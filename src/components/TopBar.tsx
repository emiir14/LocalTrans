import React, { useEffect, useState } from 'react';
import { Mic, Shield, Sliders, Download, Loader2, Menu, X } from 'lucide-react';
import {
  APP_VERSION,
  fetchLatestGithubRelease,
  getConfiguredGithubRepo,
  getTauriBridge,
  isAndroidDevice,
  isNewerVersion,
  isTauriDesktop,
  openExternalUrl,
  shouldShowDownloadsTab,
} from '../core/runtime/platform';
import { AppView, useAppStore } from '../store/useAppStore';
import { PWAInstallButton } from './PWAInstallButton';

interface UpdateProgressEvent {
  status: string;
  progress: number;
}

interface UpdateResult {
  filePath: string;
  launched: boolean;
}

export const TopBar: React.FC = () => {
  const { currentView, setView, showToast } = useAppStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [hasUpdateAvailable, setHasUpdateAvailable] = useState(false);

  const showDownloads = shouldShowDownloadsTab();

  const navItems: Array<{ id: AppView; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'home', label: 'Grabaciones', icon: Mic },
    ...(showDownloads ? [{ id: 'downloads' as const, label: 'Descargas', icon: Download }] : []),
    { id: 'settings', label: 'Ajustes', icon: Sliders },
    { id: 'privacy', label: 'Privacidad', icon: Shield },
  ];

  // Silent once-per-session check to highlight when a newer release exists
  useEffect(() => {
    let cancelled = false;
    const repo = getConfiguredGithubRepo();
    if (!repo) return;

    fetchLatestGithubRelease(repo)
      .then((release) => {
        if (!cancelled && release && isNewerVersion(release.tagName, APP_VERSION)) {
          setHasUpdateAvailable(true);
        }
      })
      .catch(() => {
        // Silent ignore when offline
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleCheckAndDownloadUpdate = async () => {
    if (isCheckingUpdate || downloadProgress !== null) return;

    const repo = getConfiguredGithubRepo();
    if (!repo) {
      showToast('No hay un repositorio de actualizaciones configurado.', 'warning');
      return;
    }

    setIsCheckingUpdate(true);
    let unlisten: (() => void) | null = null;

    try {
      const release = await fetchLatestGithubRelease(repo);
      if (!release) {
        showToast('No se pudo buscar actualizaciones. Verificá tu conexión.', 'warning');
        return;
      }

      if (!isNewerVersion(release.tagName, APP_VERSION)) {
        setHasUpdateAvailable(false);
        showToast(`Ya tenés la última versión (${APP_VERSION}).`, 'info');
        return;
      }

      setHasUpdateAvailable(true);
      const isAndroid = isAndroidDevice();
      const targetAsset = isAndroid ? release.androidAsset : release.windowsAsset;

      if (!targetAsset) {
        await openExternalUrl(release.htmlUrl);
        showToast(`Nueva versión ${release.tagName} disponible en Releases.`, 'info');
        return;
      }

      if (isTauriDesktop() && !isAndroid) {
        const bridge = getTauriBridge();
        if (bridge) {
          setIsCheckingUpdate(false);
          setDownloadProgress(0);
          if (bridge.event?.listen) {
            unlisten = await bridge.event.listen<UpdateProgressEvent>(
              'update:download-progress',
              (ev) => {
                if (typeof ev.payload?.progress === 'number') {
                  setDownloadProgress(ev.payload.progress);
                }
              }
            );
          }

          const result = await bridge.core.invoke<UpdateResult>('download_and_open_update', {
            url: targetAsset.downloadUrl,
            fileName: targetAsset.name,
          });

          if (result.launched) {
            showToast(
              `Actualización ${release.tagName} descargada. Seguí el instalador para actualizar.`,
              'success'
            );
          } else {
            showToast(
              `Actualización ${release.tagName} guardada en Descargas.`,
              'success'
            );
          }
          return;
        }
      }

      await openExternalUrl(targetAsset.downloadUrl);
      showToast(`Descargando Escriba ${release.tagName}...`, 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'No se pudo descargar la actualización.';
      showToast(msg, 'warning');
    } finally {
      if (unlisten) {
        try {
          unlisten();
        } catch {
          // ignore
        }
      }
      setIsCheckingUpdate(false);
      setDownloadProgress(null);
    }
  };

  const isBusy = isCheckingUpdate || downloadProgress !== null;
  const hoverLabel =
    downloadProgress !== null
      ? `Descargando (${downloadProgress}%)`
      : isCheckingUpdate
      ? 'Buscando actualizaciones...'
      : 'Buscar actualizaciones';

  return (
    <header className="sticky top-0 z-30 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800/80 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Brand wordmark */}
        <button
          onClick={() => {
            setView('home');
            setMobileMenuOpen(false);
          }}
          className="flex items-center gap-2.5 text-left group focus:outline-hidden"
        >
          <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center text-white shadow-xs group-hover:bg-teal-700 transition-colors">
            <svg className="w-5 h-5 fill-current" viewBox="0 0 512 512">
              <path d="M256 104 C190 104 144 140 144 200 C144 260 170 300 185 360 C195 400 215 416 235 416 C250 416 254 380 256 360 C258 380 262 416 277 416 C297 416 317 400 327 360 C342 300 368 260 368 200 C368 140 322 104 256 104 Z" />
            </svg>
          </div>
          <span className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0">
            Escriba
          </span>
        </button>

        {/* Zone 2: Navigation Links + Update Download Icon */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium">
          {navItems.map((item) => {
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                className={`transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
                  isActive
                    ? 'text-teal-700 dark:text-teal-400 border-teal-600 dark:border-teal-400 font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 border-transparent'
                }`}
              >
                {item.label}
              </button>
            );
          })}

          <div className="relative group flex items-center">
            <button
              type="button"
              onClick={handleCheckAndDownloadUpdate}
              disabled={isBusy}
              title={hoverLabel}
              aria-label="Buscar actualizaciones"
              className="relative p-2 rounded-lg text-slate-600 dark:text-slate-400 hover:text-teal-700 dark:hover:text-teal-300 hover:bg-slate-100/80 dark:hover:bg-slate-800/80 transition-colors disabled:opacity-70 flex items-center gap-1.5"
            >
              {isBusy ? (
                <Loader2 className="w-4 h-4 animate-spin text-teal-600 dark:text-teal-400" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {downloadProgress !== null && (
                <span className="text-[11px] font-mono font-semibold text-teal-700 dark:text-teal-300">
                  {downloadProgress}%
                </span>
              )}
              {hasUpdateAvailable && !isBusy && (
                <span
                  aria-hidden="true"
                  className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-teal-500 ring-2 ring-white dark:ring-slate-900"
                />
              )}
            </button>

            <span
              role="tooltip"
              className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-2 px-2.5 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 shadow-lg opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity z-40"
            >
              {hoverLabel}
            </span>
          </div>
        </nav>

        {/* Zone 3: 1 Primary Action + Install Button */}
        <div className="flex items-center gap-3 shrink-0">
          <PWAInstallButton />

          {currentView !== 'recording' && (
            <button
              onClick={() => setView('home')}
              className="md:hidden p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              onClickCapture={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Menú"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          )}
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setView(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="w-4 h-4 text-slate-500" />
                <span>{item.label}</span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen(false);
              handleCheckAndDownloadUpdate();
            }}
            disabled={isBusy}
            className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <span className="flex items-center gap-3">
              {isBusy ? (
                <Loader2 className="w-4 h-4 animate-spin text-teal-600" />
              ) : (
                <Download className="w-4 h-4 text-slate-500" />
              )}
              <span>{hoverLabel}</span>
            </span>
            {hasUpdateAvailable && !isBusy && (
              <span className="w-2 h-2 rounded-full bg-teal-500" aria-hidden="true" />
            )}
          </button>
        </div>
      )}
    </header>
  );
};
