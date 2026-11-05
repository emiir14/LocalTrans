import { DEFAULT_DENTAL_GLOSSARY } from '../../../config/glossary';
import { IGlossaryRepository } from '../../core/interfaces';
import { GlossaryEntry } from '../../core/types';
import { db } from './db';

export class LocalGlossaryRepository implements IGlossaryRepository {
  public async getAll(workspaceId: string): Promise<GlossaryEntry[]> {
    return await db.glossary
      .where('workspaceId')
      .equals(workspaceId)
      .sortBy('incorrect');
  }

  public async add(entry: GlossaryEntry): Promise<void> {
    await db.glossary.put(entry);
  }

  public async remove(id: string): Promise<void> {
    await db.glossary.delete(id);
  }

  public async update(id: string, incorrect: string, correct: string): Promise<void> {
    await db.glossary.update(id, {
      incorrect,
      correct,
      updatedAt: Date.now(),
    });
  }

  public async seedDefaultsIfEmpty(workspaceId: string): Promise<void> {
    const count = await db.glossary.where('workspaceId').equals(workspaceId).count();
    if (count === 0) {
      const now = Date.now();
      const entries: GlossaryEntry[] = DEFAULT_DENTAL_GLOSSARY.map((g, idx) => ({
        id: `glossary_${idx}_${now}`,
        workspaceId,
        incorrect: g.incorrect,
        correct: g.correct,
        createdAt: now,
        updatedAt: now,
      }));
      await db.glossary.bulkPut(entries);
    }
  }
}
