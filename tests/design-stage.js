/* Local design stage. User-selected media stays in the browser; no extension
 * APIs, stored settings, external requests or server uploads. */
(async () => {
  'use strict';
  const icons = LiquidDesignIcons;
  // The saved DOM preserves nodes that the HTML parser would otherwise move
  // out of nested native controls. Reinsert that same captured node tree.
  const settingsDialog = document.getElementById('design-settings');
  const capturedNodes = await (await fetch('/design-native/dom.json')).json(), restored = [];
  const nativeControls = await (await fetch('/design-native/controls.json')).json();
  document.body.replaceChildren();
  for (const record of capturedNodes) {
    let node;
    if (record.parent === -1) {
      node = document.body;for (const [name, value] of record.attrs) node.setAttribute(name, value);
    } else if ('text' in record) node = document.createTextNode(record.text);
    else {
      node = record.svg ? document.createElementNS('http://www.w3.org/2000/svg', record.tag) : document.createElement(record.tag);
      for (const [name, value] of record.attrs) node.setAttribute(name, value);
      if (record.checked !== undefined) node.checked = record.checked;
    }
    restored.push(node);if (record.parent >= 0) restored[record.parent].append(node);
  }
  document.body.append(settingsDialog);
  // The surrounding DOM and all page styles are the saved YouTube page.
  // Keep native elements; only reconnect the local player and clone a native
  // recommendation row for each explicitly supplied local video.
  for (const id of ['yac-launcher', 'yac-controls', 'yac-flash-warning', 'yac-background', 'yac-bar-layer', 'yac-surface-palette', 'liquid-ui-settings']) document.getElementById(id)?.remove();
  const nativePlayer = document.getElementById('movie_player');
  const nativeVideo = nativePlayer.querySelector('video');nativeVideo.id = 'stage-video';nativeVideo.removeAttribute('src');nativeVideo.removeAttribute('autoplay');nativeVideo.controls = false;
  const nativePlay = nativePlayer.querySelector('.ytp-play-button');nativePlay.id = 'stage-play';
  const nativeMute = nativePlayer.querySelector('.ytp-mute-button .ytp-volume-icon') || nativePlayer.querySelector('.ytp-mute-button');nativeMute.id = 'stage-mute';
  nativePlayer.querySelector('.ytp-time-display').id = 'stage-time';
  // The original player script normally updates these dimensions on resize.
  // Reconnect only that sizing and the local media; retain its copied styles.
  const playerSizing = new ResizeObserver(() => {
    const { width, height } = nativePlayer.getBoundingClientRect();
    nativeVideo.style.width = width + 'px';nativeVideo.style.height = height + 'px';
    nativeVideo.style.left = '0px';nativeVideo.style.top = '0px';
    nativePlayer.querySelector('.ytp-chrome-bottom').style.width = Math.max(0, width - 24) + 'px';
    const chapter = nativePlayer.querySelector('.ytp-chapter-hover-container');
    if (chapter) chapter.style.width = Math.max(0, width - 24) + 'px';
  });
  playerSizing.observe(nativePlayer);
  const nativeSeek = element('input');nativeSeek.id = 'stage-seek';nativeSeek.type = 'range';nativeSeek.min = '0';nativeSeek.max = '1000';nativeSeek.step = '1';nativeSeek.value = '0';nativeSeek.setAttribute('aria-label', '再生位置');
  nativePlayer.querySelector('.ytp-progress-bar-container').append(nativeSeek);
  nativePlayer.querySelector('.ytp-fullscreen-button')?.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();else nativePlayer.requestFullscreen();
  });
  nativePlayer.classList.remove('ytp-autohide', 'unstarted-mode');
  const nativeButtons = document.querySelector('ytd-masthead #end #buttons'), launcher = element('button');
  launcher.id = 'stage-open';launcher.type = 'button';launcher.setAttribute('aria-label', 'Flexible UIの簡易パネルを開く');launcher.setAttribute('aria-controls', 'stage-panel');launcher.setAttribute('aria-expanded', 'false');launcher.append(icons.create('settings-2'));
  nativeButtons.insertBefore(launcher, nativeButtons.children[1] || null);
  const nativeRecommendations = document.querySelector('ytd-watch-next-secondary-results-renderer');
  const nativeRow = nativeRecommendations.querySelector('yt-lockup-view-model');
  const rowTemplate = nativeRow.cloneNode(true), rowContainer = nativeRow.parentElement;rowContainer.id = 'stage-related';
  for (const row of nativeRecommendations.querySelectorAll('yt-lockup-view-model,ytd-continuation-item-renderer')) row.remove();
  const nativeHalo = element('canvas');nativeHalo.id = 'video-halo';nativeHalo.width = 96;nativeHalo.height = 54;nativeHalo.setAttribute('aria-hidden', 'true');document.body.prepend(nativeHalo);
  const nativeNote = element('div', '', 'デザイン試作 · 保存したYouTubeの実ページ');nativeNote.id = 'stage-note';document.body.append(nativeNote);
  document.addEventListener('submit', event => event.preventDefault());
  document.addEventListener('click', event => { const link = event.target.closest('a');if (link && !link.hasAttribute('download')) event.preventDefault(); });
  const dialog = document.getElementById('design-settings');
  const title = document.getElementById('design-title'), view = document.getElementById('design-view');
  const nav = document.getElementById('site-nav');
  const help = document.getElementById('design-help');
  const video = document.getElementById('stage-video'), halo = document.getElementById('video-halo');
  const appSurface = document.querySelector('ytd-app');
  const appBackground = ['background-color', 'background-image', 'box-shadow'].map(key => [key, appSurface.style.getPropertyValue(key), appSurface.style.getPropertyPriority(key)]);
  const haloContext = halo.getContext('2d', { alpha: false }), player = nativePlayer;
  const play = document.getElementById('stage-play'), mute = document.getElementById('stage-mute');
  const videoName = document.getElementById('video-name');
  const related = document.getElementById('stage-related'), seek = document.getElementById('stage-seek');
  let sidebar;
  const values = new Map([['global', { ...LiquidSites.globalDefaults, theme: 'system' }],
    ...LiquidSites.list().map(site => [site.id, { ...site.defaults }])]);
  values.get('global').playbackEnabled = true;
  const subscribers = new Map(), stageStores = new Map();
  function stageStore(scope) {
    if (stageStores.has(scope)) return stageStores.get(scope);
    const store = LiquidUI.getStore(scope);values.set(scope, store.values);
    store.ready.then(() => store.subscribe(() => applyPreview()));stageStores.set(scope, store);return store;
  }
  const ambientStore = stageStore('youtube'), playbackStore = stageStore('global');
  const commentHover = LiquidWatchSidebar.createCommentHover();
  const commentMenus = LiquidWatchSidebar.createCardMenus({ root: document.documentElement, scopes: { comments: true, replies: true } });
  const headerFade = LiquidWatchSidebar.createHeaderFade();
  const channelCards = FlexibleChannelCard.create({ stage: true, store: playbackStore, load: async url => ({ url, name: url.split('/').at(-1), handle: url.split('/').at(-1), description: '表示確認用のチャンネルカードです。実際のYouTubeでは公開されているチャンネル情報を表示します。', stats: ['試作データ'], videos: [] }) });
  let settingsCard;const stageChoices = new Set();
  const choiceSheet = new CSSStyleSheet();choiceSheet.replaceSync(LiquidChoiceMenu.css);document.adoptedStyleSheets = [...document.adoptedStyleSheets, choiceSheet];
  let selected = 'youtube', appearanceSite = 'youtube', path = [], returnFocus = null;
  let objectUrl = null, frameCallback = 0, lastPaint = -Infinity;
  let mediaItems = [], activeId = null;
  video.muted = true;video.volume = .35;
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  const translated = text => typeof text === 'string' ? text : text?.ja || '';
  const definition = () => LiquidSites.list().find(site => site.id === selected);
  const currentValues = (scope = selected) => values.get(scope);
  function iconButton(label, icon, handler, className = 'icon-button') {
    const button = element('button', className);button.type = 'button';button.setAttribute('aria-label', label);
    button.append(icons.create(icon));button.addEventListener('click', handler);return button;
  }
  function closeHelp() { if (help.matches(':popover-open')) help.hidePopover(); }
  function showHelp(field, anchor) {
    closeHelp();document.getElementById('help-title').textContent = translated(field.label);
    document.getElementById('help-text').textContent = translated(field.description);
    help.showPopover();
    const rect = anchor.getBoundingClientRect(), popup = help.getBoundingClientRect();
    help.style.left = Math.max(12, Math.min(innerWidth - popup.width - 12, rect.right - popup.width)) + 'px';
    help.style.top = Math.max(12, Math.min(innerHeight - popup.height - 12, rect.bottom + 6)) + 'px';
  }
  function applyPreview() {
    const common = values.get('global');dialog.dataset.theme = LiquidQuickPanel.resolveTheme(common.theme, { document, siteId: 'youtube' });
    dialog.dataset.solid = String(common.reduceTransparency);
    const youtube = values.get('youtube');
    document.documentElement.classList.toggle('yac-custom-accent', youtube.useCustomAccent);
    for (const [key, value] of Object.entries(LiquidSites.accentPalette?.(youtube) || {})) document.documentElement.style.setProperty(key, value);
    document.body.dataset.stageAmbient = String(youtube.enabled);
    document.documentElement.classList.toggle('yac-active', youtube.enabled);
    // Use the extension's shade coefficients with the captured YouTube styles.
    for (const [key, value] of Object.entries(YacSettingsStore.surfacePalette(youtube))) {
      document.documentElement.style.setProperty(key, value);
    }
    for (const [key, value, priority] of appBackground) {
      if (youtube.enabled) appSurface.style.setProperty(key, key === 'background-color' ? 'transparent' : 'none', 'important');
      else if (value) appSurface.style.setProperty(key, value, priority);else appSurface.style.removeProperty(key);
    }
    halo.style.opacity = youtube.enabled && video.getAttribute('src') ? String(youtube.strength / 100) : '0';
    halo.style.filter = `blur(${youtube.blur}px) saturate(${youtube.saturation}%)`;
    const playback = values.get('global');
    video.playbackRate = playback.playbackEnabled ? playback.playbackRate : 1;
    if ('preservesPitch' in video) video.preservesPitch = !playback.playbackEnabled || playback.playbackMode !== 'rate';
    if (youtube.enabled) paintHalo();else stopHalo();
    const section = selected === 'global' ? (path[0] === 'playback' ? 'playback' : 'general') : 'appearance';
    nav.querySelectorAll('[data-section]').forEach(button => button.setAttribute('aria-current', button.dataset.section === section ? 'page' : 'false'));
    for (const [scope, listeners] of subscribers) for (const listener of listeners) listener(values.get(scope), { loaded: true });
  }
  function toggle(key, label, scope = selected, prefix = 'design-toggle') {
    const hit = element('label', 'switch-hit'), input = element('input');
    input.type = 'checkbox';input.checked = !!currentValues(scope)[key];input.setAttribute('aria-label', label);input.setAttribute('role', 'switch');input.dataset.key = key;
    input.id = prefix + '-' + scope + '-' + key;
    input.addEventListener('change', () => {
      currentValues(scope)[key] = input.checked;applyPreview();
    });
    hit.append(input);return hit;
  }
  function navigate(next) { path = next;render(true); }
  function feature(label, icon, next, key, value) {
    const row = element('div', 'feature-row'), open = element('button', 'feature-open');open.type = 'button';
    open.append(icons.create(icon), element('span', 'feature-name', label));open.addEventListener('click', () => navigate(next));row.append(open);
    if (value) row.append(element('span', 'feature-value', value));
    if (key) row.append(toggle(key, label));
    row.append(iconButton(label + 'の詳細を開く', 'chevron-right', () => navigate(next), 'chevron-button'));
    return row;
  }
  function list(rows) { const wrapper = element('div', 'list');wrapper.append(...rows);return wrapper; }
  function field(definition, scope = selected, prefix = 'design') {
    const row = element('div', 'field-row' + (definition.type === 'range' ? ' range-row' : definition.type === 'toggle' ? ' toggle-row' : ''));
    const labelWrap = element('div', 'field-label'), label = element('label', '', translated(definition.label));
    const input = element(definition.type === 'select' ? 'button' : 'input');
    input.id = prefix + '-' + definition.key;input.dataset.key = definition.key;label.htmlFor = input.id;labelWrap.append(label);
    if (definition.description) {
      let info;info = iconButton(translated(definition.label) + 'の説明', 'info', () => showHelp(definition, info), 'icon-button info-button');
      labelWrap.append(info);
    }
    row.append(labelWrap);
    if (definition.type === 'toggle') { const control = toggle(definition.key, translated(definition.label), scope, prefix + '-toggle');row.append(control);label.htmlFor = control.querySelector('input').id;return row; }
    if (definition.type === 'select') {
      const choice = LiquidChoiceMenu.create({ icons, overlayRoot: dialog, container: dialog, boundary: dialog,
        id: input.id, label: translated(definition.label), value: currentValues(scope)[definition.key],
        choices: definition.choices.map(([value, text]) => [value, translated(text)]),
        onChange: value => stageStore(scope).set(definition.key, value) });
      stageChoices.add(choice);row.append(choice.element);
    } else {
      input.type = 'range';input.min = definition.min;input.max = definition.max;input.step = definition.step;
      input.value = Math.round(currentValues(scope)[definition.key] * (definition.scale || 1));
      const output = element('output', '', input.value + (definition.unit || ''));output.htmlFor = input.id;
      input.addEventListener('input', () => {
        currentValues(scope)[definition.key] = Number(input.value) / (definition.scale || 1);output.textContent = input.value + (definition.unit || '');applyPreview();updatePresets();
      });row.append(input, output);
    }
    return row;
  }
  function updatePresets() {
    for (const button of view.querySelectorAll('[data-preset]')) {
      const preset = JSON.parse(button.dataset.preset);
      button.setAttribute('aria-pressed', String(Object.entries(preset).every(([key, value]) => currentValues()[key] === value)));
    }
  }
  let stageQuickOpener = launcher;
  const stagePlaybackButton = iconButton('再生調整を開く', 'gauge', () => {
    const same = stageQuickOpener === stagePlaybackButton && quickUI.isOpen();
    stageQuickOpener?.setAttribute('aria-expanded', 'false');stageQuickOpener = stagePlaybackButton;
    if (same) quickUI.hide();else quickUI.showPlayback(stagePlaybackButton);
  }, 'ytp-button stage-playback-button');
  stagePlaybackButton.id = 'stage-playback-adjust';stagePlaybackButton.setAttribute('aria-controls', 'stage-panel');stagePlaybackButton.setAttribute('aria-expanded', 'false');
  nativePlayer.querySelector('.ytp-right-controls')?.prepend(stagePlaybackButton);
  const quickUI = LiquidQuickPanel.create({ icons, ambientStore, playbackStore, id: 'stage-panel', loadedVersion: browser.runtime.getManifest().version,
    ambientGroups: LiquidSites.identify('www.youtube.com').groups,
    onAllSettings: state => LiquidUI.open({ site: 'youtube', ...state }),
    onVisibilityChange: shown => stageQuickOpener?.setAttribute('aria-expanded', String(shown))
  });
  const cardSheet = new CSSStyleSheet();cardSheet.replaceSync(LiquidPlaybackCard.css);document.adoptedStyleSheets = [...document.adoptedStyleSheets, cardSheet];
  function showFields(group, omit = [], target = view) {
    target.append(list(group.fields.filter(field => !omit.includes(field.key)).map(definition => field(definition))));
    if (group.id === 'playback') {
      const presets = element('div', 'preset-row');
      for (const preset of group.presets || []) {
        const button = element('button', 'preset', translated(preset.label));button.type = 'button';button.dataset.preset = JSON.stringify(preset.values);
        button.addEventListener('click', () => { Object.assign(currentValues(), preset.values);render(false); });presets.append(button);
      }
      view.append(presets);updatePresets();
    }
  }
  function render(moveFocus = false) {
    settingsCard?.dispose();settingsCard = null;
    for (const choice of stageChoices) choice.dispose();stageChoices.clear();
    closeHelp();view.replaceChildren();view.removeAttribute('role');view.removeAttribute('aria-labelledby');
    document.getElementById('design-site-tabs')?.remove();
    const site = definition(), section = path[0];
    dialog.dataset.site = selected;dialog.dataset.view = path.join('/') || 'overview';
    if (section === 'playback') {
      title.textContent = '音声・再生速度';settingsCard = LiquidPlaybackCard.bind(playbackStore, { icons, language: 'ja' });view.append(settingsCard.element);
    } else if (selected === 'global') {
      title.textContent = '一般';showFields(LiquidSites.globalGroups[0]);
      const note = element('p', 'view-note', '外観だけを確認する試作です。言語の変更は本体へ反映するときに対応します。');view.append(note);
    } else {
      appearanceSite = selected;title.textContent = '外観';
      const groups = site.groups, group = groups.find(group => group.id === path.at(-1)) || groups[0];
      path = [group.id];dialog.dataset.view = group.id;
      const tabs = element('div', 'site-tabs');tabs.id = 'design-site-tabs';tabs.setAttribute('role', 'tablist');tabs.setAttribute('aria-label', '外観を設定するサイト');
      const names = LiquidSites.list();
      const choose = id => { selected = id;path = [];render();document.getElementById('design-site-' + id)?.focus({ preventScroll: true }); };
      for (const item of names) {
        const tab = element('button', 'site-tab', item.name);tab.type = 'button';tab.dataset.site = item.id;
        tab.id = 'design-site-' + item.id;tab.setAttribute('role', 'tab');tab.setAttribute('aria-controls', 'design-view');
        tab.setAttribute('aria-selected', String(selected === item.id));tab.tabIndex = selected === item.id ? 0 : -1;
        tab.addEventListener('click', () => choose(item.id));
        tab.addEventListener('keydown', event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();const index = names.findIndex(entry => entry.id === item.id);
          choose(names[event.key === 'Home' ? 0 : event.key === 'End' ? names.length - 1 :
            (index + (event.key === 'ArrowRight' ? 1 : -1) + names.length) % names.length].id);
        });tabs.append(tab);
      }
      view.before(tabs);view.setAttribute('role', 'tabpanel');view.setAttribute('aria-labelledby', 'design-site-' + selected);
      const sidebarSettings = group.id === 'watch-sidebar';
      const key = sidebarSettings ? 'sidebarEnabled' : selected === 'youtube' ? 'enabled' : 'appearanceEnabled', masterLabel = sidebarSettings ? '動画一覧を整理' : selected === 'youtube' ? 'アンビエント背景' : '外観';
      const master = element('div', 'feature-row feature-master'), label = element('div', 'feature-label');
      label.append(icons.create(selected === 'youtube' ? 'sun' : 'panels-top-left'), element('span', '', masterLabel));master.append(label, toggle(key, masterLabel));view.append(master);
      const body = element('div', groups.length > 1 ? 'appearance-body' : ''), detail = element('div', 'group-content');
      if (groups.length > 1) {
        const categories = element('div', 'topic-list');categories.setAttribute('role', 'group');categories.setAttribute('aria-label', '設定の分類');
        for (const topic of groups) {
          const entry = element('button', 'topic');entry.type = 'button';entry.setAttribute('aria-label', translated(topic.label));
          const arrow = icons.create('chevron-right', 16);arrow.classList.add('topic-arrow');
          entry.append(icons.create(topic.icon, 18), element('span', 'topic-name', translated(topic.label)), arrow);
          if (topic.id === group.id) entry.setAttribute('aria-current', 'page');
          entry.addEventListener('click', () => navigate([topic.id]));categories.append(entry);
        }
        body.append(categories);detail.append(element('h3', 'group-title', translated(group.label)));
      }
      showFields(group, [key], detail);body.append(detail);view.append(body);
    }
    applyPreview();document.getElementById('settings-content').scrollTop = 0;
    if (moveFocus) title.focus({ preventScroll: true });
  }
  for (const item of [{ id: 'appearance', name: '外観', icon: 'panels-top-left' },
    { id: 'playback', name: '音声・再生速度', icon: 'volume-2' }, { id: 'general', name: '一般', icon: 'settings-2' }]) {
    const button = element('button', 'site-entry');button.type = 'button';button.dataset.section = item.id;
    button.append(icons.create(item.icon, 20));
    button.append(element('span', '', item.name));
    button.addEventListener('click', () => { selected = item.id === 'appearance' ? appearanceSite : 'global';path = item.id === 'playback' ? ['playback'] : [];render(true); });nav.append(button);
  }
  function open(focusTarget = document.activeElement) { quickUI.hide(false);returnFocus = focusTarget;render();dialog.showModal(); }
  function close() { for (const choice of stageChoices) choice.close(false);closeHelp();dialog.close();returnFocus?.focus({ preventScroll: true }); }
  document.getElementById('stage-open').addEventListener('click', () => {
    if (globalThis.stageSettingsDesigns) { globalThis.stageSettingsDesigns.show();return; }
    stageQuickOpener?.setAttribute('aria-expanded', 'false');stageQuickOpener = launcher;quickUI.toggle(launcher);
  });
  document.getElementById('stage-close').addEventListener('click', close);
  document.getElementById('help-close').addEventListener('click', closeHelp);
  dialog.addEventListener('cancel', event => { event.preventDefault();close(); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
  });
  window.addEventListener('resize', closeHelp);
  function stopHalo() {
    if (frameCallback && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frameCallback);
    frameCallback = 0;
  }
  function paintHalo(now = performance.now()) {
    if (!video.getAttribute('src') || video.readyState < 2 || !values.get('youtube').enabled || document.hidden) return;
    const interval = 1000 / Math.max(1, Math.min(60, values.get('youtube').fps || 30));
    if (now - lastPaint >= interval || video.paused) {
      haloContext.drawImage(video, 0, 0, halo.width, halo.height);lastPaint = now;
    }
    if (!video.paused && !video.ended && !frameCallback && video.requestVideoFrameCallback) {
      frameCallback = video.requestVideoFrameCallback(now => { frameCallback = 0;paintHalo(now); });
    }
  }
  function clock(seconds) {
    const time = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
    return (time >= 3600 ? Math.floor(time / 3600) + ':' + String(Math.floor(time / 60) % 60).padStart(2, '0') : Math.floor(time / 60)) + ':' + String(time % 60).padStart(2, '0');
  }
  function controlGlyph(button, state) {
    if (button.dataset.glyphState === state || !nativeControls[state]) return;
    const captured = nativeControls[state], template = document.createElement('template');
    template.innerHTML = captured.svg;
    const svg = template.content.firstElementChild;
    svg.querySelectorAll('path').forEach((path, index) => {
      if (captured.paths[index] && captured.paths[index] !== 'none') path.style.d = captured.paths[index];
    });
    const existing = button.querySelector('svg');
    if (existing) existing.replaceWith(svg);else button.append(svg);
    button.dataset.glyphState = state;
  }
  function syncPlayer() {
    player.classList.toggle('playing-mode', !video.paused);player.classList.toggle('paused-mode', video.paused);
    play.disabled = !video.getAttribute('src') || video.readyState < 1;
    play.setAttribute('aria-label', video.paused ? '動画を再生' : '動画を一時停止');controlGlyph(play, video.paused ? 'paused' : 'playing');
    mute.setAttribute('aria-label', video.muted ? '音声をオンにする' : '音声をミュートにする');mute.setAttribute('aria-pressed', String(video.muted));
    controlGlyph(mute, video.muted ? 'muted' : 'unmuted');
    const time = document.getElementById('stage-time'), current = time.querySelector('.ytp-time-current'), duration = time.querySelector('.ytp-time-duration');
    if (current && duration) { current.textContent = clock(video.currentTime);duration.textContent = clock(video.duration); }
    else time.textContent = clock(video.currentTime) + ' / ' + clock(video.duration);
    time.querySelector('.ytp-time-contents')?.setAttribute('aria-label', clock(video.currentTime) + ' / ' + clock(video.duration));
    const ratio = Number.isFinite(video.duration) && video.duration > 0 ? Math.max(0, Math.min(1, video.currentTime / video.duration)) : 0;
    seek.value = ratio * 1000;seek.disabled = !Number.isFinite(video.duration) || video.duration <= 0;
    seek.setAttribute('aria-valuetext', clock(video.currentTime) + ' / ' + clock(video.duration));
    const progress = player.querySelector('.ytp-play-progress');
    if (progress) { progress.style.width = '100%';progress.style.transform = 'scaleX(' + ratio + ')';progress.style.transformOrigin = 'left'; }
    const thumb = player.querySelector('.ytp-scrubber-container');
    if (thumb) { thumb.style.left = ratio * 100 + '%';thumb.style.transform = 'translateX(-50%)'; }
    paintHalo();
  }
  play.addEventListener('click', () => { if (video.paused) video.play().catch(() => { videoName.textContent = '再生できませんでした'; });else video.pause(); });
  mute.addEventListener('click', () => { video.muted = !video.muted; });
  seek.addEventListener('input', () => {
    if (Number.isFinite(video.duration) && video.duration > 0) { video.currentTime = video.duration * Number(seek.value) / 1000;syncPlayer(); }
  });
  for (const event of ['loadedmetadata', 'loadeddata', 'emptied', 'play', 'pause', 'timeupdate', 'seeked', 'volumechange', 'ended']) video.addEventListener(event, syncPlayer);
  video.addEventListener('pause', stopHalo);
  video.addEventListener('error', () => {
    stopHalo();play.disabled = true;videoName.textContent = 'この動画は再生できません';
    document.getElementById('stage-note').textContent = '別の動画を選んでください。再生できる形式はブラウザーによって異なります。';
  });
  function loadVideo(src, name, id = null) {
    stopHalo();video.pause();video.removeAttribute('src');video.load();
    video.src = src;activeId = id;lastPaint = -Infinity;player.classList.add('has-video');
    videoName.textContent = name;videoName.title = name;
    document.getElementById('stage-note').textContent = 'デザイン試作 · 保存したYouTubeの実ページ';
    const heading = document.querySelector('ytd-watch-metadata h1 yt-formatted-string') || document.querySelector('ytd-watch-metadata h1');
    if (heading) { heading.textContent = name;heading.title = name;heading.setAttribute('aria-label', name); }
    for (const button of document.querySelectorAll('[data-design-media]')) {
      const current = Number(button.dataset.designMedia) === activeId;
      button.setAttribute('aria-current', String(current));
      if (button.matches('ytd-playlist-panel-video-renderer')) button.toggleAttribute('selected', current);
    }
    applyPreview();video.play().catch(() => { document.getElementById('stage-note').textContent = '再生ボタンを押すと動画を再生できます。'; });
  }
  function releaseFile() { if (objectUrl) { URL.revokeObjectURL(objectUrl);objectUrl = null; } }
  function chooseVideo(item) { video.pause();releaseFile();loadVideo(item.src, item.title, item.id); }
  async function loadNativeMix() {
    // Reuse a private native playlist capture. Only the supplied local media
    // goes into the prototype; the capture is excluded from source packages.
    const response = await fetch('/design-native/playlist.json');if (!response.ok) return;
    const records = await response.json(), nodes = [];
    // Restore the DOM tree, including native nested anchors that an HTML
    // parser would relocate and turn into zero-width playback links.
    for (const record of records) {
      let node;
      if ('text' in record) node = document.createTextNode(record.text);
      else if (['script', 'style', 'link', 'iframe'].includes(record.tag)) node = document.createTextNode('');
      else {
        node = record.svg ? document.createElementNS('http://www.w3.org/2000/svg', record.tag) : document.createElement(record.tag);
        for (const [name, value] of record.attrs) {
          if (/^on/i.test(name) || ['src', 'srcset'].includes(name)) continue;
          node.setAttribute(name, name === 'href' ? '#' : value);
        }
      }
      nodes.push(node);if (record.parent >= 0 && nodes[record.parent]?.nodeType === 1) nodes[record.parent].append(node);
    }
    const playlist = nodes[0];if (!playlist?.matches('ytd-playlist-panel-renderer')) return;
    const original = playlist.querySelector('ytd-playlist-panel-video-renderer'), items = playlist.querySelector('#items');
    if (!original || !items) return;
    const model = original.cloneNode(true);items.replaceChildren();
    playlist.removeAttribute('hidden');playlist.removeAttribute('collapsed');
    const title = playlist.querySelector('.title');if (title) title.textContent = 'ミックスリスト';
    const publisher = playlist.querySelector('.publisher');if (publisher) { publisher.textContent = 'ローカル動画 · ' + mediaItems.length + '本';publisher.removeAttribute('title'); }
    for (const stale of playlist.querySelectorAll('#next-video-title, .index-message-wrapper')) stale.hidden = true;
    // Captured controls have no YouTube runtime here. Hide those controls;
    // production keeps the real controls and their existing handlers.
    for (const control of playlist.querySelectorAll('#playlist-actions, #trailing-button, #menu')) control.hidden = true;
    for (const item of mediaItems) {
      const row = model.cloneNode(true);row.removeAttribute('selected');row.removeAttribute('id');
      row.querySelector('#menu')?.remove();
      row.dataset.designMedia = item.id;
      const image = row.querySelector('img');image.src = item.thumbnail;image.alt = '';image.loading = 'eager';
      const name = row.querySelector('#video-title');name.textContent = item.title;name.title = item.title;name.setAttribute('aria-label', item.title);
      const byline = row.querySelector('#byline');if (byline) { byline.textContent = 'ローカル動画';byline.title = 'ローカル動画'; }
      const index = row.querySelector('#index');if (index) index.textContent = item.id;
      for (const badge of row.querySelectorAll('.ytBadgeShapeText, #time-status #text')) badge.textContent = clock(item.duration);
      for (const anchor of row.querySelectorAll('a')) anchor.href = '#local-video-' + item.id;
      row.querySelector('#wc-endpoint')?.setAttribute('aria-label', item.title + 'を再生');
      row.addEventListener('click', () => chooseVideo(item));
      items.append(row);
    }
    const container = nativeRecommendations.closest('#secondary-inner');
    container.querySelector('ytd-playlist-panel-renderer')?.remove();container.insertBefore(playlist, nativeRecommendations.closest('#related'));
  }
  function setupSidebar() {
    if (new URLSearchParams(location.search).has('assistant-demo')) {
      const inner = document.querySelector('#secondary-inner');
      let panels = inner.querySelector('#panels');
      if (!panels) { panels = element('div');panels.id = 'panels';inner.prepend(panels); }
      const panel = element('ytd-engagement-panel-section-list-renderer', 'stage-assistant-demo');
      panel.setAttribute('target-id', 'PAyouchat');panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
      const header = element('header');header.append(element('strong', '', 'この動画について質問する'));
      header.append(iconButton('質問パネルを閉じる', 'x', () => panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN')));
      const content = element('div');content.id = 'content';
      content.append(element('p', '', 'Geminiの表示位置を確認するための試作です。質問は送信しません。'));
      const reopen = iconButton('質問パネルを開く', 'panels-top-left', () => panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED'), 'stage-assistant-open');
      reopen.append(element('span', '', 'この動画について質問する'));
      document.querySelector('#above-the-fold')?.append(reopen);
      panel.append(header, content);panels.append(panel);
    }
    if (new URLSearchParams(location.search).has('chat-demo')) {
      const inner = document.querySelector('#secondary-inner');
      let chat = inner.querySelector('ytd-live-chat-frame');
      if (!chat) { chat = element('ytd-live-chat-frame');inner.prepend(chat); }
      chat.removeAttribute('hidden');chat.style.setProperty('display', 'block', 'important');
      chat.style.height = '520px';
      const frame = element('iframe');frame.src = '/chat-demo';frame.title = '表示確認用の試作チャット';
      frame.style.cssText = 'display:block;width:100%;height:100%;border:0;border-radius:12px';chat.replaceChildren(frame);
      ambientStore.set('sidebarEnabled', true);ambientStore.set('sidebarFilter', 'all');ambientStore.set('sidebarParallel', true);
    }
    sidebar = LiquidWatchSidebar.create({ stage: true, store: ambientStore, enabled: false, selectFilter(button) {
      for (const tab of nativeRecommendations.querySelectorAll('[role="tab"]')) {
        tab.setAttribute('aria-selected', String(tab === button));
        tab.closest('yt-chip-cloud-chip-renderer')?.toggleAttribute('selected', tab === button);
      }
    } });
  }
  document.getElementById('stage-file').addEventListener('change', event => {
    const file = event.target.files[0];if (!file) return;
    video.pause();releaseFile();objectUrl = URL.createObjectURL(file);loadVideo(objectUrl, file.name);
    event.target.value = '';
  });
  async function loadList() {
    try {
      const response = await fetch('/design-media-list');if (!response.ok) throw new Error('Media list unavailable');
      mediaItems = await response.json();related.replaceChildren();
      for (const item of mediaItems) {
        const row = rowTemplate.cloneNode(true);row.dataset.designMedia = item.id;row.setAttribute('role', 'button');row.tabIndex = 0;row.setAttribute('aria-label', item.id + '. ' + item.title + 'を再生');
        const image = row.querySelector('img');image.src = item.thumbnail;image.removeAttribute('srcset');image.alt = '';image.loading = 'eager';
        const title = row.querySelector('.ytLockupMetadataViewModelTitle .ytAttributedStringHost');
        if (title) title.textContent = item.title;
        const titleLink = row.querySelector('.ytLockupMetadataViewModelTitle');
        if (titleLink) { titleLink.title = item.title;titleLink.setAttribute('aria-label', item.title); }
        const heading = row.querySelector('h3');if (heading) { heading.setAttribute('aria-label', item.title);heading.title = item.title; }
        const badge = row.querySelector('.ytThumbnailBadgeViewModelHost .ytBadgeShapeText');if (badge) badge.textContent = clock(item.duration);
        const metadata = row.querySelectorAll('.ytContentMetadataViewModelMetadataRow');
        const caption = metadata[0]?.querySelector('.ytAttributedStringHost');
        if (caption) { caption.textContent = 'ローカル動画';metadata[0].replaceChildren(caption); }
        for (const extra of [...metadata].slice(1)) extra.remove();
        for (const anchor of row.querySelectorAll('a')) anchor.href = '#local-video-' + item.id;
        row.addEventListener('click', () => chooseVideo(item));
        row.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault();chooseVideo(item); } });related.append(row);
      }
      await loadNativeMix().catch(() => {});setupSidebar();
      if (mediaItems.length) chooseVideo(mediaItems[0]);
      else related.append(element('p', 'yt-muted', '動画を選ぶと、左のプレイヤーで再生できます。'));
    } catch { related.replaceChildren(element('p', 'yt-muted', '動画一覧を読み込めませんでした。')); }
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopHalo();else paintHalo(); });
  window.addEventListener('pagehide', event => {
    stopHalo();video.pause();
    if (!event.persisted) { for (const choice of stageChoices) choice.dispose();globalThis.stageSettingsDesigns?.dispose();settingsCard?.dispose();quickUI.dispose();sidebar?.dispose();commentHover.dispose();commentMenus.dispose();headerFade.dispose();channelCards.dispose(); }
    if (!event.persisted && objectUrl) { URL.revokeObjectURL(objectUrl);objectUrl = null; }
  });
  for (const placeholder of document.querySelectorAll('[data-icon]')) placeholder.replaceChildren(icons.create(placeholder.dataset.icon));
  syncPlayer();render();loadList();
  if (new URLSearchParams(location.search).get('view') === 'settings-designs') {
    globalThis.stageSettingsDesigns = LiquidSettingsDesigns.mount({ icons, storeForSite: stageStore });
  } else quickUI.show(launcher);
})().catch(error => { console.error(error); });
