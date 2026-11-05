# Registro de Decisiones de Arquitectura (ADR) - Escriba

Este documento registra todas las decisiones técnicas tomadas durante el desarrollo de **Escriba**, evaluando el contexto, las alternativas descartadas y el fundamento clínico/técnico de cada elección.

---

## 1. Captura de Audio: AudioWorklet con PCM Int16 16 kHz directo

- **Decisión:** Implementar un `AudioWorkletProcessor` personalizado que capture audio del micrófono, realice remuestreo lineal inmediato a 16.000 Hz mono (si el hardware opera a 44,1 kHz o 48 kHz) y convierta cada muestra float a entero de 16 bits (`Int16Array`). El worklet emite bloques de ~30 segundos directamente a IndexedDB.
- **Alternativas consideradas:**
  1. *`MediaRecorder` nativo con Opus/WebM:* Produce trozos comprimidos que no son decodificables de forma independiente si se interrumpe la conexión, y requiere decodificación en memoria al transcribir, lo que satura la RAM en sesiones de más de una hora.
  2. *Acumular Float32 en memoria del hilo principal:* A 48 kHz estéreo de 32 bits, una consulta de 2 horas consume ~1,38 GB de memoria RAM en el navegador, provocando cierres inesperados por límite de memoria (OOM).
- **Motivo:** 16 kHz Int16 mono es el estándar nativo que Whisper consume. Ocupa solo ~115 MB por hora, permite guardar bloques atómicos independientes en disco cada 30 segundos y garantiza que ante cualquier cierre abrupto de pestaña no se pierda más que los últimos segundos.

---

## 2. Motor de Transcripción: `@huggingface/transformers` en Web Worker con WebGPU + Fallback WASM

- **Decisión:** Aislar todo el proceso de inferencia de Transformers.js en un Web Worker dedicado. Intentar primero inicialización con `device: 'webgpu'`, y ante fallo de compilación de shaders o degradación detectada, degradar a WASM (`device: 'wasm'`, cuantización `q4`).
- **Alternativas consideradas:**
  1. *APIs en la nube (OpenAI Whisper, Google Speech-to-Text, AssemblyAI):* Descartadas por violación fundamental del requisito de privacidad médica y costos de suscripción recurrentes.
  2. *Whisper.cpp compilado a WASM:* Excelente velocidad, pero mantenimiento más complejo de bindings en TypeScript y menor soporte de WebGPU que Transformers.js v3.
- **Motivo:** Cumple 100% con privacidad por diseño (cero datos salen del equipo), no bloquea la interfaz de usuario durante la inferencia y aprovecha la aceleración por hardware de GPUs modernas.

---

## 3. Salvaguarda contra Salida Corrupta de WebGPU

- **Decisión:** Implementar un analizador de salida heurístico (`detectCorruptOutput`) que evalúa los primeros fragmentos procesados en WebGPU. Analiza:
  - Proporción de caracteres no pertenecientes al español/alfabeto latino (>35% de caracteres anómalos o de control).
  - Bucles de repetición de palabras consecutivas (6+ repeticiones continuas de un token).
  - Texto vacío frente a energía vocal confirmada por VAD.
  Si falla, el motor mata el Web Worker WebGPU, instancia uno en WASM y retranscribe el segmento.
- **Alternativas consideradas:**
  1. *Forzar únicamente WASM en todos los dispositivos:* Penalizaría severamente la velocidad en PCs con tarjetas gráficas dedicadas o Apple Silicon que funcionan correctamente.
  2. *Dejar la salida corrupta sin detección:* Generaría transcripciones inutilizables para la profesional sin diagnóstico claro.
- **Motivo:** Existen incompatibilidades documentadas entre ciertos controladores de GPU (como drivers Vulkan/Metal en navegadores Chromium) y los operadores de atención cuantizados de ONNX que provocan alucinaciones numéricas. La degradación automática protege la integridad del informe clínico.

---

## 4. Almacenamiento Local: Dexie.js (IndexedDB) con Separación de Chunks y Transcripciones

- **Decisión:** Modelar la base de datos con `workspaces`, `sessions`, `audioChunks`, `transcriptSegments`, `settings` y `glossary`. El audio se fragmenta en registros de `audioChunks` y nunca se almacena como un único Blob masivo.
- **Alternativas consideradas:**
  1. *`localStorage`:* Límite estricto de 5 MB, insuficiente para audio.
  2. *Origin Private File System (OPFS):* Mayor complejidad de sincronización y soporte heterogéneo en versiones móviles antiguas.
- **Motivo:** Dexie ofrece tipado estricto, soporte de consultas indexadas por sesión y rango temporal, y capacidad para almacenar cientos de megabytes de chunks de audio de forma fiable.

---

## 5. Segmentación Vocal: VAD Clínico Adaptativo

- **Decisión:** Implementar un detector de actividad vocal adaptativo basado en RMS y percentil de piso de ruido (`ClinicalAudioSegmenter`), configurado para tolerar el ruido de fondo típico de un consultorio dental (eyector de saliva, compresor, turbina).
- **Alternativas consideradas:**
  1. *Corte por tiempo fijo ciego (ej. cada 30 segundos exactos):* Corta palabras y frases a la mitad, empeorando el reconocimiento de Whisper.
  2. *Librerías VAD pesadas basadas en redes neuronales adicionales:* Aumentan el tiempo de arranque y la memoria total requerida.
- **Motivo:** Permite agrupar intervenciones habladas en bloques de hasta ~30 segundos aprovechando pausas naturales de respiración o silencio (>400 ms), con un pequeño solapamiento (250 ms) que preserva la coherencia del habla.

---

## 6. Higiene de Memoria y Post-procesamiento Dental

- **Decisión:**
  - Opción destacada para borrar el archivo de audio una vez finalizada la transcripción ("Liberar audio"), conservando intacto el texto.
  - Glosario editable de pares erróneo → correcto ejecutado en post-proceso sobre las palabras completas mediante expresiones regulares con límite de palabra (`\b`).
- **Motivo:** Los consultorios manejan almacenamiento finito en sus dispositivos. El audio ocupa ~115 MB/hora mientras que el texto de la consulta ocupa menos de 20 KB. Permitir purgar el audio tras validar la transcripción optimiza el espacio de almacenamiento.

---

## 7. Transición Continua de Jornada: Botón de 1 Toque "Siguiente Paciente"

- **Decisión:** Implementar un método `switchNextPatient()` en el controlador de grabación que permite a la odontóloga iniciar la consulta del siguiente paciente con un solo toque (con hit-box $\ge 48$ px y respuesta háptica), sin detener el hardware de audio, sin re-solicitar permisos de micrófono y sin liberar el Screen Wake Lock. El sistema cierra automáticamente la sesión anterior en estado `recorded`, resetea el temporizador para la nueva consulta e inicia de inmediato la persistencia de bloques asociados al nuevo paciente (`Consulta #2`, `Consulta #3`, etc.).
- **Alternativas consideradas:**
  1. *Detener y volver a iniciar manualmente:* Obliga a quitarse los guantes, escribir nombres o iniciales, aceptar diálogos y volver a presionar Grabar en cada turno.
  2. *Mantener una sola sesión de 8 horas corridas:* Mezcla las historias clínicas de todos los pacientes del día en un solo archivo de texto gigante, complicando la separación posterior.
- **Motivo:** Se adapta a la dinámica real del consultorio odontológico, donde las consultas se suceden una tras otra y el profesional requiere una acción inmediata con cero fricción cognitiva.
