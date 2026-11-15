# Ski Jump (v2, modern-iPad build)

Cartoon 3D ski jumping for ages 8-15, built for iPhone and iPad Safari in landscape. One `index.html` (game bundle inlined) plus `art/` and `models/`.

## Run
    npm install
    node tools/build_html.mjs     # bundles src/main.js (Three.js r160 + esbuild, ES2022 IIFE, WebGL2) into index.html
    python3 -m http.server 8765   # open http://localhost:8765/index.html

Quality tiers: new iPads/iPhones and desktop run pixel ratio up to 2, MSAA and 2048 shadow maps (adaptive quality still steps down if frames are slow). `?q=low` forces the legacy low tier (pixel ratio 1.25, 1024 shadows, no MSAA). `?noadapt=1` disables the adaptive quality drop.

## Play
Tap anywhere (or Space) three times per jump: speed meter in the in-run, launch dial at the lip (slow-mo), then landing timing for the telemark. You can't crash. A sloppy landing only costs style points. Score = distance + style. Hill record, last five jumps and unlocked suits/skis are kept in localStorage.

## Layout
- `src/` game code: `main.js` (state machine, cameras, UI), `world.js` (hill, stands, crowd, trees, markers), `runside.js` (the colourful in-run side graphics: batched painted banners, flags with a wave shader, light posts, signs, gates, pennants, gallery crowd + dogs, glow lanes, coloured sparkles), `sprite_skier.js` (painted sprite skier: billboard, frame player, squash/stretch, contact shadow, lazy-loaded suit atlases), `physics.js` (deterministic flight model), `fx.js`, `audio.js`, `toon.js`.
- `art/sprites/` the sprite atlases (lossless WebP: `suit_<id>_0.webp`, `ski_flame_0.webp`, `ski_rainbow_0.webp`) and `sprites.json` (frame rects, per-frame ski-anchor, fps, loop). `art_src/sprites/` the raw generated sheets.
- `art/side/` painted trackside atlas `side.webp` + `side.json` and the two gates `arch_a.webp`, `arch_b.webp` (`tools/sidegfx.py`; sources in `art_src/side/`). All art is WebP (lossy q86 with alpha, sprites lossless); only the two app icons are PNG.
- `tools/` build, Blender asset scripts (gear/tree), chroma-key tool, `sprites.py` (sprite pipeline: `python3 tools/sprites.py build`), Playwright QA (`qa.py`).
- `previews/` QA screenshots (title, 4 in-run, lip, flight, preland, landing, celebrate, result) at 844x390, 932x430, 1180x820 and 1366x1024, plus `gameplay_844x390.mp4`. `tools/qa_all.sh` re-runs them; `tools/measure.py` prints load size, draw calls and triangles.

See `CREDITS.md` for asset licenses.
