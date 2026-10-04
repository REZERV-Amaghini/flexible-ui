(() => {
  'use strict';
  if (document.getElementById('yac-settings-button')) return;
  // Dispose the previous revision when previewing an update in this document.
  document.dispatchEvent(new Event('yac-dispose'));
  document.getElementById('yac-controls')?.remove();
  document.getElementById('yac-background')?.remove();
  const extension = typeof browser !== 'undefined' ? browser : globalThis.chrome;
  let extensionRuntime, loadedVersion = '', startupContextError = null;
  // Read the loaded extension once, not a source/build version or a live API in
  // the settings/frame loop. A retired context keeps the existing reload path.
  try {
    extensionRuntime = extension?.runtime;
    const version = extensionRuntime?.getManifest?.()?.version;
    if (typeof version === 'string' && version.trim()) loadedVersion = version;
  } catch (error) {
    if (YacSettingsStore.isContextInvalidated(error)) startupContextError = error;
  }
  const settings = { enabled: true, radial: true, avoidBars: true, fillBars: true, flashWarning: true, strength: 100, blur: 65, saturation: 145, inset: 0, fps: 60, surfaceMultiplier: .65, controlDensity: 50, readingDensity: 0, navigationDensity: 100, useCustomAccent: false, accentColor: '#0a84ff', language: 'ja' };
  const paletteStyle = document.createElement('style');
  paletteStyle.id = 'yac-surface-palette';
  document.head.append(paletteStyle);
  const booleanKeys = ['enabled', 'radial', 'avoidBars', 'fillBars', 'flashWarning'];
  const uiOnlySettings = new Set(['surfaceMultiplier', 'controlDensity', 'readingDensity', 'navigationDensity', 'useCustomAccent', 'accentColor', 'language']);
  const translations = {
    ja: {
      title: '設定', close: '設定を閉じる', closeHelp: '説明を閉じる', back: '設定一覧に戻る', language: '言語 / Language',
      openSettings: '設定を開く', allSettings: 'すべての設定', on: 'オン', offState: 'オフ', info: '説明', applied: '適用',
      loadedVersion: '読み込み版 {version}', versionUnavailable: '版番号を取得できません',
      enabled: 'アンビエント背景', enabledDescription: '動画から作る背景をオン・オフします。高速点滅の警告は独立した設定です。', radial: '放射状モード', avoidBars: '黒帯を自動で除外', fillBars: '黒帯を背景に置き換える',
      strength: '背景映像の濃さ', blur: 'ぼかし', saturation: '彩度', inset: '採色範囲（内側）', fps: '背景のFPS',
      surfaceMultiplier: '全体の濃さ', surfaceMultiplierDescription: '0〜100%を1%刻みで調整し、各種類の濃さに掛けます。動かした値は1%刻みで保存します。0%は完全な透明です。文字とアイコンの色は保ちます。',
      controlDensity: 'ボタンと検索', controlDensityDescription: 'ボタン、検索欄、タグ、Enhancerのツールバーの背景を0〜100%で調整します。動かした値は1%刻みで保存します。',
      readingDensity: '説明・コメント・チャット', readingDensityDescription: '説明欄、返信を含むコメント単位の背景、文字起こし、再生リスト、チャットの背景を0〜100%で調整します。動かした値は1%刻みで保存します。チャットのメニューは「メニューと左ガイド」で調整します。有料メッセージの色はそのままです。',
      navigationDensity: 'メニューと左ガイド', navigationDensityDescription: '検索候補、音声検索、通知、メニュー、ホバーカード、説明ラベル、左のサイドバー、この設定画面の背景を0〜100%で調整します。動かした値は1%刻みで保存します。チャットのメニューも対象です。',
      appearance: '背景の見た目', appearanceDescription: '濃さ・ぼかし・彩度',
      surfaces: '操作画面の濃さ', surfacesDescription: '全体と種類別の濃さ',
      rendering: '黒帯と描画', renderingDescription: '黒帯・採色範囲・フレームレート',
      safety: '安全と言語', safetyDescription: '高速点滅の警告・表示言語',
      strengthDescription: '映像から作るアンビエント背景の濃さを調整します。',
      blurDescription: 'スクロール後は設定値の半分でぼかします。下限は25 pxです。',
      saturationDescription: '100%が元の彩度です。値を上げると背景の色が鮮やかになります。',
      flashWarning: '高速点滅の警告', flashWarningDescription: 'アンビエントの濃さが51%以上のとき、高速点滅が約3秒続くと警告します。50%以下では検知を止めます。背景オフ・全画面でも同じ条件で監視し、「二度と表示しない」の設定もここで戻せます。',
      flashTitle: '高速点滅を繰り返しているようです。',
      flashBody: '光の点滅は、光に敏感な方の体調に影響することがあります。必要に応じて、アンビエントの濃さを下げてください。',
      flashNote: '検出は完全ではありません。3秒未満の点滅や、濃さ15%でも安全を保証するものではありません。',
      flashNever: '二度と表示しない', flashReduce: '濃さを下げる（15%）', flashClose: '閉じる',
      saveFailure: 'このページには反映しましたが、「{setting}」を保存できませんでした。再試行してください。', saveRetry: '再試行',
      saveDisconnected: '拡張機能との接続が切れました。設定を保存するには、このYouTubeページを再読み込みしてください。', saveReload: 'ページを再読み込み',
      radialDescription: '映像の縁から色を広げ、スクロールすると背景全体へ切り替わります。',
      avoidBarsDescription: '黒帯を避けて、映像の色を拾います。', fillBarsDescription: '動画の表示サイズを保ち、黒帯の領域にも背景を表示します。',
      insetDescription: '値を上げると、映像の内側から色を拾います。', fpsDescription: '24〜60 FPS。高いほど滑らかになりますが、負荷も増えます。',
      compatibilityRenderingNotice: 'このページでは互換描画を使用しています。',
      off: 'アンビエント背景はオフです。', fullscreen: '全画面ではページ背景を停止します。', waiting: '動画を待っています。',
      noBars: '黒帯を自動検出できません。「採色範囲（内側）」で調整できます。', cropped: '黒帯の内側から色を拾っています。',
      radialHint: '動画が隠れると背景全体へゆっくり切り替わります。', fullFrameHint: '動画全体の色を背景に広げます。', failed: 'この動画では背景を描画できません。'
    },
    en: {
      title: 'Settings', close: 'Close settings', closeHelp: 'Close explanation', back: 'Back to settings', language: '言語 / Language',
      openSettings: 'Open settings', allSettings: 'All settings', on: 'On', offState: 'Off', info: 'Information', applied: 'Applied',
      loadedVersion: 'Loaded v{version}', versionUnavailable: 'Version unavailable',
      enabled: 'Ambient background', enabledDescription: 'Turns the video-based background on or off. Rapid-flash warnings have their own setting.', radial: 'Radial mode', avoidBars: 'Detect and exclude black bars', fillBars: 'Replace black bars with ambient',
      strength: 'Ambient strength', blur: 'Blur', saturation: 'Saturation', inset: 'Sample inset', fps: 'Background FPS',
      surfaceMultiplier: 'Overall shade', surfaceMultiplierDescription: 'Multiplies each category by 0–100%, adjustable and saved in 1% steps. Zero is fully transparent. Text and icon colors stay unchanged.',
      controlDensity: 'Buttons and search', controlDensityDescription: 'Adjusts backgrounds on buttons, search, filter chips and the Enhancer toolbar from 0–100%, saved in 1% steps.',
      readingDensity: 'Descriptions, comments and chat', readingDensityDescription: 'Adjusts backgrounds in descriptions, comment threads including replies, transcripts, playlists and chat from 0–100%, saved in 1% steps. Chat menus use "Menus and left sidebar". Paid messages keep their own colors.',
      navigationDensity: 'Menus and left sidebar', navigationDensityDescription: 'Adjusts backgrounds in search suggestions, voice search, notifications, menus, hover cards, tooltips, the left sidebar and this settings panel from 0–100%, saved in 1% steps. Chat menus are included.',
      appearance: 'Background appearance', appearanceDescription: 'Strength, blur and saturation',
      surfaces: 'Interface shade', surfacesDescription: 'Overall and category shade',
      rendering: 'Black bars and rendering', renderingDescription: 'Bars, sample inset and frame rate',
      safety: 'Safety and language', safetyDescription: 'Rapid-flash warning and display language',
      strengthDescription: 'Adjusts the strength of the ambient background sampled from the video.',
      blurDescription: 'After scrolling, blur uses half this value, with a minimum of 25 px.',
      saturationDescription: '100% is the original saturation. Higher values make the background more vivid.',
      flashWarning: 'Rapid-flash warning', flashWarningDescription: 'At 51% ambient strength or higher, warns after about 3 seconds of rapid flashing, including with ambient off or in fullscreen. Detection is off at 50% or below. You can turn warnings back on here.',
      flashTitle: 'Rapid flashing appears to be repeating.',
      flashBody: 'Flashing light can affect people who are sensitive to it. Consider reducing the ambient strength.',
      flashNote: 'Detection is incomplete. Flashes shorter than 3 seconds and 15% strength are not guaranteed to be safe.',
      flashNever: "Don't show again", flashReduce: 'Reduce strength to 15%', flashClose: 'Close',
      saveFailure: 'Applied on this page, but could not save “{setting}”. Please retry.', saveRetry: 'Retry',
      saveDisconnected: 'The extension connection has ended. Reload this YouTube page to save settings.', saveReload: 'Reload page',
      radialDescription: 'Extends the video edges, then blends into a full-frame background as you scroll.',
      avoidBarsDescription: 'Samples video colors instead of black bars.', fillBarsDescription: 'Shows ambient in the black-bar area without resizing the picture.',
      insetDescription: 'Higher values sample further inside the picture.', fpsDescription: '24–60 FPS. Higher values look smoother and use more resources.',
      compatibilityRenderingNotice: 'Compatibility rendering is in use on this page.',
      off: 'Ambient background is off.', fullscreen: 'The page background pauses in fullscreen.', waiting: 'Waiting for a video.',
      noBars: 'Black-bar detection is unavailable. Adjust Sample inset manually.', cropped: 'Sampling colors inside the black bars.',
      radialHint: 'Blends into a full-frame background as the video scrolls out of view.', fullFrameHint: 'Spreads the full video frame across the background.', failed: 'Unable to render a background for this video.'
    }
  };
  const canvas = document.createElement('canvas');
  canvas.id = 'yac-background';
  canvas.setAttribute('aria-hidden', 'true');
  const startupBackground = document.createElement('div');
  startupBackground.id = 'yac-startup-background';startupBackground.setAttribute('aria-hidden', 'true');startupBackground.hidden = true;
  let backgroundVideoKey = null, previewPlayer = null, previewQueued = false;
  const previewObserver = new MutationObserver(records => {
    if (previewQueued || !records.some(record => record.type === 'childList' || record.target === player ||
      record.target === video || record.target.matches?.('.ytp-cued-thumbnail-overlay, .ytp-cued-thumbnail-overlay-image'))) return;
    previewQueued = true;queueMicrotask(() => { previewQueued = false;if (!disposed) syncStartupBackground(); });
  });
  let renderer;
  let inputRevision = 0;
  const barCanvas = document.createElement('canvas');
  barCanvas.id = 'yac-bar-background';
  barCanvas.setAttribute('aria-hidden', 'true');
  const barLayer = document.createElement('div');
  barLayer.id = 'yac-bar-layer';
  barLayer.setAttribute('aria-hidden', 'true');
  barLayer.append(barCanvas);
  const barContext = barCanvas.getContext('2d', { alpha: false });
  let originalClip = null;
  let video = null, player = null, lastVideo = null, lastTime = -1, lastGeometry = '';
  let open = false;
  let blend = 0, lastBlendTime = performance.now();
  let frameRequest = 0, lastDrawFrame = 0, disposed = false, paintDue = true, forcePaint = true;
  let geometryCheckDue = true;
  let lastResizeLayout = null;
  let frameVideo = null, videoFrameRequest = null, frameEpoch = 0, frameSerial = 0, submittedSerial = -1;
  let chatDocument = null, chatFrame = null;
  const flashMonitor = new YacFlashMonitor();
  let settingsLoaded = false, flashWarningOpen = false, warnedVideoKey = '', warningFocus = null;
  let saveError = null, reloadRequired = false, warningPresentation = 0, reductionPresentation = null;
  let reducingWarning = false, retryingWarning = false, retryingPanel = false;
  const warningSaves = new Set();
  let lastSampleVideo = null, lastSampleTime = -1;
  const chatStyleId = 'yac-chat-style';
  // Theme extensions can give page surfaces more specific !important backgrounds.
  // Override only the surrounding surfaces while active, then restore their styles.
  const pageSurfaces = [
    'body', 'ytd-app', 'ytd-app > #content', '#page-manager', 'ytd-page-manager',
    'ytd-watch-flexy', 'ytd-watch-grid', 'ytd-masthead', 'ytd-masthead #background',
    ':is(ytd-watch-flexy,ytd-watch-grid) :is(#columns,#primary,#primary-inner,#secondary,#secondary-inner,#below,#panels,#full-bleed-container,#related,#comments,#description,#description-inner,ytd-comments,ytd-watch-metadata,ytd-playlist-panel-renderer,ytd-item-section-renderer,ytd-rich-grid-renderer,yt-chip-cloud-renderer)',
    ':is(ytd-watch-flexy,ytd-watch-grid) :is(.box.ytd-watch-flexy,.box.ytd-watch-grid,ytd-watch-next-secondary-results-renderer)',
    ':is(ytd-watch-flexy,ytd-watch-grid) :is(#below,#secondary,#panels) :is(div.ytd-watch-flexy,div.ytd-watch-grid,ytd-video-primary-info-renderer,ytd-video-secondary-info-renderer,ytd-ticket-shelf-renderer)',
    ':is(ytd-watch-flexy,ytd-watch-grid) :is(ytd-watch-metadata,ytd-video-primary-info-renderer,ytd-video-secondary-info-renderer) ytd-menu-renderer',
    ':is(ytd-watch-flexy,ytd-watch-grid) :is(ytd-watch-metadata,ytd-video-primary-info-renderer,ytd-video-secondary-info-renderer) :is(#above-the-fold,#title,#top-row,#owner,#bottom-row,#info-contents)',
    ':is(ytd-watch-flexy,ytd-watch-grid) :is(ytd-engagement-panel-section-list-renderer,ytd-engagement-panel-title-header-renderer,ytd-transcript-renderer,ytd-transcript-search-panel-renderer,ytd-transcript-search-box-renderer,ytd-transcript-segment-list-renderer,ytd-transcript-body-renderer,.input-container.ytd-transcript-search-box-renderer)',
    ':is(ytd-watch-flexy,ytd-watch-grid) ytd-engagement-panel-section-list-renderer :is(#content,#header,#subheader,#panel-content)',
    ':is(ytd-watch-flexy,ytd-watch-grid)[theater] :is(#player,#player-full-bleed-container,#player-container,#player-container-outer,#player-container-inner,#ytd-player,.player-container-background)',
    ':is(ytd-watch-flexy,ytd-watch-grid)[theater] #movie_player:not(.ytp-fullscreen):not(.ytp-miniplayer-ui)',
    ':is(ytd-watch-flexy,ytd-watch-grid)[theater] #movie_player:not(.ytp-fullscreen):not(.ytp-miniplayer-ui) :is(.html5-video-container,video.html5-main-video)',
    ':is(ytd-watch-flexy,ytd-watch-grid) ytd-playlist-panel-renderer :is(#container,#items)'
  ].join(',');
  const savedSurfaces = new Map();
  let surfacesDirty = true, surfaceJob = null, nextSurfaceRefresh = 0;
  function restoreSurface(element, properties) {
    for (const [name, original] of properties) {
      // A theme may change while ambient is active; keep changes we did not make.
      if (element.style.getPropertyValue(name) !== original.applied || element.style.getPropertyPriority(name) !== 'important') continue;
      if (original.value) element.style.setProperty(name, original.value, original.priority);
      else element.style.removeProperty(name);
    }
    savedSurfaces.delete(element);
  }
  function syncPageSurfaces(active) {
    const surfaces = active ? new Set(document.querySelectorAll(pageSurfaces)) : new Set();
    for (const [element, properties] of savedSurfaces) {
      if (!surfaces.has(element)) restoreSurface(element, properties);
    }
    for (const element of surfaces) {
      const overrides = { 'background-color': 'transparent', 'background-image': 'none', 'box-shadow': 'none' };
      // Keep one reading face on the panel. Its content/header wrappers stay
      // clear; the transcript field uses the same control paint as search.
      if (element.localName === 'ytd-engagement-panel-section-list-renderer') {
        overrides['background-color'] = 'var(--yac-card-surface)';
      } else if (element.matches('ytd-transcript-search-box-renderer .input-container')) {
        overrides['background-color'] = 'var(--yac-control-surface)';
      } else if (['ytd-watch-metadata', 'ytd-video-primary-info-renderer', 'ytd-video-secondary-info-renderer'].includes(element.localName)) {
        overrides['background-color'] = 'var(--yac-metadata-reading-face)';
      } else if (element.localName === 'ytd-comments' ||
        (element.id === 'description' && element.closest('ytd-watch-metadata,ytd-video-secondary-info-renderer'))) {
        overrides['background-color'] = 'var(--yac-reading-pane-face)';
      } else if (element.id === 'related' || element.localName === 'ytd-watch-next-secondary-results-renderer') {
        // Recommendation wrappers always stay clear. Playlist row surfaces
        // are separate, so no row's ancestor gains a second reading layer.
        overrides['background-color'] = 'var(--yac-related-reading-face)';
      } else if (['ytd-item-section-renderer', 'ytd-rich-grid-renderer'].includes(element.localName) &&
        element.closest('#related,ytd-watch-next-secondary-results-renderer')) {
        overrides['background-color'] = 'var(--yac-related-section-face)';
      }
      if (element.localName === 'ytd-app') {
        overrides['background-color'] = 'var(--yac-page-base)';
        overrides.isolation = 'isolate';
      }
      const properties = savedSurfaces.get(element) || new Map();
      savedSurfaces.set(element, properties);
      for (const [name, value] of Object.entries(overrides)) {
        const current = element.style.getPropertyValue(name), priority = element.style.getPropertyPriority(name);
        const previous = properties.get(name);
        const owned = previous && current === previous.applied && priority === 'important';
        if (owned && previous.applied === value) continue;
        element.style.setProperty(name, value, 'important');
        properties.set(name, { value: owned ? previous.value : current,
          priority: owned ? previous.priority : priority, applied: element.style.getPropertyValue(name) });
      }
    }
  }
  function cancelSurfaceRefresh() {
    if (!surfaceJob) return;
    if (surfaceJob.idle) cancelIdleCallback(surfaceJob.id);
    else clearTimeout(surfaceJob.id);
    surfaceJob = null;
  }
  function refreshPageSurfaces(immediate = false) {
    const active = document.documentElement.classList.contains('yac-active');
    if (disposed || !active || document.hidden || !surfacesDirty) return;
    if (immediate) {
      cancelSurfaceRefresh();
      surfacesDirty = false;
      syncPageSurfaces(true);
      nextSurfaceRefresh = performance.now() + 1000;
      return;
    }
    if (surfaceJob) return;
    const delay = Math.max(0, nextSurfaceRefresh - performance.now());
    if (delay) {
      surfaceJob = { idle: false, id: setTimeout(() => {
        surfaceJob = null; refreshPageSurfaces();
      }, delay) };
      return;
    }
    const run = () => { surfaceJob = null; refreshPageSurfaces(true); };
    surfaceJob = typeof requestIdleCallback === 'function' && typeof cancelIdleCallback === 'function' ?
      { idle: true, id: requestIdleCallback(run, { timeout: 1000 }) } :
      { idle: false, id: setTimeout(run, 0) };
  }
  function markSurfacesDirty() { surfacesDirty = true; refreshPageSurfaces(); }
  const commentContent = 'ytd-comment-thread-renderer,ytd-comment-renderer,ytd-comment-view-model,ytd-comment-replies-renderer';
  const surfaceClasses = new Set(['box', 'ytd-watch-flexy', 'ytd-watch-grid', 'player-container-background',
    'input-container', 'ytd-transcript-search-box-renderer', 'ytp-fullscreen', 'ytp-miniplayer-ui',
    'html5-video-container', 'html5-main-video']);
  const readingOwners = 'ytd-watch-metadata,ytd-video-primary-info-renderer,ytd-video-secondary-info-renderer';
  const ownElement = element => element?.nodeType === 1 && !!element.closest('[id^="yac-"]');
  function relevantSurfaceMutation(record) {
    const element = record.target;
    if (ownElement(element) || element.nodeType === 1 && element.closest(commentContent)) return false;
    if (record.type === 'attributes') {
      if (record.attributeName === 'style') {
        // Ignore our applied styles and unrelated clip-path/opacity changes.
        const properties = savedSurfaces.get(element);
        return properties && [...properties].some(([name, original]) =>
          element.style.getPropertyValue(name) !== original.applied || element.style.getPropertyPriority(name) !== 'important');
      }
      if (record.attributeName === 'theater') return element.matches('ytd-watch-flexy,ytd-watch-grid');
      if (record.attributeName === 'class') {
        const structuralClasses = value => (value || '').split(/\s+/).filter(name => surfaceClasses.has(name)).sort().join(' ');
        if (structuralClasses(record.oldValue) === structuralClasses(element.getAttribute('class'))) return false;
      }
      return savedSurfaces.has(element) || element.matches(pageSurfaces);
    }
    // Comment bodies/threads do not contain the structural page surfaces we guard.
    // Do not turn a batch of loaded comments into repeated whole-page scans.
    for (const node of record.addedNodes) {
      if (node.nodeType !== 1 || ownElement(node) || node.matches(commentContent)) continue;
      if (node.matches(pageSurfaces) || node.querySelector(pageSurfaces)) return true;
    }
    for (const node of record.removedNodes) {
      if (node.nodeType !== 1 || ownElement(node) || node.matches(commentContent)) continue;
      for (const surface of savedSurfaces.keys()) if (node.contains(surface)) return true;
    }
    return false;
  }
  const surfaceObserver = new MutationObserver(records => {
    if (disposed) return;
    // Activation and visibility resume perform one complete synchronization.
    // Avoid walking every added subtree while native UI paint is retained or
    // the tab is hidden; keep the pending change for that synchronization.
    if (document.hidden || !document.documentElement.classList.contains('yac-active')) {
      surfacesDirty = true;
      return;
    }
    const relevant = records.filter(relevantSurfaceMutation);
    if (!relevant.length) return;
    surfacesDirty = true;
    // Theater/fullscreen container changes must not expose an opaque surround
    // while waiting for the normal coalesced refresh.
    const modeChange = relevant.some(record => record.type === 'attributes' &&
      (record.attributeName === 'theater' || record.attributeName === 'class' && record.target.id === 'movie_player'));
    // A native metadata shell can be replaced in a single navigation/layout
    // update. Apply its face in the observer microtask, before the next paint,
    // instead of leaving an inline theme background for the coalescing window.
    const readingOwnerChange = relevant.some(record => record.type === 'attributes' ?
      record.attributeName === 'style' && record.target.matches(readingOwners) :
      [...record.addedNodes].some(node => node.nodeType === 1 &&
        (node.matches(readingOwners) || node.querySelector(readingOwners))));
    refreshPageSurfaces(modeChange || readingOwnerChange);
  });
  surfaceObserver.observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeOldValue: true,
    attributeFilter: ['style', 'class', 'id', 'theater']
  });
  // Chat is a separate document. Match only native monochrome shapes so
  // paid messages, rank badges and other semantic colors keep their paint.
  const chatNeutralControl = ':is(.ytSpecButtonShapeNextHost.ytSpecButtonShapeNextMono,.yt-spec-button-shape-next.yt-spec-button-shape-next--mono):is(.ytSpecButtonShapeNextTonal,.ytSpecButtonShapeNextOutline,.ytSpecButtonShapeNextText,.ytSpecButtonShapeNextFilled,.yt-spec-button-shape-next--tonal,.yt-spec-button-shape-next--outline,.yt-spec-button-shape-next--text,.yt-spec-button-shape-next--filled)';
  const chatCss = [
    `html.yac-chat-active{
      --yt-live-chat-background-color:transparent;--yt-live-chat-action-panel-background-color:transparent;
      --yac-reading-rgb:255,255,255;
      --yac-chat-surface:rgba(var(--yac-reading-rgb),var(--yac-reading-opacity));
      --yac-chat-header-surface:rgba(var(--yac-reading-rgb),var(--yac-chat-header-opacity));
      --yac-chat-overlay-surface:rgba(var(--yac-reading-rgb),var(--yac-chat-overlay-opacity));
      --yac-chat-menu-feedback:rgba(0,0,0,calc(.10 * var(--yac-navigation-level,1)));
      --yac-control-text:var(--yt-spec-text-primary,#0f0f0f);
      --yac-control-backdrop:blur(var(--yac-control-blur)) contrast(var(--yac-control-light-contrast)) brightness(var(--yac-control-light-brightness));
      --yac-control-hover-backdrop:var(--yac-control-backdrop);
      background-color:var(--yac-chat-surface)!important;background-image:none!important;
    }
    html.yac-chat-active:is([dark],:has(link#efyt-dark-theme)){
      --yac-reading-rgb:var(--yac-control-rgb);--yac-chat-menu-feedback:rgba(255,255,255,calc(.10 * var(--yac-navigation-level,1)));
      --yac-control-text:var(--main-text,var(--yt-spec-text-primary,#f1f1f1));
      --yac-control-backdrop:blur(var(--yac-control-blur)) brightness(var(--yac-control-dark-brightness));
      --yac-control-hover-backdrop:blur(var(--yac-control-blur)) brightness(var(--yac-control-dark-hover-brightness));
    }`,
    'html.yac-chat-active body,html.yac-chat-active yt-live-chat-app,html.yac-chat-active yt-live-chat-renderer,html.yac-chat-active yt-live-chat-item-list-renderer,html.yac-chat-active yt-live-chat-ticker-renderer,html.yac-chat-active yt-live-chat-renderer #chat,html.yac-chat-active yt-live-chat-renderer #contents,html.yac-chat-active yt-live-chat-renderer #items,html.yac-chat-active yt-live-chat-renderer #item-scroller,html.yac-chat-active yt-live-chat-renderer #panel-pages{background-color:transparent!important;background-image:none!important}',
    'html.yac-chat-active yt-live-chat-message-input-renderer,html.yac-chat-active yt-live-chat-message-input-renderer #input-container{background:transparent!important;box-shadow:none!important}',
    'html.yac-chat-active yt-live-chat-text-message-renderer{text-shadow:0 1px 3px #fff9}',
    'html.yac-chat-active:is([dark],:has(link#efyt-dark-theme)) yt-live-chat-text-message-renderer{text-shadow:0 1px 3px #000b}',
    `html.yac-chat-active yt-live-chat-header-renderer{
      background-color:var(--yac-chat-header-surface)!important;background-image:none!important;
      -webkit-backdrop-filter:blur(var(--yac-reading-blur))!important;backdrop-filter:blur(var(--yac-reading-blur))!important;
    }
    /* DeepDark paints direct dropdown children with a three-class selector.
       Override that popup face without clearing its semantic descendants. */
    html.yac-chat-active .dropdown-content.style-scope.ytd-popup-container > ytd-menu-popup-renderer,
    html.yac-chat-active :is(ytd-menu-popup-renderer,ytd-engagement-panel-section-list-renderer),
    html.yac-chat-active yt-live-chat-header-renderer yt-dropdown-menu :is(tp-yt-paper-listbox,paper-listbox){
      background-color:var(--yac-chat-overlay-surface)!important;background-image:none!important;
      -webkit-backdrop-filter:blur(var(--yac-navigation-blur))!important;backdrop-filter:blur(var(--yac-navigation-blur))!important;
    }
    html.yac-chat-active .dropdown-content.style-scope.ytd-popup-container > ytd-menu-popup-renderer,
    html.yac-chat-active ytd-menu-popup-renderer{
      box-shadow:0 4px 32px rgba(0,0,0,calc(.10 * var(--yac-navigation-level,1)))!important;
    }
    html.yac-chat-active ytd-menu-popup-renderer :is(tp-yt-paper-listbox,paper-listbox),
    html.yac-chat-active ytd-engagement-panel-section-list-renderer :is(#content,#header,ytd-engagement-panel-title-header-renderer){
      background-color:transparent!important;background-image:none!important;
    }
    html.yac-chat-active yt-live-chat-header-renderer yt-dropdown-menu :is(tp-yt-paper-listbox,paper-listbox) > a.yt-simple-endpoint{
      background-color:transparent!important;background-image:none!important;
    }
    html.yac-chat-active yt-live-chat-header-renderer yt-dropdown-menu :is(tp-yt-paper-listbox,paper-listbox) > a.yt-simple-endpoint:is(:hover,:focus-visible,.iron-selected,[aria-selected="true"]){
      background-color:var(--yac-chat-menu-feedback)!important;
    }`,
    `html.yac-chat-active :is(ytd-menu-popup-renderer,ytd-engagement-panel-section-list-renderer){
      --yac-control-surface:transparent;
      --yac-control-hover-surface:rgba(var(--yac-reading-rgb),calc(.12 * var(--yac-navigation-level)));
      --yac-control-selected-surface:rgba(var(--yac-reading-rgb),calc(.20 * var(--yac-navigation-level)));
      --yac-control-feedback:var(--yac-navigation-level);
      --yac-control-backdrop:none;--yac-control-hover-backdrop:none;
    }
    html.yac-chat-active ${chatNeutralControl}{
      background-color:var(--yac-control-surface)!important;background-image:none!important;
      -webkit-backdrop-filter:var(--yac-control-backdrop)!important;backdrop-filter:var(--yac-control-backdrop)!important;
    }
    html.yac-chat-active ${chatNeutralControl}:is(:hover,:focus-visible){
      background-color:var(--yac-control-hover-surface)!important;
      -webkit-backdrop-filter:var(--yac-control-hover-backdrop)!important;backdrop-filter:var(--yac-control-hover-backdrop)!important;
    }
    html.yac-chat-active ${chatNeutralControl}:is([aria-pressed="true"],[aria-selected="true"]){
      background-color:var(--yac-control-selected-surface)!important;
    }
    html.yac-chat-active ${chatNeutralControl}:is(.ytSpecButtonShapeNextFilled,.yt-spec-button-shape-next--filled){
      color:var(--yac-control-text);
    }
    html.yac-chat-active ${chatNeutralControl} :is(.ytSpecTouchFeedbackShapeFill,.yt-spec-touch-feedback-shape__fill){
      filter:opacity(var(--yac-control-feedback))!important;
    }`
  ].join('\n');
  const removers = new Set();
  function listen(target, type, callback, options) {
    target.addEventListener(type, callback, options);
    const remove = () => { target.removeEventListener(type, callback, options); removers.delete(remove); };
    removers.add(remove);
    return remove;
  }
  const fields = {}, outputs = {}, fieldLabels = {}, descriptions = {}, infoButtons = {};
  const makeIcon = (name, size = 24) => YacIcons.create(name, size);
  const launcher = document.createElement('div');launcher.id = 'yac-launcher';
  const button = document.createElement('button');
  button.id = 'yac-settings-button';
  button.type = 'button';
  for (const [key, value] of Object.entries({
    'aria-label': '設定を開く', 'aria-haspopup': 'dialog',
    'aria-expanded': 'false', 'aria-controls': 'yac-controls'
  })) button.setAttribute(key, value);
  button.append(makeIcon('settings-2'));
  const tooltip = document.createElement('span');
  tooltip.className = 'yac-tooltip';
  tooltip.textContent = 'アンビエント設定';
  tooltip.setAttribute('aria-hidden', 'true');
  button.append(tooltip);
  launcher.append(button);
  const playbackButton = document.createElement('button');playbackButton.id = 'yac-playback-button';playbackButton.type = 'button';playbackButton.className = 'ytp-button';
  playbackButton.setAttribute('aria-haspopup', 'dialog');playbackButton.setAttribute('aria-expanded', 'false');playbackButton.setAttribute('aria-controls', 'liquid-ui-quick-panel');
  playbackButton.append(makeIcon('gauge', 20));
  let playbackControls = null;
  const playbackControlsObserver = new MutationObserver(() => { if (!disposed) syncPlaybackLauncher(); });
  function syncPlaybackLauncher() {
    const next = location.pathname === '/watch' && typeof globalThis.LiquidUI?.openPlaybackPanel === 'function' ? player?.querySelector('.ytp-right-controls') : null;
    if (next !== playbackControls) { playbackControlsObserver.disconnect();playbackControls = next;if (next) playbackControlsObserver.observe(next, { childList: true }); }
    if (next && playbackButton.parentElement !== next) {
      // YouTube may nest its settings button inside a control group. The
      // insertion reference must be a direct child of the controls container.
      let reference = next.querySelector('.ytp-settings-button');
      while (reference && reference.parentElement !== next) reference = reference.parentElement;
      next.insertBefore(playbackButton, reference);
    }
    else if (!next) playbackButton.remove();
  }
  listen(playbackButton, 'click', event => { event.preventDefault();event.stopPropagation();setOpen(false);globalThis.LiquidUI?.openPlaybackPanel?.(playbackButton); });
  listen(playbackButton, 'dblclick', event => { event.preventDefault();event.stopPropagation(); });
  listen(playbackButton, 'keydown', event => event.stopPropagation());listen(playbackButton, 'keyup', event => event.stopPropagation());

  // YouTube replaces #buttons children during SPA navigation. Keep our node
  // outside that managed list and reserve its space even while native items change.
  let headerEnd = null, headerButtons = null, headerCreate = null, headerGap = 8, headerPadding = 0, headerMeasured = false;
  function positionHeaderLauncher() {
    if (!headerEnd || !headerButtons || launcher.hidden) return;
    const end = headerEnd.getBoundingClientRect(), anchor = (headerCreate || headerButtons).getBoundingClientRect();
    const rtl = getComputedStyle(headerEnd).direction === 'rtl';
    const offset = headerCreate ? (rtl ? end.right - anchor.left : anchor.right - end.left) + headerGap : (rtl ? end.right - anchor.right : anchor.left - end.left) + headerPadding;
    const property = rtl ? 'right' : 'left', opposite = rtl ? 'left' : 'right', value = offset + 'px';
    if (launcher.style[property] !== value) launcher.style[property] = value;
    if (launcher.style[opposite] !== 'auto') launcher.style[opposite] = 'auto';
    if (open) positionPanel();
  }
  const headerResizeObserver = new ResizeObserver(positionHeaderLauncher);
  const headerObserver = new MutationObserver(records => {
    if (disposed) return;
    if (records.some(record => (record.target === headerButtons || record.target === headerEnd) &&
      [...record.addedNodes, ...record.removedNodes].some(node => node !== launcher))) syncHeaderLauncher(true);
  });
  function syncHeaderLauncher(reposition = false) {
    const nextButtons = document.querySelector('ytd-masthead #end #buttons'), nextEnd = nextButtons?.parentElement || null;
    const nextCreate = nextButtons && Array.from(nextButtons.children).find(node => node.localName === 'ytd-button-renderer') || null;
    const changed = nextEnd !== headerEnd || nextButtons !== headerButtons || nextCreate !== headerCreate;
    if (!headerMeasured && nextButtons) {
      const gap = nextCreate && parseFloat(getComputedStyle(nextCreate).marginInlineEnd);
      headerGap = Number.isFinite(gap) ? gap : 8;
      headerPadding = parseFloat(getComputedStyle(nextButtons).paddingInlineStart) || 0;
      document.documentElement.style.setProperty('--yac-header-native-gap', headerGap + 'px');
      document.documentElement.style.setProperty('--yac-header-native-padding', headerPadding + 'px');
      headerMeasured = true;
    }
    if (nextEnd !== headerEnd) {
      headerObserver.disconnect();headerResizeObserver.disconnect();playbackControlsObserver.disconnect();playbackControls = null;
      if (nextEnd) { headerObserver.observe(nextEnd, { childList: true, subtree: true });headerResizeObserver.observe(nextEnd); }
    }
    headerEnd = nextEnd;headerButtons = nextButtons;headerCreate = nextCreate;
    document.documentElement.classList.toggle('yac-header-controls', !!headerEnd);
    if (headerEnd && launcher.parentElement !== headerEnd) { headerEnd.append(launcher);reposition = true; }
    launcher.hidden = !headerEnd;button.hidden = launcher.hidden;
    if (launcher.hidden) setOpen(false);
    else if (changed || reposition) positionHeaderLauncher();
  }

  const panel = document.createElement('div');
  panel.id = 'yac-controls';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'アンビエント設定');
  panel.style.setProperty('background-color', 'rgba(24, 26, 30, var(--yac-settings-opacity, .90))', 'important');
  // Direct DOM construction also works on pages requiring TrustedHTML.
  const root = panel.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = [
    ':host{position:fixed;right:12px;top:60px;z-index:2200;display:flex;flex-direction:column;box-sizing:border-box;width:380px;max-width:calc(100% - 16px);overflow:visible;color:#f1f3f5;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;text-align:left;text-shadow:none;background:rgba(24,26,30,var(--yac-settings-opacity,.90))!important;border:1px solid rgba(255,255,255,calc(.10 * var(--yac-settings-level,1)))!important;border-radius:16px!important;box-shadow:0 12px 36px rgba(0,0,0,calc(.24 * var(--yac-settings-level,1)))!important;backdrop-filter:blur(calc(12px * var(--yac-settings-level,1)));-webkit-backdrop-filter:blur(calc(12px * var(--yac-settings-level,1)));color-scheme:dark}',
    ':host([hidden]),[hidden]{display:none!important}*{box-sizing:border-box}.body{padding:0 16px 16px;min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;border-radius:0 0 15px 15px}',
    'header{display:flex;flex-shrink:0;align-items:center;gap:8px;min-height:60px;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,calc(.07 * var(--yac-settings-level,1)))}h2{flex:1;min-width:0;margin:0;font-size:16px;font-weight:600;letter-spacing:.01em}',
    'button{display:inline-flex;align-items:center;justify-content:center;min-width:32px;min-height:32px;padding:0;color:inherit;background:transparent;border:0;border-radius:8px;font:inherit;cursor:pointer}button:hover{background:rgba(255,255,255,calc(.08 * var(--yac-settings-level,1)))}svg{display:block;flex-shrink:0;pointer-events:none}',
    '.menu-item{display:flex;align-items:center;width:100%;gap:14px;min-height:68px;padding:12px 8px;border-radius:10px;text-align:left}.menu-copy{flex:1;min-width:0}.menu-title{display:block;font-size:14px;line-height:22px;font-weight:500}.menu-description{display:block;margin-top:2px;color:#aeb4bd;font-size:12px;line-height:18px}.menu-icon{display:flex;align-items:center;color:#d4d9e1}.menu-item>svg{color:#969ea9}',
    'select{min-width:0;max-width:48%;padding:8px 10px;border:1px solid rgba(255,255,255,calc(.14 * var(--yac-settings-level,1)));border-radius:8px;background:rgba(255,255,255,calc(.04 * var(--yac-settings-level,1)));color:inherit;font:inherit;cursor:pointer}option{background:#181a1e;color:#f1f3f5}',
    '.setting-row{position:relative;padding:16px 0;border-top:1px solid rgba(255,255,255,calc(.07 * var(--yac-settings-level,1)))}.setting-row:first-child{border-top:0}.toggle,.language{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:56px}.toggle{flex-wrap:wrap}.setting-heading{display:flex;align-items:center;gap:6px;min-width:0}.toggle .setting-heading{flex:1}.setting-heading label{min-width:0;cursor:pointer}.slider-heading{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.slider-heading output{margin-left:auto}#yac-settings-menu>.setting-row{margin:12px 0 8px;padding:12px;min-height:64px;border-radius:10px;background:rgba(255,255,255,calc(.04 * var(--yac-settings-level,1)))}',
    '.info{flex:0 0 28px;min-width:28px;min-height:28px;color:#969ea9}.info:hover,.info[aria-expanded=true]{color:#f1f3f5}.help-popover{position:absolute;left:0;top:0;z-index:1;display:flex;flex-direction:column;gap:12px;width:300px;padding:16px;border:1px solid rgba(255,255,255,calc(.14 * var(--yac-settings-level,1)));border-radius:12px;background:rgba(24,26,30,var(--yac-settings-opacity,.90));box-shadow:0 8px 28px rgba(0,0,0,calc(.28 * var(--yac-settings-level,1)));backdrop-filter:blur(calc(12px * var(--yac-settings-level,1)));-webkit-backdrop-filter:blur(calc(12px * var(--yac-settings-level,1)))}.help-heading{display:flex;align-items:center;gap:8px;flex-shrink:0}.help-heading h3{flex:1;min-width:0;margin:0;font-size:14px;line-height:22px;font-weight:600}.help-close{flex-shrink:0}.hint{min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;margin:0;color:#cbd0d8;font-size:13px;line-height:1.7}.applied{display:block;font-size:12px;color:#aeb4bd;font-weight:400}',
    'input{accent-color:#fff}input[type=range]{appearance:none;display:block;width:100%;height:36px;margin:8px 0 0;padding:0;cursor:pointer;background:transparent}',
    'input[type=range]::-webkit-slider-runnable-track{height:4px;border-radius:4px;background:linear-gradient(to right,#e9edf2 0%,#e9edf2 var(--progress),#ffffff26 var(--progress),#ffffff26 100%)}input[type=range]::-webkit-slider-thumb{appearance:none;width:18px;height:18px;margin-top:-7px;border:0;border-radius:50%;background:#e9edf2}',
    'input[type=range]::-moz-range-track{height:4px;background:#ffffff26;border-radius:4px}input[type=range]::-moz-range-progress{height:4px;background:#e9edf2;border-radius:4px}input[type=range]::-moz-range-thumb{width:18px;height:18px;border:0;border-radius:50%;background:#e9edf2}',
    'input[type=checkbox]{appearance:none;position:relative;margin:0;flex:0 0 40px;width:40px;height:24px;border:0;border-radius:14px;background:#5b626d;cursor:pointer}',
    'input[type=checkbox]::before{content:"";position:absolute;left:3px;top:3px;width:18px;height:18px;border-radius:50%;background:#e9edf2;transition:transform .12s}',
    'input[type=checkbox]:checked{background:#e3e7ed}input[type=checkbox]:checked::before{background:#20242a;transform:translateX(16px)}',
    'output{flex-shrink:0;color:#e3e7ed;text-align:right;font-variant-numeric:tabular-nums}p.status{position:relative;margin:12px 0 0;padding:12px 4px 0;border-top:1px solid rgba(255,255,255,calc(.07 * var(--yac-settings-level,1)));font-size:12px;line-height:18px;color:#969ea9}.loaded-version{position:absolute;top:0;right:4px;font-size:12px;line-height:12px;white-space:nowrap;font-variant-numeric:tabular-nums}',
    '.save-error{margin:12px 0;padding:12px;border:1px solid rgba(255,255,255,calc(56 / 255 * var(--yac-settings-level,1)));border-radius:8px;font-size:12px;color:#eee}.save-error[hidden]{display:none}.save-error button{display:block;width:auto;height:auto;min-height:36px;margin-top:8px;padding:6px 12px;border:1px solid rgba(255,255,255,calc(56 / 255 * var(--yac-settings-level,1)));font:inherit}.save-error button[aria-disabled=true]{opacity:.6;cursor:wait}',
    ':focus-visible{outline:2px solid #e9edf2;outline-offset:2px}@media(pointer:coarse){button{min-height:44px;min-width:44px}.info{flex-basis:44px}.setting-row{padding-block:16px}input[type=range]{height:44px}}@media(prefers-reduced-motion:reduce){input[type=checkbox]::before{transition:none}}'
  ].join('\n');
  root.append(style);
  const body = document.createElement('div');
  body.className = 'body';
  root.append(body);
  const header = document.createElement('header');
  const heading = document.createElement('h2');
  heading.textContent = '設定';
  const back = document.createElement('button');back.id = 'yac-settings-back';back.type = 'button';back.hidden = true;back.append(makeIcon('arrow-left', 20));
  const close = document.createElement('button');
  close.type = 'button';
  close.id = 'yac-settings-close';close.className = 'close';close.append(makeIcon('x', 20));
  close.setAttribute('aria-label', '設定を閉じる');
  header.append(back, heading, close);
  root.append(header, body);
  const allSettingsLabel = document.createTextNode('');
  if (globalThis.LiquidUI) {
    const allSettings = document.createElement('button');
    allSettings.type = 'button';allSettings.id = 'yac-all-settings';
    allSettings.style.cssText = 'width:100%;min-height:44px;padding:12px;font:inherit;text-align:left';
    allSettings.append(makeIcon('settings-2'), allSettingsLabel);
    root.append(allSettings);
    listen(allSettings, 'click', () => { setOpen(false);LiquidUI.open({ site: 'youtube' }); });
  }
  const menu = document.createElement('nav');menu.id = 'yac-settings-menu';
  const pages = {}, menuLabels = {}, menuDescriptions = {}, menuButtons = {};
  const groups = {
    appearance: ['radial', 'strength', 'blur', 'saturation'],
    surfaces: ['surfaceMultiplier', 'controlDensity', 'readingDensity', 'navigationDensity'],
    rendering: ['avoidBars', 'fillBars', 'inset', 'fps'],
    safety: ['flashWarning', 'language']
  };
  const categoryIcons = { appearance: 'sun', surfaces: 'panels-top-left', rendering: 'scan-line', safety: 'shield-check' };
  let currentPage = '', helpRow = null;
  const helpEntries = new Map();
  function hideHelp(returnFocus = false) {
    if (!helpRow) return;
    const previous = helpRow, entry = helpEntries.get(previous);
    const restoreFocus = returnFocus || entry.popover.contains(root.activeElement);
    helpRow = null;
    previous.removeAttribute('data-help-open');
    entry.hint.hidden = true;entry.popover.hidden = true;
    entry.trigger.setAttribute('aria-expanded', 'false');
    if (!restoreFocus || !open || panel.hidden || disposed || document.hidden || document.fullscreenElement || !panel.isConnected) return;
    // Scrolling can hide the focused explanation and its opener together.
    // Keep keyboard recovery in the visible settings without moving the scroll.
    const anchor = entry.trigger.isConnected ? entry.trigger.getBoundingClientRect() : null;
    const bodyBox = body.getBoundingClientRect();
    const visible = anchor && anchor.top >= bodyBox.top && anchor.bottom <= bodyBox.bottom && anchor.left >= bodyBox.left && anchor.right <= bodyBox.right;
    const fallback = currentPage ? back : close, target = visible ? entry.trigger : fallback;
    target.focus({ preventScroll: true });
    if (focusedElement() !== target && target !== fallback) fallback.focus({ preventScroll: true });
  }
  function positionHelp() {
    if (!open || !helpRow || document.hidden) return;
    const entry = helpEntries.get(helpRow), panelBox = panel.getBoundingClientRect();
    const anchor = entry.trigger.getBoundingClientRect(), bodyBox = body.getBoundingClientRect();
    if (!entry.trigger.isConnected || anchor.bottom <= bodyBox.top || anchor.top >= bodyBox.bottom) { hideHelp();return; }
    const panelStyle = getComputedStyle(panel);
    const originLeft = panelBox.left + (parseFloat(panelStyle.borderLeftWidth) || 0);
    const originTop = panelBox.top + (parseFloat(panelStyle.borderTopWidth) || 0);
    const margin = 8, gap = 12, width = Math.min(300, Math.max(1, panelBox.width - 32), Math.max(1, innerWidth - margin * 2));
    const beside = panelBox.left - width - gap >= margin;
    const left = Math.max(margin, Math.min(beside ? panelBox.left - width - gap : panelBox.left + 16, innerWidth - width - margin));
    entry.popover.setAttribute('data-placement', beside ? 'left' : 'overlay');
    entry.popover.style.width = width + 'px';
    entry.popover.style.maxWidth = Math.max(1, innerWidth - margin * 2) + 'px';
    entry.popover.style.maxHeight = Math.max(1, innerHeight - margin * 2) + 'px';
    entry.popover.style.left = left - originLeft + 'px';
    const height = entry.popover.getBoundingClientRect().height;
    const top = Math.max(margin, Math.min(anchor.top - 8, innerHeight - height - margin));
    entry.popover.style.top = top - originTop + 'px';
    entry.hint.tabIndex = entry.hint.scrollHeight > entry.hint.clientHeight ? 0 : -1;
  }
  function showHelp(row) {
    hideHelp();helpRow = row;
    const entry = helpEntries.get(row);
    row.setAttribute('data-help-open', 'true');
    entry.hint.hidden = false;entry.popover.hidden = false;
    entry.trigger.setAttribute('aria-expanded', 'true');
    positionHelp();
    if (helpRow) entry.close.focus({ preventScroll: true });
  }
  function resetHelp() {
    hideHelp();
  }
  listen(body, 'scroll', () => hideHelp(), { passive: true });
  for (const key of Object.keys(groups)) {
    const item = document.createElement('button');item.type = 'button';item.className = 'menu-item';item.id = 'yac-menu-' + key;
    item.setAttribute('aria-controls', 'yac-page-' + key);
    const icon = document.createElement('span');icon.className = 'menu-icon';icon.append(makeIcon(categoryIcons[key]));
    const copy = document.createElement('span');copy.className = 'menu-copy';
    menuLabels[key] = document.createElement('span');menuLabels[key].className = 'menu-title';
    menuDescriptions[key] = document.createElement('span');menuDescriptions[key].className = 'menu-description';
    copy.append(menuLabels[key], menuDescriptions[key]);item.append(icon, copy, makeIcon('chevron-right', 20));menu.append(item);menuButtons[key] = item;
    const page = document.createElement('section');page.id = 'yac-page-' + key;page.hidden = true;pages[key] = page;
    listen(item, 'click', () => showPage(key, true));
  }
  function showPage(key = '', focus = false) {
    resetHelp();
    currentPage = key;panel.setAttribute('data-page', key);menu.hidden = !!key;back.hidden = !key;
    for (const [name, page] of Object.entries(pages)) page.hidden = name !== key;
    heading.textContent = translations[settings.language][key || 'title'];body.scrollTop = 0;
    positionPanel();
    if (focus) (key ? back : menuButtons.appearance).focus({ preventScroll: true });
  }
  function fieldRow(key, type) {
    const row = document.createElement('div');row.className = 'setting-row ' + type;
    const copy = document.createElement('span');copy.className = 'setting-heading';
    const label = document.createElement('label');label.htmlFor = 'yac-' + key;fieldLabels[key] = document.createTextNode('');label.append(fieldLabels[key]);copy.append(label);
    let hint;
    if (key !== 'language') {
      const info = document.createElement('button');info.type = 'button';info.className = 'info';info.append(makeIcon('info', 18));info.setAttribute('aria-expanded', 'false');info.setAttribute('aria-haspopup', 'dialog');info.setAttribute('aria-controls', 'yac-' + key + '-help');infoButtons[key] = info;
      const popover = document.createElement('div');popover.id = 'yac-' + key + '-help';popover.className = 'help-popover';popover.hidden = true;popover.setAttribute('role', 'dialog');popover.setAttribute('aria-labelledby', 'yac-' + key + '-help-title');popover.setAttribute('aria-describedby', 'yac-' + key + '-hint');
      const helpHeading = document.createElement('div');helpHeading.className = 'help-heading';
      const helpTitle = document.createElement('h3');helpTitle.id = 'yac-' + key + '-help-title';
      const helpClose = document.createElement('button');helpClose.type = 'button';helpClose.className = 'help-close';helpClose.append(makeIcon('x', 18));
      hint = document.createElement('p');hint.id = 'yac-' + key + '-hint';hint.className = 'hint';hint.hidden = true;descriptions[key + 'Description'] = hint;
      helpHeading.append(helpTitle, helpClose);popover.append(helpHeading, hint);root.append(popover);
      helpEntries.set(row, { key, trigger: info, popover, hint, title: helpTitle, close: helpClose });
      info.setAttribute('aria-describedby', hint.id);
      copy.append(info);fields[key].setAttribute('aria-describedby', hint.id);
      listen(helpClose, 'click', () => hideHelp(true));
      listen(info, 'click', () => {
        if (helpRow === row) hideHelp(true);
        else showHelp(row);
      });
    }
    row.append(copy);
    return { row, copy, hint };
  }
  fields.language = document.createElement('select');
  fields.language.id = 'yac-language';
  fields.language.setAttribute('aria-label', translations.ja.language);
  for (const [value, name] of [['ja', '日本語'], ['en', 'English']]) {
    const option = document.createElement('option');
    option.value = value; option.textContent = name;
    fields.language.append(option);
  }
  const languageRow = fieldRow('language', 'language');languageRow.row.append(fields.language);pages.safety.append(languageRow.row);
  for (const key of booleanKeys) {
    fields[key] = document.createElement('input');
    fields[key].type = 'checkbox';
    fields[key].id = 'yac-' + key;
    fields[key].setAttribute('role', 'switch');
    const { row } = fieldRow(key, 'toggle');row.append(fields[key]);
    if (key === 'enabled') menu.prepend(row);
    else pages[Object.keys(groups).find(name => groups[name].includes(key))].append(row);
  }
  for (const [key, min, max] of [
    ['surfaceMultiplier', 0, 100], ['controlDensity', 0, 100], ['readingDensity', 0, 100], ['navigationDensity', 0, 100],
    ['strength', 15, 100], ['blur', 0, 160], ['saturation', 0, 250], ['inset', 0, 40], ['fps', 24, 60]
  ]) {
    fields[key] = document.createElement('input');
    fields[key].id = 'yac-' + key;
    fields[key].type = 'range';
    fields[key].min = min;
    fields[key].max = max;
    fields[key].step = '1';
    outputs[key] = document.createElement('output');
    const { row, copy } = fieldRow(key, 'slider-label');
    const sliderHeading = document.createElement('div');sliderHeading.className = 'slider-heading';sliderHeading.append(copy, outputs[key]);row.append(sliderHeading, fields[key]);
    pages[Object.keys(groups).find(name => groups[name].includes(key))].append(row);
  }
  pages.safety.append(languageRow.row);
  const status = document.createElement('p');
  status.className = 'status';
  const statusText = document.createElement('span');statusText.className = 'status-message';
  const versionLabel = document.createElement('span');versionLabel.id = 'yac-loaded-version';versionLabel.className = 'loaded-version';
  status.append(statusText, versionLabel);
  function createSaveNotice() {
    const container = document.createElement('div');container.className = 'save-error';container.hidden = true;
    container.setAttribute('role', 'alert');
    const message = document.createElement('span');
    const retry = document.createElement('button');retry.type = 'button';
    container.append(message, retry);
    return { container, message, retry };
  }
  const panelSaveNotice = createSaveNotice();
  body.append(menu, ...Object.values(pages), panelSaveNotice.container, status);
  let statusKey = 'waiting';
  function setStatus(key) {
    statusKey = key;
    const text = translations[settings.language][key];
    if (statusText.textContent !== text) statusText.textContent = text;
  }
  function localizeDescriptions() {
    const text = translations[settings.language];
    const separator = settings.language === 'ja' ? '' : ' ';
    const openHint = helpRow ? helpEntries.get(helpRow).hint : null;
    let reflowOpenHelp = false;
    for (const [key, element] of Object.entries(descriptions)) {
      const notice = key === 'fpsDescription' && canvas.dataset.workerFallbackState === 'active' ? text.compatibilityRenderingNotice : '';
      const description = text[key] + (notice ? separator + notice : '');
      if (element.textContent === description) continue;
      element.textContent = description;
      if (element === openHint) reflowOpenHelp = true;
    }
    if (reflowOpenHelp) positionHelp();
  }
  function localize() {
    const text = translations[settings.language];
    allSettingsLabel.textContent = ' ' + text.allSettings;
    const versionText = loadedVersion ? text.loadedVersion.replace('{version}', loadedVersion) : text.versionUnavailable;
    if (versionLabel.textContent !== versionText) versionLabel.textContent = versionText;
    heading.textContent = text[currentPage || 'title'];
    tooltip.textContent = globalThis.LiquidUI?.togglePanel ?
      (settings.language === 'ja' ? (LiquidUI.isPanelOpen?.() ? '簡易パネルを閉じる' : 'Flexible UIの簡易パネルを開く') : (LiquidUI.isPanelOpen?.() ? 'Close quick panel' : 'Open Flexible UI quick panel')) : open ? text.close : text.openSettings;
    button.setAttribute('aria-label', tooltip.textContent);
    const playbackLabel = settings.language === 'ja' ? '再生調整' : 'Playback adjustment';playbackButton.setAttribute('title', playbackLabel);playbackButton.setAttribute('aria-label', playbackLabel);
    fields.enabled.setAttribute('aria-label', text.enabled);
    panel.setAttribute('aria-label', text.title);
    panel.lang = settings.language;
    close.setAttribute('aria-label', text.close);
    back.setAttribute('aria-label', text.back);
    fields.language.value = settings.language;
    menu.setAttribute('aria-label', text.title);
    for (const key of Object.keys(groups)) {
      menuLabels[key].textContent = text[key];menuDescriptions[key].textContent = text[key + 'Description'];pages[key].setAttribute('aria-label', text[key]);
    }
    for (const [key, info] of Object.entries(infoButtons)) info.setAttribute('aria-label', text[key] + ' · ' + text.info);
    for (const entry of helpEntries.values()) { entry.title.textContent = text[entry.key];entry.close.setAttribute('aria-label', text.closeHelp); }
    localizeDescriptions();
    for (const [key, label] of Object.entries(fieldLabels)) {
      label.textContent = text[key];
      fields[key].setAttribute('aria-label', text[key]);
    }
    setStatus(statusKey);
  }
  function setOpen(value, returnFocus = false) {
    const nextOpen = Boolean(value && launcher.isConnected && !launcher.hidden && !document.fullscreenElement);
    const nativeGear = player?.querySelector('.ytp-settings-button');
    const nativeMenu = player?.querySelector('.ytp-settings-menu');
    if (nextOpen && (nativeGear?.getAttribute('aria-expanded') === 'true' ||
        nativeMenu && getComputedStyle(nativeMenu).display !== 'none')) nativeGear?.click();
    open = nextOpen;
    panel.hidden = !open;
    if (open) showPage();
    else resetHelp();
    localize();
    button.setAttribute('aria-expanded', String(open));
    positionPanel();
    if (open) {
      fields.enabled.focus({ preventScroll: true });
    } else if (returnFocus && button.isConnected) button.focus();
  }
  listen(button, 'click', event => {
    event.stopPropagation();
    if (globalThis.LiquidUI?.togglePanel) { setOpen(false);LiquidUI.togglePanel(button); }
    else setOpen(!open);
  });
  listen(launcher, 'click', event => event.stopPropagation());
  listen(launcher, 'dblclick', event => { event.preventDefault();event.stopPropagation(); });
  listen(launcher, 'keydown', event => {
    event.stopPropagation();
  });
  listen(launcher, 'keyup', event => event.stopPropagation());
  listen(close, 'click', () => setOpen(false, true));
  listen(back, 'click', () => { const previous = currentPage;showPage();menuButtons[previous]?.focus({ preventScroll: true }); });
  listen(panel, 'click', event => {
    const entry = helpEntries.get(helpRow), path = event.composedPath?.() || [event.target];
    if (entry && !path.includes(entry.popover) && !path.includes(entry.trigger)) hideHelp();
    event.stopPropagation();
  });
  listen(panel, 'dblclick', event => { event.preventDefault(); event.stopPropagation(); });
  listen(panel, 'keydown', event => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      // Dismiss help before navigating or closing settings; restore its opener.
      if (helpRow) hideHelp(true);
      else if (currentPage) { const previous = currentPage;showPage();menuButtons[previous]?.focus({ preventScroll: true }); }
      else setOpen(false, true);
    }
  });
  listen(panel, 'keyup', event => event.stopPropagation());
  listen(document, 'click', event => {
    if (open && !panel.contains(event.target) && !launcher.contains(event.target)) {
      const path = event.composedPath?.() || [event.target];
      const navigating = path.some(node => node?.nodeType === 1 && node.localName === 'a' && node.getAttribute('href'));
      if (helpRow) hideHelp();
      else if (!navigating) setOpen(false);
    }
  });
  let videoListeners = [], gearListener = null, gearElement = null;
  const warningHost = document.createElement('div');
  warningHost.id = 'yac-flash-warning';
  const warningRoot = warningHost.attachShadow({ mode: 'open' });
  const warningStyle = document.createElement('style');
  warningStyle.textContent = [
    ':host{all:initial}*{box-sizing:border-box}dialog{position:fixed;inset:0;margin:auto;width:480px;max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);overflow:auto;padding:24px;background:#1c1c1c;color:#f1f1f1;border:1px solid #ffffff24;border-radius:16px;box-shadow:0 12px 48px #0008;font:14px/1.6 "YouTube Noto",Roboto,Arial,Helvetica,sans-serif;color-scheme:dark}',
    'dialog::backdrop{background:rgba(0,0,0,.96)}h2{margin:0 0 12px;font-size:18px;line-height:1.5;font-weight:500}p{margin:0 0 12px}.note{font-size:12px;color:#bdbdbd}',
    'label{display:flex;align-items:center;gap:10px;padding:16px 0;border-top:1px solid #ffffff1a;cursor:pointer}input{margin:0;width:18px;height:18px;accent-color:white;flex-shrink:0}.actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}',
    'button{min-height:40px;padding:8px 16px;border:1px solid #ffffff24;border-radius:8px;background:#ffffff0f;color:#eee;font:inherit;cursor:pointer}button:hover{background:#ffffff24}.primary{background:#f1f1f1;color:#0f0f0f;border-color:transparent}.primary:hover{background:white}:focus-visible{outline:2px solid white;outline-offset:3px}',
    '.save-error{margin:0 0 16px;padding:12px;border:1px solid #ffffff38;border-radius:8px;font-size:12px}.save-error[hidden]{display:none}.save-error button{display:block;margin-top:8px}button[aria-disabled=true],button[aria-busy=true]{opacity:.6;cursor:wait}'
  ].join('\n');
  const warningDialog = document.createElement('dialog');
  warningDialog.setAttribute('role', 'alertdialog');
  warningDialog.setAttribute('aria-labelledby', 'yac-flash-title');
  warningDialog.setAttribute('aria-describedby', 'yac-flash-body yac-flash-note');
  const warningTitle = document.createElement('h2');warningTitle.id = 'yac-flash-title';
  const warningBody = document.createElement('p');warningBody.id = 'yac-flash-body';
  const warningNote = document.createElement('p');warningNote.id = 'yac-flash-note';warningNote.className = 'note';
  const neverLabel = document.createElement('label');
  const neverCheckbox = document.createElement('input');neverCheckbox.type = 'checkbox';
  const neverText = document.createTextNode('');neverLabel.append(neverCheckbox, neverText);
  const warningActions = document.createElement('div');warningActions.className = 'actions';
  const warningClose = document.createElement('button');warningClose.type = 'button';
  const warningReduce = document.createElement('button');warningReduce.type = 'button';warningReduce.className = 'primary';warningReduce.autofocus = true;
  warningActions.append(warningClose, warningReduce);
  const warningSaveNotice = createSaveNotice();
  warningDialog.append(warningTitle, warningBody, warningNote, neverLabel, warningSaveNotice.container, warningActions);
  warningRoot.append(warningStyle, warningDialog);
  document.documentElement.append(warningHost);
  function renderSaveErrors() {
    const text = translations[settings.language];
    const message = reloadRequired ? text.saveDisconnected : saveError ? text.saveFailure.replace('{setting}', text[saveError.key] || text.title) : '';
    for (const notice of [panelSaveNotice, warningSaveNotice]) {
      const retryFocused = (notice === panelSaveNotice ? root : warningRoot).activeElement === notice.retry;
      if (saveError) notice.key = saveError.key;
      notice.container.hidden = !saveError && !reloadRequired;
      if (notice.message.textContent !== message) notice.message.textContent = message;
      notice.retry.textContent = reloadRequired ? text.saveReload : text.saveRetry;
      if (!saveError && !reloadRequired && retryFocused) {
        if (notice === warningSaveNotice && flashWarningOpen) warningClose.focus({ preventScroll: true });
        else if (notice === panelSaveNotice && open) {
          const target = fields[notice.key];
          target?.focus({ preventScroll: true });
          // The original setting can be hidden after changing categories.
          // Keep keyboard recovery inside the currently visible panel page.
          if (focusedElement() !== target) {
            const category = Object.keys(groups).find(key => groups[key].includes(notice.key));
            (currentPage ? back : menuButtons[category] || menuButtons.appearance).focus({ preventScroll: true });
          }
        }
      }
    }
  }
  function reportSaveError(error) {
    // An invalidated extension needs a page reload, not another API call or
    // repeated console warnings. Other persistence failures stay diagnostic.
    if (!YacSettingsStore.isContextInvalidated(error)) console.warn(error);
  }
  function localizeWarning() {
    const text = translations[settings.language];
    warningDialog.lang = settings.language;
    warningTitle.textContent = text.flashTitle;warningBody.textContent = text.flashBody;warningNote.textContent = text.flashNote;
    neverText.textContent = text.flashNever;warningClose.textContent = text.flashClose;warningReduce.textContent = text.flashReduce;
    neverCheckbox.checked = !settings.flashWarning;
    renderSaveErrors();
  }
  function focusedElement() {
    let element = document.activeElement;
    while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
    return element;
  }
  function closeFlashWarning(returnFocus = true) {
    if (!flashWarningOpen) return;
    flashWarningOpen = false;warningPresentation++;reductionPresentation = null;
    reducingWarning = retryingWarning = false;
    warningReduce.removeAttribute('aria-busy');warningSaveNotice.retry.removeAttribute('aria-disabled');
    warningDialog.close();flashMonitor.reset();
    if (returnFocus) {
      const target = warningFocus?.isConnected ? warningFocus : button;
      target.focus({ preventScroll: true });
      // A connected opener can have become hidden or disabled during the modal.
      // Verify the browser accepted focus instead of leaving it on the page body.
      if (focusedElement() !== target && button.isConnected) button.focus({ preventScroll: true });
    }
    warningFocus = null;
    if (warningHost.parentElement !== document.documentElement) document.documentElement.append(warningHost);
  }
  function positionWarning() {
    const container = document.fullscreenElement || document.documentElement;
    if (warningHost.parentElement === container) return;
    if (flashWarningOpen) warningDialog.close();
    container.append(warningHost);
    if (flashWarningOpen) warningDialog.showModal();
  }
  function showFlashWarning(key) {
    if (!settings.flashWarning || settings.strength <= 50 || flashWarningOpen || warnedVideoKey === key) return;
    warnedVideoKey = key;
    warningPresentation++;
    warningFocus = focusedElement();
    localizeWarning();positionWarning();warningDialog.showModal();flashWarningOpen = true;warningReduce.focus();
    // Notification only: do not pause video, disable ambient, or change strength.
  }
  listen(neverCheckbox, 'change', () => {
    saveWarningSetting('flashWarning', !neverCheckbox.checked).catch(reportSaveError);
  });
  function saveWarningSetting(key, value) {
    const task = settingsStore.set(key, value, true);
    warningSaves.add(task);
    task.then(() => warningSaves.delete(task), () => warningSaves.delete(task));
    return task;
  }
  async function finishWarningReduction(presentation) {
    // Never-show may still be saving. Keep its failure visible instead of
    // dismissing the dialog just because the strength write succeeded.
    while (warningSaves.size && presentation === warningPresentation) {
      await Promise.allSettled([...warningSaves]);
    }
    if (flashWarningOpen && presentation === warningPresentation && reductionPresentation === presentation && !saveError && !reloadRequired) {
      // A successful reduction starts fresh monitoring for this same video.
      if (warnedVideoKey === warningKey()) warnedVideoKey = '';
      closeFlashWarning();
    }
  }
  listen(warningReduce, 'click', async () => {
    if (reducingWarning) return;
    const presentation = warningPresentation;reductionPresentation = presentation;reducingWarning = true;
    warningReduce.setAttribute('aria-busy', 'true');
    try {
      await saveWarningSetting('strength', 15);
      await finishWarningReduction(presentation);
    } catch (error) { reportSaveError(error); }
    finally {
      if (presentation === warningPresentation) { reducingWarning = false;warningReduce.removeAttribute('aria-busy'); }
    }
  });
  listen(warningSaveNotice.retry, 'click', async () => {
    if (reloadRequired) { location.reload();return; }
    if (!saveError || retryingWarning) return;
    const key = saveError.key, presentation = warningPresentation;retryingWarning = true;
    warningSaveNotice.retry.setAttribute('aria-disabled', 'true');
    try {
      await saveWarningSetting(key, settings[key]);
      await finishWarningReduction(presentation);
    } catch (error) { reportSaveError(error); }
    finally {
      if (presentation === warningPresentation) { retryingWarning = false;warningSaveNotice.retry.removeAttribute('aria-disabled'); }
    }
  });
  listen(panelSaveNotice.retry, 'click', async () => {
    if (reloadRequired) { location.reload();return; }
    if (!saveError || retryingPanel) return;
    const key = saveError.key;retryingPanel = true;panelSaveNotice.retry.setAttribute('aria-disabled', 'true');
    try { await settingsStore.set(key, settings[key], true); }
    catch (error) { reportSaveError(error); }
    finally { retryingPanel = false;panelSaveNotice.retry.removeAttribute('aria-disabled'); }
  });
  listen(warningClose, 'click', () => closeFlashWarning());
  listen(warningDialog, 'cancel', event => { event.preventDefault();closeFlashWarning(); });
  listen(warningDialog, 'keydown', event => event.stopPropagation());
  listen(warningDialog, 'keyup', event => event.stopPropagation());
  listen(warningDialog, 'click', event => event.stopPropagation());
  listen(warningDialog, 'dblclick', event => { event.preventDefault();event.stopPropagation(); });
  function updateAppearance() {
    const attenuation = 1 - .55 * blend;
    const opacity = (settings.strength / 100 * attenuation).toFixed(4);
    if (canvas.style.opacity !== opacity) canvas.style.opacity = opacity;
    if (barCanvas.style.opacity !== opacity) barCanvas.style.opacity = opacity;
    if (startupBackground.style.opacity !== opacity) startupBackground.style.opacity = opacity;
    // Scrolled full-frame backgrounds retain finer shapes than edge projection.
    const fullFrameBlur = Math.max(25, settings.blur / 2);
    const blur = (settings.blur + (fullFrameBlur - settings.blur) * blend).toFixed(2);
    const filter = 'blur(' + blur + 'px) saturate(' + settings.saturation / 100 + ')';
    if (canvas.style.filter !== filter) canvas.style.filter = filter;
    if (barCanvas.style.filter !== filter) barCanvas.style.filter = filter;
    if (startupBackground.style.filter !== filter) startupBackground.style.filter = filter;
  }
  function syncStartupBackground() {
    const active = settingsLoaded && settings.enabled && location.pathname === '/watch' && !document.fullscreenElement && !!player;
    if (!active || backgroundVideoKey === warningKey()) {
      startupBackground.hidden = true;previewObserver.disconnect();previewPlayer = null;return;
    }
    if (document.hidden || navigationPending) return;
    if (previewPlayer !== player) {
      previewObserver.disconnect();previewPlayer = player;
      previewObserver.observe(player, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'src', 'poster', 'class'] });
    }
    const watchId = player.closest('ytd-watch-flexy')?.getAttribute('video-id'), key = warningKey();
    if (watchId && watchId !== key) return;
    const image = player.querySelector('.ytp-cued-thumbnail-overlay-image');
    const background = image?.style.getPropertyValue('background-image') || (image && getComputedStyle(image).backgroundImage);
    const match = background?.match(/^url\(["']?(.*?)["']?\)$/);
    const source = video?.getAttribute('poster') || match?.[1];
    let url;
    try {
      if (!source) return;url = new URL(source, location.href);
      if (!['https:', 'http:', 'blob:'].includes(url.protocol)) return;
      const imageId = /\/(?:vi|vi_webp)\/([^/]+)\//.exec(url.pathname)?.[1];
      if (imageId && imageId !== key) return;
    } catch { return; }
    // Reuse the player's existing thumbnail. CSS can display it without a
    // cross-origin pixel read, extra API request, video capture or playback.
    const value = 'url(' + JSON.stringify(url.href) + ')';
    if (startupBackground.style.getPropertyValue('background-image') !== value) startupBackground.style.setProperty('background-image', value);
    startupBackground.hidden = false;updateAppearance();
  }
  function apply(renderChanged = true) {
    localize();
    localizeWarning();
    // One saved preference derives the palette for every supported face. This
    // runs on settings changes only, never in the video/frame/message loop.
    const palette = YacSettingsStore.surfacePalette(settings);
    const declarations = Object.entries(palette).map(([key, value]) => key + ':' + value).join(';');
    const accentPalette = globalThis.LiquidSites?.accentPalette?.(settings);
    document.documentElement.classList.toggle('yac-custom-accent', settingsLoaded && settings.useCustomAccent && !!accentPalette);
    const accent = settings.useCustomAccent && accentPalette ? `:root.yac-custom-accent{${Object.entries(accentPalette).map(([key, value]) => key + ':' + value).join(';')}}` : '';
    const paletteText = accent + `html.yac-active{${declarations}}:root{--yac-settings-opacity:${palette['--yac-settings-opacity']};--yac-settings-level:${palette['--yac-navigation-level']};--yac-launcher-opacity:${palette['--yac-control-opacity']};--yac-launcher-level:${palette['--yac-control-feedback']}}`;
    if (paletteStyle.textContent !== paletteText) { paletteStyle.textContent = paletteText;syncChat(); }
    updateAppearance();
    button.classList.toggle('yac-enabled', settings.enabled);
    for (const key of booleanKeys) {
      fields[key].checked = settings[key];
      fields[key].setAttribute('aria-checked', String(settings[key]));
    }
    for (const key of ['strength', 'blur', 'saturation', 'inset', 'fps', 'surfaceMultiplier', 'controlDensity', 'readingDensity', 'navigationDensity']) {
      const fieldValue = Math.round(settings[key] * (key === 'surfaceMultiplier' ? 100 : 1));
      fields[key].value = fieldValue;
      fields[key].style.setProperty('--progress', (fieldValue - Number(fields[key].min)) / (Number(fields[key].max) - Number(fields[key].min)) * 100 + '%');
      const text = translations[settings.language];
      const valueText = fieldValue + (key === 'blur' ? ' px' : key === 'fps' ? ' FPS' : '%');
      outputs[key].textContent = valueText;
      let appliedText = '';
      if (key.endsWith('Density')) {
        appliedText = text.applied + ' ' + Math.round(settings[key] * settings.surfaceMultiplier) + '%';
        const applied = document.createElement('span');applied.className = 'applied';applied.textContent = appliedText;outputs[key].append(applied);
      }
      fields[key].setAttribute('aria-valuetext', valueText + (appliedText ? ' · ' + appliedText : ''));
    }
    if (renderChanged) {
      lastDrawFrame = 0;
      invalidateFrame(false);
    }
    if (!settings.fillBars || !settings.enabled) restoreBars();
  }
  for (const key of Object.keys(fields)) {
    listen(fields[key], 'input', () => {
      const value = key === 'language' ? fields[key].value :
        booleanKeys.includes(key) ? fields[key].checked : Number(fields[key].value) / (key === 'surfaceMultiplier' ? 100 : 1);
      settingsStore.set(key, value);
    });
    listen(fields[key], 'change', () => settingsStore.set(key, settings[key], true).catch(reportSaveError));
  }
  function positionPanel() {
    if (!open || document.hidden) return;
    if (document.fullscreenElement || !button.isConnected || launcher.hidden) { setOpen(false);return; }
    // Anchor to the header without moving the page or reading video geometry.
    const rectangle = button.getBoundingClientRect();
    const top = Math.min(Math.max(8, rectangle.bottom + 12), Math.max(8, innerHeight - 72));
    const width = Math.min(380, Math.max(1, innerWidth - 16));
    const right = Math.max(8, Math.min(innerWidth - rectangle.right, innerWidth - width - 8));
    panel.style.width = width + 'px';
    panel.style.top = top + 'px';
    panel.style.right = right + 'px';
    const availableHeight = Math.max(1, innerHeight - top - 8);
    panel.style.maxHeight = availableHeight + 'px';
    // Grow with the content and scroll only when it exceeds the viewport.
    panel.style.height = 'auto';
    positionHelp();
  }
  function resizeLayout(rectangle) {
    return { player, video, rectangle, width: innerWidth, height: innerHeight,
      playerWidth: player?.clientWidth || 0, playerHeight: player?.clientHeight || 0 };
  }
  function sameRectangle(a, b) {
    return a === b || !!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
  }
  function sameVideoLayout(layout, rectangle) {
    return layout && layout.player === player && layout.video === video && layout.width === innerWidth &&
      layout.height === innerHeight && sameRectangle(layout.rectangle, rectangle);
  }
  function resizeAmbient(refreshSurfaces = false) {
    if (disposed) return;
    // Controls can move inside the same player box. Keep panel placement live
    // even when the corresponding video capture is already current or pending.
    positionPanel();
    if (refreshSurfaces) markSurfacesDirty();
    if (document.hidden) return;
    const layout = resizeLayout(video ? getRectangle() : null);
    if (sameVideoLayout(lastResizeLayout, layout.rectangle) &&
        lastResizeLayout.playerWidth === layout.playerWidth && lastResizeLayout.playerHeight === layout.playerHeight) return;
    lastResizeLayout = layout;
    restoreBars();invalidateFrame(false);draw();
  }
  const panelResizeObserver = new ResizeObserver(() => resizeAmbient(true));
  function clearChat() {
    chatDocument?.documentElement?.classList.remove('yac-chat-active');
    chatDocument?.getElementById(chatStyleId)?.remove();
    chatDocument = null;
  }
  function syncChat() {
    const frame = document.querySelector('ytd-live-chat-frame #chatframe');
    if (chatFrame !== frame) {
      chatFrame?.removeEventListener('load', syncChat);
      chatFrame = frame;
      chatFrame?.addEventListener('load', syncChat);
    }
    // YouTube's embedded chat is same-origin. Leave unrelated frames untouched.
    let nextDocument = null;
    try {
      const candidate = frame?.contentDocument;
      if (candidate && /^\/live_chat(?:_replay)?$/.test(candidate.location.pathname)) nextDocument = candidate;
    } catch { /* A cross-origin frame cannot be styled by this content script. */ }
    if (chatDocument !== nextDocument) { clearChat(); chatDocument = nextDocument; }
    if (!chatDocument?.head) return;
    let chatStyle = chatDocument.getElementById(chatStyleId);
    if (!chatStyle) {
      chatStyle = chatDocument.createElement('style');
      chatStyle.id = chatStyleId;
      chatDocument.head.append(chatStyle);
    }
    const active = document.documentElement.classList.contains('yac-active');
    chatDocument.documentElement.classList.toggle('yac-chat-active', active);
    if (!active) return;
    // CSS variables do not cross iframe documents. Copy this palette only at
    // discovery/load/activation, never per rendered frame or per chat message.
    const palette = getComputedStyle(document.documentElement);
    const rgb = palette.getPropertyValue('--yac-control-rgb').trim();
    const channels = rgb.split(',').map(Number);
    const safeRgb = channels.length === 3 && channels.every(v => Number.isFinite(v) && v >= 0 && v <= 255) ? channels.join(',') : '18,20,25';
    const scalar = (property, fallback, maximum = 1) => {
      const value = palette.getPropertyValue(property).trim(), number = Number(value);
      return value && Number.isFinite(number) && number >= 0 && number <= maximum ? number : fallback;
    };
    const safeBlur = (property, fallback) => {
      const value = palette.getPropertyValue(property).trim();
      return /^\d+(?:\.\d+)?px$/.test(value) && parseFloat(value) <= 64 ? value : fallback;
    };
    const text = `html.yac-chat-active{--yac-control-rgb:${safeRgb};
      --yac-control-opacity:${scalar('--yac-control-opacity', .22)};
      --yac-control-hover-opacity:${scalar('--yac-control-hover-opacity', .34)};
      --yac-control-selected-opacity:${scalar('--yac-control-selected-opacity', .44)};
      --yac-reading-opacity:${scalar('--yac-reading-opacity', .64)};
      --yac-chat-header-opacity:${scalar('--yac-chat-header-opacity', .12)};
      --yac-chat-overlay-opacity:${scalar('--yac-chat-overlay-opacity', .13)};
      --yac-control-blur:${safeBlur('--yac-control-blur', '12px')};
      --yac-reading-blur:${safeBlur('--yac-reading-blur', '12px')};
      --yac-control-feedback:${scalar('--yac-control-feedback', 1)};
      --yac-control-dark-brightness:${scalar('--yac-control-dark-brightness', .50)};
      --yac-control-dark-hover-brightness:${scalar('--yac-control-dark-hover-brightness', .40)};
      --yac-control-light-contrast:${scalar('--yac-control-light-contrast', .10)};
      --yac-control-light-brightness:${scalar('--yac-control-light-brightness', 1.8, 2)};
      --yac-navigation-level:${scalar('--yac-navigation-level', 1)};
      --yac-navigation-blur:${safeBlur('--yac-navigation-blur', '16px')};
      --yac-control-surface:rgba(var(--yac-control-rgb),var(--yac-control-opacity));
      --yac-control-hover-surface:rgba(var(--yac-control-rgb),var(--yac-control-hover-opacity));
      --yac-control-selected-surface:rgba(var(--yac-control-rgb),var(--yac-control-selected-opacity))}
      ${chatCss}`;
    if (chatStyle.textContent !== text) chatStyle.textContent = text;
  }
  function setAmbientActive(active) {
    const changed = document.documentElement.classList.contains('yac-active') !== active;
    if (changed) document.documentElement.classList.toggle('yac-active', active);
    if (chatDocument?.documentElement?.classList.contains('yac-chat-active') !== active) {
      chatDocument?.documentElement?.classList.toggle('yac-chat-active', active);
    }
    if (changed) {
      cancelSurfaceRefresh();
      surfacesDirty = true;
      if (active) refreshPageSurfaces(true);
      else syncPageSurfaces(false);
      if (active) syncChat();
    }
  }
  function discover() {
    if (disposed || document.hidden) return;
    const app = document.querySelector('ytd-app');
    if (app && canvas.parentElement !== app) app.prepend(canvas);
    if (app && startupBackground.parentElement !== app) canvas.after(startupBackground);
    const next = document.querySelector('#movie_player');
    if (player !== next) {
      lastResizeLayout = null;
      panelResizeObserver.disconnect();
      restoreBars();
      player = next;
      if (player) panelResizeObserver.observe(player);
    }
    const nextVideo = player?.querySelector('video.html5-main-video') || null;
    const videoChanged = video !== nextVideo;
    if (videoChanged) {
      lastResizeLayout = null;
      playbackWaiting = false;renderer?.setSuspended?.(document.hidden || navigationPending);
      stopVideoFrames();
      for (const remove of videoListeners) remove();
      videoListeners = [];
      restoreBars();
      invalidateFrame();
      if (nextVideo) {
        videoListeners.push(listen(nextVideo, 'seeking', () => { stopVideoFrames();invalidateFrame();restoreBars();flashMonitor.reset(); }));
        videoListeners.push(listen(nextVideo, 'seeked', () => { startVideoFrames();invalidateFrame();draw(); }));
        videoListeners.push(listen(nextVideo, 'emptied', () => { stopVideoFrames();invalidateFrame();restoreBars();flashMonitor.reset(); }));
        videoListeners.push(listen(nextVideo, 'loadeddata', () => { startVideoFrames();invalidateFrame();draw(); }));
        videoListeners.push(listen(nextVideo, 'waiting', () => {
          if (nextVideo.paused) return;
          playbackWaiting = true;stopVideoFrames();invalidateFrame(false);restoreBars();renderer?.setSuspended?.(true);
        }));
        const resumePlayback = () => {
          playbackWaiting = false;awaitingPlaybackFrame = !nextVideo.paused;
          renderer?.setSuspended?.(document.hidden || navigationPending);startVideoFrames();invalidateFrame(false);draw();
        };
        videoListeners.push(listen(nextVideo, 'playing', resumePlayback));
        videoListeners.push(listen(nextVideo, 'canplay', () => { if (playbackWaiting) resumePlayback(); }));
        videoListeners.push(listen(nextVideo, 'pause', () => { if (playbackWaiting) resumePlayback(); }));
      }
    }
    video = nextVideo;
    syncStartupBackground();
    syncVideoFrames();
    const gear = player?.querySelector('.ytp-right-controls .ytp-settings-button');
    if (gear !== gearElement) {
      gearListener?.(); gearElement = gear;
      gearListener = gear ? listen(gear, 'click', () => { if (open) setOpen(false); }, true) : null;
    }
    syncHeaderLauncher();syncPlaybackLauncher();
    if (panel.parentElement !== document.documentElement) document.documentElement.append(panel);
    if (player && barLayer.parentElement !== player) player.prepend(barLayer);
    positionPanel();
    syncChat();
    refreshPageSurfaces();
    // Discovery can remove a video while playback is already unavailable.
    // Apply that transition once even when the animation loop is waiting.
    if (videoChanged) draw();
  }
  function restoreBars() {
    if (originalClip) {
      const { element, value, priority, applied } = originalClip;
      if (element.style.getPropertyValue('clip-path') === applied && element.style.getPropertyPriority('clip-path') === 'important') {
        if (value) element.style.setProperty('clip-path', value, priority);
        else element.style.removeProperty('clip-path');
      }
      originalClip = null;
    }
    if (player?.classList.contains('yac-fill-bars')) player.classList.remove('yac-fill-bars');
  }
  function replaceBars(result, rectangle) {
    if (!settings.fillBars) { restoreBars(); return; }
    const bounds = video.getBoundingClientRect();
    const crop = result.videoCrop;
    // A transient layout or invalid renderer response must never cut out the
    // entire video. Keep the native frame until a usable crop is available.
    if (!crop || ![crop.x, crop.y, crop.width, crop.height, bounds.width, bounds.height].every(Number.isFinite) ||
        crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 ||
        crop.x + crop.width > 160 || crop.y + crop.height > 90 || bounds.width <= 0 || bounds.height <= 0) {
      restoreBars();return;
    }
    const left = Math.max(0, rectangle.left - bounds.left + rectangle.width * crop.x / 160);
    const top = Math.max(0, rectangle.top - bounds.top + rectangle.height * crop.y / 90);
    const right = Math.max(0, bounds.right - rectangle.left - rectangle.width * (crop.x + crop.width) / 160);
    const bottom = Math.max(0, bounds.bottom - rectangle.top - rectangle.height * (crop.y + crop.height) / 90);
    if (bounds.width - left - right < 1 || bounds.height - top - bottom < 1) { restoreBars();return; }
    if (Math.max(left, top, right, bottom) < 1) { restoreBars(); return; }
    const current = video.style.getPropertyValue('clip-path'), priority = video.style.getPropertyPriority('clip-path');
    if (!originalClip || current !== originalClip.applied || priority !== 'important') {
      originalClip = { element: video, value: current, priority };
    }
    const clip = 'inset(' + [top, right, bottom, left].map(v => v.toFixed(2) + 'px').join(' ') + ')';
    if (current !== clip || priority !== 'important') video.style.setProperty('clip-path', clip, 'important');
    originalClip.applied = video.style.getPropertyValue('clip-path');
    if (!player.classList.contains('yac-fill-bars')) player.classList.add('yac-fill-bars');
    const p = player.getBoundingClientRect(), pad = renderer.padding;
    const width = 400, height = Math.min(2048, Math.max(80, Math.round(width * (p.height + pad * 2) / (p.width + pad * 2))));
    if (barCanvas.width !== width || barCanvas.height !== height) { barCanvas.width = width; barCanvas.height = height; }
    const sx = canvas.width / (innerWidth + pad * 2), sy = canvas.height / (innerHeight + pad * 2);
    barContext.drawImage(canvas, p.left * sx, p.top * sy, (p.width + pad * 2) * sx, (p.height + pad * 2) * sy, 0, 0, width, height);
  }
  function getRectangle() {
    const bounds = video.getBoundingClientRect();
    const rect = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
    const fit = getComputedStyle(video).objectFit;
    if (fit === 'contain' && video.videoWidth && video.videoHeight) {
      const factor = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
      const width = video.videoWidth * factor, height = video.videoHeight * factor;
      rect.left += (rect.width - width) / 2; rect.top += (rect.height - height) / 2;
      rect.width = width; rect.height = height;
    }
    return rect;
  }
  function invalidateFrame(resetBars = true) {
    inputRevision++;
    if (resetBars) renderer?.reset?.();
    else renderer?.invalidate?.();
    lastTime = -1;
    paintDue = true; forcePaint = true; geometryCheckDue = true;
    if (resetBars) { lastSampleVideo = null; lastSampleTime = -1; submittedSerial = -1; }
  }
  function stopVideoFrames() {
    frameEpoch++;
    if (frameVideo && videoFrameRequest !== null) frameVideo.cancelVideoFrameCallback?.(videoFrameRequest);
    videoFrameRequest = null; frameVideo = null;
  }
  function canTrackVideoFrames(consumers = settings.enabled && !document.fullscreenElement || wantsMonitoring()) {
    return !disposed && settingsLoaded && location.pathname === '/watch' && !document.hidden &&
      !navigationPending && (!playbackWaiting || video?.paused) && !!video && !video.seeking && video.readyState >= 2 && consumers;
  }
  function syncVideoFrames(consumers) {
    if (!canTrackVideoFrames(consumers)) {
      if (frameVideo) stopVideoFrames();
      return;
    }
    if (frameVideo !== video) startVideoFrames();
  }
  function startVideoFrames() {
    stopVideoFrames();
    if (!canTrackVideoFrames() || typeof video.requestVideoFrameCallback !== 'function' ||
        typeof video.cancelVideoFrameCallback !== 'function') return;
    const source = video, epoch = frameEpoch;
    frameVideo = source; frameSerial = 0; submittedSerial = -1;
    const next = () => {
      try { videoFrameRequest = source.requestVideoFrameCallback(() => {
        if (disposed || document.hidden || epoch !== frameEpoch || source !== video) return;
        videoFrameRequest = null; frameSerial++;
        const resuming = awaitingPlaybackFrame;awaitingPlaybackFrame = false;next();
        // Resume on the first presented native frame, without a fixed delay or
        // another display tick. Ordinary frames still use the configured FPS.
        if (resuming) draw(false);
      }); } catch { awaitingPlaybackFrame = false;stopVideoFrames(); }
    };
    next();
  }
  function sourceKey() {
    return (new URLSearchParams(location.search).get('v') || '') + '|' + (video?.currentSrc || '');
  }
  function warningKey() { return new URLSearchParams(location.search).get('v') || video?.currentSrc || 'current-video'; }
  function wantsMonitoring() {
    return settingsLoaded && settings.flashWarning && settings.strength > 50 && !flashWarningOpen && !!video && !video.paused && warnedVideoKey !== warningKey();
  }
  function validGeometry(rect) {
    return [rect.left, rect.top, rect.width, rect.height, innerWidth, innerHeight].every(Number.isFinite) &&
      rect.width > 0 && rect.height > 0 && innerWidth > 0 && innerHeight > 0;
  }
  function acceptFrame(meta) {
    if (disposed || !settingsLoaded || location.pathname !== '/watch' || document.hidden ||
        captureDeferred() ||
        video !== meta.source || video.seeking || sourceKey() !== meta.sourceKey || inputRevision !== meta.options.revision ||
        !validGeometry(getRectangle())) return false;
    return meta.options.sampleOnly ? wantsMonitoring() : settings.enabled && !document.fullscreenElement && !player?.classList.contains('unstarted-mode');
  }
  function presentFrame(result, meta) {
    lastSampleVideo = meta.source; lastSampleTime = meta.mediaTime;
    if (wantsMonitoring()) {
      if (flashMonitor.sample(renderer.readPixels(), meta.options.sampleTime, meta.mediaTime, meta.sourceKey, result.samplingCrop, video.playbackRate)) showFlashWarning(warningKey());
    } else flashMonitor.reset();
    // Monitoring remains available with ambient OFF and in fullscreen. These
    // jobs only inspect pixels and must never present a background or clip video.
    if (result.sampleOnly || meta.options.sampleOnly) return;
    backgroundVideoKey = warningKey();startupBackground.hidden = true;previewObserver.disconnect();previewPlayer = null;
    canvas.dataset.blend = meta.options.blend.toFixed(3);
    // The Worker captured this frame before scrolling or a layout change.
    // Clip the current video box, never combine an old rectangle with new bounds.
    replaceBars(result, getRectangle());
    lastVideo = meta.source; lastTime = meta.mediaTime; lastGeometry = meta.options.geometry;
    setStatus(settings.avoidBars && !result.readable ? 'noBars' :
      result.cropped ? 'cropped' : settings.radial ? 'radialHint' : 'fullFrameHint');
    if (canvas.dataset.renderMode === 'main' && canvas.dataset.workerFallbackReason && canvas.dataset.workerFallbackState !== 'active') {
      canvas.dataset.workerFallbackState = 'active';
      localizeDescriptions();
    }
  }
  function useMainRenderer(reason) {
    renderer?.dispose?.();
    if (disposed) return;
    renderer = new YacRenderer(canvas);
    canvas.dataset.renderMode = 'main';
    // Fallback is an expected recovery path. Keep its diagnostic without adding
    // a warning to the browser's extension error list on every page load.
    if (reason) {
      canvas.dataset.workerFallbackReason = String(reason).slice(0, 240);
      canvas.dataset.workerFallbackState = 'pending';
    }
    invalidateFrame();
  }
  let hostUrl;
  try { if (!startupContextError) hostUrl = extensionRuntime?.getURL?.('worker-host.html'); }
  catch (error) {
    if (YacSettingsStore.isContextInvalidated(error)) startupContextError = error;
    else reportSaveError(error);
  }
  if (hostUrl && typeof YacWorkerRenderer === 'function') {
    renderer = new YacWorkerRenderer(canvas, { hostUrl, acceptFrame, onFrame: presentFrame, onFailure: useMainRenderer });
    renderer.setSuspended?.(document.hidden);
    canvas.dataset.renderMode = 'worker';
  } else useMainRenderer();
  function draw(requestPaint = true) {
    if (requestPaint) { paintDue = true; forcePaint = true; }
    const active = settingsLoaded && settings.enabled && location.pathname === '/watch' && !document.fullscreenElement && !!video;
    // Native UI styling stays independent of Worker startup, busy jobs and fallback.
    setAmbientActive(active);
    syncStartupBackground();
    if (!active) {
      restoreBars();
      setStatus(!settings.enabled ? 'off' : document.fullscreenElement ? 'fullscreen' : 'waiting');
    }
    const monitoring = wantsMonitoring();
    // No consumer needs decoded-frame notifications while both features are
    // inactive. Existing state transitions prime capture when work resumes.
    syncVideoFrames(active || monitoring);
    // Keep the last ambient image while the native player switches/buffers.
    // Do not copy video pixels, force layout, or fight its first decoded frame.
    if (captureDeferred() || player?.classList.contains('unstarted-mode')) return;
    const ready = settingsLoaded && location.pathname === '/watch' && !document.hidden &&
      (active || monitoring) && canvas.isConnected && video && !video.seeking && video.readyState >= 2;
    if (!ready) {
      flashMonitor.reset();
      restoreBars();
      setStatus(!settings.enabled ? 'off' : document.fullscreenElement ? 'fullscreen' : 'waiting');
      return;
    }
    // Do not force layout or update styles for frames the Worker cannot accept.
    if (renderer.canAcceptFrame && !renderer.canAcceptFrame()) return;
    const paced = frameVideo === video;
    const fresh = paced ? frameSerial !== submittedSerial : video !== lastSampleVideo || video.currentTime !== lastSampleTime;
    // Keep layout/scroll tracking at background FPS without measuring the same
    // paused/decoded frame at every display tick. paintDue may stay latched while
    // waiting for a fresh frame, so it cannot also be the geometry deadline.
    if (paced && !fresh && !(active && (forcePaint || geometryCheckDue))) return;
    geometryCheckDue = false;
    const rect = getRectangle();
    if (!validGeometry(rect)) { flashMonitor.reset();restoreBars();setStatus('waiting');return; }
    // A scroll or another layout change may move away from an earlier resize.
    // Compare our existing measurement without adding recurring DOM probes.
    if (lastResizeLayout && !sameVideoLayout(lastResizeLayout, rect)) lastResizeLayout = null;
    if (forcePaint) lastResizeLayout = resizeLayout(rect);
    const headerBottom = Math.max(0, document.querySelector('ytd-masthead')?.getBoundingClientRect().bottom || 0);
    const targetBlend = YacRenderer.scrollBlend(rect, { top: headerBottom, height: innerHeight });
    const now = performance.now();
    blend += (targetBlend - blend) * (1 - Math.exp(-(now - lastBlendTime) / 140));
    if (Math.abs(targetBlend - blend) < .005) blend = targetBlend;
    lastBlendTime = now;
    updateAppearance();
    const geometry = [rect.left, rect.top, rect.width, rect.height, innerWidth, innerHeight, blend.toFixed(3)].join(',');
    const unchanged = video === lastVideo && video.currentTime === lastTime && geometry === lastGeometry &&
      (!(settings.avoidBars || settings.fillBars) || !renderer.readable || renderer.stableFrames >= 4);
    const settling = video.paused && (settings.avoidBars || settings.fillBars) && renderer.readable && renderer.stableFrames < 4;
    const paint = active && (forcePaint || paintDue && (fresh || geometry !== lastGeometry || settling)) && (!unchanged || forcePaint);
    const sample = monitoring && fresh;
    if (!paint && !sample) return;
    try {
      const options = { ...settings, fillBars: active && settings.fillBars, blend, sourceKey: sourceKey(), sampleTime: now, mediaTime: video.currentTime, geometry, revision: inputRevision,
        sampleOnly: !paint, readPixels: monitoring };
      const mediaTime = video.currentTime;
      const serial = frameSerial;
      const result = !paint && canvas.dataset.renderMode === 'main' ?
        renderer.inspect(video, rect, { width: innerWidth, height: innerHeight }, options) :
        renderer.draw(video, rect, { width: innerWidth, height: innerHeight }, settings.radial, options);
      const accepted = () => { if (paced) submittedSerial = serial;if (paint) { paintDue = false;forcePaint = false; } };
      if (typeof result === 'boolean') { if (result) accepted();return; }
      const meta = { source: video, rectangle: rect, options, sourceKey: options.sourceKey, mediaTime };
      if (acceptFrame(meta)) { accepted();presentFrame(result, meta); }
    } catch (error) {
      restoreBars();
      setStatus('failed');
      if (canvas.dataset.renderMode === 'main' && canvas.dataset.workerFallbackReason && canvas.dataset.workerFallbackState !== 'failed') {
        canvas.dataset.workerFallbackState = 'failed';
        localizeDescriptions();
      }
    }
  }
  let navigationPending = false, playbackWaiting = false, awaitingPlaybackFrame = false;
  function captureDeferred() {
    const framePending = awaitingPlaybackFrame && typeof video?.requestVideoFrameCallback === 'function' &&
      typeof video?.cancelVideoFrameCallback === 'function';
    return navigationPending || !!video && !video.paused && (playbackWaiting || framePending);
  }
  listen(document, 'yt-navigate-start', () => {
    navigationPending = true;stopVideoFrames();renderer?.setSuspended?.(true);invalidateFrame(false);restoreBars();
  });
  listen(document, 'yt-navigate-finish', () => {
    if (navigationPending) awaitingPlaybackFrame = true;
    navigationPending = false;
    renderer?.setSuspended?.(document.hidden || playbackWaiting);
    closeFlashWarning(false);flashMonitor.reset();invalidateFrame();discover();draw();
  });
  listen(document, 'visibilitychange', () => {
    // Buffering/navigation may defer draw(). Release our clip before that
    // early return and let the resumed frame establish it again.
    restoreBars();
    if (document.hidden) stopVideoFrames(); else startVideoFrames();
    renderer?.setSuspended?.(document.hidden || navigationPending || playbackWaiting);invalidateFrame();
    cancelSurfaceRefresh();surfacesDirty = true;
    if (!document.hidden) discover();
    draw();refreshPageSurfaces(true);
  });
  listen(document, 'fullscreenchange', () => { invalidateFrame();positionWarning();discover(); draw(); });
  listen(window, 'resize', () => resizeAmbient());
  listen(window, 'scroll', () => positionPanel(), { passive: true });
  const discoverTimer = setInterval(discover, 1000);
  let frameRunnable = false;
  function animate(now) {
    if (disposed) return;
    frameRequest = requestAnimationFrame(animate);
    if (captureDeferred()) return;
    const interval = 1000 / settings.fps;
    const elapsed = now - lastDrawFrame;
    // Keep fractional frame intervals without drifting at rates such as 24 FPS.
    if (elapsed + .5 >= interval) {
      const steps = Math.max(1, Math.floor((elapsed + .5) / interval));
      lastDrawFrame = now - Math.max(0, elapsed - steps * interval);
      paintDue = true; geometryCheckDue = true;
    }
    const active = settings.enabled && !document.fullscreenElement;
    const monitoring = wantsMonitoring();
    const runnable = settingsLoaded && location.pathname === '/watch' && !document.hidden &&
      (active || monitoring) && canvas.isConnected && video && !video.seeking && video.readyState >= 2;
    if (!runnable) {
      // Preserve the existing cleanup when playback becomes unavailable, then
      // leave DOM styling and warning history alone while it stays unavailable.
      if (frameRunnable) draw(false);
      frameRunnable = false;
      return;
    }
    frameRunnable = true;
    const fresh = frameVideo === video ? frameSerial !== submittedSerial :
      video !== lastSampleVideo || video.currentTime !== lastSampleTime;
    // A paint deadline stays latched for the next decoded frame. It should not
    // repeatedly enter DOM work between frames or while waiting for playback.
    if (!fresh && !(active && (forcePaint || geometryCheckDue))) return;
    // Warning sampling follows the display tick, independently of the chosen
    // background FPS. One Worker job at a time still provides backpressure.
    if (paintDue || monitoring) draw(false);
  }
  listen(document, 'yac-dispose', () => {
    disposed = true;
    globalThis.LiquidUI?.closePanel?.();
    lastResizeLayout = null;
    stopVideoFrames();
    unsubscribeSettings();
    if (ownsSettingsStore) settingsStore.dispose();
    renderer?.dispose?.();
    previewObserver.disconnect();
    closeFlashWarning(false);warningHost.remove();
    clearInterval(discoverTimer); cancelAnimationFrame(frameRequest);
    surfaceObserver.disconnect();cancelSurfaceRefresh();
    panelResizeObserver.disconnect();
    headerObserver.disconnect();headerResizeObserver.disconnect();playbackControlsObserver.disconnect();playbackControls = null;
    document.documentElement.classList.remove('yac-header-controls');
    document.documentElement.style.removeProperty('--yac-header-native-gap');
    document.documentElement.style.removeProperty('--yac-header-native-padding');
    chatFrame?.removeEventListener('load', syncChat);
    clearChat();
    for (const remove of removers) remove();
    restoreBars();
    document.documentElement.classList.remove('yac-active');document.documentElement.classList.remove('yac-custom-accent');
    syncPageSurfaces(false);
    launcher.remove();playbackButton.remove(); panel.remove(); canvas.remove();startupBackground.remove();barLayer.remove();paletteStyle.remove();
  }, { once: true });
  apply(); discover(); draw();
  frameRequest = requestAnimationFrame(animate);
  function onSettingsChange(snapshot, { loaded, error, saveError: nextSaveError, saveErrors: allSaveErrors, reloadRequired: nextReloadRequired }) {
      if (disposed) return;
      const changedKeys = Object.keys(settings).filter(key => Object.hasOwn(snapshot, key) && snapshot[key] !== settings[key]);
      const loadChanged = loaded !== settingsLoaded;
      const changed = loadChanged || changedKeys.length > 0;
      // Palette/language edits do not invalidate an in-flight Worker frame or
      // force a video capture. Ambient and warning preferences keep that path.
      const renderChanged = loadChanged || changedKeys.some(key => !uiOnlySettings.has(key));
      if (snapshot.flashWarning !== settings.flashWarning) { flashMonitor.reset();warnedVideoKey = ''; }
      else if ((snapshot.strength > 50) !== (settings.strength > 50)) flashMonitor.reset();
      settingsLoaded = loaded;
      for (const key of Object.keys(settings)) if (Object.hasOwn(snapshot, key)) settings[key] = snapshot[key];
      saveError = (allSaveErrors || [nextSaveError]).find(failure => failure && Object.hasOwn(settings, failure.key)) || null;
      reloadRequired = nextReloadRequired;
      if (error && !nextSaveError) reportSaveError(error);
      if (changed) { apply(renderChanged);if (renderChanged) draw(); }
      else renderSaveErrors();
  }
  const ownsSettingsStore = !globalThis.LiquidUI;
  const settingsStore = ownsSettingsStore ? new YacSettingsStore(extension.storage, settings, {
    scope: 'youtube', inheritLegacy: true, globalKeys: ['language'], rules: { accentColor: { type: 'color' } }, contextError: startupContextError,
    onChange: onSettingsChange
  }) : LiquidUI.getStore('youtube');
  const unsubscribeSettings = ownsSettingsStore ? () => {} : settingsStore.subscribe(onSettingsChange);
})();
