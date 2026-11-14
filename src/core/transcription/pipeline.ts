import { applyGlossary } from '../../../config/glossary';
import { isConsecutiveDuplicate, isHallucination } from '../../../config/hallucinations';
import {
  IAudioStore,
  IGlossaryRepository,
  ISessionRepository,
  ISettingsRepository,
  ITranscriptRepository,
  ITranscriptionEngine,
} from '../interfaces';
import { formatTimeDisplay } from '../export/formatter';
import { ModelTier, TranscriptSegment, TranscriptionMode } from '../types';
import { getSharedWhisperEngine } from './engine';
import { buildSegmentPrompt } from './prompts';
import { ClinicalAudioSegmenter } from './vad';
import { wakeLockManager } from '../utils/wakeLockManager';

export interface PipelineProgress {
  sessionId: string;
  percent: number;
  currentSegment: number;
  totalSegments: number;
  estimatedRemainingSec: number;
  statusText: string;
  isDownloadingModel?: boolean;
  modelDownloadProgress?: number;
  lastTranscribedText?: string;
  currentSegmentTime?: string;
  activeBackend?: 'webgpu' | 'wasm';
  activeTier?: ModelTier;
}

export class TranscriptionPipeline {
  private engine: ITranscriptionEngine;
  private isCancelled = false;

  constructor(
    private sessionRepo: ISessionRepository,
    private transcriptRepo: ITranscriptRepository,
    private audioStore: IAudioStore,
    private glossaryRepo: IGlossaryRepository,
    private settingsRepo: ISettingsRepository,
    options: { onCorruptionFallback?: (reason: string) => void } = {}
  ) {
    this.engine = getSharedWhisperEngine({
      onCorruptionFallback: options.onCorruptionFallback,
    });
  }

  public cancel() {
    this.isCancelled = true;
  }

