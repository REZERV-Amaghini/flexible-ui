'use strict';
const assert = require('node:assert/strict');
require('../renderer.js');
const { harness } = require('./check-ambient.cjs');

(async () => {
  for (const workerMode of [false, true]) for (const configured of [0, 40, 90, 160]) {
    const h = harness(workerMode, { scrollBlend: YacRenderer.scrollBlend });
    await h.load({ blur: configured });
    const background = h.get('yac-background');
    const blur = () => Number(/blur\(([^p]+)px\)/.exec(background.style.filter)[1]);
    assert.equal(blur(), configured, 'visible video keeps the configured blur');
    h.video.rect.top = -600;
    h.event(h.window, 'scroll');
    h.tick({ delta: 100 });
    const target = Math.max(25, configured / 2);
    assert.ok(blur() >= Math.min(configured, target) && blur() <= Math.max(configured, target),
      'transition stays between the configured and full-frame blur');
    for (let i = 0; i < 12; i++) h.tick({ delta: 100 });
    assert.equal(blur(), target, 'scrolled full-frame blur is half the setting, with a 25px floor');
    assert.equal(h.renders.at(-1).at(-1).blend, 1, 'blur reaches its target with full-frame projection');
    assert.equal(h.get('yac-blur').value, configured, 'scroll does not rewrite the saved setting');
    h.video.rect.top = 100;
    h.event(h.window, 'scroll');
    for (let i = 0; i < 12; i++) h.tick({ delta: 100 });
    assert.equal(blur(), configured, 'scrolling back restores the configured blur');
    h.event(h.document, 'yac-dispose');
  }
  console.log('PASS: main/worker scroll blur, smooth transition, half-value 25px floor, setting preservation and restoration');
})().catch(error => { console.error(error); process.exitCode = 1; });
