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
  max: {
    tier: 'max',
    modelId: 'onnx-community/whisper-large-v3-turbo',
    label: 'Máxima precisión',
    description: 'Mayor fidelidad en términos odontológicos complejos. Requiere PC con WebGPU.',
    defaultBackend: 'webgpu',
    dtype: {
      encoder_model: 'fp16',
      decoder_model_merged: 'q4',
    },
    estimatedDownloadMb: 350,
  },
  balanced: {
    tier: 'balanced',
    modelId: 'onnx-community/whisper-small',
    label: 'Equilibrada',
    description: 'Excelente balance para teléfonos modernos y laptops.',
    defaultBackend: 'webgpu',
    dtype: 'q4',
    estimatedDownloadMb: 140,
  },
  fast: {
    tier: 'fast',
    modelId: 'onnx-community/whisper-base',
    label: 'Rápida y liviana',
    description: 'Máxima compatibilidad en CPU/WASM sin requerir tarjeta gráfica.',
    defaultBackend: 'wasm',
    dtype: 'q4',
    estimatedDownloadMb: 75,
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

  // Determine recommended tier
  let recommendedTier: ModelTier = 'fast';
  let recommendedBackend: 'webgpu' | 'wasm' = 'wasm';

  if (hasWebGpu) {
    recommendedBackend = 'webgpu';
    if (isIos) {
      // iOS WebGPU can be memory-restricted; default to balanced
      recommendedTier = 'balanced';
    } else if (isMobile) {
      recommendedTier = 'balanced';
    } else {
      // Desktop / PC with WebGPU
      if (!deviceMemoryGb || deviceMemoryGb >= 8) {
        recommendedTier = 'max';
      } else {
        recommendedTier = 'balanced';
      }
    }
  } else {
    // WASM only
    recommendedBackend = 'wasm';
    recommendedTier = 'fast';
  }

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
