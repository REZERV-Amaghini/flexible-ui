'use strict';
const assert = require('node:assert/strict');
const Detector = require('../black-bar-detector.js');

const W = 160, H = 90;
const full = (w = W, h = H) => ({ x: 0, y: 0, width: w, height: h });
let seed = 0x1979ac11;
function random() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; }
function frame({ width = W, height = H, left = 0, top = 0, right = left, bottom = top, band = 0, noise = 0, content } = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside = x >= left && x < width - right && y >= top && y < height - bottom;
      const value = inside ? (content ? content(x, y, width, height) : [90 + (x * 7 + y * 13) % 120, 75 + (x * 11 + y * 3) % 120, 65 + (x * 3 + y * 7) % 120]) :
        [band, band, band].map(v => v + Math.round((random() * 2 - 1) * noise));
      const i = (y * width + x) * 4;
      data[i] = value[0]; data[i + 1] = value[1]; data[i + 2] = value[2]; data[i + 3] = 255;
    }
  }
  return data;
}
function paint(data, x, y, width, height, color = [240, 220, 200], stride = W) {
  for (let yy = y; yy < y + height; yy++) {
    for (let xx = x; xx < x + width; xx++) {
      const i = (yy * stride + xx) * 4;
      data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2];
    }
  }
}
function settle(detector, data, count = 8, options) {
  let crop;
  for (let i = 0; i < count; i++) crop = detector.sample(data, options);
  return crop;
}
function expectBands(settings, expected, name) {
  const detector = new Detector({ width: settings.width || W, height: settings.height || H });
  const data = frame(settings);
  assert.deepEqual(settle(detector, data, 3), full(settings.width || W, settings.height || H), `${name}: acquisition waits`);
  assert.deepEqual(detector.sample(data), expected, `${name}: exact boundaries`);
  return { detector, data };
}

expectBands({ top: 10 }, { x: 0, y: 10, width: W, height: 70 }, 'letterbox');
expectBands({ left: 28 }, { x: 28, y: 0, width: 104, height: H }, 'pillarbox');
expectBands({ top: 9, left: 18 }, { x: 18, y: 9, width: 124, height: 72 }, 'windowbox');
expectBands({ top: 2, left: 2 }, { x: 2, y: 2, width: 156, height: 86 }, 'two-sample bands');
expectBands({ left: 54 }, { x: 54, y: 0, width: 52, height: H }, 'portrait content');
expectBands({ top: 12, band: 26, noise: 6 }, { x: 0, y: 12, width: W, height: 66 }, 'off-black compression');
{
  const { detector } = expectBands({ top: 12, left: 20, band: 26, noise: 6 },
    { x: 20, y: 12, width: 120, height: 66 }, 'noisy mixed bands');
  assert.deepEqual(detector.displayCrop, detector.crop, 'bounded codec noise does not undo display clipping');
}
expectBands({ top: 11, bottom: 12, left: 25, right: 26 }, { x: 25, y: 11, width: 109, height: 67 }, 'subsample asymmetric rounding');

// Sparse border logos and short subtitle clutter are outliers, not
// evidence that the entire band ends at the first contaminated row.
{
  const detector = new Detector();
  const data = frame({ top: 12, left: 20, band: 12, noise: 3 });
  paint(data, 68, 84, 36, 2); paint(data, 1, 40, 4, 3); paint(data, 147, 3, 4, 3);
  assert.deepEqual(settle(detector, data), { x: 20, y: 12, width: 120, height: 66 }, 'subtitle and corner logo clutter');
  assert.ok(detector.displayCrop.x <= 1 && detector.displayCrop.y <= 3, 'left and corner logos stay visible');
  assert.ok(detector.displayCrop.x + detector.displayCrop.width >= 151, 'corner logo right edge stays visible');
  assert.ok(detector.displayCrop.y + detector.displayCrop.height >= 86, 'bottom subtitle stays visible');
  paint(data, 68, 83, 36, 3);
  assert.deepEqual(settle(new Detector(), data), { x: 20, y: 12, width: 120, height: 66 }, 'three-sample subtitle clutter');
}

{
  const detector = new Detector();
  const clean = frame({ top: 12, left: 20 });
  settle(detector, clean);
  assert.deepEqual(detector.displayCrop, detector.crop, 'clean bars retain full removal');
  const glyph = clean.slice();
  paint(glyph, 70, 3, 4, 2);
  const sampling = { ...detector.crop };
  detector.sample(glyph);
  assert.deepEqual(detector.crop, sampling, 'new glyph does not pollute sampling ROI');
  assert.ok(detector.displayCrop.y <= 2, 'new glyph is protected on its first observation');
  detector.sample(new Uint8ClampedArray(0));
  assert.deepEqual(detector.displayCrop, full(), 'invalid samples cannot retain clipping');
}

