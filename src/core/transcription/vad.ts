/**
 * Voice Activity Detection (VAD) & Audio Segmenter
 * Optimized for dental consultation audio (accommodates suction and handpiece background noise).
 * Splits 16kHz audio into speech chunks up to ~30s with slight overlap, discarding pure silence.
 */

export interface SpeechSegment {
  startSec: number;
  endSec: number;
  samples: Float32Array;
}

export interface VadOptions {
  sampleRate?: number;          // Default 16000
  frameDurationMs?: number;     // Default 30ms (480 samples at 16kHz)
  maxChunkDurationSec?: number; // Default 30s
  minChunkDurationSec?: number; // Default 0.8s
  minSpeechDurationMs?: number; // Default 250ms
  minSilenceDurationMs?: number;// Default 400ms (pause threshold to split speech)
  overlapSec?: number;          // Default 0.25s
  energyThresholdMultiplier?: number; // Dynamic multiplier over noise floor
}

export class ClinicalAudioSegmenter {
  private sampleRate: number;
  private frameDurationMs: number;
  private maxChunkDurationSec: number;
  private minChunkDurationSec: number;
  private minSpeechFrames: number;
  private minSilenceFrames: number;
  private overlapSec: number;

  constructor(options: VadOptions = {}) {
    this.sampleRate = options.sampleRate ?? 16000;
    this.frameDurationMs = options.frameDurationMs ?? 30;
    this.maxChunkDurationSec = options.maxChunkDurationSec ?? 24;
    this.minChunkDurationSec = options.minChunkDurationSec ?? 0.8;
    this.overlapSec = options.overlapSec ?? 0.25;

    const minSpeechMs = options.minSpeechDurationMs ?? 250;
    const minSilenceMs = options.minSilenceDurationMs ?? 600;

    this.minSpeechFrames = Math.max(1, Math.floor(minSpeechMs / this.frameDurationMs));
    this.minSilenceFrames = Math.max(1, Math.floor(minSilenceMs / this.frameDurationMs));
  }

