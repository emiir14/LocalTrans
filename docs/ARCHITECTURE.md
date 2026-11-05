# Arquitectura del Sistema - Escriba

Escriba está construida bajo los principios de **Clean Architecture** (Arquitectura Limpia) y **Privacy by Design** (Privacidad por Diseño). La lógica de negocio y las entidades de dominio son completamente agnósticas respecto al almacenamiento o la infraestructura subyacente.

---

## 1. Diagrama de Capas

```
┌──────────────────────────────────────────────────────────┐
│                     UI & VISTAS                          │
│   (HomeView, RecordingView, DetailView, SettingsView)    │
└────────────────────────────┬─────────────────────────────┘
                             │
┌────────────────────────────▼─────────────────────────────┐
│                 GESTOR DE ESTADO (Zustand)               │
│                    useAppStore.ts                        │
└──────────────┬─────────────────────────────┬─────────────┘
               │                             │
┌──────────────▼─────────────┐ ┌─────────────▼─────────────┐
│    CONTROLADOR DE AUDIO    │ │   PIPELINE TRANSCRIPCIÓN   │
│   RecordingController.ts   │ │   TranscriptionPipeline   │
│   (AudioWorklet + PCM 16k) │ │   (VAD + Whisper Worker)  │
└──────────────┬─────────────┘ └─────────────┬─────────────┘
               │                             │
┌──────────────▼─────────────────────────────▼─────────────┐
│                   INTERFACES DE DOMINIO                  │
│  ISessionRepository, ITranscriptRepository, IAudioStore  │
│          IAuthProvider, IGlossaryRepository              │
└──────────────┬─────────────────────────────┬─────────────┘
               │                             │
┌──────────────▼─────────────┐ ┌─────────────▼─────────────┐
│       ADAPTADOR LOCAL      │ │     ADAPTADOR SUPABASE    │
│       (ACTIVO POR DEFECTO) │ │         (ESQUELETO)       │
│      Dexie.js (IndexedDB)  │ │      Solo texto y meta    │
│    (Audio + Texto + Config)│ │       (CERO AUDIO)        │
└────────────────────────────┘ └───────────────────────────┘
```

---

## 2. Descripción de Capas

### A. Capa de Dominio (`src/core/`)
- **`types.ts`:** Entidades centrales: `Workspace`, `Profile`, `Session`, `AudioChunk`, `TranscriptSegment`, `AppSettings`, `GlossaryEntry`.
- **`interfaces.ts`:** Contratos de repositorios y servicios (`ISessionRepository`, `ITranscriptRepository`, `IAudioStore`, `IAuthProvider`, `ITranscriptionEngine`).
- **`export/`:** Exportadores a formatos estándar (`txt`, `md`, `srt`, `json`, y contexto formateado para LLMs).

### B. Capa de Audio y Transcripción (`src/core/audio/` y `src/core/transcription/`)
- **`recordingController.ts`:** Orquesta la captura mediante `AudioWorklet`, administra el Screen Wake Lock, calcula métricas VU y guarda bloques PCM cada 30 segundos en IndexedDB.
- **`vad.ts`:** Segmentador de voz clínico con estimación dinámica del piso de ruido (aislando ruidos continuos de eyector de saliva).
- **`whisperWorker.ts`:** Web Worker que ejecuta `@huggingface/transformers` en WebGPU o WASM sin bloquear la interfaz.
- **`corruptionHeuristics.ts`:** Detección de fallos en GPU y reinicio automático en WASM.

### C. Capa de Adaptadores (`src/adapters/`)
- **`local/`:** Implementación activa basada en Dexie.js (IndexedDB). Almacena tanto el audio fragmentado como las notas y configuración.
- **`supabase/`:** Esqueleto preparado para multi-consultorio y sincronización en la nube exclusivamente para textos y metadatos. **El audio nunca se sincroniza**.

---

## 3. Modelo de Datos Multi-Consultorio

Aunque hoy la aplicación funciona en modo local monousuario:
1. Todos los registros contienen `workspaceId`, `createdAt`, `updatedAt` y `deletedAt` (borrado lógico).
2. El acceso a datos nunca presupone usuario único: siempre consulta `authProvider.getCurrentWorkspace()`.
3. Esto permite transformar Escriba en una plataforma multi-clínica SaaS sin refactorizar los repositorios ni la interfaz de usuario.

---

## 4. Guía Paso a Paso para Activar la Nube (Supabase)

Para habilitar sincronización en la nube entre múltiples terminales de un consultorio:

1. **Paso 1: Aplicar la migración SQL en Supabase**
   - Ejecutar el script provisto en `supabase/migrations/0001_init.sql`.
   - Este script crea las tablas `workspaces`, `memberships` (roles: `owner`, `dentist`, `assistant`), `sessions`, `transcript_segments` y `glossary_entries`, configurando Row Level Security (RLS) estricto por pertenencia al workspace.
   - **Nota de seguridad:** El script no contiene ninguna tabla ni bucket para audio.

2. **Paso 2: Conectar el cliente de Supabase**
   - Configurar en `.env`:
     ```bash
     VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
     VITE_SUPABASE_ANON_KEY=tu-anon-key
     VITE_MODE=cloud
     ```
   - Instalar `@supabase/supabase-js`.

3. **Paso 3: Conmutar el contenedor de dependencias**
   - En `src/store/useAppStore.ts`, conmutar la instanciación de los repositorios según `import.meta.env.VITE_MODE`:
     - Si `VITE_MODE === 'cloud'`: usar `SupabaseSessionRepository` y `SupabaseTranscriptRepository`.
     - `audioStore` permanece **siempre** asignado a `LocalAudioStore` (el audio permanece local).

4. **Paso 4: Habilitar autenticación de operadores**
   - Implementar la pantalla de inicio de sesión de Supabase Auth conectada a `SupabaseAuthProvider`.
   - Los odontólogos y asistentes verán únicamente las sesiones pertenecientes a su `workspaceId`.
