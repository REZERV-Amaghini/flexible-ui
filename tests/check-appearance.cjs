'use strict';
const assert = require('node:assert/strict');
const Store = require('../settings-store.js'), sites = require('../site-registry.js'), Appearance = require('../site-appearance.js');
function backend(initial = {}) {
  const data = { ...initial }, listeners = new Set(), writes = [];
  return { data, writes, storage: {
    onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) },
    local: { get: async keys => Object.fromEntries(keys.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]])),
      set: async values => { writes.push({ ...values });const changes = {};
        for (const [key, value] of Object.entries(values)) { changes[key] = { newValue: value };data[key] = value; }
        for (const fn of listeners) fn(changes, 'local'); } }
  } };
}
const rules = site => Object.fromEntries(site.groups.flatMap(group => group.fields).map(field => [field.key, field]));
function surfaceEnvironment() {
  const attributes = new Map([['data-liquid-ui-appearance', 'foreign']]);let queries = 0, reads = 0, writes = 0;
  const root = { getAttribute: key => attributes.get(key) ?? null, setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: key => attributes.delete(key) };
  const foreignSheet = {}, doc = { documentElement: root, body: {}, defaultView: {}, adoptedStyleSheets: [foreignSheet],
    querySelector: () => { queries++;return doc.body; } };
  const sheetValues = new Map();
  class Sheet {
    constructor() { this.cssRules = [{ style: { getPropertyValue: key => sheetValues.get(key) || '',
      setProperty: (key, value) => { writes++;sheetValues.set(key, value); } } }]; }
    replaceSync(css) { this.css = css; }
  }
  const observed = [], listeners = new Set();let observer, color = 'rgb(240, 240, 240)', backgroundColor = 'rgba(0, 0, 0, 0)';
  class Observer {
    constructor(callback) { this.callback = callback;observer = this; }
    observe(target, options) { observed.push({ target, options }); }
    disconnect() { observed.length = 0; }
  }
  const media = { matches: true, addEventListener: (event, fn) => listeners.add(fn), removeEventListener: (event, fn) => listeners.delete(fn) };
  return { environment: { document: doc, CSSStyleSheet: Sheet, MutationObserver: Observer,
    getComputedStyle: function () { assert.equal(this, doc.defaultView, 'native style API requires its Window receiver');reads++;return { color, backgroundColor }; }, matchMedia: () => media }, doc, root, attributes, foreignSheet,
    observed, listeners, sheetValues, metrics: () => ({ queries, reads, writes }), changeTheme: (next, background = 'rgba(0, 0, 0, 0)') => { color = next;backgroundColor = background;observer.callback(); } };
}
(async () => {
  const music = sites.identify('music.youtube.com'), x = sites.identify('x.com'), state = backend();
  const a = new Store(state.storage, music.defaults, { scope: music.id, rules: rules(music) });
  const b = new Store(state.storage, x.defaults, { scope: x.id, rules: rules(x) });await Promise.all([a.ready, b.ready]);
  assert.equal(music.groups[0].fields.find(field => field.key === 'contentDensity').label.en, 'Lyrics and queue');
  assert.equal(x.groups[0].fields.find(field => field.key === 'contentDensity').label.en, 'Post background');
  await a.set('contentDensity', 41.7, true);assert.equal(a.values.contentDensity, 42);assert.equal(b.values.contentDensity, 25);
  await b.set('contentDensity', 9, true);assert.equal(a.values.contentDensity, 42);
  assert.deepEqual(state.writes, [{ 'liquid-ui:site:youtube-music:contentDensity': 42 }, { 'liquid-ui:site:x:contentDensity': 9 }]);
  await a.set('chromeBlur', 500);assert.equal(a.values.chromeBlur, 24);await a.set('chromeBlur', NaN);assert.equal(a.values.chromeBlur, 24);
  await a.set('cornerRadius', -1);assert.equal(a.values.cornerRadius, 0);
  sites.register({ id: 'schema-test', name: 'Schema test', hosts: ['schema.test'], defaults: { amount: .4, method: 'a' },
    groups: [{ id: 'custom', fields: [{ key: 'amount', type: 'range', min: 10, max: 90, step: 2, scale: 100 },
      { key: 'method', type: 'select', choices: [['a', 'A'], ['b', 'B']] }] }] });
  const custom = sites.identify('schema.test'), c = new Store(state.storage, custom.defaults, { scope: custom.id, rules: rules(custom) });await c.ready;
  await c.set('amount', .437, true);assert.equal(c.values.amount, .44);await c.set('method', 'b', true);assert.equal(c.values.method, 'b');
  await c.set('method', 'invalid', true);assert.equal(c.values.method, 'b');await c.set('amount', -1);assert.equal(c.values.amount, .1);
  const legacy = backend({ ambient: { strength: 79.6, surfaceDensity: 35 }, 'yac-setting:blur': 42.7 });
  const yt = sites.identify('www.youtube.com'), d = new Store(legacy.storage, yt.defaults, { scope: yt.id, inheritLegacy: true, rules: rules(yt) });await d.ready;
  assert.equal(d.values.strength, 80);assert.equal(d.values.blur, 43);assert.equal(d.values.surfaceMultiplier, .35);assert.equal(legacy.writes.length, 0);
  const env = surfaceEnvironment(), adapter = new Appearance(b, x, env.environment);
  assert.deepEqual(env.metrics(), { queries: 0, reads: 0, writes: 0 });assert.equal(env.observed.length, 0);
  assert.deepEqual(env.doc.adoptedStyleSheets, [env.foreignSheet], 'off performs no page styling or scanning');
  await b.set('appearanceEnabled', true);assert.equal(env.doc.adoptedStyleSheets.length, 2);assert.equal(env.attributes.get('data-liquid-ui-appearance'), 'x');
  assert.equal(env.observed.length, 2);assert.ok(env.observed.every(item => !item.options.childList && !item.options.subtree), 'new posts are handled by CSS without DOM scans');
  const css = adapter.sheet.css;assert.ok(css.includes('article[data-testid="tweet"]'));assert.ok(!/\b(?:padding|margin|width|height|display|position|font-size|overflow)\s*:/.test(css), 'adapter retains layout and text sizes');
  const postRule = css.split('article[data-testid="tweet"]')[1].split('}')[0];assert.ok(!postRule.includes('backdrop-filter'), 'posts have no blur');
  assert.equal(env.sheetValues.get('--liquid-ui-content-face'), 'rgba(25,27,34,0.09)');
  const playback = new Store(state.storage, sites.globalDefaults, { scope: 'global' });await playback.ready;
  const before = env.metrics();await playback.set('playbackRate', 1.25, true);
  assert.deepEqual(env.metrics(), before, 'global playback edits do not repaint site surfaces');playback.dispose();
  await b.set('chromeDensity', 0);await b.set('chromeBlur', 0);
  assert.equal(env.sheetValues.get('--liquid-ui-filter'), 'none');assert.equal(env.sheetValues.get('--liquid-ui-chrome-edge'), 'rgba(255,255,255,0)');
  env.changeTheme('rgb(20, 24, 32)');assert.equal(env.sheetValues.get('--liquid-ui-content-face'), 'rgba(250,251,255,0.09)');
  env.changeTheme('rgb(20, 24, 32)', 'rgb(0, 0, 0)');assert.equal(env.sheetValues.get('--liquid-ui-content-face'), 'rgba(25,27,34,0.09)', 'opaque native background takes precedence over unset/inherited body text color');
  await b.set('appearanceEnabled', false);assert.deepEqual(env.doc.adoptedStyleSheets, [env.foreignSheet]);assert.equal(env.attributes.get('data-liquid-ui-appearance'), 'foreign');
  assert.equal(env.observed.length, 0);assert.equal(env.listeners.size, 0);
  const disabled = env.metrics();env.changeTheme('rgb(240, 240, 240)');assert.deepEqual(env.metrics(), disabled);
  env.root.setAttribute('data-liquid-ui-appearance', 'x');adapter.pause();assert.equal(env.attributes.get('data-liquid-ui-appearance'), 'x', 'repeated pause does not restore a marker it no longer owns');
  env.root.setAttribute('data-liquid-ui-appearance', 'foreign');await b.set('appearanceEnabled', true);
  const newSheet = {};env.doc.adoptedStyleSheets.push(newSheet);adapter.pause();adapter.start();adapter.paint();
  assert.ok(env.doc.adoptedStyleSheets.includes(newSheet), 'page restore preserves other style sheets');
  env.root.setAttribute('data-liquid-ui-appearance', 'new-owner');adapter.dispose();
  assert.equal(env.attributes.get('data-liquid-ui-appearance'), 'new-owner');assert.deepEqual(env.doc.adoptedStyleSheets, [env.foreignSheet, newSheet]);
  const ended = env.metrics();await b.set('chromeDensity', 23);assert.deepEqual(env.metrics(), ended);
  for (const store of [a, b, c, d]) store.dispose();
  console.log('PASS: declarative setting validation, legacy precision, site isolation, paint-only styling, zero blur/shade, native theme, disabled idling, unrelated edit isolation, lifecycle and foreign ownership');
})().catch(error => { console.error(error);process.exitCode = 1; });
