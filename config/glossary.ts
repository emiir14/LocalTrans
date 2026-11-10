/**
 * Initial Dental Glossary for Escriba
 * Post-processes transcribed text to correct common dental terminology misspellings.
 */

export interface DentalGlossaryPair {
  incorrect: string;
  correct: string;
}

export const DEFAULT_DENTAL_GLOSSARY: DentalGlossaryPair[] = [
  // Endodoncia y Terapia Pulpar
  { incorrect: 'conducto metría', correct: 'conductometría' },
  { incorrect: 'conducto métrica', correct: 'conductometría' },
  { incorrect: 'conductometria', correct: 'conductometría' },
  { incorrect: 'endo dóncea', correct: 'endodoncia' },
  { incorrect: 'guta percha', correct: 'gutapercha' },
  { incorrect: 'guta-percha', correct: 'gutapercha' },
  { incorrect: 'gutaperca', correct: 'gutapercha' },
  { incorrect: 'pulpec tomía', correct: 'pulpectomía' },
  { incorrect: 'pulpectomia', correct: 'pulpectomía' },
  { incorrect: 'pulpo tomía', correct: 'pulpotomía' },
  { incorrect: 'pulpotomia', correct: 'pulpotomía' },
  { incorrect: 'bio pulpectomía', correct: 'biopulpectomía' },
  { incorrect: 'biopulpectomia', correct: 'biopulpectomía' },
  { incorrect: 'cámara pulpa', correct: 'cámara pulpar' },
  { incorrect: 'peri apical', correct: 'periapical' },
  { incorrect: 'periapicales', correct: 'periapical' },
  { incorrect: 'ápice radicular', correct: 'ápice radicular' },
  { incorrect: 'apice radicular', correct: 'ápice radicular' },
  { incorrect: 'foramen apical', correct: 'foramen apical' },
  { incorrect: 'localizador de ápice', correct: 'localizador apical' },
  { incorrect: 'lima ka', correct: 'lima K' },
  { incorrect: 'lima hedstrom', correct: 'lima Hedström' },
  { incorrect: 'lima hedtrom', correct: 'lima Hedström' },
  { incorrect: 'hipo clorito', correct: 'hipoclorito de sodio' },
  { incorrect: 'sellador endodóntico', correct: 'sellador endodóntico' },
  { incorrect: 'cemento sellador', correct: 'sellador endodóntico' },

  // Operatoria, Restauración y Estética
  { incorrect: 'ama la gama', correct: 'amalgama' },
  { incorrect: 'amal gama', correct: 'amalgama' },
  { incorrect: 'canilla de porcelana', correct: 'carilla de porcelana' },
  { incorrect: 'canilla estética', correct: 'carilla estética' },
  { incorrect: 'canilla dental', correct: 'carilla dental' },
  { incorrect: 'composi', correct: 'composite' },
  { incorrect: 'composito', correct: 'composite' },
  { incorrect: 'conposite', correct: 'composite' },
  { incorrect: 'resina flow', correct: 'resina flow' },
  { incorrect: 'grabado acido', correct: 'grabado ácido' },
  { incorrect: 'ácido grabador', correct: 'ácido grabador' },
  { incorrect: 'ácido ortofosfórico', correct: 'ácido ortofosfórico' },
  { incorrect: 'ortofosforico', correct: 'ácido ortofosfórico' },
  { incorrect: 'ionómero vítreo', correct: 'ionómero vítreo' },
  { incorrect: 'ionomero vitreo', correct: 'ionómero vítreo' },
  { incorrect: 'ionómero de vidrio', correct: 'ionómero vítreo' },
  { incorrect: 'in lay', correct: 'inlay' },
  { incorrect: 'on lay', correct: 'onlay' },
  { incorrect: 'over lay', correct: 'overlay' },
  { incorrect: 'incrustación inlay', correct: 'incrustación inlay' },
  { incorrect: 'incrustación onlay', correct: 'incrustación onlay' },
  { incorrect: 'incrustación overlay', correct: 'incrustación overlay' },
  { incorrect: 'perno de fibra', correct: 'perno de fibra de vidrio' },
  { incorrect: 'poste de fibra', correct: 'poste de fibra de vidrio' },
  { incorrect: 'foto curado', correct: 'fotocurado' },
  { incorrect: 'fotopolimerización', correct: 'fotopolimerización' },
  { incorrect: 'fotopolimerizacion', correct: 'fotopolimerización' },
  { incorrect: 'dique de goma', correct: 'dique de goma' },
  { incorrect: 'matriz seccional', correct: 'matriz seccional' },
  { incorrect: 'banda matriz', correct: 'banda matriz' },
  { incorrect: 'cuña de madera', correct: 'cuña de madera' },
  { incorrect: 'fresa de diamante', correct: 'fresa de diamante' },
  { incorrect: 'fresa de carburo', correct: 'fresa de carburo' },

  // Periodoncia y Profilaxis
  { incorrect: 'sin civitis', correct: 'gingivitis' },
  { incorrect: 'sincivitis', correct: 'gingivitis' },
  { incorrect: 'jinjivitis', correct: 'gingivitis' },
  { incorrect: 'periodon titis', correct: 'periodontitis' },
  { incorrect: 'profi laxis', correct: 'profilaxis' },
  { incorrect: 'culetaje', correct: 'curetaje' },
  { incorrect: 'curetaje subgingival', correct: 'curetaje subgingival' },
  { incorrect: 'tartago', correct: 'tártaro' },
  { incorrect: 'tartaro dental', correct: 'tártaro dental' },
  { incorrect: 'tartrectomía', correct: 'tartrectomía' },
  { incorrect: 'tartrectomia', correct: 'tartrectomía' },
  { incorrect: 'detartraje', correct: 'detartraje' },
  { incorrect: 'raspaje y alisado', correct: 'raspaje y alisado radicular (RAR)' },
  { incorrect: 'raspado y alisado', correct: 'raspaje y alisado radicular (RAR)' },
  { incorrect: 'bolsa periodontal', correct: 'bolsa periodontal' },
  { incorrect: 'surco gingival', correct: 'surco gingival' },
  { incorrect: 'recesión gingival', correct: 'recesión gingival' },
  { incorrect: 'recesion gingival', correct: 'recesión gingival' },
  { incorrect: 'encía insertada', correct: 'encía insertada' },
  { incorrect: 'encía queratinizada', correct: 'encía queratinizada' },
  { incorrect: 'alargamiento coronario', correct: 'alargamiento coronario' },
  { incorrect: 'ferulización periodontal', correct: 'ferulización periodontal' },

  // Cirugía y Exodoncia
  { incorrect: 'exo doncia', correct: 'exodoncia' },
  { incorrect: 'esodoncia', correct: 'exodoncia' },
  { incorrect: 'odonto sección', correct: 'odontosección' },
  { incorrect: 'odontoseccion', correct: 'odontosección' },
  { incorrect: 'ostec tomía', correct: 'ostectomía' },
  { incorrect: 'ostectomia', correct: 'ostectomía' },
  { incorrect: 'sindes motomía', correct: 'sindesmotomía' },
  { incorrect: 'sindesmotomia', correct: 'sindesmotomía' },
  { incorrect: 'alveolo seco', correct: 'alveolitis seca' },
  { incorrect: 'alveolitis', correct: 'alveolitis' },
  { incorrect: 'elevador recto', correct: 'elevador recto' },
  { incorrect: 'botador recto', correct: 'elevador recto' },
  { incorrect: 'cureta de lucas', correct: 'cureta de Lucas' },
  { incorrect: 'cureta lucas', correct: 'cureta de Lucas' },
  { incorrect: 'sutura vicryl', correct: 'sutura Vicryl' },
  { incorrect: 'sutura vicril', correct: 'sutura Vicryl' },
  { incorrect: 'seda negra', correct: 'seda negra' },
  { incorrect: 'pericoronaritis', correct: 'pericoronaritis' },
  { incorrect: 'peri coronaritis', correct: 'pericoronaritis' },
  { incorrect: 'tercer molar', correct: 'tercer molar' },
  { incorrect: 'muela de juicio', correct: 'tercer molar' },

  // Prótesis, Oclusión y ATM
  { incorrect: 'corona de zirconio', correct: 'corona de circonio' },
  { incorrect: 'zirconia dental', correct: 'circonio dental' },
  { incorrect: 'corona ceramometálica', correct: 'corona metalocerámica' },
  { incorrect: 'metalo cerámica', correct: 'metalocerámica' },
  { incorrect: 'sobredentadura', correct: 'sobredentadura' },
  { incorrect: 'sobre dentadura', correct: 'sobredentadura' },
  { incorrect: 'prótesis removible', correct: 'prótesis removible' },
  { incorrect: 'cubeta individual', correct: 'cubeta individual' },
  { incorrect: 'alginato dental', correct: 'alginato dental' },
  { incorrect: 'silicona de adición', correct: 'silicona de adición' },
  { incorrect: 'silicona de condensación', correct: 'silicona de condensación' },
  { incorrect: 'registro de mordida', correct: 'registro de mordida' },
  { incorrect: 'arco facial', correct: 'arco facial' },
  { incorrect: 'relación céntrica', correct: 'relación céntrica' },
  { incorrect: 'dimensión vertical', correct: 'dimensión vertical de oclusión' },
  { incorrect: 'grujismo', correct: 'bruxismo' },
  { incorrect: 'brucsismo', correct: 'bruxismo' },
  { incorrect: 'brujismo', correct: 'bruxismo' },
  { incorrect: 'placa miorelajante', correct: 'placa miorrelajante' },
  { incorrect: 'placa de relajación', correct: 'placa miorrelajante' },

  // Implantología
  { incorrect: 'osteo integración', correct: 'osteointegración' },
  { incorrect: 'osteointegracion', correct: 'osteointegración' },
  { incorrect: 'implante de titanio', correct: 'implante de titanio' },
  { incorrect: 'lecho implantario', correct: 'lecho implantario' },
  { incorrect: 'pilar de cicatrización', correct: 'pilar de cicatrización' },
  { incorrect: 'tornillo de cicatrización', correct: 'pilar de cicatrización' },
  { incorrect: 'transfer de impresión', correct: 'transfer de impresión' },
  { incorrect: 'análogo de implante', correct: 'análogo de implante' },
  { incorrect: 'analogo de implante', correct: 'análogo de implante' },
  { incorrect: 'guía quirúrgica', correct: 'guía quirúrgica' },
  { incorrect: 'regeneración ósea', correct: 'regeneración ósea guiada' },
  { incorrect: 'membrana reabsorbible', correct: 'membrana reabsorbible' },
  { incorrect: 'elevación de seno maxilar', correct: 'elevación de seno maxilar' },

  // Ortodoncia
  { incorrect: 'braquet', correct: 'bracket' },
  { incorrect: 'braquets', correct: 'brackets' },
  { incorrect: 'brakets', correct: 'brackets' },
  { incorrect: 'alambre de niti', correct: 'alambre de NiTi' },
  { incorrect: 'arco de niti', correct: 'arco de NiTi' },
  { incorrect: 'arco lingual', correct: 'arco lingual' },
  { incorrect: 'diastemas', correct: 'diastema' },
  { incorrect: 'mal oclusión', correct: 'maloclusión' },
  { incorrect: 'maloclusion', correct: 'maloclusión' },
  { incorrect: 'mordida cruzada', correct: 'mordida cruzada' },
  { incorrect: 'mordida abierta', correct: 'mordida abierta' },

  // Farmacología y Anestesia Odontológica
  { incorrect: 'anestesia troncular', correct: 'anestesia troncular' },
  { incorrect: 'anestesia infiltrativa', correct: 'anestesia infiltrativa' },
  { incorrect: 'lidocaina con epinefrina', correct: 'lidocaína con epinefrina' },
  { incorrect: 'mepivacaina', correct: 'mepivacaína' },
  { incorrect: 'mepivacaína al 3%', correct: 'mepivacaína al 3%' },
  { incorrect: 'carpule', correct: 'carpule' },
  { incorrect: 'carpules', correct: 'carpules' },
  { incorrect: 'amoxi clavulánico', correct: 'amoxicilina con ácido clavulánico' },
  { incorrect: 'amoxicilina clavulanico', correct: 'amoxicilina con ácido clavulánico' },
  { incorrect: 'azitromisina', correct: 'azitromicina' },
  { incorrect: 'clonixinato de lisina', correct: 'clonixinato de lisina' },
  { incorrect: 'clorhexidina al 0.12', correct: 'clorhexidina al 0.12%' },
  { incorrect: 'clorhexidina 0.12', correct: 'clorhexidina al 0.12%' },

  // Anatomía, Caras Dentarias y Diagnóstico
  { incorrect: 'resina oclusal', correct: 'resina oclusal' },
  { incorrect: 'cara mesial', correct: 'cara mesial' },
  { incorrect: 'cara distal', correct: 'cara distal' },
  { incorrect: 'cara vestibular', correct: 'cara vestibular' },
  { incorrect: 'cara palatina', correct: 'cara palatina' },
  { incorrect: 'cara lingual', correct: 'cara lingual' },
  { incorrect: 'odontogram', correct: 'odontograma' },
  { incorrect: 'floración dental', correct: 'fluoración dental' },
  { incorrect: 'amnesis', correct: 'anamnesis' },
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
