'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { create, createCardMenus, createCommentHover, createHeaderFade, createScrollLayout } = require('../watch-sidebar.js');
const sidebarCss = fs.readFileSync(path.join(__dirname, '..', 'watch-sidebar.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const leftLayerRule = [...sidebarCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, selector]) => selector.trim().startsWith('ytd-watch-flexy #secondary:has('));
assert.ok(leftLayerRule, 'left overlays raise their sticky ancestor stacking context');
const leftLayerIndex = Number(leftLayerRule[2].match(/z-index:\s*(\d+)\s*!important/)?.[1]);
assert.ok(leftLayerIndex > 301 && leftLayerIndex < 2020, 'left overlays are above the Enhancer player and below the native masthead');
assert.ok(/#secondary:not\(\[data-liquid-scroll-column\]\):not\(\[data-liquid-parallel\]\):has\([^{}]+\)\s*\{\s*position:\s*relative\s*!important/.test(sidebarCss), 'theater overlays get a positioned context without replacing sticky list positioning');
const leftLayerTargets = leftLayerRule[1].trim().match(/:has\((.*)\)$/)[1];
const leftLayerActive = root => Boolean(root.querySelector(leftLayerTargets));

// Small DOM harness for lifecycle and asynchronous native filtering. Native
// layout and real YouTube handlers are additionally checked in the browser.
class Node {
  constructor(tag = 'div') {
    this.tagName = tag;this.nodeType = 1;this.attrs = new Map();this.children = [];this.events = new Map();this.textContent = '';
    const values = new Map();this.style = { getPropertyValue: key => values.get(key)?.value || '', getPropertyPriority: key => values.get(key)?.priority || '',
      setProperty: (key, value, priority = '') => values.set(key, { value, priority }), removeProperty: key => values.delete(key) };
  }
  setAttribute(key, value) { this.attrs.set(key, String(value)); }
  getAttribute(key) { return this.attrs.get(key) ?? null; }
  hasAttribute(key) { return this.attrs.has(key); }
  removeAttribute(key) { this.attrs.delete(key); }
  get isConnected() { return this.tagName === 'document' || Boolean(this.parent?.isConnected); }
  get parentElement() { return this.parent; }
  get firstChild() { return this.children[0] || null; }
  append(...nodes) { for (const node of nodes) { node.remove();node.parent = this;this.children.push(node); } }
  insertBefore(node, before) { node.remove();node.parent = this;const index = this.children.indexOf(before);this.children.splice(index < 0 ? this.children.length : index, 0, node); }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);this.parent = null; }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  matches(selector) {
    return selector.split(',').some(part => {
      part = part.trim();const exclude = part.match(/:not\(\[([^\]]+)\]\)/);
      if (exclude) { if (this.hasAttribute(exclude[1])) return false;part = part.replace(exclude[0], ''); }
      const tag = part.match(/^[a-z][\w-]*/i);if (tag && tag[0] !== this.tagName) return false;
      const id = part.match(/#([\w-]+)/);if (id && this.getAttribute('id') !== id[1]) return false;
      for (const [, name] of part.matchAll(/\.([\w-]+)/g)) if (!(this.className || '').split(/\s+/).includes(name)) return false;
      for (const [, key, value] of part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
        if (!this.hasAttribute(key) || value !== undefined && this.getAttribute(key) !== value) return false;
      }
      return true;
    });
  }
  closest(selector) { for (let node = this;node;node = node.parent) if (node.matches(selector)) return node;return null; }
  querySelectorAll(selector) {
    const result = [], groups = selector.split(',').map(part => part.trim().split(/\s+/));
    function visit(node) {
      for (const child of node.children) {
        if (groups.some(parts => {
          if (!child.matches(parts.at(-1))) return false;
          let parent = child.parent;
          for (let index = parts.length - 2;index >= 0;index--) {
            while (parent && !parent.matches(parts[index])) parent = parent.parent;
            if (!parent) return false;parent = parent.parent;
          }
          return true;
        })) result.push(child);
        visit(child);
      }
    }
    visit(this);return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(event, handler) { if (!this.events.has(event)) this.events.set(event, new Set());this.events.get(event).add(handler); }
  removeEventListener(event, handler) { this.events.get(event)?.delete(handler); }
  dispatch(event, data = {}) { for (const handler of this.events.get(event) || []) handler({ type: event, ...data }); }
  click() { this.dispatch('click'); }
  focus() { this.focused = true; }
  getBoundingClientRect() { return { top: 12, right: 300 }; }
}
const element = (tag, id) => { const node = new Node(tag);if (id) node.setAttribute('id', id);return node; };
function fixture({ filter = true, playlist = true, channel = true } = {}) {
  const doc = new Node('document');doc.documentElement = element('html');doc.append(doc.documentElement);
  doc.createElement = tag => element(tag);
  const watch = element('ytd-watch-flexy');watch.setAttribute('video-id', 'first');doc.documentElement.append(watch);
  const root = element('div', 'secondary'), inner = element('div', 'secondary-inner');root.append(inner);watch.append(root);
  const related = element('div', 'related'), chips = element('yt-related-chip-cloud-renderer');related.append(chips);inner.append(related);
  const all = element('button');all.setAttribute('role', 'tab');all.setAttribute('aria-selected', 'true');all.textContent = 'すべて';chips.append(all);
  const button = element('button');button.setAttribute('role', 'tab');button.setAttribute('aria-selected', 'false');button.textContent = '関連動画';if (filter) chips.append(button);
  const provided = element('button');provided.setAttribute('role', 'tab');provided.setAttribute('aria-selected', 'false');provided.textContent = '提供: First channel';if (channel) chips.append(provided);
  function replaceRows(href) { related.querySelector('yt-lockup-view-model')?.remove();const row = element('yt-lockup-view-model'), link = element('a');link.setAttribute('href', href);row.append(link);row.textContent = href;related.append(row);return row; }
  const original = replaceRows('/unrelated');let calls = 0;
  for (const chip of [all, provided, button]) chip.addEventListener('click', () => {
    if (chip === button) calls++;
    for (const other of [all, provided, button]) other.setAttribute('aria-selected', String(chip === other));
  });
  const mix = element('ytd-playlist-panel-renderer', 'playlist'), mixRow = element('ytd-playlist-panel-video-renderer');mix.append(mixRow);mix.scrollTop = 127;if (playlist) inner.insertBefore(mix, related);
  let seq = 0;const timers = new Map(), observers = [], resizers = [];
  const win = new Node('window');win.location = new URL('https://www.youtube.com/watch?v=first&list=RDMM');
  win.queueMicrotask = queueMicrotask;win.setTimeout = (callback, delay) => { timers.set(++seq, { callback, delay });return seq; };win.clearTimeout = id => timers.delete(id);
  win.MutationObserver = class { constructor(callback) { this.callback = callback;this.targets = new Map();observers.push(this); } observe(node, options) { this.target = node;this.targets.set(node, options); } disconnect() { this.target = null;this.targets.clear(); } };
  win.ResizeObserver = class { constructor(callback) { this.callback = callback;resizers.push(this);this.targets = new Set(); } observe(node) { this.targets.add(node); } disconnect() { this.targets.clear(); } };
  function mutate(target = related, type = 'childList', attributeName = null, extra = {}) {
    for (const observer of observers) if ([...observer.targets].some(([node, options]) => (node === target || options.subtree && node.contains(target)) &&
      (type === 'attributes' ? options.attributes && (!options.attributeFilter || options.attributeFilter.includes(attributeName)) : options[type])))
      observer.callback([{ target, type, attributeName, addedNodes: [], removedNodes: [], ...extra }]);
  }
  function advance(delay) { for (const [id, timer] of [...timers]) if (timer.delay <= delay) { timers.delete(id);timer.callback(); } }
  return { doc, win, watch, root, inner, related, chips, button, all, provided, original, mix, mixRow, replaceRows, mutate, timers, observers, resizers, advance, calls: () => calls };
}
const settle = async () => { await Promise.resolve();await Promise.resolve(); };
const state = f => f.root.getAttribute('data-liquid-related');

(async () => {
  const f = fixture(), api = create({ document: f.doc, window: f.win });await settle();
  f.advance(120);await settle();
  assert.equal(f.root.getAttribute('data-liquid-sidebar'), 'related');
  assert.equal(f.calls(), 1, 'invoke the actual native filter handler');
  assert.equal(state(f), 'loading', 'old All rows remain hidden after selection acknowledgement');
  const loadingNotice = f.root.children[0].children[1];
  assert.equal(loadingNotice.children[0].hidden, false, 'loading uses thumbnail/text skeletons');
  assert.equal(loadingNotice.children[1].textContent, '', 'no reading-in-progress label');
  assert.equal(f.original.parent, f.related);
  f.replaceRows('/related');f.mutate();await settle();assert.equal(state(f), 'ready');
  // A reused native chip may reset to All after the first acknowledged click.
  f.button.setAttribute('aria-selected', 'false');f.all.setAttribute('aria-selected', 'true');f.mutate();await settle();
  f.advance(400);await settle();assert.equal(f.calls(), 2, 'reapply after native SPA reset');
  f.replaceRows('/related-after-reset');f.mutate();await settle();assert.equal(state(f), 'ready');
  const tabs = f.root.querySelectorAll('button[role="tab"]').filter(tab => !f.related.contains(tab));
  let nativeAction = 0;f.mixRow.addEventListener('click', () => nativeAction++);
  assert.equal(tabs[0].getAttribute('aria-controls'), 'playlist', 'special playlist tab comes first');
  assert.ok(tabs[0].hasAttribute('data-liquid-special-tab'));
  assert.deepEqual(tabs.slice(1).map(tab => tab.textContent), f.chips.children.map(chip => chip.textContent), 'the header uses the actual native labels and order');
  tabs[0].click();assert.equal(f.root.getAttribute('data-liquid-sidebar'), 'playlist');
  f.mixRow.click();assert.equal(nativeAction, 1);assert.equal(f.mix.scrollTop, 127);assert.equal(f.mix.parent, f.inner);
  tabs[0].dispatch('keydown', { key: 'ArrowLeft', preventDefault() {} });assert.equal(f.root.getAttribute('data-liquid-sidebar'), 'channel');
  tabs.find(tab => tab.textContent === '関連動画').click();
  tabs[0].click();f.doc.dispatch('yt-navigate-start');
  f.win.location = new URL('https://www.youtube.com/watch?v=second&list=RDMM');
  // Never click the old video's filter before the new public DOM arrives.
  f.doc.dispatch('yt-navigate-finish');await settle();assert.equal(f.calls(), 2);
  f.watch.setAttribute('video-id', 'second');f.button.setAttribute('aria-selected', 'false');f.mutate();await settle();
  f.advance(120);await settle();
  assert.equal(f.calls(), 3);assert.equal(f.root.getAttribute('data-liquid-sidebar'), 'playlist', 'retain an explicit Mix choice across navigation');
  f.replaceRows('/related-second');f.mutate();await settle();assert.equal(state(f), 'ready');
  const host = f.root.children[0];host.remove();api.refresh();await settle();
  assert.equal(f.root.children[0], host, 'repair only our removed tab host');
  assert.equal(f.root.children.filter(node => node.className === 'liquid-watch-sidebar').length, 1);
  const replacement = fixture();replacement.button.setAttribute('aria-selected', 'true');
  f.root.remove();f.mutate(f.watch, 'childList', null, { removedNodes: [f.root] });await settle();
  assert.equal(f.root.hasAttribute('data-liquid-sidebar'), false, 'release a removed sidebar during the gap before its replacement arrives');assert.equal(f.timers.size, 0);
  f.watch.append(replacement.root);api.refresh();await settle();
  assert.equal(f.root.hasAttribute('data-liquid-sidebar'), false, 'release attributes on replaced native containers');
  assert.equal(replacement.root.children.filter(node => node.className === 'liquid-watch-sidebar').length, 1);
  assert.equal(replacement.mix.parent, replacement.inner, 'replacement native nodes are never reparented by tabs');
  api.dispose();assert.equal(f.root.hasAttribute('data-liquid-sidebar'), false);assert.equal(f.mix.parent, f.inner);
  assert.equal(f.timers.size, 0);assert.ok(f.observers.every(observer => !observer.target));

  const missing = fixture({ filter: false, playlist: false });const missingApi = create({ document: missing.doc, window: missing.win });
  missing.advance(10000);
  assert.equal(state(missing), 'unavailable');assert.equal(missing.all.getAttribute('aria-selected'), 'true');
  assert.equal(missing.calls(), 0, 'never fall back to All');
  missing.chips.append(missing.button);missing.mutate();await settle();missing.advance(120);await settle();assert.equal(missing.calls(), 1);
  missing.replaceRows('/late-related');missing.mutate();await settle();assert.equal(state(missing), 'ready');missingApi.dispose();

  const delayed = fixture();const delayedApi = create({ document: delayed.doc, window: delayed.win });await settle();
  delayed.advance(120);await settle();delayed.advance(10000);
  assert.equal(state(delayed), 'failed', 'a stalled request must not reveal stale All results');
  delayed.mutate();await settle();assert.equal(state(delayed), 'failed');
  delayed.replaceRows('/eventual-related');delayed.mutate();await settle();assert.equal(state(delayed), 'ready');delayedApi.dispose();

  const optional = fixture(), values = { sidebarEnabled: false, sidebarFilter: 'related' }, writes = [], subscribers = new Set();
  const store = { subscribe(fn) { subscribers.add(fn);fn(values);return () => subscribers.delete(fn); },
    set(key, value, immediate) { values[key] = value;writes.push({ key, value, immediate });for (const fn of subscribers) fn(values); } };
  const optionalApi = create({ document: optional.doc, window: optional.win, store, enabled: false });await settle();
  assert.equal(optional.root.hasAttribute('data-liquid-sidebar'), false);assert.equal(optional.calls(), 0);
  assert.equal(optional.timers.size, 0);assert.equal(optional.observers.filter(observer => observer.target).length, 1, 'off keeps only the independent layout observer');
  store.set('sidebarEnabled', true, true);await settle();optional.advance(120);await settle();optional.replaceRows('/opt-in-related');optional.mutate();await settle();
  assert.equal(state(optional), 'ready');assert.equal(optional.root.getAttribute('data-liquid-sidebar'), 'related');
  const optionalTabs = optional.root.querySelectorAll('button[role="tab"]').filter(tab => !optional.related.contains(tab));
  const providedTab = optionalTabs.find(tab => tab.textContent.startsWith('提供:'));
  providedTab.click();optional.advance(120);await settle();
  assert.equal(optional.provided.getAttribute('aria-selected'), 'true');assert.equal(values.sidebarFilter, 'channel');
  assert.equal(writes.at(-1).immediate, true);optional.replaceRows('/first-channel');optional.mutate();await settle();assert.equal(state(optional), 'ready');
  // Follow a reused Provided chip's new label without saving a channel name.
  optional.doc.dispatch('yt-navigate-start');optional.win.location = new URL('https://www.youtube.com/watch?v=second');
  optional.watch.setAttribute('video-id', 'second');optional.provided.textContent = '提供: Second channel';optional.all.click();
  optional.doc.dispatch('yt-navigate-finish');await settle();optional.advance(120);await settle();
  optional.replaceRows('/second-channel');optional.mutate();await settle();assert.equal(state(optional), 'ready');
  assert.equal(providedTab.title, '提供: Second channel');assert.equal(values.sidebarFilter, 'channel');
  optionalTabs[1].click();optional.advance(120);await settle();optional.replaceRows('/all');optional.mutate();await settle();
  assert.equal(state(optional), 'ready');assert.equal(values.sidebarFilter, 'all');
  optionalTabs[0].click();optional.mix.setAttribute('hidden', '');optional.mutate();await settle();
  assert.equal(optional.root.getAttribute('data-liquid-sidebar'), 'all', 'an absent Mix returns to the chosen filter');
  store.set('sidebarEnabled', false, true);await settle();
  assert.equal(optional.root.hasAttribute('data-liquid-sidebar'), false);assert.equal(optional.all.getAttribute('aria-selected'), 'true');
  assert.equal(optional.observers.filter(observer => observer.target).length, 1);assert.equal(optional.timers.size, 0);
  store.set('sidebarFilter', 'channel', true);store.set('sidebarEnabled', true, true);await settle();optional.advance(120);await settle();
  optional.replaceRows('/enabled-again');optional.mutate();await settle();assert.equal(optional.root.getAttribute('data-liquid-sidebar'), 'channel');
  store.set('sidebarEnabled', false, true);await settle();assert.equal(optional.all.getAttribute('aria-selected'), 'true', 'off restores the original native tag');
  optionalApi.dispose();assert.equal(subscribers.size, 0);

  const sameFirst = fixture();const second = element('yt-lockup-view-model'), secondLink = element('a');secondLink.setAttribute('href', '/old-second');second.append(secondLink);sameFirst.related.append(second);
  const sameFirstApi = create({ document: sameFirst.doc, window: sameFirst.win });await settle();sameFirst.advance(120);await settle();
  secondLink.setAttribute('href', '/filtered-second');sameFirst.mutate(secondLink, 'attributes', 'href');await settle();
  assert.equal(state(sameFirst), 'ready', 'a response can retain the same first recommendation');sameFirstApi.dispose();
  const failedRestore = fixture();let restoreFails = false;
  const failedRestoreApi = create({ document: failedRestore.doc, window: failedRestore.win, selectFilter(button) { if (restoreFails) throw new Error('native handler unavailable');button.click(); } });
  await settle();failedRestore.advance(120);await settle();failedRestore.replaceRows('/filtered');failedRestore.mutate();await settle();restoreFails = true;
  assert.doesNotThrow(() => failedRestoreApi.setEnabled(false), 'a throwing native restore handler must not break disabling the feature');
  assert.equal(failedRestore.root.hasAttribute('data-liquid-sidebar'), false);assert.equal(failedRestore.timers.size, 0);failedRestoreApi.dispose();
  const originalChannel = fixture();originalChannel.provided.click();
  const originalChannelApi = create({ document: originalChannel.doc, window: originalChannel.win });await settle();originalChannel.advance(120);await settle();originalChannel.replaceRows('/related');originalChannel.mutate();await settle();
  originalChannel.provided.textContent = '提供: Changed channel';originalChannelApi.setEnabled(false);
  assert.equal(originalChannel.provided.getAttribute('aria-selected'), 'true', 'off restores the original tag type even after its channel label changes');originalChannelApi.dispose();
  const dynamic = fixture(), dynamicWrites = [], dynamicValues = { sidebarEnabled: true, sidebarFilter: 'all' };
  const extraChip = element('button');extraChip.setAttribute('role', 'tab');extraChip.textContent = '音楽';dynamic.chips.append(extraChip);
  extraChip.addEventListener('click', () => { for (const chip of dynamic.chips.children) chip.setAttribute('aria-selected', String(chip === extraChip)); });
  const dynamicApi = create({ document: dynamic.doc, window: dynamic.win, store: {
    subscribe(fn) { fn(dynamicValues);return () => {}; }, set(key, value) { dynamicWrites.push({ key, value }); }
  } });await settle();
  const customTab = dynamic.root.querySelector('.liquid-sidebar-tabs').children.find(tab => tab.textContent === '音楽');assert.ok(customTab, 'video-specific native tags are available');
  customTab.click();dynamic.advance(120);await settle();assert.equal(extraChip.getAttribute('aria-selected'), 'true');assert.equal(state(dynamic), 'loading');
  dynamic.replaceRows('/music-response');dynamic.mutate();await settle();assert.equal(state(dynamic), 'ready');assert.equal(customTab.getAttribute('aria-selected'), 'true');
  assert.deepEqual(dynamicWrites, [], 'video-specific tag names are not stored as a global filter preference');
  dynamic.doc.activeElement = customTab;extraChip.textContent = 'ライブ';dynamic.mutate();await settle();assert.ok(!customTab.parent, 'obsolete tags and their handlers are removed');
  assert.equal(dynamic.root.getAttribute('data-liquid-sidebar'), 'all', 'a disappearing video-specific tag returns to the saved filter');
  assert.equal(customTab.events.get('click').size, 0);assert.equal(customTab.events.get('keydown').size, 0);
  assert.equal(dynamic.root.querySelector('.liquid-sidebar-tabs').children.find(tab => tab.textContent === 'すべて').focused, true, 'restore keyboard focus when the active native tag disappears');
  dynamic.advance(120);await settle();assert.equal(dynamic.all.getAttribute('aria-selected'), 'true');
  dynamic.replaceRows('/renamed-tag-default');dynamic.mutate();await settle();assert.equal(state(dynamic), 'ready');assert.deepEqual(dynamicWrites, []);
  dynamic.doc.dispatch('yt-navigate-start');dynamic.win.location = new URL('https://www.youtube.com/watch?v=next');dynamic.watch.setAttribute('video-id', 'next');dynamic.doc.dispatch('yt-navigate-finish');await settle();dynamic.advance(120);await settle();
  dynamic.replaceRows('/next-default');dynamic.mutate();await settle();assert.equal(dynamic.root.getAttribute('data-liquid-sidebar'), 'all', 'navigation restores the saved default instead of looking for another video\'s tag');
  assert.equal(dynamic.all.getAttribute('aria-selected'), 'true');dynamicApi.dispose();assert.equal(dynamic.timers.size, 0);
  // Reuse the native menu handler without activating the card's navigation.
  const menuRoot = element('section'), menuWin = { innerWidth: 800, innerHeight: 600 };
  function menuRow(tag, parent = menuRoot) {
    const row = element(tag), anchor = element('div'), native = element('button');anchor.setAttribute('id', tag.startsWith('ytd-comment') ? 'action-menu' : 'menu');anchor.append(native);row.append(anchor);parent.append(row);
    let clicks = 0;native.addEventListener('click', () => clicks++);return { row, anchor, native, clicks: () => clicks };
  }
  const videoMenu = menuRow('yt-lockup-view-model'), commentMenu = menuRow('ytd-comment-view-model');
  const replies = element('ytd-comment-replies-renderer');menuRoot.append(replies);const replyMenu = menuRow('ytd-comment-view-model', replies);
  const cardMenus = createCardMenus({ root: menuRoot, window: menuWin, observe: false });
  assert.ok(videoMenu.anchor.hasAttribute('data-liquid-card-menu-trigger'));assert.equal(commentMenu.anchor.hasAttribute('data-liquid-card-menu-trigger'), false);
  let prevented = 0, stopped = 0;
  const event = target => ({ target, clientX: 790, clientY: 590, preventDefault() { prevented++; }, stopPropagation() { stopped++; } });
  menuRoot.dispatch('contextmenu', event(commentMenu.row));assert.equal(commentMenu.clicks(), 0, 'video scope does not handle comments');
  videoMenu.anchor.style.setProperty('--liquid-context-x', '4px', 'important');
  menuRoot.dispatch('contextmenu', event(videoMenu.row));assert.equal(videoMenu.clicks(), 1);assert.equal(prevented, 1);assert.equal(stopped, 1);
  assert.equal(videoMenu.anchor.style.getPropertyValue('--liquid-context-x'), '760px');assert.equal(videoMenu.anchor.style.getPropertyValue('--liquid-context-y'), '560px', 'clamp the invisible popup anchor to the viewport');
  cardMenus.setScopes({ videos: true, comments: true });menuRoot.dispatch('contextmenu', event(commentMenu.row));assert.equal(commentMenu.clicks(), 1);
  assert.equal(videoMenu.anchor.style.getPropertyValue('--liquid-context-x'), '4px');assert.equal(videoMenu.anchor.style.getPropertyPriority('--liquid-context-x'), 'important', 'restore an existing inline property');
  menuRoot.dispatch('contextmenu', event(replyMenu.row));assert.equal(replyMenu.clicks(), 0, 'parent comments and replies have independent scope');
  cardMenus.setScopes({ comments: true, replies: true });
  menuRoot.dispatch('contextmenu', event(replyMenu.row));assert.equal(replyMenu.clicks(), 1, 'approved comment scope includes replies');
  menuRoot.dispatch('contextmenu', event(commentMenu.row));assert.equal(commentMenu.clicks(), 2, 'parent comments remain enabled with replies');
  cardMenus.setScopes({ replies: true });assert.equal(commentMenu.anchor.hasAttribute('data-liquid-card-menu-trigger'), false);
  menuRoot.dispatch('keydown', { ...event(replyMenu.row), key: 'F10', shiftKey: true });assert.equal(replyMenu.clicks(), 2);assert.equal(replyMenu.anchor.style.getPropertyValue('--liquid-context-x'), '260px');
  replyMenu.native.disabled = true;menuRoot.dispatch('contextmenu', event(replyMenu.row));assert.equal(replyMenu.clicks(), 2, 'disabled menus preserve browser behavior');
  cardMenus.dispose();assert.equal(replyMenu.anchor.hasAttribute('data-liquid-card-menu-trigger'), false);assert.equal(replyMenu.anchor.hasAttribute('data-liquid-context-menu-anchor'), false);
  assert.equal(menuRoot.events.get('contextmenu').size, 0);assert.equal(menuRoot.events.get('keydown').size, 0);
  const appearance = fixture();appearance.doc.baseURI = 'https://www.youtube.com/watch?v=first';
  const hoverRow = element('ytd-comment-view-model'), avatar = element('img', 'img');avatar.setAttribute('src', 'https://yt3.ggpht.com/first=s88');hoverRow.append(avatar);appearance.watch.append(hoverRow);
  hoverRow.style.setProperty('--liquid-comment-avatar', 'none', 'important');
  const hover = createCommentHover({ document: appearance.doc, window: appearance.win, observe: false });
  assert.ok(hoverRow.hasAttribute('data-liquid-comment-hover'));assert.ok(hoverRow.style.getPropertyValue('--liquid-comment-avatar').includes('first=s88'));
  assert.deepEqual(hoverRow.children, [avatar], 'comment hover does not move or wrap native content');
  avatar.currentSrc = 'https://yt3.ggpht.com/first=s88';avatar.setAttribute('src', 'https://yt3.ggpht.com/second=s88');hover.refresh();
  avatar.currentSrc = 'https://yt3.ggpht.com/second=s88';appearance.doc.dispatch('load', { target: avatar });
  assert.ok(hoverRow.style.getPropertyValue('--liquid-comment-avatar').includes('second=s88'), 'follow a reused comment avatar after the decoded image loads');avatar.currentSrc = '';
  avatar.setAttribute('src', 'javascript:alert(1)');hover.refresh();assert.equal(hoverRow.hasAttribute('data-liquid-comment-hover'), false);
  assert.equal(hoverRow.style.getPropertyValue('--liquid-comment-avatar'), 'none');assert.equal(hoverRow.style.getPropertyPriority('--liquid-comment-avatar'), 'important');
  avatar.setAttribute('src', 'https://yt3.ggpht.com/third=s88');hover.refresh();hoverRow.remove();hover.refresh();assert.equal(hoverRow.hasAttribute('data-liquid-comment-hover'), false);hover.dispose();assert.equal(appearance.doc.events.get('load').size, 0);
  const fade = createHeaderFade({ document: appearance.doc, window: appearance.win });
  assert.ok(appearance.doc.documentElement.hasAttribute('data-liquid-header'));assert.equal(appearance.doc.documentElement.hasAttribute('data-liquid-header-scrolled'), false);
  appearance.win.scrollY = 1;appearance.win.dispatch('scroll');assert.ok(appearance.doc.documentElement.hasAttribute('data-liquid-header-scrolled'), 'one pixel of scroll enables the header effect');
  appearance.win.scrollY = 0;appearance.doc.dispatch('yt-navigate-finish');assert.equal(appearance.doc.documentElement.hasAttribute('data-liquid-header-scrolled'), false, 'returning to the top clears the effect');
  fade.dispose();assert.equal(appearance.doc.documentElement.hasAttribute('data-liquid-header'), false);assert.equal(appearance.win.events.get('scroll').size, 0);
  const wide = fixture();let available = 1000, chatWidth = 400;
  wide.watch.setAttribute('is-two-columns_', '');
  const content = element('div', 'columns'), primary = element('div', 'primary');wide.watch.append(content);content.append(primary, wide.root);
  content.getBoundingClientRect = () => ({ left: 100, width: 1200 + available + 24 });primary.getBoundingClientRect = () => ({ width: 1200 });
  const chatContainer = element('div', 'chat-container'), chat = element('ytd-live-chat-frame');chatContainer.append(chat);wide.inner.insertBefore(chatContainer, wide.mix);
  chat.getBoundingClientRect = () => ({ width: chatWidth });wide.win.getComputedStyle = node => ({ display: node.hasAttribute('hidden') ? 'none' : 'block' });
  const nativeOrder = [...wide.inner.children], wideApi = create({ document: wide.doc, window: wide.win });
  assert.equal(wide.root.hasAttribute('data-liquid-parallel'), false, 'parallel layout is opt-in');
  assert.ok(chatContainer.hasAttribute('data-liquid-left-overlay'), 'chat stays on the left when simultaneous columns are disabled');
  assert.ok(leftLayerActive(wide.root), 'chat alone enables the ancestor stacking correction');
  assert.equal(wide.root.style.getPropertyValue('--liquid-chat-left'), '12px');
  wideApi.setParallel(true);assert.ok(wide.root.hasAttribute('data-liquid-parallel'));
  assert.ok(chatContainer.hasAttribute('data-liquid-chat-column'));assert.ok(wide.related.hasAttribute('data-liquid-list-column'));
  assert.deepEqual(wide.inner.children.filter(node => node.className !== 'liquid-watch-sidebar'), nativeOrder, 'all native nodes retain their order and parents');
  assert.ok(content.hasAttribute('data-liquid-wide-columns'));assert.equal(content.style.getPropertyValue('--liquid-wide-side'), '500px');
  assert.equal(wide.root.style.getPropertyValue('--liquid-chat-left'), '100px', 'chat is aligned to the reserved left column');
  available = 719;wide.resizers.at(-1).callback();await settle();assert.equal(wide.root.hasAttribute('data-liquid-parallel'), false);
  assert.ok(chatContainer.hasAttribute('data-liquid-left-overlay'), 'a narrow viewport keeps chat out of the right list');
  available = 720;wide.win.dispatch('resize');await settle();assert.ok(wide.root.hasAttribute('data-liquid-parallel'), 'use actual CSS pixels at the boundary');
  chatWidth = 0;wide.resizers.at(-1).callback();await settle();assert.equal(wide.root.hasAttribute('data-liquid-parallel'), false, 'never force a closed chat open');
  assert.equal(chatContainer.hasAttribute('data-liquid-left-overlay'), false);
  assert.equal(leftLayerActive(wide.root), false, 'a closed chat restores the original sidebar stacking');
  chatWidth = 400;wide.win.dispatch('resize');await settle();assert.ok(wide.root.hasAttribute('data-liquid-parallel'));
  chatContainer.remove();wide.mutate(wide.inner, 'childList', null, { removedNodes: [chatContainer] });await settle();
  assert.equal(wide.root.hasAttribute('data-liquid-parallel'), false, 'removing the chat clears the expanded layout without waiting for a resize');
  wide.inner.insertBefore(chatContainer, wide.mix);wide.mutate(wide.inner, 'childList', null, { addedNodes: [chatContainer] });await settle();
  assert.ok(wide.root.hasAttribute('data-liquid-parallel'), 'restoring a chat inside a wrapper restores the layout');
  wideApi.setParallel(false);assert.equal(wide.root.hasAttribute('data-liquid-parallel'), false);assert.deepEqual(wide.inner.children, nativeOrder);
  assert.ok(chatContainer.hasAttribute('data-liquid-left-overlay'), 'turning simultaneous columns off returns to the left overlay');
  assert.equal(content.hasAttribute('data-liquid-wide-columns'), false);assert.equal(content.style.getPropertyValue('--liquid-wide-side'), '');
  wideApi.setParallel(true);wide.watch.setAttribute('theater', '');wideApi.refresh();await settle();assert.equal(wide.root.hasAttribute('data-liquid-parallel'), false, 'theater mode retains its native layout');
  assert.ok(chatContainer.hasAttribute('data-liquid-left-overlay'), 'theater chat also remains on the left');
  wide.watch.removeAttribute('theater');wideApi.refresh();await settle();assert.ok(wide.root.hasAttribute('data-liquid-parallel'));
  wide.doc.fullscreenElement = wide.watch;wide.doc.dispatch('fullscreenchange');await settle();assert.equal(wide.root.hasAttribute('data-liquid-parallel'), false);
  assert.equal(chatContainer.hasAttribute('data-liquid-left-overlay'), false, 'native fullscreen releases auxiliary positioning');
  assert.equal(leftLayerActive(wide.root), false, 'fullscreen also releases the ancestor stacking correction');
  wide.doc.fullscreenElement = null;wide.doc.dispatch('fullscreenchange');await settle();assert.ok(wide.root.hasAttribute('data-liquid-parallel'));
  wideApi.setParallel(true);wideApi.setEnabled(false);assert.ok(wide.root.hasAttribute('data-liquid-parallel'), 'ultrawide works with the original YouTube tags and list');
  assert.ok(!wide.root.hasAttribute('data-liquid-sidebar'));assert.ok(wide.root.hasAttribute('data-liquid-scroll-column'));
  wideApi.dispose();assert.equal(wide.root.hasAttribute('data-liquid-parallel'), false);
  assert.ok(wide.resizers.every(observer => !observer.targets.size));assert.equal(wide.win.events.get('resize').size, 0);
  const auxiliary = fixture(), auxiliaryColumns = element('div', 'columns'), auxiliaryPrimary = element('div', 'primary');
  auxiliary.watch.setAttribute('is-two-columns_', '');auxiliary.watch.append(auxiliaryColumns);auxiliaryColumns.append(auxiliaryPrimary, auxiliary.root);
  let auxiliaryAvailable = 900;auxiliaryColumns.getBoundingClientRect = () => ({ left: 20, width: 1224 + auxiliaryAvailable });auxiliaryPrimary.getBoundingClientRect = () => ({ width: 1200 });
  const panelContainer = element('div', 'panels'), gemini = element('ytd-engagement-panel-section-list-renderer'), transcript = element('ytd-engagement-panel-section-list-renderer');
  gemini.setAttribute('target-id', 'PAyouchat');gemini.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');transcript.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN');
  panelContainer.append(gemini, transcript);auxiliary.inner.append(panelContainer);
  const auxiliaryChatColumn = element('div'), auxiliaryChat = element('ytd-live-chat-frame');auxiliaryChatColumn.append(auxiliaryChat);auxiliary.inner.append(auxiliaryChatColumn);auxiliaryChat.getBoundingClientRect = () => ({ width: 350 });
  const auxiliaryOrder = [...auxiliary.inner.children], auxiliaryLayout = createScrollLayout({ document: auxiliary.doc, window: auxiliary.win });
  assert.ok(panelContainer.hasAttribute('data-liquid-left-panels'), 'Gemini uses the left side even with ultrawide disabled');
  assert.ok(auxiliaryColumns.hasAttribute('data-liquid-wide-columns'));assert.ok(auxiliary.related.hasAttribute('data-liquid-list-column'), 'reserve the right side for the list');
  assert.equal(auxiliaryChatColumn.hasAttribute('data-liquid-left-hidden'), true, 'chat and auxiliary content do not overlap');
  let auxiliaryTabs = auxiliary.root.querySelector('.liquid-left-panel-tabs');assert.equal(auxiliaryTabs.children[1].textContent, 'Gemini');
  auxiliaryTabs.children[0].click();assert.equal(panelContainer.hasAttribute('data-liquid-left-hidden'), true);assert.equal(auxiliaryChatColumn.hasAttribute('data-liquid-left-hidden'), false);
  auxiliaryTabs.children[0].dispatch('keydown', { key: 'ArrowRight', preventDefault() {} });assert.equal(panelContainer.hasAttribute('data-liquid-left-hidden'), false);
  assert.deepEqual(auxiliary.inner.children, auxiliaryOrder, 'left panels retain all native parents and order');
  auxiliaryAvailable = 400;auxiliary.win.dispatch('resize');await settle();
  assert.equal(auxiliaryColumns.hasAttribute('data-liquid-wide-columns'), false, 'narrow layouts preserve native video width');
  assert.ok(panelContainer.hasAttribute('data-liquid-left-panels'));assert.equal(auxiliary.root.style.getPropertyValue('--liquid-chat-left'), '12px', 'narrow panels use a left overlay');
  assert.ok(leftLayerActive(auxiliary.root), 'a narrow Gemini overlay enables the ancestor stacking correction');
  assert.ok(auxiliaryChatColumn.hasAttribute('data-liquid-left-overlay'));
  auxiliary.watch.setAttribute('theater', '');auxiliaryLayout.refresh();const stableAuxTabs = auxiliaryTabs;
  auxiliaryLayout.refresh();assert.equal(auxiliary.root.querySelector('.liquid-left-panel-tabs'), stableAuxTabs, 'theater refresh retains the left switcher without remove/reinsert loops');
  auxiliary.doc.fullscreenElement = auxiliary.watch;auxiliary.doc.dispatch('fullscreenchange');await settle();
  assert.equal(panelContainer.hasAttribute('data-liquid-left-panels'), false);assert.equal(auxiliaryTabs.isConnected, false);
  auxiliary.doc.fullscreenElement = null;auxiliary.doc.dispatch('fullscreenchange');await settle();assert.ok(panelContainer.hasAttribute('data-liquid-left-panels'));
  gemini.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN');transcript.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
  auxiliary.mutate(transcript, 'attributes', 'visibility');await settle();assert.ok(panelContainer.hasAttribute('data-liquid-left-panels'), 'other expanded non-list panels use the same left slot');
  transcript.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN');auxiliary.mutate(transcript, 'attributes', 'visibility');await settle();
  assert.equal(panelContainer.hasAttribute('data-liquid-left-panels'), false);assert.equal(auxiliary.root.querySelector('.liquid-left-panel-tabs'), null);
  assert.ok(auxiliaryChatColumn.hasAttribute('data-liquid-chat-column'), 'closing auxiliary content leaves chat on the left');
  assert.ok(auxiliaryChatColumn.hasAttribute('data-liquid-left-overlay'), 'chat alone uses an overlay while simultaneous columns are disabled');
  auxiliaryLayout.dispose();assert.deepEqual(auxiliary.inner.children, auxiliaryOrder);assert.equal(auxiliary.root.style.getPropertyValue('--liquid-wide-side'), '');
  assert.equal(leftLayerActive(auxiliary.root), false, 'disposing left panels restores the original ancestor stacking');
  const scroll = fixture(), scrollColumns = element('div', 'columns'), scrollPrimary = element('div', 'primary');
  scroll.watch.setAttribute('is-two-columns_', '');scroll.watch.append(scrollColumns);scrollColumns.append(scrollPrimary, scroll.root);
  scrollColumns.getBoundingClientRect = () => ({ left: 20, width: 2200 });scrollPrimary.getBoundingClientRect = () => ({ width: 1200 });
  const scrollPanels = element('div', 'panels'), scrollPanel = element('ytd-engagement-panel-section-list-renderer'), panelContent = element('div', 'content');
  scrollPanel.setAttribute('target-id', 'PAyouchat');scrollPanel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
  scrollPanel.append(panelContent);scrollPanels.append(scrollPanel);scroll.inner.append(scrollPanels);
  const scrollChat = element('ytd-live-chat-frame'), scrollFrame = element('iframe'), playlistItems = element('div', 'items');
  scrollChat.getBoundingClientRect = () => ({ width: 350 });scrollChat.append(scrollFrame);scroll.inner.append(scrollChat);scroll.mix.append(playlistItems);
  const chatScrollDocument = (top = 0, { pathname = '/live_chat_replay', tag = 'div', id = 'item-scroller' } = {}) => {
    const doc = element('document');doc.documentElement = element('html');doc.head = element('head');doc.append(doc.documentElement);doc.documentElement.append(doc.head);
    const scroller = element(tag, id);scroller.scrollTop = top;doc.documentElement.append(scroller);
    doc.location = { pathname };doc.createElement = tag => element(tag);return { doc, scroller };
  };
  const firstChatScroll = chatScrollDocument();scrollFrame.contentDocument = firstChatScroll.doc;
  scroll.root.scrollTop = panelContent.scrollTop = playlistItems.scrollTop = 0;scroll.root.setAttribute('data-liquid-sidebar', 'related');
  const scrollLayout = createScrollLayout({ document: scroll.doc, window: scroll.win });
  const listShaded = () => scroll.root.hasAttribute('data-liquid-list-scrolled'), leftShaded = () => scroll.root.hasAttribute('data-liquid-left-scrolled');
  assert.equal(listShaded(), false);assert.equal(leftShaded(), false, 'both headers begin transparent');
  scroll.chips.scrollLeft = 240;scroll.root.dispatch('scroll', { target: scroll.chips });await settle();
  assert.equal(listShaded(), false, 'horizontal native tags never enable the vertical list shade');
  const horizontalTabs = element('div');horizontalTabs.className = 'liquid-sidebar-tabs';horizontalTabs.scrollLeft = 160;scroll.root.append(horizontalTabs);
  scroll.root.dispatch('scroll', { target: horizontalTabs });await settle();assert.equal(listShaded(), false, 'horizontal authored tabs also leave the list header transparent');
  scroll.root.scrollTop = 1;scroll.root.dispatch('scroll', { target: scroll.root });await settle();
  assert.ok(listShaded(), 'one pixel of list scrolling enables its header shade');assert.equal(leftShaded(), false, 'right scrolling does not shade the left header');
  scroll.root.scrollTop = 0;scroll.root.dispatch('scroll', { target: scroll.root });await settle();assert.equal(listShaded(), false, 'returning the list to the top removes the shade');
  scroll.root.setAttribute('data-liquid-sidebar', 'playlist');playlistItems.scrollTop = 18;scroll.mutate(scroll.root, 'attributes', 'data-liquid-sidebar');await settle();
  assert.ok(listShaded(), 'the visible playlist has its own vertical scroller');
  playlistItems.scrollTop = 0;scroll.root.dispatch('scroll', { target: playlistItems });await settle();assert.equal(listShaded(), false);
  playlistItems.removeAttribute('id');playlistItems.className = 'playlist-items';playlistItems.scrollTop = 11;scroll.root.dispatch('scroll', { target: playlistItems });await settle();
  assert.ok(listShaded(), 'the alternate native playlist-items scroller is handled too');
  playlistItems.scrollTop = 18;scroll.root.setAttribute('data-liquid-sidebar', 'related');scroll.mutate(scroll.root, 'attributes', 'data-liquid-sidebar');await settle();
  assert.equal(listShaded(), false, 'a hidden playlist cannot keep the visible related header shaded');
  panelContent.scrollTop = 1;scroll.root.dispatch('scroll', { target: panelContent });await settle();
  assert.ok(leftShaded(), 'the selected Gemini content shades its own header');assert.equal(listShaded(), false, 'left content does not shade the right header');
  panelContent.scrollTop = 0;scroll.root.dispatch('scroll', { target: panelContent });await settle();assert.equal(leftShaded(), false);
  firstChatScroll.scroller.scrollTop = 20;firstChatScroll.doc.dispatch('scroll', { target: firstChatScroll.scroller });await settle();
  assert.equal(leftShaded(), false, 'an unselected chat cannot shade the visible Gemini header');
  const scrollTabs = scroll.root.querySelector('.liquid-left-panel-tabs');scrollTabs.children[0].click();
  assert.ok(leftShaded(), 'choosing chat reflects its already scrolled content');
  scroll.root.scrollTop = 8;scroll.root.dispatch('scroll', { target: scroll.root });await settle();assert.ok(listShaded());assert.ok(leftShaded());
  scroll.root.scrollTop = 0;scroll.root.dispatch('scroll', { target: scroll.root });await settle();assert.equal(listShaded(), false);assert.ok(leftShaded());
  firstChatScroll.scroller.scrollTop = 0;panelContent.scrollTop = 40;firstChatScroll.doc.dispatch('scroll', { target: firstChatScroll.scroller });await settle();
  assert.equal(leftShaded(), false, 'chat returning to the top ignores the hidden panel position');
  const nextChatScroll = chatScrollDocument(7);scrollFrame.contentDocument = nextChatScroll.doc;scrollFrame.dispatch('load');await settle();
  assert.ok(leftShaded(), 'iframe replacement uses the newly loaded chat position');assert.equal(firstChatScroll.doc.events.get('scroll')?.size || 0, 0, 'old iframe scroll listeners are removed');
  nextChatScroll.scroller.scrollTop = 0;nextChatScroll.doc.dispatch('scroll', { target: nextChatScroll.scroller });await settle();assert.equal(leftShaded(), false);
  firstChatScroll.scroller.scrollTop = 40;firstChatScroll.doc.dispatch('scroll', { target: firstChatScroll.scroller });await settle();assert.equal(leftShaded(), false, 'events from the detached chat document cannot change the new state');
  scroll.root.scrollTop = 5;nextChatScroll.scroller.scrollTop = 5;scroll.root.dispatch('scroll', { target: scroll.root });await settle();assert.ok(listShaded());assert.ok(leftShaded());
  const replacedScrollRoot = fixture({ playlist: false }).root;scroll.root.remove();scrollColumns.append(replacedScrollRoot);scrollLayout.refresh();
  assert.equal(listShaded(), false);assert.equal(leftShaded(), false, 'replacing the sidebar clears both flags on the detached root');
  assert.equal(scroll.root.events.get('scroll')?.size || 0, 0);assert.equal(nextChatScroll.doc.events.get('scroll')?.size || 0, 0, 'iframe listeners leave with their old sidebar');
  assert.equal(replacedScrollRoot.hasAttribute('data-liquid-list-scrolled'), false);assert.equal(replacedScrollRoot.hasAttribute('data-liquid-left-scrolled'), false);
  replacedScrollRoot.scrollTop = 9;replacedScrollRoot.dispatch('scroll', { target: replacedScrollRoot });await settle();assert.ok(replacedScrollRoot.hasAttribute('data-liquid-list-scrolled'), 'the replacement root has its own scroll listener');
  scrollLayout.dispose();assert.equal(replacedScrollRoot.hasAttribute('data-liquid-list-scrolled'), false);assert.equal(replacedScrollRoot.hasAttribute('data-liquid-left-scrolled'), false);
  assert.equal(replacedScrollRoot.events.get('scroll')?.size || 0, 0, 'disposal releases the captured scroll listener');
  replacedScrollRoot.dispatch('scroll', { target: replacedScrollRoot });await settle();assert.equal(replacedScrollRoot.hasAttribute('data-liquid-list-scrolled'), false, 'late scroll events cannot restore disposed state');
  const stageScroll = fixture({ playlist: false }), stageChatFrame = element('iframe'), stageChatHost = element('ytd-live-chat-frame');
  const stageChatScroll = chatScrollDocument(0, { pathname: '/chat-demo', tag: 'main', id: null });
  stageChatFrame.contentDocument = stageChatScroll.doc;stageChatHost.getBoundingClientRect = () => ({ width: 350 });stageChatHost.append(stageChatFrame);stageScroll.inner.append(stageChatHost);
  const stageScrollLayout = createScrollLayout({ document: stageScroll.doc, window: stageScroll.win, stage: true });
  stageChatScroll.scroller.scrollTop = 13;stageChatScroll.doc.dispatch('scroll', { target: stageChatScroll.scroller });await settle();
  assert.ok(stageScroll.root.hasAttribute('data-liquid-left-scrolled'), 'the design-stage main scroller follows the same left header rule');
  assert.equal(stageScroll.root.hasAttribute('data-liquid-list-scrolled'), false);
  stageChatScroll.scroller.scrollTop = 0;stageChatScroll.doc.dispatch('scroll', { target: stageChatScroll.scroller });await settle();assert.equal(stageScroll.root.hasAttribute('data-liquid-left-scrolled'), false);
  stageScrollLayout.dispose();assert.equal(stageChatScroll.doc.events.get('scroll')?.size || 0, 0, 'the design-stage iframe listener is also released');
  const normal = fixture(), normalColumns = element('div', 'columns'), normalPrimary = element('div', 'primary');
  normal.watch.setAttribute('is-two-columns_', '');normal.watch.append(normalColumns);normalColumns.append(normalPrimary, normal.root);
  const normalChat = element('ytd-live-chat-frame'), frame = element('iframe');normalChat.append(frame);normal.inner.append(normalChat);
  const chatDocument = element('document');chatDocument.documentElement = element('html');chatDocument.head = element('head');chatDocument.append(chatDocument.documentElement);chatDocument.documentElement.append(chatDocument.head);
  chatDocument.location = { pathname: '/live_chat_replay' };chatDocument.createElement = tag => element(tag);frame.contentDocument = chatDocument;
  const hiddenValues = { hideMainScrollbar: true, hideChatScrollbar: true, hideListScrollbar: true }, hiddenSubscribers = new Set();
  const hiddenStore = { subscribe(fn) { hiddenSubscribers.add(fn);fn(hiddenValues);return () => hiddenSubscribers.delete(fn); },
    set(key, value) { hiddenValues[key] = value;for (const fn of hiddenSubscribers) fn(hiddenValues); } };
  const layout = createScrollLayout({ document: normal.doc, window: normal.win, store: hiddenStore });await settle();
  assert.ok(normal.root.hasAttribute('data-liquid-scroll-column'), 'normal native lists get their own scrolling column');
  assert.equal(normal.root.getAttribute('tabindex'), '0', 'the scrolling column supports keyboard focus');
  assert.ok(normal.doc.documentElement.hasAttribute('data-liquid-hide-main-scrollbar'));
  assert.ok(chatDocument.documentElement.hasAttribute('data-liquid-hide-chat-scrollbar'));
  assert.ok(normal.root.hasAttribute('data-liquid-hide-list-scrollbar'));
  hiddenStore.set('hideMainScrollbar', false);await settle();assert.equal(normal.doc.documentElement.hasAttribute('data-liquid-hide-main-scrollbar'), false);
  assert.ok(chatDocument.documentElement.hasAttribute('data-liquid-hide-chat-scrollbar'));assert.ok(normal.root.hasAttribute('data-liquid-hide-list-scrollbar'));
  hiddenStore.set('hideChatScrollbar', false);await settle();assert.equal(chatDocument.documentElement.hasAttribute('data-liquid-hide-chat-scrollbar'), false);
  hiddenStore.set('hideListScrollbar', false);await settle();assert.equal(normal.root.hasAttribute('data-liquid-hide-list-scrollbar'), false);
  assert.ok(normal.root.hasAttribute('data-liquid-scroll-column'), 'scrolling remains independent with every scrollbar visible');
  normal.watch.setAttribute('theater', '');layout.refresh();assert.equal(normal.root.hasAttribute('data-liquid-scroll-column'), false);
  normal.watch.removeAttribute('theater');layout.refresh();assert.ok(normal.root.hasAttribute('data-liquid-scroll-column'));
  const replacementChat = { ...chatDocument, location: { pathname: '/unrelated-page' } };frame.contentDocument = replacementChat;frame.dispatch('load');
  assert.equal(chatDocument.head.children.length, 0, 'only our chat stylesheet is removed on frame replacement');
  assert.equal(chatDocument.documentElement.hasAttribute('data-liquid-hide-chat-scrollbar'), false, 'unrelated frames are not styled');
  frame.contentDocument = chatDocument;frame.dispatch('load');assert.equal(chatDocument.head.children.length, 1);
  normal.win.location = new URL('https://www.youtube.com/');normal.doc.dispatch('yt-navigate-finish');await settle();
  assert.equal(normal.root.hasAttribute('data-liquid-scroll-column'), false);assert.equal(normal.root.getAttribute('tabindex'), null);
  assert.equal(chatDocument.head.children.length, 0);layout.dispose();assert.equal(hiddenSubscribers.size, 0);
  console.log('PASS sidebar: native filtering, special-tab order, ultrawide columns, comment/reply menus, avatar hover, scroll header and cleanup');
})().catch(error => { console.error(error);process.exitCode = 1; });
