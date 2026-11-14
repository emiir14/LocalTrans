import React, { useEffect, useState, useRef } from 'react';
import {
  Cpu,
  Mic,
  BookOpen,
  HardDrive,
  Trash2,
  Plus,
  Check,
  Sun,
  Moon,
  Laptop,
  RotateCw,
  Radio,
  Download,
  Upload,
  CheckCircle2,
  CloudDownload,
} from 'lucide-react';
import { getDefaultModelTier, getTauriBridge, isTauriDesktop } from '../core/runtime/platform';
import { NativeCapabilitiesResponse } from '../core/transcription/tauriEngine';
import { detectHardwareCapabilities, HardwareCapabilities } from '../core/transcription/tierDetector';
import { ModelTier } from '../core/types';
import { useAppStore } from '../store/useAppStore';
import { BenchmarkSection } from './BenchmarkView';

export const SettingsView: React.FC = () => {
  const {
    settings,
    updateSettings,
    glossary,
    addGlossaryEntry,
    removeGlossaryEntry,
    storageUsage,
    clearTranscribedAudioAll,
    clearAllData,
    openConfirm,
    showToast,
    modelCacheStatuses,
    downloadingModelTier,
    modelDownloadProgress,
    downloadModelForOffline,
    exportLocalBackup,
    importLocalBackup,
    exportGlossaryBackup,
    importGlossaryBackup,
  } = useAppStore();

  const runningDesktop = isTauriDesktop();
  const [hardware, setHardware] = useState<HardwareCapabilities | null>(null);
  const [nativeCaps, setNativeCaps] = useState<NativeCapabilitiesResponse | null>(null);
  const [newIncorrect, setNewIncorrect] = useState('');
  const [newCorrect, setNewCorrect] = useState('');
  const [isAddingGlossary, setIsAddingGlossary] = useState(false);

  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [isTestingMic, setIsTestingMic] = useState(false);
  const [testVuLevel, setTestVuLevel] = useState(0);

  const testStreamRef = useRef<MediaStream | null>(null);
  const testContextRef = useRef<AudioContext | null>(null);
  const testAnimFrameRef = useRef<number | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const glossaryInputRef = useRef<HTMLInputElement | null>(null);

  const loadAudioDevices = async () => {
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices) {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter((d) => d.kind === 'audioinput');
        setAudioDevices(inputs);
      } catch {
        // ignore
      }
    }
  };

  useEffect(() => {
    detectHardwareCapabilities().then(setHardware);
    if (runningDesktop) {
      const bridge = getTauriBridge();
      bridge?.core
        .invoke<NativeCapabilitiesResponse>('get_native_capabilities')
        .then(setNativeCaps)
        .catch(() => {});
    }
    loadAudioDevices();

    const handleDeviceChange = () => {
      loadAudioDevices();
    };

    navigator.mediaDevices?.addEventListener('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', handleDeviceChange);
      stopMicTest();
    };
  }, []);

  const handleRefreshDevices = async () => {
    try {
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      tempStream.getTracks().forEach((t) => t.stop());
    } catch {
      // ignore
    }
    await loadAudioDevices();
    showToast('Lista de micrófonos actualizada', 'info');
  };

  const stopMicTest = () => {
    if (testAnimFrameRef.current) {
      cancelAnimationFrame(testAnimFrameRef.current);
      testAnimFrameRef.current = null;
    }
    if (testStreamRef.current) {
      testStreamRef.current.getTracks().forEach((t) => t.stop());
      testStreamRef.current = null;
    }
    if (testContextRef.current && testContextRef.current.state !== 'closed') {
      try {
        testContextRef.current.close();
      } catch {
        // ignore
      }
      testContextRef.current = null;
    }
    setIsTestingMic(false);
    setTestVuLevel(0);
  };

  const toggleMicTest = async () => {
    if (isTestingMic) {
      stopMicTest();
      return;
    }

    try {
      const audioConstraints: MediaTrackConstraints = {
        echoCancellation: false,
        autoGainControl: false,
        noiseSuppression: settings?.noiseSuppression ?? false,
      };
      if (settings?.selectedAudioDeviceId) {
        audioConstraints.deviceId = { exact: settings.selectedAudioDeviceId };
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
          video: false,
        });
      } catch {
        if (settings?.selectedAudioDeviceId) {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              autoGainControl: false,
              noiseSuppression: settings?.noiseSuppression ?? false,
            },
            video: false,
          });
        } else {
          throw new Error('No se pudo acceder al micrófono');
        }
      }

      testStreamRef.current = stream;
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      testContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      setIsTestingMic(true);

      const checkLevel = () => {
        if (!testContextRef.current) return;
        analyser.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const val = (dataArray[i] - 128) / 128;
          sum += val * val;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        setTestVuLevel(Math.min(1, rms * 4.5));
        testAnimFrameRef.current = requestAnimationFrame(checkLevel);
      };
      checkLevel();
    } catch {
      stopMicTest();
      showToast('No se pudo iniciar la prueba del micrófono', 'warning');
    }
  };

  const handleTierChange = async (tier: ModelTier) => {
    await updateSettings({ modelTier: tier });
  };

  const handleAddGlossarySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newIncorrect.trim() && newCorrect.trim()) {
      await addGlossaryEntry(newIncorrect, newCorrect);
      setNewIncorrect('');
      setNewCorrect('');
      setIsAddingGlossary(false);
    }
  };

  const triggerDownload = (filename: string, content: string) => {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportBackup = async () => {
    try {
      const json = await exportLocalBackup();
      const dateTag = new Date().toISOString().slice(0, 10);
      triggerDownload(`escriba_respaldo_${dateTag}.json`, json);
      showToast('Respaldo local exportado', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al exportar respaldo';
      showToast(msg, 'warning');
    }
  };

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      await importLocalBackup(text);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al importar respaldo';
      showToast(msg, 'warning');
    } finally {
      e.target.value = '';
    }
  };

  const handleExportGlossary = () => {
    const json = exportGlossaryBackup();
    const dateTag = new Date().toISOString().slice(0, 10);
    triggerDownload(`escriba_glosario_${dateTag}.json`, json);
    showToast('Glosario dental exportado', 'success');
  };

  const handleImportGlossary = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      await importGlossaryBackup(text);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al importar glosario';
      showToast(msg, 'warning');
    } finally {
      e.target.value = '';
    }
  };

  const usedMb = Math.round(storageUsage.usedBytes / (1024 * 1024));
  const totalMb = Math.round(storageUsage.quotaBytes / (1024 * 1024));

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Ajustes del sistema
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Configuración local del motor de transcripción, disponibilidad sin internet, glosario odontológico y respaldos.
        </p>
      </div>

      {/* Section 1: Transcription Model Tier & Offline Readiness */}
      <section className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800/80 p-6 shadow-xs space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-teal-50 dark:bg-teal-950/60 flex items-center justify-center text-teal-600 dark:text-teal-400">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Nivel del modelo de transcripción (Whisper)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Selecciona el modelo y verifica si sus pesos ya están descargados para trabajar sin internet.
            </p>
          </div>
        </div>

        {runningDesktop && nativeCaps ? (
          <div className="p-3.5 rounded-2xl bg-teal-50/70 dark:bg-teal-950/30 border border-teal-200/70 dark:border-teal-800/60 text-xs text-slate-700 dark:text-slate-200 space-y-1">
            <div className="font-semibold text-teal-900 dark:text-teal-200">
              Motor nativo detectado en Windows (.exe):
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-teal-800 dark:text-teal-300">
              <span>Aceleración: {nativeCaps.backendLabel}</span>
              <span>Hilos de CPU: {nativeCaps.cpuThreads}</span>
            </div>
          </div>
        ) : hardware ? (
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 text-xs text-slate-600 dark:text-slate-300 space-y-1">
            <div className="font-semibold text-slate-800 dark:text-slate-200">
              Hardware detectado en tu navegador:
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
              <span>
                Aceleración:{' '}
                {hardware.isMobile
                  ? 'WASM CPU Multihilo (Optimizado para móviles)'
                  : hardware.hasWebGpu
                  ? 'WebGPU Acelerado'
                  : 'WASM CPU Multihilo'}
              </span>
              {hardware.adapterInfo && <span>Adaptador: {hardware.adapterInfo}</span>}
              {hardware.deviceMemoryGb && <span>Memoria RAM: ~{hardware.deviceMemoryGb} GB</span>}
              <span>Hilos de CPU: {hardware.hardwareConcurrency}</span>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          {[
            {
              id: 'balanced' as const,
              label: runningDesktop
                ? 'Estándar clínico (whisper-small)'
                : 'Estándar clínico (whisper-small) — Recomendado',
              desc: runningDesktop
                ? 'Modelo GGML q8_0 (~190 MB). Ultra rápido para equipos sin GPU dedicada o consultas breves.'
                : 'Modelo de 244M parámetros (~240 MB, q8). Mejor ortografía y precisión en español para móviles y PCs.',
            },
            {
              id: 'max' as const,
              label: runningDesktop
                ? 'Máxima resolución (whisper-large-v3-turbo) — Recomendado'
                : 'Máxima resolución (whisper-large-v3-turbo)',
              desc: runningDesktop
                ? 'Modelo GGML q5_0 (~574 MB). Máxima fidelidad clínica para Windows con GPU Vulkan o CPU multinúcleo.'
                : 'Modelo de 800M parámetros (~480 MB, decodificador q8). Máxima fidelidad acústica para consultas extensas o hardware potente.',
            },
          ].map((tier) => {
            const currentTier = settings?.modelTier || getDefaultModelTier();
            const isSelected =
              tier.id === 'balanced'
                ? currentTier === 'balanced' ||
                  currentTier === 'fast' ||
                  (currentTier === 'auto' && !runningDesktop)
                : currentTier === 'max' || (currentTier === 'auto' && runningDesktop);
            const cacheInfo = modelCacheStatuses[tier.id];
            const isDownloadingThis = downloadingModelTier === tier.id;

            return (
              <div
                key={tier.id}
                className={`p-4 rounded-2xl border transition-all flex flex-col justify-between gap-3 ${
                  isSelected
                    ? 'border-teal-600 bg-teal-50/50 dark:bg-teal-950/30 ring-1 ring-teal-600'
                    : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleTierChange(tier.id)}
                  className="text-left space-y-1 w-full"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {tier.label}
                    </span>
                    {isSelected && <Check className="w-4 h-4 text-teal-600 shrink-0" />}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    {tier.desc}
                  </p>
                </button>

                <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800/80 flex items-center justify-between gap-2">
                  {cacheInfo?.isCached ? (
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-teal-700 dark:text-teal-400">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>Listo sin internet</span>
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Descarga inicial pendiente
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => downloadModelForOffline(tier.id)}
                    disabled={Boolean(downloadingModelTier)}
                    className="px-3 py-1.5 rounded-xl text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5 whitespace-nowrap min-h-[36px]"
                  >
                    {isDownloadingThis ? (
                      <>
                        <RotateCw className="w-3.5 h-3.5 animate-spin text-teal-600" />
                        <span>{modelDownloadProgress}%</span>
                      </>
                    ) : (
                      <>
                        <CloudDownload className="w-3.5 h-3.5 text-teal-600" />
                        <span>{cacheInfo?.isCached ? 'Verificar caché' : 'Descargar offline'}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Transcription Context Mode Switch */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
          <div>
            <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Contexto del vocabulario (Prompt de Whisper)
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              Elegí si querés priorizar terminología odontológica o español general sin sesgo médico (reuniones, charlas, gaming).
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {[
              {
                id: 'dental' as const,
                title: 'Odontología (Clínico)',
                desc: 'Aplica vocabulario dental, piezas FDI y corrección automática del glosario.',
              },
              {
                id: 'general' as const,
                title: 'General / Conversación libre',
                desc: 'Español rioplatense neutro sin glosario dental para evitar palabras forzadas.',
              },
            ].map((modeOption) => {
              const activeMode = settings?.transcriptionMode || 'dental';
              const isSelected = activeMode === modeOption.id;
              return (
                <button
                  key={modeOption.id}
                  type="button"
                  onClick={() => updateSettings({ transcriptionMode: modeOption.id })}
                  className={`p-3.5 rounded-2xl border text-left transition-all min-h-[44px] ${
                    isSelected
                      ? 'border-teal-600 bg-teal-50/50 dark:bg-teal-950/30 ring-1 ring-teal-600'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {modeOption.title}
                    </span>
                    {isSelected && <Check className="w-4 h-4 text-teal-600 shrink-0" />}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    {modeOption.desc}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Section 2: Audio, Mic & Recording Settings */}
      <section className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800/80 p-6 shadow-xs space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-teal-50 dark:bg-teal-950/60 flex items-center justify-center text-teal-600 dark:text-teal-400">
            <Mic className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Micrófono y grabación
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Ajustes acústicos para el consultorio.
            </p>
          </div>
        </div>

        <div className="space-y-4 pt-1 divide-y divide-slate-100 dark:divide-slate-800">
          <div className="pt-2 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <span>Dispositivo de micrófono de entrada</span>
                  {settings?.selectedAudioDeviceId && (
                    <span className="text-[10px] text-teal-700 dark:text-teal-300 font-medium">
                      · Personalizado
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Elige qué micrófono utilizar (auriculares Bluetooth, micrófono de escritorio o micrófono integrado).
                </p>
              </div>

              <button
                type="button"
                onClick={handleRefreshDevices}
                className="self-start sm:self-auto px-3 py-1.5 text-[11px] font-medium rounded-xl text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center gap-1.5 transition-colors min-h-[36px]"
              >
                <RotateCw className="w-3 h-3 text-slate-500" />
                <span>Actualizar dispositivos</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
              <div className="sm:col-span-2">
                <select
                  value={settings?.selectedAudioDeviceId || ''}
                  onChange={(e) => updateSettings({ selectedAudioDeviceId: e.target.value || undefined })}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:border-teal-500 font-medium min-h-[40px]"
                >
                  <option value="">Predeterminado del sistema / navegador</option>
                  {audioDevices.map((dev, idx) => (
                    <option key={dev.deviceId || idx} value={dev.deviceId}>
                      {dev.label || `Micrófono ${idx + 1}`}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <button
                  type="button"
                  onClick={toggleMicTest}
                  className={`w-full px-3 py-2 text-xs font-semibold rounded-xl border transition-colors flex items-center justify-center gap-2 min-h-[40px] ${
                    isTestingMic
                      ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                      : 'bg-teal-50/70 dark:bg-teal-950/40 border-teal-200 dark:border-teal-800/80 text-teal-800 dark:text-teal-200 hover:bg-teal-100 dark:hover:bg-teal-900/50'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${isTestingMic ? 'bg-rose-500 animate-ping' : 'bg-teal-500'}`} />
                  <span>{isTestingMic ? 'Detener prueba' : 'Probar nivel'}</span>
                </button>
              </div>
            </div>

            {isTestingMic && (
              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                  <span className="font-medium flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-teal-600 animate-pulse" />
                    <span>Nivel captado por el micrófono:</span>
                  </span>
                  <span className="font-mono font-bold text-teal-600">{Math.round(testVuLevel * 100)}%</span>
                </div>
                <div className="h-2 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-75 rounded-full ${
                      testVuLevel > 0.7
                        ? 'bg-amber-500'
                        : testVuLevel > 0.05
                        ? 'bg-teal-500'
                        : 'bg-slate-400'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(2, testVuLevel * 100))}%` }}
                  />
                </div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">
                  {testVuLevel < 0.03
                    ? 'Hablá hacia el micrófono. Si la barra no responde, verificá que los auriculares no estén silenciados o probá otro dispositivo de la lista.'
                    : 'Nivel óptimo detectado. Tu voz está llegando con buena amplitud.'}
                </p>
              </div>
            )}
          </div>

          {/* Noise Suppression Toggle */}
          <div className="flex items-center justify-between gap-4 pt-4">
            <div>
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Supresión de ruido por hardware del navegador
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 max-w-lg leading-relaxed">
                Desactivada por defecto para evitar que los algoritmos de cancelación corten consonantes o voces suaves en el gabinete.
              </p>
            </div>
            <button
              onClick={() => updateSettings({ noiseSuppression: !settings?.noiseSuppression })}
              className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors shrink-0 ${
                settings?.noiseSuppression ? 'bg-teal-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}
              aria-label="Alternar supresión de ruido"
            >
              <div
                className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                  settings?.noiseSuppression ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Auto Transcribe on Stop Toggle */}
          <div className="flex items-center justify-between gap-4 pt-4">
            <div>
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Transcribir automáticamente al detener la grabación
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Inicia la conversión a texto de inmediato apenas finaliza la consulta.
              </p>
            </div>
            <button
              onClick={() => updateSettings({ autoTranscribeOnStop: !settings?.autoTranscribeOnStop })}
              className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors shrink-0 ${
                settings?.autoTranscribeOnStop ? 'bg-teal-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}
              aria-label="Alternar transcripción automática"
            >
              <div
                className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                  settings?.autoTranscribeOnStop ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Progressive Background Transcription Toggle */}
          <div className="flex items-center justify-between gap-4 pt-4">
            <div>
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Transcripción progresiva en segundo plano · Recomendado
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 max-w-lg leading-relaxed">
                Transcribe bloques cada 30 segundos mientras la consulta continúa. Al finalizar, casi todo el texto ya está listo de inmediato.
              </p>
            </div>
            <button
              onClick={() => updateSettings({ progressiveTranscription: !(settings?.progressiveTranscription ?? true) })}
              className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors shrink-0 ${
                (settings?.progressiveTranscription ?? true) ? 'bg-teal-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}
              aria-label="Alternar transcripción progresiva"
            >
              <div
                className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                  (settings?.progressiveTranscription ?? true) ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Consent Requirement Toggle */}
          <div className="flex items-center justify-between gap-4 pt-4">
            <div>
              <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Recordatorio de consentimiento informado
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Muestra la confirmación de consentimiento antes de cada nueva consulta.
              </p>
            </div>
            <button
              onClick={() => updateSettings({ requireConsent: !settings?.requireConsent })}
              className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors shrink-0 ${
                settings?.requireConsent ? 'bg-teal-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}
              aria-label="Alternar recordatorio de consentimiento"
            >
              <div
                className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                  settings?.requireConsent ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>
      </section>

      {/* Section 3: Dental Glossary + Share/Migrate */}
      <section className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800/80 p-6 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-teal-50 dark:bg-teal-950/60 flex items-center justify-center text-teal-600 dark:text-teal-400">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Glosario odontológico post-proceso
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Corrige automáticamente palabras técnicas y compártelo entre consultorios.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              ref={glossaryInputRef}
              onChange={handleImportGlossary}
              accept=".json,application/json"
              className="hidden"
            />
            <button
              type="button"
              onClick={() => glossaryInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors min-h-[36px]"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Importar</span>
            </button>
            <button
              type="button"
              onClick={handleExportGlossary}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors min-h-[36px]"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Exportar</span>
            </button>
            <button
              onClick={() => setIsAddingGlossary(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950 hover:bg-teal-100 dark:hover:bg-teal-900/60 transition-colors min-h-[36px]"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Agregar término</span>
            </button>
          </div>
        </div>

        {isAddingGlossary && (
          <form onSubmit={handleAddGlossarySubmit} className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  Texto escuchado / erróneo
                </label>
                <input
                  type="text"
                  value={newIncorrect}
                  onChange={(e) => setNewIncorrect(e.target.value)}
                  placeholder="Ej: conducto metría"
                  className="w-full mt-1 px-3 py-1.5 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                  required
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  Término odontológico correcto
                </label>
                <input
                  type="text"
                  value={newCorrect}
                  onChange={(e) => setNewCorrect(e.target.value)}
                  placeholder="Ej: conductometría"
                  className="w-full mt-1 px-3 py-1.5 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                  required
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsAddingGlossary(false)}
                className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-800"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-semibold rounded-xl bg-teal-600 text-white hover:bg-teal-700"
              >
                Guardar
              </button>
            </div>
          </form>
        )}

        <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200/60 dark:border-slate-800/60">
          {glossary.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between p-3 text-xs hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
              <div className="flex items-center gap-3">
                <span className="text-rose-600 line-through dark:text-rose-400">{entry.incorrect}</span>
                <span className="text-slate-400">→</span>
                <span className="font-semibold text-teal-700 dark:text-teal-300">{entry.correct}</span>
              </div>
              <button
                onClick={() => removeGlossaryEntry(entry.id)}
                className="p-2 text-slate-400 hover:text-rose-600 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
                title="Eliminar término"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Section 4: Visual Theme */}
      <section className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800/80 p-6 shadow-xs space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Aspecto visual
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            El modo claro utiliza una paleta cálida antifatiga visual (lino y porcelana suave) bajo la luz del consultorio.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {[
            { id: 'light', label: 'Claro cálido', icon: Sun },
            { id: 'dark', label: 'Oscuro', icon: Moon },
            { id: 'system', label: 'Sistema', icon: Laptop },
          ].map((item) => {
            const Icon = item.icon;
            const isSelected = (settings?.theme || 'system') === item.id;
            return (
              <button
                key={item.id}
                onClick={() => updateSettings({ theme: item.id as 'light' | 'dark' | 'system' })}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-2xl text-xs font-semibold border transition-all min-h-[44px] ${
                  isSelected
                    ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-200 shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Section 5: Local Storage, Backups & Maintenance */}
      <section className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800/80 p-6 shadow-xs space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-teal-50 dark:bg-teal-950/60 flex items-center justify-center text-teal-600 dark:text-teal-400">
            <HardDrive className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Respaldos y mantenimiento local
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Exporta o restaura tus consultas, fichas clínicas y glosario antes de cambiar de dispositivo o limpiar el navegador.
            </p>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-slate-600 dark:text-slate-300">Espacio local en uso:</span>
            <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
              ~{usedMb} MB de {totalMb > 0 ? `${totalMb} MB disponibles` : 'cuota permitida'}
            </span>
          </div>
        </div>

        {/* Backup Import / Export */}
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            ref={backupInputRef}
            onChange={handleImportBackup}
            accept=".json,application/json"
            className="hidden"
          />
          <button
            type="button"
            onClick={handleExportBackup}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold text-teal-800 dark:text-teal-200 bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800/80 hover:bg-teal-100 dark:hover:bg-teal-900/40 transition-colors min-h-[44px]"
          >
            <Download className="w-4 h-4 text-teal-600" />
            <span>Exportar respaldo completo (.json)</span>
          </button>

          <button
            type="button"
            onClick={() => backupInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors min-h-[44px]"
          >
            <Upload className="w-4 h-4 text-slate-500" />
            <span>Restaurar respaldo (.json)</span>
          </button>
        </div>

        {/* Cleanup Actions */}
        <div className="flex flex-col sm:flex-row items-center gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            onClick={() => {
              openConfirm({
                title: '¿Liberar audio de consultas listas?',
                description: 'Se borrarán los archivos de audio de todas las consultas que ya fueron transcritas para liberar espacio en disco. Las notas y transcripciones permanecerán intactas.',
                confirmText: 'Liberar audio',
                cancelText: 'Cancelar',
                isDestructive: false,
                onConfirm: () => clearTranscribedAudioAll(),
              });
            }}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors min-h-[44px]"
          >
            Borrar audio de consultas ya transcritas
          </button>

          <button
            onClick={() => {
              openConfirm({
                title: '¿Borrar TODOS los datos locales?',
                description: 'Esta acción eliminará de forma irreversible todas las grabaciones, transcripciones, glosarios y ajustes almacenados en este navegador. Se recomienda exportar un respaldo antes de proceder.',
                confirmText: 'Borrar todo',
                cancelText: 'Cancelar',
                isDestructive: true,
                onConfirm: () => clearAllData(),
              });
            }}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-xs font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 border border-rose-200 dark:border-rose-900/60 transition-colors min-h-[44px]"
          >
            Borrar todos los datos locales
          </button>
        </div>
      </section>

      {/* Section 6: Laboratorio de rendimiento y latencia */}
      <BenchmarkSection />
    </div>
  );
};
