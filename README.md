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
- **Pumpkin Moon** (Halloween, audio-reactive): a harvest moon in a purple sky with bats, a
  graveyard hill, a dead tree and rolling fog. The fog breathes with the bass, beats flash
  lightning, treble raises green wisps; it idles on a slow breath with the mic off.
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
- Space = play/pause shader time, Delete = remove selected layer, **A** = applause-o-meter on/off,
  **M** = measure a round, **C** = new contest (see [Applause-o-meter](#applause-o-meter)).

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
**Southern Social** (the default on a first-ever boot with nothing saved), **Southern Social —
Halloween** (the same logo as a bone-white silhouette over Pumpkin Moon; carries the
applause-o-meter settings) and **The High Road**.

**SAVE AS PRESET** stores the current composition under a name you choose. Running from the
local `serve.py` it writes `presets/<slug>.json` and updates `index.json` on the spot (the ✕ on a
preset removes it again); push the repo and the hosted site picks it up. On the static hosted
site the button downloads the file instead, with instructions.

The **search box** at the top of the library filters shaders and presets by name as you type;
Enter loads the first match, Esc clears.

## Applause-o-meter

A crowd-loudness meter for contests (costume contest, dance-off). **APPLAUSE** in the top bar,
**METER** in the library panel, the **A** key, or the stage remote shows it: a big LED ladder with a
huge score takes the upper half of the screen and the logo composition shrinks into the lower half,
so a drum kit in front of the screen hides nothing. Turning it on turns the mic on if it was off.

- It reads the **raw** mic loudness **above 400 Hz**, before ROOM ADAPT and MUSIC FOCUS, on a
  **fixed dB scale**, so every contestant is judged the same however loud the night has been. The
  high-pass takes the kick, bass guitar and sub out of the reading, so a band on the PA counts for
  much less than voices and clapping (it still counts: pause the music while measuring).
  **RANGE** sets how loud the room must be to reach the top of the scale (higher = easier): at
  soundcheck, have a few people cheer and set it so a big cheer reads about 85, then leave it alone
  for the whole contest. The operator hint at the bottom of the window (hidden in stage mode) shows
  the live crowd level in dBFS and where 75 and 100 sit.
- **HEADROOM** (0–30 dB, default 12) is the compressor for a loud room. Scores up to 75 are linear
  in dB; above that, the 9 dB up to the RANGE ceiling *plus* HEADROOM dB are squeezed into the last
  25 points (ratio (9 + headroom) / 9, so 2.3:1 at the default). A room that screams 6 dB louder
  than your calibration reads 93 instead of pinning at 100. 0 dB is the hard top, where the ceiling
  itself reads 100.
- **CLIP** beside the ladder (and the badge in AUDIO REACT) means the Mac's converter is saturated:
  every louder sound then reads the same, and nothing in the app can undo it. Lower the input volume
  in System Settings → Sound → Input until it stays dark through the loudest song.
- **MEASURE** (**M**) runs a timed round (**ROUND**, 3–12 s, default 6): the screen says MAKE SOME
  NOISE with a countdown bar, the number climbs with the loudest moment so far, and at the end the
  score **locks in**, joins the list along the bottom and becomes the mark **TO BEAT** on the
  ladder. Beating it says NEW HIGH SCORE. Between rounds the ladder stays live with a peak hold.
- **NEW CONTEST** (**C**) forgets every score. Turning the meter off keeps them.
- Peaks are taken from a 120 ms follower, so one clap right next to the laptop does not win.
- RANGE, HEADROOM and ROUND persist, and travel in scene files / presets (`applause` block).

Using the MacBook as the microphone works if the Mac sits where it hears the crowd and not inside
a speaker's throw: pause the music while measuring (a playing PA reads as applause), set the
mic mode in Control Center to **Standard** (Voice Isolation strips crowd noise), and if CLIP lights
during the loudest moments lower the input volume in System Settings → Sound → Input. RANGE and
HEADROOM shape the reading; they cannot restore a clipped one.

## Audio react

The mic button (top bar) or **MIC OFF/LIVE** in the **AUDIO REACT** section of the library panel
starts listening. The input is analysed once per displayed frame (60 fps on a normal display,
falling back to a 33 ms timer while the tab is hidden) into a smoothed **level**, **bass / mid /
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
- **SMOOTHING** sets how lazily everything follows the sound. It slows the level and band
  followers (attack and release), softens each beat's attack and lengthens its tail, and every
  effect is interpolated per frame so nothing steps even if the analyser drops a frame. 0 is
  twitchy and instant, 100 is slow gliding swells with soft beats; 40 is the default.
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
  - *Shader FX* — a post-processing pass on the shader output (logos untouched), modelled on
    Procreate's Adjustments menu. Level-driven: **SOFT BLOOM** (Bloom: bright parts spill into a
    real glow), **BURN** (Bloom's Burn slider: highlights flare hotter and saturate while shadows
    deepen), **HALFTONE** (Screen Print dot screen), **GRADIENT MAP** (ember → amber → cream ramp),
    **SHARPEN**, **NOISE** (film grain). Beat-driven: **CHROMATIC** (Chromatic Aberration in
    Perspective mode), **GLITCH** (Artifact row slices plus a Diverge channel split), **ZOOM BLUR**
    (Perspective Blur toward the center), **RIPPLE** (Liquify-style rings from the center). The pass
    only runs while at least one of these is active, so it costs nothing otherwise.
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
touching your layout. **A**, **M** and **C** keep working in stage mode, so a costume contest can
be run from the keyboard with nothing on screen but the show. Set **RES HD** before going on stage
if the display is high-DPI and the machine can keep up; drop to **RES ½×** if the shader is heavy
for the hardware.

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
