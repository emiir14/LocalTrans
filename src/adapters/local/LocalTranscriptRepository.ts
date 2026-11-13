import { ITranscriptRepository } from '../../core/interfaces';
import { TranscriptSegment } from '../../core/types';
import { db } from './db';

export class LocalTranscriptRepository implements ITranscriptRepository {
  public async getBySessionId(sessionId: string): Promise<TranscriptSegment[]> {
    return await db.transcriptSegments
      .where('sessionId')
      .equals(sessionId)
      .sortBy('start');
  }

  public async addSegment(segment: TranscriptSegment): Promise<void> {
    await db.transcriptSegments.put(segment);
  }

  public async saveSegments(segments: TranscriptSegment[]): Promise<void> {
    await db.transcriptSegments.bulkPut(segments);
  }

  public async updateSegment(id: string, text: string): Promise<void> {
    await db.transcriptSegments.update(id, {
      text,
      edited: true,
      updatedAt: Date.now(),
    });
  }

  public async updateSegmentSpeaker(id: string, speaker: string | undefined): Promise<void> {
    await db.transcriptSegments.update(id, {
      speaker,
      updatedAt: Date.now(),
    });
  }

  public async deleteSegment(id: string): Promise<void> {
    await db.transcriptSegments.delete(id);
  }

  public async deleteBySessionId(sessionId: string): Promise<void> {
    await db.transcriptSegments.where('sessionId').equals(sessionId).delete();
  }
}
