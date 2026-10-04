/* Shared painted color picker. HEX input and swatches never open a native color dialog. */
(() => {
  'use strict';
  const opened = new WeakMap();
  const palette = [
    ['#ff2f92', 'ピンク', 'Pink'], ['#ff3b30', '赤', 'Red'], ['#ff9500', 'オレンジ', 'Orange'],
    ['#ffcc00', '黄', 'Yellow'], ['#34c759', '緑', 'Green'], ['#30b0c7', '青緑', 'Teal'],
    ['#007aff', '青', 'Blue'], ['#5856d6', '藍', 'Indigo'], ['#af52de', '紫', 'Purple'],
    ['#ffffff', '白', 'White'], ['#8e8e93', 'グレー', 'Gray'], ['#1c1c1e', '黒', 'Black']
  ];
  const text = {
    ja: { close: '色の選択を閉じる', hex: 'カラーコード', apply: '適用', error: '「#rrggbb」で入力してください。', palette: '色を選ぶ' },
    en: { close: 'Close color picker', hex: 'Color code', apply: 'Apply', error: 'Enter a color as #rrggbb.', palette: 'Choose a color' }
  };
  const normalize = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
  const css = `
    .liquid-color{display:inline-flex;min-width:0;max-width:60%}.liquid-color-trigger{display:inline-flex;align-items:center;justify-content:flex-end;gap:7px;min-height:32px;padding:4px 5px;border:0;border-radius:7px;background:transparent;color:var(--muted);font:inherit;cursor:pointer;text-align:end}.liquid-color-trigger:hover{background:var(--hover)}.liquid-color-trigger>span:last-of-type{font:12px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:nowrap}.liquid-color-trigger>svg{width:16px;height:16px;flex-shrink:0}.liquid-color-dot{display:block;box-sizing:border-box;flex-shrink:0;width:20px;height:20px;border:1px solid #80808066;border-radius:50%}
    .liquid-color-menu{position:absolute;z-index:50;box-sizing:border-box;padding:10px;border:1px solid var(--line);border-radius:14px;color:var(--ink);background:var(--face);backdrop-filter:blur(28px) saturate(1.2);box-shadow:inset 0 1px 0 #ffffff08,0 10px 32px #0005;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;text-align:start;pointer-events:auto}.liquid-color-menu[hidden]{display:none!important}.liquid-color-heading{display:flex;align-items:center;justify-content:space-between;gap:6px;min-width:0;margin-bottom:10px}.liquid-color-heading>span{min-width:0;font-weight:600;overflow-wrap:anywhere}.liquid-color-close{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:0 0 28px;padding:5px;border:0;border-radius:50%;background:var(--hover);color:var(--muted);cursor:pointer}.liquid-color-close:hover{background:var(--line);color:var(--ink)}.liquid-color-close>svg{width:18px;height:18px}
    .liquid-color-palette{display:grid;grid-template-columns:repeat(auto-fit,minmax(28px,1fr));gap:6px;margin-bottom:12px}.liquid-color-swatch{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-width:0;min-height:34px;padding:3px;border:0;border-radius:10px;background:transparent;cursor:pointer}.liquid-color-swatch:hover{background:var(--hover)}.liquid-color-swatch>span{display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:28px;height:28px;border:1px solid #80808066;border-radius:50%}.liquid-color-swatch svg{width:16px;height:16px;stroke-width:2.5;opacity:0}.liquid-color-swatch[aria-pressed=true] svg{opacity:1}.liquid-color-swatch[aria-pressed=true]{box-shadow:inset 0 0 0 1px var(--ink)}
    .liquid-color-label{display:block;margin-bottom:5px;color:var(--muted);font-size:11px}.liquid-color-entry{display:flex;gap:7px;flex-wrap:wrap;min-width:0}.liquid-color-hex{box-sizing:border-box;flex:1 1 100px;min-width:0;width:100%;max-width:100%;min-height:34px;padding:6px 9px;border:1px solid var(--line);border-radius:8px;background:var(--field);color:var(--ink);font:13px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace}.liquid-color-apply{display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:6px 12px;border:0;border-radius:8px;background:var(--selected);color:var(--selected-ink);font:inherit;cursor:pointer}.liquid-color-apply:not(:disabled):hover{background:var(--selected);color:var(--selected-ink);filter:brightness(.92)}.liquid-color-apply:disabled{cursor:default;opacity:.45}.liquid-color-error{margin:7px 0 0;color:var(--muted);font-size:11px;line-height:1.5;overflow-wrap:anywhere}.liquid-color-trigger:focus-visible,.liquid-color-menu button:focus-visible,.liquid-color-hex:focus-visible{outline:2px solid var(--ink);outline-offset:1px}
  `;
  function create({ document: doc = document, window: win = doc.defaultView || globalThis, icons, id, label, value,
    language = 'ja', onChange = () => {}, overlayRoot = doc.documentElement, container = doc.documentElement, boundary = null }) {
    let currentValue = normalize(value);
    if (!currentValue) throw new TypeError('Invalid color value');
    const copy = text[language] || text.ja;
    const node = (tag, className, content) => {
      const element = doc.createElement(tag);if (className) element.className = className;
      if (content !== undefined) element.textContent = content;return element;
    };
    const element = node('div', 'liquid-color'), button = node('button', 'liquid-color-trigger');
    button.type = 'button';button.id = id;button.setAttribute('aria-label', label);
    button.setAttribute('aria-haspopup', 'dialog');button.setAttribute('aria-expanded', 'false');button.setAttribute('aria-controls', id + '-colors');
    const dot = node('span', 'liquid-color-dot'), current = node('span');current.id = id + '-value';dot.setAttribute('aria-hidden', 'true');
    button.setAttribute('aria-describedby', current.id);button.append(dot, current, icons.create('chevron-down'));element.append(button);
    const menu = node('div', 'liquid-color-menu');menu.id = id + '-colors';menu.hidden = true;
    menu.setAttribute('role', 'dialog');menu.setAttribute('aria-labelledby', id + '-title');
    const heading = node('div', 'liquid-color-heading'), title = node('span', '', label);title.id = id + '-title';
    const closeButton = node('button', 'liquid-color-close');closeButton.type = 'button';closeButton.setAttribute('aria-label', copy.close);closeButton.append(icons.create('x'));
    heading.append(title, closeButton);
    const colors = node('div', 'liquid-color-palette');colors.setAttribute('role', 'group');colors.setAttribute('aria-label', copy.palette);
    const swatches = palette.map(([color, ja, en]) => {
      const option = node('button', 'liquid-color-swatch'), face = node('span'), check = icons.create('check');
      option.type = 'button';option.value = color;option.tabIndex = -1;
      option.setAttribute('aria-label', (language === 'en' ? en : ja) + ' ' + color);option.setAttribute('aria-pressed', 'false');
      face.style.backgroundColor = color;
      const components = color.slice(1).match(/../g).map(part => parseInt(part, 16));
      face.style.color = components[0] * .299 + components[1] * .587 + components[2] * .114 > 155 ? '#1c1c1e' : '#ffffff';
      check.setAttribute('aria-hidden', 'true');face.append(check);option.append(face);
      option.addEventListener('click', () => commit(color));colors.append(option);return option;
    });
    const hexLabel = node('label', 'liquid-color-label', copy.hex);hexLabel.htmlFor = id + '-hex';
    const entry = node('div', 'liquid-color-entry'), hex = node('input', 'liquid-color-hex'), apply = node('button', 'liquid-color-apply', copy.apply);
    hex.type = 'text';hex.id = id + '-hex';hex.maxLength = 7;hex.spellcheck = false;hex.autocomplete = 'off';hex.inputMode = 'text';
    hex.setAttribute('autocapitalize', 'off');hex.setAttribute('aria-describedby', id + '-error');hex.setAttribute('aria-invalid', 'false');
    apply.type = 'button';entry.append(hex, apply);
    const error = node('p', 'liquid-color-error', copy.error);error.id = id + '-error';error.hidden = true;error.setAttribute('role', 'status');
    menu.append(heading, colors, hexLabel, entry, error);overlayRoot.append(menu);
    let disposed = false, focusIndex = 0, paletteColumns = 6;
    function focus(target) { target.focus({ preventScroll: true });target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }
    function focusSwatch(index) {
      focusIndex = index;swatches.forEach((option, i) => { option.tabIndex = i === index ? 0 : -1; });focus(swatches[index]);
    }
    function update(next) {
      const normalized = normalize(next);if (!normalized || disposed) return false;
      currentValue = normalized;button.value = normalized;current.textContent = normalized;dot.style.backgroundColor = normalized;
      for (const option of swatches) option.setAttribute('aria-pressed', String(option.value === normalized));
      // Remote updates repaint the saved choice without destroying unfinished
      // custom input while the user is editing the open popover.
      if (menu.hidden) { hex.value = normalized;apply.disabled = false;error.hidden = true;hex.setAttribute('aria-invalid', 'false'); }
      return true;
    }
    function commit(next) {
      if (disposed) return false;
      const normalized = normalize(next);
      if (!normalized) { error.hidden = false;hex.setAttribute('aria-invalid', 'true');focus(hex);place();return false; }
      update(normalized);close();onChange(normalized);return true;
    }
    function place() {
      if (menu.hidden) return;
      const rect = button.getBoundingClientRect(), offset = container.getBoundingClientRect();
      const viewport = { left: 0, top: 0, right: win.innerWidth || 360, bottom: win.innerHeight || 640 }, edge = boundary?.getBoundingClientRect() || viewport;
      const bounds = { left: Math.max(viewport.left, edge.left), top: Math.max(viewport.top, edge.top), right: Math.min(viewport.right, edge.right), bottom: Math.min(viewport.bottom, edge.bottom) };
      const width = Math.max(0, Math.min(260, bounds.right - bounds.left - 16)), availableHeight = Math.max(0, bounds.bottom - bounds.top - 16);
      if (!width || !availableHeight) { close(false);return; }
      menu.style.width = width + 'px';menu.style.maxHeight = availableHeight + 'px';
      paletteColumns = Math.max(1, Math.min(6, Math.floor((width - 22 + 6) / 34)));
      colors.style.gridTemplateColumns = 'repeat(' + paletteColumns + ',minmax(0,1fr))';
      const height = Math.min(menu.getBoundingClientRect().height, availableHeight);
      const left = Math.max(bounds.left + 8, Math.min(rect.right - width, bounds.right - width - 8));
      let top = rect.bottom + 6;if (top + height > bounds.bottom - 8) top = rect.top - height - 6;
      top = Math.max(bounds.top + 8, Math.min(top, bounds.bottom - height - 8));
      menu.style.left = left - offset.left - (container.clientLeft || 0) + (container.scrollLeft || 0) + 'px';
      menu.style.top = top - offset.top - (container.clientTop || 0) + (container.scrollTop || 0) + 'px';
    }
    function outside(event) {
      const path = event.composedPath?.() || [];
      if (!path.includes(menu) && !path.includes(element)) close(false);
    }
    function keyboard(event) {
      if (menu.hidden) return;
      if (event.key === 'Escape') { event.preventDefault();event.stopPropagation();close();return; }
      const focused = menu.getRootNode?.().activeElement || doc.activeElement;
      if (event.key === 'Tab') {
        const stops = [swatches[focusIndex], hex, ...(!apply.disabled ? [apply] : []), closeButton], index = stops.indexOf(focused), next = index + (event.shiftKey ? -1 : 1);
        if (index < 0) { close(false);return; }
        if (next < 0 || next >= stops.length) { close();return; }
        event.preventDefault();event.stopPropagation();focus(stops[next]);return;
      }
      if (focused === hex) {
        if (event.key === 'Enter') { event.preventDefault();event.stopPropagation();commit(hex.value); }
        return;
      }
      const index = swatches.indexOf(focused);if (index < 0 || !['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();event.stopPropagation();
      const columns = paletteColumns;
      const column = index % columns;
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? swatches.length - 1 :
        event.key === 'ArrowDown' ? (index + columns < swatches.length ? index + columns : column) :
        event.key === 'ArrowUp' ? (index - columns >= 0 ? index - columns : column + Math.floor((swatches.length - 1 - column) / columns) * columns) :
        (index + (event.key === 'ArrowRight' ? 1 : -1) + swatches.length) % swatches.length;
      focusSwatch(next);
    }
    function close(restoreFocus = true) {
      if (menu.hidden) return;menu.hidden = true;button.setAttribute('aria-expanded', 'false');
      if (opened.get(doc) === api) opened.delete(doc);
      doc.removeEventListener('pointerdown', outside, true);doc.removeEventListener('keydown', keyboard, true);
      doc.removeEventListener('scroll', place, true);win.removeEventListener?.('resize', place);
      if (restoreFocus && button.isConnected) button.focus({ preventScroll: true });
    }
    function open(last = false) {
      if (disposed || button.disabled) return;opened.get(doc)?.close(false);
      globalThis.LiquidChoiceMenu?.closeOpenMenu?.(doc);
      menu.hidden = false;opened.set(doc, api);button.setAttribute('aria-expanded', 'true');hex.value = currentValue;
      apply.disabled = false;error.hidden = true;hex.setAttribute('aria-invalid', 'false');place();if (menu.hidden) return;
      doc.addEventListener('pointerdown', outside, true);doc.addEventListener('keydown', keyboard, true);
      doc.addEventListener('scroll', place, true);win.addEventListener?.('resize', place);
      focusSwatch(last ? swatches.length - 1 : Math.max(0, swatches.findIndex(option => option.value === currentValue)));
    }
    button.addEventListener('click', () => menu.hidden ? open() : close());
    button.addEventListener('keydown', event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();open(event.key === 'ArrowUp');
    });
    closeButton.addEventListener('click', () => close());apply.addEventListener('click', () => commit(hex.value));
    hex.addEventListener('input', () => {
      apply.disabled = !normalize(hex.value);
      if (!apply.disabled) { error.hidden = true;hex.setAttribute('aria-invalid', 'false'); }
    });
    hex.addEventListener('blur', () => {
      if (menu.hidden) return;error.hidden = !apply.disabled;hex.setAttribute('aria-invalid', String(apply.disabled));place();
    });
    const api = { element, button, menu, update, open, close,
      dispose() { if (disposed) return;close(false);disposed = true;menu.remove();element.remove(); } };
    update(currentValue);return api;
  }
  const api = Object.freeze({ css, create, normalize, hasOpenMenu: doc => opened.has(doc), closeOpenMenu: doc => opened.get(doc)?.close(false) });
  globalThis.LiquidColorPicker = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
