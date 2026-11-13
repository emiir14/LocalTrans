import { ISettingsRepository } from '../../core/interfaces';
import { AppSettings } from '../../core/types';
import { db } from './db';

const DEFAULT_SETTINGS: (workspaceId: string) => AppSettings = (workspaceId) => ({
  id: `settings_${workspaceId}`,
  workspaceId,
  modelTier: 'balanced', // whisper-small default for high clinical accuracy
  noiseSuppression: false, // Turned off by default as requested in prompt to preserve voice frequencies
  selectedAudioDeviceId: undefined,
  requireConsent: true,
  autoTranscribeOnStop: false,
  progressiveTranscription: true,
  transcriptionMode: 'dental',
  theme: 'system',
  updatedAt: Date.now(),
});

export class LocalSettingsRepository implements ISettingsRepository {
  public async get(workspaceId: string): Promise<AppSettings> {
    const existing = await db.settings.where('workspaceId').equals(workspaceId).first();
    if (existing) {
      return existing;
    }
    const defaults = DEFAULT_SETTINGS(workspaceId);
    await db.settings.put(defaults);
    return defaults;
  }

  public async update(workspaceId: string, patch: Partial<AppSettings>): Promise<void> {
    const current = await this.get(workspaceId);
    await db.settings.update(current.id, {
      ...patch,
      updatedAt: Date.now(),
    });
  }
}
