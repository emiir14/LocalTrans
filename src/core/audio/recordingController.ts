import { IAudioStore, ISessionRepository } from '../interfaces';
import { AudioChunk, Session } from '../types';

export interface VuData {
  rms: number;
  peak: number;
}

export interface BatteryStatus {
  supported: boolean;
  level: number; // 0 - 100
  charging: boolean;
}

export interface RecordingCallbacks {
  onTimeUpdate: (durationSec: number) => void;
  onVuUpdate: (vu: VuData) => void;
  onChunkSaved: (lastSavedAt: number, totalChunks: number, chunk?: AudioChunk) => void;
  onSilenceWarning: (isSilent: boolean) => void;
  onWakeLockChange: (isActive: boolean) => void;
  onError: (err: Error) => void;
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
  private timerInterval: any = null;

  private chunkIndex = 0;
  private lastSavedAt = 0;
  private lastSoundDetectedAt = 0;
  private silenceCheckInterval: any = null;
  private silenceWarningActive = false;

  private wakeLock: any = null;
  private callbacks: Partial<RecordingCallbacks> = {};

  constructor(
    private sessionRepo: ISessionRepository,
    private audioStore: IAudioStore
  ) {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  public setCallbacks(cbs: Partial<RecordingCallbacks>) {
    this.callbacks = cbs;
  }

  public async startRecording(
    session: Session,
    options: { noiseSuppression?: boolean; audioDeviceId?: string } = {}
  ): Promise<void> {
    if (this.isRecording) {
      throw new Error('Ya hay una grabación en curso');
    }

    this.currentSession = session;
    this.chunkIndex = 0;
    this.durationSec = 0;
    this.isPaused = false;
    this.lastSoundDetectedAt = Date.now();
    this.silenceWarningActive = false;

    // 1. Get user media with explicit medical-recording constraints
    // Echo cancellation and AGC are off to preserve true acoustics and dynamic range.
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
      // If exact deviceId fails (e.g. unplugged Bluetooth or external headset), fallback to default audio device
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

    // 2. Initialize AudioContext (prefer 16000Hz, fall back to native device rate)
    let ctx: AudioContext;
    try {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });
    } catch {
      ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    this.audioContext = ctx;

    // 3. Load AudioWorkletProcessor
    await ctx.audioWorklet.addModule('/recorder-worklet.js');

    this.sourceNode = ctx.createMediaStreamSource(stream);

    // Highpass filter (80Hz) to remove mechanical desk thumps, low HVAC rumble, and mic contact pops
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 80;
    highpass.Q.value = 0.7;

    this.workletNode = new AudioWorkletNode(ctx, 'pcm-recorder-processor');

    // Handle messages from the worklet
    this.workletNode.port.onmessage = async (event: MessageEvent) => {
      const data = event.data;
      if (data.type === 'chunk') {
        await this.handleChunkReceived(data);
      } else if (data.type === 'vu') {
        this.handleVuData(data);
      }
    };

    this.sourceNode.connect(highpass);
    highpass.connect(this.workletNode);
    // Connect to a dummy gain to keep the graph alive without feeding audio to speakers
    const silentGain = ctx.createGain();
    silentGain.gain.value = 0;
    this.workletNode.connect(silentGain);
    silentGain.connect(ctx.destination);

    // 4. Update session status in DB
    await this.sessionRepo.create(session);

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

  private async handleChunkReceived(data: {
    pcmData: ArrayBuffer;
    samples: number;
    duration: number;
    sampleRate: number;
  }) {
    if (!this.currentSession) return;

    const chunkId = `chunk_${this.currentSession.id}_${this.chunkIndex}`;
    const startTime = this.chunkIndex * 30; // Approx 30s per chunk
    const endTime = startTime + data.duration;

    const chunk: AudioChunk = {
      id: chunkId,
      sessionId: this.currentSession.id,
      chunkIndex: this.chunkIndex,
      startTime,
      endTime,
      pcmData: data.pcmData,
      samples: data.samples,
      sampleRate: data.sampleRate,
      createdAt: Date.now(),
    };

    // Save IMMEDIATELY into IndexedDB
    await this.audioStore.addChunk(chunk);

    this.chunkIndex++;
    this.lastSavedAt = Date.now();

    // Update session duration in DB
    await this.sessionRepo.update(this.currentSession.id, {
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
    this.workletNode?.port.postMessage({ command: 'pause' });
  }

  public resumeRecording() {
    if (!this.isRecording || !this.isPaused) return;
    this.isPaused = false;
    this.lastSoundDetectedAt = Date.now();
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

    // Flush any pending samples in the worklet for the previous session
    if (this.workletNode) {
      this.workletNode.port.postMessage({ command: 'flush' });
      await new Promise((r) => setTimeout(r, 150));
    }

    // Finalize previous session in repository
    const finalDuration = Math.max(1, this.durationSec);
    await this.sessionRepo.update(previousSession.id, {
      status: 'recorded',
      durationSec: finalDuration,
    });
    previousSession.status = 'recorded';
    previousSession.durationSec = finalDuration;

    // Create new session in repository
    await this.sessionRepo.create(newSession);

    // Switch pointers cleanly
    this.currentSession = newSession;
    this.chunkIndex = 0;
    this.durationSec = 0;
    this.lastSavedAt = Date.now();
    this.lastSoundDetectedAt = Date.now();
    this.silenceWarningActive = false;

    // Reset callbacks for new patient
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

    clearInterval(this.timerInterval);
    clearInterval(this.silenceCheckInterval);

    // Flush any pending samples in the worklet buffer
    if (this.workletNode) {
      this.workletNode.port.postMessage({ command: 'flush' });
      // Give 250ms for the worklet flush message to be stored in IndexedDB
      await new Promise((r) => setTimeout(r, 250));
    }

    // Stop all media tracks
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        await this.audioContext.close();
      } catch {
        // ignore
      }
    }

    // Release wake lock
    await this.releaseWakeLock();

    // Mark session as recorded and finalized
    const finalDuration = Math.max(1, this.durationSec);
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
    clearInterval(this.timerInterval);
    clearInterval(this.silenceCheckInterval);

    this.mediaStream?.getTracks().forEach((track) => track.stop());
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        await this.audioContext.close();
      } catch {
        // ignore
      }
    }

