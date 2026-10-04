(() => {
  'use strict';
  const vertex = `#version 300 es
    void main() {
      vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
      gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    }`;
  const fragment = `#version 300 es
    precision highp float;
    precision highp int;
    uniform sampler2D frame;
    uniform vec2 outputSize;
    uniform vec4 crop;
    uniform vec4 bounds;
    uniform float blend;
    uniform bool flatMode;
    out vec4 color;
    void main() {
      // The analysis canvas and CPU reference use top-down image coordinates.
      vec2 p = vec2(gl_FragCoord.x, outputSize.y - gl_FragCoord.y);
      vec2 whole = (crop.xy + p / outputSize * crop.zw) / vec2(160.0, 90.0);
      vec3 wholeColor = texture(frame, whole).rgb;
      if (flatMode) { color = vec4(wholeColor, 1.0); return; }
      vec2 d = (p - bounds.xy - bounds.zw * 0.5) / (bounds.zw * 0.5);
      float distance = max(1.0, max(abs(d.x), abs(d.y)));
      vec2 sampleAt = crop.xy + (d / distance + 1.0) * 0.5 * (crop.zw - 1.0);
      ivec2 texel = ivec2(clamp(floor(sampleAt + 0.5), vec2(0.0), vec2(159.0, 89.0)));
      color = vec4(mix(texelFetch(frame, texel, 0).rgb, wholeColor, blend), 1.0);
    }`;

  // Projection only: keep the existing detector and warning analysis independent.
  // A separate canvas allows fallback without trying to change its context type.
  globalThis.YacGpuRenderer = class {
    constructor(analysis, canvas) {
      this.analysis = analysis;
      this.gpuCanvas = canvas;
      this.backend = '2d';
      this.onLost = event => {
        event.preventDefault();
        this.disable('context-lost');
      };
      try {
        const gl = canvas.getContext('webgl2', { alpha: true, antialias: false,
          depth: false, stencil: false, premultipliedAlpha: false,
          preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: true });
        if (!gl) { this.fallbackReason = 'unavailable'; return; }
        this.gl = gl;
        const shaders = [];
        try {
          this.program = gl.createProgram();
          for (const [type, code] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
            const shader = gl.createShader(type);
            shaders.push(shader);
            gl.shaderSource(shader, code); gl.compileShader(shader);
            gl.attachShader(this.program, shader);
          }
          gl.linkProgram(this.program);
          if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error('GPU shader unavailable');
        } finally {
          for (const shader of shaders) gl.deleteShader(shader);
        }
        this.texture = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 160, 90);
        // Query once after allocation, never read pixels or wait for the GPU per frame.
        if (gl.getError() !== gl.NO_ERROR) throw new Error('GPU texture unavailable');
        gl.useProgram(this.program);
        this.uniforms = Object.fromEntries(['frame', 'outputSize', 'crop', 'bounds', 'blend', 'flatMode']
          .map(name => [name, gl.getUniformLocation(this.program, name)]));
        gl.uniform1i(this.uniforms.frame, 0);
        canvas.addEventListener('webglcontextlost', this.onLost);
        this.backend = 'webgl2';
      } catch (error) {
        this.disable('initialization-failed');
      }
    }
    get canvas() { return this.backend === 'webgl2' ? this.gpuCanvas : this.analysis.canvas; }
    get readable() { return this.analysis.readable; }
    get stableFrames() { return this.analysis.stableFrames; }
    readPixels() { return this.analysis.readPixels(); }
    inspect(...args) { return this.analysis.inspect(...args); }
    reset() { this.analysis.reset(); }
    disable(reason) {
      this.backend = '2d';
      this.fallbackReason = reason;
      const gl = this.gl;
      if (gl) {
        if (this.texture) gl.deleteTexture(this.texture);
        if (this.program) gl.deleteProgram(this.program);
      }
      this.texture = null; this.program = null;
      this.gpuCanvas.removeEventListener('webglcontextlost', this.onLost);
    }
    dispose() { this.disable('disposed'); }
    draw(source, rectangle, viewport, radial, options = {}) {
      const result = this.analysis.inspect(source, rectangle, viewport, options);
      if (this.backend === 'webgl2') {
        try {
          const gl = this.gl;
          if (gl.isContextLost()) throw new Error('GPU context lost');
          const plan = this.analysis.projectionLayout(rectangle, viewport, radial, options);
          const { width, height, crop, rectangle: projected, blend, flat } = plan;
          if (this.gpuCanvas.width !== width || this.gpuCanvas.height !== height) {
            this.gpuCanvas.width = width; this.gpuCanvas.height = height;
          }
          gl.viewport(0, 0, width, height);
          gl.useProgram(this.program);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, this.texture);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.analysis.frame);
          gl.uniform2f(this.uniforms.outputSize, width, height);
          gl.uniform4f(this.uniforms.crop, crop.x, crop.y, crop.width, crop.height);
          const sx = width / (viewport.width + this.analysis.padding * 2);
          const sy = height / (viewport.height + this.analysis.padding * 2);
          gl.uniform4f(this.uniforms.bounds, (projected.left + this.analysis.padding) * sx,
            (projected.top + this.analysis.padding) * sy, projected.width * sx, projected.height * sy);
          gl.uniform1f(this.uniforms.blend, blend);
          gl.uniform1i(this.uniforms.flatMode, flat ? 1 : 0);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
          gl.flush();
          return result;
        } catch (error) {
          // Do not inspect the same frame twice or reset temporal crop confidence.
          this.disable('draw-failed');
        }
      }
      return this.analysis.project(rectangle, viewport, radial, options, result);
    }
  };
})();
