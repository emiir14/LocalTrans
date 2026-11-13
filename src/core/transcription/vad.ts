/**
 * Voice Activity Detection (VAD) & Audio Segmenter
 * Tuned to preserve soft/short speech and normalize multi-speaker volume differences
 * without dropping trailing/leading consonants or quiet voices.
 */

export interface SpeechSegment {
  startSec: number;
  endSec: number;
  samples: Float32Array;
}

export interface VadOptions {
  sampleRate?: number;          // Default 16000
  frameDurationMs?: number;     // Default 30ms (480 samples at 16kHz)
  maxChunkDurationSec?: number; // Default 24s
  minChunkDurationSec?: number; // Default 0.35s (preserves short words like "sí", "bien", "dale")
  minSpeechDurationMs?: number; // Default 150ms
  minSilenceDurationMs?: number;// Default 700ms (pause threshold to split speech)
  overlapSec?: number;          // Default 0.35s
  energyThresholdMultiplier?: number; // Dynamic multiplier over noise floor (default 1.45)
}

export class ClinicalAudioSegmenter {
  private sampleRate: number;
  private frameDurationMs: number;
  private maxChunkDurationSec: number;
  private minChunkDurationSec: number;
  private minSpeechFrames: number;
  private minSilenceFrames: number;
  private overlapSec: number;
  private energyThresholdMultiplier: number;

  constructor(options: VadOptions = {}) {
    this.sampleRate = options.sampleRate ?? 16000;
    this.frameDurationMs = options.frameDurationMs ?? 30;
    this.maxChunkDurationSec = options.maxChunkDurationSec ?? 24;
    this.minChunkDurationSec = options.minChunkDurationSec ?? 0.35;
    this.overlapSec = options.overlapSec ?? 0.35;
    this.energyThresholdMultiplier = options.energyThresholdMultiplier ?? 1.45;

    const minSpeechMs = options.minSpeechDurationMs ?? 150;
    const minSilenceMs = options.minSilenceDurationMs ?? 700;

    this.minSpeechFrames = Math.max(1, Math.floor(minSpeechMs / this.frameDurationMs));
    this.minSilenceFrames = Math.max(1, Math.floor(minSilenceMs / this.frameDurationMs));
  }

