import { create } from 'zustand';
import { applyGlossary } from '../../config/glossary';
import { isConsecutiveDuplicate, isHallucination } from '../../config/hallucinations';
import { LocalAudioStore } from '../adapters/local/LocalAudioStore';
import { LocalAuthProvider } from '../adapters/local/LocalAuthProvider';
import { LocalGlossaryRepository } from '../adapters/local/LocalGlossaryRepository';
import { LocalSessionRepository } from '../adapters/local/LocalSessionRepository';
import { LocalSettingsRepository } from '../adapters/local/LocalSettingsRepository';
import { LocalTranscriptRepository } from '../adapters/local/LocalTranscriptRepository';
import { BatteryStatus, RecordingController, VuData } from '../core/audio/recordingController';
import { getSharedWhisperEngine } from '../core/transcription/engine';
import { PipelineProgress, TranscriptionPipeline } from '../core/transcription/pipeline';
import { ClinicalAudioSegmenter } from '../core/transcription/vad';
import { AppSettings, AudioChunk, GlossaryEntry, Profile, Session, TranscriptSegment, Workspace } from '../core/types';

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

  public enqueue(chunk: AudioChunk, sessionId: string, workspaceId: string) {
    this.queue.push({ chunk, sessionId, workspaceId });
    this.processQueue();
  }

  private async processQueue() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;

    try {
      const item = this.queue.shift();
      if (!item) return;

      const { chunk, sessionId, workspaceId } = item;
      const engine = getSharedWhisperEngine();
      if (!engine.getBackend()) {
        await engine.load('fast');
      }

      // Convert chunk 16kHz Int16 to Float32
      const int16 = new Int16Array(chunk.pcmData);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        const s = int16[i];
        float32[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
      }

      const speechSegments = this.segmenter.segmentAudio(float32);
      if (speechSegments.length === 0) return;

      const glossaryEntries = await glossaryRepo.getAll(workspaceId);
      const initialPrompt =
        'Consulta odontológica en español. Términos: conductometría, endodoncia, amalgama, obturación, periodonto, composite, carilla, oclusal, mesial, distal, vestibular, palatino, periapical, gutapercha, raspaje, exodoncia, implante, prótesis, anestesia, tartrectomía, bruxismo.';

      for (let i = 0; i < speechSegments.length; i++) {
        const seg = speechSegments[i];
        const segStart = chunk.startTime + seg.startSec;
        const segEnd = chunk.startTime + seg.endSec;

        const res = await engine.transcribe(seg.samples, {
          language: 'es',
          initialPrompt,
          segmentIndex: chunk.chunkIndex * 10 + i,
          startSec: segStart,
          endSec: segEnd,
        });

        const rawText = res.text?.trim() || '';
        if (rawText && !isHallucination(rawText) && !isConsecutiveDuplicate(rawText, this.lastTranscribedText)) {
          const processedText = applyGlossary(rawText, glossaryEntries);
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

          // If user is viewing this session, update store in real-time
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
      }
    }
  }
}

export const backgroundChunkTranscriber = new BackgroundChunkTranscriber();

