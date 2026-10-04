(() => {
  'use strict';

  // The detector receives the renderer's small RGBA sample. It keeps only line
  // statistics and four sets of boundaries, never a video frame or DOM object.
  class YacBlackBarDetector {
    constructor({ width = 160, height = 90, insideMargin = 0 } = {}) {
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8 || width > 4096 || height > 4096) {
        throw new RangeError('Invalid black-bar sample dimensions');
      }
      this.width = width; this.height = height;
      this.insideMargin = Math.max(0, Math.min(2, Number(insideMargin) || 0));
      this.rows = this.makeLines(height); this.columns = this.makeLines(width);
      this.history = new Float32Array(16);
      this.reference = new Float32Array(4);
      this.previous = new Float32Array(4);
      this.reset();
    }

    makeLines(length) {
      return { count: new Uint16Array(length), sum: new Uint32Array(length), square: new Uint32Array(length), bright: new Uint16Array(length), peak: new Uint8Array(length) };
    }

    reset() {
      this.crop = { x: 0, y: 0, width: this.width, height: this.height };
      this.displayCrop = { ...this.crop };
      this.pendingFrames = 0; this.exactFrames = 0; this.uncertainFrames = 0;
      this.stableFrames = 0; this.confidence = 'reset';
      this.sourceKey = undefined; this.mediaTime = undefined;
      this.history.fill(0); this.reference.fill(0); this.previous.fill(0);
      return this.crop;
    }

    collect(data) {
      for (const lines of [this.rows, this.columns]) {
        lines.count.fill(0); lines.sum.fill(0); lines.square.fill(0); lines.bright.fill(0); lines.peak.fill(0);
      }
      let bright = 0;
      for (let y = 0, i = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++, i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          const value = Math.max(r, g, b);
          if (value > this.rows.peak[y]) this.rows.peak[y] = value;
          if (value > this.columns.peak[x]) this.columns.peak[x] = value;
          // Limited-range black, mild compression noise and a small tint are
          // allowed. Bright subtitle/logo pixels are excluded from flatness.
          if (value <= 42 && value - Math.min(r, g, b) <= 18) {
            const squared = value * value;
            this.rows.count[y]++; this.rows.sum[y] += value; this.rows.square[y] += squared;
            this.columns.count[x]++; this.columns.sum[x] += value; this.columns.square[x] += squared;
          }
          if (value >= 48) { this.rows.bright[y]++; this.columns.bright[x]++; bright++; }
        }
      }
      return bright / (this.width * this.height);
    }

    measureEdge(lines, length, reverse) {
      const size = lines.count.length, limit = Math.floor(size * .4);
      let depth = 0, base = 0, totalMean = 0, strictLines = 0, holes = 0;
      const maxHoles = Math.max(3, Math.round(size / 90 * 3));
      for (let offset = 0; offset < limit; offset++) {
        const index = reverse ? size - offset - 1 : offset;
        const count = lines.count[index];
        if (!count) break;
        const mean = lines.sum[index] / count;
        const variance = Math.max(0, lines.square[index] / count - mean * mean);
        const strict = count >= length * .91 && variance <= 36;
        if (!offset) { if (!strict) break; base = mean; }
        // A gradual fade to dark is not a constant-color band. Its edge cannot
        // be inferred from an arbitrary brightness threshold.
        if (Math.abs(mean - base) > 5) break;
        if (strict) {
          strictLines++; totalMean += mean; depth = offset + 1; holes = 0;
        } else if (count >= length * .7 && variance <= 49 && holes < maxHoles) {
          // Bridge only short, locally contaminated lines followed by more
          // flat lines. Unconfirmed trailing holes do not extend the boundary.
          holes++;
        } else break;
      }
      return { depth, mean: strictLines ? totalMean / strictLines : 0 };
    }

    paired(a, b) {
      return a.depth >= 2 && b.depth >= 2 &&
        Math.abs(a.depth - b.depth) <= Math.max(2, (a.depth + b.depth) * .035) &&
        Math.abs(a.mean - b.mean) <= 6;
    }

    boundaryVisible(data, horizontal, reverse, edge, start, end) {
      const width = this.width, height = this.height;
      const dimension = horizontal ? height : width;
      const lookAhead = Math.max(2, Math.round(dimension / (horizontal ? 90 : 160) * 2));
      const threshold = Math.max(48, edge.mean + 18);
      let visible = 0, count = 0;
      // Ignore the extreme corners, where the perpendicular bars or logos can
      // otherwise fake/mask a boundary. Read the actual pixels, not an average.
      const trim = Math.floor((end - start) * .04);
      for (let along = start + trim; along < end - trim; along++) {
        let found = false;
        for (let offset = 0; offset <= lookAhead; offset++) {
          const across = reverse ? dimension - edge.depth - 1 - offset : edge.depth + offset;
          if (across < 0 || across >= dimension) continue;
          const i = horizontal ? (across * width + along) * 4 : (along * width + across) * 4;
          if (Math.max(data[i], data[i + 1], data[i + 2]) >= threshold) { found = true; break; }
        }
        count++; if (found) visible++;
      }
      return count > 0 && visible / count >= .55;
    }

    contentVisible(data, edges) {
      const [left, top, right, bottom] = edges;
      const contentWidth = this.width - left - right, contentHeight = this.height - top - bottom;
      // Cropping down to a small central object is indistinguishable from a
      // logo on black. Prefer the full frame for this ambiguous geometry.
      if (contentWidth * contentHeight < this.width * this.height * .22) return false;
      let bright = 0;
      const quadrants = [0, 0, 0, 0];
      // A broad interior, not a logo on a black canvas, must support a crop.
      // This fixed grid adds only 240 reads to the one-pass line statistics.
      for (let gy = 0; gy < 12; gy++) {
        const y = Math.min(this.height - 1, top + Math.floor((gy + .5) * contentHeight / 12));
        for (let gx = 0; gx < 20; gx++) {
          const x = Math.min(this.width - 1, left + Math.floor((gx + .5) * contentWidth / 20));
          const i = (y * this.width + x) * 4;
          if (Math.max(data[i], data[i + 1], data[i + 2]) >= 48) {
            bright++; quadrants[(gy >= 6 ? 2 : 0) + (gx >= 10 ? 1 : 0)]++;
          }
        }
      }
      return bright >= 60 && quadrants.filter(value => value >= 9).length >= 3;
    }

    currentEdges() {
      return [this.crop.x, this.crop.y, this.width - this.crop.x - this.crop.width, this.height - this.crop.y - this.crop.height];
    }

    commit(edges, confidence) {
      this.crop = { x: edges[0], y: edges[1], width: this.width - edges[0] - edges[2], height: this.height - edges[1] - edges[3] };
      this.stableFrames = 4; this.confidence = confidence;
      return this.crop;
    }

    observe(edges, kind) {
      const current = this.currentEdges();
      const hasCrop = current.some(value => value > 0);
      if (kind === 'uncertain') {
        this.pendingFrames = 0; this.exactFrames = 0; this.uncertainFrames++;
        this.stableFrames = 0; this.confidence = 'uncertain';
        // Hold a known crop through a short dark cut; do not retain it forever
        // when no frame supplies evidence that the bands still exist.
        if (hasCrop && this.uncertainFrames < 8) return this.crop;
        return this.commit([0, 0, 0, 0], 'uncertain-full');
      }
      this.uncertainFrames = 0;
      let near = this.pendingFrames > 0, exact = this.pendingFrames > 0;
      for (let i = 0; i < 4; i++) {
        if (Math.abs(edges[i] - this.reference[i]) > 2) near = false;
        if (edges[i] !== this.previous[i]) exact = false;
      }
      if (!near) { this.pendingFrames = 0; this.reference.set(edges); }
      this.exactFrames = exact ? this.exactFrames + 1 : 1;
      const slot = (this.pendingFrames % 4) * 4;
      this.history.set(edges, slot); this.previous.set(edges); this.pendingFrames++;
      this.stableFrames = Math.min(4, this.pendingFrames); this.confidence = 'pending';
      const conservative = [Infinity, Infinity, Infinity, Infinity];
      for (let frame = 0; frame < Math.min(4, this.pendingFrames); frame++) {
        for (let i = 0; i < 4; i++) conservative[i] = Math.min(conservative[i], this.history[frame * 4 + i]);
      }
      // Once a nonempty band is positively detected closer to the outer edge,
      // do not keep clipping a newly visible picture row merely for debounce.
      // Removal to zero still needs the two-observation disappearance check.
      const pictureProtection = current.map((value, i) => edges[i] > 0 && edges[i] < value ? edges[i] : value);
      if (hasCrop && pictureProtection.some((value, i) => value < current[i])) return this.commit(pictureProtection, 'settled');
      const onlyLessCrop = conservative.every((value, i) => value <= current[i]) && conservative.some((value, i) => value < current[i]);
      // Clear/bright replacement content returns to full in two observations.
      // Reducing a boundary protects picture pixels and also gets precedence.
      if (hasCrop && onlyLessCrop && this.pendingFrames >= 2) return this.commit(conservative, 'clear');
      if (!hasCrop && !edges.some(value => value > 0)) return this.commit(edges, 'full');
      if (this.pendingFrames < 4) return this.crop;
      const significant = conservative.some((value, i) => Math.abs(value - current[i]) > 2);
      if (!hasCrop || significant) return this.commit(conservative, 'settled');
      // Jitter within two sample pixels keeps the established boundary. A
      // genuinely steady new boundary can refine it after eight observations.
      if (this.exactFrames >= 8) return this.commit(edges, 'settled');
      this.stableFrames = 4; this.confidence = 'settled';
      return this.crop;
    }

    sample(data, options = {}) {
      const crop = this.analyze(data, options);
      // Sampling may ignore sparse subtitles/logos; clipping must preserve them.
      // Only remove the outer black run before the first visible sample, with a
      // one-sample guard for antialiasing. Each axis considers the entire frame
      // so corner logos are protected against either independent clip edge.
      const edges = this.currentEdges();
      if (data && data.length >= this.width * this.height * 4) {
        for (let edge = 0; edge < 4; edge++) {
          const lines = edge % 2 === 0 ? this.columns : this.rows;
          const reverse = edge >= 2;
          const outer = reverse ? lines.count.length - 1 : 0;
          // Dim/colored glyphs can be visible without reaching the absolute
          // bright cutoff. Compare against this edge's black level, allowing
          // mild codec noise. Peaks reuse the existing readback/collection pass.
          const black = lines.count[outer] ? lines.sum[outer] / lines.count[outer] : 0;
          const threshold = Math.min(48, Math.max(12, black + 12));
          for (let offset = 0; offset < edges[edge]; offset++) {
            const index = reverse ? lines.bright.length - 1 - offset : offset;
            if (lines.peak[index] >= threshold) { edges[edge] = Math.max(0, offset - 1); break; }
          }
        }
      }
      this.displayCrop = { x: edges[0], y: edges[1], width: this.width - edges[0] - edges[2], height: this.height - edges[1] - edges[3] };
      return crop;
    }

    analyze(data, { sourceKey, mediaTime } = {}) {
      if (!data || data.length < this.width * this.height * 4) { this.reset(); this.confidence = 'invalid'; return this.crop; }
      const changedSource = sourceKey !== undefined && this.sourceKey !== undefined && sourceKey !== this.sourceKey;
      const discontinuity = Number.isFinite(mediaTime) && Number.isFinite(this.mediaTime) &&
        (mediaTime < this.mediaTime - .05 || mediaTime - this.mediaTime > .5);
      if (changedSource || discontinuity) this.reset();
      if (sourceKey !== undefined) this.sourceKey = sourceKey;
      if (Number.isFinite(mediaTime)) this.mediaTime = mediaTime;
      const brightFraction = this.collect(data);
      const top = this.measureEdge(this.rows, this.width, false), bottom = this.measureEdge(this.rows, this.width, true);
      const left = this.measureEdge(this.columns, this.height, false), right = this.measureEdge(this.columns, this.height, true);
      const horizontalPair = this.paired(top, bottom), verticalPair = this.paired(left, right);
      const innerLeft = verticalPair ? left.depth : 0, innerRight = this.width - (verticalPair ? right.depth : 0);
      const innerTop = horizontalPair ? top.depth : 0, innerBottom = this.height - (horizontalPair ? bottom.depth : 0);
      const horizontal = horizontalPair &&
        this.boundaryVisible(data, true, false, top, innerLeft, innerRight) && this.boundaryVisible(data, true, true, bottom, innerLeft, innerRight);
      const vertical = verticalPair &&
        this.boundaryVisible(data, false, false, left, innerTop, innerBottom) && this.boundaryVisible(data, false, true, right, innerTop, innerBottom);
      let edges = [vertical ? left.depth : 0, horizontal ? top.depth : 0, vertical ? right.depth : 0, horizontal ? bottom.depth : 0];
      const found = edges.some(value => value > 0);
      if (found && !this.contentVisible(data, edges)) return this.observe([0, 0, 0, 0], 'uncertain');
      const current = this.currentEdges();
      const lostHorizontal = (current[1] || current[3]) && !horizontal;
      const lostVertical = (current[0] || current[2]) && !vertical;
      // A dark frame supplies no positive evidence that old bars disappeared.
      // Bright pixels at an old outer edge do; a subtitle alone does not.
      const horizontalClear = this.rows.bright[0] / this.width >= .35 || this.rows.bright[this.height - 1] / this.width >= .35;
      const verticalClear = this.columns.bright[0] / this.height >= .35 || this.columns.bright[this.width - 1] / this.height >= .35;
      if ((!found && brightFraction < .25) || (lostHorizontal && !horizontalClear) || (lostVertical && !verticalClear)) {
        return this.observe([0, 0, 0, 0], 'uncertain');
      }
      if (this.insideMargin) edges = edges.map(value => value ? Math.max(0, value - this.insideMargin) : 0);
      return this.observe(edges, found ? 'bands' : 'clear');
    }
  }

  globalThis.YacBlackBarDetector = YacBlackBarDetector;
  if (typeof module !== 'undefined' && module.exports) module.exports = YacBlackBarDetector;
})();
