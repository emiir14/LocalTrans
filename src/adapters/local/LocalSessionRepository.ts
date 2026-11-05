import { ISessionRepository } from '../../core/interfaces';
import { Session } from '../../core/types';
import { db } from './db';

export class LocalSessionRepository implements ISessionRepository {
  public async getAll(workspaceId: string): Promise<Session[]> {
    return await db.sessions
      .where('workspaceId')
      .equals(workspaceId)
      .filter((s) => !s.deletedAt)
      .reverse()
      .sortBy('createdAt');
  }

  public async getById(id: string): Promise<Session | undefined> {
    return await db.sessions.get(id);
  }

  public async create(session: Session): Promise<void> {
    await db.sessions.put(session);
  }

  public async update(id: string, patch: Partial<Session>): Promise<void> {
    await db.sessions.update(id, {
      ...patch,
      updatedAt: Date.now(),
    });
  }

  public async delete(id: string): Promise<void> {
    // Logical delete
    await db.sessions.update(id, {
      deletedAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  public async findUnclosedRecording(workspaceId: string): Promise<Session | undefined> {
    const active = await db.sessions
      .where('workspaceId')
      .equals(workspaceId)
      .filter((s) => s.status === 'recording' && !s.deletedAt)
      .first();

    return active;
  }
}
