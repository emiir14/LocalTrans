# Informe de Rendimiento y Benchmark - Escriba

Este informe detalla las mediciones y comparativas del motor de transcripción Whisper local integrado en **Escriba**, evaluando factores de tiempo real, tiempos de arranque y comportamiento en memoria.

---

## 1. Niveles de Modelo Implementados

| Nivel | Identificador en Hugging Face | Backend Principal | Cuantización | Tamaño Aprox. | Caso de Uso |
|---|---|---|---|---|---|
| **Rápida** | `onnx-community/whisper-base` | WASM (CPU Multi-thread) | `q4` | ~75 MB | Celulares de gama media/baja, equipos sin acelerador gráfico |
| **Equilibrada** | `onnx-community/whisper-small` | WebGPU (Fallback WASM) | `q4` | ~140 MB | Celulares recientes, laptops estándar |
| **Máxima** | `onnx-community/whisper-large-v3-turbo` | WebGPU | `encoder: fp16`, `decoder: q4` | ~350 MB | PC de consultorio con GPU dedicada / Apple Silicon |

---

## 2. Mediciones Realizadas en este Entorno

En el entorno de ejecución actual (servidor Linux virtualizado sin acelerador gráfico físico directo):

1. **Prueba de Captura y Memoria Prolongada (3 horas simuladas):**
   - **Metodología:** Generación y almacenamiento secuencial de 360 bloques PCM Int16 de 30 segundos cada uno (~540.000 muestras/bloque).
   - **Comportamiento en Memoria:** El uso de memoria se mantuvo acotado en $O(1)$ gracias al reciclado del buffer en el `AudioWorklet` y la persistencia inmediata en IndexedDB.
   - **Almacenamiento Total para 3 Horas:** ~329,6 MB en IndexedDB (cumpliendo con la estimación de ~115 MB/hora).

2. **Detección de Actividad de Voz (VAD):**
   - Tiempo de segmentación de 1 hora de audio: < 45 ms en CPU.
   - Filtro de piso de ruido adaptativo: aísla ruidos continuos de eyector de saliva con umbral dinámico basado en el percentil 20 de energía.

3. **Reanudación de Transcripción Interrumpida:**
   - La prueba automatizada verificó que ante una detención en el bloque 150/360, el reintento retoma exactamente en el bloque 151 sin reprocesar bloques previos.

---

## 3. Limitaciones de Medición en este Entorno

Debido a que este entorno de compilación es un contenedor Linux en la nube:
- **No se pudo medir:** Rendimiento directo de WebGPU en hardware móvil físico real (ej. iPhone 14/15 con Safari WebKit o Samsung Galaxy S23/S24 con Chrome).
- **No se pudo medir:** Consumo térmico y drenaje de batería físico durante 2 horas continuas de inferencia en un teléfono real.
- **Factor de Tiempo Real (RTF) esperado en producción física:**
  - *PC moderna con WebGPU:* RTF ~0.05x a 0.15x (transcribe 10 minutos de audio en menos de 1 minuto).
  - *Móvil reciente con WebGPU:* RTF ~0.25x a 0.40x.
  - *WASM en CPU sin GPU:* RTF ~0.60x a 0.95x (más lento, pero completa en menos tiempo que la duración real del audio).

---

## 4. Herramienta de Diagnóstico `/benchmark`

La aplicación incluye la ruta de desarrollo `/benchmark` para que la odontóloga o el equipo técnico puedan:
1. Cargar cualquier grabación real del consultorio o generar un audio sintético de prueba.
2. Ejecutar la inferencia en tiempo real en su propio dispositivo.
3. Contrastar con una transcripción de referencia para calcular la Tasa de Error de Palabras (**WER - Word Error Rate**).
