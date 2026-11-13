import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  Sun,
  Mic,
  Printer,
  ClipboardList,
  UserCheck,
  RefreshCw,
} from 'lucide-react';
import {
  buildDraftClinicalNote,
  CLINICAL_TEMPLATES,
  extractFdiTeeth,
  formatClinicalNoteText,
} from '../core/clinical/clinicalTemplates';
import { ExportFormatter, formatTimeDisplay } from '../core/export/formatter';
import { ClinicalNote, ClinicalTemplateId, TranscriptSegment } from '../core/types';
import { audioStore, useAppStore } from '../store/useAppStore';

const SPEAKER_CYCLE: Array<string | undefined> = [
  undefined,
  'Odontólogo',
  'Paciente',
  'Asistente',
];

const PLAYBACK_SPEEDS = [1, 1.25, 1.5, 2] as const;

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
    appendRecordingToSession,
    updateSessionMeta,
    saveClinicalNote,
    transcribingSessionId,
    transcriptionProgress,
    transcriptionFallbackNotice,
    updateSegmentText,
    updateSegmentSpeaker,
    deleteSession,
    deleteAudioForSession,
    openConfirm,
    showToast,
    wakeLockActive,
  } = useAppStore();

  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalAudioDuration, setTotalAudioDuration] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const [rightTab, setRightTab] = useState<'transcript' | 'clinical_note'>('transcript');
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [highlightFdi, setHighlightFdi] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showLiveLogs, setShowLiveLogs] = useState(false);
  const [transcriptSearch, setTranscriptSearch] = useState('');
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [copiedType, setCopiedType] = useState<string | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);

  // Inline Session Title / Reference editor
  const [isEditingMeta, setIsEditingMeta] = useState(false);
  const [metaRefInput, setMetaRefInput] = useState('');
  const [metaTitleInput, setMetaTitleInput] = useState('');

  // Local Clinical Note state
  const [noteDraft, setNoteDraft] = useState<ClinicalNote>({
    templateId: 'general',
    detectedTeeth: [],
    chiefComplaint: '',
    findings: '',
    procedure: '',
    indications: '',
    nextVisit: '',
    updatedAt: Date.now(),
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const transcriptBottomRef = useRef<HTMLDivElement | null>(null);
  const isTranscribingThisSession = transcribingSessionId === activeSession?.id;

  // Sync ClinicalNote draft when switching session or saving
  useEffect(() => {
    if (!activeSession) return;
    if (activeSession.clinicalNote) {
      setNoteDraft(activeSession.clinicalNote);
    } else if (activeTranscript.length > 0) {
      setNoteDraft(buildDraftClinicalNote(activeTranscript, 'general'));
    } else {
      setNoteDraft({
        templateId: 'general',
        detectedTeeth: [],
        chiefComplaint: '',
        findings: '',
        procedure: '',
        indications: '',
        nextVisit: '',
        updatedAt: Date.now(),
      });
    }
  }, [activeSession?.id, activeSession?.clinicalNote]);

  // Extract FDI teeth detected across full transcript
  const detectedFdiTeeth = useMemo(() => {
    const joined = activeTranscript.map((s) => s.text).join(' ');
    return extractFdiTeeth(joined);
  }, [activeTranscript]);

  // Auto-scroll to latest segment as new chunks stream in
  useEffect(() => {
    if (isTranscribingThisSession && autoScroll && transcriptBottomRef.current) {
      transcriptBottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [activeTranscript.length, isTranscribingThisSession, autoScroll]);

  // Low-RAM audio playback loading using direct WAV Blob concatenation over Int16 chunks
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    async function loadAudio() {
      if (!activeSession || activeSession.audioDeleted) {
        setAudioUrl(null);
        setTotalAudioDuration(0);
        return;
      }

      try {
        const { blob, durationSec } = await audioStore.createWavBlob(activeSession.id);
        if (cancelled || durationSec === 0) return;

        objectUrl = URL.createObjectURL(blob);
        setAudioUrl(objectUrl);
        setTotalAudioDuration(durationSec);
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
  }, [activeSession?.id, activeSession?.audioDeleted, activeSession?.durationSec]);

  // Sync audio playbackRate cleanly
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, audioUrl]);

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
      audioRef.current.playbackRate = playbackRate;
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const seekTo = (seconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = seconds;
      setCurrentTime(seconds);
      if (!isPlaying) {
        audioRef.current.playbackRate = playbackRate;
        audioRef.current.play();
        setIsPlaying(true);
      }
    }
  };

  const activeSegmentIndex = activeTranscript.findIndex(
    (s) => currentTime >= s.start && currentTime <= s.end
  );

  const filteredSegments = activeTranscript.filter((s) => {
    if (!transcriptSearch.trim()) return true;
    return s.text.toLowerCase().includes(transcriptSearch.toLowerCase());
  });

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
    const ext = format;
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

  const handlePrintPdf = () => {
    setShowExportMenu(false);
    setTimeout(() => {
      window.print();
    }, 100);
  };

  const handleStartEditMeta = () => {
    setMetaRefInput(activeSession.reference || '');
    setMetaTitleInput(activeSession.title || '');
    setIsEditingMeta(true);
  };

  const handleSaveMeta = async (e: React.FormEvent) => {
    e.preventDefault();
    await updateSessionMeta(activeSession.id, {
      reference: metaRefInput.trim(),
      title: metaTitleInput.trim() || activeSession.title,
    });
    setIsEditingMeta(false);
  };

  const handleRetranscribe = () => {
    const hasManualEdits = activeTranscript.some((s) => s.edited || Boolean(s.speaker));
    if (hasManualEdits) {
      openConfirm({
        title: '¿Volver a transcribir la consulta?',
        description:
          'Se volverá a procesar el audio con el modelo y glosario dental actuales. Las ediciones manuales y etiquetas de hablante de esta transcripción se reemplazarán.',
        confirmText: 'Volver a transcribir',
        cancelText: 'Cancelar',
        isDestructive: true,
        onConfirm: () => startTranscription(activeSession.id, { forceRetranscribe: true }),
      });
    } else {
      startTranscription(activeSession.id, { forceRetranscribe: true });
    }
  };

  const startEdit = (segment: TranscriptSegment) => {
    setEditingSegmentId(segment.id);
    setEditingText(segment.text);
  };

  const saveEdit = async (segmentId: string) => {
    await updateSegmentText(segmentId, editingText.trim());
    setEditingSegmentId(null);
  };

  const cycleSpeaker = async (segment: TranscriptSegment) => {
    const currentIndex = SPEAKER_CYCLE.indexOf(segment.speaker);
    const nextSpeaker = SPEAKER_CYCLE[(currentIndex + 1) % SPEAKER_CYCLE.length];
    await updateSegmentSpeaker(segment.id, nextSpeaker);
  };

  const handleAutofillClinicalNote = () => {
    const draft = buildDraftClinicalNote(activeTranscript, noteDraft.templateId);
    setNoteDraft(draft);
    showToast('Ficha autocompletada desde la transcripción local', 'info');
  };

  const handleSaveClinicalNote = async () => {
    await saveClinicalNote(activeSession.id, {
      ...noteDraft,
      updatedAt: Date.now(),
    });
  };

  const handleCopyClinicalNote = () => {
    const txt = formatClinicalNoteText(activeSession, noteDraft);
    navigator.clipboard.writeText(txt);
    showToast('Ficha clínica copiada al portapapeles', 'success');
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

      {/* Printable Clinical Sheet (Visible only when printing / Save as PDF) */}
      <div className="hidden print-only space-y-6 text-slate-900">
        <div className="border-b border-slate-300 pb-4 flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold">Escriba · Registro Clínico Odontológico</h1>
            <p className="text-sm text-slate-600 mt-1">
              Paciente / Referencia: <strong>{activeSession.reference || activeSession.title}</strong>
            </p>
          </div>
          <div className="text-right text-xs text-slate-600">
            <div>{new Date(activeSession.createdAt).toLocaleDateString('es-AR')}</div>
            <div>Duración: {formatTimeDisplay(activeSession.durationSec)}</div>
          </div>
        </div>

        {(activeSession.clinicalNote || noteDraft.procedure || noteDraft.findings) && (
          <div className="space-y-2 border border-slate-300 rounded-xl p-4 print-break-inside-avoid">
            <h2 className="text-sm font-bold uppercase tracking-wide">Ficha Clínica</h2>
            {noteDraft.detectedTeeth.length > 0 && (
              <p className="text-xs">
                <strong>Piezas FDI:</strong> {noteDraft.detectedTeeth.join(', ')}
              </p>
            )}
            {noteDraft.chiefComplaint && (
              <p className="text-xs">
                <strong>Motivo / Relato:</strong> {noteDraft.chiefComplaint}
              </p>
            )}
            {noteDraft.findings && (
              <p className="text-xs">
                <strong>Hallazgos:</strong> {noteDraft.findings}
              </p>
            )}
            {noteDraft.procedure && (
              <p className="text-xs">
                <strong>Procedimiento:</strong> {noteDraft.procedure}
              </p>
            )}
            {noteDraft.indications && (
              <p className="text-xs">
                <strong>Indicaciones:</strong> {noteDraft.indications}
              </p>
            )}
            {noteDraft.nextVisit && (
              <p className="text-xs">
                <strong>Próximo control:</strong> {noteDraft.nextVisit}
              </p>
            )}
          </div>
        )}

        <div className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide">Transcripción de la consulta</h2>
          {activeTranscript.map((seg) => (
            <div key={seg.id} className="text-xs leading-relaxed border-b border-slate-100 pb-2">
              <span className="font-mono text-slate-500 mr-2">
                [{formatTimeDisplay(seg.start)}]
              </span>
              {seg.speaker && <strong className="mr-1.5">{seg.speaker}:</strong>}
              <span>{seg.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Top Navigation & Session Header */}
      <div className="no-print flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200/80 dark:border-slate-800/80">
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <button
            onClick={() => setView('home')}
            className="p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
            title="Volver a la lista de grabaciones"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          {isEditingMeta ? (
            <form onSubmit={handleSaveMeta} className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={metaRefInput}
                onChange={(e) => setMetaRefInput(e.target.value)}
                placeholder="Referencia / Paciente (ej. M.G.)"
                className="px-3 py-1.5 text-xs rounded-xl bg-white dark:bg-slate-900 border border-teal-500 text-slate-900 dark:text-slate-100 focus:outline-hidden"
                autoFocus
              />
              <input
                type="text"
                value={metaTitleInput}
                onChange={(e) => setMetaTitleInput(e.target.value)}
                placeholder="Título de la consulta"
                className="px-3 py-1.5 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-hidden"
              />
              <button
                type="submit"
                className="px-3 py-1.5 text-xs font-semibold rounded-xl bg-teal-600 text-white hover:bg-teal-700 min-h-[36px]"
              >
                Guardar
              </button>
              <button
                type="button"
                onClick={() => setIsEditingMeta(false)}
                className="px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-800 min-h-[36px]"
              >
                Cancelar
              </button>
            </form>
          ) : (
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 truncate">
                  {activeSession.reference ? activeSession.reference : activeSession.title}
                </h1>
                <button
                  type="button"
                  onClick={handleStartEditMeta}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center shrink-0"
                  title="Editar nombre o referencia del paciente"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                <span>{new Date(activeSession.createdAt).toLocaleDateString('es-AR')}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">{formatTimeDisplay(activeSession.durationSec)}</span>
                {activeSession.modelTierUsed && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>
                      Modelo: {activeSession.modelTierUsed === 'max' ? 'Máxima precisión' : 'Estándar clínico'}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Top Actions */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {activeTranscript.length > 0 && (
            <button
              onClick={handleCopyForAi}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-200 border border-teal-200 dark:border-teal-800/80 hover:bg-teal-100 dark:hover:bg-teal-900/40 transition-colors whitespace-nowrap min-h-[44px]"
              title="Copia el texto limpio con encabezado clínico estructurado para enviar a tu IA"
            >
              {copiedType === 'ai' ? <Check className="w-3.5 h-3.5 text-teal-600" /> : <Sparkles className="w-3.5 h-3.5 text-teal-600" />}
              <span>Copiar para IA</span>
            </button>
          )}

          {activeTranscript.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors min-h-[44px] whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5 text-slate-500" />
                <span>Exportar</span>
              </button>

              {showExportMenu && (
                <div className="absolute right-0 mt-2 w-60 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl p-1.5 z-40 space-y-0.5">
                  <button
                    onClick={handlePrintPdf}
                    className="w-full text-left px-3 py-2.5 text-xs font-semibold rounded-lg text-teal-700 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/50 flex items-center justify-between"
                  >
                    <span>Imprimir / Guardar PDF</span>
                    <Printer className="w-3.5 h-3.5" />
                  </button>
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

          <button
            onClick={() => {
              openConfirm({
                title: '¿Eliminar consulta?',
                description: `Se eliminará permanentemente la consulta "${activeSession.reference || activeSession.title}", incluyendo la grabación de audio y su transcripción de este equipo.`,
                confirmText: 'Eliminar consulta',
                cancelText: 'Cancelar',
                isDestructive: true,
                onConfirm: () => deleteSession(activeSession.id),
              });
            }}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 border border-slate-200 dark:border-slate-800 transition-colors min-h-[44px] whitespace-nowrap"
            title="Eliminar consulta y transcripción"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Eliminar</span>
          </button>
        </div>
      </div>

      {/* Fallback Notice */}
      {transcriptionFallbackNotice && (
        <div className="no-print p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span>{transcriptionFallbackNotice}</span>
        </div>
      )}

      {/* Main 2-Column Responsive Layout */}
      <div className="no-print grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Audio Player & Action Controls */}
        <div className="lg:col-span-5 space-y-6 lg:sticky lg:top-6 self-start">
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

              <input
                type="range"
                min="0"
                max={totalAudioDuration || 1}
                step="0.1"
                value={currentTime}
                onChange={(e) => seekTo(parseFloat(e.target.value))}
                className="w-full accent-teal-600 cursor-pointer"
              />

              {/* Playback Controls + Speed Selector */}
              <div className="flex items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-2">
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

                {/* Speed Control */}
                <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                  {PLAYBACK_SPEEDS.map((spd) => (
                    <button
                      key={spd}
                      type="button"
                      onClick={() => setPlaybackRate(spd)}
                      className={`px-2 py-1 text-[11px] font-mono font-semibold rounded-lg transition-colors min-h-[32px] ${
                        playbackRate === spd
                          ? 'bg-white dark:bg-slate-700 text-teal-700 dark:text-teal-300 shadow-xs'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      {spd}x
                    </button>
                  ))}
                </div>
              </div>

              <p className="text-[11px] text-center text-slate-400 dark:text-slate-500">
                Al tocar cualquier fragmento de la transcripción, el audio saltará a ese momento.
              </p>

              {/* Append voice note button */}
              {!isTranscribingThisSession && (
                <button
                  type="button"
                  onClick={() => appendRecordingToSession(activeSession.id)}
                  className="w-full py-2.5 px-3 rounded-xl text-xs font-semibold text-teal-800 dark:text-teal-200 bg-teal-50/70 dark:bg-teal-950/40 hover:bg-teal-100 dark:hover:bg-teal-900/50 border border-teal-200/80 dark:border-teal-800/60 transition-colors flex items-center justify-center gap-2 min-h-[44px]"
                >
                  <Mic className="w-3.5 h-3.5 text-teal-600" />
                  <span>Anexar nota de voz a esta consulta</span>
                </button>
              )}
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

          {/* Transcription CTA, Progress, or Completed Data Management Card */}
          {activeSession.status !== 'completed' || isTranscribingThisSession ? (
            <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-teal-200/90 dark:border-teal-900/60 shadow-md shadow-teal-500/5 space-y-4">
              <div className="flex items-center justify-between gap-2">
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

                {isTranscribingThisSession && (
                  <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-300 font-mono">
                    {wakeLockActive && (
                      <span
                        className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300"
                        title="La pantalla se mantendrá activa mientras transcribe"
                      >
                        <Sun className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Pantalla activa</span>
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <Cpu className="w-3.5 h-3.5 text-teal-600" />
                      {transcriptionProgress?.activeBackend
                        ? transcriptionProgress.activeBackend.toUpperCase()
                        : 'LOCAL'}
                    </span>
                  </div>
                )}
              </div>

              {isTranscribingThisSession ? (
                <div className="space-y-3.5 pt-1">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        Fragmento {transcriptionProgress?.currentSegment || 1} de {transcriptionProgress?.totalSegments || 1}
                      </span>
                      <span className="font-mono tabular-nums font-bold text-teal-600 dark:text-teal-400 text-sm">
                        {transcriptionProgress?.percent || 0}%
                      </span>
                    </div>

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

                  <div className="flex items-center justify-center gap-1 py-1.5 px-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl">
                    <RotateCw className="w-3.5 h-3.5 text-teal-600 animate-spin shrink-0" />
                    <span className="ml-2 text-[11px] text-slate-600 dark:text-slate-300 font-medium truncate">
                      {transcriptionProgress?.statusText || 'Procesando modelo Whisper...'}
                    </span>
                  </div>

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

                  <div className="p-3 rounded-2xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-900/40 text-[11px] text-amber-900 dark:text-amber-200 space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                      <span>Protección contra recargas activa</span>
                    </div>
                    <p className="text-[10.5px] leading-relaxed text-amber-800/90 dark:text-amber-300/90">
                      Cada fragmento se guarda al instante en tu dispositivo para reanudarlo cuando quieras.
                    </p>
                  </div>

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

                  <button
                    onClick={() => cancelTranscription()}
                    className="w-full py-2.5 px-4 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors min-h-[44px]"
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
            <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-xs space-y-3">
              <div className="flex items-center gap-2.5 text-xs font-semibold text-slate-900 dark:text-slate-100">
                <HardDrive className="w-4 h-4 text-slate-500" />
                <span>Acciones y datos locales</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Puedes volver a transcribir si cambiaste el modelo o agregaste términos al glosario, o liberar el audio para ahorrar espacio.
              </p>
              <div className="space-y-2 pt-1">
                {!activeSession.audioDeleted && (
                  <>
                    <button
                      onClick={handleRetranscribe}
                      className="w-full py-2.5 px-3 rounded-xl text-xs font-semibold text-teal-800 dark:text-teal-200 bg-teal-50 dark:bg-teal-950/60 hover:bg-teal-100 dark:hover:bg-teal-900/40 border border-teal-200/80 dark:border-teal-800/60 transition-colors flex items-center justify-center gap-2 min-h-[44px]"
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-teal-600" />
                      <span>Volver a transcribir con ajustes actuales</span>
                    </button>

                    <button
                      onClick={() => {
                        openConfirm({
                          title: '¿Borrar archivo de audio?',
                          description: 'Se liberará el espacio de almacenamiento del audio en tu dispositivo (~115 MB/hora). La transcripción de texto se conservará intacta.',
                          confirmText: 'Borrar solo audio',
                          cancelText: 'Cancelar',
                          isDestructive: false,
                          onConfirm: () => deleteAudioForSession(activeSession.id),
                        });
                      }}
                      className="w-full py-2.5 px-3 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-2 min-h-[44px]"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-slate-500" />
                      <span>Borrar solo el archivo de audio</span>
                    </button>
                  </>
                )}

                <button
                  onClick={() => {
                    openConfirm({
                      title: '¿Eliminar consulta completa?',
                      description: `Se eliminarán permanentemente el audio y la transcripción de "${activeSession.reference || activeSession.title}". Esta acción no se puede deshacer.`,
                      confirmText: 'Eliminar consulta',
                      cancelText: 'Cancelar',
                      isDestructive: true,
                      onConfirm: () => deleteSession(activeSession.id),
                    });
                  }}
                  className="w-full py-2.5 px-3 rounded-xl text-xs font-medium text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/40 border border-rose-200 dark:border-rose-900/60 transition-colors flex items-center justify-center gap-2 min-h-[44px]"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Eliminar consulta completa</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Transcript OR Structured Clinical Sheet */}
        <div className="lg:col-span-7 space-y-4">
          {/* Mode Switcher + Detected FDI Teeth strip */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900/80 rounded-xl border border-slate-200/60 dark:border-slate-800/60 self-start">
              <button
                type="button"
                onClick={() => setRightTab('transcript')}
                className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap min-h-[36px] ${
                  rightTab === 'transcript'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <FileText className="w-3.5 h-3.5 text-teal-600" />
                <span>Transcripción ({activeTranscript.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setRightTab('clinical_note')}
                className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap min-h-[36px] ${
                  rightTab === 'clinical_note'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <ClipboardList className="w-3.5 h-3.5 text-teal-600" />
                <span>Ficha clínica</span>
              </button>
            </div>

            {detectedFdiTeeth.length > 0 && (
              <div className="text-xs text-slate-600 dark:text-slate-300 flex items-center gap-1.5 flex-wrap">
                <span className="font-medium text-slate-500 dark:text-slate-400">Piezas FDI:</span>
                <span className="font-mono font-semibold text-teal-700 dark:text-teal-300">
                  {detectedFdiTeeth.join(' · ')}
                </span>
              </div>
            )}
          </div>

          {rightTab === 'clinical_note' ? (
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800/80 shadow-xs p-5 sm:p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Ficha clínica estructurada (100% local)
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Organizá la historia clínica por especialidad y copiala o imprimila directo en PDF.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleAutofillClinicalNote}
                  disabled={activeTranscript.length === 0}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold text-teal-800 dark:text-teal-200 bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800/80 hover:bg-teal-100 disabled:opacity-50 transition-colors whitespace-nowrap min-h-[40px]"
                >
                  Autocompletar desde transcripción
                </button>
              </div>

              {/* Template Selector */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Plantilla odontológica
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {CLINICAL_TEMPLATES.map((tpl) => {
                    const active = noteDraft.templateId === tpl.id;
                    return (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() =>
                          setNoteDraft((prev) => ({ ...prev, templateId: tpl.id as ClinicalTemplateId }))
                        }
                        className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors min-h-[36px] ${
                          active
                            ? 'border-teal-600 bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-200 font-semibold'
                            : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        {tpl.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Editable Structured Clinical Fields */}
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Piezas dentarias (FDI, separadas por coma)
                  </label>
                  <input
                    type="text"
                    value={noteDraft.detectedTeeth.join(', ')}
                    onChange={(e) =>
                      setNoteDraft((prev) => ({
                        ...prev,
                        detectedTeeth: e.target.value
                          .split(',')
                          .map((t) => t.trim())
                          .filter(Boolean),
                      }))
                    }
                    placeholder="Ej: 1.6, 4.8"
                    className="w-full mt-1 px-3 py-2 text-xs font-mono rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:border-teal-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Motivo de consulta / Relato del paciente
                  </label>
                  <textarea
                    rows={2}
                    value={noteDraft.chiefComplaint}
                    onChange={(e) => setNoteDraft((p) => ({ ...p, chiefComplaint: e.target.value }))}
                    placeholder="Dolor a la masticación, sensibilidad al frío, control..."
                    className="w-full mt-1 px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:border-teal-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Hallazgos clínicos / Diagnóstico
                  </label>
                  <textarea
                    rows={2}
                    value={noteDraft.findings}
                    onChange={(e) => setNoteDraft((p) => ({ ...p, findings: e.target.value }))}
                    placeholder="Caries profunda oclusal, filtración de restauración, periapical sin lesión..."
                    className="w-full mt-1 px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:border-teal-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Procedimiento realizado
                  </label>
                  <textarea
                    rows={3}
                    value={noteDraft.procedure}
                    onChange={(e) => setNoteDraft((p) => ({ ...p, procedure: e.target.value }))}
                    placeholder={
                      CLINICAL_TEMPLATES.find((t) => t.id === noteDraft.templateId)
                        ?.defaultProcedureHint
                    }
                    className="w-full mt-1 px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:border-teal-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      Indicaciones / Medicación
                    </label>
                    <textarea
                      rows={2}
                      value={noteDraft.indications}
                      onChange={(e) => setNoteDraft((p) => ({ ...p, indications: e.target.value }))}
                      placeholder="Ibuprofeno 600 mg c/8h si hay dolor..."
                      className="w-full mt-1 px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:border-teal-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      Próximo control / Plan
                    </label>
                    <textarea
                      rows={2}
                      value={noteDraft.nextVisit}
                      onChange={(e) => setNoteDraft((p) => ({ ...p, nextVisit: e.target.value }))}
                      placeholder="Citar en 15 días para obturación definitiva..."
                      className="w-full mt-1 px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:border-teal-500"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={handleCopyClinicalNote}
                  className="px-4 py-2.5 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5 min-h-[44px]"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copiar ficha</span>
                </button>
                <button
                  type="button"
                  onClick={handleSaveClinicalNote}
                  className="px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 transition-colors flex items-center gap-1.5 min-h-[44px]"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Guardar ficha</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Transcript Control Bar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 shadow-xs">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={transcriptSearch}
                    onChange={(e) => setTranscriptSearch(e.target.value)}
                    placeholder="Buscar en el texto de la consulta..."
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-transparent focus:border-teal-500 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden min-h-[36px]"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {isTranscribingThisSession && (
                    <button
                      type="button"
                      onClick={() => setAutoScroll(!autoScroll)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 min-h-[36px] ${
                        autoScroll
                          ? 'bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800/60'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${autoScroll ? 'bg-teal-500 animate-ping' : 'bg-slate-400'}`} />
                      <span>Auto-scroll</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setHighlightFdi(!highlightFdi)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-colors min-h-[36px] ${
                      highlightFdi
                        ? 'bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800/60'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {highlightFdi ? 'Piezas FDI: Sí' : 'Piezas FDI: No'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowTimestamps(!showTimestamps)}
                    className="px-3 py-1.5 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap transition-colors min-h-[36px]"
                  >
                    {showTimestamps ? 'Ocultar tiempos' : 'Mostrar tiempos'}
                  </button>
                </div>
              </div>

              {/* Transcript Feed */}
              <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800/80 shadow-xs p-4 sm:p-6 min-h-[400px]">
                {filteredSegments.length > 0 ? (
                  <div className="space-y-3">
                    {filteredSegments.map((segment, index) => {
                      const isActive = index === activeSegmentIndex;
                      const isEditing = editingSegmentId === segment.id;
                      const isLatestStreaming = isTranscribingThisSession && index === filteredSegments.length - 1;

                      return (
                        <div
                          key={segment.id}
                          onClick={() => !isEditing && audioUrl && seekTo(segment.start)}
                          className={`group p-3.5 rounded-2xl transition-all border ${
                            isActive
                              ? 'bg-teal-50/70 dark:bg-teal-950/40 border-teal-300 dark:border-teal-800 shadow-xs'
                              : isLatestStreaming
                              ? 'bg-teal-50/30 dark:bg-teal-950/20 border-teal-200/80 dark:border-teal-800/50'
                              : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/40 hover:border-slate-200/60 dark:hover:border-slate-700/60'
                          } ${audioUrl ? 'cursor-pointer' : ''}`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            {/* Timestamp & Metadata */}
                            <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums text-slate-400 dark:text-slate-500">
                              {showTimestamps && (
                                <span>
                                  {formatTimeDisplay(segment.start)} - {formatTimeDisplay(segment.end)}
                                </span>
                              )}
                              {segment.speaker && (
                                <span
                                  className={`font-sans font-semibold ${
                                    segment.speaker === 'Paciente'
                                      ? 'text-indigo-700 dark:text-indigo-300'
                                      : segment.speaker === 'Asistente'
                                      ? 'text-amber-700 dark:text-amber-300'
                                      : 'text-teal-700 dark:text-teal-400'
                                  }`}
                                >
                                  · {segment.speaker}
                                </span>
                              )}
                              {segment.edited && (
                                <span className="font-sans text-[11px] text-slate-400">· editado</span>
                              )}
                              {isLatestStreaming && (
                                <span className="font-sans text-[11px] font-medium text-teal-700 dark:text-teal-300">
                                  · Reciente
                                </span>
                              )}
                            </div>

                            {/* Always-accessible Touch Actions: Speaker Role + Edit */}
                            {!isEditing && (
                              <div className="flex items-center gap-1 opacity-100 sm:opacity-75 sm:group-hover:opacity-100 transition-opacity">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    cycleSpeaker(segment);
                                  }}
                                  className="px-2.5 py-1.5 rounded-xl text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-700 flex items-center gap-1 min-h-[36px]"
                                  title="Cambiar hablante (Odontólogo / Paciente / Asistente)"
                                >
                                  <UserCheck className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                                  <span>{segment.speaker || 'Hablante'}</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startEdit(segment);
                                  }}
                                  className="p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-200/70 dark:hover:bg-slate-700 min-h-[36px] min-w-[36px] flex items-center justify-center"
                                  title="Editar texto del fragmento"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </div>

                          {isEditing ? (
                            <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                              <textarea
                                value={editingText}
                                onChange={(e) => setEditingText(e.target.value)}
                                className="w-full p-2.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-teal-500 text-slate-900 dark:text-slate-100 focus:outline-hidden"
                                rows={3}
                              />
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => setEditingSegmentId(null)}
                                  className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-800 min-h-[36px]"
                                >
                                  Cancelar
                                </button>
                                <button
                                  onClick={() => saveEdit(segment.id)}
                                  className="px-3.5 py-1.5 text-xs font-semibold rounded-xl bg-teal-600 text-white hover:bg-teal-700 min-h-[36px]"
                                >
                                  Guardar
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="mt-1.5 text-xs sm:text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
                              {renderFormattedSegmentText(segment.text, transcriptSearch, highlightFdi)}
                            </p>
                          )}
                        </div>
                      );
                    })}

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
                  </div>
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
                        Whisper está analizando el primer fragmento de voz. En cuanto termine, aparecerá aquí inmediatamente.
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
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// Highlights both search terms and clinical FDI dental codes (e.g. 1.6, pieza 36)
function renderFormattedSegmentText(text: string, search: string, highlightFdi: boolean) {
  if (search.trim()) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
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

  if (!highlightFdi) return text;

  const fdiPattern =
    /(\b(?:pieza|piezas|elemento|elementos|diente|dientes|molar|premolar|incisivo|canino|implante|conducto|corona|raíz|raiz)\s+(?:n[°º.]?\s*)?[1-8]\.?[1-8]|(?<!\d)[1-4]\.[1-8](?!\d))/gi;
  const parts = text.split(fdiPattern);
  return parts.map((part, idx) => {
    if (!part) return null;
    if (fdiPattern.test(part)) {
      fdiPattern.lastIndex = 0;
      return (
        <span
          key={idx}
          className="font-semibold text-teal-700 dark:text-teal-300 underline decoration-teal-400/60 decoration-dotted underline-offset-2"
        >
          {part}
        </span>
      );
    }
    fdiPattern.lastIndex = 0;
    return part;
  });
}
