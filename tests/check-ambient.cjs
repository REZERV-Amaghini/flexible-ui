'use strict';
// No browser, network, video decoding or visible flashing. This runs the actual
// controller against a deterministic DOM/clock and renderer/monitor test doubles.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(workerMode = false, { videoFrameCallbacks = false, idleCallbacks = true, scrollBlend = () => 0, storageSet = async () => {}, runtimeGetURL = file => 'test-extension:///' + file,
  runtimeGetManifest, runtimeAccess = runtime => runtime, runtimeManifestAccess = method => method, storageRemove = () => {}, mainDraw = () => {}, realFlashMonitor = false, sharedSettings = false, quickPanelController = null } = {}) {
  const nodes = [], raf = new Map(), intervals = new Map(), renders = [], inspections = [];
  const idle = new Map(), timeouts = new Map(), observers = [], videoFrames = new Map(), resizeObservers = [];
  const stats = { surfaceScans: 0, surfaceSubtreeQueries: 0, rectReads: 0, computedStyleReads: 0, monitorSamples: 0, monitorResets: 0, activityReads: 0,
    rendererInvalidates: 0, rendererResets: 0, workerAcceptedFrames: 0, pageReloads: 0 };
  const workerResponses = [], warnings = [], rectReadsByNode = new Map(), computedStyleReadsByNode = new Map();
  const apiCalls = { runtimeReads: 0, manifestPropertyReads: 0, manifestCalls: 0, urlCalls: 0, storageReads: 0 };
  const storageResolvers = [];
  let now = 0, id = 0, flash = false, presentedFrames = 0, worker, renderer;
  const splitOutside = (text, delimiters) => {
    const parts = []; let depth = 0, start = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '(' || text[i] === '[') depth++;
      if (text[i] === ')' || text[i] === ']') depth--;
      if (!depth && delimiters.includes(text[i])) {
        if (i > start) parts.push(text.slice(start, i).trim());
        if (text[i] === '>') parts.push('>');
        start = i + 1;
      }
    }
    if (start < text.length) parts.push(text.slice(start).trim());
    return parts.filter(Boolean);
  };
  // A generic selector subset, used by the real pageSurfaces selector in this
  // controller test. No canned list of matched ambient surfaces is returned.
  const matches = (element, selector) => {
    if (element.nodeType !== 1) return false;
    const simple = (node, text) => {
      if (!node || node.nodeType !== 1) return false;
      while (text) {
        const functional = /^:(is|not)\(/.exec(text);
        if (functional) {
          let depth = 1, end = functional[0].length;
          while (end < text.length && depth) { if (text[end] === '(') depth++; if (text[end] === ')') depth--; end++; }
          const found = matches(node, text.slice(functional[0].length, end - 1));
          if (found === (functional[1] === 'not')) return false;
          text = text.slice(end); continue;
        }
        const attr = /^\[([\w-]+)(?:(\^?=)["']?([^"'\]]+)["']?)?\]/.exec(text);
        if (attr) {
          const value = node.getAttribute(attr[1]);
          if (value === null || (attr[2] === '=' && value !== attr[3]) || (attr[2] === '^=' && !value.startsWith(attr[3]))) return false;
          text = text.slice(attr[0].length); continue;
        }
        const token = /^(\*|[.#]?[\w-]+)/.exec(text);
        if (!token) throw new Error('Unsupported test selector: ' + text);
        const value = token[0];
        if (value[0] === '.' ? !node.classList.contains(value.slice(1)) : value[0] === '#' ? node.id !== value.slice(1) : value !== '*' && node.localName !== value) return false;
        text = text.slice(value.length);
      }
      return true;
    };
    return splitOutside(selector, ',').some(part => {
      const chain = splitOutside(part, ' >');
      const matchAt = (node, index) => {
        if (!simple(node, chain[index])) return false;
        if (!index) return true;
        if (chain[index - 1] === '>') return matchAt(node.parentElement, index - 2);
        for (let parent = node.parentElement; parent; parent = parent.parentElement) if (matchAt(parent, index - 1)) return true;
        return false;
      };
      return matchAt(element, chain.length - 1);
    });
  };
  const recordMutation = record => {
    for (const observer of observers) {
      if (!observer.target || !observer.target.contains(record.target)) continue;
      if (record.type === 'attributes' && (!observer.options.attributes || !observer.options.attributeFilter.includes(record.attributeName))) continue;
      if (record.type === 'childList' && !observer.options.childList) continue;
      observer.records.push(record);
    }
  };
  const flushMutations = () => {
    for (let round = 0; round < 20; round++) {
      const pending = observers.filter(observer => observer.records.length);
      if (!pending.length) return;
      for (const observer of pending) { const records = observer.records.splice(0); observer.callback(records); }
    }
    throw new Error('Mutation feedback loop in controller');
  };
  class Event {
    constructor(type, values = {}) { this.type = type; Object.assign(this, values); }
    stopPropagation() { this.cancelBubble = true; } preventDefault() { this.defaultPrevented = true; }
  }
  class Target {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, callback, options) {
      const list = this.listeners.get(type) || []; list.push({ callback, options }); this.listeners.set(type, list);
    }
    removeEventListener(type, callback) { this.listeners.set(type, (this.listeners.get(type) || []).filter(v => v.callback !== callback)); }
    dispatchEvent(event) {
      event.target ||= this;
      for (const entry of [...(this.listeners.get(event.type) || [])]) {
        entry.callback(event); if (entry.options?.once) this.removeEventListener(event.type, entry.callback);
      }
      return true;
    }
  }
  class Style {
    constructor(owner) { this.owner = owner; this.values = new Map(); }
    setProperty(name, value, priority = '') {
      if (this.getPropertyValue(name) === String(value) && this.getPropertyPriority(name) === priority) return;
      this.values.set(name, [String(value), priority]);
      recordMutation({ type: 'attributes', target: this.owner, attributeName: 'style' });
    }
    getPropertyValue(name) { return this.values.get(name)?.[0] || ''; }
    getPropertyPriority(name) { return this.values.get(name)?.[1] || ''; }
    removeProperty(name) { if (this.values.delete(name)) recordMutation({ type: 'attributes', target: this.owner, attributeName: 'style' }); }
  }
  class Element extends Target {
    constructor(tag) {
      super(); this.localName = tag; this.nodeType = tag === '#text' ? 3 : 1; this.children = []; this.attributes = new Map(); this.style = new Style(this);
      this.dataset = {}; this.className = ''; this.rect = { left: 100, top: 100, width: 640, height: 360 };
      this.clientWidth = 640; this.clientHeight = 360; this.width = 400; this.height = 250; nodes.push(this);
      this.classList = {
        contains: name => { if (name === 'yac-active') stats.activityReads++; return this.className.split(' ').includes(name); },
        toggle: (name, force) => {
          const list = new Set(this.className.split(' ').filter(Boolean));
          const value = force === undefined ? !list.has(name) : force;
          if (value) list.add(name); else list.delete(name); this.className = [...list].join(' '); return value;
        },
        add: name => this.classList.toggle(name, true), remove: name => this.classList.toggle(name, false)
      };
    }
    setAttribute(name, value) {
      const oldValue = this.getAttribute(name); value = String(value);
      if (oldValue === value) return;
      this.attributes.set(name, value); recordMutation({ type: 'attributes', target: this, attributeName: name, oldValue });
    }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { const oldValue = this.getAttribute(name); if (this.attributes.delete(name)) recordMutation({ type: 'attributes', target: this, attributeName: name, oldValue }); }
    get id() { return this.getAttribute('id') || ''; } set id(value) { this.setAttribute('id', value); }
    get className() { return this.getAttribute('class') || ''; } set className(value) { this.setAttribute('class', value); }
    get hidden() { return this.hasAttribute('hidden'); }
    set hidden(value) {
      if (value) this.setAttribute('hidden', ''); else this.removeAttribute('hidden');
      if (value) for (let node = document.activeElement; node; node = node.parentElement || node.host) {
        if (node === this) { document.activeElement = document.body;break; }
      }
    }
    append(...children) { for (const child of children) { child.remove(); this.children.push(child); child.parentElement = this; recordMutation({ type: 'childList', target: this, addedNodes: [child], removedNodes: [] }); } }
    prepend(child) { child.remove(); this.children.unshift(child); child.parentElement = this; recordMutation({ type: 'childList', target: this, addedNodes: [child], removedNodes: [] }); }
    after(child) { const parent = this.parentElement;if (!parent) return;child.remove();parent.children.splice(parent.children.indexOf(this) + 1, 0, child);child.parentElement = parent;recordMutation({ type: 'childList', target: parent, addedNodes: [child], removedNodes: [] }); }
    insertBefore(child, before) { child.remove(); const n = this.children.indexOf(before); this.children.splice(n < 0 ? this.children.length : n, 0, child); child.parentElement = this; recordMutation({ type: 'childList', target: this, addedNodes: [child], removedNodes: [] }); }
    remove() { if (this.parentElement) { const parent = this.parentElement; parent.children = parent.children.filter(v => v !== this); this.parentElement = null; recordMutation({ type: 'childList', target: parent, addedNodes: [], removedNodes: [this] }); } }
    get isConnected() { return this === document.documentElement || !!this.parentElement?.isConnected || !!this.host?.isConnected; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    attachShadow() { this.shadowRoot = new Element('#shadow'); this.shadowRoot.host = this; return this.shadowRoot; }
    get activeElement() { return this.host && this.contains(document.activeElement) ? document.activeElement : null; }
    getBoundingClientRect() { stats.rectReads++;rectReadsByNode.set(this, (rectReadsByNode.get(this) || 0) + 1); return { ...this.rect, right: this.rect.left + this.rect.width, bottom: this.rect.top + this.rect.height }; }
    focus() {
      if (this.disabled || !this.isConnected) return;
      for (let node = this; node; node = node.parentElement || node.host) if (node.hidden) return;
      document.activeElement = this;
    }
    click() { this.dispatchEvent(new Event('click')); }
    showModal() { this.open = true; this.modalCalls = (this.modalCalls || 0) + 1; }
    close() { this.open = false; }
    getContext() { return { drawImage() {} }; }
    matches(selector) { return matches(this, selector); }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
    querySelectorAll(selector) { const result = []; const walk = element => { for (const child of element.children) { if (child.matches(selector)) result.push(child); walk(child); } }; walk(this); return result; }
    querySelector(selector) {
      if (selector.startsWith('body,ytd-app,')) stats.surfaceSubtreeQueries++;
      return this.querySelectorAll(selector)[0] || null;
    }
  }
  const document = new Target(); document.hidden = false; document.fullscreenElement = null;
  document.createElement = tag => new Element(tag); document.createElementNS = (_, tag) => new Element(tag);
  document.createTextNode = text => { const node = new Element('#text'); node.textContent = text; return node; };
  document.documentElement = new Element('html'); document.head = new Element('head'); document.body = new Element('body'); document.documentElement.append(document.head, document.body);
  document.getElementById = value => nodes.find(node => node.id === value && node.isConnected && !node.host) || null;
  document.querySelector = selector => document.documentElement.querySelector(selector);
  document.querySelectorAll = selector => { stats.surfaceScans++; return document.documentElement.querySelectorAll(selector); };
  const app = new Element('ytd-app'), watch = new Element('ytd-watch-flexy'), below = new Element('div'), comments = new Element('ytd-comments');
  const masthead = new Element('ytd-masthead'), headerEnd = new Element('div'), headerButtons = new Element('div'), create = new Element('ytd-button-renderer'), notification = new Element('ytd-notification-topbar-button-renderer');
  headerEnd.id = 'end';headerButtons.id = 'buttons';
  masthead.rect = { left: 0, top: 0, width: 1280, height: 56 };
  masthead.append(headerEnd);headerEnd.append(headerButtons);headerButtons.append(create, notification);
  below.id = 'below'; comments.id = 'comments';
  const player = new Element('div'), video = new Element('video'), toolbar = new Element('div'), gear = new Element('button');
  player.id = 'movie_player'; video.className = 'html5-main-video'; toolbar.className = 'ytp-right-controls'; gear.className = 'ytp-settings-button';
  Object.assign(video, { videoWidth: 640, videoHeight: 360, readyState: 4, currentTime: 1, currentSrc: 'test:static', paused: false, seeking: false });
  document.body.append(app); app.append(masthead, watch); watch.append(player, below); below.append(comments); player.append(video, toolbar); toolbar.append(gear);
  if (videoFrameCallbacks) {
    video.requestVideoFrameCallback = callback => { const n = ++id; videoFrames.set(n, callback); return n; };
    video.cancelVideoFrameCallback = n => videoFrames.delete(n);
  }
  const pixels = new Uint8ClampedArray(160 * 90 * 4);
  class Renderer {
    static scrollBlend(rectangle, viewport) { return scrollBlend(rectangle, viewport); }
    constructor() { this.padding = 180; this.readable = true; this.stableFrames = 4; renderer = this; }
    reset() { stats.rendererResets++; } invalidate() { stats.rendererInvalidates++; } dispose() { this.disposed = true; }
    result() { return { readable: true, cropped: true, videoCrop: { x: 0, y: 10, width: 160, height: 70 }, samplingCrop: { x: 0, y: 10, width: 160, height: 70 } }; }
    draw(...args) { renders.push(args); mainDraw(...args); return this.result(); }
    inspect(...args) { inspections.push(args); return this.result(); }
    readPixels() { return pixels; }
  }
  class WorkerRenderer extends Renderer {
    constructor(canvas, callbacks) { super(canvas); this.callbacks = callbacks; this.pending = false; worker = this; }
    setSuspended(value) { this.suspended = value; }
    fail(reason) { if (!this.disposed) this.callbacks.onFailure(reason); }
    canAcceptFrame() { return !this.disposed && !this.pending && !this.suspended; }
    draw(source, rectangle, viewport, radial, options) {
      if (!this.canAcceptFrame()) return false;
      this.pending = true;
      (options.sampleOnly ? inspections : renders).push([source, rectangle, viewport, radial, options]);
      const meta = { source, rectangle, viewport, options, sourceKey: options.sourceKey, mediaTime: source.currentTime };
      workerResponses.push(() => {
        this.pending = false;
        if (!this.disposed && this.callbacks.acceptFrame(meta)) {
          stats.workerAcceptedFrames++;
          this.callbacks.onFrame({ ...this.result(), sampleOnly: options.sampleOnly }, meta);
        }
      });
      return true;
    }
  }
  const flushWorkers = () => { for (const callback of workerResponses.splice(0)) callback(); };
  const storageListeners = new Set();
  const storage = { local: { get: () => { apiCalls.storageReads++;return new Promise(resolve => storageResolvers.push(resolve)); }, set: storageSet },
    onChanged: { addListener: f => storageListeners.add(f), removeListener: f => { storageListeners.delete(f);storageRemove(); } } };
  const runtime = workerMode ? { getURL: file => { apiCalls.urlCalls++;return runtimeGetURL(file); } } : {};
  const manifestMethod = runtimeGetManifest === undefined ? undefined : (...args) => { apiCalls.manifestCalls++;return runtimeGetManifest(...args); };
  Object.defineProperty(runtime, 'getManifest', { get: () => { apiCalls.manifestPropertyReads++;return runtimeManifestAccess(manifestMethod); } });
  const browser = { storage };
  Object.defineProperty(browser, 'runtime', { get: () => { apiCalls.runtimeReads++;return runtimeAccess(runtime); } });
  const window = new Target();
  const context = vm.createContext({ document, window, Event, URLSearchParams, URL, console: { ...console, warn: (...args) => warnings.push(args) }, Uint8ClampedArray,
    browser, location: { pathname: '/watch', search: '?v=static', href: 'https://www.youtube.com/watch?v=static', reload: () => stats.pageReloads++ },
    innerWidth: 1280, innerHeight: 720, performance: { now: () => now },
    getComputedStyle: element => { stats.computedStyleReads++;computedStyleReadsByNode.set(element, (computedStyleReadsByNode.get(element) || 0) + 1);
      return { objectFit: 'contain', display: element.hidden ? 'none' : 'block',
        borderLeftWidth: element.style.getPropertyValue('border-left-width') || '0px',
        borderTopWidth: element.style.getPropertyValue('border-top-width') || '0px' }; },
    ResizeObserver: class { constructor(callback) { this.callback = callback; resizeObservers.push(this); } observe(target) { this.target = target; } disconnect() { this.target = null; } },
    MutationObserver: class { constructor(callback) { this.callback = callback; this.records = []; observers.push(this); } observe(target, options) { this.target = target; this.options = options; } disconnect() { this.target = null; this.records = []; } },
    requestAnimationFrame: callback => { const n = ++id; raf.set(n, callback); return n; }, cancelAnimationFrame: n => raf.delete(n),
    setInterval: callback => { const n = ++id; intervals.set(n, callback); return n; }, clearInterval: n => intervals.delete(n),
    setTimeout: (callback, delay = 0) => { const n = ++id; timeouts.set(n, { callback, due: now + delay }); return n; }, clearTimeout: n => timeouts.delete(n), queueMicrotask,
    ...(idleCallbacks ? { requestIdleCallback: callback => { const n = ++id; idle.set(n, callback); return n; }, cancelIdleCallback: n => idle.delete(n) } : {}),
    YacRenderer: Renderer, YacWorkerRenderer: WorkerRenderer, YacFlashMonitor: class { reset() { stats.monitorResets++; } sample() { stats.monitorSamples++; return flash; } }
  });
  const folder = path.resolve(__dirname, '..');
  if (realFlashMonitor) {
    vm.runInContext(fs.readFileSync(path.join(folder, 'flash-monitor.js'), 'utf8'), context, { filename: 'flash-monitor.js' });
    const Monitor = context.YacFlashMonitor;
    context.YacFlashMonitor = class extends Monitor {
      reset() { stats.monitorResets++;super.reset(); }
      sample(...args) { stats.monitorSamples++;return super.sample(...args); }
    };
  }
  if (fs.existsSync(path.join(folder, 'settings-store.js'))) vm.runInContext(fs.readFileSync(path.join(folder, 'settings-store.js'), 'utf8'), context);
  let sharedStore, playbackStore;
  if (sharedSettings) {
    vm.runInContext(fs.readFileSync(path.join(folder, 'site-registry.js'), 'utf8'), context);
    sharedStore = new context.YacSettingsStore(storage, context.LiquidSites.identify('www.youtube.com').defaults,
      { scope: 'youtube', inheritLegacy: true, globalKeys: ['language'] });
    playbackStore = new context.YacSettingsStore(storage, context.LiquidSites.globalDefaults, { scope: 'global' });
    context.LiquidUI = { getStore: id => id === 'global' ? playbackStore : sharedStore, open: () => {} };
    if (quickPanelController) Object.assign(context.LiquidUI, quickPanelController);
  }
  vm.runInContext(fs.readFileSync(path.join(folder, 'lucide-icons.js'), 'utf8'), context, { filename: 'lucide-icons.js' });
  vm.runInContext(fs.readFileSync(path.join(folder, 'ambient.js'), 'utf8'), context, { filename: 'ambient.js' });
  nodes.find(node => node.id === 'yac-settings-button').rect = { left: 1090, top: 8, width: 40, height: 40 };
  const flushTasks = () => {
    flushMutations();
    for (let round = 0; round < 20; round++) {
      const due = [...timeouts].filter(([, task]) => task.due <= now);
      if (!due.length && !idle.size) break;
      for (const [n, task] of due) { timeouts.delete(n); task.callback(); }
      const jobs = [...idle.values()]; idle.clear(); jobs.forEach(callback => callback({ didTimeout: false, timeRemaining: () => 5 }));
      flushMutations();
    }
  };
  // Existing event() remains a direct dispatch. Explicit composed events model
  // the bubble path needed by ShadowRoot help without changing unrelated tests.
  const composedEvent = (target, type, values = {}) => {
    const route = [];for (let node = target; node; node = node.parentElement || node.host) route.push(node);
    if (!route.includes(document)) route.push(document, window);
    const event = new Event(type, { ...values, target, composedPath: () => route });
    for (const node of route) { node.dispatchEvent(event);if (event.cancelBubble) break; }
    return event;
  };
  // Native buttons synthesize click on Enter/Space. This deterministic harness
  // models that default action; actual key handling/layout still needs a browser.
  const pressButton = (button, key) => {
    const down = composedEvent(button, 'keydown', { key });
    if (key === 'Enter' && !down.defaultPrevented) composedEvent(button, 'click');
    const up = composedEvent(button, 'keyup', { key });
    if (key === ' ' && !down.defaultPrevented && !up.defaultPrevented) composedEvent(button, 'click');
  };
  return { document, window, video, player, watch, below, comments, app, masthead, headerButtons, create, notification, renders, inspections, nodes, raf, intervals, storageListeners, stats, apiCalls, idle, timeouts, observers, videoFrames, warnings, rectReadsByNode, computedStyleReadsByNode, composedEvent, pressButton, sharedStore, playbackStore,
    get worker() { return worker; },
    get renderer() { return renderer; },
    failWorker: reason => { assert.ok(worker, 'failure injection requires a Worker controller');worker.fail(reason); },
    load: async saved => { assert.ok(storageResolvers.length, 'controller starts storage load');for (const resolve of storageResolvers.splice(0)) resolve({ ambient: saved }); for (let i = 0; i < 8; i++) await Promise.resolve(); flushWorkers(); flushTasks(); },
    tick: ({ delta = 100, mediaAdvance = delta / 1000, flush = true } = {}) => { if (flush) flushWorkers(); now += delta; if (!video.paused) video.currentTime += mediaAdvance; const callbacks = [...raf.values()]; raf.clear(); callbacks.forEach(f => f(now)); if (flush) flushWorkers(); flushTasks(); },
    presentVideoFrame: () => { const callbacks = [...videoFrames.values()]; videoFrames.clear(); presentedFrames++; callbacks.forEach(callback => callback(now, { mediaTime: video.currentTime, presentedFrames, expectedDisplayTime: now })); },
    flushWorkers, flushTasks, flushMutations,
    advance: delta => { now += delta; flushTasks(); },
    discover: () => { for (const callback of intervals.values()) callback(); flushTasks(); },
    resize: (target = player) => { for (const observer of resizeObservers) if (observer.target === target) observer.callback(); flushTasks(); },
    setViewport: (width, height) => { context.innerWidth = width;context.innerHeight = height; },
    setPath: pathname => { context.location.pathname = pathname; },
    setSearch: search => { context.location.search = search;context.location.href = 'https://www.youtube.com' + context.location.pathname + search; },
    event: (target, type, values = {}) => target.dispatchEvent(new Event(type, values)),
    flash: value => { flash = value; },
    pixelLevel: value => pixels.fill(value),
    get: id => nodes.find(node => node.id === id),
    enabled: () => nodes.find(node => node.localName === 'input' && node.getAttribute('aria-label') === 'アンビエント背景')
  };
}

async function checkPanelRetryFocus(workerMode) {
  for (const state of ['visible field', 'settings list', 'other category', 'repeated failure', 'closed while pending']) {
    let outcome = 'failure', finishWrite = null, writes = 0;
    const h = harness(workerMode, { storageSet: () => {
      writes++;
      if (outcome === 'failure') return Promise.reject(new Error('Expected fixture persistence failure'));
      if (outcome === 'pending') return new Promise(resolve => { finishWrite = resolve; });
      return Promise.resolve();
    } });
    const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve();h.flushTasks(); };
    await h.load({ enabled: false, flashWarning: false });
    h.get('yac-settings-button').click();h.get('yac-menu-appearance').click();
    const panel = h.get('yac-controls'), notice = panel.shadowRoot.querySelector('.save-error');
    const retry = notice.querySelector('button'), strength = h.get('yac-strength');
    strength.focus();strength.value = 55;h.event(strength, 'input');h.event(strength, 'change');await settle();
    assert.equal(notice.hidden, false, state + ': failed setting save is visible');
    assert.equal(writes, 1);assert.ok(h.warnings.length > 0, 'simulated storage failure is reported');
    let expectedFocus = strength;
    if (state === 'settings list' || state === 'other category') {
      h.composedEvent(panel, 'keydown', { key: 'Escape' });expectedFocus = h.get('yac-menu-appearance');
      if (state === 'other category') { h.get('yac-menu-surfaces').click();expectedFocus = h.get('yac-settings-back'); }
      assert.equal(h.get('yac-page-appearance').hidden, true, state + ': original field is now hidden');
    }
    retry.focus();assert.equal(panel.shadowRoot.activeElement, retry, state + ': retry owns shadow focus');
    outcome = state === 'repeated failure' ? 'failure' : state === 'closed while pending' ? 'pending' : 'success';
    retry.click();await settle();
    if (state === 'repeated failure') {
      assert.equal(notice.hidden, false, 'repeat failure leaves the persistence error visible');
      assert.equal(h.document.activeElement, retry, 'repeat failure preserves retry focus');
      assert.equal(retry.getAttribute('aria-disabled'), null, 'repeat failure enables another retry');
    } else {
      if (state === 'closed while pending') {
        assert.equal(retry.getAttribute('aria-disabled'), 'true', 'pending retry announces its busy state');
        retry.click();await settle();assert.equal(writes, 2, 'pending retry cannot duplicate the write');
        h.get('yac-settings-close').click();expectedFocus = h.get('yac-settings-button');
        assert.equal(h.document.activeElement, expectedFocus, 'closing while pending returns focus to the gear');
        finishWrite();await settle();
        assert.equal(panel.hidden, true, 'late persistence success does not reopen settings');
      }
      assert.equal(notice.hidden, true, state + ': successful retry clears the persistence error');
      assert.equal(h.document.activeElement?.id || h.document.activeElement?.localName, expectedFocus.id, state + ': successful retry retains usable focus');
      assert.equal(retry.getAttribute('aria-disabled'), null, state + ': retry busy state is cleared');
    }
    assert.equal(Number(strength.value), 55, state + ': persistence recovery preserves the chosen value');
    h.event(h.document, 'yac-dispose');
  }
  console.log(`PASS (${workerMode ? 'worker callback' : 'main'}): setting retry focus after success, repeated failure, category changes and closure during an asynchronous write`);
}

async function checkHelpLifecycle(workerMode) {
  const h = harness(workerMode);await h.load({ enabled: false, flashWarning: false });
  const panel = h.get('yac-controls'), root = panel.shadowRoot, body = root.querySelector('.body');
  h.get('yac-settings-button').click();h.get('yac-menu-surfaces').click();
  panel.rect = { left: 884, top: 60, width: 380, height: 360 };
  body.rect = { left: 884, top: 120, width: 380, height: 300 };
  const entry = key => {
    const row = h.get('yac-' + key).closest('.setting-row'), trigger = row.querySelector('.info');
    const popover = h.get('yac-' + key + '-help'), hint = h.get('yac-' + key + '-hint');
    trigger.rect = { left: 1180, top: 220, width: 28, height: 28 };popover.rect = { left: 0, top: 0, width: 300, height: 96 };
    assert.equal(popover.parentElement, root);assert.equal(popover.getAttribute('role'), 'dialog');
    assert.equal(hint.parentElement, popover);assert.equal(root.contains(hint), true, 'description IDs remain in the control root');
    assert.equal(row.contains(popover), false);assert.equal(body.contains(popover), false);
    return { row, trigger, popover, hint };
  };
  const first = entry('surfaceMultiplier'), second = entry('controlDensity');
  const open = item => { h.composedEvent(item.trigger, 'click');assert.equal(item.hint.hidden, false);assert.equal(item.popover.hidden, false); };
  const closed = item => { assert.equal(item.hint.hidden, true);assert.equal(item.popover.hidden, true);assert.equal(item.trigger.getAttribute('aria-expanded'), 'false'); };
  const expectWithinViewport = (item, width, height) => {
    const left = panel.rect.left + parseFloat(item.popover.style.left), top = panel.rect.top + parseFloat(item.popover.style.top);
    const popupWidth = parseFloat(item.popover.style.width), maxHeight = parseFloat(item.popover.style.maxHeight);
    assert.ok(Number.isFinite(left) && Number.isFinite(top), 'floating help has an explicit position');
    assert.ok(popupWidth > 0 && popupWidth <= 300, 'help width is bounded independently of the settings row');
    assert.ok(left >= 8 && left + popupWidth <= width - 8, 'help stays inside horizontal viewport margins');
    assert.ok(top >= 8 && top + Math.min(item.popover.rect.height, maxHeight) <= height - 8, 'help stays inside vertical viewport margins');
    assert.ok(maxHeight > 0 && maxHeight <= height - 16, 'long help is independently scrollable within the viewport');
  };
  open(first);expectWithinViewport(first, 1280, 720);
  open(second);closed(first);
  assert.equal(root.querySelectorAll('.help-popover').filter(node => !node.hidden).length, 1, 'opening another explanation leaves exactly one dialog');
  const closeHelp = second.popover.querySelector('button');assert.ok(closeHelp, 'help has an explicit close button');
  h.composedEvent(closeHelp, 'click');closed(second);
  assert.equal(panel.hidden, false);assert.equal(h.get('yac-page-surfaces').hidden, false);
  open(first);h.composedEvent(h.notification, 'click');closed(first);
  assert.equal(panel.hidden, false, 'the first outside click dismisses only help');
  h.composedEvent(h.notification, 'click');assert.equal(panel.hidden, true, 'a subsequent outside click dismisses settings');
  h.get('yac-settings-button').click();h.get('yac-menu-surfaces').click();
  open(first);
  const density = h.get('yac-readingDensity'), controlClick = h.composedEvent(density, 'click');
  closed(first);assert.equal(panel.hidden, false);assert.equal(controlClick.defaultPrevented, undefined, 'help dismissal does not cancel a normal setting action');
  density.value = 63;h.event(density, 'input');assert.equal(Number(density.value), 63, 'the clicked setting still applies its input');
  open(first);h.event(body, 'scroll');closed(first);
  assert.equal(panel.hidden, false, 'body scroll dismisses detached help without closing settings');
  open(first);const beforeResize = [first.popover.style.left, first.popover.style.top];
  h.setViewport(360, 240);panel.rect = { left: 8, top: 60, width: 344, height: 172 };
  body.rect = { left: 8, top: 120, width: 344, height: 112 };
  first.trigger.rect = { left: 308, top: 194, width: 28, height: 28 };
  h.event(h.window, 'resize');
  assert.equal(first.popover.hidden, false, 'resize keeps explicit help open');
  assert.notDeepEqual([first.popover.style.left, first.popover.style.top], beforeResize, 'resize repositions help at its new button location');
  expectWithinViewport(first, 360, 240);
  h.get('yac-settings-back').click();closed(first);assert.equal(h.get('yac-settings-menu').hidden, false, 'back navigation resets help');
  h.get('yac-menu-surfaces').click();open(first);h.get('yac-menu-appearance').click();closed(first);
  assert.equal(h.get('yac-page-appearance').hidden, false, 'changing pages resets help');
  h.get('yac-menu-surfaces').click();open(first);h.get('yac-settings-close').click();closed(first);
  h.get('yac-settings-button').click();assert.equal(root.querySelectorAll('.help-popover').filter(node => !node.hidden).length, 0, 'reopening does not restore stale help');
  h.get('yac-menu-surfaces').click();open(first);
  h.document.fullscreenElement = h.player;h.event(h.document, 'fullscreenchange');closed(first);
  assert.equal(panel.hidden, true, 'fullscreen resets both help and settings');
  h.document.fullscreenElement = null;h.event(h.document, 'fullscreenchange');
  h.get('yac-settings-button').click();h.get('yac-menu-surfaces').click();open(first);
  h.event(h.document, 'yac-dispose');
  assert.equal(first.popover.isConnected, false);assert.equal(first.hint.isConnected, false, 'dispose removes the floating description root');
  for (const target of [root, body, first.trigger, first.popover, closeHelp]) {
    assert.ok([...target.listeners.values()].every(list => list.length === 0), 'dispose removes help and root listeners');
  }
  const afterDispose = { ...h.stats }, hiddenAfterDispose = first.hint.hidden;
  h.composedEvent(first.trigger, 'click');h.composedEvent(first.hint, 'keydown', { key: 'Escape' });h.event(body, 'scroll');h.event(h.window, 'resize');
  assert.deepEqual(h.stats, afterDispose, 'retired help controls cannot measure or render after disposal');
  assert.equal(first.hint.hidden, hiddenAfterDispose);assert.equal(h.raf.size, 0);assert.equal(h.intervals.size, 0);
  assert.equal(h.renders.length, 0);assert.equal(h.inspections.length, 0, 'help lifecycle never starts a video job when background and monitoring are OFF');
  console.log(`PASS (${workerMode ? 'worker callback' : 'main'}): click-only floating help, single dialog, viewport placement, dismissal, navigation and disposal`);
}

async function checkHelpScrollFocus(workerMode) {
  for (const scenario of ['visible opener', 'scrolled opener', 'home opener', 'hidden opener', 'other input', 'outside button', 'settings closed', 'fullscreen', 'hidden document', 'disposed']) {
    const h = harness(workerMode);await h.load({ enabled: false, flashWarning: false });
    const panel = h.get('yac-controls'), root = panel.shadowRoot, body = root.querySelector('.body');
    h.get('yac-settings-button').click();
    if (scenario !== 'home opener') h.get('yac-menu-surfaces').click();
    body.rect = { left: 184, top: 120, width: 378, height: 350 };
    const key = scenario === 'home opener' ? 'enabled' : 'surfaceMultiplier';
    const opener = h.get('yac-' + key).closest('.setting-row').querySelector('.info');
    opener.rect = { left: 276, top: 136, width: 28, height: 28 };
    const popup = h.get('yac-' + key + '-help');
    const recoveryTargets = [opener, h.get('yac-settings-back'), h.get('yac-settings-close')];
    const recoveryCalls = [];
    for (const target of recoveryTargets) {
      const focus = target.focus.bind(target);
      target.focus = options => { recoveryCalls.push({ target, options });focus(options); };
    }
    h.composedEvent(opener, 'click');
    assert.equal(root.activeElement, popup.querySelector('button'), scenario + ': explanation starts with usable focus');
    const expectedFallback = h.get(scenario === 'home opener' ? 'yac-settings-close' : 'yac-settings-back');
    const outside = h.document.createElement('button');h.document.body.append(outside);
    const density = h.get('yac-readingDensity');
    if (scenario === 'scrolled opener' || scenario === 'home opener') opener.rect.top = 80;
    if (scenario === 'hidden opener') opener.hidden = true;
    if (scenario === 'other input') density.focus();
    if (scenario === 'outside button') outside.focus();
    const beforeWork = { ...h.stats }, videoReads = h.rectReadsByNode.get(h.video) || 0, playerReads = h.rectReadsByNode.get(h.player) || 0;
    if (scenario === 'settings closed') h.get('yac-settings-close').click();
    else if (scenario === 'fullscreen') { h.document.fullscreenElement = h.player;h.event(h.document, 'fullscreenchange'); }
    else if (scenario === 'disposed') h.event(h.document, 'yac-dispose');
    else if (scenario === 'outside button') h.composedEvent(outside, 'click');
    else { if (scenario === 'hidden document') h.document.hidden = true;h.event(body, 'scroll'); }
    if (scenario === 'visible opener') {
      assert.equal(root.activeElement, opener, 'scroll keeps focus on an opener that remains visible');
      assert.equal(recoveryCalls.length, 1);assert.equal(recoveryCalls[0].target, opener);assert.equal(recoveryCalls[0].options.preventScroll, true);
    } else if (['scrolled opener', 'home opener', 'hidden opener'].includes(scenario)) {
      assert.equal(root.activeElement, expectedFallback, scenario + ': recovery lands in the fixed header');
      assert.ok(recoveryCalls.every(call => call.options.preventScroll), 'focus recovery never asks to move the scrolling body');
      h.composedEvent(expectedFallback, 'keydown', { key: 'Escape' });
      if (scenario === 'home opener') assert.equal(panel.hidden, true, 'Escape closes settings after home-scroll recovery');
      else assert.equal(h.get('yac-settings-menu').hidden, false, 'Escape returns to the menu after detail-scroll recovery');
    } else {
      assert.equal(recoveryCalls.length, 0, scenario + ': dismissal does not restore explanation focus');
      if (scenario === 'other input') assert.equal(root.activeElement, density, 'scroll preserves focus that moved to another input');
      if (scenario === 'outside button') assert.equal(h.document.activeElement, outside, 'outside clicks keep focus on their own target');
      if (scenario === 'settings closed') assert.equal(h.document.activeElement, h.get('yac-settings-button'), 'closing settings keeps its normal launcher focus');
      if (scenario === 'fullscreen' || scenario === 'hidden document') assert.equal(h.document.activeElement, h.document.body, scenario + ': hidden settings do not take focus');
      if (scenario === 'other input' || scenario === 'outside button' || scenario === 'hidden document') assert.equal(h.stats.rectReads, beforeWork.rectReads, scenario + ': no recovery geometry is read');
    }
    if (scenario !== 'disposed') {
      assert.equal(popup.hidden, true, scenario + ': the explanation is dismissed');
      assert.equal(h.rectReadsByNode.get(h.video) || 0, videoReads, 'help recovery never measures the video');
      if (scenario !== 'fullscreen') assert.equal(h.rectReadsByNode.get(h.player) || 0, playerReads, 'help recovery never measures the player');
      h.event(h.document, 'yac-dispose');
    } else {
      const disposedWork = { ...h.stats };
      h.event(body, 'scroll');h.composedEvent(opener, 'click');
      assert.deepEqual(h.stats, disposedWork, 'disposed help cannot measure or restore focus');
      assert.equal(recoveryCalls.length, 0);
    }
    assert.equal(h.renders.length, 0);assert.equal(h.inspections.length, 0);
  }
  console.log(`PASS (${workerMode ? 'worker callback' : 'main'}): explanation-scroll focus, visible/header recovery, Escape, outside input and closed/hidden/fullscreen/disposed guards`);
}

async function checkEffectiveIntegerSettings(workerMode) {
  for (const language of ['ja', 'en']) for (const surfaceMultiplier of [0, .0049, .005, .01, .49, .5, 1, .485946, .505]) {
    const writes = [], persisted = {};
    const saved = Object.freeze({ enabled: true, flashWarning: false, avoidBars: false, fillBars: false, language,
      surfaceMultiplier, controlDensity: 34.069, readingDensity: 87.8229748603352, navigationDensity: .125,
      strength: 51.4, blur: 90.4, saturation: 145.5, inset: 3.6, fps: 30 });
    const h = harness(workerMode, { storageSet: async values => { writes.push({ ...values });Object.assign(persisted, values); } });
    await h.load(saved);
    assert.deepEqual(writes, [], 'using integer effective values does not rewrite the raw stored profile');
    const effective = { ...saved, surfaceMultiplier: Math.round(surfaceMultiplier * 100) / 100,
      controlDensity: 34, readingDensity: 88, navigationDensity: 0, strength: 51, blur: 90, saturation: 146, inset: 4 };
    const masterHelp = h.get('yac-surfaceMultiplier-hint');
    const ordinaryHelp = masterHelp.textContent;
    assert.equal(/以前の細かな調整値|previously saved precise value/.test(ordinaryHelp), false, 'integer effective values do not need an old-precision notice');
    const master = h.get('yac-surfaceMultiplier');
    assert.equal(Number(master.min), 0);assert.equal(Number(master.max), 100);assert.equal(master.step, '1');
    assert.equal(Number(master.value), Math.round(surfaceMultiplier * 100));
    assert.equal(master.getAttribute('aria-valuetext'), Math.round(surfaceMultiplier * 100) + '%', 'master UI and effective ratio describe the same whole percent');
    const renderSettings = h.renders.at(-1)[4];
    assert.equal(renderSettings.surfaceMultiplier, effective.surfaceMultiplier, 'rendering uses the displayed integer-percent master');
    for (const key of ['controlDensity', 'readingDensity', 'navigationDensity']) {
      const field = h.get('yac-' + key), output = field.closest('.setting-row').querySelector('output');
      const primary = effective[key] + '%', appliedText = (language === 'ja' ? '適用' : 'Applied') + ' ' + Math.round(effective[key] * effective.surfaceMultiplier) + '%';
      assert.equal(output.textContent, primary, language + ': primary density label is an integer');
      assert.equal(output.children.at(-1).textContent, appliedText, language + ': applied density label uses the same precision');
      assert.equal(field.getAttribute('aria-valuetext'), primary + ' · ' + appliedText, 'announced and visible labels agree');
      assert.equal(Number(field.value), effective[key], 'the slider and effective category are the same integer');
      assert.equal(field.step, '1', 'category sliders use one-percent steps');
      assert.equal(renderSettings[key], effective[key], 'rendering uses the displayed integer category');
      assert.equal(/以前の細かな調整値|previously saved precise value/.test(h.get('yac-' + key + '-hint').textContent), false);
    }
    for (const key of ['strength', 'blur', 'saturation', 'inset', 'fps']) {
      const field = h.get('yac-' + key), value = Math.round(saved[key]) + (key === 'blur' ? ' px' : key === 'fps' ? ' FPS' : '%');
      assert.equal(Number(field.value), Math.round(saved[key]));assert.equal(field.step, '1');
      assert.equal(field.closest('.setting-row').querySelector('output').textContent, value);
      assert.equal(field.getAttribute('aria-valuetext'), value, key + ': all numeric slider labels and ARIA are integers');
      assert.equal(renderSettings[key], effective[key], key + ': rendering and slider use the same integer unit');
    }
    const palette = h.get('yac-surface-palette').textContent;
    const readingAlpha = Number(/--yac-reading-opacity:([\d.]+)/.exec(palette)[1]);
    assert.equal(readingAlpha, Number((.74 * effective.surfaceMultiplier * 88 / 100).toFixed(6)), 'palette multiplication uses the same effective values as the UI');
    h.get('yac-readingDensity').value = 89;h.event(h.get('yac-readingDensity'), 'input');
    h.event(h.get('yac-readingDensity'), 'change');
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.deepEqual(writes, [{ 'liquid-ui:site:youtube:readingDensity': 89 }], 'editing one category saves only that integer-percent key');
    assert.equal(masterHelp.textContent, ordinaryHelp, 'integer category edits do not rewrite the master explanation');
    const expected = { ...effective, readingDensity: 89 };
    if (surfaceMultiplier !== effective.surfaceMultiplier) {
      master.value = 50;h.event(master, 'input');h.event(master, 'change');
      for (let i = 0; i < 20; i++) await Promise.resolve();
      assert.equal(masterHelp.textContent, ordinaryHelp, 'integer-percent master edits keep the ordinary explanation');
      assert.equal(Number(master.value), 50);assert.equal(master.getAttribute('aria-valuetext'), '50%');
      assert.deepEqual(writes.at(-1), { 'liquid-ui:site:youtube:surfaceMultiplier': .5 }, 'UI percent is persisted in the existing zero-to-one schema');
      expected.surfaceMultiplier = .5;
    }
    for (const key of ['controlDensity', 'navigationDensity']) assert.equal(persisted['liquid-ui:site:youtube:' + key], undefined, 'other raw category keys are not rewritten');
    const reloadedWrites = [], reload = harness(workerMode, { storageSet: async values => reloadedWrites.push(values) });
    const restored = { ...saved };for (const [key, value] of Object.entries(persisted)) restored[key.slice('liquid-ui:site:youtube:'.length)] = value;
    await reload.load(restored);
    assert.deepEqual(reloadedWrites, [], 'reload applies integer values without rewriting the untouched raw profile');
    for (const [key, value] of Object.entries(expected)) assert.equal(reload.renders.at(-1)[4][key], value, key + ': edited keys and passive integer effective values survive reload');
    assert.equal(Number(/--yac-reading-opacity:([\d.]+)/.exec(reload.get('yac-surface-palette').textContent)[1]), Number((.74 * expected.surfaceMultiplier * 89 / 100).toFixed(6)), 'reloaded multiplication agrees with the effective integer UI');
    reload.event(reload.document, 'yac-dispose');
    h.event(h.document, 'yac-dispose');
  }
  console.log(`PASS (${workerMode ? 'worker callback' : 'main'}): integer-effective settings/ARIA/paint, raw-load no-write, one-key edits and saved reload`);
}

async function checkIntegerSliderBoundaries(workerMode) {
  const ranges = { surfaceMultiplier: [0, 100], controlDensity: [0, 100], readingDensity: [0, 100], navigationDensity: [0, 100],
    strength: [15, 100], blur: [0, 160], saturation: [0, 250], inset: [0, 40], fps: [24, 60] };
  for (const language of ['ja', 'en']) {
    const writes = [], h = harness(workerMode, { storageSet: async values => writes.push({ ...values }) });
    await h.load({ enabled: false, flashWarning: false, language, controlDensity: 100 });
    const palette = h.get('yac-surface-palette');
    for (const [key, [min, max]] of Object.entries(ranges)) {
      const field = h.get('yac-' + key), output = field.closest('.setting-row').querySelector('output');
      assert.equal(Number(field.min), min);assert.equal(Number(field.max), max);assert.equal(field.step, '1');
      let text = output.textContent, outputWrites = 0;
      Object.defineProperty(output, 'textContent', { get: () => text, set: value => { text = value;outputWrites++; } });
      const values = key === 'surfaceMultiplier' ? [0, 1, 2, 3, 4, 49, 50, 99, 100] : [min, min + 1, max - 1, max];
      for (const value of values) {
        field.value = value;h.event(field, 'input');
        assert.equal(Number(field.value), value, key + ': the next integer unit is reachable');
        const primary = value + (key === 'blur' ? ' px' : key === 'fps' ? ' FPS' : '%');
        assert.equal(output.textContent, primary);assert.equal(field.getAttribute('aria-valuetext').split(' · ')[0], primary);
        if (key === 'surfaceMultiplier') {
          const controlAlpha = Number(/--yac-control-opacity:([\d.]+)/.exec(palette.textContent)[1]);
          assert.equal(controlAlpha, Number((.22 * value / 100).toFixed(6)), 'each of 1%, 2%, 3%, 4% changes the multiplier in its existing schema');
        }
        const work = { stats: { ...h.stats }, palette: palette.textContent, outputs: outputWrites, renders: h.renders.length, samples: h.inspections.length };
        for (let repeat = 0; repeat < 3; repeat++) { field.value = value;h.event(field, 'input'); }
        assert.deepEqual(h.stats, work.stats, key + ': repeated integer input adds no geometry, surface, monitor or renderer work');
        assert.equal(outputWrites, work.outputs, key + ': repeated integer input does not rewrite its output');
        assert.equal(palette.textContent, work.palette);assert.equal(h.renders.length, work.renders);assert.equal(h.inspections.length, work.samples);
        const count = writes.length;h.event(field, 'change');for (let i = 0; i < 20; i++) await Promise.resolve();
        assert.equal(writes.length, count + 1, key + ': an explicit change still persists its current value');
        assert.deepEqual(writes.at(-1), { ['liquid-ui:site:youtube:' + key]: value / (key === 'surfaceMultiplier' ? 100 : 1) }, key + ': stores exactly one key in its original units');
      }
    }
    h.event(h.document, 'yac-dispose');
  }
  console.log(`PASS (${workerMode ? 'worker callback' : 'main'}): all integer slider boundaries, genuine one-percent master increments, duplicate-input no-work and one-key saves`);
}

async function checkLegacyIntegerDisplay(workerMode) {
  for (const language of ['ja', 'en']) {
    const writes = [], legacy = { enabled: true, flashWarning: false, avoidBars: false, fillBars: false, language,
      surfaceDensity: 40.25, controlDensityOffset: 30, readingDensityOffset: -30, navigationDensityOffset: 0 };
    const h = harness(workerMode, { storageSet: async values => writes.push({ ...values }) });await h.load(legacy);
    assert.deepEqual(writes, [], 'legacy conversion remains read-only');
    const rendered = h.renders.at(-1)[4];
    assert.equal(rendered.surfaceMultiplier, .52);assert.equal(rendered.controlDensity, 100);assert.equal(rendered.readingDensity, 54);assert.equal(rendered.navigationDensity, 77);
    assert.equal(h.get('yac-surfaceMultiplier').getAttribute('aria-valuetext'), '52%');
    assert.equal(Number(h.get('yac-readingDensity').value), 54);assert.equal(Number(h.get('yac-navigationDensity').value), 77);
    assert.equal(Number(/--yac-reading-opacity:([\d.]+)/.exec(h.get('yac-surface-palette').textContent)[1]), .207792, 'legacy reading paint uses the effective 52% master and 54% category');
    h.get('yac-navigationDensity').value = 78;h.event(h.get('yac-navigationDensity'), 'input');h.event(h.get('yac-navigationDensity'), 'change');
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.deepEqual(writes, [{ 'liquid-ui:site:youtube:navigationDensity': 78 }], 'a legacy profile edit stores just its explicit integer key');
    assert.equal(Number(/--yac-reading-opacity:([\d.]+)/.exec(h.get('yac-surface-palette').textContent)[1]), .207792, 'editing another legacy category preserves its integer reading paint');
    h.event(h.document, 'yac-dispose');
  }
  console.log(`PASS (${workerMode ? 'worker callback' : 'main'}): legacy migration applies integer paint without rewriting raw values, then saves one edited category`);
}

async function checkIntegerZeroState(workerMode) {
  const cases = [
    { master: .0049, category: 100, masterUI: 0, categoryUI: 100, applied: 0, transparent: true },
    { master: 1, category: .125, masterUI: 100, categoryUI: 0, applied: 0, transparent: true },
    { master: .005, category: 100, masterUI: 1, categoryUI: 100, applied: 1, transparent: false },
    { master: 1, category: .5, masterUI: 100, categoryUI: 1, applied: 1, transparent: false }
  ];
  const assertZeroPalette = h => {
    let checked = 0;
    for (const [, key, raw] of h.get('yac-surface-palette').textContent.matchAll(/(--yac-[\w-]+):([\d.]+)(?:px)?/g)) {
      if (/(?:opacity|blur|feedback|level)$/.test(key)) { assert.equal(Number(raw), 0, key + ': displayed zero has no residual shade, shadow or blur');checked++; }
      else if (/(?:brightness|contrast)$/.test(key)) assert.equal(Number(raw), 1, key + ': displayed zero leaves native color filters neutral');
    }
    assert.ok(checked >= 18, 'zero verification covers the actual shared and settings palette');
  };
  const assertUI = (h, state, language) => {
    const master = h.get('yac-surfaceMultiplier');
    assert.equal(Number(master.value), state.masterUI);assert.equal(master.getAttribute('aria-valuetext'), state.masterUI + '%');
    for (const key of ['controlDensity', 'readingDensity', 'navigationDensity']) {
      const field = h.get('yac-' + key), output = field.closest('.setting-row').querySelector('output');
      const applied = (language === 'ja' ? '適用' : 'Applied') + ' ' + state.applied + '%';
      assert.equal(Number(field.value), state.categoryUI);assert.equal(output.textContent, state.categoryUI + '%');
      assert.equal(output.children.at(-1).textContent, applied);assert.equal(field.getAttribute('aria-valuetext'), state.categoryUI + '% · ' + applied);
    }
    if (state.transparent) assertZeroPalette(h);
    else assert.ok(Number(/--yac-control-opacity:([\d.]+)/.exec(h.get('yac-surface-palette').textContent)[1]) > 0, 'the next actual one-percent value paints a nonzero shade');
  };
  for (const language of ['ja', 'en']) for (const state of cases) {
    const writes = [], saved = Object.freeze({ enabled: true, flashWarning: false, avoidBars: false, fillBars: false, language,
      surfaceMultiplier: state.master, controlDensity: state.category, readingDensity: state.category, navigationDensity: state.category });
    const h = harness(workerMode, { storageSet: async values => writes.push(values) });await h.load(saved);
    h.get('yac-settings-button').click();h.get('yac-menu-surfaces').click();
    // No input is dispatched: Home on an already-zero native range can have no
    // input event. The effective paint must therefore be zero before editing.
    assertUI(h, state, language);assert.deepEqual(writes, [], 'passive quantization leaves the raw fine storage untouched');
    h.event(h.document, 'yac-dispose');
  }
  for (const language of ['ja', 'en']) {
    const writes = [], h = harness(workerMode, { storageSet: async values => writes.push(values) });
    await h.load({ enabled: true, flashWarning: false, language });
    for (const state of cases.slice(0, 2)) {
      const changes = { 'liquid-ui:site:youtube:surfaceMultiplier': { newValue: state.master } };
      for (const key of ['controlDensity', 'readingDensity', 'navigationDensity']) changes['liquid-ui:site:youtube:' + key] = { newValue: state.category };
      for (const listener of h.storageListeners) listener(changes, 'local');
      assertUI(h, state, language);assert.deepEqual(writes, [], 'another tab\'s fine values apply as integers without writeback');
      assert.equal(changes['liquid-ui:site:youtube:surfaceMultiplier'].newValue, state.master, 'received raw data is not modified');
    }
    h.event(h.document, 'yac-dispose');
  }
  console.log(`PASS (${workerMode ? 'worker callback' : 'main'}): raw fine load/consume at zero matches UI and fully transparent palette before any input, with true one-percent thresholds`);
}

async function checkWorkerCompatibilityNotice() {
  const notices = { ja: 'このページでは互換描画を使用しています。', en: 'Compatibility rendering is in use on this page.' };
  const failedStatus = { ja: 'この動画では背景を描画できません。', en: 'Unable to render a background for this video.' };
  const reason = 'Ambient worker startup timed out';
  for (const language of ['ja', 'en']) {
    const writes = [];let phase = 'reject';
    const h = harness(true, { storageSet: async values => writes.push({ ...values }), mainDraw: source => {
      if (phase === 'reject') source.seeking = true;
      if (phase === 'throw') throw new Error('Expected main renderer draw failure');
    } });
    const canvas = h.get('yac-background'), help = h.get('yac-fps-hint');
    const status = h.get('yac-controls').shadowRoot.querySelector('.status-message');
    assert.ok(canvas, 'controller exposes its ambient canvas');
    assert.equal(help.textContent.includes(notices[language]), false, 'healthy Worker has no compatibility explanation');
    const oldWorker = h.worker;
    h.failWorker(reason);
    assert.equal(oldWorker.disposed, true, 'startup failure disposes the Worker renderer');
    assert.notEqual(h.renderer, oldWorker, 'startup failure installs a main renderer');
    assert.equal(canvas.dataset.renderMode, 'main');
    assert.equal(canvas.dataset.workerFallbackReason, reason, 'the diagnostic reason survives the handled failure');
    assert.equal(canvas.dataset.workerFallbackState, 'pending', 'switching renderer does not imply successful painting');
    assert.deepEqual(h.warnings, [], 'handled fallback does not create an extension warning');
    assert.equal(help.textContent.includes(notices[language]), false, 'no successful explanation before the first accepted paint');
    await h.load({ enabled: false, flashWarning: true, language });
    assert.equal(canvas.dataset.workerFallbackState, 'pending', 'loading monitoring-only preferences does not claim successful painting');
    assert.equal(help.textContent.includes(notices[language]), false);
    const samples = h.inspections.length;
    h.tick();
    assert.ok(h.inspections.length > samples, 'main renderer still performs warning-only inspection');
    assert.equal(canvas.dataset.workerFallbackState, 'pending', 'accepted sample-only work does not establish painted recovery');
    assert.equal(help.textContent.includes(notices[language]), false, 'warning-only work has no successful painting explanation');
    h.get('yac-enabled').checked = true;h.event(h.get('yac-enabled'), 'input');
    assert.ok(h.renders.length > 0 && h.video.seeking, 'test injects rejection after a main paint attempt');
    assert.equal(canvas.dataset.workerFallbackState, 'pending', 'a rejected nonsample frame does not establish recovery');
    assert.equal(help.textContent.includes(notices[language]), false, 'a rejected frame has no successful painting explanation');
    h.video.seeking = false;phase = 'throw';h.tick();
    assert.equal(status.textContent, failedStatus[language], 'actual main draw failure retains the failure status');
    assert.equal(canvas.dataset.workerFallbackState, 'failed', 'draw failure is preserved in the compatibility diagnostic');
    assert.equal(help.textContent.includes(notices[language]), false);
    phase = 'paint';h.tick();
    assert.equal(canvas.dataset.workerFallbackState, 'active', 'the first valid painted frame confirms compatibility rendering');
    assert.equal(canvas.dataset.workerFallbackReason, reason, 'successful recovery retains the diagnostic reason');
    assert.equal(help.textContent.includes(notices[language]), true, language + ': accepted paint adds the localized explanation');
    assert.equal(help.textContent.split(notices[language]).length - 1, 1, 'success explanation is not duplicated on repeated frames');
    assert.notEqual(status.textContent, failedStatus[language], 'successful paint restores the ordinary background status');
    const nextLanguage = language === 'ja' ? 'en' : 'ja';
    const languageField = h.get('yac-language');languageField.value = nextLanguage;
    const paintCount = h.renders.length;h.event(languageField, 'input');h.event(languageField, 'change');
    for (let i = 0; i < 20; i++) await Promise.resolve();h.flushTasks();
    assert.equal(h.renders.length, paintCount, 'localizing the explanation does not force background painting');
    assert.equal(help.textContent.includes(notices[nextLanguage]), true, 'language changes preserve the active compatibility explanation');
    assert.equal(help.textContent.includes(notices[language]), false, 'language changes replace the old notice');
    assert.deepEqual(writes, [{ 'liquid-ui:global:language': nextLanguage }], 'only the explicitly changed language is saved');
    h.tick();
    assert.equal(languageField.value, nextLanguage, 'subsequent painting keeps the selected language');
    assert.equal(help.textContent.split(notices[nextLanguage]).length - 1, 1);
    phase = 'throw';h.tick();
    assert.equal(status.textContent, failedStatus[nextLanguage], 'a later main draw failure remains visible after prior recovery');
    assert.equal(canvas.dataset.workerFallbackState, 'failed', 'a later failure replaces the previously active recovery state');
    assert.equal(help.textContent.includes(notices[nextLanguage]), false, 'a later failure removes the successful rendering explanation');
    assert.equal(canvas.dataset.workerFallbackReason, reason);
    assert.deepEqual(h.warnings, [], 'handled startup fallback does not log repeatedly after recovery or localization');
    h.event(h.document, 'yac-dispose');
  }
  for (const workerMode of [false, true]) {
    const h = harness(workerMode);await h.load({ enabled: true, flashWarning: false });
    assert.equal(h.get('yac-fps-hint').textContent.includes(notices.ja), false, 'ordinary main/Worker rendering does not claim a failure recovery');
    assert.equal(h.get('yac-background').dataset.workerFallbackReason, undefined);
    h.event(h.document, 'yac-dispose');
  }
  console.log('PASS: Worker startup fallback diagnostics, no warning, painted recovery versus sample/rejection/failure, localized persistent compatibility explanation');
}

async function checkActiveHelpReflow() {
  const notices = { ja: 'このページでは互換描画を使用しています。', en: 'Compatibility rendering is in use on this page.' };
  const prepare = (h, key, heightForText, scrollForText) => {
    const panel = h.get('yac-controls'), root = panel.shadowRoot, body = root.querySelector('.body');
    h.setViewport(640, 300);panel.rect = { left: 260, top: 60, width: 380, height: 230 };
    panel.style.setProperty('border-left-width', '.8px');panel.style.setProperty('border-top-width', '.8px');
    body.rect = { left: 260, top: 110, width: 380, height: 180 };
    const hint = h.get('yac-' + key + '-hint'), popover = h.get('yac-' + key + '-help');
    const trigger = h.get('yac-' + key).closest('.setting-row').querySelector('.info');
    trigger.rect = { left: 590, top: 248, width: 28, height: 28 };
    let text = hint.textContent, writes = 0, reads = 0;
    Object.defineProperty(hint, 'textContent', { get: () => text, set: value => { text = value;writes++; } });
    Object.defineProperty(hint, 'scrollHeight', { get: () => scrollForText(text) });
    Object.defineProperty(hint, 'clientHeight', { get: () => 64 });
    const measure = popover.getBoundingClientRect.bind(popover);
    // Model text wrapping at this viewport explicitly. Native layout and Tab's
    // default action are checked separately in the browser, not by this DOM.
    // CSS absolute offsets start at the parent's padding edge, which is inside
    // its fractional border; DOMRect starts at the outer border edge instead.
    const layout = () => {
      const left = panel.rect.left + parseFloat(panel.style.getPropertyValue('border-left-width')) + (parseFloat(popover.style.left) || 0);
      const top = panel.rect.top + parseFloat(panel.style.getPropertyValue('border-top-width')) + (parseFloat(popover.style.top) || 0);
      const width = parseFloat(popover.style.width) || 300;
      const height = Math.min(heightForText(text), parseFloat(popover.style.maxHeight) || Infinity);
      return { left, top, width, height, right: left + width, bottom: top + height };
    };
    popover.getBoundingClientRect = () => { reads++;return { ...measure(), ...layout() }; };
    const withinViewport = (width = 640, height = 300) => {
      const box = layout();
      assert.ok(box.left >= 8 && box.right <= width - 8, 'fractional-border help keeps the horizontal viewport margins');
      assert.ok(box.top >= 8 && box.bottom <= height - 8, 'fractional-border help keeps the vertical viewport margins');
    };
    return { panel, root, body, trigger, hint, popover, withinViewport, layout,
      get reads() { return reads; }, get writes() { return writes; },
      get styleReads() { return h.computedStyleReadsByNode.get(panel) || 0; } };
  };
  let failDrawing = false;
  const h = harness(true, { mainDraw: () => { if (failDrawing) throw new Error('Expected reflow fixture draw failure'); } });
  h.failWorker('Ambient worker startup timed out');await h.load({ enabled: false, flashWarning: false, language: 'en' });
  h.get('yac-settings-button').click();h.get('yac-menu-rendering').click();
  const hasNotice = text => Object.values(notices).some(notice => text.includes(notice));
  const fps = prepare(h, 'fps', text => text.includes(notices.en) ? 232.300003 : text.includes(notices.ja) ? 210.2 : 100,
    text => hasNotice(text) ? 94 : 50);
  const initialStyleReads = fps.styleReads;
  h.composedEvent(fps.trigger, 'click');fps.withinViewport();
  assert.equal(fps.styleReads, initialStyleReads + 1, 'an explicit help placement reads computed fractional borders once');
  const initialReads = fps.reads, initialTop = fps.popover.style.top;
  assert.equal(fps.hint.tabIndex, -1, 'short English FPS help is outside the sequential tab order');
  const closeHelp = fps.popover.querySelector('button');
  assert.equal(h.document.activeElement, closeHelp);
  h.get('yac-enabled').checked = true;h.event(h.get('yac-enabled'), 'input');
  assert.equal(h.get('yac-background').dataset.workerFallbackState, 'active');
  assert.equal(fps.reads, initialReads + 1, 'adding a note repositions only the changed open help once');
  assert.equal(fps.styleReads, initialStyleReads + 2, 'a changed open note reads panel borders once');
  assert.notEqual(fps.popover.style.top, initialTop);fps.withinViewport();
  assert.equal(fps.hint.tabIndex, 0, 'newly overflowing help becomes keyboard-focusable');
  assert.equal(h.document.activeElement, closeHelp, 'reflow preserves the current explanation focus');
  fps.hint.focus();assert.equal(h.document.activeElement, fps.hint, 'the scrollable explanation accepts keyboard focus');
  const activeWork = { reads: fps.reads, writes: fps.writes, styleReads: fps.styleReads };
  h.tick();h.tick();
  assert.deepEqual({ reads: fps.reads, writes: fps.writes, styleReads: fps.styleReads }, activeWork, 'later successful frames do not rewrite or remeasure unchanged help');
  const reading = h.get('yac-readingDensity');reading.value = 74;h.event(reading, 'input');
  assert.deepEqual({ reads: fps.reads, writes: fps.writes, styleReads: fps.styleReads }, activeWork, 'an unrelated setting with unchanged descriptions adds no help layout');
  for (const language of ['ja', 'en']) {
    const before = { reads: fps.reads, writes: fps.writes, styleReads: fps.styleReads, paints: h.renders.length };
    for (const listener of h.storageListeners) listener({ 'liquid-ui:global:language': { newValue: language } }, 'local');
    assert.equal(fps.hint.textContent.includes(notices[language]), true);
    assert.equal(fps.reads, before.reads + 1, 'an external language change reflows its changed open explanation once');
    assert.equal(fps.writes, before.writes + 1);assert.equal(h.renders.length, before.paints);
    assert.equal(fps.styleReads, before.styleReads + 1);
    fps.withinViewport();assert.equal(fps.hint.tabIndex, 0);assert.equal(h.document.activeElement, fps.hint);
  }
  const beforeFailure = { reads: fps.reads, writes: fps.writes, styleReads: fps.styleReads, top: fps.popover.style.top };
  failDrawing = true;h.tick();
  assert.equal(h.get('yac-background').dataset.workerFallbackState, 'failed');
  assert.equal(hasNotice(fps.hint.textContent), false);
  assert.equal(fps.reads, beforeFailure.reads + 1, 'removing a failed-recovery note reflows the open explanation once');
  assert.equal(fps.writes, beforeFailure.writes + 1);assert.notEqual(fps.popover.style.top, beforeFailure.top);
  assert.equal(fps.styleReads, beforeFailure.styleReads + 1);
  fps.withinViewport();assert.equal(fps.hint.tabIndex, -1, 'shortened text leaves the sequential tab order');
  assert.equal(h.document.activeElement, fps.hint, 'shortening the text does not remove existing focus');
  h.composedEvent(fps.hint, 'keydown', { key: 'Escape' });
  assert.equal(fps.popover.hidden, true);assert.equal(h.document.activeElement, fps.trigger);
  assert.equal(fps.panel.hidden, false);assert.equal(h.get('yac-page-rendering').hidden, false);
  const closedReads = fps.reads, closedStyleReads = fps.styleReads;failDrawing = false;h.tick();
  assert.equal(h.get('yac-background').dataset.workerFallbackState, 'active');
  assert.equal(fps.reads, closedReads, 'changing a closed help description adds no layout');
  assert.equal(fps.styleReads, closedStyleReads, 'changing a closed help description does not read its border style');
  const inset = prepare(h, 'inset', () => 100, () => 50);h.composedEvent(inset.trigger, 'click');
  const unrelatedWork = { fpsReads: fps.reads, insetReads: inset.reads, insetWrites: inset.writes, styleReads: inset.styleReads };
  failDrawing = true;h.tick();
  assert.deepEqual({ fpsReads: fps.reads, insetReads: inset.reads, insetWrites: inset.writes, styleReads: inset.styleReads }, unrelatedWork,
    'changing another description does not rewrite or reflow the currently open unrelated help');
  assert.equal(inset.popover.hidden, false);h.event(h.document, 'yac-dispose');
  for (const workerMode of [false, true]) for (const language of ['ja', 'en']) {
    const readingCase = harness(workerMode);await readingCase.load({ enabled: false, flashWarning: false, language });
    readingCase.get('yac-settings-button').click();readingCase.get('yac-menu-surfaces').click();
    const readingHelp = prepare(readingCase, 'readingDensity', text => text.startsWith('Adjusts backgrounds') ? 232.300003 : 210.2, () => 130);
    readingCase.composedEvent(readingHelp.trigger, 'click');readingHelp.withinViewport();assert.equal(readingHelp.hint.tabIndex, 0);
    assert.ok(readingHelp.hint.textContent.includes(language === 'ja' ? '有料メッセージ' : 'Paid messages'), 'the normal long reading explanation is used without artificial product text');
    // Transitional panel rectangles exercise each viewport clamp, including
    // a resize before the separate panel-placement callback has caught up.
    const boundaries = [
      { name: 'top', width: 640, panelLeft: 260, bodyTop: 0, triggerTop: 4, edge: 'top', expected: 8 },
      { name: 'left', width: 640, panelLeft: 320, bodyTop: 110, triggerTop: 248, edge: 'left', expected: 8 },
      { name: 'right', width: 600, panelLeft: 300, bodyTop: 110, triggerTop: 248, edge: 'right', expected: 592 },
      { name: 'bottom', width: 640, panelLeft: 260, bodyTop: 110, triggerTop: 248, edge: 'bottom', expected: 292 }
    ];
    for (const boundary of boundaries) {
      readingCase.composedEvent(readingHelp.trigger, 'click');readingCase.setViewport(boundary.width, 300);
      readingHelp.panel.rect.left = boundary.panelLeft;readingHelp.body.rect.left = boundary.panelLeft;readingHelp.body.rect.top = boundary.bodyTop;
      readingHelp.trigger.rect.top = boundary.triggerTop;
      const styleReads = readingHelp.styleReads;readingCase.composedEvent(readingHelp.trigger, 'click');
      readingHelp.withinViewport(boundary.width, 300);
      assert.equal(readingHelp.layout()[boundary.edge], boundary.expected, boundary.name + ' boundary uses the fractional padding-edge origin');
      assert.equal(readingHelp.styleReads, styleReads + 1, 'each bounded placement reads computed borders exactly once');
    }
    const field = readingCase.get('yac-readingDensity');field.focus();
    const unchanged = { reads: readingHelp.reads, writes: readingHelp.writes, styleReads: readingHelp.styleReads };
    for (const value of [89, 89]) { field.value = value;readingCase.event(field, 'input'); }
    assert.deepEqual({ reads: readingHelp.reads, writes: readingHelp.writes, styleReads: readingHelp.styleReads }, unchanged, 'integer edits do not rewrite or reflow the unchanged normal explanation');
    assert.equal(readingCase.document.activeElement, field, 'integer input preserves the edited slider focus');
    const nextLanguage = language === 'ja' ? 'en' : 'ja';
    for (const listener of readingCase.storageListeners) listener({ 'liquid-ui:global:language': { newValue: nextLanguage } }, 'local');
    assert.deepEqual({ reads: readingHelp.reads, writes: readingHelp.writes, styleReads: readingHelp.styleReads },
      { reads: unchanged.reads + 1, writes: unchanged.writes + 1, styleReads: unchanged.styleReads + 1 }, 'language changes reflow the currently open long reading explanation exactly once');
    readingHelp.withinViewport();assert.equal(readingHelp.hint.tabIndex, 0);assert.equal(readingCase.document.activeElement, field);
    readingHelp.hint.focus();readingCase.composedEvent(readingHelp.hint, 'keydown', { key: 'Escape' });
    assert.equal(readingHelp.popover.hidden, true);assert.equal(readingCase.document.activeElement, readingHelp.trigger);
    assert.equal(readingHelp.panel.hidden, false);
    const closed = { reads: readingHelp.reads, styleReads: readingHelp.styleReads };
    for (const listener of readingCase.storageListeners) listener({ 'liquid-ui:global:language': { newValue: language } }, 'local');
    assert.deepEqual({ reads: readingHelp.reads, styleReads: readingHelp.styleReads }, closed, 'language changes in closed long help add no layout');
    readingCase.event(readingCase.document, 'yac-dispose');
  }
  console.log('PASS: changed open help reflow, overflow tab stop/focus/Escape, note and language updates, no closed/unrelated/unchanged/per-frame help layout');
}

async function checkLoadedVersion() {
  const version = '12.34.56.78';
  const versionText = language => language === 'ja' ? '読み込み版 ' + version : 'Loaded v' + version;
  const unavailable = language => language === 'ja' ? '版番号を取得できません' : 'Version unavailable';
  const settle = async h => { for (let i = 0; i < 20; i++) await Promise.resolve();h.flushTasks(); };
  const exercise = (h, language) => {
    const panel = h.get('yac-controls'), label = h.get('yac-loaded-version');
    const status = panel.shadowRoot.querySelector('.status-message');
    h.get('yac-settings-button').click();
    h.get('yac-enabled').checked = false;h.event(h.get('yac-enabled'), 'input');
    h.get('yac-menu-appearance').click();
    assert.equal(status.textContent, language === 'ja' ? 'アンビエント背景はオフです。' : 'Ambient background is off.', 'normal status updates its own text');
    assert.equal(label.parentElement, status.parentElement, 'status updates keep the static version in the same footer');
    const nextLanguage = language === 'ja' ? 'en' : 'ja';
    h.get('yac-settings-back').click();h.get('yac-menu-safety').click();
    h.get('yac-language').value = nextLanguage;h.event(h.get('yac-language'), 'input');
    assert.equal(panel.lang, nextLanguage, 'the ordinary panel locale covers the static version text');
    h.get('yac-settings-back').click();
    h.get('yac-enabled').checked = true;h.event(h.get('yac-enabled'), 'input');
    h.get('yac-settings-close').click();
    for (let i = 0; i < 12; i++) h.tick();
    assert.equal(panel.hidden, true, 'rendering continues with the settings UI closed');
    h.get('yac-settings-button').click();
    return nextLanguage;
  };
  for (const workerMode of [false, true]) for (const language of ['ja', 'en']) {
    let retired = false, writes = 0;
    const h = harness(workerMode, { runtimeGetManifest: () => {
      if (retired) throw new Error('Extension context invalidated.');
      return { version };
    }, storageSet: () => { writes++;throw new Error('Extension context invalidated.'); } });
    assert.equal(h.apiCalls.manifestCalls, 1, 'the loaded manifest is read before opening the UI');
    await h.load({ enabled: true, flashWarning: false, language });
    const label = h.get('yac-loaded-version');
    assert.equal(label.textContent, versionText(language), 'uses the exact independent manifest version in ' + language);
    for (const attribute of ['role', 'aria-live', 'tabindex']) assert.equal(label.getAttribute(attribute), null, 'version text is static and adds no announcement or focus target');
    const calls = { ...h.apiCalls };
    const nextLanguage = exercise(h, language);
    assert.equal(label.textContent, versionText(nextLanguage), 'language changes preserve the manifest version');
    assert.deepEqual(h.apiCalls, calls, 'open, localize, status changes and repeated closed-UI paint never read runtime again');
    retired = true;
    h.get('yac-menu-appearance').click();
    const strength = h.get('yac-strength');strength.value = 55;h.event(strength, 'input');h.event(strength, 'change');
    await settle(h);
    const notice = h.get('yac-controls').shadowRoot.querySelector('.save-error');
    assert.equal(notice.hidden, false, 'later invalidation retains the established reload notice');
    assert.equal(notice.querySelector('button').textContent, nextLanguage === 'ja' ? 'ページを再読み込み' : 'Reload page');
    assert.equal(label.textContent, versionText(nextLanguage), 'a disconnected page still identifies the version it loaded');
    strength.value = 60;h.event(strength, 'input');h.event(strength, 'change');await settle(h);
    assert.equal(Number(strength.value), 60, 'local input remains usable after invalidation');
    assert.equal(writes, 1, 'the retired storage API is not called again');
    assert.deepEqual(h.apiCalls, calls, 'later invalidation does not retry the cached manifest or URL');
    assert.equal(h.warnings.length, 0, 'known invalidation adds no console warning');
    h.event(h.document, 'yac-dispose');
  }
  const failure = new Error('Manifest lookup unavailable');
  const cases = [
    ['missing method', {}, 0],
    ['missing runtime', { runtimeAccess: () => undefined }, 0],
    ['missing manifest', { runtimeGetManifest: () => undefined }, 1],
    ['missing version', { runtimeGetManifest: () => ({}) }, 1],
    ['empty version', { runtimeGetManifest: () => ({ version: '' }) }, 1],
    ['blank version', { runtimeGetManifest: () => ({ version: ' \t' }) }, 1],
    ['nonstring version', { runtimeGetManifest: () => ({ version: 123 }) }, 1],
    ['ordinary synchronous throw', { runtimeGetManifest: () => { throw failure; } }, 1],
    ['method property throws', { runtimeManifestAccess: () => { throw failure; } }, 0],
    ['runtime property throws', { runtimeAccess: () => { throw failure; } }, 0]
  ];
  for (const workerMode of [false, true]) for (const language of ['ja', 'en']) for (const [name, options, calls] of cases) {
    const h = harness(workerMode, options);await h.load({ enabled: true, flashWarning: false, language });
    const label = h.get('yac-loaded-version');
    assert.equal(label.textContent, unavailable(language), name + ': no source-version fallback');
    assert.equal(h.apiCalls.manifestCalls, calls, name + ': bounded manifest attempt');
    const before = { ...h.apiCalls };
    const nextLanguage = exercise(h, language);
    assert.equal(label.textContent, unavailable(nextLanguage));
    assert.deepEqual(h.apiCalls, before, name + ': no retry on interaction or paint');
    assert.equal(h.get('yac-controls').shadowRoot.querySelector('.save-error').hidden, true, name + ': an optional version lookup is not a save failure');
    assert.equal(h.warnings.length, 0, name + ': no new warning logger');
    h.event(h.document, 'yac-dispose');
  }
  for (const workerMode of [false, true]) for (const access of ['method', 'method property', 'runtime property']) {
    let writes = 0;const error = new Error('Extension context invalidated.');
    const options = access === 'method' ? { runtimeGetManifest: () => { throw error; } } :
      access === 'method property' ? { runtimeManifestAccess: () => { throw error; } } : { runtimeAccess: () => { throw error; } };
    const h = harness(workerMode, { ...options, storageSet: () => { writes++; } });await settle(h);
    const label = h.get('yac-loaded-version');
    assert.equal(label.textContent, unavailable('ja'), access + ': retired startup does not invent a version');
    assert.equal(h.apiCalls.runtimeReads, 1);assert.equal(h.apiCalls.manifestCalls, access === 'method' ? 1 : 0);
    assert.equal(h.apiCalls.urlCalls, 0, access + ': retired startup skips getURL');
    assert.equal(h.apiCalls.storageReads, 0, access + ': retired startup skips storage read');
    assert.equal(h.storageListeners.size, 0, access + ': no retired storage listener');
    h.get('yac-settings-button').click();
    const notice = h.get('yac-controls').shadowRoot.querySelector('.save-error');
    assert.equal(notice.hidden, false);assert.equal(notice.querySelector('button').textContent, 'ページを再読み込み');
    h.get('yac-menu-safety').click();
    h.get('yac-language').value = 'en';h.event(h.get('yac-language'), 'input');h.event(h.get('yac-language'), 'change');await settle(h);
    assert.equal(label.textContent, unavailable('en'));assert.equal(notice.querySelector('button').textContent, 'Reload page');
    assert.equal(writes, 0, access + ': local input cannot retry retired save APIs');
    assert.equal(h.warnings.length, 0);assert.equal(h.stats.pageReloads, 0, 'reload remains an explicit action');
    notice.querySelector('button').click();assert.equal(h.stats.pageReloads, 1);
    h.event(h.document, 'yac-dispose');assert.equal(h.raf.size, 0);assert.equal(h.intervals.size, 0);
  }
  console.log('PASS: loaded manifest version, exact JA/EN, missing/throwing APIs, one startup lookup, persistent static footer and retired-context recovery');
}

async function main() {
   await checkLoadedVersion();
   await checkActiveHelpReflow();
   await checkWorkerCompatibilityNotice();
  for (const workerMode of [false, true]) {
   await checkPlaybackIsolation(workerMode);
   await checkEffectiveIntegerSettings(workerMode);
   await checkWarningStrengthBoundary(workerMode);
   await checkIntegerSliderBoundaries(workerMode);
   await checkLegacyIntegerDisplay(workerMode);
   await checkIntegerZeroState(workerMode);
   const h = harness(workerMode);
  assert.equal(h.document.documentElement.classList.contains('yac-active'), false, 'no startup activation before saved settings');
  assert.equal(h.renders.length, 0, 'no startup background render before settings');
  await h.load({ enabled: false, controlDensity: 100 });
  const palette = h.get('yac-surface-palette');
   const density = h.get('yac-surfaceMultiplier');
  const backgroundStrength = h.get('yac-strength').value;
  const originalPalette = palette.textContent;
  assert.equal(density.step, '1', 'master shade has 101 integer-percent positions');
  assert.equal(density.getAttribute('aria-valuetext'), '65%', 'recommended master is displayed and announced as an integer percent');
  density.value = 44;h.event(density, 'input');
  assert.equal(Number(density.value), 44);
  assert.equal(density.getAttribute('aria-valuetext'), '44%');
  const masterWork = { stats: { ...h.stats }, palette: palette.textContent, renders: h.renders.length, samples: h.inspections.length };
  for (const value of [44, 44, 44, 44]) { density.value = value;h.event(density, 'input'); }
  assert.deepEqual(h.stats, masterWork.stats, 'input inside the same master step adds no surface or geometry work');
  assert.equal(palette.textContent, masterWork.palette);
  assert.equal(h.renders.length, masterWork.renders, 'master shade changes do not repaint the video');
  assert.equal(h.inspections.length, masterWork.samples, 'master shade changes do not resample the video');
  density.value = 0; h.event(density, 'input');
  assert.notEqual(palette.textContent, originalPalette, 'interface shade updates even with ambient OFF');
  assert.match(palette.textContent, /--yac-control-opacity:0\.0000/, 'shared palette reaches fully transparent endpoint');
  assert.equal(h.get('yac-strength').value, backgroundStrength, 'interface shade does not change video-background strength');
  const changedPalette = palette.textContent;
  h.tick(); h.tick();
  assert.equal(palette.textContent, changedPalette, 'frame loop leaves interface palette alone');
   density.value = 100; h.event(density, 'input');
  assert.match(palette.textContent, /--yac-control-opacity:0\.2200/, 'shared palette reaches dense endpoint');
   const roleOffset = h.get('yac-readingDensity');
   roleOffset.value = 70; h.event(roleOffset, 'input');
  assert.match(palette.textContent, /--yac-control-opacity:0\.2200/, 'reading adjustment leaves controls unchanged');
  assert.match(palette.textContent, /--yac-reading-opacity:0\.5180/, 'reading adjustment changes reading palette');
  assert.equal(h.document.documentElement.classList.contains('yac-active'), false, 'saved OFF remains OFF');
  assert.equal(h.renders.length, 0);
  h.tick(); assert.ok(h.inspections.length > 0, 'OFF still samples for warnings');
   h.get('yac-settings-button').click(); assert.equal(h.get('yac-controls').hidden, false, 'OFF settings remain accessible');
   const panel = h.get('yac-controls'), menu = h.get('yac-settings-menu');
   assert.equal(h.get('yac-enabled').parentElement.parentElement, menu, 'ambient switch is in the settings home');
   assert.equal(h.document.activeElement, h.get('yac-enabled'), 'opening settings focuses the first switch');
   assert.equal(h.get('yac-launcher').parentElement, h.headerButtons.parentElement, 'settings entrance belongs to the stable masthead container');
   assert.deepEqual(h.headerButtons.children, [h.create, h.notification], 'the YouTube-managed list contains only native controls');
   assert.equal(h.document.documentElement.classList.contains('yac-header-controls'), true, 'the header slot remains reserved while ambient is OFF');
   const sameLauncher = h.get('yac-launcher');
   const newNotification = h.document.createElement('ytd-notification-topbar-button-renderer');
   h.notification.remove();h.headerButtons.append(newNotification);h.flushMutations();
   assert.equal(sameLauncher.isConnected, true, 'native child rerender cannot remove the launcher before the next discovery tick');
   assert.equal(h.get('yac-launcher'), sameLauncher);newNotification.remove();h.headerButtons.append(h.notification);h.flushMutations();
   assert.equal(panel.parentElement, h.document.documentElement, 'fixed panel is independent of player layout');
   assert.equal(h.player.querySelector('#yac-launcher'), null, 'player has no extension entrance or switch');
   assert.equal(h.player.querySelectorAll('.ytp-settings-button').length, 1, 'native settings button is preserved');
   assert.equal(menu.querySelectorAll('.menu-item').length, 4, 'home presents four settings categories');
   assert.equal(h.get('yac-settings-button').querySelector('svg').getAttribute('width'), '24', 'header uses the Lucide standard size');
   assert.equal(h.get('yac-menu-appearance').querySelector('svg').getAttribute('width'), '24', 'category icon is larger');
   assert.ok(h.get('yac-enabled-hint').textContent, 'main switch has a localized explanation');
   const icons = [...h.get('yac-launcher').querySelectorAll('svg'), ...panel.shadowRoot.querySelectorAll('svg')];
   for (const icon of icons) {
     assert.ok(icon.getAttribute('data-lucide'), 'every extension settings icon comes from Lucide');
     assert.equal(icon.getAttribute('stroke-width'), '2', 'Lucide stroke weights are consistent');
     assert.equal(icon.getAttribute('aria-hidden'), 'true', 'decorative SVG keeps the control name accessible');
     assert.equal(icon.getAttribute('focusable'), 'false', 'SVG does not add a keyboard stop');
   }
   assert.equal(h.get('yac-settings-button').querySelector('svg').getAttribute('data-lucide'), 'settings-2', 'entrance uses sliders instead of the handmade gear');
   assert.equal(h.get('yac-enabled').closest('.setting-row').querySelector('.info svg').getAttribute('data-lucide'), 'info', 'information affordance also uses Lucide');
   const replacement = h.document.createElement('div'), replacementCreate = h.document.createElement('ytd-button-renderer');
   replacement.id = 'buttons';replacement.append(replacementCreate);
   h.headerButtons.parentElement.append(replacement);h.headerButtons.remove();h.flushMutations();
   assert.equal(h.get('yac-launcher').parentElement, replacement.parentElement, 'header rerender reuses the entrance outside the replaced list');
   assert.equal(h.document.querySelectorAll('#yac-settings-button').length, 1, 'header rerender never duplicates the entrance');
   const homeLink = h.document.createElement('a');homeLink.setAttribute('href', '/');h.masthead.append(homeLink);
   h.composedEvent(homeLink, 'click');assert.equal(panel.hidden, false, 'navigation links retain the panel before SPA navigation');
   h.setPath('/');h.event(h.document, 'yt-navigate-finish');
   assert.equal(h.get('yac-launcher').hidden, false, 'Home retains the same header entrance');
   assert.equal(panel.hidden, false, 'Home retains the open settings panel');
   h.setPath('/watch');h.event(h.document, 'yt-navigate-finish');
   assert.equal(h.get('yac-launcher').hidden, false, 'returning to Watch restores the same entrance');
   replacementCreate.remove();h.discover();
   assert.equal(h.get('yac-launcher').parentElement, replacement.parentElement, 'header without Create still has a settings entrance');
   replacement.remove();h.discover();
   assert.equal(h.get('yac-launcher').hidden, true, 'missing header hides the disconnected entrance');
   h.masthead.querySelector('#end').append(h.headerButtons);h.discover();h.get('yac-settings-button').click();
   assert.equal(panel.hidden, false, 'settings recover after the header is restored');
   h.event(h.document, 'click', { target: h.notification });
   assert.equal(panel.hidden, true, 'using another header control dismisses settings');
   h.get('yac-settings-button').click();
   h.get('yac-menu-surfaces').click();
    assert.equal(menu.hidden, true);assert.equal(h.get('yac-page-surfaces').hidden, false);
     const info = h.get('yac-page-surfaces').querySelector('.info');
     const hint = h.get('yac-surfaceMultiplier-hint'), helpParent = info.closest('.setting-row');
     const popover = h.get('yac-surfaceMultiplier-help');
     assert.equal(hint.hidden, true, 'help starts hidden in both DOM and CSS');
     assert.equal(info.getAttribute('aria-describedby'), hint.id, 'the help trigger retains its description ID');
     assert.equal(info.getAttribute('aria-controls'), popover.id, 'the button controls its own help dialog');
     assert.equal(info.getAttribute('aria-haspopup'), 'dialog');
     assert.equal(hint.parentElement, popover);
     assert.equal(popover.parentElement, panel.shadowRoot, 'floating help belongs to the same accessible ShadowRoot');
     assert.equal(helpParent.contains(popover), false, 'help does not add height to the setting row');
     assert.equal(panel.shadowRoot.querySelector('.body').contains(popover), false, 'body scrolling cannot clip the help dialog');
     const detailHeight = panel.style.height;
     h.resize();assert.equal(panel.style.height, detailHeight, 'help keeps the detail panel anchored at a stable height');
      const helpWork = { stats: { ...h.stats }, panelStyleReads: h.computedStyleReadsByNode.get(panel) || 0, renders: h.renders.length, samples: h.inspections.length, palette: palette.textContent,
       videoReads: h.rectReadsByNode.get(h.video) || 0, playerReads: h.rectReadsByNode.get(h.player) || 0 };
     info.focus();h.event(info, 'focus');
     for (const pointerType of ['mouse', 'touch', 'pen']) h.event(info, 'pointerenter', { pointerType });
     assert.equal(hint.hidden, true, 'focus and all pointer hover types leave help closed');
     assert.equal(info.getAttribute('aria-expanded'), 'false');
     h.composedEvent(info, 'click');
     assert.equal(hint.hidden, false, 'only button activation opens the explanation');
     assert.equal(popover.hidden, false);assert.equal(info.getAttribute('aria-expanded'), 'true');
     h.event(helpParent, 'pointerleave');density.focus();h.event(info, 'blur');
     assert.equal(hint.hidden, false, 'explicit help remains readable after pointer and focus leave');
     h.composedEvent(info, 'click');
     assert.equal(hint.hidden, true, 'a second click closes help');
     assert.equal(info.getAttribute('aria-expanded'), 'false');
     for (const key of ['Enter', ' ']) {
       info.focus();h.pressButton(info, key);
       assert.equal(hint.hidden, false, key + ': native button activation opens help');
       h.composedEvent(hint, 'keydown', { key: 'Escape' });
       assert.equal(hint.hidden, true);assert.equal(h.document.activeElement, info, 'Escape from floating content returns focus to its opener');
       assert.equal(h.get('yac-page-surfaces').hidden, false, 'help Escape keeps the category open');
       assert.equal(panel.hidden, false, 'help Escape keeps settings open');
     }
     h.flushTasks();
     const panelBorderReads = (h.computedStyleReadsByNode.get(panel) || 0) - helpWork.panelStyleReads;
     assert.equal(panelBorderReads, 3, 'each explicit help opening reads panel borders once');
     assert.equal(h.stats.computedStyleReads, helpWork.stats.computedStyleReads + panelBorderReads, 'help reads computed styles only for its containing panel');
     assert.deepEqual({ ...h.stats, rectReads: helpWork.stats.rectReads, computedStyleReads: helpWork.stats.computedStyleReads }, helpWork.stats, 'help interactions do not rescan surfaces, invalidate frames or reset warning samples');
     assert.equal(h.rectReadsByNode.get(h.video) || 0, helpWork.videoReads, 'popover positioning never probes video geometry');
     assert.equal(h.rectReadsByNode.get(h.player) || 0, helpWork.playerReads, 'popover positioning never probes player geometry');
     assert.equal(h.renders.length, helpWork.renders, 'help interactions do not paint an extra ambient frame');
     assert.equal(h.inspections.length, helpWork.samples, 'help interactions do not capture an extra video sample');
     assert.equal(palette.textContent, helpWork.palette, 'help interactions preserve all surface shades');
   density.value = 40;h.event(density, 'input');
   assert.match(roleOffset.getAttribute('aria-valuetext'), /28%/, 'screen reader announces the individual percentage multiplied by the master');
   assert.match(palette.textContent, /--yac-reading-opacity:0\.2072/, 'per-category percentages use multiplication');
    h.composedEvent(panel, 'keydown', { key: 'Escape' });
   assert.equal(menu.hidden, false);assert.equal(panel.hidden, false, 'Escape returns from details to the menu');
   assert.equal(h.document.activeElement, h.get('yac-menu-surfaces'), 'back navigation returns focus to the category');
   h.get('yac-settings-close').click();
   assert.equal(panel.hidden, true);assert.equal(h.document.activeElement, h.get('yac-settings-button'), 'close restores focus to the icon button');
   h.get('yac-settings-button').click();
   assert.equal(menu.hidden, false, 'reopening begins at the settings menu');
  h.enabled().checked = true; h.event(h.enabled(), 'input'); h.tick();
  assert.ok(h.renders.length > 0, 'ON paints background');
  h.enabled().checked = false; h.event(h.enabled(), 'input');
  assert.equal(h.get('yac-controls').hidden, false, 'turning OFF does not close settings');
  h.enabled().checked = true; h.event(h.enabled(), 'input');
  h.video.seeking = true; h.event(h.video, 'seeking');
  let before = h.renders.length; h.tick(); assert.equal(h.renders.length, before, 'seeking does not paint');
  h.video.seeking = false; h.event(h.video, 'seeked'); h.tick(); assert.ok(h.renders.length > before, 'seeked resumes');
  h.video.rect.width = 0; before = h.renders.length; h.tick(); assert.equal(h.renders.length, before, 'zero-width geometry does not paint');
  h.video.rect.width = 640; h.tick();
  h.video.paused = true; before = h.renders.length; const pausedSamples = h.inspections.length;
  h.tick(); h.tick();
  assert.equal(h.renders.length, before, 'settled paused footage does not repaint');
  assert.equal(h.inspections.length, pausedSamples, 'paused footage does not monitor');
  h.video.paused = false;
  h.video.style.setProperty('clip-path', 'inset(7px)', 'important');
  h.document.hidden = true; h.event(h.document, 'visibilitychange');
  assert.equal(h.video.style.getPropertyValue('clip-path'), 'inset(7px)', 'external latest clip is preserved on restoration');
  before = h.renders.length + h.inspections.length; h.tick();
  assert.equal(h.renders.length + h.inspections.length, before, 'hidden document neither paints nor samples');
  h.document.hidden = false; h.event(h.document, 'visibilitychange');
  h.document.fullscreenElement = h.player; h.event(h.document, 'fullscreenchange');
  assert.equal(panel.hidden, true, 'entering fullscreen closes the header settings panel');
  before = h.renders.length; const samples = h.inspections.length;
  h.tick(); assert.equal(h.renders.length, before, 'fullscreen never paints page background');
  assert.ok(h.inspections.length > samples, 'fullscreen continues warning samples');
  h.flash(true); h.tick();
  const warning = h.get('yac-flash-warning'), dialog = warning.shadowRoot.querySelector('dialog');
  assert.equal(warning.parentElement, h.player, 'warning host follows fullscreen element');
  assert.ok(dialog.open && dialog.modalCalls, 'warning uses modal dialog');
  const css = warning.shadowRoot.querySelector('style').textContent;
  assert.match(css, /background:#1c1c1c/, 'warning dialog has opaque dark background');
  assert.match(css, /dialog::backdrop/, 'warning has backdrop');
  h.event(h.document, 'yac-dispose');
   assert.equal(palette.isConnected, false, 'dispose removes generated palette');
   assert.equal(h.get('yac-launcher').isConnected, false, 'dispose removes the masthead settings entrance');
  assert.equal(h.raf.size, 0); assert.equal(h.intervals.size, 0);
  assert.equal(h.storageListeners.size, 0, 'dispose removes storage subscription');
  for (const target of [h.document, h.window, h.video]) assert.ok([...target.listeners.values()].every(list => list.length === 0), 'dispose removes controller listeners');
  console.log(`PASS (${workerMode ? 'worker callback' : 'main'}): ambient startup, OFF/fullscreen monitoring, panel, seek/geometry, clip ownership, modal and disposal`);
  for (const openerState of ['usable', 'disabled', 'hidden', 'hidden-parent', 'removed']) {
    const focusCase = harness(workerMode);
    await focusCase.load({ enabled: true });
    const wrapper = focusCase.document.createElement('div'), opener = focusCase.document.createElement('button');
    wrapper.append(opener);focusCase.player.append(wrapper);opener.focus();
    focusCase.flash(true);focusCase.tick();
    const modal = focusCase.get('yac-flash-warning').shadowRoot.querySelector('dialog');
    assert.equal(modal.open, true);
    const strength = focusCase.get('yac-strength').value;
    if (openerState === 'disabled') opener.disabled = true;
    else if (openerState === 'hidden') opener.hidden = true;
    else if (openerState === 'hidden-parent') wrapper.hidden = true;
    else if (openerState === 'removed') opener.remove();
    if (openerState === 'usable') modal.querySelector('.actions').children[0].click();
    else focusCase.event(modal, 'cancel');
    assert.equal(modal.open, false);
    assert.equal(focusCase.document.activeElement, openerState === 'usable' ? opener : focusCase.get('yac-settings-button'), openerState + ' opener has a usable focus return');
    assert.equal(focusCase.video.paused, false, 'dismissing the warning keeps playback running');
    assert.equal(focusCase.get('yac-strength').value, strength, 'focus return never changes ambient strength');
    focusCase.event(focusCase.document, 'yac-dispose');
  }
  console.log(`PASS (${workerMode ? 'worker callback' : 'main'}): warning focus return for usable, disabled, hidden, hidden-parent and removed openers`);
  for (const language of ['ja', 'en']) for (const initialStrength of [0, 5, 15, 65]) {
    const reductionCase = harness(workerMode);
    await reductionCase.load({ strength: initialStrength, language });
    const loadedStrength = Number(reductionCase.get('yac-strength').value);
    assert.equal(loadedStrength, Math.max(15, initialStrength), 'saved strength is normalized to the existing 15% minimum before warning interaction');
    reductionCase.flash(true);reductionCase.tick();
    const modal = reductionCase.get('yac-flash-warning').shadowRoot.querySelector('dialog');
    if (loadedStrength <= 50) {
      assert.notEqual(modal.open, true, 'Normalized low-strength controls do not produce a warning');
      assert.equal(reductionCase.stats.monitorSamples, 0, 'The normalized minimum does not need warning samples');
      assert.equal(Number(reductionCase.get('yac-strength').value), loadedStrength);
      reductionCase.event(reductionCase.document, 'yac-dispose');continue;
    }
    assert.equal(modal.open, true);
    const reduce = modal.querySelector('.actions').children[1], label = reduce.textContent;
    reduce.click();
    for (let settle = 0; settle < 20; settle++) await Promise.resolve();
    const resultingStrength = Number(reductionCase.get('yac-strength').value);
    assert.equal(resultingStrength, 15, 'warning action applies the advertised 15% preset');
    assert.ok(resultingStrength <= loadedStrength, 'warning action must never increase the current normalized ambient strength');
    assert.equal(modal.open, false, 'successful warning action closes the modal');
    assert.equal(reductionCase.video.paused, false);
    assert.ok(label.includes('15%'), 'warning action announces the actual preset');
    assert.ok(label.includes(language === 'ja' ? '濃さを下げる' : 'Reduce strength'));
    const reducedSamples = reductionCase.stats.monitorSamples, source = reductionCase.video.currentSrc;
    reductionCase.tick();
    assert.equal(reductionCase.video.currentSrc, source, 'the reduction does not rely on replacing the video');
    assert.equal(reductionCase.stats.monitorSamples, reducedSamples, 'Reduced 15% stays below the warning threshold');
    assert.equal(modal.open, false, 'Reduced strength does not immediately display another warning');
    reductionCase.flash(false);reductionCase.get('yac-strength').value = 51;reductionCase.event(reductionCase.get('yac-strength'), 'input');reductionCase.tick();
    assert.ok(reductionCase.stats.monitorSamples > reducedSamples, 'Raising to 51% resumes monitoring the same video after successful reduction');
    reductionCase.flash(true);reductionCase.tick();
    assert.equal(modal.open, true, 'fresh same-video samples can produce another warning after raising strength');
    reductionCase.event(reductionCase.document, 'yac-dispose');
  }
  console.log(`PASS (${workerMode ? 'worker callback' : 'main'}): low-strength controls do not warn, high-strength warning reduces to 15% and raising to 51% resumes, in Japanese and English`);
  await checkWarningReductionLifecycle(workerMode);
   await checkHelpLifecycle(workerMode);
   await checkHelpScrollFocus(workerMode);
   await checkPanelRetryFocus(workerMode);
  await checkInvalidatedContext(workerMode);
 }
}
async function checkWarningStrengthBoundary(workerMode) {
  for (const strength of [49, 50, 51, 100]) {
    const h = harness(workerMode, { videoFrameCallbacks: true });await h.load({ enabled: false, strength });
    const modal = h.get('yac-flash-warning').shadowRoot.querySelector('dialog');
    const scheduler = { raf: h.raf.size, intervals: h.intervals.size, timeouts: h.timeouts.size };
    h.flash(true);
    if (strength <= 50) {
      assert.equal(h.stats.monitorSamples, 0, strength + '%: loading monitoring-only settings does not inspect warning pixels');
      assert.equal(h.videoFrames.size, 0, strength + '%: low-strength monitoring has no decoded-frame subscription');
      for (let i = 0; i < 3; i++) { h.presentVideoFrame();h.tick(); }
      assert.equal(h.renders.length + h.inspections.length, 0, strength + '%: ambient OFF and low strength do no frame work');
      assert.equal(h.stats.monitorSamples, 0);assert.notEqual(modal.open, true, strength + '%: no warning is displayed');
    } else {
      assert.equal(h.videoFrames.size, 1, strength + '%: monitoring uses one decoded-frame subscription');
      h.presentVideoFrame();h.tick();
      assert.ok(h.stats.monitorSamples > 0);assert.equal(modal.open, true, strength + '%: fresh monitoring can display a warning');
    }
    assert.equal(h.get('yac-flashWarning').checked, true, 'The strength threshold does not rewrite the warning preference');
    assert.deepEqual({ raf: h.raf.size, intervals: h.intervals.size, timeouts: h.timeouts.size }, scheduler, 'Threshold handling uses the existing scheduler');
    h.event(h.document, 'yac-dispose');
  }
  if (workerMode) {
    const h = harness(true, { videoFrameCallbacks: true });await h.load({ enabled: false, strength: 51 });
    const modal = h.get('yac-flash-warning').shadowRoot.querySelector('dialog');
    h.flash(true);h.presentVideoFrame();h.tick({ flush: false });assert.equal(h.worker.pending, true);
    const samples = h.stats.monitorSamples, accepted = h.stats.workerAcceptedFrames;
    h.get('yac-strength').value = 50;h.event(h.get('yac-strength'), 'input');h.flushWorkers();
    assert.equal(h.stats.monitorSamples, samples, 'An in-flight high-strength sample cannot monitor after lowering to 50%');
    assert.equal(h.stats.workerAcceptedFrames, accepted, 'The old high-strength sample is rejected after the threshold edit');
    assert.notEqual(modal.open, true);assert.equal(h.videoFrames.size, 0);
    h.event(h.document, 'yac-dispose');
  }
  if (workerMode) {
    const h = harness(true, { realFlashMonitor: true, videoFrameCallbacks: true });await h.load({ enabled: true, strength: 51 });
    const modal = h.get('yac-flash-warning').shadowRoot.querySelector('dialog');
    const freshTick = (index, flush = true) => { h.pixelLevel(index % 2 ? 255 : 0);h.presentVideoFrame();h.tick({ delta: 100, flush }); };
    for (let i = 0; i < 25; i++) freshTick(i);
    assert.notEqual(modal.open, true, 'The actual detector retains a recent burst shorter than its warning threshold');
    freshTick(25, false);assert.equal(h.worker.pending, true, 'Both strength edits occur during real modeled Worker backpressure');
    const resets = h.stats.monitorResets, samples = h.stats.monitorSamples, accepted = h.stats.workerAcceptedFrames;
    h.get('yac-strength').value = 50;h.event(h.get('yac-strength'), 'input');
    assert.equal(h.stats.monitorResets, resets + 1, 'Lowering through 50% resets the detector immediately even when draw cannot accept');
    h.get('yac-strength').value = 51;h.event(h.get('yac-strength'), 'input');
    assert.equal(h.stats.monitorResets, resets + 2, 'Raising through 50% resets the detector immediately under the same backpressure');
    assert.equal(h.worker.pending, true);h.flushWorkers();
    assert.equal(h.stats.workerAcceptedFrames, accepted);assert.equal(h.stats.monitorSamples, samples, 'The pre-crossing frame cannot restore old history after either edit');
    let frames = 0;
    for (; frames < 25; frames++) freshTick(frames);
    assert.notEqual(modal.open, true, 'A second short burst after busy threshold crossings cannot complete the old burst');
    for (; frames < 50 && !modal.open; frames++) freshTick(frames);
    assert.equal(modal.open, true, 'Only a complete new sustained burst can warn after the busy threshold crossings');
    h.event(h.document, 'yac-dispose');
  }
  console.log(`PASS (${workerMode ? 'worker callback' : 'main'}): warning strength boundary 49/50 versus 51/100, monitoring-only rVFC work and unchanged scheduler${workerMode ? ', stale-frame rejection and busy-crossing history reset' : ''}`);
}
async function checkWarningReductionLifecycle(workerMode) {
  const settle = async h => { for (let i = 0; i < 24; i++) await Promise.resolve();h.flushTasks(); };
  const warningUi = h => {
    const root = h.get('yac-flash-warning').shadowRoot, modal = root.querySelector('dialog'), actions = modal.querySelector('.actions');
    const notice = root.querySelector('.save-error');
    return { modal, close: actions.children[0], reduce: actions.children[1], never: modal.querySelector('input'), notice, retry: notice.querySelector('button') };
  };
  const open = async h => {
    await h.load({ enabled: false, strength: 65 });h.flash(true);h.tick();
    const ui = warningUi(h);assert.equal(ui.modal.open, true);return ui;
  };
  const deferredStorage = () => {
    const writes = [];
    return { writes, storageSet: values => new Promise((resolve, reject) => writes.push({ values: { ...values }, resolve, reject })) };
  };
  for (const dismissal of ['close', 'escape']) {
    let writes = 0;const h = harness(workerMode, { storageSet: async () => { writes++; } }), ui = await open(h);
    const samples = h.stats.monitorSamples;
    if (dismissal === 'close') ui.close.click();else h.event(ui.modal, 'cancel');
    for (let i = 0; i < 3; i++) h.tick();
    assert.equal(ui.modal.open, false);assert.equal(h.stats.monitorSamples, samples, dismissal + ': plain dismissal keeps same-video suppression');
    assert.equal(Number(h.get('yac-strength').value), 65);assert.equal(h.get('yac-flashWarning').checked, true);
    h.get('yac-strength').value = 50;h.event(h.get('yac-strength'), 'input');h.get('yac-strength').value = 51;h.event(h.get('yac-strength'), 'input');h.tick();
    assert.equal(h.stats.monitorSamples, samples, dismissal + ': mere strength threshold crossings do not clear plain-dismissal suppression');
    assert.equal(ui.modal.open, false);
    assert.equal(writes, 0, 'Plain dismissal does not persist another preference');h.event(h.document, 'yac-dispose');
  }

  {
    const h = harness(workerMode, { realFlashMonitor: true, videoFrameCallbacks: true });await h.load({ enabled: false, strength: 65 });
    const ui = warningUi(h);
    const scheduler = { raf: h.raf.size, intervals: h.intervals.size, timeouts: h.timeouts.size };
    const freshTick = () => { h.presentVideoFrame();h.tick({ delta: 100 }); };
    let firstFrames = 0;
    for (; firstFrames < 50 && !ui.modal.open; firstFrames++) { h.pixelLevel(firstFrames % 2 ? 255 : 0);freshTick(); }
    assert.equal(ui.modal.open, true, 'The actual detector produces the first warning from sustained sampled transitions');
    h.tick({ delta: 100, mediaAdvance: 0 });
    assert.equal(h.videoFrames.size, 0, 'A monitoring-only warning stops decoded-frame subscriptions while the modal is open');
    const resets = h.stats.monitorResets, source = h.video.currentSrc;
    ui.reduce.click();await settle(h);
    assert.equal(ui.modal.open, false);assert.ok(h.stats.monitorResets > resets, 'Successful reduction resets the actual detector history');
    const before = h.stats.monitorSamples;h.tick({ delta: 100, mediaAdvance: 0 });
    assert.equal(h.stats.monitorSamples, before, 'The already sampled decoded frame is not reused after reduction');
    h.pixelLevel(0);h.tick({ delta: 100 });
    assert.equal(h.stats.monitorSamples, before, 'A fresh frame at reduced 15% does not run the warning detector');
    assert.equal(h.videoFrames.size, 0, 'Reduced strength keeps monitoring-only decoded-frame subscriptions stopped');
    h.get('yac-strength').value = 51;h.event(h.get('yac-strength'), 'input');h.tick({ delta: 100 });
    assert.ok(h.stats.monitorSamples > before, 'Raising to 51% resumes actual detector sampling from the same video');
    assert.equal(h.videoFrames.size, 1, 'Raising to 51% resumes exactly one decoded-frame subscription with ambient OFF');
    assert.deepEqual({ raf: h.raf.size, intervals: h.intervals.size, timeouts: h.timeouts.size }, scheduler, 'Monitoring resumes through the existing scheduler without adding timers');
    assert.equal(ui.modal.open, false, 'A single new frame cannot reuse the old warning burst');
    const primedSamples = h.stats.monitorSamples;h.tick({ delta: 100, mediaAdvance: 0 });
    assert.equal(h.stats.monitorSamples, primedSamples, 'Resumed rVFC monitoring waits for another decoded-frame callback');
    let afterFrames = 0;
    for (; afterFrames < 25; afterFrames++) { h.pixelLevel(afterFrames % 2 ? 255 : 0);freshTick(); }
    assert.equal(ui.modal.open, false, 'Less than three seconds of new transitions cannot reuse the old detector history');
    for (; afterFrames < 50 && !ui.modal.open; afterFrames++) { h.pixelLevel(afterFrames % 2 ? 255 : 0);freshTick(); }
    assert.equal(ui.modal.open, true, 'A new sustained burst can warn again after raising the reduced strength');
    assert.equal(h.video.currentSrc, source);assert.equal(h.video.paused, false);h.event(h.document, 'yac-dispose');
  }

  {
    const storage = deferredStorage(), h = harness(workerMode, storage), ui = await open(h);
    ui.reduce.click();ui.reduce.click();await settle(h);
    assert.equal(storage.writes.length, 1);assert.deepEqual(storage.writes[0].values, { 'liquid-ui:site:youtube:strength': 15 });
    assert.equal(ui.reduce.getAttribute('aria-busy'), 'true');assert.equal(ui.modal.open, true, 'Pending reduction is not treated as successful');
    const samples = h.stats.monitorSamples;h.tick();assert.equal(h.stats.monitorSamples, samples);
    storage.writes[0].reject(new Error('reduction storage failure'));await settle(h);
    assert.equal(ui.modal.open, true);assert.equal(ui.notice.hidden, false, 'Failed reduction remains visible for retry');
    assert.equal(Number(h.get('yac-strength').value), 15, 'Failed persistence keeps the local reduction');
    ui.retry.click();ui.retry.click();await settle(h);assert.equal(storage.writes.length, 2);
    assert.equal(ui.retry.getAttribute('aria-disabled'), 'true');assert.equal(ui.modal.open, true);
    storage.writes[1].resolve();await settle(h);
    assert.equal(ui.modal.open, false, 'Successful reduction retry closes the current warning');
    h.tick();assert.equal(h.stats.monitorSamples, samples, 'Successful retry at 15% does not run monitoring');
    h.flash(false);h.get('yac-strength').value = 51;h.event(h.get('yac-strength'), 'input');h.tick();
    assert.ok(h.stats.monitorSamples > samples, 'Raising to 51% after successful retry rearms the same-video monitor');
    h.flash(true);h.tick();assert.equal(ui.modal.open, true, 'Fresh same-video warning remains available after retry');h.event(h.document, 'yac-dispose');
  }

  for (const neverResult of ['success', 'failure']) {
    const storage = deferredStorage(), h = harness(workerMode, storage), ui = await open(h);
    ui.never.checked = true;h.event(ui.never, 'change');ui.reduce.click();await settle(h);
    assert.deepEqual(storage.writes.map(write => write.values), [{ 'liquid-ui:site:youtube:flashWarning': false }, { 'liquid-ui:site:youtube:strength': 15 }]);
    storage.writes[1].resolve();await settle(h);
    assert.equal(ui.modal.open, true, 'A successful strength write waits for the pending Never-show write');
    if (neverResult === 'failure') {
      storage.writes[0].reject(new Error('Never-show storage failure'));await settle(h);
      assert.equal(ui.modal.open, true);assert.equal(ui.notice.hidden, false, 'Never-show persistence failure prevents reduction dismissal');
      ui.retry.click();await settle(h);assert.deepEqual(storage.writes[2].values, { 'liquid-ui:site:youtube:flashWarning': false });
      assert.equal(ui.modal.open, true, 'The failed Never-show preference stays visible until retry finishes');
      storage.writes[2].resolve();
    } else storage.writes[0].resolve();
    await settle(h);assert.equal(ui.modal.open, false);assert.equal(h.get('yac-flashWarning').checked, false);
    h.get('yac-strength').value = 51;h.event(h.get('yac-strength'), 'input');
    const samples = h.stats.monitorSamples;for (let i = 0; i < 3; i++) h.tick();
    assert.equal(h.stats.monitorSamples, samples, 'Never-show stays OFF after successful reduction or retry');
    assert.equal(ui.modal.open, false);h.event(h.document, 'yac-dispose');
  }

  {
    const storage = deferredStorage(), h = harness(workerMode, storage), ui = await open(h);
    ui.reduce.click();await settle(h);assert.equal(storage.writes.length, 1);ui.close.click();
    h.flash(false);h.get('yac-strength').value = 51;h.event(h.get('yac-strength'), 'input');h.flash(true);
    h.setSearch('?v=next-warning');h.video.currentSrc = 'test:next-warning';h.event(h.document, 'yt-navigate-finish');h.flushWorkers();h.tick();
    assert.equal(ui.modal.open, true, 'A different video owns a new warning while the old save is pending');
    const presentations = ui.modal.modalCalls, resets = h.stats.monitorResets;
    storage.writes[0].resolve();await settle(h);
    assert.equal(ui.modal.open, true, 'The old reduction completion cannot dismiss a new warning');
    assert.equal(ui.modal.modalCalls, presentations);assert.equal(h.stats.monitorResets, resets, 'An old completion cannot reset the new monitor history');
    ui.close.click();const samples = h.stats.monitorSamples;h.tick();h.tick();
    assert.equal(h.stats.monitorSamples, samples, 'An old completion cannot rearm the new warning after plain dismissal');
    assert.equal(ui.modal.open, false);h.event(h.document, 'yac-dispose');
  }
  console.log(`PASS (${workerMode ? 'worker callback' : 'main'}): reduction rearming, actual detector fresh burst, plain dismissal, pending/failing saves, retry, Never-show and stale warning presentation`);
}
async function checkInvalidatedContext(workerMode) {
  const settle = async h => { for (let i = 0; i < 20; i++) await Promise.resolve();h.flushTasks(); };
  for (const language of ['ja', 'en']) for (const surface of ['panel', 'warning']) for (const failureMode of ['throw', 'reject']) {
    let writes = 0;const error = new Error('Extension context invalidated.');
    const h = harness(workerMode, { storageSet: () => {
      writes++;if (failureMode === 'throw') throw error;return Promise.reject(error);
    }, storageRemove: () => { throw error; } });
    await h.load({ enabled: surface === 'warning', language });
    let host;
    if (surface === 'warning') {
      h.flash(true);h.tick();host = h.get('yac-flash-warning');
      host.shadowRoot.querySelector('.actions').children[1].click();
    } else {
      h.get('yac-settings-button').click();h.get('yac-menu-appearance').click();host = h.get('yac-controls');
      const field = h.get('yac-strength');field.value = 55;h.event(field, 'input');h.event(field, 'change');
    }
    await settle(h);
    const notice = host.shadowRoot.querySelector('.save-error'), action = notice.querySelector('button');
    assert.equal(notice.hidden, false);
    assert.match(notice.querySelector('span').textContent, language === 'ja' ? /再読み込みしてください/ : /Reload this YouTube page/);
    assert.equal(action.textContent, language === 'ja' ? 'ページを再読み込み' : 'Reload page');
    if (surface === 'warning') assert.equal(host.shadowRoot.querySelector('dialog').open, true, 'Terminal save failure stays visible in the warning');
    const field = h.get('yac-strength');field.value = 60;h.event(field, 'input');h.event(field, 'change');await settle(h);
    assert.equal(Number(field.value), 60, 'A local edit remains usable while persistence requires reload');
    assert.equal(writes, 1);assert.equal(h.warnings.length, 0, 'Known invalidation is shown in the UI without repeated console errors');
    assert.equal(h.stats.pageReloads, 0, 'The page is never reloaded automatically');
    action.click();await settle(h);assert.equal(h.stats.pageReloads, 1, 'Only the explicit recovery button reloads the page');
    assert.doesNotThrow(() => h.event(h.document, 'yac-dispose'));
    assert.equal(h.raf.size, 0);assert.equal(h.intervals.size, 0);assert.equal(h.storageListeners.size, 0);
  }
  if (workerMode) {
    const h = harness(true, { runtimeGetURL: () => { throw new Error('Extension context invalidated.'); } });
    await settle(h);h.get('yac-settings-button').click();
    const notice = h.get('yac-controls').shadowRoot.querySelector('.save-error');
    assert.equal(notice.hidden, false, 'Invalidation during Worker URL lookup still shows page recovery');
    assert.equal(notice.querySelector('button').textContent, 'ページを再読み込み');
    assert.equal(h.warnings.length, 0);assert.equal(h.storageListeners.size, 0);
    h.event(h.document, 'yac-dispose');assert.equal(h.raf.size, 0);assert.equal(h.intervals.size, 0);
  }
  console.log(`PASS (${workerMode ? 'worker callback' : 'main'}): invalidated extension context, one API attempt, local paint, explicit reload recovery and complete disposal`);
}
async function checkPlaybackIsolation(workerMode) {
  const h = harness(workerMode, { sharedSettings: true, storageSet: async () => { throw new Error('Expected playback persistence failure'); } });
  await h.load({ enabled: true, flashWarning: false });
  const baseline = { renders: h.renders.length, samples: h.inspections.length, stats: { ...h.stats } };
  const playback = h.playbackStore;await playback.ready;
  await playback.set('playbackMode', 'rate');await playback.set('playbackRate', 1.25);
  await assert.rejects(playback.set('playbackRate', 1.26, true));
  assert.equal(h.renders.length, baseline.renders);assert.equal(h.inspections.length, baseline.samples);
  assert.deepEqual(h.stats, baseline.stats, 'playback edits add no ambient capture, layout or warning work');
  const notice = h.get('yac-controls').shadowRoot.querySelector('.save-error');
  assert.equal(notice.hidden, true, 'playback persistence failures do not appear in the ambient panel');
  await assert.rejects(h.sharedStore.set('strength', 60, true));
  assert.equal(notice.hidden, false, 'ambient failure remains visible even when a playback key failed first');
  h.event(h.document, 'yac-dispose');assert.equal(h.sharedStore.disposed, false, 'ambient teardown preserves the shared store');
  h.sharedStore.dispose();playback.dispose();assert.equal(h.storageListeners.size, 0);
  console.log(`PASS (${workerMode ? 'worker callback' : 'main'}): shared playback changes avoid ambient work, scoped save errors and shared-store ownership`);
}
module.exports = { harness };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
