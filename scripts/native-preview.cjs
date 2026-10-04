'use strict';

// Rendered-page exports live in ignored .tool-cache. They are test data only;
// never include third-party HTML, CSS, comments or account data in packages.
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const cache = path.join(root, '.tool-cache');
const preview = path.join(cache, 'native-preview');
const htmlEscape = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const tagAttributes = pairs => pairs.map(([name, value]) => ` ${name}="${htmlEscape(value)}"`).join('');

function chatSourceCss() {
  const source = fs.readFileSync(path.join(root, 'ambient.js'), 'utf8');
  const start = source.indexOf('  const chatNeutralControl =');
  const end = source.indexOf('  const removers =', start);
  if (start < 0 || end < 0) throw new Error('Chat CSS source marker not found');
  return vm.runInNewContext(`${source.slice(start, end)}\nchatCss;`, {}, { timeout: 1000 });
}

function generate(kind) {
  const folder = path.join(cache, `native-${kind}`);
  const capturePath = path.join(folder, 'capture.json');
  if (!fs.existsSync(capturePath)) return false;
  const capture = JSON.parse(fs.readFileSync(capturePath, 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'assets-manifest.json'), 'utf8'));
  const destination = path.join(preview, kind);
  fs.mkdirSync(path.join(destination, 'assets'), { recursive: true });
  const assetUrls = new Map();
  for (const [index, asset] of manifest.assets.entries()) {
    if (!fs.existsSync(asset.path)) continue;
    const extension = path.extname(asset.path).replace(/[^.a-z0-9]/gi, '') || '.bin';
    const filename = `${index}${extension}`;
    fs.copyFileSync(asset.path, path.join(destination, 'assets', filename));
    assetUrls.set(asset.url, `/${kind}/assets/${filename}`);
  }
  const localUrls = text => {
    for (const [url, replacement] of assetUrls) text = text.split(url).join(replacement);
    return text;
  };
  const imageAliases = new Map([...assetUrls].filter(([url]) => /yt3\.(?:ggpht|googleusercontent)\.com/.test(url)).map(([url, target]) => [url.replace(/=s\d+.*$/, ''), target]));
  const records = JSON.parse(fs.readFileSync(path.join(folder, 'dom.json'), 'utf8'));
  for (const record of records) {
    if(!record.attrs)continue;
    record.attrs=record.attrs.map(([name,value])=>[name,name==='src'?(assetUrls.get(value)||imageAliases.get(value.replace(/=s\d+.*$/,''))||value):localUrls(value)]);
  }
  fs.writeFileSync(path.join(destination,'dom.json'),JSON.stringify(records));
  let css = capture.sheets.filter(sheet => sheet.css).map(sheet => localUrls(sheet.css)).join('\n');
  if(kind==='watch')css+='\n'+(capture.toolbarLayoutCss||'');
  // Captures deliberately cannot execute remote code or load uncaptured media.
  css = css.replace(/@import[^;]+;/g, '');
  fs.writeFileSync(path.join(destination, 'captured.css'), css);
  const controls = `<aside id="native-preview-controls" aria-label="Local preview controls">
<a href="/watch">Watch</a><a href="/chat">Chat</a>
<label><input id="preview-active" type="checkbox" checked> Ambient ON</label>
<label><input id="preview-layout" type="checkbox" checked> New layout</label>
<label><input id="preview-theme" type="checkbox"> Native dark theme</label>
<label>Master <input id="preview-master" type="range" min="0" max="1" step="0.1" value="1"></label>
<label>Descriptions/comments/chat <input id="preview-reading" type="range" min="0" max="100" value="100"></label>
<button id="preview-check" type="button">Check layout</button><output id="preview-result">Local snapshot. Playback and posting disabled.</output>
</aside>`;
  fs.writeFileSync(path.join(destination,'rendered.html'),localUrls(capture.body));
  const markers=(capture.headMarkers||[]).map(id=>`<link id="${htmlEscape(id)}">`).join('');
  const body = `<body>${controls}<script src="/settings-store.js"></script><script src="/preview.js"></script></body>`;
  const html = `<!doctype html><html${tagAttributes(capture.htmlAttributes)}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>YouTube native ${kind} preview</title>${markers}<link rel="stylesheet" href="/${kind}/captured.css"><link rel="stylesheet" href="${kind === 'watch' ? '/ambient.css' : '/chat-source.css'}"><link rel="stylesheet" href="/preview.css"></head>${body}</html>`;
  fs.writeFileSync(path.join(destination, 'index.html'), html);
  fs.writeFileSync(path.join(destination, 'metadata.json'), JSON.stringify({ capturedAt: capture.capturedAt, source: capture.source, elementCount: capture.elementCount, viewport: capture.viewport, comments: capture.comments, replies: capture.replies, missingStyles: capture.sheets.filter(s => s.unavailable).map(s => s.source), video: 'not exported', background: 'static test gradient' }, null, 2));
  return true;
}

