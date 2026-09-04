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
    this.timeScale = 1;         // >1 = audio time warp (app.js drives this)
    this.audio = null;          // AudioReactive instance feeding iAudio* uniforms
    this._audioFrame = -1;
    // post-processing amounts 0..1 (app.js drives these per frame); all 0 = pass skipped
    this.post = { burn: 0, softbloom: 0, aber: 0, glitch: 0, halftone: 0, grain: 0,
                  zoomblur: 0, sharpen: 0, gradmap: 0, ripple: 0 };

    this._initGeometry();
    this._initChannels();
    this._initPost();
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

    // Sound texture in Shadertoy's layout: 512x2, row 0 = spectrum, row 1 = waveform,
    // single red channel (read it with .x). Exposed to shaders as `iAudio`.
    this._audioBuf = new Uint8Array(512 * 2);
    this.audioTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.audioTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 512, 2, 0, gl.RED, gl.UNSIGNED_BYTE, this._audioBuf);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  // ---------- post-processing (Procreate-style adjustments on the shader output) ----------

  static POST_KEYS = ['burn', 'softbloom', 'aber', 'glitch', 'halftone', 'grain', 'zoomblur', 'sharpen', 'gradmap', 'ripple'];

  _initPost() {
    const gl = this.gl;
    this.sceneTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.sceneFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._sceneSize = [0, 0];

    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, ShaderEngine.POST_SOURCE);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      console.error('post shader failed:', gl.getShaderInfoLog(fs));
      this.postProgram = null;
      return;
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, this.vertShader);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('post program failed:', gl.getProgramInfoLog(prog));
      this.postProgram = null;
      return;
    }
    this.postProgram = prog;
    this.postU = {};
    for (const n of ['uTex', 'uRes', 'uTime', ...ShaderEngine.POST_KEYS.map(k => 'u_' + k)]) {
      this.postU[n] = gl.getUniformLocation(prog, n);
    }
  }

  _postActive() {
    if (!this.postProgram) return false;
    for (const k of ShaderEngine.POST_KEYS) if (this.post[k] > 0.001) return true;
    return false;
  }

  _ensureSceneTarget() {
    const w = this.canvas.width, h = this.canvas.height;
    if (this._sceneSize[0] === w && this._sceneSize[1] === h) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this._sceneSize = [w, h];
  }

  _drawPost() {
    const gl = this.gl, u = this.postU;
    gl.useProgram(this.postProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.uniform1i(u.uTex, 0);
    gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uTime, performance.now() / 1000);
    for (const k of ShaderEngine.POST_KEYS) gl.uniform1f(u['u_' + k], Math.min(1, Math.max(0, this.post[k] || 0)));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // Attach the analyser whose level/bands/beat/spectrum drive the audio uniforms.
  setAudio(audio) { this.audio = audio; }

  _syncAudioTexture() {
    const a = this.audio;
    if (!a) return;
    const frame = a.enabled ? a.frame : -2;     // when off, upload zeros once
    if (frame === this._audioFrame) return;
    this._audioFrame = frame;
    if (a.enabled) {
      this._audioBuf.set(a.spectrum, 0);
      this._audioBuf.set(a.wave, 512);
    } else {
      this._audioBuf.fill(0);
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.audioTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 512, 2, gl.RED, gl.UNSIGNED_BYTE, this._audioBuf);
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
// shaderBoi audio inputs (all 0 when the mic is off)
uniform sampler2D iAudio;        // 512x2: row 0 spectrum, row 1 waveform (.x)
uniform float iAudioLevel;       // smoothed loudness 0..1
uniform float iBass;             // band energies 0..1
uniform float iMid;
uniform float iTreble;
uniform float iBeat;             // 1 on a bass onset, decays to 0
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
                        'iChannelResolution',
                        'iAudio', 'iAudioLevel', 'iBass', 'iMid', 'iTreble', 'iBeat']) {
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
    // audio (uniform calls on a null location are ignored, so unused inputs cost nothing)
    const a = this.audio && this.audio.enabled ? this.audio : null;
    gl.uniform1f(u.iAudioLevel, a ? a.level : 0);
    gl.uniform1f(u.iBass, a ? a.bass : 0);
    gl.uniform1f(u.iMid, a ? a.mid : 0);
    gl.uniform1f(u.iTreble, a ? a.treble : 0);
    gl.uniform1f(u.iBeat, a ? a.beat : 0);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.audioTex);
    if (u.iAudio) gl.uniform1i(u.iAudio, 4);
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
    if (this.playing) this.time += dt * this.timeScale;

    this._syncAudioTexture();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    // with any post effect active the scene renders to a texture first, then the
    // post pass draws it to the screen
    const post = this._postActive();
    if (post) {
      this._ensureSceneTarget();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    }
    this._drawScene(dt);
    if (post) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this._drawPost();
    }

    if (this.playing) this.frame++;
    if (this.onTick) this.onTick(this.time);
  }

  _drawScene(dt) {
    const gl = this.gl;
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
  }
}

