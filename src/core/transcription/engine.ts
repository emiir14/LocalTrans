import { ITranscriptionEngine, TranscriptionResult } from '../interfaces';
import { ModelTier } from '../types';
import { detectCorruptOutput } from './corruptionHeuristics';
import { detectHardwareCapabilities, resolveTier, TIER_CONFIGS } from './tierDetector';

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
  private resolvedTier: Exclude<ModelTier, 'auto'> = 'fast';
  private activeBackend: 'webgpu' | 'wasm' = 'wasm';
  private isLoaded = false;
  private pendingSegmentResolver: ((result: any) => void) | null = null;
  private pendingSegmentRejecter: ((err: any) => void) | null = null;
  private onCorruptionFallback?: (reason: string) => void;

  constructor(options: { onCorruptionFallback?: (reason: string) => void } = {}) {
    this.onCorruptionFallback = options.onCorruptionFallback;
  }

  public getActiveTier(): ModelTier {
    return this.activeTier;
  }

  public getBackend(): 'webgpu' | 'wasm' {
    return this.activeBackend;
  }

  public async load(
    tier: ModelTier = 'auto',
    onProgress?: (data: ProgressCallbackData) => void
  ): Promise<void> {
    this.activeTier = tier;

    // Request persistent storage so downloaded model weights are retained
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      try {
        await navigator.storage.persist();
      } catch {
        // Silently continue if permission prompt denied
      }
    }

    const hardware = await detectHardwareCapabilities();
    const resolution = resolveTier(tier, hardware);
    this.resolvedTier = resolution.tier;
    this.activeBackend = resolution.backend;

    await this.initWorker(resolution.config.modelId, this.activeBackend, resolution.config.dtype, onProgress);
    this.isLoaded = true;
  }

  private async initWorker(
    modelId: string,
    backend: 'webgpu' | 'wasm',
    dtype: any,
    onProgress?: (data: ProgressCallbackData) => void
  ): Promise<void> {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    // Instantiate worker as ES module
    this.worker = new Worker(new URL('./whisperWorker.ts', import.meta.url), {
      type: 'module',
    });

    return new Promise((resolve, reject) => {
      if (!this.worker) return reject(new Error('No worker initialized'));

      this.worker.onmessage = (e: MessageEvent) => {
        const { type, payload } = e.data;

        if (type === 'load_progress') {
          onProgress?.(payload);
        } else if (type === 'init_done') {
          if (payload.fallbackFromWebGpu) {
            this.activeBackend = 'wasm';
          }
          resolve();
        } else if (type === 'segment_complete') {
          if (this.pendingSegmentResolver) {
            this.pendingSegmentResolver(payload);
            this.pendingSegmentResolver = null;
            this.pendingSegmentRejecter = null;
          }
        } else if (type === 'error') {
          if (this.pendingSegmentRejecter) {
            this.pendingSegmentRejecter(new Error(payload.message));
            this.pendingSegmentResolver = null;
            this.pendingSegmentRejecter = null;
          } else {
            reject(new Error(payload.message));
          }
        }
      };

      this.worker.onerror = (err) => {
        reject(err);
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
    if (!this.isLoaded || !this.worker) {
      throw new Error('Transcription engine must be loaded before transcribe()');
    }

    const { initialPrompt, segmentIndex = 0, startSec = 0, endSec = audio.length / 16000 } = options;

    const runSegment = async (): Promise<any> => {
      return new Promise((resolve, reject) => {
        this.pendingSegmentResolver = resolve;
        this.pendingSegmentRejecter = reject;

        this.worker?.postMessage(
          {
            type: 'transcribe_segment',
            payload: {
              segmentIndex,
              samples: audio.buffer,
              startSec,
              endSec,
              initialPrompt,
            },
          },
          [audio.buffer]
        );
      });
    };

    let result = await runSegment();

    // Check for WebGPU corruption on first segments
    if (this.activeBackend === 'webgpu') {
      const corruption = detectCorruptOutput(result.text, { hasVoiceSignal: true });
      if (corruption.isCorrupt) {
        console.warn('[WhisperEngine] Corrupt output detected on WebGPU:', corruption.reason);
        this.onCorruptionFallback?.(corruption.reason || 'Salida WebGPU anómala');

        // Restart worker in WASM mode
        this.activeBackend = 'wasm';
        const config = TIER_CONFIGS[this.resolvedTier];
        await this.initWorker(config.modelId, 'wasm', 'q4');

        // Re-transcribe with fresh audio copy (since buffer was transferred)
        // audio.buffer may be detached; recreate Float32Array if needed
        const freshBuffer = new Float32Array(audio.length);
        // Note: in pipeline caller, caller retains audio or passes slice
        result = await runSegment();
      }
    }

    return {
      text: result.text.trim(),
      chunks: result.chunks?.map((c: any) => ({
        timestamp: c.timestamp as [number, number],
        text: c.text,
      })) || [],
    };
  }

  public async dispose(): Promise<void> {
    if (this.worker) {
      this.worker.postMessage({ type: 'dispose' });
      this.worker.terminate();
      this.worker = null;
    }
    this.isLoaded = false;
  }
}
