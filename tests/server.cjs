'use strict';
const http=require('http'),fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const designMedia=require('./design-media.cjs').fromPrivateConfig(root);
const designNative=require('./native-design-stage.cjs').nativeStage(root);
const routes={'/watch':'tests/fixture.html','/live_chat':'tests/chat-fixture.html','/ambient.css':'ambient.css','/ambient.js':'ambient.js','/lucide-icons.js':'lucide-icons.js','/settings-store.js':'settings-store.js','/black-bar-detector.js':'black-bar-detector.js','/renderer.js':'renderer.js','/flash-monitor.js':'flash-monitor.js','/worker-client.js':'worker-client.js','/worker-host.html':'worker-host.html','/worker-host.js':'worker-host.js','/ambient-worker.js':'ambient-worker.js','/firefox-check':'tests/firefox-check.html','/check-renderer.js':'tests/check-renderer.js','/test-theme.css':'.tool-cache/deepdark.css','/baseline-ambient.css':'.tool-cache/ambient-v022.css','/baseline-ambient.js':'.tool-cache/ambient-v022.js'};
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8'};
Object.assign(routes, {'/gpu-check':'tests/gpu-fixture.html', '/check-gpu-browser.js':'tests/check-gpu-browser.js', '/gpu-renderer.js':'gpu-renderer.js', '/control-check':'tests/control-fixture.html', '/warning-check':'tests/warning-fixture.html', '/warning-fixture.js':'tests/warning-fixture.js'});
Object.assign(routes, {'/settings-check':'tests/settings-fixture.html', '/settings-fixture.js':'tests/settings-fixture.js',
  '/site-registry.js':'site-registry.js', '/playback-card.js':'playback-card.js', '/choice-menu.js':'choice-menu.js', '/color-picker.js':'color-picker.js', '/quick-panel.js':'quick-panel.js', '/settings-backup.js':'settings-backup.js', '/settings-dialog.js':'settings-dialog.js', '/settings-page.js':'settings-page.js',
  '/media-controller.js':'media-controller.js', '/media-check':'tests/media-fixture.html', '/media-fixture.js':'tests/media-fixture.js', '/media-profile.js':'tests/media-profile.js'});
Object.assign(routes, {'/site-appearance.js':'site-appearance.js', '/appearance-check':'tests/appearance-fixture.html',
  '/appearance-fixture.js':'tests/appearance-fixture.js', '/appearance-fixture.css':'tests/appearance-fixture.css', '/appearance-profile.js':'tests/appearance-profile.js'});
Object.assign(routes, {'/design-stage.css':'tests/design-stage.css',
  '/chat-demo':'tests/chat-demo.html',
  '/settings-designs.js':'tests/settings-designs.js', '/settings-designs.css':'tests/settings-designs.css', '/design-settings-bridge.js':'tests/design-settings-bridge.js', '/design-stage.js':'tests/design-stage.js', '/design-icons.js':'tests/design-icons.js', '/playback-designs.js':'tests/playback-designs.js',
  '/channel-card.js':'channel-card.js', '/channel-bridge.js':'channel-bridge.js', '/channel-check':'tests/channel-fixture.html', '/channel-fixture.js':'tests/channel-fixture.js', '/watch-sidebar.js':'watch-sidebar.js', '/watch-sidebar.css':'watch-sidebar.css'});
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(designNative(req,res,url.pathname)) return;
  if(designMedia(req,res,url.pathname)) return;
  if(req.method==='POST'&&req.url==='/test-result'){
    let body='';req.on('data',chunk=>{body+=chunk;if(body.length>20000)req.destroy();});
    req.on('end',()=>{console.log('RENDERER_RESULT '+body);res.end('ok');});return;
  }
  if(url.pathname==='/settings-check'&&url.searchParams.has('strict')) res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'none'");
  if(url.pathname==='/appearance-check') res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'");
  const file=url.pathname==='/watch'&&url.searchParams.get('fixture')==='warning'?'tests/warning-fixture.html':routes[url.pathname];
  if(!file||!fs.existsSync(path.join(root,file))){res.writeHead(404);return res.end();}
  let content=fs.readFileSync(path.join(root,file));
  if(file==='tests/appearance-fixture.js'||file==='tests/design-settings-bridge.js'){
    const {version}=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
    content=content.toString('utf8').replace(/version: '(?:fixture|design-stage)'/, 'version: '+JSON.stringify(version));
  }
  if(file==='tests/fixture.html'||file==='tests/warning-fixture.html'||file==='tests/settings-fixture.html'||file==='tests/media-fixture.html'){
    const {version}=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
    const manifest=JSON.stringify({version}).replace(/</g,'\\u003c');
    content=content.toString('utf8').replace(/<head>/,'<head><script>globalThis.yacFixtureManifest='+manifest+';</script>');
  }
  if(file==='tests/fixture.html') content=content.toString('utf8').replace('<script src="/lucide-icons.js"></script>',
    '<script src="/lucide-icons.js"></script><script src="/site-registry.js"></script><script src="/playback-card.js"></script><script src="/choice-menu.js"></script><script src="/color-picker.js"></script><script src="/quick-panel.js"></script><script src="/settings-backup.js"></script><script src="/settings-dialog.js"></script><script src="/media-controller.js"></script>');
  res.setHeader('Content-Type',types[path.extname(file)]);res.setHeader('Cache-Control','no-store');res.end(content);
});
server.listen(Number(process.env.LIQUID_DEMO_PORT)||0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port+'/watch'));
