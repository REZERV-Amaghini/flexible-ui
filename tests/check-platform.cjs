'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const Store = require('../settings-store.js'), sites = require('../site-registry.js');
function backend(initial = {}) {
  const data = structuredClone(initial), listeners = new Set(), writes = [];
  return { data, writes, listeners, storage: {
    onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) },
    local: { get: async keys => Object.fromEntries(keys.filter(key => Object.hasOwn(data, key)).map(key => [key, structuredClone(data[key])])),
      set: async values => {
        writes.push(structuredClone(values));const changes = {};
        for (const [key, value] of Object.entries(values)) { changes[key] = { oldValue: data[key], newValue: value };data[key] = value; }
        for (const fn of listeners) fn(changes, 'local');
      } }
  } };
}
(async () => {
  const original = { ambient: { strength: 79.6, surfaceDensity: 35, language: 'en', flashWarning: false },
    'yac-setting:blur': 42.7, 'yac-setting:readingDensityOffset': -30,
    'liquid-ui:site:youtube:saturation': 120 };
  const state = backend(original), youtube = new Store(state.storage, sites.ambientDefaults,
    { scope: 'youtube', inheritLegacy: true, globalKeys: ['language'] });
  const music = new Store(state.storage, { ...sites.ambientDefaults, strength: 35 }, { scope: 'youtube-music', globalKeys: ['language'] });
  const general = new Store(state.storage, sites.globalDefaults, { scope: 'global', inheritLegacy: true });
  await Promise.all([youtube.ready, music.ready, general.ready]);
  assert.equal(youtube.values.strength, 80);assert.equal(youtube.values.blur, 43);assert.equal(youtube.values.flashWarning, false);
  assert.equal(youtube.values.surfaceMultiplier, .35);assert.equal(youtube.values.readingDensity, 70);
  assert.equal(youtube.values.saturation, 120, 'new site key overrides the older fallback');
  assert.equal(music.values.strength, 35);assert.equal(music.values.blur, 65);assert.equal(music.values.flashWarning, true);
  assert.equal(music.values.surfaceMultiplier, .65, 'Music does not inherit stored YouTube appearance');
  assert.equal(music.values.language, 'en');assert.equal(general.values.language, 'en');
  assert.deepEqual(state.writes, [], 'loading and migration never rewrite stored preferences');
  assert.deepEqual(state.data, original, 'raw legacy precision is preserved');
  const a = [], b = [];const stopA = youtube.subscribe(values => a.push(values));const stopB = youtube.subscribe(values => b.push(values));
  await youtube.set('strength', 67.4);
  assert.equal(a.at(-1).strength, 67);assert.equal(b.at(-1).strength, 67, 'both UI views see the same optimistic edit');
  assert.equal(state.writes.length, 0, 'drag previews do not save every input');
  await Promise.all([youtube.set('strength', 67, true), music.set('strength', 36, true), general.set('language', 'ja', true)]);
  assert.equal(youtube.values.strength, 67);assert.equal(music.values.strength, 36);
  assert.equal(youtube.values.language, 'ja');assert.equal(music.values.language, 'ja');
  assert.deepEqual(state.writes.map(write => Object.keys(write)), [['liquid-ui:site:youtube:strength'],
    ['liquid-ui:site:youtube-music:strength'], ['liquid-ui:global:language']]);
  assert.equal(state.data['yac-setting:blur'], 42.7);assert.equal(state.data.ambient.language, 'en');
  await general.set('theme', 'dark', true);await general.set('reduceTransparency', true, true);
  await general.set('theme', 'malformed', true);assert.equal(general.values.theme, 'dark');
  const reloaded = new Store(state.storage, sites.ambientDefaults, { scope: 'youtube', inheritLegacy: true, globalKeys: ['language'] });await reloaded.ready;
  assert.equal(reloaded.values.strength, 67);assert.equal(reloaded.values.language, 'ja');assert.equal(reloaded.values.blur, 43);
  stopA();stopB();const seen = a.length;await youtube.set('strength', 66);assert.equal(a.length, seen);
  const error = new Error('Storage unavailable');state.storage.local.set = async () => { throw error; };
  await assert.rejects(music.set('strength', 40, true), error);
  assert.equal(music.values.strength, 40, 'failed persistence retains the selected value');
  assert.equal(music.saveErrors.get('strength'), error);assert.equal(youtube.saveErrors.size, 0, 'site errors stay separate');
  const contextError = new Error('Extension context invalidated.');state.storage.local.set = () => { throw contextError; };
  await assert.rejects(music.set('strength', 41, true), contextError);let retiredWrites = 0;
  state.storage.local.set = () => { retiredWrites++; };await assert.rejects(music.set('strength', 42, true), contextError);
  assert.equal(retiredWrites, 0, 'retired scoped storage is never retried');
  for (const store of [youtube, music, general, reloaded]) store.dispose();assert.equal(state.listeners.size, 0);
  assert.equal(sites.identify('www.youtube.com').id, 'youtube');assert.equal(sites.identify('music.youtube.com').id, 'youtube-music');
  assert.equal(sites.identify('x.com').id, 'x');assert.equal(sites.identify('example.org').id, 'example.org');
  assert.deepEqual(sites.identify('notyoutube.com').groups, [], 'other sites do not inherit YouTube appearance or duplicate global playback');
  const youtubeDefinition = sites.identify('www.youtube.com'), sidebarBackend = backend(), sidebarOptions = {
    scope: 'youtube', inheritLegacy: true,
    rules: Object.fromEntries(youtubeDefinition.groups.flatMap(group => group.fields).map(field => [field.key, field]))
  };
  const sidebarStore = new Store(sidebarBackend.storage, youtubeDefinition.defaults, sidebarOptions);await sidebarStore.ready;
  assert.equal(sidebarStore.values.sidebarEnabled, false, 'existing users keep the native sidebar until opting in');
  assert.equal(sidebarStore.values.sidebarFilter, 'related');
  await sidebarStore.set('sidebarEnabled', true, true);await sidebarStore.set('sidebarFilter', 'channel', true);
  await sidebarStore.set('sidebarFilter', 'unknown', true);assert.equal(sidebarStore.values.sidebarFilter, 'channel');
  for (const key of ['hideMainScrollbar', 'hideChatScrollbar', 'hideListScrollbar']) assert.equal(sidebarStore.values[key], true);
  await sidebarStore.set('hideMainScrollbar', false, true);await sidebarStore.set('hideChatScrollbar', false, true);
  assert.equal(sidebarStore.values.hideListScrollbar, true, 'each column has an independent preference');
  const sidebarReload = new Store(sidebarBackend.storage, youtubeDefinition.defaults, sidebarOptions);await sidebarReload.ready;
  assert.equal(sidebarReload.values.sidebarEnabled, true);assert.equal(sidebarReload.values.sidebarFilter, 'channel');
  assert.equal(sidebarReload.values.hideMainScrollbar, false);assert.equal(sidebarReload.values.hideChatScrollbar, false);assert.equal(sidebarReload.values.hideListScrollbar, true);
  assert.deepEqual(Object.keys(sidebarBackend.data).sort(), ['liquid-ui:site:youtube:hideChatScrollbar', 'liquid-ui:site:youtube:hideMainScrollbar', 'liquid-ui:site:youtube:sidebarEnabled', 'liquid-ui:site:youtube:sidebarFilter']);
  assert.equal(sites.identify('music.youtube.com').defaults.sidebarEnabled, undefined, 'sidebar preferences stay YouTube-specific');
  assert.equal(sidebarStore.values.useCustomAccent, false);
  await sidebarStore.set('accentColor', '#AF52DE', true);assert.equal(sidebarStore.values.accentColor, '#af52de');
  await sidebarStore.set('accentColor', 'url(https://invalid.test)', true);assert.equal(sidebarStore.values.accentColor, '#af52de', 'only six-digit HEX colors are accepted');
  assert.equal(sites.identify('music.youtube.com').defaults.accentColor, undefined);
  sidebarStore.dispose();sidebarReload.dispose();assert.equal(sidebarBackend.listeners.size, 0);
  sites.register({ id: 'example', name: 'Example', hosts: ['example.org'], defaults: { enabled: false }, groups: [] });
  assert.equal(sites.identify('example.org').id, 'example', 'new site modules register without replacing the shell');
  assert.throws(() => sites.register({ id: 'example', hosts: [] }), /duplicate/);
  const folder = path.resolve(__dirname, '..'), manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json')));
  assert.deepEqual(manifest.permissions, ['storage']);assert.equal(manifest.action.default_popup, undefined);
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.background, { service_worker: 'extension-background.js' }, 'the source folder can be loaded in Chrome without the MV3 scripts warning');
  assert.equal(manifest.browser_specific_settings, undefined, 'Firefox-only keys are added only to the Firefox build');
  const generic = manifest.content_scripts.find(script => script.matches.includes('https://*/*'));
  assert.ok(generic.matches.includes('http://*/*'));assert.ok(generic.exclude_matches.includes('https://www.youtube.com/*'));
  assert.ok(generic.js.indexOf('settings-dialog.js') < generic.js.indexOf('media-controller.js'));
  const watch = manifest.content_scripts.find(script => script.js?.includes('ambient.js'));
  assert.ok(watch.js.indexOf('settings-dialog.js') < watch.js.indexOf('ambient.js'), 'shared controller starts before ambient');
  let click;const sent = [], created = [], extension = { action: { onClicked: { addListener: fn => { click = fn; } } },
    tabs: { sendMessage: async (...args) => { sent.push(args); }, create: async item => created.push(item) },
    runtime: { getURL: file => 'extension:///' + file } };
  vm.runInNewContext(fs.readFileSync(path.join(folder, 'extension-background.js'), 'utf8'), { chrome: extension });
  await click({ id: 8 });assert.equal(sent[0][0], 8);assert.equal(sent[0][1].type, 'liquid-ui:open-settings');
  assert.equal(sent[0][2].frameId, 0);assert.equal(created.length, 0, 'toolbar entry opens settings in the same page');
  extension.tabs.sendMessage = async () => { throw new Error('Restricted page'); };await click({ id: 9 });
  assert.equal(created[0].url, 'extension:///settings.html', 'browser-owned pages retain a separate settings fallback');
  await click({});assert.equal(created.length, 1, 'missing tab cannot issue a message');
  console.log('PASS: site isolation, shared live views, global preferences, legacy migration without writes, integer persistence, scoped failures, retired context, module registration, toolbar dispatch and restricted-page fallback');
})().catch(error => { console.error(error);process.exitCode = 1; });
