'use strict';
const assert = require('node:assert/strict');
const registry = require('../site-registry.js'), SettingsStore = require('../settings-store.js'), backup = require('../settings-backup.js');
function harness(initial = {}, options = {}) {
  const data = { ...initial }, listeners = new Set(), writes = [], stores = new Map();
  const storage = {
    onChanged: { addListener(fn) { listeners.add(fn); }, removeListener(fn) { listeners.delete(fn); } },
    local: {
      async get(keys) {
        if (options.failRead) throw new Error('Read failed');
        return Object.fromEntries(keys.filter(key => Object.hasOwn(data, key)).map(key => [key, data[key]]));
      },
      async set(values) {
        writes.push({ ...values });const count = writes.length;
        await options.beforeWrite?.(values, count);
        if (options.failWrite?.(values, count)) throw new Error('Write failed');
        const changes = {};
        for (const [key, value] of Object.entries(values)) { changes[key] = { oldValue: data[key], newValue: value };data[key] = value; }
        for (const listener of [...listeners]) listener(changes, 'local');
      }
    }
  };
  function getStore(id) {
    if (stores.has(id)) return stores.get(id);
    const definition = id === 'global' ? { defaults: registry.globalDefaults, groups: registry.globalGroups, inheritLegacy: true } : registry.list().find(site => site.id === id);
    assert.ok(definition, id);
    const store = new SettingsStore(storage, definition.defaults, {
      scope: id, inheritLegacy: !!definition.inheritLegacy, globalKeys: id === 'global' ? [] : ['language'],
      rules: Object.fromEntries(definition.groups.flatMap(group => group.fields).map(field => [field.key, field])),
      fallbackKeys: id === 'global' ? registry.playbackFallbackKeys : {}
    });
    stores.set(id, store);return store;
  }
  return { storage, getStore, stores, writes, data,
    async ready() { await Promise.all(['global', ...registry.list().map(site => site.id)].map(id => getStore(id).ready)); },
    dispose() { for (const store of stores.values()) store.dispose(); }
  };
}
const document = profiles => ({ format: backup.format, formatVersion: backup.formatVersion, extensionVersion: '3.0.31',
  exportedAt: '2026-10-04T12:34:56.789Z', profiles });