    await this.releaseWakeLock();

    // Delete session and its chunks
    await this.audioStore.deleteAudio(sessionId);
    await this.sessionRepo.delete(sessionId);
    this.currentSession = null;
  }

  private async requestWakeLock() {
    if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
      try {
        this.wakeLock = await (navigator as any).wakeLock.request('screen');
        this.callbacks.onWakeLockChange?.(true);
        this.wakeLock.addEventListener('release', () => {
          this.callbacks.onWakeLockChange?.(false);
        });
      } catch {
        this.callbacks.onWakeLockChange?.(false);
      }
    } else {
      this.callbacks.onWakeLockChange?.(false);
    }
  }

  private async releaseWakeLock() {
    if (this.wakeLock) {
      try {
        await this.wakeLock.release();
      } catch {
        // ignore
      }
      this.wakeLock = null;
      this.callbacks.onWakeLockChange?.(false);
    }
  }

  private handleVisibilityChange = async () => {
    if (this.isRecording && !this.isPaused && document.visibilityState === 'visible') {
      await this.requestWakeLock();
    }
  };

  public static async getBatteryStatus(): Promise<BatteryStatus> {
    if (typeof navigator !== 'undefined' && 'getBattery' in navigator) {
      try {
        const battery: any = await (navigator as any).getBattery();
        return {
          supported: true,
          level: Math.round(battery.level * 100),
          charging: battery.charging,
        };
      } catch {
        // fallback
      }
    }
    return { supported: false, level: 100, charging: true };
  }

  /**
   * Import an existing audio file (mp3, wav, m4a, webm)
   * Decodes & resamples to 16kHz Int16 chunks in IndexedDB
   */
  public static async importAudioFile(
    file: File,
    session: Session,
    sessionRepo: ISessionRepository,
    audioStore: IAudioStore,
    onProgress?: (pct: number) => void
  ): Promise<Session> {
    const arrayBuffer = await file.arrayBuffer();
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    onProgress?.(10);
    const decodedAudio = await audioContext.decodeAudioData(arrayBuffer);
    onProgress?.(30);

    // Resample to 16kHz mono using OfflineAudioContext
    const targetSampleRate = 16000;
    const duration = decodedAudio.duration;
    const targetLength = Math.ceil(duration * targetSampleRate);

    const offlineCtx = new OfflineAudioContext(1, targetLength, targetSampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = decodedAudio;
    source.connect(offlineCtx.destination);
    source.start(0);

    onProgress?.(50);
    const renderedBuffer = await offlineCtx.startRendering();
    const float32Samples = renderedBuffer.getChannelData(0);
    onProgress?.(70);

    // Slice into ~30s chunks and write to IndexedDB
    const samplesPerChunk = targetSampleRate * 30; // 480,000 samples
    const totalChunks = Math.ceil(float32Samples.length / samplesPerChunk);

    for (let c = 0; c < totalChunks; c++) {
      const startIdx = c * samplesPerChunk;
      const endIdx = Math.min(float32Samples.length, startIdx + samplesPerChunk);
      const chunkSamples = endIdx - startIdx;
      const int16Chunk = new Int16Array(chunkSamples);

      for (let i = 0; i < chunkSamples; i++) {
        let sample = float32Samples[startIdx + i];
        if (sample > 1.0) sample = 1.0;
        else if (sample < -1.0) sample = -1.0;
        int16Chunk[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }

      const chunk: AudioChunk = {
        id: `chunk_${session.id}_${c}`,
        sessionId: session.id,
        chunkIndex: c,
        startTime: c * 30,
        endTime: c * 30 + chunkSamples / targetSampleRate,
        pcmData: int16Chunk.buffer,
        samples: chunkSamples,
        sampleRate: targetSampleRate,
        createdAt: Date.now(),
      };

      await audioStore.addChunk(chunk);
      onProgress?.(70 + Math.round((c / totalChunks) * 25));
    }

    session.durationSec = Math.round(duration);
    session.status = 'recorded';
    await sessionRepo.create(session);
    await audioContext.close();
    onProgress?.(100);

    return session;
  }
}
