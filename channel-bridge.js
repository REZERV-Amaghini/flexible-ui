/* Page-world bridge: expose only the clicked author's public channel identity.
 * No extension APIs, storage, chat messages, or network requests in this world. */
(() => {
  'use strict';
  function identity(target) {
    const row = target?.closest?.('yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer, yt-live-chat-paid-sticker-renderer, yt-live-chat-membership-item-renderer');
    const data = row?.data;
    const id = data?.authorExternalChannelId;
    if (!/^UC[\w-]{22}$/.test(id || '')) return null;
    return { url: 'https://www.youtube.com/channel/' + id };
  }
  function install(doc) {
    const respond = event => {
      const target = event.target;
      if (!target?.matches?.('#author-name, #author-photo, #author-name *, #author-photo *')) return;
      const author = identity(target);
      if (author) target.setAttribute('data-flexible-channel-result', JSON.stringify(author));
    };
    doc.addEventListener('flexible-ui:channel-request', respond, true);
    return () => doc.removeEventListener('flexible-ui:channel-request', respond, true);
  }
  if (typeof module === 'object' && module.exports) module.exports = { identity, install };
  else install(document);
})();
