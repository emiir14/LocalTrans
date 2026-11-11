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
  balanced: {
    tier: 'balanced',
    modelId: 'onnx-community/whisper-small',
    label: 'Alta precisión clínica (whisper-small)',
    description: 'Estándar clínico de alta fidelidad (~140 MB). 244 millones de parámetros para captar terminología técnica con exactitud.',
    defaultBackend: 'webgpu',
    dtype: 'q4',
    estimatedDownloadMb: 140,
  },
  max: {
    tier: 'max',
    modelId: 'onnx-community/whisper-large-v3-turbo',
    label: 'Máxima precisión (whisper-large-v3-turbo)',
    description: 'Mayor fidelidad en casos específicos (~350 MB). 800 millones de parámetros. Requiere PC potente con WebGPU.',
    defaultBackend: 'webgpu',
    dtype: {
      encoder_model: 'fp16',
      decoder_model_merged: 'q4',
    },
    estimatedDownloadMb: 350,
  },
  // Legacy alias for existing persisted databases: automatically uses whisper-small
  fast: {
    tier: 'balanced',
    modelId: 'onnx-community/whisper-small',
    label: 'Alta precisión clínica (whisper-small)',
    description: 'Estándar clínico de alta fidelidad (~140 MB).',
    defaultBackend: 'webgpu',
    dtype: 'q4',
    estimatedDownloadMb: 140,
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
  // Default to 'balanced' (whisper-small) across all devices for high clinical accuracy.
  // On mobile devices (Android / iOS), always enforce 'wasm' (multithreaded CPU) to prevent
  // mobile GPU buffer_manager.cc crashes and Brave Shields GPU readback blocks.
  const recommendedTier: ModelTier = 'balanced';
  const recommendedBackend: 'webgpu' | 'wasm' = !isMobile && hasWebGpu ? 'webgpu' : 'wasm';

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
    selectedTier === 'auto' || (selectedTier as string) === 'fast'
      ? 'balanced'
      : (selectedTier as Exclude<ModelTier, 'auto'>);

  const baseConfig = TIER_CONFIGS[activeTier] || TIER_CONFIGS.balanced;
  
  // On mobile devices (Android / iOS), always enforce 'wasm' to avoid mobile GPU buffer allocation crashes
  // and Brave fingerprinting shield blocks. Use WebGPU only on desktop / laptops.
  const backend: 'webgpu' | 'wasm' =
    !hardware.isMobile && hardware.hasWebGpu && baseConfig.defaultBackend === 'webgpu'
      ? 'webgpu'
      : 'wasm';

  return {
    tier: activeTier,
    backend,
    config: baseConfig,
  };
}
