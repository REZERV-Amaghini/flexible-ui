'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { harness } = require('./check-ambient.cjs');
const sites = require('../site-registry.js');

// The controller harness accepts any insertBefore reference. These fixtures
// enforce the real DOM contract that caught the nested native settings button.
function enforceNativeInsertBefore(container) {
 const insert = container.insertBefore;
 container.insertBefore = function(child, before) {
   if (before != null && before.parentElement !== this) {
     const error = new Error('The node before which the new node is to be inserted is not a child of this node.');
     error.name = 'NotFoundError';throw error;
   }
   return insert.call(this, child, before);
 };
 return container;
}

async function main() {
 const css = fs.readFileSync(path.join(__dirname, '..', 'ambient.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
 const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body,
   properties: Object.fromEntries([...body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)].map(([, key, value]) => [key, value.trim()])) }));
 const launcher = rules.find(rule => rule.selector === '#yac-launcher');
 assert.equal(launcher.properties.color, '#0f0f0f', 'light launcher ignores a stale white native text variable');
 const darkLauncher = rules.find(rule => rule.selector.includes('efyt-dark-theme') && rule.selector.endsWith(' #yac-launcher'));
 assert.ok(darkLauncher.selector.includes('[dark]'), 'native and Enhancer dark themes both select the readable dark launcher');
 assert.ok(darkLauncher.properties.color.includes('#f1f1f1'), 'dark launcher retains a light fallback');
 assert.equal(rules.find(rule => rule.selector === 'html[data-liquid-header-scrolled] #yac-launcher').properties.color, '#f1f1f4', 'a light theme with the scrolled dark header uses a light launcher');
 const accentRule = rules.find(rule => rule.properties['--main-text'] === 'var(--yac-accent-color) !important');
 assert.ok(accentRule, 'Enhancer Lottie paths using --main-text inherit the custom accent');
 const accentScope = harness(false), controls = accentScope.document.createElement('div');accentScope.watch.append(controls);
 const buttonIn = (tag, attrs = {}) => {
   const host = accentScope.document.createElement(tag), button = accentScope.document.createElement('button');
   for (const [key, value] of Object.entries(attrs)) (key === 'id' ? host : button).setAttribute(key, value);
   controls.append(host);host.append(button);return button;
 };
 const like = buttonIn('like-button-view-model'), legacyLike = buttonIn('ytd-toggle-button-renderer', { id: 'like-button' });
 const dislike = buttonIn('dislike-button-view-model'), disabledLike = buttonIn('like-button-view-model', { disabled: '' });
 const ariaDisabledLike = buttonIn('like-button-view-model', { 'aria-disabled': 'true' });
 assert.equal(like.matches(accentRule.selector), false, 'default colors remain outside the opt-in scope');
 accentScope.document.documentElement.classList.add('yac-custom-accent');
 for (const button of [like, legacyLike]) assert.ok(button.matches(accentRule.selector), 'current and legacy likes inherit the local Enhancer variable');
 for (const node of [dislike, disabledLike, ariaDisabledLike, controls, accentScope.watch]) assert.equal(node.matches(accentRule.selector), false, 'dislike, disabled buttons and unrelated surfaces retain their own colors');
 assert.equal(Object.keys(accentRule.properties).some(key => key.startsWith('background')), false, 'the accent never repaints the like button background');
 accentScope.event(accentScope.document, 'yac-dispose');
 console.log('PASS foreground scope: light/dark/scrolled launcher and local Enhancer like accent');
 const luminance = hex => [1, 3, 5].reduce((sum, index, component) => {
   const value = parseInt(hex.slice(index, index + 2), 16) / 255;
   return sum + [.2126, .7152, .0722][component] * (value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
 }, 0);
 const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
 const youtube = sites.identify('www.youtube.com');
 assert.equal(youtube.defaults.useCustomAccent, false, 'accent customization is opt-in');
 assert.equal(youtube.groups.find(group => group.id === 'accent').fields.find(field => field.key === 'accentColor').type, 'color');
 for (const site of [sites.identify('music.youtube.com'), sites.identify('x.com')]) assert.equal(Object.hasOwn(site.defaults, 'accentColor'), false, 'YouTube accents never leak into another site');
 for (const color of ['#ffffff', '#000000', '#ffff00', '#00ff00', '#0000ff', '#ff0088', '#0a84ff', '#ff9500', '#808080']) {
   const settings = Object.freeze({ accentColor: color }), palette = sites.accentPalette(settings);
   assert.equal(settings.accentColor, color, 'display correction preserves the selected color');
   assert.ok(contrast(palette['--yac-accent-light'], '#ffffff') >= 4.5, color + ': readable light foreground');
   assert.ok(contrast(palette['--yac-accent-dark'], '#0f0f0f') >= 4.5, color + ': readable dark foreground');
 }
 for (const workerMode of [false, true]) {
   let opened = 0, opener;
   const accent = harness(workerMode, { sharedSettings: true, quickPanelController: {
     openPlaybackPanel(button) { opened++;opener = button; }
   } });
   await accent.load({ enabled: false, flashWarning: false });
   assert.equal(accent.document.documentElement.classList.contains('yac-custom-accent'), false);
   const initialScans = accent.stats.surfaceScans, initialRenders = accent.renders.length, invalidates = accent.stats.rendererInvalidates;
   await accent.sharedStore.setMany({ useCustomAccent: true, accentColor: '#FFFF00' }, true);accent.flushTasks();
   assert.equal(accent.sharedStore.values.accentColor, '#ffff00');
   assert.equal(accent.document.documentElement.classList.contains('yac-custom-accent'), true, 'accent works with ambient disabled');
   const expected = sites.accentPalette({ accentColor: '#ffff00' });
   for (const [key, color] of Object.entries(expected)) assert.ok(accent.get('yac-surface-palette').textContent.includes(key + ':' + color));
   assert.equal(accent.stats.surfaceScans, initialScans, 'color edits do not scan page surfaces');
   assert.equal(accent.renders.length, initialRenders, 'color edits do not capture a video frame');
   assert.equal(accent.stats.rendererInvalidates, invalidates, 'color edits do not invalidate a Worker frame');
   await accent.sharedStore.set('useCustomAccent', false, true);accent.flushTasks();
   assert.equal(accent.document.documentElement.classList.contains('yac-custom-accent'), false);
   assert.equal(accent.get('yac-surface-palette').textContent.includes('--yac-accent-light:'), false, 'off removes accent declarations');
   const playbackButton = accent.get('yac-playback-button'), controls = accent.player.querySelector('.ytp-right-controls');
   assert.equal(playbackButton.parentElement, controls);assert.equal(playbackButton.getAttribute('aria-label'), '再生調整');
   accent.pressButton(playbackButton, 'Enter');accent.pressButton(playbackButton, ' ');
   assert.equal(opened, 2);assert.equal(opener, playbackButton);assert.equal(accent.video.playbackRate, undefined, 'the launcher never changes playback settings itself');
   playbackButton.remove();accent.flushMutations();assert.equal(playbackButton.parentElement, controls, 'repair a native controls redraw without another ambient frame');
   const replacement = accent.document.createElement('div');replacement.className = 'ytp-right-controls';controls.remove();accent.player.append(replacement);accent.discover();
   assert.equal(playbackButton.parentElement, replacement, 'follow replacement player controls');
   accent.document.fullscreenElement = accent.player;accent.event(accent.document, 'fullscreenchange');assert.equal(playbackButton.parentElement, replacement, 'keep the launcher in native fullscreen controls');
   accent.setPath('/');accent.event(accent.document, 'yt-navigate-finish');assert.equal(playbackButton.isConnected, false, 'leave non-watch pages unchanged');
   accent.setPath('/watch');accent.event(accent.document, 'yt-navigate-finish');assert.equal(playbackButton.parentElement, replacement);
   accent.event(accent.document, 'yac-dispose');assert.equal(playbackButton.isConnected, false);assert.ok(accent.observers.every(observer => !observer.target));
   accent.sharedStore.dispose();accent.playbackStore.dispose();
 }
 console.log('PASS accents: per-site opt-in, readable light/dark colors, no frame work, playback launcher and cleanup');

 for (const workerMode of [false, true]) for (const nestedSettings of [true, false]) {
   const startup = harness(workerMode, { sharedSettings: true, quickPanelController: { openPlaybackPanel() {} } });
   const controls = enforceNativeInsertBefore(startup.player.querySelector('.ytp-right-controls'));
   const gear = controls.querySelector('.ytp-settings-button'), playbackButton = startup.get('yac-playback-button');
   playbackButton.remove();gear.remove();
   const nativeWrapper = startup.document.createElement('div');nativeWrapper.className = 'ytp-right-controls-left';
   const innerWrapper = startup.document.createElement('span');nativeWrapper.append(innerWrapper);
   if (nestedSettings) {
     innerWrapper.append(gear);controls.append(nativeWrapper);
     const unattached = startup.document.createElement('button');
     assert.throws(() => controls.insertBefore(unattached, gear), { name: 'NotFoundError' }, 'the fixture rejects a nested descendant as insertBefore reference');
     assert.equal(unattached.parentElement, undefined, 'a rejected insertion never changes the candidate node');
   }
   await startup.load({ enabled: true, flashWarning: false });startup.tick();
   assert.ok(startup.document.documentElement.classList.contains('yac-active'), 'optional playback integration never blocks ambient activation');
   assert.ok(startup.renders.length, 'ambient renders after startup with nested or missing native controls');
   assert.equal(playbackButton.parentElement, controls);
   assert.equal(controls.children[0], playbackButton, 'insert before the direct native wrapper or append when no settings exists');
   if (nestedSettings) assert.equal(gear.parentElement, innerWrapper, 'native settings retain their original nested parent');
   for (let i = 0; i < 4; i++) {
     playbackButton.remove();startup.flushMutations();startup.discover();startup.tick();
     assert.equal(controls.children.filter(node => node.id === 'yac-playback-button').length, 1, 'native redraw and discovery repair one launcher without duplication');
     assert.equal(controls.children[0], playbackButton);
   }
   const replacement = enforceNativeInsertBefore(startup.document.createElement('div'));replacement.className = 'ytp-right-controls';
   controls.remove();startup.player.append(replacement);startup.discover();
   assert.equal(playbackButton.parentElement, replacement, 'replacement controls without a native settings button append safely');
   assert.equal(replacement.children.length, 1);
   startup.document.fullscreenElement = startup.player;startup.event(startup.document, 'fullscreenchange');
   assert.equal(playbackButton.parentElement, replacement);
   startup.setPath('/');startup.event(startup.document, 'yt-navigate-finish');assert.equal(playbackButton.isConnected, false);
   startup.setPath('/watch');startup.event(startup.document, 'yt-navigate-finish');assert.equal(playbackButton.parentElement, replacement);
   startup.event(startup.document, 'yac-dispose');assert.equal(playbackButton.isConnected, false);
   startup.flushMutations();assert.equal(playbackButton.isConnected, false, 'pending native mutations cannot resurrect a disposed launcher');
   assert.ok(startup.observers.every(observer => !observer.target));
   startup.sharedStore.dispose();startup.playbackStore.dispose();
 }
 console.log('PASS playback startup: real insertBefore contract, nested/missing settings, redraw, replacement, fullscreen, SPA and teardown');

 for (const idleCallbacks of [true, false]) {
  const h = harness(true, { idleCallbacks });
  const chat = h.document.createElement('ytd-live-chat-frame');
  const chatFrame = h.document.createElement('iframe'); chatFrame.id = 'chatframe';
  chat.style.setProperty('background-color', 'rgb(35, 36, 39)');
  chatFrame.style.setProperty('border-color', 'rgb(65, 66, 69)');
  chat.append(chatFrame); h.watch.append(chat);
  h.below.style.setProperty('background-color', 'rgb(30, 30, 30)', 'important');
  h.comments.style.setProperty('background-color', 'rgb(22, 23, 24)', 'important');
  await h.load({ enabled: true, flashWarning: false });
  const scans = () => h.stats.surfaceScans;
  assert.equal(h.below.style.getPropertyValue('background-color'), 'transparent', 'ON guards a real watch surface');
  assert.equal(h.comments.style.getPropertyValue('background-color'), 'var(--yac-reading-pane-face)', 'comment collection paint stays CSS-managed');
  assert.equal(h.get('yac-background').style.opacity, '1.0000', 'recommended ambient strength remains unchanged');
  assert.equal(chat.style.getPropertyValue('background-color'), 'rgb(35, 36, 39)', 'the inline surface guard leaves the CSS chat shade intact');
  assert.equal(chatFrame.style.getPropertyValue('border-color'), 'rgb(65, 66, 69)', 'native iframe border is retained');
  let before = scans();
  for (let i = 0; i < 5; i++) { h.advance(1000); h.discover(); }
  assert.equal(scans(), before, 'stable playback performs no recurring whole-page surface scans');

  for (let i = 0; i < 50; i++) {
    const thread = h.document.createElement('ytd-comment-thread-renderer');
    const content = h.document.createElement('div'); content.id = 'content';
    thread.append(content); h.comments.append(thread);
  }
  h.flushTasks(); h.advance(1000); h.discover();
  assert.equal(scans(), before, '50 loaded comment threads do not rescan the page');
  assert.equal(h.comments.style.getPropertyValue('background-color'), 'var(--yac-reading-pane-face)', 'loading comments preserves the clear collection owner');
  h.comments.children[0].classList.add('expanded');
  h.player.classList.add('ytp-playing'); h.player.classList.add('ytp-autohide');
  h.flushTasks(); h.advance(1000); h.discover();
  assert.equal(scans(), before, 'comment and playback-control classes do not rescan structural surfaces');
  assert.equal(h.timeouts.size + h.idle.size, 0, 'unrelated classes do not schedule work');

  const suggestions = h.document.createElement('div'); suggestions.className = 'ytSearchboxComponentSuggestionsContainer';
  const popup = h.document.createElement('ytd-popup-container');
  const voice = h.document.createElement('ytd-voice-search-dialog-renderer'); voice.setAttribute('dialog', '');
  const mini = h.document.createElement('ytd-mini-guide-renderer');
  popup.append(voice); h.app.append(suggestions, popup, mini); h.flushTasks();
  for (let i = 0; i < 50; i++) {
    const row = h.document.createElement('button'); row.className = 'ytSuggestionComponentSuggestion';
    suggestions.append(row); row.setAttribute('aria-selected', String(i === 0));
  }
  h.flushTasks();
  suggestions.className = 'YtSearchboxComponentSuggestionsContainer'; h.flushTasks();
  assert.equal(scans(), before, 'portalled suggestions, voice dialog and mini-guide use CSS without whole-page scans');
  assert.equal(h.timeouts.size + h.idle.size, 0, 'suggestion rows and selection do not enqueue structural refreshes');

  for (const kind of ['ytd-form-popup-renderer', 'ytd-hotkey-dialog-renderer', 'yt-report-form-modal-renderer',
    'ytd-single-option-survey-renderer', 'ytd-survey-follow-up-renderer', 'ytd-checkbox-survey-renderer', 'ytd-dismissal-follow-up-renderer']) {
    const dialog = h.document.createElement(kind); dialog.setAttribute('dialog', '');
    const layout = h.document.createElement('div'); layout.className = 'yt-spec-dialog-layout';
    dialog.append(layout); popup.append(dialog);
  }
  const playerMenu = h.document.createElement('div'); playerMenu.className = 'ytp-settings-menu ytp-popup';
  const playerRow = h.document.createElement('button'); playerRow.className = 'ytp-menuitem';
  playerMenu.append(playerRow); h.player.append(playerMenu); h.flushTasks();
  playerRow.setAttribute('aria-checked', 'true'); playerRow.classList.add('native-selected'); h.flushTasks();
  assert.equal(scans(), before, 'late dialogs/player menus and native row states use CSS without page scans');
  assert.equal(h.timeouts.size + h.idle.size, 0, 'popup navigation does not schedule structural work');

  const hoverCard = h.document.createElement('div'); hoverCard.className = 'yt-uix-hovercard-card';
  const hoverContent = h.document.createElement('div'); hoverContent.className = 'yt-uix-hovercard-card-content';
  const tooltip = h.document.createElement('yt-tooltip-renderer');
  const paperTooltip = h.document.createElement('tp-yt-paper-tooltip');
  const tooltipFace = h.document.createElement('div'); tooltipFace.id = 'tooltip'; tooltipFace.className = 'tp-yt-paper-tooltip';
  const promoTooltip = h.document.createElement('div'); promoTooltip.className = 'ytp-promotooltip-container';
  hoverCard.append(hoverContent); paperTooltip.append(tooltipFace); tooltip.append(paperTooltip);
  h.app.append(hoverCard, tooltip); h.player.append(promoTooltip); h.flushTasks();
  hoverCard.classList.add('yt-uix-hovercard-card-reverse'); hoverCard.classList.add('yt-uix-hovercard-card-flip');
  tooltipFace.style.setProperty('opacity', '.55'); tooltipFace.setAttribute('hidden', ''); h.flushTasks();
  assert.equal(scans(), before, 'known portalled cards, tooltips, arrows and native fade changes cause no page scans');
  assert.equal(h.timeouts.size + h.idle.size, 0, 'card/tooltip changes do not enqueue structural work');

  const description = h.document.createElement('div'); description.id = 'description';
  description.style.setProperty('background-color', 'rgb(44, 45, 46)', 'important');
  const descriptionInner = h.document.createElement('div'); descriptionInner.id = 'description-inner';
  description.append(descriptionInner); h.below.append(description); h.flushTasks(); h.advance(1000);
  assert.equal(description.style.getPropertyValue('background-color'), 'transparent', 'unrelated description ID stays structural');
  const metadata = h.document.createElement('ytd-watch-metadata');
  metadata.style.setProperty('background-color', 'rgb(46, 47, 48)', 'important');
  const title = h.document.createElement('div'); title.id = 'title'; title.textContent = 'Original native title';
  title.style.setProperty('background-color', 'rgb(48, 49, 50)', 'important'); metadata.append(title);
  metadata.append(description); h.below.append(metadata); h.flushTasks();
  assert.equal(metadata.style.getPropertyValue('background-color'), 'var(--yac-metadata-reading-face)', 'a newly created metadata owner is guarded before the delayed refresh');
  assert.equal(h.timeouts.size + h.idle.size, 0, 'a metadata replacement leaves no delayed duplicate scan');
  h.advance(1000);
  assert.equal(metadata.style.getPropertyValue('background-color'), 'var(--yac-metadata-reading-face)', 'metadata outer paint stays CSS-managed');
  assert.equal(title.style.getPropertyValue('background-color'), 'transparent', 'inner title cannot stack a theme background');
  assert.equal(title.textContent, 'Original native title', 'native title contents are untouched');
  const ownerScan = scans();
  metadata.style.setProperty('background-color', 'rgb(54, 55, 56)', 'important'); h.flushTasks();
  assert.equal(metadata.style.getPropertyValue('background-color'), 'var(--yac-metadata-reading-face)', 'an external metadata paint change is guarded before the next frame');
  assert.equal(scans(), ownerScan + 1, 'an external paint change causes one immediate metadata sync');
  assert.equal(description.style.getPropertyValue('background-color'), 'var(--yac-reading-pane-face)', 'moving into the native metadata shell applies its text face');
  assert.equal(descriptionInner.style.getPropertyValue('background-color'), 'transparent', 'description content cannot add a second pane');
  h.below.append(description); metadata.remove(); h.flushTasks(); h.advance(1000);
  assert.equal(metadata.style.getPropertyValue('background-color'), 'rgb(54, 55, 56)', 'a removed metadata owner restores the latest external paint');
  assert.equal(title.style.getPropertyValue('background-color'), 'rgb(48, 49, 50)', 'removed metadata children retain their original paint');
  assert.equal(description.style.getPropertyValue('background-color'), 'transparent', 'moving out of metadata removes the owned text face');
  const legacyMetadata = h.document.createElement('ytd-video-secondary-info-renderer');
  legacyMetadata.style.setProperty('background-color', 'rgb(50, 51, 52)', 'important');
  legacyMetadata.append(description); h.below.append(legacyMetadata); h.flushTasks(); h.advance(1000);
  assert.equal(description.style.getPropertyValue('background-color'), 'var(--yac-reading-pane-face)', 'legacy descriptions use the same text face');
  assert.equal(legacyMetadata.style.getPropertyValue('background-color'), 'var(--yac-metadata-reading-face)', 'legacy owner paint stays CSS-managed');
  const legacyPrimary = h.document.createElement('ytd-video-primary-info-renderer');
  legacyPrimary.style.setProperty('background-color', 'rgb(52, 53, 54)', 'important'); h.below.append(legacyPrimary); h.flushTasks(); h.advance(1000);
  assert.equal(legacyPrimary.style.getPropertyValue('background-color'), 'var(--yac-metadata-reading-face)', 'legacy title/actions receive their native container face');

  const related = h.document.createElement('div'); related.id = 'related';
  related.style.setProperty('background-color', 'rgb(60, 61, 62)', 'important');
  const results = h.document.createElement('ytd-watch-next-secondary-results-renderer');
  results.style.setProperty('background-color', 'rgb(70, 71, 72)', 'important');
  related.append(results); h.watch.append(related); h.flushTasks(); h.advance(1000);
  assert.equal(related.style.getPropertyValue('background-color'), 'var(--yac-related-reading-face)', 'related wrapper uses its clear CSS-managed face');
  assert.equal(results.style.getPropertyValue('background-color'), 'var(--yac-related-reading-face)', 'nested renderer resolves its clear face without another paint');
  const playlist = h.document.createElement('ytd-playlist-panel-renderer'); results.append(playlist);
  const resultSection = h.document.createElement('ytd-item-section-renderer');
  resultSection.style.setProperty('background-color', 'rgb(72, 73, 74)', 'important'); results.append(resultSection);
  const nestedGrid = h.document.createElement('ytd-rich-grid-renderer');
  nestedGrid.style.setProperty('background-color', 'rgb(74, 75, 76)', 'important'); resultSection.append(nestedGrid);
  h.flushTasks(); h.advance(1000);
  assert.equal(related.style.getPropertyValue('background-color'), 'var(--yac-related-reading-face)', 'playlist insertion retains the CSS-managed face without adding another inline layer');
  assert.equal(resultSection.style.getPropertyValue('background-color'), 'var(--yac-related-section-face)', 'mixed result sections use a conditional CSS face');
  assert.equal(nestedGrid.style.getPropertyValue('background-color'), 'var(--yac-related-section-face)', 'a nested grid resolves its own face to avoid inherited paint');
  playlist.remove(); h.flushTasks(); h.advance(1000);
  assert.equal(related.style.getPropertyValue('background-color'), 'var(--yac-related-reading-face)', 'related face stays CSS-managed after the playlist leaves');
  h.watch.append(results); h.flushTasks(); h.advance(1000);
  assert.equal(results.style.getPropertyValue('background-color'), 'var(--yac-related-reading-face)', 'moved renderer retains its clear CSS-managed face');
  h.enabled().checked = false; h.event(h.enabled(), 'input');
  assert.equal(description.style.getPropertyValue('background-color'), 'rgb(44, 45, 46)', 'role changes retain the original description paint for OFF');
  assert.equal(legacyMetadata.style.getPropertyValue('background-color'), 'rgb(50, 51, 52)', 'OFF restores the native legacy owner shell');
  assert.equal(legacyPrimary.style.getPropertyValue('background-color'), 'rgb(52, 53, 54)', 'OFF restores the native legacy title shell');
  assert.equal(related.style.getPropertyValue('background-color'), 'rgb(60, 61, 62)', 'OFF restores original related wrapper paint');
  assert.equal(results.style.getPropertyValue('background-color'), 'rgb(70, 71, 72)', 'OFF restores original moved renderer paint');
  assert.equal(resultSection.style.getPropertyValue('background-color'), 'rgb(72, 73, 74)', 'OFF restores a mixed result section');
  assert.equal(nestedGrid.style.getPropertyValue('background-color'), 'rgb(74, 75, 76)', 'OFF restores nested grid paint');
  assert.equal(h.comments.style.getPropertyValue('background-color'), 'rgb(22, 23, 24)', 'OFF restores original comments paint');
  h.enabled().checked = true; h.event(h.enabled(), 'input'); h.flushTasks(); h.advance(1000); before = scans();

  const ticket = h.document.createElement('ytd-ticket-shelf-renderer');
  const transcript = h.document.createElement('ytd-transcript-renderer');
  const wrapper = h.document.createElement('section'); wrapper.append(ticket, transcript); h.below.append(wrapper);
  h.flushTasks();
  assert.equal(scans(), before + 1, 'late surfaces in one batch receive one idle/fallback sync');
  assert.equal(ticket.style.getPropertyValue('background-color'), 'transparent');
  assert.equal(transcript.style.getPropertyValue('background-color'), 'transparent');
  before = scans(); h.flushTasks(); h.advance(1000); h.discover();
  assert.equal(scans(), before, 'our own styles do not trigger a mutation feedback loop');

  const panel = h.document.createElement('ytd-engagement-panel-section-list-renderer');
  const content = h.document.createElement('div'); content.id = 'content';
  const search = h.document.createElement('ytd-transcript-search-box-renderer');
  const field = h.document.createElement('div'); field.className = 'input-container ytd-transcript-search-box-renderer';
  const input = h.document.createElement('input'); input.value = 'Existing query';
  panel.style.setProperty('background-color', 'rgb(40, 40, 40)', 'important');
  field.style.setProperty('background-color', 'rgb(80, 80, 80)', 'important');
  search.append(field); field.append(input); content.append(search); panel.append(content); h.watch.append(panel);
  h.flushTasks();
  assert.equal(panel.style.getPropertyValue('background-color'), 'var(--yac-card-surface)', 'late panel receives one reading face');
  assert.equal(content.style.getPropertyValue('background-color'), 'transparent', 'inner panel content cannot stack theme paint');
  assert.equal(search.style.getPropertyValue('background-color'), 'transparent', 'transcript search host remains clear');
  assert.equal(field.style.getPropertyValue('background-color'), 'var(--yac-control-surface)', 'field follows control density independently');
  assert.equal(input.value, 'Existing query', 'search input value is preserved');
  h.get('yac-readingDensity').value = 0; h.event(h.get('yac-readingDensity'), 'input');
  assert.match(h.get('yac-surface-palette').textContent, /--yac-reading-opacity:0\.000000/, 'panel shade reaches true zero');
  assert.match(h.get('yac-surface-palette').textContent, /--yac-reading-pane-opacity:0\.000000/, 'long text panes also reach true zero');
  before = scans(); h.flushTasks();
  assert.equal(scans(), before, 'density changes use CSS variables without rescanning panel descendants');
  h.enabled().checked = false; h.event(h.enabled(), 'input');
  assert.equal(panel.style.getPropertyValue('background-color'), 'rgb(40, 40, 40)', 'OFF restores original panel theme');
  assert.equal(field.style.getPropertyValue('background-color'), 'rgb(80, 80, 80)', 'OFF restores original field theme');
  h.enabled().checked = true; h.event(h.enabled(), 'input'); h.flushTasks();
  h.get('yac-readingDensity').value = 100; h.event(h.get('yac-readingDensity'), 'input');
  h.advance(1000);
  before = scans();

  h.below.style.setProperty('background-color', 'rgb(70, 80, 90)', 'important');
  h.flushTasks();
  assert.equal(h.below.style.getPropertyValue('background-color'), 'transparent', 'external inline theme change is guarded again');
  h.enabled().checked = false; h.event(h.enabled(), 'input');
  assert.equal(h.below.style.getPropertyValue('background-color'), 'rgb(70, 80, 90)', 'OFF restores the latest external theme value');
  assert.equal(h.below.style.getPropertyPriority('background-color'), 'important');
  h.enabled().checked = true; h.event(h.enabled(), 'input'); h.flushTasks();
  before = scans();
  h.resize(); h.resize(); h.resize();
  assert.equal(scans(), before, 'resize bursts defer full-page work');
  assert.equal(h.timeouts.size + h.idle.size, 1, 'resize burst coalesces into one scheduled job');
  h.advance(1000); assert.equal(scans(), before + 1, 'resize burst needs only one refresh');

  h.document.hidden = true; h.event(h.document, 'visibilitychange');
  before = scans();
  const hiddenTicket = h.document.createElement('ytd-ticket-shelf-renderer');
  h.below.append(hiddenTicket); h.flushTasks();
  for (let i = 0; i < 5; i++) { h.advance(1000); h.discover(); }
  assert.equal(scans(), before, 'hidden changes and discovery never scan the page');
  h.document.hidden = false; h.event(h.document, 'visibilitychange'); h.flushTasks();
  assert.equal(scans(), before + 1, 'visible resume synchronizes deferred surfaces once');
  assert.equal(hiddenTicket.style.getPropertyValue('background-color'), 'transparent');

  h.player.style.setProperty('background-color', 'rgb(1, 2, 3)');
  h.watch.setAttribute('theater', ''); h.flushMutations();
  assert.equal(h.player.style.getPropertyValue('background-color'), 'transparent', 'theater player surround is guarded');
  assert.equal(h.timeouts.size + h.idle.size, 0, 'theater entry bypasses the delayed job');
  assert.equal(chat.style.getPropertyValue('background-color'), 'rgb(35, 36, 39)', 'theater entry does not overwrite the chat face with transparency');
  h.watch.removeAttribute('theater'); h.flushMutations();
  assert.equal(h.player.style.getPropertyValue('background-color'), 'rgb(1, 2, 3)', 'leaving theater restores the player surface');
  assert.equal(h.timeouts.size + h.idle.size, 0, 'theater exit restores without waiting');
  assert.equal(chatFrame.style.getPropertyValue('border-color'), 'rgb(65, 66, 69)', 'theater changes preserve the iframe border');
  before = scans(); wrapper.remove(); h.flushTasks(); h.advance(1000);
  assert.equal(scans(), before + 1, 'removed wrapper refreshes tracked descendants');
  assert.equal(ticket.style.getPropertyValue('background-color'), '', 'removed surface is restored');

  h.resize(); h.enabled().checked = false; h.event(h.enabled(), 'input'); h.flushTasks();
  before = scans();
  assert.equal(h.below.style.getPropertyValue('background-color'), 'rgb(70, 80, 90)', 'OFF restores immediately despite a queued refresh');
  assert.equal(chat.style.getPropertyValue('background-color'), 'rgb(35, 36, 39)', 'OFF leaves the native chat face available again');
  h.advance(3000); assert.equal(scans(), before, 'canceled job cannot reapply after OFF');
  h.enabled().checked = true; h.event(h.enabled(), 'input'); h.flushTasks(); h.resize();
  h.event(h.document, 'yac-dispose');
  before = scans(); h.advance(3000);
  assert.equal(scans(), before, 'disposed observer/jobs do not scan or reapply');
  assert.equal(h.below.style.getPropertyValue('background-color'), 'rgb(70, 80, 90)');
  assert.equal(h.timeouts.size + h.idle.size, 0, 'dispose clears scheduled work');
  assert.ok(h.observers.every(observer => !observer.target), 'dispose disconnects DOM observers');
  console.log(`PASS (${idleCallbacks ? 'idle' : 'timer fallback'}): no recurring/50-comment/hidden scans; late surfaces, theme, theater, resize coalescing, restoration and teardown`);
 }

  for (const workerMode of [false, true]) for (const idleCallbacks of [true, false]) {
   for (const mode of ['off', 'hidden', 'fullscreen']) {
    const dormant = harness(workerMode, { idleCallbacks });
    await dormant.load({ enabled: mode !== 'off', flashWarning: false });
    if (mode === 'hidden') {
      dormant.document.hidden = true; dormant.event(dormant.document, 'visibilitychange');
    } else if (mode === 'fullscreen') {
      dormant.document.fullscreenElement = dormant.player; dormant.event(dormant.document, 'fullscreenchange');
    }
    dormant.flushTasks();
    const probeBefore = dormant.stats.surfaceSubtreeQueries, scanBefore = dormant.stats.surfaceScans;
    const readsBefore = dormant.stats.rectReads, samplesBefore = dormant.stats.monitorSamples;
    let late;
    for (let i = 0; i < 50; i++) {
      const wrapper = dormant.document.createElement('div'); wrapper.append(dormant.document.createElement('span'));
      if (i === 0) {
        late = dormant.document.createElement('ytd-ticket-shelf-renderer');
        late.style.setProperty('background-color', 'rgb(51, 52, 53)', 'important'); wrapper.append(late);
      }
      dormant.below.append(wrapper);
    }
    dormant.flushTasks();
    assert.equal(dormant.stats.surfaceSubtreeQueries, probeBefore, `${mode}: no per-wrapper descendant queries while UI guarding is dormant`);
    assert.equal(dormant.stats.surfaceScans, scanBefore, `${mode}: no full-page scans while dormant`);
    assert.equal(dormant.stats.rectReads, readsBefore, `${mode}: DOM additions do not force player layout`);
    assert.equal(dormant.stats.monitorSamples, samplesBefore, `${mode}: DOM additions do not sample video`);
    assert.equal(late.style.getPropertyValue('background-color'), 'rgb(51, 52, 53)', `${mode}: late theme paint stays native while dormant`);
    if (mode === 'off') {
      dormant.enabled().checked = true; dormant.event(dormant.enabled(), 'input');
    } else if (mode === 'hidden') {
      dormant.document.hidden = false; dormant.event(dormant.document, 'visibilitychange');
    } else {
      dormant.document.fullscreenElement = null; dormant.event(dormant.document, 'fullscreenchange');
    }
    dormant.flushTasks();
    assert.equal(dormant.stats.surfaceScans, scanBefore + 1, `${mode}: resume synchronizes deferred surfaces once`);
    assert.equal(late.style.getPropertyValue('background-color'), 'transparent', `${mode}: resume guards the late surface`);
    dormant.enabled().checked = false; dormant.event(dormant.enabled(), 'input');
    assert.equal(late.style.getPropertyValue('background-color'), 'rgb(51, 52, 53)', `${mode}: OFF restores the original late theme paint`);
    dormant.event(dormant.document, 'yac-dispose');
   }
   console.log(`PASS (${workerMode ? 'worker' : 'main'}, ${idleCallbacks ? 'idle' : 'timer'}): OFF/hidden/fullscreen skip subtree probes and resume once`);
  }

  const busy = harness(true);
 await busy.load({ enabled: true });
 busy.tick({ flush: false });
 assert.ok(busy.worker.pending, 'test leaves one Worker frame outstanding');
 const reads = busy.stats.rectReads, styles = busy.stats.computedStyleReads;
 for (let i = 0; i < 5; i++) busy.tick({ flush: false });
 assert.equal(busy.stats.rectReads, reads, 'busy Worker skips geometry reads');
 assert.equal(busy.stats.computedStyleReads, styles, 'busy Worker skips computed style');
 busy.event(busy.document, 'yac-dispose');
 console.log('PASS: Worker backpressure applies before main-thread layout work');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
