/* RATE controls shared by the settings dialog and the design comparison. */
(() => {
  'use strict';
  const signed = n => n > 0 ? '＋' + n : n < 0 ? '−' + Math.abs(n) : '0';
  const interval = rate => 12 * Math.log2(rate);
  const rateFor = step => 2 ** (step / 12);
  const clamp = percent => Math.max(25, Math.min(300, percent));
  const minInterval = -24, maxInterval = 12 * Math.log2(3);
  const boundInterval = value => Math.max(minInterval, Math.min(maxInterval, value));
  const nextInterval = (value, direction) => boundInterval(Math.abs(value - Math.round(value)) < 1e-8 ? Math.round(value) + direction : direction > 0 ? Math.ceil(value) : Math.floor(value));
  const defaultLayout = Object.freeze({ shell: 'wheel', picker: 'wheel', tags: 'bottom' });
  const reelStep = 20;
  const copy = {
    ja: { title: '再生調整', enabled: '再生調整を有効にする', normal: 'スピード', night: 'レート', presets: '変更方法',
      speed: '速度', pitch: '音階', percent: '速度（%）', semitones: '半音', down: '速度を1%下げる', up: '速度を1%上げる',
      approx: '約', custom: '任意', speedMode: '音程を保って速度を変更', rateMode: '速度と音程を一緒に変更' },
    en: { title: 'Playback adjustment', enabled: 'Enable playback adjustment', normal: 'Speed', night: 'RATE', presets: 'Mode',
      speed: 'Speed', pitch: 'Pitch', percent: 'Speed (%)', semitones: 'semitones', down: 'Decrease speed by 1%', up: 'Increase speed by 1%',
      approx: '≈', custom: 'Custom', speedMode: 'Change speed while preserving pitch', rateMode: 'Change speed and pitch together' }
  };
  // Only seven rows per wheel; no layout reads or permanent animation loop.
  function createMotion(initial, draw, { request = requestAnimationFrame, cancel = cancelAnimationFrame, reduced = () => false, active = () => true } = {}) {
    let position = initial, target = initial, frame = null, previous = 0, disposed = false;
    function finish() { if (frame !== null) cancel(frame);frame = null;position = target;draw(position, false); }
    function tick(time) {
      frame = null;if (disposed) return;
      if (reduced() || !active()) { finish();return; }
      const dt = previous ? Math.max(1, Math.min(40, time - previous)) : 16.67;previous = time;
      position += (target - position) * (1 - Math.exp(-dt / 42));
      if (Math.abs(target - position) < .002) { finish();return; }
      draw(position, true);frame = request(tick);
    }
    return { set(value) {
      if (disposed) return;
      target = value;if (reduced() || !active() || Math.abs(target - position) < .002) { finish();return; }
      if (frame === null) { previous = 0;frame = request(tick); }
    }, finish, dispose() { disposed = true;if (frame !== null) cancel(frame);frame = null; } };
  }
  function createReel({ doc, root, input, min, max, getValue, format, unit, onValue, intervalPicker = false, prefix = () => '' }) {
    const reel = doc.createElement('div');reel.className = 'rate-reel';
    const rows = Array.from({ length: 7 }, () => {
      const row = doc.createElement('span');row.className = 'rate-reel-row';row.setAttribute('aria-hidden', 'true');
      const leading = doc.createElement('span'), value = doc.createElement('span'), suffix = doc.createElement('span');
      leading.className = 'rate-reel-prefix';value.className = 'rate-reel-number';suffix.className = 'rate-reel-unit';suffix.textContent = unit;
      row.append(leading, value, suffix);reel.append(row);return { row, value, leading };
    });
    // The wheel owns focus. Numeric inputs stay detached; clicking a row never opens an editor.
    reel.id = input.id;reel.dataset.key = input.dataset.key;
    reel.setAttribute('role', 'spinbutton');reel.setAttribute('aria-label', input.getAttribute('aria-label') || '');
    reel.setAttribute('aria-valuemin', String(min));reel.setAttribute('aria-valuemax', String(max));
    const within = value => Math.max(min, Math.min(max, value));
    const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    // Keep the exact media rate in state, but settle the displayed row on a whole slot.
    const visualValue = () => Math.round(within(getValue()));
    const motion = createMotion(visualValue(), (position, moving) => {
      reel.dataset.moving = String(moving);const base = Math.round(position);
      for (let i = 0; i < rows.length; i++) {
        const value = base - i + 3, distance = position - value, { row, value: label, leading } = rows[i];
        row.hidden = value < min || value > max;row.dataset.reelValue = String(value);row.dataset.center = String(i === 3);
        const labelValue = !moving && i === 3 ? getValue() : value;
        const text = format(labelValue);if (label.textContent !== text) label.textContent = text;
        leading.textContent = prefix(labelValue);
        row.style.transform = 'translateY(' + (distance * reelStep - reelStep / 2) + 'px) rotateX(' + Math.max(-65, Math.min(65, -distance * 23)) + 'deg) scale(' + Math.max(.58, 1 - Math.abs(distance) * .12) + ')';
        row.style.opacity = String(Math.max(.05, 1 - Math.abs(distance) * .64));
      }
    }, { reduced: () => !!reduced?.matches, active: () => {
      if (!root.isConnected || doc.hidden || root.closest('[hidden]')) return false;
      const shell = root.closest('dialog,[popover]');return !shell || (shell.localName === 'dialog' ? shell.open : shell.matches(':popover-open'));
    } });
    let drag = null;
    reel.addEventListener('wheel', event => {
      if (input.disabled) return;
      event.preventDefault();event.stopPropagation();if (!event.deltaY) return;
      const current = getValue(), direction = event.deltaY < 0 ? 1 : -1;
      const value = intervalPicker ? nextInterval(current, direction) : Math.round(current) + direction;
      const next = within(value);if (Math.abs(current - next) > 1e-10) onValue(next, true);
    }, { passive: false });
    reel.addEventListener('pointerdown', event => {
      if (input.disabled || event.button !== 0 || event.target === input) return;
      drag = { id: event.pointerId, y: event.clientY, initial: visualValue(), lastY: event.clientY, time: event.timeStamp, velocity: 0, moved: false };
      reel.focus();reel.setPointerCapture(event.pointerId);event.preventDefault();
    });
    reel.addEventListener('pointermove', event => {
      if (input.disabled || !drag || drag.id !== event.pointerId) return;
      const delta = event.clientY - drag.y;if (Math.abs(delta) > 3) drag.moved = true;
      if (!drag.moved) return;
      const dt = Math.max(1, event.timeStamp - drag.time);drag.velocity = (event.clientY - drag.lastY) / dt;drag.lastY = event.clientY;drag.time = event.timeStamp;
      onValue(within(Math.round(drag.initial + delta / reelStep)), true);
    });
    const release = event => {
      if (!drag || drag.id !== event.pointerId) return;const old = drag;drag = null;
      if (reel.hasPointerCapture(event.pointerId)) reel.releasePointerCapture(event.pointerId);
      if (input.disabled) return;
      if (old.moved) {
        const velocity = event.timeStamp - old.time > 80 || event.type !== 'pointerup' ? 0 : old.velocity;
        const current = getValue(), momentum = Math.max(-8, Math.min(8, velocity * 120 / reelStep));
        const next = !momentum ? current : current >= max && momentum > 0 ? max : current <= min && momentum < 0 ? min : Math.round(current + momentum);
        onValue(within(next), true);
      }
    };
    reel.addEventListener('pointerup', release);reel.addEventListener('pointercancel', release);
    reel.addEventListener('keydown', event => {
      if (input.disabled || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();event.stopPropagation();const direction = event.key === 'ArrowUp' ? 1 : -1, current = getValue();
      const next = within(intervalPicker ? nextInterval(current, direction) : Math.round(current) + direction);
      if (Math.abs(current - next) > 1e-10) onValue(next, true);
    });
    const settle = () => { if (doc.hidden || reduced?.matches) motion.finish(); };
    doc.addEventListener('visibilitychange', settle);reduced?.addEventListener('change', settle);
    return { element: reel, refresh() {
      reel.disabled = !!input.disabled;reel.tabIndex = input.disabled ? -1 : 0;
      reel.setAttribute('aria-disabled', String(!!input.disabled));reel.setAttribute('aria-valuenow', String(getValue()));
      reel.setAttribute('aria-valuetext', prefix(getValue()) + format(getValue()) + ' ' + unit);
      if (input.disabled && drag) { if (reel.hasPointerCapture(drag.id)) reel.releasePointerCapture(drag.id);drag = null; }
      motion.set(visualValue());if (input.disabled) motion.finish();
    }, finish: motion.finish,
      dispose() { motion.dispose();doc.removeEventListener('visibilitychange', settle);reduced?.removeEventListener('change', settle); } };
  }
  // Preview every step, save only after a short pause or an explicit commit.
  // Flush reads the latest store values so a later preset cannot be reverted.
  function createWriter(store, { save = values => store.setMany(values, true), schedule = setTimeout, cancel = clearTimeout } = {}) {
    let timer = null, stopped = false;
    const pending = new Set();
    function flush() {
      if (timer !== null) cancel(timer);timer = null;
      if (!pending.size) return Promise.resolve();
      const values = Object.fromEntries([...pending].map(key => [key, store.values[key]]));pending.clear();
      try { return Promise.resolve(save(values)).catch(() => {}); } catch { return Promise.resolve(); } // Store metadata owns visible failure/retry.
    }
    function change(values, deferred = false) {
      if (stopped) return Promise.resolve();
      for (const key of Object.keys(values)) pending.add(key);
      store.setMany(values, false);
      if (!deferred) return flush();
      if (timer !== null) cancel(timer);
      timer = schedule(flush, 160);return Promise.resolve();
    }
    return { change, flush, dispose() { const saved = flush();stopped = true;return saved; } };
  }
  let sequence = 0;
  function create({ icons, getState, onChange, config = defaultLayout, prefix = '', language = 'ja', document: doc = globalThis.document }) {
    const text = copy[language] || copy.ja, id = 'liquid-rate-' + ++sequence;
    const node = (tag, cls, value) => { const e = doc.createElement(tag);if (cls) e.className = cls;if (value !== undefined) e.textContent = value;return e; };
    const name = value => prefix ? prefix + ' · ' + value : value;
    const root = node('section', 'rate-card');root.dataset.shell = config.shell;root.dataset.picker = config.picker;root.dataset.tags = config.tags;
    root.setAttribute('aria-label', name(text.title));
    const head = node('div', 'rate-head'), title = node('strong', '', text.title), enableHit = node('label', 'switch-hit'), enable = node('input');
    enable.type = 'checkbox';enable.dataset.key = 'playbackEnabled';enable.setAttribute('role', 'switch');enable.setAttribute('aria-label', name(text.enabled));enableHit.append(enable);
    enable.addEventListener('change', () => onChange({ enabled: enable.checked }));head.append(title, enableHit);
    const change = (values, deferred) => { if (getState().enabled) onChange(values, deferred); };
    const tags = node('div', 'rate-tags');tags.setAttribute('role', 'radiogroup');tags.setAttribute('aria-label', name(text.presets));
    const normal = node('button', '', text.normal), night = node('button', '', text.night);
    for (const b of [normal, night]) { b.type = 'button';b.setAttribute('role', 'radio'); }
    normal.title = text.speedMode;night.title = text.rateMode;
    normal.addEventListener('click', () => change({ mode: 'tempo' }));
    night.addEventListener('click', () => change({ mode: 'rate' }));tags.append(normal, night);
    tags.addEventListener('keydown', event => {
      if (!getState().enabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();const first = event.key === 'Home' || (event.key !== 'End' && getState().mode !== 'tempo');
      change({ mode: first ? 'tempo' : 'rate' });(first ? normal : night).focus();
    });
    const controls = node('div', 'rate-controls'), left = node('div', 'rate-percent'), right = node('div', 'rate-interval');
    const leftLabel = node('label', 'rate-label', text.speed), rightLabel = node('label', 'rate-label', text.pitch);
    const wheel = node('div', 'rate-wheel'), prev = node('button', 'rate-neighbor rate-prev'), next = node('button', 'rate-neighbor rate-next');
    prev.type = next.type = 'button';prev.setAttribute('aria-label', name(text.down));next.setAttribute('aria-label', name(text.up));
    const line = node('div', 'rate-value-line'), approximate = node('span', 'rate-approx', text.approx), percent = node('input'), unit = node('span', 'rate-unit', '%');
    percent.type = 'number';percent.min = '25';percent.max = '300';percent.step = '1';percent.id = id + '-percent';percent.dataset.key = 'playbackRate';
    percent.setAttribute('aria-label', name(text.percent));leftLabel.htmlFor = percent.id;line.append(approximate, percent, unit);wheel.append(prev, line, next);left.append(leftLabel, wheel);
    let typing = false;
    const editRate = (rate, deferred) => change({ rate, mode: getState().mode || 'rate' }, deferred);
    const adjust = amount => {
      typing = false;const value = clamp(Math.round(getState().rate * 100) + amount) / 100;
      if (Math.abs(value - getState().rate) > 1e-12) editRate(value, true);
    };
    prev.addEventListener('click', () => adjust(-1));next.addEventListener('click', () => adjust(1));
    if (config.picker === 'plain') { prev.append(icons.create('chevron-right'));next.append(icons.create('chevron-right')); }
    wheel.addEventListener('wheel', e => {
      if (!getState().enabled) return;
      e.preventDefault();if (!e.deltaY) return;
      e.stopPropagation();adjust(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
    percent.addEventListener('input', () => {
      typing = true;const value = Number(percent.value);
      if (percent.value !== '' && Number.isInteger(value) && value >= 25 && value <= 300) editRate(value / 100, true);
    });
    const commit = () => {
      const value = Number(percent.value);typing = false;
      if (percent.value !== '' && Number.isFinite(value)) editRate(clamp(Math.round(value)) / 100, false);else refresh();
    };
    percent.addEventListener('change', commit);
    percent.addEventListener('blur', () => { if (typing) commit(); });
    percent.addEventListener('keydown', e => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault();adjust(e.key === 'ArrowUp' ? 1 : -1); }
      if (e.key === 'Enter') { e.preventDefault();if (typing) commit(); }
    });
    const reels = [];
    if (config.picker === 'wheel') {
      const reel = createReel({ doc, root, input: percent, min: 25, max: 300, getValue: () => getState().rate * 100,
        format: value => String(Math.round(value)), prefix: value => Math.abs(value - Math.round(value)) > 1e-8 ? text.approx : '', unit: '%', onValue: (value, deferred) => { typing = false;editRate(value / 100, deferred); } });
      wheel.replaceChildren(reel.element);reels.push(reel);
    }
    const selectWrap = node('div', 'rate-select-wrap'), select = node('select');select.id = id + '-interval';select.dataset.key = 'playbackSemitone';
    select.setAttribute('aria-label', name(text.pitch + '（' + text.semitones + '）'));rightLabel.htmlFor = select.id;
    for (let n = minInterval; n <= maxInterval; n++) { const option = node('option', '', signed(n) + ' ' + text.semitones);option.value = String(n);select.append(option); }
    const custom = node('option');custom.value = 'custom';custom.disabled = true;select.append(custom);
    select.addEventListener('change', () => {
      typing = false;if (select.value !== 'custom') change({ rate: rateFor(Number(select.value)), mode: 'rate' });
    });
    selectWrap.append(select, icons.create('chevron-right'));right.append(rightLabel, selectWrap);controls.append(left, right);
    let pitchInput;
    const pitchValue = () => getState().mode === 'tempo' ? 0 : interval(getState().rate);
    if (config.picker === 'wheel') {
      pitchInput = node('input');pitchInput.type = 'number';pitchInput.min = String(minInterval);pitchInput.max = String(maxInterval);pitchInput.step = '1';pitchInput.id = select.id;pitchInput.dataset.key = 'playbackSemitone';
      pitchInput.setAttribute('aria-label', name(text.pitch + '（' + text.semitones + '）'));
      const pitchEdit = (value, deferred) => { typing = false;change({ rate: rateFor(boundInterval(value)), mode: 'rate' }, deferred); };
      const reel = createReel({ doc, root, input: pitchInput, min: minInterval, max: maxInterval, getValue: pitchValue,
        format: value => String(Math.abs(Number(value.toFixed(2)))),
        prefix: value => { const rounded = Number(value.toFixed(2));return rounded > 0 ? '＋' : rounded < 0 ? '−' : ''; },
        unit: text.semitones, intervalPicker: true, onValue: pitchEdit });
      selectWrap.replaceChildren(reel.element);selectWrap.classList.add('rate-pitch-wheel');reels.push(reel);

    }
    root.append(head, controls);
    if (config.tags === 'middle') head.after(tags);else if (config.tags === 'bottom') {
      const bottom = node('div', 'rate-bottom');bottom.append(tags);root.append(bottom);
    } else head.append(tags);
    function refresh() {
      const state = getState(), value = state.rate * 100, rounded = Math.round(value), steps = state.mode === 'tempo' ? 0 : interval(state.rate), closest = Math.round(steps);
      const exact = Math.abs(steps - closest) < 1e-8 && closest >= minInterval && closest <= maxInterval;
      enable.checked = state.enabled;
      if (!typing && percent.value !== String(rounded)) percent.value = String(rounded);
      approximate.hidden = Math.abs(value - rounded) < 1e-9;
      if (config.picker !== 'plain') { prev.textContent = Math.max(25, rounded - 1) + '%';next.textContent = Math.min(300, rounded + 1) + '%'; }
      prev.disabled = !state.enabled || rounded <= 25;next.disabled = !state.enabled || rounded >= 300;
      for (const input of [percent, select, normal, night, pitchInput]) if (input) input.disabled = !state.enabled;
      percent.setAttribute('aria-valuetext', (Math.abs(value - rounded) > 1e-8 ? text.approx : '') + rounded + '%');
      custom.hidden = exact;custom.textContent = text.custom + '（' + signed(Number(steps.toFixed(2))) + '）';select.value = exact ? String(closest) : 'custom';
      normal.setAttribute('aria-checked', String(state.mode === 'tempo'));night.setAttribute('aria-checked', String(state.mode !== 'tempo'));
      normal.tabIndex = state.mode === 'tempo' ? 0 : -1;night.tabIndex = state.mode === 'tempo' ? -1 : 0;
      root.dataset.enabled = String(state.enabled);root.dataset.mode = state.mode === 'tempo' ? 'tempo' : 'rate';
      if (pitchInput) pitchInput.value = String(Number(steps.toFixed(2)));
      for (const reel of reels) reel.refresh();
    }
    refresh();return { element: root, refresh, dispose() { for (const reel of reels) reel.dispose(); } };
  }
  function bind(store, options = {}) {
    const writer = createWriter(store, { save: options.save });
    const state = () => ({ enabled: store.values.playbackEnabled, mode: store.values.playbackMode, rate: store.values.playbackRate });
    const card = create({ ...options, getState: state, onChange(change, deferred) {
      const keys = { enabled: 'playbackEnabled', mode: 'playbackMode', rate: 'playbackRate' };
      writer.change(Object.fromEntries(Object.entries(change).map(([key, value]) => [keys[key], value])), deferred);
    } });
    const unsubscribe = store.subscribe(card.refresh);
    return { ...card, flush: writer.flush, dispose() { unsubscribe();card.dispose();return writer.dispose(); } };
  }
  const api = { create, bind, createWriter, createMotion, createReel, nextInterval, defaultLayout, interval, rateFor, clamp, css: ".rate-card{padding:6px 10px 7px;border-radius:12px;background:var(--group);font-size:13px;text-align:left;font-variant-numeric:tabular-nums}.rate-head{display:flex;align-items:center;gap:6px;min-height:32px}.rate-head>strong{font-size:13px;font-weight:500;white-space:nowrap}.rate-head>.switch-hit{margin-left:auto}\n.rate-tags{position:relative;isolation:isolate;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0;width:140px;max-width:100%;padding:2px;border-radius:8px;background:var(--face);box-sizing:border-box}.rate-tags::before{content:\"\";position:absolute;z-index:-1;top:2px;left:2px;width:calc(50% - 2px);height:calc(100% - 4px);border-radius:6px;background:var(--field,#45454a);box-shadow:0 1px 2px #0002;transition:transform .16s cubic-bezier(.2,.8,.2,1)}.rate-card[data-mode=rate] .rate-tags::before{transform:translateX(100%)}.rate-head>.rate-tags{order:1;margin-left:2px}.rate-card .rate-tags>button{min-width:0;min-height:24px;margin:0;padding:3px 6px;border:0;border-radius:6px;background:transparent;font-size:11px;line-height:1.4;color:var(--muted);white-space:nowrap;cursor:pointer}.rate-card .rate-tags>button[aria-checked=true]{color:var(--ink)}.rate-card .rate-tags>button:hover:not(:disabled){color:var(--ink)}.rate-card .rate-tags>button:disabled{cursor:default;opacity:1}.rate-card .rate-tags>button:focus-visible{outline:2px solid var(--muted);outline-offset:-2px}.rate-card[data-tags=middle]>.rate-tags{margin:6px 0 4px}.rate-controls{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:3px}.rate-label{display:block;color:var(--muted);font-size:10px;line-height:1.4;margin-bottom:4px}.rate-wheel{display:flex;align-items:center;flex-direction:column;justify-content:center;min-height:54px;touch-action:pan-x;overscroll-behavior:contain}.rate-value-line{display:flex;align-items:baseline;justify-content:center;gap:2px;min-height:32px;line-height:1.3}.rate-value-line input{appearance:textfield;width:3.05ch;min-width:0;padding:0!important;margin:0;border:0;background:transparent;outline-offset:2px;color:var(--ink);font-size:24px!important;font-weight:500;letter-spacing:-.8px;text-align:right;font-family:inherit}.rate-value-line input::-webkit-inner-spin-button,.rate-value-line input::-webkit-outer-spin-button{appearance:none;margin:0}.rate-unit{font-size:14px;color:var(--muted)}.rate-approx{font-size:10px;color:var(--muted);opacity:.7;width:16px;flex:0 0 16px;text-align:left}.rate-approx[hidden]{display:block;visibility:hidden}.rate-neighbor{display:none;min-height:21px;padding:0 8px;color:var(--muted)!important;font-size:11px!important}.rate-neighbor:disabled{opacity:.25;cursor:default!important}.rate-select-wrap{display:flex;position:relative;align-items:center;min-height:54px}.rate-select-wrap select{appearance:none;width:100%;border:0;border-radius:7px;padding:8px 22px 8px 8px;margin:0;background:var(--face);color:var(--ink);font-size:15px;line-height:1.3;text-align:center;cursor:pointer;font-family:inherit}.rate-select-wrap>svg{position:absolute;right:7px;width:12px!important;height:12px!important;pointer-events:none;transform:rotate(90deg);color:var(--muted)}.rate-card[data-enabled=false] .rate-controls,.rate-card[data-enabled=false] .rate-tags{opacity:.45}\n.rate-card[data-shell=plain] .rate-controls{border-top:1px solid var(--line);padding-top:8px}.rate-card[data-shell=split] .rate-percent,.rate-card[data-shell=split] .rate-interval{border-radius:9px;padding:8px;background:var(--face)}.rate-card[data-shell=split] .rate-wheel,.rate-card[data-shell=split] .rate-select-wrap{min-height:45px}.rate-card[data-shell=flat]{padding-top:8px;padding-bottom:8px}.rate-card[data-shell=flat] .rate-controls{gap:16px;margin-top:5px}.rate-card[data-shell=flat] .rate-percent,.rate-card[data-shell=flat] .rate-interval{display:flex;align-items:center;gap:8px}.rate-card[data-shell=flat] .rate-label{margin:0}.rate-card[data-shell=flat] .rate-wheel,.rate-card[data-shell=flat] .rate-select-wrap{flex:1;min-width:0;min-height:34px}.rate-card[data-shell=flat] .rate-value-line input{font-size:20px!important}.rate-card[data-shell=wheel] .rate-controls{padding-top:5px;border-top:1px solid var(--line)}\n.rate-card[data-picker=plain] .rate-wheel{position:relative}.rate-card[data-picker=plain] .rate-neighbor{display:block;position:absolute;right:0;width:18px;padding:0;font-size:0!important;min-height:20px;opacity:.65}.rate-card[data-picker=plain] .rate-prev{bottom:4px}.rate-card[data-picker=plain] .rate-next{top:4px}.rate-card[data-picker=plain] .rate-neighbor svg{width:13px!important;height:13px!important;transform:rotate(-90deg)}.rate-card[data-picker=plain] .rate-prev svg{transform:rotate(90deg)}.rate-card[data-picker=box] .rate-value-line{padding:5px 8px;border-radius:7px;background:var(--field,#45454a)}.rate-card[data-picker=inline] .rate-wheel{min-height:34px}.rate-card[data-picker=inline] .rate-value-line input{font-size:20px!important}.rate-card[data-picker=wheel] .rate-neighbor{display:block;opacity:.48}.rate-card[data-picker=wheel] .rate-value-line{align-items:center;width:100%;padding:3px 4px;border-radius:6px;background:var(--field,#45454a)}.rate-card[data-picker=wheel] .rate-value-line input{font-size:22px!important}\n.rate-card{width:100%;max-width:280px;box-sizing:border-box;color:var(--ink);font-family:inherit}.rate-card button,.rate-card input,.rate-card select{font-family:inherit}.rate-card .rate-select-wrap select{max-width:none}.rate-card .rate-neighbor{border:0;background:transparent;cursor:pointer}.rate-card .rate-bottom{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px}\n\n.rate-reel{position:relative;width:100%;height:54px;min-height:54px;overflow:hidden;touch-action:none;user-select:none;cursor:ns-resize;perspective:160px;isolation:isolate;mask-image:linear-gradient(transparent,black 22%,black 78%,transparent)}\n.rate-reel::before{content:\"\";position:absolute;inset:calc(50% - 12px) 0 auto;height:24px;border-radius:6px;background:var(--line,#ffffff0c);z-index:-1}\n.rate-reel-row{position:absolute;top:50%;left:0;right:0;height:20px;display:flex;align-items:center;justify-content:center;gap:3px;font-size:20px;line-height:20px;color:var(--ink);white-space:nowrap;transform-origin:center;backface-visibility:hidden}\n.rate-reel-row[hidden]{display:none!important}.rate-reel[data-moving=true] .rate-reel-row{will-change:transform,opacity}.rate-reel-prefix{flex:0 0 16px;width:16px;text-align:left;font-size:10px;font-weight:400;color:var(--muted);opacity:.7}.rate-reel-number{flex:0 0 3ch;width:3ch;text-align:center}.rate-interval .rate-reel-number{flex-basis:5ch;width:5ch}.rate-reel-unit{flex:0 0 24px;width:24px;text-align:left;font-size:10px;font-weight:400;color:var(--muted)}\n.rate-card .rate-pitch-wheel{min-width:0}.rate-card .rate-pitch-wheel .rate-reel{width:100%}\n\n.rate-reel[aria-disabled=true]{cursor:default}@media(prefers-reduced-motion:reduce){.rate-tags::before{transition:none}}\n\n.rate-card .rate-reel:focus-visible{outline:2px solid var(--muted);outline-offset:-2px;border-radius:6px}\n" };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.LiquidPlaybackCard = Object.freeze(api);
})();
