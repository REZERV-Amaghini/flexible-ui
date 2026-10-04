'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs');
const os = require('node:os'), path = require('node:path');
const { nativeStage } = require('./native-design-stage.cjs');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'liquid-native-stage-'));
const source = path.join(directory, '.tool-cache', 'native-preview', 'watch');
const tests = path.join(directory, 'tests');
const template = fs.readFileSync(path.join(__dirname, 'design-stage.html'), 'utf8');
try {
  fs.mkdirSync(source, { recursive: true });fs.mkdirSync(tests);
  fs.writeFileSync(path.join(source, 'rendered.html'), '<body><ytd-app>Saved YouTube page</ytd-app></body>');
  fs.writeFileSync(path.join(source, 'capture.json'), JSON.stringify({
    htmlAttributes: [['style', 'font-size: 62.5%; font-family: "Roboto", Arial;'], ['lang', 'ja-JP'],
      ['dark', ''], ['class', 'efyt-control-bar-visible'], ['typography', ''], ['onclick', 'untrusted()']],
    headMarkers: ['efyt-dark-theme']
  }));
  for (const marked of [true, false]) {
    fs.writeFileSync(path.join(tests, 'design-stage.html'), marked ? template : template.replace(' data-liquid-design-stage', ''));
    let response;
    const headers = {};
    assert.equal(nativeStage(directory)({}, {
      setHeader: (name, value) => { headers[name] = value; },
      end: html => { response = html; }
    }, '/design-stage'), true);
    const opening = response.match(/<html\b[^>]*>/)[0];
    assert.ok(opening.includes('style="font-size: 62.5%; font-family: &quot;Roboto&quot;, Arial;"'), 'copied root font sizing survives template attributes');
    assert.ok(opening.includes('lang="ja-JP"') && opening.includes('dark=""'), 'native language and theme survive');
    assert.ok(opening.includes('class="efyt-control-bar-visible"') && opening.includes('typography=""'), 'native layout markers survive');
    assert.equal(opening.includes('data-liquid-design-stage'), marked, 'the local playback isolation marker is retained');
    assert.ok(!opening.includes('onclick'), 'captured event handlers stay excluded');
    assert.ok(response.includes('<link id="efyt-dark-theme">'), 'copied theme marker survives');
    assert.ok(response.includes('<ytd-app>Saved YouTube page</ytd-app>'), 'the copied page is retained');
    assert.ok(response.includes('id="design-settings"'), 'prototype controls are still appended');
    assert.ok(headers['Content-Security-Policy'].includes("script-src 'self'"));
  }
  const handle = nativeStage(directory), playlistFile = path.join(directory, '.tool-cache', 'design-stage-native', 'playlist.json');
  let code, body, contentType;
  const res = { writeHead: status => { code = status; }, setHeader: (name, value) => { if (name === 'Content-Type') contentType = value; }, end: value => { body = value; } };
  handle({}, res, '/design-native/playlist.json');assert.equal(code, 404, 'optional private Mix capture can be absent');
  fs.writeFileSync(playlistFile, '[{"parent":-1,"tag":"ytd-playlist-panel-renderer","attrs":[]}]');
  handle({}, res, '/design-native/playlist.json');assert.equal(contentType, 'application/json; charset=utf-8');
  assert.equal(JSON.parse(body)[0].tag, 'ytd-playlist-panel-renderer', 'serve native DOM records without HTML reparsing');
  console.log('Design stage root attributes and playback isolation checks passed');
} finally {
  if (path.dirname(directory) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('liquid-native-stage-')) {
    throw new Error('Fixture cleanup must stay inside its temporary directory');
  }
  fs.rmSync(directory, { recursive: true, force: true });
}
