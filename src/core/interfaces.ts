import {
  AppSettings,
  AudioChunk,
  GlossaryEntry,
  ModelTier,
  Profile,
  Session,
  TranscriptSegment,
  Workspace
} from './types';

export interface ISessionRepository {
  getAll(workspaceId: string): Promise<Session[]>;
  getById(id: string): Promise<Session | undefined>;
  create(session: Session): Promise<void>;
  update(id: string, patch: Partial<Session>): Promise<void>;
  delete(id: string): Promise<void>;
  findUnclosedRecording(workspaceId: string): Promise<Session | undefined>;
}

export interface ITranscriptRepository {
  getBySessionId(sessionId: string): Promise<TranscriptSegment[]>;
  addSegment(segment: TranscriptSegment): Promise<void>;
  saveSegments(segments: TranscriptSegment[]): Promise<void>;
  updateSegment(id: string, text: string): Promise<void>;
  updateSegmentSpeaker(id: string, speaker: string | undefined): Promise<void>;
  deleteSegment(id: string): Promise<void>;
  deleteBySessionId(sessionId: string): Promise<void>;
}

export interface IAudioStore {
  addChunk(chunk: AudioChunk): Promise<void>;
  getChunks(sessionId: string): Promise<AudioChunk[]>;
  getCombinedPcmFloat32(sessionId: string): Promise<Float32Array>;
  createWavBlob(sessionId: string): Promise<{ blob: Blob; durationSec: number }>;
  deleteAudio(sessionId: string): Promise<void>;
  deleteAllTranscribedAudio(transcribedSessionIds: string[]): Promise<void>;
  clearAll(): Promise<void>;
  getStorageEstimate(): Promise<{ usedBytes: number; quotaBytes: number }>;
}

export interface IGlossaryRepository {
  getAll(workspaceId: string): Promise<GlossaryEntry[]>;
  add(entry: GlossaryEntry): Promise<void>;
  remove(id: string): Promise<void>;
  update(id: string, incorrect: string, correct: string): Promise<void>;
  seedDefaultsIfEmpty(workspaceId: string): Promise<void>;
}

export interface ISettingsRepository {
  get(workspaceId: string): Promise<AppSettings>;
  update(workspaceId: string, patch: Partial<AppSettings>): Promise<void>;
}

export interface IAuthProvider {
  getCurrentWorkspace(): Promise<Workspace>;
  getCurrentProfile(): Promise<Profile>;
}

export interface TranscriptionResult {
  text: string;
  chunks: Array<{
    timestamp: [number, number];
    text: string;
  }>;
}

export interface ITranscriptionEngine {
  load(
    tier: ModelTier,
    onProgress?: (progress: { status: string; progress?: number; file?: string }) => void
  ): Promise<void>;
  transcribe(
    audio: Float32Array,
    options?: {
      language?: string;
      initialPrompt?: string;
    }
  ): Promise<TranscriptionResult>;
  dispose(): Promise<void>;
  getActiveTier(): ModelTier;
  getBackend(): 'webgpu' | 'wasm';
}
