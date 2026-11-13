import { ClinicalNote, ClinicalTemplateId, Session, TranscriptSegment } from '../types';

export interface ClinicalTemplateDefinition {
  id: ClinicalTemplateId;
  label: string;
  description: string;
  defaultProcedureHint: string;
}

export const CLINICAL_TEMPLATES: ClinicalTemplateDefinition[] = [
  {
    id: 'general',
    label: 'Consulta general',
    description: 'Anamnesis, examen clínico, procedimiento y seguimiento.',
    defaultProcedureHint: 'Diagnóstico clínico, higiene o maniobras realizadas.',
  },
  {
    id: 'endodoncia',
    label: 'Endodoncia',
    description: 'Conductometría, instrumentación, irrigación y obturación.',
    defaultProcedureHint: 'Apertura, conductometría, irrigación, medicación intraconducto / obturación.',
  },
  {
    id: 'operatoria',
    label: 'Operatoria / Caries',
    description: 'Remoción de caries, aislamiento, adhesión y restauración.',
    defaultProcedureHint: 'Aislamiento, remoción de tejido cariado, protección pulpar, composite/resina.',
  },
  {
    id: 'cirugia',
    label: 'Cirugía / Implantes',
    description: 'Anestesia, exodoncia o colocación, sutura e indicaciones.',
    defaultProcedureHint: 'Técnica anestésica, exodoncia/osteotomía, sutura y hemostasia.',
  },
  {
    id: 'periodoncia',
    label: 'Periodoncia',
    description: 'Sondaje, raspaje, alisado radicular y control de placa.',
    defaultProcedureHint: 'Raspaje y alisado radicular, ultrasonido, pulido e higiene oral.',
  },
];

// Valid FDI quadrants 1-4 (permanent 1..8) and 5-8 (deciduous 1..5)
function isValidFdiCode(quad: number, tooth: number): boolean {
  if (quad >= 1 && quad <= 4) return tooth >= 1 && tooth <= 8;
  if (quad >= 5 && quad <= 8) return tooth >= 1 && tooth <= 5;
  return false;
}

/**
 * Extracts valid FDI dental piece codes from clinical Spanish text without false positives
 * (e.g. matches "1.6", "pieza 36", "elemento 4.8", "molar 26", but ignores "15 días" or "500 mg").
 */
export function extractFdiTeeth(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();

  // 1. Dotted FDI like 1.6, 2.4, 4.8 (avoid decimals in mg/ml/mm by checking boundary & tooth range)
  const dottedRegex = /(?:^|[\s(,;:])([1-8])\.([1-8])(?=$|[\s).,;:!?])/g;
  let match: RegExpExecArray | null;
  while ((match = dottedRegex.exec(text)) !== null) {
    const q = parseInt(match[1], 10);
    const t = parseInt(match[2], 10);
    if (isValidFdiCode(q, t)) {
      found.add(`${q}.${t}`);
    }
  }

  // 2. Contextual FDI like "pieza 16", "piezas 16 y 17", "elemento 48", "diente 21", "molar 36"
  const contextRegex =
    /\b(?:pieza|piezas|elemento|elementos|diente|dientes|molar|premolar|incisivo|canino|implante|conducto|corona|raíz|raiz)\s+(?:n[°º.]?\s*)?([1-8])\.?([1-8])(?:\s*(?:,|y|e|-)\s*([1-8])\.?([1-8]))?/gi;
  while ((match = contextRegex.exec(text)) !== null) {
    const q1 = parseInt(match[1], 10);
    const t1 = parseInt(match[2], 10);
    if (isValidFdiCode(q1, t1)) {
      found.add(`${q1}.${t1}`);
    }
    if (match[3] && match[4]) {
      const q2 = parseInt(match[3], 10);
      const t2 = parseInt(match[4], 10);
      if (isValidFdiCode(q2, t2)) {
        found.add(`${q2}.${t2}`);
      }
    }
  }

  return Array.from(found).sort();
}

/**
 * Builds a structured clinical note draft 100% locally from transcript segments.
 */
export function buildDraftClinicalNote(
  segments: TranscriptSegment[],
  templateId: ClinicalTemplateId = 'general'
): ClinicalNote {
  const fullText = segments.map((s) => s.text).join(' ');
  const detectedTeeth = extractFdiTeeth(fullText);

  const patientLines: string[] = [];
  const findingsLines: string[] = [];
  const procedureLines: string[] = [];
  const indicationsLines: string[] = [];
  const nextVisitLines: string[] = [];

  const medicationOrCareRegex =
    /\b(ibuprofeno|amoxicilina|azitromicina|ketorolac|paracetamol|clorhexidina|antibiótico|analgésico|antiinflamatorio|hielo|dieta|blanda|reposo|enjuague|buches|cepillado|indicaciones)\b/i;
  const nextVisitRegex =
    /\b(próximo|próxima|control|citar|volvemos|turno|en\s+\d+\s+(?:días|semanas|meses)|sutura|retiro)\b/i;
  const findingsRegex =
    /\b(caries|dolor|sensibilidad|inflamación|edema|fístula|absceso|fractura|movilidad|bolsa|sangrado|radiografía|periapical|lesión|obturación|filtración)\b/i;
  const procedureRegex =
    /\b(anestesia|apertura|conductometría|irrigación|hipoclorito|instrumentación|obturación|gutapercha|composite|resina|aislamiento|exodoncia|extracción|implante|sutura|raspaje|alisado|ultrasonido|provisorio|ionómero|tallado|cemento)\b/i;

  for (const seg of segments) {
    const txt = seg.text.trim();
    if (!txt) continue;

    if (seg.speaker === 'Paciente') {
      patientLines.push(txt);
      continue;
    }

    if (medicationOrCareRegex.test(txt)) {
      indicationsLines.push(txt);
    } else if (nextVisitRegex.test(txt)) {
      nextVisitLines.push(txt);
    } else if (procedureRegex.test(txt)) {
      procedureLines.push(txt);
    } else if (findingsRegex.test(txt)) {
      findingsLines.push(txt);
    }
  }

  return {
    templateId,
    detectedTeeth,
    chiefComplaint: patientLines.join(' ').trim(),
    findings: findingsLines.join(' ').trim(),
    procedure: procedureLines.join(' ').trim(),
    indications: indicationsLines.join(' ').trim(),
    nextVisit: nextVisitLines.join(' ').trim(),
    updatedAt: Date.now(),
  };
}

export function formatClinicalNoteText(session: Session, note: ClinicalNote): string {
  const tpl = CLINICAL_TEMPLATES.find((t) => t.id === note.templateId)?.label || 'Consulta general';
  const dateStr = new Date(session.createdAt).toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const lines = [
    `FICHA CLÍNICA ODONTOLÓGICA (${tpl.toUpperCase()})`,
    `Paciente / Ref.: ${session.reference || session.title}`,
    `Fecha: ${dateStr}`,
    note.detectedTeeth.length > 0 ? `Piezas FDI detectadas: ${note.detectedTeeth.join(', ')}` : '',
    '----------------------------------------',
    note.chiefComplaint ? `Motivo / Relato del paciente:\n${note.chiefComplaint}\n` : '',
    note.findings ? `Hallazgos clínicos / Diagnóstico:\n${note.findings}\n` : '',
    note.procedure ? `Procedimiento realizado:\n${note.procedure}\n` : '',
    note.indications ? `Indicaciones y medicación:\n${note.indications}\n` : '',
    note.nextVisit ? `Próximo control:\n${note.nextVisit}\n` : '',
  ].filter(Boolean);

  return lines.join('\n').trim();
}
