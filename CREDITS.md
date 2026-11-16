# Credits and licenses

| Asset | Source | License |
|---|---|---|
| Skier (all sprite animations: idle/wave, crouch, takeoff, V-flight, pre-landing, telemark, sloppy, skid, fist pump, showboat; six suits; unlock skis) | Painted with the GenerateImage tool as multi-frame sheets on a green key background, using one approved base character sheet as the reference (`art_src/sprites/`). Keyed, sliced, anchored, hue-recoloured per suit (Wyatt, Reid, Brady, Stetson, Gold, Galaxy), bib numbers stamped and packed into lossless-WebP atlases + JSON frame map by `tools/sprites.py`. The old Quaternius "Man" 3D skier was removed. No images of real people. | Original work |
| Ski Park skier animations (ride/carve, pop, air, landing, backflip, front flip, 360 spin, rail/box grind, grab; seven suits + Aurora, Neon skis) | Painted with the GenerateImage tool as multi-frame sheets on a green key background using the same approved base character as the reference (`art_src/park/`), keyed, sliced, uniformly scaled, hue-recoloured and packed into lossless-WebP atlases by `tools/park_sprites.py`. No images of real people. | Original work |
| Ski Park ramps (small/medium/big kickers), rail, box, start and finish gates, trick signs, snowmen | Painted with the GenerateImage tool on a green key background, keyed and packed into one lossy WebP atlas with ride-surface profiles by `tools/park_art.py` (`art_src/park/`). All brands invented. | Original work |
| Trees (8 painted snowy pine / fir sprites) | Painted with the GenerateImage tool (one sheet), keyed and packed by `tools/trees.py` into `art/trees.webp` | Original art, no third-party model. Replaces the old Quaternius pine. |
| First-person ski tips (`models/gear_ski.glb`) | Modelled in Blender for this game (`tools/make_gear.py`) | Original work |
| Three.js r160 | https://threejs.org | MIT |
| Title logo, title backdrop, crowd sprites, Stormy/Emma dog sprites, banner, medal, trophy, buttons, bunting, ridge, clouds, burst, puff, app icon | Painted with the GenerateImage tool, chroma-keyed to PNG alpha (`tools/key.py`). Raw sources in `art_src/`. Stormy and Emma are cartoon stand-ins for the family dogs, based on the art in the sandlot-derby-aaa project. No images of real people. | Original work |
| Trackside graphics for the in-run (sponsor banners with made-up brands, flags, light posts, sign plates, start/speed gates) | Painted with the GenerateImage tool as sheets on a green key background, keyed, sliced and packed into one WebP atlas by `tools/key.py` and `tools/sidegfx.py` (`art_src/side/`). Sign numbers are drawn at runtime. All brands are invented. No real brands or people. | Original work |
| Music and sound effects | Synthesised live with WebAudio (`src/audio.js`), 120 Hz high-pass, nothing sampled | Original work |
| "meters" speech | Browser `speechSynthesis` | Device voice |

Fonts: system fonts only.
