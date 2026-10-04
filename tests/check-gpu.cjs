'use strict';
// Fake GL checks resource and fallback ownership; real shader pixels are tested separately.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const context = vm.createContext({ Uint8ClampedArray });
for (const name of ['renderer.js', 'gpu-renderer.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), context, { filename: name });
}
const GpuRenderer = context.YacGpuRenderer;
const layout = context.YacRenderer.prototype.projectionLayout;
const source = { currentSrc: 'test-video' };
const rectangle = { left: 20, top: 40, width: 640, height: 360 };
const viewport = { width: 1280, height: 720 };

class Canvas {
  constructor(gl = null, width = 400, height = 400) {
    this.gl = gl; this._width = width; this._height = height;
    this.resizes = []; this.contextRequests = []; this.events = new Map(); this.removed = [];
  }
  get width() { return this._width; }
  set width(value) { this._width = value; this.resizes.push(['width', value]); }
  get height() { return this._height; }
  set height(value) { this._height = value; this.resizes.push(['height', value]); }
  getContext(type, options) { this.contextRequests.push({ type, options }); return type === 'webgl2' ? this.gl : null; }
  addEventListener(type, handler) { this.events.set(type, handler); }
  removeEventListener(type, handler) {
    this.removed.push({ type, handler });
    if (this.events.get(type) === handler) this.events.delete(type);
  }
}

class FakeGl {
  constructor(options = {}) {
    this.options = options; this.calls = []; this.programs = []; this.shaders = []; this.textures = [];
    this.deletedPrograms = []; this.deletedShaders = []; this.deletedTextures = [];
    Object.assign(this, { VERTEX_SHADER: 35633, FRAGMENT_SHADER: 35632, LINK_STATUS: 35714,
      TEXTURE0: 33984, TEXTURE_2D: 3553, TEXTURE_MIN_FILTER: 10241, TEXTURE_MAG_FILTER: 10240,
      LINEAR: 9729, TEXTURE_WRAP_S: 10242, TEXTURE_WRAP_T: 10243, CLAMP_TO_EDGE: 33071,
      RGBA8: 32856, RGBA: 6408, UNSIGNED_BYTE: 5121, NO_ERROR: 0, TRIANGLES: 4 });
    for (const name of ['shaderSource', 'compileShader', 'attachShader', 'linkProgram', 'activeTexture',
      'bindTexture', 'texParameteri', 'useProgram', 'uniform1i', 'uniform1f', 'uniform2f', 'uniform4f',
      'viewport', 'flush']) this[name] = (...args) => { this.calls.push({ name, args }); };
  }
  createProgram() {
    if (this.options.programThrows) throw new Error('program failure');
    const program = {}; this.programs.push(program); return program;
  }
  createShader(type) { const shader = { type }; this.shaders.push(shader); return shader; }
  getProgramParameter() { return this.options.link !== false; }
  deleteShader(value) { this.deletedShaders.push(value); }
  createTexture() { const texture = {}; this.textures.push(texture); return texture; }
  deleteTexture(value) { this.deletedTextures.push(value); }
  deleteProgram(value) { this.deletedPrograms.push(value); }
  texStorage2D(...args) { this.calls.push({ name: 'texStorage2D', args }); }
  getError() { this.errorReads = (this.errorReads || 0) + 1; return this.options.textureError ? 1285 : 0; }
  getUniformLocation(program, name) { return name; }
  isContextLost() { return this.options.lost === true; }
  texSubImage2D(...args) {
    this.calls.push({ name: 'texSubImage2D', args });
    if (this.options.uploadThrows) throw new Error('upload failure');
  }
  drawArrays(...args) {
    this.calls.push({ name: 'drawArrays', args });
    if (this.options.drawThrows) throw new Error('draw failure');
  }
  readPixels() { throw new Error('GPU readback is not part of production rendering'); }
  finish() { throw new Error('GPU finish would synchronously block rendering'); }
}

function harness(options = {}) {
  const gl = options.noGl ? null : new FakeGl(options);
  const gpuCanvas = new Canvas(gl), cpuCanvas = new Canvas();
  const calls = { inspect: [], plans: [], project: [], reads: 0, resets: 0 };
  const pixels = new Uint8ClampedArray(160 * 90 * 4);
  const analysis = {
    canvas: cpuCanvas, frame: { width: 160, height: 90 }, padding: 180,
    readable: true, stableFrames: 7, crop: { x: 0, y: 10, width: 160, height: 70 },
    inspect(...args) {
      calls.inspect.push(args);
      return { readable: this.readable, cropped: true,
        videoCrop: { ...this.crop }, samplingCrop: { ...this.crop } };
    },
    projectionLayout(...args) { calls.plans.push(args); return layout.apply(this, args); },
    project(...args) {
      calls.project.push(args);
      const plan = this.projectionLayout(...args.slice(0, 4));
      if (this.canvas.width !== plan.width || this.canvas.height !== plan.height) {
        this.canvas.width = plan.width; this.canvas.height = plan.height;
      }
      return args[4];
    },
    readPixels() { calls.reads++; return pixels; },
    reset() { calls.resets++; }
  };
  return { renderer: new GpuRenderer(analysis, gpuCanvas), analysis, gl, gpuCanvas, cpuCanvas, calls, pixels };
}

const unavailable = harness({ noGl: true });
assert.equal(unavailable.renderer.backend, '2d'); assert.equal(unavailable.renderer.canvas, unavailable.cpuCanvas);
const fallbackResult = unavailable.renderer.draw(source, rectangle, viewport, true, { inset: 5 });
assert.equal(unavailable.calls.inspect.length, 1); assert.equal(unavailable.calls.project.length, 1);
assert.equal(unavailable.calls.project[0][4], fallbackResult, 'Fallback reuses the inspected frame result');
assert.equal(unavailable.calls.resets, 0, 'Unavailable GPU preserves temporal detector state');
unavailable.renderer.dispose();

for (const options of [{ programThrows: true }, { link: false }, { textureError: true }]) {
  const failed = harness(options);
  assert.equal(failed.renderer.backend, '2d'); assert.equal(failed.renderer.fallbackReason, 'initialization-failed');
  assert.equal(failed.renderer.canvas, failed.cpuCanvas); assert.equal(failed.gpuCanvas.events.size, 0);
  assert.equal(failed.gl.deletedShaders.length, failed.gl.shaders.length, 'Every temporary shader is released after initialization');
  assert.equal(failed.gl.deletedPrograms.length, failed.gl.programs.length, 'Failed initialization releases its program');
  assert.equal(failed.gl.deletedTextures.length, failed.gl.textures.length, 'Failed texture allocation releases its texture');
  const before = { programs: failed.gl.deletedPrograms.length, textures: failed.gl.deletedTextures.length };
  failed.renderer.draw(source, rectangle, viewport, true);
  failed.renderer.dispose(); failed.renderer.dispose();
  assert.equal(failed.calls.inspect.length, 1); assert.equal(failed.calls.project.length, 1);
  assert.equal(failed.calls.resets, 0);
  assert.equal(failed.gl.deletedPrograms.length, before.programs, 'Cleanup does not delete a failed program twice');
  assert.equal(failed.gl.deletedTextures.length, before.textures, 'Cleanup does not delete a failed texture twice');
}

const success = harness();
assert.equal(success.renderer.backend, 'webgl2'); assert.equal(success.renderer.canvas, success.gpuCanvas);
assert.equal(success.gl.deletedShaders.length, 2); assert.equal(success.gl.deletedPrograms.length, 0);
assert.equal(success.gpuCanvas.contextRequests[0].type, 'webgl2');
assert.equal(success.gpuCanvas.contextRequests[0].options.failIfMajorPerformanceCaveat, true);
assert.equal(success.gpuCanvas.events.has('webglcontextlost'), true);
const preferences = { avoidBars: true, fillBars: true, inset: 5, blend: .25, sourceKey: 'same-source', mediaTime: 4 };
const result = success.renderer.draw(source, rectangle, viewport, true, preferences);
assert.equal(success.calls.inspect.length, 1); assert.equal(success.calls.inspect[0][0], source);
assert.equal(success.calls.inspect[0][3], preferences, 'GPU projection keeps the original analysis settings');
assert.equal(success.calls.project.length, 0, 'GPU rendering skips the CPU projection and pixel-copy loop');
assert.equal(success.calls.reads, 0, 'Rendering alone does not request CPU warning pixels');
assert.equal(success.calls.resets, 0); assert.equal(success.renderer.stableFrames, 7);
assert.equal(result.samplingCrop.y, 10);
assert.equal(success.gl.calls.filter(call => call.name === 'drawArrays').length, 1);
assert.deepEqual(success.gl.calls.find(call => call.name === 'drawArrays').args, [success.gl.TRIANGLES, 0, 3]);
assert.equal(success.gl.calls.find(call => call.name === 'texSubImage2D').args.at(-1), success.analysis.frame,
  'Texture upload uses the shared analysis canvas, with no second video capture');
assert.equal(success.gl.errorReads, 1, 'Error query runs once at allocation, never once per output frame');
assert.equal(success.renderer.readPixels(), success.pixels); assert.equal(success.calls.reads, 1);
success.analysis.readable = false; assert.equal(success.renderer.readable, false);
success.renderer.reset(); assert.equal(success.calls.resets, 1, 'Explicit reset delegates once to the existing detector');
const drawsBeforeInspect = success.gl.calls.filter(call => call.name === 'drawArrays').length;
success.renderer.inspect(source, rectangle, viewport, preferences);
assert.equal(success.calls.inspect.length, 2);
assert.equal(success.gl.calls.filter(call => call.name === 'drawArrays').length, drawsBeforeInspect,
  'Analysis-only jobs never draw or resize a GPU output');
const resizeCount = success.gpuCanvas.resizes.length;
success.renderer.draw(source, rectangle, viewport, true, preferences);
assert.equal(success.gpuCanvas.resizes.length, resizeCount, 'Stable output dimensions do not reallocate the drawing buffer');
assert.equal(success.gl.calls.filter(call => call.name === 'texStorage2D').length, 1,
  'Texture storage is reused across output frames and resets');
assert.equal(success.gl.errorReads, 1);

for (const size of [{ width: 1, height: 32768 }, { width: 32768, height: 1 }, { width: 800, height: 2000 }]) {
  const plan = layout.call(success.analysis, rectangle, size, true, preferences);
  success.renderer.draw(source, rectangle, size, true, preferences);
  assert.equal(success.gpuCanvas.width, 400); assert.equal(success.gpuCanvas.height, plan.height);
  assert.ok(success.gpuCanvas.height >= 80 && success.gpuCanvas.height <= 2048,
    'GPU output keeps the existing CPU size and memory bounds');
  const gpuBounds = success.gl.calls.filter(call => call.name === 'uniform4f' && call.args[0] === 'bounds').at(-1).args;
  const sx = plan.width / (size.width + 360), sy = plan.height / (size.height + 360);
  assert.deepEqual(gpuBounds, ['bounds', (plan.rectangle.left + 180) * sx, (plan.rectangle.top + 180) * sy,
    plan.rectangle.width * sx, plan.rectangle.height * sy], 'GPU and CPU projection share cropped geometry');
}
success.renderer.draw(source, rectangle, viewport, false, preferences);
assert.equal(success.gl.calls.filter(call => call.name === 'uniform1i' && call.args[0] === 'flatMode').at(-1).args[1], 1);
success.renderer.draw(source, rectangle, viewport, true, { ...preferences, blend: 1 });
assert.equal(success.gl.calls.filter(call => call.name === 'uniform1i' && call.args[0] === 'flatMode').at(-1).args[1], 1);
success.renderer.dispose(); success.renderer.dispose();
assert.equal(success.gl.deletedPrograms.length, 1); assert.equal(success.gl.deletedTextures.length, 1);
assert.equal(success.gpuCanvas.events.size, 0); assert.equal(success.renderer.backend, '2d');

for (const options of [{ uploadThrows: true }, { drawThrows: true }, { lost: true }]) {
  const failed = harness(options);
  const first = failed.renderer.draw(source, rectangle, viewport, true, preferences);
  assert.equal(failed.renderer.backend, '2d'); assert.equal(failed.renderer.fallbackReason, 'draw-failed');
  assert.equal(failed.renderer.canvas, failed.cpuCanvas);
  assert.equal(failed.calls.inspect.length, 1, 'Failing GPU projection does not re-inspect the same input');
  assert.equal(failed.calls.project.length, 1); assert.equal(failed.calls.project[0][4], first);
  assert.equal(failed.calls.resets, 0); assert.equal(failed.renderer.stableFrames, 7,
    'Fallback retains crop confidence and flash-monitor sample ownership');
  assert.equal(failed.gl.deletedPrograms.length, 1); assert.equal(failed.gl.deletedTextures.length, 1);
  assert.equal(failed.gpuCanvas.events.size, 0);
  const beforeGpuCalls = failed.gl.calls.length;
  failed.renderer.draw(source, rectangle, viewport, true, preferences);
  assert.equal(failed.gl.calls.length, beforeGpuCalls, 'Fallback remains permanent, without repeated GPU retries');
  assert.equal(failed.calls.inspect.length, 2); assert.equal(failed.calls.project.length, 2);
  failed.renderer.dispose();
  assert.equal(failed.gl.deletedPrograms.length, 1); assert.equal(failed.gl.deletedTextures.length, 1);
}

const contextLoss = harness();
const handler = contextLoss.gpuCanvas.events.get('webglcontextlost');
let prevented = 0;
handler({ preventDefault() { prevented++; } });
assert.equal(prevented, 1); assert.equal(contextLoss.renderer.backend, '2d');
assert.equal(contextLoss.renderer.fallbackReason, 'context-lost'); assert.equal(contextLoss.gpuCanvas.events.size, 0);
assert.equal(contextLoss.gl.deletedPrograms.length, 1); assert.equal(contextLoss.gl.deletedTextures.length, 1);
contextLoss.renderer.draw(source, rectangle, viewport, true, preferences);
assert.equal(contextLoss.calls.inspect.length, 1); assert.equal(contextLoss.calls.project.length, 1);
assert.equal(contextLoss.calls.resets, 0);
contextLoss.renderer.dispose();
assert.equal(contextLoss.gl.deletedPrograms.length, 1); assert.equal(contextLoss.gl.deletedTextures.length, 1);

console.log('PASS: GPU lifecycle, resource cleanup, analysis reuse, optional readback, bounded shared geometry, stable allocation and permanent 2D fallback');
