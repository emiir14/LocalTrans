import { ModelTier } from '../types';
import { TIER_CONFIGS } from './tierDetector';

export interface ModelCacheStatus {
  tier: Exclude<ModelTier, 'auto' | 'fast'>;
  modelId: string;
  isCached: boolean;
  cachedFilesCount: number;
  cachedBytes: number;
}

/**
 * Checks browser Cache Storage ('transformers-cache') to determine whether
 * the ONNX weights for a given Whisper model are stored offline locally.
 */
export async function checkModelCacheStatus(
  tier: Exclude<ModelTier, 'auto' | 'fast'>
): Promise<ModelCacheStatus> {
  const config = TIER_CONFIGS[tier];
  const empty: ModelCacheStatus = {
    tier,
    modelId: config.modelId,
    isCached: false,
    cachedFilesCount: 0,
    cachedBytes: 0,
  };

  if (typeof caches === 'undefined') {
    return empty;
  }

  try {
    const cacheNames = await caches.keys();
    const transformersCacheNames = cacheNames.filter((name) =>
      name.toLowerCase().includes('transformers')
    );

    if (transformersCacheNames.length === 0) {
      return empty;
    }

    let matchedFiles = 0;
    let totalBytes = 0;
    let hasOnnxWeight = false;

    for (const cacheName of transformersCacheNames) {
      const cache = await caches.open(cacheName);
      const requests = await cache.keys();

      for (const req of requests) {
        if (req.url.includes(config.modelId)) {
          matchedFiles++;
          if (req.url.endsWith('.onnx') || req.url.includes('.onnx_data')) {
            hasOnnxWeight = true;
          }
          try {
            const resp = await cache.match(req);
            const cl = resp?.headers.get('content-length');
            if (cl) {
              totalBytes += parseInt(cl, 10) || 0;
            }
          } catch {
            // ignore size lookup failure
          }
        }
      }
    }

    return {
      tier,
      modelId: config.modelId,
      isCached: hasOnnxWeight && matchedFiles >= 2,
      cachedFilesCount: matchedFiles,
      cachedBytes: totalBytes,
    };
  } catch {
    return empty;
  }
}
