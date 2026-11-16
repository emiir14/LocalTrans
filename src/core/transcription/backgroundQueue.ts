import { applyGlossary } from '../../../config/glossary';
import { isConsecutiveDuplicate, isHallucination } from '../../../config/hallucinations';
import { IGlossaryRepository, ITranscriptRepository, ITranscriptionEngine } from '../interfaces';
import { getDefaultModelTier } from '../runtime/platform';
import { AudioChunk, ModelTier, TranscriptSegment, TranscriptionMode } from '../types';
import { wakeLockManager } from '../utils/wakeLockManager';
import { buildSegmentPrompt } from './prompts';
import { ClinicalAudioSegmenter } from './vad';

export interface BackgroundQueueDeps {
  getEngine: () => ITranscriptionEngine;
  getSettings: () => { modelTier?: ModelTier; transcriptionMode?: TranscriptionMode } | null | undefined;
  getCurrentSessionId: () => string | null;
  transcriptRepo: Pick<ITranscriptRepository, 'addSegment'>;
  glossaryRepo: Pick<IGlossaryRepository, 'getAll'>;
  isModelCached: (tier: ModelTier) => Promise<boolean>;
  onSegmentAdded?: (sessionId: string, segment: TranscriptSegment) => void;
}

/**
 * Progressive background pre-transcriber that processes audio chunks during recording.
 * Designed so it never blocks foreground transcription indefinitely or silently triggers
 * massive uncached downloads without progress feedback.
 */
export class BackgroundChunkTranscriber {
  private queue: Array<{ chunk: AudioChunk; sessionId: string; workspaceId: string }> = [];
  private isProcessing = false;
  private segmenter = new ClinicalAudioSegmenter();
  private lastTranscribedText = '';
  private lastSessionId = '';
  private idleWaiters: Array<() => void> = [];
  private cancelGeneration = 0;

  constructor(private deps: BackgroundQueueDeps) {}

  public enqueue(chunk: AudioChunk, sessionId: string, workspaceId: string) {
    if (this.lastSessionId !== sessionId) {
      this.lastSessionId = sessionId;
      this.lastTranscribedText = '';
    }
    this.queue.push({ chunk, sessionId, workspaceId });
    void this.processQueue();
  }

  public resetSessionContext() {
    this.lastTranscribedText = '';
    this.lastSessionId = '';
  }

  public clearQueueForSession(sessionId: string) {
    this.queue = this.queue.filter((item) => item.sessionId !== sessionId);
  }

  /**
   * Clears all pending background chunks across every session and bumps generation
   * so any active chunk exits cleanly without starting further queued items.
   */
  public clearAllPending() {
    this.cancelGeneration++;
    this.queue = [];
  }

  public isBusy(): boolean {
    return this.isProcessing || this.queue.length > 0;
  }

  /**
   * Waits for any in-flight background chunk up to a bounded cap (`maxWaitMs`).
   * Returns true if the background queue drained cleanly, false if timed out or aborted.
   */
  public async waitForIdle(
    options: { maxWaitMs?: number; shouldAbort?: () => boolean } = {}
  ): Promise<boolean> {
    if (!this.isProcessing && this.queue.length === 0) {
      return true;
    }

    const maxWaitMs = options.maxWaitMs ?? 3500;
    const shouldAbort = options.shouldAbort;

    return new Promise<boolean>((resolve) => {
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let pollId: ReturnType<typeof setInterval> | null = null;

      const finish = (drained: boolean) => {
        if (settled) return;
        settled = true;
        if (timeoutId !== null) clearTimeout(timeoutId);
        if (pollId !== null) clearInterval(pollId);
        const idx = this.idleWaiters.indexOf(onIdle);
        if (idx >= 0) this.idleWaiters.splice(idx, 1);
        resolve(drained);
      };

      const onIdle = () => finish(true);
      this.idleWaiters.push(onIdle);

      if (maxWaitMs > 0) {
        timeoutId = setTimeout(() => {
          finish(!this.isProcessing && this.queue.length === 0);
        }, maxWaitMs);
      }

      if (shouldAbort) {
        pollId = setInterval(() => {
          if (shouldAbort()) {
            finish(false);
          } else if (!this.isProcessing && this.queue.length === 0) {
            finish(true);
          }
        }, 120);
      }
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

    const genAtStart = this.cancelGeneration;
    this.isProcessing = true;
    await wakeLockManager.acquire('bg_transcription');

    try {
      const item = this.queue.shift();
      if (!item || genAtStart !== this.cancelGeneration) return;

      const { chunk, sessionId, workspaceId } = item;
      const engine = this.deps.getEngine();
      if (!engine.isReady()) {
        const currentSettings = this.deps.getSettings();
        const tier = currentSettings?.modelTier || getDefaultModelTier();
        const cached = await this.deps.isModelCached(tier);
        if (!cached || genAtStart !== this.cancelGeneration) {
          // Never hijack the queue with a blind multi-hundred-MB uncached download while recording
          this.queue = [];
          return;
        }
        await engine.load(tier);
      }

      if (genAtStart !== this.cancelGeneration) return;

      const int16 = new Int16Array(chunk.pcmData);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        const s = int16[i];
        float32[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
      }

      const speechSegments = this.segmenter.segmentAudio(float32);
      if (speechSegments.length === 0) return;

      const mode: TranscriptionMode = this.deps.getSettings()?.transcriptionMode || 'dental';
      const glossaryEntries = mode === 'dental' ? await this.deps.glossaryRepo.getAll(workspaceId) : [];

      for (let i = 0; i < speechSegments.length; i++) {
        if (genAtStart !== this.cancelGeneration) return;

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

          await this.deps.transcriptRepo.addSegment(segment);
          this.lastTranscribedText = processedText;

          if (this.deps.getCurrentSessionId() === sessionId) {
            this.deps.onSegmentAdded?.(sessionId, segment);
          }
        }
      }
    } catch (err) {
      console.warn('[BackgroundChunkTranscriber] Non-blocking notice:', err);
    } finally {
      this.isProcessing = false;
      if (this.queue.length > 0 && genAtStart === this.cancelGeneration) {
        void this.processQueue();
      } else {
        await wakeLockManager.release('bg_transcription');
        this.notifyIdleIfDone();
      }
    }
  }
}
