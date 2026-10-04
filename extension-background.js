/* One browser-toolbar entry for the shared in-page settings dialog. */
(() => {
  'use strict';
  const extension = typeof browser !== 'undefined' ? browser : globalThis.chrome;
  extension.action.onClicked.addListener(async tab => {
    try {
      if (!Number.isInteger(tab.id)) return;
      await extension.tabs.sendMessage(tab.id, { type: 'liquid-ui:open-settings' }, { frameId: 0 });
    } catch {
      // Browser-owned pages and existing tabs without the new content script
      // cannot host an injected dialog. Keep settings accessible there too.
      await extension.tabs.create({ url: extension.runtime.getURL('settings.html') });
    }
  });
})();
