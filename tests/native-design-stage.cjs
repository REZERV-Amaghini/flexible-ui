'use strict';
const fs = require('node:fs'), path = require('node:path');
const escape = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const types = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.avif': 'image/avif', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.json': 'application/json; charset=utf-8', '.bin': 'application/octet-stream' };

// Reuse the saved rendered YouTube page and its styles, rather than recreating
// them. Captures, assets and the assembled HTML stay in the ignored tool cache.
function nativeStage(root) {
  return function handle(req, res, pathname) {
    const selection = path.join(root, '.tool-cache', 'design-stage-native', 'source.json');
    const cache = path.resolve(root, '.tool-cache');
    const source = fs.existsSync(selection) ? path.resolve(root, JSON.parse(fs.readFileSync(selection, 'utf8')).folder) : path.join(cache, 'native-preview', 'watch');
    if (!source.startsWith(cache + path.sep)) throw new Error('Design capture must stay inside the private tool cache');
    const captureFile = fs.existsSync(path.join(source, 'capture.json')) ? path.join(source, 'capture.json') : path.join(cache, 'native-watch', 'capture.json');
    if (pathname === '/design-stage') {
      if (!fs.existsSync(path.join(source, 'rendered.html')) || !fs.existsSync(captureFile)) {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });res.end('The local YouTube page capture is unavailable.');return true;
      }
      const template = fs.readFileSync(path.join(root, 'tests', 'design-stage.html'), 'utf8');
      const capture = JSON.parse(fs.readFileSync(captureFile, 'utf8'));
      const attributes = (capture.htmlAttributes || []).filter(([name]) => !name.startsWith('on'))
        .map(([name, value]) => ` ${name}="${escape(value)}"`).join('');
      const markers = (capture.headMarkers || []).map(id => `<link id="${escape(id)}">`).join('');
      const settingsStart = template.indexOf('  <aside'), settingsEnd = template.indexOf('</html>');
      const settings = template.slice(settingsStart, settingsEnd);
      const body = fs.readFileSync(path.join(source, 'rendered.html'), 'utf8')
        .replace(/<\/body>\s*$/, settings + '</body>');
      const html = template.slice(0, template.indexOf('<!-- NATIVE_YOUTUBE_BODY -->'))
        // Keep the prototype's isolation marker while restoring the captured
        // root font size, theme and layout attributes used by YouTube's CSS.
        .replace(/<html\b[^>]*>/i, opening => opening.slice(0, -1) + attributes + '>')
        .replace('</head>', markers + '</head>') + body + '</html>';
      const output = path.join(root, '.tool-cache', 'design-stage-native');fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(path.join(output, 'page.html'), html);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; font-src 'self' data:; media-src 'self' blob:; frame-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'");
      res.end(html);return true;
    }
    let filename;
    if (pathname === '/design-native/captured.css') filename = path.join(source, 'captured.css');
    else if (pathname === '/design-native/dom.json') filename = path.join(source, 'dom.json');
    else if (pathname === '/design-native/controls.json') filename = path.join(source, 'controls.json');
    else if (pathname === '/design-native/playlist.json') filename = path.join(cache, 'design-stage-native', 'playlist.json');
    else if (/^\/design-native\/assets\/\d+\.[a-z0-9]+$/i.test(pathname)) filename = path.join(source, 'assets', path.basename(pathname));
    else if (/^\/watch\/assets\/\d+\.[a-z0-9]+$/i.test(pathname)) filename = path.join(source, 'assets', path.basename(pathname));
    else return false;
    if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) { res.writeHead(404);res.end();return true; }
    res.setHeader('Content-Type', pathname.endsWith('.css') ? 'text/css; charset=utf-8' : types[path.extname(filename)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');res.end(fs.readFileSync(filename));return true;
  };
}
module.exports = { nativeStage };
