import { ITranscriptRepository } from '../../core/interfaces';
import { TranscriptSegment } from '../../core/types';

/**
 * SupabaseTranscriptRepository (Skeleton / Unconnected)
 * Ready for future cloud sync of transcript text only.
 */
export class SupabaseTranscriptRepository implements ITranscriptRepository {
  public async getBySessionId(_sessionId: string): Promise<TranscriptSegment[]> {
    throw new Error('Supabase adapter not activated. Set NEXT_PUBLIC_MODE=cloud to enable.');
  }

  public async addSegment(_segment: TranscriptSegment): Promise<void> {
    throw new Error('Supabase adapter not activated. Set NEXT_PUBLIC_MODE=cloud to enable.');
  }

  public async saveSegments(_segments: TranscriptSegment[]): Promise<void> {
    throw new Error('Supabase adapter not activated. Set NEXT_PUBLIC_MODE=cloud to enable.');
  }

  public async updateSegment(_id: string, _text: string): Promise<void> {
    throw new Error('Supabase adapter not activated. Set NEXT_PUBLIC_MODE=cloud to enable.');
  }

  public async deleteSegment(_id: string): Promise<void> {
    throw new Error('Supabase adapter not activated. Set NEXT_PUBLIC_MODE=cloud to enable.');
  }

  public async deleteBySessionId(_sessionId: string): Promise<void> {
    throw new Error('Supabase adapter not activated. Set NEXT_PUBLIC_MODE=cloud to enable.');
  }
}
