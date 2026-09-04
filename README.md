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
  **Starry Plains** (night sky, milky way, shooting stars, fireflies),
  **Honky-Tonk Beams** (smoky stage-light sweeps with dust), and **Amber Pulse** (audio-reactive:
  spectrum rings around a bass-driven ember core, beat flashes, treble sparks; idles on a slow
  breath when the mic is off).
- Switching shaders **crossfades** over ~2s — both shaders render live during the blend,
  so changes are never abrupt on the bar display.
- **+ ADD SHADER** → paste Shadertoy code (needs `mainImage(out vec4 fragColor, in vec2 fragCoord)`).
  It compiles on save; GLSL errors are shown inline. Custom shaders persist in localStorage.
- Supported uniforms: `iResolution`, `iTime`, `iTimeDelta`, `iFrame`, `iFrameRate`, `iMouse`,
  `iDate`, `iChannel0–3` (all bound to a 256×256 RGBA noise texture, i.e. Shadertoy's
  "RGBA noise" input). Multi-pass (Buffer A/B...), keyboard, video, and cubemap inputs are
  not supported — single-pass image shaders only.
- **Audio uniforms** (always declared, all zero while the mic is off): `iAudioLevel` (smoothed
  loudness 0–1), `iBass` / `iMid` / `iTreble` (band energies 0–1, auto-gained), `iBeat` (1.0 on a
  bass onset, decaying to 0), and `iAudio` — a 512×2 texture in Shadertoy's sound-input layout
  (row 0 = spectrum, row 1 = waveform, read `.x`). To port a Shadertoy music shader, replace its
  `iChannel0` sound reads with `iAudio`.

## Logo layers

- **Drag & drop** (or paste) any image — it snaps to the center of the screen (extra files
  cascade slightly). Drag to move; dragging near the center axes snaps magnetically with
  guide lines. Scroll-wheel to scale.
- **Scale / Scale X / Scale Y**: uniform scale plus independent per-axis stretch (5–300%),
  so logos can be widened or squashed without touching the overall size.
