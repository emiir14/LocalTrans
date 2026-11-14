# Escriba — Transcripción Odontológica Local y Privada

**Escriba** es una aplicación web médica progresiva (PWA) de nivel de producción diseñada para odontólogas y profesionales de la salud. Permite grabar consultas clínicas completas (de minutos a varias horas) y transcribirlas a texto en español latino **100% en el dispositivo del usuario**, sin subir jamás audio ni texto a la nube.

---

## Características Principales

- **Privacidad por diseño absoluta:** El audio y las transcripciones se procesan y almacenan exclusivamente en el navegador local (IndexedDB con Dexie.js).
- **Inferencia en el dispositivo:** Utiliza modelos abiertos Whisper de Hugging Face (`@huggingface/transformers`) ejecutándose en un Web Worker en segundo plano, con aceleración WebGPU y fallback resiliente a WebAssembly (WASM).
- **Captura robusta con AudioWorklet:** Graba en PCM Int16 mono a 16 kHz. Cada ~30 segundos se persiste un bloque atómico en disco, impidiendo la saturación de memoria RAM y garantizando recuperación ante cierres inesperados.
- **Screen Wake Lock y Telemetría en Vivo:** Mantiene la pantalla activa durante la consulta, monitorea el nivel de audio (VU meter) a 60 fps, alerta ante 30 segundos de silencio continuo y supervisa el estado de batería.
- **Segmentación con VAD Clínico:** Detector de actividad vocal adaptativo que aísla ruidos constantes de consultorio (eyector de saliva, compresor dental).
- **Filtro de Alucinaciones y Glosario Odontológico:** Elimina créditos inventados por Whisper y corrige terminología dental especializada (conductometría, obturación, amalgama, periodonto, carilla, etc.).
- **Reproductor Sincronizado y Exportación Versátil:** Al tocar cualquier segmento de texto, el reproductor salta a ese segundo exacto. Exportación a TXT, Markdown, subtítulos SRT, JSON estructurado y formato especial **"Copiar para IA"** para alimentar directamente a tu LLM de confianza.
- **PWA Instalable:** Funciona sin conexión una vez descargado el modelo, con soporte de instalación en Android, iOS (Safari) y escritorio.
- **Página de Diagnóstico `/benchmark`:** Laboratorio de latencia para evaluar modelos y backends en cualquier equipo.

---

## Requisitos Previos

- Node.js 18+ o superior.
- Navegador moderno con soporte de Web Audio y WebAssembly (Chrome, Edge, Safari, Firefox). Para aceleración gráfica, se recomienda un navegador con soporte WebGPU.

---

## Instalación y Ejecución Local

1. **Clonar e instalar dependencias:**
   ```bash
   npm install
   ```

2. **Iniciar servidor de desarrollo:**
   ```bash
   npm run dev
   ```
   Abrí `http://localhost:3000` en tu navegador.

3. **Ejecutar tests unitarios y de simulación (Vitest):**
   ```bash
   npm run test
   ```
   O con npx:
   ```bash
   npx vitest run
   ```

4. **Compilar para producción:**
   ```bash
   npm run build
   ```

---

## Despliegue en Vercel

El proyecto incluye el archivo `vercel.json` con los encabezados de seguridad requeridos para el aislamiento de hilos WASM (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`), políticas de permisos de micrófono restringidas al propio origen (`Permissions-Policy: microphone=(self)`) y Content Security Policy estricta.

Para desplegar:
```bash
npx vercel
```
O conectá el repositorio directamente en tu panel de control de Vercel (Framework Preset: **Vite**).

---

## Descargas y Firma de Código (Windows y Android)

- **Instaladores oficiales (`.exe` para Windows y `.apk` para Android):** [GitHub Releases](https://github.com/emiir14/LocalTrans/releases)
- **Política de Privacidad:** [docs/PRIVACY.md](docs/PRIVACY.md) — Escriba no recopila ni envía datos ni audio del usuario a ningún servidor externo; todo se procesa y guarda localmente en el equipo.

Free code signing on Windows provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

---

## Documentación Técnica Adicional

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): Arquitectura por capas, modelo de datos y guía de activación de la nube (Supabase).
- [docs/DECISIONS.md](docs/DECISIONS.md): Registro de decisiones arquitectónicas (ADR), alternativas evaluadas y fundamentos.
- [docs/BENCHMARK.md](docs/BENCHMARK.md): Informe de pruebas de rendimiento, factor de tiempo real y mediciones del entorno.
- [docs/PRIVACY.md](docs/PRIVACY.md): Política de privacidad médica, modelo de consentimiento informado y consideraciones sobre la Ley 25.326.
- [docs/WINDOWS_EXE_BUILD.md](docs/WINDOWS_EXE_BUILD.md): Compilación del instalador nativo para Windows (`.exe`) con Tauri v2 + `whisper.cpp`.
- [docs/ANDROID_APK_BUILD.md](docs/ANDROID_APK_BUILD.md): Compilación del paquete nativo para Android (`.apk`).
- [docs/SIGNPATH_SETUP.md](docs/SIGNPATH_SETUP.md): Integración con SignPath Foundation.