  /**
   * Segments 16kHz Float32 audio into speech chunks suitable for Whisper
   */
  public segmentAudio(audio: Float32Array): SpeechSegment[] {
    const totalDurationSec = audio.length / this.sampleRate;
    if (totalDurationSec <= this.minChunkDurationSec) {
      if (this.calculateRms(audio) > 0.003) {
        const leveled = this.levelWindowedAudio(audio, 0.002);
        return [{ startSec: 0, endSec: totalDurationSec, samples: leveled }];
      }
      return [];
    }

    const frameSize = Math.floor((this.sampleRate * this.frameDurationMs) / 1000);
    const numFrames = Math.floor(audio.length / frameSize);
    if (numFrames === 0) return [];

    // Compute frame energies and zero-crossing rates
    const energies = new Float32Array(numFrames);
    const zcr = new Float32Array(numFrames);
    let energySum = 0;

    for (let i = 0; i < numFrames; i++) {
      const offset = i * frameSize;
      let sumSq = 0;
      let zeroCrossings = 0;
      for (let j = 0; j < frameSize; j++) {
        const val = audio[offset + j];
        sumSq += val * val;
        if (j > 0) {
          const prev = audio[offset + j - 1];
          if ((val >= 0 && prev < 0) || (val < 0 && prev >= 0)) {
            zeroCrossings++;
          }
        }
      }
      energies[i] = Math.sqrt(sumSq / frameSize);
      zcr[i] = zeroCrossings / frameSize;
      energySum += energies[i];
    }

    // Adaptive noise floor (bottom 20th percentile)
    const sortedEnergies = Float32Array.from(energies).sort();
    const noiseFloor = sortedEnergies[Math.floor(numFrames * 0.2)] || 0.0015;
    // Sensitive threshold so soft speakers & distant voices aren't dropped
    const speechThreshold = Math.max(0.0045, noiseFloor * this.energyThresholdMultiplier);

    // Label each frame as speech or non-speech
    const isSpeechFrame = new Uint8Array(numFrames);
    for (let i = 0; i < numFrames; i++) {
      isSpeechFrame[i] = energies[i] >= speechThreshold ? 1 : 0;
    }

    // Smooth frames with hangover logic (prevent cutting inter-word pauses)
    const smoothedSpeech = new Uint8Array(numFrames);
    let consecutiveSpeech = 0;
    let consecutiveSilence = 0;
    let inSpeech = false;

    for (let i = 0; i < numFrames; i++) {
      if (isSpeechFrame[i]) {
        consecutiveSpeech++;
        consecutiveSilence = 0;
        if (consecutiveSpeech >= this.minSpeechFrames) {
          inSpeech = true;
        }
      } else {
        consecutiveSilence++;
        consecutiveSpeech = 0;
        if (consecutiveSilence >= this.minSilenceFrames) {
          inSpeech = false;
        }
      }
      smoothedSpeech[i] = inSpeech ? 1 : 0;
    }

    // Extract speech intervals
    interface Interval {
      startFrame: number;
      endFrame: number;
    }
    const rawIntervals: Interval[] = [];
    let intervalStart = -1;

    for (let i = 0; i < numFrames; i++) {
      if (smoothedSpeech[i] === 1 && intervalStart === -1) {
        intervalStart = i;
      } else if (smoothedSpeech[i] === 0 && intervalStart !== -1) {
        rawIntervals.push({ startFrame: intervalStart, endFrame: i });
        intervalStart = -1;
      }
    }
    if (intervalStart !== -1) {
      rawIntervals.push({ startFrame: intervalStart, endFrame: numFrames });
    }

    // Filter out ONLY extreme stationary high-frequency hiss (dental suction / white noise)
    // without discarding soft fricative/whispered speech
    const intervals: Interval[] = [];
    for (const interval of rawIntervals) {
      const len = interval.endFrame - interval.startFrame;
      if (len > 45) {
        let sumE = 0;
        let sumZ = 0;
        for (let f = interval.startFrame; f < interval.endFrame; f++) {
          sumE += energies[f];
          sumZ += zcr[f];
        }
        const meanE = sumE / len;
        const meanZ = sumZ / len;

        let varianceE = 0;
        for (let f = interval.startFrame; f < interval.endFrame; f++) {
          const diff = energies[f] - meanE;
          varianceE += diff * diff;
        }
        varianceE /= len;

        if (meanZ > 0.48 && varianceE < 0.000005) {
          continue;
        }
      }
      intervals.push(interval);
    }

    const prepareSamples = (raw: Float32Array): Float32Array | null => {
      let maxPeak = 0;
      for (let i = 0; i < raw.length; i++) {
        const v = Math.abs(raw[i]);
        if (v > maxPeak) maxPeak = v;
      }
      // Reject only true dead air / near-zero digital noise
      if (maxPeak < 0.004) {
        return null;
      }
      return this.levelWindowedAudio(raw, noiseFloor);
    };

    // Fallback: if voice exists in the buffer but wasn't cleanly separated into intervals,
    // slice continuously rather than dropping the block
    if (intervals.length === 0) {
      const avgEnergy = numFrames > 0 ? energySum / numFrames : 0;
      let maxPeak = 0;
      const checkLen = Math.min(audio.length, 48000);
      for (let s = 0; s < checkLen; s++) {
        const absVal = Math.abs(audio[s]);
        if (absVal > maxPeak) maxPeak = absVal;
      }

      if (avgEnergy > 0.003 || maxPeak > 0.015) {
        return this.sliceIntoEqualChunks(audio, this.maxChunkDurationSec, noiseFloor);
      }
      return [];
    }

    // Group intervals into coherent speech chunks (up to maxChunkDurationSec)
    const paddingFrames = Math.max(6, Math.round(360 / this.frameDurationMs)); // ~360ms pre/post consonant padding
    const maxFramesPerChunk = Math.floor((this.maxChunkDurationSec * 1000) / this.frameDurationMs);
    const maxSilenceGapFrames = Math.floor((1.8 * 1000) / this.frameDurationMs);
    const segments: SpeechSegment[] = [];

    let currentStartFrame = Math.max(0, intervals[0].startFrame - paddingFrames);
    let currentEndFrame = intervals[0].endFrame;

    for (let k = 1; k < intervals.length; k++) {
      const nextInterval = intervals[k];
      const silenceGap = nextInterval.startFrame - currentEndFrame;
      const proposedDurationFrames = nextInterval.endFrame - currentStartFrame;

      if (proposedDurationFrames <= maxFramesPerChunk && silenceGap <= maxSilenceGapFrames) {
        currentEndFrame = nextInterval.endFrame;
      } else {
        const safeEndFrame = Math.min(numFrames, currentEndFrame + paddingFrames);
        const startSec = (currentStartFrame * frameSize) / this.sampleRate;
        const endSec = (safeEndFrame * frameSize) / this.sampleRate;

        if (endSec - startSec >= this.minChunkDurationSec) {
          const startSample = currentStartFrame * frameSize;
          const endSample = safeEndFrame * frameSize;
          const processed = prepareSamples(audio.slice(startSample, endSample));
          if (processed) {
            segments.push({ startSec, endSec, samples: processed });
          }
        }

        const overlapFrames = Math.max(
          paddingFrames,
          Math.floor((this.overlapSec * 1000) / this.frameDurationMs)
        );
        currentStartFrame = Math.max(0, nextInterval.startFrame - overlapFrames);
        currentEndFrame = nextInterval.endFrame;
      }
    }

    // Emit final chunk
    const finalEndFrame = Math.min(numFrames, currentEndFrame + paddingFrames);
    const finalStartSec = (currentStartFrame * frameSize) / this.sampleRate;
    const finalEndSec = (finalEndFrame * frameSize) / this.sampleRate;

    if (finalEndSec - finalStartSec >= this.minChunkDurationSec) {
      const startSample = currentStartFrame * frameSize;
      const endSample = finalEndFrame * frameSize;
      const processed = prepareSamples(audio.slice(startSample, endSample));
      if (processed) {
        segments.push({ startSec: finalStartSec, endSec: finalEndSec, samples: processed });
      }
    }

    return segments;
  }

