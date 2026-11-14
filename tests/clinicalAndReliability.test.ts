import { describe, it, expect } from 'vitest';
import {
  buildDraftClinicalNote,
  extractFdiTeeth,
  formatClinicalNoteText,
} from '../src/core/clinical/clinicalTemplates';
import { exportGlossaryJson } from '../src/core/export/backup';
import { ExportFormatter } from '../src/core/export/formatter';
import { GlossaryEntry, Session, TranscriptSegment } from '../src/core/types';

describe('Clinical FDI Parser & Structured Note Builder', () => {
  it('extracts valid FDI teeth codes while ignoring non-dental numbers', () => {
    const text =
      'El paciente refiere dolor hace 15 días en la pieza 36 y sensibilidad en 1.6. Tomó ibuprofeno 600 mg y revisamos el elemento 4.8.';
    const teeth = extractFdiTeeth(text);
    expect(teeth).toEqual(['1.6', '3.6', '4.8']);
  });

  it('does not detect invalid quadrants or tooth indices as FDI', () => {
    const text = 'Control en 19 días, dosis 9.9 ml y 2.9 mm de margen.';
    expect(extractFdiTeeth(text)).toEqual([]);
  });

  it('builds a local structured clinical note respecting speaker tags and clinical cues', () => {
    const segments: TranscriptSegment[] = [
      {
        id: 's1',
        sessionId: 'sess_1',
        start: 0,
        end: 5,
        text: 'Me duele al morder del lado derecho desde ayer.',
        originalText: 'Me duele al morder del lado derecho desde ayer.',
        speaker: 'Paciente',
        edited: false,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 's2',
        sessionId: 'sess_1',
        start: 6,
        end: 12,
        text: 'Observamos caries profunda en pieza 4.6.',
        originalText: 'Observamos caries profunda en pieza 4.6.',
        speaker: 'Odontólogo',
        edited: false,
        createdAt: 2,
        updatedAt: 2,
      },
      {
        id: 's3',
        sessionId: 'sess_1',
        start: 13,
        end: 20,
        text: 'Realizamos anestesia, aislamiento y restauración con composite.',
        originalText: 'Realizamos anestesia, aislamiento y restauración con composite.',
        speaker: 'Odontólogo',
        edited: false,
        createdAt: 3,
        updatedAt: 3,
      },
      {
        id: 's4',
        sessionId: 'sess_1',
        start: 21,
        end: 26,
        text: 'Tomar ibuprofeno 600 mg cada 8 horas si molesta.',
        originalText: 'Tomar ibuprofeno 600 mg cada 8 horas si molesta.',
        speaker: 'Odontólogo',
        edited: false,
        createdAt: 4,
        updatedAt: 4,
      },
      {
        id: 's5',
        sessionId: 'sess_1',
        start: 27,
        end: 32,
        text: 'Próximo control en 15 días para pulido.',
        originalText: 'Próximo control en 15 días para pulido.',
        speaker: 'Odontólogo',
        edited: false,
        createdAt: 5,
        updatedAt: 5,
      },
    ];

    const note = buildDraftClinicalNote(segments, 'operatoria');
    expect(note.templateId).toBe('operatoria');
    expect(note.detectedTeeth).toEqual(['4.6']);
    expect(note.chiefComplaint).toContain('Me duele al morder');
    expect(note.findings).toContain('caries profunda');
    expect(note.procedure).toContain('composite');
    expect(note.indications).toContain('ibuprofeno');
    expect(note.nextVisit).toContain('15 días');

    const session: Session = {
      id: 'sess_1',
      workspaceId: 'ws_1',
      title: 'Consulta Demo',
      reference: 'Paciente M.G.',
      status: 'completed',
      durationSec: 40,
      consentGiven: true,
      audioDeleted: false,
      clinicalNote: note,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const noteTxt = formatClinicalNoteText(session, note);
    expect(noteTxt).toContain('OPERATORIA / CARIES');
    expect(noteTxt).toContain('Piezas FDI detectadas: 4.6');

    const md = ExportFormatter.toMd(session, segments);
    expect(md).toContain('## Ficha Clínica Estructurada');
    expect(md).toContain('4.6');
  });

  it('serializes dental glossary export payload cleanly', () => {
    const entries: GlossaryEntry[] = [
      {
        id: 'g1',
        workspaceId: 'ws',
        incorrect: 'conducto metria',
        correct: 'conductometría',
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const parsed = JSON.parse(exportGlossaryJson(entries));
    expect(parsed.schema).toBe('escriba_glossary_v1');
    expect(parsed.entries).toEqual([{ incorrect: 'conducto metria', correct: 'conductometría' }]);
  });

  it('builds dental vs general rolling prompts cleanly and formats clean plain text without timestamps', async () => {
    const { buildSegmentPrompt } = await import('../src/core/transcription/prompts');

    const generalPrompt = buildSegmentPrompt('general', 'Che boludo, vamos a buscar el cofre.');
    expect(generalPrompt).toContain('español rioplatense');
    expect(generalPrompt).toContain('vamos a buscar el cofre.');
    expect(generalPrompt.toLowerCase()).not.toContain('conductometría');

    const dentalPrompt = buildSegmentPrompt('dental', 'Pieza 3.6 con caries profunda.');
    expect(dentalPrompt).toContain('odontológica');
    expect(dentalPrompt).toContain('endodoncia');
    expect(dentalPrompt).toContain('Pieza 3.6 con caries profunda.');

    const clean = ExportFormatter.toCleanPlainText([
      {
        id: '1',
        sessionId: 's1',
        start: 3,
        end: 6,
        text: '¿En qué cofre está la cosa?',
        originalText: '¿En qué cofre está la cosa?',
        edited: false,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: '2',
        sessionId: 's1',
        start: 15,
        end: 20,
        text: 'Acá en el tercero.',
        originalText: 'Acá en el tercero.',
        speaker: 'Odontólogo',
        edited: false,
        createdAt: 2,
        updatedAt: 2,
      },
    ]);

    expect(clean).toBe('¿En qué cofre está la cosa?\n\nOdontólogo: Acá en el tercero.');
    expect(clean).not.toContain('[00:03');
  });

  it('aggregates concurrent model file progress monotonically without backwards flicker', async () => {
    const { MonotonicModelProgressTracker } = await import('../src/core/transcription/progressTracker');
    const tracker = new MonotonicModelProgressTracker();

    const p1 = tracker.update({ status: 'progress', file: 'encoder.onnx', loaded: 4, total: 100, progress: 4 });
    const p2 = tracker.update({ status: 'progress', file: 'decoder.onnx', loaded: 3, total: 100, progress: 3 });
    const p3 = tracker.update({ status: 'progress', file: 'encoder.onnx', loaded: 5, total: 100, progress: 5 });
    const p4 = tracker.update({ status: 'progress', file: 'decoder.onnx', loaded: 3, total: 100, progress: 3 });
    const p5 = tracker.update({ status: 'done', file: 'encoder.onnx', loaded: 100, total: 100, progress: 100 });
    const p6 = tracker.update({ status: 'done', file: 'decoder.onnx', loaded: 100, total: 100, progress: 100 });

    expect([p1, p2, p3, p4, p5, p6]).toEqual([4, 4, 4, 4, 52, 100]);
  });
});
