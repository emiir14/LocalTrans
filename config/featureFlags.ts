/**
 * Feature Flags Configuration
 * Architecture ready for scaling to teams, diarization and cloud metadata sync.
 */
export interface FeatureFlags {
  diarization: boolean;
  cloudSync: boolean;
  teams: boolean;
  allowNoiseSuppressionOverride: boolean;
}

export const FEATURE_FLAGS: FeatureFlags = {
  diarization: false, // Speaker separation reserved for v2
  cloudSync: false,   // 100% local by default, cloud sync skeleton ready
  teams: false,       // Multi-operator clinics ready in data model
  allowNoiseSuppressionOverride: true,
};
