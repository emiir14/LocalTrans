import React, { useEffect, useState } from 'react';
import {
  Mic,
  Pause,
  Play,
  Square,
  Trash2,
  Sun,
  AlertTriangle,
  HardDrive,
  ShieldAlert,
  UserPlus,
} from 'lucide-react';
import { formatTimeDisplay } from '../core/export/formatter';
import { useAppStore } from '../store/useAppStore';

export const RecordingView: React.FC = () => {
  const {
    activeSession,
    recordingDurationSec,
    dayPatientIndex,
    isPaused,
    vu,
    lastSavedAt,
    silenceWarning,
    wakeLockActive,
    pauseRecording,
    resumeRecording,
    nextPatient,
    stopRecording,
    discardRecording,
    openConfirm,
    storageUsage,
  } = useAppStore();

  const [secondsSinceLastSave, setSecondsSinceLastSave] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      if (lastSavedAt) {
        setSecondsSinceLastSave(Math.floor((Date.now() - lastSavedAt) / 1000));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [lastSavedAt]);

  // Storage calculation
  const freeMb = Math.round((storageUsage.quotaBytes - storageUsage.usedBytes) / (1024 * 1024));
  const isStorageLow = storageUsage.quotaBytes > 0 && freeMb < 200; // Less than 200MB

  // Format large clinical timer: HH:MM:SS
  const formatLargeTimer = (totalSec: number) => {
    const pad = (n: number) => ('00' + n).slice(-2);
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
  };

  // Convert VU RMS to percentage [0, 100] with logarithmic response
  const vuLevelPct = Math.min(100, Math.max(0, Math.round(Math.sqrt(vu.rms) * 180)));

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col justify-between max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Top Telemetry & Health Indicators Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900/60 p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-800/80 shadow-xs">
        {/* Auto-save timestamp */}
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse" />
          <span>
            {secondsSinceLastSave <= 2
              ? 'Guardado automático hace instantes'
              : `Guardado local hace ${secondsSinceLastSave}s`}
          </span>
        </div>

        {/* Screen Wake Lock */}
        <div>
          {wakeLockActive ? (
            <div className="flex items-center gap-1.5 text-teal-700 dark:text-teal-400">
              <Sun className="w-3.5 h-3.5" />
              <span>Pantalla encendida</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Bloqueo no soportado</span>
            </div>
          )}
        </div>
      </div>

      {/* Warnings Zone */}
      <div className="space-y-3">
        {/* Silence Warning */}
        {silenceWarning && (
          <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs flex items-center gap-3 animate-fade-in shadow-xs">
            <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <div>
              <span className="font-semibold">No se detecta sonido:</span> Revisá si el micrófono está silenciado, cubierto o demasiado lejos del paciente.
            </div>
          </div>
        )}

        {/* Low Storage Warning */}
        {isStorageLow && (
          <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200 text-xs flex items-center gap-2.5 shadow-xs">
            <HardDrive className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>Almacenamiento bajo: quedan menos de {freeMb} MB disponibles en el navegador.</span>
          </div>
        )}

        {/* Clinician Advice Notice */}
        <div className="p-3.5 rounded-2xl bg-teal-50/60 dark:bg-teal-950/30 border border-teal-200/60 dark:border-teal-800/40 text-teal-900 dark:text-teal-200 text-xs flex items-center justify-center text-center">
          <span>Dejá la pantalla encendida y el dispositivo cargando para asegurar la captura continua.</span>
        </div>
      </div>

      {/* Central Heart: Clinical Timer & Session Reference */}
      <div className="flex-1 flex flex-col items-center justify-center py-6 text-center space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold px-3 py-1 rounded-full bg-teal-100 dark:bg-teal-950 text-teal-800 dark:text-teal-200 border border-teal-200 dark:border-teal-800">
            Consulta Paciente #{dayPatientIndex}
          </span>
          {activeSession?.reference && activeSession.reference !== `Paciente #${dayPatientIndex}` && (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {activeSession.reference}
            </span>
          )}
        </div>

        <div className="relative">
          <div
            className={`text-6xl sm:text-7xl md:text-8xl font-mono tabular-nums font-bold tracking-tight ${
              isPaused
                ? 'text-amber-600 dark:text-amber-400 opacity-80'
                : 'text-slate-900 dark:text-slate-100'
            }`}
          >
            {formatLargeTimer(recordingDurationSec)}
          </div>
          {isPaused && (
            <div className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300 mt-2">
              Grabación en pausa
            </div>
          )}
        </div>

        {/* Live Audio Level Meter (VU Meter) */}
        <div className="w-full max-w-md space-y-1.5 pt-4">
          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>Nivel de audio en vivo</span>
            <span className="font-mono tabular-nums">{vuLevelPct}%</span>
          </div>

          <div className="h-3 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden p-0.5 border border-slate-200 dark:border-slate-700">
            <div
              className={`h-full rounded-full transition-all duration-75 ${
                vuLevelPct > 80
                  ? 'bg-amber-500'
                  : vuLevelPct > 15
                  ? 'bg-teal-500'
                  : 'bg-slate-300 dark:bg-slate-600'
              }`}
              style={{ width: `${vuLevelPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Bottom Sticky Action Controls */}
      <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md p-4 rounded-3xl border border-slate-200/80 dark:border-slate-800/80 shadow-lg flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* Discard button */}
        <button
          onClick={() => {
            openConfirm({
              title: '¿Descartar grabación?',
              description: 'Se cancelará la captura de audio y se eliminarán los fragmentos temporales de esta consulta. Esta acción no se puede deshacer.',
              confirmText: 'Descartar grabación',
              cancelText: 'Continuar grabando',
              isDestructive: true,
              onConfirm: () => discardRecording(),
            });
          }}
          className="w-full sm:w-auto px-3.5 py-3 rounded-2xl text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors flex items-center justify-center gap-1.5 min-h-[48px]"
        >
          <Trash2 className="w-4 h-4" />
          <span>Descartar</span>
        </button>

        {/* Center / Primary Controls */}
        <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
          {/* 1-Touch Next Patient Button */}
          <button
            onClick={() => nextPatient()}
            className="flex-1 sm:flex-none px-5 py-3.5 rounded-2xl text-xs sm:text-sm font-semibold text-teal-950 dark:text-teal-100 bg-teal-100 hover:bg-teal-200 dark:bg-teal-900/60 dark:hover:bg-teal-800/70 border border-teal-300 dark:border-teal-700 active:scale-95 transition-all flex items-center justify-center gap-2 min-h-[48px] shadow-xs cursor-pointer"
            title="Guarda la consulta actual e inicia la del próximo paciente de inmediato sin pausar la grabación"
          >
            <UserPlus className="w-4 h-4 text-teal-700 dark:text-teal-300" />
            <span>Siguiente paciente</span>
            <span className="font-mono text-xs opacity-75">(#{dayPatientIndex + 1})</span>
          </button>

          {isPaused ? (
            <button
              onClick={() => resumeRecording()}
              className="flex-1 sm:flex-none px-4 py-3.5 rounded-2xl text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-1.5 min-h-[48px]"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Reanudar</span>
            </button>
          ) : (
            <button
              onClick={() => pauseRecording()}
              className="flex-1 sm:flex-none px-4 py-3.5 rounded-2xl text-xs sm:text-sm font-semibold text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-1.5 min-h-[48px]"
            >
              <Pause className="w-4 h-4 fill-current" />
              <span>Pausar</span>
            </button>
          )}

          <button
            onClick={() => stopRecording()}
            className="flex-1 sm:flex-none px-6 py-3.5 rounded-2xl text-xs sm:text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 active:scale-[0.98] transition-all shadow-md shadow-rose-600/20 flex items-center justify-center gap-1.5 min-h-[48px]"
          >
            <Square className="w-4 h-4 fill-current" />
            <span>Finalizar día</span>
          </button>
        </div>
      </div>
    </div>
  );
};
