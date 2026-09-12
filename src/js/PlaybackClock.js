// Keep the slider's original 60 Hz scale: speed 1.5 = 90 days/second.
export default class PlaybackClock {
  constructor() { this.reset(); }

  reset() { this.previous = null; this.seconds = 0; }

  advance(timestamp, speed) {
    this.seconds = 0;
    if (!Number.isFinite(timestamp)) { this.reset(); return 0; }
    const previous = this.previous;
    this.previous = timestamp;
    if (previous === null || !Number.isFinite(speed) || speed === 0) return 0;
    this.seconds = Math.max(0, Math.min((timestamp - previous) / 1000, 0.25));
    return speed * 60 * this.seconds;
  }
}
