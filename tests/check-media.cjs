'use strict';
const assert = require('node:assert/strict');
const Store = require('../settings-store.js'), sites = require('../site-registry.js'), Controller = require('../media-controller.js');
function harness() {
  const tasks = [], changes = new Set(), writes = [], data = {}, events = new Map();let scans = 0, observer;
  const doc = { media: [], documentElement: {},
    addEventListener: (type, listener) => events.set(type, listener), removeEventListener: type => events.delete(type),
    querySelectorAll: () => { scans++;return doc.media.filter(media => media.isConnected && media.eligible); },
    emit: (type, target) => events.get(type)?.({ type, target }) };
  class Observer { constructor(callback) { this.callback = callback;this.active = false;observer = this; }
    observe() { this.active = true; } disconnect() { this.active = false; }
    changed(addedNodes = []) { if (this.active) this.callback([{ addedNodes }]); } }
  class Media {
    constructor({ rate = 1.5, pitch = true, live = false, pitchKey = 'preservesPitch', eligible = true } = {}) {
      this._rate = rate;this.duration = live ? Infinity : 120;this.srcObject = null;this.isConnected = true;
      this.eligible = eligible;this.rateWrites = 0;this[pitchKey] = pitch;doc.media.push(this);
    }
    get playbackRate() { return this._rate; }
    set playbackRate(value) {
      if (this.reject) throw new Error('Unsupported rate');
      this._rate = value;this.rateWrites++;tasks.push(() => doc.emit('ratechange', this));
      if (this.forceSiteRate) tasks.push(() => { this._rate = .8;doc.emit('ratechange', this); });
    }
    matches() { return this.eligible; } querySelectorAll() { return []; }
  }
  const storage = { onChanged: { addListener: listener => changes.add(listener), removeListener: listener => changes.delete(listener) },
    local: { get: async keys => Object.fromEntries(keys.filter(key => key in data).map(key => [key, data[key]])),
      set: async values => { writes.push(values);Object.assign(data, values);
        for (const listener of changes) listener(Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { newValue }])), 'local'); } } };
  const store = new Store(storage, sites.globalDefaults, { scope: 'global',
    rules: Object.fromEntries(sites.globalGroups.flatMap(group => group.fields).map(field => [field.key, field])) });
  const controller = new Controller(store, { document: doc, MutationObserver: Observer, now: () => 100, enqueue: function (task) { assert.equal(this, undefined, 'host callbacks must not receive the controller as their receiver');tasks.push(task); } });
  const flush = () => { for (let n = 0; tasks.length; n++) { if (n > 100) throw new Error('Unbounded media feedback loop');tasks.shift()(); } };
  return { store, controller, doc, Media, writes, flush, observer: () => observer, scans: () => scans, events };
}
// A design stage owns its video; extension global settings must not start there.
{
  const vm = require('node:vm'), fs = require('node:fs');let requests = 0;
  const window = {};window.top = window;
  vm.runInNewContext(fs.readFileSync(require.resolve('../media-controller.js'), 'utf8'), {
    window, document: { documentElement: { hasAttribute: name => name === 'data-liquid-design-stage' } },
    LiquidUI: { getStore() { requests++;throw new Error('A prototype must not load extension settings'); } }
  });
  assert.equal(requests, 0);
}
(async () => {
  const h = harness(), a = new h.Media(), ignored = new h.Media({ eligible: false });await h.store.ready;
  assert.equal(h.scans(), 0);assert.equal(h.observer().active, false);assert.equal(h.events.size, 0);
  assert.equal(a.rateWrites, 0, 'disabled profiles do not overwrite native playback');
  await h.store.set('playbackMode', 'rate');await h.store.set('playbackRate', 1.25);await h.store.set('playbackEnabled', true);h.flush();
  assert.equal(a.playbackRate, 1.25);assert.equal(a.preservesPitch, false);assert.equal(ignored.playbackRate, 1.5);
  assert.equal(h.controller.state.kind, 'applied');assert.equal(h.controller.state.count, 1);
  const before = a.rateWrites;h.doc.emit('loadedmetadata', a);h.doc.emit('play', a);h.doc.emit('ratechange', a);h.flush();
  assert.equal(a.rateWrites, before, 'matching lifecycle events do not write properties again');
  await h.store.set('playbackMode', 'tempo');assert.equal(a.preservesPitch, true);assert.equal(a.playbackRate, 1.25);
  const b = new h.Media({ rate: .75, pitch: false, pitchKey: 'webkitPreservesPitch' });h.observer().changed([b]);h.flush();
  assert.equal(b.playbackRate, 1.25);assert.equal(b.webkitPreservesPitch, true);assert.equal(h.controller.state.count, 2);
  await h.store.set('playbackRate', 1.33, true);h.flush();assert.equal(a.playbackRate, 1.33);
  assert.deepEqual(h.writes.at(-1), { 'liquid-ui:global:playbackRate': 1.33 });
  for (let semitone = -12; semitone <= 12; semitone++) {
    const rate = 2 ** (semitone / 12);await h.store.setMany({ playbackRate: rate, playbackMode: 'rate' }, true);h.flush();
    assert.ok(Math.abs(a.playbackRate - rate) < 1e-12, 'semitone rate retains tuning precision');assert.equal(a.preservesPitch, false);
  }
  await h.store.set('playbackEnabled', false);h.flush();
  assert.equal(a.playbackRate, 1.5);assert.equal(a.preservesPitch, true);assert.equal(b.playbackRate, .75);assert.equal(b.webkitPreservesPitch, false);
  assert.equal(h.events.size, 0);assert.equal(h.observer().active, false);assert.equal(h.controller.media.size, 0);
  await h.store.set('playbackEnabled', true);h.flush();b.isConnected = false;h.observer().changed();h.flush();
  assert.equal(b.playbackRate, .75);assert.equal(h.controller.media.has(b), false, 'removed media is restored and released');
  const conflictBefore = a.rateWrites;a.forceSiteRate = true;a.playbackRate = .8;h.flush();
  assert.equal(h.controller.state.kind, 'conflict');assert.equal(a.playbackRate, .8);
  assert.ok(a.rateWrites - conflictBefore < 6, 'site conflict stops after three reapplication attempts');
  await h.store.set('playbackEnabled', false);h.flush();assert.equal(a.playbackRate, .8, 'disabling preserves a newer site-owned speed');
  a.forceSiteRate = false;await h.store.set('playbackEnabled', true);h.flush();assert.equal(h.controller.state.kind, 'applied');
  a.duration = Infinity;h.doc.emit('loadedmetadata', a);h.flush();assert.equal(h.controller.state.kind, 'unsupported');assert.equal(a.playbackRate, .8);
  a.duration = 120;h.doc.emit('loadedmetadata', a);h.flush();assert.equal(h.controller.state.kind, 'applied');
  await h.store.set('playbackMode', 'rate');a.reject = true;await h.store.set('playbackRate', 1.4);h.flush();
  assert.equal(h.controller.state.kind, 'unsupported');assert.equal(a.preservesPitch, true, 'failed rate restores pitch compensation');
  a.reject = false;h.controller.dispose();h.store.dispose();h.flush();assert.equal(h.events.size, 0);assert.equal(h.controller.media.size, 0);
  const isolated = harness();await isolated.store.ready;
  await isolated.store.set('playbackRate', 8);assert.equal(isolated.store.values.playbackRate, 3);
  await isolated.store.set('playbackRate', -.4);assert.equal(isolated.store.values.playbackRate, .25);
  await isolated.store.set('playbackMode', 'invalid', true);assert.equal(isolated.writes.length, 0);
  assert.equal(sites.globalDefaults.playbackEnabled, false);
  for (const site of sites.list()) assert.equal(Object.hasOwn(site.defaults, 'playbackRate'), false, 'playback has only one global profile');
  assert.deepEqual(sites.identify('x.com').groups.map(group => group.id), ['site-appearance']);
  isolated.controller.dispose();isolated.store.dispose();
  console.log('PASS: opt-in media control, tempo/RATE, native pitch prefixes, integer-percent storage, player replacement, bounded site conflicts, ownership-aware restoration, live exclusion, setter failure and disposal');
})().catch(error => { console.error(error);process.exitCode = 1; });
