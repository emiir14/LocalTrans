import { ITranscriptionEngine, TranscriptionResult } from '../interfaces';
import { isTauriDesktop } from '../runtime/platform';
import { ModelTier } from '../types';
import { detectCorruptOutput } from './corruptionHeuristics';
import { TauriWhisperEngine } from './tauriEngine';
import { detectHardwareCapabilities, resolveTier, TIER_CONFIGS } from './tierDetector';
import { wakeLockManager } from '../utils/wakeLockManager';

export interface ProgressCallbackData {
  status: string;
  progress?: number;
  file?: string;
  loaded?: number;
  total?: number;
}

export interface WhisperEngineOptions {
  onCorruptionFallback?: (reason: string) => void;
  webGpuInitStallTimeoutMs?: number;
  wasmInitStallTimeoutMs?: number;
  segmentTimeoutMs?: number;
  workerFactory?: () => Worker;
}

function resolveWasmFallbackDtype(dtype: unknown): 'q8' | 'q4' {
  if (dtype === 'q4') return 'q4';
  return 'q8';
}

export class WhisperTranscriptionEngine implements ITranscriptionEngine {
  private worker: Worker | null = null;
  private activeTier: ModelTier = 'auto';
  private resolvedTier: Exclude<ModelTier, 'auto'> = 'balanced';
  private activeBackend: 'webgpu' | 'wasm' = 'wasm';
  private isLoaded = false;
  private forceWasmForSession = false;

  private pendingSegmentResolver: ((result: { text: string }) => void) | null = null;
  private pendingSegmentRejecter: ((err: Error) => void) | null = null;
  private onCorruptionFallback?: (reason: string) => void;

  private readonly webGpuInitStallTimeoutMs: number;
  private readonly wasmInitStallTimeoutMs: number;
  private readonly segmentTimeoutMs: number;
  private readonly workerFactory: () => Worker;

  // Serialize all load/transcribe calls so concurrent callers never collide
  private taskQueue: Promise<unknown> = Promise.resolve();

  // Deduplicate concurrent loads for the same tier & share live progress with all subscribers
  private activeLoadPromise: Promise<void> | null = null;
  private activeLoadTier: ModelTier | null = null;
  private activeLoadRejecter: ((err: Error) => void) | null = null;
  private loadGeneration = 0;
  private loadProgressListeners = new Set<(data: ProgressCallbackData) => void>();
  private lastLoadProgress: ProgressCallbackData | null = null;

  constructor(options: WhisperEngineOptions = {}) {
    this.onCorruptionFallback = options.onCorruptionFallback;
    this.webGpuInitStallTimeoutMs = options.webGpuInitStallTimeoutMs ?? 25_000;
    this.wasmInitStallTimeoutMs = options.wasmInitStallTimeoutMs ?? 60_000;
    this.segmentTimeoutMs = options.segmentTimeoutMs ?? 90_000;
    this.workerFactory =
      options.workerFactory ??
      (() =>
        new Worker(new URL('./whisperWorker.ts', import.meta.url), {
          type: 'module',
        }));
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

  public isLoadInProgress(): boolean {
    return this.activeLoadPromise !== null;
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

  private broadcastLoadProgress(data: ProgressCallbackData) {
    this.lastLoadProgress = data;
    for (const listener of this.loadProgressListeners) {
      try {
        listener(data);
      } catch {
        // Ignore subscriber callback errors
      }
    }
  }

  public abortLoad(): void {
    if (!this.activeLoadPromise) return;
    this.loadGeneration++;
    const rejecter = this.activeLoadRejecter;
    this.activeLoadRejecter = null;
    this.activeLoadPromise = null;
    this.activeLoadTier = null;
    this.lastLoadProgress = null;
    this.isLoaded = false;

    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        // ignore
      }
      this.worker = null;
    }

    rejecter?.(new Error('Carga del modelo cancelada por el usuario'));
  }

