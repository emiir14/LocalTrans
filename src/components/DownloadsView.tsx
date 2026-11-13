import React, { useEffect, useState } from 'react';
import {
  Download,
  Monitor,
  Smartphone,
  Cpu,
  ShieldCheck,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Zap,
  HardDrive,
  RefreshCw,
} from 'lucide-react';
import {
  fetchLatestGithubRelease,
  getConfiguredGithubRepo,
  getTauriBridge,
  GithubLatestReleaseInfo,
  isTauriDesktop,
  saveConfiguredGithubRepo,
} from '../core/runtime/platform';
import { NativeCapabilitiesResponse } from '../core/transcription/tauriEngine';
import { useAppStore } from '../store/useAppStore';

function formatBytesMb(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export const DownloadsView: React.FC = () => {
  const { showToast } = useAppStore();
  const runningDesktop = isTauriDesktop();

  const [repoSlug, setRepoSlug] = useState<string>(() => getConfiguredGithubRepo());
  const [repoInput, setRepoInput] = useState<string>(() => getConfiguredGithubRepo());
  const [release, setRelease] = useState<GithubLatestReleaseInfo | null>(null);
  const [isLoadingRelease, setIsLoadingRelease] = useState(false);
  const [releaseChecked, setReleaseChecked] = useState(false);
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

  const loadRelease = async (slug: string) => {
    if (!slug) {
      setRelease(null);
      setReleaseChecked(true);
      return;
    }
    setIsLoadingRelease(true);
    try {
      const info = await fetchLatestGithubRelease(slug);
      setRelease(info);
    } catch {
      setRelease(null);
    } finally {
      setIsLoadingRelease(false);
      setReleaseChecked(true);
    }
  };

  useEffect(() => {
    loadRelease(repoSlug);
  }, [repoSlug]);

  const handleSaveRepo = (e: React.FormEvent) => {
    e.preventDefault();
    const saved = saveConfiguredGithubRepo(repoInput);
    if (!saved && repoInput.trim()) {
      showToast('Ingresá el formato usuario/repositorio (ej: emir/escriba)', 'warning');
      return;
    }
    setRepoSlug(saved);
    setRepoInput(saved);
    if (saved) {
      showToast(`Repositorio conectado: ${saved}`, 'success');
    } else {
      showToast('Configuración de repositorio limpiada', 'info');
    }
  };

  const fallbackWindowsUrl = repoSlug
    ? `https://github.com/${repoSlug}/releases/latest/download/Escriba-Setup.exe`
    : '';
  const windowsDownloadUrl = release?.windowsAsset?.downloadUrl || fallbackWindowsUrl;
  const androidDownloadUrl = release?.androidAsset?.downloadUrl || '';
  const releasesPageUrl = repoSlug ? `https://github.com/${repoSlug}/releases` : '';

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
            {windowsDownloadUrl ? (
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
            ) : (
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 text-xs text-slate-600 dark:text-slate-300 space-y-1.5">
                <div className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>Pendiente conectar repositorio de GitHub Releases</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  Al crear un tag <code>v1.0.0</code> en GitHub, Actions compila el <code>.exe</code> gratis y lo publica automáticamente. Conectá tu repo abajo para habilitar el botón directo.
                </p>
              </div>
            )}

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
                  <strong>Paquete .apk nativo:</strong> Se publicará desde el mismo flujo de GitHub Releases cuando se agregue el compilador Android con Capacitor.
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
                <span>Escriba.apk (Próximamente en GitHub Releases)</span>
              </button>
            )}

            <p className="text-[11px] text-slate-400 dark:text-slate-500 leading-relaxed">
              Mientras el `.apk` nativo no esté publicado, la PWA instalada funciona sin internet y protege el almacenamiento local en el teléfono.
            </p>
          </div>
        </section>
      </div>

      {/* GitHub Releases Repository Linker */}
      <section className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800/80 p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Origen de descargas (GitHub Releases gratuito)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Los binarios se alojan gratis en GitHub Releases para no consumir cuota de Vercel. Podés definir <code>VITE_GITHUB_REPO</code> o guardarlo acá.
            </p>
          </div>

          {releasesPageUrl && (
            <a
              href={releasesPageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 dark:text-teal-300 hover:underline whitespace-nowrap"
            >
              <span>Ver todas las versiones</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>

        <form onSubmit={handleSaveRepo} className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="text"
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            placeholder="tu-usuario/tu-repositorio"
            className="flex-1 px-3.5 py-2.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:border-teal-500 font-mono min-h-[44px]"
          />
          <button
            type="submit"
            className="px-4 py-2.5 rounded-xl text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 transition-colors whitespace-nowrap min-h-[44px]"
          >
            Conectar repositorio
          </button>
          {repoSlug && (
            <button
              type="button"
              onClick={() => loadRelease(repoSlug)}
              disabled={isLoadingRelease}
              className="px-3.5 py-2.5 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-1.5 min-h-[44px]"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingRelease ? 'animate-spin' : ''}`} />
              <span>Comprobar</span>
            </button>
          )}
        </form>

        {repoSlug && releaseChecked && !isLoadingRelease && !release && (
          <p className="text-[11px] text-amber-700 dark:text-amber-300">
            No se encontró un Release publicado todavía en <code>{repoSlug}</code> (o el repo es privado). Igual podés lanzar el workflow <em>Build Escriba Windows (.exe)</em> en GitHub Actions con un tag <code>v1.0.0</code>.
          </p>
        )}
      </section>

      {/* Honest Platform Comparison */}
      <section className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800/80 p-6 shadow-xs space-y-4">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          ¿Qué cambia entre la Web / PWA y la app nativa?
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <th className="py-2.5 pr-4 font-medium">Característica</th>
                <th className="py-2.5 px-4 font-medium">Web / PWA</th>
                <th className="py-2.5 pl-4 font-semibold text-teal-700 dark:text-teal-300">
                  Windows (.exe)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-slate-700 dark:text-slate-300">
              <tr>
                <td className="py-2.5 pr-4 font-medium">Motor de IA</td>
                <td className="py-2.5 px-4">ONNX en navegador (WASM / WebGPU)</td>
                <td className="py-2.5 pl-4 font-medium">whisper.cpp nativo (Vulkan GPU + CPU AVX2)</td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-medium">Límite de memoria</td>
                <td className="py-2.5 px-4">Restringido por pestaña (~2–4 GB)</td>
                <td className="py-2.5 pl-4 font-medium">Toda la RAM y VRAM reales de tu PC</td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-medium">Decodificación</td>
                <td className="py-2.5 px-4">Beam 1–2 (`q4` / `q8`)</td>
                <td className="py-2.5 pl-4 font-medium">Beam 5 nativo (`q8_0` / `q5_0`)</td>
              </tr>
              <tr>
                <td className="py-2.5 pr-4 font-medium">Privacidad y costo</td>
                <td className="py-2.5 px-4">100% local · $0</td>
                <td className="py-2.5 pl-4 font-medium">100% local · $0</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
