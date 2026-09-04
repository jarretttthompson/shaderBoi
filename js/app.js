// shaderBoi — app wiring: shader library, modal editor, drag/drop, layer controls, export.
// (Internal storage keys and the scene "app" identifier keep the original "shaderdeck" names
//  so existing saved state and shared scene files stay loadable.)

(() => {
  const $ = (id) => document.getElementById(id);

  // ---------- engine ----------
  const engine = new ShaderEngine($('glCanvas'));
  window.engine = engine;
  const layerStore = new LayerStore();
  const layerMgr = new LayerManager($('overlayCanvas'), layerStore);
  window.layerMgr = layerMgr;

  // ---------- shader library ----------
  const LS_SHADERS = 'shaderdeck.customShaders';
  const LS_ACTIVE = 'shaderdeck.activeShaderId';

  let customShaders = [];
  try { customShaders = JSON.parse(localStorage.getItem(LS_SHADERS) || '[]'); } catch { customShaders = []; }

  const allShaders = () => [...BUILTIN_SHADERS, ...customShaders];
  const findShader = (id) => allShaders().find(s => s.id === id);
  const saveCustom = () => localStorage.setItem(LS_SHADERS, JSON.stringify(customShaders));

  let activeId = null;

  function activateShader(id) {
    const sh = findShader(id);
    if (!sh) return false;
    const res = engine.setShader(sh.code);
    if (!res.ok) {
      console.error('Shader compile failed:', sh.name, res.log);
      alert('Shader "' + sh.name + '" failed to compile:\n\n' + res.log);
      return false;
    }
    activeId = id;
    localStorage.setItem(LS_ACTIVE, id);
    $('activeShaderName').textContent = sh.name;
    renderShaderList();
    broadcastState();
    return true;
  }

  function renderShaderList() {
    const ul = $('shaderList');
    ul.innerHTML = '';
    for (const sh of allShaders()) {
      const li = document.createElement('li');
      li.className = sh.id === activeId ? 'active' : '';
      const name = document.createElement('span');
      name.className = 'sh-name';
      name.textContent = sh.name;
      li.appendChild(name);

      if (!sh.builtin) {
        const edit = document.createElement('button');
        edit.className = 'li-btn';
        edit.textContent = 'EDIT';
        edit.addEventListener('click', (e) => { e.stopPropagation(); openModal(sh); });
        li.appendChild(edit);

        const del = document.createElement('button');
        del.className = 'li-btn del';
        del.textContent = '✕';
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!confirm('Delete shader "' + sh.name + '"?')) return;
          customShaders = customShaders.filter(s => s.id !== sh.id);
          saveCustom();
          if (activeId === sh.id) activateShader(allShaders()[0].id);
          else renderShaderList();
        });
        li.appendChild(del);
      }
      li.addEventListener('click', () => activateShader(sh.id));
      ul.appendChild(li);
    }
  }

  // ---------- shader modal ----------
  let editingId = null;

  function openModal(shader) {
    editingId = shader ? shader.id : null;
    $('modalTitle').textContent = shader ? 'EDIT SHADER' : 'ADD SHADER';
    $('shaderNameInput').value = shader ? shader.name : '';
    $('shaderCodeInput').value = shader ? shader.code : '';
    $('compileLog').classList.add('hidden');
    $('modalBackdrop').classList.remove('hidden');
    $('shaderNameInput').focus();
  }
  function closeModal() { $('modalBackdrop').classList.add('hidden'); }

  $('addShaderBtn').addEventListener('click', () => openModal(null));
  $('modalCloseBtn').addEventListener('click', closeModal);
  $('modalCancelBtn').addEventListener('click', closeModal);
  $('modalBackdrop').addEventListener('pointerdown', (e) => {
    if (e.target === $('modalBackdrop')) closeModal();
  });

  $('modalSaveBtn').addEventListener('click', () => {
    const name = $('shaderNameInput').value.trim() || 'Untitled';
    const code = $('shaderCodeInput').value;
    if (!code.includes('mainImage')) {
      $('compileLog').textContent = 'Shader needs a mainImage(out vec4 fragColor, in vec2 fragCoord) entry point.';
      $('compileLog').classList.remove('hidden');
      return;
    }
    const res = engine.testCompile(code);
    if (!res.ok) {
      $('compileLog').textContent = res.log;
      $('compileLog').classList.remove('hidden');
      return;
    }
    if (editingId) {
      const sh = customShaders.find(s => s.id === editingId);
      if (sh) { sh.name = name; sh.code = code; }
    } else {
      const sh = { id: 'custom-' + Date.now(), name, code };
      customShaders.push(sh);
      editingId = sh.id;
    }
    saveCustom();
    activateShader(editingId);
    closeModal();
  });

  // ---------- top bar ----------
  $('playPauseBtn').addEventListener('click', () => {
    const playing = engine.togglePlay();
    $('pauseIcon').classList.toggle('hidden', !playing);
    $('playIcon').classList.toggle('hidden', playing);
    broadcastState();
  });

  $('qualitySelect').addEventListener('change', (e) => engine.setResolutionScale(e.target.value));

  let lastReadout = 0;
  let lastGlow = '';
  let overlayAnimating = false;
  let seenBeat = 0, beatT0 = 0, beatStrength = 1, shakeAng = 0;
  const snapZero = (v) => (Math.abs(v) < 5e-4 ? 0 : v);
  engine.onTick = (t) => {
    const now = performance.now();
    if (now - lastReadout > 200) {
      lastReadout = now;
      $('timeReadout').textContent = 't ' + t.toFixed(1) + 's';
    }

    // audio-driven shader / logo / overlay effects, evaluated per frame so they stay
    // in step with the render (composite CSS effects are applied inside AudioReactive)
    const live = audio.enabled;
    const k = (key) => (live ? audio.k(key) : 0);
    engine.timeScale = 1 + audio.level * 1.6 * k('speed');
    layerMgr.pulse = snapZero((audio.beat * 0.06 + audio.level * 0.025) * k('pulse'));
    layerMgr.wobble = snapZero(Math.sin(now / 1000 * 3.1) * audio.bass * 3.5 * k('wobble'));

    // beat zoom + shake: envelope restarts on every detected onset, decays over ~0.6s.
    // Animated here (per frame) rather than in the 30 Hz analyser loop so it's smooth.
    if (audio.beatCount !== seenBeat) {
      seenBeat = audio.beatCount;
      beatT0 = now;
      beatStrength = Math.min(1, 0.45 + audio.bass * 0.8);   // bigger hits knock harder
      shakeAng = Math.random() * Math.PI * 2;
    }
    const kz = k('zoom'), ks = k('shake');
    if (kz || ks) {
      const age = beatT0 ? (now - beatT0) / 1000 : 99;
      const env = Math.exp(-age / 0.24) * beatStrength;
      let zoom = 1 + (env * 0.07 + audio.level * 0.012) * kz;
      let sx = 0, sy = 0;
      if (ks && env > 0.004) {
        // damped knock along a random direction with a faster cross-axis wobble
        const amp = 18 * ks * env;
        const knock = Math.cos(age * 2 * Math.PI * 7.5);
        const cross = Math.sin(age * 2 * Math.PI * 11.5) * 0.35;
        sx = amp * (Math.cos(shakeAng) * knock - Math.sin(shakeAng) * cross);
        sy = amp * (Math.sin(shakeAng) * knock + Math.cos(shakeAng) * cross);
      }
      audio.applyTransform(zoom, sx, sy);
    } else {
      audio.applyTransform(1, 0, 0);
    }

    const glowPx = (audio.beat * 22 + audio.level * 8) * k('glow');
    const glow = glowPx > 0.3 ? `drop-shadow(0 0 ${glowPx.toFixed(1)}px rgba(255, 225, 170, 0.9))` : '';
    if (glow !== lastGlow) {
      lastGlow = glow;
      $('overlayCanvas').style.filter = glow;
    }

    const overlaysOn = !!(k('eq') || k('wave'));
    const animating = !!(layerMgr.pulse || layerMgr.wobble || overlaysOn);
    // render while anything moves, plus one more frame to clear when it stops
    if (animating || overlayAnimating) layerMgr.render();
    overlayAnimating = animating;
  };

  // ---------- audio overlays (drawn under the logos) ----------
  function drawEqBars(ctx) {
    const W = window.innerWidth, H = window.innerHeight;
    const N = 36, spec = audio.spectrum;
    const slot = W / (N * 2), barW = slot * 0.62, maxH = H * 0.22 * audio.k('eq');
    const g = ctx.createLinearGradient(0, H, 0, H - maxH);
    g.addColorStop(0, 'rgba(255, 225, 170, 0.12)');
    g.addColorStop(1, 'rgba(255, 240, 210, 0.7)');
    ctx.fillStyle = g;
    for (let i = 0; i < N; i++) {
      // log-ish bin spacing: low bars = bass, high bars = treble; peak over the bin span
      const b0 = Math.min(511, Math.floor(Math.pow(i / N, 1.8) * 380) + 1);
      const b1 = Math.min(512, Math.floor(Math.pow((i + 1) / N, 1.8) * 380) + 2);
      let v = 0;
      for (let k = b0; k < b1; k++) if (spec[k] > v) v = spec[k];
      const h = Math.pow(v / 255, 1.3) * maxH;
      if (h < 1) continue;
      ctx.fillRect(W / 2 + i * slot + (slot - barW) / 2, H - h, barW, h);
      ctx.fillRect(W / 2 - (i + 1) * slot + (slot - barW) / 2, H - h, barW, h);
    }
  }

  function drawWaveform(ctx) {
    const W = window.innerWidth, H = window.innerHeight;
    const wave = audio.wave, amp = H * 0.12 * (0.6 + 0.8 * audio.level) * audio.k('wave');
    ctx.beginPath();
    for (let i = 0; i < 512; i++) {
      const x = (i / 511) * W;
      const y = H * 0.5 + (wave[i] / 255 - 0.5) * 2 * amp;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(255, 240, 210, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  layerMgr.preDraw = (ctx) => {
    if (!audio.enabled) return;
    if (audio.k('eq')) drawEqBars(ctx);
    if (audio.k('wave')) drawWaveform(ctx);
  };

  function exportPng() {
    const dpr = window.devicePixelRatio || 1;
    const out = document.createElement('canvas');
    out.width = Math.round(window.innerWidth * dpr);
    out.height = Math.round(window.innerHeight * dpr);
    const ctx = out.getContext('2d');
    ctx.drawImage($('glCanvas'), 0, 0, out.width, out.height);
    layerMgr.compositeTo(ctx, dpr);
    out.toBlob((blob) => downloadBlob(blob, 'shaderboi-' + Date.now() + '.png'), 'image/png');
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---------- scene save / load (portable JSON) ----------

  const blobToDataURL = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });

  async function serializeScene() {
    const sh = findShader(activeId);
    const layers = [];
    for (const l of layerMgr.layers) {
      const image = l._blob ? await blobToDataURL(l._blob) : l.src.toDataURL('image/png');
      layers.push({
        name: l.name, image,
        xf: l.xf, yf: l.yf,
        scale: l.scale, scaleX: l.scaleX ?? 1, scaleY: l.scaleY ?? 1,
        rotation: l.rotation, opacity: l.opacity,
        colorMode: l.colorMode, color: l.color,
        knockout: l.knockout, knockoutThresh: l.knockoutThresh,
        outlineWidth: l.outlineWidth, outlineColor: l.outlineColor,
        vectorized: l.vectorized, epsilon: l.epsilon,
      });
    }
    return {
      app: 'shaderdeck-scene',
      version: 1,
      shader: sh ? { name: sh.name, code: sh.code } : null,
      audio: {
        sens: parseInt($('audioSens').value, 10),
        fx: { ...audio.fx }, amt: { ...audio.amt },
        focus: Math.round(audio.musicFocus * 100),
      },
      layers,
    };
  }

  async function saveScene() {
    const scene = await serializeScene();
    const slug = (scene.shader ? scene.shader.name : 'scene')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    downloadBlob(new Blob([JSON.stringify(scene, null, 2)], { type: 'application/json' }),
      'shaderboi-' + slug + '.json');
  }

  async function importScene(scene, { confirmReplace = true } = {}) {
    if (!scene || scene.app !== 'shaderdeck-scene' || !Array.isArray(scene.layers)) {
      alert('That file is not a shaderBoi scene.');
      return false;
    }
    if (confirmReplace && layerMgr.layers.length &&
        !confirm('Loading this scene replaces the current layers. Continue?')) {
      return false;
    }

    // shader: builtin reference, or reuse an identical one, or add it to the library
    if (scene.shader && scene.shader.builtin && findShader(scene.shader.builtin)) {
      activateShader(scene.shader.builtin);
    } else if (scene.shader && scene.shader.code) {
      let target = allShaders().find(s => s.code === scene.shader.code);
      if (!target) {
        target = { id: 'custom-' + Date.now(), name: scene.shader.name || 'Imported', code: scene.shader.code };
        customShaders.push(target);
        saveCustom();
      }
      activateShader(target.id);
    }

    layerMgr.layers.slice().forEach(l => layerMgr.remove(l));
    for (const rec of scene.layers) {
      try {
        const blob = await (await fetch(rec.image)).blob();
        const bmp = await createImageBitmap(blob);
        const layer = layerMgr.addImage(bmp, rec.name);
        Object.assign(layer, {
          xf: Number.isFinite(rec.xf) ? rec.xf : 0.5,
          yf: Number.isFinite(rec.yf) ? rec.yf : 0.5,
          scale: rec.scale, scaleX: rec.scaleX ?? 1, scaleY: rec.scaleY ?? 1,
          rotation: rec.rotation, opacity: rec.opacity,
          colorMode: rec.colorMode, color: rec.color,
          knockout: rec.knockout, knockoutThresh: rec.knockoutThresh,
          outlineWidth: rec.outlineWidth, outlineColor: rec.outlineColor,
          epsilon: rec.epsilon ?? 1.5,
        });
        if (rec.vectorized) layerMgr.trace(layer);
        else layerMgr.rebuild(layer);
      } catch (err) {
        console.warn('Failed to import layer', rec && rec.name, err);
      }
    }
    if (scene.audio) {
      if (scene.audio.sens) applySens(scene.audio.sens);
      applyFxSettings(scene.audio);
      audio._applyComposite();
      saveAudioSettings(audio.enabled);
      syncAudioUI();
    }
    layerMgr.select(null);
    layerMgr.persistSoon();
    return true;
  }

  $('saveSceneBtn').addEventListener('click', saveScene);
  $('loadSceneBtn').addEventListener('click', () => $('sceneFileInput').click());
  $('sceneFileInput').addEventListener('change', async () => {
    const f = $('sceneFileInput').files[0];
    $('sceneFileInput').value = '';
    if (!f) return;
    try { await importScene(JSON.parse(await f.text())); }
    catch (err) { console.warn(err); alert('Could not read that scene file.'); }
  });

  // ---------- presets ----------

  let presetsCache = [];

  async function loadPresets() {
    let list;
    try {
      const res = await fetch('presets/index.json', { cache: 'no-store' });
      if (!res.ok) return [];
      list = await res.json();
    } catch { return []; }
    if (!Array.isArray(list) || !list.length) return [];

    const ul = $('presetList');
    ul.innerHTML = '';
    for (const p of list) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'sh-name';
      name.textContent = p.name;
      li.appendChild(name);
      li.addEventListener('click', async () => {
        try {
          const res = await fetch('presets/' + p.file, { cache: 'no-store' });
          await importScene(await res.json());
        } catch (err) {
          console.warn(err);
          alert('Could not load preset "' + p.name + '".');
        }
      });
      ul.appendChild(li);
    }
    $('presetSection').classList.remove('hidden');
    presetsCache = list.map(p => ({ name: p.name, file: p.file }));
    broadcastState();
    return list;
  }

  // ---------- audio react: mic → brightness/bloom, shader uniforms, time warp, logo pulse ----------
  const audio = new AudioReactive({
    filterEl: $('shaderWrap'),      // color effects: shader only, logos stay clean
    transformEl: $('vizWrap'),      // zoom / shake: whole picture
    glowEl: $('bloomGlow'),
  });
  window.audioReact = audio;
  engine.setAudio(audio);
  const LS_AUDIO = 'shaderdeck.audio';
  const FX_DEFS = AudioReactive.FX;
  const FX_KEYS = FX_DEFS.map(d => d.key);

  // one row per effect: on/off checkbox + strength slider (0–200%, 100 = designed amount)
  const AMT_MAX = 200;
  const amtPct = (key) => Math.round((audio.amt[key] ?? 1) * 100);

  function renderFxList() {
    const root = $('audioFx');
    root.innerHTML = '';
    let group = null;
    for (const d of FX_DEFS) {
      if (d.group !== group) {
        group = d.group;
        const h = document.createElement('div');
        h.className = 'fx-head';
        h.textContent = group;
        root.appendChild(h);
      }
      const row = document.createElement('div');
      row.className = 'fx-row';
      row.dataset.fx = d.key;
      row.title = d.hint;

      const lab = document.createElement('label');
      lab.className = 'chk';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.fx = d.key;
      cb.addEventListener('change', () => setFx(d.key, cb.checked));
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(' ' + d.label));

      const sl = document.createElement('input');
      sl.type = 'range';
      sl.min = 0; sl.max = AMT_MAX; sl.step = 1;
      sl.dataset.amt = d.key;
      sl.title = d.label + ' strength';
      sl.addEventListener('input', () => setAmt(d.key, sl.value / 100));

      const val = document.createElement('span');
      val.className = 'val';
      val.dataset.amtVal = d.key;

      row.appendChild(lab);
      row.appendChild(sl);
      row.appendChild(val);
      root.appendChild(row);
    }
    syncFxRows();
  }

  function syncFxRows() {
    $('audioFx').querySelectorAll('.fx-row').forEach(row => {
      const key = row.dataset.fx;
      const on = !!audio.fx[key];
      row.classList.toggle('off', !on);
      row.querySelector('input[data-fx]').checked = on;
      const sl = row.querySelector('input[data-amt]');
      const pct = amtPct(key);
      if (parseInt(sl.value, 10) !== pct) sl.value = pct;
      row.querySelector('[data-amt-val]').textContent = pct + '%';
    });
  }

  function audioSettings() {
    try { return JSON.parse(localStorage.getItem(LS_AUDIO) || '{}'); } catch { return {}; }
  }
  function saveAudioSettings(on) {
    localStorage.setItem(LS_AUDIO, JSON.stringify({
      on,
      sens: parseInt($('audioSens').value, 10),
      fx: { ...audio.fx },
      amt: { ...audio.amt },
      focus: Math.round(audio.musicFocus * 100),
      adapt: audio.adapt,
      deviceId: audio.deviceId || '',
    }));
  }
  function applyFxSettings(src) {
    if (!src) return;
    if (src.fx) for (const k of FX_KEYS) if (typeof src.fx[k] === 'boolean') audio.fx[k] = src.fx[k];
    if (src.amt) for (const k of FX_KEYS) if (Number.isFinite(src.amt[k])) audio.amt[k] = Math.max(0, Math.min(AMT_MAX / 100, src.amt[k]));
    if (Number.isFinite(src.focus)) applyFocus(src.focus);
    if (typeof src.adapt === 'boolean') { audio.adapt = src.adapt; $('adaptChk').checked = src.adapt; }
  }
  function syncAudioUI() {
    const on = audio.enabled;
    const file = on && audio.sourceKind === 'file';
    $('audioBtnLabel').textContent = on ? (file ? 'FILE' : 'LIVE') : 'OFF';
    $('audioBtn').classList.toggle('live', on);
    $('audioSens').classList.toggle('hidden', !on);
    $('audioToggleBtn').textContent = on ? (file ? 'FILE PLAYING — STOP' : 'MIC LIVE') : 'MIC OFF';
    $('audioToggleBtn').classList.toggle('on', on);
    $('adaptChk').checked = audio.adapt;
    syncFxRows();
    setRecordUI();
    if (!on) setMeters();
    broadcastState();
  }

  // sensitivity lives in two sliders (top bar + panel); keep them and the analyser in step
  function applySens(v) {
    v = Math.max(1, Math.min(30, parseInt(v, 10) || 10));
    $('audioSens').value = v;
    $('audioSensPanel').value = v;
    $('audioSensVal').textContent = v;
    audio.sensitivity = v / 2;
  }
  function setSens(v) {
    applySens(v);
    saveAudioSettings(audio.enabled);
    broadcastState();
  }

  function setFx(key, on) {
    if (!FX_KEYS.includes(key)) return;
    audio.fx[key] = !!on;
    if (!on) audio._applyComposite();   // clear a composite effect right away, not on the next tick
    saveAudioSettings(audio.enabled);
    syncAudioUI();
  }
  function setAmt(key, value) {
    if (!FX_KEYS.includes(key)) return;
    const v = Math.max(0, Math.min(AMT_MAX / 100, parseFloat(value)));
    if (!Number.isFinite(v)) return;
    audio.amt[key] = v;
    audio._applyComposite();
    saveAudioSettings(audio.enabled);
    syncFxRows();
    broadcastState();
  }
  // fx = which are on; amt = strengths (omit to reset all to 100%)
  function setAllFx(fx, amt) {
    for (const k of FX_KEYS) {
      audio.fx[k] = !!fx[k];
      audio.amt[k] = amt && Number.isFinite(amt[k]) ? amt[k] : 1;
    }
    audio._applyComposite();
    saveAudioSettings(audio.enabled);
    syncAudioUI();
  }

  function setMeters() {
    const pct = (v) => Math.round(Math.min(1, Math.max(0, v)) * 100) + '%';
    $('mLevel').style.width = pct(audio.level);
    $('mBass').style.width = pct(audio.bass);
    $('mMid').style.width = pct(audio.mid);
    $('mTreb').style.width = pct(audio.treble);
    $('beatDot').classList.toggle('hit', audio.beat > 0.5);
    $('mMusic').style.width = pct(audio.enabled ? audio.music : 0);
    $('clipBadge').classList.toggle('hit', audio.enabled && audio.clip);
  }

  // ---- room adaptation toggle ----
  $('adaptChk').addEventListener('change', () => setAdapt($('adaptChk').checked));
  function setAdapt(on) {
    audio.adapt = !!on;
    $('adaptChk').checked = audio.adapt;
    saveAudioSettings(audio.enabled);
    broadcastState();
  }

  // ---- record mic + analysis log for offline tuning ----
  let recTimer = null;
  function setRecordUI() {
    const on = audio.recording;
    $('recordBtn').classList.toggle('recording', on);
    $('recordBtn').textContent = on ? 'STOP' : 'RECORD 45s';
    $('recordBtn').disabled = !audio.enabled || audio.sourceKind !== 'mic';
    $('recordBtn').title = audio.sourceKind === 'file'
      ? 'Recording works from the mic input only'
      : 'Record 45 seconds of the mic plus the analysis log, then download both — send them back to tune the detector for this room';
    if (!on) {
      clearInterval(recTimer);
      recTimer = null;
    }
    broadcastState();
  }
  function startRecording() {
    if (!audio.enabled || audio.sourceKind !== 'mic') {
      alert('Turn the mic on first — recording captures the live input.');
      return;
    }
    if (!audio.startRecording(45)) return;
    const t0 = performance.now();
    $('recordStatus').classList.remove('hidden');
    recTimer = setInterval(() => {
      const s = Math.min(45, (performance.now() - t0) / 1000);
      $('recordStatus').textContent = 'RECORDING ' + s.toFixed(0) + 's / 45s — play a song, then let someone talk.';
    }, 250);
    setRecordUI();
  }
  audio.onRecording = (blob, log) => {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const ext = (blob.type || '').includes('mp4') ? 'm4a' : 'webm';
    downloadBlob(blob, 'shaderboi-room-' + ts + '.' + ext);
    setTimeout(() => downloadBlob(new Blob([JSON.stringify(log)], { type: 'application/json' }),
      'shaderboi-room-' + ts + '.analysis.json'), 400);
    $('recordStatus').textContent = 'Saved two files (audio + analysis log) to your downloads. Send both back for tuning.';
    setRecordUI();
  };
  $('recordBtn').addEventListener('click', () => {
    if (audio.recording) audio.stopRecording();
    else startRecording();
  });

  function applyFocus(v) {
    v = Math.max(0, Math.min(100, parseInt(v, 10)));
    if (!Number.isFinite(v)) v = 70;
    $('focusSlider').value = v;
    $('focusVal').textContent = v;
    audio.musicFocus = v / 100;
  }
  function setFocus(v) {
    applyFocus(v);
    saveAudioSettings(audio.enabled);
    broadcastState();
  }
  $('focusSlider').addEventListener('input', () => setFocus($('focusSlider').value));

  async function refreshDevices() {
    const list = await AudioReactive.listInputs();
    const sel = $('audioDevice');
    sel.innerHTML = '';
    const def = document.createElement('option');
    def.value = '';
    def.textContent = 'DEFAULT INPUT';
    sel.appendChild(def);
    let n = 0;
    for (const d of list) {
      if (!d.deviceId || d.deviceId === 'default' || d.deviceId === 'communications') continue;
      n++;
      const o = document.createElement('option');
      o.value = d.deviceId;
      // labels are only exposed once mic permission has been granted
      o.textContent = (d.label || ('INPUT ' + n)).toUpperCase();
      sel.appendChild(o);
    }
    const fileOpt = document.createElement('option');
    fileOpt.value = '__file';
    fileOpt.textContent = audio.sourceKind === 'file' && audio.fileName
      ? 'FILE: ' + audio.fileName.toUpperCase()
      : 'AUDIO FILE…';
    sel.appendChild(fileOpt);
    if (audio.sourceKind === 'file') {
      sel.value = '__file';
      return;
    }
    const known = audio.deviceId && [...sel.options].some(o => o.value === audio.deviceId);
    sel.value = known ? audio.deviceId : '';
  }

  // analyse an audio file (a venue recording) instead of the mic, for tuning at home
  $('audioFileInput').addEventListener('change', async () => {
    const f = $('audioFileInput').files[0];
    $('audioFileInput').value = '';
    if (!f) { refreshDevices(); return; }
    try {
      await audio.startFile(f);
    } catch (err) {
      console.warn('Could not play that file:', err);
      alert('Could not decode that audio file.');
    }
    saveAudioSettings(audio.enabled && audio.sourceKind === 'mic');
    syncAudioUI();
    refreshDevices();
  });

  async function setAudio(on, opts = {}) {
    if (on && !audio.enabled) {
      let err = null;
      try { await audio.start(audio.deviceId); }
      catch (e) { err = e; }
      // a remembered input may be unplugged: fall back to the default device
      if (err && audio.deviceId) {
        audio.deviceId = null;
        try { await audio.start(null); err = null; } catch (e) { err = e; }
      }
      if (err) {
        console.warn('Microphone unavailable:', err);
        if (!opts.silent) {
          alert('Could not access the microphone.\nCheck the browser’s mic permission for this page.');
        }
        saveAudioSettings(false);
        syncAudioUI();
        return;
      }
      refreshDevices();   // labels become available after the first grant
    } else if (!on && audio.enabled) {
      audio.stop();
      refreshDevices();
    }
    saveAudioSettings(audio.enabled);
    syncAudioUI();
  }

  $('audioBtn').addEventListener('click', () => setAudio(!audio.enabled));
  $('audioToggleBtn').addEventListener('click', () => setAudio(!audio.enabled));
  $('audioSens').addEventListener('input', () => setSens($('audioSens').value));
  $('audioSensPanel').addEventListener('input', () => setSens($('audioSensPanel').value));
  $('fxNoneBtn').addEventListener('click', () => setAllFx({}));
  $('fxDefaultsBtn').addEventListener('click', () => setAllFx(AudioReactive.defaultFx()));
  $('audioDevice').addEventListener('change', async () => {
    const id = $('audioDevice').value || null;
    if (id === '__file') {
      $('audioFileInput').click();
      return;
    }
    try {
      if (audio.sourceKind === 'file') {
        // leaving file mode: back to the mic
        audio.stop();
        audio.deviceId = id;
        await audio.start(id);
      } else {
        await audio.setDevice(id);
      }
    } catch (err) {
      console.warn('Input switch failed:', err);
      alert('Could not open that input. Falling back to the default device.');
      await audio.setDevice(null).catch(() => {});
    }
    saveAudioSettings(audio.enabled);
    syncAudioUI();
    refreshDevices();
  });
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
  }

  // ---------- keep the display awake (no screensaver/sleep during shows) ----------
  let wakeLock = null;
  async function acquireWakeLock() {
    if (!('wakeLock' in navigator)) {
      console.warn('Screen Wake Lock API not supported in this browser — the OS may still blank the screen.');
      return;
    }
    if (wakeLock) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('shaderBoi: screen wake lock active');
      // the OS releases the lock when the tab is hidden or the display config
      // changes — re-acquire as soon as we're visible again
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
        if (document.visibilityState === 'visible') acquireWakeLock();
      });
    } catch (err) {
      wakeLock = null;
      console.warn('Screen wake lock refused:', err);
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') acquireWakeLock();
  });
  window.addEventListener('focus', acquireWakeLock);
  acquireWakeLock();

  // ---------- stage mode (fullscreen, no UI) ----------
  let cursorTimer = null;

  function setStage(on) {
    document.body.classList.toggle('stage', on);
    layerMgr.render();
    if (on) {
      const hint = $('stageHint');
      hint.classList.remove('hidden');
      // restart the fade animation
      hint.style.animation = 'none';
      void hint.offsetWidth;
      hint.style.animation = '';
      armCursorHide();
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      }
    } else {
      $('stageHint').classList.add('hidden');
      document.body.classList.remove('hide-cursor');
      clearTimeout(cursorTimer);
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    }
    broadcastState();
  }

  const inStage = () => document.body.classList.contains('stage');

  function armCursorHide() {
    clearTimeout(cursorTimer);
    document.body.classList.remove('hide-cursor');
    cursorTimer = setTimeout(() => {
      if (inStage()) document.body.classList.add('hide-cursor');
    }, 2500);
  }

  window.addEventListener('pointermove', () => { if (inStage()) armCursorHide(); });

  $('stageBtn').addEventListener('click', () => {
    setStage(true);
    openRemote();   // pop-out controls so the TV wall stays clean
  });

  // leaving browser fullscreen (Esc) also leaves stage mode
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && inStage()) setStage(false);
  });

  // ---------- pop-out remote control (BroadcastChannel) ----------
  let remoteWin = null;
  function openRemote() {
    if (remoteWin && !remoteWin.closed) { remoteWin.focus(); return; }
    remoteWin = window.open('remote.html', 'shaderboiRemote',
      'width=380,height=720,resizable=yes');
    if (!remoteWin) console.warn('shaderBoi: popup blocked — allow popups for this site to use the stage remote.');
  }

  const ctlChannel = new BroadcastChannel('shaderboi-ctl');

  function broadcastState() {
    ctlChannel.postMessage({
      type: 'state',
      shaders: allShaders().map(s => ({ id: s.id, name: s.name })),
      activeId,
      presets: presetsCache,
      playing: engine.playing,
      stage: inStage(),
      audio: {
        on: audio.enabled, sens: parseInt($('audioSens').value, 10),
        fx: { ...audio.fx }, amt: { ...audio.amt },
        focus: Math.round(audio.musicFocus * 100),
        adapt: audio.adapt,
        source: audio.sourceKind,
        recording: audio.recording,
      },
      fxDefs: FX_DEFS.map(d => ({ key: d.key, label: d.label, group: d.group })),
    });
  }

  ctlChannel.onmessage = async (e) => {
    const m = e.data || {};
    switch (m.cmd) {
      case 'hello':
        broadcastState();
        break;
      case 'setShader':
        activateShader(m.id);
        break;
      case 'preset': {
        try {
          const res = await fetch('presets/' + m.file, { cache: 'no-store' });
          await importScene(await res.json(), { confirmReplace: false });
        } catch (err) { console.warn('Remote preset load failed', err); }
        broadcastState();
        break;
      }
      case 'playpause':
        $('playPauseBtn').click();
        break;
      case 'audio':
        await setAudio(m.on);
        break;
      case 'sens':
        setSens(m.value);
        break;
      case 'fx':
        setFx(m.key, m.on);
        break;
      case 'fxAll':
        setAllFx(m.defaults ? AudioReactive.defaultFx() : {});
        break;
      case 'amt':
        setAmt(m.key, m.value);
        break;
      case 'focus':
        setFocus(m.value);
        break;
      case 'adapt':
        setAdapt(m.on);
        break;
      case 'record':
        if (audio.recording) audio.stopRecording();
        else startRecording();
        break;
      case 'stage':
        setStage(m.on);
        break;
    }
  };

  // local meters every tick; stream level + bands to the remote's meters (throttled)
  let lastLevelSent = 0;
  audio.onLevel = () => {
    setMeters();
    const now = performance.now();
    if (now - lastLevelSent > 100) {
      lastLevelSent = now;
      ctlChannel.postMessage({
        type: 'level',
        v: Math.min(1, audio.level), b: audio.bass, m: audio.mid, t: audio.treble, beat: audio.beat,
        music: audio.music, clip: audio.clip,
      });
    }
  };

  // ---------- panel collapse ----------
  document.querySelectorAll('.collapse-btn[data-target]').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = $(btn.dataset.target);
      panel.classList.toggle('collapsed');
      btn.textContent = panel.classList.contains('collapsed') ? '+' : '–';
    });
  });

  // ---------- drag & drop / paste ----------
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    $('dropHint').classList.remove('hidden');
  });
  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    if (--dragDepth <= 0) { dragDepth = 0; $('dropHint').classList.add('hidden'); }
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('dropHint').classList.add('hidden');
    const all = [...(e.dataTransfer?.files || [])];
    // dropped scene files load the whole scene
    const sceneFile = all.find(f => f.name.endsWith('.json') || f.type === 'application/json');
    if (sceneFile) {
      try { await importScene(JSON.parse(await sceneFile.text())); } catch { alert('Could not read that scene file.'); }
      return;
    }
    // images snap to the center of the screen (extras cascade slightly)
    const files = all.filter(f => f.type.startsWith('image/'));
    files.forEach((f, i) => loadImageFile(f,
      window.innerWidth / 2 + i * 26,
      window.innerHeight / 2 + i * 26));
  });
  window.addEventListener('paste', (e) => {
    const items = [...(e.clipboardData?.items || [])].filter(it => it.type.startsWith('image/'));
    for (const it of items) {
      const f = it.getAsFile();
      if (f) loadImageFile(f);
    }
  });

  function loadImageFile(file, x, y) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      layerMgr.addImage(img, file.name.replace(/\.[^.]+$/, ''), x, y);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }

  // ---------- layer UI ----------
  const ctl = {
    opacity: $('opacitySlider'), opacityVal: $('opacityVal'),
    scale: $('scaleSlider'), scaleVal: $('scaleVal'),
    scaleX: $('scaleXSlider'), scaleXVal: $('scaleXVal'),
    scaleY: $('scaleYSlider'), scaleYVal: $('scaleYVal'),
    rotation: $('rotationSlider'), rotationVal: $('rotationVal'),
    colorSeg: $('colorModeSeg'), color: $('layerColor'),
    knockout: $('knockoutChk'), knockoutSlider: $('knockoutSlider'), knockoutVal: $('knockoutVal'),
    knockoutGroup: $('knockoutThreshGroup'),
    outline: $('outlineSlider'), outlineVal: $('outlineVal'), outlineColor: $('outlineColor'),
    smooth: $('smoothSlider'), smoothVal: $('smoothVal'),
    trace: $('traceBtn'), svg: $('downloadSvgBtn'), del: $('deleteLayerBtn'),
  };

  let syncing = false;

  function renderLayerUI() {
    const ul = $('layerList');
    ul.innerHTML = '';
    for (let i = layerMgr.layers.length - 1; i >= 0; i--) {
      const layer = layerMgr.layers[i];
      const li = document.createElement('li');
      li.className = layer === layerMgr.selected ? 'selected' : '';
      const img = document.createElement('img');
      img.className = 'layer-thumb';
      if (layer.thumb) img.src = layer.thumb;
      li.appendChild(img);
      const nm = document.createElement('span');
      nm.className = 'ly-name';
      nm.textContent = layer.name;
      li.appendChild(nm);
      if (layer.vectorized) {
        const b = document.createElement('span');
        b.className = 'ly-badge';
        b.textContent = 'VEC';
        li.appendChild(b);
      }
      li.addEventListener('click', () => layerMgr.select(layer));
      ul.appendChild(li);
    }

    $('layerEmptyMsg').classList.toggle('hidden', layerMgr.layers.length > 0);

    const sel = layerMgr.selected;
    $('layerControls').classList.toggle('hidden', !sel);
    if (!sel) return;

    syncing = true;
    ctl.opacity.value = Math.round(sel.opacity * 100);
    ctl.opacityVal.textContent = Math.round(sel.opacity * 100);
    ctl.scale.value = Math.round(sel.scale * 100);
    ctl.scaleVal.textContent = Math.round(sel.scale * 100);
    ctl.scaleX.value = Math.round((sel.scaleX ?? 1) * 100);
    ctl.scaleXVal.textContent = Math.round((sel.scaleX ?? 1) * 100);
    ctl.scaleY.value = Math.round((sel.scaleY ?? 1) * 100);
    ctl.scaleYVal.textContent = Math.round((sel.scaleY ?? 1) * 100);
    ctl.rotation.value = Math.round(sel.rotation);
    ctl.rotationVal.textContent = Math.round(sel.rotation) + '°';
    ctl.color.value = sel.color;
    ctl.knockout.checked = sel.knockout;
    ctl.knockoutSlider.value = sel.knockoutThresh;
    ctl.knockoutVal.textContent = sel.knockoutThresh;
    ctl.knockoutGroup.style.display = sel.knockout ? '' : 'none';
    ctl.outline.value = sel.outlineWidth;
    ctl.outlineVal.textContent = sel.outlineWidth;
    ctl.outlineColor.value = sel.outlineColor;
    ctl.smooth.value = Math.round(sel.epsilon * 10);
    ctl.smoothVal.textContent = sel.epsilon.toFixed(1);
    ctl.colorSeg.querySelectorAll('button').forEach(b =>
      b.classList.toggle('on', b.dataset.mode === sel.colorMode));
    ctl.trace.textContent = sel.vectorized ? '⟲ BACK TO RASTER' : 'TRACE → VECTOR';
    ctl.trace.classList.toggle('on', sel.vectorized);
    ctl.svg.disabled = !(sel.vectorized && sel.traced);
    syncing = false;
  }

  layerMgr.onChange = renderLayerUI;

  // rebuild throttle (heavy pipeline ops)
  let rebuildQueued = false;
  function queueRebuild(layer) {
    if (rebuildQueued) return;
    rebuildQueued = true;
    requestAnimationFrame(() => {
      rebuildQueued = false;
      layerMgr.rebuild(layer);
    });
  }

  const sel = () => layerMgr.selected;

  ctl.opacity.addEventListener('input', () => {
    if (syncing || !sel()) return;
    sel().opacity = ctl.opacity.value / 100;
    ctl.opacityVal.textContent = ctl.opacity.value;
    layerMgr.render();
    layerMgr.persistSoon();
  });
  ctl.scale.addEventListener('input', () => {
    if (syncing || !sel()) return;
    sel().scale = ctl.scale.value / 100;
    ctl.scaleVal.textContent = ctl.scale.value;
    layerMgr.render();
    layerMgr.persistSoon();
  });
  ctl.scaleX.addEventListener('input', () => {
    if (syncing || !sel()) return;
    sel().scaleX = ctl.scaleX.value / 100;
    ctl.scaleXVal.textContent = ctl.scaleX.value;
    layerMgr.render();
    layerMgr.persistSoon();
  });
  ctl.scaleY.addEventListener('input', () => {
    if (syncing || !sel()) return;
    sel().scaleY = ctl.scaleY.value / 100;
    ctl.scaleYVal.textContent = ctl.scaleY.value;
    layerMgr.render();
    layerMgr.persistSoon();
  });
  ctl.rotation.addEventListener('input', () => {
    if (syncing || !sel()) return;
    sel().rotation = parseFloat(ctl.rotation.value);
    ctl.rotationVal.textContent = ctl.rotation.value + '°';
    layerMgr.render();
    layerMgr.persistSoon();
  });

  ctl.colorSeg.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!sel()) return;
      sel().colorMode = btn.dataset.mode;
      layerMgr.rebuild(sel());
    });
  });
  ctl.color.addEventListener('input', () => {
    if (syncing || !sel()) return;
    sel().color = ctl.color.value;
    queueRebuild(sel());
  });

  ctl.knockout.addEventListener('change', () => {
    if (syncing || !sel()) return;
    sel().knockout = ctl.knockout.checked;
    ctl.knockoutGroup.style.display = sel().knockout ? '' : 'none';
    layerMgr.rebuild(sel());
  });
  ctl.knockoutSlider.addEventListener('input', () => {
    if (syncing || !sel()) return;
    sel().knockoutThresh = parseInt(ctl.knockoutSlider.value, 10);
    ctl.knockoutVal.textContent = ctl.knockoutSlider.value;
    queueRebuild(sel());
  });

  ctl.outline.addEventListener('input', () => {
    if (syncing || !sel()) return;
    sel().outlineWidth = parseInt(ctl.outline.value, 10);
    ctl.outlineVal.textContent = ctl.outline.value;
    queueRebuild(sel());
  });
  ctl.outlineColor.addEventListener('input', () => {
    if (syncing || !sel()) return;
    sel().outlineColor = ctl.outlineColor.value;
    queueRebuild(sel());
  });

  ctl.smooth.addEventListener('change', () => {
    if (syncing || !sel()) return;
    sel().epsilon = parseInt(ctl.smooth.value, 10) / 10;
    ctl.smoothVal.textContent = sel().epsilon.toFixed(1);
    if (sel().vectorized) layerMgr.trace(sel());
  });
  ctl.smooth.addEventListener('input', () => {
    ctl.smoothVal.textContent = (parseInt(ctl.smooth.value, 10) / 10).toFixed(1);
  });

  ctl.trace.addEventListener('click', () => {
    if (!sel()) return;
    if (sel().vectorized) layerMgr.untrace(sel());
    else layerMgr.trace(sel());
  });

  ctl.svg.addEventListener('click', () => {
    const layer = sel();
    if (!layer) return;
    const svg = layerMgr.svgFor(layer);
    if (!svg) return;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = layer.name + '.svg';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });

  ctl.del.addEventListener('click', () => {
    if (sel()) layerMgr.remove(sel());
  });

  // keyboard
  window.addEventListener('keydown', (e) => {
    if (!$('modalBackdrop').classList.contains('hidden')) {
      if (e.key === 'Escape') closeModal();
      return;
    }
    if (e.target !== document.body) return;
    if (e.key === 'h' || e.key === 'H' || (e.key === 'Escape' && inStage())) {
      setStage(!inStage());
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel()) {
      e.preventDefault();
      layerMgr.remove(sel());
    }
    if (e.key === ' ') {
      e.preventDefault();
      $('playPauseBtn').click();
    }
    if (e.key === 'p' || e.key === 'P') exportPng();   // still available, just off the toolbar
  });

  // ---------- boot ----------
  renderShaderList();
  const savedActive = localStorage.getItem(LS_ACTIVE);
  if (!savedActive || !findShader(savedActive) || !activateShader(savedActive)) {
    activateShader(BUILTIN_SHADERS[0].id);
  }
  renderLayerUI();

  // audio: restore settings, then resume listening if it was on last session
  // (works without a prompt once permission is granted)
  {
    const s = audioSettings();
    applyFxSettings(s);
    audio.deviceId = s.deviceId || null;
    applySens(s.sens || 10);
    if (!Number.isFinite(s.focus)) applyFocus(70);
    renderFxList();
    syncAudioUI();
    refreshDevices();
    if (s.on) setAudio(true, { silent: true });
  }

  (async () => {
    await layerMgr.restore();          // bring back layers from the previous session
    const presets = await loadPresets();
    // first-ever boot with nothing saved: start from the default preset
    const everBooted = localStorage.getItem('shaderdeck.everBooted');
    localStorage.setItem('shaderdeck.everBooted', '1');
    if (!everBooted && layerMgr.layers.length === 0 && presets.length) {
      try {
        const res = await fetch('presets/' + presets[0].file, { cache: 'no-store' });
        await importScene(await res.json(), { confirmReplace: false });
      } catch (err) { console.warn('Default preset failed to load', err); }
    }
  })();
})();
