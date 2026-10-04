'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs');
const panel = require('../quick-panel.js');
const choices = require('../choice-menu.js');
const sites = require('../site-registry.js'), { createWriter } = require('../playback-card.js');
class Element {
  constructor(tag) { this.tagName = tag;this.children = [];this.dataset = {};this.style = {};this.attributes = {};this.events = new Map();this.hidden = false;this.classList = { add() {} }; }
  append(...nodes) { for (const node of nodes) { this.children.push(node);node.parentElement = this; } }
  replaceChildren(...nodes) { this.children = [];this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  hasAttribute(key) { return Object.hasOwn(this.attributes, key); }
  removeAttribute(key) { delete this.attributes[key]; }
  attachShadow() { this.shadowRoot = new Element('shadow');this.shadowRoot.parentElement = this;return this.shadowRoot; }
  addEventListener(type, fn) { if (!this.events.has(type)) this.events.set(type, new Set());this.events.get(type).add(fn); }
  removeEventListener(type, fn) { this.events.get(type)?.delete(fn); }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this); }
  focus() { this.focused = true;if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 300, bottom: 40, width: 300, height: 40 }; }
  get isConnected() { return !!this.connected || !!this.parentElement?.isConnected; }
  fire(type, data = {}) { const event = { key: '', preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...data };for (const fn of this.events.get(type) || []) fn(event);return event; }
}
function store(initial) {
  const listeners = new Set(), writes = [], values = { ...initial };let meta = { loaded: true };
  const notify = () => { for (const fn of [...listeners]) fn(values, meta); };
  return { values, writes, listeners,
    subscribe(fn) { listeners.add(fn);fn(values, meta);return () => listeners.delete(fn); },
    async set(key, value, immediate) { return this.setMany({ [key]: value }, immediate); },
    async setMany(changes, immediate) { Object.assign(values, changes);writes.push({ changes, immediate });meta = { loaded: true };notify(); },
    remote(changes, metadata = { loaded: true }) { Object.assign(values, changes);meta = metadata;notify(); }
  };
}
const doc = new Element('document');doc.createElement = tag => { const el = new Element(tag);el.ownerDocument = doc;return el; };doc.documentElement = new Element('html');doc.documentElement.connected = true;
doc.defaultView = new Element('window');doc.defaultView.innerWidth = 1000;doc.defaultView.innerHeight = 800;
const scheme = new Element('MediaQueryList');scheme.matches = true;doc.defaultView.matchMedia = () => scheme;
doc.head = new Element('head');doc.querySelector = selector => selector === 'link#efyt-dark-theme' ? doc.enhancerTheme || null : null;
doc.defaultView.matchMedia = query => query === 'print' ? { matches: false } : scheme;
const observers = [];doc.defaultView.MutationObserver = class {
  constructor(callback) { this.callback = callback;this.targets = [];observers.push(this); }
  observe(target, options) { this.targets.push({ target, options }); }
  disconnect() { this.disconnected = true; }
};
const ambient = store({ ...sites.identify('www.youtube.com').defaults, strength: 82 }), common = store({ language: 'ja', theme: 'dark', playbackEnabled: true, playbackRate: 1.25, playbackMode: 'rate' });
const timers = new Map();let timerId = 0;
const cards = [];const playback = { css: '', createWriter: source => createWriter(source, {
  schedule: fn => { const id = ++timerId;timers.set(id, fn);return id; }, cancel: id => timers.delete(id)
}), bind(source, options) {
  const instance = { element: new Element('section'), flushes: 0, disposed: false, options,
    flush() { this.flushes++; }, dispose() { this.disposed = true;unsubscribe(); } };
  const unsubscribe = source.subscribe(values => { instance.rate = values.playbackRate; });cards.push(instance);return instance;
} };
let all = 0, reloads = 0;const visibility = [];
const pickers = [], colors = { css: '', hasOpenMenu: () => pickers.some(picker => picker.open && !picker.disposed), create(options) {
  const button = new Element('button');button.id = options.id;button.ownerDocument = doc;
  const picker = { element: new Element('div'), button, options, open: false, disposed: false,
    update(value) { button.value = value; }, close() { this.open = false; }, dispose() { this.close();this.disposed = true; } };
  picker.element.append(button);button.addEventListener('click', () => { picker.open = true; });picker.update(options.value);pickers.push(picker);return picker;
} };
const instance = panel.create({ icons: { create: () => new Element('svg') }, ambientStore: ambient, playbackStore: common,
  registry: sites, loadedVersion: '9.8.7', document: doc, CSSStyleSheet: class { replaceSync() {} }, playback, choices, colors,
  ambientGroups: sites.identify('www.youtube.com').groups,
  onAllSettings: () => all++, onVisibilityChange: value => visibility.push(value), reload: () => reloads++ });
