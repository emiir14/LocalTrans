import { db } from '../../adapters/local/db';
import { AppSettings, GlossaryEntry, Session, TranscriptSegment } from '../types';

export interface EscribaBackupPayload {
  schema: 'escriba_backup_v1';
  exportedAt: string;
  sessions: Session[];
  segments: TranscriptSegment[];
  glossary: GlossaryEntry[];
  settings?: AppSettings;
}

export interface EscribaGlossaryBackupPayload {
  schema: 'escriba_glossary_v1';
  exportedAt: string;
  entries: Array<{ incorrect: string; correct: string }>;
}

export async function exportFullBackup(workspaceId: string): Promise<string> {
  const sessions = await db.sessions
    .where('workspaceId')
    .equals(workspaceId)
    .filter((s) => !s.deletedAt)
    .toArray();

  const sessionIds = new Set(sessions.map((s) => s.id));
  const allSegments = await db.transcriptSegments.toArray();
  const segments = allSegments.filter((seg) => sessionIds.has(seg.sessionId));

  const glossary = await db.glossary.where('workspaceId').equals(workspaceId).toArray();
  const settings = await db.settings.where('workspaceId').equals(workspaceId).first();

  const payload: EscribaBackupPayload = {
    schema: 'escriba_backup_v1',
    exportedAt: new Date().toISOString(),
    sessions,
    segments,
    glossary,
    settings,
  };

  return JSON.stringify(payload, null, 2);
}

export async function restoreFullBackup(
  jsonText: string,
  workspaceId: string
): Promise<{ sessionsRestored: number; segmentsRestored: number; glossaryRestored: number }> {
  let parsed: EscribaBackupPayload;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('El archivo seleccionado no es un JSON válido.');
  }

  if (!parsed || parsed.schema !== 'escriba_backup_v1' || !Array.isArray(parsed.sessions)) {
    throw new Error('Formato de respaldo no reconocido.');
  }

  let sessionsRestored = 0;
  let segmentsRestored = 0;
  let glossaryRestored = 0;

  // Normalize sessions: imported text-only backup has audioDeleted = true unless audio already exists locally
  for (const sess of parsed.sessions) {
    if (!sess.id) continue;
    const existingAudioCount = await db.audioChunks.where('sessionId').equals(sess.id).count();
    await db.sessions.put({
      ...sess,
      workspaceId,
      audioDeleted: existingAudioCount === 0 ? true : sess.audioDeleted,
      status: sess.status === 'recording' || sess.status === 'transcribing' ? 'completed' : sess.status,
    });
    sessionsRestored++;
  }

  if (Array.isArray(parsed.segments) && parsed.segments.length > 0) {
    await db.transcriptSegments.bulkPut(parsed.segments);
    segmentsRestored = parsed.segments.length;
  }

  if (Array.isArray(parsed.glossary)) {
    const existingGlossary = await db.glossary.where('workspaceId').equals(workspaceId).toArray();
    const existingKeys = new Set(existingGlossary.map((g) => g.incorrect.trim().toLowerCase()));
    for (const entry of parsed.glossary) {
      const key = entry.incorrect?.trim().toLowerCase();
      if (key && entry.correct?.trim() && !existingKeys.has(key)) {
        await db.glossary.put({
          ...entry,
          id: entry.id || `glossary_imp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          workspaceId,
        });
        existingKeys.add(key);
        glossaryRestored++;
      }
    }
  }

  return { sessionsRestored, segmentsRestored, glossaryRestored };
}

export function exportGlossaryJson(entries: GlossaryEntry[]): string {
  const payload: EscribaGlossaryBackupPayload = {
    schema: 'escriba_glossary_v1',
    exportedAt: new Date().toISOString(),
    entries: entries.map((e) => ({
      incorrect: e.incorrect,
      correct: e.correct,
    })),
  };
  return JSON.stringify(payload, null, 2);
}

export async function importGlossaryJson(
  jsonText: string,
  workspaceId: string
): Promise<number> {
  let parsed: EscribaGlossaryBackupPayload;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('Archivo de glosario inválido.');
  }

  if (!parsed || parsed.schema !== 'escriba_glossary_v1' || !Array.isArray(parsed.entries)) {
    throw new Error('El archivo no corresponde a un glosario exportado de Escriba.');
  }

  const existing = await db.glossary.where('workspaceId').equals(workspaceId).toArray();
  const existingKeys = new Set(existing.map((e) => e.incorrect.trim().toLowerCase()));
  let added = 0;

  for (const item of parsed.entries) {
    const inc = item.incorrect?.trim();
    const cor = item.correct?.trim();
    if (!inc || !cor) continue;
    const key = inc.toLowerCase();
    if (!existingKeys.has(key)) {
      await db.glossary.put({
        id: `glossary_${Date.now()}_${added}_${Math.random().toString(36).slice(2, 6)}`,
        workspaceId,
        incorrect: inc,
        correct: cor,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      existingKeys.add(key);
      added++;
    }
  }

  return added;
}
