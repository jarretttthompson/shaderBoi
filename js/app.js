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
  });

  $('qualitySelect').addEventListener('change', (e) => engine.setResolutionScale(e.target.value));

  let lastReadout = 0;
  engine.onTick = (t) => {
    const now = performance.now();
    if (now - lastReadout > 200) {
      lastReadout = now;
      $('timeReadout').textContent = 't ' + t.toFixed(1) + 's';
    }
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
        xf: l.x / window.innerWidth, yf: l.y / window.innerHeight,
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
      audio: audioSettings(),
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
          x: rec.xf * window.innerWidth,
          y: rec.yf * window.innerHeight,
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
    if (scene.audio && scene.audio.sens) {
      $('audioSens').value = scene.audio.sens;
      audio.sensitivity = scene.audio.sens / 2;
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
    return list;
  }

  // ---------- audio-reactive brightness/bloom ----------
  const audio = new AudioReactive($('vizWrap'), $('bloomGlow'));
  window.audioReact = audio;
  const LS_AUDIO = 'shaderdeck.audio';

  function audioSettings() {
    try { return JSON.parse(localStorage.getItem(LS_AUDIO) || '{}'); } catch { return {}; }
  }
  function saveAudioSettings(on) {
    localStorage.setItem(LS_AUDIO, JSON.stringify({ on, sens: parseInt($('audioSens').value, 10) }));
  }
  function syncAudioUI() {
    $('audioBtnLabel').textContent = audio.enabled ? 'LIVE' : 'OFF';
    $('audioBtn').classList.toggle('live', audio.enabled);
    $('audioSens').classList.toggle('hidden', !audio.enabled);
  }

  async function setAudio(on, opts = {}) {
    if (on && !audio.enabled) {
      try {
        await audio.start();
      } catch (err) {
        console.warn('Microphone unavailable:', err);
        if (!opts.silent) {
          alert('Could not access the microphone.\nCheck the browser’s mic permission for this page.');
        }
        saveAudioSettings(false);
        syncAudioUI();
        return;
      }
    } else if (!on && audio.enabled) {
      audio.stop();
    }
    saveAudioSettings(audio.enabled);
    syncAudioUI();
  }

  $('audioBtn').addEventListener('click', () => setAudio(!audio.enabled));
  $('audioSens').addEventListener('input', () => {
    audio.sensitivity = parseInt($('audioSens').value, 10) / 2;
    saveAudioSettings(audio.enabled);
  });

  {
    const s = audioSettings();
    if (s.sens) $('audioSens').value = s.sens;
    audio.sensitivity = parseInt($('audioSens').value, 10) / 2;
    // resume if it was on last session (works without a prompt once permission is granted)
    if (s.on) setAudio(true, { silent: true });
  }

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

  $('stageBtn').addEventListener('click', () => setStage(true));

  // leaving browser fullscreen (Esc) also leaves stage mode
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && inStage()) setStage(false);
  });

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
