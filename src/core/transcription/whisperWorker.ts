import { pipeline, env } from '@huggingface/transformers';

// Configure environment for local browser execution
env.allowLocalModels = false;
env.useBrowserCache = true;

let transcriber: any = null;
let currentModelId = '';
let currentDevice: 'webgpu' | 'wasm' = 'wasm';

self.onmessage = async (event: MessageEvent) => {
  const { type, payload } = event.data;

  try {
    switch (type) {
      case 'init': {
        const { modelId, device, dtype } = payload;
        currentModelId = modelId;
        currentDevice = device || 'wasm';

        // Check if device is webgpu but WebGPU is not supported in worker context
        if (currentDevice === 'webgpu' && !(navigator as any).gpu) {
          console.warn('[WhisperWorker] WebGPU not available in worker, falling back to wasm');
          currentDevice = 'wasm';
        }

        try {
          transcriber = await pipeline('automatic-speech-recognition', modelId, {
            device: currentDevice,
            dtype: dtype || 'q4',
            progress_callback: (p: any) => {
              self.postMessage({
                type: 'load_progress',
                payload: {
                  status: p.status,
                  progress: typeof p.progress === 'number' ? Math.round(p.progress) : 0,
                  file: p.file,
                  loaded: p.loaded,
                  total: p.total,
                },
              });
            },
          });

          self.postMessage({
            type: 'init_done',
            payload: {
              modelId: currentModelId,
              device: currentDevice,
            },
          });
        } catch (initErr: any) {
          // If WebGPU failed, fallback to WASM automatically
          if (currentDevice === 'webgpu') {
            console.warn('[WhisperWorker] WebGPU init failed, retrying on WASM:', initErr);
            currentDevice = 'wasm';
            transcriber = await pipeline('automatic-speech-recognition', modelId, {
              device: 'wasm',
              dtype: 'q4',
              progress_callback: (p: any) => {
                self.postMessage({
                  type: 'load_progress',
                  payload: {
                    status: p.status,
                    progress: typeof p.progress === 'number' ? Math.round(p.progress) : 0,
                    file: p.file,
                  },
                });
              },
            });

            self.postMessage({
              type: 'init_done',
              payload: {
                modelId: currentModelId,
                device: 'wasm',
                fallbackFromWebGpu: true,
              },
            });
          } else {
            throw initErr;
          }
        }
        break;
      }

      case 'transcribe_segment': {
        if (!transcriber) {
          throw new Error('Transcriber not initialized');
        }

        const { segmentIndex, samples, startSec, endSec, initialPrompt } = payload;
        const floatAudio = new Float32Array(samples);

        const options: any = {
          language: 'es',
          task: 'transcribe',
          return_timestamps: true,
          chunk_length_s: 30,
          stride_length_s: 5,
        };

        if (initialPrompt) {
          options.initial_prompt = initialPrompt;
        }

        const output = await transcriber(floatAudio, options);

        self.postMessage({
          type: 'segment_complete',
          payload: {
            segmentIndex,
            startSec,
            endSec,
            text: output.text || '',
            chunks: output.chunks || [],
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
