import { IAudioStore, ISessionRepository } from '../interfaces';
import { AudioChunk, Session } from '../types';
import { wakeLockManager } from '../utils/wakeLockManager';

export interface VuData {
  rms: number;
  peak: number;
}

export interface RecordingCallbacks {
  onTimeUpdate: (durationSec: number) => void;
  onVuUpdate: (vu: VuData) => void;
  onChunkSaved: (lastSavedAt: number, totalChunks: number, chunk?: AudioChunk) => void;
  onSilenceWarning: (isSilent: boolean) => void;
  onWakeLockChange: (isActive: boolean) => void;
  onTrackEnded: (reason: string) => void;
  onError: (err: Error) => void;
}

export interface StartRecordingOptions {
  noiseSuppression?: boolean;
  audioDeviceId?: string;
  initialChunkIndex?: number;
  initialOffsetSec?: number;
  skipSessionCreate?: boolean;
}

export class RecordingController {
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;

  private currentSession: Session | null = null;
  private isRecording = false;
  private isPaused = false;
  private durationSec = 0;
  private cumulativeAudioSec = 0;
  private timerInterval: ReturnType<typeof setInterval> | null = null;

  private chunkIndex = 0;
  private lastSavedAt = 0;
  private lastSoundDetectedAt = 0;
  private silenceCheckInterval: ReturnType<typeof setInterval> | null = null;
  private silenceWarningActive = false;
  private callbacks: Partial<RecordingCallbacks> = {};
  private visibilityListenerAttached = false;

  // Serialize IndexedDB chunk writes and synchronize deterministic worklet flushes
  private chunkWriteChain: Promise<void> = Promise.resolve();
  private flushCounter = 0;
  private pendingFlushResolvers = new Map<number, () => void>();

  constructor(
    private sessionRepo: ISessionRepository,
    private audioStore: IAudioStore
  ) {
    this.attachVisibilityListener();
  }

  private attachVisibilityListener() {
    if (typeof document !== 'undefined' && !this.visibilityListenerAttached) {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
      this.visibilityListenerAttached = true;
    }
  }

  private detachVisibilityListener() {
    if (typeof document !== 'undefined' && this.visibilityListenerAttached) {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
      this.visibilityListenerAttached = false;
    }
  }

  public setCallbacks(cbs: Partial<RecordingCallbacks>) {
    this.callbacks = cbs;
  }

