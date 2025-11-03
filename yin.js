// Implements the YIN pitch detection algorithm for monophonic sources.
export class YinPitchDetector {
  constructor(sampleRate, {
    threshold = 0.1,
    probabilityThreshold = 0.1,
    bufferSize = 2048,
  } = {}) {
    this.sampleRate = sampleRate;
    this.threshold = threshold;
    this.probabilityThreshold = probabilityThreshold;
    this.bufferSize = bufferSize;
    this.halfBuffer = Math.floor(bufferSize / 2);
    this.difference = new Float32Array(this.halfBuffer);
    this.cumulativeMean = new Float32Array(this.halfBuffer);
  }

  /**
   * Estimate the fundamental frequency present in the given audio buffer.
   * Returns null when no stable pitch is detected above the configured probability threshold.
   */
  getPitch(buffer) {
    let tau;

    this._difference(buffer);
    this._cumulativeMeanNormalizedDifference();

    tau = this._absoluteThreshold();
    if (tau === -1) {
      return null;
    }

    // Refine tau using parabolic interpolation for higher precision in cents.
    const betterTau = this._parabolicInterpolation(tau);
    const frequency = this.sampleRate / betterTau;
    const probability = 1 - this.cumulativeMean[tau];

    if (probability < this.probabilityThreshold) {
      return null;
    }

    return {
      frequency,
      probability,
    };
  }

  _difference(buffer) {
    // Step 1: difference function that measures waveform self-similarity at different delays.
    this.difference[0] = 0;

    for (let tau = 1; tau < this.halfBuffer; tau++) {
      let sum = 0;
      for (let i = 0; i < this.halfBuffer; i++) {
        const delta = buffer[i] - buffer[i + tau];
        sum += delta * delta;
      }
      this.difference[tau] = sum;
    }
  }

  _cumulativeMeanNormalizedDifference() {
    // Step 2: cumulative mean normalized difference dampens the raw difference values.
    this.cumulativeMean[0] = 1;
    let runningSum = 0;

    for (let tau = 1; tau < this.halfBuffer; tau++) {
      runningSum += this.difference[tau];
      if (runningSum !== 0) {
        this.cumulativeMean[tau] = (this.difference[tau] * tau) / runningSum;
      } else {
        this.cumulativeMean[tau] = 1;
      }
    }
  }

  _absoluteThreshold() {
    let tau = 2;

    // Step 3: find the first minimum that drops below the stability threshold.
    for (; tau < this.halfBuffer; tau++) {
      if (this.cumulativeMean[tau] < this.threshold) {
        while (
          tau + 1 < this.halfBuffer &&
          this.cumulativeMean[tau + 1] < this.cumulativeMean[tau]
        ) {
          tau++;
        }
        return tau;
      }
    }

    return -1;
  }

  _parabolicInterpolation(tau) {
    if (tau < 1 || tau + 1 >= this.halfBuffer) {
      return tau;
    }

    // Step 4: refine the tau estimate to sub-sample accuracy.
    const s0 = this.cumulativeMean[tau - 1];
    const s1 = this.cumulativeMean[tau];
    const s2 = this.cumulativeMean[tau + 1];
    const betterTau = tau + (s2 - s0) / (2 * (2 * s1 - s2 - s0));

    return isFinite(betterTau) ? betterTau : tau;
  }
}
