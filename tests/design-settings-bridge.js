/* Local stage only: run the production settings shell against memory storage.
 * This object is not the extension's storage and never persists user settings. */
(() => {
  const values = new Map([['liquid-ui:global:theme', 'system'], ['liquid-ui:global:playbackEnabled', true]]), listeners = new Set();
  globalThis.browser = {
    runtime: { id: 'liquid-design-stage', getManifest: () => ({ version: 'design-stage' }) },
    storage: { onChanged: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) }, local: {
      get: async keys => Object.fromEntries(keys.filter(key => values.has(key)).map(key => [key, values.get(key)])),
      set: async entries => {
        const changes = {};
        for (const [key, value] of Object.entries(entries)) { changes[key] = { oldValue: values.get(key), newValue: value };values.set(key, value); }
        for (const listener of listeners) listener(changes, 'local');
      }
    } }
  };
})();
