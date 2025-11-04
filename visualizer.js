const NOTE_ORDER = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const CENTS_RANGE = 50; // +/- cents visual range
const NOTE_COUNT = NOTE_ORDER.length;
const TIME_WINDOW = 10000; // milliseconds


// Maintains a scrolling history of pitch samples and renders them on a canvas.
export class PitchVisualizer {
  constructor(canvas, {
    timeWindow = TIME_WINDOW,
  } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.timeWindow = timeWindow;
    this.points = [];

    this.axisMarginLeft = 64;
    this.axisMarginRight = 12;
    this.axisMarginTop = 12;
    this.axisMarginBottom = 18;

    this.plotWidth = 1;
    this.plotHeight = 1;
    this.rowHeight = 1;

    this._handleResize = this.resize.bind(this);
    this._animate = this._animate.bind(this);
    this.isAnimating = false;
    this._animationFrame = null;

    window.addEventListener("resize", this._handleResize);
    this.resize();
  }

  resize() {
    const ratio = window.devicePixelRatio || 1;
    const displayWidth = this.canvas.clientWidth * ratio;
    const displayHeight = this.canvas.clientHeight * ratio;
    if (this.canvas.width !== displayWidth || this.canvas.height !== displayHeight) {
      this.canvas.width = displayWidth;
      this.canvas.height = displayHeight;
    }

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(ratio, ratio);

    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
    this.plotWidth = Math.max(1, this.width - this.axisMarginLeft - this.axisMarginRight);
    this.plotHeight = Math.max(1, this.height - this.axisMarginTop - this.axisMarginBottom);
    this.rowHeight = this.plotHeight / NOTE_COUNT;

    this.draw(); // refresh grid on resize
  }

  update(point) {
    if (!point) {
      return;
    }

    // Append the latest sample along with a timestamp for scrolling.
    const now = performance.now();
    this.points.push({
      ...point,
      time: now,
    });
    this._trim(now);
    this.draw();
  }

  draw() {
    const ctx = this.ctx;
    const now = performance.now();
    this._trim(now);

    ctx.clearRect(0, 0, this.width, this.height);

    this._drawBackgroundGrid();

    if (this.points.length === 0) {
      return;
    }

    const pixelsPerMs = this.plotWidth / this.timeWindow;

    ctx.save();
    ctx.translate(this.axisMarginLeft, this.axisMarginTop);

    ctx.lineWidth = 3.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    let lastPoint = null;

    for (let i = 0; i < this.points.length; i++) {
      const point = this.points[i];
      const age = now - point.time;
      const x = this.plotWidth - age * pixelsPerMs;
      if (x < 0 || x > this.plotWidth) {
        lastPoint = null;
        continue;
      }

      const y = this._mapNoteToY(point.noteIndex, point.cents);
      const color = this._colorForCents(point.cents);

      if (lastPoint && point.time - lastPoint.time <= 250 && lastPoint.noteIndex === point.noteIndex) {
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(lastPoint.x, lastPoint.y);
        ctx.lineTo(x, y);
        ctx.stroke();
      }

      lastPoint = {x, y, time: point.time, noteIndex: point.noteIndex};
    }

    ctx.restore();
  }

  clear() {
    this.points = [];
    this.draw();
  }

  destroy() {
    window.removeEventListener("resize", this._handleResize);
    this.stop();
    this.clear();
  }

  _trim(now) {
    const threshold = now - this.timeWindow;
    // Remove samples that have scrolled out of view to keep the buffer small.
    while (this.points.length && this.points[0].time < threshold) {
      this.points.shift();
    }
  }

  _drawBackgroundGrid() {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.axisMarginLeft, this.axisMarginTop);

    // Horizontal note guides and labels.
    ctx.save();
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.font = "12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    for (let index = 0; index < NOTE_COUNT; index++) {
      const y = this._mapNoteToY(index, 0);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.40)";
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.plotWidth, y);
      ctx.stroke();

      ctx.fillStyle = "rgba(244, 246, 248, 0.78)";
      ctx.fillText(NOTE_ORDER[index], -10, y);
    }
    ctx.restore();

    // Vertical time markers spaced one second apart.
    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.setLineDash([2, 6]);
    const pixelsPerMs = this.plotWidth / this.timeWindow;
    for (let ms = 1000; ms < this.timeWindow; ms += 1000) {
      const x = this.plotWidth - ms * pixelsPerMs;
      if (x < 0) {
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.plotHeight);
      ctx.stroke();
    }
    ctx.restore();

    ctx.restore();
  }

  _mapNoteToY(noteIndex, cents) {
    const clampedIndex = ((noteIndex % NOTE_COUNT) + NOTE_COUNT) % NOTE_COUNT;
    const clampedCents = Math.max(Math.min(cents, CENTS_RANGE), -CENTS_RANGE);
    const rowCenter = this.plotHeight - (clampedIndex + 0.5) * this.rowHeight;
    const centsOffset = (clampedCents / CENTS_RANGE) * (this.rowHeight * 0.4);
    return rowCenter - centsOffset;
  }

  _colorForCents(cents) {
    const deviation = Math.abs(cents);
    if (!Number.isFinite(deviation) || deviation <= 0.5) {
      return "#ffffff";
    }

    // Map larger deviations to stronger red (sharp) or blue (flat) hues.
    const ratio = Math.min(deviation, CENTS_RANGE) / CENTS_RANGE;
    const channel = Math.round(255 * (1 - ratio));

    if (cents > 0) {
      return `rgb(255, ${channel}, ${channel})`;
    }

    return `rgb(${channel}, ${channel}, 255)`;
  }

  start() {
    if (this.isAnimating) {
      return;
    }
    this.isAnimating = true;
    this._animationFrame = requestAnimationFrame(this._animate);
  }

  stop() {
    this.isAnimating = false;
    if (this._animationFrame !== null) {
      cancelAnimationFrame(this._animationFrame);
      this._animationFrame = null;
    }
    this.draw();
  }

  _animate() {
    if (!this.isAnimating) {
      return;
    }
    this.draw();
    this._animationFrame = requestAnimationFrame(this._animate);
  }
}
