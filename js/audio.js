// Audio analysis + reactive effects.
//
// One microphone / line input (or an audio file, for tuning) is analysed once per
// displayed frame (60 fps on a normal display; a 33 ms timer while hidden) into:
//   level            smoothed loudness 0..1 (fast attack, slow release)
//   bass/mid/treble  band energies 0..1, each auto-gained against its own recent peak
//   beat             1.0 on a detected kick onset, decaying back to 0 over ~0.3s
//   music            0..1 confidence that the input is music rather than speech
//   clip             true while the input is hitting the converter ceiling
//   spectrum/wave    512-entry byte rows in Shadertoy's sound-texture layout
//
// Consumers: the CSS effects on the shader (applied here), the shader uniforms +
// iAudio texture (ShaderEngine), the time warp, logo and overlay effects (app.js).
// Which of those react, and how hard, is chosen with the `fx` / `amt` tables.

class AudioReactive {
  // Every audio-driven effect, in UI order. `def` = on by default. The panel and the
  // stage remote both build their checkbox lists from this table.
  static FX = [
    { key: 'brightness', label: 'BRIGHTNESS', group: 'COMPOSITE', def: true,  hint: 'Shader brightness + saturation lift on peaks (logos unaffected)' },
    { key: 'bloom',      label: 'BLOOM',      group: 'COMPOSITE', def: true,  hint: 'Soft glow over the shader on peaks (logos unaffected)' },
    { key: 'flash',      label: 'BEAT FLASH', group: 'COMPOSITE', def: false, hint: 'Glow spikes on each beat' },
    { key: 'punch',      label: 'CONTRAST',   group: 'COMPOSITE', def: false, hint: 'Contrast rises with the level' },
    { key: 'hue',        label: 'HUE SHIFT',  group: 'COMPOSITE', def: false, hint: 'Colors rotate with the level' },
    { key: 'zoom',       label: 'BEAT ZOOM',  group: 'COMPOSITE', def: false, hint: 'Whole picture punches in on each beat and eases back' },
    { key: 'shake',      label: 'SHAKE',      group: 'COMPOSITE', def: false, hint: 'Camera knock on each beat that rings out, harder on big hits' },
    { key: 'speed',      label: 'TIME WARP',  group: 'SHADER',    def: false, hint: 'Shader time runs faster with the level' },
    // post-processing on the shader output, modelled on Procreate's Adjustments menu
    { key: 'softbloom',  label: 'SOFT BLOOM', group: 'SHADER FX', def: false, hint: 'Bright parts of the shader spill into a soft glow on peaks (Procreate Bloom)' },
    { key: 'burn',       label: 'BURN',       group: 'SHADER FX', def: false, hint: 'Highlights flare hotter and saturate, shadows deepen (Procreate Bloom → Burn)' },
    { key: 'aber',       label: 'CHROMATIC',  group: 'SHADER FX', def: false, hint: 'Red and blue planes split outward from the center on beats (Chromatic Aberration, Perspective)' },
    { key: 'glitch',     label: 'GLITCH',     group: 'SHADER FX', def: false, hint: 'Row slices shove sideways and channels split on beats (Glitch: Artifact + Diverge)' },
    { key: 'zoomblur',   label: 'ZOOM BLUR',  group: 'SHADER FX', def: false, hint: 'Streaks toward the center on beats (Perspective Blur)' },
    { key: 'ripple',     label: 'RIPPLE',     group: 'SHADER FX', def: false, hint: 'Rings warp outward from the center on beats (Liquify-style)' },
    { key: 'halftone',   label: 'HALFTONE',   group: 'SHADER FX', def: false, hint: 'Dot-screen print pattern comes up with the level (Halftone: Screen Print)' },
    { key: 'gradmap',    label: 'GRADIENT MAP', group: 'SHADER FX', def: false, hint: 'Colors remap to an ember → amber → cream ramp with the level (Gradient Map)' },
    { key: 'sharpen',    label: 'SHARPEN',    group: 'SHADER FX', def: false, hint: 'Detail crisps up with the level (Sharpen)' },
    { key: 'grain',      label: 'NOISE',      group: 'SHADER FX', def: false, hint: 'Film grain with the level (Noise)' },
    { key: 'pulse',      label: 'PULSE',      group: 'LOGO',      def: true,  hint: 'Logos swell on beats' },
    { key: 'glow',       label: 'GLOW',       group: 'LOGO',      def: false, hint: 'Warm halo around logos on beats' },
    { key: 'wobble',     label: 'WOBBLE',     group: 'LOGO',      def: false, hint: 'Logos rock with the bass' },
    { key: 'eq',         label: 'EQ BARS',    group: 'OVERLAY',   def: false, hint: 'Spectrum bars along the bottom, behind the logos' },
    { key: 'wave',       label: 'WAVEFORM',   group: 'OVERLAY',   def: false, hint: 'Oscilloscope line across the middle, behind the logos' },
  ];

