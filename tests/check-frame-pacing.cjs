'use strict';
const assert = require('node:assert/strict');
const { harness } = require('./check-ambient.cjs');
const FlashMonitor = require('../flash-monitor.js');
const total = h => h.renders.length + h.inspections.length;
const stop = h => h.event(h.document, 'yac-dispose');
const tick = h => h.tick({ delta: 1000 / 120 });
async function checkStartupBackground(workerMode) {
  const h = harness(workerMode, { videoFrameCallbacks: true });
  h.video.readyState = 0;h.video.paused = true;h.player.classList.add('unstarted-mode');
  const thumbnail = h.document.createElement('div');thumbnail.className = 'ytp-cued-thumbnail-overlay-image';
  thumbnail.style.setProperty('background-image', 'url("https://i.ytimg.com/vi/static/hqdefault.jpg")');h.player.append(thumbnail);
  await h.load({ enabled: true, flashWarning: false });
  const preview = h.get('yac-startup-background');
  assert.equal(preview.hidden, false, 'reuse the visible thumbnail before decoded frames exist');
  assert.ok(preview.style.getPropertyValue('background-image').includes('/vi/static/'));
  assert.equal(preview.parentElement, h.app);assert.equal(total(h), 0, 'thumbnail preview does not capture video or sample warning pixels');
  h.video.readyState = 4;h.event(h.video, 'loadeddata');h.flushWorkers();assert.equal(total(h), 0, 'unstarted native player still uses the thumbnail, not a blank decoded surface');
  h.player.classList.remove('unstarted-mode');h.video.paused = false;h.event(h.video, 'playing');h.presentVideoFrame();h.flushWorkers();
  assert.equal(preview.hidden, true, 'first accepted real background replaces the thumbnail');
  assert.ok(total(h) > 0);
  h.event(h.document, 'yt-navigate-start');h.setSearch('?v=second');h.video.readyState = 0;h.video.paused = true;h.player.classList.add('unstarted-mode');
  thumbnail.style.setProperty('background-image', 'url("https://i.ytimg.com/vi/second/hqdefault.jpg")');h.event(h.document, 'yt-navigate-finish');h.flushTasks();
  assert.equal(preview.hidden, false);assert.ok(preview.style.getPropertyValue('background-image').includes('/vi/second/'), 'navigation follows the current native thumbnail');
  const enabled = h.get('yac-enabled');enabled.checked = false;h.event(enabled, 'input');assert.equal(preview.hidden, true, 'ambient off removes the preview');
  enabled.checked = true;h.event(enabled, 'input');assert.equal(preview.hidden, false);
  h.document.fullscreenElement = h.player;h.event(h.document, 'fullscreenchange');assert.equal(preview.hidden, true);
  h.document.fullscreenElement = null;h.event(h.document, 'fullscreenchange');assert.equal(preview.hidden, false);
  stop(h);assert.equal(preview.isConnected, false);assert.ok(h.observers.every(observer => !observer.target));
  console.log(`PASS (${workerMode ? 'worker' : 'main'}): thumbnail startup, unstarted player, first-frame handoff, navigation and cleanup`);
}

async function checkCropRecovery(workerMode) {
  const h = harness(workerMode, { videoFrameCallbacks: true });await h.load({ enabled: true, flashWarning: false });
  const originalResult = h.renderer.result.bind(h.renderer);
  for (const crop of [{ x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 100, width: 160, height: 10 },
    { x: 0, y: 0, width: NaN, height: 90 }]) {
    h.renderer.result = () => ({ ...originalResult(), videoCrop: crop });h.presentVideoFrame();h.tick({ delta: 50 });
    assert.equal(h.video.style.getPropertyValue('clip-path'), '', 'invalid output restores native video instead of cutting out its full frame');
    assert.equal(h.player.classList.contains('yac-fill-bars'), false);
  }
  h.renderer.result = originalResult;h.presentVideoFrame();h.tick({ delta: 50 });assert.ok(h.video.style.getPropertyValue('clip-path'));
  const frame = [...h.videoFrames.values()][0];h.document.hidden = true;h.event(h.document, 'visibilitychange');
  assert.equal(h.video.style.getPropertyValue('clip-path'), '', 'tab departure synchronously releases the owned clip');
  frame?.(0, {});h.flushWorkers();assert.equal(h.video.style.getPropertyValue('clip-path'), '', 'a late frame cannot restore a hidden-tab clip');
  h.document.hidden = false;h.event(h.document, 'visibilitychange');h.presentVideoFrame();h.tick({ delta: 50 });
  assert.ok(h.video.style.getPropertyValue('clip-path'), 'a current visible frame restores black-bar replacement');stop(h);
  console.log(`PASS (${workerMode ? 'worker' : 'main'}): invalid crops, visibility release and current-frame recovery`);
}

