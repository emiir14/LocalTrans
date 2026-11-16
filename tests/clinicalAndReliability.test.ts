import { describe, it, expect } from 'vitest';
import {
  buildDraftClinicalNote,
  extractFdiTeeth,
  formatClinicalNoteText,
} from '../src/core/clinical/clinicalTemplates';
import { exportGlossaryJson } from '../src/core/export/backup';
import { ExportFormatter } from '../src/core/export/formatter';
import { GlossaryEntry, Session, TranscriptSegment } from '../src/core/types';

describe('Clinical FDI Parser & Structured Note Builder', () => {
  it('extracts valid FDI teeth codes while ignoring non-dental numbers', () => {
    const text =
      'El paciente refiere dolor hace 15 días en la pieza 36 y sensibilidad en 1.6. Tomó ibuprofeno 600 mg y revisamos el elemento 4.8.';
    const teeth = extractFdiTeeth(text);
    expect(teeth).toEqual(['1.6', '3.6', '4.8']);
  });

  it('does not detect invalid quadrants or tooth indices as FDI', () => {
    const text = 'Control en 19 días, dosis 9.9 ml y 2.9 mm de margen.';
    expect(extractFdiTeeth(text)).toEqual([]);
  });

  it('builds a local structured clinical note respecting speaker tags and clinical cues', () => {
    const segments: TranscriptSegment[] = [
      {
        id: 's1',
        sessionId: 'sess_1',
        start: 0,
        end: 5,
        text: 'Me duele al morder del lado derecho desde ayer.',
        originalText: 'Me duele al morder del lado derecho desde ayer.',
        speaker: 'Paciente',
        edited: false,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 's2',
        sessionId: 'sess_1',
        start: 6,
        end: 12,
        text: 'Observamos caries profunda en pieza 4.6.',
        originalText: 'Observamos caries profunda en pieza 4.6.',
        speaker: 'Odontólogo',
        edited: false,
        createdAt: 2,
        updatedAt: 2,
      },
      {
        id: 's3',
        sessionId: 'sess_1',
        start: 13,
        end: 20,
        text: 'Realizamos anestesia, aislamiento y restauración con composite.',
        originalText: 'Realizamos anestesia, aislamiento y restauración con composite.',
        speaker: 'Odontólogo',
        edited: false,
        createdAt: 3,
        updatedAt: 3,
      },
      {
        id: 's4',
        sessionId: 'sess_1',
        start: 21,
        end: 26,
        text: 'Tomar ibuprofeno 600 mg cada 8 horas si molesta.',
        originalText: 'Tomar ibuprofeno 600 mg cada 8 horas si molesta.',
        speaker: 'Odontólogo',
        edited: false,
        createdAt: 4,
        updatedAt: 4,
      },
      {
        id: 's5',
        sessionId: 'sess_1',
        start: 27,
        end: 32,
        text: 'Próximo control en 15 días para pulido.',
        originalText: 'Próximo control en 15 días para pulido.',
        speaker: 'Odontólogo',
        edited: false,
        createdAt: 5,
        updatedAt: 5,
      },
    ];

    const note = buildDraftClinicalNote(segments, 'operatoria');
    expect(note.templateId).toBe('operatoria');
    expect(note.detectedTeeth).toEqual(['4.6']);
    expect(note.chiefComplaint).toContain('Me duele al morder');
    expect(note.findings).toContain('caries profunda');
    expect(note.procedure).toContain('composite');
    expect(note.indications).toContain('ibuprofeno');
    expect(note.nextVisit).toContain('15 días');

    const session: Session = {
      id: 'sess_1',
      workspaceId: 'ws_1',
      title: 'Consulta Demo',
      reference: 'Paciente M.G.',
      status: 'completed',
      durationSec: 40,
      consentGiven: true,
      audioDeleted: false,
      clinicalNote: note,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const noteTxt = formatClinicalNoteText(session, note);
    expect(noteTxt).toContain('OPERATORIA / CARIES');
    expect(noteTxt).toContain('Piezas FDI detectadas: 4.6');

    const md = ExportFormatter.toMd(session, segments);
    expect(md).toContain('## Ficha Clínica Estructurada');
    expect(md).toContain('4.6');
  });

  it('serializes dental glossary export payload cleanly', () => {
    const entries: GlossaryEntry[] = [
      {
        id: 'g1',
        workspaceId: 'ws',
        incorrect: 'conducto metria',
        correct: 'conductometría',
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const parsed = JSON.parse(exportGlossaryJson(entries));
    expect(parsed.schema).toBe('escriba_glossary_v1');
    expect(parsed.entries).toEqual([{ incorrect: 'conducto metria', correct: 'conductometría' }]);
  });

  it('builds dental vs general rolling prompts cleanly and formats clean plain text without timestamps', async () => {
    const { buildSegmentPrompt } = await import('../src/core/transcription/prompts');

    const generalPrompt = buildSegmentPrompt('general', 'Che boludo, vamos a buscar el cofre.');
    expect(generalPrompt).toContain('español rioplatense');
    expect(generalPrompt).toContain('vamos a buscar el cofre.');
    expect(generalPrompt.toLowerCase()).not.toContain('conductometría');

    const dentalPrompt = buildSegmentPrompt('dental', 'Pieza 3.6 con caries profunda.');
    expect(dentalPrompt).toContain('odontológica');
    expect(dentalPrompt).toContain('endodoncia');
    expect(dentalPrompt).toContain('Pieza 3.6 con caries profunda.');

    const clean = ExportFormatter.toCleanPlainText([
      {
        id: '1',
        sessionId: 's1',
        start: 3,
        end: 6,
        text: '¿En qué cofre está la cosa?',
        originalText: '¿En qué cofre está la cosa?',
        edited: false,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: '2',
        sessionId: 's1',
        start: 15,
        end: 20,
        text: 'Acá en el tercero.',
        originalText: 'Acá en el tercero.',
        speaker: 'Odontólogo',
        edited: false,
        createdAt: 2,
        updatedAt: 2,
      },
    ]);

    expect(clean).toBe('¿En qué cofre está la cosa?\n\nOdontólogo: Acá en el tercero.');
    expect(clean).not.toContain('[00:03');
  });

  it('aggregates concurrent model file progress monotonically without backwards flicker', async () => {
    const { MonotonicModelProgressTracker } = await import('../src/core/transcription/progressTracker');
    const tracker = new MonotonicModelProgressTracker();

    const p1 = tracker.update({ status: 'progress', file: 'encoder.onnx', loaded: 4, total: 100, progress: 4 });
    const p2 = tracker.update({ status: 'progress', file: 'decoder.onnx', loaded: 3, total: 100, progress: 3 });
    const p3 = tracker.update({ status: 'progress', file: 'encoder.onnx', loaded: 5, total: 100, progress: 5 });
    const p4 = tracker.update({ status: 'progress', file: 'decoder.onnx', loaded: 3, total: 100, progress: 3 });
    const p5 = tracker.update({ status: 'done', file: 'encoder.onnx', loaded: 100, total: 100, progress: 100 });
    const p6 = tracker.update({ status: 'done', file: 'decoder.onnx', loaded: 100, total: 100, progress: 100 });

    expect([p1, p2, p3, p4, p5, p6]).toEqual([4, 4, 4, 4, 52, 100]);
  });

  it('shares load progress across concurrent callers and falls back to WASM when WebGPU stalls', async () => {
    const { WhisperTranscriptionEngine } = await import('../src/core/transcription/engine');

    const origDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        platform: 'Win32',
        maxTouchPoints: 0,
        hardwareConcurrency: 8,
        gpu: {
          requestAdapter: async () => ({ info: { vendor: 'mock', architecture: 'mock' } }),
        },
      },
    });

    const spawnedBackends: string[] = [];
    const terminatedCount = { value: 0 };
    const fallbackNotices: string[] = [];

    try {
      const engine = new WhisperTranscriptionEngine({
        webGpuInitStallTimeoutMs: 40,
        wasmInitStallTimeoutMs: 200,
        segmentTimeoutMs: 50,
        onCorruptionFallback: (reason) => fallbackNotices.push(reason),
        workerFactory: () => {
          const fakeWorker: any = {
            onmessage: null,
            onerror: null,
            terminate: () => {
              terminatedCount.value++;
            },
            postMessage: (msg: any) => {
              if (msg.type === 'init') {
                spawnedBackends.push(msg.payload.device);
                if (msg.payload.device === 'webgpu') {
                  // Simulate progress at 45% then WebGPU shader stall (never sends init_done)
                  setTimeout(() => {
                    fakeWorker.onmessage?.({
                      data: { type: 'load_progress', payload: { status: 'progress', progress: 45, loaded: 45, total: 100 } },
                    });
                  }, 5);
                } else {
                  // WASM completes promptly
                  setTimeout(() => {
                    fakeWorker.onmessage?.({
                      data: { type: 'load_progress', payload: { status: 'progress', progress: 100, loaded: 100, total: 100 } },
                    });
                    fakeWorker.onmessage?.({
                      data: { type: 'init_done', payload: { device: 'wasm', dtype: 'q8' } },
                    });
                  }, 10);
                }
              }
            },
          };
          return fakeWorker as Worker;
        },
      });

      const caller1Progress: number[] = [];
      const caller2Progress: number[] = [];

      const p1 = engine.load('balanced', (d) => {
        if (typeof d.progress === 'number') caller1Progress.push(d.progress);
      });
      await new Promise((r) => setTimeout(r, 15));
      const p2 = engine.load('balanced', (d) => {
        if (typeof d.progress === 'number') caller2Progress.push(d.progress);
      });

      await Promise.all([p1, p2]);

      expect(spawnedBackends).toEqual(['webgpu', 'wasm']);
      expect(terminatedCount.value).toBe(1);
      expect(engine.getActiveBackend()).toBe('wasm');
      expect(fallbackNotices.length).toBe(1);
      expect(caller1Progress).toContain(45);
      expect(caller2Progress).toContain(45);
      expect(caller2Progress).toContain(100);
    } finally {
      if (origDescriptor) {
        Object.defineProperty(globalThis, 'navigator', origDescriptor);
      }
    }
  });

  it('recovers cleanly via abortLoad and bounds BackgroundChunkTranscriber waitForIdle', async () => {
    const { WhisperTranscriptionEngine } = await import('../src/core/transcription/engine');
    const { BackgroundChunkTranscriber } = await import('../src/core/transcription/backgroundQueue');

    let workerIdx = 0;
    const engine = new WhisperTranscriptionEngine({
      wasmInitStallTimeoutMs: 5000,
      workerFactory: () => {
        const idx = workerIdx++;
        const fakeWorker: any = {
          onmessage: null,
          onerror: null,
          terminate: () => {},
          postMessage: (msg: any) => {
            if (msg.type === 'init' && idx === 1) {
              setTimeout(() => {
                fakeWorker.onmessage?.({ data: { type: 'init_done', payload: { device: 'wasm' } } });
              }, 10);
            }
          },
        };
        return fakeWorker as Worker;
      },
    });

    // First load hangs; abortLoad unblocks queue so second load succeeds
    const firstLoad = engine.load('balanced').catch((e) => e.message);
    await new Promise((r) => setTimeout(r, 10));
    expect(engine.isLoadInProgress()).toBe(true);
    engine.abortLoad();
    const firstResult = await firstLoad;
    expect(String(firstResult)).toContain('cancelada');

    await engine.load('balanced');
    expect(engine.isReady()).toBe(true);

    // BackgroundChunkTranscriber: skips uncached silent downloads and enforces bounded waitForIdle
    let slowEngineCalled = false;
    const bg = new BackgroundChunkTranscriber({
      getEngine: () =>
        ({
          isReady: () => true,
          transcribe: () =>
            new Promise((resolve) => {
              slowEngineCalled = true;
              setTimeout(() => resolve({ text: 'ok', chunks: [] }), 500);
            }),
          load: async () => {},
          dispose: async () => {},
          getActiveTier: () => 'balanced',
          getBackend: () => 'wasm',
          getActiveBackend: () => 'wasm',
        }),
      getSettings: () => ({ modelTier: 'balanced', transcriptionMode: 'dental' }),
      getCurrentSessionId: () => 's2',
      transcriptRepo: { addSegment: async () => {} },
      glossaryRepo: { getAll: async () => [] },
      isModelCached: async () => false,
    });

    // Realistic voiced sine wave (400 Hz) so VAD produces a speech segment
    const int16 = new Int16Array(16000);
    for (let i = 0; i < int16.length; i++) {
      int16[i] = Math.round(Math.sin((2 * Math.PI * 400 * i) / 16000) * 12000);
    }
    const pcm = int16.buffer;

    bg.enqueue(
      {
        id: 'c1',
        sessionId: 's1',
        chunkIndex: 0,
        startTime: 0,
        endTime: 1,
        pcmData: pcm,
        samples: 16000,
        sampleRate: 16000,
        createdAt: Date.now(),
      },
      's1',
      'ws1'
    );
    bg.enqueue(
      {
        id: 'c2',
        sessionId: 's1',
        chunkIndex: 1,
        startTime: 1,
        endTime: 2,
        pcmData: pcm,
        samples: 16000,
        sampleRate: 16000,
        createdAt: Date.now(),
      },
      's1',
      'ws1'
    );

    // Give processQueue microtasks a moment to acquire wakelock and enter slow engine.transcribe
    await new Promise((r) => setTimeout(r, 15));

    bg.clearAllPending();
    const drained = await bg.waitForIdle({ maxWaitMs: 40 });
    expect(slowEngineCalled).toBe(true);
    expect(drained).toBe(false);
  });
});

