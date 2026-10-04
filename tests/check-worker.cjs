'use strict';
// Numerical images and fake transports exercise lifecycle without flashing UI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

class Bitmap {
  constructor(width = 320, height = 180, data = null) {
    this.width = width; this.height = height; this.data = data; this.closed = 0;
  }
  close() { this.closed++; }
}
class Canvas {
  constructor(width = 400, height = 400) {
    this.width = width; this.height = height;
    this.context = {
      draws: [], drawImage: (...args) => {
        this.context.draws.push(args);
        const source = args[0];
        if (!source.data || (source.width === this.width && source.height === this.height)) {
          this.data = source.data; return;
        }
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
        for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
          const from = (Math.floor(y * source.height / this.height) * source.width + Math.floor(x * source.width / this.width)) * 4;
          this.data.set(source.data.subarray(from, from + 4), (y * this.width + x) * 4);
        }
      },
      getImageData: () => ({ data: this.data || new Uint8ClampedArray(this.width * this.height * 4) }),
      createImageData: (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
      putImageData: value => { this.data = value.data; }
    };
  }
  getContext(type) { return type === '2d' ? this.context : null; }
  transferToImageBitmap() { this.transfers = (this.transfers || 0) + 1; return new Bitmap(this.width, this.height, this.data); }
}
const run = (context, name) => vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), context, { filename: name });
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

function harness({ captureThrows = false, accepted = true, dataset = true, connectionFailure = '' } = {}) {
  const nodes = [], captures = [], channels = [], timers = new Map(), frames = [], failures = [];
  let timerId = 0;
  class Port {
    postMessage(value, transfers = []) { this.sent.push({ value, transfers }); }
    start() {
      if (connectionFailure === 'start') throw new Error('Injected port start failure');
    }
    close() { this.closed = true; }
    constructor() {
      this.sent = [];
      if (connectionFailure === 'handler') Object.defineProperty(this, 'onmessage', {
        set() { throw new Error('Injected handler setup failure'); }
      });
    }
  }
  class Channel {
    constructor() {
      if (connectionFailure === 'constructor') throw new Error('Injected channel construction failure');
      this.port1 = new Port(); this.port2 = new Port(); channels.push(this);
    }
  }
  const context = vm.createContext({
    URL, Uint8Array, Uint8ClampedArray, crypto: { getRandomValues: array => array.fill(1) },
    location: { href: 'https://www.youtube.com/watch?v=test' }, MessageChannel: Channel,
    setTimeout: (callback, delay) => { callback.delay = delay;timers.set(++timerId, callback);return timerId; },
    clearTimeout: id => timers.delete(id), queueMicrotask,
    createImageBitmap: (source, options) => {
      if (captureThrows) throw new Error('Unavailable');
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      captures.push({ source, options, resolve, reject }); return promise;
    },
    document: {
      documentElement: { append: node => nodes.push(node) },
      createElement: () => ({ setAttribute() {}, style: {}, contentWindow: {
        connections: [],
        postMessage(value, target, transfers) {
          if (connectionFailure === 'transfer') throw new Error('Injected port transfer failure');
          this.connection = { value, target, transfers }; this.connections.push(this.connection);
        }
      }, remove() { this.removed = true; } })
    }
  });
  run(context, 'worker-client.js');
  const canvas = new Canvas();
  if (dataset) canvas.dataset = {};
  const client = new context.YacWorkerRenderer(canvas, {
    hostUrl: 'chrome-extension://test/worker-host.html',
    onFrame: (result, meta) => frames.push({ result, meta }),
    onFailure: reason => failures.push(reason), acceptFrame: () => accepted
  });
  const ready = () => { nodes[0].onload(); client.receive({ type: 'ready' }); };
  return { client, canvas, nodes, captures, channels, timers, frames, failures, ready };
}
const source = { currentSrc: 'video:test', currentTime: 4 };
const rectangle = { left: 10, top: 20, width: 640, height: 360 };
const viewport = { width: 1280, height: 720 };
const result = (client, extra = {}) => ({
  type: 'frame', requestId: client.pending.requestId, generation: client.pending.generation,
  bitmap: new Bitmap(400, 320), pixels: null, readable: true, cropped: false,
  videoCrop: { x: 0, y: 0, width: 160, height: 90 },
  samplingCrop: { x: 0, y: 0, width: 160, height: 90 },
  sampleOnly: false, stableFrames: 4, ...extra
});

function processingWorker() {
  const replies = [];
  class WorkerCanvas extends Canvas {
    constructor(...args) {
      super(...args);
      const draw = this.context.drawImage;
      this.context.drawImage = (...values) => {
        if (values[0]?.failDraw) throw new Error('Injected worker draw failure');
        draw(...values);
      };
    }
  }
  const context = vm.createContext({ OffscreenCanvas: WorkerCanvas, Uint8ClampedArray, Error,
    self: { postMessage: value => replies.push(value) },
    importScripts: (...names) => names.forEach(name => run(context, name)) });
  run(context, 'ambient-worker.js');
  assert.equal(replies[0].type, 'ready');
  return job => {
    const before = replies.length;
    context.self.onmessage({ data: job });
    assert.equal(replies.length, before + 1, 'Actual Worker replies once per processed job');
    return replies.at(-1);
  };
}

