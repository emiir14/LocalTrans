import React, { useEffect, useState } from 'react';
import {
  Download,
  Monitor,
  Smartphone,
  Cpu,
  ShieldCheck,
  CheckCircle2,
  Zap,
  HardDrive,
} from 'lucide-react';
import {
  fetchLatestGithubRelease,
  getConfiguredGithubRepo,
  getTauriBridge,
  GithubLatestReleaseInfo,
  isTauriDesktop,
} from '../core/runtime/platform';
import { NativeCapabilitiesResponse } from '../core/transcription/tauriEngine';

function formatBytesMb(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export const DownloadsView: React.FC = () => {
  const runningDesktop = isTauriDesktop();
  const repoSlug = getConfiguredGithubRepo();

  const [release, setRelease] = useState<GithubLatestReleaseInfo | null>(null);
  const [nativeCaps, setNativeCaps] = useState<NativeCapabilitiesResponse | null>(null);

  useEffect(() => {
    if (runningDesktop) {
      const bridge = getTauriBridge();
      bridge?.core
        .invoke<NativeCapabilitiesResponse>('get_native_capabilities')
        .then(setNativeCaps)
        .catch(() => {});
    }
  }, [runningDesktop]);

  useEffect(() => {
    if (!repoSlug) return;
    fetchLatestGithubRelease(repoSlug)
      .then(setRelease)
      .catch(() => setRelease(null));
  }, [repoSlug]);

  const fallbackWindowsUrl = repoSlug
    ? `https://github.com/${repoSlug}/releases/latest/download/Escriba-Setup.exe`
    : '';
  const windowsDownloadUrl = release?.windowsAsset?.downloadUrl || fallbackWindowsUrl;
  const androidDownloadUrl = release?.androidAsset?.downloadUrl || '';

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 border-b border-slate-200/80 dark:border-slate-800/80">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Descargas nativas
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 max-w-2xl leading-relaxed">
            Escriba funciona 100% gratis en tu dispositivo. Instalá la versión nativa para aprovechar toda la placa de video y memoria sin los límites del navegador.
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs text-teal-700 dark:text-teal-300 font-medium shrink-0">
          <ShieldCheck className="w-4 h-4" />
          <span>100% local y gratuito</span>
        </div>
      </div>

      {/* Active Native Desktop Banner */}
      {runningDesktop && (
        <div className="p-5 rounded-3xl bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800/70 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-teal-900 dark:text-teal-100">
            <CheckCircle2 className="w-4 h-4 text-teal-600 dark:text-teal-400" />
            <span>Estás usando Escriba Desktop nativo para Windows (.exe)</span>
          </div>
          {nativeCaps && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-teal-800/90 dark:text-teal-200/90">
              <span>Motor: {nativeCaps.backendLabel}</span>
              <span aria-hidden="true">·</span>
              <span>Hilos CPU: {nativeCaps.cpuThreads}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate max-w-md" title={nativeCaps.modelsDir}>
                Modelos: {nativeCaps.modelsDir}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Platform Download Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Windows .exe Card */}
        <section className="bg-white dark:bg-slate-900 rounded-3xl border border-teal-200/90 dark:border-teal-900/60 p-6 shadow-xs flex flex-col justify-between gap-6">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-teal-50 dark:bg-teal-950/60 flex items-center justify-center text-teal-600 dark:text-teal-400 shrink-0">
                  <Monitor className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Windows (.exe)
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Windows 10 / 11 (64 bits) · Motor whisper.cpp nativo
                  </p>
                </div>
              </div>

              {release?.tagName && (
                <span className="text-xs font-mono font-semibold text-teal-700 dark:text-teal-300">
                  {release.tagName}
                </span>
              )}
            </div>

            <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
              <li className="flex items-start gap-2">
                <Zap className="w-3.5 h-3.5 text-teal-600 shrink-0 mt-0.5" />
                <span>
                  <strong>Aceleración GPU Vulkan</strong> (NVIDIA, AMD e Intel) y respaldo CPU AVX2 sin tope de 2 GB del navegador.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Cpu className="w-3.5 h-3.5 text-teal-600 shrink-0 mt-0.5" />
                <span>
                  Decodificación <strong>Beam Search (beam 5)</strong> con modelos GGML <code>q8_0</code> / <code>q5_0</code> para máxima precisión en español.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <HardDrive className="w-3.5 h-3.5 text-teal-600 shrink-0 mt-0.5" />
                <span>
                  Instalador por usuario (sin permisos de administrador), instancia única y protección en bandeja del sistema mientras transcribe.
                </span>
              </li>
            </ul>
          </div>

          <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            <a
              href={windowsDownloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-3.5 px-4 rounded-2xl text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 shadow-md shadow-teal-600/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2 min-h-[48px]"
            >
              <Download className="w-4 h-4" />
              <span>
                Descargar Escriba-Setup.exe
                {release?.windowsAsset?.sizeBytes
                  ? ` (${formatBytesMb(release.windowsAsset.sizeBytes)})`
                  : ''}
              </span>
            </a>

            <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
              Si Windows SmartScreen muestra aviso al ser software gratuito sin certificado pago: tocá <strong>Más información → Ejecutar de todas formas</strong>.
            </p>
          </div>
        </section>

        {/* Android .apk Card */}
        <section className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800/80 p-6 shadow-xs flex flex-col justify-between gap-6">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-700 dark:text-slate-300 shrink-0">
                  <Smartphone className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    Android (.apk) y Móviles
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Android 9+ (ARM64) · Instalación directa o PWA
                  </p>
                </div>
              </div>
            </div>

            <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-teal-600 shrink-0 mt-0.5" />
                <span>
                  <strong>PWA lista hoy mismo:</strong> En Chrome (Android) o Safari (iPhone), tocá <em>"Instalar app"</em> / <em>"Agregar a pantalla de inicio"</em> para usarla 100% offline.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <Smartphone className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                <span>
                  <strong>Paquete .apk nativo:</strong> Disponible para descarga directa desde que se publique la compilación móvil.
                </span>
              </li>
            </ul>
          </div>

          <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            {androidDownloadUrl ? (
              <a
                href={androidDownloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-3.5 px-4 rounded-2xl text-xs font-semibold text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 hover:opacity-90 transition-all flex items-center justify-center gap-2 min-h-[48px]"
              >
                <Download className="w-4 h-4" />
                <span>
                  Descargar Escriba.apk
                  {release?.androidAsset?.sizeBytes
                    ? ` (${formatBytesMb(release.androidAsset.sizeBytes)})`
                    : ''}
                </span>
              </a>
            ) : (
              <button
                type="button"
                disabled
                className="w-full py-3.5 px-4 rounded-2xl text-xs font-semibold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 cursor-not-allowed flex items-center justify-center gap-2 min-h-[48px]"
              >
                <Download className="w-4 h-4" />
                <span>Escriba.apk (Próximamente)</span>
              </button>
            )}

            <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
              Mientras el .apk nativo no esté publicado, la PWA instalada funciona sin internet y protege el almacenamiento local en el teléfono.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
};
