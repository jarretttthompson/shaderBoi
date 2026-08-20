// Shadertoy-compatible WebGL2 rendering engine.

class ShaderEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!this.gl) throw new Error('WebGL2 not supported in this browser.');

    this.program = null;
    this.uniforms = {};
    this.playing = true;
    this.time = 0;
    this.frame = 0;
    this.lastStamp = null;
    this.resolutionScale = 1;   // 0.5, 1, or devicePixelRatio
    this.mouse = [0, 0, 0, 0];
    this.onTick = null;         // callback(time)
    this.fade = null;           // {program, uniforms, start} — outgoing shader during crossfade
    this.fadeDuration = 1.8;    // seconds

    this._initGeometry();
    this._initChannels();
    this._resize();
    window.addEventListener('resize', () => this._resize());
    requestAnimationFrame((t) => this._loop(t));
  }

  _initGeometry() {
    const gl = this.gl;
    const vs = `#version 300 es
    void main() {
      vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
      gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    }`;
    this.vertShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(this.vertShader, vs);
    gl.compileShader(this.vertShader);
  }

  // Shadertoy binds textures to iChannel0-3; we provide an RGBA noise texture
  // (Shadertoy's classic "RGBA noise" input) on every channel.
  _initChannels() {
    const gl = this.gl;
    const size = 256;
    const data = new Uint8Array(size * size * 4);
    // deterministic PRNG so the forest looks the same every load
    let seed = 1234567;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed & 0xff;
    };
    for (let i = 0; i < data.length; i++) data[i] = rnd();

    this.noiseTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.noiseTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  _wrapSource(userCode) {
    return `#version 300 es
precision highp float;
precision highp int;
uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform float iFrameRate;
uniform int iFrame;
uniform vec4 iMouse;
uniform vec4 iDate;
uniform sampler2D iChannel0;
uniform sampler2D iChannel1;
uniform sampler2D iChannel2;
uniform sampler2D iChannel3;
uniform vec3 iChannelResolution[4];
out vec4 SD_fragColor;
#line 1
${userCode}
void main() {
  vec4 c = vec4(0.0);
  mainImage(c, gl_FragCoord.xy);
  SD_fragColor = vec4(c.rgb, 1.0);
}`;
  }

  // Compile user code. Returns { ok: true } or { ok: false, log }.
  // On success the new program becomes active.
  setShader(userCode) {
    const gl = this.gl;
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, this._wrapSource(userCode));
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(fs);
      gl.deleteShader(fs);
      return { ok: false, log };
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, this.vertShader);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      return { ok: false, log };
    }
    // crossfade: the outgoing program keeps rendering live while the new one blends in
    if (this.program) {
      if (this.fade) { gl.deleteProgram(this.fade.program); }
      this.fade = {
        program: this.program,
        uniforms: this.uniforms,
        start: performance.now(),
      };
    }
    this.program = prog;
    this.uniforms = this._lookupUniforms(prog);
    // time keeps running across switches so neither side of the fade jumps
    return { ok: true };
  }

  _lookupUniforms(prog) {
    const u = {};
    for (const name of ['iResolution', 'iTime', 'iTimeDelta', 'iFrameRate', 'iFrame',
                        'iMouse', 'iDate', 'iChannel0', 'iChannel1', 'iChannel2', 'iChannel3',
                        'iChannelResolution']) {
      u[name] = this.gl.getUniformLocation(prog, name);
    }
    return u;
  }

  // Dry-run compile without swapping the active program.
  testCompile(userCode) {
    const gl = this.gl;
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, this._wrapSource(userCode));
    gl.compileShader(fs);
    const ok = gl.getShaderParameter(fs, gl.COMPILE_STATUS);
    const log = ok ? '' : gl.getShaderInfoLog(fs);
    gl.deleteShader(fs);
    return { ok, log };
  }

  setResolutionScale(scale) {
    this.resolutionScale = scale === 'dpr' ? (window.devicePixelRatio || 1) : parseFloat(scale);
    this._resize();
  }

  _resize() {
    const s = this.resolutionScale;
    this.canvas.width = Math.max(2, Math.round(window.innerWidth * s));
    this.canvas.height = Math.max(2, Math.round(window.innerHeight * s));
  }

  togglePlay() {
    this.playing = !this.playing;
    return this.playing;
  }

  _drawProgram(prog, u, dt) {
    const gl = this.gl;
    gl.useProgram(prog);
    gl.uniform3f(u.iResolution, this.canvas.width, this.canvas.height, 1.0);
    gl.uniform1f(u.iTime, this.time);
    gl.uniform1f(u.iTimeDelta, dt);
    gl.uniform1f(u.iFrameRate, dt > 0 ? 1 / dt : 60);
    gl.uniform1i(u.iFrame, this.frame);
    gl.uniform4f(u.iMouse, this.mouse[0], this.mouse[1], this.mouse[2], this.mouse[3]);
    const d = new Date();
    gl.uniform4f(u.iDate, d.getFullYear(), d.getMonth(), d.getDate(),
      d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000);
    if (u.iChannelResolution) {
      gl.uniform3fv(u.iChannelResolution, new Float32Array([256,256,1, 256,256,1, 256,256,1, 256,256,1]));
    }
    for (let i = 0; i < 4; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.noiseTex);
      const loc = u['iChannel' + i];
      if (loc) gl.uniform1i(loc, i);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  _loop(stamp) {
    requestAnimationFrame((t) => this._loop(t));
    const gl = this.gl;
    if (!this.program) return;

    let dt = 0;
    if (this.lastStamp !== null) dt = (stamp - this.lastStamp) / 1000;
    this.lastStamp = stamp;
    if (dt > 0.25) dt = 0.25;
    if (this.playing) this.time += dt;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    if (this.fade) {
      const k = (performance.now() - this.fade.start) / (this.fadeDuration * 1000);
      if (k >= 1) {
        gl.deleteProgram(this.fade.program);
        this.fade = null;
        this._drawProgram(this.program, this.uniforms, dt);
      } else {
        // outgoing shader renders live underneath...
        this._drawProgram(this.fade.program, this.fade.uniforms, dt);
        // ...incoming shader blends over it with an eased constant alpha
        const e = k * k * (3 - 2 * k);
        gl.enable(gl.BLEND);
        gl.blendColor(0, 0, 0, e);
        gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
        this._drawProgram(this.program, this.uniforms, dt);
        gl.disable(gl.BLEND);
      }
    } else {
      this._drawProgram(this.program, this.uniforms, dt);
    }

    if (this.playing) this.frame++;
    if (this.onTick) this.onTick(this.time);
  }
}
