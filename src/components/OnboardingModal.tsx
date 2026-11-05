import React from 'react';
import { Mic, ShieldCheck, DownloadCloud, Sparkles } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

export const OnboardingModal: React.FC = () => {
  const { showOnboarding, closeOnboarding } = useAppStore();

  if (!showOnboarding) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fade-in">
      <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-2xl space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-teal-600 flex items-center justify-center text-white shadow-md shadow-teal-600/20">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Bienvenida a Escriba
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Transcripción odontológica inteligente, privada y 100% en tu dispositivo.
            </p>
          </div>
        </div>

        <div className="space-y-4 pt-2">
          <div className="flex items-start gap-3.5">
            <div className="w-8 h-8 rounded-xl bg-teal-50 dark:bg-teal-950/60 flex items-center justify-center text-teal-600 dark:text-teal-400 shrink-0 mt-0.5">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                1. Privacidad médica por diseño
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                El audio y las notas clínicas nunca se envían a ningún servidor ni nube. Todo queda almacenado en tu propio navegador.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3.5">
            <div className="w-8 h-8 rounded-xl bg-teal-50 dark:bg-teal-950/60 flex items-center justify-center text-teal-600 dark:text-teal-400 shrink-0 mt-0.5">
              <DownloadCloud className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                2. Descarga única del modelo
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                La primera vez que transcribas, se descargará el modelo de Whisper (~75MB a 350MB). Luego queda cacheado y funciona de forma offline.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3.5">
            <div className="w-8 h-8 rounded-xl bg-teal-50 dark:bg-teal-950/60 flex items-center justify-center text-teal-600 dark:text-teal-400 shrink-0 mt-0.5">
              <Mic className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                3. Permiso de micrófono
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                Tu navegador solicitará acceso al micrófono al iniciar tu primera consulta. Podés dejar el teléfono sobre tu escritorio durante la sesión.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={closeOnboarding}
          className="w-full py-3.5 px-6 rounded-2xl text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 shadow-md shadow-teal-600/20 active:scale-[0.98] transition-all min-h-[48px]"
        >
          Comenzar a usar Escriba
        </button>
      </div>
    </div>
  );
};
