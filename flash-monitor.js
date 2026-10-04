(() => {
  'use strict';
  const linear = Float32Array.from({ length: 256 }, (_, n) => {
    const c = n / 255;
    return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
  });
  // A coarse local warning heuristic, not a photosensitivity safety test or
  // WCAG certification. Sampling can miss flashes, small areas and patterns.
  class YacFlashMonitor {
    reset() {
      this.previous = null; this.directions = null;
      this.key = null; this.time = null; this.mediaTime = null;
      this.reversals = []; this.lastReversal = null; this.burstStart = null;
    }
    constructor() { this.reset(); }
    sample(pixels, time, mediaTime, key, crop = { x: 0, y: 0, width: 160, height: 90 }, playbackRate = 1) {
      if (!pixels || pixels.length < 160 * 90 * 4 || !Number.isFinite(time) || !Number.isFinite(mediaTime)) {
        this.reset(); return false;
      }
      const rate = Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
      if (key !== this.key || this.time !== null &&
          (time <= this.time || time - this.time > 200 || mediaTime < this.mediaTime || mediaTime - this.mediaTime > .25 * Math.max(1, rate))) this.reset();
      if (this.mediaTime === mediaTime) return false;
      const values = new Float32Array(20 * 12 * 2);
      let i = 0;
      for (let y = 0; y < 12; y++) for (let x = 0; x < 20; x++) {
        const px = Math.min(159, Math.max(0, Math.floor(crop.x + (x + .5) * crop.width / 20)));
        const py = Math.min(89, Math.max(0, Math.floor(crop.y + (y + .5) * crop.height / 12)));
        const p = (py * 160 + px) * 4;
        const r = pixels[p], g = pixels[p + 1], b = pixels[p + 2];
        values[i++] = .2126 * linear[r] + .7152 * linear[g] + .0722 * linear[b];
        values[i++] = r / Math.max(1, r + g + b) >= .8 ? Math.max(0, (r - g - b) / 255) : 0;
      }
      if (!this.directions) this.directions = new Int8Array(values.length);
      let opposing = 0;
      if (this.previous) for (let p = 0; p < 240; p++) {
        let reversed = false;
        for (let channel = 0; channel < 2; channel++) {
          const n = p * 2 + channel, delta = values[n] - this.previous[n];
          const direction = Math.abs(delta) >= (channel === 0 ? .12 : .2) ? Math.sign(delta) : 0;
          if (direction) {
            if (this.directions[n] && direction !== this.directions[n]) reversed = true;
            this.directions[n] = direction;
          }
        }
        if (reversed) opposing++;
      }
      this.previous = values; this.key = key; this.time = time; this.mediaTime = mediaTime;
      if (opposing >= 60) {
        this.reversals.push(time); this.lastReversal = time;
      } else if (this.lastReversal !== null && time - this.lastReversal > 300) {
        this.reversals = []; this.burstStart = null; this.directions.fill(0);
      }
      // At least eight large opposing transitions in a rolling second, sustained
      // for about three seconds. The small timing tolerance handles frame jitter.
      this.reversals = this.reversals.filter(t => time - t <= 1050);
      if (this.reversals.length >= 8) {
        if (this.burstStart === null) this.burstStart = this.reversals[0];
        if (time - this.burstStart >= 3000) { this.reset(); return true; }
      } else this.burstStart = null;
      return false;
    }
  }
  globalThis.YacFlashMonitor = YacFlashMonitor;
  if (typeof module !== 'undefined') module.exports = YacFlashMonitor;
})();
