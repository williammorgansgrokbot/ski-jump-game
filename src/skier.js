import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonMat, addOutline, gradient } from './toon.js';
import { buildClips } from './anim.js';

export const SUITS = {
  wyatt:  { name: 'Wyatt',  suit: 0xe8302c, trim: 0xffffff, ski: 0xe8302c, helmet: 0xe8302c, skin: 0xf0b894, glove: 0x23232b, lens: 0xff9d2e },
  reid:   { name: 'Reid',   suit: 0x2a6df4, trim: 0xffffff, ski: 0x2a6df4, helmet: 0x2a6df4, skin: 0xd99a72, glove: 0x23232b, lens: 0x9be8ff },
  brady:  { name: 'Brady',  suit: 0x23b35a, trim: 0xffffff, ski: 0x23b35a, helmet: 0x23b35a, skin: 0xf5c9a6, glove: 0x23232b, lens: 0xffe45c },
  stetson:{ name: 'Stetson',suit: 0xffc21a, trim: 0x2b2b35, ski: 0xffc21a, helmet: 0xffc21a, skin: 0xb9805a, glove: 0x23232b, lens: 0xff5fa8 },
};
const SKIER_H = 1.72;               // metres, standing, before big-head
const san = (n) => n.replace(/[\[\]\.:\/]/g, '');
const loader = new GLTFLoader();
const load = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));

export async function loadSkierAssets(base) {
  base = base || 'models/';
  const [body, helmet, goggles, ski] = await Promise.all([load(base + 'skier_base.glb'), load(base + 'gear_helmet.glb'), load(base + 'gear_goggles.glb'), load(base + 'gear_ski.glb')]);
  return { body, helmet, goggles, ski };
}