// Post-processing pass. Each effect is gated by its amount so unused ones cost nothing.
// Modelled on Procreate's Adjustments: Bloom (+ its Burn slider), Glitch, Halftone,
// Chromatic Aberration (Perspective), Noise, Sharpen, Perspective Blur, Gradient Map, Liquify.
ShaderEngine.POST_SOURCE = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform float uTime;
uniform float u_burn, u_softbloom, u_aber, u_glitch, u_halftone, u_grain, u_zoomblur, u_sharpen, u_gradmap, u_ripple;
out vec4 outColor;

float h11(float p){ return fract(sin(p * 127.1) * 43758.5453); }
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 scene(vec2 uv){ return texture(uTex, clamp(uv, vec2(0.001), vec2(0.999))).rgb; }

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 c = uv - 0.5;
  float aspect = uRes.x / uRes.y;
  float r = length(vec2(c.x * aspect, c.y));

  // RIPPLE (Liquify-style): rings warp outward from the center
  if (u_ripple > 0.001) {
    float w = sin(r * 40.0 - uTime * 9.0) * 0.012 * u_ripple * smoothstep(0.0, 0.25, r);
    uv += normalize(c + 1e-5) * w;
  }
  // GLITCH (Artifact + Signal): row slices shove sideways, refreshed ~24x a second, odd frame rolls
  if (u_glitch > 0.001) {
    float rows = 14.0 + 26.0 * u_glitch;
    float row = floor(uv.y * rows);
    float t = floor(uTime * 24.0);
    float s = h21(vec2(row, t));
    if (s > 1.0 - 0.4 * u_glitch) uv.x += (h11(s * 7.0 + t) - 0.5) * 0.14 * u_glitch;
    if (h11(t) > 1.0 - 0.15 * u_glitch) uv.y = fract(uv.y + 0.05 * u_glitch);
  }

  vec3 col;
  // PERSPECTIVE (zoom) BLUR: samples streak toward the center
  if (u_zoomblur > 0.001) {
    col = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      float k = 1.0 - float(i) / 8.0 * 0.14 * u_zoomblur;
      col += scene(0.5 + (uv - 0.5) * k);
    }
    col /= 8.0;
  } else {
    col = scene(uv);
  }

  // CHROMATIC ABERRATION (Perspective mode: radial from the focal point); glitch adds a Diverge split
  float ab = u_aber * 0.014 + u_glitch * 0.005;
  if (ab > 0.0001) {
    vec2 d = c * ab * (0.5 + r);
    col.r = scene(uv + d).r;
    col.b = scene(uv - d).b;
  }

  // SHARPEN: unsharp mask
  if (u_sharpen > 0.001) {
    vec2 px = 1.0 / uRes;
    vec3 blur = (scene(uv + vec2(px.x, 0.0)) + scene(uv - vec2(px.x, 0.0)) +
                 scene(uv + vec2(0.0, px.y)) + scene(uv - vec2(0.0, px.y))) * 0.25;
    col += (col - blur) * 1.6 * u_sharpen;
  }

  // SOFT BLOOM (Bloom): bright parts spill into a glow — threshold + 12-tap spiral blur
  if (u_softbloom > 0.001) {
    vec3 acc = vec3(0.0);
    float rad = 0.012 + 0.03 * u_softbloom;
    for (int i = 0; i < 12; i++) {
      float a = float(i) * 2.399963;
      float rr = sqrt(float(i) + 0.5) / sqrt(12.0) * rad;
      vec3 s = scene(uv + vec2(cos(a), sin(a) * aspect) * rr);
      acc += max(s - 0.45, 0.0);
    }
    col += acc / 12.0 * 1.8 * u_softbloom;
  }

  // BURN (Bloom's Burn slider): highlights flare hotter and saturate, shadows deepen a touch
  if (u_burn > 0.001) {
    float l = luma(col);
    float hi = smoothstep(0.35, 0.95, l);
    vec3 warm = vec3(1.0, 0.72, 0.42);
    col += hi * hi * warm * 0.9 * u_burn;
    col = mix(col, col * col * 1.15, (1.0 - hi) * 0.5 * u_burn);
  }

  // GRADIENT MAP: luminance remapped through an ember -> amber -> cream ramp
  if (u_gradmap > 0.001) {
    float l = clamp(luma(col), 0.0, 1.0);
    vec3 g = l < 0.5 ? mix(vec3(0.04, 0.01, 0.03), vec3(0.85, 0.36, 0.08), l * 2.0)
                     : mix(vec3(0.85, 0.36, 0.08), vec3(1.0, 0.93, 0.74), (l - 0.5) * 2.0);
    col = mix(col, g, u_gradmap);
  }

  // HALFTONE (Screen Print): dot screen sized by luminance
  if (u_halftone > 0.001) {
    float cell = 8.0;
    vec2 p = mod(gl_FragCoord.xy, cell) - cell * 0.5;
    float l = luma(col);
    float rad = sqrt(l) * cell * 0.62;
    float dotv = 1.0 - smoothstep(rad - 0.9, rad + 0.9, length(p));
    col = mix(col, col * (0.25 + 0.75 * dotv), u_halftone);
  }

  // NOISE: film grain
  if (u_grain > 0.001) {
    float g = h21(gl_FragCoord.xy + fract(uTime) * 917.0) - 0.5;
    col += g * 0.28 * u_grain;
  }

  outColor = vec4(col, 1.0);
}`;
