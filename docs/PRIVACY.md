# Política de Privacidad y Modelo de Consentimiento - Escriba

> **AVISO LEGAL OBLIGATORIO:** Este documento es una base técnica y orientativa. Todos los pasajes marcados como **[REVISIÓN LEGAL REQUERIDA]** deben ser auditados y adaptados por un profesional del derecho matriculado según la jurisdicción específica donde opere el consultorio (en particular, la Ley N° 25.326 de Protección de los Datos Personales de la República Argentina y normativas de colegios odontológicos provinciales).

---

## 1. Declaración de Principios de Privacidad por Diseño

1. **Inexistencia de Servidor Central de Audio:** Escriba no cuenta con servidores donde se almacenen grabaciones de voz ni transcripciones de consultas.
2. **Procesamiento Exclusivamente Local:** La captura del micrófono, la segmentación y la transcripción mediante modelos Whisper se ejecutan dentro del navegador del usuario en el dispositivo físico de la profesional.
3. **Descarga Unidireccional de Pesos:** El único intercambio con internet consiste en la descarga de los archivos de modelo de Whisper desde el repositorio público de Hugging Face. Ningún dato del consultorio es transmitido hacia Hugging Face ni hacia terceros.

---

## 2. [REVISIÓN LEGAL REQUERIDA] Texto Sugerido para el Consentimiento del Paciente

*(Este texto debe ponerse a disposición del paciente de forma verbal o impresa previo a la consulta).*

> **Consentimiento Informado para el Registro de la Consulta Odontológica**
>
> Por la presente, el/la paciente autoriza a la Dra. [Nombre del Profesional], Matrícula N° [Número de Matrícula], a utilizar la aplicación **Escriba** para registrar el audio de la presente consulta con el único fin de facilitar la transcripción y confección de la Historia Clínica Odontológica.
>
> Se informa al paciente que:
> 1. El audio registrado **no se sube a internet ni a ningún servidor externo**, permaneciendo almacenado exclusivamente en la memoria del dispositivo del consultorio.
> 2. El registro es confidencial y queda sujeto al secreto profesional médico-odontológico (Art. 156 del Código Penal Argentino).
> 3. El paciente tiene derecho a revocar este consentimiento y a solicitar la eliminación inmediata de la grabación en cualquier momento.
>
> **Lugar y Fecha:** ________________________
> **Firma del Paciente / Tutor:** ________________________
> **Aclaración y DNI:** ________________________

---

## 3. [REVISIÓN LEGAL REQUERIDA] Adaptación a la Ley 25.326 (República Argentina)

Puntos críticos que el asesor legal del consultorio debe certificar:

1. **Datos de Salud como Datos Sensibles (Art. 2 y Art. 7):** La información sobre patologías orales, medicación, alergias e intervenciones quirúrgicas califica como datos sensibles. Su tratamiento exige consentimiento expreso y tutela reforzada de confidencialidad.
2. **Registro de Base de Datos ante la AAIP:** El consultorio debe verificar si corresponde inscribir la base de datos de historias clínicas ante la Agencia de Acceso a la Información Pública (AAIP).
3. **Derechos de Acceso, Rectificación y Supresión (Art. 14, 15 y 16):** La odontóloga debe garantizar que ante el requerimiento del paciente se le pueda entregar copia de la transcripción o eliminar los registros almacenados (función "Borrar todos los datos" provista en Ajustes).
4. **Disociación de Datos (Recomendación Técnica Activa):** Escriba implementa de manera nativa la recomendación de usar códigos o iniciales en el campo "Referencia", evitando asociar directamente el nombre y DNI en el título de la grabación.