  static defaultFx() {
    const fx = {};
    for (const d of AudioReactive.FX) fx[d.key] = d.def;
    return fx;
  }
  // per-effect strength multiplier, 1 = designed amount (UI shows it as 0–200%)
  static defaultAmt() {
    const amt = {};
    for (const d of AudioReactive.FX) amt[d.key] = 1;
    return amt;
  }
  // effective strength: 0 when the effect is off, else its multiplier
  k(key) {
    if (!this.fx[key]) return 0;
    const a = this.amt[key];
    return Number.isFinite(a) ? Math.max(0, a) : 1;
  }

  // filterEl: gets brightness/contrast/hue (the shader only, so logos stay clean)
  // transformEl: gets zoom/shake (the whole picture)
  // glowEl: the bloom layer, sits over the shader but under the logos
  constructor({ filterEl, transformEl, glowEl }) {
    this.filterEl = filterEl;
    this.transformEl = transformEl || filterEl;
    this.glow = glowEl;
    this.sensitivity = 5;        // multiplier on the level (SENS slider / 2; 5 = neutral in adapt mode)
    this.enabled = false;
    this.deviceId = null;        // null = system default input
    this.sourceKind = null;      // 'mic' | 'file'
    this.fileName = null;
    this.fx = AudioReactive.defaultFx();
    this.amt = AudioReactive.defaultAmt();
    this._lastFilter = '';
    this._lastTransform = '';

    // Music focus: how much reactions duck when the input sounds like speech rather
    // than music (0 = react to everything, 1 = only music). `music` is the detector's
    // confidence 0..1, `gain` the resulting multiplier on the reactions.
    this.musicFocus = 0.7;
    this.music = 0;
    this.gain = 1;
    this._beatTimes = [];

    // Smoothing 0..1: how lazily the level and bands follow the sound (attack + release),
    // and how softly beats hit. app.js also interpolates per frame using this.
    this.smooth = 0.4;
    // when true, app.js drives the composite CSS effects per frame from interpolated
    // values and the 30 Hz analyser loop leaves them alone
    this.externalDrive = false;

    // Room adaptation: normalise loudness against the loudest recent passage (so a
    // quiet soundcheck and a packed room both use the full range) and remove the
    // steady crowd-noise floor before analysis.
    this.adapt = true;
    this._peak = 0.05;
    this._rmsFloor = 0;
    this._floor = [0, 0, 0, 0, 0];
    this.clip = false;
    this._clipUntil = 0;

    this.level = 0;
    this.bass = 0;
    this.mid = 0;
    this.treble = 0;
    this.beat = 0;
    this.beatCount = 0;          // increments on every detected onset (edge trigger for animations)
    this.beatAt = 0;             // performance.now() of the last onset
    this.spectrum = new Uint8Array(512);
    this.wave = new Uint8Array(512);
    this.frame = 0;              // bumps every analysis tick — texture upload trigger
    this.onLevel = null;         // optional callback(level) for UI meters
    this.onRecording = null;     // callback(blob, log) when a recording finishes

    this.stream = null;
    this.audioCtx = null;
    this.analyser = null;
    this._fileSrc = null;
    this._freq = null;
    this._time = null;
    this._bandPeak = [0.05, 0.05, 0.05];
    this._bassHist = new Float32Array(80);   // ~1.3s of kick energy at 60 fps
    this._histIdx = 0;
    this._histFill = 0;
    this._lastBeat = 0;
    this._tick = 0;
    this._lastLoopAt = 0;
    this._rafId = 0;
    this._timerId = 0;
    this.tickHz = 0;             // measured analysis rate (for the UI / logs)

    this._rec = null;
    this._recChunks = [];
    this._recTimer = null;
    this.log = null;             // analysis log while recording
  }

