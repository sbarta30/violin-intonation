import {YinPitchDetector} from './yin.js';
import {AutoGainController} from './autogain.js';

const ENABLE_DEBUG_LOGS = false;
const debugLog = (...args) => {
  if (ENABLE_DEBUG_LOGS) {
    console.debug('[PitchTracker]', ...args);
  }
};

const AUDIO_CONSTRAINTS = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
    latency: 0,
  },
  video: false,
};

export class PitchTracker {
  constructor({
    bufferSize = 2048,
    yinThreshold = 0.1,
    probabilityThreshold = 0.15,
    rmsThreshold = 0.01,
    autoGainOptions = {},
  } = {}) {
    this.bufferSize = bufferSize;
    this.yinThreshold = yinThreshold;
    this.probabilityThreshold = probabilityThreshold;
    this.rmsThreshold = rmsThreshold;
    this.buffer = null;
    this.audioContext = null;
    this.analyser = null;
    this.stream = null;
    this.source = null;
    this.yin = null;
    this.initialized = false;
    this._lastLowRmsLog = 0;
    this._lastNullPitchLog = 0;
    this._lastDetectionLog = 0;
    this.autoGain = null;
    this.autoGainOptions = {
      targetRms: 0.2,
      smoothingTime: 0.6,
      minGain: 0.5,
      maxGain: 200,
      gainSlew: 0.1,
      ...autoGainOptions,
    };
  }

  async init() {
    if (this.initialized) {
      debugLog('Already initialized, skipping init.');
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Your browser does not support microphone access.");
    }

    debugLog('Requesting microphone stream with constraints', AUDIO_CONSTRAINTS);
    // Acquire live audio stream with all automatic processing disabled to keep pitch intact.
    this.stream = await navigator.mediaDevices.getUserMedia(AUDIO_CONSTRAINTS);

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.audioContext = new AudioContextClass();
    debugLog('Created audio context', {
      sampleRate: this.audioContext.sampleRate,
      state: this.audioContext.state,
    });

    // Route the microphone into an analyser node so we can read raw samples for pitch detection.
    this.source = this.audioContext.createMediaStreamSource(this.stream);
    // Insert an automatic gain controller so the analyser always receives a levelled signal.
    this.autoGain = new AutoGainController(this.audioContext, this.autoGainOptions);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = this.bufferSize;
    this.analyser.minDecibels = -100;
    this.analyser.maxDecibels = -10;
    this.analyser.smoothingTimeConstant = 0;
    this.source.connect(this.autoGain.input);
    this.autoGain.connect(this.analyser);

    this.buffer = new Float32Array(this.analyser.fftSize);
    this.yin = new YinPitchDetector(this.audioContext.sampleRate, {
      threshold: this.yinThreshold,
      probabilityThreshold: this.probabilityThreshold,
      bufferSize: this.analyser.fftSize,
    });

    this.initialized = true;
    debugLog('Pitch tracker initialized.');
  }

  async start() {
    if (!this.initialized) {
      await this.init();
    }

    if (this.audioContext?.state === "suspended") {
      await this.audioContext.resume();
      debugLog('Audio context resumed.');
    }
    debugLog('Pitch tracker start complete.');
  }

  stop() {
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }
    if (this.autoGain) {
      this.autoGain.disconnect();
      this.autoGain = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.buffer = null;
    this.yin = null;
    this.initialized = false;
    debugLog('Pitch tracker stopped and resources released.');
  }

  getPitch() {
    if (!this.initialized || !this.analyser || this.audioContext?.state !== "running") {
      if (ENABLE_DEBUG_LOGS) {
        debugLog('Cannot get pitch: analyser missing or audio context not running.', {
          initialized: this.initialized,
          hasAnalyser: Boolean(this.analyser),
          contextState: this.audioContext?.state,
        });
      }
      return null;
    }

    // Pull the latest audio frame and reject very quiet input before running YIN.
    this.analyser.getFloatTimeDomainData(this.buffer);
    const {rms, peak} = this._analyseAmplitude(this.buffer);
    // Feed the amplitude reading into the gain controller before evaluating pitch.
    const gainMetrics = this.autoGain
      ? this.autoGain.update(rms)
      : {smoothedRms: rms, gain: 1};
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

    if (rms < this.rmsThreshold) {
      if (now - this._lastLowRmsLog > 500) {
        debugLog('RMS below threshold, skipping pitch detection.', {
          rms,
          threshold: this.rmsThreshold,
        });
        this._lastLowRmsLog = now;
      }
      return {
        frequency: null,
        probability: 0,
        rms,
        peak,
        smoothedRms: gainMetrics.smoothedRms,
        gain: gainMetrics.gain,
      };
    }

    const estimation = this.yin.getPitch(this.buffer);
    if (!estimation) {
      if (now - this._lastNullPitchLog > 500) {
        debugLog('YIN returned no pitch candidate.', {rms});
        this._lastNullPitchLog = now;
      }
      return {
        frequency: null,
        probability: 0,
        rms,
        peak,
        smoothedRms: gainMetrics.smoothedRms,
        gain: gainMetrics.gain,
      };
    }

    if (now - this._lastDetectionLog > 500) {
      debugLog('Detected pitch.', estimation);
      this._lastDetectionLog = now;
    }

    return {
      ...estimation,
      rms,
      peak,
      smoothedRms: gainMetrics.smoothedRms,
      gain: gainMetrics.gain,
    };
  }

  _analyseAmplitude(buffer) {
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < buffer.length; i++) {
      const sample = buffer[i];
      sum += sample * sample;
      const magnitude = Math.abs(sample);
      if (magnitude > peak) {
        peak = magnitude;
      }
    }
    return {
      rms: Math.sqrt(sum / buffer.length),
      peak,
    };
  }
}
