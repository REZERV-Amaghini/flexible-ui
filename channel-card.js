/* Public channel preview for comment authors and live-chat handles.
 * Fetch only on click; parse public JSON as data, never execute fetched scripts. */
(() => {
  'use strict';
  const ORIGIN = 'https://www.youtube.com';
  const COMMENT = 'ytd-comment-view-model, ytd-comment-renderer';
  const CHAT = 'yt-live-chat-text-message-renderer, yt-live-chat-paid-message-renderer, yt-live-chat-paid-sticker-renderer, yt-live-chat-membership-item-renderer';
  const text = value => typeof value === 'string' ? value : value?.simpleText || value?.content || value?.runs?.map(run => run.text || '').join('') || '';
  function channelUrl(value) {
    try {
      const url = new URL(value, ORIGIN);
      if (url.origin !== ORIGIN || url.username || url.password) return null;
      const path = url.pathname.replace(/\/(?:featured|videos|about|shorts|streams)\/?$/, '').replace(/\/$/, '');
      if (!/^\/(?:@[^/\s?#]+|channel\/UC[\w-]{22}|(?:c|user)\/[^/\s?#]+)$/.test(path)) return null;
      return ORIGIN + path;
    } catch { return null; }
  }
  function imageUrl(value) {
    try {
      const url = new URL(value, ORIGIN);
      if (url.protocol !== 'https:' || url.username || url.password || !/^(?:[^.]+\.)*(?:ytimg\.com|ggpht\.com|googleusercontent\.com)$/.test(url.hostname)) return '';
      return url.href;
    } catch { return ''; }
  }
  function thumbnail(value) {
    const list = value?.thumbnails || value?.sources || [];
    return imageUrl(list.at(-1)?.url || '');
  }
  function initialData(html) {
    if (typeof html !== 'string' || html.length > 8_000_000) throw new Error('Invalid channel response');
    const marker = /(?:var\s+ytInitialData|window\[\s*["']ytInitialData["']\s*\]|ytInitialData)\s*=\s*/g;
    let match;
    while ((match = marker.exec(html))) {
      const start = marker.lastIndex;if (html[start] !== '{') continue;
      let depth = 0, quoted = false, escaped = false;
      for (let index = start;index < html.length;index++) {
        const ch = html[index];
        if (quoted) { if (escaped) escaped = false;else if (ch === '\\') escaped = true;else if (ch === '"') quoted = false;continue; }
        if (ch === '"') quoted = true;else if (ch === '{') depth++;else if (ch === '}' && --depth === 0) {
          try { return JSON.parse(html.slice(start, index + 1)); } catch { break; }
        }
      }
    }
    throw new Error('Channel data unavailable');
  }
  function parseProfile(data, url) {
    const meta = data?.metadata?.channelMetadataRenderer;
    if (!meta?.title) throw new Error('Channel metadata unavailable');
    const profile = { url: channelUrl(meta.channelUrl || meta.vanityChannelUrl) || url, name: text(meta.title).slice(0,250),
      avatar: thumbnail(meta.avatar), handle: '', description: text(meta.description).slice(0,4000), stats: [], videos: [] };
    const seen = new Set();let visited = 0;
    function walk(node, videoArea = false) {
      if (!node || typeof node !== 'object' || ++visited > 75_000) return;
      if (node.c4TabbedHeaderRenderer) {
        const header = node.c4TabbedHeaderRenderer;
        profile.handle = text(header.channelHandleText);
        profile.stats = [text(header.subscriberCountText), text(header.videosCountText)].filter(Boolean);
      }
      if (node.pageHeaderViewModel) {
        const header = node.pageHeaderViewModel;
        const parts = header.metadata?.contentMetadataViewModel?.metadataRows?.flatMap(row => row.metadataParts || []) || [];
        for (const part of parts) {
          const value = text(part.text);if (!value) continue;
          if (value.startsWith('@')) profile.handle = value;else if (profile.stats.length < 3) profile.stats.push(value);
        }
      }
      const renderer = videoArea && (node.videoRenderer || node.gridVideoRenderer);
      const lockup = videoArea && node.lockupViewModel;
      const id = renderer?.videoId || (lockup?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' ? lockup.contentId : '');
      if (/^[\w-]{11}$/.test(id || '') && !seen.has(id) && profile.videos.length < 6) {
        const title = text(renderer?.title || lockup?.metadata?.lockupMetadataViewModel?.title);
        if (title) {
          seen.add(id);profile.videos.push({ id, title: title.slice(0,300),
            thumbnail: thumbnail(renderer?.thumbnail || lockup?.contentImage?.thumbnailViewModel?.image),
            duration: text(renderer?.lengthText), views: text(renderer?.shortViewCountText || renderer?.viewCountText) });
        }
      }
      for (const [key, value] of Object.entries(node)) walk(value, videoArea || key === 'richGridRenderer' || key === 'gridRenderer' || key === 'shelfRenderer');
    }
    walk(data.header);walk(data.contents);
    if (!profile.handle) { try { const path = decodeURIComponent(new URL(profile.url).pathname);if (path.startsWith('/@')) profile.handle = path.slice(1); } catch { /* Keep the public title. */ } }
    profile.stats = [...new Set(profile.stats)].slice(0,3);return profile;
  }
  function createLoader(fetcher = globalThis.fetch?.bind(globalThis), now = () => Date.now()) {
    const cache = new Map();
    return async (raw, { signal } = {}) => {
      const url = channelUrl(raw);if (!url) throw new Error('Invalid channel URL');
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const cached = cache.get(url);if (cached && now() - cached.time < 300_000) return cached.profile;
      const controller = new AbortController();let timedOut = false;
      const cancel = () => controller.abort();if (signal?.aborted) cancel();else signal?.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(() => { timedOut = true;controller.abort(); }, 12_000);
      let profile;
      try {
        const response = await fetcher(url + '?hl=ja', { signal: controller.signal, credentials: 'same-origin' });
        if (!response.ok || response.url && !channelUrl(response.url)) throw new Error('Channel request failed');
        profile = parseProfile(initialData(await response.text()), url);
      } catch (error) { if (timedOut && !signal?.aborted) throw new Error('Channel request timed out');throw error; }
      finally { clearTimeout(timer);signal?.removeEventListener('abort', cancel); }
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (cache.size >= 32) cache.delete(cache.keys().next().value);
      cache.set(url, { time: now(), profile });return profile;
    };
  }
  function clickedAuthor(target, doc, stage = false) {
    const row = target?.closest?.(COMMENT + ', ' + CHAT + (stage ? ', article[data-channel-demo]' : ''));
    if (!row) return null;
    const trigger = target.closest('#author-text, #author-comment-badge, #author-thumbnail-button, #author-name, #author-photo, ' + (stage ? '.name, .avatar' : '#author-thumbnail'));
    if (!trigger || !row.contains(trigger)) return null;
    let url = channelUrl(trigger.getAttribute('href') || row.querySelector('#author-text')?.getAttribute('href') || (stage ? row.getAttribute('data-channel-demo') : ''));
    if (!url && row.matches(CHAT)) {
      trigger.removeAttribute('data-flexible-channel-result');
      trigger.dispatchEvent(new doc.defaultView.CustomEvent('flexible-ui:channel-request', { bubbles: true }));
      try { url = channelUrl(JSON.parse(trigger.getAttribute('data-flexible-channel-result') || '{}').url); } catch { /* Malformed page data is not used. */ }
      trigger.removeAttribute('data-flexible-channel-result');
    }
    const nameNode = row.querySelector('#author-text, #author-name' + (stage ? ', .name' : ''));
    const name = (nameNode?.textContent || trigger.getAttribute('aria-label') || '').trim().slice(0,250);
    if (!url && name.startsWith('@')) url = channelUrl('/' + name);
    const img = row.querySelector('#author-thumbnail img, #author-photo img, #author-thumbnail-button img');
    const source = img?.currentSrc || img?.getAttribute('src');let avatar = imageUrl(source);
    if (stage && source) { try { const local = new URL(source, doc.baseURI);if (local.origin === new URL(doc.baseURI).origin) avatar = local.href; } catch { /* Invalid fixture image. */ } }
    return { url, name, avatar, trigger };
  }
  const css = `
    :host{all:initial;position:fixed!important;z-index:2147483501!important;display:block!important;width:min(480px,calc(100vw - 24px))!important;left:var(--left)!important;top:var(--top)!important;--ink:#f4f4f7;--muted:#b5b5be;--face:#27272edb;--group:#ffffff0a;--line:#ffffff13;--hover:#ffffff12;--skeleton:#ffffff13;color-scheme:dark}
    :host([hidden]),[hidden]{display:none!important}:host([data-theme=light]){--ink:#232329;--muted:#666670;--face:#f7f7f9e8;--group:#00000004;--line:#0000000c;--hover:#00000008;--skeleton:#0000000c;color-scheme:light}
    *{box-sizing:border-box}button,a{font:inherit;color:inherit}button{border:0;cursor:pointer}a{text-decoration:none}button:focus-visible,a:focus-visible{outline:2px solid #579df7;outline-offset:2px}
    .card{font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:var(--face);backdrop-filter:blur(32px) saturate(1.25);border:1px solid var(--line);border-radius:26px;box-shadow:0 18px 60px #0004;max-height:calc(100dvh - 24px);overflow:auto;overscroll-behavior:contain;scrollbar-width:none;padding:20px;animation:appear .16s ease-out}
    .card::-webkit-scrollbar{display:none}header{display:flex;align-items:center;gap:16px;padding-right:32px;position:relative}.avatar{width:72px;height:72px;flex:none;border-radius:50%;object-fit:cover;background:var(--skeleton);display:grid;place-items:center;font-size:28px;font-weight:600}.identity{min-width:0}h2{font-size:21px;letter-spacing:-.5px;font-weight:650;line-height:1.25;margin:0;overflow-wrap:anywhere}.handle{color:var(--muted);font-size:13px;margin-top:4px;overflow-wrap:anywhere}.close{position:absolute;top:-6px;right:-6px;width:32px;height:32px;display:grid;place-items:center;border-radius:50%;background:var(--group);color:var(--muted)}.close svg{width:18px;height:18px}.close:hover{background:var(--hover);color:var(--ink)}
    .stats{display:flex;flex-wrap:wrap;gap:6px 14px;margin:16px 0 0;font-size:12px;color:var(--muted)}.stats span+span::before{content:'·';margin-right:14px;color:var(--muted)}.description{margin:18px 0 0;white-space:pre-line;overflow-wrap:anywhere;font-size:13px;line-height:1.65;color:var(--muted)}.description.clamped{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden}.more{background:none;padding:4px 0;color:var(--ink);font-size:12px;font-weight:600}.videos{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 12px;margin-top:10px}.section-title{margin:20px 0 0;padding-top:16px;border-top:1px solid var(--line);font-size:13px;font-weight:600}.video{min-width:0;border-radius:12px;padding:4px;margin:-4px;display:block}.video:hover{background:var(--hover)}.thumbnail{position:relative;aspect-ratio:16/9;border-radius:10px;background:var(--skeleton);overflow:hidden}.thumbnail img{width:100%;height:100%;object-fit:cover}.duration{position:absolute;bottom:5px;right:5px;background:#000b;color:white;padding:0 4px;font-size:10px;border-radius:4px}.video-title{font-size:12px;font-weight:550;line-height:1.45;margin-top:7px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}.views{font-size:11px;color:var(--muted);margin-top:2px}footer{margin-top:18px;padding-top:16px;border-top:1px solid var(--line)}.open-channel{display:flex;align-items:center;justify-content:center;min-height:42px;background:var(--group);border-radius:13px;font-size:13px;font-weight:600}.open-channel:hover{background:var(--hover)}.open-channel svg{width:16px;height:16px;margin-left:8px}
    .error{margin-top:18px;padding:12px;border-radius:14px;background:var(--group);color:var(--muted);font-size:12px}.retry{padding:6px 12px;border-radius:8px;background:var(--hover);margin-top:8px}.skeleton{margin-top:18px;display:grid;gap:10px}.bone{height:12px;border-radius:6px;background:var(--skeleton);animation:pulse 1.4s ease-in-out infinite}.bone:nth-child(2){width:76%}.bone:nth-child(3){width:52%}
    @keyframes appear{from{opacity:0;transform:translateY(5px) scale(.99)}to{opacity:1;transform:none}}@keyframes pulse{50%{opacity:.45}}@media(prefers-reduced-motion:reduce){.card,.bone{animation:none}}:host([data-solid=true]) .card{background:#29292f;backdrop-filter:none}:host([data-solid=true][data-theme=light]) .card{background:#f7f7f9}@media(prefers-reduced-transparency:reduce){.card{background:#29292f;backdrop-filter:none}:host([data-theme=light]) .card{background:#f7f7f9}}
  `;
  function create({ document: doc = document, window: win = window, stage = false, load = createLoader(), store = globalThis.LiquidUI?.getStore('global'),
    icons = globalThis.YacIcons, themes = globalThis.LiquidQuickPanel } = {}) {
    const host = doc.createElement('div');host.id = 'flexible-ui-channel-card';host.hidden = true;
    const root = host.attachShadow({ mode: 'open' });const sheet = new win.CSSStyleSheet();sheet.replaceSync(css);root.adoptedStyleSheets = [sheet];
    const node = (tag, cls, value) => { const el=doc.createElement(tag);if (cls) el.className=cls;if (value !== undefined) el.textContent=value;return el; };
    const removers=[], frameBindings=new Map();let disposed=false, opener=null, seed=null, anchor=null, abort=null, generation=0;
    let prefs=store?.values || {}, stopTheme=themes?.observeTheme(refreshTheme,{document:doc,siteId:'youtube'});
    const copy = (ja,en) => prefs.language === 'en' ? en : ja;
    const listen = (target,type,fn,capture=false,list=removers) => {target.addEventListener(type,fn,capture);list.push(()=>target.removeEventListener(type,fn,capture));};
    function refreshTheme() {host.setAttribute('data-theme',themes?.resolveTheme(prefs.theme,{document:doc,siteId:'youtube'}) || (doc.documentElement.hasAttribute('dark')?'dark':'light'));host.setAttribute('data-solid',String(!!prefs.reduceTransparency));}
    function position() {
      if (host.hidden) return;
      const box=host.getBoundingClientRect(), margin=12;
      const left=Math.min(Math.max(margin,anchor?.left || margin),Math.max(margin,win.innerWidth-box.width-margin));
      const below=(anchor?.bottom || margin)+8;
      const top=below+box.height <= win.innerHeight-margin ? below : Math.max(margin,(anchor?.top || margin)-box.height-8);
      host.style.setProperty('--left',left+'px');host.style.setProperty('--top',Math.min(top,Math.max(margin,win.innerHeight-box.height-margin))+'px');
    }
    function hide(focus=true) {generation++;abort?.abort();abort=null;host.hidden=true;const previous=opener;opener=null;if (focus && previous?.isConnected) previous.focus?.({preventScroll:true});}
    function image(source,cls,name) {const el=source?node('img',cls):node('span',cls,(name || '?').slice(0,1).toUpperCase());if (source) {el.src=source;el.alt='';el.referrerPolicy='no-referrer';el.addEventListener('error',()=>el.replaceWith(image('',cls,name)),{once:true});}return el;}
    function render(profile,loading=false,error=false) {
      refreshTheme();const card=node('section','card');card.setAttribute('role','dialog');card.setAttribute('aria-labelledby','flexible-channel-title');card.setAttribute('aria-busy',String(loading));
      const header=node('header'),identity=node('div','identity'),name=node('h2','',profile.name || copy('チャンネル','Channel'));name.id='flexible-channel-title';
      identity.append(name);if (profile.handle) identity.append(node('div','handle',profile.handle));
      const close=node('button','close');close.type='button';close.setAttribute('aria-label',copy('チャンネルカードを閉じる','Close channel card'));close.append(icons.create('x'));close.addEventListener('click',()=>hide());
      header.append(image(profile.avatar,'avatar',profile.name),identity,close);card.append(header);
      if (loading) {const bones=node('div','skeleton');bones.setAttribute('aria-hidden','true');for(let i=0;i<3;i++) bones.append(node('div','bone'));card.append(bones);}
      if (error) {const notice=node('div','error');notice.setAttribute('role','status');notice.append(node('div','',copy('チャンネル情報を取得できませんでした。','Could not load this channel.')));if (seed.url) {const retry=node('button','retry',copy('再試行','Retry'));retry.type='button';retry.addEventListener('click',()=>populate());notice.append(retry);}card.append(notice);}
      if (profile.stats?.length) {const stats=node('div','stats');for(const value of profile.stats) stats.append(node('span','',value));card.append(stats);}
      if (profile.description) {const description=node('p','description clamped',profile.description);card.append(description);if (profile.description.length > 150) {const more=node('button','more',copy('さらに表示','Show more'));more.type='button';more.setAttribute('aria-expanded','false');more.addEventListener('click',()=>{const expand=more.getAttribute('aria-expanded')!=='true';description.classList.toggle('clamped',!expand);more.setAttribute('aria-expanded',String(expand));more.textContent=expand?copy('閉じる','Show less'):copy('さらに表示','Show more');position();});card.append(more);}}
      if (profile.videos?.length) {card.append(node('h3','section-title',copy('チャンネルの動画','Channel videos')));const videos=node('div','videos');for(const video of profile.videos) {const link=node('a','video');link.href=ORIGIN+'/watch?v='+video.id;const thumb=node('div','thumbnail');if(video.thumbnail) thumb.append(image(video.thumbnail,'',video.title));if(video.duration) thumb.append(node('span','duration',video.duration));link.append(thumb,node('div','video-title',video.title));if(video.views) link.append(node('div','views',video.views));link.addEventListener('click',()=>hide(false));videos.append(link);}card.append(videos);}
      if (profile.url) {const footer=node('footer'),link=node('a','open-channel',copy('チャンネルを開く','Open channel'));link.href=profile.url;link.target='_blank';link.rel='noopener noreferrer';link.append(icons.create('chevron-right'));footer.append(link);card.append(footer);}
      const hadFocus=root.activeElement;root.replaceChildren(card);position();if (hadFocus) close.focus({preventScroll:true});
    }
    async function populate() {abort?.abort();abort=new win.AbortController();const current=++generation;render(seed,true);try {if (!seed.url) throw new Error('Channel identity unavailable');const profile=await load(seed.url,{signal:abort.signal});if (!disposed && current===generation && !host.hidden) render({...profile,avatar:profile.avatar || seed.avatar});}catch(error) {if (!disposed && current===generation && !host.hidden && error.name!=='AbortError') render(seed,false,true);}}
    function open(author,frame) {seed={...author};opener=author.trigger;const rect=opener.getBoundingClientRect(),offset=frame?.getBoundingClientRect();anchor={left:rect.left+(offset?.left||0),top:rect.top+(offset?.top||0),bottom:rect.bottom+(offset?.top||0)};if (!host.isConnected) doc.documentElement.append(host);host.hidden=false;populate();root.querySelector('.close').focus({preventScroll:true});}
    function bindDocument(source,frame,list) {
      listen(source,'click',event=>{if(disposed || event.button && event.button!==0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;const author=clickedAuthor(event.target,source,stage);if (!author) {if (!host.hidden && !event.composedPath().includes(host)) hide(false);return;}event.preventDefault();event.stopImmediatePropagation();open(author,frame);},true,list);
      listen(source,'keydown',event=>{if (!host.hidden && event.key==='Escape') {event.preventDefault();event.stopPropagation();hide();}},true,list);
    }
    function refreshFrames() {
      if(disposed) return;const frames=new Set(doc.querySelectorAll('ytd-live-chat-frame iframe'));
      for(const [frame,binding] of frameBindings) if(!frames.has(frame) || !frame.isConnected) {binding.forEach(fn=>fn());frameBindings.delete(frame);}
      for(const frame of frames) if(!frameBindings.has(frame)) {const binding=[];let last=null,documentRemovers=[];const attach=()=>{let source;try {source=frame.contentDocument;if(!source || !/^\/(?:live_chat(?:_replay)?|chat-demo)$/.test(source.location.pathname)) source=null;}catch {source=null;}if(source===last) return;documentRemovers.forEach(fn=>fn());documentRemovers=[];last=source;if(source) bindDocument(source,frame,documentRemovers);};listen(frame,'load',attach,false,binding);binding.push(()=>documentRemovers.forEach(fn=>fn()));frameBindings.set(frame,binding);attach();}
    }
    bindDocument(doc,null,removers);listen(win,'resize',position);listen(doc,'scroll',event=>{if (!event.composedPath().includes(host)) hide(false);},true);listen(doc,'yt-navigate-start',()=>hide(false));
    listen(root,'keydown',event=>{if(event.key!=='Tab') return;const focusable=[...root.querySelectorAll('button,a[href]')].filter(el=>!el.hidden);const index=focusable.indexOf(root.activeElement);if(event.shiftKey && index<=0) {event.preventDefault();focusable.at(-1)?.focus();}else if(!event.shiftKey && index===focusable.length-1) {event.preventDefault();focusable[0]?.focus();}});
    const observer=new win.MutationObserver(records=>{if(records.some(record=>[...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1 && (node.matches('ytd-live-chat-frame,iframe') || node.querySelector?.('ytd-live-chat-frame,iframe'))))) refreshFrames();});
    observer.observe(doc.documentElement,{childList:true,subtree:true});refreshFrames();refreshTheme();
    const unsubscribe=store?.subscribe(values=>{prefs=values;refreshTheme();});
    function dispose() {if(disposed) return;disposed=true;hide(false);observer.disconnect();unsubscribe?.();stopTheme?.();removers.forEach(fn=>fn());for(const binding of frameBindings.values()) binding.forEach(fn=>fn());frameBindings.clear();host.remove();}
    listen(win,'pagehide',event=>{if(!event.persisted) dispose();});return {open,hide,dispose,refreshFrames,host};
  }
  const api={channelUrl,imageUrl,initialData,parseProfile,createLoader,clickedAuthor,create,css};
  if(typeof module==='object' && module.exports) module.exports=api;
  else {globalThis.FlexibleChannelCard=api;if(location.hostname==='www.youtube.com' && !document.documentElement.hasAttribute('data-liquid-design-stage')) api.instance=create();}
})();
