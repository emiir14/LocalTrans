import { describe, it, expect } from 'vitest';
import { detectCorruptOutput } from '../src/core/transcription/corruptionHeuristics';

describe('WebGPU Corruption Detection Heuristics', () => {
  it('should flag empty output when voice signal is present', () => {
    const res = detectCorruptOutput('', { hasVoiceSignal: true });
    expect(res.isCorrupt).toBe(true);
    expect(res.reason).toContain('Salida vacía');
  });

  it('should flag excessive non-Spanish anomalous character sets', () => {
    // Simulated ONNX corruption glyph storm
    const glyphStorm = 'АБВГДЕЖЗИЙКЛМН 測試文本 §¶®© 123 456 \uFFFD\uFFFD\uFFFD';
    const res = detectCorruptOutput(glyphStorm);
    expect(res.isCorrupt).toBe(true);
    expect(res.reason).toContain('no españoles');
  });

  it('should flag extreme single-word repetition loops', () => {
    const wordLoop = 'pieza pieza pieza pieza pieza pieza pieza pieza';
    const res = detectCorruptOutput(wordLoop);
    expect(res.isCorrupt).toBe(true);
    expect(res.reason).toContain('Bucle repetitivo');
  });

  it('should flag extreme character repetition', () => {
    const charLoop = 'aaaaaaaaaaaaaaaaaaaaaaaaaa';
    const res = detectCorruptOutput(charLoop);
    expect(res.isCorrupt).toBe(true);
  });

  it('should pass normal clinical Spanish speech', () => {
    const normal = 'El tratamiento de endodoncia fue completado satisfactoriamente.';
    const res = detectCorruptOutput(normal, { hasVoiceSignal: true });
    expect(res.isCorrupt).toBe(false);
  });
});
