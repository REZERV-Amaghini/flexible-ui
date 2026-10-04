'use strict';
const storageListeners = new Set(), messageListeners = new Set();
const browser = {
  runtime: { id: 'liquid-fixture', getManifest: () => globalThis.yacFixtureManifest,
    onMessage: { addListener: listener => messageListeners.add(listener), removeListener: listener => messageListeners.delete(listener) } },
  storage: {
    onChanged: { addListener: listener => storageListeners.add(listener), removeListener: listener => storageListeners.delete(listener) },
    local: {
      get: async keys => Object.fromEntries(keys.filter(key => localStorage.getItem(key) !== null).map(key => [key, JSON.parse(localStorage.getItem(key))])),
      set: async values => {
        const changes = {};
        for (const [key, value] of Object.entries(values)) {
          const raw = localStorage.getItem(key); changes[key] = { oldValue: raw === null ? undefined : JSON.parse(raw), newValue: value };
          localStorage.setItem(key, JSON.stringify(value));
        }
        for (const listener of storageListeners) listener(changes, 'local');
      }
    }
  }
};
window.addEventListener('storage', event => {
  if (event.key) for (const listener of storageListeners) listener({ [event.key]: { newValue: event.newValue === null ? undefined : JSON.parse(event.newValue) } }, 'local');
});
document.getElementById('fixture-action').onclick = () => {
  for (const listener of messageListeners) listener({ type: 'liquid-ui:open-settings' }, { id: 'liquid-fixture' }, () => {});
};
document.getElementById('fixture-youtube').onclick = () => LiquidUI.open({ site: 'youtube' });
document.getElementById('fixture-quick')?.addEventListener('click', event => LiquidUI.togglePanel(event.currentTarget));
document.getElementById('fixture-home').onclick = () => {
  history.pushState({}, '', '/settings-check?view=home');document.title = 'Home — shared settings verification';
  document.dispatchEvent(new Event('yt-navigate-finish'));
};
document.getElementById('fixture-inspect').onclick = () => {
  const dialog = document.getElementById('liquid-ui-settings')?.shadowRoot.querySelector('dialog'), rect = dialog?.getBoundingClientRect();
  document.getElementById('fixture-result').textContent = JSON.stringify({ version: globalThis.yacFixtureManifest?.version,
    open: !!dialog?.open, widthFraction: rect?.width / innerWidth, heightFraction: rect?.height / innerHeight,
    centerX: rect ? (rect.left + rect.right) / 2 : null, centerY: rect ? (rect.top + rect.bottom) / 2 : null,
    viewport: [innerWidth, innerHeight], hosts: document.querySelectorAll('#liquid-ui-settings').length,
    settings: Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith('liquid-ui:')).map(key => [key, JSON.parse(localStorage.getItem(key))])) }, null, 2);
};
