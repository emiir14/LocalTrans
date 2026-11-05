import { describe, it, expect } from 'vitest';
import { ExportFormatter, formatTimeDisplay, formatTimeSrt } from '../src/core/export/formatter';
import { Session, TranscriptSegment } from '../src/core/types';

describe('Export Formatters', () => {
  const mockSession: Session = {
    id: 'sess_1',
    workspaceId: 'ws_1',
    title: 'Consulta Prueba',
    reference: 'Paciente A.B.',
    status: 'completed',
    durationSec: 125,
    consentGiven: true,
    audioDeleted: false,
    createdAt: new Date('2026-11-05T10:00:00Z').getTime(),
    updatedAt: new Date('2026-11-05T10:05:00Z').getTime(),
  };

  const mockSegments: TranscriptSegment[] = [
    {
      id: 'seg_1',
      sessionId: 'sess_1',
      start: 0.5,
      end: 4.2,
      text: 'Buenos días, pasá y tomá asiento.',
      originalText: 'Buenos días, pasá y tomá asiento.',
      edited: false,
      createdAt: 1000,
      updatedAt: 1000,
    },
    {
      id: 'seg_2',
      sessionId: 'sess_1',
      start: 5.0,
      end: 12.8,
      text: 'Vamos a revisar la obturación en la pieza 1.6.',
      originalText: 'Vamos a revisar la obturación en la pieza 1.6.',
      edited: false,
      createdAt: 2000,
      updatedAt: 2000,
    },
  ];

  it('should format times correctly for SRT and display', () => {
    expect(formatTimeDisplay(125)).toBe('02:05');
    expect(formatTimeSrt(65.5)).toBe('00:01:05,500');
  });

  it('should generate valid plain text with metadata', () => {
    const txt = ExportFormatter.toTxt(mockSession, mockSegments);
    expect(txt).toContain('CONSULTA ODONTOLÓGICA');
    expect(txt).toContain('Paciente A.B.');
    expect(txt).toContain('Buenos días, pasá y tomá asiento.');
  });

  it('should generate valid Markdown with headers and timestamps', () => {
    const md = ExportFormatter.toMd(mockSession, mockSegments);
    expect(md).toContain('# Consulta Odontológica');
    expect(md).toContain('`00:00 - 00:04`');
  });

  it('should format valid SRT subtitle blocks', () => {
    const srt = ExportFormatter.toSrt(mockSegments);
    expect(srt).toContain('1\n00:00:00,500 --> 00:00:04,200\nBuenos días');
    expect(srt).toContain('2\n00:00:05,000 --> 00:00:12,800\nVamos a revisar');
  });

  it('should generate JSON export with session and segments', () => {
    const jsonStr = ExportFormatter.toJson(mockSession, mockSegments);
    const parsed = JSON.parse(jsonStr);
    expect(parsed.session.id).toBe('sess_1');
    expect(parsed.segments.length).toBe(2);
  });

  it('should format clean clinical AI prompt context without timestamps', () => {
    const aiText = ExportFormatter.toAiContext(mockSession, mockSegments);
    expect(aiText).toContain('Contexto: A continuación se transcribe');
    expect(aiText).toContain('Referencia / Código del paciente: Paciente A.B.');
    expect(aiText).toContain('Buenos días, pasá y tomá asiento.');
    expect(aiText).not.toContain('-->');
  });
});
