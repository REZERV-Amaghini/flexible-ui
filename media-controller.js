/* Native media adapter. No audio decoding, polling or frame-loop work. */
(() => {
  'use strict';
  class LiquidMediaController {
    constructor(store, { document: doc, MutationObserver: Observer, now = () => performance.now(),
      enqueue = queueMicrotask, selector = 'video,audio' }) {
      this.store = store;this.doc = doc;this.now = now;this.enqueue = task => enqueue(task);this.selector = selector;
      this.media = new Map();this.listeners = new Set();this.active = false;this.disposed = false;
      this.observer = new Observer(records => {
        if (!this.active) return;
        for (const record of records) for (const node of record.addedNodes) this.discover(node);
        for (const [element, record] of this.media) if (!element.isConnected) { this.restore(element, record);this.media.delete(element); }
        this.publish();
      });
      this.event = event => {
        if (!this.active || !event.target.isConnected || !event.target.matches?.(this.selector)) return;
        const element = event.target, record = this.track(element);
        if (event.type === 'loadedmetadata') { record.blocked = '';record.attempts = 0; }
        if (event.type === 'ratechange' && (record.applying || record.queued || record.blocked || this.matches(element))) return;
        if (event.type === 'ratechange') {
          const time = this.now();
          if (time - record.windowStart > 1000) { record.windowStart = time;record.attempts = 0; }
          if (++record.attempts > 3) { record.blocked = 'conflict';this.publish();return; }
          record.queued = true;
          this.enqueue(() => { record.queued = false;if (this.active && this.media.get(element) === record) this.apply(element, record); });
        } else this.apply(element, record);
      };
      this.unsubscribe = store.subscribe(values => {
        const signature = JSON.stringify([values.playbackEnabled, values.playbackMode, values.playbackRate]);
        if (signature === this.signature) return;
        this.signature = signature;this.values = { ...values };
        if (!values.playbackEnabled) this.pause();
        else {
          this.start();
          for (const [element, record] of this.media) { record.blocked = '';record.attempts = 0;this.apply(element, record); }
        }
        this.publish();
      });
      this.values ||= { ...store.values };this.publish();
    }
    start() {
      if (this.active || this.disposed || !this.values.playbackEnabled) return;
      this.active = true;
      for (const type of ['play', 'loadedmetadata', 'ratechange']) this.doc.addEventListener(type, this.event, true);
      this.observer.observe(this.doc.documentElement, { childList: true, subtree: true });
      this.discover(this.doc);
    }
    pause() {
      this.active = false;this.observer.disconnect();
      for (const type of ['play', 'loadedmetadata', 'ratechange']) this.doc.removeEventListener(type, this.event, true);
      for (const [element, record] of this.media) this.restore(element, record);
      this.media.clear();this.publish();
    }
    discover(node) {
      if (node.matches?.(this.selector)) this.apply(node, this.track(node));
      for (const element of node.querySelectorAll?.(this.selector) || []) this.apply(element, this.track(element));
    }
    track(element) {
      if (!this.media.has(element)) {
        const pitchKey = ['preservesPitch', 'webkitPreservesPitch', 'mozPreservesPitch'].find(key => key in element);
        this.media.set(element, { rate: element.playbackRate, pitchKey, pitch: pitchKey ? element[pitchKey] : undefined,
          lastRate: null, lastPitch: null, applying: false, queued: false, attempts: 0, windowStart: this.now(), blocked: '' });
      }
      return this.media.get(element);
    }
    matches(element) {
      const record = this.media.get(element);
      return element.playbackRate === this.values.playbackRate && record?.pitchKey &&
        element[record.pitchKey] === (this.values.playbackMode === 'tempo');
    }
    apply(element, record) {
      if (!this.active || !element.isConnected || record.blocked || record.applying) return;
      if (!record.pitchKey || element.duration === Infinity || element.srcObject) {
        this.restore(element, record);
        record.blocked = 'unsupported';this.publish();return;
      }
      record.applying = true;
      try {
        const pitch = this.values.playbackMode === 'tempo';
        if (element[record.pitchKey] !== pitch) element[record.pitchKey] = pitch;
        record.lastPitch = element[record.pitchKey];
        if (element.playbackRate !== this.values.playbackRate) element.playbackRate = this.values.playbackRate;
        record.lastRate = element.playbackRate;
        if (!this.matches(element)) record.blocked = 'unsupported';
      } catch { this.restore(element, record);record.blocked = 'unsupported'; }
      finally { record.applying = false;this.publish(); }
    }
    restore(element, record) {
      // Do not undo a newer value written by the site or another control.
      try { if (record.lastRate !== null && element.playbackRate === record.lastRate) element.playbackRate = record.rate;record.lastRate = null; } catch {}
      try { if (record.pitchKey && record.lastPitch !== null && element[record.pitchKey] === record.lastPitch) element[record.pitchKey] = record.pitch;record.lastPitch = null; } catch {}
    }
    publish() {
      const records = [...this.media.values()], count = records.filter(record => !record.blocked && record.lastRate !== null).length;
      const kind = !this.active ? 'off' : records.some(record => record.blocked === 'conflict') ? 'conflict' :
        records.some(record => record.blocked) ? 'unsupported' : count ? 'applied' : 'waiting';
      const state = { kind, count, rate: this.values?.playbackRate || 1, mode: this.values?.playbackMode || 'tempo' };
      const signature = JSON.stringify(state);
      if (signature === this.stateSignature) return;
      this.stateSignature = signature;this.state = Object.freeze(state);
      for (const listener of this.listeners) listener(this.state);
    }
    subscribe(listener) { this.listeners.add(listener);listener(this.state);return () => this.listeners.delete(listener); }
    dispose() { this.pause();this.disposed = true;this.unsubscribe();this.listeners.clear(); }
  }
  globalThis.LiquidMediaController = LiquidMediaController;
  if (typeof module !== 'undefined') module.exports = LiquidMediaController;
  if (globalThis.LiquidUI && !globalThis.LiquidPlayback && typeof document !== 'undefined' && window.top === window && !document.documentElement?.hasAttribute?.('data-liquid-design-stage')) {
    const site = LiquidSites.identify(location.hostname), controller = new LiquidMediaController(LiquidUI.getStore('global'),
      { document, MutationObserver, selector: site.mediaSelector || 'video,audio' });
    globalThis.LiquidPlayback = Object.freeze({ getState: () => controller.state, subscribe: listener => controller.subscribe(listener) });
    controller.subscribe(() => document.dispatchEvent(new Event('liquid-ui:playback-status')));
    window.addEventListener('pagehide', event => { if (event.persisted) controller.pause();else controller.dispose(); });
    window.addEventListener('pageshow', event => { if (event.persisted) { controller.start();controller.publish(); } });
  }
})();
