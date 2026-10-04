/* Local fixture only. Product code and visible frames remain unmodified. */
'use strict';
(() => {
  const namespace = 'yac-warning-fixture:v1:';
  const preferenceKeys = ['enabled', 'radial', 'avoidBars', 'fillBars', 'flashWarning', 'strength', 'blur', 'saturation', 'inset', 'fps', 'surfaceMultiplier', 'controlDensity', 'readingDensity', 'navigationDensity', 'language'];
  const route = new URL(location.href);
  route.pathname = '/watch';route.searchParams.set('fixture', 'warning');
  if (!route.searchParams.has('v')) route.searchParams.set('v', 'warning-source-1');
  history.replaceState(null, '', route);
  const player = document.querySelector('#movie_player'), video = document.querySelector('video');
  // Match the measured native topbar hosts before the controller discovers its
  // entry. Keep the warning fixture's source label and all existing controls.
  const masthead = document.querySelector('ytd-masthead');
  const sourceLabel = document.createElement('div');sourceLabel.id = 'background';sourceLabel.append(...masthead.childNodes);
  const topbarEnd = document.createElement('div');topbarEnd.id = 'end';
  topbarEnd.innerHTML = '<div id="buttons"><ytd-button-renderer><button class="fixture-native-topbar-button" aria-label="作成"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3h2v8h8v2h-8v8h-2v-8H3v-2h8z"/></svg><span>作成</span></button></ytd-button-renderer><ytd-notification-topbar-button-renderer><button class="fixture-native-topbar-button" aria-label="通知"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6 6 0 0 0-6 6v5l-2 3v1h16v-1l-2-3V9a6 6 0 0 0-6-6zm0 18a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2z"/></svg></button></ytd-notification-topbar-button-renderer><ytd-topbar-menu-button-renderer><button class="fixture-native-topbar-button" aria-label="アカウント"><span class="fixture-avatar">YT</span></button></ytd-topbar-menu-button-renderer></div>';
  masthead.append(sourceLabel, topbarEnd);
  const topbarStyle = document.createElement('style');
  topbarStyle.textContent = 'ytd-masthead{position:sticky;top:0;z-index:100;display:flex;align-items:center;gap:16px;height:56px;padding:0 16px}ytd-masthead>#background{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}ytd-masthead>#end,ytd-masthead #buttons{display:flex;align-items:center;flex-shrink:0}#buttons>:is(ytd-button-renderer,ytd-notification-topbar-button-renderer,ytd-topbar-menu-button-renderer){display:flex;align-items:center;height:40px}#buttons>ytd-button-renderer{width:90px;margin-right:8px}#buttons>ytd-notification-topbar-button-renderer{width:40px;margin-right:8px}#buttons>ytd-topbar-menu-button-renderer{width:40px}#buttons .fixture-native-topbar-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;width:100%;height:40px;padding:0;border:0;border-radius:20px;font:14px system-ui;background:transparent;color:inherit}#buttons>ytd-button-renderer .fixture-native-topbar-button{background:#ffffff1a}#buttons .fixture-native-topbar-button svg{width:24px;height:24px;fill:currentColor}#buttons .fixture-avatar{display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:#53698a;color:white;font-weight:600}';
  document.head.append(topbarStyle);
  const output = document.querySelector('#fixture-result'), listeners = new Set();
  const evidence = {
    boundary: 'Real static video -> original isolated Worker -> real controller -> YacFlashMonitor.sample numerical-only injection -> native ShadowRoot dialog',
    scope: 'Controller/modal integration only; synthetic pixels and synthetic clocks do not verify real-video detection accuracy, photosensitivity safety, or detection timing.',
    sourceFrames: 0, presentedVideoFrames: 0, ambientPresentationMarkers: 0,
    totalSamples: 0, realSamples: 0, injectedSamples: 0, monitorResets: 0, triggerCount: 0,
    armed: false, sequenceIndex: 0, virtualElapsedMs: 0, lastInput: null,
    source: route.searchParams.get('v'), armBaseline: null, lastTrigger: null,
    bubbleEvents: { click: 0, dblclick: 0, keydown: 0, keyup: 0 }, bubbleLog: [],
    outsideClicks: 0, storageWrites: [], storageWriteEvents: [], storageFailures: 0, failNextWrite: false,
    delayNextWrite: false, pendingWrites: 0,
    errors: [], fullscreenError: null, changedOpener: null
  };
  const readStored = key => {
    const raw = sessionStorage.getItem(namespace + key);
    if (raw === null) return undefined;
    try { return JSON.parse(raw); } catch { return undefined; }
  };
  globalThis.browser = {
    runtime: { getManifest: () => globalThis.yacFixtureManifest, getURL: filename => new URL(filename, location.origin + '/').href },
    storage: {
      onChanged: { addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener) },
      local: {
        get: async keys => {
          const names = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys || {});
          const values = {};
          for (const key of names) { const value = readStored(key);if (value !== undefined) values[key] = value; }
          return values;
        },
        set: async values => {
          const delayed = evidence.delayNextWrite;evidence.delayNextWrite = false;
          const writeSource = evidence.source, keys = Object.keys(values);
          const recordPhase = phase => {
            const time = performance.now();
            for (const key of keys) evidence.storageWriteEvents.push({ key, phase, time, source: writeSource });
            evidence.storageWriteEvents = evidence.storageWriteEvents.slice(-24);
          };
          recordPhase('start');
          evidence.pendingWrites++;inspect();
          try {
            if (delayed) await new Promise(resolve => setTimeout(resolve, 800));
            if (evidence.failNextWrite) {
              evidence.failNextWrite = false;evidence.storageFailures++;
              inspect();throw new Error('Fixture simulated setting-write failure');
            }
            const changes = {};
            for (const [key, value] of Object.entries(values)) {
              const oldValue = readStored(key);
              sessionStorage.setItem(namespace + key, JSON.stringify(value));
              changes[key] = { oldValue, newValue: value };
              evidence.storageWrites.push({ key, value });
            }
            evidence.storageWrites = evidence.storageWrites.slice(-12);
            recordPhase('success');
            queueMicrotask(() => { for (const listener of [...listeners]) listener(changes, 'local');inspect(); });
          } catch (error) {
            recordPhase('failure');throw error;
          } finally {
            evidence.pendingWrites--;inspect();
          }
        }
      }
    }
  };
  const bright = new Uint8ClampedArray(160 * 90 * 4).fill(255);
  const dark = new Uint8ClampedArray(160 * 90 * 4);
  for (let alpha = 3;alpha < dark.length;alpha += 4) dark[alpha] = 255;
  const originalSample = YacFlashMonitor.prototype.sample, originalReset = YacFlashMonitor.prototype.reset;
  let armedInstance = null, armedKey = null, injecting = false, armStart = 0;
  YacFlashMonitor.prototype.reset = function (...args) {
    evidence.monitorResets++;
    if (!injecting && evidence.armed && armedInstance === this) {
      evidence.sequenceIndex = 0;evidence.virtualElapsedMs = 0;armedInstance = null;armedKey = null;
    }
    return originalReset.apply(this, args);
  };
  YacFlashMonitor.prototype.sample = function (pixels, time, mediaTime, key, crop, playbackRate) {
    evidence.totalSamples++;
    evidence.lastInput = { pixelLength: pixels?.length || 0, sampleTime: time, mediaTime, sourceKey: key };
    if (!evidence.armed || !pixels || pixels.length !== 160 * 90 * 4) {
      evidence.realSamples++;
      return originalSample.call(this, pixels, time, mediaTime, key, crop, playbackRate);
    }
    if (armedInstance !== this || armedKey !== key) {
      originalReset.call(this);armedInstance = this;armedKey = key;evidence.sequenceIndex = 0;
    }
    const index = evidence.sequenceIndex;
    const syntheticTime = index * 100, syntheticMediaTime = index / 10;
    let triggered;
    injecting = true;
    try {
      triggered = originalSample.call(this, index % 2 ? dark : bright, syntheticTime, syntheticMediaTime,
        key, { x: 0, y: 0, width: 160, height: 90 }, playbackRate);
    } finally { injecting = false; }
    evidence.injectedSamples++;evidence.sequenceIndex = index + 1;evidence.virtualElapsedMs = syntheticTime;
    if (triggered) {
      evidence.armed = false;evidence.triggerCount++;
      evidence.lastTrigger = { source: evidence.source, time: performance.now(), injectedSampleCount: index + 1,
        virtualElapsedMs: syntheticTime, wallElapsedMs: performance.now() - armStart };
      inspect();
    } else if (index >= 80) {
      disarm();evidence.errors.push('Controlled numerical monitor did not trigger within 81 samples');inspect();
    }
    return triggered;
  };
  function disarm() {
    if (armedInstance) originalReset.call(armedInstance);
    evidence.armed = false;armedInstance = null;armedKey = null;evidence.sequenceIndex = 0;
  }
  function arm() {
    disarm();evidence.armed = true;armStart = performance.now();
    evidence.armBaseline = { videoTime: video.currentTime, paused: video.paused,
      strength: settingsState().strength, sourceFrames: evidence.sourceFrames, bubbleEvents: { ...evidence.bubbleEvents } };
    inspect();
  }
  const sourceCanvas = document.createElement('canvas');sourceCanvas.width = 640;sourceCanvas.height = 360;
  const sourceContext = sourceCanvas.getContext('2d', { alpha: false });
  function paintStaticSource() {
    sourceContext.fillStyle = '#385974';sourceContext.fillRect(0, 0, 640, 360);
    sourceContext.fillStyle = '#4d6982';sourceContext.fillRect(120, 90, 400, 180);
    sourceContext.fillStyle = '#eee';sourceContext.font = '22px system-ui';
    sourceContext.fillText('Constant local fixture video', 168, 185);
    evidence.sourceFrames++;sourceTrack?.requestFrame?.();
    requestAnimationFrame(paintStaticSource);
  }
  let sourceTrack = null;
  try {
    paintStaticSource();
    const stream = sourceCanvas.captureStream(30);sourceTrack = stream.getVideoTracks()[0];
    video.srcObject = stream;
    video.play().catch(error => { evidence.errors.push('Video autoplay: ' + error.message);inspect(); });
  } catch (error) { evidence.errors.push('Local captureStream unavailable: ' + error.message); }
  function watchVideoFrames() {
    if (!video.requestVideoFrameCallback) return;
    video.requestVideoFrameCallback(() => { evidence.presentedVideoFrames++;watchVideoFrames(); });
  }
  watchVideoFrames();
  for (const type of Object.keys(evidence.bubbleEvents)) player.addEventListener(type, event => {
    const hosts = event.composedPath().filter(node => node instanceof Element &&
      ['yac-flash-warning', 'yac-controls'].includes(node.id));
    if (!hosts.length) return;
    evidence.bubbleEvents[type]++;
    evidence.bubbleLog.push({ type, hosts: hosts.map(node => node.id), target: event.target?.id || event.target?.localName });
    evidence.bubbleLog = evidence.bubbleLog.slice(-12);inspect();
  });
  document.querySelector('#fixture-outside-probe').onclick = () => { evidence.outsideClicks++;inspect(); };
  document.querySelector('#fixture-arm').onclick = arm;
  document.querySelector('#fixture-disarm').onclick = () => { disarm();inspect(); };
  document.querySelector('#fixture-nav-reset').onclick = () => { disarm();document.dispatchEvent(new Event('yt-navigate-finish'));inspect(); };
  document.querySelector('#fixture-next-source').onclick = () => {
    disarm();const next = new URL(location.href);
    const number = Number((next.searchParams.get('v') || '').match(/(\d+)$/)?.[1]) || 1;
    evidence.source = 'warning-source-' + (number + 1);next.searchParams.set('v', evidence.source);
    history.replaceState(null, '', next);document.dispatchEvent(new Event('yt-navigate-finish'));arm();
  };
  document.querySelector('#fixture-fail-write').onclick = () => { evidence.failNextWrite = true;inspect(); };
  document.querySelector('#fixture-delay-write').onclick = () => { evidence.delayNextWrite = true;inspect(); };
  document.querySelector('#fixture-reset-events').onclick = () => {
    for (const type of Object.keys(evidence.bubbleEvents)) evidence.bubbleEvents[type] = 0;
    evidence.bubbleLog = [];inspect();
  };
  document.querySelector('#fixture-fullscreen').onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (player.requestFullscreen && document.fullscreenEnabled) await player.requestFullscreen();
      else evidence.fullscreenError = 'Native fullscreen is unavailable on this browser/surface';
    } catch (error) { evidence.fullscreenError = error.message; }
    inspect();
  };
  document.querySelector('#fixture-inspect').onclick = inspect;
  document.querySelector('#fixture-restore-opener').onclick = () => {
    const opener = document.querySelector('#fixture-arm');opener.disabled = opener.hidden = false;inspect();
  };
  function deepActive() {
    let element = document.activeElement;
    while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
    return element;
  }
  function settingsState() {
    const root = document.querySelector('#yac-controls')?.shadowRoot;
    const strength = root?.querySelector('#yac-strength');
    return { enabled: (root?.querySelector('#yac-enabled')||document.querySelector('#yac-enabled'))?.checked ?? null,
      flashWarning: root?.querySelector('#yac-flashWarning')?.checked ?? null,
      strength: strength ? Number(strength.value) : null,
      surfaceMultiplier: root?.querySelector('#yac-surfaceMultiplier') ? Number(root.querySelector('#yac-surfaceMultiplier').value) : null };
  }
  function rectangle(element) {
    if (!element) return null;
    const value = element.getBoundingClientRect();
    return { x: value.x, y: value.y, width: value.width, height: value.height };
  }
  function saveErrorState(hostId) {
    const root = document.querySelector('#' + hostId)?.shadowRoot;
    return root ? [...root.querySelectorAll('.save-error[role="alert"]')].map(alert => {
      const css = getComputedStyle(alert);
      return { text: alert.textContent.trim(), hidden: alert.hidden, display: css.display,
        visibility: css.visibility, rect: rectangle(alert),
        buttons: [...alert.querySelectorAll('button')].map(button => ({ text: button.textContent.trim(), disabled: button.disabled,
          ariaDisabled: button.getAttribute('aria-disabled'), ariaBusy: button.getAttribute('aria-busy') })) };
    }) : [];
  }
  function inspect() {
    const host = document.querySelector('#yac-flash-warning'), dialog = host?.shadowRoot?.querySelector('dialog');
    const active = deepActive(), canvas = document.querySelector('#yac-background');
    let modal = null, backdrop = null;
    try { modal = dialog?.matches(':modal') ?? false; } catch { /* Older selector engine. */ }
    if (dialog) {
      const css = getComputedStyle(dialog, '::backdrop');
      backdrop = { backgroundColor: css.backgroundColor, opacity: css.opacity, pointerEvents: css.pointerEvents };
    }
    const probe = document.querySelector('#fixture-outside-probe'), probeRect = rectangle(probe);
    const hit = probeRect ? document.elementFromPoint(probeRect.x + probeRect.width / 2, probeRect.y + probeRect.height / 2) : null;
    const preferences = Object.fromEntries(preferenceKeys.map(key => [key, readStored('yac-setting:' + key)]).filter(([, value]) => value !== undefined));
    const data = {
      ...evidence, pathname: location.pathname,
      storage: { namespace, scope: 'sessionStorage per-key; existing localStorage untouched', preferences },
      settings: settingsState(),
      saveErrors: { warning: saveErrorState('yac-flash-warning'), settings: saveErrorState('yac-controls') },
      dialog: { present: !!dialog, native: !!dialog && dialog instanceof HTMLDialogElement, open: dialog?.open || false, modal,
        role: dialog?.getAttribute('role') || null, title: host?.shadowRoot?.querySelector('h2')?.textContent || '',
        rect: rectangle(dialog), hostParent: host?.parentElement?.id || host?.parentElement?.localName || null,
        hostInsideFullscreen: !!document.fullscreenElement && host?.parentElement === document.fullscreenElement,
        backgroundColor: dialog ? getComputedStyle(dialog).backgroundColor : null, backdrop,
        focusInside: !!dialog && dialog.contains(active),
        focus: active ? { tag: active.localName, id: active.id, label: active.getAttribute('aria-label'), text: active.textContent?.trim().slice(0, 80) } : null,
        neverChecked: host?.shadowRoot?.querySelector('input[type="checkbox"]')?.checked ?? null },
      nativeInteraction: { outsideProbeRect: probeRect, hitElement: hit ? { tag: hit.localName, id: hit.id } : null,
        outsideClickCount: evidence.outsideClicks, playerRect: rectangle(player), fullscreenElement: document.fullscreenElement?.id || null,
        fullscreenAvailable: !!player.requestFullscreen && document.fullscreenEnabled },
      video: { currentTime: video.currentTime, paused: video.paused, readyState: video.readyState, playbackRate: video.playbackRate },
      ambient: canvas ? { mode: canvas.dataset.renderMode, workerState: canvas.dataset.workerState, backend: canvas.dataset.workerBackend,
        width: canvas.width, height: canvas.height, opacity: canvas.style.opacity, filter: canvas.style.filter,
        active: document.documentElement.classList.contains('yac-active') } : null
    };
    output.dataset.result = JSON.stringify(data);
    output.textContent = 'Boundary: numerical monitor injection only. ' +
      'Video ' + (video.paused ? 'paused' : 'playing') + '; Worker ' + (data.ambient?.workerState || 'loading') +
      '; warning ' + (data.dialog.modal ? 'native modal' : data.dialog.open ? 'open' : 'closed') +
      '; arm ' + (evidence.armed ? evidence.sequenceIndex + ' samples' : 'idle') +
      '; triggers ' + evidence.triggerCount + '; strength ' + data.settings.strength +
      '; warning preference ' + data.settings.flashWarning + '; failed writes ' + evidence.storageFailures +
      '; pending writes ' + evidence.pendingWrites + '; next write delayed ' + evidence.delayNextWrite +
      '; player bubbles ' + JSON.stringify(evidence.bubbleEvents);
    document.querySelector('#fixture-outside-count').textContent = ' clicks: ' + evidence.outsideClicks;
  }
  addEventListener('error', event => { evidence.errors.push(event.message);inspect(); });
  document.addEventListener('fullscreenchange', inspect);
  const runtime = document.createElement('script');runtime.src = '/ambient.js';
  runtime.onload = () => {
    const dialog = document.querySelector('#yac-flash-warning')?.shadowRoot?.querySelector('dialog');
    if (dialog) new MutationObserver(() => {
      if (!dialog.open) return;
      const mode = document.querySelector('#fixture-opener-state').value;
      const opener = document.querySelector('#fixture-arm');
      if (mode !== 'usable') {
        opener[mode] = true;evidence.changedOpener = { id: opener.id, mode };inspect();
      }
    }).observe(dialog, { attributes: true, attributeFilter: ['open'] });
    const canvas = document.querySelector('#yac-background');
    if (canvas) new MutationObserver(records => {
      evidence.ambientPresentationMarkers += records.filter(record => record.attributeName === 'data-blend').length;
    }).observe(canvas, { attributes: true, attributeFilter: ['data-blend'] });
    inspect();
  };
  document.body.append(runtime);
  setInterval(inspect, 500);
  inspect();
})();
