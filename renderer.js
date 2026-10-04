(() => {
  'use strict';
  // Independent of YouTube: source frame + video rectangle + viewport.
  globalThis.YacRenderer = class {
    static scrollBlend(rectangle, viewport) {
      const visible = Math.max(0, Math.min(rectangle.top + rectangle.height, viewport.height) - Math.max(rectangle.top, viewport.top || 0));
      const hidden = Math.min(1, Math.max(0, (0.5 - visible / Math.max(1, rectangle.height)) * 2));
      return hidden * hidden * (3 - 2 * hidden);
    }
    constructor(canvas, createCanvas = (width, height) => {
      if (typeof document === 'undefined') return new OffscreenCanvas(width, height);
      const frame = document.createElement('canvas');
      frame.width = width; frame.height = height;
      return frame;
    }) {
      this.canvas = canvas;
      this.context = canvas.getContext('2d', { alpha: false });
      this.frame = createCanvas(160, 90);
      this.frame.width = 160;
      this.frame.height = 90;
      this.sample = this.frame.getContext('2d', { alpha: false, willReadFrequently: true });
      this.barFrame = createCanvas(320, 180);
      this.barSample = this.barFrame.getContext('2d', { alpha: false, willReadFrequently: true });
      this.barDetector = new YacBlackBarDetector({ width: 320, height: 180 });
      this.padding = 180;
      this.crop = { x: 0, y: 0, width: 160, height: 90 };
      this.pendingCrop = '';
      this.stableFrames = 0;
      this.readable = true;
      this.projection = null;
    }
    reset() {
      // Clear readback taint when the media element or source changes.
      // A removed video must not remain owned while rendering is idle.
      this.source = null;
      this.frame.width = 160; this.barFrame.width = 320;
      this.readable = true;
      this.barDetector.reset();
      this.crop = { x: 0, y: 0, width: 160, height: 90 };
      this.stableFrames = 0; this.pixels = null;
      this.projection = null;
    }
    readPixels() {
      if (!this.readable) return null;
      if (this.pixels) return this.pixels;
      try { this.pixels = this.sample.getImageData(0, 0, 160, 90).data; }
      catch (error) { this.readable = false; }
      return this.pixels;
    }
    detectBars(source, mediaTime) {
      const full = { x: 0, y: 0, width: 160, height: 90 };
      if (!this.readable) return full;
      try {
        // Upscaling a small source must not blend its perimeter with interior
        // pixels before the shared color sample is reduced again.
        this.barSample.imageSmoothingEnabled = (source.videoWidth || source.width || 320) >= 320 &&
          (source.videoHeight || source.height || 180) >= 180;
        this.barSample.drawImage(source, 0, 0, 320, 180);
        const data = this.barSample.getImageData(0, 0, 320, 180).data;
        const crop = this.barDetector.sample(data, { sourceKey: this.sourceKey, mediaTime });
        this.crop = { x: crop.x / 2, y: crop.y / 2, width: crop.width / 2, height: crop.height / 2 };
        const display = this.barDetector.displayCrop;
        this.displayCrop = { x: display.x / 2, y: display.y / 2, width: display.width / 2, height: display.height / 2 };
        // Paused footage gets enough observations for the detector's refinement.
        this.stableFrames = this.barDetector.confidence.endsWith('full') ? 4 : Math.min(4, Math.max(0, this.barDetector.exactFrames - 4));
      } catch (error) {
        this.readable = false; this.barDetector.reset(); this.crop = full; this.displayCrop = full;
      }
      return this.crop;
    }
    inspect(source, rectangle, viewport, options = {}) {
      const explicitKey = typeof options.sourceKey === 'string';
      const sourceKey = explicitKey ? options.sourceKey : source.currentSrc || source.src || '';
      // Worker captures arrive as a new bitmap each frame. Their stable key
      // identifies the video, so bar detection can settle across captures.
      if ((!explicitKey && this.source !== source) || this.sourceKey !== sourceKey) {
        this.source = source; this.sourceKey = sourceKey;
        // Resizing clears any origin taint left by a previous video.
        this.frame.width = 160;
        this.barFrame.width = 320;
        this.readable = true; this.stableFrames = 0; this.pendingCrop = '';
        this.crop = { x: 0, y: 0, width: 160, height: 90 };
        this.barDetector.reset();
        this.projection = null;
      }
      const full = { x: 0, y: 0, width: 160, height: 90 };
      const needsBars = options.avoidBars !== false || options.fillBars === true;
      const detected = needsBars ?
        this.detectBars(source, Number.isFinite(options.mediaTime) ? options.mediaTime : source.currentTime) : full;
      // Read the decoded video once. Reuse the detector's small canvas for
      // ambient colors instead of a second video/GPU-to-CPU transfer.
      this.sample.drawImage(needsBars && this.readable ? this.barFrame : source, 0, 0, 160, 90);
      this.pixels = null;
      const automatic = options.avoidBars === false ? full : detected;
      const display = !this.readable || detected.width === 160 && detected.height === 90 ? full : this.displayCrop || detected;
      this.crop = { ...automatic };
      return { readable: this.readable, cropped: automatic.width < 160 || automatic.height < 90,
        videoCrop: { ...display }, samplingCrop: { ...automatic } };
    }
    draw(source, rectangle, viewport, radial, options = {}) {
      const result = this.inspect(source, rectangle, viewport, options);
      return this.project(rectangle, viewport, radial, options, result);
    }
    // Share geometry with the GPU backend so cropping and scroll blend agree.
    projectionLayout(rectangle, viewport, radial, options = {}) {
      const automatic = this.crop;
      const pad = this.padding;
      const sw = viewport.width + pad * 2;
      const sh = viewport.height + pad * 2;
      const width = 400;
      const height = Math.min(2048, Math.max(80, Math.round(width * sh / sw)));
      // A conservative display boundary can sit inside a noisy band. Sampling
      // starts one color pixel further in only along axes with confirmed bars.
      const horizontal = automatic.height < 90 ? Math.min(1, automatic.height / 8) : 0;
      const vertical = automatic.width < 160 ? Math.min(1, automatic.width / 8) : 0;
      const sampling = { x: automatic.x + vertical, y: automatic.y + horizontal,
        width: automatic.width - vertical * 2, height: automatic.height - horizontal * 2 };
      const inset = Math.min(.4, Math.max(0, Number(options.inset) / 100 || 0));
      const crop = {
        x: sampling.x + sampling.width * inset,
        y: sampling.y + sampling.height * inset,
        width: sampling.width * (1 - inset * 2),
        height: sampling.height * (1 - inset * 2)
      };
      rectangle = {
        left: rectangle.left + rectangle.width * crop.x / 160,
        top: rectangle.top + rectangle.height * crop.y / 90,
        width: rectangle.width * crop.width / 160,
        height: rectangle.height * crop.height / 90
      };
      const blend = Math.max(0, Math.min(1, Number(options.blend) || 0));
      return { width, height, crop, rectangle, blend,
        flat: !radial || blend >= 1 || rectangle.width < 1 || rectangle.height < 1 };
    }
    project(rectangle, viewport, radial, options, result) {
      const { width, height, crop, rectangle: projected, blend, flat } =
        this.projectionLayout(rectangle, viewport, radial, options);
      rectangle = projected;
      const pad = this.padding;
      const sw = viewport.width + pad * 2, sh = viewport.height + pad * 2;
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      const ctx = this.context;
      const blendWholeFrame = () => {
        if (!blend) return;
        ctx.globalAlpha = blend;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(this.frame, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
        ctx.globalAlpha = 1;
      };
      ctx.imageSmoothingEnabled = true;
      if (flat) {
        this.projection = null;
        ctx.drawImage(this.frame, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
        return result;
      }
      const scaleX = width / sw;
      const scaleY = height / sh;
      const left = (rectangle.left + pad) * scaleX;
      const top = (rectangle.top + pad) * scaleY;
      const right = left + rectangle.width * scaleX;
      const bottom = top + rectangle.height * scaleY;
      const cx = (left + right) / 2;
      const cy = (top + bottom) / 2;
      const pixels = this.readPixels();
      result.readable = this.readable;
      if (pixels) {
        if (!this.output || this.output.width !== width || this.output.height !== height) {
          this.output = ctx.createImageData(width, height);
        }
        const target = this.output.data;
        const halfWidth = (right - left) / 2, halfHeight = (bottom - top) / 2;
        const key = [width, height, left, top, right, bottom, crop.x, crop.y, crop.width, crop.height].join(',');
        // Project each background pixel back along its ray to the video edge.
        // Keep one map only: at most 400 * 2048 * 2 bytes, independent of time.
        if (this.projection?.key !== key) {
          const indices = new Uint16Array(width * height);
          for (let y = 0; y < height; y++) {
            const dy = (y + .5 - cy) / halfHeight;
            for (let x = 0; x < width; x++) {
              const dx = (x + .5 - cx) / halfWidth;
              const distance = Math.max(1, Math.abs(dx), Math.abs(dy));
              const sx = Math.round(crop.x + (dx / distance + 1) * .5 * (crop.width - 1));
              const sy = Math.round(crop.y + (dy / distance + 1) * .5 * (crop.height - 1));
              indices[y * width + x] = Math.min(89, Math.max(0, sy)) * 160 + Math.min(159, Math.max(0, sx));
            }
          }
          this.projection = { key, indices };
        }
        for (let i = 0; i < this.projection.indices.length; i++) {
          const from = this.projection.indices[i] * 4, to = i * 4;
          target[to] = pixels[from]; target[to + 1] = pixels[from + 1];
          target[to + 2] = pixels[from + 2]; target[to + 3] = 255;
        }
        ctx.putImageData(this.output, 0, 0);
        blendWholeFrame();
        return result;
      }
      // Never blend an adjacent interior pixel into a stretched edge pixel.
      this.projection = null;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.frame, crop.x, crop.y, 1, 1, 0, 0, width, height);
      ctx.drawImage(this.frame, crop.x, crop.y, crop.width, crop.height, left, top, right - left, bottom - top);
      const far = 1 + Math.max(
        Math.abs(cx) / ((right - left) / 2),
        Math.abs(width - cx) / ((right - left) / 2),
        Math.abs(cy) / ((bottom - top) / 2),
        Math.abs(height - cy) / ((bottom - top) / 2)
      );
      // One sampled perimeter pixel per wedge. Every wedge follows a ray
      // from the real video centre, beyond the viewport, without pixel readback.
      const wedge = (a, b, sx, sy) => {
        const overlap = [(b[0] - a[0]) * .6, (b[1] - a[1]) * .6];
        a = [a[0] - overlap[0], a[1] - overlap[1]];
        b = [b[0] + overlap[0], b[1] + overlap[1]];
        const qa = [cx + (a[0] - cx) * far, cy + (a[1] - cy) * far];
        const qb = [cx + (b[0] - cx) * far, cy + (b[1] - cy) * far];
        const points = [a, b, qb, qa];
        const minX = Math.max(0, Math.min(...points.map(p => p[0])));
        const maxX = Math.min(width, Math.max(...points.map(p => p[0])));
        const minY = Math.max(0, Math.min(...points.map(p => p[1])));
        const maxY = Math.min(height, Math.max(...points.map(p => p[1])));
        if (maxX <= minX || maxY <= minY) return;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        for (const p of points.slice(1)) ctx.lineTo(p[0], p[1]);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(this.frame, Math.floor(sx), Math.floor(sy), 1, 1, minX, minY, maxX - minX, maxY - minY);
        ctx.restore();
      };
      for (let x = 0; x < 160; x++) {
        const a = left + (right - left) * x / 160;
        const b = left + (right - left) * (x + 1) / 160;
        const sx = crop.x + (x + .5) * crop.width / 160;
        wedge([a, top], [b, top], sx, crop.y);
        wedge([b, bottom], [a, bottom], sx, crop.y + crop.height - 1);
      }
      for (let y = 0; y < 90; y++) {
        const a = top + (bottom - top) * y / 90;
        const b = top + (bottom - top) * (y + 1) / 90;
        const sy = crop.y + (y + .5) * crop.height / 90;
        wedge([left, b], [left, a], crop.x, sy);
        wedge([right, a], [right, b], crop.x + crop.width - 1, sy);
      }
      blendWholeFrame();
      return result;
    }
  };
})();