  public async startRecording(
    session: Session,
    options: StartRecordingOptions = {}
  ): Promise<void> {
    if (this.isRecording) {
      throw new Error('Ya hay una grabación en curso');
    }

    this.attachVisibilityListener();

    this.currentSession = session;
    this.chunkIndex = options.initialChunkIndex ?? 0;
    const initialOffset = options.initialOffsetSec ?? 0;
    this.durationSec = Math.round(initialOffset);
    this.cumulativeAudioSec = initialOffset;
    this.isPaused = false;
    this.lastSoundDetectedAt = Date.now();
    this.silenceWarningActive = false;
    this.chunkWriteChain = Promise.resolve();

    // 1. Get user media with explicit medical-recording constraints
    const audioConstraints: MediaTrackConstraints = {
      echoCancellation: false,
      autoGainControl: false,
      noiseSuppression: options.noiseSuppression ?? false,
      channelCount: 1,
    };

    if (options.audioDeviceId) {
      audioConstraints.deviceId = { exact: options.audioDeviceId };
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false,
      });
    } catch {
      if (options.audioDeviceId) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            autoGainControl: false,
            noiseSuppression: options.noiseSuppression ?? false,
            channelCount: 1,
          },
          video: false,
        });
      } else {
        throw new Error('No se pudo acceder al micrófono');
      }
    }
    this.mediaStream = stream;

    // Detect unexpected hardware disconnection (Bluetooth unplugged, OS permission revoked)
    stream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        if (this.isRecording) {
          this.silenceWarningActive = true;
          this.callbacks.onSilenceWarning?.(true);
          this.callbacks.onTrackEnded?.(
            'El micrófono se desconectó o perdió acceso en medio de la grabación.'
          );
        }
      };
    });

    // 2. Initialize AudioContext (prefer 16000Hz, fall back to native device rate)
    let ctx: AudioContext;
    try {
      ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)({
        sampleRate: 16000,
      });
    } catch {
      ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    this.audioContext = ctx;

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    // 3. Load AudioWorkletProcessor
    await ctx.audioWorklet.addModule('/recorder-worklet.js');

    this.sourceNode = ctx.createMediaStreamSource(stream);

    // Human vocal bandpass (80Hz - 7000Hz) with 24dB/oct anti-aliasing rolloff
    // so frequencies above 8kHz Nyquist don't alias onto consonants during 16kHz resampling
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 80;
    highpass.Q.value = 0.707;

    const lowpassStage1 = ctx.createBiquadFilter();
    lowpassStage1.type = 'lowpass';
    lowpassStage1.frequency.value = 7000;
    lowpassStage1.Q.value = 0.707;

    const lowpassStage2 = ctx.createBiquadFilter();
    lowpassStage2.type = 'lowpass';
    lowpassStage2.frequency.value = 7000;
    lowpassStage2.Q.value = 0.707;

    this.workletNode = new AudioWorkletNode(ctx, 'pcm-recorder-processor');

    this.workletNode.port.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (data.type === 'chunk') {
        // Queue chunk persistence strictly in sequence
        this.chunkWriteChain = this.chunkWriteChain
          .then(() => this.handleChunkReceived(data))
          .catch((err) => {
            console.error('Error guardando fragmento de audio:', err);
            this.callbacks.onError?.(
              err instanceof Error ? err : new Error('Error al guardar fragmento de audio')
            );
          });
      } else if (data.type === 'flush_done') {
        const flushId = data.flushId as number | null;
        if (flushId !== null && this.pendingFlushResolvers.has(flushId)) {
          const resolve = this.pendingFlushResolvers.get(flushId)!;
          this.pendingFlushResolvers.delete(flushId);
          resolve();
        }
      } else if (data.type === 'vu') {
        this.handleVuData(data);
      }
    };

    this.sourceNode.connect(highpass);
    highpass.connect(lowpassStage1);
    lowpassStage1.connect(lowpassStage2);
    lowpassStage2.connect(this.workletNode);
    const silentGain = ctx.createGain();
    silentGain.gain.value = 0;
    this.workletNode.connect(silentGain);
    silentGain.connect(ctx.destination);

    // 4. Persist or update session status in DB
    if (options.skipSessionCreate) {
      await this.sessionRepo.update(session.id, { status: 'recording' });
    } else {
      await this.sessionRepo.create(session);
    }

    // 5. Request Screen Wake Lock
    await this.requestWakeLock();

    // 6. Start duration timer
    this.isRecording = true;
    this.timerInterval = setInterval(() => {
      if (!this.isPaused) {
        this.durationSec += 1;
        this.callbacks.onTimeUpdate?.(this.durationSec);
      }
    }, 1000);

    // 7. Check for continuous silence (30s threshold)
    this.silenceCheckInterval = setInterval(() => {
      if (!this.isPaused && this.isRecording) {
        const timeSinceSound = Date.now() - this.lastSoundDetectedAt;
        if (timeSinceSound > 30000 && !this.silenceWarningActive) {
          this.silenceWarningActive = true;
          this.callbacks.onSilenceWarning?.(true);
        } else if (timeSinceSound <= 30000 && this.silenceWarningActive) {
          this.silenceWarningActive = false;
          this.callbacks.onSilenceWarning?.(false);
        }
      }
    }, 2000);
  }

  private async flushWorkletAndDrain(): Promise<void> {
    if (this.workletNode) {
      const flushId = ++this.flushCounter;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.pendingFlushResolvers.delete(flushId);
          resolve();
        }, 1500);

        this.pendingFlushResolvers.set(flushId, () => {
          clearTimeout(timer);
          resolve();
        });

        this.workletNode?.port.postMessage({ command: 'flush', flushId });
      });
    }
    // Wait until every queued IndexedDB write for those chunks finishes
    await this.chunkWriteChain;
  }

  private async handleChunkReceived(data: {
    pcmData: ArrayBuffer;
    samples: number;
    duration: number;
    sampleRate: number;
  }) {
    if (!this.currentSession) return;

    const sessionId = this.currentSession.id;
    const currentIdx = this.chunkIndex;
    const startTime = this.cumulativeAudioSec;
    const endTime = startTime + data.duration;

    const chunk: AudioChunk = {
      id: `chunk_${sessionId}_${currentIdx}`,
      sessionId,
      chunkIndex: currentIdx,
      startTime,
      endTime,
      pcmData: data.pcmData,
      samples: data.samples,
      sampleRate: data.sampleRate,
      createdAt: Date.now(),
    };

    await this.audioStore.addChunk(chunk);

    this.chunkIndex++;
    this.cumulativeAudioSec = endTime;
    this.lastSavedAt = Date.now();

    await this.sessionRepo.update(sessionId, {
      durationSec: Math.round(endTime),
    });

    this.callbacks.onChunkSaved?.(this.lastSavedAt, this.chunkIndex, chunk);
  }

  private handleVuData(vu: VuData) {
    if (vu.rms > 0.008) {
      this.lastSoundDetectedAt = Date.now();
      if (this.silenceWarningActive) {
        this.silenceWarningActive = false;
        this.callbacks.onSilenceWarning?.(false);
      }
    }
    this.callbacks.onVuUpdate?.(vu);
  }

  public pauseRecording() {
    if (!this.isRecording || this.isPaused) return;
    this.isPaused = true;
    if (this.audioContext && this.audioContext.state === 'running') {
      this.audioContext.suspend().catch(() => {});
    }
    this.workletNode?.port.postMessage({ command: 'pause' });
  }

  public resumeRecording() {
    if (!this.isRecording || !this.isPaused) return;
    this.isPaused = false;
    this.lastSoundDetectedAt = Date.now();
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume().catch(() => {});
    }
    this.workletNode?.port.postMessage({ command: 'resume' });
  }

  /**
   * 1-Touch transition to the next patient without restarting the audio hardware,
   * keeping the microphone open and Screen Wake Lock active.
   */
  public async switchNextPatient(newSession: Session): Promise<Session> {
    if (!this.currentSession) {
      throw new Error('No hay sesión de grabación activa');
    }

    const previousSession = this.currentSession;

    // If clinician pressed Next Patient while paused, resume hardware cleanly for the next patient
    if (this.isPaused) {
      this.resumeRecording();
    }

    // Deterministically flush pending audio and wait for IndexedDB writes before switching session pointers
    await this.flushWorkletAndDrain();

    const finalDuration = Math.max(1, Math.round(Math.max(this.durationSec, this.cumulativeAudioSec)));
    await this.sessionRepo.update(previousSession.id, {
      status: 'recorded',
      durationSec: finalDuration,
    });
    previousSession.status = 'recorded';
    previousSession.durationSec = finalDuration;

    await this.sessionRepo.create(newSession);

    this.currentSession = newSession;
    this.chunkIndex = 0;
    this.durationSec = 0;
    this.cumulativeAudioSec = 0;
    this.lastSavedAt = Date.now();
    this.lastSoundDetectedAt = Date.now();
    this.silenceWarningActive = false;

    this.callbacks.onTimeUpdate?.(0);
    this.callbacks.onSilenceWarning?.(false);
    this.callbacks.onChunkSaved?.(this.lastSavedAt, 0);

    return previousSession;
  }

  public async stopRecording(): Promise<Session> {
    if (!this.currentSession) {
      throw new Error('No hay sesión de grabación activa');
    }

    const session = this.currentSession;
    this.isRecording = false;
    this.isPaused = false;

    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.silenceCheckInterval) clearInterval(this.silenceCheckInterval);
    this.timerInterval = null;
    this.silenceCheckInterval = null;

    // Deterministically flush worklet & wait for all IndexedDB chunk writes while currentSession is still set
    await this.flushWorkletAndDrain();

    this.cleanupAudioHardware();
    this.detachVisibilityListener();
    await this.releaseWakeLock();

    const finalDuration = Math.max(1, Math.round(Math.max(this.durationSec, this.cumulativeAudioSec)));
    await this.sessionRepo.update(session.id, {
      status: 'recorded',
      durationSec: finalDuration,
    });

    session.status = 'recorded';
    session.durationSec = finalDuration;

    this.currentSession = null;
    return session;
  }

  public async discardRecording(): Promise<void> {
    if (!this.currentSession) return;
    const sessionId = this.currentSession.id;

    this.isRecording = false;
    this.isPaused = false;
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.silenceCheckInterval) clearInterval(this.silenceCheckInterval);
    this.timerInterval = null;
    this.silenceCheckInterval = null;

    // Reject any pending chunk writes after hardware teardown
    this.currentSession = null;
    this.cleanupAudioHardware();
    this.detachVisibilityListener();
    await this.releaseWakeLock();

    await this.chunkWriteChain.catch(() => {});
    await this.audioStore.deleteAudio(sessionId);
    await this.sessionRepo.delete(sessionId);
  }

  private cleanupAudioHardware() {
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      try {
        this.workletNode.disconnect();
      } catch {
        // ignore
      }
      this.workletNode = null;
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        // ignore
      }
      this.sourceNode = null;
    }
    this.mediaStream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    this.mediaStream = null;
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(() => {});
    }
    this.audioContext = null;
  }

  private async requestWakeLock() {
    await wakeLockManager.acquire('recording');
    this.callbacks.onWakeLockChange?.(wakeLockManager.isActive());
  }

  private async releaseWakeLock() {
    await wakeLockManager.release('recording');
    this.callbacks.onWakeLockChange?.(wakeLockManager.isActive());
  }

  private handleVisibilityChange = async () => {
    if (this.isRecording && !this.isPaused && document.visibilityState === 'visible') {
      await this.requestWakeLock();
    }
  };

  /**
   * Import an existing audio file (mp3, wav, m4a, webm)
   * Resamples in 30s windows to avoid huge single-allocation OOM on mobile devices.
   */
  public static async importAudioFile(
    file: File,
    session: Session,
    sessionRepo: ISessionRepository,
    audioStore: IAudioStore,
    onProgress?: (pct: number) => void
  ): Promise<Session> {
    const arrayBuffer = await file.arrayBuffer();
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioContext = new AudioCtx();

    onProgress?.(10);
    const decodedAudio = await audioContext.decodeAudioData(arrayBuffer);
    await audioContext.close();
    onProgress?.(25);

    const targetSampleRate = 16000;
    const sourceSampleRate = decodedAudio.sampleRate;
    const totalDuration = decodedAudio.duration;
    const windowSec = 30;
    const totalChunks = Math.max(1, Math.ceil(totalDuration / windowSec));

    let cumulativeSec = 0;

    for (let c = 0; c < totalChunks; c++) {
      const startSec = c * windowSec;
      const chunkDuration = Math.min(windowSec, totalDuration - startSec);
      if (chunkDuration <= 0) break;

      const srcStartSample = Math.floor(startSec * sourceSampleRate);
      const srcLength = Math.min(
        decodedAudio.length - srcStartSample,
        Math.ceil(chunkDuration * sourceSampleRate)
      );
      if (srcLength <= 0) break;

      // Build a temporary single-window mono buffer to keep OfflineAudioContext memory bounded
      const windowBuffer = new AudioBuffer({
        length: srcLength,
        numberOfChannels: 1,
        sampleRate: sourceSampleRate,
      });
      const targetChannel = windowBuffer.getChannelData(0);

      if (decodedAudio.numberOfChannels === 1) {
        targetChannel.set(decodedAudio.getChannelData(0).subarray(srcStartSample, srcStartSample + srcLength));
      } else {
        const ch0 = decodedAudio.getChannelData(0);
        const ch1 = decodedAudio.getChannelData(1);
        for (let i = 0; i < srcLength; i++) {
          targetChannel[i] = (ch0[srcStartSample + i] + ch1[srcStartSample + i]) * 0.5;
        }
      }

      const targetSamples = Math.max(1, Math.ceil((srcLength / sourceSampleRate) * targetSampleRate));
      const offlineCtx = new OfflineAudioContext(1, targetSamples, targetSampleRate);
      const source = offlineCtx.createBufferSource();
      source.buffer = windowBuffer;
      source.connect(offlineCtx.destination);
      source.start(0);

      const renderedBuffer = await offlineCtx.startRendering();
      const float32Samples = renderedBuffer.getChannelData(0);
      const int16Chunk = new Int16Array(float32Samples.length);

      for (let i = 0; i < float32Samples.length; i++) {
        let sample = float32Samples[i];
        if (sample > 1.0) sample = 1.0;
        else if (sample < -1.0) sample = -1.0;
        int16Chunk[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }

      const actualDur = float32Samples.length / targetSampleRate;
      const chunk: AudioChunk = {
        id: `chunk_${session.id}_${c}`,
        sessionId: session.id,
        chunkIndex: c,
        startTime: cumulativeSec,
        endTime: cumulativeSec + actualDur,
        pcmData: int16Chunk.buffer,
        samples: float32Samples.length,
        sampleRate: targetSampleRate,
        createdAt: Date.now(),
      };

      cumulativeSec += actualDur;
      await audioStore.addChunk(chunk);
      onProgress?.(25 + Math.round(((c + 1) / totalChunks) * 70));
    }

    session.durationSec = Math.round(totalDuration);
    session.status = 'recorded';
    await sessionRepo.create(session);
    onProgress?.(100);

    return session;
  }
}
