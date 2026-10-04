'use strict';
const assert = require('node:assert/strict');
const Store = require('../settings-store.js');
const defaults = { enabled: true, radial: true, avoidBars: true, fillBars: true, flashWarning: true,
  strength: 65, blur: 90, saturation: 145, inset: 0, fps: 30, language: 'ja',
  surfaceDensity: 100, controlDensityOffset: 0, readingDensityOffset: 0, navigationDensityOffset: 0 };
function backend(initial = {}, hold = false) {
  const data = structuredClone(initial), listeners = new Set(), reads = [], writes = [];
  const storage = { onChanged: { addListener: f => listeners.add(f), removeListener: f => listeners.delete(f) }, local: {
    get: keys => {
      const snapshot = Object.fromEntries(keys.filter(k => Object.hasOwn(data, k)).map(k => [k, structuredClone(data[k])]));
      return hold ? new Promise(resolve => reads.push(() => resolve(snapshot))) : Promise.resolve(snapshot);
    },
    set: async values => {
      writes.push(structuredClone(values));
      const changes = {};
      for (const [key, value] of Object.entries(values)) { changes[key] = { oldValue: data[key], newValue: value };data[key] = value; }
      for (const listener of listeners) listener(changes, 'local');
    }
  } };
  return { storage, data, listeners, reads, writes };
}
function pendingBackend(initial = {}) {
  const result = backend(initial), attempts = [];
  result.storage.local.set = values => {
    result.writes.push(structuredClone(values));
    return new Promise((resolve, reject) => attempts.push({
      succeed: () => {
        for (const [key, value] of Object.entries(values)) result.data[key] = structuredClone(value);
        resolve();
      },
      fail: reject
    }));
  };
  const complete = async (index, outcome, error) => {
    await new Promise(setImmediate);
    assert.ok(attempts[index], `Storage write ${index + 1} was started`);
    attempts[index][outcome](error);
  };
  return { ...result, succeed: index => complete(index, 'succeed'), fail: (index, error) => complete(index, 'fail', error) };
}
function observedStore(storage) {
  const changes = [];
  const store = new Store(storage, defaults, { onChange: (values, meta) => changes.push({ values, ...meta }) });
  return { store, changes };
}
function assertSaveError(change, key, error, count) {
  assert.equal(change.saveError.key, key);
  assert.equal(change.saveError.error, error);
  assert.equal(change.saveErrorCount, count);
}
function assertAnySaveError(change, expected) {
  assert.equal(change.saveErrorCount, expected.length);
  assert.ok(expected.some(([key, error]) => change.saveError.key === key && change.saveError.error === error),
    'The visible save error belongs to one of the unresolved keys');
}
function checkSurfacePalette() {
  const bounds = {
    '--yac-control-opacity': [0, .22], '--yac-control-hover-opacity': [0, .34],
    '--yac-control-selected-opacity': [0, .44], '--yac-control-dark-brightness': [.50, 1],
    '--yac-control-dark-hover-brightness': [.40, 1], '--yac-chip-dark-brightness': [.44, 1],
    '--yac-control-light-contrast': [.1, 1], '--yac-control-light-brightness': [1, 1.8],
    '--yac-control-blur': [0, 12], '--yac-reading-blur': [0, 12], '--yac-navigation-blur': [0, 16],
    '--yac-control-feedback': [0, 1], '--yac-navigation-level': [0, 1],
    '--yac-reading-opacity': [0, .74], '--yac-reading-hover-opacity': [0, .80],
    '--yac-reading-pane-opacity': [0, .94], '--yac-reading-pane-hover-opacity': [0, .98],
    '--yac-menu-opacity': [0, .86], '--yac-guide-opacity': [0, .78],
    '--yac-secondary-opacity': [0, .90], '--yac-settings-opacity': [0, .90],
    '--yac-chat-header-opacity': [0, 1], '--yac-chat-overlay-opacity': [0, 1]
  };
  const defaultPalette = Store.surfacePalette();
  assert.deepEqual(Object.keys(defaultPalette).sort(), Object.keys(bounds).sort());
  assert.deepEqual(Store.surfacePalette(null), defaultPalette);
  const densityKeys = ['surfaceDensity', 'controlDensityOffset', 'readingDensityOffset', 'navigationDensityOffset'];
  for (const key of densityKeys) {
    for (const value of [NaN, Infinity, -Infinity, null, '35', {}, []]) {
      assert.deepEqual(Store.surfacePalette({ [key]: value }), defaultPalette, `${key}: invalid values use the default palette`);
    }
    const range = key === 'surfaceDensity' ? [0, 100] : [-30, 30];
    assert.deepEqual(Store.surfacePalette({ [key]: -1000 }), Store.surfacePalette({ [key]: range[0] }));
    assert.deepEqual(Store.surfacePalette({ [key]: 1000 }), Store.surfacePalette({ [key]: range[1] }));
  }
  const composite = (base, layer) => base + (1 - base) * layer;
  let cases = 0;
  for (const surfaceDensity of [0, 35, 100]) {
    for (const controlDensityOffset of [-30, 0, 30]) {
      for (const readingDensityOffset of [-30, 0, 30]) {
        for (const navigationDensityOffset of [-30, 0, 30]) {
          const input = Object.freeze({ surfaceDensity, controlDensityOffset, readingDensityOffset, navigationDensityOffset });
          const tokens = Store.surfacePalette(input), palette = Object.fromEntries(Object.entries(tokens).map(([key, value]) => [key, parseFloat(value)]));
          for (const [key, [min, max]] of Object.entries(bounds)) {
            assert.match(tokens[key], key.endsWith('-blur') ? /^\d+\.\d{6}px$/ : /^\d+\.\d{6}$/, `${key} is a finite CSS value`);
            assert.ok(palette[key] >= min && palette[key] <= max, `${key} stays within its surface bounds`);
          }
          assert.ok(palette['--yac-control-opacity'] <= palette['--yac-control-hover-opacity']);
          assert.ok(palette['--yac-control-hover-opacity'] <= palette['--yac-control-selected-opacity']);
          assert.ok(palette['--yac-reading-hover-opacity'] >= palette['--yac-reading-opacity']);
          assert.ok(palette['--yac-reading-pane-hover-opacity'] >= palette['--yac-reading-pane-opacity']);
          if (surfaceDensity === 0) {
            for (const key of Object.keys(bounds).filter(key => key.endsWith('-opacity') || key.endsWith('-blur') || key === '--yac-control-feedback' || key === '--yac-navigation-level')) {
              assert.equal(palette[key], 0, `${key}: zero is completely clear, including positive category adjustments`);
            }
            for (const key of ['--yac-control-dark-brightness', '--yac-control-dark-hover-brightness', '--yac-chip-dark-brightness', '--yac-control-light-contrast', '--yac-control-light-brightness']) {
              assert.equal(palette[key], 1, `${key}: zero does not dim or brighten the backdrop`);
            }
          }
          const reading = palette['--yac-reading-opacity'], menu = palette['--yac-menu-opacity'];
          const overlay = composite(reading, palette['--yac-chat-overlay-opacity']);
          assert.ok(overlay + .00003 >= Math.max(reading, menu), 'Chat overlay is not thinner than either reading or menu surface');
          assert.ok(overlay <= Math.max(reading, menu) + .00003, 'Chat overlay adds only the target shade, not a second complete face');
          assert.ok(Math.abs(composite(reading, palette['--yac-chat-header-opacity']) - reading - .04 * reading / .74) < .00003,
            'Chat header feedback scales down with the reading face');
          cases++;
        }
      }
    }
  }
  const baseline = Store.surfacePalette(defaults);
  assert.ok(Math.abs(composite(Number(baseline['--yac-reading-opacity']), Number(baseline['--yac-chat-overlay-opacity'])) - .86) < .00003,
    'Dense chat menus use the existing 86% face without an extra complete layer');
  const quarter = Store.surfacePalette({ surfaceDensity: 25 });
  for (const key of ['--yac-control-opacity', '--yac-reading-opacity', '--yac-reading-pane-opacity', '--yac-reading-pane-hover-opacity', '--yac-menu-opacity', '--yac-settings-opacity']) {
    assert.equal(Number(quarter[key]), Number(baseline[key]) / 4, `${key}: the whole range is available, without a hidden opacity floor`);
  }
  for (const offset of [-30, 0, 30]) {
    let previous;
    for (let surfaceDensity = 0; surfaceDensity <= 100; surfaceDensity++) {
      const palette = Store.surfacePalette({ surfaceDensity, controlDensityOffset: offset, readingDensityOffset: offset, navigationDensityOffset: offset });
      if (previous) for (const key of Object.keys(bounds).filter(key => key !== '--yac-chat-overlay-opacity')) {
        const decreasing = ['--yac-control-dark-brightness', '--yac-control-dark-hover-brightness', '--yac-chip-dark-brightness', '--yac-control-light-contrast'].includes(key);
        assert.ok(decreasing ? parseFloat(palette[key]) <= parseFloat(previous[key]) : parseFloat(palette[key]) >= parseFloat(previous[key]), `${key} changes continuously across the master range`);
      }
      previous = palette;
    }
  }
  const groups = {
    controlDensityOffset: ['--yac-control-opacity', '--yac-control-hover-opacity', '--yac-control-selected-opacity', '--yac-control-dark-brightness', '--yac-control-dark-hover-brightness', '--yac-chip-dark-brightness', '--yac-control-light-contrast', '--yac-control-light-brightness', '--yac-control-blur', '--yac-control-feedback'],
    readingDensityOffset: ['--yac-reading-opacity', '--yac-reading-hover-opacity', '--yac-reading-pane-opacity', '--yac-reading-pane-hover-opacity', '--yac-chat-header-opacity', '--yac-chat-overlay-opacity', '--yac-reading-blur'],
    navigationDensityOffset: ['--yac-menu-opacity', '--yac-guide-opacity', '--yac-secondary-opacity', '--yac-settings-opacity', '--yac-chat-overlay-opacity', '--yac-navigation-blur', '--yac-navigation-level']
  };
  for (const [key, affected] of Object.entries(groups)) {
    const adjusted = Store.surfacePalette({ [key]: -30 });
    for (const token of Object.keys(bounds).filter(token => !affected.includes(token))) {
      assert.equal(adjusted[token], baseline[token], `${key} leaves other surface categories unchanged`);
    }
    assert.ok(affected.some(token => adjusted[token] !== baseline[token]), `${key} changes its own category`);
  }
  return cases;
}
async function checkPercentages() {
  const nextDefaults = { ...defaults, surfaceMultiplier: 1, controlDensity: 100, readingDensity: 100, navigationDensity: 100 };
  const oldKeys = ['surfaceDensity', 'controlDensityOffset', 'readingDensityOffset', 'navigationDensityOffset'];
  for (const key of oldKeys) delete nextDefaults[key];
  let cases = 0;
  for (const surfaceDensity of [0, 35, 100]) for (const controlDensityOffset of [-30, 0, 30]) {
    for (const readingDensityOffset of [-30, 0, 30]) for (const navigationDensityOffset of [-30, 0, 30]) {
      const legacy = { surfaceDensity, controlDensityOffset, readingDensityOffset, navigationDensityOffset };
      const data = backend({ ambient: { ...legacy, flashWarning: false }, 'yac-setting:blur': 48 });
      const store = new Store(data.storage, nextDefaults);await store.ready;
      const previous = Store.migrateSurfaces(legacy);
      assert.ok(Math.abs(store.values.surfaceMultiplier - previous.surfaceMultiplier) <= .005 + Number.EPSILON, 'migration uses the nearest one-percent master');
      assert.equal(store.values.surfaceMultiplier, Number(store.values.surfaceMultiplier.toFixed(2)));
      for (const key of ['controlDensity', 'readingDensity', 'navigationDensity']) {
        assert.ok(Number.isInteger(store.values[key]), 'migrated category uses integer percent');
        assert.ok(Math.abs(store.values[key] - previous[key]) <= .5 + Number.EPSILON);
      }
      assert.deepEqual(store.legacy, { ...legacy, flashWarning: false }, 'migration keeps its raw legacy input');
      assert.equal(store.values.flashWarning, false);assert.equal(store.values.blur, 48);
      assert.deepEqual(data.writes, [], 'upgrade fallback never rewrites existing preferences');
      for (const key of ['controlDensity', 'readingDensity', 'navigationDensity']) assert.ok(store.values[key] >= 0 && store.values[key] <= 100);
      assert.ok(store.values.surfaceMultiplier >= 0 && store.values.surfaceMultiplier <= 1);
      store.dispose();cases++;
    }
  }
  for (const surfaceMultiplier of [0, .4, 1]) for (const controlDensity of [0, 50, 100]) {
    for (const readingDensity of [0, 50, 100]) for (const navigationDensity of [0, 50, 100]) {
      const palette = Store.surfacePalette({ surfaceMultiplier, controlDensity, readingDensity, navigationDensity });
      assert.ok(Math.abs(Number(palette['--yac-control-opacity']) - .22 * surfaceMultiplier * controlDensity / 100) < .000001);
      assert.ok(Math.abs(Number(palette['--yac-reading-opacity']) - .74 * surfaceMultiplier * readingDensity / 100) < .000001);
      assert.ok(Math.abs(Number(palette['--yac-reading-pane-opacity']) - .94 * surfaceMultiplier * readingDensity / 100) < .000001);
      assert.ok(Math.abs(Number(palette['--yac-reading-pane-hover-opacity']) - .98 * surfaceMultiplier * readingDensity / 100) < .000001);
      assert.ok(Math.abs(Number(palette['--yac-settings-opacity']) - .90 * surfaceMultiplier * navigationDensity / 100) < .000001);
      if (!surfaceMultiplier) for (const [key, value] of Object.entries(palette)) {
        if (key.endsWith('-opacity') || key.endsWith('-blur') || key.endsWith('-level') || key.endsWith('-feedback')) assert.equal(parseFloat(value), 0);
      }
      cases++;
    }
  }
  const shared = backend({ ambient: { surfaceDensity: 35, controlDensityOffset: 30 }, 'yac-setting:readingDensityOffset': -30 });
  const a = new Store(shared.storage, nextDefaults), b = new Store(shared.storage, nextDefaults);await Promise.all([a.ready, b.ready]);
  const categoryBefore = a.values.readingDensity;
  await a.set('surfaceMultiplier', 0, true);
  assert.equal(b.values.surfaceMultiplier, 0);assert.equal(a.values.readingDensity, categoryBefore, 'master zero preserves individual preferences');
  await b.set('readingDensity', 80, true);await a.set('surfaceMultiplier', .5, true);
  assert.equal(a.values.readingDensity, 80);assert.equal(b.values.surfaceMultiplier, .5);
  assert.equal(Store.surfacePalette(a.values)['--yac-reading-opacity'], '0.296000', 'independent cross-tab edits keep their multiplied result');
  assert.deepEqual(shared.writes.map(write => Object.keys(write)), [['yac-setting:surfaceMultiplier'], ['yac-setting:readingDensity'], ['yac-setting:surfaceMultiplier']], 'changing shade never writes the warning choice or another category');
  await a.set('controlDensity', -20);await a.set('navigationDensity', 120);await a.set('surfaceMultiplier', 9);
  assert.equal(a.values.controlDensity, 0);assert.equal(a.values.navigationDensity, 100);assert.equal(a.values.surfaceMultiplier, 1);
  const persisted = new Store(shared.storage, nextDefaults);await persisted.ready;
  assert.equal(persisted.values.surfaceMultiplier, .5);assert.equal(persisted.values.readingDensity, 80, 'new percentages survive reload alongside old preferences');
  a.dispose();b.dispose();persisted.dispose();
  const waiting = backend({ 'yac-setting:surfaceDensity': 35, 'yac-setting:readingDensityOffset': -30 }, true);
  const early = new Store(waiting.storage, nextDefaults);
  await early.set('readingDensity', 90.49);waiting.reads.shift()();await early.ready;
  assert.equal(early.values.readingDensity, 90, 'a percentage edited before load wins over the legacy fallback');
  assert.deepEqual(waiting.writes, []);early.dispose();
  const precise = backend({ 'yac-setting:surfaceMultiplier': .485946, 'yac-setting:controlDensity': 48.5946,
    'yac-setting:readingDensity': 34.069, 'yac-setting:navigationDensity': 99.99, 'yac-setting:flashWarning': false });
  const fine = new Store(precise.storage, nextDefaults);await fine.ready;
  assert.equal(fine.values.surfaceMultiplier, .49, 'the effective loaded master uses one percent without rewriting storage');
  assert.equal(fine.values.controlDensity, 49);assert.equal(fine.values.readingDensity, 34);assert.equal(fine.values.navigationDensity, 100);
  assert.equal(fine.overrides.get('surfaceMultiplier'), .485946);assert.equal(fine.overrides.get('readingDensity'), 34.069);
  assert.deepEqual(precise.writes, []);
  await fine.set('surfaceMultiplier', .444);
  assert.equal(fine.values.surfaceMultiplier, .44, 'new master input uses one percent before applying the palette');
  await fine.set('surfaceMultiplier', .456, true);
  assert.equal(fine.values.surfaceMultiplier, .46);
  assert.deepEqual(precise.writes, [{ 'yac-setting:surfaceMultiplier': .46 }], 'only the explicitly edited master is saved at one percent');
  await fine.set('readingDensity', 34.069, true);
  assert.equal(fine.values.readingDensity, 34, 'explicitly saving a loaded fine category rounds only that category');
  assert.equal(fine.values.controlDensity, 49);assert.equal(fine.values.navigationDensity, 100);
  assert.equal(precise.data['yac-setting:controlDensity'], 48.5946);assert.equal(precise.data['yac-setting:navigationDensity'], 99.99);
  assert.deepEqual(precise.writes.at(-1), { 'yac-setting:readingDensity': 34 });
  const fineReload = new Store(precise.storage, nextDefaults);await fineReload.ready;
  assert.equal(fineReload.values.surfaceMultiplier, .46);assert.equal(fineReload.values.readingDensity, 34);
  assert.equal(fineReload.values.controlDensity, 49);assert.equal(fineReload.values.navigationDensity, 100);
  assert.equal(fineReload.values.flashWarning, false, 'one-percent edits preserve untouched raw precision and warning preference');
  fine.dispose();fineReload.dispose();
  await checkIntegerEdits(nextDefaults);
  console.log(`PASS: ${cases} percentage and upgrade combinations, multiplied categories, per-key persistence, cross-tab sync, bounds and pending reads`);
}
async function checkIntegerEdits(nextDefaults) {
  const oldFine = { strength: 65.49, blur: 90.51, saturation: 145.49, inset: 12.51,
    surfaceMultiplier: .485946, controlDensity: 48.5946, readingDensity: 34.069, navigationDensity: 99.99 };
  const data = backend(Object.fromEntries(Object.entries(oldFine).map(([key, value]) => ['yac-setting:' + key, value])));
  const store = new Store(data.storage, nextDefaults);await store.ready;
  const loaded = { strength: 65, blur: 91, saturation: 145, inset: 13, surfaceMultiplier: .49, controlDensity: 49, readingDensity: 34, navigationDensity: 100 };
  for (const [key, value] of Object.entries(loaded)) assert.equal(store.values[key], value, key + ': loading applies the displayed integer value');
  for (const [key, value] of Object.entries(oldFine)) {
    assert.equal(store.overrides.get(key), value, key + ': raw overrides remain precise');
    assert.equal(data.data['yac-setting:' + key], value, key + ': loading leaves storage untouched');
  }
  assert.deepEqual(data.writes, [], 'Loading integer effective settings does not save them');
  const fromOtherTab = Object.fromEntries(Object.entries({ ...oldFine, blur: 88.123, readingDensity: 33.456 })
    .map(([key, value]) => ['yac-setting:' + key, value]));
  await data.storage.local.set(fromOtherTab);
  assert.equal(data.writes.length, 1, 'Receiving another tab\'s fine preferences causes no echo write');
  for (const [key, value] of Object.entries({ ...loaded, blur: 88, readingDensity: 33 })) assert.equal(store.values[key], value);
  for (const [key, value] of Object.entries(fromOtherTab)) assert.equal(store.overrides.get(key.slice('yac-setting:'.length)), value);
  await store.set('blur', store.values.blur, true);
  assert.deepEqual(data.writes.at(-1), { 'yac-setting:blur': 88 }, 'An explicit save quantizes only the chosen key');
  assert.equal(store.values.surfaceMultiplier, .49);assert.equal(store.values.readingDensity, 33);
  assert.equal(store.values.strength, 65);assert.equal(store.values.inset, 13);
  for (const [key, value] of Object.entries(fromOtherTab)) if (key !== 'yac-setting:blur') assert.equal(data.data[key], value, 'Saving one field preserves all other raw values');
  store.dispose();

  const legacy = { surfaceDensity: 37.123, controlDensityOffset: 12.345, readingDensityOffset: -7.891, navigationDensityOffset: 1.234 };
  const migrated = backend({ ambient: legacy }), upgrade = new Store(migrated.storage, nextDefaults);await upgrade.ready;
  const expected = { surfaceMultiplier: .42, controlDensity: 100, readingDensity: 82, navigationDensity: 90 };
  for (const [key, value] of Object.entries(expected)) assert.equal(upgrade.values[key], value, 'Legacy conversion is rounded only after deriving the new settings');
  assert.equal(Store.migrateSurfaces(legacy).surfaceMultiplier, .4170583435, 'The raw migration calculation retains its original precision');
  assert.deepEqual(upgrade.legacy, legacy);assert.deepEqual(migrated.data, { ambient: legacy });assert.deepEqual(migrated.writes, []);
  upgrade.dispose();

  const cases = {
    surfaceMultiplier: [[0, 0], [.01, .01], [.99, .99], [1, 1], [.0049, 0], [.0051, .01], [.9949, .99], [.9951, 1], [-Number.MAX_VALUE, 0], [Number.MAX_VALUE, 1]],
    controlDensity: [[0, 0], [1, 1], [99, 99], [100, 100], [.49, 0], [.51, 1], [98.6, 99], [99.6, 100], [-Number.MAX_VALUE, 0], [Number.MAX_VALUE, 100]],
    readingDensity: [[0, 0], [1, 1], [99, 99], [100, 100], [34.49, 34], [34.51, 35], [-Number.MAX_VALUE, 0], [Number.MAX_VALUE, 100]],
    navigationDensity: [[0, 0], [1, 1], [99, 99], [100, 100], [34.49, 34], [34.51, 35], [-Number.MAX_VALUE, 0], [Number.MAX_VALUE, 100]],
    strength: [[15.49, 15], [15.51, 16], [99.6, 100], [-Number.MAX_VALUE, 15], [Number.MAX_VALUE, 100]],
    blur: [[.49, 0], [.51, 1], [159.6, 160], [-Number.MAX_VALUE, 0], [Number.MAX_VALUE, 160]],
    saturation: [[.49, 0], [.51, 1], [249.6, 250], [-Number.MAX_VALUE, 0], [Number.MAX_VALUE, 250]],
    inset: [[.49, 0], [.51, 1], [39.6, 40], [-Number.MAX_VALUE, 0], [Number.MAX_VALUE, 40]],
    fps: [[24.49, 24], [24.51, 25], [59.6, 60], [-Number.MAX_VALUE, 24], [Number.MAX_VALUE, 60]]
  };
  const bounded = backend(), edited = new Store(bounded.storage, nextDefaults);await edited.ready;
  for (const [key, values] of Object.entries(cases)) for (const [input, output] of values) {
    const imported = backend({ ['yac-setting:' + key]: input }), fromDisk = new Store(imported.storage, nextDefaults);await fromDisk.ready;
    assert.equal(fromDisk.values[key], output, `${key}: loaded effective value uses the same bounds and step`);
    assert.equal(fromDisk.overrides.get(key), input);assert.equal(imported.data['yac-setting:' + key], input);
    assert.deepEqual(imported.writes, []);fromDisk.dispose();
    await edited.set(key, input, true);
    assert.equal(edited.values[key], output, `${key}: bounded ${input} applies the intended integer step`);
    assert.deepEqual(bounded.writes.at(-1), { ['yac-setting:' + key]: output }, key + ': the same normalized value is persisted');
  }
  const writesBeforeInvalid = bounded.writes.length;
  for (const key of Object.keys(cases)) for (const invalid of [NaN, Infinity, -Infinity, null, '1']) await edited.set(key, invalid, true);
  assert.equal(bounded.writes.length, writesBeforeInvalid, 'Invalid slider edits never reach storage');
  edited.dispose();

  for (const raw of [
    { surfaceMultiplier: .0049 },
    { surfaceMultiplier: 1, controlDensity: .125, readingDensity: .125, navigationDensity: .125 }
  ]) {
    const saved = Object.fromEntries(Object.entries(raw).map(([key, value]) => ['yac-setting:' + key, value]));
    const tiny = backend(saved), loadedTiny = new Store(tiny.storage, nextDefaults);await loadedTiny.ready;
    const palette = Store.surfacePalette(loadedTiny.values);
    for (const [token, value] of Object.entries(palette)) {
      const neutral = /brightness|contrast/.test(token) ? 1 : 0;
      assert.equal(parseFloat(value), neutral, token + ': loaded zero percent has no residual surface paint');
    }
    assert.deepEqual(tiny.data, saved);assert.deepEqual(tiny.writes, []);
    const reloaded = new Store(tiny.storage, nextDefaults);await reloaded.ready;
    assert.deepEqual(reloaded.values, loadedTiny.values);assert.deepEqual(Store.surfacePalette(reloaded.values), palette);
    assert.deepEqual(tiny.writes, [], 'Reopening the zero-percent profile still does not write raw fine values');
    loadedTiny.dispose();reloaded.dispose();
  }

  const pending = backend({ 'yac-setting:surfaceMultiplier': .0049, 'yac-setting:readingDensity': .125 }, true);
  const duringLoad = new Store(pending.storage, nextDefaults);
  await duringLoad.set('readingDensity', 1.4);
  await pending.storage.local.set({ 'yac-setting:surfaceMultiplier': .876 });pending.reads.shift()();await duringLoad.ready;
  assert.equal(duringLoad.values.surfaceMultiplier, .88, 'A fine cross-tab event received during load is quantized after the stale snapshot');
  assert.equal(duringLoad.overrides.get('surfaceMultiplier'), .876);assert.equal(duringLoad.values.readingDensity, 1, 'The quantized pending edit wins over loaded fine data');
  assert.deepEqual(pending.writes, [{ 'yac-setting:surfaceMultiplier': .876 }], 'Pending-load normalization adds no write beyond the external tab event');
  assert.equal(pending.data['yac-setting:readingDensity'], .125);duringLoad.dispose();

  const duplicateBackend = backend();let paletteCalls = 0;
  const duplicate = new Store(duplicateBackend.storage, nextDefaults, { onChange: values => { paletteCalls++;Store.surfacePalette(values); } });
  await duplicate.ready;const before = paletteCalls;
  await duplicate.set('surfaceMultiplier', .451);await duplicate.set('surfaceMultiplier', .454);
  assert.equal(duplicate.values.surfaceMultiplier, .45);assert.equal(paletteCalls, before + 1, 'Same-percent inputs do not recompute the downstream palette');
  await duplicate.set('readingDensity', 34.1);await duplicate.set('readingDensity', 34.4);
  assert.equal(paletteCalls, before + 2, 'Same-integer category inputs do not recompute the downstream palette');
  assert.deepEqual(duplicateBackend.writes, [], 'Repeated transient inputs never save');
  await duplicate.set('surfaceMultiplier', .454, true);
  assert.deepEqual(duplicateBackend.writes, [{ 'yac-setting:surfaceMultiplier': .45 }], 'Explicit change still saves a value already applied by input');
  assert.equal(paletteCalls, before + 2, 'The matching storage echo does not repeat downstream work');
  await duplicateBackend.storage.local.set({ 'yac-setting:surfaceMultiplier': .451 });
  assert.equal(duplicate.values.surfaceMultiplier, .45);assert.equal(duplicate.overrides.get('surfaceMultiplier'), .451);
  assert.equal(paletteCalls, before + 2, 'A cross-tab raw change within the same effective percent does not repeat palette work');
  duplicate.dispose();

  const retryBackend = pendingBackend();const changes = [];
  const retry = new Store(retryBackend.storage, nextDefaults, { onChange: (values, meta) => changes.push({ values, ...meta }) });await retry.ready;
  const error = new Error('surface save failed');
  const failed = assert.rejects(retry.set('surfaceMultiplier', .451, true), caught => caught === error);
  await retryBackend.fail(0, error);await failed;
  assertSaveError(changes.at(-1), 'surfaceMultiplier', error, 1);
  const saved = retry.set('surfaceMultiplier', .454, true);await retryBackend.succeed(1);await saved;
  assert.deepEqual(retryBackend.writes, [{ 'yac-setting:surfaceMultiplier': .45 }, { 'yac-setting:surfaceMultiplier': .45 }], 'A same-step retry is not suppressed as duplicate input');
  assert.equal(changes.at(-1).saveError, null);assert.equal(retry.values.surfaceMultiplier, .45);retry.dispose();
  console.log('PASS: integer effective loads and edits for all current sliders, raw precision without writes, zero transparency, one-percent bounds, pending loads, input deduplication and same-step save retry');
}
(async () => {
  const paletteCases = checkSurfacePalette();
  await checkPercentages();
  const old = backend({ ambient: { enabled: false, blur: 45, fps: 39.4, flashWarning: false } });
  const upgraded = new Store(old.storage, defaults);await upgraded.ready;
  assert.equal(upgraded.values.enabled, false);assert.equal(upgraded.values.blur, 45);
  assert.equal(upgraded.values.fps, 39);assert.equal(upgraded.values.flashWarning, false);
  for (const key of ['surfaceDensity', 'controlDensityOffset', 'readingDensityOffset', 'navigationDensityOffset']) {
    assert.equal(upgraded.values[key], defaults[key], 'Older profiles receive the new appearance defaults');
  }
  assert.deepEqual(old.writes, [], 'Reading an older profile does not overwrite or migrate it destructively');
  upgraded.dispose();

  const shared = backend({ ambient: { blur: 42 } });
  const a = new Store(shared.storage, defaults), b = new Store(shared.storage, defaults);
  await Promise.all([a.ready, b.ready]);
  await a.set('flashWarning', false, true);
  assert.equal(b.values.flashWarning, false, 'An already open tab follows the never-show preference');
  await b.set('blur', 70, true);
  assert.equal(shared.data['yac-setting:flashWarning'], false);
  assert.deepEqual(shared.writes.at(-1), { 'yac-setting:blur': 70 }, 'Unrelated sliders save only their own key');
  assert.equal(a.values.blur, 70);
  await Promise.all([a.set('saturation', 155, true), b.set('strength', 15, true)]);
  const appearanceEdits = { surfaceDensity: 72, controlDensityOffset: -20, readingDensityOffset: 15, navigationDensityOffset: 30 };
  for (const [key, value] of Object.entries(appearanceEdits)) {
    await a.set(key, value, true);
    assert.equal(b.values[key], value, `${key} reaches another open tab`);
    assert.deepEqual(shared.writes.at(-1), { ['yac-setting:' + key]: value }, `${key} persists only its own preference`);
  }
  const reload = new Store(shared.storage, defaults);await reload.ready;
  assert.equal(reload.values.saturation, 155);assert.equal(reload.values.strength, 15);
  assert.equal(reload.values.flashWarning, false);
  for (const [key, value] of Object.entries(appearanceEdits)) assert.equal(reload.values[key], value, `${key} survives reload`);
  assert.deepEqual(shared.data.ambient, { blur: 42 }, 'The legacy bag remains intact');
  let notifications = 0;
  const deduplicated = new Store(shared.storage, defaults, { onChange: () => notifications++ });await deduplicated.ready;
  const before = notifications;
  await deduplicated.set('blur', 81, true);
  assert.equal(notifications, before + 1, 'The own storage echo does not invalidate rendering twice');
  await deduplicated.set('blur', 81, true);
  assert.equal(notifications, before + 1, 'Persisting an unchanged field does not repaint');
  deduplicated.dispose();
  a.dispose();b.dispose();reload.dispose();assert.equal(shared.listeners.size, 0);

  const delayed = backend({ ambient: { enabled: false, blur: 90 } }, true), changes = [];
  const startup = new Store(delayed.storage, defaults, { onChange: (values, meta) => changes.push({ values, ...meta }) });
  assert.equal(startup.loaded, false);
  startup.set('blur', 25);
  await delayed.storage.local.set({ 'yac-setting:flashWarning': false });
  delayed.reads[0]();await startup.ready;
  assert.equal(startup.values.enabled, false, 'Delayed OFF is retained');
  assert.equal(startup.values.blur, 25, 'Input while loading survives an older snapshot');
  assert.equal(startup.values.flashWarning, false, 'A change received during loading survives an older snapshot');
  await delayed.storage.local.set({ 'yac-setting:strength': 15 });
  assert.equal(startup.values.blur, 25, 'An unrelated later tab event cannot undo an unsaved startup edit');
  assert.equal(changes.at(-1).loaded, true);
  startup.dispose();

  const checked = backend({ 'yac-setting:strength': 1, 'yac-setting:blur': 1000, 'yac-setting:fps': 59.5,
    'yac-setting:language': 'invalid', 'yac-setting:flashWarning': 'false' });
  const normalized = new Store(checked.storage, defaults);await normalized.ready;
  assert.equal(normalized.values.strength, 15);assert.equal(normalized.values.blur, 160);
  assert.equal(normalized.values.fps, 60);assert.equal(normalized.values.language, 'ja');assert.equal(normalized.values.flashWarning, true);
  await normalized.set('blur', NaN, true);await normalized.set('unknown', 12, true);
  for (const key of ['surfaceDensity', 'controlDensityOffset', 'readingDensityOffset', 'navigationDensityOffset']) {
    for (const value of [NaN, Infinity, -Infinity, null, '35']) {
      assert.equal(normalized.normalize(key, value), undefined);
      await normalized.set(key, value, true);
    }
    assert.equal(normalized.normalize(key, -1000), key === 'surfaceDensity' ? 0 : -30);
    assert.equal(normalized.normalize(key, 1000), key === 'surfaceDensity' ? 100 : 30);
    assert.equal(normalized.normalize(key, 12.5), 12.5);
  }
  assert.deepEqual(checked.writes, [], 'Malformed and unknown fields cannot be persisted');
  normalized.dispose();
  let disposedCalls = 0;
  const disposed = backend({}, true), abandoned = new Store(disposed.storage, defaults, { onChange: () => disposedCalls++ });
  abandoned.dispose();disposed.reads[0]();await abandoned.ready;
  assert.equal(disposedCalls, 0);assert.equal(disposed.listeners.size, 0);
  let readError;
  const failed = new Store({ local: { get: () => Promise.reject(new Error('read failed')) } }, defaults,
    { onChange: (_, meta) => { readError = meta.error; } });
  await failed.ready;assert.equal(failed.loaded, true);assert.equal(readError.message, 'read failed');failed.dispose();

  const throwingBackend = backend({ 'yac-setting:blur': 45 }), syncError = new Error('storage is unavailable');
  throwingBackend.storage.local.set = () => { throw syncError; };
  const throwing = observedStore(throwingBackend.storage);await throwing.store.ready;
  let thrownSave;
  assert.doesNotThrow(() => { thrownSave = throwing.store.set('blur', 80, true); },
    'A synchronous storage exception is reported through the returned Promise');
  await assert.rejects(thrownSave, error => error === syncError);
  assert.equal(throwing.store.values.blur, 80, 'A failed save keeps the edited value available in the current tab');
  assertSaveError(throwing.changes.at(-1), 'blur', syncError, 1);
  assert.equal(throwingBackend.data['yac-setting:blur'], 45);
  throwing.store.dispose();

  const retryBackend = pendingBackend({ 'yac-setting:blur': 45 });
  const retry = observedStore(retryBackend.storage);await retry.store.ready;
  assert.equal(retry.changes.at(-1).saveError, null);assert.equal(retry.changes.at(-1).saveErrorCount, 0);
  const asyncError = new Error('asynchronous storage failure');
  const failedSave = retry.store.set('blur', 75, true);
  assert.equal(retry.store.values.blur, 75, 'The edit is visible before persistence completes');
  const rejectedSave = assert.rejects(failedSave, error => error === asyncError);
  await retryBackend.fail(0, asyncError);await rejectedSave;
  assert.equal(retry.store.values.blur, 75);
  assertSaveError(retry.changes.at(-1), 'blur', asyncError, 1);
  const afterFailure = new Store(retryBackend.storage, defaults);await afterFailure.ready;
  assert.equal(afterFailure.values.blur, 45, 'Reloading exposes the previous persisted value after a failed save');
  afterFailure.dispose();
  const beforeRetry = retry.changes.length;
  const retriedSave = retry.store.set('blur', 75, true);
  await retryBackend.succeed(1);await retriedSave;
  assert.equal(retry.changes.length, beforeRetry + 1, 'A successful same-value retry notifies that the save error cleared');
  assert.equal(retry.changes.at(-1).values.blur, 75);
  assert.equal(retry.changes.at(-1).saveError, null);assert.equal(retry.changes.at(-1).saveErrorCount, 0);
  const afterRetry = new Store(retryBackend.storage, defaults);await afterRetry.ready;
  assert.equal(afterRetry.values.blur, 75, 'The successful retry is persisted');
  afterRetry.dispose();retry.store.dispose();

  const multipleBackend = pendingBackend(), multiple = observedStore(multipleBackend.storage);await multiple.store.ready;
  const blurError = new Error('blur save failed'), strengthError = new Error('strength save failed');
  const blurFailure = assert.rejects(multiple.store.set('blur', 80, true), error => error === blurError);
  await multipleBackend.fail(0, blurError);await blurFailure;
  const strengthFailure = assert.rejects(multiple.store.set('strength', 35, true), error => error === strengthError);
  await multipleBackend.fail(1, strengthError);await strengthFailure;
  assertAnySaveError(multiple.changes.at(-1), [['blur', blurError], ['strength', strengthError]]);
  const unrelatedSave = multiple.store.set('saturation', 160, true);
  await multipleBackend.succeed(2);await unrelatedSave;
  assertAnySaveError(multiple.changes.at(-1), [['blur', blurError], ['strength', strengthError]]);
  const blurRetry = multiple.store.set('blur', 80, true);
  await multipleBackend.succeed(3);await blurRetry;
  assertSaveError(multiple.changes.at(-1), 'strength', strengthError, 1);
  assert.equal(multiple.store.values.blur, 80);assert.equal(multiple.store.values.strength, 35);
  const strengthRetry = multiple.store.set('strength', 35, true);
  await multipleBackend.succeed(4);await strengthRetry;
  assert.equal(multiple.changes.at(-1).saveError, null);assert.equal(multiple.changes.at(-1).saveErrorCount, 0);
  multiple.store.dispose();

  const staleFailureBackend = pendingBackend(), staleFailure = observedStore(staleFailureBackend.storage);
  await staleFailure.store.ready;
  const oldFailureError = new Error('older save failed');
  const oldFailure = staleFailure.store.set('blur', 70, true);
  const rejectOldFailure = assert.rejects(oldFailure, error => error === oldFailureError);
  const newSuccess = staleFailure.store.set('blur', 80, true);
  await staleFailureBackend.succeed(1);await newSuccess;
  const beforeOldFailure = staleFailure.changes.length;
  await staleFailureBackend.fail(0, oldFailureError);await rejectOldFailure;
  assert.equal(staleFailure.changes.length, beforeOldFailure, 'An older failure cannot invalidate a newer successful save');
  assert.equal(staleFailure.changes.at(-1).saveError, null);assert.equal(staleFailure.changes.at(-1).saveErrorCount, 0);
  assert.equal(staleFailure.store.values.blur, 80);staleFailure.store.dispose();

  const staleSuccessBackend = pendingBackend(), staleSuccess = observedStore(staleSuccessBackend.storage);
  await staleSuccess.store.ready;
  const oldSuccess = staleSuccess.store.set('blur', 70, true), newFailureError = new Error('latest save failed');
  const newFailure = assert.rejects(staleSuccess.store.set('blur', 80, true), error => error === newFailureError);
  await staleSuccessBackend.fail(1, newFailureError);await newFailure;
  const beforeOldSuccess = staleSuccess.changes.length;
  await staleSuccessBackend.succeed(0);await oldSuccess;
  assert.equal(staleSuccess.changes.length, beforeOldSuccess, 'An older successful save cannot clear the latest failure');
  assertSaveError(staleSuccess.changes.at(-1), 'blur', newFailureError, 1);
  assert.equal(staleSuccess.store.values.blur, 80);staleSuccess.store.dispose();

  const abandonedBackend = pendingBackend(), abandonedSave = observedStore(abandonedBackend.storage);
  await abandonedSave.store.ready;
  const lateSuccess = abandonedSave.store.set('blur', 70, true), lateError = new Error('late save failure');
  const lateFailure = assert.rejects(abandonedSave.store.set('strength', 35, true), error => error === lateError);
  abandonedSave.store.dispose();const beforeLateCompletion = abandonedSave.changes.length;
  await abandonedBackend.succeed(0);await lateSuccess;
  await abandonedBackend.fail(1, lateError);await lateFailure;
  assert.equal(abandonedSave.changes.length, beforeLateCompletion, 'Disposed tabs receive no late success or failure callback');
  assert.equal(abandonedBackend.listeners.size, 0);
  for (const failureMode of ['throw', 'reject']) {
    const invalidBackend = backend({ 'yac-setting:blur': 45 });
    const invalid = observedStore(invalidBackend.storage);await invalid.store.ready;
    const contextError = new Error('Extension context invalidated.');let attempts = 0;
    invalidBackend.storage.local.set = () => {
      attempts++;
      if (failureMode === 'throw') throw contextError;
      return Promise.reject(contextError);
    };
    await assert.rejects(invalid.store.set('blur', 75, true), error => error === contextError);
    assert.equal(invalid.store.values.blur, 75);
    assert.equal(invalid.changes.at(-1).reloadRequired, true);
    await invalid.store.set('blur', 80);
    for (const [key, value] of [['blur', 80], ['strength', 15]]) {
      await assert.rejects(invalid.store.set(key, value, true), error => error === contextError);
    }
    assert.equal(attempts, 1, failureMode + ': a retired API is not retried for the same or another key');
    assert.equal(invalidBackend.data['yac-setting:blur'], 45, 'Failed writes do not replace saved preferences');
    invalidBackend.storage.onChanged.removeListener = () => { throw contextError; };
    assert.doesNotThrow(() => invalid.store.dispose(), 'Invalidated listener removal cannot interrupt controller cleanup');
  }
  for (const phase of ['subscribe', 'read']) {
    const contextError = new Error('Extension context invalidated.');let reads = 0;
    const invalidBackend = backend();
    invalidBackend.storage.local.get = () => { reads++;throw contextError; };
    if (phase === 'subscribe') invalidBackend.storage.onChanged.addListener = () => { throw contextError; };
    const invalid = observedStore(invalidBackend.storage);await invalid.store.ready;
    assert.equal(invalid.changes.at(-1).reloadRequired, true, phase + ': startup reports the required page reload');
    assert.equal(reads, phase === 'subscribe' ? 0 : 1);
    await assert.rejects(invalid.store.set('blur', 80, true), error => error === contextError);
    assert.deepEqual(invalidBackend.writes, []);
    invalid.store.dispose();
  }
  const retiredBackend = pendingBackend(), retired = observedStore(retiredBackend.storage);await retired.store.ready;
  const retiredError = new Error('Extension context invalidated.');
  const oldWrite = assert.rejects(retired.store.set('blur', 70, true), error => error === retiredError);
  const newerWrite = retired.store.set('blur', 80, true);
  await retiredBackend.fail(0, retiredError);await oldWrite;
  await retiredBackend.succeed(1);await newerWrite;
  assert.equal(retired.changes.at(-1).reloadRequired, true, 'A stale invalidation is terminal despite a later pending success');
  await assert.rejects(retired.store.set('strength', 15, true), error => error === retiredError);
  assert.equal(retiredBackend.writes.length, 2);retired.store.dispose();
  // Invalidation between set() and its deferred API call must also be guarded.
  const queuedBackend = backend(), queued = observedStore(queuedBackend.storage);await queued.store.ready;
  const queuedWrite = queued.store.set('blur', 80, true);queued.store.contextError = retiredError;
  await assert.rejects(queuedWrite, error => error === retiredError);
  assert.deepEqual(queuedBackend.writes, []);queued.store.dispose();
  console.log(`PASS: ${paletteCases} surface palette combinations, appearance persistence and synchronization, legacy preferences, concurrent saves, pending-read edits, validation, persistence failures, retries, stale completions, invalidated extension context and disposal`);
})().catch(error => { console.error(error);process.exitCode = 1; });