  public async load(
    tier: ModelTier = 'auto',
    onProgress?: (data: ProgressCallbackData) => void
  ): Promise<void> {
    if (onProgress) {
      this.loadProgressListeners.add(onProgress);
    }

    try {
      // Fast-path if already loaded with same tier
      if (this.isLoaded && this.worker && this.activeTier === tier) {
        return;
      }

      // Join an already in-flight load for the same tier and replay last progress snapshot
      if (this.activeLoadPromise && this.activeLoadTier === tier) {
        if (onProgress && this.lastLoadProgress) {
          onProgress(this.lastLoadProgress);
        }
        await this.activeLoadPromise;
        return;
      }

      const generation = ++this.loadGeneration;
      this.activeLoadTier = tier;
      this.lastLoadProgress = null;

      const loadPromise = this.enqueueTask(async () => {
        if (generation !== this.loadGeneration) {
          throw new Error('Carga del modelo cancelada por el usuario');
        }
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
          this.activeBackend = this.forceWasmForSession ? 'wasm' : resolution.backend;

          const effectiveDtype =
            this.activeBackend === 'wasm'
              ? resolveWasmFallbackDtype(resolution.config.dtype)
              : resolution.config.dtype;

          await this.initWorker(
            resolution.config.modelId,
            this.activeBackend,
            effectiveDtype,
            generation
          );

          if (generation !== this.loadGeneration) {
            throw new Error('Carga del modelo cancelada por el usuario');
          }
          this.isLoaded = true;
        } finally {
          await wakeLockManager.release('engine_load');
        }
      });

      this.activeLoadPromise = loadPromise;
      try {
        await loadPromise;
      } finally {
        if (this.activeLoadPromise === loadPromise) {
          this.activeLoadPromise = null;
          this.activeLoadTier = null;
          this.activeLoadRejecter = null;
          this.lastLoadProgress = null;
        }
      }
    } finally {
      if (onProgress) {
        this.loadProgressListeners.delete(onProgress);
      }
    }
  }

  private async initWorker(
    modelId: string,
    backend: 'webgpu' | 'wasm',
    dtype: unknown,
    expectedGeneration: number
  ): Promise<void> {
    if (expectedGeneration !== this.loadGeneration) {
      throw new Error('Carga del modelo cancelada por el usuario');
    }

    this.rejectPendingSegment('El motor de transcripción se reinició');

    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        // ignore
      }
      this.worker = null;
    }

    this.worker = this.workerFactory();

    return new Promise((resolve, reject) => {
      if (!this.worker) return reject(new Error('No worker initialized'));

      let settledInit = false;
      let stallTimer: ReturnType<typeof setTimeout> | null = null;
      let lastStatus = '';
      let lastLoaded = -1;

      const clearWatchdog = () => {
        if (stallTimer !== null) {
          clearTimeout(stallTimer);
          stallTimer = null;
        }
      };

      const settleReject = (err: Error) => {
        if (settledInit) return;
        settledInit = true;
        clearWatchdog();
        if (this.activeLoadRejecter === settleReject) {
          this.activeLoadRejecter = null;
        }
        reject(err);
      };

      const settleResolve = () => {
        if (settledInit) return;
        settledInit = true;
        clearWatchdog();
        if (this.activeLoadRejecter === settleReject) {
          this.activeLoadRejecter = null;
        }
        resolve();
      };

      this.activeLoadRejecter = settleReject;

      const stallTimeoutMs =
        backend === 'webgpu' ? this.webGpuInitStallTimeoutMs : this.wasmInitStallTimeoutMs;

      const armWatchdog = () => {
        clearWatchdog();
        if (stallTimeoutMs <= 0) return;

        stallTimer = setTimeout(() => {
          if (settledInit) return;

          if (this.worker) {
            try {
              this.worker.terminate();
            } catch {
              // ignore
            }
            this.worker = null;
          }

          if (expectedGeneration !== this.loadGeneration) {
            settleReject(new Error('Carga del modelo cancelada por el usuario'));
            return;
          }

          if (backend === 'webgpu') {
            settledInit = true;
            clearWatchdog();
            this.forceWasmForSession = true;
            this.activeBackend = 'wasm';
            const notice =
              'WebGPU tardó demasiado en iniciar en este navegador. Se cambió automáticamente a modo CPU (WASM).';
            console.warn('[WhisperEngine]', notice);
            this.onCorruptionFallback?.(notice);
            this.broadcastLoadProgress({
              status: 'initiate',
              progress: 0,
            });
            this.initWorker(
              modelId,
              'wasm',
              resolveWasmFallbackDtype(dtype),
              expectedGeneration
            ).then(resolve, reject);
          } else {
            settleReject(
              new Error(
                'La descarga o carga del modelo se detuvo sin respuesta. Verificá tu conexión e intentá nuevamente.'
              )
            );
          }
        }, stallTimeoutMs);
      };

      armWatchdog();

      this.worker.onmessage = (e: MessageEvent) => {
        const { type, payload } = e.data || {};

        if (type === 'load_progress' && payload) {
          const loaded = typeof payload.loaded === 'number' ? payload.loaded : -1;
          const status = typeof payload.status === 'string' ? payload.status : '';
          if (status !== lastStatus || loaded !== lastLoaded) {
            lastStatus = status;
            lastLoaded = loaded;
            armWatchdog();
          }
          this.broadcastLoadProgress(payload);
        } else if (type === 'init_done') {
          if (payload?.fallbackFromWebGpu) {
            this.forceWasmForSession = true;
            this.activeBackend = 'wasm';
          }
          settleResolve();
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
            settleReject(error);
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
          settleReject(error);
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

      const {
        language = 'es',
        initialPrompt,
        segmentIndex = 0,
        startSec = 0,
        endSec = audio.length / 16000,
      } = options;

      const runSegment = async (audioData: Float32Array): Promise<{ text: string }> => {
        return new Promise((resolve, reject) => {
          let settled = false;
          let segTimer: ReturnType<typeof setTimeout> | null = null;

          const cleanup = () => {
            if (segTimer !== null) {
              clearTimeout(segTimer);
              segTimer = null;
            }
          };

          this.pendingSegmentResolver = (res) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(res);
          };

          this.pendingSegmentRejecter = (err) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(err);
          };

          if (this.segmentTimeoutMs > 0) {
            segTimer = setTimeout(() => {
              if (settled) return;
              settled = true;
              this.pendingSegmentResolver = null;
              this.pendingSegmentRejecter = null;
              reject(new Error('SEGMENT_TIMEOUT'));
            }, this.segmentTimeoutMs);
          }

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
                language,
              },
            },
            [copy.buffer]
          );
        });
      };

      let result: { text: string };
      try {
        result = await runSegment(audio);
      } catch (segErr) {
        const msg = segErr instanceof Error ? segErr.message : '';
        if (msg === 'SEGMENT_TIMEOUT') {
          if (this.activeBackend === 'webgpu') {
            console.warn('[WhisperEngine] WebGPU inference timed out; switching to WASM');
            this.forceWasmForSession = true;
            this.activeBackend = 'wasm';
            this.onCorruptionFallback?.(
              'El acelerador WebGPU no respondió a tiempo. Se cambió automáticamente a CPU (WASM).'
            );
            const config = TIER_CONFIGS[this.resolvedTier];
            await this.initWorker(
              config.modelId,
              'wasm',
              resolveWasmFallbackDtype(config.dtype),
              this.loadGeneration
            );
            this.isLoaded = true;
            result = await runSegment(audio);
          } else {
            if (this.worker) {
              try {
                this.worker.terminate();
              } catch {
                // ignore
              }
              this.worker = null;
            }
            this.isLoaded = false;
            throw new Error(
              'La transcripción de un fragmento excedió el tiempo límite. Intentá nuevamente.'
            );
          }
        } else {
          throw segErr;
        }
      }

      if (this.activeBackend === 'webgpu') {
        const corruption = detectCorruptOutput(result.text, { hasVoiceSignal: true });
        if (corruption.isCorrupt) {
          console.warn('[WhisperEngine] Corrupt output detected on WebGPU:', corruption.reason);
          this.onCorruptionFallback?.(corruption.reason || 'Salida WebGPU anómala');

          this.forceWasmForSession = true;
          this.activeBackend = 'wasm';
          const config = TIER_CONFIGS[this.resolvedTier];
          await this.initWorker(
            config.modelId,
            'wasm',
            resolveWasmFallbackDtype(config.dtype),
            this.loadGeneration
          );
          this.isLoaded = true;

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
    this.loadGeneration++;
    this.rejectPendingSegment('Motor cerrado');
    this.activeLoadRejecter?.(new Error('Motor cerrado'));
    this.activeLoadRejecter = null;
    this.activeLoadPromise = null;
    this.activeLoadTier = null;
    this.lastLoadProgress = null;
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

let sharedEngineInstance: ITranscriptionEngine | null = null;

export function getSharedWhisperEngine(
  options: { onCorruptionFallback?: (reason: string) => void } = {}
): ITranscriptionEngine {
  if (!sharedEngineInstance) {
    sharedEngineInstance = isTauriDesktop()
      ? new TauriWhisperEngine()
      : new WhisperTranscriptionEngine(options);
  } else if (
    sharedEngineInstance instanceof WhisperTranscriptionEngine &&
    options.onCorruptionFallback
  ) {
    sharedEngineInstance.setCorruptionFallbackHandler(options.onCorruptionFallback);
  }
  return sharedEngineInstance;
}
