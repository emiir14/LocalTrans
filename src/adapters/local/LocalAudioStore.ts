import { IAudioStore } from '../../core/interfaces';
import { AudioChunk } from '../../core/types';
import { db } from './db';

export class LocalAudioStore implements IAudioStore {
  public async addChunk(chunk: AudioChunk): Promise<void> {
    await db.audioChunks.put(chunk);
  }

  public async getChunks(sessionId: string): Promise<AudioChunk[]> {
    return await db.audioChunks
      .where('sessionId')
      .equals(sessionId)
      .sortBy('chunkIndex');
  }

  public async getCombinedPcmFloat32(sessionId: string): Promise<Float32Array> {
    const chunks = await this.getChunks(sessionId);
    if (chunks.length === 0) {
      return new Float32Array(0);
    }

    // Calculate total sample count
    let totalSamples = 0;
    for (const chunk of chunks) {
      totalSamples += chunk.samples;
    }

    const float32 = new Float32Array(totalSamples);
    let offset = 0;

    for (const chunk of chunks) {
      const int16 = new Int16Array(chunk.pcmData);
      for (let i = 0; i < int16.length; i++) {
        const sample = int16[i];
        float32[offset + i] = sample < 0 ? sample / 0x8000 : sample / 0x7fff;
      }
      offset += int16.length;
    }

    return float32;
  }

  public async deleteAudio(sessionId: string): Promise<void> {
    await db.audioChunks.where('sessionId').equals(sessionId).delete();
  }

  public async deleteAllTranscribedAudio(transcribedSessionIds: string[]): Promise<void> {
    for (const sessionId of transcribedSessionIds) {
      await this.deleteAudio(sessionId);
      await db.sessions.update(sessionId, { audioDeleted: true, updatedAt: Date.now() });
    }
  }

  public async clearAll(): Promise<void> {
    await db.audioChunks.clear();
    await db.transcriptSegments.clear();
    await db.sessions.clear();
  }

  public async getStorageEstimate(): Promise<{ usedBytes: number; quotaBytes: number }> {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        return {
          usedBytes: estimate.usage || 0,
          quotaBytes: estimate.quota || 0,
        };
      } catch {
        // Fallback
      }
    }
    return { usedBytes: 0, quotaBytes: 0 };
  }
}