const parse = data => backup.parseSettings(JSON.stringify(data), { registry });
function invalid(data, code, path) {
  assert.throws(() => typeof data === 'string' ? backup.parseSettings(data, { registry }) : parse(data),
    error => error instanceof backup.SettingsBackupError && error.code === code && (path === undefined || error.path === path), code + ' rejected');
}
(async () => {
  const source = harness({ 'liquid-ui:global:language': 'en', 'liquid-ui:global:theme': 'dark', 'liquid-ui:global:playbackRate': 1.059463094359,
    'liquid-ui:site:youtube:strength': 74, 'liquid-ui:site:youtube:sidebarFilter': 'channel',
    'liquid-ui:site:youtube:useCustomAccent': true, 'liquid-ui:site:youtube:accentColor': '#AF52DE',
    'liquid-ui:site:youtube-music:chromeDensity': 35, 'liquid-ui:site:x:cornerRadius': 22,
    'private-account': { token: 'not-a-real-secret' }, 'liquid-ui:site:youtube:unknown': 'not exported' });
  const exported = await backup.exportSettings({ registry, getStore: source.getStore, extensionVersion: '3.0.31' });
  assert.deepEqual(Object.keys(exported.profiles), ['global', 'youtube', 'youtube-music', 'x']);
  assert.equal(exported.profiles.global.language, 'en');assert.ok(!Object.hasOwn(exported.profiles.youtube, 'language'));
  assert.equal(exported.profiles.global.playbackRate, 1.059463094359);assert.equal(exported.profiles.youtube.strength, 74);
  assert.equal(exported.profiles['youtube-music'].chromeDensity, 35);assert.equal(exported.profiles.x.cornerRadius, 22);
  assert.equal(exported.profiles.youtube.accentColor, '#af52de');assert.equal(exported.profiles.youtube.useCustomAccent, true);
  assert.ok(!Object.hasOwn(exported.profiles.global, 'accentColor') && !Object.hasOwn(exported.profiles['youtube-music'], 'accentColor'));
  assert.ok(!JSON.stringify(exported).includes('not-a-real-secret'));assert.ok(!JSON.stringify(exported).includes('unknown'));
  const preview = parse(exported);
  assert.equal(preview.profileCount, 4);assert.equal(preview.settingCount, Object.values(exported.profiles).reduce((count, values) => count + Object.keys(values).length, 0));
  assert.ok(Object.isFrozen(preview) && Object.isFrozen(preview.profiles) && Object.isFrozen(preview.profiles[0].changes));
  assert.throws(() => { preview.profiles[0].changes.language = 'ja'; }, TypeError);
  const target = harness();const applied = await backup.applySettings(preview, { getStore: target.getStore });
  assert.equal(applied.ok, true);assert.deepEqual(applied.appliedProfiles, ['global', 'youtube', 'youtube-music', 'x']);
  assert.equal(target.data['liquid-ui:global:language'], 'en');assert.ok(!Object.hasOwn(target.data, 'liquid-ui:site:youtube:language'));
  assert.equal(target.data['liquid-ui:site:youtube:strength'], 74);assert.equal(target.data['liquid-ui:global:playbackRate'], 1.059463094359);
  const roundTrip = await backup.exportSettings({ registry, getStore: target.getStore, extensionVersion: '3.0.31' });
  assert.deepEqual(roundTrip.profiles, exported.profiles);
  const writeCount = target.writes.length, repeated = await backup.applySettings(preview, { getStore: target.getStore });
  assert.equal(repeated.ok, true);assert.equal(repeated.settingCount, 0);assert.equal(target.writes.length, writeCount);
  assert.deepEqual(repeated.unchangedProfiles, ['global', 'youtube', 'youtube-music', 'x']);
  await assert.rejects(() => backup.applySettings({ ...preview }, { getStore: target.getStore }), { code: 'invalidPreview' });

  invalid('', 'emptyFile');invalid('   ', 'emptyFile');invalid('{', 'invalidJSON');invalid('null', 'invalidObject');invalid('[]', 'invalidObject');
  invalid(document({}), 'emptySettings');invalid(document({ youtube: {} }), 'emptySettings');
  invalid({ ...document({ youtube: { enabled: true } }), format: 'another-extension' }, 'invalidFormat');
  invalid({ ...document({ youtube: { enabled: true } }), formatVersion: 2 }, 'unsupportedVersion');
  invalid({ ...document({ youtube: { enabled: true } }), extensionVersion: '<script>' }, 'invalidMetadata');
  invalid({ ...document({ youtube: { enabled: true } }), exportedAt: '2026-02-30T00:00:00.000Z' }, 'invalidMetadata');
  invalid({ ...document({ youtube: { enabled: true } }), accounts: {} }, 'unknownProperty');
  invalid(document({ future: { enabled: true } }), 'unknownProfile');
  invalid(document({ youtube: [] }), 'invalidObject');invalid(document({ youtube: { random: 1 } }), 'unknownSetting');
  invalid(document({ youtube: { language: 'en' } }), 'unknownSetting', 'profiles.youtube.language');
  invalid(document({ global: { language: 'fr' } }), 'invalidValue');invalid(document({ global: { theme: 'sepia' } }), 'invalidValue');
  invalid(document({ youtube: { enabled: 'true' } }), 'invalidType');invalid(document({ youtube: { enabled: 1 } }), 'invalidType');
  invalid(document({ youtube: { blur: '65' } }), 'invalidType');invalid(document({ youtube: { blur: null } }), 'invalidType');
  invalid(document({ youtube: { strength: 14 } }), 'outOfRange');invalid(document({ youtube: { strength: 101 } }), 'outOfRange');
  invalid(document({ youtube: { blur: 65.5 } }), 'invalidPrecision');invalid(document({ youtube: { fps: 59.5 } }), 'outOfRange');
  invalid(document({ youtube: { surfaceMultiplier: .655 } }), 'invalidPrecision');
  invalid(document({ global: { playbackRate: Math.pow(2, 1 / 12) } }), 'invalidPrecision');
  invalid(document({ global: { playbackRate: 3.01 } }), 'outOfRange');
  invalid(document({ youtube: { sidebarFilter: 'chip:music' } }), 'invalidValue');
  invalid(document({ youtube: { accentColor: '#fff' } }), 'invalidValue');
  invalid(document({ youtube: { accentColor: 'url(https://example.invalid)' } }), 'invalidValue');
  invalid(document({ youtube: { accentColor: '#12345678' } }), 'invalidValue');
  invalid(document({ youtube: { accentColor: 0xffffff } }), 'invalidType');
  assert.equal(parse(document({ youtube: { accentColor: '#007aff', useCustomAccent: true } })).settingCount, 2);
  assert.equal(parse(document({ youtube: { accentColor: '#ABCDEF' } })).profiles[0].changes.accentColor, '#abcdef', 'case folding is allowed for color without rounding numeric preferences');
  invalid('{"format":"liquid-ui-settings","formatVersion":1,"extensionVersion":"3.0.31","exportedAt":"2026-10-04T12:34:56.789Z","profiles":{"youtube":{"__proto__":{"enabled":true}}}}', 'unsafeProperty');
  invalid('{"constructor":{},"format":"liquid-ui-settings"}', 'unsafeProperty');
  invalid(document({ youtube: { enabled: { prototype: true } } }), 'unsafeProperty');
  invalid(' '.repeat(backup.maxBytes + 1) + '{}', 'fileTooLarge');
  invalid(JSON.stringify({ note: '語'.repeat(backup.maxBytes / 2) }), 'fileTooLarge');
  assert.equal(backup.parseSettings('\uFEFF' + JSON.stringify(document({ youtube: { enabled: false } })), { registry }).profileCount, 1);
  assert.equal(parse(document({ youtube: { strength: 15, blur: 0, saturation: 250, inset: 40, fps: 24, surfaceMultiplier: 0 } })).settingCount, 6);

  // A damaged final profile cannot write an earlier valid one.
  const writesBeforeInvalid = target.writes.length;
  invalid(document({ global: { theme: 'light' }, x: { chromeDensity: 100.5 } }), 'outOfRange');
  assert.equal(target.writes.length, writesBeforeInvalid);
  const readFailure = harness({}, { failRead: true });
  await assert.rejects(() => backup.exportSettings({ registry, getStore: readFailure.getStore, extensionVersion: '3.0.31' }), { code: 'storageUnavailable' });
  const disposed = harness();await disposed.ready();disposed.getStore('youtube').dispose();
  await assert.rejects(() => backup.exportSettings({ registry, getStore: disposed.getStore, extensionVersion: '3.0.31' }), { code: 'storageUnavailable' });
  const retired = harness();await retired.ready();retired.getStore('x').contextError = new Error('Extension context invalidated.');
  await assert.rejects(() => backup.exportSettings({ registry, getStore: retired.getStore, extensionVersion: '3.0.31' }), { code: 'storageUnavailable' });
  const lateReadFailure = harness();await lateReadFailure.ready();lateReadFailure.getStore('x').contextError = new Error('Extension context invalidated.');
  await assert.rejects(() => backup.applySettings(parse(document({ global: { theme: 'dark' }, x: { chromeDensity: 35 } })), { getStore: lateReadFailure.getStore }), { code: 'storageUnavailable' });
  assert.equal(lateReadFailure.writes.length, 0, 'every target is ready before first mutation');

  const recovering = harness({}, { failWrite: (_, count) => count === 2 });
  const recoveryResult = await backup.applySettings(parse(document({ global: { theme: 'dark' }, youtube: { strength: 75 }, x: { cornerRadius: 20 } })), { getStore: recovering.getStore });
  assert.equal(recoveryResult.ok, false);assert.deepEqual(recoveryResult.appliedProfiles, ['global']);
  assert.deepEqual(recoveryResult.failedProfiles.map(item => item.id), ['youtube']);assert.deepEqual(recoveryResult.skippedProfiles, ['x']);
  assert.deepEqual(recoveryResult.rolledBackProfiles, ['youtube', 'global']);assert.equal(recoveryResult.rollbackFailedProfiles.length, 0);
  assert.equal(recovering.getStore('global').values.theme, 'system');assert.equal(recovering.getStore('youtube').values.strength, 100);
  assert.equal(recovering.data['liquid-ui:global:theme'], 'system');assert.equal(recovering.data['liquid-ui:site:youtube:strength'], 100);
  assert.ok(!Object.hasOwn(recovering.data, 'liquid-ui:site:x:cornerRadius'));

  const unavailableStorage = harness({}, { failWrite: (_, count) => count >= 2 });
  const failedRollback = await backup.applySettings(parse(document({ global: { theme: 'dark' }, youtube: { strength: 75 } })), { getStore: unavailableStorage.getStore });
  assert.equal(failedRollback.ok, false);assert.deepEqual(failedRollback.rollbackFailedProfiles.map(item => item.id), ['youtube', 'global']);
  assert.equal(unavailableStorage.getStore('global').values.theme, 'system', 'failed rollback still restores local paint');
  assert.equal(unavailableStorage.data['liquid-ui:global:theme'], 'dark', 'durability failure remains visible in result');

  let concurrent;
  concurrent = harness({}, { failWrite: (_, count) => count === 2, async beforeWrite(_, count) {
    if (count === 2) await concurrent.storage.local.set({ 'liquid-ui:global:theme': 'light' });
  } });
  // The nested write is count 3, so fail only the original YouTube write.
  const conflict = await backup.applySettings(parse(document({ global: { theme: 'dark' }, youtube: { strength: 75 } })), { getStore: concurrent.getStore });
  assert.equal(conflict.ok, false);assert.deepEqual(conflict.rollbackSkippedKeys, [{ id: 'global', keys: ['theme'] }]);
  assert.equal(concurrent.getStore('global').values.theme, 'light');assert.equal(concurrent.data['liquid-ui:global:theme'], 'light');

  let sameValue;
  sameValue = harness({}, { failWrite: (_, count) => count === 2, async beforeWrite(_, count) {
    if (count === 2) await sameValue.getStore('global').setMany({ theme: 'dark' }, true);
  } });
  const newerWrite = await backup.applySettings(parse(document({ global: { theme: 'dark' }, youtube: { strength: 75 } })), { getStore: sameValue.getStore });
  assert.equal(newerWrite.ok, false);assert.deepEqual(newerWrite.rollbackSkippedKeys, [{ id: 'global', keys: ['theme'] }]);
  assert.equal(sameValue.getStore('global').values.theme, 'dark', 'a new local write of the same value has its own ownership');

  let latestSnapshot;
  latestSnapshot = harness({}, { failWrite: (_, count) => count === 3, async beforeWrite(_, count) {
    if (count === 1) await latestSnapshot.storage.local.set({ 'liquid-ui:site:youtube:strength': 85 });
  } });
  const freshRecovery = await backup.applySettings(parse(document({ global: { theme: 'dark' }, youtube: { strength: 75 } })), { getStore: latestSnapshot.getStore });
  assert.equal(freshRecovery.ok, false);assert.equal(latestSnapshot.getStore('youtube').values.strength, 85);
  assert.equal(latestSnapshot.data['liquid-ui:site:youtube:strength'], 85, 'rollback uses the value immediately before that profile write');

  let lateDisposal;
  lateDisposal = harness({}, { async beforeWrite(_, count) { if (count === 1) lateDisposal.getStore('youtube').dispose(); } });
  const disposalResult = await backup.applySettings(parse(document({ global: { theme: 'dark' }, youtube: { strength: 75 } })), { getStore: lateDisposal.getStore });
  assert.equal(disposalResult.ok, false);assert.deepEqual(disposalResult.failedProfiles.map(item => item.id), ['youtube']);
  assert.equal(lateDisposal.getStore('global').values.theme, 'system');assert.ok(!Object.hasOwn(lateDisposal.data, 'liquid-ui:site:youtube:strength'));

  let pageDisposed;
  pageDisposed = harness({}, { async beforeWrite(_, count) { if (count === 1) for (const store of pageDisposed.stores.values()) store.dispose(); } });
  const disposedRecovery = await backup.applySettings(parse(document({ global: { theme: 'dark' }, youtube: { strength: 75 } })), { getStore: pageDisposed.getStore });
  assert.equal(disposedRecovery.ok, false);assert.deepEqual(disposedRecovery.rollbackFailedProfiles.map(item => item.id), ['global']);
  assert.deepEqual(disposedRecovery.rolledBackProfiles, [], 'disposed setMany no-op must not report a restored profile');
  assert.equal(pageDisposed.data['liquid-ui:global:theme'], 'dark', 'an in-flight write can finish after page disposal');

  let pageRetired;
  pageRetired = harness({}, { async beforeWrite(_, count) { if (count === 1) for (const store of pageRetired.stores.values()) store.contextError = new Error('Extension context invalidated.'); } });
  const retiredRecovery = await backup.applySettings(parse(document({ global: { theme: 'dark' }, youtube: { strength: 75 } })), { getStore: pageRetired.getStore });
  assert.equal(retiredRecovery.ok, false);assert.deepEqual(retiredRecovery.rollbackFailedProfiles.map(item => item.id), ['global']);
  assert.deepEqual(retiredRecovery.rolledBackProfiles, []);assert.equal(pageRetired.writes.length, 1, 'retired storage is not called again during recovery');

  const pendingSave = harness({}, { failWrite: (_, count) => count === 1 });
  await pendingSave.ready();await assert.rejects(() => pendingSave.getStore('youtube').set('strength', 75, true));
  const durable = await backup.applySettings(parse(document({ youtube: { strength: 75 } })), { getStore: pendingSave.getStore });
  assert.equal(durable.ok, true);assert.equal(durable.settingCount, 1);assert.equal(pendingSave.data['liquid-ui:site:youtube:strength'], 75);
  assert.equal(pendingSave.getStore('youtube').saveErrors.size, 0, 'equal local values with failed persistence are retried');

  for (const item of [source, target, readFailure, disposed, retired, lateReadFailure, recovering, unavailableStorage, concurrent, sameValue, latestSnapshot, lateDisposal, pageDisposed, pageRetired, pendingSave]) item.dispose();
  console.log('Settings backup checks passed: scoped round-trip, strict validation, atomic validation, recovery and concurrent edits.');
})().catch(error => { console.error(error);process.exitCode = 1; });
