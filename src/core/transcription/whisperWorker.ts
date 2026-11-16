import { pipeline, env } from '@huggingface/transformers';
import { MonotonicModelProgressTracker } from './progressTracker';

// Configure environment for local browser execution
env.allowLocalModels = false;
env.useBrowserCache = true;

// Maximize WASM CPU performance only when SharedArrayBuffer / crossOriginIsolated is available
if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) {
  try {
    const canUseThreads =
      typeof SharedArrayBuffer !== 'undefined' && Boolean((self as any).crossOriginIsolated);
    if ((env as any).backends?.onnx?.wasm) {
      (env as any).backends.onnx.wasm.numThreads = canUseThreads
        ? Math.min(4, navigator.hardwareConcurrency)
        : 1;
    }
  } catch {
    // Ignore if not supported in worker environment
  }
}

let transcriber: any = null;
let currentModelId = '';
let currentDevice: 'webgpu' | 'wasm' = 'wasm';
let currentDtype: any = 'q4';

const isMobileWorker =
  typeof navigator !== 'undefined' &&
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

async function resolveSafeWebGpuDtype(requestedDtype: any): Promise<{ dtype: any; hasAdapter: boolean }> {
  if (!(navigator as any).gpu) {
    return { dtype: requestedDtype, hasAdapter: false };
  }
  try {
    const adapter = await (navigator as any).gpu.requestAdapter();
    if (!adapter) {
      return { dtype: requestedDtype, hasAdapter: false };
    }
    const supportsFp16 = Boolean(adapter.features?.has?.('shader-f16'));
    if (!supportsFp16 && requestedDtype && typeof requestedDtype === 'object') {
      const normalized: Record<string, string> = {};
      for (const [k, v] of Object.entries(requestedDtype)) {
        normalized[k] = v === 'fp16' ? 'fp32' : String(v);
      }
      return { dtype: normalized, hasAdapter: true };
    }
    if (!supportsFp16 && requestedDtype === 'fp16') {
      return { dtype: 'fp32', hasAdapter: true };
    }
    return { dtype: requestedDtype, hasAdapter: true };
  } catch {
    return { dtype: requestedDtype, hasAdapter: false };
  }
}

function resolveWasmFallbackDtype(requestedDtype: any): 'q8' | 'q4' {
  if (requestedDtype === 'q4') return 'q4';
  return 'q8';
}

async function loadPipelineWithFallback(
  modelId: string,
  requestedDevice: 'webgpu' | 'wasm',
  requestedDtype: any,
  onProgress?: (p: any) => void
): Promise<{ instance: any; device: 'webgpu' | 'wasm'; dtype: any; fallbackFromWebGpu: boolean }> {
  let activeDevice = requestedDevice;
  let effectiveDtype = requestedDtype || 'q8';
  let fallbackFromWebGpu = false;

  if (isMobileWorker && activeDevice === 'webgpu') {
    activeDevice = 'wasm';
  }
  if (activeDevice === 'webgpu') {
    const gpuCheck = await resolveSafeWebGpuDtype(effectiveDtype);
    if (!gpuCheck.hasAdapter) {
      activeDevice = 'wasm';
      fallbackFromWebGpu = true;
      effectiveDtype = resolveWasmFallbackDtype(requestedDtype);
    } else {
      effectiveDtype = gpuCheck.dtype;
    }
  }

  const progress_callback = onProgress
    ? (p: any) => onProgress(p)
    : undefined;

  try {
    const instance = await pipeline('automatic-speech-recognition', modelId, {
      device: activeDevice,
      dtype: effectiveDtype,
      ...(progress_callback ? { progress_callback } : {}),
    });
    return { instance, device: activeDevice, dtype: effectiveDtype, fallbackFromWebGpu };
  } catch (firstErr) {
    // If higher quantization failed on requested device, retry same device with q4 before falling back
    if (effectiveDtype && effectiveDtype !== 'q4') {
      try {
        console.warn('[WhisperWorker] Retrying with q4 quantization after init error:', firstErr);
        const instance = await pipeline('automatic-speech-recognition', modelId, {
          device: activeDevice,
          dtype: 'q4',
          ...(progress_callback ? { progress_callback } : {}),
        });
        return { instance, device: activeDevice, dtype: 'q4', fallbackFromWebGpu };
      } catch {
        // Proceed to WebGPU->WASM fallback below
      }
    }

    if (activeDevice === 'webgpu') {
      console.warn('[WhisperWorker] WebGPU init failed, retrying on WASM:', firstErr);
      fallbackFromWebGpu = true;
      const wasmDtype = resolveWasmFallbackDtype(requestedDtype);
      const instance = await pipeline('automatic-speech-recognition', modelId, {
        device: 'wasm',
        dtype: wasmDtype,
        ...(progress_callback ? { progress_callback } : {}),
      });
      return { instance, device: 'wasm', dtype: wasmDtype, fallbackFromWebGpu };
    }

    throw firstErr;
  }
}

