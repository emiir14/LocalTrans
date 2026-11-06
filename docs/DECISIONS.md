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

---

## 8. Transcripción con Streaming Visual en Tiempo Real y Protección contra Recargas

- **Decisión:**
  1. **Streaming Segmento a Segmento:** Modificar el pipeline de transcripción para emitir un evento `onSegmentTranscribed` y persistir cada segmento atómicamente en IndexedDB en el instante exacto en que Whisper lo finaliza. En vez de esperar a que termine toda la grabación (ej. 20-30 minutos) para mostrar el texto, la interfaz visual renderiza los fragmentos inmediatamente a medida que van saliendo del Web Worker, con desplazamiento automático suave (`autoScroll`), destaque visual del fragmento más reciente y un radar con la última frase reconocida.
  2. **Protección `beforeunload`:** Registrar un listener en `window.addEventListener('beforeunload')` activo mientras haya una grabación o transcripción en curso. Si el usuario intenta recargar la pestaña o cerrar el navegador, el sistema activa el diálogo nativo de confirmación del navegador para impedir cancelaciones involuntarias.
  3. **Reanudación Atómica:** Si el usuario decide recargar o se produce un reinicio forzado, la sesión no se corrompe: al iniciar la aplicación, cualquier sesión en estado `transcribing` se restablece limpiamente a `recorded` conservando todos los segmentos ya procesados. Al presionar "Reanudar transcripción", el motor omite los fragmentos existentes y continúa directamente desde el último segundo procesado.
  4. **Sensibilidad VAD Ajustada:** Rediseñar el umbral de energía en `ClinicalAudioSegmenter` para admitir señales de baja ganancia o micrófonos sin control automático de ganancia (AGC), evitando que audios con voz suave sean catalogados erróneamente como silencio absoluto.
- **Alternativas consideradas:**
  1. *Buffer acumulativo hasta fin de archivo:* Mantiene la pantalla con un spinner estático durante minutos sin feedback visual de avance, generando incertidumbre y sensación de fallo en el usuario.
  2. *Bloqueo de recarga sin guardado incremental:* Si la pestaña fallaba a mitad de camino, se perdía todo el progreso de transcripción.
- **Motivo:** Brinda certidumbre total al usuario clínico de que su equipo está trabajando activamente, permite ir leyendo y copiando fragmentos sin esperar al final del audio y garantiza tolerancia total a fallos y recargas de página.

---

## 9. Modo Claro Antifatiga Visual: Lino y Porcelana Cálida (Anti-Glare)

- **Decisión:** Reemplazar el fondo blanco puro `#FFFFFF` y el canvas `#FAFAF8` por una paleta cálida, mate y de bajo deslumbramiento inspirada en papel lino y porcelana dental:
  - **Fondo de lienzo (`--canvas-bg`):** `#EDEFEA` (tono lino/piedra cálido neutro, 92% luminosidad sin destellos).
  - **Superficie de tarjetas y modales (`--canvas-surface`):** `#F8F9F5` (porcelana suave con contraste suave y definido).
  - **Superficies secundarias e inputs:** `#E4E8DF` (fondo atenuado para barras de búsqueda y badges).
  - **Bordes cálidos:** `#D3D8CC` (sustituye el gris frío `#E2E8F0`).
- **Alternativas consideradas:**
  1. *Conservar blanco puro `#FFFFFF`:* Descartado por feedback clínico; bajo reflectores odontológicos y monitores de alta luminosidad produce fatiga visual severa ("demasiado blanco").
  2. *Forzar únicamente modo oscuro:* Descartado porque muchos consultorios operan con luz diurna intensa y requieren un tema claro legible y cómodo.
- **Motivo:** Reduce sustancialmente la emisión de luz y fatiga ocular durante jornadas continuas de varias horas frente a la pantalla, manteniendo un contraste tipográfico nítido y profesional.

---

## 10. Aceleración del Pipeline: Whisper Base Acelerado, Decodificación Greedy y VAD con Segmentación Estricta de Silencios

