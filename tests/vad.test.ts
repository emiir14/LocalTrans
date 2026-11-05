import { describe, it, expect } from 'vitest';
import { ClinicalAudioSegmenter } from '../src/core/transcription/vad';

describe('ClinicalAudioSegmenter (VAD)', () => {
  it('should return empty segments for pure silence', () => {
    const segmenter = new ClinicalAudioSegmenter();
    const silence = new Float32Array(16000 * 5); // 5 seconds of absolute silence
    const segments = segmenter.segmentAudio(silence);
    expect(segments.length).toBe(0);
  });

  it('should detect speech burst and extract correct segment with time boundaries', () => {
    const segmenter = new ClinicalAudioSegmenter({
      minChunkDurationSec: 0.5,
      maxChunkDurationSec: 30,
    });

    const sampleRate = 16000;
    const totalSamples = sampleRate * 4; // 4 seconds
    const audio = new Float32Array(totalSamples);

    // Inject speech tone between 1.0s and 2.5s (1.5s speech)
    const startSample = sampleRate * 1;
    const endSample = Math.floor(sampleRate * 2.5);
    for (let i = startSample; i < endSample; i++) {
      audio[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.4;
    }

    const segments = segmenter.segmentAudio(audio);
    expect(segments.length).toBeGreaterThan(0);

    const first = segments[0];
    // Start should be around 1.0s (with onset margin)
    expect(first.startSec).toBeLessThanOrEqual(1.1);
    expect(first.endSec).toBeGreaterThanOrEqual(2.4);
    expect(first.samples.length).toBeGreaterThan(0);
  });

  it('should split long audio into chunks of at most maxChunkDurationSec', () => {
    const segmenter = new ClinicalAudioSegmenter({
      maxChunkDurationSec: 5, // 5s max for testing
    });

    const sampleRate = 16000;
    const totalSamples = sampleRate * 12; // 12 seconds continuous sound
    const audio = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      audio[i] = Math.sin((2 * Math.PI * 300 * i) / sampleRate) * 0.3;
    }

    const segments = segmenter.segmentAudio(audio);
    expect(segments.length).toBeGreaterThanOrEqual(2);
    for (const seg of segments) {
      expect(seg.endSec - seg.startSec).toBeLessThanOrEqual(5.5);
    }
  });
});
