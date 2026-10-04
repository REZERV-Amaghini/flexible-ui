'use strict';
const fs = require('node:fs'), path = require('node:path');

// Only explicit entries in the private, ignored development list are served.
// Request paths can never supply a filesystem path. Bind the parent server to
// loopback; this helper is not part of either extension package.
function createMediaHandler(items, thumbnailDirectory) {
  const entries = new Map(items.map(item => [String(item.id), { ...item }]));
  function publicList() {
    return [...entries.values()].map(item => ({ id: item.id, title: item.title || path.basename(item.path, path.extname(item.path)),
      duration: Number(item.duration) || 0, src: '/design-media/' + item.id,
      thumbnail: '/design-thumb/' + item.id }));
  }
  function sendFile(req, res, filename, type, media) {
    let stat;
    try { stat = fs.statSync(filename);if (!stat.isFile()) throw new Error('Not a file'); }
    catch { res.writeHead(404);res.end();return; }
    res.setHeader('Content-Type', type);res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (media) res.setHeader('Accept-Ranges', 'bytes');
    let start = 0, end = stat.size - 1;
    if (media && req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      const invalid = () => { res.writeHead(416, { 'Content-Range': 'bytes */' + stat.size });res.end(); };
      if (!match || (!match[1] && !match[2])) { invalid();return; }
      if (!match[1]) {
        const length = Number(match[2]);
        if (!Number.isSafeInteger(length) || length <= 0) { invalid();return; }
        start = Math.max(0, stat.size - length);
      } else {
        start = Number(match[1]);end = match[2] ? Math.min(Number(match[2]), end) : end;
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) { invalid();return; }
      res.statusCode = 206;res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    }
    res.setHeader('Content-Length', Math.max(0, end - start + 1));
    if (req.method === 'HEAD' || stat.size === 0) { res.end();return; }
    const stream = fs.createReadStream(filename, { start, end });
    stream.on('error', () => { if (!res.headersSent) { res.writeHead(500);res.end(); } else res.destroy(); });
    res.on('close', () => stream.destroy());stream.pipe(res);
  }
  return function handle(req, res, pathname) {
    if (!pathname.startsWith('/design-media') && !pathname.startsWith('/design-thumb')) return false;
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' });res.end();return true; }
    if (pathname === '/design-media-list') {
      const body = JSON.stringify(publicList());res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');res.setHeader('Content-Length', Buffer.byteLength(body));
      res.end(req.method === 'HEAD' ? undefined : body);return true;
    }
    const match = /^\/design-(media|thumb)\/([1-9]\d*)$/.exec(pathname), item = match && entries.get(match[2]);
    if (!item) { res.writeHead(404);res.end();return true; }
    if (match[1] === 'media') sendFile(req, res, item.path, 'video/mp4', true);
    else {
      const id = Number(item.thumbnailId || item.id);
      if (!Number.isSafeInteger(id) || id < 1) { res.writeHead(404);res.end();return true; }
      sendFile(req, res, path.join(thumbnailDirectory, id + '.jpg'), 'image/jpeg', false);
    }
    return true;
  };
}
function fromPrivateConfig(root) {
  let items = [];
  try { items = JSON.parse(fs.readFileSync(path.join(root, '.tool-cache', 'design-stage-media.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return createMediaHandler(items, path.join(root, '.tool-cache', 'design-stage-thumbs'));
}
module.exports = { createMediaHandler, fromPrivateConfig };
