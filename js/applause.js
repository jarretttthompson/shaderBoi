// Applause-o-meter — a crowd-loudness meter for contests (costume contest, dance-off…).
//
// It reads the RAW microphone loudness above 400 Hz (AudioReactive.crowdRms, taken before room
// adaptation and music focus, so a band's kick and bass count for little) and maps it onto a
// FIXED dB scale, so every contestant is measured the same way however the night has gone so
// far. HEADROOM compresses the top of the scale so a screaming room separates instead of
// pinning at 100. On screen: a big LED ladder with a peak hold, a huge score, and the mark to
// beat. MEASURE runs a timed round — the loudest moment of the round locks in as that
// contestant's score and joins the list.
//
// The controls live in app.js (panel section, top bar button, keys A / M / C, the stage
// remote). This class only measures and draws.

class ApplauseMeter {
  static THEMES = {
    halloween: {
      title: '#f6e7c8', text: 'rgba(246, 231, 200, 0.78)',
      low: '#ff7a1a', high: '#9dff3c', hot: '#ff4a2a',
      dim: 'rgba(255, 180, 110, 0.10)', frame: 'rgba(246, 231, 200, 0.30)',
      marker: '#f6e7c8', beat: '#c48cff', locked: '#9dff3c', warn: '#ff4a2a',
      glow: 'rgba(255, 122, 26, 0.75)',
    },
    amber: {
      title: '#fff0d6', text: 'rgba(255, 240, 214, 0.78)',
      low: '#ff9a3c', high: '#ffe08a', hot: '#ff5a3c',
      dim: 'rgba(255, 200, 140, 0.10)', frame: 'rgba(255, 240, 214, 0.30)',
      marker: '#fff0d6', beat: '#ffd27a', locked: '#ffe08a', warn: '#ff5a3c',
      glow: 'rgba(255, 154, 60, 0.75)',
    },
  };

