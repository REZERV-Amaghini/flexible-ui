'use strict';
const assert = require('node:assert/strict');
const Store = require('../settings-store.js'), sites = require('../site-registry.js'), card = require('../playback-card.js');
const rules = Object.fromEntries(sites.globalGroups.flatMap(group => group.fields).map(field => [field.key, field]));
// Exercise real wheel handlers and row transforms without a browser or layout engine.
{
  class Element {
    constructor() { this.children = [];this.dataset = {};this.style = {};this.events = {};this.attributes = {};this.classList = { add() {} }; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(key, value) { this.attributes[key] = value; }
    getAttribute(key) { return this.attributes[key] || null; }
    addEventListener(type, callback) { this.events[type] = callback; }
    focus() {}
    select() {}
    setPointerCapture() {}
    hasPointerCapture() { return false; }
    fire(type, fields) {
      const event = { type, target: this, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...fields };
      this.events[type](event);return event;
    }
    closest() { return null; }
  }
  const doc = { createElement: () => new Element(), hidden: false, addEventListener() {}, removeEventListener() {} };
  const previousRequest = global.requestAnimationFrame, previousCancel = global.cancelAnimationFrame;
  global.requestAnimationFrame = () => { throw new Error('Detached reels must not animate'); };global.cancelAnimationFrame = () => {};
  try {
    let value, changes = 0;
    function mount(intervalPicker) {
      return card.createReel({ doc, root: { isConnected: false }, input: new Element(), min: intervalPicker ? -12 : 25, max: intervalPicker ? 12 : 300,
        getValue: () => value, format: n => String(n), unit: '', intervalPicker, onValue: n => { value = n;changes++; } });
    }
    value = 100;const percent = mount(false), pitch = mount(true);
    assert.equal(percent.element.children.length, 7, 'the wheel contains display rows without an editable input');
    value = 100;percent.refresh();const clicksBefore = changes;
    for (const target of [percent.element.children[3], percent.element.children[2]]) {
      percent.element.fire('pointerdown', { button: 0, pointerId: 3, clientY: 100, timeStamp: 0, target });
      percent.element.fire('pointerup', { pointerId: 3, clientY: 100, timeStamp: 100, target });
    }
    percent.element.fire('keydown', { key: '2' });percent.element.fire('keydown', { key: 'Enter' });
    assert.equal(changes, clicksBefore, 'clicking digits or typing cannot edit or jump to another value');
    assert.equal(percent.element.attributes.role, 'spinbutton');assert.equal(percent.element.attributes['aria-valuenow'], '100');
    percent.element.fire('keydown', { key: 'ArrowUp' });assert.equal(value, 101, 'accessible arrow stepping uses the same one-percent increment');
    for (const deltaMode of [0, 1, 2]) for (const magnitude of [1, 4, 120, 480]) {
      value = 100;const event = percent.element.fire('wheel', { deltaY: -magnitude, deltaMode });
      assert.equal(value, 101, 'one wheel event increases by one percent regardless of OS magnitude or unit');
      assert.ok(event.prevented && event.stopped, 'the reel consumes the event without moving its parent');
      percent.element.fire('wheel', { deltaY: magnitude, deltaMode });assert.equal(value, 100);
      value = 0;pitch.element.fire('wheel', { deltaY: -magnitude, deltaMode });assert.equal(value, 1);
      pitch.element.fire('wheel', { deltaY: magnitude, deltaMode });assert.equal(value, 0);
    }
    const before = changes;pitch.element.fire('wheel', { deltaY: 0 });assert.equal(changes, before);
    for (const step of [-12, -7, -1, 0, 1, 7, 12]) {
      value = card.rateFor(step) * 100;const exactRate = value;percent.refresh();
      const center = percent.element.children[3];
      assert.equal(center.dataset.reelValue, String(Math.round(value)));
      assert.equal(center.style.transform, 'translateY(-10px) rotateX(0deg) scale(1)', 'fractional rates settle on the selected row');
      assert.equal(center.children[1].textContent, String(exactRate));assert.equal(value, exactRate, 'display snapping never rounds media state');
      value = step;pitch.refresh();
      assert.equal(Number(pitch.element.children[2].dataset.reelValue), step + 1, 'higher notes are above the selected note');
      assert.equal(Number(pitch.element.children[4].dataset.reelValue), step - 1, 'lower notes are below the selected note');
    }
    value = 12;pitch.element.fire('wheel', { deltaY: -120 });assert.equal(value, 12);
    value = -12;pitch.element.fire('wheel', { deltaY: 120 });assert.equal(value, -12);
    value = 300;percent.element.fire('wheel', { deltaY: -120 });assert.equal(value, 300);
    value = 25;percent.element.fire('wheel', { deltaY: 120 });assert.equal(value, 25);
    value = 3.86;pitch.element.fire('wheel', { deltaY: -120 });assert.equal(value, 4);
    value = 3.86;pitch.element.fire('wheel', { deltaY: 120 });assert.equal(value, 3);
    value = 100;const approximate = card.createReel({ doc, root: { isConnected: false }, input: new Element(), min: 25, max: 300,
      getValue: () => value, format: n => String(Math.round(n)), prefix: n => Math.abs(n - Math.round(n)) > 1e-8 ? '約' : '', unit: '%', onValue() {} });
    approximate.refresh();const selected = approximate.element.children[3];
    const numberNode = selected.children[1];assert.equal(selected.children[0].textContent, '');
    value = card.rateFor(1) * 100;approximate.refresh();
    assert.equal(selected.children[0].textContent, '約');assert.equal(numberNode.textContent, '106');assert.equal(selected.children[1], numberNode, 'approximation uses a separate prefix, not the numeric label');
    value = 106;approximate.refresh();assert.equal(selected.children[0].textContent, '');assert.equal(numberNode.textContent, '106');approximate.dispose();
    value = 0;pitch.element.fire('pointerdown', { button: 0, pointerId: 1, clientY: 100, timeStamp: 0 });
    pitch.element.fire('pointermove', { pointerId: 1, clientY: 120, timeStamp: 100 });assert.equal(value, 1, 'dragging the upper row toward the center selects a higher note');
    pitch.element.fire('pointerup', { pointerId: 1, clientY: 120, timeStamp: 200 });assert.equal(value, 1);
    let state = { enabled: true, mode: 'rate', rate: card.rateFor(1) }, writes = 0;
    const mounted = card.create({ document: doc, icons: { create: () => new Element() }, getState: () => state,
      onChange: change => { writes++;Object.assign(state, change);mounted.refresh(); } });
    const all = node => [node, ...node.children.flatMap(all)];
    const nodes = all(mounted.element), controls = nodes.filter(node => node.dataset.key && node.dataset.key !== 'playbackEnabled');
    const modes = nodes.filter(node => node.attributes.role === 'radio'), group = nodes.find(node => node.attributes.role === 'radiogroup');
    assert.ok(nodes.every(node => node.className !== 'rate-readout'), 'the duplicated mode and pitch summary is removed');
    const pitchReel = nodes.find(node => node.className === 'rate-interval').children[1].children[0], pitchRow = pitchReel.children[3], pitchNumber = pitchRow.children[1];
    for (const [rate, sign, number] of [[1.11, '＋', '1.81'], [.89, '−', '2.02'], [1, '', '0'], [.99999, '', '0'], [2, '＋', '12'], [.5, '−', '12']]) {
      state.rate = rate;mounted.refresh();
      assert.equal(pitchRow.children[0].textContent, sign, 'the sign has its own reserved prefix slot');
      assert.equal(pitchNumber.textContent, number, 'fractional semitones contain only digits in the numeric slot');
      assert.equal(pitchRow.children[1], pitchNumber, 'sign changes never replace or shift the numeric node');
      assert.equal(state.rate, rate, 'formatting never changes the exact media rate');
    }
    for (const rate of [.25, .4, .49, 1.11, 2.01, 2.5, 3]) {
      state.rate = rate;mounted.refresh();
      const now = Number(pitchReel.attributes['aria-valuenow']);
      assert.ok(now >= Number(pitchReel.attributes['aria-valuemin']) && now <= Number(pitchReel.attributes['aria-valuemax']), 'pitch accessibility bounds cover the full speed range');
      assert.equal(pitchNumber.textContent, String(Math.abs(Number(card.interval(rate).toFixed(2)))), 'the full-range pitch readout retains the fractional interval');
      for (const direction of [-1, 1]) for (const type of ['wheel', 'keydown']) {
        state.rate = rate;mounted.refresh();const before = writes;
        pitchReel.fire(type, type === 'wheel' ? { deltaY: -direction * 120 } : { key: direction > 0 ? 'ArrowUp' : 'ArrowDown' });
        const expected = card.rateFor(card.nextInterval(card.interval(rate), direction));
        assert.ok(Math.abs(state.rate - expected) < 1e-12, 'pitch steps to the adjacent semitone and preserves its exact ratio');
        assert.ok(direction > 0 ? state.rate >= rate - 1e-12 : state.rate <= rate + 1e-12, 'pitch adjustment never jumps in the opposite direction outside ±12 semitones');
        assert.ok(state.rate >= .25 - 1e-12 && state.rate <= 3 + 1e-12);
        if ((rate === .25 && direction < 0) || (rate === 3 && direction > 0)) assert.equal(writes, before, 'pitch stops at the shared rate endpoints');
      }
    }
    for (const type of ['pointerup', 'pointercancel']) for (const pause of [0, 100]) {
      state.rate = card.rateFor(19);mounted.refresh();
      pitchReel.fire('pointerdown', { button: 0, pointerId: 4, clientY: 100, timeStamp: 0 });
      pitchReel.fire('pointermove', { pointerId: 4, clientY: 120, timeStamp: 100 });assert.ok(Math.abs(state.rate - 3) < 1e-12);
      pitchReel.fire(type, { pointerId: 4, clientY: 120, timeStamp: 100 + pause });
      assert.ok(Math.abs(state.rate - 3) < 1e-12, 'drag release and cancellation preserve the fractional upper endpoint');
    }
    state.rate = card.rateFor(1);mounted.refresh();
    assert.equal(modes[1].attributes['aria-checked'], 'true');assert.equal(modes[1].tabIndex, 0);assert.equal(modes[0].tabIndex, -1);
    const ratio = state.rate;modes[0].fire('click', {});assert.equal(state.mode, 'tempo');assert.equal(state.rate, ratio, 'changing mode preserves the exact speed');
    group.fire('keydown', { key: 'End' });assert.equal(state.mode, 'rate');assert.equal(modes[1].attributes['aria-checked'], 'true');
    state.enabled = false;mounted.refresh();assert.ok([...controls, ...modes].every(node => node.disabled));
    const count = writes;for (const mode of modes) mode.fire('click', {});group.fire('keydown', { key: 'Home' });
    for (const control of controls) { control.fire('keydown', { key: 'ArrowUp' });control.fire('wheel', { deltaY: -120 }); }
    assert.equal(writes, count, 'disabled controls cannot change playback through stale events');assert.equal(state.rate, ratio);
    state.enabled = true;mounted.refresh();assert.ok([...controls, ...modes].every(node => !node.disabled));mounted.dispose();
    const stoppedInput = new Element();stoppedInput.disabled = true;value = 100;
    const stopped = card.createReel({ doc, root: { isConnected: false }, input: stoppedInput, min: 25, max: 300,
      getValue: () => value, format: String, unit: '%', onValue: n => { value = n; } });
    const ignored = stopped.element.fire('wheel', { deltaY: -120 });assert.equal(value, 100);assert.ok(!ignored.prevented && !ignored.stopped, 'disabled wheels let the containing page scroll');
    stopped.refresh();stopped.element.fire('keydown', { key: 'ArrowUp' });assert.equal(value, 100);assert.equal(stopped.element.tabIndex, -1);
    stopped.dispose();
    percent.dispose();pitch.dispose();
  } finally {
    if (previousRequest === undefined) delete global.requestAnimationFrame;else global.requestAnimationFrame = previousRequest;
    if (previousCancel === undefined) delete global.cancelAnimationFrame;else global.cancelAnimationFrame = previousCancel;
  }
}
// Motion retargets one frame loop and stops at rest, when hidden or disposed.
{
  const frames = new Map(), draws = [];let sequence = 0, now = 0, visible = true, reduced = false;
  const motion = card.createMotion(100, (value, moving) => draws.push({ value, moving }), {
    request: callback => { frames.set(++sequence, callback);return sequence; }, cancel: id => frames.delete(id),
    active: () => visible, reduced: () => reduced
  });
  const frame = () => { const [id, callback] = frames.entries().next().value;frames.delete(id);now += 16.67;callback(now); };
  motion.set(110);motion.set(115);assert.equal(frames.size, 1);
  frame();assert.ok(draws.at(-1).value > 100 && draws.at(-1).value < 115);assert.equal(draws.at(-1).moving, true);
  motion.set(90);assert.equal(frames.size, 1);let count = 0;
  while (frames.size && ++count < 80) frame();
  assert.ok(count < 80);assert.deepEqual(draws.at(-1), { value: 90, moving: false });
  motion.set(105);visible = false;frame();assert.equal(frames.size, 0);assert.equal(draws.at(-1).value, 105);
  visible = true;reduced = true;motion.set(120);assert.equal(frames.size, 0);assert.equal(draws.at(-1).moving, false);
  reduced = false;motion.set(130);motion.dispose();assert.equal(frames.size, 0);
  const before = draws.length;motion.set(140);assert.equal(draws.length, before);
  assert.equal(card.nextInterval(3.86, 1), 4);assert.equal(card.nextInterval(3.86, -1), 3);
  assert.equal(card.nextInterval(-3.86, 1), -3);assert.equal(card.nextInterval(-3.86, -1), -4);
  assert.equal(card.nextInterval(12, 1), 13);assert.equal(card.nextInterval(-12, -1), -13);
  assert.equal(card.nextInterval(-24, -1), -24);assert.equal(card.nextInterval(card.interval(3), 1), card.interval(3));
}
(async () => {
  const data = {}, writes = [], timers = new Map();let next = 0, rejectSave = false;
  const store = new Store({ local: { get: async () => data, set: async values => {
    if (rejectSave) throw new Error('Unavailable storage');writes.push(values);Object.assign(data, values);
  } } }, sites.globalDefaults, { scope: 'global', rules });
  await store.ready;
  const writer = card.createWriter(store, { schedule: fn => { const id = ++next;timers.set(id, fn);return id; }, cancel: id => timers.delete(id) });
  for (let percent = 101; percent <= 111; percent++) await writer.change({ playbackRate: percent / 100, playbackMode: 'rate' }, true);
  assert.equal(store.values.playbackRate, 1.11);assert.equal(writes.length, 0);assert.equal(timers.size, 1, 'a gesture has one save timer');
  const done = [...timers.values()][0]();await done;assert.equal(timers.size, 0);
  assert.deepEqual(writes, [{ 'liquid-ui:global:playbackRate': 1.11, 'liquid-ui:global:playbackMode': 'rate' }]);
  await writer.change({ playbackRate: 1.12 }, true);
  await writer.change({ playbackEnabled: true, playbackMode: 'rate', playbackRate: 1.25 });
  assert.equal(timers.size, 0);assert.equal(writes.length, 2);
  assert.equal(writes.at(-1)['liquid-ui:global:playbackRate'], 1.25, 'a preset replaces the unsaved wheel value');
  await writer.change({ playbackRate: 1.26 }, true);
  await store.set('playbackRate', card.rateFor(7), true);await writer.flush();
  assert.ok(Math.abs(writes.at(-1)['liquid-ui:global:playbackRate'] - card.rateFor(7)) < 1e-12, 'a later remote edit wins');
  rejectSave = true;await writer.change({ playbackRate: 1.27 });
  assert.equal(store.saveErrors.size, 1);assert.equal(store.values.playbackRate, 1.27, 'a failed save keeps the visible value');
  rejectSave = false;await store.setMany(Object.fromEntries([...store.saveErrors.keys()].map(key => [key, store.values[key]])), true);
  assert.equal(store.saveErrors.size, 0);
  for (let step = -12; step <= 12; step++) {
    await writer.change({ playbackMode: 'rate', playbackRate: card.rateFor(step) });
    assert.ok(Math.abs(card.interval(store.values.playbackRate) - step) < 1e-10);
  }
  await writer.change({ playbackRate: 1.29 }, true);
  const closing = writer.dispose();store.dispose();await closing;
  assert.equal(data['liquid-ui:global:playbackRate'], 1.29, 'closing starts the final save before retiring the store');assert.equal(timers.size, 0);
  const before = writes.length;await writer.change({ playbackRate: 1.3 }, true);assert.equal(writes.length, before);
  console.log('Playback card: bounded wheel animation, reduced/hidden motion, disposal, deferred saves, preset/remote ordering, save failure/retry, exact intervals and closure passed');
})().catch(error => { console.error(error);process.exitCode = 1; });