async function checkPlaybackPriority(workerMode) {
  const h = harness(workerMode, { videoFrameCallbacks: true });
  await h.load({ enabled: true, flashWarning: true });
  const painted = total(h), reads = h.stats.rectReads;
  h.event(h.document, 'yt-navigate-start');
  for (let n = 0; n < 8; n++) tick(h);
  assert.equal(total(h), painted, 'navigation defers ambient capture');assert.equal(h.stats.rectReads, reads, 'navigation performs no per-frame layout reads');
  assert.equal(h.videoFrames.size, 0);
  h.event(h.video, 'playing');h.tick({ delta: 250 });
  assert.equal(total(h), painted, 'playing before navigation finish does not resume capture');
  assert.equal(h.videoFrames.size, 0);
  if (workerMode) assert.equal(h.worker.suspended, true, 'early playing retains navigation suspension');
  h.event(h.document, 'yt-navigate-finish');assert.equal(total(h), painted, 'navigation finish gives the native player its first frame');
  h.advance(8);h.presentVideoFrame();h.flushWorkers();
  assert.ok(total(h) > painted, 'the first presented native frame resumes capture immediately, before 200 ms or another animation tick');
  h.event(h.video, 'waiting');const waiting = total(h), waitingReads = h.stats.rectReads;
  for (let n = 0; n < 12; n++) tick(h);
  assert.equal(total(h), waiting);assert.equal(h.stats.rectReads, waitingReads, 'buffering stops pixel and layout work');
  h.event(h.video, 'playing');h.tick({ delta: 1000 });assert.equal(total(h), waiting, 'elapsed time alone never captures a stale frame');
  h.presentVideoFrame();h.flushWorkers();assert.ok(total(h) > waiting, 'the current native frame resumes background and warning consumers');
  h.event(h.video, 'waiting');h.video.paused = true;h.event(h.video, 'pause');tick(h);
  assert.ok(total(h) > waiting, 'paused preview is available without forcing video playback');
  h.video.paused = false;h.event(h.video, 'waiting');h.event(h.video, 'canplay');h.tick({ delta: 250 });
  assert.equal(h.videoFrames.size, 1, 'canplay recovers when the browser omits a subsequent playing event');
  const beforeCanplayFrame = total(h);h.presentVideoFrame();h.flushWorkers();assert.ok(total(h) > beforeCanplayFrame);
  stop(h);assert.equal(h.videoFrames.size, 0);assert.equal(h.raf.size, 0);
  const fallback = harness(workerMode);await fallback.load({ enabled: true, flashWarning: false });
  fallback.event(fallback.video, 'waiting');const beforeFallback = total(fallback);
  fallback.event(fallback.video, 'playing');fallback.flushWorkers();
  assert.ok(total(fallback) > beforeFallback, 'browsers without decoded-frame callbacks have no artificial timer or deadlock');stop(fallback);
  console.log(`PASS (${workerMode ? 'worker' : 'main'}): navigation/first-frame priority, buffering suspension, paused preview and resume`);
}

