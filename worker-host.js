/* The extension-origin frame starts a same-origin packaged Worker. */
'use strict';
(() => {
  let port = null, worker = null;
  const token = location.hash.slice(1);
  const teardown = () => { worker?.terminate(); worker = null; port?.close(); port = null; };
  addEventListener('pagehide', teardown, { once: true });
  addEventListener('message', event => {
    const sameOriginDemo = location.protocol === 'http:' && event.origin === location.origin;
    if (port || event.source !== parent || (event.origin !== 'https://www.youtube.com' && !sameOriginDemo) ||
        event.data?.type !== 'yac-worker-connect' || event.data.token !== token ||
        !/^[a-f0-9]{32}$/.test(token) || event.ports.length !== 1) return;
    port = event.ports[0];
    const fail = reason => { port?.postMessage({ type: 'failed', reason }); worker?.terminate(); worker = null; };
    try {
      worker = new Worker('ambient-worker.js');
      worker.onmessage = workerEvent => {
        const value = workerEvent.data;
        if (!value || !['ready', 'frame', 'failed'].includes(value.type)) return;
        const transfers = value.bitmap ? [value.bitmap] : [];
        if (value.pixels instanceof Uint8ClampedArray) transfers.push(value.pixels.buffer);
        try { port?.postMessage(value, transfers); }
        catch (error) { value.bitmap?.close(); fail('Ambient frame transfer failed'); }
      };
      worker.onerror = () => fail('Ambient worker could not start');
      worker.onmessageerror = () => fail('Ambient worker message failed');
      port.onmessage = portEvent => {
        const value = portEvent.data;
        if (value?.type === 'dispose') { teardown(); return; }
        if (value?.type !== 'render') return;
        if (!worker) { value.frame?.close(); return; }
        try { worker.postMessage(value, value.frame ? [value.frame] : []); }
        catch (error) { value.frame?.close(); fail('Ambient source transfer failed'); }
      };
      port.start();
    } catch (error) { fail('Ambient worker is unavailable'); }
  });
})();
