import { describe, it, expect } from 'vitest';
import { ISessionRepository } from '../src/core/interfaces';
import { Session } from '../src/core/types';

class MockSessionRepository implements ISessionRepository {
  private sessions: Map<string, Session> = new Map();

  async getAll(_wsId: string): Promise<Session[]> {
    return Array.from(this.sessions.values());
  }
  async getById(id: string): Promise<Session | undefined> {
    return this.sessions.get(id);
  }
  async create(session: Session): Promise<void> {
    this.sessions.set(session.id, { ...session });
  }
  async update(id: string, patch: Partial<Session>): Promise<void> {
    const curr = this.sessions.get(id);
    if (curr) {
      this.sessions.set(id, { ...curr, ...patch });
    }
  }
  async delete(id: string): Promise<void> {
    this.sessions.delete(id);
  }
  async findUnclosedRecording(_wsId: string): Promise<Session | undefined> {
    return undefined;
  }
}

describe('1-Touch Next Patient Transition', () => {
  it('should cleanly finalize previous patient and register next patient session', async () => {
    const repo = new MockSessionRepository();

    const session1: Session = {
      id: 'sess_patient_1',
      workspaceId: 'ws_test',
      title: 'Consulta Paciente #1',
      reference: 'Paciente #1',
      status: 'recording',
      durationSec: 120, // 2 minutes
      consentGiven: true,
      audioDeleted: false,
      createdAt: 1000,
      updatedAt: 1000,
    };

    await repo.create(session1);

    // Simulate transition
    await repo.update(session1.id, { status: 'recorded', durationSec: 120 });

    const session2: Session = {
      id: 'sess_patient_2',
      workspaceId: 'ws_test',
      title: 'Consulta Paciente #2',
      reference: 'Paciente #2',
      status: 'recording',
      durationSec: 0,
      consentGiven: true,
      audioDeleted: false,
      createdAt: 2000,
      updatedAt: 2000,
    };

    await repo.create(session2);

    const stored1 = await repo.getById('sess_patient_1');
    const stored2 = await repo.getById('sess_patient_2');

    expect(stored1?.status).toBe('recorded');
    expect(stored1?.durationSec).toBe(120);

    expect(stored2?.status).toBe('recording');
    expect(stored2?.durationSec).toBe(0);
    expect(stored2?.title).toBe('Consulta Paciente #2');
  });
});