async function checkIdleFrameSubscriptions(workerMode) {
  const h = harness(workerMode, { videoFrameCallbacks: true });
  await h.load({ enabled: false, flashWarning: false, avoidBars: false, fillBars: true });
  assert.equal(h.videoFrames.size, 0, 'saved background/monitor OFF never subscribes to decoded frames');
  const edit = (key, checked) => { const field = h.get('yac-' + key);field.checked = checked;h.event(field, 'input'); };
  edit('enabled', true);tick(h);
  assert.equal(h.videoFrames.size, 1, 'background ON resumes one decoded-frame subscription');
  assert.ok(h.renders.length > 0, 'ON captures the current frame without waiting for a decoded callback');
  const retired = [...h.videoFrames.values()][0];
  edit('enabled', false);assert.equal(h.videoFrames.size, 0, 'turning both consumers OFF cancels decoded-frame subscription');
  const offJobs = total(h);retired(0, {});
  for (let n = 0; n < 100; n++) { h.presentVideoFrame();tick(h); }
  h.discover();
  assert.equal(h.videoFrames.size, 0, 'idle discovery and a cancelled callback cannot rearm while OFF');
  assert.equal(total(h), offJobs, 'idle frame input cannot submit video work');
  h.video.seeking = true;h.event(h.video, 'seeking');
  h.video.seeking = false;h.event(h.video, 'seeked');
  h.video.readyState = 0;h.event(h.video, 'emptied');
  h.video.currentSrc = 'test:idle-source';h.video.readyState = 4;h.event(h.video, 'loadeddata');
  assert.equal(h.videoFrames.size, 0, 'seek and loaded source events respect both consumers OFF');
  const replacement = h.document.createElement('video');
  Object.assign(replacement, { className: 'html5-main-video', videoWidth: 640, videoHeight: 360, readyState: 4,
    currentTime: 2, currentSrc: 'test:idle-element', paused: false, seeking: false,
    requestVideoFrameCallback: h.video.requestVideoFrameCallback, cancelVideoFrameCallback: h.video.cancelVideoFrameCallback });
  h.video.remove();h.player.append(replacement);h.discover();
  assert.equal(h.videoFrames.size, 0, 'replacing an idle video element cannot restart its subscription');
  edit('flashWarning', true);tick(h);
  assert.equal(h.videoFrames.size, 1, 'warning-only playback resumes one decoded-frame subscription');
  assert.equal(h.inspections.at(-1)[0], replacement, 'monitor resumes on the current replacement video');
  const warningPaints = h.renders.length, warningSamples = h.stats.monitorSamples;
  for (let n = 0; n < 12; n++) { replacement.currentTime += 1 / 30;h.presentVideoFrame();tick(h); }
  assert.equal(h.renders.length, warningPaints);assert.equal(h.stats.monitorSamples, warningSamples + 12, 'warning-only callbacks preserve every available monitoring sample');
  for (const args of h.inspections) {
    const options = args.at(-1);
    assert.equal(options.sampleOnly, true);assert.equal(options.avoidBars, false);
    assert.equal(options.fillBars, false, 'background OFF does not detect an unused display crop');
  }
  assert.equal(h.get('yac-fillBars').checked, true, 'sampling does not change the saved fill-bars preference');
  const pausedCallback = [...h.videoFrames.values()][0];
  replacement.paused = true;tick(h);pausedCallback(0, {});
  assert.equal(h.videoFrames.size, 0, 'paused warning-only playback does not retain a decoded-frame subscription');
  replacement.paused = false;replacement.currentTime += 1 / 30;tick(h);
  assert.equal(h.videoFrames.size, 1, 'warning-only playback resumes as media time advances without a new listener');
  h.setPath('/');h.event(h.document, 'yt-navigate-finish');
  assert.equal(h.videoFrames.size, 0, 'a retained video outside Watch does not keep frame notifications alive');
  h.setPath('/watch');h.event(h.document, 'yt-navigate-finish');tick(h);
  assert.equal(h.videoFrames.size, 1, 'returning to Watch primes warning-only notifications');
  const hiddenCallback = [...h.videoFrames.values()][0];
  h.document.hidden = true;h.event(h.document, 'visibilitychange');hiddenCallback(0, {});
  assert.equal(h.videoFrames.size, 0, 'hidden and late callbacks do not rearm monitoring');
  h.document.hidden = false;h.event(h.document, 'visibilitychange');tick(h);
  assert.equal(h.videoFrames.size, 1, 'visible warning-only playback resumes');
  edit('flashWarning', false);h.document.hidden = true;h.event(h.document, 'visibilitychange');
  h.document.hidden = false;h.event(h.document, 'visibilitychange');
  assert.equal(h.videoFrames.size, 0, 'resuming a both-OFF document does not subscribe');
  edit('enabled', true);tick(h);
  assert.equal(h.renders.at(-1).at(-1).fillBars, true, 'background ON restores its unchanged display-crop work');
  const fullscreenCallback = [...h.videoFrames.values()][0];
  h.document.fullscreenElement = h.player;h.event(h.document, 'fullscreenchange');fullscreenCallback(0, {});
  assert.equal(h.videoFrames.size, 0, 'fullscreen without warning monitoring has no decoded-frame consumer');
  h.document.fullscreenElement = null;h.event(h.document, 'fullscreenchange');tick(h);
  assert.equal(h.videoFrames.size, 1, 'leaving fullscreen resumes the background consumer');
  const disposedCallback = [...h.videoFrames.values()][0];stop(h);disposedCallback(0, {});
  assert.equal(h.videoFrames.size, 0, 'disposed callbacks cannot rearm');assert.equal(h.raf.size, 0);
  console.log(`PASS (${workerMode ? 'worker' : 'main'}): idle frame subscriptions, consumer restart, warning-only options, hidden/source/seek and disposal`);
}

