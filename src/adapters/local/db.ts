import Dexie, { Table } from 'dexie';
import {
  AppSettings,
  AudioChunk,
  GlossaryEntry,
  Profile,
  Session,
  TranscriptSegment,
  Workspace,
} from '../../core/types';

export class EscribaDatabase extends Dexie {
  workspaces!: Table<Workspace, string>;
  profiles!: Table<Profile, string>;
  sessions!: Table<Session, string>;
  audioChunks!: Table<AudioChunk, string>;
  transcriptSegments!: Table<TranscriptSegment, string>;
  settings!: Table<AppSettings, string>;
  glossary!: Table<GlossaryEntry, string>;

  constructor() {
    super('EscribaDentalDB');

    this.version(1).stores({
      workspaces: 'id, slug, createdAt',
      profiles: 'id, workspaceId',
      sessions: 'id, workspaceId, status, createdAt, updatedAt, deletedAt',
      audioChunks: 'id, sessionId, chunkIndex, createdAt',
      transcriptSegments: 'id, sessionId, start, end, createdAt',
      settings: 'id, workspaceId',
      glossary: 'id, workspaceId, incorrect',
    });
  }
}

export const db = new EscribaDatabase();
