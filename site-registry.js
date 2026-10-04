/* Shared site and setting definitions. Add site adapters here without copying UI. */
(() => {
  'use strict';
  const label = (ja, en) => ({ ja, en });
  const field = (key, type, ja, en, options = {}) => ({ key, type, label: label(ja, en), ...options });
  const group = (id, icon, ja, en, fields) => ({ id, icon, label: label(ja, en), fields });
  const playbackDefaults = Object.freeze({ playbackEnabled: false, playbackMode: 'rate', playbackRate: 1 });
  const playbackGroup = group('playback', 'scan-line', '再生', 'Playback', [
    field('playbackEnabled', 'toggle', '再生調整', 'Playback adjustment', {
      description: label('すべてのサイトの動画・音声に同じ設定を適用します。オフにすると、各プレイヤーの変更前の速度と音程補正に戻します。',
        'Use the same settings for media on all sites. Turning off restores each player\'s previous rate and pitch compensation.') }),
    field('playbackMode', 'select', '変更方法', 'Mode', { choices: [
      ['tempo', label('音程を保つ', 'Keep pitch')], ['rate', label('レコード式RATE', 'Record-style RATE')]],
      description: label('RATEは速度と音程を一緒に変えます。ナイトコアはRATEを125%にする設定です。',
        'RATE changes speed and pitch together. Nightcore sets RATE to 125%.') }),
    field('playbackRate', 'range', '速度 / RATE', 'Speed / RATE', { min: 25, max: 300, step: 1, scale: 100, unit: '%', storagePrecision: 12 })]);
  playbackGroup.presets = [
    { label: label('標準 100%', 'Normal 100%'), values: { playbackMode: 'rate', playbackRate: 1, playbackEnabled: true } },
    { label: label('ナイトコア 125%', 'Nightcore 125%'), values: { playbackMode: 'rate', playbackRate: 1.25, playbackEnabled: true } }];
  const ambientDefaults = Object.freeze({ enabled: true, radial: true, avoidBars: true, fillBars: true,
    flashWarning: true, strength: 100, blur: 65, saturation: 145, inset: 0, fps: 60,
    surfaceMultiplier: .65, controlDensity: 50, readingDensity: 0, navigationDensity: 100, language: 'ja' });
  const ambientGroups = [
    group('appearance', 'sun', '背景の見た目', 'Background appearance', [
      field('enabled', 'toggle', 'アンビエント背景', 'Ambient background'),
      field('radial', 'toggle', '放射状モード', 'Radial mode'),
      field('strength', 'range', '背景映像の濃さ', 'Ambient strength', { min: 15, max: 100, step: 1, unit: '%' }),
      field('blur', 'range', 'ぼかし', 'Blur', { min: 0, max: 160, step: 1, unit: ' px' }),
      field('saturation', 'range', '彩度', 'Saturation', { min: 0, max: 250, step: 1, unit: '%' })]),
    group('surfaces', 'panels-top-left', '操作画面の濃さ', 'Interface shade', [
      field('surfaceMultiplier', 'range', '全体の濃さ', 'Overall shade', { min: 0, max: 100, step: 1, scale: 100, unit: '%' }),
      field('controlDensity', 'range', 'ボタンと検索', 'Buttons and search', { min: 0, max: 100, step: 1, unit: '%' }),
      field('readingDensity', 'range', '説明・コメント・チャット', 'Descriptions, comments and chat', { min: 0, max: 100, step: 1, unit: '%' }),
      field('navigationDensity', 'range', 'メニューと左ガイド', 'Menus and left sidebar', { min: 0, max: 100, step: 1, unit: '%' })]),
    group('rendering', 'scan-line', '黒帯と描画', 'Black bars and rendering', [
      field('avoidBars', 'toggle', '黒帯を自動で除外', 'Detect and exclude black bars'),
      field('fillBars', 'toggle', '黒帯を背景に置き換える', 'Replace black bars with ambient'),
      field('inset', 'range', '採色範囲（内側）', 'Sample inset', { min: 0, max: 40, step: 1, unit: '%' }),
      field('fps', 'range', '背景のFPS', 'Background FPS', { min: 24, max: 60, step: 1, unit: ' FPS' })]),
    group('safety', 'shield-check', '高速点滅の警告', 'Rapid-flash warning', [
      field('flashWarning', 'toggle', '高速点滅の警告', 'Rapid-flash warning', {
        description: label('背景映像の濃さが51%以上のときに検知します。50%以下では検知を止めます。',
          'Detection runs at 51% ambient strength or higher and stops at 50% or below.') })])
  ];
  const sidebarGroup = group('watch-sidebar', 'panels-top-left', '動画一覧', 'Video list', [
    field('sidebarEnabled', 'toggle', '動画一覧を整理', 'Organize the video list', {
      description: label('オンにすると右側をタブにまとめます。オフではYouTubeの元の一覧とタグを使います。',
        'Use a compact tabbed sidebar when enabled. Turning off restores YouTube\'s original list and filter chips.') }),
    field('sidebarFilter', 'select', '既定のタグ', 'Default tag', { choices: [
      ['all', label('すべて', 'All')], ['channel', label('提供', 'From this channel')], ['related', label('関連動画', 'Related videos')]],
      description: label('初期表示に使うタグを選びます。「提供」は現在の動画に表示される「提供: ○○」を使います。右のヘッダーでは、その動画でYouTubeが用意したすべてのタグを選べます。動画固有のタグを使った後は、次の動画で初期タグに戻ります。',
        'Choose the initial filter. From this channel follows the current video\'s From chip. The list header offers every native tag for that video. A video-specific selection returns to this initial filter on the next video.') }),
    field('sidebarParallel', 'toggle', 'ウルトラワイド用の配置', 'Ultrawide layout', {
      description: label('左にチャット、中央に動画とコメント、右に一覧を表示します。左右は画面に固定し、それぞれスクロールできます。チャットを開いていて、動画の幅を保ちつつ左右に合計720px以上を確保できるときに適用します。動画一覧の整理がオフでも使えます。',
        'Fix chat on the left and the list on the right with independent scrolling. Keep video and comments in the scrolling center. Requires an open chat and at least 720 CSS pixels for the side columns without shrinking the video. Works with the original YouTube list too.') })]);
  function readableAccent(color, dark) {
    const original = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
    const luminance = rgb => rgb.reduce((sum, value, index) => {
      const channel = value / 255;
      return sum + [.2126, .7152, .0722][index] * (channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
    }, 0);
    const background = luminance(dark ? [15, 15, 15] : [255, 255, 255]);
    const contrast = rgb => { const text = luminance(rgb);return (Math.max(text, background) + .05) / (Math.min(text, background) + .05); };
    let rgb = original;
    if (contrast(rgb) < 4.5) {
      let low = 0, high = 1;
      const blend = amount => original.map(value => Math.round(value + ((dark ? 255 : 0) - value) * amount));
      for (let step = 0; step < 16; step++) { const mid = (low + high) / 2;if (contrast(blend(mid)) >= 4.5) high = mid;else low = mid; }
      rgb = blend(high);
    }
    return '#' + rgb.map(value => value.toString(16).padStart(2, '0')).join('');
  }
  function accentPalette(settings) {
    const color = typeof settings?.accentColor === 'string' && /^#[\da-f]{6}$/i.test(settings.accentColor) ? settings.accentColor.toLowerCase() : '#0a84ff';
    return { '--yac-accent-light': readableAccent(color, false), '--yac-accent-dark': readableAccent(color, true) };
  }
  const accentGroup = group('accent', 'sun', 'アクセント色', 'Accent color', [
    field('useCustomAccent', 'toggle', 'アクセント色を変更', 'Use a custom accent'),
    field('accentColor', 'color', '色', 'Color', {
      description: label('投稿者名、リンク、いいねの色を揃えます。保存した色を基に、背景に合わせて読みやすい明るさに調整します。',
        'Use one accent for creator names, links and likes. Adjust display brightness for readability while preserving the saved color.') })]);
  const scrollbarGroup = group('scrollbars', 'panels-top-left', 'スクロールバーを隠す', 'Hide scrollbars', [
    field('hideMainScrollbar', 'toggle', '動画・コメントのメイン列', 'Main video and comments column'),
    field('hideChatScrollbar', 'toggle', 'ライブチャット', 'Live chat'),
    field('hideListScrollbar', 'toggle', '動画一覧', 'Video list')]);
  const playbackFallbackKeys = Object.freeze(Object.fromEntries(Object.keys(playbackDefaults)
    .map(key => [key, 'liquid-ui:site:youtube:' + key])));
  const globalDefaults = Object.freeze({ language: 'ja', theme: 'system', reduceTransparency: false, ...playbackDefaults });
  const globalGroups = [group('general', 'settings-2', '共通設定', 'General', [
    field('language', 'select', '言語', 'Language', { choices: [['ja', '日本語'], ['en', 'English']] }),
    field('theme', 'select', '設定画面の外観', 'Settings appearance', { choices: [
      ['system', label('自動', 'Auto')], ['light', label('ライト', 'Light')], ['dark', label('ダーク', 'Dark')]] }),
    field('reduceTransparency', 'toggle', '設定画面の透明感を抑える', 'Reduce settings transparency')]), playbackGroup];
  const appearanceDefaults = Object.freeze({ appearanceEnabled: false, chromeDensity: 65, contentDensity: 25, cornerRadius: 16, chromeBlur: 16 });
  function appearanceGroup(id) {
    const music = id === 'youtube-music';
    return group('site-appearance', 'panels-top-left', '外観', 'Appearance', [
      field('appearanceEnabled', 'toggle', 'Liquidの外観', 'Liquid appearance', {
        description: label('色・透過・角丸を調整します。文字とプレイヤーのサイズは保持します。',
          'Adjust surface color, transparency and corners while retaining text and player sizes.') }),
      field('chromeDensity', 'range', music ? 'ヘッダー・検索・再生バー' : 'ナビゲーションとタブ',
        music ? 'Header, search and player bar' : 'Navigation and tabs', { min: 0, max: 100, step: 1, unit: '%' }),
      field('contentDensity', 'range', music ? '歌詞と再生キュー' : '投稿の背景',
        music ? 'Lyrics and queue' : 'Post background', { min: 0, max: 100, step: 1, unit: '%' }),
      field('cornerRadius', 'range', '角丸', 'Corner radius', { min: 0, max: 28, step: 1, unit: ' px' }),
      field('chromeBlur', 'range', '操作部分のぼかし', 'Control-surface blur', { min: 0, max: 24, step: 1, unit: ' px',
        description: label(music ? '歌詞とキューにはぼかしを掛けません。0pxでは操作部分のぼかしも止めます。' :
          '投稿にはぼかしを掛けません。0pxでは操作部分のぼかしも止めます。',
          music ? 'Lyrics and the queue use no blur. Set 0px to remove blur from controls too.' :
            'Posts use no blur. Set 0px to remove blur from controls too.') })]);
  }
  const musicAppearance = Object.freeze({
    chrome: ['ytmusic-nav-bar', 'ytmusic-search-box', 'ytmusic-player-bar', 'ytmusic-guide-renderer'],
    content: ['ytmusic-player-queue', 'ytmusic-tab-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]'],
    nativeForeground: 'ytmusic-app',
    backgrounds: ['ytmusic-search-box #search-background']
  });
  const xAppearance = Object.freeze({ chrome: ['header[role="banner"] nav', '[data-testid="primaryColumn"] [role="tablist"]'],
    content: ['[data-testid="primaryColumn"] article[data-testid="tweet"]'], nativeForeground: 'body', backgrounds: [] });
  const sites = new Map();
  function register(site) {
    if (!site || !/^[a-z0-9.-]+$/.test(site.id) || sites.has(site.id)) throw new TypeError('Invalid or duplicate site');
    sites.set(site.id, Object.freeze({ ...site, hosts: Object.freeze([...site.hosts]),
      features: Object.freeze((site.features || []).map(feature => Object.freeze({ ...feature, groups: Object.freeze([...feature.groups]) }))),
      defaults: Object.freeze({ ...site.defaults }), groups: Object.freeze([...site.groups]) }));
  }
  register({ id: 'youtube', name: 'YouTube', hosts: ['www.youtube.com', 'youtube.com'],
    defaults: { ...ambientDefaults, sidebarEnabled: false, sidebarFilter: 'related', sidebarParallel: false,
      hideMainScrollbar: true, hideChatScrollbar: true, hideListScrollbar: true, useCustomAccent: false, accentColor: '#0a84ff' }, groups: [...ambientGroups, sidebarGroup, scrollbarGroup, accentGroup], inheritLegacy: true, mediaSelector: '#movie_player video',
    features: [{ id: 'ambient', icon: 'sun', label: label('アンビエント背景', 'Ambient background'), toggleKey: 'enabled',
      groups: ['appearance', 'surfaces', 'rendering', 'safety'] }] });
  register({ id: 'youtube-music', name: 'YouTube Music', hosts: ['music.youtube.com'], defaults: appearanceDefaults,
    groups: [appearanceGroup('youtube-music')], appearance: musicAppearance, mediaSelector: '#movie_player video, ytmusic-player audio' });
  register({ id: 'x', name: 'X', hosts: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'], defaults: appearanceDefaults,
    groups: [appearanceGroup('x')], appearance: xAppearance });
  function identify(hostname) {
    const host = String(hostname).toLowerCase();
    for (const site of sites.values()) if (site.hosts.includes(host)) return site;
    return { id: /^[a-z0-9.-]+$/.test(host) ? host : 'other', name: host || 'Other site', hosts: [host], defaults: {}, groups: [] };
  }
  const sections = Object.freeze([
    { id: 'appearance', icon: 'panels-top-left', label: label('外観', 'Appearance') },
    { id: 'video', icon: 'volume-2', label: label('動画と再生', 'Video and playback') },
    { id: 'general', icon: 'settings-2', label: label('一般', 'General') }
  ]);
  // Quick actions are chosen per site; other sites keep their existing home.
  const quickActions = Object.freeze({ youtube: Object.freeze([
    { id: 'appearance', icon: 'sun', label: label('アンビエント背景', 'Ambient background'), toggleKey: 'enabled' },
    { id: 'video', icon: 'gauge', label: label('再生調整', 'Playback adjustment'), toggleKey: 'playbackEnabled', global: true }
  ]) });
  // Official brand shapes, kept separate from Lucide interface icons.
  // YouTube: https://www.youtube.com/ (the two icon paths of ytd-logo).
  // Music: https://music.youtube.com/img/on_platform_logo_dark.svg (icon only).
  // X: https://about.x.com/content/dam/about-twitter/x/brand-toolkit/x-logo.zip
  const logos = {
    youtube: { viewBox: '0 0 29 20', paths: [
      { d: 'M14.4848 20C14.4848 20 23.5695 20 25.8229 19.4C27.0917 19.06 28.0459 18.08 28.3808 16.87C29 14.65 29 9.98 29 9.98C29 9.98 29 5.34 28.3808 3.14C28.0459 1.9 27.0917 0.94 25.8229 0.61C23.5695 0 14.4848 0 14.4848 0C14.4848 0 5.42037 0 3.17711 0.61C1.9286 0.94 0.954148 1.9 0.59888 3.14C0 5.34 0 9.98 0 9.98C0 9.98 0 14.65 0.59888 16.87C0.954148 18.08 1.9286 19.06 3.17711 19.4C5.42037 20 14.4848 20 14.4848 20Z', fill: '#FF0033' },
      { d: 'M19 10L11.5 5.75V14.25L19 10Z', fill: 'white' }
    ] },
    'youtube-music': { viewBox: '0 0 26 26', paths: [
      { d: 'm13 26c7.176 0 13-5.824 13-13s-5.824-13-13-13-13 5.824-13 13 5.824 13 13 13z', fill: '#f03' },
      { d: 'm20.5 13c0 4.1439-3.3561 7.5-7.5 7.5-4.14386 0-7.5-3.3561-7.5-7.5 0-4.14386 3.35614-7.5 7.5-7.5 4.1439 0 7.5 3.35614 7.5 7.5z', stroke: '#fff' },
      { d: 'm17.75 13-7.5-4.25v8.5z', fill: '#fff' }
    ] },
    x: { viewBox: '0 0 1200 1227', paths: [
      { d: 'M714.163 519.284L1160.89 0H1055.03L667.137 450.887L357.328 0H0L468.492 681.821L0 1226.37H105.866L515.491 750.218L842.672 1226.37H1200L714.137 519.284H714.163ZM569.165 687.828L521.697 619.934L144.011 79.6944H306.615L611.412 515.685L658.88 583.579L1055.08 1150.3H892.476L569.165 687.854V687.828Z', fill: 'currentColor' }
    ] }
  };
  function createLogo(siteId, doc = globalThis.document) {
    const logo = logos[siteId];if (!logo) return null;
    const namespace = 'http://www.w3.org/2000/svg', svg = doc.createElementNS(namespace, 'svg');
    for (const [key, value] of Object.entries({ viewBox: logo.viewBox, fill: 'none', 'aria-hidden': 'true', focusable: 'false', class: 'site-logo' })) svg.setAttribute(key, value);
    for (const attributes of logo.paths) { const path = doc.createElementNS(namespace, 'path');for (const [key, value] of Object.entries(attributes)) path.setAttribute(key, value);svg.append(path); }
    return svg;
  }
  const topics = Object.freeze([
    { id: 'ambient', section: 'appearance', site: 'youtube', group: 'appearance', icon: 'sun', label: label('アンビエント背景', 'Ambient background'), toggleKey: 'enabled' },
    { id: 'rendering', section: 'appearance', site: 'youtube', group: 'rendering', icon: 'scan-line', label: label('黒帯と描画', 'Black bars and rendering') },
    { id: 'surfaces', section: 'appearance', site: 'youtube', group: 'surfaces', icon: 'panels-top-left', label: label('操作画面の濃さ', 'Interface shade') },
    { id: 'accent', section: 'appearance', site: 'youtube', group: 'accent', icon: 'sun', label: label('アクセント色', 'Accent color') },
    { id: 'scrollbars', section: 'appearance', site: 'youtube', group: 'scrollbars', icon: 'panels-top-left', label: label('スクロールバーを隠す', 'Hide scrollbars') },
    { id: 'siteAppearance', section: 'appearance', group: 'site-appearance', icon: 'panels-top-left', label: label('Liquidの外観', 'Liquid appearance'), toggleKey: 'appearanceEnabled' },
    { id: 'playback', section: 'video', global: true, group: 'playback', icon: 'volume-2', label: label('音声・再生速度', 'Audio and playback speed'), toggleKey: 'playbackEnabled' },
    { id: 'sidebar', section: 'video', site: 'youtube', group: 'watch-sidebar', icon: 'panels-top-left', label: label('動画一覧', 'Video list'), toggleKey: 'sidebarEnabled' },
    { id: 'safety', section: 'video', site: 'youtube', group: 'safety', icon: 'shield-check', label: label('高速点滅の警告', 'Rapid-flash warning'), toggleKey: 'flashWarning' }
  ]);
  function topicsFor(section, siteId, parent = '') {
    return topics.filter(topic => topic.section === section && (topic.parent || '') === parent &&
      (!topic.site || topic.site === siteId) && (topic.global || sites.get(siteId)?.groups.some(group => group.id === topic.group)));
  }
  const registry = Object.freeze({ register, identify, list: () => [...sites.values()],
    globalDefaults, globalGroups, ambientDefaults, playbackDefaults, playbackGroup, playbackFallbackKeys, sections, topics, topicsFor,
    quickActionsFor: siteId => quickActions[siteId] || [], createLogo, accentPalette });
  globalThis.LiquidSites = registry;
  if (typeof module !== 'undefined') module.exports = registry;
})();