async function checkPanelScrollBoundary(workerMode) {
  const h = harness(workerMode, { videoFrameCallbacks: true });
  await h.load({ enabled: true, flashWarning: false, avoidBars: false, fillBars: false, fps: 24 });
  h.video.paused = true;tick(h);
  const button = h.get('yac-settings-button');
  Object.assign(button.rect, { left: 1090, top: 8, width: 40, height: 40 });
  const scrollCorrections = [];
  h.window.scrollBy = options => scrollCorrections.push(options);
  let videoReads = 0;
  const readVideoRectangle = h.video.getBoundingClientRect.bind(h.video);
  h.video.getBoundingClientRect = () => { videoReads++;return readVideoRectangle(); };
  const panel = h.get('yac-controls');
  const activity = () => ({ reads: h.stats.rectReads, videoReads, captures: total(h),
    invalidates: h.stats.rendererInvalidates, resets: h.stats.rendererResets, corrections: scrollCorrections.length });
  const scroll = () => h.event(h.window, 'scroll');
  const listeners = h.window.listeners.get('scroll');
  assert.equal(listeners.length, 1);assert.equal(listeners[0].options.passive, true);

  const closed = activity();
  for (let n = 0; n < 10; n++) scroll();
  assert.deepEqual(activity(), closed, 'Closed settings do not measure, capture or invalidate on page scroll');
  button.click();h.get('yac-menu-rendering').click();
  const open = activity();
  assert.equal(panel.style.top, '60px');assert.equal(panel.style.right, '150px');
  assert.equal(panel.style.maxHeight, '652px');
  // Scrolling the video out of view no longer limits the header-anchored panel.
  h.player.rect.top = -200;h.video.rect.top = -200;
  scroll();
  assert.equal(panel.style.top, '60px');assert.equal(panel.style.maxHeight, '652px',
    'A player scrolled out of view does not shrink the fixed settings panel');
  button.rect.top = 20;button.rect.left = 1000;scroll();
  assert.equal(panel.style.top, '72px');assert.equal(panel.style.right, '240px');assert.equal(panel.style.maxHeight, '640px',
    'The panel follows the header entrance and uses the viewport below it');
  h.setViewport(260, 120);scroll();
  assert.equal(panel.style.width, '244px');assert.equal(panel.style.right, '8px');
  assert.equal(panel.style.top, '48px');assert.equal(panel.style.maxHeight, '64px',
    'A short/narrow viewport preserves the 64px header and outer margins');
  assert.ok(h.stats.rectReads > open.reads, 'Open settings measure their header entrance');
  assert.deepEqual({ ...activity(), reads: open.reads }, open,
    'Panel scroll placement does not measure video geometry, capture, invalidate or pull the page back');

  h.document.hidden = true;h.event(h.document, 'visibilitychange');
  const hidden = activity(), hiddenPlacement = { top: panel.style.top, right: panel.style.right, height: panel.style.maxHeight };
  h.player.rect.top -= 20;h.video.rect.top -= 20;button.rect.top += 10;
  for (let n = 0; n < 10; n++) scroll();
  assert.deepEqual(activity(), hidden, 'Hidden settings do not do scroll placement or background work');
  assert.deepEqual({ top: panel.style.top, right: panel.style.right, height: panel.style.maxHeight }, hiddenPlacement);
  stop(h);
  assert.equal(h.window.listeners.get('scroll').length, 0, 'Dispose removes the passive scroll listener');
  h.document.hidden = false;
  const disposed = activity();
  for (let n = 0; n < 10; n++) scroll();
  assert.deepEqual(activity(), disposed, 'Disposed scroll callbacks do not measure, capture or invalidate');
}

async function checkResizeNotifications(workerMode, videoFrameCallbacks) {
  const h = harness(workerMode, { videoFrameCallbacks });
  await h.load({ enabled: true, flashWarning: false, avoidBars: false, fillBars: false, fps: 24 });
  h.video.paused = true;h.resize();tick(h);
  const notifyWindow = () => h.event(h.window, 'resize');
  const pairedResize = change => {
    change();
    const before = total(h), invalidates = h.stats.rendererInvalidates;
    notifyWindow();
    assert.equal(total(h), before + 1, 'A real resize captures the paused frame immediately, before the FPS deadline');
    assert.equal(h.stats.rendererInvalidates, invalidates + 1);
    const revision = h.renders.at(-1).at(-1).revision;
    h.resize();notifyWindow();h.resize();
    assert.equal(h.stats.rendererInvalidates, invalidates + 1, 'The same window/Observer geometry invalidates once');
    assert.equal(total(h), before + 1, 'Duplicate notifications do not capture again');
    tick(h);
    assert.equal(total(h), before + 1, 'Duplicate notifications do not leave a forced paused repaint');
    assert.equal(h.renders.at(-1).at(-1).revision, revision, 'Duplicate geometry retains its submitted revision');
    const accepted = h.stats.workerAcceptedFrames;
    for (let n = 0; n < 10; n++) { notifyWindow();h.resize();tick(h); }
    assert.equal(total(h), before + 1, 'Ten unchanged resize pairs stay idle after the accepted frame');
    assert.equal(h.stats.rendererInvalidates, invalidates + 1);
    assert.equal(h.stats.workerAcceptedFrames, accepted);
  };
  pairedResize(() => { h.video.rect.left += 20; });
  pairedResize(() => { h.video.rect.width = 720;h.video.rect.height = 405; });
  pairedResize(() => { h.player.clientWidth += 30;h.player.rect.width += 30; });
  pairedResize(() => h.setViewport(1360, 800));

  const resizeTop = h.video.rect.top;
  h.video.rect.top -= 60;
  for (let n = 0; n < 6; n++) tick(h);
  assert.equal(h.renders.at(-1)[1].top, resizeTop - 60, 'Normal drawing observes the scrolled position');
  pairedResize(() => { h.video.rect.top = resizeTop; });
  assert.equal(h.renders.at(-1)[1].top, resizeTop, 'A return to the earlier resize position is not suppressed by stale state');

  const controls = h.document.createElement('div');controls.className = 'ytp-chrome-bottom';controls.offsetTop = 130;
  const button = h.get('yac-settings-button');
  Object.assign(button.rect, { left: 1090, top: 8, width: 40, height: 40 });
  h.player.append(controls);button.click();h.get('yac-menu-rendering').click();
  h.player.clientHeight = 160;h.player.rect.height = 160;
  const beforeShort = total(h);notifyWindow();
  const panel = h.get('yac-controls');
  assert.equal(panel.style.top, '60px');assert.equal(panel.style.right, '230px');
  assert.equal(panel.style.maxHeight, '732px', 'A short player does not restrict the viewport-anchored panel before any Worker result');
  assert.equal(total(h), beforeShort + 1);
  const shortInvalidates = h.stats.rendererInvalidates;
  controls.offsetTop = 100;button.rect.top += 12;button.rect.left -= 40;notifyWindow();h.resize();
  assert.equal(panel.style.top, '72px');assert.equal(panel.style.right, '270px');
  assert.equal(panel.style.maxHeight, '720px', 'Header-anchor movement updates placement while video/player geometry stays unchanged');
  assert.equal(h.stats.rendererInvalidates, shortInvalidates);
  tick(h);assert.equal(total(h), beforeShort + 1);

  h.document.hidden = true;h.event(h.document, 'visibilitychange');
  const hidden = { captures: total(h), reads: h.stats.rectReads, scans: h.stats.surfaceScans, invalidates: h.stats.rendererInvalidates };
  h.video.rect.left += 50;h.player.clientHeight = 180;h.player.rect.height = 180;
  h.setViewport(1440, 900);
  for (let n = 0; n < 10; n++) { notifyWindow();h.resize(); }
  assert.equal(total(h), hidden.captures);assert.equal(h.stats.rectReads, hidden.reads);
  assert.equal(h.stats.surfaceScans, hidden.scans);assert.equal(h.stats.rendererInvalidates, hidden.invalidates,
    'Hidden resize notifications do not measure, capture, scan or invalidate repeatedly');
  h.document.hidden = false;h.event(h.document, 'visibilitychange');tick(h);
  assert.equal(h.renders.at(-1)[1].left, h.video.rect.left);
  assert.equal(h.renders.at(-1)[2].width, 1440);
  const resumed = total(h), resumedInvalidates = h.stats.rendererInvalidates;
  notifyWindow();h.resize();tick(h);
  assert.equal(total(h), resumed);assert.equal(h.stats.rendererInvalidates, resumedInvalidates,
    'Resume drawing establishes the latest geometry before duplicate visible notifications');
  stop(h);
}