/**
 * Builds Whisper decoder_input_ids conditioned on `<|startofprev|> + promptTokens`
 * because @huggingface/transformers ASR pipeline ignores `options.initial_prompt`.
 */
function buildPromptedInitTokens(
  instance: any,
  language: string,
  initialPrompt?: string
): number[] | null {
  if (!initialPrompt || !initialPrompt.trim()) return null;

  const tokenizer = instance?.tokenizer;
  const genConfig = instance?.model?.generation_config;
  if (!tokenizer || !genConfig) return null;

  try {
    const startOfPrevIds = tokenizer.convert_tokens_to_ids?.(['<|startofprev|>']);
    const startOfPrevId = Array.isArray(startOfPrevIds) ? startOfPrevIds[0] : null;
    if (
      typeof startOfPrevId !== 'number' ||
      startOfPrevId < 0 ||
      startOfPrevId === tokenizer.unk_token_id
    ) {
      return null;
    }

    const sotId =
      genConfig.decoder_start_token_id ??
      tokenizer.convert_tokens_to_ids?.(['<|startoftranscript|>'])?.[0];
    const langToken = `<|${language}|>`;
    const langId =
      genConfig.lang_to_id?.[langToken] ??
      tokenizer.convert_tokens_to_ids?.([langToken])?.[0];
    const taskId =
      genConfig.task_to_id?.['transcribe'] ??
      tokenizer.convert_tokens_to_ids?.(['<|transcribe|>'])?.[0];
    const noTsId =
      genConfig.no_timestamps_token_id ??
      tokenizer.convert_tokens_to_ids?.(['<|notimestamps|>'])?.[0];

    if (
      typeof sotId !== 'number' ||
      typeof langId !== 'number' ||
      typeof taskId !== 'number'
    ) {
      return null;
    }

    const encodedPrompt: number[] =
      typeof tokenizer.encode === 'function'
        ? tokenizer.encode(initialPrompt.trim(), { add_special_tokens: false })
        : [];

    if (!Array.isArray(encodedPrompt) || encodedPrompt.length === 0) {
      return null;
    }

    // Reserve at least half of Whisper's 448 target positions for new transcription tokens
    const boundedPrompt = encodedPrompt.slice(-140);
    const initTokens = [startOfPrevId, ...boundedPrompt, sotId, langId, taskId];
    if (typeof noTsId === 'number' && noTsId >= 0) {
      initTokens.push(noTsId);
    }

    return initTokens;
  } catch {
    return null;
  }
}

async function runWhisperInference(
  instance: any,
  floatAudio: Float32Array,
  language: string,
  initialPrompt?: string
): Promise<string> {
  const numBeams = isMobileWorker ? 1 : 2;
  const baseGenOptions: any = {
    language,
    task: 'transcribe',
    return_timestamps: false,
    temperature: 0.0,
    num_beams: numBeams,
    max_new_tokens: 384,
  };

  const promptedInitTokens = buildPromptedInitTokens(instance, language, initialPrompt);

  if (
    promptedInitTokens &&
    typeof instance.processor === 'function' &&
    typeof instance.model?.generate === 'function' &&
    typeof instance.tokenizer?.decode === 'function'
  ) {
    try {
      const features = await instance.processor(floatAudio);
      const maxTargetPositions = instance.model?.config?.max_target_positions || 448;
      const safeMaxNewTokens = Math.max(
        96,
        Math.min(384, maxTargetPositions - promptedInitTokens.length - 4)
      );

      const generated = await instance.model.generate({
        inputs: features.input_features,
        language,
        task: 'transcribe',
        return_timestamps: false,
        temperature: 0.0,
        num_beams: numBeams,
        max_new_tokens: safeMaxNewTokens,
        decoder_input_ids: promptedInitTokens,
      });

      const sequenceTensor = Array.isArray(generated) ? generated[0] : generated?.[0] ?? generated?.sequences?.[0];
      const tokenIds: number[] =
        typeof sequenceTensor?.tolist === 'function'
          ? sequenceTensor.tolist()
          : Array.isArray(sequenceTensor)
          ? sequenceTensor
          : [];

      const generatedSlice = tokenIds.slice(promptedInitTokens.length);
      if (generatedSlice.length === 0) {
        return '';
      }
      const decoded = instance.tokenizer.decode(generatedSlice, {
        skip_special_tokens: true,
      });
      return (decoded || '').trim();
    } catch (promptErr) {
      console.warn('[WhisperWorker] Prompted generate fallback to standard pipeline:', promptErr);
    }
  }

  const output = await instance(floatAudio, baseGenOptions);
  return (output?.text || '').trim();
}

