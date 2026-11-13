import { ITranscriptionEngine, TranscriptionResult } from '../interfaces';
import { ModelTier } from '../types';
import { detectCorruptOutput } from './corruptionHeuristics';
import { detectHardwareCapabilities, resolveTier, TIER_CONFIGS } from './tierDetector';
import { wakeLockManager } from '../utils/wakeLockManager';

export interface ProgressCallbackData {
  status: string;
  progress?: number;
  file?: string;
  loaded?: number;
  total?: number;
}

export class WhisperTranscriptionEngine implements ITranscriptionEngine {
  private worker: Worker | null = null;
  private activeTier: ModelTier = 'auto';
  private resolvedTier: Exclude<ModelTier, 'auto'> = 'balanced';
  private activeBackend: 'webgpu' | 'wasm' = 'wasm';
  private isLoaded = false;
  private pendingSegmentResolver: ((result: { text: string }) => void) | null = null;
  private pendingSegmentRejecter: ((err: Error) => void) | null = null;
  private onCorruptionFallback?: (reason: string) => void;

  // Serialize all load/transcribe calls so concurrent callers (background + foreground) never collide
  private taskQueue: Promise<unknown> = Promise.resolve();

  constructor(options: { onCorruptionFallback?: (reason: string) => void } = {}) {
    this.onCorruptionFallback = options.onCorruptionFallback;
  }

  public setCorruptionFallbackHandler(handler?: (reason: string) => void) {
    this.onCorruptionFallback = handler;
  }

  public getActiveTier(): ModelTier {
    return this.activeTier;
  }

  public isReady(): boolean {
    return this.isLoaded && this.worker !== null;
  }

  public getBackend(): 'webgpu' | 'wasm' {
    return this.activeBackend;
  }

  public getActiveBackend(): 'webgpu' | 'wasm' {
    return this.activeBackend;
  }