  /**
   * Smoothly levels quiet vs loud speakers across 0.5s windows so soft distant speech
   * is lifted cleanly without pumping pure background silence or clipping loud peaks.
   */
  public levelWindowedAudio(raw: Float32Array, noiseFloor = 0.002): Float32Array {
    if (raw.length === 0) return raw;

    const windowSamples = Math.max(1, Math.floor(this.sampleRate * 0.5)); // 0.5s windows
    const numWindows = Math.max(1, Math.ceil(raw.length / windowSamples));
    const windowGains = new Float32Array(numWindows);
    const targetRms = 0.14;
    const maxBoostGain = 5.0;
    const speechGate = Math.max(0.004, noiseFloor * 1.35);

    for (let w = 0; w < numWindows; w++) {
      const start = w * windowSamples;
      const end = Math.min(raw.length, start + windowSamples);
      const count = end - start;
      let sumSq = 0;
      let peak = 0;

      for (let i = start; i < end; i++) {
        const val = raw[i];
        sumSq += val * val;
        const abs = Math.abs(val);
        if (abs > peak) peak = abs;
      }

      const rms = Math.sqrt(sumSq / Math.max(1, count));
      if (rms <= speechGate || peak <= 0.002) {
        windowGains[w] = 1.0;
      } else {
        const desired = Math.min(maxBoostGain, Math.max(0.85, targetRms / rms));
        const peakSafe = peak * desired > 0.92 ? 0.92 / peak : desired;
        windowGains[w] = Math.max(0.5, peakSafe);
      }
    }

    // Prevent gain ramp-up from overshooting the tail of a preceding loud window
    for (let w = 1; w < numWindows; w++) {
      if (windowGains[w] > windowGains[w - 1] * 1.8) {
        windowGains[w] = Math.min(windowGains[w], windowGains[w - 1] * 1.8);
      }
    }

    const out = new Float32Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      const wFloat = i / windowSamples;
      const w0 = Math.min(numWindows - 1, Math.floor(wFloat));
      const w1 = Math.min(numWindows - 1, w0 + 1);
      const frac = wFloat - w0;
      const smoothGain = windowGains[w0] * (1 - frac) + windowGains[w1] * frac;
      const scaled = raw[i] * smoothGain;
      const absScaled = Math.abs(scaled);
      // Bounded tanh soft-knee limiter strictly within [-0.97, 0.97]
      if (absScaled > 0.9) {
        const compressed = 0.9 + 0.07 * Math.tanh((absScaled - 0.9) / 0.15);
        out[i] = scaled < 0 ? -compressed : compressed;
      } else {
        out[i] = scaled;
      }
    }

    return out;
  }

  private sliceIntoEqualChunks(
    audio: Float32Array,
    chunkSec: number,
    noiseFloor: number
  ): SpeechSegment[] {
    const chunkSize = chunkSec * this.sampleRate;
    const overlapSize = Math.floor(this.overlapSec * this.sampleRate);
    const segments: SpeechSegment[] = [];
    let start = 0;

    while (start < audio.length) {
      const end = Math.min(audio.length, start + chunkSize);
      const startSec = start / this.sampleRate;
      const endSec = end / this.sampleRate;

      if (endSec - startSec >= this.minChunkDurationSec) {
        segments.push({
          startSec,
          endSec,
          samples: this.levelWindowedAudio(audio.slice(start, end), noiseFloor),
        });
      }

      if (end >= audio.length) break;
      start = end - overlapSize;
    }

    return segments;
  }

  private calculateRms(samples: Float32Array): number {
    if (samples.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length);
  }
}