self.onmessage = async (event: MessageEvent) => {
  const { type, payload } = event.data;

  try {
    switch (type) {
      case 'init': {
        const { modelId, device, dtype } = payload;
        currentModelId = modelId;
        const progressTracker = new MonotonicModelProgressTracker();
        let lastEmittedPct = -1;

        const loaded = await loadPipelineWithFallback(
          modelId,
          device || 'wasm',
          dtype || 'q4',
          (p: any) => {
            const aggPct = progressTracker.update({
              status: p.status,
              file: p.file,
              progress: p.progress,
              loaded: p.loaded,
              total: p.total,
            });
            if (p.status === 'progress' && aggPct === lastEmittedPct) {
              return;
            }
            if (p.status === 'progress') {
              lastEmittedPct = aggPct;
            }
            self.postMessage({
              type: 'load_progress',
              payload: {
                status: p.status,
                progress: aggPct,
                file: p.file,
                loaded: p.loaded,
                total: p.total,
              },
            });
          }
        );

        transcriber = loaded.instance;
        currentDevice = loaded.device;
        currentDtype = loaded.dtype;

        self.postMessage({
          type: 'init_done',
          payload: {
            modelId: currentModelId,
            device: currentDevice,
            dtype: currentDtype,
            ...(loaded.fallbackFromWebGpu ? { fallbackFromWebGpu: true } : {}),
          },
        });
        break;
      }

      case 'transcribe_segment': {
        if (!transcriber) {
          throw new Error('Transcriber not initialized');
        }

        const { segmentIndex, samples, startSec, endSec, initialPrompt, language = 'es' } = payload;
        const floatAudio = new Float32Array(samples);
        const durationSec = floatAudio.length / 16000;

        let text = '';
        try {
          text = await runWhisperInference(transcriber, floatAudio, language, initialPrompt);
        } catch (inferenceErr: any) {
          if (currentDevice === 'webgpu') {
            console.warn('[WhisperWorker] WebGPU inference failed, dynamically falling back to WASM:', inferenceErr);
            const wasmDtype = resolveWasmFallbackDtype(currentDtype);
            const fallbackLoaded = await loadPipelineWithFallback(currentModelId, 'wasm', wasmDtype);
            transcriber = fallbackLoaded.instance;
            currentDevice = 'wasm';
            currentDtype = fallbackLoaded.dtype;
            text = await runWhisperInference(transcriber, floatAudio, language, initialPrompt);
          } else {
            throw inferenceErr;
          }
        }

        self.postMessage({
          type: 'segment_complete',
          payload: {
            segmentIndex,
            startSec,
            endSec,
            durationSec,
            text,
          },
        });
        break;
      }

      case 'dispose': {
        if (transcriber) {
          try {
            await transcriber.dispose?.();
          } catch {
            // ignore
          }
          transcriber = null;
        }
        self.postMessage({ type: 'disposed' });
        break;
      }

      default:
        console.warn('[WhisperWorker] Unknown message type:', type);
    }
  } catch (err: any) {
    console.error('[WhisperWorker] Error handling message:', err);
    self.postMessage({
      type: 'error',
      payload: {
        message: err.message || 'Error desconocido en el worker de transcripción',
      },
    });
  }
};