export type AppView = 'home' | 'recording' | 'detail' | 'settings' | 'privacy' | 'benchmark';

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
  recordingDurationSec: number;
  dayPatientIndex: number;
  vu: VuData;
  lastSavedAt: number | null;
  silenceWarning: boolean;
  wakeLockActive: boolean;
  battery: BatteryStatus;

  // Transcription State
  transcriptionPipeline: TranscriptionPipeline | null;
  transcribingSessionId: string | null;
  transcriptionProgress: PipelineProgress | null;
  transcriptionFallbackNotice: string | null;

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
  startRecording: (reference?: string, consentGiven?: boolean) => Promise<void>;
  pauseRecording: () => void;
  resumeRecording: () => void;
  nextPatient: () => Promise<void>;
  stopRecording: () => Promise<void>;
  discardRecording: () => Promise<void>;
  recoverRecording: (session: Session) => Promise<void>;
  dismissRecovery: () => Promise<void>;
  startTranscription: (sessionId: string) => Promise<void>;
  cancelTranscription: () => void;
  updateSegmentText: (segmentId: string, newText: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  deleteAudioForSession: (sessionId: string) => Promise<void>;
  clearTranscribedAudioAll: () => Promise<void>;
  clearAllData: () => Promise<void>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  addGlossaryEntry: (incorrect: string, correct: string) => Promise<void>;
  removeGlossaryEntry: (id: string) => Promise<void>;
  importAudioFile: (file: File, reference?: string) => Promise<void>;
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
  dayPatientIndex: 1,
  recordingDurationSec: 0,
  vu: { rms: 0, peak: 0 },
  lastSavedAt: null,
  silenceWarning: false,
  wakeLockActive: false,
  battery: { supported: false, level: 100, charging: true },

  transcriptionPipeline: null,
  transcribingSessionId: null,
  transcriptionProgress: null,
  transcriptionFallbackNotice: null,

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

    // Check first time onboarding
    const seenOnboarding = localStorage.getItem('escriba_onboarding_done');
    const showOnboarding = !seenOnboarding;

    // Apply theme
    applyThemeClass(sets.theme);

    // Recover any session that was interrupted during transcription (e.g. browser reload/crash)
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

    // Check battery
    const batt = await RecordingController.getBatteryStatus();
    set({ battery: batt });

    // Pre-warm the shared Whisper engine in background after initial render
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        getSharedWhisperEngine().load('fast').catch(() => {});
      }, 1500);
    }
  },

  setView: (view: AppView, sessionId?: string) => {
    set({
      currentView: view,
      currentSessionId: sessionId || null,
    });
    if (view === 'detail' && sessionId) {
      get().loadSessionDetail(sessionId);
    }
    if (view === 'home') {
      get().loadSessions();
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

  startRecording: async (reference = '', consentGiven = true) => {
    const ws = get().workspace;
    if (!ws) return;

    const sessionId = `session_${Date.now()}`;
    const newSession: Session = {
      id: sessionId,
      workspaceId: ws.id,
      title: reference.trim() ? `Consulta ${reference.trim()}` : `Consulta del ${new Date().toLocaleDateString('es-AR')}`,
      reference: reference.trim(),
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
      onWakeLockChange: (active) => set({ wakeLockActive: active }),
      onError: (err) => {
        get().showToast(err.message || 'Error en la grabación', 'warning');
      },
    });

    const settings = get().settings;
    await controller.startRecording(newSession, {
      noiseSuppression: settings?.noiseSuppression ?? false,
      audioDeviceId: settings?.selectedAudioDeviceId,
    });

    set({
      recordingController: controller,
      isRecording: true,
      isPaused: false,
      dayPatientIndex: 1,
      recordingDurationSec: 0,
      currentView: 'recording',
      activeSession: newSession,
      currentSessionId: sessionId,
      lastSavedAt: Date.now(),
      silenceWarning: false,
    });
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
      set({ isPaused: false });
    }
  },

  nextPatient: async () => {
    const controller = get().recordingController;
    const ws = get().workspace;
    if (!controller || !ws) return;

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

      // Tactile / vibration feedback if supported
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate([60, 40, 60]);
        } catch {
          // ignore
        }
      }

      set({
        dayPatientIndex: nextIndex,
        activeSession: newSession,
        currentSessionId: sessionId,
        recordingDurationSec: 0,
        lastSavedAt: Date.now(),
      });

      // Reload sessions list in background
      await get().loadSessions();

      get().showToast(`¡Consulta anterior guardada! Iniciando Paciente #${nextIndex}`, 'success');
    } catch (err: any) {
      console.error('Error switching to next patient:', err);
      get().showToast(err.message || 'Error al cambiar de paciente', 'warning');
    }
  },

  stopRecording: async () => {
    const controller = get().recordingController;
    if (controller) {
      const finishedSession = await controller.stopRecording();
      set({
        isRecording: false,
        isPaused: false,
        recordingController: null,
      });

      await get().loadSessions();

      // Check auto transcribe option
      const settings = get().settings;
      if (settings?.autoTranscribeOnStop) {
        get().setView('detail', finishedSession.id);
        get().startTranscription(finishedSession.id);
      } else {
        get().setView('detail', finishedSession.id);
      }
    }
  },

  discardRecording: async () => {
    const controller = get().recordingController;
    if (controller) {
      await controller.discardRecording();
      set({
        isRecording: false,
        isPaused: false,
        recordingController: null,
        activeSession: null,
      });
      get().setView('home');
      get().showToast('Grabación descartada', 'info');
    }
  },

  recoverRecording: async (session: Session) => {
    // Treat as normal recorded session with what was saved in IndexedDB
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

  startTranscription: async (sessionId: string) => {
    const ws = get().workspace;
    if (!ws) return;

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
      transcriptionProgress: {
        sessionId,
        percent: 0,
        currentSegment: 0,
        totalSegments: 1,
        estimatedRemainingSec: 0,
        statusText: 'Iniciando pipeline de transcripción...',
      },
    });

    try {
      const segments = await pipeline.run(
        sessionId,
        ws.id,
        (prog) => {
          set({ transcriptionProgress: prog });
        },
        (newSegment) => {
          // Stream new segment immediately into UI transcript list
          set((state) => {
            const exists = state.activeTranscript.some((s) => s.id === newSegment.id);
            const updated = exists ? state.activeTranscript : [...state.activeTranscript, newSegment];
            return {
              activeTranscript: updated.sort((a, b) => a.start - b.start),
            };
          });
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
      get().showToast('Transcripción completada con éxito', 'success');
    } catch (err: any) {
      console.error('Transcription error:', err);
      set({
        transcribingSessionId: null,
        transcriptionProgress: null,
        transcriptionPipeline: null,
      });
      await sessionRepo.update(sessionId, { status: 'error', error: err.message });
      await get().loadSessionDetail(sessionId);
      get().showToast(err.message || 'Error en la transcripción', 'warning');
    }
  },

  cancelTranscription: () => {
    const pipeline = get().transcriptionPipeline;
    if (pipeline) {
      pipeline.cancel();
      set({
        transcribingSessionId: null,
        transcriptionProgress: null,
        transcriptionPipeline: null,
      });
      get().showToast('Transcripción detenida', 'info');
    }
  },

  updateSegmentText: async (segmentId: string, newText: string) => {
    await transcriptRepo.updateSegment(segmentId, newText);
    const active = get().activeTranscript.map((s) =>
      s.id === segmentId ? { ...s, text: newText, edited: true } : s
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
    } catch (err: any) {
      console.error('Import error:', err);
      get().showToast(err.message || 'Error al importar audio', 'warning');
    }
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
    // system
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }
}
