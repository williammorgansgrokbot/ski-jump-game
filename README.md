# Ski Jump (v2, modern-iPad build)

Cartoon 3D ski jumping for ages 8-15, built for iPhone and iPad Safari in landscape. One `index.html` (game bundle inlined) plus `art/` and `models/`.

## Run
    npm install
    node tools/build_html.mjs     # bundles src/main.js (Three.js r160 + esbuild, ES2022 IIFE, WebGL2) into index.html
    python3 -m http.server 8765   # open http://localhost:8765/index.html

Quality tiers: new iPads/iPhones and desktop run pixel ratio up to 2, MSAA and 2048 shadow maps (adaptive quality still steps down if frames are slow). `?q=low` forces the legacy low tier (pixel ratio 1.25, 1024 shadows, no MSAA). `?noadapt=1` disables the adaptive quality drop.

## Play
Tap anywhere (or Space) three times per jump: speed meter in the in-run, launch dial at the lip (slow-mo), then landing timing for the telemark. You can't crash. A sloppy landing only costs style points. Score = distance + style. Hill record, last five jumps and unlocked suits/skis are kept in localStorage.

## Ski Park mode
Pick SKI PARK on the title screen (top right), then GO. It's an automatic side-scrolling downhill (about 68 s) that can't crash or fail. Seven painted features come up in order: small kicker (GRAB), rail (RAIL GRIND), medium kicker (BACKFLIP), box (BOX SLIDE), medium kicker (360 SPIN), small kicker (FRONT FLIP) and the big jump (DOUBLE BACKFLIP). Each feature has one big TRICK button (bottom right, or tap anywhere / Space): it lights up 1.5 s before the feature with a shrinking ring, and tapping when the ring closes is PERFECT (+/-0.12 s, x2), GOOD (+/-0.28 s, x1.5) or EARLY/LATE (x1). A missed tap still lands (NICE POP / SLIDE, +50, combo resets). Points = base x timing x combo (+0.25 per trick in a row, up to x2.5). Best park score is saved; Neon Skis unlock at 7,000 and the Aurora Suit at 15,000.
The ride is a deterministic pre-simulation (`simulate()` in `src/park.js`): the surface of each ramp, rail and box is taken from the painted art's top edge (`tools/park_art.py` -> `art/park/park.json`), so the skier rides on the art. Only pose, score and combo depend on the player. QA hooks: `__game.park.info()`, `.setAuto([offsets|'miss'])`, `.pauseAt=[t..]`.

## Layout
- `src/` game code: `main.js` (state machine, cameras, UI), `world.js` (hill, stands, crowd, painted-sprite trees, markers), `trees.js` (instanced billboard trees from `art/trees.webp`, haze shader), `runside.js` (the colourful in-run side graphics: batched painted banners, flags with a wave shader, light posts, signs, gates, pennants, gallery crowd + dogs, glow lanes, coloured sparkles), `sprite_skier.js` (painted sprite skier: billboard, frame player, squash/stretch, contact shadow, lazy-loaded suit atlases), `physics.js` (deterministic flight model), `fx.js`, `audio.js`, `toon.js`.
- `art/sprites/` the sprite atlases (lossless WebP: `suit_<id>_0.webp`, `ski_flame_0.webp`, `ski_rainbow_0.webp`) and `sprites.json` (frame rects, per-frame ski-anchor, fps, loop). `art_src/sprites/` the raw generated sheets.
- `art/side/` painted trackside atlas `side.webp` + `side.json` and the two gates `arch_a.webp`, `arch_b.webp` (`tools/sidegfx.py`; sources in `art_src/side/`). All art is WebP (lossy q86 with alpha, sprites lossless); only the two app icons are PNG.
- `art/park/` painted park features + scenery atlas (`park.webp`, `park.json` with ride-surface profiles, `tools/park_art.py`; sources in `art_src/park/`). `art/sprites/park_*.webp` + `park.json` are the park skier atlases (ride, pop, air, landing, backflip, front flip, 360 spin, grind, grab; `tools/park_sprites.py`), fetched lazily the first time Ski Park is entered. `src/park.js` is the park mode.
- `tools/` build, Blender asset script (gear), `trees.py` (tree sheet → alpha atlas), chroma-key tool, `sprites.py` (sprite pipeline: `python3 tools/sprites.py build`), Playwright QA (`qa.py`, `qa_park.py`).
- `previews/` QA screenshots (title, 4 in-run, lip, flight, preland, landing, celebrate, result) at 844x390, 932x430, 1180x820 and 1366x1024, plus `gameplay_844x390.mp4`. `tools/qa_all.sh` re-runs them; `tools/measure.py` prints load size, draw calls and triangles.

See `CREDITS.md` for asset licenses.
