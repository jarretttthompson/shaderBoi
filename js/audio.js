// Audio-reactive brightness/bloom: microphone level drives a filter on the
// whole composite (shader + logo layers) plus a screen-blended glow.

class AudioReactive {
  constructor(targetEl, glowEl) {
    this.target = targetEl;
    this.glow = glowEl;
    this.sensitivity = 5;   // multiplier applied to the RMS level
    this.enabled = false;
    this.level = 0;         // smoothed 0..1
    this.stream = null;
    this.audioCtx = null;
    this.analyser = null;
    this.buf = null;
    this.onLevel = null;    // optional callback(level) for UI meters
  }

  async start() {
    if (this.enabled) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.audioCtx.state === 'suspended') await this.audioCtx.resume();
    const source = this.audioCtx.createMediaStreamSource(this.stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 1024;
    source.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    this.enabled = true;
    this._loop();
  }

  stop() {
    this.enabled = false;
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    if (this.audioCtx) this.audioCtx.close().catch(() => {});
    this.stream = null;
    this.audioCtx = null;
    this.analyser = null;
    this.level = 0;
    this._apply(0);
  }

  _loop() {
    if (!this.enabled) return;
    // timer instead of rAF so level tracking survives an obscured/backgrounded window
    setTimeout(() => this._loop(), 33);

    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(sum / this.buf.length);

    const instant = Math.min(1, rms * this.sensitivity);
    // fast attack, slow release — punchy on beats, smooth decay
    this.level = instant > this.level
      ? this.level + (instant - this.level) * 0.55
      : this.level * 0.92;

    this._apply(this.level);
    if (this.onLevel) this.onLevel(this.level);
  }

  _apply(v) {
    if (v < 0.003) {
      this.target.style.filter = '';
      this.glow.style.opacity = '0';
      return;
    }
    this.target.style.filter =
      `brightness(${(1 + v * 0.85).toFixed(3)}) saturate(${(1 + v * 0.45).toFixed(3)})`;
    this.glow.style.opacity = (v * 0.75).toFixed(3);
  }
}
