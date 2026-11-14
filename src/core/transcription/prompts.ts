import { TranscriptionMode } from '../types';

/**
 * Whisper Prompts for Escriba
 * Directs Whisper's probability distribution toward either clinical dental vocabulary
 * or neutral Rioplatense conversational Spanish, plus rolling previous-segment context.
 */

export const CLINICAL_WHISPER_INITIAL_PROMPT =
  'Conversación clínica odontológica en español rioplatense. Buen día, revisamos la pieza 36, evaluamos caries oclusal, endodoncia o composite y registramos las indicaciones.';

export const GENERAL_WHISPER_INITIAL_PROMPT =
  'Conversación natural en español rioplatense con palabras claras y puntuación correcta.';

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
