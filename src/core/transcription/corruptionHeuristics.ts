/**
 * WebGPU Output Corruption Heuristics
 * Detects known ONNX export failure modes (e.g. on certain Apple Silicon/Chrome GPUs)
 * such as endless token repetition loops, non-Spanish glyph storms, or blank outputs.
 */

export interface CorruptionCheckResult {
  isCorrupt: boolean;
  reason?: string;
  metric?: number;
}

export function detectCorruptOutput(
  text: string,
  options: { hasVoiceSignal?: boolean } = {}
): CorruptionCheckResult {
  const trimmed = text.trim();

  // 1. Voice detected by VAD but model outputs totally empty text
  if (options.hasVoiceSignal && trimmed.length === 0) {
    return {
      isCorrupt: true,
      reason: 'Salida vacía a pesar de señal de voz clara.',
      metric: 0,
    };
  }

  if (trimmed.length === 0) {
    return { isCorrupt: false };
  }

  // 2. Proportion of non-Spanish Latin characters
  // Valid characters: standard Spanish letters (a-z, A-Z, á, é, í, ó, ú, ü, ñ, ¿, ¡), numbers, punctuation and spaces
  const totalChars = trimmed.length;
  const spanishAndAsciiPattern = /[a-zA-Z0-9\sáéíóúüñÁÉÍÓÚÜÑ.,!?:;¡¿"'\-–—()[\]/°%]/g;
  const validMatches = trimmed.match(spanishAndAsciiPattern) || [];
  const validCharRatio = validMatches.length / totalChars;

  if (validCharRatio < 0.65 && totalChars > 15) {
    return {
      isCorrupt: true,
      reason: `Proporción anómala de caracteres no españoles (${Math.round((1 - validCharRatio) * 100)}%).`,
      metric: validCharRatio,
    };
  }

  // 3. Extreme character repetition loops (e.g., "aaaaaaaaaaaa", "?????????")
  if (/(.)\1{12,}/.test(trimmed)) {
    return {
      isCorrupt: true,
      reason: 'Bucle extremo de repetición de caracteres.',
    };
  }

  // 4. Extreme word loop (same word repeated consecutively 6+ times)
  const words = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length >= 6) {
    let maxConsecutiveSameWord = 1;
    let currentStreak = 1;
    for (let i = 1; i < words.length; i++) {
      if (words[i] === words[i - 1]) {
        currentStreak++;
        if (currentStreak > maxConsecutiveSameWord) {
          maxConsecutiveSameWord = currentStreak;
        }
      } else {
        currentStreak = 1;
      }
    }

    if (maxConsecutiveSameWord >= 6) {
      return {
        isCorrupt: true,
        reason: `Bucle repetitivo de palabra ("${words[0]}" repetida ${maxConsecutiveSameWord} veces).`,
        metric: maxConsecutiveSameWord,
      };
    }
  }

  return { isCorrupt: false };
}
