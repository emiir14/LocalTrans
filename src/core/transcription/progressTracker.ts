export interface ModelProgressSample {
  status?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

/**
 * Aggregates multi-file model download progress (e.g. concurrent ONNX encoder/decoder weights)
 * into a single strictly non-decreasing 0..100 percentage so UI counters never flicker backwards.
 */
export class MonotonicModelProgressTracker {
  private fileBytes = new Map<string, { loaded: number; total: number }>();
  private maxPercent = 0;

  public update(sample: ModelProgressSample): number {
    const fileKey = (sample.file || '__model__').trim() || '__model__';

    if (typeof sample.total === 'number' && sample.total > 0) {
      const prev = this.fileBytes.get(fileKey);
      const rawLoaded =
        sample.status === 'done'
          ? sample.total
          : typeof sample.loaded === 'number'
          ? sample.loaded
          : prev?.loaded ?? 0;

      const clampedLoaded = Math.min(
        sample.total,
        Math.max(prev?.loaded ?? 0, Math.max(0, rawLoaded))
      );

      this.fileBytes.set(fileKey, {
        loaded: clampedLoaded,
        total: sample.total,
      });

      let totalLoaded = 0;
      let totalExpected = 0;
      for (const entry of this.fileBytes.values()) {
        totalLoaded += entry.loaded;
        totalExpected += entry.total;
      }

      if (totalExpected > 0) {
        const aggregatePct = Math.min(100, Math.round((totalLoaded / totalExpected) * 100));
        this.maxPercent = Math.max(this.maxPercent, aggregatePct);
      }
      return this.maxPercent;
    }

    if (typeof sample.progress === 'number' && Number.isFinite(sample.progress)) {
      if (this.fileBytes.size === 0) {
        const pct = Math.max(0, Math.min(100, Math.round(sample.progress)));
        this.maxPercent = Math.max(this.maxPercent, pct);
      }
    }

    return this.maxPercent;
  }

  public getCurrentPercent(): number {
    return this.maxPercent;
  }
}