export class Skier {
  constructor(assets, opts) {
    opts = opts || {};
    this.quality = opts.quality || 'high';
    this.root = new THREE.Group(); this.root.name = 'skierRoot';
    this.pivot = new THREE.Group(); this.root.add(this.pivot);           // squash/stretch + lean
    this.model = assets.body.scene;                                         // skinned rig
    this.model.rotation.y = Math.PI / 2;                                    // model +Z -> world +X (travel direction)
    this.pivot.add(this.model);
    this.bones = {}; this.meshes = []; this.mats = {};
    this.model.traverse((o) => { if (o.name && !o.isMesh) { this.bones[san(o.name)] = o; if (o.isBone) o.userData.skin = true; } });
    this._prepareBody(assets);
    this._normalizeScale();
    this._attachGear(assets);
    this.setSuit('wyatt');
    this.mixer = new THREE.AnimationMixer(this.root);
    this.clips = buildClips(this);
    this.actions = {};
    for (const k in this.clips) { const a = this.mixer.clipAction(this.clips[k]); this.actions[k] = a; }
    this.current = null;
    this.play('idle', 0);
  }
  _prepareBody(assets) {
    const keep = [];
    this.model.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      // fix flat polka normals from export, drop hidden hair faces
      let g = o.geometry; g.deleteAttribute('normal'); g = mergeVertices(g, 1e-5); g.computeVertexNormals();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const hairIdx = mats.findIndex((m) => m.name === 'Hair');
      if (hairIdx >= 0 && g.groups.length) {
        const idx = g.index.array; const out = []; const groups = []; let pos = 0;
        for (const gr of g.groups) {
          if (gr.materialIndex === hairIdx) continue;
          for (let i = gr.start; i < gr.start + gr.count; i++) out.push(idx[i]);
          groups.push({ start: pos, count: gr.count, materialIndex: gr.materialIndex }); pos += gr.count;
        }
        g.setIndex(out); g.clearGroups(); groups.forEach((x) => g.addGroup(x.start, x.count, x.materialIndex));
      }
      o.geometry = g; o.frustumCulled = false;
      const tmats = mats.map((m) => { const t = toonMat(m.color); t.name = m.name; this.mats[m.name] = t; return t; });
      o.material = Array.isArray(o.material) ? tmats : tmats[0];
      o.castShadow = true; keep.push(o);
    });
    this.meshes = keep;
  }
  _normalizeScale() {
    this.model.updateMatrixWorld(true);
    const box = new THREE.Box3();
    this.meshes.forEach((m) => { m.geometry.computeBoundingBox(); });
    // measure via bones: foot origin to head_end
    const b = this.bones;
    const top = new THREE.Vector3(), bot = new THREE.Vector3();
    b.Head_end ? b.Head_end.getWorldPosition(top) : b.Head.getWorldPosition(top);
    bot.set(0, 0, 0);
    const s = SKIER_H / (top.y || 1);
    this.model.scale.setScalar(s);
    this.model.position.y = 0.07;                                         // boots sit on ski
    if (b.Head) b.Head.scale.setScalar(1.28);                           // cartoon head
    this.model.updateMatrixWorld(true);
  }
  _attachGear(assets) {
    const b = this.bones, V = THREE.Vector3;
    const hp = new V(); b.Head.getWorldPosition(hp);
    const he = new V(); (b.Head_end || b.Head).getWorldPosition(he);
    const headH = Math.max(0.05, he.y - hp.y);
    this.gear = {};
    const mk = (src, matMap0) => { const cache = {}; const matMap = (n, m) => cache[n] || (cache[n] = matMap0(n, m)); const g = src.scene.clone(true); g.traverse((o) => { if (o.isMesh) { const ms = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => matMap(m.name, m)); o.material = Array.isArray(o.material) ? ms : ms[0]; o.castShadow = true; } }); return g; };
    const helmet = mk(assets.helmet, (n) => { const t = toonMat(n === 'HelmetTrim' ? 0x15151c : 0xffffff); t.name = n; this.mats['H_' + n] = t; return t; });
    const goggles = mk(assets.goggles, (n) => { let t; if (n === 'Lens') { t = new THREE.MeshStandardMaterial({ color: 0x66c8ff, roughness: 0.12, metalness: 0.25 }); } else t = toonMat(n === 'GogStrap' ? 0x15151c : 0xffffff); t.name = n; this.mats['G_' + n] = t; return t; });
    // head centre in world (skin head centre is a bit above the Head bone origin)
    const headRadius = 0.148;                              // metres, half-width of the cartoon head
    helmet.scale.setScalar(headRadius); goggles.scale.setScalar(headRadius);
    helmet.position.set(hp.x + 0.03, hp.y + 0.17, hp.z); goggles.position.set(hp.x + 0.03, hp.y + 0.125, hp.z);
    [helmet, goggles].forEach((g) => { g.rotation.y = Math.PI / 2; this.model.parent.add(g); g.updateMatrixWorld(true); b.Head.attach(g); });
    this.gear.helmet = helmet; this.gear.goggles = goggles;
    // skis
    const mkski = (side) => {
      const g = mk(assets.ski, (n) => { const t = toonMat(n === 'SkiBase' ? 0x15151c : n === 'Binding' ? 0x2b2b35 : 0xffffff); t.name = n; this.mats['S_' + n + side] = t; return t; });
      const foot = new V(); b['Foot' + side].getWorldPosition(foot);
      g.position.set(foot.x, 0, foot.z); g.rotation.y = Math.PI / 2; g.scale.setScalar(1.0);
      this.model.parent.add(g); g.updateMatrixWorld(true); b['Foot' + side].attach(g);
      return g;
    };
    this.gear.skiL = mkski('L'); this.gear.skiR = mkski('R');
    // outlines
    const th = 0.012;
    this.meshes.forEach((m) => addOutline(m, th * 0.9));
    [helmet, goggles, this.gear.skiL, this.gear.skiR].forEach((g) => { const ms = []; g.traverse((o) => { if (o.isMesh && !o.userData.isOutline) ms.push(o); }); ms.forEach((m) => { if (m.material.name === 'Lens') return; addOutline(m, th * 0.7); }); });
  }
  setSuit(id) {
    const S = SUITS[id]; this.suitId = id; const M = this.mats;
    const c = (k, hex) => { if (M[k]) M[k].color.setHex(hex); };
    c('Shirt', S.suit); c('Pants', S.suit); c('Skin', S.skin); c('Gloves', S.glove); c('Boots', 0x1b1b24); c('Eyes', 0x1b1b24); c('Hair', S.suit);
    c('H_Helmet', S.helmet); c('H_Collar', S.trim); c('H_HelmetStripe', S.trim); c('H_HelmetTrim', 0x15151c);
    c('G_GogFrame', S.trim); if (M.G_Lens) M.G_Lens.color.setHex(S.lens);
    for (const side of ['L', 'R']) { c('S_SkiTop' + side, S.ski); c('S_SkiBase' + side, 0x15151c); c('S_Binding' + side, 0x2b2b35); c('S_SkiStripe' + side, S.trim); }
  }
  play(name, fade) {
    const next = this.actions[name]; if (!next) return;
    fade = fade == null ? 0.2 : fade;
    next.reset(); next.enabled = true; next.setEffectiveWeight(1); next.setEffectiveTimeScale(1);
    const clip = this.clips[name];
    next.setLoop(clip.userData && clip.userData.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); next.clampWhenFinished = true;
    if (this.current && this.current !== next) { if (fade > 0) { next.crossFadeFrom(this.current, fade, false); } else this.current.stop(); }
    next.play(); this.current = next; this.currentName = name;
  }
  update(dt) { this.mixer.update(dt); }
}