  /**
   * Segments 16kHz Float32 audio into speech chunks suitable for Whisper
   */
  public segmentAudio(audio: Float32Array): SpeechSegment[] {
    const totalDurationSec = audio.length / this.sampleRate;
    if (totalDurationSec <= this.minChunkDurationSec) {
      // Audio is too short to split, return if not pure silence
      if (this.calculateRms(audio) > 0.005) {
        return [{ startSec: 0, endSec: totalDurationSec, samples: audio }];
      }
      return [];
    }

    const frameSize = Math.floor((this.sampleRate * this.frameDurationMs) / 1000);
    const numFrames = Math.floor(audio.length / frameSize);

    // Compute frame energies and estimate background noise floor
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
    const noiseFloor = sortedEnergies[Math.floor(numFrames * 0.2)] || 0.002;
    // Speech threshold above noise floor (dental office suction creates constant background floor)
    const speechThreshold = Math.max(0.008, noiseFloor * 1.8);

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

    // Filter out intervals that are purely stationary suction / compressor hiss
    // (High continuous ZCR > 0.40 with almost zero syllabic variance)
    const intervals: Interval[] = [];
    for (const interval of rawIntervals) {
      const len = interval.endFrame - interval.startFrame;
      if (len > 35) { // More than ~1s
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

        // Discard flat high-frequency hiss from saliva suction
        if (meanZ > 0.42 && varianceE < 0.000015) {
          continue;
        }
      }
      intervals.push(interval);
    }

    // Helper to validate and gently normalize speech segments
    const prepareSamples = (raw: Float32Array): Float32Array | null => {
      let maxPeak = 0;
      for (let i = 0; i < raw.length; i++) {
        const v = Math.abs(raw[i]);
        if (v > maxPeak) maxPeak = v;
      }
      // Reject pure room noise / dead air
      if (maxPeak < 0.012) {
        return null;
      }
      // Gentle gain normalization for distant or quiet speech
      if (maxPeak > 0.015 && maxPeak < 0.35) {
        const targetPeak = 0.65;
        const gain = Math.min(3.5, targetPeak / maxPeak);
        const normalized = new Float32Array(raw.length);
        for (let i = 0; i < raw.length; i++) {
          normalized[i] = raw[i] * gain;
        }
        return normalized;
      }
      return raw;
    };

    // If no distinct voice was separated, fallback to windowing only if audio has real signal
    if (intervals.length === 0) {
      const avgEnergy = numFrames > 0 ? energySum / numFrames : 0;
      let maxPeak = 0;
      for (let s = 0; s < Math.min(audio.length, 32000); s++) {
        const absVal = Math.abs(audio[s]);
        if (absVal > maxPeak) maxPeak = absVal;
      }

      if (avgEnergy > 0.005 && maxPeak > 0.03) {
        // Break into maxChunkDurationSec chunks (~25s)
        return this.sliceIntoEqualChunks(audio, this.maxChunkDurationSec);
      }
      return [];
    }

    // Group intervals into coherent speech chunks (up to maxChunkDurationSec)
    const maxFramesPerChunk = Math.floor((this.maxChunkDurationSec * 1000) / this.frameDurationMs);
    const maxSilenceGapFrames = Math.floor((1.5 * 1000) / this.frameDurationMs); // Splits if silence gap between phrases exceeds 1.5s
    const segments: SpeechSegment[] = [];

    let currentStartFrame = Math.max(0, intervals[0].startFrame - 4); // Include leading breath/onset
    let currentEndFrame = intervals[0].endFrame;

    for (let k = 1; k < intervals.length; k++) {
      const nextInterval = intervals[k];
      const silenceGap = nextInterval.startFrame - currentEndFrame;
      const proposedDurationFrames = nextInterval.endFrame - currentStartFrame;

      // Merge if within maxChunk duration and gap is not an extended idle silence
      if (proposedDurationFrames <= maxFramesPerChunk && silenceGap <= maxSilenceGapFrames) {
        currentEndFrame = nextInterval.endFrame;
      } else {
        // Chunk is ready; emit current speech chunk with trailing margin
        const safeEndFrame = Math.min(numFrames, currentEndFrame + 4);
        const startSec = (currentStartFrame * frameSize) / this.sampleRate;
        const endSec = (safeEndFrame * frameSize) / this.sampleRate;
        
        if (endSec - startSec >= this.minChunkDurationSec) {
          const startSample = currentStartFrame * frameSize;
          const endSample = safeEndFrame * frameSize;
          const processed = prepareSamples(audio.slice(startSample, endSample));
          if (processed) {
            segments.push({
              startSec,
              endSec,
              samples: processed,
            });
          }
        }

        // Start next chunk without carrying idle silence
        const overlapFrames = Math.floor((this.overlapSec * 1000) / this.frameDurationMs);
        currentStartFrame = Math.max(0, nextInterval.startFrame - overlapFrames);
        currentEndFrame = nextInterval.endFrame;
      }
    }

    // Emit final chunk
    const finalEndFrame = Math.min(numFrames, currentEndFrame + 4);
    const finalStartSec = (currentStartFrame * frameSize) / this.sampleRate;
    const finalEndSec = (finalEndFrame * frameSize) / this.sampleRate;

    if (finalEndSec - finalStartSec >= this.minChunkDurationSec) {
      const startSample = currentStartFrame * frameSize;
      const endSample = finalEndFrame * frameSize;
      const processed = prepareSamples(audio.slice(startSample, endSample));
      if (processed) {
        segments.push({
          startSec: finalStartSec,
          endSec: finalEndSec,
          samples: processed,
        });
      }
    }

    return segments;
  }

  private sliceIntoEqualChunks(audio: Float32Array, chunkSec: number): SpeechSegment[] {
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
          samples: audio.slice(start, end),
        });
      }

      if (end >= audio.length) break;
      start = end - overlapSize;
    }

    return segments;
  }

  private calculateRms(samples: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length);
  }
}
