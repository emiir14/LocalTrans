export const APP_VERSION = '1.0.1';

export interface TauriGlobalBridge {
  core: {
    invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  };
  event?: {
    listen: <T = unknown>(
      event: string,
      handler: (event: { payload: T }) => void
    ) => Promise<() => void>;
  };
}

export function getTauriBridge(): TauriGlobalBridge | null {
  if (typeof window === 'undefined') return null;
  const tauri = (window as unknown as { __TAURI__?: TauriGlobalBridge }).__TAURI__;
  if (tauri?.core?.invoke) {
    return tauri;
  }
  return null;
}

export function isAndroidDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent || '');
}

export function isTauriDesktop(): boolean {
  return getTauriBridge() !== null && !isAndroidDevice();
}

export function isTauriMobileAndroid(): boolean {
  return getTauriBridge() !== null && isAndroidDevice();
}

export function isNativeMobileApp(): boolean {
  if (typeof window === 'undefined') return false;
  if (isTauriMobileAndroid()) return true;
  const win = window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
    cordova?: unknown;
    ReactNativeWebView?: unknown;
  };
  if (win.Capacitor?.isNativePlatform?.()) return true;
  if (win.Capacitor?.getPlatform && win.Capacitor.getPlatform() !== 'web') return true;
  if (win.cordova || win.ReactNativeWebView) return true;

  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent || '';
    if (/Android/i.test(ua) && /;\s*wv\)/i.test(ua)) {
      return true;
    }
  }
  return false;
}

export function shouldShowDownloadsTab(): boolean {
  return !isTauriDesktop() && !isNativeMobileApp();
}

export function getDefaultModelTier(): 'balanced' | 'max' {
  return isTauriDesktop() ? 'max' : 'balanced';
}

export function parseSemverParts(raw: string): [number, number, number] {
  const cleaned = raw.trim().replace(/^v/i, '').split(/[-+]/)[0] || '0.0.0';
  const [maj = '0', min = '0', pat = '0'] = cleaned.split('.');
  return [
    Number.parseInt(maj, 10) || 0,
    Number.parseInt(min, 10) || 0,
    Number.parseInt(pat, 10) || 0,
  ];
}

export function compareVersions(a: string, b: string): number {
  const [a1, a2, a3] = parseSemverParts(a);
  const [b1, b2, b3] = parseSemverParts(b);
  if (a1 !== b1) return a1 > b1 ? 1 : -1;
  if (a2 !== b2) return a2 > b2 ? 1 : -1;
  if (a3 !== b3) return a3 > b3 ? 1 : -1;
  return 0;
}

export function isNewerVersion(remoteTag: string, currentVersion: string = APP_VERSION): boolean {
  return compareVersions(remoteTag, currentVersion) > 0;
}

export async function openExternalUrl(url: string): Promise<void> {
  const bridge = getTauriBridge();
  if (bridge?.core?.invoke) {
    try {
      await bridge.core.invoke('plugin:opener|open_url', { url });
      return;
    } catch {
      // fallback to anchor element below
    }
  }
  if (typeof document !== 'undefined') {
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

const GITHUB_REPO_STORAGE_KEY = 'escriba_github_repo';
export const DEFAULT_GITHUB_REPO = 'emiir14/LocalTrans';

export function getConfiguredGithubRepo(): string {
  const envRepo = (import.meta.env?.VITE_GITHUB_REPO as string | undefined)?.trim();
  if (envRepo) {
    const normalizedEnv = normalizeRepoSlug(envRepo);
    if (normalizedEnv) return normalizedEnv;
  }

  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(GITHUB_REPO_STORAGE_KEY)?.trim();
    if (saved) {
      const normalizedSaved = normalizeRepoSlug(saved);
      if (normalizedSaved) return normalizedSaved;
    }
  }
  return DEFAULT_GITHUB_REPO;
}

export function saveConfiguredGithubRepo(repo: string): string {
  const normalized = normalizeRepoSlug(repo);
  if (typeof localStorage !== 'undefined') {
    if (normalized) {
      localStorage.setItem(GITHUB_REPO_STORAGE_KEY, normalized);
    } else {
      localStorage.removeItem(GITHUB_REPO_STORAGE_KEY);
    }
  }
  return normalized || DEFAULT_GITHUB_REPO;
}

export function normalizeRepoSlug(raw: string): string {
  const trimmed = raw.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '');
  const parts = trimmed.split('/').filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]}/${parts[1]}`;
  }
  return '';
}

export interface GithubReleaseAssetInfo {
  name: string;
  sizeBytes: number;
  downloadUrl: string;
}

export interface GithubLatestReleaseInfo {
  tagName: string;
  publishedAt: string;
  htmlUrl: string;
  windowsAsset: GithubReleaseAssetInfo | null;
  androidAsset: GithubReleaseAssetInfo | null;
}

export async function fetchLatestGithubRelease(
  repoSlug: string
): Promise<GithubLatestReleaseInfo | null> {
  const normalized = normalizeRepoSlug(repoSlug);
  if (!normalized) return null;

  const res = await fetch(`https://api.github.com/repos/${normalized}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  });

  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as {
    tag_name?: string;
    published_at?: string;
    html_url?: string;
    assets?: Array<{ name?: string; size?: number; browser_download_url?: string }>;
  };

  const assets = data.assets || [];
  const exeAsset = assets.find((a) => (a.name || '').toLowerCase().endsWith('.exe'));
  const apkAsset = assets.find((a) => (a.name || '').toLowerCase().endsWith('.apk'));

  return {
    tagName: data.tag_name || 'latest',
    publishedAt: data.published_at || '',
    htmlUrl: data.html_url || `https://github.com/${normalized}/releases`,
    windowsAsset: exeAsset?.browser_download_url
      ? {
          name: exeAsset.name || 'Escriba-Setup.exe',
          sizeBytes: exeAsset.size || 0,
          downloadUrl: exeAsset.browser_download_url,
        }
      : null,
    androidAsset: apkAsset?.browser_download_url
      ? {
          name: apkAsset.name || 'Escriba.apk',
          sizeBytes: apkAsset.size || 0,
          downloadUrl: apkAsset.browser_download_url,
        }
      : null,
  };
}
