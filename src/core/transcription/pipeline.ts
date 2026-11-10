import { applyGlossary } from '../../../config/glossary';
import { isConsecutiveDuplicate, isHallucination } from '../../../config/hallucinations';
import {
  IAudioStore,
  IGlossaryRepository,
  ISessionRepository,
  ISettingsRepository,
  ITranscriptRepository,
} from '../interfaces';
import { formatTimeDisplay } from '../export/formatter';
import { ModelTier, TranscriptSegment } from '../types';
import { getSharedWhisperEngine, WhisperTranscriptionEngine } from './engine';
import { ClinicalAudioSegmenter } from './vad';

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
  logs?: string[];
  activeBackend?: 'webgpu' | 'wasm';
  activeTier?: ModelTier;
}

export class TranscriptionPipeline {
  private engine: WhisperTranscriptionEngine;
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
    onSegmentTranscribed?: (segment: TranscriptSegment) => void
  ): Promise<TranscriptSegment[]> {
    this.isCancelled = false;
    const session = await this.sessionRepo.getById(sessionId);
    if (!session) {
      throw new Error(`Sesión ${sessionId} no encontrada`);
    }

    // 1. Mark session as transcribing
    await this.sessionRepo.update(sessionId, { status: 'transcribing' });

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

    // 3. Segment audio using clinical VAD
    onProgress?.({
      sessionId,
      percent: 10,
      currentSegment: 0,
      totalSegments: 1,
      estimatedRemainingSec: 0,
      statusText: 'Detectando actividad de voz (VAD)...',
    });

    const segmenter = new ClinicalAudioSegmenter();
    const speechSegments = segmenter.segmentAudio(fullAudio);

    if (speechSegments.length === 0) {
      // Audio contained zero speech signal
      await this.sessionRepo.update(sessionId, { status: 'completed' });
      return [];
    }

    // 4. Load Whisper model
    const settings = await this.settingsRepo.get(workspaceId);
    const tier: ModelTier = session.modelTierUsed || settings.modelTier || 'auto';

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

    await this.engine.load(tier, (p) => {
      if (p.status === 'progress' && typeof p.progress === 'number') {
        onProgress?.({
          sessionId,
          percent: 15 + Math.round((p.progress / 100) * 15),
          currentSegment: 0,
          totalSegments: speechSegments.length,
          estimatedRemainingSec: 0,
          statusText: `Descargando componentes del modelo (${Math.round(p.progress)}%)...`,
          isDownloadingModel: true,
          modelDownloadProgress: Math.round(p.progress),
        });
      }
    });

    // 5. Load Glossary for post-processing
    const glossaryEntries = await this.glossaryRepo.getAll(workspaceId);

    // Initial prompt for Whisper with enriched dental vocabulary context
    const initialPrompt =
      'Consulta odontológica en español. Términos: conductometría, endodoncia, amalgama, obturación, periodonto, composite, carilla, oclusal, mesial, distal, vestibular, palatino, periapical, gutapercha, raspaje, exodoncia, implante, prótesis, anestesia, tartrectomía, bruxismo.';

    // 6. Check existing segments to support resumption & progressive pre-transcription
    const existingSegments = await this.transcriptRepo.getBySessionId(sessionId);

    const isSegmentAlreadyCovered = (seg: { startSec: number; endSec: number }) => {
      return existingSegments.some((ex) => {
        const overlapStart = Math.max(seg.startSec, ex.start);
        const overlapEnd = Math.min(seg.endSec, ex.end);
        const overlap = overlapEnd - overlapStart;
        const segDuration = seg.endSec - seg.startSec;
        return overlap > 0.5 || (segDuration > 0 && overlap / segDuration > 0.5);
      });
    };

    const remainingSegments = speechSegments.filter((seg) => !isSegmentAlreadyCovered(seg));
    const allSegments: TranscriptSegment[] = [...existingSegments];

    // If 100% of segments were already processed in background during recording
    if (remainingSegments.length === 0 && existingSegments.length > 0) {
      await this.sessionRepo.update(sessionId, { status: 'completed' });
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
    const remainingToTranscribe = remainingSegments.length;

    let previousText = existingSegments.length > 0 ? existingSegments[existingSegments.length - 1].text : '';

    const logs: string[] = [];
    logs.push(`VAD completado: ${speechSegments.length} fragmentos de voz (${existingSegments.length} ya pre-transcritos)`);
    logs.push(`Iniciando motor de transcripción local (${this.engine.getActiveBackend().toUpperCase()})`);

    // 7. Transcribe segment by segment
    for (let i = 0; i < speechSegments.length; i++) {
      if (this.isCancelled) {
        await this.sessionRepo.update(sessionId, { status: 'recorded' });
        throw new Error('Transcripción cancelada por el usuario');
      }

      const speechSeg = speechSegments[i];

      // Skip already transcribed segments
      if (isSegmentAlreadyCovered(speechSeg)) {
        continue;
      }

      const segTimeRange = `${formatTimeDisplay(speechSeg.startSec)} - ${formatTimeDisplay(speechSeg.endSec)}`;

      // Calculate estimated time remaining based on throughput
      const elapsedSec = (Date.now() - startTimeMs) / 1000;
      let estimatedRemainingSec = 0;
      if (transcribedCount > 0) {
        const secPerSegment = elapsedSec / transcribedCount;
        estimatedRemainingSec = Math.round((remainingToTranscribe - transcribedCount) * secPerSegment);
      } else {
        // Initial conservative guess: ~2.5s per chunk
        estimatedRemainingSec = remainingToTranscribe * 2;
      }

      const progressPct = 30 + Math.round((transcribedCount / Math.max(1, remainingToTranscribe)) * 68);

      onProgress?.({
        sessionId,
        percent: Math.min(99, progressPct),
        currentSegment: transcribedCount + 1,
        totalSegments: remainingToTranscribe,
        estimatedRemainingSec,
        statusText: `Transcribiendo segmento ${transcribedCount + 1} de ${remainingToTranscribe} (${segTimeRange})...`,
        isDownloadingModel: false,
        currentSegmentTime: segTimeRange,
        lastTranscribedText: previousText || undefined,
        logs: [...logs],
        activeBackend: this.engine.getActiveBackend(),
        activeTier: this.engine.getActiveTier(),
      });

      // Execute Whisper transcription on Web Worker
      const res = await this.engine.transcribe(speechSeg.samples, {
        language: 'es',
        initialPrompt,
        segmentIndex: i,
        startSec: speechSeg.startSec,
        endSec: speechSeg.endSec,
      });

      const rawText = res.text?.trim() || '';

      // Filter hallucinations & consecutive duplicates
      if (rawText && !isHallucination(rawText) && !isConsecutiveDuplicate(rawText, previousText)) {
        // Apply dental glossary post-processing
        const processedText = applyGlossary(rawText, glossaryEntries);

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

        // Save IMMEDIATELY to IndexedDB for resumability
        await this.transcriptRepo.addSegment(segment);
        allSegments.push(segment);
        previousText = processedText;

        logs.push(`[${segTimeRange}] "${processedText.length > 50 ? processedText.slice(0, 50) + '...' : processedText}"`);
        if (logs.length > 30) logs.shift();

        // Stream segment live to the UI immediately!
        onSegmentTranscribed?.(segment);

        // Update progress with latest phrase
        onProgress?.({
          sessionId,
          percent: Math.min(99, progressPct),
          currentSegment: transcribedCount + 1,
          totalSegments: remainingToTranscribe,
          estimatedRemainingSec,
          statusText: `Transcribiendo (${transcribedCount + 1}/${remainingToTranscribe})...`,
          isDownloadingModel: false,
          currentSegmentTime: segTimeRange,
          lastTranscribedText: processedText,
          logs: [...logs],
          activeBackend: this.engine.getActiveBackend(),
          activeTier: this.engine.getActiveTier(),
        });
      } else {
        logs.push(`[${segTimeRange}] (Filtro acústico: ruido de turbina o silencio)`);
        if (logs.length > 30) logs.shift();
      }

      transcribedCount++;
    }

    // 8. Mark session completed
    await this.sessionRepo.update(sessionId, {
      status: 'completed',
      modelTierUsed: this.engine.getActiveTier(),
    });

    logs.push('¡Transcripción finalizada y guardada en el dispositivo!');

    onProgress?.({
      sessionId,
      percent: 100,
      currentSegment: remainingToTranscribe,
      totalSegments: remainingToTranscribe,
      estimatedRemainingSec: 0,
      statusText: '¡Transcripción completada con éxito!',
      lastTranscribedText: previousText || undefined,
      logs: [...logs],
      activeBackend: this.engine.getActiveBackend(),
      activeTier: this.engine.getActiveTier(),
    });

    return allSegments.sort((a, b) => a.start - b.start);
  }

  public async dispose(): Promise<void> {
    await this.engine.dispose();
  }
}
