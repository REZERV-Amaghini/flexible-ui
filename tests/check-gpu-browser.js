(() => {
  'use strict';

  const button = document.getElementById('run');
  const status = document.getElementById('status');
  const output = document.getElementById('result');
  const previews = document.getElementById('previews');
  const viewport = { width: 1920, height: 1080 };
  const rectangle = { left: 340, top: 90, width: 960, height: 540 };

  function canvas(width = 1, height = 1) {
    const value = document.createElement('canvas');
    value.width = width; value.height = height;
    return value;
  }

  function makeSource({ bars = null, edgeColors = false, offset = 0 } = {}) {
    // Two pixels per analysis texel makes downsampling deterministic, while
    // leaving realistic, nonuniform colors inside any synthetic black bands.
    const source = canvas(320, 180);
    const context = source.getContext('2d', { alpha: false });
    const image = context.createImageData(320, 180);
    for (let y = 0; y < 180; y++) for (let x = 0; x < 320; x++) {
      const sx = Math.floor(x / 2), sy = Math.floor(y / 2);
      let rgb = [50 + Math.round(sx * 1.1) + offset, 60 + Math.round(sy * 1.9), 220 - Math.round((sx + sy) * .55)];
      if (edgeColors) {
        if (sy === 0) rgb = [255, 0, 0];
        else if (sy === 89) rgb = [0, 0, 255];
        else if (sx === 0) rgb = [255, 255, 0];
        else if (sx === 159) rgb = [0, 255, 0];
      }
      if (bars === 'letterbox' && (y < 24 || y >= 156) ||
          bars === 'pillarbox' && (x < 40 || x >= 280)) rgb = [0, 0, 0];
      const at = (y * 320 + x) * 4;
      image.data[at] = rgb[0]; image.data[at + 1] = rgb[1];
      image.data[at + 2] = rgb[2]; image.data[at + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    return source;
  }

  function snapshot(source) {
    const value = canvas(source.width, source.height);
    const context = value.getContext('2d', { alpha: false, willReadFrequently: true });
    // This readback is a correctness-test synchronization point. The extension
    // runtime never reads the WebGL output back for its projection.
    context.drawImage(source, 0, 0);
    return { canvas: value, pixels: context.getImageData(0, 0, value.width, value.height).data };
  }

  function difference(reference, actual) {
    if (reference.length !== actual.length) throw new Error('Output dimensions differ');
    let sum = 0, max = 0, largePixels = 0, alphaErrors = 0;
    const count = reference.length / 4;
    for (let i = 0; i < reference.length; i += 4) {
      let pixelMax = 0;
      for (let channel = 0; channel < 3; channel++) {
        const error = Math.abs(reference[i + channel] - actual[i + channel]);
        sum += error; max = Math.max(max, error); pixelMax = Math.max(pixelMax, error);
      }
      if (pixelMax > 8) largePixels++;
      if (actual[i + 3] !== 255) alphaErrors++;
    }
    return { meanChannelError: Number((sum / (count * 3)).toFixed(4)),
      maxChannelError: max, largePixelFraction: Number((largePixels / count).toFixed(6)), alphaErrors };
  }

  function preview(label, value) {
    const figure = document.createElement('figure');
    const caption = document.createElement('figcaption'); caption.textContent = label;
    figure.append(caption, value); previews.append(figure);
  }

  async function checkWorker() {
    let worker, input, returned, timer, stopped = false;
    const jobCount = 36;
    const report = { pass: false, requestedJobs: jobCount, completedJobs: 0, pixelChecks: 0,
      sampleOnlyJobs: 0, withoutReadbackJobs: 0, bitmapChecks: 0, cropChecks: 0,
      detachedInputs: 0, readyBackend: null, frameBackends: [],
      maxMeanChannelError: 0, maxLargePixelFraction: 0, maxChannelError: 0, alphaErrors: 0 };
    try {
      worker = new Worker('/ambient-worker.js');
      const reference = new YacRenderer(canvas());
      let ready = false, pending = null;
      return await new Promise((resolve, reject) => {
        const fail = error => { if (!stopped) { stopped = true; reject(error); } };
        timer = setTimeout(() => fail(new Error('Sequential Worker checks exceeded 10000 ms')), 10000);
        worker.onerror = event => fail(new Error(event.message || 'Worker startup failed'));
        worker.onmessageerror = () => fail(new Error('Worker result could not be decoded'));
        async function sendNext() {
          if (stopped) return;
          const index = report.completedJobs;
          const group = Math.floor(index / 12);
          // Keep every source detached from the DOM: these changing static
          // patterns validate ownership, never produce visible flashing.
          const source = makeSource({ offset: index, bars: [null, 'letterbox', 'pillarbox'][group] });
          const captured = await createImageBitmap(source);
          if (stopped) { captured.close(); return; }
          input = captured;
          const options = { avoidBars: true, fillBars: true, inset: 13, blend: .35,
            sampleOnly: index % 3 === 1, readPixels: index % 3 === 0 };
          const sourceKey = 'fixture-worker-' + group, mediaTime = index / 30;
          const referenceOptions = { ...options, sourceKey: '3:' + sourceKey, mediaTime };
          const expected = options.sampleOnly ? reference.inspect(input, rectangle, viewport, referenceOptions) :
            reference.draw(input, rectangle, viewport, true, referenceOptions);
          pending = { requestId: index + 1, options, expected };
          worker.postMessage({ type: 'render', requestId: pending.requestId, generation: 2, barGeneration: 3,
            frame: input, rectangle, viewport, radial: true, options, sourceKey, mediaTime }, [input]);
          if (input.width !== 0 || input.height !== 0) throw new Error('Transferred input was not detached');
          report.detachedInputs++;
          input = null;
        }
        worker.onmessage = event => {
          const reply = event.data;
          if (stopped) { reply.bitmap?.close(); return; }
          returned = reply.bitmap || null;
          try {
            if (reply.type === 'ready') {
              if (ready) throw new Error('Duplicate worker readiness');
              if (!['webgl2', '2d'].includes(reply.backend)) throw new Error('Unknown worker backend');
              ready = true; report.readyBackend = reply.backend;
              sendNext().catch(fail); return;
            }
            if (reply.type === 'failed') throw new Error(reply.reason || 'Worker render failed');
            if (reply.type !== 'frame' || !pending) throw new Error('Unexpected worker reply');
            const { requestId, options, expected } = pending;
            if (reply.requestId !== requestId || reply.generation !== 2 || reply.sampleOnly !== options.sampleOnly ||
                !['webgl2', '2d'].includes(reply.backend)) throw new Error('Worker response identity/mode mismatch');
            if (!report.frameBackends.includes(reply.backend)) report.frameBackends.push(reply.backend);
            if (JSON.stringify(reply.samplingCrop) !== JSON.stringify(expected.samplingCrop) ||
                JSON.stringify(reply.videoCrop) !== JSON.stringify(expected.videoCrop) ||
                reply.readable !== expected.readable || reply.cropped !== expected.cropped) throw new Error('Worker crop/analysis mismatch');
            report.cropChecks++;
            if (options.sampleOnly || options.readPixels) {
              const sample = reference.readPixels();
              if (!(reply.pixels instanceof Uint8ClampedArray) || reply.pixels.length !== 57600 ||
                  sample.length !== 57600 || !reply.pixels.every((value, at) => value === sample[at])) {
                throw new Error('Worker sample pixels differ or became detached');
              }
              report.pixelChecks++;
            } else {
              if (reply.pixels !== null) throw new Error('Worker returned unrequested sample pixels');
              report.withoutReadbackJobs++;
            }
            if (options.sampleOnly) {
              if (reply.bitmap !== null) throw new Error('Sampling-only job returned a bitmap');
              report.sampleOnlyJobs++;
            } else {
              if (!returned || returned.width !== reference.canvas.width || returned.height !== reference.canvas.height) {
                throw new Error('Worker bitmap missing or wrong dimensions');
              }
              const metrics = difference(snapshot(reference.canvas).pixels, snapshot(returned).pixels);
              report.maxMeanChannelError = Math.max(report.maxMeanChannelError, metrics.meanChannelError);
              report.maxLargePixelFraction = Math.max(report.maxLargePixelFraction, metrics.largePixelFraction);
              report.maxChannelError = Math.max(report.maxChannelError, metrics.maxChannelError);
              report.alphaErrors += metrics.alphaErrors;
              if (metrics.meanChannelError > 1 || metrics.largePixelFraction > .004 || metrics.alphaErrors) {
                throw new Error('Worker projected bitmap differs from the reference');
              }
              report.bitmapChecks++;
            }
            returned?.close(); returned = null; pending = null;
            report.completedJobs++;
            if (report.completedJobs === jobCount) {
              report.pass = true; report.transferredInputDetached = report.detachedInputs === jobCount;
              stopped = true; resolve(report);
            } else sendNext().catch(fail);
          } catch (error) { fail(error); }
          finally { returned?.close(); returned = null; }
        };
      });
    } catch (error) {
      return { ...report, pass: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      stopped = true; clearTimeout(timer); input?.close(); returned?.close(); worker?.terminate();
    }
  }
  async function run() {
    button.disabled = true; previews.replaceChildren();
    status.dataset.state = 'running'; status.textContent = 'Running';
    output.textContent = 'Comparing actual GPU output with the Canvas 2D reference…';
    const result = { pass: false, backend: null, cases: [], checks: [], benchmark: null, worker: null,
      scope: 'Static offscreen frames: inspection, projection and sequential packaged-Worker transfer. Real video decoding, CSS blur and YouTube are excluded.' };
    let gpu;
    try {
      if (typeof YacGpuRenderer !== 'function') throw new Error('YacGpuRenderer did not load');
      const cpu = new YacRenderer(canvas());
      const analysis = new YacRenderer(canvas());
      const gpuCanvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1) : canvas();
      gpu = new YacGpuRenderer(analysis, gpuCanvas);
      result.backend = gpu.backend;
      result.canvasType = gpuCanvas.constructor.name;
      const source = makeSource();
      const edges = makeSource({ edgeColors: true });
      const letterbox = makeSource({ bars: 'letterbox' });
      const pillarbox = makeSource({ bars: 'pillarbox' });
      let mediaTime = 0;

      function compare(name, frame, rect = rectangle, vp = viewport, radial = true, extra = {}) {
        const options = { sourceKey: 'fixture-' + (extra.sourceKey || name), avoidBars: false,
          mediaTime: mediaTime += .04, ...extra };
        const expected = cpu.draw(frame, rect, vp, radial, options);
        const actual = gpu.draw(frame, rect, vp, radial, options);
        const reference = snapshot(cpu.canvas), rendered = snapshot(gpu.canvas);
        const dimensionsMatch = reference.canvas.width === rendered.canvas.width && reference.canvas.height === rendered.canvas.height;
        const metrics = difference(reference.pixels, rendered.pixels);
        const cropMatches = JSON.stringify(expected.samplingCrop) === JSON.stringify(actual.samplingCrop) &&
          JSON.stringify(expected.videoCrop) === JSON.stringify(actual.videoCrop);
        // Nearest radial texel rounding can differ at isolated boundaries in
        // float32 shaders. Blended/flat Canvas interpolation can differ by a
        // few channel levels. A flipped or otherwise incorrect mapping fails
        // mean error and the fraction-of-large-errors limit decisively.
        const pass = dimensionsMatch && cropMatches && metrics.meanChannelError <= 1 &&
          metrics.largePixelFraction <= .004 && metrics.alphaErrors === 0;
        result.cases.push({ name, pass, backend: gpu.backend, width: rendered.canvas.width,
          height: rendered.canvas.height, cropMatches, ...metrics });
        return { pass, expected, actual, reference, rendered };
      }

      compare('radial-gradient', source);
      compare('radial-perimeter-colors', edges);
      compare('radial-blend-035', source, rectangle, viewport, true, { blend: .35 });
      compare('radial-blend-1', source, rectangle, viewport, true, { blend: 1 });
      compare('flat-gradient', source, rectangle, viewport, false);
      compare('fractional-inset', source, rectangle, viewport, true, { inset: 17.5 });
      compare('fractional-offscreen', source, { left: -327.25, top: -423.75, width: 791.5, height: 445.375 }, viewport);
      compare('tiny-video-flat-fallback', source, { left: 10, top: 40, width: .5, height: .75 }, viewport);
      compare('portrait-resize', source, { left: 9.5, top: 80.25, width: 371, height: 208.6875 }, { width: 390, height: 844 });
      compare('clamped-output-height', source, rectangle, { width: 180, height: 3000 });

      let settled;
      for (const [name, frame] of [['letterbox', letterbox], ['pillarbox', pillarbox]]) {
        const options = { sourceKey: name, avoidBars: true, fillBars: true };
        for (let i = 0; i < 10; i++) {
          const sampleOptions = { ...options, mediaTime: mediaTime += .04 };
          cpu.inspect(frame, rectangle, viewport, sampleOptions);
          gpu.inspect(frame, rectangle, viewport, sampleOptions);
        }
        settled = compare('stable-' + name, frame, rectangle, viewport, true, options);
        const cropped = name === 'letterbox' ? settled.actual.samplingCrop.height < 90 : settled.actual.samplingCrop.width < 160;
        result.checks.push({ name: name + '-detected', pass: cropped, crop: settled.actual.samplingCrop });
      }
      const displayed = compare('preview-gradient', source);
      preview('Canvas 2D reference', displayed.reference.canvas);
      preview('GPU renderer output', displayed.rendered.canvas);
      result.worker = await checkWorker();
      result.checks.push({ name: 'packaged-worker-render', pass: result.worker.pass });

      if (result.backend === 'webgl2') result.checks.push({ name: 'gpu-projection-stayed-active',
        pass: gpu.backend === 'webgl2' && result.cases.every(value => value.backend === 'webgl2') });
      const gl = gpu.backend === 'webgl2' ? gpuCanvas.getContext('webgl2') : null;
      if (gl) {
        result.gl = { version: gl.getParameter(gl.VERSION), shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
          renderer: gl.getParameter(gl.RENDERER) };
        const frames = [0, 1, 2, 3].map(offset => makeSource({ offset }));
        const jobCount = 80;
        const options = { sourceKey: 'benchmark', avoidBars: false, fillBars: false };
        for (let i = 0; i < 12; i++) {
          cpu.draw(frames[i % 4], rectangle, viewport, true, options);
          gpu.draw(frames[i % 4], rectangle, viewport, true, options);
        }
        gl.finish();
        await new Promise(resolve => requestAnimationFrame(resolve));
        const startCpu = performance.now();
        for (let i = 0; i < jobCount; i++) cpu.draw(frames[i % 4], rectangle, viewport, true, options);
        const cpuMs = performance.now() - startCpu;
        await new Promise(resolve => requestAnimationFrame(resolve));
        const startGpu = performance.now();
        for (let i = 0; i < jobCount; i++) gpu.draw(frames[i % 4], rectangle, viewport, true, options);
        // Completion is required; comparing only queued GPU commands against
        // completed CPU jobs would exaggerate any speedup.
        gl.finish();
        const gpuMs = performance.now() - startGpu;
        result.benchmark = { completedJobs: jobCount, cpuTotalMs: Number(cpuMs.toFixed(3)),
          gpuTotalMs: Number(gpuMs.toFixed(3)), cpuMsPerJob: Number((cpuMs / jobCount).toFixed(3)),
          gpuMsPerJob: Number((gpuMs / jobCount).toFixed(3)),
          synchronization: 'WebGL finish after warmup and timed batch; test only' };

        // Settle a crop before a forced context loss, then verify that the
        // original analysis/detector survives switching to the 2D projection.
        const optionsAfterLoss = { sourceKey: 'loss-letterbox', avoidBars: true, fillBars: true };
        for (let i = 0; i < 10; i++) {
          cpu.inspect(letterbox, rectangle, viewport, optionsAfterLoss);
          gpu.inspect(letterbox, rectangle, viewport, optionsAfterLoss);
        }
        const detector = analysis.barDetector;
        const exactFrames = detector.exactFrames;
        const cropBefore = { ...analysis.crop };
        const lose = gl.getExtension('WEBGL_lose_context');
        if (lose) {
          const lost = new Promise(resolve => {
            const timeout = setTimeout(resolve, 500);
            gpuCanvas.addEventListener('webglcontextlost', () => { clearTimeout(timeout); resolve(); }, { once: true });
          });
          lose.loseContext(); await lost;
          const fallback = compare('context-loss-reference', letterbox, rectangle, viewport, true, optionsAfterLoss);
          const statePreserved = analysis.barDetector === detector && detector.exactFrames >= exactFrames &&
            JSON.stringify(analysis.crop) === JSON.stringify(cropBefore);
          result.checks.push({ name: 'context-loss-cpu-fallback', pass: gpu.backend === '2d' && fallback.pass && statePreserved,
            backend: gpu.backend, detectorStatePreserved: statePreserved });
        } else result.checks.push({ name: 'context-loss-cpu-fallback', skipped: true, reason: 'WEBGL_lose_context unavailable' });
      } else {
        result.benchmark = { skipped: true, reason: 'Hardware WebGL2 unavailable; reference comparisons exercised Canvas 2D fallback only.' };
        result.checks.push({ name: 'unavailable-gpu-cpu-fallback', pass: gpu.backend === '2d' });
      }

      result.pass = result.cases.every(value => value.pass) && result.checks.every(value => value.pass || value.skipped);
      result.gpuVerified = result.pass && result.backend === 'webgl2';
      status.dataset.state = result.pass ? result.gpuVerified ? 'passed' : 'unavailable' : 'failed';
      status.textContent = result.pass ? result.gpuVerified ? 'GPU checks passed' : 'Fallback passed; GPU unavailable' : 'Checks failed';
    } catch (error) {
      result.error = error instanceof Error ? error.stack || error.message : String(error);
      status.dataset.state = 'failed'; status.textContent = 'Checks failed';
    } finally {
      if (gpu) gpu.dispose();
      globalThis.yacGpuTestResult = result;
      output.textContent = JSON.stringify(result, null, 2);
      button.disabled = false;
    }
  }

  button.addEventListener('click', run);
})();