const content = instance.root.children[0], [header, editor, footer, notice] = content.children;
const [back, title, version, close] = header.children, retry = notice.children[1];
const walk = (element, predicate) => predicate(element) ? element : element.children.map(child => walk(child, predicate)).find(Boolean);
const route = key => walk(editor, el => el.dataset.route === key);
const findInput = key => walk(editor, el => el.id === 'liquid-ui-quick-panel-setting-' + key);
const preview = (key, value) => { const input = findInput(key);assert.ok(input, key + ' is available');input.value = value;input.fire('input');return input; };
(async () => {
  common.remote({ theme: 'system' });assert.equal(instance.element.dataset.theme, 'light', 'YouTube light mode wins over a dark OS when settings follow the page');
  doc.documentElement.setAttribute('dark', '');observers[0].callback();assert.equal(instance.element.dataset.theme, 'dark', 'an open panel follows YouTube theme changes');
  common.remote({ theme: 'light' });assert.equal(instance.element.dataset.theme, 'light', 'an explicit light setting overrides the page');
  doc.documentElement.removeAttribute('dark');observers[0].callback();common.remote({ theme: 'dark' });assert.equal(instance.element.dataset.theme, 'dark', 'an explicit dark setting is preserved');
  common.remote({ theme: 'system' });doc.enhancerTheme = new Element('link');observers[0].callback();assert.equal(instance.element.dataset.theme, 'dark', 'Enhancer dark mode is followed too');
  doc.enhancerTheme.disabled = true;observers[0].callback();assert.equal(instance.element.dataset.theme, 'light', 'disabled theme styles do not force dark mode');
  doc.enhancerTheme.disabled = false;doc.enhancerTheme.media = 'print';observers[0].callback();assert.equal(instance.element.dataset.theme, 'light', 'inactive media styles do not force dark mode');
  doc.enhancerTheme.media = 'all';observers[0].callback();assert.equal(instance.element.dataset.theme, 'dark');
  doc.enhancerTheme = null;observers[0].callback();assert.equal(instance.element.dataset.theme, 'light');common.remote({ theme: 'dark' });
  assert.equal(observers[0].targets.length, 2, 'theme observation avoids the frequently changing video/comment subtree');
  assert.equal(instance.isOpen(), false);assert.deepEqual(editor.children[0].children.map(row => row.children[0].children[1].textContent), ['アンビエント背景', '再生調整']);
  assert.deepEqual(editor.children[1].children.map(row => row.children[0].dataset.route), ['appearance', 'video', 'general']);
  const quickAmbient = findInput('enabled'), quickPlayback = findInput('playbackEnabled'), playbackRow = quickPlayback.parentElement.parentElement;
  assert.equal(playbackRow.dataset.enabled, 'true');quickPlayback.checked = false;quickPlayback.fire('change');await Promise.resolve();
  assert.equal(common.values.playbackEnabled, false);assert.equal(ambient.values.enabled, true);assert.equal(playbackRow.dataset.enabled, 'false');
  common.remote({ playbackEnabled: true });assert.equal(quickPlayback.checked, true);assert.equal(playbackRow.dataset.enabled, 'true');
  quickAmbient.checked = false;quickAmbient.fire('change');await Promise.resolve();assert.equal(ambient.values.enabled, false);ambient.remote({ enabled: true });
  assert.deepEqual(sites.quickActionsFor('youtube-music'), []);assert.deepEqual(sites.quickActionsFor('x'), []);
  const opener = new Element('button');opener.connected = true;instance.show(opener);assert.ok(instance.isOpen());assert.equal(instance.element.parentElement, doc.documentElement);
  route('playback').fire('click');assert.equal(title.textContent, '再生調整');assert.equal(editor.children.length, 1, 'the home playback shortcut opens only its compact card');back.fire('click');
  const lowerControl = new Element('button');lowerControl.connected = true;lowerControl.getBoundingClientRect = () => ({ left: 975, top: 780, right: 997, bottom: 798, width: 22, height: 18 });
  content.getBoundingClientRect = () => ({ left: 0, top: 0, right: 300, bottom: 200, width: 300, height: 200 });
  assert.equal(instance.showPlayback(lowerControl), true);assert.equal(instance.element.dataset.anchored, 'true');assert.equal(editor.children.length, 1);
  assert.equal(instance.element.style['--panel-left'], '688px');assert.equal(instance.element.style['--panel-top'], '572px', 'lower-edge playback controls open a popup above the anchor inside the screen');
  doc.defaultView.innerHeight = 160;content.getBoundingClientRect = () => ({ left: 0, top: 0, right: 300, bottom: 136, width: 300, height: 136 });
  lowerControl.getBoundingClientRect = () => ({ left: 975, top: 120, right: 997, bottom: 140, width: 22, height: 20 });doc.defaultView.fire('resize');
  assert.equal(instance.element.style['--panel-top'], '12px', 'the playback popup remains inside a low viewport');
  lowerControl.getBoundingClientRect = () => ({ left: 975, top: -150, right: 997, bottom: -130, width: 22, height: 20 });doc.fire('scroll');assert.equal(instance.isOpen(), false, 'scrolling the source control off screen closes its popup');
  doc.defaultView.innerHeight = 800;delete content.getBoundingClientRect;instance.show(opener);assert.equal(instance.element.dataset.anchored, 'false');
  assert.equal(version.textContent, '9.8.7');assert.equal(version.attributes['aria-label'], '読み込み版 9.8.7');assert.equal(version.hidden, false);
  route('appearance').fire('click');assert.equal(title.textContent, '外観');assert.equal(back.children[1].textContent, '設定');
  assert.equal(version.hidden, true, 'detail headers keep room for the previous-screen label');
  assert.ok(findInput('strength') && findInput('surfaceMultiplier') && findInput('hideMainScrollbar'), 'appearance controls share one page');
  assert.equal(route('ambient'), undefined);assert.equal(route('surfaces'), undefined);
  const toggle = findInput('enabled');toggle.checked = false;toggle.fire('change');await Promise.resolve();
  assert.equal(ambient.values.enabled, false);assert.equal(ambient.writes.at(-1).immediate, true);assert.equal(common.values.playbackRate, 1.25);
  assert.equal(instance.element.attributes['aria-modal'], undefined, 'inline adjustment never darkens the page with a backdrop');
  assert.equal(route('safety'), undefined, 'warning is not nested under ambient');assert.equal(route('rendering'), undefined);assert.equal(route('surfaces'), undefined);
  assert.ok(findInput('avoidBars') && findInput('fillBars') && findInput('inset') && findInput('fps'), 'black-bar and drawing controls are on the appearance page');
  const strength = preview('strength', '67');assert.equal(ambient.values.strength, 67);assert.equal(ambient.writes.at(-1).immediate, false);assert.equal(timers.size, 1);
  ambient.remote({ blur: 76 });assert.equal(findInput('strength'), strength, 'remote values preserve the mounted field');strength.fire('change');assert.equal(ambient.writes.at(-1).immediate, true);assert.equal(timers.size, 0);
  const bars = findInput('avoidBars');bars.checked = false;bars.fire('change');assert.equal(ambient.values.avoidBars, false);assert.equal(title.textContent, '外観');
  preview('surfaceMultiplier', '68');assert.equal(ambient.values.surfaceMultiplier, .68);back.fire('click');assert.deepEqual(ambient.writes.at(-1).changes, { surfaceMultiplier: .68 });
  route('video').fire('click');assert.equal(title.textContent, '動画と再生');
  assert.ok(findInput('flashWarning') && findInput('sidebarParallel'), 'video controls share one page with playback');
  const info = walk(editor, el => el.attributes['aria-label'] === 'ウルトラワイド用の配置の説明'), help = instance.root.children[1];
  info.fire('click');assert.equal(help.hidden, false);assert.equal(info.attributes['aria-expanded'], 'true');
  doc.fire('keydown', { key: 'Escape' });assert.equal(help.hidden, true);assert.equal(info.attributes['aria-expanded'], 'false');assert.ok(info.focused);assert.equal(title.textContent, '動画と再生');
  info.fire('click');editor.fire('scroll');assert.equal(help.hidden, true, 'scroll dismisses an explanation before its anchor moves');
  info.fire('click');doc.defaultView.fire('resize');assert.equal(help.hidden, true, 'resize never leaves an explanation at a stale position');
  assert.equal(route('playback'), undefined);assert.equal(route('sidebar'), undefined);assert.equal(route('safety'), undefined);
  const sidebar = findInput('sidebarEnabled');assert.equal(sidebar.checked, false);sidebar.checked = true;sidebar.fire('change');assert.equal(ambient.values.sidebarEnabled, true);
  assert.equal(back.children[1].textContent, '設定');const select = findInput('sidebarFilter');assert.equal(select.tagName, 'button');select.fire('click');
  const menu = instance.root.children.find(el => el.id === select.id + '-choices');menu.children[1].fire('click');assert.equal(ambient.values.sidebarFilter, 'channel');assert.equal(menu.hidden, true);
  ambient.remote({ sidebarFilter: 'all' });assert.equal(findInput('sidebarFilter'), select);assert.equal(select.value, 'all');select.fire('click');doc.fire('keydown', { key: 'Escape' });assert.equal(menu.hidden, true);assert.ok(instance.isOpen());
  const card = cards.at(-1);common.remote({ playbackRate: 1.5 });assert.equal(card.rate, 1.5);
  common.remote({ reduceTransparency: true });assert.equal(instance.element.dataset.solid, 'true');assert.equal(cards.at(-1), card);common.remote({ reduceTransparency: false });
  doc.fire('keydown', { key: 'Escape' });assert.equal(title.textContent, 'Flexible UI', 'Escape navigates back before closing');assert.ok(card.disposed);
  route('general').fire('click');assert.ok(findInput('language'));assert.equal(back.children[1].textContent, '設定');
  const theme = findInput('theme');theme.fire('click');instance.root.children.find(el => el.id === theme.id + '-choices').children[1].fire('click');assert.equal(common.values.theme, 'light');
  const language = findInput('language');language.fire('click');instance.root.children.find(el => el.id === language.id + '-choices').children[1].fire('click');
  assert.equal(common.values.language, 'en');assert.notEqual(findInput('language'), language);assert.equal(doc.activeElement, findInput('language'), 'language changes retain keyboard focus on the replacement control');
  common.remote({ language: 'ja' });
  back.fire('click');route('appearance').fire('click');preview('blur', '72');footer.children[0].fire('click');assert.equal(all, 1);assert.equal(instance.isOpen(), false);assert.deepEqual(ambient.writes.at(-1).changes, { blur: 72 });
  instance.show(opener);assert.equal(title.textContent, 'Flexible UI', 'reopening starts from the shared classification');route('appearance').fire('click');preview('strength', '71');[...timers.values()][0]();assert.equal(timers.size, 0);
  instance.hide();instance.show(opener);const escape = doc.fire('keydown', { key: 'Escape' });assert.ok(escape.prevented && escape.stopped);assert.equal(instance.isOpen(), false);
  instance.show(opener);doc.fire('pointerdown', { composedPath: () => [opener] });assert.ok(instance.isOpen());doc.fire('pointerdown', { composedPath: () => [doc.documentElement] });assert.equal(instance.isOpen(), false);
  instance.show(opener);doc.fullscreenElement = new Element('player');doc.fire('fullscreenchange');assert.equal(instance.isOpen(), false);doc.fullscreenElement = null;
  const player = new Element('player');player.connected = true;doc.fullscreenElement = player;instance.show(opener);assert.equal(instance.element.parentElement, player);
  doc.fullscreenElement = null;doc.fire('fullscreenchange');assert.equal(instance.isOpen(), false, 'exiting fullscreen cannot leave the panel mounted in the old player');
  instance.show(opener);route('appearance').fire('click');
  ambient.remote({}, { saveError: new Error('Unavailable'), saveErrors: [{ key: 'enabled' }] });assert.equal(notice.hidden, false);retry.focus();retry.fire('click');await Promise.resolve();await Promise.resolve();assert.equal(notice.hidden, true);
  assert.equal(doc.activeElement, back, 'successful retry moves focus out of the hidden notice');instance.hide();
  ambient.remote({}, { error: new Error('Storage read failed') });assert.equal(retry.textContent, '再読み込み');assert.equal(notice.children[0].textContent, '設定を読み込めませんでした。ページを再読み込みしてください。');
  retry.fire('click');assert.equal(reloads, 1, 'a failed initial read offers a real recovery instead of a no-op save retry');ambient.remote({});
  common.remote({}, { reloadRequired: true });retry.fire('click');assert.equal(reloads, 2);common.remote({ language: 'en', theme: 'light' });assert.equal(instance.element.dataset.theme, 'light');
  instance.show(opener);route('appearance').fire('click');assert.equal(title.textContent, 'Appearance');assert.equal(back.children[1].textContent, 'Settings');preview('blur', '80');instance.dispose();
  assert.deepEqual(ambient.writes.at(-1).changes, { blur: 80 });assert.equal(timers.size, 0);assert.equal(ambient.listeners.size, 0);assert.equal(common.listeners.size, 0);
  assert.equal(doc.events.get('keydown').size, 0);assert.equal(doc.events.get('pointerdown').size, 0);assert.equal(doc.events.get('fullscreenchange').size, 0);instance.show(opener);assert.equal(instance.isOpen(), false);
  assert.equal(doc.events.get('scroll').size, 0);
  assert.equal(doc.defaultView.events.get('resize').size, 0);
  assert.ok(observers[0].disconnected);assert.equal(scheme.events.get('change').size, 0, 'disposing removes page and OS theme subscriptions');
  const music = store(sites.identify('music.youtube.com').defaults), musicPanel = panel.create({ icons: { create: () => new Element('svg') }, ambientStore: music, playbackStore: common,
    registry: sites, siteId: 'youtube-music', document: doc, CSSStyleSheet: class { replaceSync() {} }, playback, choices, colors,
    ambientGroups: sites.identify('music.youtube.com').groups, onAllSettings() {} });
  const musicEditor = musicPanel.root.children[0].children[1];assert.equal(musicEditor.children.length, 1, 'YouTube shortcuts do not leak into the Music panel');
  assert.equal(musicPanel.showPlayback(opener), false, 'the playback control popup remains YouTube-specific');
  musicEditor.children[0].children[0].children[0].fire('click');
  assert.equal(walk(musicEditor, el => el.id?.endsWith('-setting-avoidBars')), undefined, 'YouTube-only rendering controls do not leak into Music appearance');
  common.remote({ theme: 'system' });assert.equal(musicPanel.element.dataset.theme, 'dark', 'other sites retain their OS-based automatic theme');
  scheme.matches = false;scheme.fire('change');assert.equal(musicPanel.element.dataset.theme, 'light');
  musicPanel.dispose();assert.equal(music.listeners.size, 0);assert.equal(common.listeners.size, 0);
  const colorStore = store({ ...sites.identify('www.youtube.com').defaults, accentColor: '#ff3366' });
  const colorGroups = sites.identify('www.youtube.com').groups.map(group => group.id !== 'appearance' ? group : { ...group,
    fields: [...group.fields.filter(field => field.key !== 'accentColor'), { key: 'accentColor', type: 'color', label: { ja: 'アクセント色', en: 'Accent color' } }] });
  const colorPanel = panel.create({ icons: { create: () => new Element('svg') }, ambientStore: colorStore, playbackStore: common,
    registry: sites, document: doc, CSSStyleSheet: class { replaceSync() {} }, playback, choices, colors, ambientGroups: colorGroups, onAllSettings() {} });
  colorPanel.show(opener);const colorEditor = colorPanel.root.children[0].children[1];walk(colorEditor, el => el.dataset.route === 'appearance').fire('click');
  const picker = pickers.at(-1);assert.equal(picker.button.tagName, 'button');assert.equal(picker.button.value, '#ff3366');picker.options.onChange('#3377cc');
  assert.equal(colorStore.values.accentColor, '#3377cc');assert.equal(picker.button.value, '#3377cc');assert.equal(colorStore.writes.at(-1).immediate, true);
  picker.button.fire('click');doc.fire('keydown', { key: 'Escape' });assert.equal(colorPanel.root.children[0].children[0].children[1].textContent, 'Appearance', 'an open color picker handles Escape before panel navigation');
  picker.close();colorPanel.dispose();assert.ok(picker.disposed);assert.equal(colorStore.listeners.size, 0);assert.equal(common.listeners.size, 0);
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  for (const script of manifest.content_scripts.filter(script => script.js?.includes('settings-dialog.js'))) {
    assert.ok(script.js.indexOf('quick-panel.js') >= 0 && script.js.indexOf('quick-panel.js') < script.js.indexOf('settings-dialog.js'), 'the shared panel is loaded before its controller');
  }
  const stage = fs.readFileSync('tests/design-stage.js', 'utf8');assert.ok(stage.includes('LiquidQuickPanel.create('));
  assert.ok(!stage.includes('LiquidPlaybackDesigns') && !stage.includes('quick-compare'), 'the stage uses the production panel without a comparison gallery');
  assert.ok(visibility.includes(true) && visibility.includes(false));
  const { harness } = require('./check-ambient.cjs');
  for (const workerMode of [false, true]) {
    let opened = false, toggles = 0, closed = 0, anchor;
    const runtime = harness(workerMode, { sharedSettings: true, quickPanelController: {
      togglePanel(opener) { opened = !opened;toggles++;anchor = opener; }, isPanelOpen: () => opened,
      closePanel() { opened = false;closed++; }
    } });
    await runtime.load({ enabled: true, flashWarning: false });
    const launcher = runtime.get('yac-settings-button');launcher.click();
    assert.equal(toggles, 1);assert.equal(anchor, launcher);assert.equal(runtime.get('yac-controls').hidden, true, 'YouTube opens the shared panel instead of its inherited settings menu');
    launcher.click();assert.equal(toggles, 2);assert.equal(opened, false);
    runtime.event(runtime.document, 'yac-dispose');assert.equal(closed, 1, 'ambient teardown also closes the shared panel');
    runtime.sharedStore.dispose();runtime.playbackStore.dispose();assert.equal(runtime.storageListeners.size, 0);
  }
  console.log('Quick panel: inline ambient settings, live previews, scaled integers, batched persistence, navigation, shared stores, errors and cleanup passed');
})().catch(error => { console.error(error);process.exitCode = 1; });
