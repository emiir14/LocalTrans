import React, { useRef, useState } from 'react';
import {
  Mic,
  Upload,
  Search,
  ShieldCheck,
  Clock,
  ChevronRight,
  AlertCircle,
  FileAudio,
  CheckCircle2,
  RotateCw,
  Trash2,
  Zap,
} from 'lucide-react';
import { formatTimeDisplay } from '../core/export/formatter';
import { Session } from '../core/types';
import { useAppStore } from '../store/useAppStore';

export const HomeView: React.FC = () => {
  const {
    sessions,
    setView,
    startRecording,
    deleteSession,
    openConfirm,
    unclosedSession,
    recoverRecording,
    dismissRecovery,
    importAudioFile,
    settings,
  } = useAppStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'recorded' | 'transcribing' | 'completed'>('all');
  const [showModal, setShowModal] = useState(false);
  const [referenceInput, setReferenceInput] = useState('');
  const [consentChecked, setConsentChecked] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredSessions = sessions.filter((s) => {
    // Status filter
    if (statusFilter !== 'all' && s.status !== statusFilter) return false;
    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = s.title.toLowerCase().includes(q);
      const matchRef = (s.reference || '').toLowerCase().includes(q);
      return matchTitle || matchRef;
    }
    return true;
  });

  const handleStartModalConfirm = async () => {
    if (settings?.requireConsent && !consentChecked) return;
    setShowModal(false);
    await startRecording(referenceInput, consentChecked);
    setReferenceInput('');
    setConsentChecked(false);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await importAudioFile(file);
      e.target.value = '';
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Unclosed Session Recovery Banner */}
      {unclosedSession && (
        <div className="p-4 sm:p-5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                Grabación anterior interrumpida
              </h2>
              <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-0.5">
                Se detectó una consulta que quedó abierta ({unclosedSession.reference || unclosedSession.title}).
                Los bloques guardados están seguros en tu navegador.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5 w-full sm:w-auto shrink-0">
            <button
              onClick={() => dismissRecovery()}
              className="flex-1 sm:flex-none px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-amber-100/60 dark:hover:bg-amber-900/40 rounded-xl transition-colors"
            >
              Descartar
            </button>
            <button
              onClick={() => recoverRecording(unclosedSession)}
              className="flex-1 sm:flex-none px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-xl shadow-xs transition-colors"
            >
              Recuperar consulta
            </button>
          </div>
        </div>
      )}

      {/* Hero & Dominant Primary Action */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 pb-6 border-b border-slate-200/80 dark:border-slate-800/80">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Consultas odontológicas
          </h1>
          <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            <ShieldCheck className="w-4 h-4 text-teal-600 dark:text-teal-400" />
            <span>100% en este dispositivo</span>
            <span aria-hidden="true">·</span>
            <span>Cero envío de audio a servidores</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="audio/mp3,audio/wav,audio/m4a,audio/webm,audio/*"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-3 rounded-2xl text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors shadow-xs whitespace-nowrap min-h-[48px]"
          >
            <Upload className="w-4 h-4 text-slate-500" />
            <span>Importar audio</span>
          </button>

          <button
            onClick={() => startRecording('', true, { isQuickDictation: true })}
            className="flex items-center gap-2 px-4 py-3 rounded-2xl text-xs font-semibold text-teal-800 dark:text-teal-200 bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800/80 hover:bg-teal-100 dark:hover:bg-teal-900/40 transition-colors whitespace-nowrap min-h-[48px]"
            title="Graba un dictado breve post-atención sin pasos previos y transcribe al detener"
          >
            <Zap className="w-4 h-4 text-teal-600 dark:text-teal-400" />
            <span>Dictado rápido</span>
          </button>

          <button
            onClick={() => {
              if (settings?.requireConsent) {
                setShowModal(true);
              } else {
                startRecording();
              }
            }}
            className="group relative flex items-center gap-2.5 px-6 py-3 rounded-2xl text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 active:scale-[0.98] transition-all shadow-md shadow-teal-600/20 whitespace-nowrap min-h-[48px]"
          >
            <Mic className="w-4 h-4" />
            <span>Grabar consulta</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        {/* Segmented Filter Control */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900/80 rounded-xl border border-slate-200/60 dark:border-slate-800/60 overflow-x-auto">
          {[
            { id: 'all', label: 'Todas' },
            { id: 'recorded', label: 'Por transcribir' },
            { id: 'transcribing', label: 'En proceso' },
            { id: 'completed', label: 'Listas' },
          ].map((tab) => {
            const isSelected = statusFilter === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id as any)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                  isSelected
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar por referencia o fecha..."
            className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-colors"
          />
        </div>
      </div>

      {/* Session List */}
      {filteredSessions.length > 0 ? (
        <div className="divide-y divide-slate-100 dark:divide-slate-800/80 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 shadow-xs overflow-hidden">
          {filteredSessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              onClick={() => setView('detail', session.id)}
              onDelete={() => {
                openConfirm({
                  title: '¿Eliminar consulta?',
                  description: `Se eliminará permanentemente la consulta "${session.reference || session.title}", incluyendo la grabación de audio y su transcripción de este equipo.`,
                  confirmText: 'Eliminar consulta',
                  cancelText: 'Cancelar',
                  isDestructive: true,
                  onConfirm: () => deleteSession(session.id),
                });
              }}
            />
          ))}
        </div>
      ) : (
        <div className="py-16 px-6 text-center rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-teal-50 dark:bg-teal-950/60 flex items-center justify-center text-teal-600 dark:text-teal-400 mb-4">
            <Mic className="w-6 h-6" />
          </div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {searchQuery ? 'No se encontraron grabaciones coincidentes' : 'Sin consultas grabadas aún'}
          </h2>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
            {searchQuery
              ? 'Probá modificando el término de búsqueda o limpiá el filtro.'
              : 'Presioná "Grabar consulta" para iniciar la captura de audio en tu consultorio. El audio permanecerá estrictamente en este equipo.'}
          </p>
          {!searchQuery && (
            <button
              onClick={() => {
                if (settings?.requireConsent) {
                  setShowModal(true);
                } else {
                  startRecording();
                }
              }}
              className="mt-5 px-5 py-2.5 text-xs font-semibold text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950 hover:bg-teal-100 dark:hover:bg-teal-900/60 rounded-xl transition-colors"
            >
              Comenzar primera grabación
            </button>
          )}
        </div>
      )}

      {/* New Recording Confirmation Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl space-y-5">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                Nueva grabación clínica
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Configurá los datos de referencia antes de iniciar la captura de audio.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                Referencia o código del paciente (Opcional)
              </label>
              <input
                type="text"
                value={referenceInput}
                onChange={(e) => setReferenceInput(e.target.value)}
                placeholder="Ej: Paciente M.G. / Implante 1.4"
                className="w-full px-3.5 py-2.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
              />
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Por privacidad, sugerimos iniciales o número de historia clínica en lugar del nombre completo.
              </p>
            </div>

            {settings?.requireConsent && (
              <label className="flex items-start gap-3 p-3.5 rounded-xl bg-teal-50/60 dark:bg-teal-950/30 border border-teal-200/60 dark:border-teal-800/40 cursor-pointer">
                <input
                  type="checkbox"
                  checked={consentChecked}
                  onChange={(e) => setConsentChecked(e.target.checked)}
                  className="mt-0.5 rounded text-teal-600 focus:ring-teal-500"
                />
                <span className="text-xs text-teal-900 dark:text-teal-200 leading-snug">
                  Informé al paciente sobre el registro de la consulta y cuento con su consentimiento informado para grabar.
                </span>
              </label>
            )}

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 rounded-xl"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleStartModalConfirm}
                disabled={settings?.requireConsent && !consentChecked}
                className="px-5 py-2.5 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-xs transition-colors"
              >
                Iniciar grabación
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Row component adhering to Zero-Pill and 44px touch targets
const SessionRow: React.FC<{
  session: Session;
  onClick: () => void;
  onDelete: () => void;
}> = ({ session, onClick, onDelete }) => {
  const dateStr = new Date(session.createdAt).toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const renderStatus = () => {
    switch (session.status) {
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700 dark:text-teal-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Lista</span>
          </span>
        );
      case 'transcribing':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400">
            <RotateCw className="w-3.5 h-3.5 animate-spin" />
            <span>Transcribiendo...</span>
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>Error</span>
          </span>
        );
      case 'recording':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <span>Grabando</span>
          </span>
        );
      case 'recorded':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">
            <Clock className="w-3.5 h-3.5" />
            <span>Por transcribir</span>
          </span>
        );
    }
  };

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onClick();
        }
      }}
      className="w-full text-left p-4 sm:p-5 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors flex items-center justify-between gap-4 group min-h-[64px] cursor-pointer"
    >
      <div className="flex items-center gap-4 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 shrink-0 group-hover:bg-teal-50 dark:group-hover:bg-teal-950/60 group-hover:text-teal-600 transition-colors">
          <FileAudio className="w-5 h-5" />
        </div>

        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
            {session.reference ? session.reference : session.title}
          </h3>

          {/* Unboxed Metadata Line with separators */}
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            <span>{dateStr}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{formatTimeDisplay(session.durationSec)}</span>
            {session.audioDeleted && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-slate-400 dark:text-slate-500">Audio liberado</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <div className="text-right hidden sm:block">{renderStatus()}</div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="p-2 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-xl transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center"
          title="Eliminar consulta"
        >
          <Trash2 className="w-4 h-4" />
        </button>
        <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200 group-hover:translate-x-0.5 transition-all" />
      </div>
    </div>
  );
};