  public async run(
    sessionId: string,
    workspaceId: string,
    onProgress?: (progress: PipelineProgress) => void,
    onSegmentTranscribed?: (segment: TranscriptSegment) => void,
    runOptions: { forceRetranscribe?: boolean; modeOverride?: TranscriptionMode } = {}
  ): Promise<TranscriptSegment[]> {
    this.isCancelled = false;
    await wakeLockManager.acquire(`pipeline_${sessionId}`);
    try {
      const session = await this.sessionRepo.getById(sessionId);
      if (!session) {
        throw new Error(`Sesión ${sessionId} no encontrada`);
      }

      // 1. Mark session as transcribing
      await this.sessionRepo.update(sessionId, { status: 'transcribing', error: undefined });

      // 2. Load audio PCM Float32 from local IndexedDB
      onProgress?.({
        sessionId,
        percent: 5,
        currentSegment: 0,
        totalSegments: 1,
        estimatedRemainingSec: 0,
        statusText: 'Cargando audio local...',
      });

      const fullAudio = await this.audioStore.getCombinedPcmFloat32(sessionId);
      if (fullAudio.length === 0) {
        throw new Error('No se encontraron datos de audio para esta sesión');
      }

      // 3. Segment audio using VAD + windowed audio leveling
      onProgress?.({
        sessionId,
        percent: 10,
        currentSegment: 0,
        totalSegments: 1,
        estimatedRemainingSec: 0,
        statusText: 'Detectando actividad de voz y nivelando audio...',
      });

      const segmenter = new ClinicalAudioSegmenter();
      const speechSegments = segmenter.segmentAudio(fullAudio);

      if (speechSegments.length === 0) {
        await this.sessionRepo.update(sessionId, { status: 'completed' });
        return [];
      }

      // 4. Load Whisper model (when forcing retranscribe, always use the latest chosen settings.modelTier)
      const settings = await this.settingsRepo.get(workspaceId);
      const transcriptionMode: TranscriptionMode =
        runOptions.modeOverride || settings.transcriptionMode || 'dental';
      const tier: ModelTier = runOptions.forceRetranscribe
        ? settings.modelTier || 'balanced'
        : session.modelTierUsed || settings.modelTier || 'balanced';

      onProgress?.({
        sessionId,
        percent: 15,
        currentSegment: 0,
        totalSegments: speechSegments.length,
        estimatedRemainingSec: 0,
        statusText: 'Preparando modelo de transcripción local...',
        isDownloadingModel: true,
        modelDownloadProgress: 0,
      });

      let maxModelPct = 0;
      await this.engine.load(tier, (p) => {
        if (p.status === 'progress' && typeof p.progress === 'number') {
          maxModelPct = Math.max(maxModelPct, Math.min(100, Math.round(p.progress)));
          onProgress?.({
            sessionId,
            percent: 15 + Math.round((maxModelPct / 100) * 15),
            currentSegment: 0,
            totalSegments: speechSegments.length,
            estimatedRemainingSec: 0,
            statusText: `Descargando componentes del modelo (${maxModelPct}%)...`,
            isDownloadingModel: true,
            modelDownloadProgress: maxModelPct,
          });
        }
      });

      if (this.isCancelled) {
        await this.sessionRepo.update(sessionId, { status: 'recorded' });
        throw new Error('Transcripción cancelada por el usuario');
      }

      // If forcing a fresh re-transcription, clear previous segments safely now that audio & model are ready
      if (runOptions.forceRetranscribe) {
        await this.transcriptRepo.deleteBySessionId(sessionId);
      }

      // 5. Load Glossary only when operating in clinical dental mode
      const glossaryEntries =
        transcriptionMode === 'dental' ? await this.glossaryRepo.getAll(workspaceId) : [];

      // 6. Check existing segments to support resumption & progressive pre-transcription.
      let existingSegments = await this.transcriptRepo.getBySessionId(sessionId);

      const getOverlappingExisting = (seg: { startSec: number; endSec: number }) => {
        return existingSegments.filter((ex) => {
          const overlapStart = Math.max(seg.startSec, ex.start);
          const overlapEnd = Math.min(seg.endSec, ex.end);
          const overlap = overlapEnd - overlapStart;
          const segDuration = seg.endSec - seg.startSec;
          return overlap > 0.5 || (segDuration > 0 && overlap / segDuration > 0.5);
        });
      };

      const isSegmentAlreadyCovered = (seg: { startSec: number; endSec: number }) => {
        const overlapping = getOverlappingExisting(seg);
        if (overlapping.length === 0) return false;
        const crossesChunkBoundary =
          Math.floor(seg.startSec / 30) !== Math.floor(Math.max(0, seg.endSec - 0.05) / 30);
        if (crossesChunkBoundary && overlapping.every((ex) => ex.id.includes('_bg_'))) {
          return false;
        }
        return true;
      };

      const remainingSegments = speechSegments.filter((seg) => !isSegmentAlreadyCovered(seg));
      let allSegments: TranscriptSegment[] = [...existingSegments];

      if (remainingSegments.length === 0 && existingSegments.length > 0) {
        await this.sessionRepo.update(sessionId, {
          status: 'completed',
          modelTierUsed: this.engine.getActiveTier(),
        });
        onProgress?.({
          sessionId,
          percent: 100,
          currentSegment: speechSegments.length,
          totalSegments: speechSegments.length,
          estimatedRemainingSec: 0,
          statusText: 'Transcripción completada al instante (procesada en tiempo real)',
          activeBackend: this.engine.getActiveBackend(),
          activeTier: this.engine.getActiveTier(),
        });
        return allSegments.sort((a, b) => a.start - b.start);
      }

      const startTimeMs = Date.now();
      let transcribedCount = 0;
      const totalSegments = speechSegments.length;
      const alreadyCoveredCount = totalSegments - remainingSegments.length;
      const remainingToTranscribe = remainingSegments.length;

      let previousText =
        existingSegments.length > 0 ? existingSegments[existingSegments.length - 1].text : '';

      // 7. Transcribe remaining segments with rolling context prompt
      for (let i = 0; i < speechSegments.length; i++) {
        if (this.isCancelled) {
          await this.sessionRepo.update(sessionId, { status: 'recorded' });
          throw new Error('Transcripción cancelada por el usuario');
        }

        const speechSeg = speechSegments[i];

        if (isSegmentAlreadyCovered(speechSeg)) {
          const overlapping = getOverlappingExisting(speechSeg);
          if (overlapping.length > 0) {
            previousText = overlapping[overlapping.length - 1].text;
          }
          continue;
        }

        const segTimeRange = `${formatTimeDisplay(speechSeg.startSec)} - ${formatTimeDisplay(speechSeg.endSec)}`;

        const elapsedSec = (Date.now() - startTimeMs) / 1000;
        let estimatedRemainingSec = 0;
        if (transcribedCount > 0) {
          const secPerSegment = elapsedSec / transcribedCount;
          estimatedRemainingSec = Math.round((remainingToTranscribe - transcribedCount) * secPerSegment);
        } else {
          estimatedRemainingSec = remainingToTranscribe * 2;
        }

        const overallCompleted = alreadyCoveredCount + transcribedCount;
        const progressPct = 30 + Math.round((overallCompleted / Math.max(1, totalSegments)) * 68);

        onProgress?.({
          sessionId,
          percent: Math.min(99, progressPct),
          currentSegment: overallCompleted + 1,
          totalSegments,
          estimatedRemainingSec,
          statusText: `Transcribiendo fragmento ${overallCompleted + 1} de ${totalSegments}...`,
          isDownloadingModel: false,
          currentSegmentTime: segTimeRange,
          lastTranscribedText: previousText || undefined,
          activeBackend: this.engine.getActiveBackend(),
          activeTier: this.engine.getActiveTier(),
        });

        const initialPrompt = buildSegmentPrompt(transcriptionMode, previousText);

        const res = await this.engine.transcribe(speechSeg.samples, {
          language: 'es',
          initialPrompt,
          segmentIndex: i,
          startSec: speechSeg.startSec,
          endSec: speechSeg.endSec,
        });

        if (this.isCancelled) {
          await this.sessionRepo.update(sessionId, { status: 'recorded' });
          throw new Error('Transcripción cancelada por el usuario');
        }

        const rawText = res.text?.trim() || '';

        const bgOverlaps = getOverlappingExisting(speechSeg).filter((ex) => ex.id.includes('_bg_'));
        if (bgOverlaps.length > 0) {
          for (const oldBg of bgOverlaps) {
            await this.transcriptRepo.deleteSegment(oldBg.id);
          }
          const removedIds = new Set(bgOverlaps.map((b) => b.id));
          existingSegments = existingSegments.filter((ex) => !removedIds.has(ex.id));
          allSegments = allSegments.filter((ex) => !removedIds.has(ex.id));
        }

        if (rawText && !isHallucination(rawText) && !isConsecutiveDuplicate(rawText, previousText)) {
          const processedText =
            transcriptionMode === 'dental' ? applyGlossary(rawText, glossaryEntries) : rawText;

          const segment: TranscriptSegment = {
            id: `seg_${sessionId}_${Date.now()}_${i}`,
            sessionId,
            start: speechSeg.startSec,
            end: speechSeg.endSec,
            text: processedText,
            originalText: rawText,
            edited: false,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };

          await this.transcriptRepo.addSegment(segment);
          allSegments.push(segment);
          previousText = processedText;

          onSegmentTranscribed?.(segment);

          onProgress?.({
            sessionId,
            percent: Math.min(99, progressPct),
            currentSegment: overallCompleted + 1,
            totalSegments,
            estimatedRemainingSec,
            statusText: `Transcribiendo (${overallCompleted + 1}/${totalSegments})...`,
            isDownloadingModel: false,
            currentSegmentTime: segTimeRange,
            lastTranscribedText: processedText,
            activeBackend: this.engine.getActiveBackend(),
            activeTier: this.engine.getActiveTier(),
          });
        }

        transcribedCount++;
      }

      await this.sessionRepo.update(sessionId, {
        status: 'completed',
        modelTierUsed: this.engine.getActiveTier(),
      });

      onProgress?.({
        sessionId,
        percent: 100,
        currentSegment: totalSegments,
        totalSegments,
        estimatedRemainingSec: 0,
        statusText: '¡Transcripción completada con éxito!',
        lastTranscribedText: previousText || undefined,
        activeBackend: this.engine.getActiveBackend(),
        activeTier: this.engine.getActiveTier(),
      });

      return allSegments.sort((a, b) => a.start - b.start);
    } finally {
      await wakeLockManager.release(`pipeline_${sessionId}`);
    }
  }

  public async dispose(): Promise<void> {
    await this.engine.dispose();
  }
}
