/* Shared settings shell. Runs in the extension's isolated content-script world. */
(() => {
  'use strict';
  if (globalThis.LiquidUI || window.top !== window) return;
  const extension = typeof browser !== 'undefined' ? browser : globalThis.chrome;
  if (!extension?.storage || !globalThis.LiquidSites) return;
  // Keep the version of this content script even if a later extension reload
  // retires its runtime before the user opens either settings panel.
  let loadedVersion = '';
  try { loadedVersion = extension.runtime?.getManifest?.()?.version || ''; } catch {}
  const stores = new Map(), metas = new Map();
  let host, root, dialog, title, heading, headerBack, navigation, content, status, retry, version, playbackStatus;
  let help, helpTitle, helpBody, helpAnchor, playbackCard, quickPanel, quickOpener;
  let current = LiquidSites.identify(location.hostname), selected = 'global', category = '', section = 'appearance', signature = '', history = [];
  let appearanceSite = LiquidSites.list().some(item => item.id === current.id) ? current.id : 'youtube';
  let returnFocus = null, lastDialogFocus = null, disposed = false, globalStore, saving = 0, lastError = null;
  const controls = new Map();
  const backup = { preview: null, fileName: '', busy: '', message: null, changedCount: 0, sequence: 0 };
  let backupRefs = null;
  const downloadURLs = new Set();
  const loadFailed = meta => meta?.error && !meta.saveError && !(meta.saveErrors || []).length;
  const text = {
    ja: { title: '設定', close: '設定を閉じる', scope: '編集する設定', global: 'すべてのサイトで共通', general: '一般',
      appearance: '外観', sites: '外観を設定するサイト', topics: '設定の分類',
      back: '前の画面へ戻る', details: 'の詳細を開く', explanation: 'の説明', closeHelp: '説明を閉じる', audioPlayback: '音声・再生速度',
      page: 'このページ', saved: '端末に保存', saving: '保存中', failure: '設定を保存できませんでした。再試行してください。',
      disconnected: '拡張機能との接続が切れました。ページを再読み込みしてください。', loadFailure: '設定を読み込めませんでした。ページを再読み込みしてください。', retry: '再試行', reload: 'ページを再読み込み',
      pending: 'このサイト専用の機能は、今後ここに追加します。共通設定はすべてのサイトで使えます。',
      playback: '再生', rate: 'レコード式RATE', rateBody: '再生速度と音程を一緒に変更',
      tempo: '音程を保つ再生速度', pitch: 'ピッチ', planned: '今後追加', overview: 'サイトの機能', loading: '設定を読み込み中',
      mediaOff: '再生調整はオフです。', mediaWaiting: 'このページの動画・音声を待っています。',
      mediaApplied: 'このページの{count}個のプレイヤーに適用中。', mediaConflict: 'サイト側との変更が競合しています。再生調整をオフ・オンして再試行できます。',
      mediaUnsupported: 'このページに、再生調整に対応していないプレイヤーがあります。ライブ配信と通話は対象外です。',
      mediaOther: '動画・音声を開いたすべてのタブへ同じ設定を適用します。', semitones: '半音', configuredPitch: '設定上の音程' },
    en: { title: 'Settings', close: 'Close settings', scope: 'Settings to edit', global: 'Shared across all sites', general: 'General',
      appearance: 'Appearance', sites: 'Site appearance', topics: 'Setting categories',
      back: 'Back', details: ' details', explanation: ' information', closeHelp: 'Close explanation', audioPlayback: 'Audio and playback speed',
      page: 'This page', saved: 'Saved on this device', saving: 'Saving', failure: 'Could not save settings. Please retry.',
      disconnected: 'The extension connection has ended. Reload this page.', loadFailure: 'Could not load settings. Reload this page.', retry: 'Retry', reload: 'Reload page',
      pending: 'Site-specific features will be added here. General settings work on every site.',
      playback: 'Playback', rate: 'Record-style RATE', rateBody: 'Change speed and pitch together',
      tempo: 'Speed with pitch preserved', pitch: 'Pitch', planned: 'Planned', overview: 'Site features', loading: 'Loading settings',
      mediaOff: 'Playback adjustment is off.', mediaWaiting: 'Waiting for media on this page.',
      mediaApplied: 'Applied to {count} player(s) on this page.', mediaConflict: 'The site is overriding playback settings. Turn adjustment off and on to retry.',
      mediaUnsupported: 'Some players on this page do not support adjustment. Live streams and calls are excluded.',
      mediaOther: 'The same settings apply in every tab with media.', semitones: 'semitones', configuredPitch: 'Configured pitch' }
  };
  const language = () => globalStore?.values.language || 'ja';
  const tr = () => text[language()];
  const translated = value => typeof value === 'string' ? value : value?.[language()] || value?.ja || '';
  function site(id) { return LiquidSites.list().find(item => item.id === id) || (current.id === id ? current : null); }
  function getStore(id) {
    if (stores.has(id)) return stores.get(id);
    const definition = id === 'global' ? { defaults: LiquidSites.globalDefaults, groups: LiquidSites.globalGroups, inheritLegacy: true } : site(id);
    if (!definition) throw new RangeError('Unknown site profile');
    const store = new YacSettingsStore(extension.storage, definition.defaults, {
      scope: id, inheritLegacy: !!definition.inheritLegacy, globalKeys: id === 'global' ? [] : ['language'],
      rules: Object.fromEntries(definition.groups.flatMap(group => group.fields).map(field => [field.key, field])),
      fallbackKeys: id === 'global' ? LiquidSites.playbackFallbackKeys : {},
      onChange: (_, meta) => { metas.set(id, meta); if (dialog?.open) render(); }
    });
    stores.set(id, store);
    if (id === 'global') globalStore = store;
    return store;
  }
  function node(tag, className, value) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (value !== undefined) el.textContent = value;
    return el;
  }
  function button(label, icon, handler, className = '') {
    const el = node('button', className); el.type = 'button'; el.setAttribute('aria-label', label);
    if (icon) el.append(YacIcons.create(icon, 24));
    if (label && !className.includes('icon-only')) el.append(document.createTextNode(label));
    el.addEventListener('click', handler); return el;
  }
  function deepFocus() {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }
  function create() {
    host = node('div'); host.id = 'liquid-ui-settings'; host.hidden = true;
    root = host.attachShadow({ mode: 'open' });
    const style = node('style');
    style.textContent = `
      :host{all:initial;color-scheme:light dark;font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;position:fixed;inset:0;z-index:2147483600;pointer-events:none}
      :host([hidden]){display:none!important}*{box-sizing:border-box}[hidden]{display:none!important}
      dialog{--solid-face:#f3f3f5;--solid-glass:#eeeef2;--solid-group:#fff;--face:#f3f3f5d1;--glass:#eeeef238;--group:#ffffff52;--ink:#232327;--muted:#797980;--line:#00000009;--hover:#00000004;--selected:#595963;--selected-ink:#fff;--field:#f0f0f3;--track:#d0d0d5;--thumb:#fff;pointer-events:auto;position:fixed;inset:0;margin:auto;width:70vw;max-width:none;height:70vh;height:70dvh;max-height:none;min-width:0;border:1px solid var(--line);border-radius:20px;padding:0;color:var(--ink);background:var(--face);backdrop-filter:blur(28px) saturate(1.2);font:inherit;box-shadow:inset 0 1px 0 #ffffff08,0 22px 80px #0007;overflow:hidden;text-align:start}
      dialog[data-theme=dark]{--solid-face:#252527;--solid-glass:#212123;--solid-group:#303032;--face:#19191ec7;--glass:#17171b40;--group:#ffffff0e;--ink:#f1f1f4;--muted:#b1b1ba;--line:#ffffff12;--hover:#ffffff08;--selected:#d3d3da;--selected-ink:#4a4a50;--field:#3b3b3e;--track:#545458;--thumb:#fafafb}
      @media(prefers-color-scheme:dark){dialog[data-theme=system]{--solid-face:#252527;--solid-glass:#212123;--solid-group:#303032;--face:#19191ec7;--glass:#17171b40;--group:#ffffff0e;--ink:#f1f1f4;--muted:#b1b1ba;--line:#ffffff12;--hover:#ffffff08;--selected:#d3d3da;--selected-ink:#4a4a50;--field:#3b3b3e;--track:#545458;--thumb:#fafafb}}
      dialog:not([open]){display:none}dialog[open]{display:flex;flex-direction:column}dialog::backdrop{background:#08091055}
      dialog[data-theme=light]{color-scheme:light}dialog[data-theme=dark]{color-scheme:dark}
      header{display:flex;align-items:center;gap:12px;flex-shrink:0;height:52px;padding:0 14px 0 20px;border-bottom:1px solid var(--line)}.brand{font-size:16px;line-height:1.25;font-weight:600;letter-spacing:-.25px;margin-right:auto}.header-caption{font-size:13px;color:var(--muted);font-weight:400;margin-left:10px}
      button,input{font:inherit;color:inherit}button,input[type=checkbox],input[type=range]{cursor:pointer}button{border:0;background:transparent;border-radius:8px;padding:7px 9px;display:inline-flex;align-items:center;justify-content:center;gap:9px}button:hover{background:var(--hover)}button:disabled{cursor:default;opacity:.6}.icon-only{width:36px;height:36px;flex-shrink:0;padding:7px}header .icon-only{border-radius:50%;background:var(--group);color:var(--muted)}header .icon-only:hover{background:var(--hover);color:var(--ink)}.icon-only svg{width:22px;height:22px}svg{width:24px;height:24px;flex-shrink:0}
      .layout{display:flex;flex:1;min-height:0;min-width:0}nav{flex:0 0 166px;padding:16px 10px;border-right:1px solid var(--line);background:var(--glass);overflow:auto;overscroll-behavior:contain}nav button{width:100%;min-height:38px;justify-content:flex-start;text-align:start;margin-bottom:3px;white-space:nowrap;font-size:13px}nav svg{width:20px;height:20px}nav button[aria-current=page]{background:var(--line);font-weight:600}
      main{flex:1;min-width:0;overflow:auto;overscroll-behavior:contain;padding:20px 24px;scrollbar-width:thin}.view-heading{display:flex;align-items:center;gap:8px;margin-bottom:14px;min-height:32px}h2{margin:0;font-size:20px;line-height:1.25;font-weight:700;letter-spacing:-.35px;outline:none}.back{width:32px;height:32px;margin-left:-7px;padding:5px}.fields{max-width:720px}.field-list{background:var(--group);border-radius:12px;overflow:hidden}.setting{display:flex;align-items:center;gap:16px;min-height:50px;padding:10px 14px;position:relative}.setting+.setting::before{content:"";position:absolute;top:0;left:14px;right:0;border-top:1px solid var(--line)}.setting.toggle-setting{padding-block:3px}.field-label{flex:1;min-width:0;display:flex;align-items:center;gap:4px;font-size:13px}.setting.range-setting{display:grid;grid-template-columns:minmax(100px,1fr) minmax(90px,1.2fr) 50px;gap:14px}.setting output{font-size:12px;line-height:1.4;font-variant-numeric:tabular-nums;color:var(--muted);white-space:nowrap;text-align:right}.info{width:28px;height:28px;padding:6px;color:var(--muted)}.info svg{width:16px;height:16px}.description{font-size:12px;color:var(--muted);margin:10px 14px 0;line-height:1.5}
      .feature{display:flex;align-items:center;min-height:50px;padding-right:5px;position:relative}.feature+.feature::before{content:"";position:absolute;top:0;left:46px;right:0;border-top:1px solid var(--line)}.feature-open{flex:1;align-self:stretch;justify-content:flex-start;text-align:start;border-radius:0;padding:11px 14px}.feature-open svg{width:22px;height:22px;color:var(--muted)}.chevron{width:30px;height:auto;align-self:stretch;border-radius:0;padding:4px;color:var(--muted)}.chevron svg{width:18px;height:18px}
      main{container:liquid-settings / inline-size}.fields{max-width:none}.site-tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:18px;overflow-x:auto;scrollbar-width:thin}.site-tab{display:inline-flex;align-items:center;gap:7px;position:relative;flex-shrink:0;min-height:38px;padding:7px 14px 10px;border-radius:7px 7px 0 0;color:var(--muted);font-size:13px}.site-tab .site-logo{width:20px;height:20px;flex-shrink:0}.site-tab[aria-selected=true]{color:var(--ink);font-weight:600}.site-tab[aria-selected=true]::after{content:"";position:absolute;bottom:0;left:14px;right:14px;height:2px;border-radius:2px;background:var(--selected)}
      .feature-label{flex:1;display:flex;align-items:center;gap:9px;padding:11px 14px;font-size:13px;font-weight:600}.feature-label svg{width:22px;height:22px;color:var(--muted)}.feature-master{background:var(--group);border-radius:12px;margin-bottom:18px}.appearance-body{display:grid;grid-template-columns:170px minmax(0,1fr);gap:20px;align-items:start}.topic-list{display:flex;flex-direction:column;gap:3px;min-width:0}.topic{width:100%;min-height:40px;justify-content:flex-start;padding:9px 10px;text-align:start;font-size:12px;color:var(--muted)}.topic>svg:first-child{width:18px;height:18px}.topic[aria-current=page]{background:var(--line);color:var(--ink)}.topic-name{flex:1}.topic .topic-arrow{width:16px;height:16px}.group-content{min-width:0}.group-title{font-size:13px;font-weight:600;line-height:1.4;margin:0 0 10px 14px}.general-fields{max-width:720px}
      .back-label{padding:4px 0;justify-content:flex-start;gap:4px;color:var(--muted);font-size:12px}.back-label svg{width:18px;height:18px}.view-heading:has(.back-label){flex-direction:column;align-items:flex-start;gap:6px}.section-caption{margin:12px 14px 6px;font-size:11px;color:var(--muted)}.child-features{margin-top:12px}.feature .ambient-settings{color:var(--muted)}.feature:hover{background:var(--hover)}.feature>button:hover{background:transparent}
      .settings-groups{display:grid;grid-template-columns:minmax(0,1fr);gap:20px;align-items:start}.settings-group{min-width:0}.settings-group .group-title{margin:0 0 8px 14px;color:var(--muted);font-size:12px;font-weight:500}.settings-group .child-features{margin-top:8px}.settings-group .setting.range-setting{grid-template-columns:minmax(95px,1fr) minmax(70px,1.1fr) 45px;gap:10px}.settings-group .field-label{font-size:12px}
      @container liquid-settings (min-width:680px){.settings-groups{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @container liquid-settings (min-width:1020px){.settings-groups{grid-template-columns:repeat(3,minmax(0,1fr))}}
      .settings-group:only-child{grid-column:1/-1;width:100%;max-width:720px}
      @container liquid-settings (max-width:540px){.appearance-body{grid-template-columns:minmax(0,1fr);gap:14px}.topic-list{flex-direction:row;overflow-x:auto}.topic{width:auto;flex-shrink:0;white-space:nowrap;padding:8px 10px;min-height:34px}.topic>svg{display:none}.site-tab{padding-left:11px;padding-right:11px}.site-tabs{margin-bottom:14px}.feature-master{margin-bottom:14px}}
      input[type=range]{width:100%;height:28px;min-width:0;margin:0;appearance:none;background:transparent}input[type=range]::-webkit-slider-runnable-track{height:3px;border-radius:3px;background:var(--track)}input[type=range]::-webkit-slider-thumb{appearance:none;width:16px;height:16px;margin-top:-6.5px;border-radius:50%;background:var(--ink)}input[type=range]::-moz-range-track{height:3px;border-radius:3px;background:var(--track)}input[type=range]::-moz-range-thumb{width:16px;height:16px;border:0;border-radius:50%;background:var(--ink)}.switch-hit{display:flex;align-items:center;justify-content:center;flex:0 0 46px;width:46px;min-height:44px;cursor:pointer}input[type=checkbox]{appearance:none;position:relative;width:36px;height:22px;margin:0;border:0;border-radius:14px;background:var(--track)}input[type=checkbox]::before{content:"";position:absolute;left:2px;top:2px;width:18px;height:18px;border-radius:50%;background:var(--thumb);box-shadow:0 1px 2px #0002;transition:transform .12s}input[type=checkbox]:checked{background:var(--selected)}input[type=checkbox]:checked::before{background:var(--selected-ink);transform:translateX(14px)}
      footer{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-shrink:0;padding:8px 20px;border-top:1px solid var(--line);color:var(--muted);font-size:10px;min-height:32px}.save-state{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.save-state button{min-height:28px;padding:4px 8px;border:1px solid var(--line)}.version{margin-left:8px;white-space:nowrap}
      :focus-visible{outline:2px solid var(--selected);outline-offset:3px}
      .presets{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.presets button{min-height:32px;padding:6px 10px;background:var(--group);font-size:12px}.presets button[aria-pressed=true]{box-shadow:inset 0 0 0 1px var(--selected)}
      .backup-section{margin-top:22px;min-width:0}.backup-section h3{margin:0 14px 8px;font-size:12px;font-weight:500;color:var(--muted)}.backup-card{padding:14px;background:var(--group);border:1px solid transparent;border-radius:12px;min-width:0}.backup-card[data-drag=true]{border-color:var(--selected)}.backup-card p{font-size:12px;line-height:1.55;margin:0 0 12px;color:var(--muted)}.backup-actions{display:flex;gap:8px;flex-wrap:wrap}.backup-actions button{min-height:36px;font-size:12px;padding:8px 12px;background:var(--line)}.backup-actions button:hover:not(:disabled){background:var(--hover)}.backup-actions svg{width:17px;height:17px}.backup-preview{margin-top:14px;padding-top:14px;border-top:1px solid var(--line);font-size:12px}.backup-file{display:block;overflow-wrap:anywhere;line-height:1.5;margin-bottom:10px}.backup-profiles{padding:0;margin:0 0 10px;list-style:none}.backup-profiles li{display:flex;justify-content:space-between;gap:14px;padding:4px 0;color:var(--muted)}.backup-profiles li span:last-child{font-variant-numeric:tabular-nums;white-space:nowrap}.backup-message{margin-top:12px;font-size:12px;color:var(--muted);overflow-wrap:anywhere;outline:none}.backup-message:empty{display:none}.backup-message[data-error=true]{color:var(--ink)}.backup-actions .backup-apply{color:var(--selected-ink);background:var(--selected)}.backup-actions .backup-apply:hover:not(:disabled){background:var(--selected);filter:brightness(.95)}
      .help-popover{position:absolute;inset:auto;margin:0;padding:10px 12px;width:min(290px,calc(100vw - 48px));max-height:calc(70dvh - 24px);overflow:auto;z-index:1;border:1px solid var(--line);border-radius:12px;color:var(--ink);background:var(--solid-group);box-shadow:0 6px 32px #0005;font-size:12px;overscroll-behavior:contain;overflow-wrap:anywhere}.help-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}.help-heading .icon-only{width:26px;height:26px;padding:5px}.help-heading svg{width:16px;height:16px}.help-popover p{margin:6px 0 3px;color:var(--muted);line-height:1.6}
      dialog[data-solid=true]{--face:var(--solid-face);--glass:var(--solid-glass);--group:var(--solid-group);backdrop-filter:none}
      @media(max-width:1050px){main{padding:18px}nav{flex-basis:146px;padding-left:8px;padding-right:8px}nav button{font-size:12px}.setting.range-setting{grid-template-columns:minmax(90px,1fr) minmax(75px,1fr) 45px;gap:8px}}
      @media(max-width:760px){header{height:46px;padding-left:16px}.layout{flex-direction:column}nav{flex:0 0 auto;border-right:0;border-bottom:1px solid var(--line);padding:6px 10px;display:flex;gap:3px;backdrop-filter:none}nav button{width:auto;min-height:32px;margin:0;padding:6px 8px;font-size:12px}nav svg{width:16px;height:16px}main{padding:16px}footer{padding:8px 16px;align-items:flex-start;flex-wrap:wrap}dialog{width:calc(100vw - 24px);border-radius:16px}h2{font-size:17px}}
      @media(max-width:400px){nav{padding:6px;gap:0}nav button{gap:4px;padding:6px;font-size:11px}nav svg,.site-symbol{display:none}main{padding:14px 12px}.setting{gap:8px;padding:9px 12px}.setting.range-setting{grid-template-columns:minmax(85px,1.1fr) minmax(50px,1fr) 39px;gap:6px}.field-label{font-size:12px}.setting output{font-size:11px}.feature-open{font-size:13px;padding:10px 12px;gap:8px}.feature-open svg{width:20px;height:20px}footer{font-size:9px;padding:7px 12px}}
      @media(prefers-reduced-motion:reduce){input[type=checkbox]::before{transition:none}}
      @media(prefers-reduced-transparency:reduce){dialog[data-theme]{--face:var(--solid-face);--glass:var(--solid-glass);--group:var(--solid-group);backdrop-filter:none}}
      @supports not (backdrop-filter:blur(1px)){dialog[data-theme]{--face:var(--solid-face);--glass:var(--solid-glass);--group:var(--solid-group);backdrop-filter:none}}
    `;
    dialog = node('dialog'); dialog.setAttribute('aria-labelledby', 'liquid-settings-title');
    const header = node('header'), brand = node('div', 'brand', 'Flexible UI'), caption = node('span', 'header-caption');caption.dataset.headerCaption = '';brand.append(caption);
    version = node('span', 'version');
    version.textContent = 'Flexible UI' + (loadedVersion ? ' · ' + loadedVersion : '');
    const closeButton = button('', 'x', () => close(), 'icon-only'); closeButton.dataset.close = '';
    headerBack = button('', 'arrow-left', goBack, 'back-label');headerBack.hidden = true;
    header.append(headerBack, brand, closeButton);
    const layout = node('div', 'layout'); navigation = node('nav'); content = node('main'); layout.append(navigation, content);
    heading = node('div', 'view-heading');title = node('h2');title.id = 'liquid-settings-title';title.tabIndex = -1;
    heading.append(title);
    const footer = node('footer'), page = node('span'); page.dataset.currentPage = '';page.append(version);
    const saveState = node('div', 'save-state'); status = node('span'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    retry = button('', '', async () => {
      if ([...metas.values()].some(meta => meta?.reloadRequired || loadFailed(meta))) { location.reload(); return; }
      for (const [id, meta] of metas) {
        const store = getStore(id), keys = (meta?.saveErrors || []).map(item => item.key);
        if (keys.length) await saveMany(store, Object.fromEntries(keys.map(key => [key, store.values[key]])));
      }
    }); saveState.append(status, retry); footer.append(page, saveState);
    help = node('div', 'help-popover');help.id = 'liquid-setting-help';help.hidden = true;help.setAttribute('role', 'dialog');help.setAttribute('aria-labelledby', 'liquid-help-title');
    const helpHeading = node('div', 'help-heading');helpTitle = node('strong');helpTitle.id = 'liquid-help-title';
    const helpClose = button('', 'x', () => closeHelp(), 'icon-only');helpClose.dataset.closeHelp = '';helpBody = node('p');helpHeading.append(helpTitle, helpClose);help.append(helpHeading, helpBody);
    dialog.append(header, layout, footer, help);
    // Constructed stylesheets work even when a site's CSP blocks inline style
    // elements. Both supported browser minimums provide this standard API.
    const sheet = new CSSStyleSheet();sheet.replaceSync(style.textContent + LiquidPlaybackCard.css + LiquidChoiceMenu.css + (globalThis.LiquidColorPicker?.css || '') + '.playback-field-list{background:none;overflow:visible}');
    root.adoptedStyleSheets = [sheet];root.append(dialog);
    dialog.addEventListener('focusin', event => { lastDialogFocus = event.target; });
    for (const type of ['click', 'dblclick', 'keydown', 'keyup']) dialog.addEventListener(type, event => event.stopPropagation());
    dialog.addEventListener('cancel', event => { event.preventDefault();if (globalThis.LiquidColorPicker?.hasOpenMenu(document)) return;if (!help.hidden) closeHelp();else close(); });
    dialog.addEventListener('pointerdown', event => { if (!help.hidden && !help.contains(event.target) && !helpAnchor?.contains(event.target)) closeHelp(false); });
    content.addEventListener('scroll', () => closeHelp(false));
    window.addEventListener('resize', () => closeHelp(false));
    dialog.addEventListener('close', () => { if (!dialog.open) { host.hidden = true;observer.disconnect(); } });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
    });
  }
  function groups() {
    if (selected === 'global') return LiquidSites.globalGroups;
    const definition = site(selected);
    return definition?.groups || [];
  }
  function navigate(next) {
    const topic = LiquidSites.topics.find(item => item.id === next);
    if (!topic) return;
    history.push({ category, selected, scroll: content.scrollTop, focus: deepFocus() });
    closeHelp(false);category = next;section = topic.section;selected = topic.global ? 'global' : appearanceSite;
    render();title.focus({ preventScroll: true });
  }
  function goBack() {
    const previous = history.pop();if (!previous) return;
    category = previous.category;selected = previous.selected;render();content.scrollTop = previous.scroll;
    const key = previous.focus?.dataset.topic;
    const focus = key ? content.querySelector('[data-topic="' + key + '"]') : title;
    focus?.focus({ preventScroll: true });
  }
  function closeHelp(restoreFocus = true) {
    if (!help || help.hidden) return;
    help.hidden = true;
    const anchor = helpAnchor;helpAnchor = null;
    anchor?.setAttribute('aria-expanded', 'false');anchor?.removeAttribute('aria-describedby');
    if (restoreFocus && anchor?.isConnected) anchor.focus({ preventScroll: true });
  }
  function showHelp(anchor, definition) {
    if (!help.hidden && helpAnchor === anchor) { closeHelp();return; }
    closeHelp(false);helpAnchor = anchor;helpTitle.textContent = translated(definition.label);
    helpBody.textContent = translated(definition.description);help.hidden = false;
    anchor.setAttribute('aria-expanded', 'true');anchor.setAttribute('aria-describedby', help.id);
    const bounds = dialog.getBoundingClientRect(), target = anchor.getBoundingClientRect();
    help.style.maxWidth = Math.max(0, dialog.clientWidth - 16) + 'px';
    help.style.maxHeight = Math.max(0, dialog.clientHeight - 16) + 'px';
    const box = help.getBoundingClientRect();
    const left = Math.max(bounds.left + 8, Math.min(target.left, bounds.right - box.width - 8));
    const below = target.bottom + 7;
    const top = Math.max(bounds.top + 8, Math.min(below + box.height <= bounds.bottom - 8 ? below : target.top - box.height - 7,
      bounds.bottom - box.height - 8));
    // The blurred dialog contains positioned children. Convert viewport
    // coordinates to its padding box instead of applying the offset twice.
    help.style.left = left - bounds.left - dialog.clientLeft + 'px';
    help.style.top = top - bounds.top - dialog.clientTop + 'px';
  }
  function setting(definition, store) {
    const wrap = node('div', 'setting ' + definition.type + '-setting'), row = node('div', 'field-label');
    const label = node('label', '', translated(definition.label)), input = node(definition.type === 'select' ? 'button' : 'input');
    input.id = 'liquid-' + definition.key; label.htmlFor = input.id;
    input.dataset.key = definition.key; const output = definition.type === 'range' ? node('output') : null;
    row.append(label);
    if (definition.description) {
      const info = button(translated(definition.label) + tr().explanation, 'info', event => showHelp(event.currentTarget, definition), 'icon-only info');
      info.setAttribute('aria-haspopup', 'dialog');info.setAttribute('aria-controls', 'liquid-setting-help');info.setAttribute('aria-expanded', 'false');row.append(info);
    }
    if (definition.type === 'select' || definition.type === 'color') {
      const choice = (definition.type === 'color' ? LiquidColorPicker : LiquidChoiceMenu).create({ icons: YacIcons, overlayRoot: dialog, container: dialog, boundary: dialog,
        id: input.id, label: translated(definition.label), value: store.values[definition.key],
        language: language(), choices: definition.choices?.map(([value, title]) => [value, translated(title)]),
        onChange: value => save(store, definition.key, value) });
      choice.button.dataset.key = definition.key;wrap.append(row, choice.element);
      controls.set(definition.key, { definition, input: choice.button, choice, store });return wrap;
    }
    if (definition.type === 'toggle') { input.type = 'checkbox';input.setAttribute('role', 'switch'); }
    if (definition.type === 'range') {
      input.type = 'range'; input.min = definition.min; input.max = definition.max; input.step = definition.step;
      output.htmlFor = input.id;wrap.append(row, input, output);
      input.addEventListener('input', () => store.set(definition.key, Number(input.value) / (definition.scale || 1)));
    } else {
      wrap.append(row);
      if (definition.type === 'toggle') {
        const hit = node('label', 'switch-hit');hit.htmlFor = input.id;hit.append(input);wrap.append(hit);
      } else wrap.append(input);
    }
    input.addEventListener('change', () => save(store, definition.key,
      input.type === 'checkbox' ? input.checked : definition.type === 'range' ? Number(input.value) / (definition.scale || 1) : input.value));
    controls.set(definition.key, { definition, input, output, store }); return wrap;
  }
  function featureRow(feature) {
    const store = getStore(feature.global ? 'global' : appearanceSite), label = translated(feature.label);
    const row = node('div', 'feature');
    const open = button(label, feature.icon, () => navigate(feature.id), 'feature-open');open.dataset.topic = feature.id;row.append(open);
    const gear = button(label + tr().details, 'settings-2', () => navigate(feature.id), 'icon-only ambient-settings');gear.dataset.topic = feature.id;row.append(gear);
    if (feature.toggleKey) {
      const definition = (feature.global ? LiquidSites.globalGroups : site(appearanceSite).groups).flatMap(group => group.fields).find(field => field.key === feature.toggleKey);
      const hit = node('label', 'switch-hit'), input = node('input');input.type = 'checkbox';input.id = 'liquid-' + feature.toggleKey;
      input.dataset.key = feature.toggleKey;input.setAttribute('role', 'switch');input.setAttribute('aria-label', label);
      input.addEventListener('change', () => save(store, feature.toggleKey, input.checked));hit.htmlFor = input.id;hit.append(input);row.append(hit);
      controls.set(feature.toggleKey, { definition, input, store });
    } else { gear.replaceChildren(YacIcons.create('chevron-right', 18)); }
    return row;
  }
  function siteTabs(names) {
    const tabs = node('div', 'site-tabs');tabs.setAttribute('role', 'tablist');tabs.setAttribute('aria-label', tr().sites);
    for (const item of names) {
      const tab = button(item.name, '', () => choose(item.id), 'site-tab');tab.dataset.site = item.id;
      const logo = LiquidSites.createLogo(item.id);if (logo) tab.prepend(logo);
      tab.id = 'liquid-site-' + item.id;tab.setAttribute('role', 'tab');tab.setAttribute('aria-controls', 'liquid-site-settings');
      tab.setAttribute('aria-selected', String(selected === item.id));tab.tabIndex = selected === item.id ? 0 : -1;
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();const index = names.findIndex(entry => entry.id === item.id);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? names.length - 1 :
          (index + (event.key === 'ArrowRight' ? 1 : -1) + names.length) % names.length;
        choose(names[next].id);
      });tabs.append(tab);
    }
    function choose(id) {
      appearanceSite = selected = id;category = '';history = [];render();
      const tab = root.getElementById('liquid-site-' + id);tab?.focus({ preventScroll: true });
      tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    return tabs;
  }
  async function save(store, key, value) {
    return saveMany(store, { [key]: value });
  }
  async function saveMany(store, values) {
    saving++;lastError = null;render();
    try { await store.setMany(values, true); }
    catch (error) { lastError = { store, error }; }
    finally { saving--;if (dialog?.open) render(); }
  }
  const backupText = {
    ja: { title: '設定のバックアップ', description: '共通設定と全サイトの設定をJSONファイルで保存します。読み込むと、反映前に変更内容を確認できます。',
      export: 'エクスポート', import: 'インポート', apply: '反映する', cancel: 'キャンセル', drop: 'JSONファイルをここにドロップして読み込むこともできます。',
      shared: '共通設定', count: '{count}項目', summary: '{profiles}個の設定グループ・{settings}項目を読み込みました。変更される設定は{changes}項目です。',
      unchanged: '現在の設定と同じ内容です。', read: 'ファイルを確認中…', exporting: 'ファイルを作成中…', applying: '設定を反映中…', exported: '設定ファイルをエクスポートしました。',
      applied: '{count}項目の設定を反映しました。', failed: '反映できませんでした。変更した設定は元に戻しました。',
      rollbackFailed: '反映に失敗し、一部の設定を元に戻せませんでした。設定を確認してください。', conflict: '反映に失敗しました。ほかの操作で変更された設定は保持しています。設定を確認してください。',
      fileTooLarge: 'ファイルは128KB以下にしてください。', emptyFile: 'ファイルが空です。', invalidJSON: 'JSONファイルを読み取れませんでした。',
      invalidFormat: 'Flexible UIの設定ファイルではありません。', unsupportedVersion: 'この設定ファイルの形式には対応していません。',
      unknown: 'このバージョンにない設定が含まれています。', invalid: '設定ファイルの内容が正しくありません。',
      unavailable: '設定を読み込めませんでした。ページを再読み込みしてください。', readFailed: 'ファイルを読み込めませんでした。もう一度選択してください。', failedExport: '設定ファイルを保存できませんでした。' },
    en: { title: 'Settings backup', description: 'Save shared preferences and all site profiles as a JSON file. Review changes before importing them.',
      export: 'Export', import: 'Import', apply: 'Apply', cancel: 'Cancel', drop: 'You can also drop a JSON file here to import it.',
      shared: 'Shared preferences', count: '{count} settings', summary: 'Loaded {profiles} profiles with {settings} settings. {changes} settings will change.',
      unchanged: 'These settings match your current preferences.', read: 'Checking file…', exporting: 'Creating file…', applying: 'Applying settings…', exported: 'Settings file exported.',
      applied: 'Applied {count} settings.', failed: 'Import failed. The changed settings were restored.',
      rollbackFailed: 'Import failed and some settings could not be restored. Check your preferences.', conflict: 'Import failed. Changes made by other operations were kept. Check your preferences.',
      fileTooLarge: 'Choose a file no larger than 128KB.', emptyFile: 'This file is empty.', invalidJSON: 'Could not read this JSON file.',
      invalidFormat: 'This is not a Flexible UI settings file.', unsupportedVersion: 'This settings file format is not supported.',
      unknown: 'This file contains settings not available in this version.', invalid: 'This settings file contains invalid data.',
      unavailable: 'Could not load preferences. Reload this page.', readFailed: 'Could not read this file. Choose it again.', failedExport: 'Could not save the settings file.' }
  };
  const backupCopy = () => backupText[language()];
  const fill = (value, data = {}) => value.replace(/\{(\w+)\}/g, (_, key) => String(data[key] ?? ''));
  function backupError(error, fallback = 'invalid') {
    const code = error?.code;
    if (['fileTooLarge', 'emptyFile', 'invalidJSON', 'invalidFormat', 'unsupportedVersion'].includes(code)) return code;
    if (['storageUnavailable', 'unavailable'].includes(code)) return 'unavailable';
    if (['unknownProfile', 'unknownSetting', 'unknownProperty'].includes(code)) return 'unknown';
    return code ? 'invalid' : fallback;
  }
  function backupSection() {
    const copy = backupCopy(), section = node('section', 'backup-section');section.dataset.settingsBackup = '';
    const label = node('h3', '', copy.title), card = node('div', 'backup-card'), description = node('p', '', copy.description);
    const actions = node('div', 'backup-actions');
    const exportButton = button(copy.export, 'download', exportBackup), importButton = button(copy.import, 'upload', () => input.click());
    exportButton.dataset.backupExport = '';importButton.dataset.backupImport = '';
    const input = node('input');input.type = 'file';input.accept = '.json,application/json';input.hidden = true;
    input.addEventListener('change', () => { const file = input.files?.[0];input.value = '';if (file) readBackup(file); });
    actions.append(exportButton, importButton);card.append(description, actions, input);
    const drop = node('p', 'description', copy.drop);drop.style.marginTop = '10px';card.append(drop);
    const preview = node('div', 'backup-preview'), fileName = node('strong', 'backup-file'), profiles = node('ul', 'backup-profiles'), summary = node('p');
    const confirmActions = node('div', 'backup-actions'), apply = button(copy.apply, '', applyBackup, 'backup-apply');apply.dataset.backupApply = '';
    const cancel = button(copy.cancel, '', () => {
      if (backup.busy) return;
      backup.preview = null;backup.fileName = '';backup.message = null;updateBackup();backupRefs?.importButton.focus();
    });cancel.dataset.backupCancel = '';confirmActions.append(apply, cancel);preview.append(fileName, profiles, summary, confirmActions);
    const message = node('div', 'backup-message');message.setAttribute('role', 'status');message.setAttribute('aria-live', 'polite');message.tabIndex = -1;
    card.append(preview, message);section.append(label, card);
    card.addEventListener('dragover', event => { if (![...event.dataTransfer.types].includes('Files')) return;event.preventDefault();if (!backup.busy) card.dataset.drag = 'true'; });
    card.addEventListener('dragleave', event => { if (!card.contains(event.relatedTarget)) delete card.dataset.drag; });
    card.addEventListener('drop', event => {
      delete card.dataset.drag;
      if (![...event.dataTransfer.types].includes('Files')) return;
      event.preventDefault();if (backup.busy) return;
      const files = event.dataTransfer.files;
      if (files.length === 1) readBackup(files[0]);
      else { backup.message = { key: 'readFailed', error: true };updateBackup(); }
    });
    backupRefs = { section, exportButton, importButton, preview, fileName, profiles, summary, apply, cancel, message };return section;
  }
  function updateBackup() {
    if (!backupRefs) return;
    backup.changedCount = backup.preview ? backup.preview.profiles.reduce((count, profile) => {
      const store = getStore(profile.id);
      return count + Object.entries(profile.changes).filter(([key, value]) =>
        !Object.is(store.values[key], value) || store.saveErrors?.has(key)).length;
    }, 0) : 0;
    const refs = backupRefs, copy = backupCopy(), busy = !!backup.busy;
    refs.section.setAttribute('aria-busy', String(busy));refs.exportButton.disabled = busy;refs.importButton.disabled = busy;
    refs.preview.hidden = !backup.preview;refs.apply.disabled = busy || !backup.changedCount;refs.cancel.disabled = busy;
    if (backup.preview) {
      const data = backup.preview;refs.fileName.textContent = backup.fileName;
      const order = ['global', ...LiquidSites.list().map(item => item.id)];
      refs.profiles.replaceChildren(...[...data.profiles].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)).map(profile => {
        const row = node('li');row.append(node('span', '', profile.id === 'global' ? copy.shared : site(profile.id)?.name || profile.id),
          node('span', '', fill(copy.count, { count: profile.count })));return row;
      }));
      refs.summary.textContent = fill(copy.summary, { profiles: data.profileCount, settings: data.settingCount, changes: backup.changedCount }) +
        (backup.changedCount ? '' : ' ' + copy.unchanged);
    }
    const message = backup.busy ? { key: { read: 'read', export: 'exporting', apply: 'applying' }[backup.busy] } : backup.message;
    refs.message.textContent = message ? fill(copy[message.key], message) : '';refs.message.dataset.error = String(!!message?.error);
  }
  async function readBackup(file) {
    if (backup.busy || disposed) return;
    const sequence = ++backup.sequence;backup.busy = 'read';backup.preview = null;backup.message = null;updateBackup();
    try {
      if (file.size > LiquidSettingsBackup.maxBytes) throw { code: 'fileTooLarge' };
      const preview = LiquidSettingsBackup.parseSettings(await file.text(), { registry: LiquidSites });let changes = 0;
      for (const profile of preview.profiles) {
        const store = getStore(profile.id);await store.ready;
        if (store.contextError || loadFailed(store.lastMeta)) throw { code: 'storageUnavailable' };
        changes += Object.entries(profile.changes).filter(([key, value]) => !Object.is(store.values[key], value) || store.saveErrors?.has(key)).length;
      }
      if (sequence !== backup.sequence || disposed) return;
      backup.preview = preview;backup.fileName = file.name;backup.changedCount = changes;
    } catch (error) { if (sequence === backup.sequence) backup.message = { key: backupError(error, 'readFailed'), error: true }; }
    finally {
      if (sequence === backup.sequence && !disposed) { backup.busy = '';updateBackup();if (dialog.open) (backup.preview ? backup.changedCount ? backupRefs?.apply : backupRefs?.cancel : backupRefs?.message)?.focus(); }
    }
  }
  async function exportBackup() {
    if (backup.busy || disposed) return;
    const sequence = ++backup.sequence;backup.busy = 'export';backup.message = null;updateBackup();
    try {
      const data = await LiquidSettingsBackup.exportSettings({ registry: LiquidSites, getStore, extensionVersion: loadedVersion });
      if (sequence !== backup.sequence || disposed) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));downloadURLs.add(url);
      const link = node('a');link.href = url;link.download = 'liquid-ui-settings-' + data.exportedAt.replace(/[:.]/g, '-') + '.json';link.hidden = true;
      dialog.append(link);link.click();link.remove();
      setTimeout(() => { URL.revokeObjectURL(url);downloadURLs.delete(url); }, 60000);
      backup.message = { key: 'exported' };
    } catch (error) { if (sequence === backup.sequence) backup.message = { key: backupError(error, 'failedExport'), error: true }; }
    finally { if (sequence === backup.sequence && !disposed) { backup.busy = '';updateBackup(); } }
  }
  async function applyBackup() {
    if (backup.busy || !backup.preview || disposed) return;
    backup.busy = 'apply';backup.message = null;render();
    try {
      const result = await LiquidSettingsBackup.applySettings(backup.preview, { getStore });
      backup.message = result.ok ? { key: 'applied', count: result.settingCount } :
        { key: result.rollbackFailedProfiles.length ? 'rollbackFailed' : result.rollbackSkippedKeys.length ? 'conflict' : 'failed', error: true };
      if (result.ok) { backup.preview = null;backup.fileName = '';lastError = null; }
    } catch (error) { backup.message = { key: backupError(error), error: true }; }
    finally { backup.busy = '';if (!disposed) { render();if (dialog.open) backupRefs?.message.focus(); } }
  }
  function render() {
    if (!dialog) return;
    const common = getStore('global'), copy = tr(), names = LiquidSites.list();
    const topic = LiquidSites.topics.find(item => item.id === category);
    const store = getStore(selected);
    const group = category === 'general' ? LiquidSites.globalGroups.find(item => item.id === 'general') :
      topic ? (topic.global ? LiquidSites.globalGroups : site(appearanceSite)?.groups || []).find(item => item.id === topic.group) : null;
    const nextSignature = [selected, category, section, language(), names.map(item => item.id).join(',')].join('|');
    dialog.lang = language(); dialog.dataset.theme = LiquidQuickPanel.resolveTheme(common.values.theme, { document, siteId: extension.runtime?.id === 'liquid-design-stage' ? 'youtube' : current.id }); dialog.dataset.solid = String(common.values.reduceTransparency);
    title.textContent = topic ? translated(topic.label) : translated(LiquidSites.sections.find(item => item.id === section)?.label);
    dialog.querySelector('[data-header-caption]').textContent = copy.title;
    dialog.querySelector('[data-close]').setAttribute('aria-label', copy.close);
    dialog.querySelector('[data-close-help]').setAttribute('aria-label', copy.closeHelp);
    dialog.querySelector('[data-current-page]').replaceChildren(document.createTextNode(copy.page + ' · ' + current.name), version);
    if (signature !== nextSignature) {
      const focusKey = root.activeElement?.dataset.key;
      closeHelp(false);signature = nextSignature;playbackCard?.dispose();playbackCard = null;
      for (const control of controls.values()) control.choice?.dispose();
      navigation.replaceChildren();content.replaceChildren(heading);controls.clear();playbackStatus = null;backupRefs = null;
      navigation.setAttribute('aria-label', copy.scope);
      for (const item of LiquidSites.sections) {
        const entry = button(translated(item.label), item.icon, () => {
          section = item.id;category = section === 'general' ? 'general' : '';selected = section === 'general' ? 'global' : appearanceSite;history = [];
          render();title.focus({ preventScroll: true });
        });entry.dataset.section = item.id;
        if (section === item.id) entry.setAttribute('aria-current', 'page');navigation.append(entry);
      }
      heading.replaceChildren();headerBack.hidden = !history.length;
      if (history.length) {
        const previous = history.at(-1), previousTopic = LiquidSites.topics.find(item => item.id === previous.category);
        const previousTitle = previousTopic ? translated(previousTopic.label) : translated(LiquidSites.sections.find(item => item.id === section).label);
        headerBack.replaceChildren(YacIcons.create('arrow-left', 18), document.createTextNode(previousTitle));
        headerBack.setAttribute('aria-label', previousTitle + (language() === 'ja' ? 'に戻る' : ' — Back'));
      }
      heading.append(title);
      const fields = node('div', 'fields'), list = node('div', 'field-list');fields.append(list);
      if (section !== 'general' && !topic?.global) {
        content.append(siteTabs(names));fields.id = 'liquid-site-settings';fields.setAttribute('role', 'tabpanel');fields.setAttribute('aria-labelledby', 'liquid-site-' + appearanceSite);
      }
      if (!category) {
        fields.replaceChildren();fields.classList.add('settings-groups');
        const available = LiquidSites.topicsFor(section, appearanceSite);
        for (const item of available) {
          const itemStore = item.global ? common : getStore(appearanceSite);
          const definition = (item.global ? LiquidSites.globalGroups : site(appearanceSite).groups).find(group => group.id === item.group);
          const block = node('section', 'settings-group'), label = node('h3', 'group-title', translated(item.label)), rows = node('div', 'field-list');
          block.append(label, rows);
          if (item.id === 'playback') {
            label.textContent = language() === 'ja' ? '再生調整' : 'Playback adjustment';
            block.append(node('p', 'description', copy.global));
            playbackCard = LiquidPlaybackCard.bind(common, { icons: YacIcons, language: language() });rows.append(playbackCard.element);rows.classList.add('playback-field-list');
            playbackStatus = node('p', 'description');playbackStatus.setAttribute('role', 'status');block.append(playbackStatus);
          } else if (definition) {
            rows.append(...definition.fields.map(field => setting(field, itemStore)));
          }
          fields.append(block);
        }
        if (!available.length) fields.append(node('p', 'description', copy.pending));
      } else if (group?.id === 'playback') {
        playbackCard = LiquidPlaybackCard.bind(store, { icons: YacIcons, language: language() });list.append(playbackCard.element);list.classList.add('playback-field-list');
        fields.prepend(node('p', 'section-caption', copy.global));playbackStatus = node('p', 'description');playbackStatus.setAttribute('role', 'status');fields.append(playbackStatus);
      } else if (group) {
        for (const definition of group.fields) list.append(setting(definition, store));
        if (category === 'general') { fields.classList.add('general-fields');fields.append(backupSection()); }
        if (category === 'surfaces') fields.append(node('p', 'description', language() === 'ja' ? 'アンビエント背景がオンのときに適用します。' : 'Applies while ambient background is enabled.'));
      }
      content.append(fields);content.scrollTop = 0;
      if (focusKey) (controls.get(focusKey)?.input || [...content.querySelectorAll('[data-key]')].find(el => el.dataset.key === focusKey))?.focus({ preventScroll: true });
    }
    for (const [key, control] of controls) {
      const value = (control.store || store).values[key], { input, output, definition, choice } = control;
      if (choice) choice.update(value);
      else if (input.type === 'checkbox') input.checked = value;
      else input.value = definition.type === 'range' ? Math.round(value * (definition.scale || 1)) : value;
      if (output) output.textContent = input.value + (definition.unit || '');
      input.disabled = backup.busy === 'apply';
    }
    for (const entry of navigation.querySelectorAll('button')) entry.disabled = backup.busy === 'apply';
    updateBackup();
    if (playbackStatus) {
      const state = globalThis.LiquidPlayback?.getState();
      const messages = { off: copy.mediaOff, waiting: copy.mediaWaiting, applied: copy.mediaApplied, conflict: copy.mediaConflict, unsupported: copy.mediaUnsupported };
      const shift = common.values.playbackMode === 'rate' ? 12 * Math.log2(common.values.playbackRate) : 0;
      playbackStatus.textContent = (state ? messages[state.kind].replace('{count}', state.count) : copy.mediaOther) +
        ' ' + copy.configuredPitch + ': ' + (shift > 0 ? '+' : '') + shift.toFixed(2) + ' ' + copy.semitones;
    }
    const meta = metas.get(selected), readError = [...metas.values()].some(loadFailed), disconnected = [...metas.values()].some(item => item?.reloadRequired);
    const reload = disconnected || readError, error = [...metas.values()].find(item => item?.saveError || item?.error) || lastError;
    status.textContent = disconnected ? copy.disconnected : readError ? copy.loadFailure : error ? copy.failure : saving || backup.busy === 'apply' ? copy.saving : meta?.loaded ? copy.saved : copy.loading;
    const retryFocused = root.activeElement === retry;
    retry.hidden = !reload && ![...metas.values()].some(item => item?.saveError);retry.disabled = saving > 0;retry.textContent = reload ? copy.reload : copy.retry;
    if (retryFocused && retry.hidden && dialog.open) (playbackCard?.element.querySelector('[data-key=playbackRate]') || title).focus({ preventScroll: true });
  }
  function attach() {
    const target = document.fullscreenElement || document.documentElement;
    if (host.parentElement !== target) target.append(host);
  }
  const observer = new MutationObserver(() => {
    if (!dialog?.open || host.isConnected) return;
    // Removing the host clears shadowRoot.activeElement before this callback.
    const previousFocus = lastDialogFocus;
    dialog.close();attach();host.hidden = false;dialog.showModal();
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  });
  const stopTheme = LiquidQuickPanel.observeTheme(() => { if (dialog?.open) render(); }, {
    document, siteId: extension.runtime?.id === 'liquid-design-stage' ? 'youtube' : current.id
  });
  function open(options = {}) {
    if (disposed) return;
    quickPanel?.hide(false);
    current = LiquidSites.identify(location.hostname);
    if (!dialog) create();
    getStore('global');
    const next = options.site === 'global' || site(options.site) ? options.site : current.id;
    if (next !== 'global' && LiquidSites.list().some(item => item.id === next)) appearanceSite = next;
    section = LiquidSites.sections.some(item => item.id === options.section) ? options.section : next === 'global' ? 'general' : 'appearance';
    category = options.topic || (options.category === 'playback' ? 'playback' : section === 'general' ? 'general' : '');history = [];
    const topic = LiquidSites.topics.find(item => item.id === category);
    if (topic) {
      section = topic.section;
      if (topic.id === 'rendering') history.push({ category: '', selected: appearanceSite, scroll: 0 });
      else category = '';
    }
    selected = section === 'general' ? 'global' : appearanceSite;
    returnFocus = dialog.open ? returnFocus : deepFocus();
    attach();host.hidden = false;render();
    if (!dialog.open) dialog.showModal();
    observer.observe(document.documentElement, { childList: true });
  }
  function close() {
    if (!dialog?.open) return;
    for (const control of controls.values()) control.choice?.close(false);
    closeHelp(false);playbackCard?.flush();
    if (backup.busy && backup.busy !== 'apply') { backup.sequence++;backup.busy = ''; }
    dialog.close();host.hidden = true;observer.disconnect();
    lastDialogFocus = null;
    const usable = element => element?.isConnected && element !== document.body &&
      element !== document.documentElement && element.getClientRects().length > 0;
    const fallback = document.getElementById('yac-settings-button');
    const opener = usable(returnFocus) ? returnFocus : fallback;
    if (usable(opener)) opener.focus({ preventScroll: true });
    // Opening from a panel that just closed can leave the body as the captured
    // opener. A visible element is not necessarily focusable.
    if (deepFocus() !== opener && usable(fallback)) fallback.focus({ preventScroll: true });
  }
  function ensureQuickPanel(opener) {
    if (quickOpener !== opener) quickOpener?.setAttribute('aria-expanded', 'false');
    quickOpener = opener;
    if (!quickPanel) quickPanel = LiquidQuickPanel.create({ icons: YacIcons,
      loadedVersion, siteId: 'youtube',
      ambientStore: getStore('youtube'), playbackStore: getStore('global'),
      ambientGroups: LiquidSites.identify('www.youtube.com').groups,
      onAllSettings: state => open({ site: 'youtube', ...state }),
      onVisibilityChange: shown => {
        quickOpener?.setAttribute('aria-expanded', String(shown));
        quickOpener?.setAttribute('aria-controls', 'liquid-ui-quick-panel');
        const playback = quickOpener?.id === 'yac-playback-button';
        quickOpener?.setAttribute('aria-label', language() === 'ja' ?
          (shown ? playback ? '再生調整を閉じる' : '簡易パネルを閉じる' : playback ? '再生調整を開く' : 'Flexible UIの簡易パネルを開く') :
          (shown ? playback ? 'Close playback adjustment' : 'Close quick panel' : playback ? 'Open playback adjustment' : 'Open Flexible UI quick panel'));
      }
    });
    return quickPanel;
  }
  function togglePanel(opener) {
    if (disposed || !globalThis.LiquidQuickPanel) return;
    ensureQuickPanel(opener).toggle(opener);
  }
  function openPlaybackPanel(opener) {
    if (disposed || !globalThis.LiquidQuickPanel) return;
    const same = quickOpener === opener && quickPanel?.isOpen();
    const panel = ensureQuickPanel(opener);if (same) panel.hide();else panel.showPlayback(opener);
  }
  const message = (request, sender, sendResponse) => {
    if (request?.type !== 'liquid-ui:open-settings' || sender?.id !== extension.runtime?.id || sender?.tab) return undefined;
    open({ site: 'global' });sendResponse({ opened: true });return false;
  };
  try { extension.runtime?.onMessage?.addListener(message); } catch {}
  window.addEventListener('pagehide', event => {
    if (event.persisted) { close();quickPanel?.hide(false);return; }
    disposed = true;observer.disconnect();stopTheme();playbackCard?.dispose();playbackCard = null;
    backup.sequence++;for (const url of downloadURLs) URL.revokeObjectURL(url);downloadURLs.clear();
    for (const control of controls.values()) control.choice?.dispose();
    quickPanel?.dispose();quickPanel = null;
    for (const store of stores.values()) store.dispose();
    try { extension.runtime?.onMessage?.removeListener(message); } catch {}
    dialog?.close();host?.remove();
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted && !disposed) for (const store of stores.values()) store.load();
  });
  globalThis.LiquidUI = Object.freeze({ open, close, getStore, togglePanel, openPlaybackPanel, isPanelOpen: () => !!quickPanel?.isOpen(), closePanel: () => quickPanel?.hide(false) });
  document.addEventListener('liquid-ui:playback-status', () => { if (dialog?.open && section === 'video') render(); });
})();
