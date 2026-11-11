import React, { useState } from 'react';
import { Activity, Play, Upload, CheckCircle2, RotateCw, FileText } from 'lucide-react';
import { WhisperTranscriptionEngine } from '../core/transcription/engine';
import { TIER_CONFIGS } from '../core/transcription/tierDetector';
import { BenchmarkResult, ModelTier } from '../core/types';

export const BenchmarkView: React.FC = () => {
  const [selectedTier, setSelectedTier] = useState<ModelTier>('balanced');
  const [selectedBackend, setSelectedBackend] = useState<'wasm' | 'webgpu'>('wasm');
  const [referenceText, setReferenceText] = useState('');
  const [audioSamples, setAudioSamples] = useState<Float32Array | null>(null);
  const [audioDurationSec, setAudioDurationSec] = useState(0);
  const [audioFileName, setAudioFileName] = useState('');

  const [isRunning, setIsRunning] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [results, setResults] = useState<BenchmarkResult[]>([]);

  // Generate synthetic test audio (5s speech-range synthetic signal)
  const handleGenerateSyntheticAudio = () => {
    const sampleRate = 16000;
    const duration = 5;
    const totalSamples = sampleRate * duration;
    const samples = new Float32Array(totalSamples);

    // Generate modulated sine waves with harmonic intervals resembling speech formants
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      const f1 = 440;
      const f2 = 880;
      const envelope = Math.sin(Math.PI * 2 * 0.5 * t);
      samples[i] = (Math.sin(2 * Math.PI * f1 * t) * 0.3 + Math.sin(2 * Math.PI * f2 * t) * 0.2) * Math.abs(envelope);
    }

    setAudioSamples(samples);
    setAudioDurationSec(duration);
    setAudioFileName('Audio sintético de prueba (5.0s)');
    setReferenceText('prueba de audio sintética');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setStatusMessage('Decodificando archivo...');
      const arrayBuffer = await file.arrayBuffer();
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const decoded = await audioContext.decodeAudioData(arrayBuffer);

      // Resample to 16kHz
      const targetRate = 16000;
      const duration = decoded.duration;
      const offlineCtx = new OfflineAudioContext(1, Math.ceil(duration * targetRate), targetRate);
      const source = offlineCtx.createBufferSource();
      source.buffer = decoded;
      source.connect(offlineCtx.destination);
      source.start(0);

      const rendered = await offlineCtx.startRendering();
      const pcm = rendered.getChannelData(0);

      setAudioSamples(pcm);
      setAudioDurationSec(duration);
      setAudioFileName(`${file.name} (${Math.round(duration * 10) / 10}s)`);
      setStatusMessage('');
      await audioContext.close();
    } catch (err: any) {
      console.error('Benchmark file decode error:', err);
      setStatusMessage('Error al decodificar audio');
    }
  };

  const runBenchmark = async () => {
    if (!audioSamples) return;

    setIsRunning(true);
    setStatusMessage('Iniciando motor de benchmark...');

    const tierKey = selectedTier === 'auto' || (selectedTier as string) === 'fast' ? 'balanced' : selectedTier;
    const tierConfig = TIER_CONFIGS[tierKey];

    const engine = new WhisperTranscriptionEngine();

    try {
      // 1. Measure load time
      setStatusMessage(`Cargando modelo ${tierConfig.modelId} (${selectedBackend})...`);
      const t0Load = performance.now();
      await engine.load(selectedTier, (p) => {
        if (p.status === 'progress' && typeof p.progress === 'number') {
          setStatusMessage(`Descargando modelo: ${Math.round(p.progress)}%`);
        }
      });
      const t1Load = performance.now();
      const loadTimeMs = Math.round(t1Load - t0Load);

      // 2. Measure transcription time
      setStatusMessage('Transcribiendo audio de prueba...');
      const t0Transcribe = performance.now();
      const result = await engine.transcribe(audioSamples, {
        language: 'es',
        initialPrompt: 'Consulta odontológica de prueba.',
      });
      const t1Transcribe = performance.now();
      const transcribeTimeMs = Math.round(t1Transcribe - t0Transcribe);

      const rtf = Math.round((transcribeTimeMs / (audioDurationSec * 1000)) * 100) / 100;

      // 3. Compute WER if reference text given
      let wer: number | undefined;
      if (referenceText.trim()) {
        wer = computeWer(referenceText.trim(), result.text);
      }

      const res: BenchmarkResult = {
        tier: selectedTier,
        deviceBackend: selectedBackend,
        modelId: tierConfig.modelId,
        loadTimeMs,
        audioDurationSec: Math.round(audioDurationSec * 10) / 10,
        transcriptionTimeMs: transcribeTimeMs,
        realTimeFactor: rtf,
        transcribedText: result.text,
        wordErrorRate: wer,
      };

      setResults((prev) => [res, ...prev]);
      setStatusMessage('Prueba completada');
      await engine.dispose();
    } catch (err: any) {
      console.error('Benchmark execution error:', err);
      setStatusMessage(`Error: ${err.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div>
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/60 px-3 py-1 rounded-full border border-teal-200 dark:border-teal-800/60 mb-2">
          <Activity className="w-3.5 h-3.5" />
          <span>Herramienta de diagnóstico de desarrollo (/benchmark)</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Laboratorio de rendimiento y latencia
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl leading-relaxed">
          Compara el tiempo de carga, Factor de Tiempo Real (RTF), backend (WebGPU vs WASM) y tasa de error (WER) en tu dispositivo actual.
        </p>
      </div>

      {/* Benchmark Setup Form */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800/80 p-6 shadow-xs space-y-6">
        {/* Step 1: Audio Input */}
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            1. Audio para la prueba
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer transition-colors">
              <Upload className="w-4 h-4 text-slate-500" />
              <span>Subir archivo de audio</span>
              <input type="file" accept="audio/*" onChange={handleFileUpload} className="hidden" />
            </label>

            <button
              onClick={handleGenerateSyntheticAudio}
              className="px-4 py-2.5 rounded-xl text-xs font-medium text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/60 hover:bg-teal-100 transition-colors"
            >
              Generar audio sintético (5s)
            </button>

            {audioFileName && (
              <span className="text-xs font-medium text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-950 px-3 py-1.5 rounded-lg border border-teal-200 dark:border-teal-800">
                {audioFileName}
              </span>
            )}
          </div>
        </div>

        {/* Step 2: Reference Text (Optional) */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-900 dark:text-slate-100">
            2. Transcripción de referencia (Opcional, para calcular Word Error Rate)
          </label>
          <input
            type="text"
            value={referenceText}
            onChange={(e) => setReferenceText(e.target.value)}
            placeholder="Pegá aquí el texto exacto esperado para calcular la tasa de error..."
            className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden"
          />
        </div>

        {/* Step 3: Tier and Backend Selection */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              3. Nivel de modelo
            </label>
            <select
              value={selectedTier}
              onChange={(e) => setSelectedTier(e.target.value as ModelTier)}
              className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
            >
              <option value="balanced">Alta precisión clínica (whisper-small)</option>
              <option value="max">Máxima resolución (whisper-large-v3-turbo)</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              4. Backend de cómputo
            </label>
            <select
              value={selectedBackend}
              onChange={(e) => setSelectedBackend(e.target.value as any)}
              className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100"
            >
              <option value="wasm">WASM (Multi-thread CPU)</option>
              <option value="webgpu">WebGPU (Aceleración gráfica)</option>
            </select>
          </div>
        </div>

        {/* Run Button */}
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-slate-500 font-medium">{statusMessage}</span>
          <button
            onClick={runBenchmark}
            disabled={!audioSamples || isRunning}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs transition-colors"
          >
            {isRunning ? <RotateCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
            <span>{isRunning ? 'Ejecutando...' : 'Iniciar benchmark'}</span>
          </button>
        </div>
      </div>

      {/* Benchmark Results Table */}
      {results.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800/80 p-6 shadow-xs space-y-4">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Resultados comparativos
          </h2>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400">
                  <th className="pb-3 font-medium">Nivel</th>
                  <th className="pb-3 font-medium">Backend</th>
                  <th className="pb-3 font-medium">Carga (ms)</th>
                  <th className="pb-3 font-medium">Transcripción</th>
                  <th className="pb-3 font-medium">RTF (Real-Time Factor)</th>
                  <th className="pb-3 font-medium">WER</th>
                  <th className="pb-3 font-medium">Texto transcrito</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {results.map((res, i) => (
                  <tr key={i} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="py-3 font-semibold text-slate-900 dark:text-slate-100">{res.tier}</td>
                    <td className="py-3 font-mono">{res.deviceBackend}</td>
                    <td className="py-3 font-mono tabular-nums">{res.loadTimeMs} ms</td>
                    <td className="py-3 font-mono tabular-nums">{res.transcriptionTimeMs} ms</td>
                    <td className="py-3 font-mono tabular-nums font-semibold text-teal-600">
                      {res.realTimeFactor}x
                    </td>
                    <td className="py-3 font-mono tabular-nums">
                      {res.wordErrorRate !== undefined ? `${res.wordErrorRate}%` : 'N/A'}
                    </td>
                    <td className="py-3 text-slate-700 dark:text-slate-300 max-w-xs truncate">
                      {res.transcribedText || '(Vacío)'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// Word Error Rate calculation (Levenshtein distance over word tokens)
function computeWer(ref: string, hyp: string): number {
  const refWords = ref.toLowerCase().replace(/[.,!?:;¡¿"'-]/g, '').split(/\s+/).filter(Boolean);
  const hypWords = hyp.toLowerCase().replace(/[.,!?:;¡¿"'-]/g, '').split(/\s+/).filter(Boolean);

  if (refWords.length === 0) return 0;

  const dp: number[][] = Array(refWords.length + 1)
    .fill(null)
    .map(() => Array(hypWords.length + 1).fill(0));

  for (let i = 0; i <= refWords.length; i++) dp[i][0] = i;
  for (let j = 0; j <= hypWords.length; j++) dp[0][j] = j;

  for (let i = 1; i <= refWords.length; i++) {
    for (let j = 1; j <= hypWords.length; j++) {
      if (refWords[i - 1] === hypWords[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,     // deletion
          dp[i][j - 1] + 1,     // insertion
          dp[i - 1][j - 1] + 1  // substitution
        );
      }
    }
  }

  const distance = dp[refWords.length][hypWords.length];
  return Math.round((distance / refWords.length) * 100);
}
