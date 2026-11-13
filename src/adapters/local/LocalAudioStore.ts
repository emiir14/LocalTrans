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

  public async createWavBlob(sessionId: string): Promise<{ blob: Blob; durationSec: number }> {
    const chunks = await this.getChunks(sessionId);
    if (chunks.length === 0) {
      return { blob: new Blob([], { type: 'audio/wav' }), durationSec: 0 };
    }

    const sampleRate = chunks[0].sampleRate || 16000;
    let totalDataBytes = 0;
    let totalSamples = 0;
    const pcmParts: ArrayBuffer[] = [];

    for (const chunk of chunks) {
      totalDataBytes += chunk.pcmData.byteLength;
      totalSamples += chunk.samples;
      pcmParts.push(chunk.pcmData);
    }

    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + totalDataBytes, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, totalDataBytes, true);

    return {
      blob: new Blob([header, ...pcmParts], { type: 'audio/wav' }),
      durationSec: totalSamples / sampleRate,
    };
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