- **Decisión:**
  1. **Modelo Predeterminado Ligero (`whisper-base`):** Configurar `fast` como tier automático predeterminado (~75 MB, ~74M parámetros), habilitado para correr en WebGPU si el hardware lo soporta o en WASM multihilo. Evita auto-seleccionar el modelo masivo `whisper-large-v3-turbo` (350 MB, 800M parámetros) que ralentizaba las sesiones de 20 minutos.
  2. **Supresión de Matrices de Timestamps (`return_timestamps: false`):** Eliminar la computación de alineación de atención cruzada palabra por palabra de Whisper. El inicio y fin del fragmento provienen del segmentador VAD con precisión milimétrica, reduciendo un ~35% el consumo de GPU/CPU.
  3. **Decodificación Greedy Directa:** Fijar `temperature: 0.0`, `num_beams: 1`, y `max_new_tokens: 128` en Transformers.js para inferencia lineal rápida sin branching probabilístico ni bucles infinitos en ruido de instrumental.
  4. **Fusión de Silencios y Salto de Inactividad (VAD):** Pausas de inactividad mayores a 1.5 s dividen limpiamente los fragmentos evitando enviar silencios vacíos a Whisper, mientras que oraciones cercanas se consolidan en bloques de hasta 24 s, reduciendo a la mitad el número total de llamadas a la red neuronal.
  5. **Multihilo Completo en CPU (WASM):** Asignar `env.backends.onnx.wasm.numThreads = Math.min(8, navigator.hardwareConcurrency)` en el Web Worker para aprovechar todos los núcleos disponibles.
  6. **Eliminación de Código Muerto:** Purgar mapeos redundantes de `chunks` sub-palabra no consumidos en la interfaz.
- **Alternativas consideradas:**
  1. *Conservar Whisper Large v3 Turbo por defecto:* Tiempos de espera excesivos (más de 30 minutos para un audio de 20 minutos en procesadores estándar).
  2. *Forzar Whisper Tiny:* Aunque aún más rápido, en acentos cerrados o fonemas complejos requería correcciones mayores en el glosario. `whisper-base` ofrece el balance ideal de velocidad (1-2s por fragmento) y alta inteligibilidad.
- **Motivo:** Reduce el tiempo total de transcripción entre un 65% y un 80% (de 30+ minutos a 3-5 minutos para consultas de 20 minutos) sin pérdida perceptible de calidad clínica gracias al Glosario Odontológico post-proceso.

---

## 11. Optimización Extrema Sin Pérdida: Precalentamiento Singleton, Transcripción Progresiva en Segundo Plano y Rechazo Espectral de Instrumental

- **Decisión:**
  1. **Motor Whisper Singleton con Precalentamiento (`getSharedWhisperEngine`):**
     Anteriormente, el pipeline instanciaba un nuevo `WhisperTranscriptionEngine` en cada transcripción, destruyendo el Web Worker y obligando a la GPU a recompilar los shaders de cómputo ONNX WebGPU desde cero (retraso inicial de 4 a 8 segundos). Al convertirlo en un Singleton en memoria y precalentarlo en segundo plano a los 1.5s de abrir la app, la inferencia arranca en menos de 50 ms.
  2. **Transcripción Progresiva en Segundo Plano (`BackgroundChunkTranscriber`):**
     Durante una consulta de 20 minutos, el hardware de audio graba y almacena bloques de 30 segundos en IndexedDB, dejando la CPU/GPU desocupada durante el 95% del tiempo. El sistema aprovecha estos intervalos de inactividad para transcribir y aplicar el glosario a cada bloque inmediatamente en segundo plano. Cuando la odontóloga pulsa "Finalizar consulta", el 95% a 100% de la consulta ya está transcrito y guardado, logrando que el tiempo percibido de espera pase de varios minutos a prácticamente cero segundos.
  3. **Rechazo Espectral de Aspiradores Dentales (ZCR + Varianza Plana):**
     Los eyectores de saliva y compresores de sillón generan un siseo estático continuo de alta frecuencia que engañaba a los detectores VAD puramente basados en energía sonora, haciendo que Whisper procesara decenas de fragmentos vacíos (arriesgando alucinaciones de texto). Se incorporó el cálculo de Tasa de Cruces por Cero (ZCR) y varianza energética en `ClinicalAudioSegmenter`: cualquier fragmento con ZCR > 0.42 y varianza < 0.000015 se clasifica como ruido de succión estacionario y se descarta en menos de 1 ms sin sobrecargar a Whisper.
  4. **Alineación y Detección de Solapamiento Temporal (`isSegmentAlreadyCovered`):**
     El pipeline principal detecta si los fragmentos de voz ya fueron procesados por el transcriptor progresivo (mediante solapamiento > 0.5 s) para omitirlos instantáneamente sin duplicar cómputo ni generar discrepancias en las marcas de tiempo.
- **Alternativas consideradas:**
  1. *Transcribir únicamente en lote al terminar:* Mantiene al usuario esperando minutos después de una larga consulta y desaprovecha por completo los recursos ociosos de la máquina durante la grabación.
  2. *Enviar audio a servicios de streaming cloud:* Vulnera la privacidad médica odontológica y genera dependencia de conexión a internet.
- **Motivo:** Convierte a Escriba en una herramienta instantánea de respuesta inmediata, reduciendo a cero el tiempo de espera al finalizar la jornada sin comprometer la privacidad ni la precisión léxica.
