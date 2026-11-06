import { ModelTier } from '../types';

export interface HardwareCapabilities {
  hasWebGpu: boolean;
  adapterInfo?: string;
  isMobile: boolean;
  isIos: boolean;
  deviceMemoryGb?: number;
  hardwareConcurrency: number;
  recommendedTier: ModelTier;
  recommendedBackend: 'webgpu' | 'wasm';
}

export interface ModelTierConfig {
  tier: ModelTier;
  modelId: string;
  label: string;
  description: string;
  defaultBackend: 'webgpu' | 'wasm';
  dtype: any;
  estimatedDownloadMb: number;
}

export const TIER_CONFIGS: Record<Exclude<ModelTier, 'auto'>, ModelTierConfig> = {
  fast: {
    tier: 'fast',
    modelId: 'onnx-community/whisper-base',
    label: 'Rápida (Recomendada)',
    description: 'Máxima velocidad (~75 MB). Procesa cada fragmento en 1-2 segundos sin saturar el equipo.',
    defaultBackend: 'webgpu',
    dtype: 'q4',
    estimatedDownloadMb: 75,
  },
  balanced: {
    tier: 'balanced',
    modelId: 'onnx-community/whisper-small',
    label: 'Equilibrada',
    description: 'Excelente balance para teléfonos modernos y laptops (~140 MB).',
    defaultBackend: 'webgpu',
    dtype: 'q4',
    estimatedDownloadMb: 140,
  },
  max: {
    tier: 'max',
    modelId: 'onnx-community/whisper-large-v3-turbo',
    label: 'Máxima precisión (Pesada)',
    description: 'Mayor fidelidad en casos específicos (~350 MB). Requiere PC potente con WebGPU.',
    defaultBackend: 'webgpu',
    dtype: {
      encoder_model: 'fp16',
      decoder_model_merged: 'q4',
    },
    estimatedDownloadMb: 350,
  },
};

/**
 * Inspects device hardware capabilities to select the optimal model tier
 */
export async function detectHardwareCapabilities(): Promise<HardwareCapabilities> {
  const isMobile =
    typeof navigator !== 'undefined' &&
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  
  const isIos =
    typeof navigator !== 'undefined' &&
    (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

  const deviceMemoryGb =
    typeof navigator !== 'undefined' && 'deviceMemory' in navigator
      ? (navigator as any).deviceMemory
      : undefined;

  const hardwareConcurrency =
    typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;

  let hasWebGpu = false;
  let adapterInfo = '';

  if (typeof navigator !== 'undefined' && 'gpu' in navigator && (navigator as any).gpu) {
    try {
      const adapter = await (navigator as any).gpu.requestAdapter();
      if (adapter) {
        hasWebGpu = true;
        if (adapter.info) {
          adapterInfo = `${adapter.info.vendor || ''} ${adapter.info.architecture || ''}`.trim();
        }
      }
    } catch {
      hasWebGpu = false;
    }
  }

  // Recommended tier for auto mode:
  // Default to 'fast' (whisper-base) across all devices for fast, responsive processing.
  // Uses WebGPU if present, or all CPU cores on WASM fallback.
  const recommendedTier: ModelTier = 'fast';
  const recommendedBackend: 'webgpu' | 'wasm' = hasWebGpu ? 'webgpu' : 'wasm';

  return {
    hasWebGpu,
    adapterInfo,
    isMobile,
    isIos,
    deviceMemoryGb,
    hardwareConcurrency,
    recommendedTier,
    recommendedBackend,
  };
}

export function resolveTier(
  selectedTier: ModelTier,
  hardware: HardwareCapabilities
): { tier: Exclude<ModelTier, 'auto'>; backend: 'webgpu' | 'wasm'; config: ModelTierConfig } {
  const activeTier: Exclude<ModelTier, 'auto'> =
    selectedTier === 'auto' ? (hardware.recommendedTier as Exclude<ModelTier, 'auto'>) : selectedTier;

  const baseConfig = TIER_CONFIGS[activeTier];
  
  // If user selected max or balanced but has no WebGPU, fallback backend to wasm
  const backend: 'webgpu' | 'wasm' =
    hardware.hasWebGpu && baseConfig.defaultBackend === 'webgpu' ? 'webgpu' : 'wasm';

  return {
    tier: activeTier,
    backend,
    config: baseConfig,
  };
}
