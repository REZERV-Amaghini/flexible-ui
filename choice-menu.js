/* Shared, painted choice menus. Never open a browser/OS select popup. */
(() => {
  'use strict';
  const opened = new WeakMap();
  const css = `
    .liquid-choice{display:inline-flex;min-width:0;max-width:60%}.liquid-choice-trigger{display:inline-flex;align-items:center;justify-content:flex-end;gap:6px;min-height:32px;padding:4px 5px;border:0;border-radius:7px;background:transparent;color:var(--muted);font:inherit;cursor:pointer;text-align:end}.liquid-choice-trigger:hover{background:var(--hover)}.liquid-choice-trigger>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.liquid-choice-trigger>svg{width:16px;height:16px;flex-shrink:0}
    .liquid-choice-menu{position:absolute;z-index:50;box-sizing:border-box;padding:5px;border:1px solid var(--line);border-radius:14px;color:var(--ink);background:var(--face);backdrop-filter:blur(28px) saturate(1.2);box-shadow:inset 0 1px 0 #ffffff08,0 10px 32px #0005;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;text-align:start;pointer-events:auto}.liquid-choice-menu[hidden]{display:none!important}.liquid-choice-menu .liquid-choice-option{display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;min-height:40px;margin:0;padding:8px 11px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:start;cursor:pointer}.liquid-choice-option+ .liquid-choice-option{border-top:1px solid var(--line)}.liquid-choice-menu .liquid-choice-option:hover,.liquid-choice-menu .liquid-choice-option:focus-visible{background:var(--hover)}.liquid-choice-option>svg{width:18px;height:18px;flex-shrink:0;opacity:0}.liquid-choice-option[aria-checked=true]>svg{opacity:1}.liquid-choice-option[aria-checked=true]{font-weight:600}.liquid-choice-trigger:focus-visible,.liquid-choice-option:focus-visible{outline:2px solid var(--ink);outline-offset:1px}
  `;
  function create({ document: doc = document, window: win = doc.defaultView || globalThis, icons,
    overlayRoot = doc.documentElement, container = doc.documentElement, boundary = null,
    choices, label, value, id, onChange }) {
    const element = doc.createElement('div');element.className = 'liquid-choice';
    const button = doc.createElement('button');button.type = 'button';button.id = id;
    button.className = 'liquid-choice-trigger';button.setAttribute('aria-label', label);
    button.setAttribute('aria-haspopup', 'menu');button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', id + '-choices');
    const current = doc.createElement('span');current.id = id + '-value';
    button.setAttribute('aria-describedby', current.id);button.append(current, icons.create('chevron-down'));
    const menu = doc.createElement('div');menu.id = id + '-choices';menu.className = 'liquid-choice-menu';
    menu.hidden = true;menu.setAttribute('role', 'menu');menu.setAttribute('aria-label', label);
    const options = choices.map(([key, title]) => {
      const option = doc.createElement('button');option.type = 'button';option.className = 'liquid-choice-option';
      option.setAttribute('role', 'menuitemradio');option.setAttribute('aria-checked', 'false');option.tabIndex = -1;
      const text = doc.createElement('span');text.textContent = title;const check = icons.create('check');check.setAttribute('aria-hidden', 'true');
      option.append(text, check);option.addEventListener('click', () => { update(key);close();onChange(key); });
      menu.append(option);return { key, title, option };
    });
    element.append(button);overlayRoot.append(menu);let disposed = false;
    function update(next) {
      value = next;button.value = next;current.textContent = options.find(item => item.key === next)?.title || '';
      for (const item of options) item.option.setAttribute('aria-checked', String(item.key === next));
    }
    function place() {
      if (menu.hidden) return;
      const rect = button.getBoundingClientRect(), offset = container.getBoundingClientRect();
      const viewport = { left: 0, top: 0, right: win.innerWidth || 360, bottom: win.innerHeight || 640 }, edge = boundary?.getBoundingClientRect() || viewport;
      const bounds = { left: Math.max(viewport.left, edge.left), top: Math.max(viewport.top, edge.top), right: Math.min(viewport.right, edge.right), bottom: Math.min(viewport.bottom, edge.bottom) };
      const width = Math.max(0, Math.min(236, bounds.right - bounds.left - 16));menu.style.width = width + 'px';
      menu.style.maxHeight = Math.max(0, bounds.bottom - bounds.top - 16) + 'px';
      const height = menu.getBoundingClientRect().height;
      const left = Math.max(bounds.left + 8, Math.min(rect.right - width, bounds.right - width - 8));
      let top = rect.bottom + 6;if (top + height > bounds.bottom - 8) top = rect.top - height - 6;
      top = Math.max(bounds.top + 8, Math.min(top, bounds.bottom - height - 8));
      menu.style.left = left - offset.left - (container.clientLeft || 0) + (container.scrollLeft || 0) + 'px';
      menu.style.top = top - offset.top - (container.clientTop || 0) + (container.scrollTop || 0) + 'px';
    }
    function focusOption(option) {
      option.focus({ preventScroll: true });option.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
    function outside(event) {
      const path = event.composedPath?.() || [];
      if (!path.includes(menu) && !path.includes(element)) close(false);
    }
    function keyboard(event) {
      if (menu.hidden) return;
      if (event.key === 'Escape') { event.preventDefault();event.stopPropagation();close();return; }
      if (event.key === 'Tab') { close();return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();event.stopPropagation();
      const focused = menu.getRootNode?.().activeElement || doc.activeElement;
      const index = options.findIndex(item => item.option === focused);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 :
        (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      focusOption(options[next].option);
    }
    function close(focus = true) {
      if (menu.hidden) return;menu.hidden = true;button.setAttribute('aria-expanded', 'false');
      if (opened.get(doc) === api) opened.delete(doc);
      doc.removeEventListener('pointerdown', outside, true);doc.removeEventListener('keydown', keyboard, true);
      doc.removeEventListener('scroll', place, true);win.removeEventListener?.('resize', place);
      if (focus && button.isConnected) button.focus({ preventScroll: true });
    }
    function open(last = false) {
      if (disposed || !options.length) return;opened.get(doc)?.close(false);globalThis.LiquidColorPicker?.closeOpenMenu?.(doc);
      menu.hidden = false;opened.set(doc, api);button.setAttribute('aria-expanded', 'true');place();
      doc.addEventListener('pointerdown', outside, true);doc.addEventListener('keydown', keyboard, true);
      doc.addEventListener('scroll', place, true);win.addEventListener?.('resize', place);
      focusOption((last ? options.at(-1) : options.find(item => item.key === value) || options[0]).option);
    }
    button.addEventListener('click', () => menu.hidden ? open() : close());
    button.addEventListener('keydown', event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();open(event.key === 'ArrowUp');
    });
    const api = { element, button, menu, update, open, close,
      dispose() { if (disposed) return;close(false);disposed = true;menu.remove();element.remove(); } };
    update(value);return api;
  }
  const api = { css, create, hasOpenMenu: doc => opened.has(doc), closeOpenMenu: doc => opened.get(doc)?.close(false) };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.LiquidChoiceMenu = api;
})();
