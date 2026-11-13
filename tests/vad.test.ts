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

  it('preserves soft speech instead of dropping quiet speakers', () => {
    const segmenter = new ClinicalAudioSegmenter();
    const sampleRate = 16000;
    const audio = new Float32Array(sampleRate * 3);
    // Quiet 350Hz voice-like tone (peak ~0.014) between 0.5s and 2.2s
    for (let i = Math.floor(sampleRate * 0.5); i < Math.floor(sampleRate * 2.2); i++) {
      audio[i] = Math.sin((2 * Math.PI * 350 * i) / sampleRate) * 0.014;
    }
    const segments = segmenter.segmentAudio(audio);
    expect(segments.length).toBe(1);
    expect(segments[0].startSec).toBeLessThanOrEqual(0.6);
    expect(segments[0].endSec).toBeGreaterThanOrEqual(2.1);
  });

  it('levels quiet speaker windows without clipping loud peaks', () => {
    const segmenter = new ClinicalAudioSegmenter();
    const sampleRate = 16000;
    const audio = new Float32Array(sampleRate * 2);
    // First second: loud voice (peak 0.8)
    for (let i = 0; i < sampleRate; i++) {
      audio[i] = Math.sin((2 * Math.PI * 250 * i) / sampleRate) * 0.8;
    }
    // Second second: quiet voice (peak 0.03)
    for (let i = sampleRate; i < sampleRate * 2; i++) {
      audio[i] = Math.sin((2 * Math.PI * 250 * i) / sampleRate) * 0.03;
    }

    const leveled = segmenter.levelWindowedAudio(audio, 0.002);
    let maxFirst = 0;
    let maxSecond = 0;
    for (let i = 0; i < sampleRate; i++) {
      maxFirst = Math.max(maxFirst, Math.abs(leveled[i]));
    }
    for (let i = sampleRate + 2000; i < sampleRate * 2; i++) {
      maxSecond = Math.max(maxSecond, Math.abs(leveled[i]));
    }

    expect(maxFirst).toBeLessThanOrEqual(0.98);
    expect(maxSecond).toBeGreaterThan(0.08);
  });
});
