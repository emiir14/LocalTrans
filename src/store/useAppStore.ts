import { create } from 'zustand';
import { applyGlossary } from '../../config/glossary';
import { isConsecutiveDuplicate, isHallucination } from '../../config/hallucinations';
import { LocalAudioStore } from '../adapters/local/LocalAudioStore';
import { LocalAuthProvider } from '../adapters/local/LocalAuthProvider';
import { LocalGlossaryRepository } from '../adapters/local/LocalGlossaryRepository';
import { LocalSessionRepository } from '../adapters/local/LocalSessionRepository';
import { LocalSettingsRepository } from '../adapters/local/LocalSettingsRepository';
import { LocalTranscriptRepository } from '../adapters/local/LocalTranscriptRepository';
import { RecordingController, VuData } from '../core/audio/recordingController';
import {
  exportFullBackup,
  exportGlossaryJson,
  importGlossaryJson,
  restoreFullBackup,
} from '../core/export/backup';
import { getSharedWhisperEngine, ProgressCallbackData } from '../core/transcription/engine';
import { checkModelCacheStatus, ModelCacheStatus } from '../core/transcription/modelCache';
import { PipelineProgress, TranscriptionPipeline } from '../core/transcription/pipeline';
import { buildSegmentPrompt } from '../core/transcription/prompts';
import { getDefaultModelTier, shouldShowDownloadsTab } from '../core/runtime/platform';
import { ClinicalAudioSegmenter } from '../core/transcription/vad';
import {
  AppSettings,
  AudioChunk,
  ClinicalNote,
  GlossaryEntry,
  ModelTier,
  Profile,
  Session,
  TranscriptSegment,
  TranscriptionMode,
  Workspace,
} from '../core/types';
import { wakeLockManager } from '../core/utils/wakeLockManager';

// Global singletons for repositories
export const sessionRepo = new LocalSessionRepository();
export const transcriptRepo = new LocalTranscriptRepository();
export const audioStore = new LocalAudioStore();
export const glossaryRepo = new LocalGlossaryRepository();
export const settingsRepo = new LocalSettingsRepository();
export const authProvider = new LocalAuthProvider();

/**
 * Progressive background pre-transcriber that processes audio chunks during recording
 */
class BackgroundChunkTranscriber {
  private queue: Array<{ chunk: AudioChunk; sessionId: string; workspaceId: string }> = [];
  private isProcessing = false;
  private segmenter = new ClinicalAudioSegmenter();
  private lastTranscribedText = '';
  private lastSessionId = '';
  private idleWaiters: Array<() => void> = [];

  public enqueue(chunk: AudioChunk, sessionId: string, workspaceId: string) {
    if (this.lastSessionId !== sessionId) {
      this.lastSessionId = sessionId;
      this.lastTranscribedText = '';
    }
    this.queue.push({ chunk, sessionId, workspaceId });
    this.processQueue();
  }

  public resetSessionContext() {
    this.lastTranscribedText = '';
    this.lastSessionId = '';
  }

  public clearQueueForSession(sessionId: string) {
    this.queue = this.queue.filter((item) => item.sessionId !== sessionId);
  }