async function checkInFlightResize() {
  const h = harness(true, { videoFrameCallbacks: true });
  await h.load({ enabled: true, flashWarning: false, avoidBars: false, fillBars: false, fps: 24 });
  h.video.paused = true;h.resize();tick(h);
  const notifyWindow = () => h.event(h.window, 'resize');
  h.video.rect.left += 10;notifyWindow();
  const first = h.renders.at(-1), accepted = h.stats.workerAcceptedFrames;
  assert.ok(h.worker.pending);
  h.video.rect.left += 10;
  const beforeChange = total(h), invalidates = h.stats.rendererInvalidates;
  notifyWindow();h.resize();notifyWindow();
  assert.equal(total(h), beforeChange, 'An in-flight resize keeps a single capture outstanding');
  assert.equal(h.stats.rendererInvalidates, invalidates + 1, 'The changed geometry invalidates once despite duplicate notifications');
  h.flushWorkers();
  assert.equal(h.stats.workerAcceptedFrames, accepted, 'The old geometry is not presented after a real layout change');
  tick(h);
  assert.equal(total(h), beforeChange + 1);
  const current = h.renders.at(-1);
  assert.equal(current.at(-1).revision, first.at(-1).revision + 1);
  assert.equal(current[1].left, h.video.rect.left);
  stop(h);

  const preserved = harness(true, { videoFrameCallbacks: true });
  await preserved.load({ enabled: true, flashWarning: false, avoidBars: false, fillBars: false, fps: 24 });
  preserved.video.paused = true;preserved.resize();tick(preserved);
  preserved.video.rect.top += 15;preserved.event(preserved.window, 'resize');
  const pendingCapture = total(preserved), pendingInvalidates = preserved.stats.rendererInvalidates;
  const presentations = preserved.stats.workerAcceptedFrames;
  for (let n = 0; n < 10; n++) { preserved.resize();preserved.event(preserved.window, 'resize'); }
  assert.equal(total(preserved), pendingCapture);assert.equal(preserved.stats.rendererInvalidates, pendingInvalidates);
  preserved.flushWorkers();
  assert.equal(preserved.stats.workerAcceptedFrames, presentations + 1, 'Unchanged notifications preserve the current in-flight presentation');
  tick(preserved);assert.equal(total(preserved), pendingCapture);
  stop(preserved);
}

