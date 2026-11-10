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
    const existing = await db.glossary.where('workspaceId').equals(workspaceId).toArray();
    const existingSet = new Set(existing.map((e) => e.incorrect.toLowerCase().trim()));
    const now = Date.now();
    const toAdd: GlossaryEntry[] = [];

    DEFAULT_DENTAL_GLOSSARY.forEach((g, idx) => {
      if (!existingSet.has(g.incorrect.toLowerCase().trim())) {
        toAdd.push({
          id: `glossary_${idx}_${now}`,
          workspaceId,
          incorrect: g.incorrect,
          correct: g.correct,
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    if (toAdd.length > 0) {
      await db.glossary.bulkPut(toAdd);
    }
  }
}
