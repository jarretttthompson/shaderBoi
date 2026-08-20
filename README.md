# shaderBoi

A local web app that hosts Shadertoy-style shaders as live backdrops and lets you composite
logos/images on top — drag & drop, recolor, outline, and vectorize to SVG.

## Run it

**Hosted:** https://thejrummer.art/shaderBoi/ — deployed from this repo by
`.github/workflows/deploy.yml` on every push to main (GitHub Pages, same pattern as
patchNet/trussLab). Assets are stamped with the commit SHA at deploy time.

**Desktop:** double-click `ShaderBoi.app` on the Desktop — it starts the local server
if needed (via `scripts/launch.sh`) and opens the app.

**Manual:**

```bash
python3 ~/Documents/shaderdeck/serve.py 8402
```

Then open http://localhost:8402. `serve.py` stamps every js/css URL with its file mtime so
browsers can never serve stale app code after an update — prefer it over a plain static
server, though any static server technically works.

## Shader library

- Ships with **Haunted Forest** (Frank Hugenroth, Shadertoy 2013) plus a country-bar set:
  **Ember Drift** (drifting embers), **Prairie Dusk** (sunset over rolling plains),
  **Neon Saloon** (warm bar-light bokeh), **Whiskey Swirl** (slow amber marbling),
  **Starry Plains** (night sky, milky way, shooting stars, fireflies), and
  **Honky-Tonk Beams** (smoky stage-light sweeps with dust).
- Switching shaders **crossfades** over ~2s — both shaders render live during the blend,
  so changes are never abrupt on the bar display.
- **+ ADD SHADER** → paste Shadertoy code (needs `mainImage(out vec4 fragColor, in vec2 fragCoord)`).
  It compiles on save; GLSL errors are shown inline. Custom shaders persist in localStorage.
- Supported uniforms: `iResolution`, `iTime`, `iTimeDelta`, `iFrame`, `iFrameRate`, `iMouse`,
  `iDate`, `iChannel0–3` (all bound to a 256×256 RGBA noise texture, i.e. Shadertoy's
  "RGBA noise" input). Multi-pass (Buffer A/B...), keyboard, video, and cubemap inputs are
  not supported — single-pass image shaders only.

## Logo layers

- **Drag & drop** (or paste) any image — it snaps to the center of the screen (extra files
  cascade slightly). Drag to move; dragging near the center axes snaps magnetically with
  guide lines. Scroll-wheel to scale.
- **Scale / Scale X / Scale Y**: uniform scale plus independent per-axis stretch (5–300%),
  so logos can be widened or squashed without touching the overall size.
- **Color**: ORIG / TINT (recolor, keeps shading) / FILL (solid silhouette) + color picker.
- **Knock out white BG**: strips white backgrounds from JPEGs/flat logos (threshold slider).
- **Outline**: dilated contour outline, width + color.
- **Vectorize**: TRACE → VECTOR converts the silhouette to clean vector paths
  (holes preserved, smoothing slider), toggle back to raster anytime, **SVG ⇩** downloads the file.
- **SCENE ⇩ / SCENE ⇧** (top bar) export/import the whole composition — shader, all layers
  (images embedded), and audio sensitivity — as a single portable `.json` file. Send it to
  anyone; they load it with SCENE ⇧ or by dropping the file onto the page. Press **P** to
  save a PNG snapshot of the composition.
- Space = play/pause shader time, Delete = remove selected layer.

## Presets

Scene files placed in `presets/` and listed in `presets/index.json` appear under **PRESETS**
in the library panel — one click loads shader + layers + audio settings. Ships with
**Southern Social** (Ember Drift + the Southern Social logo, vectorized, centered), which
also auto-loads on a first-ever boot with nothing saved.

## Audio-reactive brightness

**🎙** (top bar) toggles microphone-driven brightness/bloom for the whole composite: the input
level lifts brightness and saturation and blends in a soft bloom glow, with fast attack and
smooth decay. The slider next to it sets sensitivity. The browser asks for mic permission on
first use; the on/off state and sensitivity persist and resume on reload.
- **Layers persist**: every image and all its edits (position, scale, rotation, color, outline,
  knockout, vector state) are saved to the browser's IndexedDB automatically and restored on
  reload. Positions are stored relative to the viewport, so a layout made on a laptop keeps its
  composition on a different-resolution display. Deleting a layer removes it from storage too.

## Stage mode (live display)

For running as a background visualizer (bar/venue): **⛶ STAGE** (top right) goes fullscreen and
hides every control — just the shader and your logos. The cursor auto-hides after a couple of
seconds. Press **Esc** or **H** to bring the controls back; **H** also toggles stage mode without
touching your layout. Set **RES HD** before going on stage if the display is high-DPI and the
machine can keep up; drop to **RES ½×** if the shader is heavy for the hardware.

## Files

- `js/shader-engine.js` — WebGL2 Shadertoy-compatible wrapper
- `js/shaders.js` — built-in shader library
- `js/layers.js` — layer pipeline (knockout → colorize → outline) + canvas compositing
- `js/vectorize.js` — raster→vector tracing (boundary walk + RDP simplification)
- `js/app.js` — UI wiring, library persistence

## Naming note

The app is **shaderBoi** (formerly ShaderDeck). The directory, localStorage keys, IndexedDB
database, and the scene files' internal `"app": "shaderdeck-scene"` identifier keep the old
name on purpose — renaming them would orphan saved shaders/layers and break previously
shared scene files.

## Theme

UI follows the patchNet design language: dichromatic lime (#00ff00) on black, Vulf Mono for
data/chrome and Vulf Sans for body text (local `fonts/`, no external font hosts), subtle
scanlines on shell surfaces.
