/* Local-only settings architecture comparison. Reuses real definitions and
 * controls with the stage's in-memory stores; never writes extension storage. */
(() => {
  'use strict';
  const patterns = [
    { id: 'A', label: '機能から選ぶ', description: '機能を直接選ぶ。詳細だけを右側に表示。' },
    { id: 'B', label: 'サイトから選ぶ', description: 'サイトの一覧から詳細へ。一列で順に進む。' },
    { id: 'C', label: '用途から選ぶ', description: '外観・動画と再生・一般に分けて選ぶ。' }
  ];
  const topics = {
    ambient: { label: 'アンビエント背景', icon: 'sun', group: 'appearance', toggle: 'enabled' },
    surfaces: { label: '操作画面の濃さ', icon: 'panels-top-left', group: 'surfaces' },
    rendering: { label: '黒帯と描画', icon: 'scan-line', group: 'rendering' },
    sidebar: { label: '動画一覧', icon: 'panels-top-left', group: 'watch-sidebar', toggle: 'sidebarEnabled' },
    safety: { label: '高速点滅の警告', icon: 'shield-check', group: 'safety', toggle: 'flashWarning' },
    siteAppearance: { label: 'Liquidの外観', icon: 'panels-top-left', group: 'site-appearance', toggle: 'appearanceEnabled' },
    playback: { label: '音声・再生速度', icon: 'volume-2', global: true, toggle: 'playbackEnabled' },
    general: { label: '一般', icon: 'settings-2', global: true, group: 'general' }
  };
  const categories = [
    { id: 'appearance', label: '外観', icon: 'panels-top-left' },
    { id: 'video', label: '動画と再生', icon: 'volume-2' },
    { id: 'general', label: '一般', icon: 'settings-2' }
  ];
  const text = value => typeof value === 'string' ? value : value?.ja || '';
  function mount({ icons, storeForSite }) {
    const el = (tag, cls, value) => { const node = document.createElement(tag);if (cls) node.className = cls;if (value !== undefined) node.textContent = value;return node; };
    const btn = (name, handler, cls = '', icon) => {
      const node = el('button', cls);node.type = 'button';if (icon) node.append(icons.create(icon));
      if (name) node.append(el('span', '', name));node.addEventListener('click', handler);return node;
    };
    const iconButton = (name, icon, handler) => { const node = btn('', handler, 'pd-icon', icon);node.setAttribute('aria-label', name);return node; };
    const root = el('div', 'pd-stage');root.id = 'settings-patterns';
    const toolbar = el('div', 'pd-toolbar'), tabs = el('div', 'pd-pattern-tabs');tabs.setAttribute('role', 'tablist');tabs.setAttribute('aria-label', '設定の構成案');
    const caption = el('span', 'pd-pattern-caption'), reveal = el('div', 'pd-reveal');
    const showLarge = btn('大きな設定', () => show(large), 'pd-reveal-button');
    const showSmall = btn('簡易パネル', () => show(small), 'pd-reveal-button');reveal.append(showLarge, showSmall);
    toolbar.append(tabs, caption, reveal);root.append(toolbar);document.body.append(root);
    let pattern = (new URLSearchParams(location.search).get('pattern') || 'A').toUpperCase();
    if (!patterns.some(item => item.id === pattern)) pattern = 'A';
    const large = makePreview('large', '大きな設定画面'), small = makePreview('small', '簡易パネル');
    const choiceSheet = new CSSStyleSheet();choiceSheet.replaceSync(LiquidChoiceMenu.css + LiquidPlaybackCard.css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, choiceSheet];
    for (const item of patterns) {
      const tab = btn(item.id + '　' + item.label, () => choose(item.id), 'pd-pattern-tab');
      tab.dataset.pattern = item.id;tab.setAttribute('role', 'tab');
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();const index = patterns.findIndex(value => value.id === pattern);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : -1) + 3) % 3;
        choose(patterns[next].id);tabs.children[next].focus();
      });tabs.append(tab);
    }
    function makePreview(kind, name) {
      const shell = el('section', 'pd-preview pd-' + kind);shell.id = 'pattern-' + kind;
      shell.setAttribute('role', 'dialog');shell.setAttribute('aria-label', name);shell.setAttribute('aria-modal', 'false');
      const header = el('header', 'pd-header'), back = iconButton('戻る', 'arrow-left', () => goBack(instance));
      back.classList.add('pd-back-label');back.append(el('span'));
      const title = el('strong', '', 'Flexible UI'), size = el('span', 'pd-size', name);
      const close = iconButton(name + 'を閉じる', 'x', () => { clearMenus(instance);shell.hidden = true; });
      header.append(back, title, size, close);
      const body = el('div', 'pd-body'), nav = el('nav', 'pd-nav'), content = el('main', 'pd-content');
      nav.setAttribute('aria-label', name + 'の分類');body.append(nav, content);
      const footer = el('footer', 'pd-footer', 'デザイン試作 · このページだけに反映');shell.append(header, body, footer);root.append(shell);
      const instance = { kind, shell, header, title, back, nav, content, footer, controls: [], menus: [], cards: [], history: [],
        state: null, help: null };
      return instance;
    }
    function initial(instance) {
      if (pattern === 'A') return { site: 'youtube', topic: instance.kind === 'large' ? 'ambient' : '', category: '', page: 'features' };
      if (pattern === 'B') return { site: 'youtube', topic: '', category: '', page: instance.kind === 'large' ? 'sites' : 'features' };
      return { site: 'youtube', topic: '', category: instance.kind === 'large' ? 'appearance' : '', page: 'categories' };
    }
    function choose(id) {
      pattern = id;const url = new URL(location.href);url.searchParams.set('pattern', id);history.replaceState(null, '', url);
      for (const tab of tabs.children) { const active = tab.dataset.pattern === id;tab.setAttribute('aria-selected', String(active));tab.tabIndex = active ? 0 : -1; }
      caption.textContent = patterns.find(item => item.id === id).description;
      for (const instance of [large, small]) { instance.history = [];instance.state = initial(instance);instance.shell.hidden = false;render(instance); }
      root.dataset.pattern = pattern;root.dataset.mobileView = 'large';
    }
    function show(instance) { instance.shell.hidden = false;root.dataset.mobileView = instance.kind; }
    function clearMenus(instance) { for (const choice of instance.menus) choice.close(false);instance.help?.remove();instance.help = null; }
    function clean(instance) {
      clearMenus(instance);for (const choice of instance.menus) choice.dispose();for (const card of instance.cards) card.dispose();
      instance.menus = [];instance.cards = [];instance.controls = [];
    }
    function push(instance, changes) {
      instance.history.push({ state: { ...instance.state }, scroll: instance.content.scrollTop, focus: document.activeElement?.id });
      instance.state = { ...instance.state, ...changes };render(instance);instance.content.querySelector('h2')?.focus({ preventScroll: true });
    }
    function goBack(instance) {
      const previous = instance.history.pop();if (!previous) return;
      instance.state = previous.state;render(instance);instance.content.scrollTop = previous.scroll;
      if (previous.focus) document.getElementById(previous.focus)?.focus({ preventScroll: true });
    }
    function siteTabs(instance) {
      const tabs = el('div', 'pd-sites');tabs.setAttribute('role', 'tablist');tabs.setAttribute('aria-label', '設定するサイト');
      for (const site of LiquidSites.list()) {
        const tab = btn(site.name, () => {
          instance.state.site = site.id;
          if (pattern === 'A' && instance.state.topic && !topics[instance.state.topic].global) instance.state.topic = site.id === 'youtube' ? 'ambient' : 'siteAppearance';
          instance.history = [];render(instance);document.getElementById(instance.kind + '-site-' + site.id)?.focus({ preventScroll: true });
        }, 'pd-site-tab');tab.id = instance.kind + '-site-' + site.id;tab.setAttribute('role', 'tab');tab.setAttribute('aria-selected', String(site.id === instance.state.site));tabs.append(tab);
      }return tabs;
    }
    function title(instance, name, scope) {
      const heading = el('div', 'pd-heading'), h2 = el('h2', '', name);h2.tabIndex = -1;
      heading.append(h2);if (scope) heading.append(el('span', 'pd-scope', scope));instance.content.append(heading);
    }
    const available = site => site === 'youtube' ? ['ambient', 'surfaces', 'sidebar', 'safety'] : ['siteAppearance'];
    const scopeName = state => LiquidSites.list().find(site => site.id === state.site)?.name || state.site;
    function groupFor(instance, topic) {
      return (topic.global ? LiquidSites.globalGroups : LiquidSites.list().find(site => site.id === instance.state.site)?.groups || []).find(group => group.id === topic.group);
    }
    function toggle(instance, key, label, scope) {
      const hit = el('label', 'pd-switch-hit'), input = el('input');input.type = 'checkbox';input.id = instance.kind + '-toggle-' + key;
      input.setAttribute('role', 'switch');input.setAttribute('aria-label', label);hit.htmlFor = input.id;hit.append(input);
      input.addEventListener('change', () => storeForSite(scope).set(key, input.checked));
      instance.controls.push({ input, key, scope, type: 'toggle' });return hit;
    }
    function topicRow(instance, id) {
      const topic = topics[id], scope = topic.global ? 'global' : instance.state.site;
      const row = el('div', 'pd-topic-row'), open = btn(topic.label, () => push(instance, { topic: id }), 'pd-row-open', topic.icon);
      open.id = instance.kind + '-open-' + id;row.append(open);
      if (topic.toggle) {
        const gear = iconButton(topic.label + 'の設定を開く', 'settings-2', () => push(instance, { topic: id }));
        gear.id = instance.kind + '-gear-' + id;row.append(gear, toggle(instance, topic.toggle, topic.label, scope));
      } else row.append(iconButton(topic.label + 'の設定を開く', 'chevron-right', () => push(instance, { topic: id })));
      return row;
    }
    function list(instance, ids, label) {
      if (label) instance.content.append(el('p', 'pd-section-label', label));
      const group = el('div', 'pd-list');group.append(...ids.map(id => topicRow(instance, id)));instance.content.append(group);
    }
    function showHelp(instance, definition, anchor) {
      instance.help?.remove();const help = el('aside', 'pd-help');help.setAttribute('role', 'dialog');help.setAttribute('aria-label', text(definition.label) + 'の説明');
      const heading = el('div', 'pd-help-head');heading.append(el('strong', '', text(definition.label)), iconButton('説明を閉じる', 'x', () => { help.remove();instance.help = null;anchor.focus(); }));
      help.append(heading, el('p', '', text(definition.description)));instance.shell.append(help);instance.help = help;
    }
    function field(instance, definition, scope) {
      const row = el('div', 'pd-field pd-field-' + definition.type), labelWrap = el('div', 'pd-field-label'), label = el('label', '', text(definition.label));
      labelWrap.append(label);row.append(labelWrap);
      if (definition.description) {
        let info;info = iconButton(text(definition.label) + 'の説明', 'info', () => showHelp(instance, definition, info));labelWrap.append(info);
      }
      const key = definition.key, id = instance.kind + '-field-' + key, store = storeForSite(scope);label.htmlFor = id;
      if (definition.type === 'toggle') { const control = toggle(instance, key, text(definition.label), scope);label.htmlFor = control.firstElementChild.id;row.append(control); }
      else if (definition.type === 'select') {
        const choice = LiquidChoiceMenu.create({ icons, overlayRoot: instance.shell, container: instance.shell, boundary: instance.shell,
          id, label: text(definition.label), choices: definition.choices.map(([value, label]) => [value, text(label)]), value: store.values[key],
          onChange: value => store.set(key, value) });
        instance.menus.push(choice);instance.controls.push({ key, scope, choice });row.append(choice.element);
      } else {
        const input = el('input');input.type = 'range';input.id = id;input.min = definition.min;input.max = definition.max;input.step = definition.step || 1;
        const output = el('output');output.htmlFor = id;
        input.addEventListener('input', () => store.set(key, Number(input.value) / (definition.scale || 1)));
        instance.controls.push({ key, scope, input, output, definition });row.append(input, output);
      }return row;
    }
    function detail(instance, id) {
      const topic = topics[id], scope = topic.global ? 'global' : instance.state.site;
      title(instance, topic.label, topic.global ? 'すべてのサイトで共通' : scopeName(instance.state));
      if (id === 'playback') {
        const card = LiquidPlaybackCard.bind(storeForSite('global'), { icons, language: 'ja', prefix: instance.kind === 'large' ? '大きな設定' : '簡易設定' });
        instance.cards.push(card);instance.content.append(card.element);return;
      }
      const definition = groupFor(instance, topic);if (!definition) return;
      const fields = el('div', 'pd-list');fields.append(...definition.fields.map(def => field(instance, def, scope)));instance.content.append(fields);
      if (id === 'ambient') {
        const row = el('div', 'pd-list pd-extra');row.append(topicRow(instance, 'rendering'));instance.content.append(row);
      }
      if (id === 'surfaces') instance.content.append(el('p', 'pd-note', 'アンビエント背景がオンのときに適用します。'));
      if (id === 'safety') instance.content.append(el('p', 'pd-note', 'アンビエント背景の濃さが51%以上のときに検知します。50%以下では検知を止めます。'));
      if (id === 'sidebar') instance.content.append(el('p', 'pd-note', 'オフではYouTubeの元の一覧とタグを表示します。'));
    }
    function render(instance) {
      clean(instance);instance.nav.replaceChildren();instance.content.replaceChildren();instance.content.scrollTop = 0;
      const state = instance.state;instance.back.hidden = !instance.history.length;
      if (instance.history.length) {
        const previous = instance.history.at(-1).state;
        const name = previous.topic ? topics[previous.topic].label : previous.category ? categories.find(item => item.id === previous.category).label : previous.page === 'features' && pattern === 'B' ? scopeName(previous) : '設定';
        instance.back.lastElementChild.textContent = name;instance.back.setAttribute('aria-label', name + 'に戻る');
      }
      instance.title.textContent = instance.kind === 'small' && state.topic ? topics[state.topic].label : 'Flexible UI';
      const hasNav = instance.kind === 'large' && pattern !== 'B';instance.nav.hidden = !hasNav;
      if (hasNav) {
        const entries = pattern === 'A' ? [...available(state.site), 'playback', 'general'].map(id => ({ id, ...topics[id] })) : categories;
        for (const item of entries) {
          const button = btn(item.label, () => { instance.history = [];instance.state = { ...state, topic: pattern === 'A' ? item.id : '', category: pattern === 'C' ? item.id : '' };render(instance); }, 'pd-nav-button', item.icon);
          button.dataset.topic = item.id;button.setAttribute('aria-current', (pattern === 'A' ? state.topic : state.category) === item.id ? 'page' : 'false');instance.nav.append(button);
        }
      }
      if (state.topic) {
        if (!topics[state.topic].global && pattern !== 'B') instance.content.append(siteTabs(instance));
        detail(instance, state.topic);
      } else if (pattern === 'B' && state.page === 'sites') {
        title(instance, '設定');instance.content.append(el('p', 'pd-section-label', 'サイトごとの設定'));
        const group = el('div', 'pd-list');
        for (const site of LiquidSites.list()) {
          const button = btn(site.name, () => push(instance, { site: site.id, page: 'features' }), 'pd-site-row', site.id === 'youtube-music' ? 'music-2' : site.id === 'youtube' ? 'play' : 'panels-top-left');button.append(icons.create('chevron-right'));group.append(button);
        }instance.content.append(group);list(instance, ['playback', 'general'], 'すべてのサイトで共通');
      } else if (pattern === 'A' || pattern === 'B') {
        title(instance, scopeName(state), 'このサイトの設定');list(instance, available(state.site));list(instance, ['playback', 'general'], 'すべてのサイトで共通');
      } else if (!state.category) {
        title(instance, '設定');const group = el('div', 'pd-list');
        for (const item of categories) { const button = btn(item.label, () => push(instance, { category: item.id }), 'pd-site-row', item.icon);button.append(icons.create('chevron-right'));group.append(button); }instance.content.append(group);
      } else if (state.category === 'general') detail(instance, 'general');
      else {
        instance.content.append(siteTabs(instance));title(instance, state.category === 'appearance' ? '外観' : '動画と再生', scopeName(state));
        if (state.category === 'appearance') list(instance, state.site === 'youtube' ? ['ambient', 'surfaces'] : ['siteAppearance']);
        else { list(instance, ['playback'], 'すべてのサイトで共通');if (state.site === 'youtube') list(instance, ['sidebar', 'safety'], 'YouTube'); }
      }
      if (instance.kind === 'small') {
        const all = btn('大きな設定で開く', () => {
          large.state = { ...instance.state };large.history = [];render(large);show(large);
        }, 'pd-all', 'settings-2');all.append(icons.create('chevron-right'));instance.footer.replaceChildren(all);
      }
      refresh(instance);
    }
    function refresh(instance) {
      const common = storeForSite('global').values;instance.shell.dataset.theme = common.theme;
      instance.shell.dataset.solid = String(common.reduceTransparency);
      for (const control of instance.controls) {
        const value = storeForSite(control.scope).values[control.key];
        if (control.choice) control.choice.update(value);
        else if (control.type === 'toggle') control.input.checked = !!value;
        else { control.input.value = Math.round(value * (control.definition.scale || 1));control.output.textContent = control.input.value + (control.definition.unit || ''); }
      }
    }
    choose(pattern);
    const stops = ['global', ...LiquidSites.list().map(site => site.id)].map(scope => storeForSite(scope).subscribe(() => { refresh(large);refresh(small); }));
    const keydown = event => {
      if (event.key !== 'Escape' || LiquidChoiceMenu.hasOpenMenu(document)) return;
      const instance = small.shell.contains(document.activeElement) ? small : large;
      if (instance.help) { instance.help.remove();instance.help = null; }
      else if (instance.history.length) goBack(instance);
      else instance.shell.hidden = true;
      event.preventDefault();event.stopPropagation();
    };
    root.addEventListener('keydown', keydown);
    return { show: () => { show(large);show(small); }, choose,
      dispose() { for (const stop of stops) stop();clean(large);clean(small);root.remove();document.adoptedStyleSheets = document.adoptedStyleSheets.filter(sheet => sheet !== choiceSheet); } };
  }
  globalThis.LiquidSettingsDesigns = Object.freeze({ mount });
})();
