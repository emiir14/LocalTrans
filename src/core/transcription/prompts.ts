import { TranscriptionMode } from '../types';

/**
 * Whisper Prompts for Escriba
 * Directs Whisper's probability distribution toward either clinical dental vocabulary
 * or neutral Rioplatense conversational Spanish, plus rolling previous-segment context.
 */

export const CLINICAL_WHISPER_INITIAL_PROMPT =
  'Consulta odontológica en español rioplatense. Odontólogo dictando hallazgos, diagnóstico y tratamiento. Piezas FDI 1.1 a 4.8. Términos: conductometría, endodoncia, amalgama, composite, carillas, resina, oclusal, mesial, distal, vestibular, palatino, lingual, periodonto, periapical, gutapercha, tartrectomía, exodoncia, implante, corona, prótesis, anestesia, mepivacaína, lidocaína, bruxismo, caries.';

export const GENERAL_WHISPER_INITIAL_PROMPT =
  'Conversación espontánea en español rioplatense con modismos argentinos, charlas cotidianas, juegos, trabajo o reuniones. Transcripción fiel palabra por palabra con puntuación natural.';

/**
 * Builds a bounded prompt combining domain context with the tail of the previous segment
 * so Whisper maintains sentence continuity across VAD chunks.
 */
export function buildSegmentPrompt(mode: TranscriptionMode = 'dental', previousText?: string): string {
  const basePrompt =
    mode === 'general' ? GENERAL_WHISPER_INITIAL_PROMPT : CLINICAL_WHISPER_INITIAL_PROMPT;

  const trimmedPrev = (previousText || '').trim().replace(/\s+/g, ' ');
  if (!trimmedPrev) {
    return basePrompt;
  }

  // Keep the last ~150 characters of previous transcribed text to preserve rolling context
  const rollingTail = trimmedPrev.length > 150 ? trimmedPrev.slice(-150).replace(/^\S*\s+/, '') : trimmedPrev;
  if (!rollingTail) {
    return basePrompt;
  }

  return `${basePrompt} ${rollingTail}`;
}