// Low-opacity captions/watermarks can remain visible below the bright-pixel
// cutoff. Protect all four display edges without contaminating ambient samples,
// including on the first frame after the overlay appears.
for (const scale of [1, 2]) {
  const width = W * scale, height = H * scale;
  const detector = new Detector({ width, height });
  const clean = frame({ width, height, top: 12 * scale, left: 20 * scale, band: 16, noise: 3 });
  const sampling = { ...settle(detector, clean) };
  assert.deepEqual(detector.displayCrop, sampling, `dim-overlay ${scale}: codec noise still permits bar removal`);
  const overlays = [
    [70 * scale, 3 * scale, 4 * scale, 2 * scale],
    [70 * scale, 84 * scale, 4 * scale, 2 * scale],
    [3 * scale, 40 * scale, 2 * scale, 3 * scale],
    [151 * scale, 40 * scale, 2 * scale, 3 * scale],
    [3 * scale, 3 * scale, 2 * scale, 2 * scale],
    [0, 3 * scale, 2 * scale, 2 * scale],
    [3 * scale, 0, 2 * scale, 2 * scale],
  ];
  for (const color of [[35, 35, 35], [36, 22, 25]]) {
    for (const [x, y, w, h] of overlays) {
      const data = clean.slice();
      paint(data, x, y, w, h, color, width);
      detector.sample(data);
      assert.deepEqual(detector.crop, sampling, `dim-overlay ${scale}: sampling remains settled`);
      const display = detector.displayCrop;
      assert.ok(display.x <= x && display.y <= y && display.x + display.width >= x + w && display.y + display.height >= y + h,
        `dim-overlay ${scale}: ${color} overlay at ${x},${y} remains inside the first-frame display crop`);
      detector.sample(clean);
      assert.deepEqual(detector.displayCrop, sampling, `dim-overlay ${scale}: clean display bounds recover immediately`);
    }
  }
}

// Adversarial/holdout scenes: broad dark gradients, dim textured edges,
// asymmetric darkness, a small bright subject on black, and spatial darkness.
const holdouts = [
  ['all black', frame({ content: () => [0, 0, 0] })],
  ['dim flat frame', frame({ content: () => [26, 26, 26] })],
  ['dark textured image', frame({ content: (x, y) => { const v = 5 + (x * 19 + y * 23) % 33; return [v, v, v]; } })],
  ['vertical natural gradient', frame({ content: (_, y, w, h) => { const v = Math.round(Math.min(y, h - y - 1) * 4.2); return [v, v * .9, v * .8]; } })],
  ['horizontal natural gradient', frame({ content: (x, _, w) => { const v = Math.round(Math.min(x, w - x - 1) * 2.7); return [v, v, v]; } })],
  ['radial vignette', frame({ content: (x, y, w, h) => { const d = Math.hypot((x - w / 2) / (w / 2), (y - h / 2) / (h / 2)); const v = Math.max(0, Math.round(190 * (1 - d))); return [v, v * .8, v * .7]; } })],
  ['single dark edge', frame({ top: 14, bottom: 0 })],
  ['substantially asymmetric letterbox', frame({ top: 8, bottom: 17 })],
  ['substantially asymmetric pillarbox', frame({ left: 12, right: 24 })],
  ['colorful low-intensity edges', frame({ content: (x, y) => x < 20 || x >= 140 ? [40, 3, 3] : [150, 100, 90] })],
  ['black canvas with logo', frame({ content: (x, y) => x > 58 && x < 102 && y > 30 && y < 58 ? [220, 220, 220] : [0, 0, 0] })],
  ['dark scene with isolated highlights', frame({ top: 12, content: (x, y) => (x * 31 + y * 17) % 101 < 8 ? [230, 180, 90] : [9, 10, 11] })],
];
for (const [name, data] of holdouts) assert.deepEqual(settle(new Detector(), data, 12), full(), `holdout: ${name}`);

// A one-pixel codec bleed line should not let the detector extend the crop
// into bright picture pixels; a soft gradient alone supplies no boundary.
{
  const data = frame({ top: 10, band: 6, noise: 2 });
  paint(data, 0, 9, W, 1, [23, 23, 23]); paint(data, 0, 80, W, 1, [23, 23, 23]);
  const crop = settle(new Detector(), data);
  assert.ok(crop.y >= 9 && crop.y <= 10, 'compression bleed does not overcrop top');
  assert.ok(crop.y + crop.height >= 80 && crop.y + crop.height <= 81, 'compression bleed does not overcrop bottom');
}

