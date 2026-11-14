import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  APP_VERSION,
  compareVersions,
  DEFAULT_GITHUB_REPO,
  getConfiguredGithubRepo,
  getDefaultModelTier,
  getTauriBridge,
  isAndroidDevice,
  isNativeMobileApp,
  isNewerVersion,
  isTauriDesktop,
  isTauriMobileAndroid,
  normalizeRepoSlug,
  shouldShowDownloadsTab,
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

  it('compares semantic versions and release tags accurately', () => {
    expect(APP_VERSION).toBe('1.0.1');
    expect(compareVersions('v1.0.2', '1.0.1')).toBe(1);
    expect(compareVersions('1.0.1', 'v1.0.1')).toBe(0);
    expect(compareVersions('v1.0.0', '1.0.1')).toBe(-1);
    expect(isNewerVersion('v1.0.2', '1.0.1')).toBe(true);
    expect(isNewerVersion('v1.0.1', '1.0.1')).toBe(false);
    expect(isNewerVersion('v1.1.0-beta.1', '1.0.9')).toBe(true);
  });

  it('detects standard web environment cleanly when __TAURI__ and mobile wrappers are absent', () => {
    expect(getTauriBridge()).toBeNull();
    expect(isTauriDesktop()).toBe(false);
    expect(isTauriMobileAndroid()).toBe(false);
    expect(isNativeMobileApp()).toBe(false);
    expect(shouldShowDownloadsTab()).toBe(true);
    expect(getDefaultModelTier()).toBe('balanced');
  });

  it('hides Downloads tab and defaults to max model tier inside Windows .exe', () => {
    const mockInvoke = vi.fn();
    vi.stubGlobal('window', {
      __TAURI__: {
        core: { invoke: mockInvoke },
      },
    });
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/130.0.0.0',
    });

    expect(isAndroidDevice()).toBe(false);
    expect(isTauriDesktop()).toBe(true);
    expect(isTauriMobileAndroid()).toBe(false);
    expect(getTauriBridge()?.core.invoke).toBe(mockInvoke);
    expect(shouldShowDownloadsTab()).toBe(false);
    expect(getDefaultModelTier()).toBe('max');
  });

  it('distinguishes Tauri Android APK from Windows Desktop and defaults Android APK to balanced tier', () => {
    const mockInvoke = vi.fn();
    vi.stubGlobal('window', {
      __TAURI__: {
        core: { invoke: mockInvoke },
      },
    });
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36',
    });

    expect(isAndroidDevice()).toBe(true);
    expect(isTauriDesktop()).toBe(false);
    expect(isTauriMobileAndroid()).toBe(true);
    expect(isNativeMobileApp()).toBe(true);
    expect(shouldShowDownloadsTab()).toBe(false);
    expect(getDefaultModelTier()).toBe('balanced');
  });

  it('hides Downloads tab inside other native Android .apk wrappers (Capacitor / Cordova / WebView)', () => {
    vi.stubGlobal('window', {
      Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
    });
    expect(isNativeMobileApp()).toBe(true);
    expect(shouldShowDownloadsTab()).toBe(false);

    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A; wv) AppleWebKit/537.36 Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36',
    });
    expect(isNativeMobileApp()).toBe(true);
    expect(shouldShowDownloadsTab()).toBe(false);
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
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    });

    const status = await checkModelCacheStatus('max');
    expect(mockInvoke).toHaveBeenCalledWith('check_native_model_status', { tier: 'max' });
    expect(status.isCached).toBe(true);
    expect(status.modelId).toBe('ggml-large-v3-turbo-q5_0.bin');
    expect(status.cachedBytes).toBe(574000000);
  });

  it('defaults TauriWhisperEngine auto tier to max and transcribes Float32 PCM segments', async () => {
    const unlistenSpy = vi.fn();
    const mockListen = vi.fn().mockResolvedValue(unlistenSpy);
    const mockInvoke = vi.fn(async (cmd: string) => {
      if (cmd === 'load_whisper_model') {
        return {
          runtime: 'windows-exe',
          engine: 'whisper.cpp',
          gpuActive: true,
          backendLabel: 'Vulkan GPU: NVIDIA RTX (whisper.cpp)',
          cpuThreads: 12,
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
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    });

    const engine = new TauriWhisperEngine();
    expect(engine.getActiveTier()).toBe('max');
    const onProgress = vi.fn();
    await engine.load('auto', onProgress);

    expect(engine.isReady()).toBe(true);
    expect(engine.getActiveTier()).toBe('max');
    expect(mockInvoke).toHaveBeenCalledWith('load_whisper_model', { tier: 'max' });
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
