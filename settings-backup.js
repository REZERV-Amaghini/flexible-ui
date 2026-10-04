/* Versioned preferences only. Media, browser storage bags and account data are never exported. */
(() => {
  'use strict';
  const format = 'liquid-ui-settings', formatVersion = 1, maxBytes = 128 * 1024;
  const previews = new WeakSet(), forbidden = new Set(['__proto__', 'constructor', 'prototype']);
  const SettingsStore = globalThis.YacSettingsStore || (typeof require === 'function' ? require('./settings-store.js') : null);
  class SettingsBackupError extends Error {
    constructor(code, path = '') {
      super('Invalid settings backup: ' + code + (path ? ' (' + path + ')' : ''));
      this.name = 'SettingsBackupError';this.code = code;this.path = path;
    }
  }
  const fail = (code, path) => { throw new SettingsBackupError(code, path); };
  const object = (value, path) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('invalidObject', path);
    return value;
  };
  function schema(registry) {
    if (!registry?.list || !SettingsStore) fail('unavailable');
    const global = { id: 'global', defaults: registry.globalDefaults, groups: registry.globalGroups };
    const definitions = [global, ...registry.list()], shared = new Set(Object.keys(global.defaults));
    return new Map(definitions.map(definition => {
      const defaults = Object.fromEntries(Object.entries(definition.defaults)
        .filter(([key]) => definition.id === 'global' || !shared.has(key)));
      const rules = Object.fromEntries(definition.groups.flatMap(group => group.fields).map(field => [field.key, field]));
      return [definition.id, { defaults, rules }];
    }));
  }
  function validateValue(definition, key, value, path) {
    if (!Object.hasOwn(definition.defaults, key)) fail('unknownSetting', path);
    if (typeof value !== typeof definition.defaults[key]) fail('invalidType', path);
    const normalized = SettingsStore.prototype.normalize.call(definition, key, value);
    if (normalized === undefined) fail('invalidValue', path);
    if (normalized !== value && definition.rules[key]?.type !== 'color') fail('outOfRange', path);
    const quantized = SettingsStore.prototype.quantize.call(definition, key, normalized);
    if (quantized !== normalized) fail('invalidPrecision', path);
    return normalized;
  }
  function validateMetadata(data) {
    object(data, '');
    const allowed = new Set(['format', 'formatVersion', 'extensionVersion', 'exportedAt', 'profiles']);
    for (const key of Object.keys(data)) if (!allowed.has(key)) fail('unknownProperty', key);
    if (data.format !== format) fail('invalidFormat', 'format');
    if (data.formatVersion !== formatVersion) fail('unsupportedVersion', 'formatVersion');
    if (typeof data.extensionVersion !== 'string' || !/^\d+(?:\.\d+){1,3}$/.test(data.extensionVersion) || data.extensionVersion.length > 50) fail('invalidMetadata', 'extensionVersion');
    if (typeof data.exportedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data.exportedAt) ||
      !Number.isFinite(Date.parse(data.exportedAt)) || new Date(data.exportedAt).toISOString() !== data.exportedAt) fail('invalidMetadata', 'exportedAt');
    object(data.profiles, 'profiles');
    if (!Object.keys(data.profiles).length) fail('emptySettings', 'profiles');
  }
  async function readyStore(id, getStore) {
    let store;
    try { store = await getStore(id);await store?.ready; }
    catch { fail('storageUnavailable', 'profiles.' + id); }
    if (!store?.ready || typeof store.setMany !== 'function') fail('unavailable', 'profiles.' + id);
    checkReady(store, id);
    return store;
  }
  function checkReady(store, id) {
    if (store.disposed || store.contextError || !store.loaded || (store.lastMeta?.error && !store.lastMeta?.saveError)) fail('storageUnavailable', 'profiles.' + id);
  }
  async function exportSettings({ registry, getStore, extensionVersion }) {
    const definitions = schema(registry), profiles = {};
    // Read every known profile before returning a complete document.
    for (const [id, definition] of definitions) {
      const store = await readyStore(id, getStore), values = {};
      for (const key of Object.keys(definition.defaults)) values[key] = validateValue(definition, key, store.values[key], 'profiles.' + id + '.' + key);
      profiles[id] = values;
    }
    const result = { format, formatVersion, extensionVersion, exportedAt: new Date().toISOString(), profiles };
    validateMetadata(result);
    return result;
  }
  function parseSettings(jsonString, { registry }) {
    if (typeof jsonString !== 'string') fail('invalidType');
    if (jsonString.length > maxBytes || new TextEncoder().encode(jsonString).byteLength > maxBytes) fail('fileTooLarge');
    if (!jsonString.trim()) fail('emptyFile');
    let data;
    try {
      data = JSON.parse(jsonString.replace(/^\uFEFF/, ''), (key, value) => {
        if (forbidden.has(key)) fail('unsafeProperty', key);
        return value;
      });
    } catch (error) {
      if (error instanceof SettingsBackupError) throw error;
      fail('invalidJSON');
    }
    validateMetadata(data);
    const definitions = schema(registry), profiles = [];let settingCount = 0;
    for (const [id, values] of Object.entries(data.profiles)) {
      if (!definitions.has(id)) fail('unknownProfile', 'profiles.' + id);
      object(values, 'profiles.' + id);
      const changes = {};
      for (const [key, value] of Object.entries(values)) changes[key] = validateValue(definitions.get(id), key, value, 'profiles.' + id + '.' + key);
      const count = Object.keys(changes).length;
      if (!count) fail('emptySettings', 'profiles.' + id);
      settingCount += count;profiles.push(Object.freeze({ id, changes: Object.freeze(changes), count }));
    }
    const preview = Object.freeze({ format, formatVersion, extensionVersion: data.extensionVersion, exportedAt: data.exportedAt,
      profiles: Object.freeze(profiles), profileCount: profiles.length, settingCount });
    previews.add(preview);return preview;
  }
  async function applySettings(preview, { getStore }) {
    if (!previews.has(preview)) fail('invalidPreview');
    const plans = [];
    // Resolve all stores before changing any preference.
    for (const profile of preview.profiles) {
      const store = await readyStore(profile.id, getStore);
      plans.push({ ...profile, store });
    }
    const result = { ok: true, appliedProfiles: [], failedProfiles: [], rolledBackProfiles: [], rollbackFailedProfiles: [],
      rollbackSkippedKeys: [], skippedProfiles: [], unchangedProfiles: [], settingCount: 0 };
    const attempted = [];
    for (let index = 0; index < plans.length; index++) {
      const plan = plans[index];
      // Snapshot immediately before this write, including other tabs' latest
      // changes, rather than restoring a stale value from the start of import.
      plan.before = Object.fromEntries(Object.keys(plan.changes).map(key => [key, plan.store.values[key]]));
      const changes = Object.fromEntries(Object.entries(plan.changes).filter(([key, value]) =>
        !Object.is(plan.before[key], value) || plan.store.saveErrors?.has(key)));
      plan.changes = changes;
      try {
        checkReady(plan.store, plan.id);
        if (!Object.keys(changes).length) { result.unchangedProfiles.push(plan.id);continue; }
        attempted.push(plan);
        const pending = plan.store.setMany(plan.changes, true);
        plan.writeVersions = new Map(Object.keys(plan.changes).map(key => [key, plan.store.writeVersions?.get(key)]));
        await pending;
        result.appliedProfiles.push(plan.id);result.settingCount += Object.keys(changes).length;
      } catch (error) {
        result.ok = false;result.failedProfiles.push({ id: plan.id, error });
        result.skippedProfiles = plans.slice(index + 1).map(item => item.id);
        // setMany updates local values before persistence. Restore the failed
        // profile too, and report rollback writes that could not be saved.
        for (const previous of attempted.reverse()) {
          const restore = {}, skipped = [];
          for (const key of Object.keys(previous.changes)) {
            if (Object.is(previous.store.values[key], previous.changes[key]) &&
              previous.store.writeVersions?.get(key) === previous.writeVersions?.get(key)) restore[key] = previous.before[key];
            else skipped.push(key);
          }
          if (skipped.length) result.rollbackSkippedKeys.push({ id: previous.id, keys: skipped });
          if (!Object.keys(restore).length) continue;
          try {
            checkReady(previous.store, previous.id);
            await previous.store.setMany(restore, true);
            result.rolledBackProfiles.push(previous.id);
          } catch (rollbackError) { result.rollbackFailedProfiles.push({ id: previous.id, error: rollbackError }); }
        }
        return result;
      }
    }
    return result;
  }
  const api = Object.freeze({ format, formatVersion, maxBytes, SettingsBackupError, exportSettings, parseSettings, applySettings });
  globalThis.LiquidSettingsBackup = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