// Candidate boundaries need not be byte-for-byte identical every frame.
// Conservatively retain the smallest supported boundary through jitter.
{
  const detector = new Detector();
  const depths = [10, 9, 11, 10, 9, 11, 10, 9, 11, 10, 9, 10];
  const accepted = [];
  for (const depth of depths) {
    const crop = detector.sample(frame({ top: depth }));
    if (crop.height < H) accepted.push(crop.y);
    assert.ok(crop.y <= depth, 'jitter never crops farther into the current picture');
  }
  assert.ok(accepted.length >= 8, 'jitter still acquires a stable crop');
  assert.ok(accepted.every(value => value === 9), 'jitter does not chatter');
  assert.deepEqual(settle(detector, frame({ top: 10 }), 8), { x: 0, y: 10, width: W, height: 70 }, 'steady boundary refines after settling');
  assert.equal(detector.sample(frame({ top: 9 })).y, 9, 'positive smaller boundary protects the first newly visible picture row immediately');
}

{
  const { detector } = expectBands({ top: 10 }, { x: 0, y: 10, width: W, height: 70 }, 'disappearance setup');
  const bright = frame();
  assert.equal(detector.sample(bright).y, 10, 'one-frame bright cut does not clear');
  assert.deepEqual(detector.sample(bright), full(), 'confirmed disappearance clears in two observations');
  settle(detector, frame({ top: 10 }));
  const black = frame({ content: () => [0, 0, 0] });
  assert.equal(settle(detector, black, 3).y, 10, 'short dark cut retains known boundary');
  assert.deepEqual(settle(detector, black, 5), full(), 'persistent uncertainty falls back to full');
}

// Losing just one axis must not retain a stale video clip, nor discard a
// separately supported axis once the transition has settled.
{
  const detector = new Detector();
  settle(detector, frame({ left: 18, top: 10 }));
  const letterboxOnly = frame({ top: 10 });
  assert.deepEqual(settle(detector, letterboxOnly, 2), { x: 0, y: 10, width: W, height: 70 }, 'pillarbox disappears while letterbox remains');
  const pillarboxOnly = frame({ left: 22 });
  assert.deepEqual(settle(detector, pillarboxOnly, 8), { x: 22, y: 0, width: 116, height: H }, 'letterbox-to-pillarbox transition');
}

// Seek/source changes discard previous-video boundaries before new evidence.
{
  const detector = new Detector();
  const bars = frame({ left: 24 });
  for (let i = 0; i < 8; i++) detector.sample(bars, { sourceKey: 'a', mediaTime: 1 + i / 30 });
  assert.equal(detector.crop.x, 24);
  assert.deepEqual(detector.sample(bars, { sourceKey: 'b', mediaTime: 1.3 }), full(), 'source reset');
  for (let i = 0; i < 8; i++) detector.sample(bars, { sourceKey: 'b', mediaTime: 2 + i / 30 });
  assert.deepEqual(detector.sample(bars, { sourceKey: 'b', mediaTime: .5 }), full(), 'backwards seek reset');
  settle(detector, bars);
  assert.deepEqual(detector.sample(bars, { mediaTime: 20 }), full(), 'forward seek reset');
  settle(detector, bars);
  assert.deepEqual(detector.sample(null), full(), 'unreadable input reset');
  assert.equal(detector.confidence, 'invalid');
}

// Two resolutions describe the same physical borders, without assuming a
// 160x90 coordinate system internally. Odd depths retain sub-160 precision.
{
  const a = new Detector(), b = new Detector({ width: 320, height: 180 });
  const ca = settle(a, frame({ top: 11, left: 17, band: 16, noise: 2 }));
  const cb = settle(b, frame({ width: 320, height: 180, top: 22, left: 34, band: 16, noise: 2 }));
  assert.deepEqual({ x: cb.x / 2, y: cb.y / 2, width: cb.width / 2, height: cb.height / 2 }, ca, 'resolution normalization');
  const odd = settle(b, frame({ width: 320, height: 180, top: 23, left: 35 }));
  assert.deepEqual(odd, { x: 35, y: 23, width: 250, height: 134 }, 'higher resolution preserves odd boundaries');
  assert.deepEqual(settle(new Detector({ insideMargin: 1 }), frame({ top: 10 })), { x: 0, y: 9, width: W, height: 72 }, 'optional picture-preserving margin');
}

assert.throws(() => new Detector({ width: 0 }), RangeError);
console.log('PASS: black-bar boundaries, noisy/off-black bands, mixed bars, clutter, dark/gradient holdouts, jitter, disappearance, resets and 160/320 resolution');

// Opt-in benchmark: no browser/image/display/network work. Timings are local
// observations, not a frame-rate or mobile-performance guarantee.
if (process.argv.includes('--benchmark')) {
  const { performance } = require('node:perf_hooks');
  for (const [width, height] of [[160, 90], [320, 180]]) {
    const detector = new Detector({ width, height });
    const data = frame({ width, height, top: height / 9, left: width / 8, band: 15, noise: 3 });
    settle(detector, data, 100);
    const iterations = 2000, before = performance.now();
    for (let i = 0; i < iterations; i++) detector.sample(data);
    const elapsed = performance.now() - before;
    console.log(`BENCH ${width}x${height}: ${(elapsed / iterations).toFixed(3)} ms/sample (${iterations} iterations, one reused RGBA input)`);
  }
}
