/* Packaged extension code only; this worker has no DOM or extension API. */
'use strict';
importScripts('black-bar-detector.js', 'renderer.js', 'gpu-renderer.js');

const canvas = new OffscreenCanvas(400, 400);
const renderer = new YacGpuRenderer(new YacRenderer(canvas), new OffscreenCanvas(400, 400));
const validSize = value => Number.isFinite(value) && value > 0 && value <= 32768;
const validRect = rectangle => rectangle &&
  ['left', 'top', 'width', 'height'].every(key => Number.isFinite(rectangle[key])) &&
  validSize(rectangle.width) && validSize(rectangle.height);

self.onmessage = event => {
  const job = event.data;
  if (!job || job.type !== 'render') return;
  const frame = job.frame;
  let output = null;
  try {
    if (!Number.isSafeInteger(job.requestId) || !Number.isSafeInteger(job.generation) ||
        !Number.isSafeInteger(job.barGeneration) || job.barGeneration < 0 ||
        !frame || frame.width !== 320 || frame.height !== 180 || !validRect(job.rectangle) ||
        !job.viewport || !validSize(job.viewport.width) || !validSize(job.viewport.height) ||
        typeof job.sourceKey !== 'string' || job.sourceKey.length > 8192) {
      throw new Error('Invalid ambient frame');
    }
    const options = job.options || {};
    if (options.sampleOnly !== undefined && typeof options.sampleOnly !== 'boolean') throw new Error('Invalid ambient sampling mode');
    const sampleOnly = options.sampleOnly === true;
    const rendererOptions = {
      sourceKey: job.barGeneration + ':' + job.sourceKey,
      mediaTime: Number(job.mediaTime) || 0,
      avoidBars: options.avoidBars !== false,
      fillBars: options.fillBars === true,
      inset: Number(options.inset) || 0,
      blend: Number(options.blend) || 0
    };
    const result = sampleOnly ? renderer.inspect(frame, job.rectangle, job.viewport, rendererOptions) :
      renderer.draw(frame, job.rectangle, job.viewport, job.radial === true, rendererOptions);
    // Projection/inspection is complete before handing off the sample buffer.
    // The next inspect() clears the cached pixels and reads a fresh frame, so
    // neither the 2D nor GPU backend needs to retain this buffer after transfer.
    const pixels = sampleOnly || options.readPixels === true ? renderer.readPixels() || null : null;
    // Pixel readback may discover protected/tainted media after inspection.
    result.readable = result.readable && renderer.readable;
    const bitmap = sampleOnly ? null : renderer.canvas.transferToImageBitmap();
    output = bitmap;
    const transfers = bitmap ? [bitmap] : [];
    if (pixels) transfers.push(pixels.buffer);
    self.postMessage({
      type: 'frame', requestId: job.requestId, generation: job.generation,
      sampleOnly, bitmap, pixels, ...result, stableFrames: renderer.stableFrames, backend: renderer.backend
    }, transfers);
    output = null;
  } catch (error) {
    output?.close();
    self.postMessage({ type: 'failed', requestId: job.requestId, generation: job.generation,
      reason: error instanceof Error ? error.message : 'Ambient worker failed' });
  } finally {
    frame?.close?.();
  }
};
self.postMessage({ type: 'ready', backend: renderer.backend });
