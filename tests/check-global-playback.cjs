'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const Store = require('../settings-store.js'), sites = require('../site-registry.js');
const rules = Object.fromEntries(sites.globalGroups.flatMap(group => group.fields).map(field => [field.key, field]));
const options = { scope: 'global', inheritLegacy: true, rules, fallbackKeys: sites.playbackFallbackKeys };
function backend(initial = {}) {
  const data = structuredClone(initial), listeners = new Set(), writes = [];
  const storage = { onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) },
    local: { get: async keys => Object.fromEntries(keys.filter(key => Object.hasOwn(data, key)).map(key => [key, structuredClone(data[key])])),
      set: async values => {
        writes.push(structuredClone(values));const changes = {};
        for (const [key, value] of Object.entries(values)) { changes[key] = { oldValue: data[key], newValue: value };data[key] = value; }
        for (const listener of listeners) listener(changes, 'local');
      } } };
  return { data, writes, storage, listeners };
}
(async () => {
  const original = { 'liquid-ui:site:youtube:playbackEnabled': true, 'liquid-ui:site:youtube:playbackMode': 'rate',
    'liquid-ui:site:youtube:playbackRate': 1.25, 'liquid-ui:site:youtube-music:playbackRate': .8,
    'liquid-ui:site:x:playbackEnabled': false, 'liquid-ui:site:youtube:strength': 67,
    'liquid-ui:site:youtube-music:chromeDensity': 33, 'liquid-ui:site:x:cornerRadius': 9 };
  const env = backend(original), tabs = Array.from({ length: 4 }, () => new Store(env.storage, sites.globalDefaults, options));
  const appearance = sites.list().map(site => new Store(env.storage, site.defaults, { scope: site.id,
    rules: Object.fromEntries(site.groups.flatMap(group => group.fields).map(field => [field.key, field])) }));
  await Promise.all([...tabs, ...appearance].map(store => store.ready));
  for (const store of tabs) {
    assert.equal(store.values.playbackEnabled, true);assert.equal(store.values.playbackMode, 'rate');assert.equal(store.values.playbackRate, 1.25);
  }
  assert.deepEqual(env.writes, [], 'upgrade loading performs no writes');assert.deepEqual(env.data, original, 'all original site values remain recoverable');
  const appearanceBefore = appearance.map(store => ({ ...store.values })), paintEvents = [];
  const stops = appearance.map(store => store.subscribe(values => paintEvents.push(values)));paintEvents.length = 0;
  const observed = [];const stop = tabs[1].subscribe(values => observed.push([values.playbackEnabled, values.playbackMode, values.playbackRate]));observed.length = 0;
  await tabs[0].setMany({ playbackEnabled: true, playbackMode: 'tempo', playbackRate: 1.4 }, true);
  assert.deepEqual(observed, [[true, 'tempo', 1.4]], 'a preset has one coherent cross-tab update');
  assert.deepEqual(env.writes.at(-1), { 'liquid-ui:global:playbackEnabled': true, 'liquid-ui:global:playbackMode': 'tempo', 'liquid-ui:global:playbackRate': 1.4 });
  for (let semitone = -12; semitone <= 12; semitone++) {
    const expected = 2 ** (semitone / 12);
    await tabs[2].setMany({ playbackMode: 'rate', playbackRate: expected }, true);
    for (const store of tabs) assert.ok(Math.abs(store.values.playbackRate - expected) < 1e-12);
    assert.ok(Math.abs(12 * Math.log2(tabs[3].values.playbackRate) - semitone) < 1e-10, 'stored ratio does not detune a semitone');
  }
  assert.deepEqual(appearance.map(store => store.values), appearanceBefore);assert.deepEqual(paintEvents, [], 'global rate writes do not emit site paint updates');
  for (const [key, value] of Object.entries(original)) assert.deepEqual(env.data[key], value, 'migration never replaces old site preferences');
  const reloaded = new Store(env.storage, sites.globalDefaults, options);await reloaded.ready;assert.equal(reloaded.values.playbackRate, 2);
  await env.storage.local.set({ 'liquid-ui:site:youtube:playbackRate': .75 });
  assert.equal(reloaded.values.playbackRate, 2, 'a saved global value takes precedence over the legacy site value');
  const before = env.writes.length;await tabs[0].setMany({ playbackRate: 1.3, playbackMode: 'invalid' }, true);
  assert.equal(env.writes.length, before, 'invalid batches cannot partially change the shared preference');assert.equal(tabs[0].values.playbackRate, 2);
  stop();for (const unsubscribe of stops) unsubscribe();for (const store of [...tabs, ...appearance, reloaded]) store.dispose();assert.equal(env.listeners.size, 0);

  const raced = backend(), store = new Store(raced.storage, sites.globalDefaults, options);await store.ready;
  const pending = [];raced.storage.local.set = values => new Promise((resolve, reject) => pending.push({ values, resolve, reject }));
  const old = store.setMany({ playbackMode: 'rate', playbackRate: 1.1 }, true);
  const latest = store.setMany({ playbackMode: 'rate', playbackRate: 1.2 }, true);await Promise.resolve();
  pending[1].resolve();await latest;pending[0].reject(new Error('Old write failed'));await assert.rejects(old);
  assert.equal(store.saveErrors.size, 0, 'an older batch failure cannot replace a successful newer batch');assert.equal(store.values.playbackRate, 1.2);
  const retired = new Error('Extension context invalidated.');raced.storage.local.set = async () => { throw retired; };
  await assert.rejects(store.setMany({ playbackMode: 'rate', playbackRate: 1.3 }, true), retired);
  let attempts = 0;raced.storage.local.set = () => { attempts++;return Promise.resolve(); };
  await assert.rejects(store.setMany({ playbackMode: 'rate', playbackRate: 1.4 }, true), retired);assert.equal(attempts, 0);store.dispose();

  const lazy = backend(original), get = lazy.storage.local.get;let finishRead;
  lazy.storage.local.get = () => new Promise(resolve => { finishRead = resolve; });
  const early = new Store(lazy.storage, sites.globalDefaults, options), ratio = 2 ** (1 / 12);
  await early.setMany({ playbackEnabled: true, playbackMode: 'rate', playbackRate: ratio }, true);
  finishRead(structuredClone(original));await early.ready;
  assert.equal(early.values.playbackEnabled, true);assert.equal(early.values.playbackMode, 'rate');assert.ok(Math.abs(early.values.playbackRate - ratio) < 1e-12);
  lazy.storage.local.get = get;const durable = new Store(lazy.storage, sites.globalDefaults, options);await durable.ready;
  assert.deepEqual(durable.values, early.values, 'a batch entered during the initial read survives its stale result and reload');early.dispose();durable.dispose();

  const failed = backend(), retryStore = new Store(failed.storage, sites.globalDefaults, options);await retryStore.ready;
  const originalSet = failed.storage.local.set;failed.storage.local.set = async () => { throw new Error('Save unavailable'); };
  await assert.rejects(retryStore.setMany({ playbackEnabled: true, playbackMode: 'rate', playbackRate: 1.25 }, true));
  assert.equal(retryStore.saveErrors.size, 3);failed.storage.local.set = originalSet;
  await retryStore.setMany(Object.fromEntries([...retryStore.saveErrors.keys()].map(key => [key, retryStore.values[key]])), true);
  assert.equal(retryStore.saveErrors.size, 0);assert.equal(failed.writes.length, 1);
  assert.equal(Object.keys(failed.writes[0]).length, 3, 'one retry saves every failed preset field together');retryStore.dispose();

  const source = fs.readFileSync(require.resolve('../media-controller.js'), 'utf8');
  for (const host of ['www.youtube.com', 'music.youtube.com', 'x.com', 'example.org']) {
    const scopes = [], selectors = [], fakeStore = { values: { playbackEnabled: true, playbackMode: 'rate', playbackRate: 1.25 },
      subscribe(fn) { fn(this.values);return () => {}; } };
    const doc = { documentElement: {}, querySelectorAll: selector => { selectors.push(selector);return []; }, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
    const win = { addEventListener() {} };win.top = win;
    class Observer { observe() {} disconnect() {} }
    vm.runInNewContext(source, { LiquidUI: { getStore: id => { scopes.push(id);return fakeStore; } }, LiquidSites: sites,
      document: doc, window: win, location: { hostname: host }, MutationObserver: Observer, Event: class {}, performance: { now: () => 0 }, queueMicrotask });
    assert.deepEqual(scopes, ['global'], host + ' starts from the shared playback store');
    assert.deepEqual(selectors, [sites.identify(host).mediaSelector || 'video,audio'], host + ' retains its player selector');
  }
  console.log('PASS: one global playback profile, read-only YouTube upgrade fallback, atomic cross-tab presets, all 25 semitone ratios, isolated appearance, reload, override precedence, batch validation, stale failures, context retirement and four-site controller startup');
})().catch(error => { console.error(error);process.exitCode = 1; });
