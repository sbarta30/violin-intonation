// Provides automatic gain control for the live microphone signal.
export class AutoGainController {
  constructor(audioContext, {
    targetRms = 0.2,
    smoothingTime = 0.6,
    minGain = 0.5,
    maxGain = 50,
    gainSlew = 0.1,
    epsilon = 1e-6,
  } = {}) {
    this.audioContext = audioContext;
    this.targetRms = targetRms;
    this.smoothingTime = Math.max(smoothingTime, 1e-3);
    this.minGain = minGain;
    this.maxGain = maxGain;
    this.gainSlew = Math.max(gainSlew, 1e-3);
    this.epsilon = epsilon;

    this.node = this.audioContext.createGain();
    this.node.gain.value = 1;

    this.smoothedRms = null;
    this.lastUpdateTime = null;
    this.currentGain = 1;
  }

  get input() {
    return this.node;
  }

  connect(destination) {
    this.node.connect(destination);
  }

  disconnect() {
    this.node.disconnect();
  }

  /**
   * Update the controller with the latest frame RMS measurement and retune the gain.
   * Returns the smoothed RMS and the current gain so callers can display diagnostics.
   */
  update(rms) {
    const now = this.audioContext.currentTime;

    if (!Number.isFinite(rms)) {
      return {
        smoothedRms: this.smoothedRms ?? 0,
        gain: this.currentGain,
      };
    }

    if (this.smoothedRms === null) {
      this.smoothedRms = rms;
    } else {
      const dt = this.lastUpdateTime === null ? 0 : Math.max(0, now - this.lastUpdateTime);
      const alpha = dt > 0 ? 1 - Math.exp(-dt / this.smoothingTime) : 1;
      this.smoothedRms = (1 - alpha) * this.smoothedRms + alpha * rms;
    }

    const desiredGain = this._clamp(this.targetRms / (this.smoothedRms + this.epsilon));
    this.node.gain.setTargetAtTime(desiredGain, now, this.gainSlew);

    this.currentGain = desiredGain;
    this.lastUpdateTime = now;

    return {
      smoothedRms: this.smoothedRms,
      gain: this.currentGain,
    };
  }

  _clamp(value) {
    return Math.min(this.maxGain, Math.max(this.minGain, value));
  }
}
