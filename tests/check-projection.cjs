'use strict';
const assert = require('node:assert/strict');
require('../black-bar-detector.js');
require('../renderer.js');

class Canvas {
  constructor(width, height) { this.width = width; this.height = height; this.writes = 0;this.sources = []; }
  getContext() {
    return {
      drawImage: source => {
        this.sources.push(source);
        this.writes++;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
        for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
          const from = (Math.floor(y * source.height / this.height) * source.width + Math.floor(x * source.width / this.width)) * 4;
          this.data.set(source.data.subarray(from, from + 4), (y * this.width + x) * 4);
        }
      },
      getImageData: () => ({ data: this.data }),
      createImageData: (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: value => { this.writes++; this.data = value.data.slice(); }
    };
  }
}
const source = new Canvas(160, 90);
source.data = Uint8ClampedArray.from({ length: 160 * 90 * 4 }, (_, i) => (i * 37 + 11) % 256);
const output = new Canvas(1, 1), renderer = new YacRenderer(output, (w, h) => new Canvas(w, h));
// Independent reference: the pre-cache per-frame projection formula.
function reference(rect, vp, inset) {
  const crop = { x: 160 * inset, y: 90 * inset, width: 160 * (1 - 2 * inset), height: 90 * (1 - 2 * inset) };
  const left = (rect.left + rect.width * inset + 180) * output.width / (vp.width + 360);
  const top = (rect.top + rect.height * inset + 180) * output.height / (vp.height + 360);
  const right = left + rect.width * (1 - 2 * inset) * output.width / (vp.width + 360);
  const bottom = top + rect.height * (1 - 2 * inset) * output.height / (vp.height + 360);
  const data = new Uint8ClampedArray(output.width * output.height * 4);
  for (let y = 0; y < output.height; y++) for (let x = 0; x < output.width; x++) {
    const dx = (x + .5 - (left + right) / 2) / ((right - left) / 2);
    const dy = (y + .5 - (top + bottom) / 2) / ((bottom - top) / 2);
    const distance = Math.max(1, Math.abs(dx), Math.abs(dy));
    const sx = Math.round(crop.x + (dx / distance + 1) * .5 * (crop.width - 1));
    const sy = Math.round(crop.y + (dy / distance + 1) * .5 * (crop.height - 1));
    const from = (Math.min(89, Math.max(0, sy)) * 160 + Math.min(159, Math.max(0, sx))) * 4;
    const to = (y * output.width + x) * 4;
    data.set(source.data.subarray(from, from + 3), to); data[to + 3] = 255;
  }
  return data;
}
let lastMap;
for (const [rect, vp, inset] of [
  [{ left: 300, top: 200, width: 640, height: 360 }, { width: 1920, height: 1080 }, 0],
  [{ left: -200, top: -400, width: 640, height: 360 }, { width: 1920, height: 1080 }, .2],
  [{ left: 10, top: 80, width: 320, height: 180 }, { width: 390, height: 844 }, .4]
]) {
  renderer.draw(source, rect, vp, true, { avoidBars: false, inset: inset * 100 });
  assert.deepEqual(output.data, reference(rect, vp, inset), 'projection equals original RGBA');
  assert.notEqual(renderer.projection, lastMap, 'geometry/crop changes replace cache');
  const map = renderer.projection;
  source.data[20] ^= 255;
  renderer.draw(source, rect, vp, true, { avoidBars: false, inset: inset * 100 });
  assert.equal(renderer.projection, map, 'new colors reuse geometry cache');
  assert.deepEqual(output.data, reference(rect, vp, inset), 'cached geometry uses fresh pixels');
  assert.ok(map.indices.byteLength <= 400 * 2048 * 2, 'cache has bounded memory');
  lastMap = map;
}
const rect = { left: 0, top: 0, width: 160, height: 90 }, vp = { width: 800, height: 600 };
const writes = output.writes;
const result = renderer.inspect(source, rect, vp, { avoidBars: false });
assert.equal(output.writes, writes, 'inspect never draws output');
assert.equal(renderer.readPixels().length, 160 * 90 * 4);
assert.deepEqual(result.videoCrop, result.samplingCrop);
renderer.draw(source, rect, vp, false, { avoidBars: false });
assert.equal(renderer.projection, null, 'nonradial releases projection cache');
renderer.reset();
assert.equal(renderer.projection, null, 'reset releases projection cache');
const letterbox = new Canvas(320, 180);
letterbox.data = new Uint8ClampedArray(320 * 180 * 4);
for (let y = 0; y < 180; y++) for (let x = 0; x < 320; x++) {
  const bright = y >= 24 && y < 156 || x >= 130 && x < 170 && y >= 168 && y < 170;
  letterbox.data.set(bright ? [170, 140, 120, 255] : [0, 0, 0, 255], (y * 320 + x) * 4);
}
const beforeInspect = output.writes;
let inspected;
for (let i = 0; i < 8; i++) inspected = renderer.inspect(letterbox, rect, vp, { sourceKey: 'letterbox' });
assert.equal(output.writes, beforeInspect, 'repeated inspect detection never renders background');
assert.deepEqual(inspected.samplingCrop, { x: 0, y: 12, width: 160, height: 66 }, 'inspect keeps clean sampling ROI');
assert.deepEqual(renderer.crop, inspected.samplingCrop, 'legacy crop is the sampling ROI');
assert.ok(inspected.videoCrop.y + inspected.videoCrop.height >= 85, 'inspect display ROI preserves bottom subtitle');
const rendered = renderer.draw(letterbox, rect, vp, true, { sourceKey: 'letterbox' });
assert.deepEqual(rendered, inspected, 'draw and inspect expose the same ROI contract');
let fillOnly;
for (let i = 0; i < 8; i++) fillOnly = renderer.inspect(letterbox, rect, vp, { sourceKey: 'fill-only', avoidBars: false, fillBars: true });
assert.deepEqual(fillOnly.samplingCrop, { x: 0, y: 0, width: 160, height: 90 }, 'sampling exclusion can be disabled independently');
assert.equal(fillOnly.videoCrop.y, 12, 'display replacement still detects bars with sampling exclusion off');
assert.ok(fillOnly.videoCrop.y + fillOnly.videoCrop.height >= 85, 'independent display replacement preserves subtitles');
assert.deepEqual(renderer.crop, fillOnly.samplingCrop);
// A faded caption below the detector's absolute bright threshold reaches the
// renderer's display contract while the ambient exclusion remains independent.
for (let y = 0; y < 180; y++) for (let x = 0; x < 320; x++) {
  if (y >= 24 && y < 156) continue;
  const caption = x >= 130 && x < 170 && y >= 168 && y < 170;
  letterbox.data.set(caption ? [35, 35, 35, 255] : [16, 16, 16, 255], (y * 320 + x) * 4);
}
const dim = renderer.inspect(letterbox, rect, vp, { sourceKey: 'fill-only', avoidBars: true, fillBars: true });
assert.deepEqual(dim.samplingCrop, { x: 0, y: 12, width: 160, height: 66 }, 'faded caption keeps clean ambient samples');
assert.ok(dim.videoCrop.y + dim.videoCrop.height >= 85, 'first faded caption reaches renderer display bounds');
const dimFillOnly = renderer.inspect(letterbox, rect, vp, { sourceKey: 'fill-only', avoidBars: false, fillBars: true });
assert.deepEqual(dimFillOnly.samplingCrop, { x: 0, y: 0, width: 160, height: 90 });
assert.ok(dimFillOnly.videoCrop.y + dimFillOnly.videoCrop.height >= 85, 'fill-only display preserves faded caption');
const neither = renderer.inspect(letterbox, rect, vp, { avoidBars: false, fillBars: false });
assert.deepEqual(neither.videoCrop, { x: 0, y: 0, width: 160, height: 90 });
renderer.frame.sources.length = renderer.barFrame.sources.length = 0;
renderer.inspect(letterbox, rect, vp, { avoidBars: true, fillBars: true });
assert.deepEqual(renderer.barFrame.sources, [letterbox], 'decoded video is captured once for both consumers');
assert.deepEqual(renderer.frame.sources, [renderer.barFrame], 'color sampling reuses the small detector canvas');
renderer.frame.sources.length = renderer.barFrame.sources.length = 0;
renderer.inspect(letterbox, rect, vp, { avoidBars: false, fillBars: false });
assert.deepEqual(renderer.frame.sources, [letterbox]);assert.equal(renderer.barFrame.sources.length, 0, 'disabled detection requires no extra capture');
console.log('Projection RGBA, cache lifecycle, and inspect tests passed');