  constructor(canvas, audio) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.audio = audio;
    this.on = false;
    this.range = 50;        // 0..100: how loud the room must be to read 100 (higher = easier)
    this.roundSec = 6;      // seconds a MEASURE round listens before the score locks
    this.headroom = 12;     // dB above the RANGE ceiling that still raise the score, compressed (0 = hard top)
    this.theme = 'halloween';
    this.live = 0;          // bar level 0..1 (fast attack, moderate release)
    this.slow = 0;          // ~120 ms follower the peaks are taken from (ignores one-frame spikes)
    this.hold = 0;          // idle peak hold
    this.holdAt = 0;
    this.round = null;      // { start, end, peak, locked, score, newBest, lockedAt }
    this.rounds = [];       // locked scores, in contest order
    this.db = -100;         // last crowd-band loudness in dBFS (shown to the operator)
    this.clip = false;      // the converter is clipping (raw samples at full scale) — a hardware limit
    this._clipHintUntil = 0;
    this.onChange = null;   // callback when the on/round state changes (start, lock, clear)
    this._size = [0, 0, 0];
    this._lastAt = 0;
  }

  // ---- scale ----
  // The dBFS of the RANGE ceiling. RANGE 50 = -14 dBFS, about a big cheer near a MacBook mic at
  // the default input level; a lower RANGE needs a louder room, a higher one makes it easier.
  // 0 sits 36 dB under the ceiling. Both are fixed for the contest — no auto-gain. With HEADROOM
  // at 0 the ceiling reads 100; otherwise the top of the scale is compressed (see _score).
  get ceilingDb() { return Math.max(-30, Math.min(-1, -14 + (50 - this.range) * 0.3)); }
  get floorDb() { return this.ceilingDb - 36; }
  static KNEE = 0.75;     // compression starts at 75 points
  // the compressor above the knee: the 9 dB from the knee to the ceiling plus HEADROOM dB are
  // squeezed into the last 25 points, so a room louder than the calibration still separates
  get ratio() { const top = (1 - ApplauseMeter.KNEE) * (this.ceilingDb - this.floorDb); return (top + this.headroom) / top; }
  get kneeDb() { return this.floorDb + ApplauseMeter.KNEE * (this.ceilingDb - this.floorDb); }
  get topDb() { return this.ceilingDb + this.headroom; }   // the dBFS that reads 100
  // score 0..1 for a crowd loudness in dBFS: linear in dB up to the knee, compressed above it
  _score(db) {
    const K = ApplauseMeter.KNEE;
    const lin = (db - this.floorDb) / (this.ceilingDb - this.floorDb);
    if (lin <= K) return Math.max(0, lin);
    return Math.min(1, K + (lin - K) / this.ratio);
  }
  get best() { return this.rounds.length ? Math.max(...this.rounds) : 0; }
  get measuring() { return !!(this.round && !this.round.locked); }
  get locked() { return !!(this.round && this.round.locked); }
  // the number on screen: the running peak while measuring, the locked score after, live otherwise
  get score() {
    if (this.round) return this.round.locked ? this.round.score : Math.round(this.round.peak * 100);
    return Math.round(this.live * 100);
  }
  get remaining() { return this.measuring ? Math.max(0, (this.round.end - performance.now()) / 1000) : 0; }

  settings() { return { range: this.range, roundSec: this.roundSec, headroom: this.headroom, theme: this.theme }; }
  applySettings(s) {
    if (!s) return;
    if (Number.isFinite(s.range)) this.range = Math.max(0, Math.min(100, Math.round(s.range)));
    if (Number.isFinite(s.roundSec)) this.roundSec = Math.max(3, Math.min(12, Math.round(s.roundSec)));
    if (Number.isFinite(s.headroom)) this.headroom = Math.max(0, Math.min(30, Math.round(s.headroom)));
    if (typeof s.theme === 'string' && ApplauseMeter.THEMES[s.theme]) this.theme = s.theme;
  }

  setOn(on) {
    this.on = !!on;
    this.canvas.classList.toggle('hidden', !this.on);
    if (!this.on) { this.live = this.slow = this.hold = 0; }
    this._lastAt = 0;
    if (this.onChange) this.onChange();
  }

  // Start a timed round. The scores list and the mark to beat are kept.
  startRound(now = performance.now()) {
    if (!this.on || this.measuring) return false;
    this.round = { start: now, end: now + this.roundSec * 1000, peak: 0, locked: false, score: 0, newBest: false, lockedAt: 0, clipped: false };
    if (this.onChange) this.onChange();
    return true;
  }

  // Forget every score — a new contest.
  clearContest() {
    this.rounds = [];
    this.round = null;
    this.hold = 0;
    if (this.onChange) this.onChange();
  }

  // ---- measurement ----
  // Called once per analysis tick (app.js hooks it to the analyser, which keeps running on a
  // timer while the tab is hidden) and from the render loop while the mic is off, so the
  // followers settle. Keeps its own clock, so any caller cadence works.
  tick(now = performance.now()) {
    // dt is allowed up to 0.5 s so a throttled tab (1 Hz ticks) still lets the followers settle
    const dt = this._lastAt ? Math.min(0.5, Math.max(0.001, (now - this._lastAt) / 1000)) : 0.016;
    this._lastAt = now;
    const a = this.audio;
    const mic = !!(a && a.enabled);
    // the crowd band (above 400 Hz) when the analyser provides it, full-band RMS otherwise
    const rms = mic ? (Number.isFinite(a.crowdRms) ? a.crowdRms : (a.rms || 0)) : 0;
    this.db = 20 * Math.log10(Math.max(rms, 1e-5));
    const target = mic ? this._score(this.db) : 0;
    this.clip = mic && !!a.clip;
    if (this.clip) this._clipHintUntil = now + 4000;
    const ap = (cur, t, tau) => cur + (t - cur) * (1 - Math.exp(-dt / tau));
    this.live = ap(this.live, target, target > this.live ? 0.04 : 0.3);
    this.slow = ap(this.slow, target, 0.12);

    const r = this.round;
    if (r && !r.locked) {
      // lock first, so a late tick (throttled tab) never adds a sample from after the round
      if (now >= r.end) {
        r.locked = true;
        r.lockedAt = now;
        r.score = Math.round(r.peak * 100);
        r.newBest = this.rounds.length > 0 && r.score > this.best;   // judged against earlier rounds
        this.rounds.push(r.score);
        if (this.onChange) this.onChange();
      } else {
        if (this.slow > r.peak) r.peak = this.slow;
        if (this.clip) r.clipped = true;
      }
    } else {
      // idle peak hold: sits for 1.2 s, then falls
      if (this.slow >= this.hold) { this.hold = this.slow; this.holdAt = now; }
      else if (now - this.holdAt > 1200) this.hold = Math.max(this.slow, this.hold - dt * 0.35);
    }
  }

  // ---- drawing ----
  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const W = window.innerWidth, H = window.innerHeight;
    if (this._size[0] === W && this._size[1] === H && this._size[2] === dpr) return;
    this._size = [W, H, dpr];
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
  }

  draw(now) {
    if (!this.on) return;
    this._resize();
    const [W, H, dpr] = this._size;
    const ctx = this.ctx;
    const T = ApplauseMeter.THEMES[this.theme] || ApplauseMeter.THEMES.halloween;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const stage = document.body.classList.contains('stage');
    const mono = '"Vulf Mono", monospace';
    // layout unit: 1 at 1080p, scales with the display (16:9 fit)
    const u = Math.min(H, W * 0.5625) / 1080;
    const mic = !!(this.audio && this.audio.enabled);
    const r = this.round;
    const measuring = !!(r && !r.locked), locked = !!(r && r.locked);

    // vertical layout: the meter owns the upper half of the display (app.js shrinks the logo
    // composition into the lower half), so a drum kit in front of the screen hides nothing
    const Y = { fade0: 0.60, fade1: 0.38, title: 0.085, score: 0.205, status: 0.305, ladder: 0.34, rounds: 0.495 };

    // a soft dark band behind the meter so it reads on bright shaders
    const band = ctx.createLinearGradient(0, H * Y.fade0, 0, H * Y.fade1);
    band.addColorStop(0, 'rgba(0, 0, 0, 0)');
    band.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, W, H * Y.fade0);

    // title
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(34 * u)}px ${mono}`;
    ctx.fillStyle = T.title;
    ctx.shadowColor = T.glow;
    ctx.shadowBlur = 24 * u;
    this._spaced(ctx, 'APPLAUSE-O-METER', W / 2, H * Y.title, 0.28);
    ctx.shadowBlur = 0;

    // the score
    const level = measuring ? r.peak : locked ? r.score / 100 : this.live;
    let scoreColor = this._ramp(T, level);
    if (locked) scoreColor = r.newBest ? T.locked : T.title;
    ctx.font = `700 ${Math.round(200 * u)}px ${mono}`;
    ctx.fillStyle = scoreColor;
    ctx.shadowColor = scoreColor;
    ctx.shadowBlur = 40 * u;
    ctx.fillText(String(this.score), W / 2, H * Y.score);
    ctx.shadowBlur = 0;

    // status line under the score
    let status = '', statusColor = T.text;
    if (!mic) { status = 'MIC OFF — TURN THE MIC ON'; statusColor = T.warn; }
    else if (measuring) { status = 'MAKE SOME NOISE   ' + this.remaining.toFixed(1) + 's'; statusColor = T.title; }
    else if (locked) { status = r.newBest ? 'NEW HIGH SCORE' : 'LOCKED IN'; statusColor = r.newBest ? T.locked : T.text; }
    else if (this.rounds.length) status = this.rounds.length + ' SCORED   ·   HIGH ' + this.best;
    if (status) {
      ctx.font = `700 ${Math.round(22 * u)}px ${mono}`;
      ctx.fillStyle = statusColor;
      this._spaced(ctx, status, W / 2, H * Y.status, 0.22);
    }

    // LED ladder
    const x0 = W * 0.08, x1 = W * 0.92, y = H * Y.ladder, h = H * 0.07;
    const N = 40, slot = (x1 - x0) / N, gap = slot * 0.28, segW = slot - gap;
    const rad = Math.min(6 * u, segW / 2);
    for (let i = 0; i < N; i++) {
      const f = (i + 0.5) / N;
      const lit = f <= this.live;
      const x = x0 + i * slot + gap / 2;
      ctx.fillStyle = lit ? this._ramp(T, f) : T.dim;
      ctx.shadowBlur = lit ? 14 * u : 0;
      ctx.shadowColor = lit ? ctx.fillStyle : 'transparent';
      this._rrect(ctx, x, y, segW, h, rad);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.strokeStyle = T.frame;
    ctx.lineWidth = 1.5 * u;
    this._rrect(ctx, x0 - 10 * u, y - 10 * u, (x1 - x0) + 20 * u, h + 20 * u, 10 * u);
    ctx.stroke();

    // converter clipping: a red tag beside the ladder — the reading is capped by the hardware
    // and only a lower input volume helps
    if (this.clip) {
      ctx.font = `700 ${Math.round(18 * u)}px ${mono}`;
      ctx.fillStyle = T.warn;
      ctx.shadowColor = T.warn;
      ctx.shadowBlur = 14 * u;
      ctx.textAlign = 'left';
      ctx.fillText('CLIP', x1 + 22 * u, y + h / 2);
      ctx.textAlign = 'center';
      ctx.shadowBlur = 0;
    }

    // peak marker: the round's peak while measuring / locked, the idle hold otherwise
    const peak = r ? r.peak : this.hold;
    if (peak > 0.005) {
      const px = x0 + (x1 - x0) * peak;
      ctx.fillStyle = T.marker;
      ctx.shadowColor = T.marker;
      ctx.shadowBlur = 16 * u;
      ctx.fillRect(px - 2.5 * u, y - 16 * u, 5 * u, h + 32 * u);
      ctx.shadowBlur = 0;
    }

    // the mark to beat (best locked score so far)
    const best = this.best;
    if (best > 0) {
      const bx = x0 + (x1 - x0) * best / 100;
      ctx.strokeStyle = T.beat;
      ctx.lineWidth = 2 * u;
      ctx.setLineDash([6 * u, 5 * u]);
      ctx.beginPath();
      ctx.moveTo(bx, y - 34 * u);
      ctx.lineTo(bx, y + h + 34 * u);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `700 ${Math.round(18 * u)}px ${mono}`;
      ctx.fillStyle = T.beat;
      const right = bx > W * 0.5;
      ctx.textAlign = right ? 'right' : 'left';
      const label = (locked && r.score === best) ? 'HIGH ' + best : 'TO BEAT ' + best;
      ctx.fillText(label, bx + (right ? -8 : 8) * u, y + h + 48 * u);
      ctx.textAlign = 'center';
    }

    // round timer under the ladder
    if (measuring) {
      const frac = Math.max(0, Math.min(1, (r.end - now) / (r.end - r.start)));
      const ty = y + h + 20 * u, th = 6 * u;
      ctx.fillStyle = T.dim;
      this._rrect(ctx, x0, ty, x1 - x0, th, th / 2);
      ctx.fill();
      ctx.fillStyle = T.title;
      ctx.shadowColor = T.glow;
      ctx.shadowBlur = 10 * u;
      this._rrect(ctx, x0, ty, (x1 - x0) * frac, th, th / 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // scores so far
    if (this.rounds.length) {
      ctx.font = `400 ${Math.round(20 * u)}px ${mono}`;
      const shown = this.rounds.slice(-10), off = this.rounds.length - shown.length;
      ctx.fillStyle = T.text;
      ctx.fillText(shown.map((s, i) => '#' + (off + i + 1) + ' ' + s).join('     '), W / 2, H * Y.rounds);
    }

    // operator hints — never on the stage display
    if (!stage) {
      ctx.font = `400 ${Math.round(13 * u)}px ${mono}`;
      ctx.fillStyle = T.text;
      let hint = 'A  METER      M  MEASURE      C  NEW CONTEST      crowd ' + this.db.toFixed(0) + ' dBFS   (75 at ' +
        this.kneeDb.toFixed(0) + ', 100 at ' + this.topDb.toFixed(0) + ')';
      if (now < this._clipHintUntil) {
        hint = 'INPUT CLIPPING — lower the input volume in System Settings › Sound › Input (RANGE and HEADROOM cannot fix this)';
        ctx.fillStyle = T.warn;
      }
      ctx.fillText(hint, W / 2, H - 14);
    }
  }

  // ---- helpers ----
  static _hex(c) {
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // ladder colour by position: low → high across the bar, the top segments run hot
  _ramp(T, f) {
    const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
    const lo = ApplauseMeter._hex(T.low), hi = ApplauseMeter._hex(T.high), hot = ApplauseMeter._hex(T.hot);
    let c;
    if (f < 0.55) c = lo;
    else if (f < 0.85) c = mix(lo, hi, (f - 0.55) / 0.3);
    else c = mix(hi, hot, Math.min(1, (f - 0.85) / 0.15));
    return 'rgb(' + c[0] + ', ' + c[1] + ', ' + c[2] + ')';
  }

  // letter-spaced centred text (canvas letterSpacing is not everywhere yet)
  _spaced(ctx, text, cx, cy, em) {
    const m = ctx.font.match(/(\d+(?:\.\d+)?)px/);
    const sp = em * (m ? parseFloat(m[1]) : 16);
    const chars = [...text];
    const widths = chars.map(ch => ctx.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + sp * (chars.length - 1);
    const align = ctx.textAlign;
    ctx.textAlign = 'left';
    let x = cx - total / 2;
    chars.forEach((ch, i) => { ctx.fillText(ch, x, cy); x += widths[i] + sp; });
    ctx.textAlign = align;
  }

  _rrect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
