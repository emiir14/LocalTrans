/**
 * Initial Dental Glossary for Escriba
 * Post-processes transcribed text to correct common dental terminology misspellings.
 */

export interface DentalGlossaryPair {
  incorrect: string;
  correct: string;
}

export const DEFAULT_DENTAL_GLOSSARY: DentalGlossaryPair[] = [
  { incorrect: 'conducto metría', correct: 'conductometría' },
  { incorrect: 'conducto métrica', correct: 'conductometría' },
  { incorrect: 'endo dóncea', correct: 'endodoncia' },
  { incorrect: 'endodoncia mecanizada', correct: 'endodoncia mecanizada' },
  { incorrect: 'ama la gama', correct: 'amalgama' },
  { incorrect: 'canilla de porcelana', correct: 'carilla de porcelana' },
  { incorrect: 'canilla estética', correct: 'carilla estética' },
  { incorrect: 'composi', correct: 'composite' },
  { incorrect: 'composito', correct: 'composite' },
  { incorrect: 'sin civitis', correct: 'gingivitis' },
  { incorrect: 'periodon titis', correct: 'periodontitis' },
  { incorrect: 'grujismo', correct: 'bruxismo' },
  { incorrect: 'odontogram', correct: 'odontograma' },
  { incorrect: 'profi laxis', correct: 'profilaxis' },
  { incorrect: 'culetaje', correct: 'curetaje' },
  { incorrect: 'peri apical', correct: 'periapical' },
  { incorrect: 'floración dental', correct: 'fluoración dental' },
  { incorrect: 'amnesis', correct: 'anamnesis' },
  { incorrect: 'tartago', correct: 'tártaro' },
  { incorrect: 'tártaro dental', correct: 'tártaro dental' },
  { incorrect: 'resina oclusal', correct: 'resina oclusal' },
  { incorrect: 'cara mesial', correct: 'cara mesial' },
  { incorrect: 'cara distal', correct: 'cara distal' },
  { incorrect: 'cara vestibular', correct: 'cara vestibular' },
  { incorrect: 'cara palatina', correct: 'cara palatina' },
  { incorrect: 'cara lingual', correct: 'cara lingual' },
  { incorrect: 'dique de goma', correct: 'dique de goma' },
  { incorrect: 'anestesia troncular', correct: 'anestesia troncular' },
  { incorrect: 'corona ceramometálica', correct: 'corona ceramometálica' },
  { incorrect: 'corona de zirconio', correct: 'corona de circonio' },
];

/**
 * Apply glossary transformations safely using word boundaries and case insensitivity
 */
export function applyGlossary(text: string, glossary: DentalGlossaryPair[]): string {
  if (!text || glossary.length === 0) return text;

  let processed = text;
  for (const item of glossary) {
    if (!item.incorrect || !item.correct) continue;
    // Escape regex special chars
    const escaped = item.incorrect.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
    processed = processed.replace(regex, (match) => {
      // Preserve uppercase if original was capitalized
      if (match[0] === match[0].toUpperCase()) {
        return item.correct.charAt(0).toUpperCase() + item.correct.slice(1);
      }
      return item.correct;
    });
  }

  return processed;
}
