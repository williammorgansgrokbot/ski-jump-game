# Credits and licenses

| Asset | Source | License |
|---|---|---|
| Skier (all sprite animations: idle/wave, crouch, takeoff, V-flight, pre-landing, telemark, sloppy, skid, fist pump, showboat; six suits; unlock skis) | Painted with the GenerateImage tool as multi-frame sheets on a green key background, using one approved base character sheet as the reference (`art_src/sprites/`). Keyed, sliced, anchored, hue-recoloured per suit (Wyatt, Reid, Brady, Stetson, Gold, Galaxy), bib numbers stamped and packed into PNG atlases + JSON frame map by `tools/sprites.py`. The old Quaternius "Man" 3D skier was removed. No images of real people. | Original work |
| Pine tree ("Pine Tree with Snow") | Quaternius, via poly.pizza (id 17vQv2X5rh) | CC0 1.0. Decimated to ~700 tris (`tools/make_tree.py`). |
| First-person ski tips (`models/gear_ski.glb`) | Modelled in Blender for this game (`tools/make_gear.py`) | Original work |
| Three.js r160 | https://threejs.org | MIT |
| Title logo, title backdrop, crowd sprites, Stormy/Emma dog sprites, banner, medal, trophy, buttons, bunting, ridge, clouds, burst, puff, app icon | Painted with the GenerateImage tool, chroma-keyed to PNG alpha (`tools/key.py`). Raw sources in `art_src/`. Stormy and Emma are cartoon stand-ins for the family dogs, based on the art in the sandlot-derby-aaa project. No images of real people. | Original work |
| Music and sound effects | Synthesised live with WebAudio (`src/audio.js`), 120 Hz high-pass, nothing sampled | Original work |
| "meters" speech | Browser `speechSynthesis` | Device voice |

Fonts: system fonts only.