fs.mkdirSync(preview, { recursive: true });
const available = ['watch', 'chat'].filter(generate);
if (!available.length) throw new Error('No native captures. Export rendered HTML/CSS into .tool-cache/native-watch or native-chat first.');
if (process.argv.includes('--generate-only')) { console.log(`Generated native previews: ${available.join(', ')}`); process.exit(0); }

const previewCss = `
/* This gradient is a test backdrop, not an exported video frame. */
html.yac-active{background:linear-gradient(130deg,#71632a 0%,#49456a 45%,#414453 70%,#726262 100%) fixed!important}
#yac-bar-layer{display:none!important}
body{padding-bottom:100px!important}
#native-preview-controls{position:fixed;bottom:8px;left:8px;right:8px;z-index:2147483647;display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:10px 14px;background:#17191f;color:#fff;border:1px solid #8991a3;border-radius:12px;font:13px/1.4 Arial,sans-serif;box-shadow:0 4px 20px #0006}
#native-preview-controls label{display:flex;gap:5px;align-items:center}#native-preview-controls input[type=range]{width:90px}#native-preview-controls button{padding:6px 10px;border:1px solid #889;border-radius:8px;background:#343944;color:white;font:inherit}#native-preview-controls a{color:#d8e0ff}#preview-result{flex-basis:100%;white-space:pre-wrap}
html[data-preview-clean] #native-preview-controls{display:none!important}
html[data-preview-legacy] :is(ytd-watch-flexy,ytd-watch-grid) :is(ytd-watch-metadata,ytd-video-primary-info-renderer,ytd-video-secondary-info-renderer){--yac-metadata-reading-face:var(--yac-reading-pane-surface);padding:0;border-radius:12px}
html[data-preview-legacy] :is(ytd-watch-flexy,ytd-watch-grid) ytd-comments{--yac-reading-pane-face:var(--yac-reading-pane-surface)}
html[data-preview-legacy] :is(ytd-watch-flexy,ytd-watch-grid) ytd-comments :is(ytd-comments-header-renderer,ytd-comment-thread-renderer){padding:0;border-radius:0;background:transparent!important}
html[data-preview-legacy] :is(ytd-watch-flexy,ytd-watch-grid) ytd-comments ytd-comments-header-renderer{margin:24px 0 32px}
html[data-preview-legacy] :is(ytd-watch-flexy,ytd-watch-grid) #related{--yac-related-reading-face:var(--yac-reading-pane-surface);padding:0;border-radius:0}
html[data-preview-legacy].yac-chat-active:not([dark]):has(link#efyt-dark-theme){--yac-reading-rgb:255,255,255}
`;
const previewJs = `
'use strict';
function removeCapturedSettings(){
const owned=['yac-launcher','yac-controls','yac-flash-warning','yac-background','yac-bar-layer','yac-surface-palette'];
for(const node of document.querySelectorAll(owned.map(id=>'#'+id).join(',')))node.remove();
}
async function bootSettings(){
// This mode never imports captured code or media. Its preferences are confined
// to this preview tab, and every fresh load starts with paint/monitoring off.
for(const video of document.querySelectorAll('video'))video.pause();
const namespace='yac-native-preview:settings:v1:',listeners=new Set();
const initial={'yac-setting:enabled':false,'yac-setting:flashWarning':false};
const read=key=>{const value=sessionStorage.getItem(namespace+key);if(value===null)return undefined;try{return JSON.parse(value);}catch{return undefined;}};
globalThis.browser={storage:{onChanged:{addListener:listener=>listeners.add(listener),removeListener:listener=>listeners.delete(listener)},local:{
get:async keys=>{const names=typeof keys==='string'?[keys]:Array.isArray(keys)?keys:Object.keys(keys||{}),values={};for(const key of names){const value=Object.hasOwn(initial,key)?initial[key]:read(key);if(value!==undefined)values[key]=value;}return values;},
set:async values=>{const changes={};for(const [key,value] of Object.entries(values)){const oldValue=read(key);sessionStorage.setItem(namespace+key,JSON.stringify(value));changes[key]={oldValue,newValue:value};}queueMicrotask(()=>{for(const listener of [...listeners])listener(changes,'local');});}
}}};
const load=filename=>new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/'+filename;script.onload=resolve;script.onerror=()=>reject(new Error('Could not load local settings source: '+filename));document.body.append(script);});
for(const filename of ['black-bar-detector.js','renderer.js','flash-monitor.js','lucide-icons.js','ambient.js'])await load(filename);
const entry=document.querySelector('#yac-settings-button');
if(!entry||entry.hidden)throw new Error('Captured watch masthead/player is unavailable for settings');
entry.click();
document.querySelector('#preview-result').textContent='Current local settings UI. Preview-tab sessionStorage only; video and warning monitoring start OFF. No Worker or captured scripts are loaded.';
}
async function boot(){
const settingsMode=location.pathname.replace(/\\/$/,'')==='/watch'&&new URLSearchParams(location.search).has('settings');
const records=await(await fetch(location.pathname.replace(/\\/$/,'')+'/dom.json')).json();
const nodes=[];const toolbar=document.querySelector('#native-preview-controls');
for(const record of records){let node;if(record.parent===-1){node=document.body;for(const [name,value] of record.attrs)node.setAttribute(name,value);}else if('text' in record){node=document.createTextNode(record.text);}else{node=record.svg?document.createElementNS('http://www.w3.org/2000/svg',record.tag):document.createElement(record.tag);for(const [name,value] of record.attrs)node.setAttribute(name,value);if(record.checked!==undefined)node.checked=record.checked;}nodes.push(node);if(record.parent>=0)nodes[record.parent].appendChild(node);}document.body.append(toolbar);
if(settingsMode)removeCapturedSettings();
const canvas=document.querySelector('#yac-background');if(canvas){const ctx=canvas.getContext('2d'),gradient=ctx.createLinearGradient(0,0,canvas.width,canvas.height);gradient.addColorStop(0,'#b79742');gradient.addColorStop(.5,'#786a9b');gradient.addColorStop(1,'#817373');ctx.fillStyle=gradient;ctx.fillRect(0,0,canvas.width,canvas.height);}
const scroller=document.querySelector('#item-scroller');if(scroller)scroller.scrollTop=scroller.scrollHeight;
const root=document.documentElement;
if(settingsMode&&new URLSearchParams(location.search).has('clean'))root.setAttribute('data-preview-clean','');
const activeClass=location.pathname.startsWith('/chat')?'yac-chat-active':'yac-active';document.querySelector('#preview-active').onchange=event=>root.classList.toggle(activeClass,event.target.checked);
const theme=document.querySelector('#preview-theme');theme.checked=root.hasAttribute('dark');
function palette(){const values={surfaceMultiplier:Number(document.querySelector('#preview-master').value),readingDensity:Number(document.querySelector('#preview-reading').value),controlDensity:100,navigationDensity:100},tokens=YacSettingsStore.surfacePalette(values);for(const [key,value] of Object.entries(tokens))root.style.setProperty(key,value);root.style.setProperty('--yac-settings-level',tokens['--yac-navigation-level']);root.style.setProperty('--yac-launcher-level',tokens['--yac-control-feedback']);root.style.setProperty('--yac-launcher-opacity',tokens['--yac-control-opacity']);document.querySelector('#preview-result').textContent='Local snapshot. Playback and posting disabled.';}
document.querySelector('#preview-master').oninput=palette;document.querySelector('#preview-reading').oninput=palette;
theme.onchange=()=>root.toggleAttribute('dark',theme.checked);
document.querySelector('#preview-layout').onchange=event=>root.toggleAttribute('data-preview-legacy',!event.target.checked);
// Loaded replies can be opened/closed; this never sends a YouTube request.
for(const replies of document.querySelectorAll('ytd-comment-replies-renderer')){const items=replies.querySelector('#expander-contents,#contents');if(!items||!items.querySelector('ytd-comment-view-model,ytd-comment-renderer'))continue;const button=replies.querySelector('#more-replies button,#less-replies button,button');if(!button)continue;button.onclick=()=>{items.hidden=!items.hidden;button.setAttribute('aria-expanded',String(!items.hidden));};}
document.addEventListener('submit',event=>event.preventDefault());
document.addEventListener('click',event=>{const anchor=event.target.closest('a');if(anchor&&!anchor.closest('#native-preview-controls'))event.preventDefault();});
document.querySelector('#preview-check').onclick=()=>{const selectors=['ytd-watch-metadata','ytd-comments','ytd-comments-header-renderer','ytd-comment-thread-renderer','#related','yt-live-chat-header-renderer','yt-live-chat-item-list-renderer'];const results=selectors.map(selector=>{const node=document.querySelector(selector);if(!node)return null;const style=getComputedStyle(node),rect=node.getBoundingClientRect();return{selector,padding:style.padding,radius:style.borderRadius,background:style.backgroundColor,blur:style.backdropFilter,width:rect.width};}).filter(Boolean);window.nativePreviewResults=results;document.querySelector('#preview-result').textContent=JSON.stringify(results);};
if(settingsMode){
for(const id of ['preview-active','preview-layout','preview-master','preview-reading'])document.getElementById(id).disabled=true;
document.querySelector('#preview-active').checked=false;
await bootSettings();
}else palette();
}
boot().catch(error=>{document.querySelector('#preview-result').textContent=error.message;});
`;
const type = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.bin':'application/octet-stream' };
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; font-src 'self' data:; frame-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'");
  const url = new URL(req.url, 'http://localhost');
  let dynamic;
  if(url.pathname==='/preview.css')dynamic=previewCss;
  else if(url.pathname==='/preview.js')dynamic=previewJs;
  else if(url.pathname==='/chat-source.css')dynamic=chatSourceCss();
  else if(['/ambient.css','/settings-store.js','/lucide-icons.js','/black-bar-detector.js','/renderer.js','/flash-monitor.js','/ambient.js'].includes(url.pathname))dynamic=fs.readFileSync(path.join(root,url.pathname.slice(1)));
  if (dynamic!==undefined) { res.setHeader('Content-Type',type[path.extname(url.pathname)]); return res.end(dynamic); }
  const pathname = /^\/(watch|chat)\/?$/.test(url.pathname) ? `${url.pathname.replace(/\/$/,'')}/index.html` : url.pathname;
  const file = path.resolve(preview, `.${decodeURIComponent(pathname)}`);
  if (!file.startsWith(preview + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); }
  res.setHeader('Content-Type',type[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));
});
const port=Number(process.env.YAC_NATIVE_PREVIEW_PORT||0);
if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Invalid YAC_NATIVE_PREVIEW_PORT');
server.listen(port,'127.0.0.1',()=>console.log(`Native preview: http://127.0.0.1:${server.address().port}/${available[0]}`));
