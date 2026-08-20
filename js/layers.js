// Logo/image layer system: processing pipeline + overlay canvas rendering + pointer interaction.

class LayerManager {
  constructor(overlayCanvas, store) {
    this.canvas = overlayCanvas;
    this.ctx = overlayCanvas.getContext('2d');
    this.store = store || null;
    this.layers = [];
    this.selected = null;
    this.nextId = 1;
    this.onChange = null;      // UI refresh callback
    this.drag = null;
    this._persistTimer = null;

    this._resize();
    window.addEventListener('resize', () => { this._resize(); this.render(); });
    this._bindPointer();
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(window.innerWidth * dpr);
    this.canvas.height = Math.round(window.innerHeight * dpr);
    this.dpr = dpr;
  }

  // ---------- layer creation ----------

  addImage(img, name, x, y) {
    // Normalize very large sources so processing stays fast.
    const maxDim = 1600;
    let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    const k = Math.min(1, maxDim / Math.max(w, h));
    w = Math.max(1, Math.round(w * k));
    h = Math.max(1, Math.round(h * k));
    const src = document.createElement('canvas');
    src.width = w; src.height = h;
    src.getContext('2d').drawImage(img, 0, 0, w, h);

    const layer = {
      id: (crypto.randomUUID ? crypto.randomUUID() : 'ly-' + Date.now() + '-' + Math.random()),
      name: name || 'layer',
      src, srcW: w, srcH: h,
      x: x ?? window.innerWidth / 2,
      y: y ?? window.innerHeight / 2,
      scale: Math.min(1, (window.innerWidth * 0.3) / w, (window.innerHeight * 0.5) / h),
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: 1,
      colorMode: 'original',
      color: '#ffc46b',
      knockout: false,
      knockoutThresh: 235,
      outlineWidth: 0,
      outlineColor: '#0b0e12',
      vectorized: false,
      traced: null,
      epsilon: 1.5,
      cache: null,
      thumb: null,
      _blob: null,
    };
    this.layers.push(layer);
    this.rebuild(layer);
    this.select(layer);

    // capture the normalized source once for persistence
    if (this.store) {
      src.toBlob((b) => { layer._blob = b; this.persistSoon(); }, 'image/png');
    }
    return layer;
  }

  remove(layer) {
    const i = this.layers.indexOf(layer);
    if (i >= 0) this.layers.splice(i, 1);
    if (this.selected === layer) this.selected = this.layers[this.layers.length - 1] || null;
    if (this.store) this.store.remove(layer.id).catch(() => {});
    this.render();
    this._changed();
  }

  select(layer) {
    this.selected = layer;
    this.render();
    this._changed();
  }

  _changed() {
    if (this.onChange) this.onChange();
    this.persistSoon();
  }

  // ---------- persistence ----------

  _serialize(layer, order) {
    return {
      id: layer.id,
      name: layer.name,
      order,
      blob: layer._blob,
      xf: layer.x / window.innerWidth,
      yf: layer.y / window.innerHeight,
      scale: layer.scale,
      scaleX: layer.scaleX ?? 1,
      scaleY: layer.scaleY ?? 1,
      rotation: layer.rotation,
      opacity: layer.opacity,
      colorMode: layer.colorMode,
      color: layer.color,
      knockout: layer.knockout,
      knockoutThresh: layer.knockoutThresh,
      outlineWidth: layer.outlineWidth,
      outlineColor: layer.outlineColor,
      vectorized: layer.vectorized,
      epsilon: layer.epsilon,
    };
  }

