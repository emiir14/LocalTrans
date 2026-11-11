/**
 * Spanish Whisper Hallucination Filter List & Repetition Rules
 * Whisper frequently hallucinates standard subtitle credits or youtube phrases
 * when audio contains silence, continuous suction noise, or dental handpiece frequencies.
 */

export const KNOWN_HALLUCINATIONS: string[] = [
  'gracias por ver el video',
  'gracias por ver el vídeo',
  'gracias por ver este video',
  'gracias por su atención',
  'muchas gracias por ver',
  'suscríbete a mi canal',
  'suscribete al canal',
  'dale like y suscríbete',
  'subtítulos por la comunidad de amara.org',
  'subtítulos realizados por la comunidad de amara.org',
  'subtitulado por',
  'subtitulos por',
  'traducción de',
  'más información en',
  'hasta la próxima',
  'nos vemos en el próximo video',
  'chao chao',
  'adiós',
  'bye bye',
  'www.',
  'http',
  'transcrito por',
  'transcripción por',
  'copyright',
  'todos los derechos reservados',
];

/**
 * Checks if a transcribed text matches a known hallucination phrase
 */
export function isHallucination(text: string): boolean {
  const clean = (s: string) => s.toLowerCase().trim().replace(/[.,!?:;¡¿"'\-–—]/g, '');
  const normalized = clean(text);
  if (!normalized) return true;

  // Exact or contained hallucination pattern
  for (const phrase of KNOWN_HALLUCINATIONS) {
    const normPhrase = clean(phrase);
    if (normalized === normPhrase || (normalized.length < normPhrase.length + 15 && normalized.includes(normPhrase))) {
      return true;
    }
  }

  // Check for severe character repetition (e.g. "aaaaa", ".....")
  if (/(.)\1{5,}/.test(normalized)) {
    return true;
  }

  // Check for sliding-window n-gram loops anywhere in the sentence (1 to 5 word patterns)
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length >= 6) {
    // 1. Unique word ratio check: repetitive loop degenerate text has very few unique words
    if (words.length >= 10) {
      const uniqueWords = new Set(words);
      const diversity = uniqueWords.size / words.length;
      if (diversity < 0.4) {
        return true;
      }
    }

    // 2. Sliding window check: detects repetition starting at any offset
    for (let n = 1; n <= 5; n++) {
      for (let i = 0; i <= words.length - n * 3; i++) {
        const pattern = words.slice(i, i + n).join(' ');
        const second = words.slice(i + n, i + n * 2).join(' ');
        const third = words.slice(i + n * 2, i + n * 3).join(' ');
        if (pattern === second && second === third) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Checks if a segment is identical or near-identical to the previous segment
 */
export function isConsecutiveDuplicate(currentText: string, previousText?: string): boolean {
  if (!previousText) return false;
  const curr = currentText.toLowerCase().trim().replace(/[.,!?:;¡¿"'-]/g, '');
  const prev = previousText.toLowerCase().trim().replace(/[.,!?:;¡¿"'-]/g, '');
  return curr.length > 3 && curr === prev;
}
