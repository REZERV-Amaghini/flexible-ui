/* Main-thread capture/presentation; the expensive rendering runs in a Worker. */
(() => {
  'use strict';
  const validCrop = crop => crop && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(crop[key])) &&
    crop.x >= 0 && crop.y >= 0 && crop.width > 0 && crop.height > 0 &&
    crop.x + crop.width <= 160 && crop.y + crop.height <= 90;
  const validSize = value => Number.isFinite(value) && value > 0 && value <= 32768;
  const validGeometry = (rectangle, viewport) => rectangle && viewport &&
    ['left', 'top', 'width', 'height'].every(key => Number.isFinite(rectangle[key])) &&
    validSize(rectangle.width) && validSize(rectangle.height) &&
    validSize(viewport.width) && validSize(viewport.height);

  globalThis.YacWorkerRenderer = class {
    constructor(canvas, { hostUrl, onFrame = () => {}, onFailure = () => {}, acceptFrame = () => true,
      startupTimeout = 4000, renderTimeout = 2000 } = {}) {
      this.canvas = canvas;
      this.context = canvas.getContext('2d', { alpha: false });
      this.padding = 180;
      this.setState('starting');
      this.suspended = false;
      this.generation = 0;
      this.barGeneration = 0;
      this.requestId = 0;
      this.pending = null;
      this.readable = true;
      this.stableFrames = 0;
      this.crop = { x: 0, y: 0, width: 160, height: 90 };
      this.videoCrop = { ...this.crop };
      this.pixels = null;
      this.onFrame = onFrame;
      this.onFailure = onFailure;
      this.acceptFrame = acceptFrame;
      this.startupTimeout = startupTimeout;
      this.renderTimeout = renderTimeout;
      try {
        if (!hostUrl || typeof createImageBitmap !== 'function' || typeof MessageChannel !== 'function') {
          throw new Error('Ambient worker capture is unavailable');
        }
        const target = new URL(hostUrl, location.href);
        const origin = target.protocol + '//' + target.host;
        const tokenBytes = crypto.getRandomValues(new Uint8Array(16));
        const token = [...tokenBytes].map(value => value.toString(16).padStart(2, '0')).join('');
        target.hash = token;
        this.frame = document.createElement('iframe');
        this.frame.id = 'yac-worker-host';
        this.frame.setAttribute('aria-hidden', 'true');
        this.frame.style.cssText = 'display:none!important;width:0!important;height:0!important;border:0!important';
        this.frame.src = target.href;
        this.frame.onerror = () => this.fail('Ambient worker frame could not load');
        this.frame.onload = () => {
          if (this.state !== 'starting' || this.port) return;
          let channel;
          try {
            channel = new MessageChannel();
            this.port = channel.port1;
            this.port.onmessage = event => this.receive(event.data);
            this.port.onmessageerror = () => this.fail('Ambient worker result failed');
            this.port.start();
            this.frame.contentWindow.postMessage({ type: 'yac-worker-connect', token }, origin, [channel.port2]);
          } catch (error) {
            channel?.port2.close();
            this.fail('Ambient worker connection failed');
          }
        };
        this.armStartupTimeout();
        document.documentElement.append(this.frame);
      } catch (error) {
        // Notify asynchronously, so the caller can install its fallback after construction.
        queueMicrotask(() => this.fail(error instanceof Error ? error.message : 'Ambient worker is unavailable'));
      }
    }
    readPixels() { return this.readable ? this.pixels : null; }
    setState(state) {
      this.state = state;
      if (this.canvas.dataset) this.canvas.dataset.workerState = state;
    }
    canAcceptFrame() { return this.state === 'ready' && !this.pending && !this.suspended; }
    armStartupTimeout() {
      clearTimeout(this.startupTimer); this.startupTimer = null;
      if (this.state === 'starting' && !this.suspended) {
        this.startupTimer = setTimeout(() => {
          if (this.state === 'starting' && !this.suspended) this.fail('Ambient worker startup timed out');
        }, this.startupTimeout);
      }
    }
    armJobTimeout() {
      clearTimeout(this.jobTimer); this.jobTimer = null;
      if (this.state === 'ready' && this.pending && !this.suspended) {
        const meta = this.pending;
        this.jobTimer = setTimeout(() => {
          if (this.state === 'ready' && !this.suspended && this.pending === meta) this.fail('Ambient worker frame timed out');
        }, this.renderTimeout);
      }
    }
    setSuspended(value) {
      const suspended = Boolean(value);
      if (this.suspended === suspended) return;
      this.suspended = suspended;
      // Background documents may freeze both the extension frame and Worker.
      // Keep their single outstanding job, but do not treat suspended time as a
      // failed startup/capture. Resuming gives that same job a fresh deadline.
      this.armStartupTimeout(); this.armJobTimeout();
    }
    draw(source, rectangle, viewport, radial, options = {}) {
      if (!this.canAcceptFrame()) return false;
      // A temporarily hidden player has no geometry. Wait without capturing or
      // converting a layout transition into a permanent Worker failure.
      if (!validGeometry(rectangle, viewport)) return false;
      const meta = {
        source, rectangle: { ...rectangle }, viewport: { ...viewport }, options: { ...options },
        requestId: ++this.requestId, generation: this.generation, barGeneration: this.barGeneration,
        sourceKey: typeof options.sourceKey === 'string' ? options.sourceKey : source.currentSrc || source.src || '',
        mediaTime: Number(source.currentTime) || 0
      };
      this.pending = meta;
      this.armJobTimeout();
      let captured;
      try { captured = createImageBitmap(source, { resizeWidth: 320, resizeHeight: 180, resizeQuality: 'low' }); }
      catch (error) { this.fail('Ambient video capture is unavailable'); return false; }
      Promise.resolve(captured).then(frame => {
        if (this.state !== 'ready' || this.pending !== meta || meta.generation !== this.generation) {
          frame.close(); this.finish(meta); return;
        }
        try {
          this.port.postMessage({ type: 'render', requestId: meta.requestId, generation: meta.generation,
            barGeneration: meta.barGeneration,
            frame, rectangle: meta.rectangle, viewport: meta.viewport, radial: radial === true,
            sourceKey: meta.sourceKey, mediaTime: meta.mediaTime, options: {
              avoidBars: meta.options.avoidBars !== false, inset: Number(meta.options.inset) || 0,
              blend: Number(meta.options.blend) || 0, readPixels: meta.options.readPixels === true,
              sampleOnly: meta.options.sampleOnly === true, fillBars: meta.options.fillBars === true
            }
          }, [frame]);
        } catch (error) { frame.close(); this.fail('Ambient worker capture transfer failed'); }
      }, () => {
        // A seek, source change or visibility reset can obsolete this capture
        // before its rejection arrives. Release that job without disabling the
        // Worker for the current video, as with an obsolete successful capture.
        if (this.state !== 'ready' || this.pending !== meta || meta.generation !== this.generation) {
          this.finish(meta); return;
        }
        this.fail('Ambient video capture is unavailable');
      });
      return true;
    }
    receive(value) {
      if (!value || this.state === 'disposed' || this.state === 'failed') { value?.bitmap?.close?.(); return; }
      if (value.type === 'ready' && this.state === 'starting') {
        if (this.canvas.dataset && ['webgl2', '2d'].includes(value.backend)) this.canvas.dataset.workerBackend = value.backend;
        clearTimeout(this.startupTimer); this.startupTimer = null; this.setState('ready'); return;
      }
      if (value.type === 'failed') {
        // Processing failures belong to one job; connection failures have no IDs.
        // An obsolete or duplicate reply must not disable a newer generation.
        if (Number.isSafeInteger(value.requestId) && Number.isSafeInteger(value.generation)) {
          const meta = this.pending;
          if (!meta || value.requestId !== meta.requestId || value.generation !== meta.generation ||
              meta.generation !== this.generation) {
            if (meta && value.requestId === meta.requestId && value.generation === meta.generation) this.finish(meta);
            return;
          }
        }
        this.fail(value.reason || 'Ambient worker failed'); return;
      }
      if (value.type !== 'frame') return;
      const meta = this.pending;
      if (!meta || value.requestId !== meta.requestId || value.generation !== meta.generation ||
          meta.generation !== this.generation || this.state !== 'ready') {
        value.bitmap?.close?.();
        if (meta && value.requestId === meta.requestId) this.finish(meta);
        return;
      }
      const bitmap = value.bitmap;
      const sampleOnly = meta.options.sampleOnly === true;
      const validBitmap = sampleOnly ? bitmap === null : bitmap && bitmap.width === 400 && bitmap.height >= 80 && bitmap.height <= 2048;
      const validPixels = value.pixels instanceof Uint8ClampedArray && value.pixels.length === 160 * 90 * 4;
      if (value.sampleOnly !== sampleOnly || !validBitmap ||
          !validCrop(value.videoCrop) || !validCrop(value.samplingCrop) ||
          typeof value.readable !== 'boolean' || typeof value.cropped !== 'boolean' ||
          !Number.isSafeInteger(value.stableFrames) || value.stableFrames < 0 ||
          (value.pixels !== null && !validPixels) || (sampleOnly && value.readable && !validPixels)) {
        bitmap?.close?.(); this.fail('Invalid ambient worker result'); return;
      }
      try {
        if (this.suspended || !this.acceptFrame(meta)) { this.finish(meta); return; }
        if (!sampleOnly) {
          if (this.canvas.width !== bitmap.width || this.canvas.height !== bitmap.height) {
            this.canvas.width = bitmap.width; this.canvas.height = bitmap.height;
          }
          this.context.drawImage(bitmap, 0, 0);
        }
        this.readable = value.readable;
        if (this.canvas.dataset && ['webgl2', '2d'].includes(value.backend)) this.canvas.dataset.workerBackend = value.backend;
        this.stableFrames = value.stableFrames;
        this.crop = value.samplingCrop;
        this.videoCrop = value.videoCrop;
        this.pixels = value.pixels;
        this.finish(meta);
        this.onFrame({ readable: value.readable, cropped: value.cropped, videoCrop: value.videoCrop,
          samplingCrop: value.samplingCrop, sampleOnly }, meta);
      } catch (error) {
        this.fail('Ambient worker presentation failed');
      } finally { bitmap?.close?.(); }
    }
    finish(meta) {
      if (this.pending !== meta) return;
      clearTimeout(this.jobTimer); this.jobTimer = null; this.pending = null;
    }
    invalidate() {
      this.generation++;
      // A visual preference change only invalidates the pending presentation.
      // It must not erase the confirmed bar geometry or restart detection.
      // Keep the outstanding job until it finishes; never add a queue.
    }
    reset() {
      this.invalidate();
      this.barGeneration++;
      this.pixels = null; this.readable = true; this.stableFrames = 0;
      this.crop = { x: 0, y: 0, width: 160, height: 90 };
      this.videoCrop = { ...this.crop };
    }
    fail(reason) {
      if (this.state === 'failed' || this.state === 'disposed') return;
      this.setState('failed'); this.closeTransport(); this.onFailure(reason);
    }
    closeTransport() {
      clearTimeout(this.startupTimer); clearTimeout(this.jobTimer);
      this.startupTimer = null; this.jobTimer = null;
      try { this.port?.postMessage({ type: 'dispose' }); } catch (error) { /* Already detached. */ }
      this.port?.close(); this.frame?.remove(); this.pending = null; this.pixels = null;
    }
    dispose() { this.setState('disposed'); this.generation++; this.closeTransport(); }
  };
})();