(async () => {
  for (const workerMode of [false, true]) {
    await checkPlaybackPriority(workerMode);
    await checkStartupBackground(workerMode);
    await checkCropRecovery(workerMode);
    await checkIdleFrameSubscriptions(workerMode);
    await checkPanelScrollBoundary(workerMode);
    console.log(`PASS (${workerMode ? 'worker' : 'main'}): header-anchor placement, short viewport, passive scroll and closed/hidden/disposed work boundaries`);
    for (const videoFrameCallbacks of [false, true]) await checkResizeNotifications(workerMode, videoFrameCallbacks);
    if (workerMode) await checkInFlightResize();
    console.log(`PASS (${workerMode ? 'worker' : 'main'}): paused window/player resize deduplication, immediate geometry, scroll return, header-anchor placement, hidden resume${workerMode ? ' and in-flight revisions' : ''}`);
    for (const videoFrameCallbacks of [false, true]) {
      const ui = harness(workerMode, { videoFrameCallbacks });
      await ui.load({ enabled: true, flashWarning: false, avoidBars: false, fillBars: false });
      ui.video.paused = true; tick(ui);
      const captures = total(ui), reads = ui.stats.rectReads;
      for (const [key, value] of [['surfaceMultiplier', 40], ['controlDensity', 70], ['readingDensity', 60], ['navigationDensity', 50], ['language', 'en']]) {
        const field = ui.get('yac-' + key); field.value = value; ui.event(field, 'input');
        assert.equal(total(ui), captures, key + ' does not force a duplicate video capture');
        assert.equal(ui.stats.rectReads, reads, key + ' does not probe background geometry');
      }
      assert.match(ui.get('yac-surface-palette').textContent, /--yac-reading-opacity:0\.177600/, 'UI-only edits still update their shared palette');
      for (let n = 0; n < 16; n++) tick(ui);
      assert.equal(total(ui), captures, 'UI edits do not leave a forced repaint latched for later ticks');
      ui.get('yac-blur').value = 80; ui.event(ui.get('yac-blur'), 'input'); tick(ui);
      assert.ok(total(ui) > captures, 'ambient preferences still repaint the paused current frame');
      stop(ui);
    }
    if (workerMode) {
      const heldUI = harness(true);
      await heldUI.load({ enabled: true, flashWarning: true });
      heldUI.tick({ flush: false });
      assert.ok(heldUI.worker.pending, 'a real Worker submission is still outstanding');
      const captures = total(heldUI), samples = heldUI.stats.monitorSamples;
      heldUI.get('yac-surfaceMultiplier').value = 20; heldUI.event(heldUI.get('yac-surfaceMultiplier'), 'input');
      heldUI.flushWorkers();
      assert.equal(total(heldUI), captures, 'shade edit cannot enqueue another capture behind a busy Worker');
      assert.equal(heldUI.stats.monitorSamples, samples + 1, 'shade edit preserves the in-flight frame for warning analysis');
      stop(heldUI);
    }
    const idle = harness(workerMode, { videoFrameCallbacks: true });
    await idle.load({ enabled: false, flashWarning: false, fps: 30 });
    tick(idle);
    const offActivity = idle.stats.activityReads, offResets = idle.stats.monitorResets;
    for (let n = 0; n < 360; n++) tick(idle);
    assert.equal(idle.stats.activityReads, offActivity, 'OFF without monitoring does not re-enter DOM activation on display ticks');
    assert.equal(idle.stats.monitorResets, offResets, 'OFF without monitoring does not repeatedly allocate/reset warning history');
    idle.enabled().checked = true; idle.event(idle.enabled(), 'input'); tick(idle);
    const readyActivity = idle.stats.activityReads;
    for (let n = 0; n < 360; n++) tick(idle);
    assert.ok(idle.stats.activityReads - readyActivity <= 92, 'a repeated video frame enters DOM work at background FPS, not display FPS');
    idle.video.readyState = 1;
    const beforeWait = idle.stats.monitorResets;
    tick(idle);
    assert.equal(idle.stats.monitorResets, beforeWait + 1, 'readiness loss clears warning history once even without an emptied event');
    assert.equal(idle.video.style.getPropertyValue('clip-path'), '', 'readiness loss restores the owned video crop');
    const waitingActivity = idle.stats.activityReads, waitingResets = idle.stats.monitorResets;
    for (let n = 0; n < 120; n++) tick(idle);
    assert.equal(idle.stats.activityReads, waitingActivity, 'waiting does not repeatedly enter DOM work');
    assert.equal(idle.stats.monitorResets, waitingResets, 'waiting does not repeatedly reset warning history');
    idle.video.remove(); idle.discover(); tick(idle);
    assert.equal(idle.document.documentElement.classList.contains('yac-active'), false, 'video removal during an existing wait still deactivates native styling');
    idle.player.append(idle.video); idle.discover(); tick(idle);
    idle.video.readyState = 4; idle.presentVideoFrame(); tick(idle);
    assert.ok(idle.video.style.getPropertyValue('clip-path'), 'new available frame restores cropping after readiness returns');
    idle.video.remove(); idle.discover(); tick(idle);
    assert.equal(idle.document.documentElement.classList.contains('yac-active'), false, 'video removal deactivates native UI styling');
    const missingActivity = idle.stats.activityReads;
    for (let n = 0; n < 120; n++) tick(idle);
    assert.equal(idle.stats.activityReads, missingActivity, 'missing video does not repeatedly enter DOM work');
    idle.player.append(idle.video); idle.discover(); tick(idle);
    assert.equal(idle.document.documentElement.classList.contains('yac-active'), true, 'video replacement reactivates native UI styling');
    idle.document.hidden = true; idle.event(idle.document, 'visibilitychange'); tick(idle);
    const hiddenActivity = idle.stats.activityReads, hiddenResets = idle.stats.monitorResets;
    for (let n = 0; n < 120; n++) tick(idle);
    assert.equal(idle.stats.activityReads, hiddenActivity, 'hidden tab does not repeatedly enter DOM work');
    assert.equal(idle.stats.monitorResets, hiddenResets, 'hidden tab does not repeatedly reset warning history');
    idle.document.hidden = false; idle.event(idle.document, 'visibilitychange'); tick(idle);
    assert.ok(idle.video.style.getPropertyValue('clip-path'), 'visibility restoration resumes current-frame drawing');
    stop(idle);

    for (const fps of [24, 30, 60]) {
      const h = harness(workerMode, { videoFrameCallbacks: true });
      await h.load({ fps });
      const before = total(h), painted = h.renders.length, sampled = h.stats.monitorSamples;
      for (let n = 0; n < 360; n++) {
        if (n % 4 === 0) h.presentVideoFrame();
        tick(h);
      }
      assert.equal(total(h) - before, 90, '30 FPS video is captured once per frame on a 120 Hz display');
      assert.equal(h.stats.monitorSamples - sampled, 90, 'warning observes every available frame independently of background FPS');
      const paintCount = h.renders.length - painted;
      assert.ok(paintCount >= Math.min(fps, 30) * 3 - 2 && paintCount <= Math.min(fps, 30) * 3,
        `background pacing stays near ${Math.min(fps, 30)} FPS: ${paintCount} frames/3s`);
      assert.equal(h.videoFrames.size, 1, 'only one video callback remains registered');
      stop(h); assert.equal(h.videoFrames.size, 0);
    }

    const warningCadence = harness(workerMode, { videoFrameCallbacks: true });
    await warningCadence.load({ fps: 24 });
    for (let n = 0; n < 480; n++) { if (n % 4 === 0) warningCadence.presentVideoFrame(); tick(warningCadence); }
    const samples = [...warningCadence.renders, ...warningCadence.inspections].map(args => args.at(-1)).sort((a, b) => a.sampleTime - b.sampleTime);
    const monitor = new FlashMonitor(), pixels = new Uint8ClampedArray(160 * 90 * 4);
    let triggeredAt;
    for (const options of samples) {
      pixels.fill(Math.floor(options.mediaTime * 8) % 2 ? 255 : 0);
      if (monitor.sample(pixels, options.sampleTime, options.mediaTime, 'paced', undefined, 1)) triggeredAt ??= options.sampleTime;
    }
    assert.ok(triggeredAt >= 3000 && triggeredAt <= 4000, 'actual flash monitor retains its sustained three-second trigger on paced capture timestamps');
    stop(warningCadence);

    const replacement = harness(workerMode, { videoFrameCallbacks: true });
    await replacement.load({});
    const oldElementCallback = [...replacement.videoFrames.values()][0];
    const nextVideo = replacement.document.createElement('video');
    Object.assign(nextVideo, { className: 'html5-main-video', videoWidth: 640, videoHeight: 360, readyState: 4,
      currentTime: 2, currentSrc: 'test:new-element', paused: false, seeking: false,
      requestVideoFrameCallback: replacement.video.requestVideoFrameCallback,
      cancelVideoFrameCallback: replacement.video.cancelVideoFrameCallback });
    replacement.video.remove(); replacement.player.append(nextVideo); replacement.discover(); tick(replacement);
    assert.equal(replacement.renders.at(-1)[0], nextVideo, 'replacement video element receives the forced capture');
    const afterReplacement = total(replacement); oldElementCallback(0, {}); tick(replacement);
    assert.equal(total(replacement), afterReplacement, 'old video callback cannot schedule replacement captures');
    assert.equal(replacement.videoFrames.size, 1); stop(replacement);

    const h = harness(workerMode, { videoFrameCallbacks: true });
    await h.load({ fps: 24 });
    h.presentVideoFrame(); tick(h);
    const afterSample = total(h);
    const layoutReads = h.stats.computedStyleReads;
    for (let n = 0; n < 8; n++) tick(h);
    assert.equal(total(h), afterSample, 'sample-only frame is not recaptured when a later paint deadline arrives');
    assert.ok(h.stats.computedStyleReads - layoutReads <= 2, 'no new video frame probes layout at background FPS instead of every 120 Hz tick');
    h.presentVideoFrame(); tick(h);
    assert.equal(total(h), afterSample + 1, 'latched paint deadline uses the next new video frame');

    const beforeResize = h.renders.length;
    h.video.rect.left += 20; h.resize(); tick(h);
    assert.ok(h.renders.length > beforeResize, 'geometry change can repaint without a new video frame');
    const beforePreference = h.renders.length;
    h.get('yac-inset').value = 10; h.event(h.get('yac-inset'), 'input'); tick(h);
    assert.ok(h.renders.length > beforePreference, 'preference changes force a repaint of the current frame');

    h.video.paused = true; h.renderer.stableFrames = 0;
    const beforeSettle = h.renders.length;
    for (let n = 0; n < 16; n++) tick(h);
    assert.ok(h.renders.length > beforeSettle, 'paused black-band detection can converge without video callbacks');
    h.renderer.stableFrames = 4;
    const settled = total(h); for (let n = 0; n < 16; n++) tick(h);
    assert.equal(total(h), settled, 'settled paused frame stops capturing');
    h.video.paused = false;

    const oldSeekCallback = [...h.videoFrames.values()][0];
    h.video.seeking = true; h.event(h.video, 'seeking');
    assert.equal(h.videoFrames.size, 0, 'seek cancels callback');
    const seeking = total(h); tick(h); assert.equal(total(h), seeking);
    h.video.seeking = false; h.event(h.video, 'seeked'); tick(h);
    assert.ok(total(h) > seeking, 'seeked forces a fresh capture without waiting for a callback');
    const afterSeek = total(h); oldSeekCallback(0, {}); tick(h);
    assert.equal(total(h), afterSeek, 'cancelled seek callback cannot mark a new frame or resubscribe');
    assert.equal(h.videoFrames.size, 1);

    h.enabled().checked = false; h.event(h.enabled(), 'input'); tick(h);
    const offReads = h.stats.computedStyleReads;
    for (let n = 0; n < 12; n++) tick(h);
    assert.equal(h.stats.computedStyleReads, offReads, 'ambient OFF with no new video frame does not force layout for monitoring');
    h.enabled().checked = true; h.event(h.enabled(), 'input'); tick(h);

    h.video.readyState = 0; h.event(h.video, 'emptied');
    assert.equal(h.videoFrames.size, 0);
    const empty = total(h); tick(h); assert.equal(total(h), empty);
    h.video.currentSrc = 'test:replacement'; h.video.readyState = 4; h.event(h.video, 'loadeddata'); tick(h);
    assert.ok(total(h) > empty, 'same-element source replacement refreshes current-frame capture');
    assert.equal(h.videoFrames.size, 1);

    const hiddenCallback = [...h.videoFrames.values()][0];
    h.document.hidden = true; h.event(h.document, 'visibilitychange');
    assert.equal(h.videoFrames.size, 0);
    const hidden = total(h); hiddenCallback(0, {}); tick(h); assert.equal(total(h), hidden);
    h.document.hidden = false; h.event(h.document, 'visibilitychange'); tick(h);
    assert.ok(total(h) > hidden, 'visibility restoration primes capture');
    assert.equal(h.videoFrames.size, 1);

    if (workerMode) {
      h.worker.pending = true; h.presentVideoFrame(); const busy = total(h); tick(h);
      assert.equal(total(h), busy, 'busy preflight does not capture');
      h.worker.pending = false; tick(h);
      assert.equal(total(h), busy + 1, 'busy preflight does not consume the new-frame serial');
      const draw = h.worker.draw;
      h.worker.draw = () => false; h.presentVideoFrame(); const rejected = total(h); tick(h);
      h.worker.draw = draw; tick(h);
      assert.equal(total(h), rejected + 1, 'a draw rejected after preflight does not consume its serial');
      h.presentVideoFrame(); h.tick({ delta: 1000 / 120, flush: false });
      const held = total(h);
      h.presentVideoFrame(); h.presentVideoFrame(); h.tick({ delta: 1000 / 120, flush: false });
      assert.equal(total(h), held, 'in-flight frame does not accumulate a capture queue');
      h.flushWorkers(); tick(h);
      assert.equal(total(h), held + 1, 'latest callback survives completion of an older in-flight frame');
      h.worker.callbacks.onFailure(); tick(h);
      assert.equal(h.get('yac-background').dataset.renderMode, 'main', 'Worker fallback remains available with frame pacing');
    }
    const disposedCallback = [...h.videoFrames.values()][0]; stop(h);
    disposedCallback(0, {});
    assert.equal(h.videoFrames.size, 0, 'late callback after disposal cannot rearm');
    assert.equal(h.raf.size, 0);

    const fallback = harness(workerMode);
    await fallback.load({ fps: 30 }); const fallbackBefore = total(fallback);
    for (let n = 0; n < 12; n++) tick(fallback);
    assert.ok(total(fallback) > fallbackBefore, 'unsupported video-frame callbacks preserve existing sampling');
    stop(fallback);
    console.log(`PASS (${workerMode ? 'worker' : 'main'}): decoded-frame pacing, warning cadence, force repaint, pause, seek, source, hidden and disposal`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
