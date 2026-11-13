import { ITranscriptionEngine, TranscriptionResult } from '../interfaces';
import { getTauriBridge } from '../runtime/platform';
import { ModelTier } from '../types';
import { ProgressCallbackData } from './engine';

export interface NativeCapabilitiesResponse {
  runtime: string;
  engine: string;
  gpuActive: boolean;
  backendLabel: string;
  cpuThreads: number;
  modelsDir: string;
}

function float32ToBase64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(bytes.length, i + chunkSize));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/**
 * Native Desktop Engine (Windows .exe via Tauri v2 + whisper.cpp Vulkan/CPU)
 * Implements the exact same ITranscriptionEngine interface as the browser worker.
 */
export class TauriWhisperEngine implements ITranscriptionEngine {
  private activeTier: ModelTier = 'balanced';
  private loaded = false;
  private gpuActive = true;
  private taskQueue: Promise<unknown> = Promise.resolve();

  public getActiveTier(): ModelTier {
    return this.activeTier;
  }

  public isReady(): boolean {
    return this.loaded;
  }

  public getBackend(): 'webgpu' | 'wasm' {
    return this.getActiveBackend();
  }

  public getActiveBackend(): 'webgpu' | 'wasm' {
    // Maps native GPU/CPU cleanly into existing UI status indicators
    return this.gpuActive ? 'webgpu' : 'wasm';
  }

  private enqueueTask<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.taskQueue.then(fn, fn);
    this.taskQueue = run.catch(() => {});
    return run;
  }

  public async load(
    tier: ModelTier = 'auto',
    onProgress?: (data: ProgressCallbackData) => void
  ): Promise<void> {
    return this.enqueueTask(async () => {
      const bridge = getTauriBridge();
      if (!bridge) {
        throw new Error('Puente nativo de Windows no disponible');
      }

      const resolvedTier: Exclude<ModelTier, 'auto' | 'fast'> =
        tier === 'max' ? 'max' : 'balanced';

      if (this.loaded && this.activeTier === resolvedTier) {
        return;
      }

      let unlisten: (() => void) | null = null;
      if (bridge.event?.listen && onProgress) {
        unlisten = await bridge.event.listen<ProgressCallbackData>(
          'whisper:download-progress',
          (ev) => {
            onProgress(ev.payload);
          }
        );
      }

      try {
        const caps = await bridge.core.invoke<NativeCapabilitiesResponse>('load_whisper_model', {
          tier: resolvedTier,
        });
        this.activeTier = resolvedTier;
        this.gpuActive = caps.gpuActive;
        this.loaded = true;
      } finally {
        if (unlisten) {
          try {
            unlisten();
          } catch {
            // ignore
          }
        }
      }
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
      const bridge = getTauriBridge();
      if (!bridge) {
        throw new Error('Puente nativo de Windows no disponible');
      }
      if (!this.loaded) {
        await this.load(this.activeTier);
      }

      const samplesB64 = float32ToBase64(audio);
      const text = await bridge.core.invoke<string>('transcribe_whisper_segment', {
        samplesB64,
        language: options.language || 'es',
        initialPrompt: options.initialPrompt || '',
      });

      return {
        text: (text || '').trim(),
        chunks: [],
      };
    });
  }

  public async dispose(): Promise<void> {
    const bridge = getTauriBridge();
    if (bridge) {
      await bridge.core.invoke('unload_whisper_model').catch(() => {});
    }
    this.loaded = false;
  }
}
