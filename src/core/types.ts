/**
 * Core Domain Entities for Escriba
 * Prepared for multi-workspace & multi-consultorio scaling.
 */

export type ModelTier = 'auto' | 'fast' | 'balanced' | 'max';

export type SessionStatus = 'recording' | 'recorded' | 'transcribing' | 'completed' | 'error';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

export interface Profile {
  id: string;
  workspaceId: string;
  fullName: string;
  role: 'owner' | 'dentist' | 'assistant';
  createdAt: number;
  updatedAt: number;
}

export interface Session {
  id: string;
  workspaceId: string;
  title: string;
  reference?: string; // Clinician reference / initials
  status: SessionStatus;
  durationSec: number;
  consentGiven: boolean;
  modelTierUsed?: ModelTier;
  audioDeleted: boolean;
  error?: string;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}

/**
 * AudioChunk stores 16kHz Int16 PCM chunks directly in local IndexedDB.
 * NEVER synchronized to any cloud server.
 */
export interface AudioChunk {
  id: string;
  sessionId: string;
  chunkIndex: number;
  startTime: number;
  endTime: number;
  pcmData: ArrayBuffer; // 16kHz 1-channel Int16 PCM
  samples: number;
  sampleRate: number; // 16000
  createdAt: number;
}

export interface TranscriptSegment {
  id: string;
  sessionId: string;
  start: number; // in seconds
  end: number;   // in seconds
  text: string;
  originalText: string;
  speaker?: string; // Optional speaker identifier for future diarization
  edited: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface GlossaryEntry {
  id: string;
  workspaceId: string;
  incorrect: string;
  correct: string;
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings {
  id: string;
  workspaceId: string;
  modelTier: ModelTier;
  noiseSuppression: boolean;
  requireConsent: boolean;
  autoTranscribeOnStop: boolean;
  progressiveTranscription: boolean; // Transcribes chunks in background during recording for instant results
  theme: 'light' | 'dark' | 'system';
  updatedAt: number;
}

export interface TranscriptionProgress {
  sessionId: string;
  progressPercent: number; // 0 - 100
  currentSegment: number;
  totalSegments: number;
  estimatedRemainingSec: number;
  phase: 'vad' | 'transcribing' | 'formatting' | 'idle';
  statusText: string;
}

export interface BenchmarkResult {
  tier: ModelTier;
  deviceBackend: 'webgpu' | 'wasm';
  modelId: string;
  loadTimeMs: number;
  audioDurationSec: number;
  transcriptionTimeMs: number;
  realTimeFactor: number; // transcriptionTime / audioDuration
  memoryEstimatedMb?: number;
  transcribedText: string;
  wordErrorRate?: number; // WER compared with reference if provided
}
