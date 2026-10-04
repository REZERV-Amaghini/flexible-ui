'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), http = require('node:http');
const os = require('node:os'), path = require('node:path');
const { createMediaHandler } = require('./design-media.cjs');
// Exercise the HTTP server directly: Windows can choose ephemeral ports that
// browser fetch rejects before issuing a request (for example, port 6000).
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const pending = http.request(url, options, response => {
      const chunks = [];response.on('data', chunk => chunks.push(chunk));response.on('error', reject);
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
    });
    pending.on('error', reject);pending.end(options.body);
  });
}

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'liquid-design-range-'));
  const video = path.join(directory, 'fixture.mp4'), thumbnail = path.join(directory, '1.jpg');
  fs.writeFileSync(video, '0123456789abcdef');fs.writeFileSync(thumbnail, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const handle = createMediaHandler([{ id: 1, path: video, title: 'First', thumbnailId: 1 },
    { id: 2, path: video, title: 'Same file, separate row', thumbnailId: 1 }], directory);
  const server = http.createServer((req, res) => {
    if (!handle(req, res, new URL(req.url, 'http://localhost').pathname)) { res.writeHead(404);res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const list = await (await request(base + '/design-media-list')).json();
    assert.equal(list.length, 2, 'the same source file remains two separate rows');
    assert.ok(list.every(item => !Object.hasOwn(item, 'path')), 'filesystem paths stay out of the public list');
    const full = await request(base + '/design-media/1');assert.equal(full.status, 200);assert.equal(await full.text(), '0123456789abcdef');
    const partial = await request(base + '/design-media/2', { headers: { Range: 'bytes=2-5' } });
    assert.equal(partial.status, 206);assert.equal(partial.headers.get('content-range'), 'bytes 2-5/16');assert.equal(await partial.text(), '2345');
    const suffix = await request(base + '/design-media/1', { headers: { Range: 'bytes=-3' } });
    assert.equal(suffix.status, 206);assert.equal(await suffix.text(), 'def');
    const tail = await request(base + '/design-media/1', { headers: { Range: 'bytes=12-9999' } });
    assert.equal(tail.headers.get('content-range'), 'bytes 12-15/16');assert.equal(await tail.text(), 'cdef');
    const head = await request(base + '/design-media/1', { method: 'HEAD', headers: { Range: 'bytes=1-4' } });
    assert.equal(head.status, 206);assert.equal(head.headers.get('content-length'), '4');assert.equal(await head.text(), '');
    for (const range of ['bytes=16-', 'bytes=8-3', 'bytes=-0', 'bytes=0-1,4-5', 'bytes=-', 'bytes=9007199254740993-']) {
      const response = await request(base + '/design-media/1', { headers: { Range: range } });
      assert.equal(response.status, 416, range);assert.equal(response.headers.get('content-range'), 'bytes */16');await response.text();
    }
    for (const url of ['/design-media/3', '/design-media/fixture.mp4', '/design-thumb/3', '/design-media/3?path=' + encodeURIComponent(video)]) {
      assert.equal((await request(base + url)).status, 404, url);
    }
    const blocked = await request(base + '/design-media/1', { method: 'POST', body: 'ignored' });assert.equal(blocked.status, 405);
    const thumb = await request(base + '/design-thumb/2');assert.equal(thumb.headers.get('content-type'), 'image/jpeg');
    assert.equal((await thumb.arrayBuffer()).byteLength, 4);
    assert.equal(fs.readFileSync(video, 'utf8'), '0123456789abcdef', 'streaming never rewrites the source file');
    console.log('PASS: allowlisted media, duplicate rows, exact bytes, partial and suffix ranges, seek bounds, HEAD, rejected file paths and methods, thumbnails, unchanged originals');
  } finally {
    server.closeAllConnections?.();await new Promise(resolve => server.close(resolve));
    // Remove only the two files created above. An unexpected extra file makes
    // rmdir fail rather than deleting anything else.
    fs.unlinkSync(video);fs.unlinkSync(thumbnail);fs.rmdirSync(directory);
  }
})().catch(error => { console.error(error);process.exitCode = 1; });
