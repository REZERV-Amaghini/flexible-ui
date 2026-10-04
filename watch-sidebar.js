/* Native YouTube sidebar adapter. Keep the managed list nodes and their
 * handlers in place; tabs only select their visibility and the native filter. */
(() => {
  'use strict';
  const VIEW = 'data-liquid-sidebar', STATE = 'data-liquid-related';
  const LABELS = new Set(['関連動画', 'Related', 'Related videos']);
  const ALL_LABELS = new Set(['すべて', 'All']);
  const FILTER_NAMES = { related: '関連動画', all: 'すべて', channel: '提供' };
  const CHIP_SELECTOR = 'yt-related-chip-cloud-renderer [role="tab"], yt-chip-cloud-renderer [role="tab"]';
  const selected = button => button?.getAttribute('aria-selected') === 'true' ||
    button?.closest('yt-chip-cloud-chip-renderer')?.hasAttribute('selected');
  function createHeaderFade({ document: doc = document, window: win = window } = {}) {
    const root = doc.documentElement;
    const previous = new Map(['data-liquid-header', 'data-liquid-header-scrolled'].map(key => [key, root.getAttribute(key)]));
    let disposed = false;
    root.setAttribute('data-liquid-header', '');
    function refresh() {
      if (disposed) return;
      const scrolled = (win.scrollY || doc.scrollingElement?.scrollTop || 0) > 0;
      if (root.hasAttribute('data-liquid-header-scrolled') !== scrolled) {
        if (scrolled) root.setAttribute('data-liquid-header-scrolled', '');else root.removeAttribute('data-liquid-header-scrolled');
      }
    }
    win.addEventListener('scroll', refresh, { passive: true });doc.addEventListener('yt-navigate-finish', refresh);refresh();
    return { refresh, dispose() {
      if (disposed) return;disposed = true;win.removeEventListener('scroll', refresh);doc.removeEventListener('yt-navigate-finish', refresh);
      for (const [key, value] of previous) { if (value === null) root.removeAttribute(key);else root.setAttribute(key, value); }
    } };
  }
  function relatedButton(root, filter = 'related') {
    if (!root) return null;
    return [...root.querySelectorAll(CHIP_SELECTOR)]
      .find(button => filter === 'channel' ? /^(?:提供\s*[:：]|From\s+).+/.test(button.textContent.trim()) :
        (filter === 'all' ? ALL_LABELS : LABELS).has(button.textContent.trim()));
  }
  // Shared native menu/hover helpers for video cards and comments.
  function createCommentHover({ document: doc = document, window: win = window, observe = true } = {}) {
    const ROWS = 'ytd-comment-view-model, ytd-comment-renderer', marked = new Map(), pending = new Set();
    let observer, queued = false, disposed = false;
    function update(row) {
      if (!row || !row.matches(ROWS)) return;
      const avatar = row.querySelector('#author-thumbnail img, #author-thumbnail-button img, img#img');
      const source = avatar?.currentSrc || avatar?.getAttribute('src');
      let url;
      try { url = new URL(source, doc.baseURI);if (!source || !['https:', 'http:'].includes(url.protocol)) { release(row);return; } } catch { release(row);return; }
      const value = 'url(' + JSON.stringify(url.href) + ')';
      if (!marked.has(row)) marked.set(row, { value: row.style.getPropertyValue('--liquid-comment-avatar'), priority: row.style.getPropertyPriority('--liquid-comment-avatar') });
      if (row.style.getPropertyValue('--liquid-comment-avatar') !== value) row.style.setProperty('--liquid-comment-avatar', value);
      row.setAttribute('data-liquid-comment-hover', '');
    }
    function release(row) {
      const previous = marked.get(row);if (!previous) return;
      row.removeAttribute('data-liquid-comment-hover');
      if (previous.value) row.style.setProperty('--liquid-comment-avatar', previous.value, previous.priority);else row.style.removeProperty('--liquid-comment-avatar');
      marked.delete(row);
    }
    function scan(node) {
      if (!node?.querySelectorAll) return;
      update(node.closest?.(ROWS));for (const row of node.querySelectorAll(ROWS)) update(row);
    }
    function refresh() {
      if (disposed) return;scan(doc.documentElement);
      for (const row of marked.keys()) if (!row.isConnected) release(row);
    }
    if (observe) {
      observer = new win.MutationObserver(records => {
        for (const record of records) {
          if (record.type === 'attributes') pending.add(record.target);
          else for (const node of record.addedNodes) if (node.nodeType === 1) pending.add(node);
        }
        if (queued) return;queued = true;
        win.queueMicrotask(() => {
          queued = false;if (disposed) return;
          for (const node of pending) scan(node);pending.clear();
          for (const row of marked.keys()) if (!row.isConnected) release(row);
        });
      });
      observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset'] });
    }
    const imageLoaded = event => { if (!disposed && event.target?.matches?.('img')) scan(event.target); };
    doc.addEventListener('load', imageLoaded, true);refresh();
    return { refresh, dispose() { if (disposed) return;disposed = true;observer?.disconnect();doc.removeEventListener('load', imageLoaded, true);pending.clear();for (const row of [...marked.keys()]) release(row); } };
  }
  function createCardMenus({ root, window: win = window, scopes = { videos: true }, observe = true, available = () => true }) {
    const ROWS = 'yt-lockup-view-model, ytd-compact-video-renderer, ytd-playlist-panel-video-renderer, ytd-comment-view-model, ytd-comment-renderer';
    const marked = new Set(), layouts = new Set();
    let menuAnchor = null, observer = null, disposed = false, queued = false;
    const scopeFor = row => row.matches('ytd-comment-view-model, ytd-comment-renderer') ?
      (row.closest('ytd-comment-replies-renderer') ? 'replies' : 'comments') : 'videos';
    const menuButton = row => row.querySelector('.ytLockupMetadataViewModelMenuButton button, #action-menu button, #menu button, ytd-menu-renderer button');
    const anchorFor = button => button?.closest('.ytLockupMetadataViewModelMenuButton, #action-menu, #menu') || button?.closest('ytd-menu-renderer');
    function refresh() {
      queued = false;if (disposed) return;
      const current = new Set(), currentLayouts = new Set();
      for (const row of root.querySelectorAll(ROWS)) {
        if (!scopes[scopeFor(row)]) continue;
        const anchor = anchorFor(menuButton(row));if (!anchor) continue;
        current.add(anchor);anchor.setAttribute('data-liquid-card-menu-trigger', '');
        const layout = anchor.closest('yt-lockup-metadata-view-model');
        if (layout) { currentLayouts.add(layout);layout.setAttribute('data-liquid-card-menu-layout', ''); }
      }
      for (const node of marked) if (!current.has(node)) node.removeAttribute('data-liquid-card-menu-trigger');
      for (const node of layouts) if (!currentLayouts.has(node)) node.removeAttribute('data-liquid-card-menu-layout');
      marked.clear();layouts.clear();for (const node of current) marked.add(node);for (const node of currentLayouts) layouts.add(node);
      if (menuAnchor && !marked.has(menuAnchor.node)) releaseMenuAnchor();
    }
    function releaseMenuAnchor() {
      if (!menuAnchor) return;
      const { node, properties } = menuAnchor;
      node.removeAttribute('data-liquid-context-menu-anchor');
      for (const [key, value, priority] of properties) {
        if (value) node.style.setProperty(key, value, priority);else node.style.removeProperty(key);
      }
      menuAnchor = null;
    }
    function openCardMenu(event) {
      const keyboard = event.type === 'keydown';
      if (keyboard && event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
      if (event.defaultPrevented || disposed || !available()) return;
      const row = event.target.closest?.(ROWS);
      if (!row || !root.contains(row) || !scopes[scopeFor(row)]) return;
      const button = menuButton(row);
      if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
      const anchor = anchorFor(button);
      if (!anchor) return;
      releaseMenuAnchor();
      const properties = ['--liquid-context-x', '--liquid-context-y'].map(key =>
        [key, anchor.style.getPropertyValue(key), anchor.style.getPropertyPriority(key)]);
      const rect = keyboard ? row.getBoundingClientRect() : null;
      const x = keyboard ? rect.right - 40 : event.clientX, y = keyboard ? rect.top : event.clientY;
      anchor.style.setProperty('--liquid-context-x', Math.max(0, Math.min(win.innerWidth - 40, x)) + 'px');
      anchor.style.setProperty('--liquid-context-y', Math.max(0, Math.min(win.innerHeight - 40, y)) + 'px');
      anchor.setAttribute('data-liquid-context-menu-anchor', '');menuAnchor = { node: anchor, properties };
      // Reuse YouTube's actual actions and popup. Only its invisible anchor is
      // positioned at the pointer; no copied menu or recommendation data.
      try { button.click(); } catch { releaseMenuAnchor();return; }
      event.preventDefault();event.stopPropagation();
    }
    root.addEventListener('contextmenu', openCardMenu);root.addEventListener('keydown', openCardMenu);
    if (observe) {
      observer = new win.MutationObserver(() => { if (!queued && !disposed) { queued = true;win.queueMicrotask(refresh); } });
      observer.observe(root, { childList: true, subtree: true });
    }
    refresh();
    return { refresh, setScopes(next) { scopes = { ...next };refresh(); }, dispose() {
      if (disposed) return;disposed = true;observer?.disconnect();releaseMenuAnchor();
      root.removeEventListener('contextmenu', openCardMenu);root.removeEventListener('keydown', openCardMenu);
      for (const node of marked) node.removeAttribute('data-liquid-card-menu-trigger');
      for (const node of layouts) node.removeAttribute('data-liquid-card-menu-layout');marked.clear();layouts.clear();
    } };
  }
  function createScrollLayout({ document: doc = document, window: win = window, stage = false, store = null, parallel = false } = {}) {
    const keys = ['hideMainScrollbar', 'hideChatScrollbar', 'hideListScrollbar'];
    const hidden = Object.fromEntries(keys.map(key => [key, true]));
    const chatCss = 'html[data-liquid-hide-chat-scrollbar],html[data-liquid-hide-chat-scrollbar] *{scrollbar-width:none!important}html[data-liquid-hide-chat-scrollbar]::-webkit-scrollbar,html[data-liquid-hide-chat-scrollbar] *::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}';
    let watch, content, primary, root, inner, chat, panels, frame, chatDocument, chatStyle, sizes, queued = false, disposed = false, unsubscribe;
    let parallelEnabled = parallel, nativePrimaryWidth = 0, expanded = false, leftTabs, chatTab, panelTab, leftView = 'panel', activePanel = null, language = 'ja';
    const columns = new Set();
    let rootTabIndex, addedTabIndex = false, playlistScroller, panelScroller, chatScroller;
    const layoutNodes = 'ytd-watch-flexy, #columns, #primary, #secondary, #secondary-inner, #panels, ytd-engagement-panel-section-list-renderer, ytd-live-chat-frame, iframe';
    const removers = [], observe = new win.MutationObserver(records => {
      if (records.some(record => record.target === root && record.attributeName === VIEW)) syncHeaderScroll();
      if (watch && !watch.isConnected || records.some(record =>
        record.type === 'attributes' && (record.target === watch || record.target.matches?.('ytd-live-chat-frame, ytd-engagement-panel-section-list-renderer')) ||
        [...(record.addedNodes || []), ...(record.removedNodes || [])].some(node => node.nodeType === 1 &&
          (node.matches?.(layoutNodes) || node.querySelector?.(layoutNodes))))) schedule();
    });
    const listen = (node, event, handler) => { node.addEventListener(event, handler);removers.push(() => node.removeEventListener(event, handler)); };
    const flag = (node, key, enabled) => {
      if (!node) return;if (enabled && !node.hasAttribute(key)) node.setAttribute(key, '');else if (!enabled && node.hasAttribute(key)) node.removeAttribute(key);
    };
    const property = (node, key, value) => { if (node.style.getPropertyValue(key) !== value) node.style.setProperty(key, value); };
    function syncHeaderScroll(event) {
      if (disposed) return;
      const target = event?.target;
      if (target !== root && target?.matches?.('#items, .playlist-items') && root?.contains(target) && target.closest('ytd-playlist-panel-renderer')) playlistScroller = target;
      if (target?.matches?.('#content') && activePanel?.contains(target)) panelScroller = target;
      const playlistVisible = !root?.hasAttribute(VIEW) || root.getAttribute(VIEW) === 'playlist';
      flag(root, 'data-liquid-list-scrolled', (root?.scrollTop || 0) > 0 || playlistVisible && (playlistScroller?.scrollTop || 0) > 0);
      const leftScroller = activePanel && leftView === 'panel' ? panelScroller : chatScroller;
      flag(root, 'data-liquid-left-scrolled', (leftScroller?.scrollTop || 0) > 0);
    }
    function releaseExpansion() {
      for (const node of columns) { node.removeAttribute('data-liquid-list-column');node.removeAttribute('data-liquid-chat-column');node.removeAttribute('data-liquid-left-hidden');node.removeAttribute('data-liquid-left-overlay'); }
      columns.clear();root?.removeAttribute('data-liquid-parallel');content?.removeAttribute('data-liquid-wide-columns');primary?.removeAttribute('data-liquid-video-column');
      panels?.removeAttribute('data-liquid-left-panels');panels?.removeAttribute('data-liquid-left-hidden');leftTabs?.remove();
      content?.style.removeProperty('--liquid-wide-side');
      for (const key of ['--liquid-chat-left', '--liquid-wide-side', '--liquid-wide-top', '--liquid-left-tabs-height']) root?.style.removeProperty(key);
      root?.removeAttribute('data-liquid-left-scrolled');panelScroller = null;expanded = false;
    }
    function makeLeftTabs() {
      if (leftTabs) return;
      leftTabs = doc.createElement('div');leftTabs.className = 'liquid-left-panel-tabs';leftTabs.setAttribute('role', 'tablist');
      chatTab = doc.createElement('button');panelTab = doc.createElement('button');
      for (const button of [chatTab, panelTab]) { button.type = 'button';button.setAttribute('role', 'tab'); }
      const choose = view => { leftView = view;update(); };
      listen(chatTab, 'click', () => choose('chat'));listen(panelTab, 'click', () => choose('panel'));
      for (const [button, view] of [[chatTab, 'chat'], [panelTab, 'panel']]) listen(button, 'keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();const next = event.key === 'Home' ? 'chat' : event.key === 'End' ? 'panel' : view === 'chat' ? 'panel' : 'chat';
        choose(next);(next === 'chat' ? chatTab : panelTab).focus({ preventScroll: true });
      });
      leftTabs.append(chatTab, panelTab);
    }
    function updateExpansion(separate, top) {
      const childOfInner = node => { while (node && node.parentElement !== inner) node = node.parentElement;return node; };
      const chatColumn = childOfInner(chat), panel = panels?.querySelector('ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]');
      const listColumns = [inner?.querySelector('#related'), inner?.querySelector('ytd-playlist-panel-renderer')]
        .map(childOfInner).filter(node => node && node !== chatColumn && node !== childOfInner(panels));
      const chatOpen = chat && !chat.hasAttribute('hidden') && chat.getBoundingClientRect().width > 0 &&
        (!win.getComputedStyle || win.getComputedStyle(chat).display !== 'none');
      if (panel !== activePanel) { activePanel = panel;leftView = panel ? 'panel' : 'chat'; }
      const bounds = content?.getBoundingClientRect();
      if (!expanded) nativePrimaryWidth = primary?.getBoundingClientRect().width || 0;
      const available = (bounds?.width || 0) - nativePrimaryWidth - 24;
      const reserved = separate && available >= 720 && listColumns.length && (panel || parallelEnabled && chatOpen && chatColumn);
      // Non-list panels always use the left side. On smaller or theater
      // layouts use an overlay instead of taking width from the native video.
      if (!reserved && (!(panel || chatOpen && chatColumn) || doc.fullscreenElement || !root)) { releaseExpansion();return; }
      const side = reserved ? Math.floor(available / 2) : Math.min(360, Math.max(0, (win.innerWidth || bounds?.width || 384) - 24));
      flag(content, 'data-liquid-wide-columns', !!reserved);flag(primary, 'data-liquid-video-column', !!reserved);flag(root, 'data-liquid-parallel', !!reserved);
      if (reserved) property(content, '--liquid-wide-side', side + 'px');else content?.style.removeProperty('--liquid-wide-side');
      property(root, '--liquid-wide-side', side + 'px');property(root, '--liquid-chat-left', (reserved ? bounds.left : 12) + 'px');property(root, '--liquid-wide-top', top + 'px');
      const shared = !!(panel && chatOpen && chatColumn);
      property(root, '--liquid-left-tabs-height', shared ? '40px' : '0px');
      if (shared) {
        makeLeftTabs();if (leftTabs.parentElement !== root) root.append(leftTabs);
        const chatLabel = language === 'en' ? 'Chat' : 'チャット';
        const panelLabel = panel.getAttribute('target-id') === 'PAyouchat' ? 'Gemini' : panel.querySelector('#title')?.textContent.trim() || (language === 'en' ? 'Panel' : '補助パネル');
        if (chatTab.textContent !== chatLabel) chatTab.textContent = chatLabel;if (panelTab.textContent !== panelLabel) panelTab.textContent = panelLabel;
        const tabLabel = language === 'en' ? 'Left panels' : '左側のパネル';if (leftTabs.getAttribute('aria-label') !== tabLabel) leftTabs.setAttribute('aria-label', tabLabel);
        for (const [button, view] of [[chatTab, 'chat'], [panelTab, 'panel']]) { const selected = leftView === view;if (button.getAttribute('aria-selected') !== String(selected)) button.setAttribute('aria-selected', String(selected));button.tabIndex = selected ? 0 : -1; }
      } else leftTabs?.remove();
      const current = new Set([...(chatOpen && chatColumn ? [chatColumn] : []), ...(reserved ? listColumns : [])]);
      for (const node of columns) if (!current.has(node)) { node.removeAttribute('data-liquid-list-column');node.removeAttribute('data-liquid-chat-column');node.removeAttribute('data-liquid-left-hidden');node.removeAttribute('data-liquid-left-overlay'); }
      if (chatOpen && chatColumn) { flag(chatColumn, 'data-liquid-chat-column', true);flag(chatColumn, 'data-liquid-left-hidden', shared && leftView !== 'chat');flag(chatColumn, 'data-liquid-left-overlay', !reserved); }
      for (const node of listColumns) flag(node, 'data-liquid-list-column', !!reserved);
      flag(panels, 'data-liquid-left-panels', !!panel);flag(panels, 'data-liquid-left-hidden', shared && leftView !== 'panel');
      columns.clear();for (const node of current) columns.add(node);expanded = !!reserved;
    }
    function clearChat() {
      chatDocument?.removeEventListener('scroll', syncHeaderScroll, true);chatScroller = null;
      chatDocument?.documentElement?.removeAttribute('data-liquid-hide-chat-scrollbar');chatStyle?.remove();chatDocument = chatStyle = null;
    }
    function syncChat() {
      let candidate;
      try {
        candidate = frame?.contentDocument;
        const path = candidate?.location?.pathname;
        if (!(/^\/live_chat(?:_replay)?$/.test(path) || stage && path === '/chat-demo')) candidate = null;
      } catch { candidate = null; }
      if (candidate !== chatDocument) {
        clearChat();chatDocument = candidate;
        chatDocument?.addEventListener('scroll', syncHeaderScroll, { capture: true, passive: true });
      }
      if (!chatDocument?.head) return;
      if (!chatStyle) { chatStyle = chatDocument.createElement('style');chatStyle.id = 'liquid-chat-scrollbars';chatStyle.textContent = chatCss;chatDocument.head.append(chatStyle); }
      flag(chatDocument.documentElement, 'data-liquid-hide-chat-scrollbar', hidden.hideChatScrollbar);
      chatScroller = chatDocument.querySelector('#item-scroller' + (stage ? ', main' : ''));
      syncHeaderScroll();
    }
    function releaseMainColumns() {
      root?.removeAttribute('data-liquid-list-scrolled');
      content?.removeAttribute('data-liquid-scroll-columns');primary?.removeAttribute('data-liquid-main-column');
      root?.removeAttribute('data-liquid-scroll-column');root?.removeAttribute('data-liquid-hide-list-scrollbar');root?.style.removeProperty('--liquid-scroll-top');
      if (addedTabIndex && root?.getAttribute('tabindex') === '0') { if (rootTabIndex === null) root.removeAttribute('tabindex');else root.setAttribute('tabindex', rootTabIndex); }
      addedTabIndex = false;
    }
    function releaseColumns() { releaseExpansion();releaseMainColumns();playlistScroller = null; }
    function update() {
      queued = false;if (disposed) return;
      const nextWatch = stage || win.location.pathname === '/watch' ? doc.querySelector('ytd-watch-flexy:not([hidden])') : null;
      const nextContent = nextWatch?.querySelector('#columns'), nextPrimary = nextWatch?.querySelector('#primary'), nextRoot = nextWatch?.querySelector('#secondary');
      const nextInner = nextRoot?.querySelector('#secondary-inner'), nextChat = nextRoot?.querySelector('ytd-live-chat-frame'), nextPanels = nextInner?.querySelector('#panels');
      const changed = watch !== nextWatch || content !== nextContent || root !== nextRoot || primary !== nextPrimary;
      if (changed) {
        root?.removeEventListener('scroll', syncHeaderScroll, true);releaseColumns();
        watch = nextWatch;content = nextContent;primary = nextPrimary;root = nextRoot;
        root?.addEventListener('scroll', syncHeaderScroll, { capture: true, passive: true });
      }
      if (changed || inner !== nextInner || chat !== nextChat || panels !== nextPanels) {
        releaseExpansion();sizes?.disconnect();inner = nextInner;chat = nextChat;panels = nextPanels;activePanel = null;
        for (const node of [content, primary, inner, chat, panels]) if (node) sizes?.observe(node);
      }
      flag(doc.documentElement, 'data-liquid-hide-main-scrollbar', !!watch && hidden.hideMainScrollbar);
      const separate = !!(watch && content && primary && root && watch.hasAttribute('is-two-columns_') &&
        !watch.hasAttribute('theater') && !doc.fullscreenElement);
      const top = Math.max(56, doc.querySelector('ytd-masthead')?.getBoundingClientRect().bottom || 56) + 12;
      if (separate) {
        flag(content, 'data-liquid-scroll-columns', true);flag(primary, 'data-liquid-main-column', true);flag(root, 'data-liquid-scroll-column', true);
        property(root, '--liquid-scroll-top', top + 'px');
        if (!root.hasAttribute('tabindex')) { rootTabIndex = root.getAttribute('tabindex');addedTabIndex = true;root.setAttribute('tabindex', '0'); }
      } else releaseMainColumns();
      updateExpansion(separate, top);
      // The native playlist has an inner scroller even in single-column/theater mode.
      flag(root, 'data-liquid-hide-list-scrollbar', !!watch && hidden.hideListScrollbar);
      const nextFrame = watch?.querySelector('ytd-live-chat-frame iframe');
      if (frame !== nextFrame) { frame?.removeEventListener('load', syncChat);clearChat();frame = nextFrame;frame?.addEventListener('load', syncChat); }
      syncChat();
      playlistScroller = root?.querySelector('ytd-playlist-panel-renderer #items, ytd-playlist-panel-renderer .playlist-items');
      panelScroller = activePanel?.querySelector('#content');syncHeaderScroll();
    }
    function schedule() { if (!queued && !disposed) { queued = true;win.queueMicrotask(update); } }
    if (win.ResizeObserver) sizes = new win.ResizeObserver(schedule);
    observe.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'collapsed', 'is-two-columns_', 'theater', 'visibility', VIEW] });
    for (const event of ['yt-navigate-finish', 'yt-page-data-updated']) listen(doc, event, schedule);
    const resize = () => { releaseExpansion();schedule(); };
    listen(doc, 'fullscreenchange', resize);listen(win, 'resize', resize);listen(win, 'pageshow', resize);listen(win, 'pagehide', event => { if (!event.persisted) dispose(); });
    if (store) unsubscribe = store.subscribe(values => { for (const key of keys) hidden[key] = values[key] !== false;parallelEnabled = !!values.sidebarParallel;language = values.language === 'en' ? 'en' : 'ja';schedule(); });
    function dispose() {
      if (disposed) return;disposed = true;root?.removeEventListener('scroll', syncHeaderScroll, true);releaseColumns();observe.disconnect();sizes?.disconnect();unsubscribe?.();
      frame?.removeEventListener('load', syncChat);clearChat();doc.documentElement.removeAttribute('data-liquid-hide-main-scrollbar');for (const remove of removers) remove();
    }
    update();return { refresh: update, setParallel(next) { parallelEnabled = !!next;update(); }, dispose };
  }
  function create({ document: doc = document, window: win = window, stage = false,
    selectFilter = button => button.click(), store = null, enabled = true, parallel = false, icons = globalThis.YacIcons } = {}) {
    let root, watch, host, observer, discovery, timer, retryTimer, queued = false, disposed = false, busy;
    let view = 'related', filter = 'related', savedFilter = 'related', active = enabled, unsubscribe, nativeLabel, nativeFilter;
    let videoId = null, navigating = false, attempt = null, pending = null, failed = false;
    let attempts = 0, acknowledged = false;
    let tabs, playlistTab, playlistLabel, notice, message, retry, skeleton;
    const tagTabs = new Map();let visibleTabs = [];
    let cardMenus = null;
    const scrollLayout = createScrollLayout({ document: doc, window: win, stage, store, parallel });
    const listeners = [], mountListeners = [];
    const attr = (node, key, value) => { if (node.getAttribute(key) !== value) node.setAttribute(key, value); };
    const listen = (node, event, handler, mounted = false) => { node.addEventListener(event, handler);(mounted ? mountListeners : listeners).push(() => node.removeEventListener(event, handler)); };
    const filterButton = related => Object.hasOwn(FILTER_NAMES, filter) ? relatedButton(related, filter) :
      [...(related?.querySelectorAll(CHIP_SELECTOR) || [])].find(button => 'chip:' + button.textContent.trim() === filter);
    function clearWait() { win.clearTimeout(timer);timer = null; }
    function clearRetry() { win.clearTimeout(retryTimer);retryTimer = null; }
    function rowIdentity(container) {
      return [...container.querySelectorAll('yt-lockup-view-model, ytd-compact-video-renderer')]
        .map(row => ({ row, href: row.querySelector('a[href]')?.getAttribute('href'), text: row.textContent }));
    }
    function status(state) {
      attr(root, STATE, state);
      attr(root, 'aria-busy', String(state === 'loading'));
      notice.hidden = view === 'playlist' || state === 'ready';
      skeleton.hidden = state !== 'loading';
      message.textContent = state === 'unavailable' ? `この動画では「${FILTER_NAMES[filter] || filter.slice(5)}」の絞り込みを利用できません。` :
        state === 'failed' ? '動画一覧を読み込めませんでした。' : '';
      message.hidden = state !== 'unavailable' && state !== 'failed';
      retry.hidden = state !== 'unavailable' && state !== 'failed';
    }
    function armWait() {
      if (timer) return;
      timer = win.setTimeout(() => {
        timer = null;
        if (!disposed && root) { failed = true;clearRetry();status(attempt ? 'failed' : 'unavailable'); }
      }, 10000);
    }
    function requestFilter(button, delay) {
      if (retryTimer || failed || attempts >= 5) return;
      retryTimer = win.setTimeout(() => {
        retryTimer = null;
        if (disposed || !active || navigating || !root?.isConnected || filterButton(root.querySelector('#related')) !== button) return;
        if (selected(button)) { schedule();return; }
        attempt = button;attempts++;acknowledged = false;
        pending = { button, before: rowIdentity(root.querySelector('#related')) };
        try { selectFilter(button); } catch { failed = true;clearWait();status('failed');return; }
        schedule();
      }, delay);
    }
    function renderTabs(playlist) {
      if (!playlist && view === 'playlist') view = filter;
      const listId = new URL(win.location.href).searchParams.get('list') || '';
      playlistLabel.textContent = stage || listId.startsWith('RD') ? 'ミックスリスト' : '再生リスト';
      playlistTab.hidden = !playlist;
      const related = root.querySelector('#related'), current = new Set();visibleTabs = playlist ? [{ button: playlistTab, name: 'playlist' }] : [];
      for (const source of related?.querySelectorAll(CHIP_SELECTOR) || []) {
        const label = source.textContent.trim();if (!label) continue;
        const name = Object.keys(FILTER_NAMES).find(key => relatedButton(related, key) === source) || 'chip:' + label;
        if (current.has(name)) continue;current.add(name);
        let entry = tagTabs.get(name);
        if (!entry) {
          const button = doc.createElement('button');button.type = 'button';button.setAttribute('role', 'tab');button.setAttribute('aria-controls', 'related');
          const click = () => choose(name), keyboard = event => tabKey(event, name);
          button.addEventListener('click', click);button.addEventListener('keydown', keyboard);
          entry = { button, name, remove() { button.removeEventListener('click', click);button.removeEventListener('keydown', keyboard);button.remove(); } };tagTabs.set(name, entry);
        }
        if (entry.button.textContent !== label) entry.button.textContent = label;
        entry.button.title = label;visibleTabs.push(entry);
      }
      let removedFocus = false;
      for (const [name, entry] of tagTabs) if (!current.has(name)) {
        if (doc.activeElement === entry.button) removedFocus = true;entry.remove();tagTabs.delete(name);
      }
      if (filter.startsWith('chip:') && current.size && !current.has(filter)) {
        filter = savedFilter;if (view !== 'playlist') view = filter;
        attempt = pending = null;failed = false;attempts = 0;acknowledged = false;clearWait();clearRetry();
      }
      attr(root, VIEW, view);
      // Keep the native order without moving YouTube's managed chip nodes.
      const ordered = [playlistTab, ...visibleTabs.filter(entry => entry.name !== 'playlist').map(entry => entry.button)];
      ordered.forEach((button, index) => { if (tabs.children[index] !== button) tabs.insertBefore(button, tabs.children[index] || null); });
      for (const { button, name } of visibleTabs) {
        attr(button, 'aria-selected', String(view === name));button.tabIndex = view === name ? 0 : -1;
      }
      if (visibleTabs.length && !visibleTabs.some(entry => entry.name === view)) visibleTabs[0].button.tabIndex = 0;
      if (removedFocus) (visibleTabs.find(entry => entry.name === view) || visibleTabs[0])?.button.focus({ preventScroll: true });
    }
    function refresh() {
      queued = false;if (disposed || !active || !root) return;
      if (!root.isConnected || !watch.isConnected) { unmount();discover();return; }
      if (!host.isConnected) root.insertBefore(host, root.querySelector('#secondary-inner'));
      cardMenus?.refresh();
      const related = root.querySelector('#related'), playlist = root.querySelector('ytd-playlist-panel-renderer');
      // YouTube retains an empty/hidden playlist renderer on ordinary watches.
      const hasPlaylist = playlist && !playlist.hasAttribute('hidden') && playlist.querySelector('ytd-playlist-panel-video-renderer');
      const urlId = new URL(win.location.href).searchParams.get('v');
      const domId = watch.getAttribute('video-id');
      if (!stage && (win.location.pathname !== '/watch' || watch.hasAttribute('hidden'))) { unmount();return; }
      if (navigating || (!stage && domId && urlId && domId !== urlId)) { renderTabs(hasPlaylist);status('loading');return; }
      const id = stage ? 'stage' : urlId;
      if (videoId !== id) {
        if (filter.startsWith('chip:')) { filter = savedFilter;if (view !== 'playlist') view = filter; }
        videoId = id;attempt = null;pending = null;failed = false;attempts = 0;acknowledged = false;clearWait();clearRetry();
      }
      renderTabs(hasPlaylist);scrollLayout.refresh();
      if (!related) { status('loading');armWait();return; }
      const button = filterButton(related);
      if (!button) { status(failed ? 'unavailable' : 'loading');if (!failed) armWait();return; }
      if (failed && !attempt) { failed = false;clearWait(); }
      if (pending && pending.button !== button) { pending = null;attempt = null;failed = false;attempts = 0;clearWait();clearRetry(); }
      if (selected(button)) {
        acknowledged = true;clearRetry();
        if (pending && !stage) {
          const current = rowIdentity(related), previous = pending.before;
          // Selection changes before the asynchronous recommendation response.
          // Do not expose the old All rows during that interval.
          if (current.length === previous.length && current.every((item, index) => item.row === previous[index].row &&
            item.href === previous[index].href && item.text === previous[index].text)) {
            status(failed ? 'failed' : 'loading');if (!failed) armWait();return;
          }
        }
        pending = null;failed = false;clearWait();status('ready');return;
      }
      // During SPA navigation YouTube can reuse the chip node, then reset it
      // to All after our first click. Reapply after the native update settles;
      // never treat that early click as a permanent completed attempt.
      if (acknowledged) { acknowledged = false;pending = null; }
      status(failed ? 'failed' : 'loading');
      if (!failed) { armWait();requestFilter(button, attempts ? Math.min(1800, 400 * 2 ** (attempts - 1)) : 120); }
    }
    function schedule() {
      if (queued || disposed) return;queued = true;win.queueMicrotask(refresh);
    }
    function choose(next) {
      if (next === 'playlist' && playlistTab.hidden) return;
      view = next;
      if (next !== 'playlist' && next !== filter) {
        filter = next;attempt = pending = null;failed = false;attempts = 0;clearWait();clearRetry();
        if (Object.hasOwn(FILTER_NAMES, next)) { savedFilter = next;if (store) Promise.resolve(store.set('sidebarFilter', next, true)).catch(() => {}); }
      }
      refresh();
    }
    function tabKey(event, name) {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();const index = visibleTabs.findIndex(entry => entry.name === name);
      const next = event.key === 'Home' ? visibleTabs[0] : event.key === 'End' ? visibleTabs.at(-1) :
        visibleTabs[(index + (event.key === 'ArrowRight' ? 1 : -1) + visibleTabs.length) % visibleTabs.length];
      if (next) { choose(next.name);next.button.focus({ preventScroll: true });next.button.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }
    }
    function makeHost() {
      host = doc.createElement('div');host.className = 'liquid-watch-sidebar';
      tabs = doc.createElement('div');tabs.className = 'liquid-sidebar-tabs';
      tabs.setAttribute('role', 'tablist');tabs.setAttribute('aria-label', '右側の動画一覧');
      listen(tabs, 'wheel', event => {
        if (tabs.scrollWidth <= tabs.clientWidth) return;
        const before = tabs.scrollLeft, delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        tabs.scrollLeft += delta * (event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? tabs.clientWidth : 1);
        if (tabs.scrollLeft !== before) event.preventDefault();
      }, true);
      playlistTab = doc.createElement('button');playlistTab.type = 'button';playlistTab.setAttribute('role', 'tab');playlistTab.setAttribute('aria-controls', 'playlist');playlistTab.setAttribute('data-liquid-special-tab', '');
      const icon = icons?.create('list-video', 16);if (icon) playlistTab.append(icon);
      playlistLabel = doc.createElement('span');playlistLabel.textContent = 'ミックスリスト';playlistTab.append(playlistLabel);tabs.append(playlistTab);
      listen(playlistTab, 'click', () => choose('playlist'), true);listen(playlistTab, 'keydown', event => tabKey(event, 'playlist'), true);
      notice = doc.createElement('div');notice.className = 'liquid-sidebar-notice';
      skeleton = doc.createElement('div');skeleton.className = 'liquid-sidebar-skeleton';skeleton.setAttribute('aria-hidden', 'true');
      for (let index = 0;index < 5;index++) {
        const row = doc.createElement('div');row.className = 'liquid-sidebar-placeholder';
        const thumbnail = doc.createElement('span');thumbnail.className = 'liquid-sidebar-placeholder-image';
        const lines = doc.createElement('div');lines.className = 'liquid-sidebar-placeholder-lines';
        for (let line = 0;line < 3;line++) lines.append(doc.createElement('span'));
        row.append(thumbnail, lines);skeleton.append(row);
      }
      message = doc.createElement('p');message.setAttribute('role', 'status');
      retry = doc.createElement('button');retry.type = 'button';retry.textContent = '再試行';
      listen(retry, 'click', () => { attempt = null;pending = null;failed = false;attempts = 0;clearWait();clearRetry();refresh(); }, true);
      notice.append(skeleton, message, retry);host.append(tabs, notice);
    }
    function unmount() {
      cardMenus?.dispose();cardMenus = null;
      observer?.disconnect();observer = null;clearWait();clearRetry();host?.remove();
      for (const entry of tagTabs.values()) entry.remove();tagTabs.clear();visibleTabs = [];
      for (const remove of mountListeners.splice(0)) remove();
      root?.removeAttribute(VIEW);root?.removeAttribute(STATE);
      if (root) { if (busy === null) root.removeAttribute('aria-busy');else root.setAttribute('aria-busy', busy); }
      root = watch = host = null;videoId = null;attempt = pending = null;failed = false;
    }
    function discover() {
      scrollLayout.refresh();
      if (disposed || !active) return;
      if (!stage && win.location.pathname !== '/watch') { unmount();return; }
      const nextWatch = doc.querySelector('ytd-watch-flexy:not([hidden])');
      const next = nextWatch?.querySelector('#secondary');
      if (!next || !next.querySelector('#secondary-inner')) { unmount();return; }
      if (next === root) { schedule();return; }
      unmount();watch = nextWatch;root = next;busy = root.getAttribute('aria-busy');makeHost();
      const original = [...(root.querySelector('#related')?.querySelectorAll('[role="tab"]') || [])].find(selected);
      nativeLabel = original?.textContent.trim();
      nativeFilter = Object.keys(FILTER_NAMES).find(name => relatedButton(root.querySelector('#related'), name) === original);
      root.insertBefore(host, root.querySelector('#secondary-inner'));
      cardMenus = createCardMenus({ root, window: win, scopes: { videos: true }, observe: false, available: () => active && !navigating });
      observer = new win.MutationObserver(records => {
        if (records.some(record => !host.contains(record.target))) schedule();
      });
      observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ['aria-selected', 'selected', 'hidden', 'collapsed', 'theater', 'href'] });
      observer.observe(watch, { attributes: true, attributeFilter: ['theater'] });
      refresh();
    }
    listen(doc, 'yt-navigate-start', () => { navigating = true;clearWait();clearRetry();if (root) status('loading'); });
    listen(doc, 'yt-navigate-finish', () => { navigating = false;attempt = pending = null;videoId = null;discover(); });
    listen(doc, 'yt-page-data-updated', () => { if (!navigating) discover(); });
    listen(win, 'pageshow', discover);
    listen(doc, 'fullscreenchange', discover);
    listen(win, 'pagehide', event => { if (!event.persisted) dispose(); });
    // Only discover structural replacements. Player/comment changes do not
    // trigger sidebar queries; the mounted sidebar has its own narrow observer.
    discovery = new win.MutationObserver(records => {
      if (root && (!root.isConnected || !host?.isConnected)) { discover();return; }
      if (records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 &&
        (node.matches('ytd-watch-flexy, #secondary, #secondary-inner') || (!root && node.querySelector('ytd-watch-flexy, #secondary')))))) discover();
    });
    function setEnabled(next) {
      if (disposed || next === active) return;
      active = next;
      if (!active) {
        const related = root?.querySelector('#related');
        const original = [...(related?.querySelectorAll('[role="tab"]') || [])].find(button => button.textContent.trim() === nativeLabel) ||
          (nativeFilter && relatedButton(related, nativeFilter)) || relatedButton(related, 'all');
        // Show the native chips before restoring their original selection.
        unmount();discovery.disconnect();if (original && !selected(original)) { try { selectFilter(original); } catch { /* The native chip may have been detached during navigation. */ } }
      } else { view = filter;discovery.observe(doc.documentElement, { childList: true, subtree: true });discover(); }
    }
    function dispose() {
      if (disposed) return;disposed = true;unmount();discovery.disconnect();
      scrollLayout.dispose();
      unsubscribe?.();for (const remove of listeners.splice(0)) remove();
    }
    if (active) { discovery.observe(doc.documentElement, { childList: true, subtree: true });discover(); }
    if (store) unsubscribe = store.subscribe(values => {
      const next = Object.hasOwn(FILTER_NAMES, values.sidebarFilter) ? values.sidebarFilter : 'related';
      if (next !== savedFilter) { savedFilter = filter = next;if (view !== 'playlist') view = next;attempt = pending = null;failed = false;attempts = 0;clearWait();clearRetry(); }
      setEnabled(!!values.sidebarEnabled);if (active) schedule();
    });
    return { dispose, refresh: discover, setEnabled, setParallel: scrollLayout.setParallel };
  }
  const api = { create, relatedButton, createCardMenus, createCommentHover, createHeaderFade, createScrollLayout };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    globalThis.LiquidWatchSidebar = api;
    if (location.hostname === 'www.youtube.com' && !document.documentElement.hasAttribute('data-liquid-design-stage')) {
      api.instance = create({ store: globalThis.LiquidUI?.getStore('youtube'), enabled: false });
      api.commentHover = createCommentHover();
      api.commentMenus = createCardMenus({ root: document.documentElement, scopes: { comments: true, replies: true } });
      api.headerFade = createHeaderFade();
      window.addEventListener('pagehide', event => {
        if (!event.persisted) { api.commentHover.dispose();api.commentMenus.dispose();api.headerFade.dispose(); }
      });
    }
  }
})();