  private enqueueTask<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.taskQueue.then(fn, fn);
    this.taskQueue = run.catch(() => {});
    return run;
  }

  private rejectPendingSegment(reason: string) {
    if (this.pendingSegmentRejecter) {
      this.pendingSegmentRejecter(new Error(reason));
      this.pendingSegmentResolver = null;
      this.pendingSegmentRejecter = null;
    }
  }

  public async load(
    tier: ModelTier = 'auto',
    onProgress?: (data: ProgressCallbackData) => void
  ): Promise<void> {
    return this.enqueueTask(async () => {
      if (this.isLoaded && this.worker && this.activeTier === tier) {
        return;
      }

      this.activeTier = tier;

      if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
        try {
          await navigator.storage.persist();
        } catch {
          // Silently continue if permission prompt denied
        }
      }

      await wakeLockManager.acquire('engine_load');
      try {
        const hardware = await detectHardwareCapabilities();
        const resolution = resolveTier(tier, hardware);
        this.resolvedTier = resolution.tier;
        this.activeBackend = resolution.backend;

        await this.initWorker(
          resolution.config.modelId,
          this.activeBackend,
          resolution.config.dtype,
          onProgress
        );
        this.isLoaded = true;
      } finally {
        await wakeLockManager.release('engine_load');
      }
    });
  }

  private async initWorker(
    modelId: string,
    backend: 'webgpu' | 'wasm',
    dtype: unknown,
    onProgress?: (data: ProgressCallbackData) => void
  ): Promise<void> {
    this.rejectPendingSegment('El motor de transcripción se reinició');

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    this.worker = new Worker(new URL('./whisperWorker.ts', import.meta.url), {
      type: 'module',
    });

    return new Promise((resolve, reject) => {
      if (!this.worker) return reject(new Error('No worker initialized'));

      let settledInit = false;

      this.worker.onmessage = (e: MessageEvent) => {
        const { type, payload } = e.data;

        if (type === 'load_progress') {
          onProgress?.(payload);
        } else if (type === 'init_done') {
          if (payload.fallbackFromWebGpu) {
            this.activeBackend = 'wasm';
          }
          settledInit = true;
          resolve();
        } else if (type === 'segment_complete') {
          if (this.pendingSegmentResolver) {
            const resolver = this.pendingSegmentResolver;
            this.pendingSegmentResolver = null;
            this.pendingSegmentRejecter = null;
            resolver(payload);
          }
        } else if (type === 'error') {
          const error = new Error(payload?.message || 'Error en el worker de Whisper');
          if (this.pendingSegmentRejecter) {
            const rejecter = this.pendingSegmentRejecter;
            this.pendingSegmentResolver = null;
            this.pendingSegmentRejecter = null;
            rejecter(error);
          } else if (!settledInit) {
            settledInit = true;
            reject(error);
          }
        }
      };

      this.worker.onerror = (err) => {
        const error = new Error(err?.message || 'Error inesperado en Whisper Worker');
        if (this.pendingSegmentRejecter) {
          const rejecter = this.pendingSegmentRejecter;
          this.pendingSegmentResolver = null;
          this.pendingSegmentRejecter = null;
          rejecter(error);
        }
        if (!settledInit) {
          settledInit = true;
          reject(error);
        }
      };

      this.worker.postMessage({
        type: 'init',
        payload: {
          modelId,
          device: backend,
          dtype,
        },
      });
    });
  }

  public async transcribe(
    audio: Float32Array,
    options: {
      language?: string;
      initialPrompt?: string;
      segmentIndex?: number;
      startSec?: number;
      endSec?: number;
    } = {}
  ): Promise<TranscriptionResult> {
    return this.enqueueTask(async () => {
      if (!this.isLoaded || !this.worker) {
        throw new Error('Transcription engine must be loaded before transcribe()');
      }

      const { initialPrompt, segmentIndex = 0, startSec = 0, endSec = audio.length / 16000 } = options;

      const runSegment = async (audioData: Float32Array): Promise<{ text: string }> => {
        return new Promise((resolve, reject) => {
          this.pendingSegmentResolver = resolve;
          this.pendingSegmentRejecter = reject;

          const copy = audioData.slice();
          this.worker?.postMessage(
            {
              type: 'transcribe_segment',
              payload: {
                segmentIndex,
                samples: copy.buffer,
                startSec,
                endSec,
                initialPrompt,
              },
            },
            [copy.buffer]
          );
        });
      };

      let result = await runSegment(audio);

      if (this.activeBackend === 'webgpu') {
        const corruption = detectCorruptOutput(result.text, { hasVoiceSignal: true });
        if (corruption.isCorrupt) {
          console.warn('[WhisperEngine] Corrupt output detected on WebGPU:', corruption.reason);
          this.onCorruptionFallback?.(corruption.reason || 'Salida WebGPU anómala');

          this.activeBackend = 'wasm';
          const config = TIER_CONFIGS[this.resolvedTier];
          await this.initWorker(config.modelId, 'wasm', 'q4');

          result = await runSegment(audio);
        }
      }

      return {
        text: (result.text || '').trim(),
        chunks: [],
      };
    });
  }

  public async dispose(): Promise<void> {
    this.rejectPendingSegment('Motor cerrado');
    if (this.worker) {
      try {
        this.worker.postMessage({ type: 'dispose' });
      } catch {
        // ignore
      }
      this.worker.terminate();
      this.worker = null;
    }
    this.isLoaded = false;
  }
}

let sharedEngineInstance: WhisperTranscriptionEngine | null = null;

export function getSharedWhisperEngine(
  options: { onCorruptionFallback?: (reason: string) => void } = {}
): WhisperTranscriptionEngine {
  if (!sharedEngineInstance) {
    sharedEngineInstance = new WhisperTranscriptionEngine(options);
  } else if (options.onCorruptionFallback) {
    sharedEngineInstance.setCorruptionFallbackHandler(options.onCorruptionFallback);
  }
  return sharedEngineInstance;
}
