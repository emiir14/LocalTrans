import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GITHUB_REPO,
  getConfiguredGithubRepo,
  getTauriBridge,
  isTauriDesktop,
  normalizeRepoSlug,
} from '../src/core/runtime/platform';
import { checkModelCacheStatus } from '../src/core/transcription/modelCache';
import { TauriWhisperEngine } from '../src/core/transcription/tauriEngine';

describe('Platform & Desktop Runtime Bridge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults GitHub releases repo to emiir14/LocalTrans when no env or local override is set', () => {
    expect(DEFAULT_GITHUB_REPO).toBe('emiir14/LocalTrans');
    expect(getConfiguredGithubRepo()).toBe('emiir14/LocalTrans');
  });

  it('normalizes GitHub repository slugs and rejects invalid values', () => {
    expect(normalizeRepoSlug('emir/escriba')).toBe('emir/escriba');
    expect(normalizeRepoSlug('https://github.com/emir/escriba/')).toBe('emir/escriba');
    expect(normalizeRepoSlug('http://github.com/emir/escriba/releases')).toBe('emir/escriba');
    expect(normalizeRepoSlug('solo-usuario')).toBe('');
    expect(normalizeRepoSlug('   ')).toBe('');
  });

  it('detects standard web environment cleanly when __TAURI__ is absent', () => {
    expect(getTauriBridge()).toBeNull();
    expect(isTauriDesktop()).toBe(false);
  });

  it('detects Tauri desktop environment when __TAURI__.core.invoke is injected', () => {
    const mockInvoke = vi.fn();
    vi.stubGlobal('window', {
      __TAURI__: {
        core: { invoke: mockInvoke },
      },
    });

    expect(isTauriDesktop()).toBe(true);
    expect(getTauriBridge()?.core.invoke).toBe(mockInvoke);
  });

  it('delegates model cache check to native command inside Windows .exe', async () => {
    const mockInvoke = vi.fn().mockResolvedValue({
      tier: 'max',
      fileName: 'ggml-large-v3-turbo-q5_0.bin',
      isCached: true,
      fileBytes: 574000000,
    });
    vi.stubGlobal('window', {
      __TAURI__: {
        core: { invoke: mockInvoke },
      },
    });

    const status = await checkModelCacheStatus('max');
    expect(mockInvoke).toHaveBeenCalledWith('check_native_model_status', { tier: 'max' });
    expect(status.isCached).toBe(true);
    expect(status.modelId).toBe('ggml-large-v3-turbo-q5_0.bin');
    expect(status.cachedBytes).toBe(574000000);
  });

  it('loads and transcribes Float32 PCM segments via TauriWhisperEngine', async () => {
    const unlistenSpy = vi.fn();
    const mockListen = vi.fn().mockResolvedValue(unlistenSpy);
    const mockInvoke = vi.fn(async (cmd: string) => {
      if (cmd === 'load_whisper_model') {
        return {
          runtime: 'windows-exe',
          engine: 'whisper.cpp',
          gpuActive: true,
          backendLabel: 'Vulkan GPU Nativo (whisper.cpp)',
          cpuThreads: 8,
          modelsDir: 'C:\\Users\\Demo\\AppData\\Local\\com.escriba.app\\models',
        };
      }
      if (cmd === 'transcribe_whisper_segment') {
        return ' Pieza 36 con caries oclusal. ';
      }
      return null;
    });

    vi.stubGlobal('window', {
      __TAURI__: {
        core: { invoke: mockInvoke },
        event: { listen: mockListen },
      },
    });

    const engine = new TauriWhisperEngine();
    const onProgress = vi.fn();
    await engine.load('balanced', onProgress);

    expect(engine.isReady()).toBe(true);
    expect(engine.getActiveTier()).toBe('balanced');
    expect(engine.getActiveBackend()).toBe('webgpu');
    expect(mockListen).toHaveBeenCalledWith('whisper:download-progress', expect.any(Function));
    expect(unlistenSpy).toHaveBeenCalledTimes(1);

    const samples = new Float32Array([0.25, -0.5, 0.75, 0.0]);
    const res = await engine.transcribe(samples, {
      language: 'es',
      initialPrompt: 'odontograma pieza 36',
    });

    expect(res.text).toBe('Pieza 36 con caries oclusal.');
    expect(mockInvoke).toHaveBeenCalledWith(
      'transcribe_whisper_segment',
      expect.objectContaining({
        language: 'es',
        initialPrompt: 'odontograma pieza 36',
        samplesB64: expect.any(String),
      })
    );

    const invokeCalls = mockInvoke.mock.calls as unknown as Array<
      [string, Record<string, unknown> | undefined]
    >;
    const callArgs = invokeCalls.find((c) => c[0] === 'transcribe_whisper_segment')?.[1] as {
      samplesB64: string;
    };
    const decodedBytes = Uint8Array.from(atob(callArgs.samplesB64), (c) => c.charCodeAt(0));
    const decodedFloats = new Float32Array(decodedBytes.buffer);
    expect(Array.from(decodedFloats)).toEqual([0.25, -0.5, 0.75, 0.0]);

    await engine.dispose();
    expect(engine.isReady()).toBe(false);
    expect(mockInvoke).toHaveBeenCalledWith('unload_whisper_model');
  });
});
