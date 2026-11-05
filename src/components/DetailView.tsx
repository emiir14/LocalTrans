import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  Download,
  Copy,
  Check,
  Search,
  Clock,
  Edit2,
  Trash2,
  AlertTriangle,
  RotateCw,
  HardDrive,
  FileText,
  Volume2,
  ShieldCheck,
  Terminal,
  ChevronDown,
  ChevronUp,
  Cpu,
  Radio,
} from 'lucide-react';
import { ExportFormatter, formatTimeDisplay } from '../core/export/formatter';
import { TranscriptSegment } from '../core/types';
import { audioStore, useAppStore } from '../store/useAppStore';

function formatRemainingTime(seconds: number): string {
  if (seconds <= 0) return 'Calculando...';
  if (seconds < 60) return `~${seconds} s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `~${mins} min ${secs} s` : `~${mins} min`;
}

export const DetailView: React.FC = () => {
  const {
    activeSession,
    activeTranscript,
    setView,
    startTranscription,
    cancelTranscription,
    transcribingSessionId,
    transcriptionProgress,
    transcriptionFallbackNotice,
    updateSegmentText,
    deleteAudioForSession,
    showToast,
  } = useAppStore();

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalAudioDuration, setTotalAudioDuration] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const [showTimestamps, setShowTimestamps] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showLiveLogs, setShowLiveLogs] = useState(false);
  const [transcriptSearch, setTranscriptSearch] = useState('');
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [copiedType, setCopiedType] = useState<string | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const transcriptBottomRef = useRef<HTMLDivElement | null>(null);
  const isTranscribingThisSession = transcribingSessionId === activeSession?.id;

  // Auto-scroll to latest segment as new chunks stream in
  useEffect(() => {
    if (isTranscribingThisSession && autoScroll && transcriptBottomRef.current) {
      transcriptBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeTranscript.length, isTranscribingThisSession, autoScroll]);

  // Load and assemble audio for playback if not deleted
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    async function loadAudio() {
      if (!activeSession || activeSession.audioDeleted) {
        setAudioUrl(null);
        return;
      }

      try {
        const floatPcm = await audioStore.getCombinedPcmFloat32(activeSession.id);
        if (cancelled || floatPcm.length === 0) return;

        // Convert 16kHz Float32 PCM into a playable WAV Blob
        const wavBlob = createWavBlobFromPcm(floatPcm, 16000);
        objectUrl = URL.createObjectURL(wavBlob);
        setAudioUrl(objectUrl);
        setTotalAudioDuration(floatPcm.length / 16000);
      } catch (err) {
        console.error('Error preparing audio playback:', err);
      }
    }

    loadAudio();

    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [activeSession?.id, activeSession?.audioDeleted]);

  if (!activeSession) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center">
        <p className="text-slate-500">Sesión no encontrada</p>
        <button onClick={() => setView('home')} className="mt-4 text-teal-600 font-medium">
          Volver a grabaciones
        </button>
      </div>
    );
  }

  const handleAudioTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleTogglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const seekTo = (seconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = seconds;
      setCurrentTime(seconds);
      if (!isPlaying) {
        audioRef.current.play();
        setIsPlaying(true);
      }
    }
  };

  // Find active segment matching audio playback
  const activeSegmentIndex = activeTranscript.findIndex(
    (s) => currentTime >= s.start && currentTime <= s.end
  );

  // Filter segments by search
  const filteredSegments = activeTranscript.filter((s) => {
    if (!transcriptSearch.trim()) return true;
    return s.text.toLowerCase().includes(transcriptSearch.toLowerCase());
  });

  // Export handlers
  const handleCopyText = () => {
    const txt = ExportFormatter.toTxt(activeSession, activeTranscript);
    navigator.clipboard.writeText(txt);
    setCopiedType('txt');
    showToast('Texto copiado al portapapeles', 'success');
    setTimeout(() => setCopiedType(null), 2500);
  };

  const handleCopyForAi = () => {
    const aiText = ExportFormatter.toAiContext(activeSession, activeTranscript);
    navigator.clipboard.writeText(aiText);
    setCopiedType('ai');
    showToast('Texto clínico formateado para IA copiado', 'success');
    setTimeout(() => setCopiedType(null), 2500);
  };

  const handleDownload = (format: 'txt' | 'md' | 'srt' | 'json') => {
    let content = '';
    let ext = format;
    let mime = 'text/plain';

    if (format === 'txt') {
      content = ExportFormatter.toTxt(activeSession, activeTranscript);
      mime = 'text/plain';
    } else if (format === 'md') {
      content = ExportFormatter.toMd(activeSession, activeTranscript);
      mime = 'text/markdown';
    } else if (format === 'srt') {
      content = ExportFormatter.toSrt(activeTranscript);
      mime = 'text/plain';
    } else if (format === 'json') {
      content = ExportFormatter.toJson(activeSession, activeTranscript);
      mime = 'application/json';
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `consulta_${activeSession.reference || activeSession.id}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  };

  const startEdit = (segment: TranscriptSegment) => {
    setEditingSegmentId(segment.id);
    setEditingText(segment.text);
  };

  const saveEdit = async (segmentId: string) => {
    await updateSegmentText(segmentId, editingText.trim());
    setEditingSegmentId(null);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Hidden Audio Player Element */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onTimeUpdate={handleAudioTimeUpdate}
          onEnded={() => setIsPlaying(false)}
        />
      )}

      {/* Top Navigation & Session Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/80 dark:border-slate-800/80">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setView('home')}
            className="p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            title="Volver a la lista de grabaciones"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              {activeSession.reference ? activeSession.reference : activeSession.title}
            </h1>
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              <span>{new Date(activeSession.createdAt).toLocaleDateString('es-AR')}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{formatTimeDisplay(activeSession.durationSec)}</span>
              {activeSession.modelTierUsed && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Modelo: {activeSession.modelTierUsed}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Top Actions */}
        <div className="flex items-center gap-2.5">
          {/* Copy For AI Button */}
          {activeTranscript.length > 0 && (
            <button
              onClick={handleCopyForAi}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-200 border border-teal-200 dark:border-teal-800/80 hover:bg-teal-100 dark:hover:bg-teal-900/40 transition-colors whitespace-nowrap min-h-[40px]"
              title="Copia el texto limpio con encabezado clínico estructurado para enviar a tu IA"
            >
              {copiedType === 'ai' ? <Check className="w-3.5 h-3.5 text-teal-600" /> : <Sparkles className="w-3.5 h-3.5 text-teal-600" />}
              <span>Copiar para IA</span>
            </button>
          )}

          {/* Export Dropdown */}
          {activeTranscript.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors min-h-[40px]"
              >
                <Download className="w-3.5 h-3.5 text-slate-500" />
                <span>Exportar</span>
              </button>

              {showExportMenu && (
                <div className="absolute right-0 mt-2 w-56 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl p-1.5 z-40 space-y-0.5 animate-fade-in">
                  <button
                    onClick={handleCopyText}
                    className="w-full text-left px-3 py-2 text-xs rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between"
                  >
                    <span>Copiar texto plano</span>
                    <Copy className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                  <button
                    onClick={() => handleDownload('txt')}
                    className="w-full text-left px-3 py-2 text-xs rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between"
                  >
                    <span>Descargar .txt</span>
                    <FileText className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                  <button
                    onClick={() => handleDownload('md')}
                    className="w-full text-left px-3 py-2 text-xs rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between"
                  >
                    <span>Descargar Markdown (.md)</span>
                    <FileText className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                  <button
                    onClick={() => handleDownload('srt')}
                    className="w-full text-left px-3 py-2 text-xs rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between"
                  >
                    <span>Descargar Subtítulos (.srt)</span>
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                  <button
                    onClick={() => handleDownload('json')}
                    className="w-full text-left px-3 py-2 text-xs rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between"
                  >
                    <span>Descargar Datos (.json)</span>
                    <FileText className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Fallback Notice for WebGPU to WASM degradation */}
      {transcriptionFallbackNotice && (
        <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span>{transcriptionFallbackNotice}</span>
        </div>
      )}

      {/* Main 2-Column Responsive Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Audio Player & Action Controls (4 cols on lg) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Synchronized Audio Player Card */}
          {!activeSession.audioDeleted && audioUrl ? (
            <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-xs space-y-4">
              <div className="flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300">
                <span className="flex items-center gap-1.5">
                  <Volume2 className="w-4 h-4 text-teal-600" />
                  <span>Reproductor de consulta</span>
                </span>
                <span className="font-mono tabular-nums text-slate-500">
                  {formatTimeDisplay(currentTime)} / {formatTimeDisplay(totalAudioDuration)}
                </span>
              </div>

              {/* Progress Scrubber */}
              <input
                type="range"
                min="0"
                max={totalAudioDuration || 1}
                step="0.1"
                value={currentTime}
                onChange={(e) => seekTo(parseFloat(e.target.value))}
                className="w-full accent-teal-600 cursor-pointer"
              />

              {/* Playback Controls */}
              <div className="flex items-center justify-center gap-4 pt-1">
                <button
                  onClick={() => seekTo(Math.max(0, currentTime - 5))}
                  className="p-2.5 rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 min-h-[44px] min-w-[44px] flex items-center justify-center"
                  title="Retroceder 5 segundos"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>

                <button
                  onClick={handleTogglePlay}
                  className="w-12 h-12 rounded-full bg-teal-600 hover:bg-teal-700 text-white flex items-center justify-center shadow-md shadow-teal-600/20 active:scale-95 transition-all min-h-[48px] min-w-[48px]"
                >
                  {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
                </button>
              </div>

              <p className="text-[11px] text-center text-slate-400 dark:text-slate-500">
                Al tocar cualquier fragmento de la transcripción, el audio saltará a ese momento.
              </p>
            </div>
          ) : activeSession.audioDeleted ? (
            <div className="p-5 rounded-3xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800/80 text-center space-y-2">
              <HardDrive className="w-6 h-6 mx-auto text-slate-400" />
              <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                Audio liberado para ahorrar memoria
              </p>
              <p className="text-[11px] text-slate-400">
                La transcripción se conserva intacta en tu base de datos local.
              </p>
            </div>
          ) : null}

          {/* Transcription CTA or Progress Bar Card */}
          {activeSession.status !== 'completed' || isTranscribingThisSession ? (
            <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-teal-200/90 dark:border-teal-900/60 shadow-md shadow-teal-500/5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-teal-50 dark:bg-teal-950/60 flex items-center justify-center text-teal-600 dark:text-teal-400">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      {isTranscribingThisSession ? (
                        <>
                          <span className="relative flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-teal-500"></span>
                          </span>
                          <span>Transcribiendo en vivo</span>
                        </>
                      ) : activeTranscript.length > 0 ? (
                        'Transcripción pausada'
                      ) : (
                        'Transcripción pendiente'
                      )}
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {isTranscribingThisSession
                        ? 'Motor Whisper 100% en tu equipo'
                        : activeTranscript.length > 0
                        ? `${activeTranscript.length} fragmentos ya guardados`
                        : 'Audio listo para convertir a texto'}
                    </p>
                  </div>
                </div>

                {/* Engine Hardware Badge */}
                {isTranscribingThisSession && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center gap-1">
                    <Cpu className="w-3 h-3 text-teal-600" />
                    {transcriptionProgress?.activeBackend ? transcriptionProgress.activeBackend.toUpperCase() : 'LOCAL'}
                  </span>
                )}
              </div>

              {isTranscribingThisSession ? (
                <div className="space-y-3.5 pt-1">
                  {/* Progress Info Header */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        Segmento {transcriptionProgress?.currentSegment || 1} de {transcriptionProgress?.totalSegments || 1}
                      </span>
                      <span className="font-mono tabular-nums font-bold text-teal-600 dark:text-teal-400 text-sm">
                        {transcriptionProgress?.percent || 0}%
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="h-2.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-linear-to-r from-teal-500 to-teal-600 rounded-full transition-all duration-300"
                        style={{ width: `${Math.max(3, transcriptionProgress?.percent || 0)}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                      <span>{transcriptionProgress?.currentSegmentTime ? `Intervalo: ${transcriptionProgress.currentSegmentTime}` : 'Analizando voz...'}</span>
                      <span>Restan: {formatRemainingTime(transcriptionProgress?.estimatedRemainingSec || 0)}</span>
                    </div>
                  </div>

                  {/* Audio computation pulse visualizer */}
                  <div className="flex items-center justify-center gap-1 py-1.5 px-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl">
                    <div className="w-1 bg-teal-500 rounded-full animate-bounce h-3" style={{ animationDelay: '0ms' }} />
                    <div className="w-1 bg-teal-500 rounded-full animate-bounce h-5" style={{ animationDelay: '150ms' }} />
                    <div className="w-1 bg-teal-500 rounded-full animate-bounce h-2" style={{ animationDelay: '300ms' }} />
                    <div className="w-1 bg-teal-500 rounded-full animate-bounce h-6" style={{ animationDelay: '100ms' }} />
                    <div className="w-1 bg-teal-500 rounded-full animate-bounce h-4" style={{ animationDelay: '250ms' }} />
                    <div className="w-1 bg-teal-500 rounded-full animate-bounce h-3" style={{ animationDelay: '350ms' }} />
                    <span className="ml-2 text-[11px] text-slate-600 dark:text-slate-300 font-medium truncate">
                      {transcriptionProgress?.statusText || 'Procesando modelo Whisper...'}
                    </span>
                  </div>

                  {/* Real-time Last Detected Phrase Preview Box */}
                  {transcriptionProgress?.lastTranscribedText && (
                    <div className="p-3 rounded-2xl bg-teal-50/70 dark:bg-teal-950/40 border border-teal-200/70 dark:border-teal-800/60 space-y-1">
                      <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wide uppercase text-teal-700 dark:text-teal-300">
                        <Radio className="w-3 h-3 text-teal-600 animate-pulse" />
                        <span>Última frase detectada:</span>
                      </div>
                      <p className="text-xs text-slate-800 dark:text-slate-100 font-medium italic leading-relaxed line-clamp-3">
                        "{transcriptionProgress.lastTranscribedText}"
                      </p>
                    </div>
                  )}

                  {/* Browser reload protection & resumability notice */}
                  <div className="p-3 rounded-2xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-900/40 text-[11px] text-amber-900 dark:text-amber-200 space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                      <span>Protección contra recargas activa</span>
                    </div>
                    <p className="text-[10.5px] leading-relaxed text-amber-800/90 dark:text-amber-300/90">
                      Si intentas recargar o cerrar la pestaña, el navegador te pedirá confirmación. No perderás lo transcrito: cada fragmento ya está guardado en tu memoria local y podrás reanudarlo cuando quieras.
                    </p>
                  </div>

                  {/* Collapsible Activity Logs Drawer */}
                  <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setShowLiveLogs(!showLiveLogs)}
                      className="w-full px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-between transition-colors"
                    >
                      <span className="flex items-center gap-1.5">
                        <Terminal className="w-3.5 h-3.5 text-slate-500" />
                        <span>Registro de actividad en vivo</span>
                      </span>
                      {showLiveLogs ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                    {showLiveLogs && (
                      <div className="p-2.5 bg-slate-900 text-slate-200 font-mono text-[10px] space-y-1 max-h-36 overflow-y-auto">
                        {transcriptionProgress?.logs && transcriptionProgress.logs.length > 0 ? (
                          transcriptionProgress.logs.map((log, lIdx) => (
                            <div key={lIdx} className="leading-tight text-teal-400">
                              <span className="text-slate-500 mr-1.5">›</span>
                              {log}
                            </div>
                          ))
                        ) : (
                          <div className="text-slate-500 italic">Iniciando registro de eventos...</div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Stop transcription safely */}
                  <button
                    onClick={() => cancelTranscription()}
                    className="w-full py-2.5 px-4 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                  >
                    Detener transcripción (guarda progreso actual)
                  </button>
                </div>
              ) : (
                <div className="space-y-4 pt-2">
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    Whisper segmentará el audio, filtrará silencios y corregirá términos odontológicos automáticamente con tu glosario.
                  </p>
                  <button
                    onClick={() => startTranscription(activeSession.id)}
                    className="w-full py-3.5 px-4 rounded-2xl text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 shadow-md shadow-teal-600/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2 min-h-[48px]"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>{activeTranscript.length > 0 ? 'Reanudar transcripción' : 'Iniciar transcripción local'}</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            // Completed Session Audio Cleanup Card
            !activeSession.audioDeleted && (
              <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-xs space-y-3">
                <div className="flex items-center gap-2.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
                  <HardDrive className="w-4 h-4 text-slate-500" />
                  <span>Liberar almacenamiento</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Ya tenés la transcripción completa guardada. Podés borrar el audio original para recuperar espacio en tu disco.
                </p>
                <button
                  onClick={() => {
                    if (window.confirm('¿Segura que querés borrar el audio de esta consulta? El texto de la transcripción se conservará.')) {
                      deleteAudioForSession(activeSession.id);
                    }
                  }}
                  className="w-full py-2.5 px-3 rounded-xl text-xs font-medium text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/40 border border-rose-200 dark:border-rose-900/60 transition-colors flex items-center justify-center gap-2 min-h-[40px]"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Borrar solo el archivo de audio</span>
                </button>
              </div>
            )
          )}
        </div>

        {/* Right Column: Transcript Content & Live Search (7 cols on lg) */}
        <div className="lg:col-span-7 space-y-4">
          {/* Transcript Control Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 shadow-xs">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={transcriptSearch}
                onChange={(e) => setTranscriptSearch(e.target.value)}
                placeholder="Buscar en el texto de la consulta..."
                className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-transparent focus:border-teal-500 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden"
              />
            </div>

            <div className="flex items-center gap-2">
              {/* Auto Scroll toggle during transcription */}
              {isTranscribingThisSession && (
                <button
                  type="button"
                  onClick={() => setAutoScroll(!autoScroll)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                    autoScroll
                      ? 'bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800/60'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                  title="Desplaza la vista automáticamente a medida que llegan nuevas frases"
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${autoScroll ? 'bg-teal-500 animate-ping' : 'bg-slate-400'}`} />
                  <span>Auto-scroll</span>
                </button>
              )}

              {/* Toggle Timestamps */}
              <button
                onClick={() => setShowTimestamps(!showTimestamps)}
                className="px-3 py-1.5 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 transition-colors flex items-center gap-1.5"
              >
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span>{showTimestamps ? 'Ocultar tiempos' : 'Ver tiempos'}</span>
              </button>
            </div>
          </div>

          {/* Transcript Segments List */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800/80 shadow-xs p-6 space-y-4 min-h-[420px]">
            {filteredSegments.length > 0 ? (
              <>
                {filteredSegments.map((segment, idx) => {
                  const isActive = idx === activeSegmentIndex;
                  const isEditing = editingSegmentId === segment.id;
                  const isLatestStreaming = isTranscribingThisSession && idx === filteredSegments.length - 1;

                  return (
                    <div
                      key={segment.id}
                      onClick={() => !isEditing && seekTo(segment.start)}
                      className={`p-3.5 rounded-2xl transition-all cursor-pointer group ${
                        isActive
                          ? 'bg-teal-50/80 dark:bg-teal-950/40 ring-1 ring-teal-500/40'
                          : isLatestStreaming
                          ? 'bg-teal-50/40 dark:bg-teal-950/20 ring-1 ring-teal-400/40'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        {/* Timestamp & Speaker Tag */}
                        <div className="flex items-center gap-2 text-xs font-mono tabular-nums text-slate-400 dark:text-slate-500">
                          {showTimestamps && (
                            <span>
                              {formatTimeDisplay(segment.start)} - {formatTimeDisplay(segment.end)}
                            </span>
                          )}
                          {segment.speaker && (
                            <span className="font-semibold text-teal-700 dark:text-teal-400">
                              {segment.speaker}
                            </span>
                          )}
                          {segment.edited && (
                            <span className="text-[10px] text-slate-400">(editado)</span>
                          )}
                          {isLatestStreaming && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-sans font-medium bg-teal-100 dark:bg-teal-900/60 text-teal-800 dark:text-teal-300">
                              <span className="w-1 h-1 rounded-full bg-teal-500 animate-pulse" />
                              Reciente
                            </span>
                          )}
                        </div>

                        {/* Edit Button */}
                        {!isEditing && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              startEdit(segment);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-opacity"
                            title="Editar segmento"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Segment Text or Edit Input */}
                      {isEditing ? (
                        <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                          <textarea
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            className="w-full p-2.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-teal-500 text-slate-900 dark:text-slate-100 focus:outline-hidden"
                            rows={2}
                          />
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => setEditingSegmentId(null)}
                              className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-800"
                            >
                              Cancelar
                            </button>
                            <button
                              onClick={() => saveEdit(segment.id)}
                              className="px-3 py-1 text-xs font-semibold rounded-lg bg-teal-600 text-white hover:bg-teal-700"
                            >
                              Guardar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-1 text-xs sm:text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
                          {highlightSearchTerm(segment.text, transcriptSearch)}
                        </p>
                      )}
                    </div>
                  );
                })}

                {/* Real-time next chunk in-progress placeholder */}
                {isTranscribingThisSession && (
                  <div className="p-4 rounded-2xl border border-dashed border-teal-300 dark:border-teal-700 bg-teal-50/50 dark:bg-teal-950/20 flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-teal-100 dark:bg-teal-900 flex items-center justify-center shrink-0">
                      <RotateCw className="w-3.5 h-3.5 text-teal-600 animate-spin" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-teal-900 dark:text-teal-200">
                          Procesando siguiente bloque de voz...
                        </span>
                        {transcriptionProgress?.currentSegmentTime && (
                          <span className="text-[10px] font-mono text-teal-700 dark:text-teal-400">
                            ({transcriptionProgress.currentSegmentTime})
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {transcriptionProgress?.lastTranscribedText
                          ? `Último texto: "${transcriptionProgress.lastTranscribedText}"`
                          : 'Whisper analizando fragmento acústico...'}
                      </p>
                    </div>
                  </div>
                )}
                <div ref={transcriptBottomRef} />
              </>
            ) : isTranscribingThisSession ? (
              <div className="py-16 px-4 text-center space-y-4">
                <div className="relative inline-flex items-center justify-center">
                  <div className="w-16 h-16 rounded-full bg-teal-100 dark:bg-teal-950/70 flex items-center justify-center text-teal-600 animate-pulse">
                    <RotateCw className="w-7 h-7 animate-spin" />
                  </div>
                </div>
                <div className="max-w-md mx-auto space-y-1.5">
                  <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Iniciando transcripción en tiempo real...
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Whisper está analizando el primer fragmento de voz. En cuanto termine, aparecerá aquí inmediatamente y continuará con los siguientes.
                  </p>
                </div>
                {transcriptionProgress && (
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-mono text-slate-600 dark:text-slate-300">
                    <Radio className="w-3 h-3 text-teal-600 animate-pulse" />
                    <span>{transcriptionProgress.statusText}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="py-20 text-center space-y-2">
                <FileText className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-700" />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {transcriptSearch
                    ? 'No se encontraron coincidencias para la búsqueda.'
                    : 'Esta consulta todavía no ha sido transcrita.'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// Search highlighter utility
function highlightSearchTerm(text: string, search: string) {
  if (!search.trim()) return text;
  const parts = text.split(new RegExp(`(${search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === search.toLowerCase() ? (
      <mark key={i} className="bg-amber-200 dark:bg-amber-900/60 text-slate-900 dark:text-slate-100 px-0.5 rounded">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

// Convert PCM Float32Array to 16kHz WAV Blob in memory for browser audio playback
function createWavBlobFromPcm(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFF header
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  // fmt chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // Byte rate
  view.setUint16(32, 2, true); // Block align
  view.setUint16(34, 16, true); // Bits per sample
  // data chunk
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  // Write PCM Int16 samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}
