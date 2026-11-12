/**
 * Centralized Screen Wake Lock Manager
 *
 * Keeps mobile devices and computers awake during:
 * - Active audio recording
 * - Whisper model downloading / initialization
 * - In-progress audio transcription & background chunk processing
 * - Performance benchmarks
 *
 * Automatically re-acquires the lock if the user changes tabs and returns
 * (document visibilitychange).
 */

class WakeLockManager {
  private reasons = new Set<string>();
  private sentinel: any = null;
  private subscribers = new Set<(active: boolean) => void>();
  private isRequesting = false;

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.reasons.size > 0) {
          this.requestLock();
        }
      });
    }
  }

  public async acquire(reason: string): Promise<boolean> {
    this.reasons.add(reason);
    return await this.requestLock();
  }

  public async release(reason: string): Promise<void> {
    this.reasons.delete(reason);
    if (this.reasons.size === 0) {
      await this.releaseLock();
    }
  }

  public isActive(): boolean {
    return this.sentinel !== null && !this.sentinel.released;
  }

  public getActiveReasons(): string[] {
    return Array.from(this.reasons);
  }

  public subscribe(callback: (active: boolean) => void): () => void {
    this.subscribers.add(callback);
    callback(this.isActive());
    return () => {
      this.subscribers.delete(callback);
    };
  }

  private notify() {
    const active = this.isActive();
    this.subscribers.forEach((cb) => {
      try {
        cb(active);
      } catch {
        // ignore subscriber errors
      }
    });
  }

  private async requestLock(): Promise<boolean> {
    if (this.isActive() || this.isRequesting) {
      return true;
    }

    if (
      typeof navigator === 'undefined' ||
      !('wakeLock' in navigator) ||
      typeof document === 'undefined' ||
      document.visibilityState !== 'visible'
    ) {
      this.notify();
      return false;
    }

    this.isRequesting = true;
    try {
      this.sentinel = await (navigator as any).wakeLock.request('screen');
      this.notify();

      this.sentinel.addEventListener('release', () => {
        this.sentinel = null;
        this.notify();

        // If reasons are still active and page is visible, attempt to re-acquire
        if (this.reasons.size > 0 && typeof document !== 'undefined' && document.visibilityState === 'visible') {
          setTimeout(() => {
            if (this.reasons.size > 0) {
              this.requestLock();
            }
          }, 300);
        }
      });

      return true;
    } catch (err) {
      // Wake lock can fail if battery saver is on or device restricts it
      console.warn('[WakeLockManager] Could not acquire screen wakeLock:', err);
      this.sentinel = null;
      this.notify();
      return false;
    } finally {
      this.isRequesting = false;
    }
  }

  private async releaseLock(): Promise<void> {
    if (this.sentinel) {
      try {
        await this.sentinel.release();
      } catch {
        // ignore
      }
      this.sentinel = null;
      this.notify();
    }
  }
}

export const wakeLockManager = new WakeLockManager();
