import { ISessionRepository } from '../../core/interfaces';
import { Session } from '../../core/types';

/**
 * SupabaseSessionRepository (Skeleton / Unconnected)
 * Ready for future cloud sync of metadata and text ONLY.
 * Audio is NEVER uploaded to Supabase or any cloud storage.
 */
export class SupabaseSessionRepository implements ISessionRepository {
  public async getAll(_workspaceId: string): Promise<Session[]> {
    throw new Error('Supabase adapter not activated. Set NEXT_PUBLIC_MODE=cloud to enable.');
  }

  public async getById(_id: string): Promise<Session | undefined> {
    throw new Error('Supabase adapter not activated. Set NEXT_PUBLIC_MODE=cloud to enable.');
  }

  public async create(_session: Session): Promise<void> {
    throw new Error('Supabase adapter not activated. Set NEXT_PUBLIC_MODE=cloud to enable.');
  }

  public async update(_id: string, _patch: Partial<Session>): Promise<void> {
    throw new Error('Supabase adapter not activated. Set NEXT_PUBLIC_MODE=cloud to enable.');
  }

  public async delete(_id: string): Promise<void> {
    throw new Error('Supabase adapter not activated. Set NEXT_PUBLIC_MODE=cloud to enable.');
  }

  public async findUnclosedRecording(_workspaceId: string): Promise<Session | undefined> {
    return undefined;
  }
}
