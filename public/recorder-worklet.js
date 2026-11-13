/**
 * AudioWorkletProcessor for recording 16kHz Mono Int16 PCM chunks
 * Resamples on-the-fly to 16kHz if the input sample rate is different (e.g., 44.1kHz or 48kHz).
 * Automatically delivers ~30s chunks to the main thread to be saved directly to IndexedDB.
 */
class PcmRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetSampleRate = 16000;
    this.chunkDurationSec = 30;
    this.samplesPerChunk = this.targetSampleRate * this.chunkDurationSec; // 480,000 samples
    this.buffer = new Int16Array(this.samplesPerChunk);
    this.bufferIndex = 0;
    this.isPaused = false;

    // Resampling state (linear interpolation)
    this.resampleRatio = sampleRate / this.targetSampleRate;
    this.resamplePhase = 0.0;
    this.lastInputSample = 0.0;

    // VU meter calculation state
    this.vuSampleCounter = 0;
    this.vuWindowSamples = 800; // ~50ms window at 16kHz
    this.vuSumSquares = 0;
    this.vuPeak = 0;

    this.port.onmessage = (event) => {
      const data = event.data;
      if (data.command === 'pause') {
        this.isPaused = true;
      } else if (data.command === 'resume') {
        this.isPaused = false;
      } else if (data.command === 'flush') {
        this.flushChunk();
        this.port.postMessage({
          type: 'flush_done',
          flushId: data.flushId ?? null,
        });
      }
    };
  }

  flushChunk() {
    if (this.bufferIndex > 0) {
      // Create slice of the active buffer
      const filledBuffer = this.buffer.slice(0, this.bufferIndex);
      const duration = this.bufferIndex / this.targetSampleRate;
      
      this.port.postMessage({
        type: 'chunk',
        pcmData: filledBuffer.buffer,
        samples: this.bufferIndex,
        duration: duration,
        sampleRate: this.targetSampleRate
      }, [filledBuffer.buffer]);

      this.bufferIndex = 0;
    }
  }

  process(inputs) {
    if (this.isPaused) {
      return true;
    }

    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }

    // Downmix to mono if stereo or multi-channel
    const channel0 = input[0];
    const channel1 = input[1];
    const inputLength = channel0 ? channel0.length : 0;
    if (inputLength === 0) {
      return true;
    }

    // Resample input to 16kHz
    // If input sampleRate is already 16000, ratio is 1.0
    if (sampleRate === this.targetSampleRate) {
      for (let i = 0; i < inputLength; i++) {
        let sample = channel0[i];
        if (channel1) {
          sample = (sample + channel1[i]) * 0.5;
        }

        // Clamp to [-1.0, 1.0]
        if (sample > 1.0) sample = 1.0;
        else if (sample < -1.0) sample = -1.0;

        // Update VU stats
        this.updateVu(sample);

        // Convert to Int16
        const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        this.buffer[this.bufferIndex++] = intSample;

        if (this.bufferIndex >= this.samplesPerChunk) {
          this.flushChunk();
        }
      }
    } else {
      // Linear interpolation resampler
      for (let i = 0; i < inputLength; i++) {
        let currentInput = channel0[i];
        if (channel1) {
          currentInput = (currentInput + channel1[i]) * 0.5;
        }

        while (this.resamplePhase < 1.0) {
          // Interpolate between lastInputSample and currentInput
          const interp = this.lastInputSample + (currentInput - this.lastInputSample) * this.resamplePhase;
          let sample = interp;
          if (sample > 1.0) sample = 1.0;
          else if (sample < -1.0) sample = -1.0;

          this.updateVu(sample);

          const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
          this.buffer[this.bufferIndex++] = intSample;

          if (this.bufferIndex >= this.samplesPerChunk) {
            this.flushChunk();
          }

          this.resamplePhase += this.resampleRatio;
        }

        this.resamplePhase -= 1.0;
        this.lastInputSample = currentInput;
      }
    }

    return true;
  }

  updateVu(sample) {
    this.vuSumSquares += sample * sample;
    const absSample = Math.abs(sample);
    if (absSample > this.vuPeak) {
      this.vuPeak = absSample;
    }
    this.vuSampleCounter++;

    if (this.vuSampleCounter >= this.vuWindowSamples) {
      const rms = Math.sqrt(this.vuSumSquares / this.vuSampleCounter);
      this.port.postMessage({
        type: 'vu',
        rms: rms,
        peak: this.vuPeak
      });
      this.vuSampleCounter = 0;
      this.vuSumSquares = 0;
      this.vuPeak = 0;
    }
  }
}

registerProcessor('pcm-recorder-processor', PcmRecorderProcessor);
