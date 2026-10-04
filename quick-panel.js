/* One compact panel for the extension and the local design stage. */
(() => {
  'use strict';
  function resolveTheme(preference, { document: doc = globalThis.document, siteId = 'youtube',
    matchMedia = query => (doc?.defaultView || globalThis).matchMedia?.(query) } = {}) {
    if (preference === 'light' || preference === 'dark') return preference;
    if (siteId === 'youtube' && doc?.documentElement) {
      const link = doc.querySelector?.('link#efyt-dark-theme'), media = link?.media?.trim() || '';
      const enhancerDark = link && !link.disabled && !link.hasAttribute?.('disabled') && (!media || media.toLowerCase() === 'all' || matchMedia?.(media)?.matches);
      return doc.documentElement.hasAttribute?.('dark') || enhancerDark ? 'dark' : 'light';
    }
    return matchMedia?.('(prefers-color-scheme:dark)')?.matches ? 'dark' : 'light';
  }
  function observeTheme(handler, { document: doc = globalThis.document, siteId = 'youtube',
    matchMedia = query => (doc?.defaultView || globalThis).matchMedia?.(query),
    MutationObserver: Observer = doc?.defaultView?.MutationObserver || globalThis.MutationObserver } = {}) {
    const options = { document: doc, siteId, matchMedia };let current = resolveTheme('system', options), stopped = false, observedHead = null;
    const observeHead = () => { if (observer && doc.head && observedHead !== doc.head) { observedHead = doc.head;observer.observe(doc.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['id', 'disabled', 'href', 'media'] }); } };
    const changed = () => { if (stopped) return;observeHead();const next = resolveTheme('system', options);if (next !== current) { current = next;handler(); } };
    const scheme = matchMedia?.('(prefers-color-scheme:dark)');scheme?.addEventListener?.('change', changed);
    const observer = siteId === 'youtube' && Observer && doc?.documentElement ? new Observer(changed) : null;
    observer?.observe(doc.documentElement, { attributes: true, childList: true, attributeFilter: ['dark'] });observeHead();
    return () => { stopped = true;observer?.disconnect();scheme?.removeEventListener?.('change', changed); };
  }
  const copy = {
    ja: { close: '簡易パネルを閉じる', ambient: 'アンビエント背景', ambientSettings: 'アンビエント背景の設定を開く',
      back: '簡易パネルに戻る', ambientBack: 'アンビエント背景に戻る', sidebar: '動画一覧を整理', sidebarSettings: '動画一覧の設定を開く', all: 'すべての設定', failed: '設定を保存できませんでした。', loadFailed: '設定を読み込めませんでした。ページを再読み込みしてください。', disconnected: 'ページを再読み込みしてください。', retry: '再試行', reload: '再読み込み' },
    en: { close: 'Close quick panel', ambient: 'Ambient background', ambientSettings: 'Open ambient background settings',
      back: 'Back to quick panel', ambientBack: 'Back to ambient background', sidebar: 'Organize the video list', sidebarSettings: 'Open video list settings', all: 'All settings', failed: 'Could not save settings.', loadFailed: 'Could not load settings. Reload this page.', disconnected: 'Reload this page.', retry: 'Retry', reload: 'Reload' }
  };
  const css = `
    :host{all:initial;box-sizing:border-box;--solid-face:#333339;--solid-group:#3b3b42;--face:#2b2b32ad;--field:#3b3b3e;--ink:#f1f1f4;--muted:#b1b1ba;--line:#ffffff12;--hover:#ffffff08;--group:#ffffff0e;--track:#545458;--on:#dbdbe0;--thumb:#fafafb;--on-thumb:#4a4a50;--accent:#d3d3da;position:fixed!important;inset:64px 16px auto auto!important;z-index:2147483500!important;display:block!important;width:330px!important;max-width:calc(100vw - 24px)!important;margin:0!important;padding:0!important;border:0!important;background:transparent!important;pointer-events:auto!important;color-scheme:dark}.panel{padding:12px;border:1px solid #ffffff1f;border-radius:22px;background:var(--face);backdrop-filter:blur(28px) saturate(1.2);color:var(--ink);box-shadow:inset 0 1px 0 #ffffff08,0 12px 40px #0006;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-height:calc(100dvh - 80px);overflow:auto;scrollbar-width:thin;text-align:start}
    :host([hidden]),[hidden]{display:none!important}*{box-sizing:border-box}button,input{font:inherit;color:inherit}button{border:0;background:transparent;cursor:pointer;border-radius:8px}button:hover{background:var(--hover)}svg{width:20px;height:20px;flex-shrink:0;vertical-align:middle;pointer-events:none}:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    :host{--selected:var(--on);--selected-ink:var(--on-thumb)}
    :host([data-anchored=true]){inset:auto!important;left:var(--panel-left)!important;top:var(--panel-top)!important}:host([data-anchored=true]) .panel{max-height:calc(100dvh - 24px)}
    :host([data-theme=light]){--solid-face:#f3f3f5;--solid-group:#fff;--face:#f3f3f5d1;--field:#f0f0f3;--ink:#232327;--muted:#797980;--line:#00000009;--hover:#00000004;--group:#ffffff52;--track:#d0d0d5;--on:#525259;--thumb:#fff;--on-thumb:#fff;--accent:#595963;color-scheme:light}:host([data-theme=light]) .panel{border-color:#ffffffba}
    header{display:flex;align-items:center;justify-content:space-between;padding:0 0 10px 12px}header strong{font-size:16px;line-height:1.25;font-weight:600;letter-spacing:-.25px}.icon-button{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;padding:6px;flex-shrink:0}header .icon-button{width:30px;height:30px;padding:5px;border-radius:50%;background:var(--group);color:var(--muted)}header .icon-button:hover{background:var(--hover);color:var(--ink)}
    .ambient-row{display:flex;align-items:center;gap:6px;min-height:44px;padding:0 10px;background:var(--group);border-radius:12px}.ambient-label{flex:1;min-width:0;font-size:13px;font-weight:500;cursor:pointer}.ambient-settings{color:var(--muted)}.ambient-settings:hover{color:var(--ink)}.switch-hit{display:flex;align-items:center;justify-content:center;flex:0 0 46px;width:46px;min-height:44px;cursor:pointer}
    input[type=checkbox]{appearance:none;position:relative;width:36px;height:22px;margin:0;border:0;border-radius:14px;background:var(--track);cursor:pointer}input[type=checkbox]::before{content:"";position:absolute;left:2px;top:2px;width:18px;height:18px;border-radius:50%;background:var(--thumb);box-shadow:0 1px 2px #0002;transition:transform .12s}input[type=checkbox]:checked{background:var(--on)}input[type=checkbox]:checked::before{background:var(--on-thumb);transform:translateX(14px)}
    .playback-slot{margin-top:8px}.playback-slot .rate-head>strong{font-size:13px;font-weight:500}.playback-slot .rate-head{min-height:44px}.rate-card{width:100%}footer{margin-top:10px;padding-top:8px;border-top:1px solid var(--line)}.all-settings{width:100%;display:flex;align-items:center;gap:8px;min-height:38px;padding:6px 12px;border-radius:12px;text-align:left;font-size:12px;font-weight:500}.all-settings .chevron{margin-left:auto;width:18px;height:18px}
    .save-notice{margin:8px 0 0;padding:8px 10px;background:var(--group);border-radius:8px;font-size:12px}.save-notice button{margin-top:4px;min-height:28px;padding:4px 8px;border:1px solid var(--line)}
    header .back{margin-left:-5px;margin-right:6px;background:transparent}header strong{margin-right:auto}.panel[data-view=ambient]{display:flex;flex-direction:column}.panel[data-view=ambient] header,.panel[data-view=ambient] footer,.panel[data-view=ambient] .save-notice{flex-shrink:0}.ambient-editor{min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}.ambient-fields,.ambient-links{border-radius:14px;background:var(--group);padding:0 12px}.ambient-links{margin-top:8px;padding:0 8px}.ambient-field+.ambient-field,.ambient-link+.ambient-link{border-top:1px solid var(--line)}.ambient-field{padding:10px 0}.ambient-field-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:24px}.ambient-field-head label{font-size:12px;font-weight:500}.ambient-field output{color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums;font-size:12px}.ambient-field[data-type=toggle]{padding:0}.ambient-field .switch-hit{flex-basis:36px;width:36px}.ambient-field input[type=range]{appearance:none;width:100%;height:24px;margin:6px 0 0;padding:0;background:transparent;cursor:pointer;touch-action:pan-y}.ambient-field input[type=range]::-webkit-slider-runnable-track{height:3px;border-radius:3px;background:var(--track)}.ambient-field input[type=range]::-webkit-slider-thumb{appearance:none;width:16px;height:16px;margin-top:-6.5px;border-radius:50%;background:var(--ink);box-shadow:0 1px 2px #0002}.ambient-field input[type=range]::-moz-range-track{height:3px;border-radius:3px;background:var(--track)}.ambient-field input[type=range]::-moz-range-thumb{width:16px;height:16px;border:0;border-radius:50%;background:var(--ink)}.ambient-description{margin:4px 0 10px;color:var(--muted);font-size:11px;line-height:1.5}.ambient-link{width:100%;min-height:40px;display:flex;align-items:center;gap:8px;padding:4px 2px;font-size:12px;text-align:start;border-radius:0}.ambient-link>svg{width:18px;height:18px;color:var(--muted)}.ambient-link .chevron{margin-left:auto;width:16px;height:16px}
    .sidebar-row{margin-top:8px}.loaded-version{font-size:10px;color:var(--muted);margin-inline:8px;white-space:nowrap}
    .topic-list .ambient-row:hover,.topic-list .ambient-row:focus-within{background:var(--hover)}.topic-list .ambient-row>button:hover{background:transparent}
    .topic-list+.topic-list{margin-top:12px}.quick-actions .ambient-row[data-enabled=true] .topic-label svg{color:#34c759}:host([data-theme=light]) .quick-actions .ambient-row[data-enabled=true] .topic-label svg{color:#248a3d}
    :host([data-solid=true]){--face:var(--solid-face);--group:var(--solid-group)}:host([data-solid=true]) .panel{backdrop-filter:none}
    @media(prefers-reduced-transparency:reduce){:host([data-theme]){--face:var(--solid-face);--group:var(--solid-group)}.panel{backdrop-filter:none}}
    @supports not (backdrop-filter:blur(1px)){:host([data-theme]){--face:var(--solid-face);--group:var(--solid-group)}.panel{backdrop-filter:none}}
    @media(prefers-reduced-motion:reduce){input[type=checkbox]::before{transition:none}}
  `;
  function create({ icons, ambientStore, playbackStore, ambientGroups, onAllSettings, onVisibilityChange = () => {},
    registry = globalThis.LiquidSites, siteId = 'youtube', loadedVersion = '', id = 'liquid-ui-quick-panel', document: doc = globalThis.document,
    CSSStyleSheet: Sheet = globalThis.CSSStyleSheet, playback = globalThis.LiquidPlaybackCard,
    choices = globalThis.LiquidChoiceMenu, colors = globalThis.LiquidColorPicker, reload = () => globalThis.location.reload() }) {
    const node = (tag, cls, text) => { const el = doc.createElement(tag);if (cls) el.className = cls;if (text !== undefined) el.textContent = text;return el; };
    const host = node('div');host.id = id;host.hidden = true;host.setAttribute('role', 'dialog');host.setAttribute('aria-label', 'Flexible UI');
    const root = host.attachShadow({ mode: 'open' }), sheet = new Sheet();
    sheet.replaceSync(css + playback.css + choices.css + (colors?.css || '') + '.back.icon-button{width:auto;max-width:140px;gap:3px;font-size:11px;white-space:nowrap;color:var(--muted)}.back.icon-button svg{width:18px;height:18px}header strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}.topic-list .ambient-row{position:relative;min-height:46px;border-radius:0;background:transparent;padding:0 8px 0 0;gap:0}.topic-list{background:var(--group);border-radius:14px;padding:0;overflow:hidden}.topic-list .ambient-row+.ambient-row::before{content:"";position:absolute;top:0;left:38px;right:12px;border-top:1px solid var(--line)}.topic-list button:focus-visible{outline-offset:-3px}.topic-label{display:flex;align-items:center;gap:8px;flex:1;align-self:stretch;text-align:start;min-width:0;padding:10px 12px;font-size:12px;font-weight:500}.topic-label svg{width:18px;height:18px;color:var(--muted)}.scope-caption{font-size:10px;color:var(--muted);margin:16px 12px 6px}.scope-caption:first-child{margin-top:4px}.quick-help{position:absolute;left:13px;top:12px;z-index:2;width:calc(100% - 26px);border:1px solid var(--line);border-radius:14px;padding:12px;background:var(--solid-group);box-shadow:0 8px 30px #0005;font:12px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:auto;overscroll-behavior:contain;overflow-wrap:anywhere;color:var(--ink)}.help-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}.help-heading .icon-button{width:26px;height:26px;padding:5px}.quick-help p{margin:6px 0 0;color:var(--muted)}.field-info{width:24px;height:24px;padding:4px;color:var(--muted)}.field-info svg{width:16px;height:16px}.ambient-field-head>label:not(.switch-hit){flex:1;min-width:0}.ambient-editor{scrollbar-color:#8c8c9560 transparent}.ambient-editor::-webkit-scrollbar{width:4px}.ambient-editor::-webkit-scrollbar-thumb{background:#8c8c9560;border-radius:4px}.ambient-editor::-webkit-scrollbar-track{background:transparent}.ambient-editor::-webkit-scrollbar-button{display:none}');
    root.adoptedStyleSheets = [sheet];
    const panel = node('div', 'panel'), header = node('header'), back = node('button', 'icon-button back'), backText = node('span'), brand = node('strong', '', 'Flexible UI'), close = node('button', 'icon-button');
    const version = node('span', 'loaded-version', loadedVersion);
    back.type = close.type = 'button';back.hidden = true;back.append(icons.create('arrow-left'), backText);close.append(icons.create('x'));header.append(back, brand, version, close);
    const editor = node('div', 'ambient-editor'), footer = node('footer'), all = node('button', 'all-settings'), allText = node('span');all.type = 'button';
    const chevron = icons.create('chevron-right');chevron.classList.add('chevron');all.append(icons.create('settings-2'), allText, chevron);footer.append(all);
    const notice = node('div', 'save-notice'), message = node('div'), retry = node('button');notice.hidden = true;notice.setAttribute('role', 'status');retry.type = 'button';notice.append(message, retry);
    const help = node('aside', 'quick-help');help.hidden = true;help.setAttribute('role', 'dialog');help.setAttribute('aria-labelledby', id + '-help-title');
    panel.append(header, editor, footer, notice);root.append(panel, help);
    const fields = new Map(), metas = new Map(), removers = [], writers = new Map([[ambientStore, playback.createWriter(ambientStore)], [playbackStore, playback.createWriter(playbackStore)]]);
    let opener = null, card = null, language = '', disposed = false, view = 'home', history = [], firstControl = null, helpAnchor = null, playbackAnchor = null;
    const translated = value => typeof value === 'string' ? value : value?.[language] || value?.ja || '';
    const topic = key => registry.topics.find(item => item.id === key);
    const titleFor = key => key === 'home' ? (language === 'en' ? 'Settings' : '設定') : key === 'playback' ? (language === 'en' ? 'Playback adjustment' : '再生調整') : key === 'general' ? translated(registry.sections[2].label) : translated(topic(key)?.label || registry.sections.find(item => item.id === key)?.label);
    const sourceFor = item => item.global ? playbackStore : ambientStore;
    const loadFailed = meta => !!meta?.error && !meta.saveError && !(meta.saveErrors || []).length;
    const flush = () => { card?.flush();for (const writer of writers.values()) writer.flush(); };
    function closeHelp(focus = true) {
      help.hidden = true;const anchor = helpAnchor;helpAnchor = null;anchor?.setAttribute('aria-expanded', 'false');
      if (focus && anchor?.isConnected) anchor.focus({ preventScroll: true });
    }
    function showHelp(info, definition) {
      choices.closeOpenMenu?.(doc);colors?.closeOpenMenu?.(doc);
      if (!help.hidden && helpAnchor === info) { closeHelp();return; }
      closeHelp(false);helpAnchor = info;
      const heading = node('div', 'help-heading'), title = node('strong', '', translated(definition.label)), dismiss = node('button', 'icon-button');
      title.id = id + '-help-title';dismiss.type = 'button';dismiss.setAttribute('aria-label', language === 'en' ? 'Close explanation' : '説明を閉じる');dismiss.append(icons.create('x'));
      dismiss.addEventListener('click', () => closeHelp());heading.append(title, dismiss);help.replaceChildren(heading, node('p', '', translated(definition.description)));
      help.hidden = false;info.setAttribute('aria-expanded', 'true');
      const bounds = panel.getBoundingClientRect(), offset = host.getBoundingClientRect(), target = info.getBoundingClientRect();
      help.style.maxHeight = Math.max(0, bounds.height - 24) + 'px';
      const box = help.getBoundingClientRect(), below = target.bottom + 7;
      const top = Math.max(bounds.top + 12, Math.min(below + box.height <= bounds.bottom - 12 ? below : target.top - box.height - 7, bounds.bottom - box.height - 12));
      help.style.top = top - offset.top + 'px';dismiss.focus({ preventScroll: true });
    }
    function clear() { closeHelp(false);card?.dispose();card = null;for (const field of fields.values()) field.choice?.dispose();fields.clear();editor.replaceChildren();firstControl = null; }
    function navigate(key, focus = true) {
      flush();history.push({ view, focus: root.activeElement?.dataset.route, scroll: editor.scrollTop });playbackAnchor = null;view = key;render();refresh();editor.scrollTop = 0;
      if (focus) back.focus({ preventScroll: true });
    }
    function goBack() {
      flush();const previous = history.pop();if (!previous) return;view = previous.view;if (view !== 'playback') playbackAnchor = null;render();refresh();editor.scrollTop = previous.scroll;
      (editor.querySelector?.('[data-route="' + previous.focus + '"]') || firstControl)?.focus({ preventScroll: true });
    }
    function routeButton(item) {
      const destination = siteId === 'youtube' && item.toggleKey === 'playbackEnabled' ? 'playback' : item.id;
      const row = node('div', 'ambient-row'), open = node('button', 'topic-label', translated(item.label));open.type = 'button';open.dataset.route = destination;
      open.replaceChildren(icons.create(item.icon), node('span', '', translated(item.label)));open.addEventListener('click', () => navigate(destination));row.append(open);firstControl ||= open;
      const gear = node('button', 'icon-button ambient-settings');gear.type = 'button';gear.dataset.route = destination;
      gear.setAttribute('aria-label', translated(item.label) + (language === 'en' ? ' settings' : 'の設定を開く'));gear.append(icons.create(item.toggleKey ? 'settings-2' : 'chevron-right'));gear.addEventListener('click', () => navigate(destination));row.append(gear);
      if (item.toggleKey) {
        const store = sourceFor(item), input = node('input'), hit = node('label', 'switch-hit');input.type = 'checkbox';input.id = id + '-setting-' + item.toggleKey;input.setAttribute('role', 'switch');input.setAttribute('aria-label', translated(item.label));hit.htmlFor = input.id;hit.append(input);row.append(hit);
        input.addEventListener('change', () => writers.get(store).change({ [item.toggleKey]: input.checked }));fields.set(item.toggleKey, { definition: { type: 'toggle', key: item.toggleKey }, input, store, row });
      }return row;
    }
    function renderList(items, caption, className = '') {
      if (!items.length) return;if (caption) editor.append(node('p', 'scope-caption', caption));
      const list = node('div', 'topic-list' + (className ? ' ' + className : ''));list.append(...items.map(routeButton));editor.append(list);
    }
    function renderFields(group, store, caption) {
      if (!group) return;if (caption) editor.append(node('p', 'scope-caption', caption));
      const list = node('div', 'ambient-fields'), writer = writers.get(store);
      for (const definition of group.fields) {
        const field = node('div', 'ambient-field');field.dataset.type = definition.type;
        const head = node('div', 'ambient-field-head'), name = node('label', '', translated(definition.label));let input = node(['select', 'color'].includes(definition.type) ? 'button' : 'input');
        input.id = id + '-setting-' + definition.key;name.htmlFor = input.id;head.append(name);field.append(head);
        if (definition.description) {
          const info = node('button', 'field-info');info.type = 'button';info.setAttribute('aria-label', translated(definition.label) + (language === 'en' ? ' information' : 'の説明'));info.append(icons.create('info'));
          info.setAttribute('aria-haspopup', 'dialog');info.setAttribute('aria-expanded', 'false');info.addEventListener('click', () => showHelp(info, definition));head.append(info);
        }
        let output, choice;
        if (definition.type === 'toggle') {
          input.type = 'checkbox';input.setAttribute('role', 'switch');const hit = node('label', 'switch-hit');hit.htmlFor = input.id;hit.append(input);head.append(hit);input.addEventListener('change', () => writer.change({ [definition.key]: input.checked }));
        } else if (definition.type === 'color') {
          choice = colors.create({ document: doc, icons, language, overlayRoot: root, container: host, id: input.id, label: translated(definition.label),
            value: store.values[definition.key], onChange: value => writer.change({ [definition.key]: value }) });input = choice.button;head.append(choice.element);
        } else if (definition.type === 'select') {
          choice = choices.create({ document: doc, icons, overlayRoot: root, container: host, id: input.id, label: translated(definition.label),
            choices: definition.choices.map(([value, title]) => [value, translated(title)]), value: store.values[definition.key], onChange: value => writer.change({ [definition.key]: value }) });input = choice.button;head.append(choice.element);
        } else {
          input.type = 'range';input.min = definition.min;input.max = definition.max;input.step = definition.step || 1;output = node('output');output.htmlFor = input.id;head.append(output);field.append(input);
          input.addEventListener('input', () => writer.change({ [definition.key]: Number(input.value) / (definition.scale || 1) }, true));input.addEventListener('change', () => writer.flush());
        }
        fields.set(definition.key, { definition, input, output, choice, store });list.append(field);firstControl ||= input;
      }editor.append(list);
    }
    function render() {
      clear();
      if (view === 'home') { renderList(registry.quickActionsFor(siteId), '', 'quick-actions');renderList(registry.sections); }
      else if (view === 'appearance' || view === 'video') {
        for (const item of registry.topicsFor(view, siteId)) {
          if (item.id === 'playback') {
            editor.append(node('p', 'scope-caption', language === 'en' ? 'Playback · all sites' : '再生調整 · すべてのサイトで共通'));
            card = playback.bind(playbackStore, { icons, language, prefix: language === 'en' ? 'Quick panel' : '簡易パネル', document: doc });editor.append(card.element);
          } else {
            renderFields(ambientGroups.find(group => group.id === item.group), ambientStore, translated(item.label));
          }
        }
      } else if (view === 'playback') { card = playback.bind(playbackStore, { icons, language, prefix: language === 'en' ? 'Quick panel' : '簡易パネル', document: doc });editor.append(card.element); }
      else {
        const item = topic(view), store = view === 'general' ? playbackStore : sourceFor(item);
        const group = (view === 'general' ? registry.globalGroups : ambientGroups).find(group => group.id === (item?.group || 'general'));renderFields(group, store);
        if (view === 'surfaces') editor.append(node('p', 'ambient-description', language === 'en' ? 'Applies while ambient background is enabled.' : 'アンビエント背景がオンのときに適用します。'));
      }
    }
    function refresh() {
      if (disposed) return;const nextLanguage = playbackStore.values.language === 'en' ? 'en' : 'ja';
      const active = root.activeElement || doc.activeElement, retryFocused = active === retry;
      let focusKey;
      if (language !== nextLanguage) {
        focusKey = [...fields].find(([, field]) => field.input === active)?.[0];
        language = nextLanguage;flush();render();
      }
      const text = copy[language];host.lang = language;
      host.dataset.theme = resolveTheme(playbackStore.values.theme, { document: doc, siteId });host.dataset.solid = String(!!playbackStore.values.reduceTransparency);
      brand.textContent = view === 'home' ? 'Flexible UI' : titleFor(view);back.hidden = !history.length;backText.textContent = history.length ? titleFor(history.at(-1).view) : '';
      version.hidden = !loadedVersion || view !== 'home';version.setAttribute('aria-label', (language === 'en' ? 'Loaded version ' : '読み込み版 ') + loadedVersion);
      back.setAttribute('aria-label', backText.textContent + (language === 'en' ? ' — Back' : 'に戻る'));close.setAttribute('aria-label', text.close);allText.textContent = text.all;panel.dataset.view = view === 'home' ? 'home' : 'ambient';
      for (const { definition, input, output, choice, store, row } of fields.values()) {
        if (choice) choice.update(store.values[definition.key]);else if (definition.type === 'toggle') input.checked = !!store.values[definition.key];
        else { input.value = Math.round(store.values[definition.key] * (definition.scale || 1));output.textContent = input.value + (definition.unit || ''); }
        if (row) row.dataset.enabled = String(input.checked);
      }
      const errors = [...metas.values()], disconnected = errors.some(meta => meta?.reloadRequired), readingFailed = errors.some(loadFailed), failed = errors.some(meta => meta?.saveError || meta?.error);
      notice.hidden = !disconnected && !failed;message.textContent = disconnected ? text.disconnected : readingFailed ? text.loadFailed : text.failed;retry.textContent = disconnected || readingFailed ? text.reload : text.retry;
      if (!host.hidden) {
        if (focusKey) fields.get(focusKey)?.input.focus({ preventScroll: true });
        else if (retryFocused && notice.hidden) (history.length ? back : firstControl || close).focus({ preventScroll: true });
      }
      host.dataset.anchored = String(view === 'playback' && !!playbackAnchor);placePlayback();
    }
    function hide(restoreFocus = true) {
      if (host.hidden) return;flush();host.hidden = panel.hidden = true;onVisibilityChange(false);view = 'home';history = [];playbackAnchor = null;render();refresh();
      if (restoreFocus && opener?.isConnected) opener.focus({ preventScroll: true });
    }
    function show(anchor) {
      if (disposed) return;opener = anchor || doc.activeElement;refresh();const target = doc.fullscreenElement || doc.documentElement;if (host.parentElement !== target) target.append(host);
      host.hidden = panel.hidden = false;onVisibilityChange(true);firstControl?.focus({ preventScroll: true });
    }
    function placePlayback() {
      if (!playbackAnchor || host.hidden || view !== 'playback') return;
      const anchor = playbackAnchor.getBoundingClientRect(), width = win.innerWidth || 360, height = win.innerHeight || 640;
      if (!playbackAnchor.isConnected || anchor.bottom < 0 || anchor.top > height || anchor.right < 0 || anchor.left > width) { hide(false);return; }
      const box = panel.getBoundingClientRect(), left = Math.max(12, Math.min(anchor.right - box.width, width - box.width - 12));
      const below = anchor.bottom + 8, top = Math.max(12, Math.min(below + box.height <= height - 12 ? below : anchor.top - box.height - 8, height - box.height - 12));
      for (const [key, value] of [['--panel-left', left + 'px'], ['--panel-top', top + 'px']]) {
        if (host.style.setProperty) host.style.setProperty(key, value);else host.style[key] = value;
      }
    }
    function showPlayback(anchor) {
      if (disposed || siteId !== 'youtube') return false;flush();view = 'playback';history = [{ view: 'home', focus: 'playback', scroll: 0 }];playbackAnchor = anchor || doc.activeElement;
      render();refresh();show(playbackAnchor);placePlayback();back.focus({ preventScroll: true });return true;
    }
    close.addEventListener('click', () => hide());back.addEventListener('click', goBack);
    all.addEventListener('click', () => { const state = { section: topic(view)?.section || (view === 'home' ? 'appearance' : view), topic: topic(view)?.id || '' };hide();onAllSettings(state); });
    retry.addEventListener('click', async () => {
      if ([...metas.values()].some(meta => meta?.reloadRequired || loadFailed(meta))) { reload();return; }retry.disabled = true;
      try { for (const [store, meta] of metas) { const keys = (meta?.saveErrors || []).map(error => error.key);if (keys.length) await store.setMany(Object.fromEntries(keys.map(key => [key, store.values[key]])), true); } } catch {} finally { retry.disabled = false; }
    });
    for (const type of ['click', 'dblclick', 'keydown', 'keyup']) host.addEventListener(type, event => event.stopPropagation());
    const keydown = event => { if (!host.hidden && event.key === 'Escape' && !choices.hasOpenMenu(doc) && !colors?.hasOpenMenu?.(doc)) { event.preventDefault();event.stopPropagation();if (!help.hidden) closeHelp();else if (history.length) goBack();else hide(); } };
    const outside = event => {
      const path = event.composedPath();
      if (!help.hidden && !path.includes(help) && !path.includes(helpAnchor)) closeHelp(false);
      if (!host.hidden && !path.includes(host) && !path.includes(opener)) hide(false);
    };
    const dismissHelp = () => { closeHelp(false);placePlayback(); }, win = doc.defaultView || globalThis;
    editor.addEventListener('scroll', dismissHelp);win.addEventListener?.('resize', dismissHelp);
    const fullscreenChanged = () => { if (host.parentElement !== (doc.fullscreenElement || doc.documentElement)) hide(false); };
    doc.addEventListener('keydown', keydown, true);doc.addEventListener('pointerdown', outside, true);doc.addEventListener('fullscreenchange', fullscreenChanged);
    doc.addEventListener('scroll', placePlayback, true);
    refresh();for (const store of [ambientStore, playbackStore]) removers.push(store.subscribe((_, meta) => { metas.set(store, meta);refresh(); }));
    const stopTheme = observeTheme(refresh, { document: doc, siteId });
    return { element: host, root, refresh, show, showPlayback, hide, isOpen: () => !host.hidden, toggle(anchor) { if (host.hidden) show(anchor);else hide(); },
      dispose() { hide(false);disposed = true;clear();for (const writer of writers.values()) writer.dispose();for (const stop of removers) stop();doc.removeEventListener('keydown', keydown, true);doc.removeEventListener('pointerdown', outside, true);doc.removeEventListener('fullscreenchange', fullscreenChanged);doc.removeEventListener('scroll', placePlayback, true);editor.removeEventListener('scroll', dismissHelp);win.removeEventListener?.('resize', dismissHelp);stopTheme();host.remove(); }
    };
  }

  const api = { create, css, resolveTheme, observeTheme };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.LiquidQuickPanel = Object.freeze(api);
})();
