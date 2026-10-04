(() => {
  'use strict';
  const prefix = 'yac-setting:';
  const ranges = { strength: [15, 100], blur: [0, 160], saturation: [0, 250], inset: [0, 40], fps: [24, 60],
    surfaceMultiplier: [0, 1], controlDensity: [0, 100], readingDensity: [0, 100], navigationDensity: [0, 100],
    surfaceDensity: [0, 100], controlDensityOffset: [-30, 30], readingDensityOffset: [-30, 30], navigationDensityOffset: [-30, 30], playbackRate: [.25, 3] };
  const surfaceKeys = ['surfaceMultiplier', 'controlDensity', 'readingDensity', 'navigationDensity'];
  const integerSliderKeys = new Set(['controlDensity', 'readingDensity', 'navigationDensity', 'strength', 'blur', 'saturation', 'inset', 'fps']);
  const legacySurfaceKeys = ['surfaceDensity', 'controlDensityOffset', 'readingDensityOffset', 'navigationDensityOffset'];
  const bounded = (values, key, fallback) => {
    const value = values?.[key], [min, max] = ranges[key];
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  };
  // Each preference has its own storage key. A stale tab cannot replace another
  // tab's warning choice when saving an unrelated slider. The old ambient bag
  // remains a read-only fallback for upgrades from earlier versions.
  class YacSettingsStore {
    static isContextInvalidated(error) {
      return /^Extension context invalidated\.?$/i.test(error?.message || '');
    }
    static migrateSurfaces(values = {}) {
      const master = bounded(values, 'surfaceDensity', 100) / 100;
      const levels = legacySurfaceKeys.slice(1).map(key => Math.min(1, master * (1 + bounded(values, key, 0) / 100)));
      // Preserve all three paint levels, including previously positive offsets.
      // This fallback is read-only; unrelated saves never write a whole profile.
      const surfaceMultiplier = Math.max(...levels);
      const result = { surfaceMultiplier };
      for (let i = 0; i < levels.length; i++) result[surfaceKeys[i + 1]] = surfaceMultiplier ? levels[i] / surfaceMultiplier * 100 : 100;
      return result;
    }
    static surfacePalette(values = {}) {
      const migrated = YacSettingsStore.migrateSurfaces(values);
      const master = bounded(values, 'surfaceMultiplier', migrated.surfaceMultiplier);
      const level = key => master * bounded(values, key, migrated[key]) / 100;
      const controls = level('controlDensity'), reading = level('readingDensity'), navigation = level('navigationDensity');
      const controlAlpha = .22 * controls, readingAlpha = .74 * reading, menuAlpha = .86 * navigation;
      // These are paint coefficients, not UI percentages or measured contrast.
      // Chat already has a reading face; its children add only the remaining shade.
      const palette = {
        '--yac-control-opacity': controlAlpha,
        '--yac-control-hover-opacity': .34 * controls,
        '--yac-control-selected-opacity': .44 * controls,
        '--yac-control-dark-brightness': 1 - .50 * controls,
        '--yac-control-dark-hover-brightness': 1 - .60 * controls,
        '--yac-chip-dark-brightness': 1 - .56 * controls,
        '--yac-control-light-contrast': 1 - .90 * controls,
        '--yac-control-light-brightness': 1 + .80 * controls,
        '--yac-control-blur': 12 * controls,
        '--yac-reading-blur': 12 * reading,
        '--yac-navigation-blur': 16 * navigation,
        '--yac-control-feedback': controls,
        '--yac-navigation-level': navigation,
        '--yac-reading-opacity': readingAlpha,
        '--yac-reading-hover-opacity': .80 * reading,
        // Long text panes avoid backdrop filters. Their denser paint protects
        // secondary/accent text without a per-comment blur or opacity floor.
        '--yac-reading-pane-opacity': .94 * reading,
        '--yac-reading-pane-hover-opacity': .98 * reading,
        '--yac-menu-opacity': menuAlpha,
        '--yac-guide-opacity': .78 * navigation,
        '--yac-secondary-opacity': .90 * navigation,
        '--yac-settings-opacity': .90 * navigation,
        '--yac-chat-header-opacity': .04 * reading / (1 - readingAlpha),
        '--yac-chat-overlay-opacity': Math.max(0, (menuAlpha - readingAlpha) / (1 - readingAlpha))
      };
      return Object.fromEntries(Object.entries(palette).map(([key, value]) => [key, value.toFixed(6) + (key.endsWith('-blur') ? 'px' : '')]));
    }
    constructor(storage, defaults, { onChange = () => {}, contextError = null, scope = '', inheritLegacy = false, globalKeys = [], rules = {}, fallbackKeys = {} } = {}) {
      if (scope && !/^[a-z0-9.-]+$/.test(scope)) throw new TypeError('Invalid settings scope');
      this.prefix = !scope ? prefix : scope === 'global' ? 'liquid-ui:global:' : 'liquid-ui:site:' + scope + ':';
      this.inheritLegacy = !scope || inheritLegacy;
      this.globalKeys = new Set(globalKeys);
      this.rules = rules;
      this.fallbackKeys = { ...fallbackKeys };this.profileFallbacks = new Map();
      this.fallbackOverrides = new Map();
      this.storage = storage; this.defaults = { ...defaults }; this.values = { ...defaults };
      this.onChange = onChange; this.loaded = false; this.disposed = false; this.contextError = contextError;
      this.legacy = {}; this.overrides = new Map(); this.edits = new Map(); this.events = [];
      this.saveErrors = new Map(); this.writeVersions = new Map(); this.persistenceRevision = 0;
      this.subscribers = new Set();
      this.listener = (changes, area) => {
        if (area !== 'local' || this.disposed || this.contextError) return;
        if (!this.loaded) this.events.push(changes);
        this.consume(changes); this.emit();
      };
      try { if (!this.contextError) storage.onChanged?.addListener(this.listener); }
      catch (error) {
        if (!YacSettingsStore.isContextInvalidated(error)) throw error;
        this.contextError = error;
      }
      this.ready = this.load();
    }
    storageKey(key) {
      return (this.globalKeys.has(key) ? 'liquid-ui:global:' : this.prefix) + key;
    }
    subscribe(listener) {
      this.subscribers.add(listener);
      if (this.loaded && !this.disposed) listener({ ...this.values }, this.lastMeta);
      return () => this.subscribers.delete(listener);
    }
    normalize(key, value) {
      if (!(key in this.defaults)) return undefined;
      const rule = this.rules[key];
      if (rule?.type === 'color' || key === 'accentColor') return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined;
      if (rule?.type === 'select') return rule.choices.some(choice => choice[0] === value) ? value : undefined;
      if (key === 'language') return ['ja', 'en'].includes(value) ? value : undefined;
      if (key === 'theme') return ['system', 'light', 'dark'].includes(value) ? value : undefined;
      if (key === 'playbackMode') return ['tempo', 'rate'].includes(value) ? value : undefined;
      if (typeof this.defaults[key] === 'boolean') return typeof value === 'boolean' ? value : undefined;
      const range = rule?.type === 'range' ? [rule.min / (rule.scale || 1), rule.max / (rule.scale || 1)] : ranges[key];
      if (!range || !Number.isFinite(value)) return undefined;
      const [min, max] = range, n = Math.min(max, Math.max(min, value));
      return key === 'fps' ? Math.round(n) : n;
    }
    quantize(key, value) {
      const rule = this.rules[key];
      if (Number.isInteger(rule?.storagePrecision) && rule.storagePrecision >= 0 && rule.storagePrecision <= 15) {
        // Semitone choices need their exact ratio. The percent control still
        // uses whole-percent steps; its display step does not detune a ratio.
        return Number(value.toFixed(rule.storagePrecision));
      }
      if (rule?.type === 'range') {
        const scale = rule.scale || 1, step = Number(rule.step) || 1;
        return Number((Math.min(rule.max, Math.max(rule.min,
          rule.min + Math.round((value * scale - rule.min) / step) * step)) / scale).toFixed(12));
      }
      if (key === 'surfaceMultiplier' || key === 'playbackRate') return Math.round(value * 100) / 100;
      return integerSliderKeys.has(key) ? Math.round(value) : value;
    }
    refresh() {
      const fallback = this.inheritLegacy ? { ...this.legacy, ...Object.fromEntries(this.fallbackOverrides) } : {};
      const oldSurfaces = { ...fallback };
      for (const key of legacySurfaceKeys) if (this.overrides.has(key)) oldSurfaces[key] = this.overrides.get(key);
      const migrated = YacSettingsStore.migrateSurfaces(oldSurfaces);
      const hasOldSurfaces = legacySurfaceKeys.some(key => Object.hasOwn(oldSurfaces, key));
      for (const key of Object.keys(this.defaults)) {
        const legacyValue = this.profileFallbacks.get(key) ?? fallback[key] ??
          (this.globalKeys.has(key) ? this.fallbackOverrides.get(key) ?? this.legacy[key] : undefined);
        const value = this.normalize(key, this.overrides.has(key) ? this.overrides.get(key) : legacyValue) ??
          (hasOldSurfaces && surfaceKeys.includes(key) ? migrated[key] : this.defaults[key]);
        // Match the displayed slider units without rewriting raw saved values.
        // Legacy inputs are converted at their original precision first.
        this.values[key] = this.quantize(key, value);
      }
    }
    consume(changes) {
      if (changes.ambient) this.legacy = changes.ambient.newValue || {};
      for (const key of new Set([...Object.keys(this.defaults), ...legacySurfaceKeys])) {
        const source = this.fallbackKeys[key], sourceChange = source && changes[source];
        if (sourceChange) {
          if (sourceChange.newValue === undefined) this.profileFallbacks.delete(key);
          else this.profileFallbacks.set(key, sourceChange.newValue);
        }
        if (this.prefix !== prefix && (this.inheritLegacy || this.globalKeys.has(key))) {
          const oldChange = changes[prefix + key];
          if (oldChange) {
            if (oldChange.newValue === undefined) this.fallbackOverrides.delete(key);
            else this.fallbackOverrides.set(key, oldChange.newValue);
          }
        }
        const change = changes[this.storageKey(key)];
        if (!change) continue;
        if (change.newValue === undefined) this.overrides.delete(key);
        else this.overrides.set(key, change.newValue);
      }
      this.refresh();
      // Preserve input that happened while the initial read was in flight.
      if (!this.loaded) for (const [key, value] of this.edits) this.values[key] = value;
    }
    async load() {
      let error;
      try {
        if (this.contextError) throw this.contextError;
        const keys = new Set([...Object.keys(this.defaults), ...legacySurfaceKeys]);
        const requested = ['ambient', ...[...keys].map(key => this.storageKey(key)), ...Object.values(this.fallbackKeys)];
        if (this.prefix !== prefix) for (const key of keys) {
          if (this.inheritLegacy || this.globalKeys.has(key)) requested.push(prefix + key);
        }
        const data = await this.storage.local.get([...new Set(requested)]);
        if (this.disposed) return;
        this.legacy = data.ambient || {}; this.overrides.clear();
        this.fallbackOverrides.clear();
        this.profileFallbacks.clear();
        for (const key of keys) {
          if (this.fallbackKeys[key] && Object.hasOwn(data, this.fallbackKeys[key])) this.profileFallbacks.set(key, data[this.fallbackKeys[key]]);
          if (this.prefix !== prefix && Object.hasOwn(data, prefix + key)) this.fallbackOverrides.set(key, data[prefix + key]);
          if (Object.hasOwn(data, this.storageKey(key))) this.overrides.set(key, data[this.storageKey(key)]);
        }
        this.refresh();
        for (const changes of this.events) this.consume(changes);
      } catch (caught) {
        error = caught;
        if (YacSettingsStore.isContextInvalidated(caught)) this.contextError = caught;
      }
      if (this.disposed) return;
      for (const [key, value] of this.edits) { this.overrides.set(key, value);this.values[key] = value; }
      this.events = []; this.edits.clear(); this.loaded = true; this.emit(error);
    }
    emit(error) {
      const signature = JSON.stringify([this.loaded, this.values, this.persistenceRevision, !!this.contextError]);
      if (!error && signature === this.emittedSignature) return;
      this.emittedSignature = signature;
      const failed = this.saveErrors.entries().next().value;
      this.lastMeta = { loaded: this.loaded, error, reloadRequired: !!this.contextError,
        saveError: failed ? { key: failed[0], error: failed[1] } : null,
        saveErrors: [...this.saveErrors].map(([key, error]) => ({ key, error })), saveErrorCount: this.saveErrors.size };
      this.onChange({ ...this.values }, this.lastMeta);
      for (const listener of this.subscribers) listener({ ...this.values }, this.lastMeta);
    }
    set(key, value, persist = false) {
      return this.setMany({ [key]: value }, persist);
    }
    setMany(values, persist = false) {
      if (this.disposed) return Promise.resolve();
      const normalized = {};
      for (const [key, value] of Object.entries(values)) {
        const valid = this.normalize(key, value);
        if (valid === undefined) return Promise.resolve();
        normalized[key] = this.quantize(key, valid);
      }
      const keys = Object.keys(normalized);if (!keys.length) return Promise.resolve();
      for (const key of keys) {
        if (!this.loaded) this.edits.set(key, normalized[key]);
        this.overrides.set(key, normalized[key]);this.values[key] = normalized[key];
      }
      this.emit();
      if (!persist) return Promise.resolve();
      if (this.contextError) return Promise.reject(this.contextError);
      const versions = new Map(keys.map(key => {
        const version = (this.writeVersions.get(key) || 0) + 1;this.writeVersions.set(key, version);return [key, version];
      }));
      // Keep the explicitly chosen value on this page, including a reduction to
      // 15%. Report durability failures separately, without silently undoing it.
      return Promise.resolve().then(() => {
        if (this.contextError) throw this.contextError;
        return this.storage.local.set(Object.fromEntries(keys.map(key => [this.storageKey(key), normalized[key]])));
      }).then(() => {
        if (!this.disposed && !this.contextError) {
          let cleared = false;
          for (const [key, version] of versions) if (this.writeVersions.get(key) === version && this.saveErrors.delete(key)) cleared = true;
          if (cleared) { this.persistenceRevision++;this.emit(); }
        }
      }, error => {
        // This page cannot reconnect to a reloaded extension. Keep local paint,
        // stop calling the retired API, and ask the user to reload the page.
        if (!this.disposed && YacSettingsStore.isContextInvalidated(error)) this.contextError = error;
        if (!this.disposed) {
          let failed = false;
          for (const [key, version] of versions) if (this.writeVersions.get(key) === version) { this.saveErrors.set(key, error);failed = true; }
          if (failed) { this.persistenceRevision++;this.emit(error); }else if (this.contextError) this.emit();
        }
        throw error;
      });
    }
    dispose() {
      this.disposed = true; this.events = []; this.edits.clear();
      this.subscribers.clear();
      try { this.storage.onChanged?.removeListener(this.listener); }
      catch (error) { if (!YacSettingsStore.isContextInvalidated(error)) throw error; }
    }
  }
  globalThis.YacSettingsStore = YacSettingsStore;
  if (typeof module !== 'undefined') module.exports = YacSettingsStore;
})();
