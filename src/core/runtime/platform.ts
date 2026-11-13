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

export function isTauriDesktop(): boolean {
  return getTauriBridge() !== null;
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
