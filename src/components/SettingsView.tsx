import React, { useEffect, useState, useRef } from 'react';
import {
  Cpu,
  Mic,
  Shield,
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
  Volume2,
} from 'lucide-react';
import { detectHardwareCapabilities, HardwareCapabilities } from '../core/transcription/tierDetector';
import { ModelTier } from '../core/types';
import { useAppStore } from '../store/useAppStore';

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
  } = useAppStore();

  const [hardware, setHardware] = useState<HardwareCapabilities | null>(null);
  const [newIncorrect, setNewIncorrect] = useState('');
  const [newCorrect, setNewCorrect] = useState('');
  const [isAddingGlossary, setIsAddingGlossary] = useState(false);

  // Audio Device Enumeration & Mic Level Test
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [isTestingMic, setIsTestingMic] = useState(false);
  const [testVuLevel, setTestVuLevel] = useState(0);

  const testStreamRef = useRef<MediaStream | null>(null);
  const testContextRef = useRef<AudioContext | null>(null);
  const testAnimFrameRef = useRef<number | null>(null);

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
      // Trigger a brief permission request to expose device labels if browser has them hidden
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
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
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

  const usedMb = Math.round(storageUsage.usedBytes / (1024 * 1024));
  const totalMb = Math.round(storageUsage.quotaBytes / (1024 * 1024));

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Ajustes del sistema
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Configuración local del motor de transcripción, vocabulario odontológico y almacenamiento.
        </p>
      </div>

      {/* Section 1: Transcription Model Tier */}
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
              Selecciona el tamaño del modelo según la capacidad de tu teléfono o computadora.
            </p>
          </div>
        </div>

        {/* Hardware Detection Badge */}
        {hardware && (
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
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          {[
            {
              id: 'auto',
              label: 'Automático (whisper-small)',
              desc: 'Configura el modelo de alta precisión clínica (whisper-small) con aceleración WebGPU o CPU multihilo.',
            },
            {
              id: 'balanced',
              label: 'Alta precisión clínica (whisper-small)',
              desc: 'Modelo estándar recomendado (~140 MB). 244 millones de parámetros para captar terminología técnica con exactitud.',
            },
            {
              id: 'max',
              label: 'Máxima resolución (whisper-large-v3-turbo)',
              desc: 'Modelo de 800M parámetros (~350 MB) para la máxima fidelidad acústica. Requiere computadora potente con WebGPU.',
            },
          ].map((tier) => {
            const isSelected = (settings?.modelTier || 'auto') === tier.id;
            return (
              <button
                key={tier.id}
                onClick={() => handleTierChange(tier.id as ModelTier)}
                className={`p-4 rounded-2xl text-left border transition-all ${
                  isSelected
                    ? 'border-teal-600 bg-teal-50/50 dark:bg-teal-950/30 ring-1 ring-teal-600'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {tier.label}
                  </span>
                  {isSelected && <Check className="w-4 h-4 text-teal-600" />}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                  {tier.desc}
                </p>
              </button>
            );
          })}
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
          {/* Audio Input Device Selector */}
          <div className="pt-2 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <span>Dispositivo de micrófono de entrada</span>
                  {settings?.selectedAudioDeviceId && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-teal-100 dark:bg-teal-900/50 text-teal-800 dark:text-teal-200 font-medium">
                      Personalizado
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Elige qué micrófono utilizar (auriculares Bluetooth, micrófono de escritorio o micrófono integrado).
                </p>
              </div>

              {/* Refresh devices button */}
              <button
                type="button"
                onClick={handleRefreshDevices}
                className="self-start sm:self-auto px-2.5 py-1 text-[11px] font-medium rounded-lg text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center gap-1.5 transition-colors"
                title="Actualizar lista de micrófonos conectados"
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
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:border-teal-500 font-medium"
                >
                  <option value="">Predeterminado del sistema / navegador</option>
                  {audioDevices.map((dev, idx) => (
                    <option key={dev.deviceId || idx} value={dev.deviceId}>
                      {dev.label || `Micrófono ${idx + 1}`}
                    </option>
                  ))}
                </select>
              </div>

              {/* Quick mic test button & vu meter */}
              <div>
                <button
                  type="button"
                  onClick={toggleMicTest}
                  className={`w-full px-3 py-2 text-xs font-semibold rounded-xl border transition-colors flex items-center justify-center gap-2 ${
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

            {/* Live VU meter when testing */}
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
                Desactivada por defecto. En odontología se recomienda desactivada para evitar que los algoritmos de cancelación corten frecuencias de consonantes o voces suaves.
              </p>
            </div>
            <button
              onClick={() => updateSettings({ noiseSuppression: !settings?.noiseSuppression })}
              className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors shrink-0 ${
                settings?.noiseSuppression ? 'bg-teal-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}
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
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Transcripción progresiva en segundo plano
                </span>
                <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 rounded-md">
                  Recomendado
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 max-w-lg leading-relaxed">
                Transcribe los bloques de audio cada 30 segundos mientras la consulta continúa. Al finalizar la grabación, el 95% a 100% del texto ya está listo de inmediato sin tiempos de espera.
              </p>
            </div>
            <button
              onClick={() => updateSettings({ progressiveTranscription: !(settings?.progressiveTranscription ?? true) })}
              className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors shrink-0 ${
                (settings?.progressiveTranscription ?? true) ? 'bg-teal-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}
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
                Muestra la confirmación ética/legal de consentimiento antes de cada nueva consulta.
              </p>
            </div>
            <button
              onClick={() => updateSettings({ requireConsent: !settings?.requireConsent })}
              className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors shrink-0 ${
                settings?.requireConsent ? 'bg-teal-600' : 'bg-slate-300 dark:bg-slate-700'
              }`}
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

      {/* Section 3: Dental Glossary */}
      <section className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800/80 p-6 shadow-xs space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-teal-50 dark:bg-teal-950/60 flex items-center justify-center text-teal-600 dark:text-teal-400">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Glosario odontológico post-proceso
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Corrige automáticamente palabras que Whisper suele interpretar mal.
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsAddingGlossary(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950 hover:bg-teal-100 dark:hover:bg-teal-900/60 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Agregar término</span>
          </button>
        </div>

        {/* Add Term Form */}
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

        {/* Glossary Table */}
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
                className="p-1 text-slate-400 hover:text-rose-600 transition-colors"
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
            El modo claro utiliza una paleta cálida antifatiga visual (lino y porcelana suave), eliminando el blanco deslumbrante bajo la luz del consultorio.
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
                onClick={() => updateSettings({ theme: item.id as any })}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-2xl text-xs font-semibold border transition-all ${
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

      {/* Section 5: Local Storage & Maintenance */}
      <section className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800/80 p-6 shadow-xs space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-teal-50 dark:bg-teal-950/60 flex items-center justify-center text-teal-600 dark:text-teal-400">
            <HardDrive className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Almacenamiento e higiene de datos
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Espacio utilizado por audios y textos en este navegador.
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

        <div className="flex flex-col sm:flex-row items-center gap-3 pt-1">
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
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            Borrar audio de consultas ya transcritas
          </button>

          <button
            onClick={() => {
              openConfirm({
                title: '¿Borrar TODOS los datos locales?',
                description: 'Esta acción eliminará de forma irreversible todas las grabaciones, transcripciones, glosarios y ajustes almacenados en este navegador. Se recomienda exportar tus consultas antes de proceder.',
                confirmText: 'Borrar todo',
                cancelText: 'Cancelar',
                isDestructive: true,
                onConfirm: () => clearAllData(),
              });
            }}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-xs font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 border border-rose-200 dark:border-rose-900/60 transition-colors"
          >
            Borrar todos los datos locales
          </button>
        </div>
      </section>
    </div>
  );
};
