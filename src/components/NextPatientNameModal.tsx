import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, Mic, UserPlus, X } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

const AUTO_CLOSE_SECONDS = 7;

export const NextPatientNameModal: React.FC = () => {
  const { pendingNextPatientModal, confirmNextPatientName } = useAppStore();
  const [patientName, setPatientName] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(AUTO_CLOSE_SECONDS);
  const [hasInteracted, setHasInteracted] = useState(false);
  const closedRef = useRef(false);

  useEffect(() => {
    if (!pendingNextPatientModal) return;
    closedRef.current = false;
    setPatientName('');
    setSecondsLeft(AUTO_CLOSE_SECONDS);
    setHasInteracted(false);
  }, [pendingNextPatientModal?.sessionId]);

  const finishAndStart = useCallback(
    (nameToSave?: string) => {
      if (closedRef.current || !pendingNextPatientModal) return;
      closedRef.current = true;
      void confirmNextPatientName(nameToSave);
    },
    [confirmNextPatientName, pendingNextPatientModal]
  );

  useEffect(() => {
    if (!pendingNextPatientModal || hasInteracted) return;

    const timer = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [pendingNextPatientModal, hasInteracted]);

  useEffect(() => {
    if (!pendingNextPatientModal || hasInteracted) return;
    if (secondsLeft === 0) {
      finishAndStart(patientName);
    }
  }, [secondsLeft, hasInteracted, pendingNextPatientModal, finishAndStart, patientName]);

  useEffect(() => {
    if (!pendingNextPatientModal) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        finishAndStart(patientName);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [pendingNextPatientModal, finishAndStart, patientName]);

  if (!pendingNextPatientModal) return null;

  const markInteracted = () => {
    if (!hasInteracted) {
      setHasInteracted(true);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    finishAndStart(patientName);
  };

  const progressPct = Math.max(0, Math.min(100, (secondsLeft / AUTO_CLOSE_SECONDS) * 100));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="next-patient-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fade-in"
    >
      <div
        className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 p-6 shadow-2xl space-y-4 animate-scale-in"
        onPointerDown={markInteracted}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-teal-50 dark:bg-teal-950/60 border border-teal-200/70 dark:border-teal-800/60 text-teal-700 dark:text-teal-300 flex items-center justify-center shrink-0">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="next-patient-modal-title"
                className="text-base font-bold text-slate-900 dark:text-slate-100"
              >
                ¿Deseás escribir el nombre del paciente?
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Consulta anterior guardada · Próxima: Paciente #{pendingNextPatientModal.patientIndex}
              </p>
            </div>
          </div>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => finishAndStart(patientName)}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Cerrar y comenzar grabación"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Auto-close notification banner */}
        <div
          className={`rounded-2xl border p-3 text-xs space-y-2 transition-colors ${
            hasInteracted
              ? 'bg-teal-50/70 dark:bg-teal-950/30 border-teal-200 dark:border-teal-800/60 text-teal-900 dark:text-teal-200'
              : 'bg-amber-50/80 dark:bg-amber-950/30 border-amber-200/80 dark:border-amber-800/60 text-amber-900 dark:text-amber-200'
          }`}
        >
          <div className="flex items-center gap-2 font-medium">
            <Clock className="w-3.5 h-3.5 shrink-0" />
            <span>
              {hasInteracted
                ? 'Cierre automático detenido. La grabación comenzará cuando cierres esta ventana.'
                : `Esta ventana se cerrará automáticamente en ${secondsLeft} ${
                    secondsLeft === 1 ? 'segundo' : 'segundos'
                  }.`}
            </span>
          </div>

          {!hasInteracted && (
            <div className="h-1.5 w-full bg-amber-200/70 dark:bg-amber-900/50 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500 dark:bg-amber-400 rounded-full transition-all duration-1000 ease-linear"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="next-patient-name-input"
              className="block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              Nombre o referencia (opcional)
            </label>
            <input
              id="next-patient-name-input"
              type="text"
              autoFocus
              value={patientName}
              onChange={(e) => {
                markInteracted();
                setPatientName(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Escape' && e.key !== 'Enter' && e.key !== 'Tab') {
                  markInteracted();
                }
              }}
              placeholder={`Ej: Juan Pérez (si lo dejás vacío será Paciente #${pendingNextPatientModal.patientIndex})`}
              className="w-full px-3.5 py-2.5 text-sm rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-1">
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => finishAndStart()}
              className="px-4 py-2.5 text-xs font-semibold rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors min-h-[44px]"
            >
              Omitir y grabar
            </button>

            <button
              type="submit"
              onPointerDown={(e) => e.stopPropagation()}
              className="px-5 py-2.5 text-xs font-semibold rounded-xl text-white bg-teal-600 hover:bg-teal-700 shadow-md shadow-teal-600/20 active:scale-[0.98] transition-all flex items-center gap-1.5 min-h-[44px]"
            >
              <Mic className="w-3.5 h-3.5" />
              <span>{patientName.trim() ? 'Guardar y grabar' : 'Comenzar grabación'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