- **Color**: ORIG / TINT (recolor, keeps shading) / FILL (solid silhouette) + color picker.
- **Knock out white BG**: strips white backgrounds from JPEGs/flat logos (threshold slider).
- **Cut out** (magic wand, as in patchNet's image FX): **CLICK TO CUT**, then click any part of the
  image to remove that connected same-color region; **TOLERANCE** sets how different a color can be
  and still belong to the region. **CUT EDGES** removes everything touching the image border (a quick
  background strip for busy backgrounds the white knockout can't handle). **UNDO CUT** (or **⌘Z**)
  steps back one cut, **CLEAR CUTS** removes them all, and **REVERT TO ORIGINAL** returns the layer
  to the untouched image (cuts, knockout, recolor, outline and vector gone; position and size kept). Cuts are stored as seed points, so they persist, travel in scene files, and
  re-apply before color and vectorize — trace a logo after cutting and the vector follows the cuts.
  Esc leaves cut mode.
- **Outline**: dilated contour outline, width + color.
- **Vectorize**: TRACE → VECTOR converts the silhouette to clean vector paths
  (holes preserved, smoothing slider), toggle back to raster anytime, **SVG ⇩** downloads the file.
- **SCENE ⇩ / SCENE ⇧** (top bar) export/import the whole composition — shader, all layers
  (images embedded), and audio sensitivity — as a single portable `.json` file. Send it to
  anyone; they load it with SCENE ⇧ or by dropping the file onto the page. Press **P** to
  save a PNG snapshot of the composition.
- Space = play/pause shader time, Delete = remove selected layer.

## Stage remote

Entering STAGE mode pops out a small **remote control window** (`remote.html`) so the TV
wall stays clean: switch shaders, load presets, play/pause, toggle the mic, set audio
sensitivity and the BRIGHT / SPEED / PULSE toggles from the popup, with live level, band,
and beat meters. It syncs both ways over a
BroadcastChannel — changes made in either window show in both. Requirements: the popup
must be allowed (the browser may block it the first time), and both windows must be in
the same browser profile. Open `remote.html` directly any time for a second controller.

## Show reliability

While the app is open and visible it holds a **screen wake lock** — the display won't
sleep and the screensaver won't start, so it can run unattended through a show. The lock
re-acquires automatically if the tab is hidden and shown again. (Requires Chrome/Edge 84+
or Safari 16.4+; the console logs "screen wake lock active" on success.)

## Presets

Scene files placed in `presets/` and listed in `presets/index.json` appear under **PRESETS**
in the library panel — one click loads shader + layers + audio settings. Ships with
**Southern Social** (the default on a first-ever boot with nothing saved) and **The High Road**.

**SAVE AS PRESET** stores the current composition under a name you choose. Running from the
local `serve.py` it writes `presets/<slug>.json` and updates `index.json` on the spot (the ✕ on a
preset removes it again); push the repo and the hosted site picks it up. On the static hosted
site the button downloads the file instead, with instructions.

The **search box** at the top of the library filters shaders and presets by name as you type;
Enter loads the first match, Esc clears.

## Audio react

The mic button (top bar) or **MIC OFF/LIVE** in the **AUDIO REACT** section of the library panel
starts listening. The input is analysed ~30× a second into a smoothed **level**, **bass / mid /
treble** band energies (each auto-gained against its own recent peak, so they read the same at
soundcheck and in a packed room) and a **beat** detector (bass onsets above the recent average).
Live meters for all of them sit in the panel and in the stage remote.

- **INPUT** picks the audio device — the built-in mic, or a line-in / loopback device carrying the
  house feed. Device labels appear after the first permission grant. An unplugged remembered
  device falls back to the default input.
- **SENSITIVITY** (panel slider or the one next to the mic button — they are the same control)
  scales how loud the room has to be to hit full level.
- **MUSIC FOCUS** keeps the visuals calm while someone is talking between songs. A detector
  scores how music-like the input is from two cues: sub-bass (kick / bass guitar, below most voice
  fundamentals) relative to the mids where speech lives, and a regular pulse in the recent beats.
  Confidence rises within about a second when music starts and falls over a few seconds when it
  stops, so breakdowns and quiet passages don't drop it. The slider sets how far reactions duck
  when confidence is low: 0 reacts to everything, 100 reacts to music only (default 70). The
  **MUSIC** meter shows the detector's confidence so you can watch it work; if it stays low during
  a song, the room mic probably isn't picking up enough low end — move it or lower the focus.
- **ROOM ADAPT** (on by default) makes the same settings work at soundcheck and in a packed room.
  Loudness is normalised against the loudest recent passage, so "full" always means "as loud as
  it has been lately" rather than a fixed volume, and a slow-tracking noise floor (crowd chatter,
  HVAC) is removed from the level and every band before analysis. With it on, SENSITIVITY 10 is
  neutral: lower values show only the peaks, higher values react to everything above the floor.
- **CLIP** lights when the input hits the converter ceiling. A clipped signal has no dynamics
  left — beats smear and the level sits pinned — so fix it at the source: System Settings → Sound →
  Input → lower the input volume for the MacBook microphone, or move the Mac further from the
  speakers. On recent macOS also open Control Center while the app is listening and set the mic
  mode to **Standard** or **Wide Spectrum**, never *Voice Isolation* (it filters the music out).
- **EFFECTS** is a list of everything the sound can drive. Each row has an on/off checkbox and its
  own **strength** slider (0–200%, 100% = the designed amount), so every effect can be dialed in
  independently. **NONE** clears them all, **DEFAULTS** restores the starting set (brightness,
  bloom, pulse at 100%).
  - *Composite*: **BRIGHTNESS** (brightness + saturation lift), **BLOOM** (soft glow),
    **BEAT FLASH** (glow spikes on beats), **CONTRAST**, **HUE SHIFT** — these color effects hit
    the **shader only**; logo layers are never brightened or tinted by them. Brightness, bloom and
    contrast ride a curved level, so only real peaks push the picture. **BEAT ZOOM** (punches in on
    each beat and eases back over about half a second) and **SHAKE** (a damped camera knock in a
    random direction, harder on bigger hits) move the whole picture, logos included.
  - *Shader*: **TIME WARP** — shader time runs up to 2.6× faster with the level, so any shader
    moves with the music.
  - *Logo*: **PULSE** (logos swell ~6% on beats and breathe with the level), **GLOW** (warm halo
    around the logos on beats), **WOBBLE** (logos rock with the bass). All display-only; saved
    layer geometry is untouched.
  - *Overlay* (drawn behind the logos): **EQ BARS** (mirrored spectrum bars along the bottom),
    **WAVEFORM** (oscilloscope line across the middle).
- Shaders always receive the audio uniforms listed above, whatever the checkboxes say.
- On/off, sensitivity, every effect's state and strength, and the chosen input persist and resume
  on reload; scene files carry sensitivity plus the effect states and strengths. The stage remote
  shows the same list.

### Tuning for a room: record, then play back

**RECORD 45s** (panel or remote, mic must be live) captures the raw mic audio plus the full analysis
log — per-tick loudness, bands, music confidence, beats, clipping, and a spectrum snapshot three
times a second — and downloads both as `shaderboi-room-<time>.webm` and `.analysis.json`. Record
during a song and let someone talk on the mic for part of it. The log shows exactly what the
detector saw, so thresholds can be tuned against the real room without being there.

To tune by ear, pick **AUDIO FILE…** under INPUT and load the recording: it plays on a loop through
the speakers and drives the analysis exactly like the mic would, so every slider and effect can
be dialed in at home against the venue's actual sound. Choose an input device to go back to the mic.

## Layer persistence

Every image and all its edits (position, scale, rotation, color, outline, knockout, vector state)
are saved to the browser's IndexedDB automatically and restored on reload. Positions are stored
as viewport fractions and resolved on every frame, so a layout keeps its composition on a
different-resolution display and stays put when the window is resized or goes fullscreen for
stage mode. Deleting a layer removes it from storage too.

## Stage mode (live display)

For running as a background visualizer (bar/venue): **⛶ STAGE** (top right) goes fullscreen and
hides every control — just the shader and your logos. The cursor auto-hides after a couple of
seconds. Press **Esc** or **H** to bring the controls back; **H** also toggles stage mode without
touching your layout. Set **RES HD** before going on stage if the display is high-DPI and the
machine can keep up; drop to **RES ½×** if the shader is heavy for the hardware.

## Files

- `js/shader-engine.js` — WebGL2 Shadertoy-compatible wrapper (+ audio uniforms / iAudio texture)
- `js/shaders.js` — built-in shader library
- `js/audio.js` — mic analysis: level, bands, beat, Shadertoy sound texture; brightness/bloom effect
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
