# Ski Jump (v1, local build, not published)

Cartoon 3D ski jumping for ages 8-15, built for iPhone and iPad Safari in landscape. One `index.html` (game bundle inlined) plus `art/` and `models/`.

## Run
    npm install
    node tools/build_html.mjs     # bundles src/main.js (Three.js r160 + esbuild, ES2018 IIFE) into index.html
    python3 -m http.server 8765   # open http://localhost:8765/index.html

`?q=low` / `?q=high` forces the mobile or desktop quality tier. `?noadapt=1` disables the adaptive quality drop.

## Play
Tap anywhere (or Space) three times per jump: speed meter in the in-run, launch dial at the lip (slow-mo), then landing timing for the telemark. You can't crash. A sloppy landing only costs style points. Score = distance + style. Hill record, last five jumps and unlocked suits/skis are kept in localStorage.

## Layout
- `src/` game code: `main.js` (state machine, cameras, UI), `world.js` (hill, stands, crowd, trees, markers), `sprite_skier.js` (painted sprite skier: billboard, frame player, squash/stretch, contact shadow, lazy-loaded suit atlases), `physics.js` (deterministic flight model), `fx.js`, `audio.js`, `toon.js`.
- `art/sprites/` the sprite atlases (`suit_<id>_0.png`, `ski_flame_0.png`, `ski_rainbow_0.png`) and `sprites.json` (frame rects, per-frame ski-anchor, fps, loop). `art_src/sprites/` the raw generated sheets.
- `tools/` build, Blender asset scripts (gear/tree), chroma-key tool, `sprites.py` (sprite pipeline: `python3 tools/sprites.py build`), Playwright QA (`qa.py`).
- `previews/` QA screenshots at 844x390, 932x430, 667x375, 1180x820 plus `gameplay_844x390.mp4`.

See `CREDITS.md` for asset licenses.