  public async waitForIdle(): Promise<void> {
    if (!this.isProcessing && this.queue.length === 0) return;
    return new Promise((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  private notifyIdleIfDone() {
    if (!this.isProcessing && this.queue.length === 0) {
      const waiters = this.idleWaiters.splice(0, this.idleWaiters.length);
      waiters.forEach((w) => w());
    }
  }

  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      this.notifyIdleIfDone();
      return;
    }
    this.isProcessing = true;
    await wakeLockManager.acquire('bg_transcription');

    try {
      const item = this.queue.shift();
      if (!item) return;

      const { chunk, sessionId, workspaceId } = item;
      const engine = getSharedWhisperEngine();
      if (!engine.isReady()) {
        const currentSettings = useAppStore.getState().settings;
        await engine.load(currentSettings?.modelTier || getDefaultModelTier());
      }

      const int16 = new Int16Array(chunk.pcmData);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        const s = int16[i];
        float32[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
      }

      const speechSegments = this.segmenter.segmentAudio(float32);
      if (speechSegments.length === 0) return;

      const mode: TranscriptionMode = useAppStore.getState().settings?.transcriptionMode || 'dental';
      const glossaryEntries = mode === 'dental' ? await glossaryRepo.getAll(workspaceId) : [];

      for (let i = 0; i < speechSegments.length; i++) {
        const seg = speechSegments[i];
        const segStart = chunk.startTime + seg.startSec;
        const segEnd = chunk.startTime + seg.endSec;
        const initialPrompt = buildSegmentPrompt(mode, this.lastTranscribedText);

        const res = await engine.transcribe(seg.samples, {
          language: 'es',
          initialPrompt,
          segmentIndex: chunk.chunkIndex * 10 + i,
          startSec: segStart,
          endSec: segEnd,
        });

        const rawText = res.text?.trim() || '';
        if (rawText && !isHallucination(rawText) && !isConsecutiveDuplicate(rawText, this.lastTranscribedText)) {
          const processedText = mode === 'dental' ? applyGlossary(rawText, glossaryEntries) : rawText;
          const segment: TranscriptSegment = {
            id: `seg_${sessionId}_bg_${Date.now()}_${chunk.chunkIndex}_${i}`,
            sessionId,
            start: segStart,
            end: segEnd,
            text: processedText,
            originalText: rawText,
            edited: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          await transcriptRepo.addSegment(segment);
          this.lastTranscribedText = processedText;

          if (useAppStore.getState().currentSessionId === sessionId) {
            useAppStore.setState((state) => ({
              activeTranscript: [...state.activeTranscript, segment].sort((a, b) => a.start - b.start),
            }));
          }
        }
      }
    } catch (err) {
      console.warn('[BackgroundChunkTranscriber] Non-blocking notice:', err);
    } finally {
      this.isProcessing = false;
      if (this.queue.length > 0) {
        this.processQueue();
      } else {
        await wakeLockManager.release('bg_transcription');
        this.notifyIdleIfDone();
      }
    }
  }
}

export const backgroundChunkTranscriber = new BackgroundChunkTranscriber();

export type AppView = 'home' | 'recording' | 'detail' | 'downloads' | 'settings' | 'privacy';

interface AppState {
  currentView: AppView;
  currentSessionId: string | null;
  workspace: Workspace | null;
  profile: Profile | null;
  sessions: Session[];
  activeSession: Session | null;
  activeTranscript: TranscriptSegment[];
  settings: AppSettings | null;
  glossary: GlossaryEntry[];

  // Recording State
  recordingController: RecordingController | null;
  isRecording: boolean;
  isPaused: boolean;
  isQuickDictationMode: boolean;
  appendingToSessionId: string | null;
  recordingDurationSec: number;
  dayPatientIndex: number;
  vu: VuData;
  lastSavedAt: number | null;
  silenceWarning: boolean;
  trackDisconnectedWarning: string | null;
  wakeLockActive: boolean;

  // Transcription & Model Cache State
  transcriptionPipeline: TranscriptionPipeline | null;
  transcribingSessionId: string | null;
  transcriptionProgress: PipelineProgress | null;
  transcriptionFallbackNotice: string | null;
  modelCacheStatuses: Record<'balanced' | 'max', ModelCacheStatus | null>;
  downloadingModelTier: 'balanced' | 'max' | null;
  modelDownloadProgress: number;

  // Recovery & Modals
  unclosedSession: Session | null;
  showOnboarding: boolean;
  toastMessage: { text: string; type: 'info' | 'success' | 'warning' } | null;

  // Storage
  storageUsage: { usedBytes: number; quotaBytes: number };

  // Actions
  init: () => Promise<void>;
  setView: (view: AppView, sessionId?: string) => void;
  loadSessions: () => Promise<void>;
  loadSessionDetail: (sessionId: string) => Promise<void>;
  startRecording: (
    reference?: string,
    consentGiven?: boolean,
    options?: { isQuickDictation?: boolean }
  ) => Promise<void>;
  appendRecordingToSession: (sessionId: string) => Promise<void>;
  pauseRecording: () => void;
  resumeRecording: () => void;
  nextPatient: () => Promise<void>;
  stopRecording: () => Promise<void>;
  discardRecording: () => Promise<void>;
  recoverRecording: (session: Session) => Promise<void>;
  dismissRecovery: () => Promise<void>;
  startTranscription: (
    sessionId: string,
    options?: { forceRetranscribe?: boolean; modeOverride?: TranscriptionMode }
  ) => Promise<void>;
  cancelTranscription: () => void;
  updateSessionMeta: (
    sessionId: string,
    patch: { title?: string; reference?: string }
  ) => Promise<void>;
  saveClinicalNote: (sessionId: string, note: ClinicalNote) => Promise<void>;
  updateSegmentText: (segmentId: string, newText: string) => Promise<void>;
  updateSegmentSpeaker: (segmentId: string, speaker: string | undefined) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  deleteAudioForSession: (sessionId: string) => Promise<void>;
  clearTranscribedAudioAll: () => Promise<void>;
  clearAllData: () => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  addGlossaryEntry: (incorrect: string, correct: string) => Promise<void>;
  removeGlossaryEntry: (id: string) => Promise<void>;
  importAudioFile: (file: File, reference?: string) => Promise<void>;
  refreshModelCacheStatuses: () => Promise<void>;
  downloadModelForOffline: (tier: 'balanced' | 'max') => Promise<void>;
  exportLocalBackup: () => Promise<string>;
  importLocalBackup: (jsonText: string) => Promise<void>;
  exportGlossaryBackup: () => string;
  importGlossaryBackup: (jsonText: string) => Promise<void>;
  showToast: (text: string, type?: 'info' | 'success' | 'warning') => void;
  closeOnboarding: () => void;

  // Global Confirm Dialog
  confirmDialog: ConfirmDialogConfig | null;
  openConfirm: (config: ConfirmDialogConfig) => void;
  closeConfirm: () => void;
}

export interface ConfirmDialogConfig {
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
  onConfirm: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  currentView: 'home',
  currentSessionId: null,
  workspace: null,
  profile: null,
  sessions: [],
  activeSession: null,
  activeTranscript: [],
  settings: null,
  glossary: [],

  recordingController: null,
  isRecording: false,
  isPaused: false,
  isQuickDictationMode: false,
  appendingToSessionId: null,
  dayPatientIndex: 1,
  recordingDurationSec: 0,
  vu: { rms: 0, peak: 0 },
  lastSavedAt: null,
  silenceWarning: false,
  trackDisconnectedWarning: null,
  wakeLockActive: false,

  transcriptionPipeline: null,
  transcribingSessionId: null,
  transcriptionProgress: null,
  transcriptionFallbackNotice: null,
  modelCacheStatuses: { balanced: null, max: null },
  downloadingModelTier: null,
  modelDownloadProgress: 0,

  unclosedSession: null,
  showOnboarding: false,
  toastMessage: null,
  storageUsage: { usedBytes: 0, quotaBytes: 0 },
  confirmDialog: null,

  init: async () => {
    const ws = await authProvider.getCurrentWorkspace();
    const prof = await authProvider.getCurrentProfile();
    await glossaryRepo.seedDefaultsIfEmpty(ws.id);
    const sets = await settingsRepo.get(ws.id);
    const gloss = await glossaryRepo.getAll(ws.id);
    const unclosed = await sessionRepo.findUnclosedRecording(ws.id);
    const storageEst = await audioStore.getStorageEstimate();

    const seenOnboarding = localStorage.getItem('escriba_onboarding_done');
    const showOnboarding = !seenOnboarding;

    applyThemeClass(sets.theme);

    const allUserSessions = await sessionRepo.getAll(ws.id);
    const interruptedSession = allUserSessions.find((s) => s.status === 'transcribing');
    if (interruptedSession) {
      await sessionRepo.update(interruptedSession.id, { status: 'recorded' });
    }

    set({
      workspace: ws,
      profile: prof,
      settings: sets,
      glossary: gloss,
      unclosedSession: unclosed || null,
      showOnboarding,
      storageUsage: storageEst,
    });

    await get().loadSessions();
    await get().refreshModelCacheStatuses();

    wakeLockManager.subscribe((active) => {
      set({ wakeLockActive: active });
    });

    if (typeof window !== 'undefined') {
      setTimeout(() => {
        getSharedWhisperEngine().load(sets.modelTier || getDefaultModelTier()).catch(() => {});
      }, 1500);
    }
  },

  setView: (view: AppView, sessionId?: string) => {
    const safeView: AppView =
      view === 'downloads' && !shouldShowDownloadsTab() ? 'home' : view;
    set({
      currentView: safeView,
      currentSessionId: sessionId || null,
    });
    if (safeView === 'detail' && sessionId) {
      get().loadSessionDetail(sessionId);
    }
    if (safeView === 'home') {
      get().loadSessions();
    }
    if (safeView === 'settings') {
      get().refreshModelCacheStatuses();
    }
  },

  loadSessions: async () => {
    const ws = get().workspace;
    if (!ws) return;
    const list = await sessionRepo.getAll(ws.id);
    const storage = await audioStore.getStorageEstimate();
    set({ sessions: list, storageUsage: storage });
  },

  loadSessionDetail: async (sessionId: string) => {
    const session = await sessionRepo.getById(sessionId);
    if (!session) return;
    const segments = await transcriptRepo.getBySessionId(sessionId);
    set({
      activeSession: session,
      activeTranscript: segments,
      currentSessionId: sessionId,
    });
  },

  startRecording: async (reference = '', consentGiven = true, options = {}) => {
    const ws = get().workspace;
    if (!ws) return;

    backgroundChunkTranscriber.resetSessionContext();
    const isQuick = Boolean(options.isQuickDictation);
    const now = new Date();
    const timeStr = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    const sessionId = `session_${Date.now()}`;

    const newSession: Session = {
      id: sessionId,
      workspaceId: ws.id,
      title: isQuick
        ? `Dictado rápido (${timeStr} hs)`
        : reference.trim()
        ? `Consulta ${reference.trim()}`
        : `Consulta del ${now.toLocaleDateString('es-AR')}`,
      reference: reference.trim() || (isQuick ? `Dictado rápido ${timeStr}` : ''),
      status: 'recording',
      durationSec: 0,
      consentGiven,
      audioDeleted: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const controller = new RecordingController(sessionRepo, audioStore);

    controller.setCallbacks({
      onTimeUpdate: (sec) => set({ recordingDurationSec: sec }),
      onVuUpdate: (vu) => set({ vu }),
      onChunkSaved: (lastSavedAt, _totalChunks, chunk) => {
        set({ lastSavedAt });
        const settings = get().settings;
        if ((settings?.progressiveTranscription ?? true) && chunk) {
          backgroundChunkTranscriber.enqueue(chunk, chunk.sessionId, ws.id);
        }
      },
      onSilenceWarning: (silent) => set({ silenceWarning: silent }),
      onTrackEnded: (reason) => {
        set({ trackDisconnectedWarning: reason });
        get().showToast(reason, 'warning');
      },
      onWakeLockChange: (active) => set({ wakeLockActive: active }),
      onError: (err) => {
        get().showToast(err.message || 'Error en la grabación', 'warning');
      },
    });

    const settings = get().settings;
    try {
      await controller.startRecording(newSession, {
        noiseSuppression: settings?.noiseSuppression ?? false,
        audioDeviceId: settings?.selectedAudioDeviceId,
      });

      set({
        recordingController: controller,
        isRecording: true,
        isPaused: false,
        isQuickDictationMode: isQuick,
        appendingToSessionId: null,
        dayPatientIndex: 1,
        recordingDurationSec: 0,
        currentView: 'recording',
        activeSession: newSession,
        currentSessionId: sessionId,
        lastSavedAt: Date.now(),
        silenceWarning: false,
        trackDisconnectedWarning: null,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      console.error('Failed to start recording:', err);
      get().showToast(
        msg || 'No se pudo acceder al micrófono. Por favor verifica los permisos en tu navegador.',
        'warning'
      );
    }
  },

  appendRecordingToSession: async (sessionId: string) => {
    const ws = get().workspace;
    if (!ws) return;

    const existingSession = await sessionRepo.getById(sessionId);
    if (!existingSession || existingSession.audioDeleted) {
      get().showToast('No es posible anexar audio a esta consulta.', 'warning');
      return;
    }

    const existingChunks = await audioStore.getChunks(sessionId);
    const initialChunkIndex =
      existingChunks.length > 0
        ? Math.max(...existingChunks.map((c) => c.chunkIndex)) + 1
        : 0;
    const initialOffsetSec = existingChunks.reduce(
      (sum, c) => sum + Math.max(0, c.endTime - c.startTime),
      0
    );

    backgroundChunkTranscriber.resetSessionContext();
    const controller = new RecordingController(sessionRepo, audioStore);

    controller.setCallbacks({
      onTimeUpdate: (sec) => set({ recordingDurationSec: sec }),
      onVuUpdate: (vu) => set({ vu }),
      onChunkSaved: (lastSavedAt, _totalChunks, chunk) => {
        set({ lastSavedAt });
        const settings = get().settings;
        if ((settings?.progressiveTranscription ?? true) && chunk) {
          backgroundChunkTranscriber.enqueue(chunk, chunk.sessionId, ws.id);
        }
      },
      onSilenceWarning: (silent) => set({ silenceWarning: silent }),
      onTrackEnded: (reason) => {
        set({ trackDisconnectedWarning: reason });
        get().showToast(reason, 'warning');
      },
      onWakeLockChange: (active) => set({ wakeLockActive: active }),
      onError: (err) => {
        get().showToast(err.message || 'Error en la grabación', 'warning');
      },
    });

    const settings = get().settings;
    try {
      await controller.startRecording(existingSession, {
        noiseSuppression: settings?.noiseSuppression ?? false,
        audioDeviceId: settings?.selectedAudioDeviceId,
        initialChunkIndex,
        initialOffsetSec,
        skipSessionCreate: true,
      });

      set({
        recordingController: controller,
        isRecording: true,
        isPaused: false,
        isQuickDictationMode: false,
        appendingToSessionId: sessionId,
        dayPatientIndex: 1,
        recordingDurationSec: Math.round(initialOffsetSec),
        currentView: 'recording',
        activeSession: existingSession,
        currentSessionId: sessionId,
        lastSavedAt: Date.now(),
        silenceWarning: false,
        trackDisconnectedWarning: null,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      get().showToast(
        msg || 'No se pudo acceder al micrófono para anexar audio.',
        'warning'
      );
    }
  },

  pauseRecording: () => {
    const controller = get().recordingController;
    if (controller) {
      controller.pauseRecording();
      set({ isPaused: true });
    }
  },

  resumeRecording: () => {
    const controller = get().recordingController;
    if (controller) {
      controller.resumeRecording();
      set({ isPaused: false, trackDisconnectedWarning: null });
    }
  },

  nextPatient: async () => {
    const controller = get().recordingController;
    const ws = get().workspace;
    if (!controller || !ws) return;

    backgroundChunkTranscriber.resetSessionContext();
    const nextIndex = get().dayPatientIndex + 1;
    const now = new Date();
    const timeStr = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    const sessionId = `session_${Date.now()}`;

    const newSession: Session = {
      id: sessionId,
      workspaceId: ws.id,
      title: `Consulta #${nextIndex} (${timeStr} hs)`,
      reference: `Paciente #${nextIndex}`,
      status: 'recording',
      durationSec: 0,
      consentGiven: true,
      audioDeleted: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      await controller.switchNextPatient(newSession);

      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate([60, 40, 60]);
        } catch {
          // ignore
        }
      }

      set({
        dayPatientIndex: nextIndex,
        isPaused: false,
        isQuickDictationMode: false,
        appendingToSessionId: null,
        activeSession: newSession,
        currentSessionId: sessionId,
        recordingDurationSec: 0,
        lastSavedAt: Date.now(),
        silenceWarning: false,
      });

      await get().loadSessions();
      get().showToast(`¡Consulta anterior guardada! Iniciando Paciente #${nextIndex}`, 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al cambiar de paciente';
      console.error('Error switching to next patient:', err);
      get().showToast(msg, 'warning');
    }
  },

  stopRecording: async () => {
    const controller = get().recordingController;
    const wasQuickDictation = get().isQuickDictationMode;
    const wasAppending = Boolean(get().appendingToSessionId);

    if (controller) {
      const finishedSession = await controller.stopRecording();
      set({
        isRecording: false,
        isPaused: false,
        isQuickDictationMode: false,
        appendingToSessionId: null,
        trackDisconnectedWarning: null,
        recordingController: null,
      });

      await get().loadSessions();

      const settings = get().settings;
      if (settings?.autoTranscribeOnStop || wasQuickDictation || wasAppending) {
        get().setView('detail', finishedSession.id);
        get().startTranscription(finishedSession.id);
      } else {
        get().setView('detail', finishedSession.id);
      }
    }
  },

  discardRecording: async () => {
    const controller = get().recordingController;
    const appendingId = get().appendingToSessionId;
    if (controller) {
      if (appendingId) {
        // When discarding an appended recording, finalize existing session safely without deleting original audio
        await controller.stopRecording();
        set({
          isRecording: false,
          isPaused: false,
          isQuickDictationMode: false,
          appendingToSessionId: null,
          trackDisconnectedWarning: null,
          recordingController: null,
        });
        get().setView('detail', appendingId);
        get().showToast('Anexo detenido', 'info');
        return;
      }

      await controller.discardRecording();
      set({
        isRecording: false,
        isPaused: false,
        isQuickDictationMode: false,
        appendingToSessionId: null,
        trackDisconnectedWarning: null,
        recordingController: null,
        activeSession: null,
      });
      get().setView('home');
      get().showToast('Grabación descartada', 'info');
    }
  },

  recoverRecording: async (session: Session) => {
    await sessionRepo.update(session.id, { status: 'recorded' });
    set({ unclosedSession: null });
    get().showToast('Grabación recuperada con éxito', 'success');
    get().setView('detail', session.id);
  },

  dismissRecovery: async () => {
    const unclosed = get().unclosedSession;
    if (unclosed) {
      await sessionRepo.delete(unclosed.id);
      await audioStore.deleteAudio(unclosed.id);
      set({ unclosedSession: null });
    }
  },

  startTranscription: async (sessionId: string, options = {}) => {
    const ws = get().workspace;
    if (!ws) return;

    // Prevent concurrent pipeline collision if a transcription is already running
    if (get().transcribingSessionId) {
      get().showToast('Ya hay una transcripción en curso.', 'info');
      return;
    }

    // Drain any queued/in-flight background chunk for this session before starting pipeline
    backgroundChunkTranscriber.clearQueueForSession(sessionId);

    const pipeline = new TranscriptionPipeline(
      sessionRepo,
      transcriptRepo,
      audioStore,
      glossaryRepo,
      settingsRepo,
      {
        onCorruptionFallback: (reason) => {
          set({
            transcriptionFallbackNotice: `WebGPU generó salida inestable (${reason}). Se cambió automáticamente a WASM para garantizar fidelidad.`,
          });
        },
      }
    );

    set({
      transcriptionPipeline: pipeline,
      transcribingSessionId: sessionId,
      ...(options.forceRetranscribe ? { activeTranscript: [] } : {}),
      transcriptionProgress: {
        sessionId,
        percent: 0,
        currentSegment: 0,
        totalSegments: 1,
        estimatedRemainingSec: 0,
        statusText: 'Sincronizando cola y preparando motor...',
      },
    });

    await wakeLockManager.acquire('transcription');
    try {
      await backgroundChunkTranscriber.waitForIdle();

      const segments = await pipeline.run(
        sessionId,
        ws.id,
        (prog) => {
          set({ transcriptionProgress: prog });
        },
        (newSegment) => {
          set((state) => {
            const exists = state.activeTranscript.some((s) => s.id === newSegment.id);
            const updated = exists ? state.activeTranscript : [...state.activeTranscript, newSegment];
            return {
              activeTranscript: updated.sort((a, b) => a.start - b.start),
            };
          });
        },
        {
          forceRetranscribe: options.forceRetranscribe,
          modeOverride: options.modeOverride,
        }
      );

      set({
        activeTranscript: segments,
        transcribingSessionId: null,
        transcriptionProgress: null,
        transcriptionPipeline: null,
      });

      await get().loadSessionDetail(sessionId);
      await get().loadSessions();
      await get().refreshModelCacheStatuses();
      get().showToast('Transcripción completada con éxito', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error en la transcripción';
      console.error('Transcription error:', err);
      set({
        transcribingSessionId: null,
        transcriptionProgress: null,
        transcriptionPipeline: null,
      });
      if (!msg.includes('cancelada')) {
        await sessionRepo.update(sessionId, { status: 'error', error: msg });
      }
      await get().loadSessionDetail(sessionId);
      await get().loadSessions();
      get().showToast(msg, msg.includes('cancelada') ? 'info' : 'warning');
    } finally {
      await wakeLockManager.release('transcription');
    }
  },

  cancelTranscription: () => {
    const pipeline = get().transcriptionPipeline;
    if (pipeline) {
      pipeline.cancel();
      wakeLockManager.release('transcription').catch(() => {});
      set({
        transcribingSessionId: null,
        transcriptionProgress: null,
        transcriptionPipeline: null,
      });
      get().showToast('Transcripción detenida', 'info');
    }
  },

  updateSessionMeta: async (sessionId: string, patch: { title?: string; reference?: string }) => {
    await sessionRepo.update(sessionId, patch);
    const updated = await sessionRepo.getById(sessionId);
    if (updated && get().activeSession?.id === sessionId) {
      set({ activeSession: updated });
    }
    await get().loadSessions();
    get().showToast('Datos de la consulta actualizados', 'success');
  },

  saveClinicalNote: async (sessionId: string, note: ClinicalNote) => {
    await sessionRepo.update(sessionId, { clinicalNote: note });
    const updated = await sessionRepo.getById(sessionId);
    if (updated && get().activeSession?.id === sessionId) {
      set({ activeSession: updated });
    }
    await get().loadSessions();
    get().showToast('Ficha clínica guardada', 'success');
  },

  updateSegmentText: async (segmentId: string, newText: string) => {
    await transcriptRepo.updateSegment(segmentId, newText);
    const active = get().activeTranscript.map((s) =>
      s.id === segmentId ? { ...s, text: newText, edited: true } : s
    );
    set({ activeTranscript: active });
  },

  updateSegmentSpeaker: async (segmentId: string, speaker: string | undefined) => {
    await transcriptRepo.updateSegmentSpeaker(segmentId, speaker);
    const active = get().activeTranscript.map((s) =>
      s.id === segmentId ? { ...s, speaker } : s
    );
    set({ activeTranscript: active });
  },

  deleteSession: async (sessionId: string) => {
    await audioStore.deleteAudio(sessionId);
    await transcriptRepo.deleteBySessionId(sessionId);
    await sessionRepo.delete(sessionId);
    if (get().currentSessionId === sessionId) {
      set({ activeSession: null, activeTranscript: [], currentSessionId: null });
      get().setView('home');
    }
    await get().loadSessions();
    get().showToast('Consulta y datos asociados eliminados', 'info');
  },

  deleteAudioForSession: async (sessionId: string) => {
    await audioStore.deleteAudio(sessionId);
    await sessionRepo.update(sessionId, { audioDeleted: true });
    if (get().activeSession?.id === sessionId) {
      set({ activeSession: { ...get().activeSession!, audioDeleted: true } });
    }
    await get().loadSessions();
    get().showToast('Audio eliminado para ahorrar espacio. Transcripción intacta.', 'success');
  },

  clearTranscribedAudioAll: async () => {
    const sessions = get().sessions.filter((s) => s.status === 'completed' && !s.audioDeleted);
    const ids = sessions.map((s) => s.id);
    await audioStore.deleteAllTranscribedAudio(ids);
    await get().loadSessions();
    get().showToast(`Audio de ${ids.length} consultas eliminado.`, 'success');
  },

  clearAllData: async () => {
    await audioStore.clearAll();
    await get().loadSessions();
    set({ activeSession: null, activeTranscript: [] });
    get().setView('home');
    get().showToast('Todos los datos locales han sido eliminados.', 'info');
  },

  updateSettings: async (patch: Partial<AppSettings>) => {
    const ws = get().workspace;
    if (!ws) return;
    await settingsRepo.update(ws.id, patch);
    const updated = await settingsRepo.get(ws.id);
    if (patch.theme) {
      applyThemeClass(patch.theme);
    }
    set({ settings: updated });
    get().showToast('Ajustes guardados', 'success');
  },

  addGlossaryEntry: async (incorrect: string, correct: string) => {
    const ws = get().workspace;
    if (!ws) return;
    const entry: GlossaryEntry = {
      id: `glossary_${Date.now()}`,
      workspaceId: ws.id,
      incorrect: incorrect.trim(),
      correct: correct.trim(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await glossaryRepo.add(entry);
    const updated = await glossaryRepo.getAll(ws.id);
    set({ glossary: updated });
  },

  removeGlossaryEntry: async (id: string) => {
    const ws = get().workspace;
    if (!ws) return;
    await glossaryRepo.remove(id);
    const updated = await glossaryRepo.getAll(ws.id);
    set({ glossary: updated });
  },

  importAudioFile: async (file: File, reference = '') => {
    const ws = get().workspace;
    if (!ws) return;

    const sessionId = `session_import_${Date.now()}`;
    const newSession: Session = {
      id: sessionId,
      workspaceId: ws.id,
      title: reference.trim() ? `Archivo ${reference.trim()}` : `Audio importado ${file.name}`,
      reference: reference.trim(),
      status: 'recording',
      durationSec: 0,
      consentGiven: true,
      audioDeleted: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    try {
      get().showToast('Decodificando y remuestreando audio...', 'info');
      const finished = await RecordingController.importAudioFile(
        file,
        newSession,
        sessionRepo,
        audioStore
      );
      await get().loadSessions();
      get().setView('detail', finished.id);
      get().showToast('Audio importado correctamente', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al importar audio';
      console.error('Import error:', err);
      get().showToast(msg, 'warning');
    }
  },

  refreshModelCacheStatuses: async () => {
    try {
      const [balanced, max] = await Promise.all([
        checkModelCacheStatus('balanced'),
        checkModelCacheStatus('max'),
      ]);
      set({
        modelCacheStatuses: { balanced, max },
      });
    } catch {
      // ignore cache check failure
    }
  },

  downloadModelForOffline: async (tier: 'balanced' | 'max') => {
    if (get().downloadingModelTier) return;
    set({ downloadingModelTier: tier, modelDownloadProgress: 0 });
    try {
      const engine = getSharedWhisperEngine();
      await engine.load(tier, (p: ProgressCallbackData) => {
        if (p.status === 'progress' && typeof p.progress === 'number') {
          set({ modelDownloadProgress: Math.round(p.progress) });
        }
      });
      await get().refreshModelCacheStatuses();
      get().showToast('Modelo listo y guardado para usar sin internet', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al descargar modelo';
      get().showToast(msg, 'warning');
    } finally {
      set({ downloadingModelTier: null, modelDownloadProgress: 0 });
    }
  },

  exportLocalBackup: async () => {
    const ws = get().workspace;
    if (!ws) throw new Error('Espacio de trabajo no inicializado');
    return await exportFullBackup(ws.id);
  },

  importLocalBackup: async (jsonText: string) => {
    const ws = get().workspace;
    if (!ws) return;
    const summary = await restoreFullBackup(jsonText, ws.id);
    const updatedGlossary = await glossaryRepo.getAll(ws.id);
    set({ glossary: updatedGlossary });
    await get().loadSessions();
    get().showToast(
      `Respaldo importado: ${summary.sessionsRestored} consultas y ${summary.glossaryRestored} términos nuevos`,
      'success'
    );
  },

  exportGlossaryBackup: () => {
    return exportGlossaryJson(get().glossary);
  },

  importGlossaryBackup: async (jsonText: string) => {
    const ws = get().workspace;
    if (!ws) return;
    const added = await importGlossaryJson(jsonText, ws.id);
    const updatedGlossary = await glossaryRepo.getAll(ws.id);
    set({ glossary: updatedGlossary });
    get().showToast(
      added > 0
        ? `Se agregaron ${added} términos nuevos al glosario`
        : 'El glosario ya contenía todos esos términos',
      'success'
    );
  },

  showToast: (text: string, type: 'info' | 'success' | 'warning' = 'info') => {
    set({ toastMessage: { text, type } });
    setTimeout(() => {
      set({ toastMessage: null });
    }, 4000);
  },

  closeOnboarding: () => {
    localStorage.setItem('escriba_onboarding_done', 'true');
    set({ showOnboarding: false });
  },

  openConfirm: (config) => {
    set({ confirmDialog: config });
  },

  closeConfirm: () => {
    set({ confirmDialog: null });
  },
}));

function applyThemeClass(theme: 'light' | 'dark' | 'system') {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else if (theme === 'light') {
    root.classList.remove('dark');
  } else {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }
}