(async () => {
  const h = harness();
  assert.equal(h.canvas.dataset.workerState, 'starting');
  assert.equal(h.client.canAcceptFrame(), false, 'Preflight rejects startup without capturing');
  assert.equal(h.client.draw(source, rectangle, viewport, true), false, 'Starting transport does not capture');
  h.ready();
  assert.equal(h.canvas.dataset.workerState, 'ready');
  assert.equal(h.client.canAcceptFrame(), true, 'Ready transport accepts work');
  assert.equal(h.channels[0].port1.sent.length, 0);
  assert.equal(h.nodes[0].contentWindow.connection.target, 'chrome-extension://test');
  assert.equal(h.client.draw(source, rectangle, viewport, true, { readPixels: true, fillBars: true }), true);
  assert.equal(h.client.canAcceptFrame(), false, 'Preflight includes asynchronous capture ownership');
  for (let i = 0; i < 100; i++) assert.equal(h.client.draw(source, rectangle, viewport, true), false);
  assert.equal(h.captures.length, 1, 'Backpressure covers capture, with no pending queue');
  const captured = new Bitmap(); h.captures[0].resolve(captured); await settle();
  assert.equal(h.channels[0].port1.sent.length, 1);
  assert.equal(h.client.canAcceptFrame(), false, 'Preflight remains busy during Worker processing');
  const job = h.channels[0].port1.sent[0].value;
  assert.equal(job.frame, captured); assert.equal(job.sourceKey, source.currentSrc);
  assert.equal(job.barGeneration, 0);
  assert.equal(job.mediaTime, 4);
  assert.equal(h.captures[0].options.resizeWidth, 320);
  assert.equal(h.captures[0].options.resizeHeight, 180);
  assert.equal(job.options.readPixels, true);
  assert.equal(job.options.sampleOnly, false);
  assert.equal(job.options.fillBars, true);
  const image = result(h.client, { pixels: new Uint8ClampedArray(160 * 90 * 4) });
  h.client.receive(image);
  assert.equal(image.bitmap.closed, 1); assert.equal(h.frames.length, 1);
  assert.equal(h.frames[0].meta.source, source); assert.equal(h.frames[0].meta.mediaTime, 4);
  assert.equal(h.client.readPixels().length, 160 * 90 * 4);
  assert.equal(h.client.pending, null); assert.equal(h.canvas.context.draws.length, 1);
  assert.equal(h.client.canAcceptFrame(), true, 'Presentation releases preflight backpressure');

  const noDataset = harness({ dataset: false });
  noDataset.ready(); assert.equal(noDataset.client.canAcceptFrame(), true);
  noDataset.client.dispose(); assert.equal(noDataset.client.canAcceptFrame(), false, 'Dataset is optional');
  const failedState = harness({ captureThrows: true }); failedState.ready();
  assert.equal(failedState.client.draw(source, rectangle, viewport, true), false);
  assert.equal(failedState.canvas.dataset.workerState, 'failed');
  assert.equal(failedState.client.canAcceptFrame(), false, 'Failed transport rejects further work');
  failedState.client.dispose();
  assert.equal(failedState.canvas.dataset.workerState, 'disposed');

  h.client.draw(source, rectangle, viewport, true);
  const oldGeneration = h.client.generation;
  h.client.reset();
  assert.equal(h.client.generation, oldGeneration + 1);
  assert.equal(h.client.draw(source, rectangle, viewport, true), false, 'Reset does not start a burst');
  const staleCapture = new Bitmap(); h.captures[1].resolve(staleCapture); await settle();
  assert.equal(staleCapture.closed, 1); assert.equal(h.client.pending, null);
  assert.equal(h.channels[0].port1.sent.length, 1, 'Invalidated capture is not transferred');

  h.client.draw(source, rectangle, viewport, true);
  h.captures[2].resolve(new Bitmap()); await settle();
  const stale = result(h.client); h.client.reset(); h.client.receive(stale);
  assert.equal(stale.bitmap.closed, 1); assert.equal(h.frames.length, 1);
  assert.equal(h.client.pending, null); assert.equal(h.client.readPixels(), null);
  assert.equal(h.canvas.context.draws.length, 1, 'Old worker result is never presented');

  for (const sampleOnly of [false, true]) {
    for (const transition of ['reset', 'invalidate', 'hidden-reset']) {
      const staleFailure = harness(); staleFailure.ready();
      assert.equal(staleFailure.client.draw(source, rectangle, viewport, true, { sampleOnly }), true);
      if (transition === 'hidden-reset') staleFailure.client.setSuspended(true);
      if (transition === 'invalidate') staleFailure.client.invalidate();
      else staleFailure.client.reset();
      assert.equal(staleFailure.client.draw(source, rectangle, viewport, true, { sampleOnly }), false,
        'Invalidated capture retains backpressure until its failure settles');
      staleFailure.captures[0].reject(new Error('Previous video capture became unavailable'));
      await settle();
      assert.equal(staleFailure.client.state, 'ready', transition + ': obsolete capture failure keeps the Worker');
      assert.equal(staleFailure.failures.length, 0, transition + ': obsolete capture failure does not invoke fallback');
      assert.equal(staleFailure.client.pending, null, transition + ': obsolete capture failure releases only its job');
      assert.equal(staleFailure.timers.size, 0, transition + ': obsolete capture failure clears its watchdog');
      assert.equal(staleFailure.nodes[0].removed, undefined);
      assert.equal(staleFailure.channels[0].port1.closed, undefined);
      assert.equal(staleFailure.captures.length, 1, 'No replacement capture is queued automatically');
      if (transition === 'hidden-reset') {
        assert.equal(staleFailure.client.canAcceptFrame(), false, 'Hidden transport stays suspended after the obsolete failure');
        staleFailure.client.setSuspended(false);
      }
      assert.equal(staleFailure.client.canAcceptFrame(), true);
      assert.equal(staleFailure.client.draw(source, rectangle, viewport, true, { sampleOnly }), true,
        transition + ': a current capture can follow the obsolete failure');
      staleFailure.captures[1].resolve(new Bitmap()); await settle();
      staleFailure.client.receive(result(staleFailure.client, sampleOnly ? {
        sampleOnly: true, bitmap: null, pixels: new Uint8ClampedArray(160 * 90 * 4)
      } : {}));
      assert.equal(staleFailure.frames.length, 1, transition + ': the next current frame is delivered');
      assert.equal(staleFailure.failures.length, 0);
      assert.equal(staleFailure.client.pending, null);
      staleFailure.client.dispose();
    }
  }
  for (const sampleOnly of [false, true]) {
    for (const transition of ['reset', 'invalidate', 'hidden-reset']) {
      const oldFailure = harness(), processJob = processingWorker(); oldFailure.ready();
      const options = { sampleOnly, avoidBars: false, readPixels: sampleOnly };
      oldFailure.client.draw(source, rectangle, viewport, false, options);
      const oldCapture = new Bitmap(); oldCapture.failDraw = true;
      oldFailure.captures[0].resolve(oldCapture); await settle();
      const oldJob = oldFailure.channels[0].port1.sent.at(-1).value;
      const failedJob = processJob(oldJob);
      assert.equal(failedJob.type, 'failed'); assert.equal(failedJob.requestId, oldJob.requestId);
      assert.equal(failedJob.generation, oldJob.generation);
      assert.equal(failedJob.reason, 'Injected worker draw failure'); assert.equal(oldCapture.closed, 1);
      if (transition === 'hidden-reset') oldFailure.client.setSuspended(true);
      if (transition === 'invalidate') oldFailure.client.invalidate();
      else oldFailure.client.reset();
      assert.equal(oldFailure.client.draw(source, rectangle, viewport, false, options), false,
        'Obsolete processing retains backpressure until its reply arrives');
      oldFailure.client.receive(failedJob);
      assert.equal(oldFailure.client.state, 'ready', transition + ': obsolete Worker failure keeps the transport');
      assert.equal(oldFailure.failures.length, 0); assert.equal(oldFailure.client.pending, null);
      assert.equal(oldFailure.timers.size, 0); assert.equal(oldFailure.nodes[0].removed, undefined);
      assert.equal(oldFailure.channels[0].port1.closed, undefined);
      assert.equal(oldFailure.captures.length, 1, 'Obsolete failure does not enqueue a replacement capture');
      oldFailure.client.receive(failedJob);
      assert.equal(oldFailure.client.state, 'ready', 'Duplicate completed failure cannot disable the transport');
      if (transition === 'hidden-reset') {
        assert.equal(oldFailure.client.canAcceptFrame(), false, 'Hidden transport remains suspended');
        oldFailure.client.setSuspended(false);
      }
      assert.equal(oldFailure.client.draw(source, rectangle, viewport, false, options), true);
      const nextCapture = new Bitmap(); oldFailure.captures[1].resolve(nextCapture); await settle();
      const nextJob = oldFailure.channels[0].port1.sent.at(-1).value, nextPending = oldFailure.client.pending;
      oldFailure.client.receive(failedJob);
      oldFailure.client.receive({ ...failedJob, requestId: nextJob.requestId });
      oldFailure.client.receive({ ...failedJob, generation: nextJob.generation });
      assert.equal(oldFailure.client.pending === nextPending, true,
        'Duplicate, wrong-generation and wrong-ID failures cannot release the current job');
      assert.equal(oldFailure.timers.size, 1); assert.equal(oldFailure.failures.length, 0);
      const nextReply = processJob(nextJob);
      assert.equal(nextReply.type, 'frame', 'Actual Worker recovers on the next valid source');
      assert.equal(nextReply.sampleOnly, sampleOnly); assert.equal(nextCapture.closed, 1);
      oldFailure.client.receive(nextReply);
      assert.equal(oldFailure.frames.length, 1); assert.equal(oldFailure.client.pending, null);
      assert.equal(oldFailure.canvas.context.draws.length, sampleOnly ? 0 : 1);
      if (sampleOnly) assert.equal(oldFailure.client.readPixels().length, 160 * 90 * 4);
      else assert.equal(nextReply.bitmap.closed, 1, 'Recovered output bitmap is released once');
      assert.equal(oldFailure.client.canAcceptFrame(), true); assert.equal(oldFailure.timers.size, 0);
      oldFailure.client.receive(failedJob); assert.equal(oldFailure.failures.length, 0);
      oldFailure.client.dispose(); oldFailure.client.receive(failedJob);
      assert.equal(oldFailure.client.state, 'disposed'); assert.equal(oldFailure.timers.size, 0);
      assert.equal(oldFailure.failures.length, 0, 'Late processing failure cannot restart or fail disposed transport');
    }
    const currentFailure = harness(), processJob = processingWorker(); currentFailure.ready();
    currentFailure.client.draw(source, rectangle, viewport, false, { sampleOnly, avoidBars: false });
    const captured = new Bitmap(); captured.failDraw = true;
    currentFailure.captures[0].resolve(captured); await settle();
    const failedJob = processJob(currentFailure.channels[0].port1.sent.at(-1).value);
    currentFailure.client.receive(failedJob); currentFailure.client.receive(failedJob);
    assert.equal(currentFailure.client.state, 'failed', 'Actual current-job processing failure still invokes fallback');
    assert.equal(currentFailure.failures.length, 1, 'Duplicate current failure invokes fallback once');
    assert.equal(captured.closed, 1); assert.equal(currentFailure.client.pending, null);
    assert.equal(currentFailure.timers.size, 0); assert.equal(currentFailure.nodes[0].removed, true);
    assert.equal(currentFailure.channels[0].port1.closed, true); currentFailure.client.dispose();
  }
  for (const state of ['starting', 'ready', 'obsolete-pending']) {
    const connectionFailure = harness();
    if (state !== 'starting') connectionFailure.ready();
    if (state === 'obsolete-pending') {
      connectionFailure.client.draw(source, rectangle, viewport, false);
      connectionFailure.captures[0].resolve(new Bitmap()); await settle();
      connectionFailure.client.reset();
    }
    connectionFailure.client.receive({ type: 'failed', reason: 'Worker connection failed' });
    assert.equal(connectionFailure.client.state, 'failed', state + ': unscoped connection failures still invoke fallback');
    assert.equal(connectionFailure.failures.length, 1); assert.equal(connectionFailure.client.pending, null);
    assert.equal(connectionFailure.timers.size, 0); assert.equal(connectionFailure.nodes[0].removed, true);
    connectionFailure.client.dispose();
  }
  const currentCaptureFailure = harness(); currentCaptureFailure.ready();
  currentCaptureFailure.client.draw(source, rectangle, viewport, true);
  currentCaptureFailure.captures[0].reject(new Error('Current capture is unavailable')); await settle();
  assert.equal(currentCaptureFailure.client.state, 'failed', 'Current capture failure still invokes fallback');
  assert.equal(currentCaptureFailure.failures.length, 1);
  assert.equal(currentCaptureFailure.nodes[0].removed, true);
  assert.equal(currentCaptureFailure.channels[0].port1.closed, true);
  assert.equal(currentCaptureFailure.client.pending, null);
  assert.equal(currentCaptureFailure.timers.size, 0);
  currentCaptureFailure.client.dispose();
  const disposedCaptureFailure = harness(); disposedCaptureFailure.ready();
  disposedCaptureFailure.client.draw(source, rectangle, viewport, true); disposedCaptureFailure.client.dispose();
  disposedCaptureFailure.captures[0].reject(new Error('Disposed capture is unavailable')); await settle();
  assert.equal(disposedCaptureFailure.client.state, 'disposed', 'Disposed capture rejection cannot restore or fail the transport');
  assert.equal(disposedCaptureFailure.failures.length, 0);
  assert.equal(disposedCaptureFailure.timers.size, 0);

  const preserve = harness(); preserve.ready();
  preserve.client.draw(source, rectangle, viewport, true); preserve.captures[0].resolve(new Bitmap()); await settle();
  const confirmed = result(preserve.client, { cropped: true, readable: false,
    videoCrop: { x: 0, y: 10, width: 160, height: 70 }, stableFrames: 7,
    samplingCrop: { x: 0, y: 10, width: 160, height: 70 },
    pixels: new Uint8ClampedArray(160 * 90 * 4) });
  preserve.client.receive(confirmed);
  const confirmedCrop = preserve.client.crop, confirmedPixels = preserve.client.pixels;
  preserve.client.draw(source, rectangle, viewport, true); preserve.captures[1].resolve(new Bitmap()); await settle();
  const oldVisualJob = result(preserve.client);
  preserve.client.invalidate();
  assert.equal(preserve.client.barGeneration, 0);
  assert.equal(preserve.client.crop, confirmedCrop); assert.equal(preserve.client.pixels, confirmedPixels);
  assert.equal(preserve.client.readable, false); assert.equal(preserve.client.stableFrames, 7);
  assert.equal(preserve.client.draw(source, rectangle, viewport, true), false, 'Preference invalidation also preserves backpressure');
  preserve.client.receive(oldVisualJob);
  assert.equal(oldVisualJob.bitmap.closed, 1); assert.equal(preserve.canvas.context.draws.length, 1);
  assert.equal(preserve.client.crop, confirmedCrop); assert.equal(preserve.client.pixels, confirmedPixels);
  preserve.client.draw(source, rectangle, viewport, true); preserve.captures[2].resolve(new Bitmap()); await settle();
  const newVisualJob = preserve.channels[0].port1.sent.at(-1).value;
  assert.equal(newVisualJob.generation, 1); assert.equal(newVisualJob.barGeneration, 0,
    'New preference job retains the detector history key');
  preserve.client.reset();
  assert.equal(preserve.client.barGeneration, 1); assert.equal(preserve.client.generation, 2);
  assert.equal(preserve.client.crop.height, 90); assert.equal(preserve.client.stableFrames, 0);
  assert.equal(preserve.client.pixels, null); assert.equal(preserve.client.readable, true);
  preserve.client.receive(result(preserve.client));
  preserve.client.dispose();

  const reject = harness({ accepted: false }); reject.ready();
  reject.client.draw(source, rectangle, viewport, true); reject.captures[0].resolve(new Bitmap()); await settle();
  const unwanted = result(reject.client); reject.client.receive(unwanted);
  assert.equal(unwanted.bitmap.closed, 1); assert.equal(reject.frames.length, 0);
  assert.equal(reject.canvas.context.draws.length, 0, 'Caller validates source/settings before presentation');
  reject.client.dispose();
  assert.equal(reject.nodes[0].removed, true); assert.equal(reject.channels[0].port1.closed, true);
  assert.equal(reject.client.draw(source, rectangle, viewport, true), false);

  const unavailable = harness({ captureThrows: true }); unavailable.ready();
  assert.equal(unavailable.client.draw(source, rectangle, viewport, true), false);
  assert.equal(unavailable.client.state, 'failed'); assert.equal(unavailable.failures.length, 1);
  assert.equal(unavailable.nodes[0].removed, true);
  unavailable.client.fail('Duplicate'); assert.equal(unavailable.failures.length, 1);

  for (const connectionFailure of ['constructor', 'handler', 'start', 'transfer']) {
    const failedConnection = harness({ connectionFailure });
    assert.doesNotThrow(() => failedConnection.nodes[0].onload(), connectionFailure + ': load-time exceptions stay inside the transport');
    assert.equal(failedConnection.client.state, 'failed', connectionFailure + ': failure does not wait for the startup watchdog');
    assert.deepEqual(failedConnection.failures, ['Ambient worker connection failed']);
    assert.equal(failedConnection.client.canAcceptFrame(), false);
    assert.equal(failedConnection.timers.size, 0, connectionFailure + ': failure cancels the watchdog');
    assert.equal(failedConnection.nodes[0].removed, true);
    assert.equal(failedConnection.captures.length, 0, connectionFailure + ': no video capture before a connection');
    for (const channel of failedConnection.channels) {
      assert.equal(channel.port1.closed, true, connectionFailure + ': owned port is closed');
      assert.equal(channel.port2.closed, true, connectionFailure + ': untransferred port is closed');
    }
    failedConnection.nodes[0].onload(); failedConnection.client.fail('Duplicate');
    assert.equal(failedConnection.failures.length, 1, connectionFailure + ': late load and failure do not invoke fallback again');
  }

  const duplicateLoad = harness();
  duplicateLoad.nodes[0].onload();
  const firstConnectionPort = duplicateLoad.client.port;
  duplicateLoad.nodes[0].onload();
  assert.equal(duplicateLoad.channels.length, 1, 'Two loads before ready must not replace the accepted connection');
  assert.equal(duplicateLoad.nodes[0].contentWindow.connections.length, 1, 'The host receives one transferred port');
  assert.equal(duplicateLoad.client.port, firstConnectionPort);
  firstConnectionPort.onmessage({ data: { type: 'ready' } });
  assert.equal(duplicateLoad.client.state, 'ready');
  assert.equal(duplicateLoad.client.draw(source, rectangle, viewport, false), true);
  duplicateLoad.captures[0].resolve(new Bitmap()); await settle();
  assert.equal(firstConnectionPort.sent.filter(message => message.value.type === 'render').length, 1,
    'The first render uses the port whose host sent ready');
  duplicateLoad.client.dispose();
  assert.equal(firstConnectionPort.closed, true);
  assert.equal(duplicateLoad.nodes[0].removed, true);
  assert.equal(duplicateLoad.timers.size, 0);

  const timeout = harness();
  [...timeout.timers.values()][0]();
  assert.equal(timeout.client.state, 'failed'); assert.equal(timeout.failures.length, 1);
  const hung = harness(); hung.ready(); hung.client.draw(source, rectangle, viewport, true);
  [...hung.timers.values()][0]();
  assert.equal(hung.client.state, 'failed'); assert.equal(hung.nodes[0].removed, true);
  const lateCapture = new Bitmap(); hung.captures[0].resolve(lateCapture); await settle();
  assert.equal(lateCapture.closed, 1);

  const malformed = harness(); malformed.ready(); malformed.client.draw(source, rectangle, viewport, true);
  malformed.captures[0].resolve(new Bitmap()); await settle();
  const bad = result(malformed.client, { bitmap: new Bitmap(400, 4096) }); malformed.client.receive(bad);
  assert.equal(bad.bitmap.closed, 1); assert.equal(malformed.client.state, 'failed');
  const presentation = harness(); presentation.ready(); presentation.client.draw(source, rectangle, viewport, true);
  presentation.captures[0].resolve(new Bitmap()); await settle();
  presentation.client.onFrame = () => { throw new Error('Presentation failed'); };
  const failedPresentation = result(presentation.client); presentation.client.receive(failedPresentation);
  assert.equal(failedPresentation.bitmap.closed, 1);
  assert.equal(presentation.client.state, 'failed'); assert.equal(presentation.failures.length, 1);
  assert.equal(presentation.nodes[0].removed, true, 'Presentation exceptions use the fallback and close the transport');
  h.client.dispose(); timeout.client.dispose(); hung.client.dispose(); malformed.client.dispose(); unavailable.client.dispose();
  presentation.client.dispose();

  const geometry = harness(); geometry.ready();
  for (const [rect, view] of [
    [{ ...rectangle, width: 0 }, viewport], [{ ...rectangle, height: 0 }, viewport],
    [{ ...rectangle, width: NaN }, viewport], [{ ...rectangle, top: Infinity }, viewport],
    [rectangle, { ...viewport, width: 0 }], [rectangle, { ...viewport, height: 32769 }]
  ]) assert.equal(geometry.client.draw(source, rect, view, true), false, 'Unavailable geometry waits');
  assert.equal(geometry.client.state, 'ready'); assert.equal(geometry.client.pending, null);
  assert.equal(geometry.client.requestId, 0); assert.equal(geometry.captures.length, 0);
  assert.equal(geometry.failures.length, 0); assert.equal(geometry.timers.size, 0);
  geometry.client.dispose();

  const suspendedStartup = harness();
  const oldStartupTimer = [...suspendedStartup.timers.keys()][0];
  suspendedStartup.client.setSuspended(true);
  assert.equal(suspendedStartup.timers.size, 0, 'Suspended startup has no watchdog deadline');
  assert.equal(suspendedStartup.client.draw(source, rectangle, viewport, true), false);
  suspendedStartup.client.setSuspended(false);
  assert.equal(suspendedStartup.timers.size, 1); assert.equal(suspendedStartup.timers.has(oldStartupTimer), false);
  assert.equal([...suspendedStartup.timers.values()][0].delay, 4000, 'Startup resumes with a fresh full deadline');
  suspendedStartup.client.setSuspended(true); suspendedStartup.ready();
  assert.equal(suspendedStartup.canvas.dataset.workerState, 'ready', 'Suspension does not misreport startup state');
  assert.equal(suspendedStartup.client.canAcceptFrame(), false, 'Hidden ready transport rejects preflight');
  assert.equal(suspendedStartup.client.state, 'ready'); assert.equal(suspendedStartup.timers.size, 0);
  assert.equal(suspendedStartup.client.draw(source, rectangle, viewport, true), false, 'Ready while suspended still does not capture');
  suspendedStartup.client.setSuspended(false); assert.equal(suspendedStartup.timers.size, 0);
  assert.equal(suspendedStartup.client.canAcceptFrame(), true, 'Visible idle transport accepts preflight again');
  suspendedStartup.client.dispose(); suspendedStartup.client.setSuspended(false);
  assert.equal(suspendedStartup.client.canAcceptFrame(), false, 'Disposed transport cannot become available on resume');
  assert.equal(suspendedStartup.canvas.dataset.workerState, 'disposed');
  assert.equal(suspendedStartup.timers.size, 0, 'Disposed transport never rearms watchdogs');

  const suspendedJob = harness(); suspendedJob.ready();
  suspendedJob.client.draw(source, rectangle, viewport, true);
  const pendingBeforeSuspend = suspendedJob.client.pending;
  const oldJobTimer = [...suspendedJob.timers.keys()][0];
  suspendedJob.client.setSuspended(true); assert.equal(suspendedJob.timers.size, 0);
  assert.equal(suspendedJob.client.pending, pendingBeforeSuspend, 'Suspension retains one capture and its ownership');
  assert.equal(suspendedJob.client.draw(source, rectangle, viewport, true, { sampleOnly: true }), false);
  const suspendedCapture = new Bitmap(); suspendedJob.captures[0].resolve(suspendedCapture); await settle();
  assert.equal(suspendedJob.channels[0].port1.sent.length, 1, 'Already-owned capture transfers once without starting another job');
  suspendedJob.client.setSuspended(false);
  assert.equal(suspendedJob.timers.size, 1); assert.equal(suspendedJob.timers.has(oldJobTimer), false);
  assert.equal([...suspendedJob.timers.values()][0].delay, 2000, 'Pending job resumes with a fresh full deadline');
  assert.equal(suspendedJob.client.draw(source, rectangle, viewport, true), false, 'Resume never duplicates the pending job');
  const resumedFrame = result(suspendedJob.client); suspendedJob.client.receive(resumedFrame);
  assert.equal(resumedFrame.bitmap.closed, 1); assert.equal(suspendedJob.frames.length, 1);
  assert.equal(suspendedJob.client.pending, null); assert.equal(suspendedJob.timers.size, 0);
  suspendedJob.client.dispose();

  const hiddenResult = harness(); hiddenResult.ready();
  hiddenResult.client.draw(source, rectangle, viewport, true);
  hiddenResult.captures[0].resolve(new Bitmap()); await settle();
  hiddenResult.client.setSuspended(true);
  const hiddenFrame = result(hiddenResult.client); hiddenResult.client.receive(hiddenFrame);
  assert.equal(hiddenFrame.bitmap.closed, 1); assert.equal(hiddenResult.frames.length, 0);
  assert.equal(hiddenResult.canvas.context.draws.length, 0, 'A result delivered during suspension is released without presentation');
  assert.equal(hiddenResult.client.pending, null); hiddenResult.client.setSuspended(false);
  assert.equal(hiddenResult.timers.size, 0); assert.equal(hiddenResult.client.state, 'ready');
  hiddenResult.client.dispose();

  const suspendedReset = harness(); suspendedReset.ready();
  suspendedReset.client.draw(source, rectangle, viewport, true);
  suspendedReset.client.setSuspended(true); suspendedReset.client.reset();
  suspendedReset.client.setSuspended(false);
  assert.equal(suspendedReset.client.draw(source, rectangle, viewport, true), false, 'Visibility reset keeps stale capture ownership until released');
  const invalidatedHiddenCapture = new Bitmap(); suspendedReset.captures[0].resolve(invalidatedHiddenCapture); await settle();
  assert.equal(invalidatedHiddenCapture.closed, 1); assert.equal(suspendedReset.channels[0].port1.sent.length, 0);
  assert.equal(suspendedReset.client.pending, null); assert.equal(suspendedReset.timers.size, 0);
  assert.equal(suspendedReset.failures.length, 0);
  assert.equal(suspendedReset.client.draw(source, rectangle, viewport, true), true, 'A fresh job follows suspended stale capture disposal');
  suspendedReset.client.dispose(); suspendedReset.captures[1].resolve(new Bitmap()); await settle();

  const sampling = harness(); sampling.ready();
  assert.equal(sampling.client.draw(source, rectangle, viewport, true, { sampleOnly: true }), true);
  assert.equal(sampling.client.draw(source, rectangle, viewport, true), false, 'Sampling shares rendering backpressure');
  sampling.captures[0].resolve(new Bitmap()); await settle();
  assert.equal(sampling.channels[0].port1.sent[0].value.options.sampleOnly, true);
  assert.equal(sampling.channels[0].port1.sent[0].value.options.fillBars, false);
  const sampled = result(sampling.client, { sampleOnly: true, bitmap: null, cropped: true,
    pixels: new Uint8ClampedArray(160 * 90 * 4),
    videoCrop: { x: 0, y: 8, width: 160, height: 76 },
    samplingCrop: { x: 0, y: 10, width: 160, height: 70 } });
  sampling.client.receive(sampled);
  assert.equal(sampling.canvas.width, 400); assert.equal(sampling.canvas.height, 400);
  assert.equal(sampling.canvas.context.draws.length, 0, 'Sampling never presents or resizes the background');
  assert.equal(sampling.frames[0].result.sampleOnly, true); assert.equal(sampling.client.pending, null);
  assert.equal(sampling.client.crop.y, 10, 'Public crop retains the sampling ROI');
  assert.equal(sampling.client.videoCrop.y, 8, 'Display ROI retains protected subtitles separately');
  assert.equal(sampling.client.readPixels().length, 160 * 90 * 4);

  sampling.client.draw(source, rectangle, viewport, true, { sampleOnly: true });
  sampling.captures[1].resolve(new Bitmap()); await settle();
  const staleSample = result(sampling.client, { sampleOnly: true, bitmap: null, pixels: sampled.pixels });
  sampling.client.reset(); sampling.client.receive(staleSample);
  assert.equal(sampling.frames.length, 1); assert.equal(sampling.client.pending, null);
  assert.equal(sampling.client.readPixels(), null, 'Stale sampling cannot restore old safety-monitor pixels');
  assert.equal(sampling.canvas.context.draws.length, 0);
  sampling.client.draw(source, rectangle, viewport, true, { sampleOnly: true });
  const unfinishedSample = new Bitmap(); sampling.client.dispose();
  sampling.captures[2].resolve(unfinishedSample); await settle();
  assert.equal(unfinishedSample.closed, 1, 'Disposed sampling closes late capture');

  const rejectedSample = harness({ accepted: false }); rejectedSample.ready();
  rejectedSample.client.draw(source, rectangle, viewport, true, { sampleOnly: true });
  rejectedSample.captures[0].resolve(new Bitmap()); await settle();
  rejectedSample.client.receive(result(rejectedSample.client, { sampleOnly: true, bitmap: null, pixels: sampled.pixels }));
  assert.equal(rejectedSample.frames.length, 0); assert.equal(rejectedSample.client.pixels, null);
  assert.equal(rejectedSample.client.pending, null); rejectedSample.client.dispose();

  for (const extra of [
    { pixels: null }, { pixels: new Uint8ClampedArray(10) },
    { samplingCrop: { x: 0, y: 0, width: 161, height: 90 } },
    { videoCrop: { x: 0, y: NaN, width: 160, height: 90 } },
    { sampleOnly: false }, { bitmap: new Bitmap(400, 320) }
  ]) {
    const invalidSample = harness(); invalidSample.ready();
    invalidSample.client.draw(source, rectangle, viewport, true, { sampleOnly: true });
    invalidSample.captures[0].resolve(new Bitmap()); await settle();
    const invalidReply = result(invalidSample.client, { sampleOnly: true, bitmap: null, pixels: sampled.pixels, ...extra });
    invalidSample.client.receive(invalidReply);
    assert.equal(invalidSample.client.state, 'failed', 'Sampling validates its complete pixel/crop/mode contract');
    assert.equal(invalidSample.canvas.context.draws.length, 0); assert.equal(invalidSample.frames.length, 0);
    if (invalidReply.bitmap) assert.equal(invalidReply.bitmap.closed, 1, 'Unexpected sampling bitmap is closed');
    invalidSample.client.dispose();
  }
  const protectedSample = harness(); protectedSample.ready();
  protectedSample.client.draw(source, rectangle, viewport, true, { sampleOnly: true });
  protectedSample.captures[0].resolve(new Bitmap()); await settle();
  protectedSample.client.receive(result(protectedSample.client, { sampleOnly: true, bitmap: null, pixels: null, readable: false }));
  assert.equal(protectedSample.client.state, 'ready'); assert.equal(protectedSample.frames.length, 1);
  assert.equal(protectedSample.client.readPixels(), null); assert.equal(protectedSample.canvas.context.draws.length, 0);
  protectedSample.client.dispose();

  const pixelData = new Uint8ClampedArray(160 * 90 * 4);
  for (let y = 0; y < 90; y++) for (let x = 0; x < 160; x++) {
    const i = (y * 160 + x) * 4;
    pixelData[i] = y >= 10 && y < 80 ? 144 : 0;
    pixelData[i + 1] = y >= 10 && y < 80 ? 74 : 0;
    pixelData[i + 2] = y >= 10 && y < 80 ? 255 : 0; pixelData[i + 3] = 255;
  }
  const rendererContext = vm.createContext({ OffscreenCanvas: Canvas, Uint8ClampedArray });
  if (fs.existsSync(path.join(root, 'black-bar-detector.js'))) run(rendererContext, 'black-bar-detector.js');
  run(rendererContext, 'renderer.js');
  const renderer = new rendererContext.YacRenderer(new Canvas());
  for (let i = 0; i < 4; i++) renderer.draw(new Bitmap(160, 90, pixelData), rectangle, viewport, false, { sourceKey: 'same-video' });
  assert.equal(renderer.crop.y, 10); assert.equal(renderer.crop.height, 70, 'New bitmap objects keep the stable crop');
  renderer.draw(new Bitmap(160, 90, pixelData), rectangle, viewport, false, { sourceKey: 'new-video' });
  assert.equal(renderer.crop.height, 90, 'Changing the explicit key resets bar history');
  for (let i = 0; i < 4; i++) renderer.draw(new Bitmap(160, 90, pixelData), rectangle, viewport, false, { sourceKey: '' });
  assert.equal(renderer.crop.height, 70, 'An explicit empty key is still stable');
  const staticSource = new Bitmap(160, 90, pixelData);
  for (let i = 0; i < 4; i++) renderer.draw(staticSource, rectangle, viewport, false);
  assert.equal(renderer.crop.height, 70);
  renderer.draw(new Bitmap(160, 90, pixelData), rectangle, viewport, false);
  assert.equal(renderer.crop.height, 90, 'Unkeyed canvas fixtures retain source-object reset');
  renderer.draw(staticSource, rectangle, { width: 1, height: 32768 }, false);
  assert.equal(renderer.canvas.height, 2048, 'Extreme aspect ratios remain bounded');

  for (const keyed of [false, true]) {
    const resetRenderer = new rendererContext.YacRenderer(new Canvas());
    const retired = new Bitmap(160, 90, pixelData), replacement = new Bitmap(160, 90, pixelData.slice());
    replacement.data[(10 * 160) * 4] = 42;
    const options = keyed ? { sourceKey: 'unchanged-after-reset' } : {};
    for (let i = 0; i < 4; i++) resetRenderer.draw(retired, rectangle, viewport, false, options);
    assert.equal(resetRenderer.source, retired);assert.equal(resetRenderer.crop.height, 70);
    resetRenderer.reset();
    assert.equal(resetRenderer.source === null, true, 'reset releases the retired source reference before another frame arrives');
    assert.equal(resetRenderer.pixels, null);assert.equal(resetRenderer.stableFrames, 0);
    for (let i = 0; i < 4; i++) resetRenderer.draw(replacement, rectangle, viewport, false, options);
    assert.notEqual(resetRenderer.source, retired, 'same-key and unkeyed recovery cannot retain the retired source');
    assert.deepEqual(resetRenderer.frame.data, replacement.data, 'the new source supplies analysis pixels after reset');
    assert.equal(resetRenderer.crop.height, 70, 'bar detection recovers after reset with a stable explicit key or unkeyed replacement');
  }

  const workerReplies = [];
  const capturedPixels = new Uint8ClampedArray(320 * 180 * 4);
  for (let y = 0; y < 180; y++) for (let x = 0; x < 320; x++) {
    const from = (Math.floor(y / 2) * 160 + Math.floor(x / 2)) * 4;
    capturedPixels.set(pixelData.subarray(from, from + 4), (y * 320 + x) * 4);
  }
  const workerContext = vm.createContext({
    OffscreenCanvas: Canvas, Uint8ClampedArray,
    self: { postMessage: (value, transfers = []) => workerReplies.push({ value, transfers }) },
    importScripts: (...names) => names.forEach(name => {
      // The detector is supplied by the parallel detector change. The existing
      // renderer still works on its own while that independent file is pending.
      if (fs.existsSync(path.join(root, name))) run(workerContext, name);
    })
  });
  run(workerContext, 'ambient-worker.js');
  assert.equal(workerReplies[0].value.type, 'ready');
  assert.equal(workerReplies[0].value.backend, '2d', 'Unavailable WebGL retains the existing CPU renderer');
  for (let i = 0; i < 4; i++) {
    const frame = new Bitmap(320, 180, capturedPixels);
    workerContext.self.onmessage({ data: {
      type: 'render', requestId: i + 1, generation: 0, barGeneration: 0, frame,
      rectangle, viewport, radial: false, sourceKey: 'same-video', mediaTime: i / 30, options: { readPixels: true }
    } });
    assert.equal(frame.closed, 1, 'Worker releases each incoming image after rendering');
  }
  const workerResult = workerReplies.at(-1);
  assert.equal(workerResult.value.backend, '2d');
  assert.equal(workerResult.value.videoCrop.height, 70);
  assert.equal(workerResult.value.pixels.length, 160 * 90 * 4);
  assert.equal(workerResult.transfers.length, 2, 'Bitmap and owned sample buffer are transferred');
  assert.equal(workerResult.value.sampleOnly, false);
  assert.equal(workerResult.value.samplingCrop.height, 70);
  const noReadbackFrame = new Bitmap(320, 180, capturedPixels);
  workerContext.self.onmessage({ data: { type: 'render', requestId: 40, generation: 0, barGeneration: 0,
    frame: noReadbackFrame, rectangle, viewport, radial: false, sourceKey: 'same-video', mediaTime: 4 / 30,
    options: { readPixels: false } } });
  const noReadback = workerReplies.at(-1);
  assert.equal(noReadback.value.type, 'frame'); assert.equal(noReadback.value.backend, '2d');
  assert.equal(noReadback.value.pixels, null, 'Projection does not return an unrequested sample buffer');
  assert.equal(noReadback.transfers.length, 1, 'Rendering without warning sampling transfers only the bitmap');
  assert.equal(noReadback.transfers[0], noReadback.value.bitmap); assert.equal(noReadbackFrame.closed, 1);
  const outputCanvas = vm.runInContext('canvas', workerContext);
  const beforeInspection = { width: outputCanvas.width, height: outputCanvas.height,
    draws: outputCanvas.context.draws.length, transfers: outputCanvas.transfers };
  const inspectFrame = new Bitmap(320, 180, capturedPixels);
  workerContext.self.onmessage({ data: { type: 'render', requestId: 41, generation: 0, barGeneration: 0,
    frame: inspectFrame, rectangle, viewport: { width: 800, height: 2000 }, radial: true,
    sourceKey: 'same-video', mediaTime: 4 / 30, options: { sampleOnly: true, readPixels: false } } });
  const inspection = workerReplies.at(-1);
  assert.equal(inspection.value.type, 'frame'); assert.equal(inspection.value.sampleOnly, true);
  assert.equal(inspection.value.backend, '2d');
  assert.equal(inspection.value.bitmap, null); assert.equal(inspection.value.pixels.length, 160 * 90 * 4);
  assert.equal(inspection.value.samplingCrop.height, 70); assert.equal(inspectFrame.closed, 1);
  assert.equal(inspection.transfers.length, 1); assert.equal(inspection.transfers[0], inspection.value.pixels.buffer);
  assert.deepEqual({ width: outputCanvas.width, height: outputCanvas.height,
    draws: outputCanvas.context.draws.length, transfers: outputCanvas.transfers }, beforeInspection,
    'Worker sampling does not resize, render or allocate an output bitmap');
  const filledInspectFrame = new Bitmap(320, 180, capturedPixels);
  workerContext.self.onmessage({ data: { type: 'render', requestId: 42, generation: 0, barGeneration: 0,
    frame: filledInspectFrame, rectangle, viewport, sourceKey: 'same-video', mediaTime: 4 / 30,
    options: { sampleOnly: true, avoidBars: false, fillBars: true } } });
  const filledInspection = workerReplies.at(-1).value;
  assert.equal(filledInspection.type, 'frame'); assert.equal(filledInspection.samplingCrop.height, 90);
  assert.equal(filledInspection.videoCrop.height, 70, 'fillBars detects a display ROI even with color exclusion OFF');
  assert.equal(filledInspection.cropped, false, 'Color sampling keeps the full source when avoidBars is OFF');
  assert.equal(filledInspectFrame.closed, 1); assert.equal(outputCanvas.transfers, beforeInspection.transfers);

  const samplingTrace = (avoidBars, fillBars) => {
    const readbacks = { bars: 0, warning: 0 }, replies = [];
    class CountedCanvas extends Canvas {
      constructor(...args) {
        super(...args);const read = this.context.getImageData;
        this.context.getImageData = (...values) => {
          if (this.width === 320 && this.height === 180) readbacks.bars++;
          if (this.width === 160 && this.height === 90) readbacks.warning++;
          return read(...values);
        };
      }
    }
    const context = vm.createContext({ OffscreenCanvas: CountedCanvas, Uint8ClampedArray,
      self: { postMessage: value => replies.push(value) },
      importScripts: (...names) => names.forEach(name => run(context, name)) });
    run(context, 'ambient-worker.js');
    for (let i = 0; i < 8; i++) {
      const frame = new Bitmap(320, 180, capturedPixels);
      context.self.onmessage({ data: { type: 'render', requestId: i + 1, generation: 0, barGeneration: 0,
        frame, rectangle, viewport, sourceKey: 'warning-only-readback', mediaTime: i / 30,
        options: { sampleOnly: true, avoidBars, fillBars } } });
      assert.equal(frame.closed, 1, 'warning-only readback comparison releases every capture');
    }
    return { readbacks, frames: replies.filter(value => value.type === 'frame') };
  };
  for (const avoidBars of [false, true]) {
    const formerlyFilledSamples = samplingTrace(avoidBars, true), monitorOnlySamples = samplingTrace(avoidBars, false);
    assert.deepEqual(formerlyFilledSamples.readbacks, { bars: 8, warning: 8 });
    assert.deepEqual(monitorOnlySamples.readbacks, { bars: avoidBars ? 8 : 0, warning: 8 }, 'skip unused display readback while retaining warning crop detection');
    assert.equal(formerlyFilledSamples.frames.length, 8);assert.equal(monitorOnlySamples.frames.length, 8);
    for (let i = 0; i < 8; i++) {
      const previous = formerlyFilledSamples.frames[i], current = monitorOnlySamples.frames[i];
      assert.equal(current.sampleOnly, true);assert.equal(current.bitmap, null);
      assert.deepEqual(Buffer.from(current.pixels), Buffer.from(previous.pixels), 'warning pixels remain byte-identical without unused fill detection');
      assert.equal(JSON.stringify(current.samplingCrop), JSON.stringify(previous.samplingCrop), 'warning ROI stays identical at every detector-refinement step');
    }
    assert.equal(monitorOnlySamples.frames.at(-1).samplingCrop.height, avoidBars ? 70 : 90, 'warning ROI retains automatic bars or the full source as configured');
  }
  const filledPaintFrame = new Bitmap(320, 180, capturedPixels);
  workerContext.self.onmessage({ data: { type: 'render', requestId: 43, generation: 0, barGeneration: 0,
    frame: filledPaintFrame, rectangle, viewport, sourceKey: 'same-video', mediaTime: 4 / 30,
    options: { sampleOnly: false, avoidBars: false, fillBars: true, readPixels: false } } });
  const filledPaint = workerReplies.at(-1).value;
  assert.equal(filledPaint.type, 'frame');assert.equal(filledPaint.sampleOnly, false);assert.ok(filledPaint.bitmap);
  assert.equal(filledPaint.videoCrop.height, 70, 'background paint keeps display-bar detection when color exclusion is OFF');
  assert.equal(filledPaint.samplingCrop.height, 90);assert.equal(filledPaintFrame.closed, 1);
  workerContext.self.onmessage({ data: { type: 'render', requestId: 5, generation: 1, barGeneration: 0,
    frame: new Bitmap(320, 180, capturedPixels), rectangle, viewport, radial: false,
    sourceKey: 'same-video', mediaTime: 4 / 30 } });
  assert.equal(workerReplies.at(-1).value.videoCrop.height, 70,
    'Changing presentation generation retains the confirmed worker crop');
  workerContext.self.onmessage({ data: { type: 'render', requestId: 6, generation: 2, barGeneration: 1,
    frame: new Bitmap(320, 180, capturedPixels), rectangle, viewport, radial: false,
    sourceKey: 'same-video', mediaTime: 5 / 30 } });
  assert.equal(workerReplies.at(-1).value.videoCrop.height, 90,
    'Changing the bar generation resets detection for a seek or new source');
  const invalidFrame = new Bitmap(1920, 1080);
  workerContext.self.onmessage({ data: { type: 'render', requestId: 99, generation: 0, barGeneration: 0,
    frame: invalidFrame, rectangle, viewport, sourceKey: 'same-video' } });
  assert.equal(invalidFrame.closed, 1); assert.equal(workerReplies.at(-1).value.type, 'failed');
  for (const barGeneration of [-1, .5, undefined]) {
    const badCounterFrame = new Bitmap(320, 180, capturedPixels);
    workerContext.self.onmessage({ data: { type: 'render', requestId: 100, generation: 0, barGeneration,
      frame: badCounterFrame, rectangle, viewport, sourceKey: 'same-video' } });
    assert.equal(badCounterFrame.closed, 1); assert.equal(workerReplies.at(-1).value.type, 'failed');
  }
  const malformedMode = new Bitmap(320, 180, capturedPixels);
  workerContext.self.onmessage({ data: { type: 'render', requestId: 101, generation: 0, barGeneration: 0,
    frame: malformedMode, rectangle, viewport, sourceKey: 'same-video', options: { sampleOnly: 'true' } } });
  assert.equal(malformedMode.closed, 1); assert.equal(workerReplies.at(-1).value.type, 'failed');

  // Unlike the transport mocks above, this exercises real ArrayBuffer ownership
  // transfer. ImageBitmap/WebGL remain test doubles; no browser or GPU is used.
  const FlashMonitor = require('../flash-monitor.js');
  for (const backend of ['2d', 'webgl2']) {
    let uploads = 0, detached = 0;
    const gl = {
      createProgram: () => ({}), createShader: () => ({}), createTexture: () => ({}),
      getProgramParameter: () => true, getUniformLocation: (_, name) => name,
      getError: () => 0, NO_ERROR: 0, isContextLost: () => false,
      texSubImage2D: (...args) => {
        assert.equal(args.at(-1).data.length, 160 * 90 * 4, 'GPU upload precedes sample detachment'); uploads++;
      }
    };
    for (const name of ['shaderSource', 'compileShader', 'attachShader', 'linkProgram', 'deleteShader',
      'activeTexture', 'bindTexture', 'texParameteri', 'texStorage2D', 'useProgram', 'uniform1i',
      'uniform1f', 'uniform2f', 'uniform4f', 'viewport', 'drawArrays', 'flush', 'deleteTexture', 'deleteProgram']) gl[name] = () => {};
    class TransferCanvas extends Canvas {
      getContext(kind) { return kind === 'webgl2' ? backend === 'webgl2' ? gl : null : super.getContext(kind); }
      addEventListener() {} removeEventListener() {}
    }
    const replies = [];
    const transferContext = vm.createContext({
      OffscreenCanvas: TransferCanvas, Uint8ClampedArray,
      importScripts: (...names) => names.forEach(name => run(transferContext, name)),
      self: { postMessage(value, transfers = []) {
        if (!value.pixels) { replies.push(value); return; }
        const pixels = value.pixels;
        assert.equal(pixels, vm.runInContext('renderer.readPixels()', transferContext), 'Transfer uses original analysis pixels, without a second full-frame buffer');
        assert.ok(transfers.includes(pixels.buffer));
        const received = structuredClone(pixels, { transfer: [pixels.buffer] });
        assert.equal(pixels.byteLength, 0, 'Sender buffer is genuinely detached'); detached++;
        replies.push({ ...value, pixels: received });
      } }
    });
    run(transferContext, 'ambient-worker.js');
    assert.equal(replies[0].backend, backend);
    const monitor = new FlashMonitor(), referenceMonitor = new FlashMonitor();
    let warningCount = 0;
    // Switching between rendering and inspection also covers the CPU projection
    // cache after its previous sample buffer has been detached.
    for (let i = 0; i < 132; i++) {
      const input = new Uint8ClampedArray(320 * 180 * 4);
      const expected = new Uint8ClampedArray(160 * 90 * 4);
      const bright = Math.floor(i * 8 / 30) % 2 ? 240 : 55;
      for (let y = 0; y < 180; y++) for (let x = 0; x < 320; x++) {
        const color = y < 20 || y >= 160 ? 0 : bright;
        const p = (y * 320 + x) * 4;
        input[p] = input[p + 1] = input[p + 2] = color; input[p + 3] = 255;
        if (!(x % 2) && !(y % 2)) expected.set(input.subarray(p, p + 4), ((y / 2) * 160 + x / 2) * 4);
      }
      const sampleOnly = i % 3 === 1, wantsPixels = i % 3 !== 2;
      const frame = new Bitmap(320, 180, input);
      transferContext.self.onmessage({ data: { type: 'render', requestId: i + 1, generation: 0,
        barGeneration: 0, frame, rectangle, viewport, radial: true, sourceKey: 'ownership-video',
        mediaTime: i / 30, options: { sampleOnly, readPixels: wantsPixels } } });
      const value = replies.at(-1);
      assert.equal(value.type, 'frame', value.reason); assert.equal(value.backend, backend); assert.equal(frame.closed, 1);
      if (!wantsPixels) { assert.equal(value.pixels, null, 'Unrequested pixels stay untransferred'); continue; }
      assert.deepEqual(value.pixels, expected, 'Successive transferred pixels retain exact contents');
      assert.equal(value.pixels.byteLength, 57600);
      const args = [i * 1000 / 30, i / 30, 'ownership-video', value.samplingCrop, 1];
      const warned = monitor.sample(value.pixels, ...args);
      assert.equal(warned, referenceMonitor.sample(expected.slice(), ...args), 'Warning timing matches the former copied-pixel path');
      if (warned) warningCount++;
    }
    assert.equal(detached, 88, 'Every requested sample is transferred exactly once');
    assert.ok(warningCount > 0, 'Timing parity includes an actual sustained-flash warning');
    if (backend === 'webgl2') assert.equal(uploads, 88, 'Only background jobs upload a GPU texture');
  }

  const handlers = {}, workers = [], parent = {}, bridgeReplies = [];
  const token = '01'.repeat(16);
  class HostWorker {
    constructor(url) { this.url = url; this.jobs = []; workers.push(this); }
    postMessage(value, transfers) { this.jobs.push({ value, transfers }); }
    terminate() { this.terminated = true; }
  }
  const hostContext = vm.createContext({
    Uint8ClampedArray, parent, Worker: HostWorker,
    location: { hash: '#' + token, protocol: 'chrome-extension:', origin: 'chrome-extension://test' },
    addEventListener: (name, listener) => { handlers[name] = listener; }
  });
  run(hostContext, 'worker-host.js');
  const bridgePort = { postMessage: (value, transfers) => bridgeReplies.push({ value, transfers }),
    start() { this.started = true; }, close() { this.closed = true; } };
  const connect = { source: parent, origin: 'https://www.youtube.com',
    data: { type: 'yac-worker-connect', token }, ports: [bridgePort] };
  handlers.message({ ...connect, source: {} });
  handlers.message({ ...connect, origin: 'https://untrusted.example' });
  handlers.message({ ...connect, data: { ...connect.data, token: '00'.repeat(16) } });
  assert.equal(workers.length, 0, 'Bridge rejects unrelated parent, origin and token');
  handlers.message(connect);
  assert.equal(workers[0].url, 'ambient-worker.js'); assert.equal(bridgePort.started, true);
  workers[0].onmessage({ data: { type: 'ready' } });
  assert.equal(bridgeReplies[0].value.type, 'ready');
  const sourceFrame = new Bitmap(); bridgePort.onmessage({ data: { type: 'render', frame: sourceFrame } });
  assert.equal(workers[0].jobs[0].transfers[0], sourceFrame);
  workers[0].onmessage({ data: workerResult.value });
  assert.equal(bridgeReplies.at(-1).transfers.length, 2);
  workers[0].onmessage({ data: inspection.value });
  assert.equal(bridgeReplies.at(-1).value.bitmap, null);
  assert.equal(bridgeReplies.at(-1).transfers.length, 1, 'Bridge transfers only the pixel buffer for sampling');
  bridgePort.onmessage({ data: { type: 'dispose' } });
  assert.equal(workers[0].terminated, true); assert.equal(bridgePort.closed, true);
  handlers.pagehide();

  console.log('PASS: worker sampling/rendering modes, suspended watchdogs, geometry wait, pixel/crop contracts, backpressure, stale capture success/failure, stale processing failure, frame ownership, fallback, bounded output, bridge origin and teardown');
})().catch(error => { console.error(error); process.exitCode = 1; });