  persistSoon() {
    if (!this.store || this._restoring) return;
    clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => {
      this.layers.forEach((layer, i) => {
        if (layer._blob) this.store.put(this._serialize(layer, i)).catch(() => {});
      });
    }, 400);
  }

  async restore() {
    if (!this.store) return;
    let records;
    try { records = await this.store.all(); } catch { return; }
    if (!records || !records.length) return;
    records.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    this._restoring = true;
    for (const r of records) {
      try {
        const img = await createImageBitmap(r.blob);
        const src = document.createElement('canvas');
        src.width = img.width; src.height = img.height;
        src.getContext('2d').drawImage(img, 0, 0);
        const layer = {
          id: r.id,
          name: r.name,
          src, srcW: src.width, srcH: src.height,
          x: r.xf * window.innerWidth,
          y: r.yf * window.innerHeight,
          scale: r.scale,
          scaleX: r.scaleX ?? 1,
          scaleY: r.scaleY ?? 1,
          rotation: r.rotation,
          opacity: r.opacity,
          colorMode: r.colorMode,
          color: r.color,
          knockout: r.knockout,
          knockoutThresh: r.knockoutThresh,
          outlineWidth: r.outlineWidth,
          outlineColor: r.outlineColor,
          vectorized: false,
          traced: null,
          epsilon: r.epsilon ?? 1.5,
          cache: null,
          thumb: null,
          _blob: r.blob,
        };
        this.layers.push(layer);
        if (r.vectorized) this.trace(layer);   // re-derive vector paths from the source
        else this.rebuild(layer);
      } catch (err) {
        console.warn('Failed to restore layer', r && r.name, err);
      }
    }
    this._restoring = false;
    this.render();
    this._changed();
  }

  // ---------- processing pipeline ----------

  // Silhouette source (post-knockout, pre-color) — also what the vectorizer traces.
  _buildBase(layer) {
    const { srcW: w, srcH: h } = layer;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');

    if (layer.vectorized && layer.traced) {
      ctx.fillStyle = layer.color;
      ctx.fill(Vectorize.toPath2D(layer.traced), 'evenodd');
      return c;
    }

    ctx.drawImage(layer.src, 0, 0);
    if (layer.knockout) {
      const id = ctx.getImageData(0, 0, w, h);
      const d = id.data, t = layer.knockoutThresh;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] >= t && d[i + 1] >= t && d[i + 2] >= t) d[i + 3] = 0;
      }
      ctx.putImageData(id, 0, 0);
    }
    return c;
  }

  _colorize(base, layer) {
    if (layer.vectorized || layer.colorMode === 'original') return base;
    const w = base.width, h = base.height;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');

    if (layer.colorMode === 'fill') {
      ctx.drawImage(base, 0, 0);
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = layer.color;
      ctx.fillRect(0, 0, w, h);
    } else { // tint: keep luminance, take hue/sat from the chosen color
      ctx.drawImage(base, 0, 0);
      ctx.globalCompositeOperation = 'color';
      ctx.fillStyle = layer.color;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(base, 0, 0);
    }
    return c;
  }

  _outline(colored, layer) {
    const wOut = Math.round(layer.outlineWidth);
    if (wOut <= 0) return { canvas: colored, pad: 0 };
    const w = colored.width, h = colored.height;

    // silhouette in outline color
    const sil = document.createElement('canvas');
    sil.width = w; sil.height = h;
    const sctx = sil.getContext('2d');
    sctx.drawImage(colored, 0, 0);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = layer.outlineColor;
    sctx.fillRect(0, 0, w, h);

    const out = document.createElement('canvas');
    out.width = w + wOut * 2;
    out.height = h + wOut * 2;
    const octx = out.getContext('2d');
    // stamp the silhouette in rings to build a dilated outline
    const radii = [];
    for (let r = wOut; r > 0; r -= Math.max(1, wOut / 4)) radii.push(r);
    for (const r of radii) {
      const steps = Math.max(16, Math.ceil(r * 2.5));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        octx.drawImage(sil, wOut + Math.cos(a) * r, wOut + Math.sin(a) * r);
      }
    }
    octx.drawImage(colored, wOut, wOut);
    return { canvas: out, pad: wOut };
  }

  rebuild(layer) {
    const base = this._buildBase(layer);
    const colored = this._colorize(base, layer);
    layer.cache = this._outline(colored, layer);

    // thumbnail
    const t = document.createElement('canvas');
    const tk = 52 / Math.max(layer.cache.canvas.width, layer.cache.canvas.height);
    t.width = Math.max(1, Math.round(layer.cache.canvas.width * tk));
    t.height = Math.max(1, Math.round(layer.cache.canvas.height * tk));
    t.getContext('2d').drawImage(layer.cache.canvas, 0, 0, t.width, t.height);
    layer.thumb = t.toDataURL();

    this.render();
    this._changed();
  }

  // ---------- vectorize ----------

  trace(layer) {
    const wasVector = layer.vectorized;
    layer.vectorized = false;               // trace from the raster silhouette
    const base = this._buildBase(layer);
    layer.traced = Vectorize.trace(base, { epsilon: layer.epsilon });
    layer.vectorized = true;
    if (!wasVector && layer.colorMode === 'original') {
      layer.color = layer.color || '#ffc46b';
    }
    this.rebuild(layer);
  }

  untrace(layer) {
    layer.vectorized = false;
    this.rebuild(layer);
  }

  svgFor(layer) {
    if (!layer.traced) return null;
    return Vectorize.toSVG(layer.traced, layer.color);
  }

  // ---------- rendering ----------

  render() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    for (const layer of this.layers) {
      if (!layer.cache) continue;
      const { canvas: c, pad } = layer.cache;
      ctx.save();
      ctx.translate(layer.x, layer.y);
      ctx.rotate(layer.rotation * Math.PI / 180);
      ctx.scale(layer.scale * (layer.scaleX ?? 1), layer.scale * (layer.scaleY ?? 1));
      ctx.globalAlpha = layer.opacity;
      ctx.drawImage(c, -c.width / 2, -c.height / 2);
      ctx.restore();
    }

    // center-snap guide lines while dragging
    if (this.drag && this.drag.layer && (this.snapX || this.snapY)) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 255, 0, 0.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 5]);
      if (this.snapX) {
        ctx.beginPath();
        ctx.moveTo(window.innerWidth / 2, 0);
        ctx.lineTo(window.innerWidth / 2, window.innerHeight);
        ctx.stroke();
      }
      if (this.snapY) {
        ctx.beginPath();
        ctx.moveTo(0, window.innerHeight / 2);
        ctx.lineTo(window.innerWidth, window.innerHeight / 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // selection frame (hidden in stage mode)
    const sel = this.selected;
    if (sel && sel.cache && !document.body.classList.contains('stage')) {
      const c = sel.cache.canvas;
      const hw = (c.width * sel.scale * (sel.scaleX ?? 1)) / 2;
      const hh = (c.height * sel.scale * (sel.scaleY ?? 1)) / 2;
      ctx.save();
      ctx.translate(sel.x, sel.y);
      ctx.rotate(sel.rotation * Math.PI / 180);
      ctx.strokeStyle = 'rgba(0, 255, 0, 0.85)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(-hw - 6, -hh - 6, hw * 2 + 12, hh * 2 + 12);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(0, 255, 0, 0.9)';
      for (const [cx, cy] of [[-hw - 6, -hh - 6], [hw + 6, -hh - 6], [-hw - 6, hh + 6], [hw + 6, hh + 6]]) {
        ctx.fillRect(cx - 2.5, cy - 2.5, 5, 5);
      }
      ctx.restore();
    }
  }

  // Composite all layers onto an external context (for PNG export), scaled by k.
  compositeTo(ctx, k) {
    for (const layer of this.layers) {
      if (!layer.cache) continue;
      const c = layer.cache.canvas;
      ctx.save();
      ctx.translate(layer.x * k, layer.y * k);
      ctx.rotate(layer.rotation * Math.PI / 180);
      ctx.scale(layer.scale * (layer.scaleX ?? 1) * k, layer.scale * (layer.scaleY ?? 1) * k);
      ctx.globalAlpha = layer.opacity;
      ctx.drawImage(c, -c.width / 2, -c.height / 2);
      ctx.restore();
    }
  }

  // ---------- interaction ----------

  hitTest(px, py) {
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const layer = this.layers[i];
      if (!layer.cache) continue;
      const c = layer.cache.canvas;
      const a = -layer.rotation * Math.PI / 180;
      const dx = px - layer.x, dy = py - layer.y;
      const lx = (dx * Math.cos(a) - dy * Math.sin(a)) / (layer.scale * (layer.scaleX ?? 1));
      const ly = (dx * Math.sin(a) + dy * Math.cos(a)) / (layer.scale * (layer.scaleY ?? 1));
      if (Math.abs(lx) <= c.width / 2 && Math.abs(ly) <= c.height / 2) return layer;
    }
    return null;
  }

  _bindPointer() {
    const el = this.canvas;
    el.style.touchAction = 'none';

    el.addEventListener('pointerdown', (e) => {
      const hit = this.hitTest(e.clientX, e.clientY);
      if (hit) {
        this.select(hit);
        this.drag = { layer: hit, ox: e.clientX - hit.x, oy: e.clientY - hit.y };
        el.setPointerCapture(e.pointerId);
      } else {
        if (this.selected) this.select(null);
        this.drag = { layer: null };  // background drag -> feed iMouse
        if (window.engine) {
          const s = window.engine.resolutionScale === 'dpr' ? (window.devicePixelRatio || 1) : window.engine.resolutionScale;
          window.engine.mouse = [e.clientX * s, (window.innerHeight - e.clientY) * s,
                                 e.clientX * s, (window.innerHeight - e.clientY) * s];
        }
      }
    });

    el.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      if (this.drag.layer) {
        let nx = e.clientX - this.drag.ox;
        let ny = e.clientY - this.drag.oy;
        // magnetic snap to the screen center axes
        const SNAP = 12;
        this.snapX = Math.abs(nx - window.innerWidth / 2) < SNAP;
        this.snapY = Math.abs(ny - window.innerHeight / 2) < SNAP;
        if (this.snapX) nx = window.innerWidth / 2;
        if (this.snapY) ny = window.innerHeight / 2;
        this.drag.layer.x = nx;
        this.drag.layer.y = ny;
        this.render();
      } else if (window.engine) {
        const s = window.engine.resolutionScale === 'dpr' ? (window.devicePixelRatio || 1) : window.engine.resolutionScale;
        window.engine.mouse[0] = e.clientX * s;
        window.engine.mouse[1] = (window.innerHeight - e.clientY) * s;
      }
    });

    const endDrag = () => {
      if (this.drag && window.engine) {
        window.engine.mouse[2] = -Math.abs(window.engine.mouse[2]);
        window.engine.mouse[3] = -Math.abs(window.engine.mouse[3]);
      }
      if (this.drag && this.drag.layer) this.persistSoon();
      this.drag = null;
      this.snapX = this.snapY = false;
      this.render();
    };
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);

    el.addEventListener('wheel', (e) => {
      const hit = this.hitTest(e.clientX, e.clientY);
      const target = hit || this.selected;
      if (!target) return;
      e.preventDefault();
      const f = Math.pow(1.0015, -e.deltaY);
      target.scale = Math.min(4, Math.max(0.03, target.scale * f));
      this.render();
      this._changed();
    }, { passive: false });
  }
}