  static async listInputs() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
      const all = await navigator.mediaDevices.enumerateDevices();
      return all.filter(d => d.kind === 'audioinput');
    } catch { return []; }
  }

  // ---------- sources ----------

  async start(deviceId = this.deviceId) {
    if (this.enabled) return;
    const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    if (deviceId) audio.deviceId = { exact: deviceId };
    this.stream = await navigator.mediaDevices.getUserMedia({ audio });
    this.deviceId = deviceId || null;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') await ctx.resume();
    this._attach(ctx, ctx.createMediaStreamSource(this.stream));
    this.sourceKind = 'mic';
    this.fileName = null;
  }

  // Analyse an audio file instead of the mic (loops; also plays through the speakers)
  // so the effects can be tuned against a recording made at the venue.
  async startFile(file) {
    if (this.enabled) this.stop();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') await ctx.resume();
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    this._fileSrc = src;
    this._attach(ctx, src);
    src.connect(ctx.destination);
    src.start();
    this.sourceKind = 'file';
    this.fileName = file.name;
  }

  _attach(ctx, node) {
    this.audioCtx = ctx;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.4;
    node.connect(this.analyser);
    this._freq = new Uint8Array(this.analyser.frequencyBinCount);
    this._time = new Float32Array(this.analyser.fftSize);
    this._histFill = 0;
    this._beatTimes.length = 0;
    this._peak = 0.05;
    this._rmsFloor = 0;
    this._floor.fill(0);
    this.enabled = true;
    this._lastLoopAt = 0;
    this._schedule();
  }

  // Analyse once per displayed frame (60 fps or whatever the display does); fall back
  // to a 33 ms timer while the tab is hidden so meters and the remote keep moving.
  _schedule() {
    if (!this.enabled) return;
    if (document.visibilityState === 'visible') {
      this._rafId = requestAnimationFrame(() => this._loop());
    } else {
      this._timerId = setTimeout(() => this._loop(), 33);
    }
  }

  // Switch input device, keeping the enabled state.
  async setDevice(deviceId) {
    const wasOn = this.enabled;
    if (wasOn) this.stop();
    this.deviceId = deviceId || null;
    if (wasOn) await this.start(this.deviceId);
  }

  stop() {
    this.stopRecording();
    this.enabled = false;
    cancelAnimationFrame(this._rafId);
    clearTimeout(this._timerId);
    if (this._fileSrc) { try { this._fileSrc.stop(); } catch {} this._fileSrc = null; }
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    if (this.audioCtx && this.audioCtx.state !== 'closed') this.audioCtx.close().catch(() => {});
    this.stream = null;
    this.audioCtx = null;
    this.analyser = null;
    this.sourceKind = null;
    this.fileName = null;
    this.level = this.bass = this.mid = this.treble = this.beat = 0;
    this.music = 0;
    this.gain = 1;
    this.clip = false;
    this.spectrum.fill(0);
    this.wave.fill(0);
    this.frame++;
    this._applyComposite();
    if (this.onLevel) this.onLevel(0);
  }

  // ---------- recording (for offline tuning) ----------

  get recording() { return !!this._rec; }

  // Records the raw mic audio plus the analysis log for `seconds`, then calls
  // onRecording(blob, log). Only for the mic source.
  startRecording(seconds = 45) {
    if (!this.stream || this._rec || typeof MediaRecorder === 'undefined') return false;
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', ''].find(m => !m || MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this._rec = rec;
    this._recChunks = [];
    this._lastSpectrumLog = 0;
    this.log = { startedAt: new Date().toISOString(), sampleRate: this.audioCtx.sampleRate, fftSize: this.analyser.fftSize,
                 sensitivity: this.sensitivity, musicFocus: this.musicFocus, adapt: this.adapt, deviceId: this.deviceId,
                 columns: ['t', 'rms', 'peak', 'bass', 'mid', 'treble', 'sub', 'kick', 'level', 'music', 'gain', 'beat', 'clip'],
                 ticks: [], spectra: [] };
    this._recT0 = performance.now();
    rec.ondataavailable = (e) => { if (e.data && e.data.size) this._recChunks.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(this._recChunks, { type: rec.mimeType || 'audio/webm' });
      const log = this.log;
      this._rec = null;
      this._recChunks = [];
      this.log = null;
      if (this.onRecording) this.onRecording(blob, log);
    };
    rec.start(1000);
    clearTimeout(this._recTimer);
    this._recTimer = setTimeout(() => this.stopRecording(), seconds * 1000);
    return true;
  }

  stopRecording() {
    clearTimeout(this._recTimer);
    this._recTimer = null;
    if (this._rec && this._rec.state !== 'inactive') this._rec.stop();
  }

  // ---------- analysis ----------

  _loop() {
    if (!this.enabled) return;
    this._schedule();

    const an = this.analyser;
    an.getFloatTimeDomainData(this._time);
    an.getByteFrequencyData(this._freq);
    const now = performance.now();
    this._tick++;

    // All followers below were tuned as per-tick coefficients at 33 ms. `q` rescales
    // them to the actual frame time so the feel is identical at 60 fps, 120 fps or the
    // hidden-tab timer: decay c per tick -> c^q, attack a per tick -> 1-(1-a)^q.
    const dt = this._lastLoopAt ? Math.min(0.1, Math.max(0.002, (now - this._lastLoopAt) / 1000)) : 0.033;
    this._lastLoopAt = now;
    this.tickHz = this.tickHz ? this.tickHz * 0.95 + (1 / dt) * 0.05 : 1 / dt;
    const q = dt / 0.033;
    const D = (c) => Math.pow(c, q);
    const A = (a) => 1 - Math.pow(1 - a, q);

    // ---- loudness + clipping ----
    let sum = 0, pk = 0;
    for (let i = 0; i < this._time.length; i++) {
      const v = this._time[i];
      sum += v * v;
      const av = v < 0 ? -v : v;
      if (av > pk) pk = av;
    }
    const rms = Math.sqrt(sum / this._time.length);
    if (pk > 0.985) this._clipUntil = now + 400;
    this.clip = now < this._clipUntil;

    const hz = this.audioCtx.sampleRate / an.fftSize;
    // bands: bass 30–150, mid 150–2000, treble 2000–9000, sub 30–95 (music cue), kick 30–120 (onsets)
    let bands = [this._band(30, 150, hz), this._band(150, 2000, hz), this._band(2000, 9000, hz),
                 this._band(30, 95, hz), this._band(30, 120, hz)];

    // ---- room adaptation ----
    let raw;
    if (this.adapt) {
      // steady floor (crowd chatter, HVAC): a slow-rising running minimum (settles in
      // ~40s, drops instantly in a gap), mostly removed
      this._rmsFloor = Math.min(rms, this._rmsFloor + 0.00004 * q);
      let eff = Math.max(0, rms - this._rmsFloor * 0.85);
      // normalise against the loudest recent passage (half-life ~20s): full scale =
      // recent peak, so the same slider position works at soundcheck and at midnight
      this._peak = Math.max(eff, this._peak * D(0.9988), 0.01);
      raw = Math.min(1, (eff / this._peak) * (this.sensitivity / 5));
      bands = bands.map((v, i) => {
        this._floor[i] = Math.min(v, this._floor[i] + 0.0001 * q);
        return Math.max(0, v - this._floor[i] * 0.8);
      });
    } else {
      raw = Math.min(1, rms * this.sensitivity);
    }

    // ---- music vs. speech ----
    // Two cues: sub-bass (kick / bass guitar, below most voice fundamentals) relative
    // to the mids where speech lives, and a regular pulse in the recent beats.
    // Confidence rises fast when music starts and falls slowly so breakdowns and quiet
    // passages don't drop it.
    if (raw > 0.02) {
      const ratio = bands[3] / Math.max(0.03, bands[1]);
      let evidence = Math.max(0, Math.min(1, (ratio - 0.55) / 0.5));
      const bt = this._beatTimes;
      if (bt.length >= 4 && now - bt[bt.length - 1] < 2500) {
        let mean = 0;
        for (let i = 1; i < bt.length; i++) mean += bt[i] - bt[i - 1];
        mean /= bt.length - 1;
        let vr = 0;
        for (let i = 1; i < bt.length; i++) vr += ((bt[i] - bt[i - 1]) - mean) ** 2;
        const cv = Math.sqrt(vr / (bt.length - 1)) / mean;
        const bpm = 60000 / mean;
        if (cv < 0.3 && bpm > 55 && bpm < 210) evidence = Math.max(evidence, 0.85);
      }
      this.music += (evidence - this.music) * A(evidence > this.music ? 0.12 : 0.035);
    } else {
      this.music *= D(0.999);   // silence: hold, drift down very slowly
    }
    this.gain = 1 - this.musicFocus * (1 - this.music);
    const instant = raw * this.gain;

    // attack / release follower: punchy at low smoothing, lazy at high
    const s = Math.max(0, Math.min(1, this.smooth));
    const atk = 0.55 - 0.43 * s;          // 0.55 → 0.12 per 33ms
    const rel = 0.92 + 0.065 * s;         // 0.92 → 0.985 per 33ms (~0.4s → ~2s tail)
    this.level = instant > this.level
      ? this.level + (instant - this.level) * A(atk)
      : this.level * D(rel);

    // ---- bands ----
    // Auto-gained against a slowly decaying peak so they read the same at a quiet
    // soundcheck and in a packed room. Gated by loudness so silence stays still
    // instead of amplifying the noise floor.
    const gate = Math.min(1, instant * 4);
    const out = [0, 1, 2].map((i) => {
      this._bandPeak[i] = Math.max(bands[i], this._bandPeak[i] * D(0.996), 0.05);
      return Math.min(1, bands[i] / this._bandPeak[i]) * gate;
    });
    this.bass = this._follow(this.bass, out[0], s, q);
    this.mid = this._follow(this.mid, out[1], s, q);
    this.treble = this._follow(this.treble, out[2], s, q);

    // ---- beat: kick-range energy jumping above its recent average ----
    const kick = bands[4];
    const h = this._bassHist;
    h[this._histIdx] = kick;
    this._histIdx = (this._histIdx + 1) % h.length;
    this._histFill = Math.min(h.length, this._histFill + 1);
    let mean = 0;
    for (let i = 0; i < this._histFill; i++) mean += h[i];
    mean /= this._histFill;
    let vr = 0;
    for (let i = 0; i < this._histFill; i++) vr += (h[i] - mean) * (h[i] - mean);
    const sd = Math.sqrt(vr / this._histFill);
    // onsets are tracked from the ungated signal so the rhythm cue above can still
    // recognise music while reactions are ducked; the visible beat only fires when
    // the reactions are (mostly) open
    const onset = raw * 4 > 0.3 && this._histFill > 10 &&
      kick > mean + Math.max(0.05, 1.4 * sd) && kick > mean * 1.12 &&
      now - this._lastBeat > 200;
    if (onset) {
      this._lastBeat = now;
      this._beatTimes.push(now);
      if (this._beatTimes.length > 8) this._beatTimes.shift();
    }
    if (onset && this.gain > 0.4) {
      this.beat = 1;
      this.beatCount++;
      this.beatAt = now;
    } else {
      this.beat *= D(0.86);
    }

    // ---- Shadertoy sound texture ----
    // row 0 = spectrum (first 512 bins, roughly 0–11 kHz), row 1 = waveform
    this.spectrum.set(this._freq.subarray(0, 512));
    const step = this._time.length / 512;
    for (let i = 0; i < 512; i++) {
      const v = (this._time[Math.floor(i * step)] * 0.5 + 0.5) * 255;
      this.wave[i] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
    }
    this.frame++;

    // ---- analysis log (while recording) ----
    if (this.log) {
      const t = (now - this._recT0) / 1000;
      const r3 = (v) => Math.round(v * 1000) / 1000;
      this.log.ticks.push([r3(t), r3(rms), r3(pk), r3(bands[0]), r3(bands[1]), r3(bands[2]), r3(bands[3]), r3(bands[4]),
                           r3(this.level), r3(this.music), r3(this.gain), onset ? 1 : 0, this.clip ? 1 : 0]);
      // spectrum snapshot ~3x a second regardless of frame rate
      if (!this._lastSpectrumLog || now - this._lastSpectrumLog > 330) {
        this._lastSpectrumLog = now;
        this.log.spectra.push([r3(t), Array.from(this._freq.subarray(0, 512))]);
      }
    }

    if (!this.externalDrive) this._applyComposite();
    if (this.onLevel) this.onLevel(this.level);
  }

  _band(lo, hi, hz) {
    const a = Math.max(1, Math.floor(lo / hz));
    const b = Math.min(this._freq.length, Math.ceil(hi / hz));
    if (b <= a) return 0;
    let s = 0;
    for (let i = a; i < b; i++) s += this._freq[i];
    return s / ((b - a) * 255);
  }

  _follow(cur, target, s = 0, q = 1) {
    const atk = 0.6 - 0.45 * s, rel = 0.86 + 0.11 * s;
    return target > cur ? cur + (target - cur) * (1 - Math.pow(1 - atk, q)) : cur * Math.pow(rel, q);
  }

  // ---------- effects ----------

  // Whole-composite effects (CSS on the shader wrapper + the bloom layer). Shader, logo
  // and overlay effects are applied per frame by app.js from the same numbers.
  // lv / bt default to the analyser's own values; app.js passes per-frame interpolated ones
  _applyComposite(lvIn = this.level, btIn = this.beat) {
    const lv = this.enabled ? lvIn : 0;
    const bt = this.enabled ? btIn : 0;
    const active = lv > 0.003;
    const k = (key) => (this.enabled ? this.k(key) : 0);
    // brightness-type effects ride a curved level so quiet and mid-level passages barely
    // lift and only real peaks push the picture — keeps a busy room from washing out
    const lvc = Math.pow(lv, 1.6);

    // color filters (shader only)
    const f = [];
    const kb = k('brightness'), kp = k('punch'), kh = k('hue');
    if (active && kb) f.push(`brightness(${(1 + lvc * 0.5 * kb).toFixed(3)}) saturate(${(1 + lvc * 0.3 * kb).toFixed(3)})`);
    if (active && kp) f.push(`contrast(${(1 + lvc * 0.35 * kp).toFixed(3)})`);
    if (active && kh) f.push(`hue-rotate(${(lv * 40 * kh).toFixed(1)}deg)`);
    const filter = f.join(' ');
    if (filter !== this._lastFilter) {
      this.filterEl.style.filter = filter;
      this._lastFilter = filter;
    }

    // bloom / flash share the glow layer: take the stronger
    let glow = Math.max(lvc * 0.5 * k('bloom'), bt * 0.55 * k('flash'));
    glow = Math.min(1, glow);
    this.glow.style.opacity = glow < 0.003 ? '0' : glow.toFixed(3);

    // zoom / shake are animated per frame by app.js via applyTransform(); when the
    // analyser is off make sure nothing is left applied
    if (!this.enabled) this.applyTransform(1, 0, 0);
  }

  // Whole-picture transform (zoom + shake). Scales just enough that a shake offset
  // never exposes the edges of the picture.
  applyTransform(zoom, sx, sy) {
    if (sx || sy) {
      const w = window.innerWidth || 1, h = window.innerHeight || 1;
      zoom = Math.max(zoom, 1 + 2.2 * Math.max(Math.abs(sx) / w, Math.abs(sy) / h));
    }
    const transform = (Math.abs(zoom - 1) > 0.0004 || Math.abs(sx) > 0.05 || Math.abs(sy) > 0.05)
      ? `translate(${sx.toFixed(2)}px, ${sy.toFixed(2)}px) scale(${zoom.toFixed(4)})`
      : '';
    if (transform !== this._lastTransform) {
      this.transformEl.style.transform = transform;
      this._lastTransform = transform;
    }
  }
}
