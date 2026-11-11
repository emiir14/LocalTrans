/**
 * Optimized Clinical Initial Prompt for Whisper Transcription
 * Directs Whisper's language model probability distribution towards
 * Latin American / Argentine dental terminology and FDI numbering notation.
 */

export const CLINICAL_WHISPER_INITIAL_PROMPT =
  'Consulta odontológica en español con paciente. Odontólogo dictando hallazgos clínicos, diagnóstico y tratamiento. Nomenclatura dental FDI: pieza 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8; cuadrante 2: 2.1 a 2.8; cuadrante 3: 3.1 a 3.8; cuadrante 4: 4.1 a 4.8. Términos: conductometría, endodoncia, amalgama, obturación con composite, carillas estéticas, resina, caras oclusal, mesial, distal, vestibular, palatino, lingual, periodonto, periapical, gutapercha, raspaje y alisado radicular, tartrectomía, exodoncia simple y quirúrgica, implante oseointegrado, corona, prótesis fija y removible, anestesia troncular e infiltrativa con mepivacaína y lidocaína, bruxismo, surco gingival, caries de esmalte y dentina, conductos radiculares, cavidad de acceso.';
