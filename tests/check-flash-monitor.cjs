'use strict';
const assert = require('node:assert/strict');
const Monitor = require('../flash-monitor.js');
const frame = (rgb, fraction = 1) => {
  const data = new Uint8ClampedArray(160 * 90 * 4);
  for (let y = 0; y < 90; y++) for (let x = 0; x < 160; x++) {
    const p = (y * 160 + x) * 4, color = x < 160 * fraction ? rgb : [128, 128, 128];
    data.set([...color, 255], p);
  }
  return data;
};
const black = frame([0, 0, 0]), white = frame([255, 255, 255]);
function run(hz, duration, fps = 30, options = {}) {
  const monitor = new Monitor(), warnings = [];
  for (let n = 0; n <= duration * fps; n++) {
    const t = n / fps, on = Math.floor(t * hz * 2 + .001) % 2;
    if (monitor.sample(on ? options.on || white : options.off || black, t * 1000, t * (options.rate || 1), 'video', undefined, options.rate || 1)) warnings.push(t);
  }
  return warnings;
}
for (const fps of [24, 30, 60]) {
  const warnings = run(6, 4, fps);
  assert.equal(warnings.length, 1, `6 Hz at ${fps} FPS`);
  assert(warnings[0] >= 3 && warnings[0] <= 3.6, 'three-second sustained burst');
}
assert.deepEqual(run(6, 2.9), [], 'short burst');
assert.deepEqual(run(2, 6), [], 'slow transitions');
assert.deepEqual(run(0, 6), [], 'static frame');
assert.deepEqual(run(6, 6, 30, { on: frame([145,145,145]), off: frame([140,140,140]) }), [], 'small brightness changes');
assert.deepEqual(run(6, 6, 30, { on: frame([255,255,255], .1), off: frame([0,0,0], .1) }), [], 'small flashing area is outside this heuristic');
assert.equal(run(6, 4, 30, { on: frame([255,0,0]), off: frame([0,148,0]) }).length, 1, 'saturated red transitions at similar luminance');
assert.equal(run(6, 4, 24, { rate: 8 }).length, 1, 'fast playback does not masquerade as repeated seeks');
assert.equal(run(24, 4, 60).length, 1, 'display-tick sampling can detect a frequency aliased by a 24 FPS background');
assert.deepEqual(run(60, 4, 60), [], 'sampling at the same frequency can alias; never claim complete detection');
const interrupted = new Monitor();
let interruptedWarning = false;
for (let n = 0; n < 180; n++) {
  const t = n / 30, flash = t < 2 || t >= 3;
  const pixels = flash && Math.floor(t * 12) % 2 ? white : black;
  interruptedWarning ||= interrupted.sample(pixels, t * 1000, t, 'video');
}
assert.equal(interruptedWarning, false, 'a quiet interval resets the burst');
for (const disruption of ['seek', 'source', 'gap']) {
  const m = new Monitor(); let warning = false;
  for (let n = 0; n < 120; n++) {
    const t = n / 30, second = n >= 60;
    warning ||= m.sample(Math.floor(t * 12) % 2 ? white : black,
      t * 1000 + (disruption === 'gap' && second ? 1000 : 0),
      t + (disruption === 'seek' && second ? 20 : 0), disruption === 'source' && second ? 'next' : 'video');
  }
  assert.equal(warning, false, `${disruption} resets history`);
}
const unavailable = new Monitor();
assert.equal(unavailable.sample(null, 0, 0, 'video'), false);
// Run entirely on numeric arrays: the test never displays flashing imagery.
console.log('PASS: flash-warning heuristic, 24/30/60 FPS, red changes, quiet/seek/source/gap resets');
