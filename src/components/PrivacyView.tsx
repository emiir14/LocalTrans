import React from 'react';
import { ShieldCheck, HardDrive, Cpu, WifiOff, FileLock2, AlertCircle } from 'lucide-react';

export const PrivacyView: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div>
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-950/60 px-3 py-1 rounded-full border border-teal-200 dark:border-teal-800/60 mb-2">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>Privacidad por diseño (Privacy by Design)</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Política y arquitectura de privacidad
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-2xl leading-relaxed">
          Escriba fue diseñada con una garantía absoluta: la información médica, dental y sensible del paciente nunca abandona el dispositivo donde se graba.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-xs space-y-2.5">
          <div className="w-9 h-9 rounded-xl bg-teal-50 dark:bg-teal-950/60 flex items-center justify-center text-teal-600 dark:text-teal-400">
            <HardDrive className="w-5 h-5" />
          </div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            1. Almacenamiento 100% en tu equipo
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Las grabaciones de audio se convierten inmediatamente en bloques PCM locales y se guardan en el motor IndexedDB de tu navegador. Ningún fragmento de audio es transmitido a ningún backend, CDN o servidor intermedio.
          </p>
        </div>

        <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-xs space-y-2.5">
          <div className="w-9 h-9 rounded-xl bg-teal-50 dark:bg-teal-950/60 flex items-center justify-center text-teal-600 dark:text-teal-400">
            <Cpu className="w-5 h-5" />
          </div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            2. Transcripción con IA local
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            La transcripción utiliza modelos de Whisper que se ejecutan directamente en el procesador (WASM) o en la tarjeta gráfica (WebGPU) de tu propio dispositivo. No se consumen APIs de pago ni servicios en la nube.
          </p>
        </div>

        <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-xs space-y-2.5">
          <div className="w-9 h-9 rounded-xl bg-teal-50 dark:bg-teal-950/60 flex items-center justify-center text-teal-600 dark:text-teal-400">
            <WifiOff className="w-5 h-5" />
          </div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            3. Único tráfico de red externo
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            El único acceso a la red que realiza la aplicación es la descarga inicial de los pesos del modelo abierto desde Hugging Face. Una vez descargado y cacheado en tu navegador, Escriba puede funcionar totalmente sin conexión a internet.
          </p>
        </div>

        <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800/80 shadow-xs space-y-2.5">
          <div className="w-9 h-9 rounded-xl bg-teal-50 dark:bg-teal-950/60 flex items-center justify-center text-teal-600 dark:text-teal-400">
            <FileLock2 className="w-5 h-5" />
          </div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            4. Control total y eliminación de datos
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            La profesional de la salud tiene el control absoluto: puede borrar selectivamente el archivo de audio tras la transcripción para liberar memoria, exportar el texto o purgar por completo la base de datos local en cualquier momento.
          </p>
        </div>
      </div>

      {/* Legal & Medical Notice */}
      <div className="p-6 rounded-3xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800/80 space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100">
          <AlertCircle className="w-4 h-4 text-amber-600" />
          <span>Consideraciones ético-legales (Ley 25.326 y consentimiento)</span>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          En la República Argentina y en la mayoría de las legislaciones hispanoamericanas, los registros orales y las historias clínicas contienen <strong>datos de salud sensibles</strong> amparados por la Ley 25.326 de Protección de los Datos Personales.
        </p>
        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          Recomendamos como buena práctica médica solicitar el <strong>consentimiento verbal o firmado</strong> del paciente previo a la grabación, y registrar las consultas identificándolas con iniciales o códigos internos de historia clínica, evitando nombres y documentos de identidad completos en el título de la sesión.
        </p>
      </div>
    </div>
  );
};
