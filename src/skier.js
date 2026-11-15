import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toonMat, addOutline, gradient } from './toon.js';
import { buildClips } from './anim.js';

export const SUITS = {
  wyatt:  { num: 7, name: 'Wyatt',  suit: 0xe8302c, trim: 0xffffff, ski: 0xe8302c, helmet: 0xe8302c, skin: 0xf0b894, glove: 0x23232b, lens: 0xff9d2e },
  reid:   { num: 12, name: 'Reid',   suit: 0x2a6df4, trim: 0xffffff, ski: 0x2a6df4, helmet: 0x2a6df4, skin: 0xd99a72, glove: 0x23232b, lens: 0x9be8ff },
  brady:  { num: 5, name: 'Brady',  suit: 0x23b35a, trim: 0xffffff, ski: 0x23b35a, helmet: 0x23b35a, skin: 0xf5c9a6, glove: 0x23232b, lens: 0xffe45c },
  stetson:{ num: 21, name: 'Stetson',suit: 0xffc21a, trim: 0x2b2b35, ski: 0xffc21a, helmet: 0xffc21a, skin: 0xb9805a, glove: 0x23232b, lens: 0xff5fa8 },
};
const OUTLINE_COL = 0x2e1d4a;
let _matcap = null;
function matcapTex() {
  if (_matcap) return _matcap;
  const cv = document.createElement('canvas'); cv.width = cv.height = 128; const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, '#bfe3ff'); g.addColorStop(0.5, '#ffffff'); g.addColorStop(0.62, '#ffb35c'); g.addColorStop(1, '#7a3b9c');
  c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  const r = c.createRadialGradient(44, 38, 2, 44, 38, 30); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = r; c.fillRect(0, 0, 128, 128);
  _matcap = new THREE.CanvasTexture(cv); _matcap.minFilter = _matcap.magFilter = THREE.LinearFilter; _matcap.generateMipmaps = false; return _matcap;
}
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
    this._decorate();
    this._attachGear(assets);
    this.setSuit('wyatt');
    this.mixer = new THREE.AnimationMixer(this.root);
    this.clips = buildClips(this);
    this.actions = {};
    for (const k in this.clips) { const a = this.mixer.clipAction(this.clips[k]); this.actions[k] = a; }
    this.current = null;
    this.play('idle', 0);
  }
  _matOpts(name) {
    if (!this.panels) this.panels = { trim: { value: new THREE.Color(0xffffff) }, accent: { value: new THREE.Color(0x222222) } };
    if (name === 'Shirt' || name === 'Pants') return { panels: this.panels, rim: 0xcfe6ff, rimAmt: 0.28, gloss: 0.12 };
    if (name === 'Skin') return { panels: this.panels, rim: 0xffd9c0, rimAmt: 0.35 };
    if (name === 'Boots') return { rim: 0xcfe6ff, rimAmt: 0.4, gloss: 0.6 };
    if (name === 'Gloves') return { rim: 0xcfe6ff, rimAmt: 0.4, gloss: 0.4 };
    return { rim: 0xffffff, rimAmt: 0.3 };
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
      const tmats = mats.map((m) => { const t = toonMat(m.color, this._matOpts(m.name)); t.name = m.name; this.mats[m.name] = t; return t; });
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
    this.s0 = s; const h0 = new THREE.Vector3(); b.Head.getWorldPosition(h0);
    this.torsoScale = 1.1; this.headScale = 1.62;                         // heroic V-taper + big cartoon head
    if (b.Torso) b.Torso.scale.setScalar(this.torsoScale);
    if (b.Head) b.Head.scale.setScalar(this.headScale / this.torsoScale);
    ['PalmL', 'PalmR'].forEach((n) => { if (b[n]) b[n].scale.setScalar(1.3); });   // chunky gloves
    this.headBoneScale = this.headScale / this.torsoScale; this.model.updateMatrixWorld(true);
    { const h1 = new THREE.Vector3(); b.Head.getWorldPosition(h1); this.model.scale.multiplyScalar(h0.y / h1.y); this.model.position.y = 0.07; }
    this.model.updateMatrixWorld(true);
  }
  // suit panels (per-vertex attribute driven by bone weights + position) and bib numbers
  _decorate() {
    const V = THREE.Vector3; this.model.updateMatrixWorld(true);
    const stats = {}; const pass = [];
    this.meshes.forEach((m) => {
      m.skeleton.update(); const g = m.geometry; const n = g.attributes.position.count; const bi = g.attributes.skinIndex, bw = g.attributes.skinWeight; const mats = Array.isArray(m.material) ? m.material : [m.material];
      const vm = new Array(n).fill(mats[0].name); g.groups.forEach((gr) => { for (let i = gr.start; i < gr.start + gr.count; i++) vm[g.index.getX(i)] = mats[gr.materialIndex].name; });
      const P = new Float32Array(n * 3), B = new Array(n), tmp = new V();
      for (let i = 0; i < n; i++) {
        let best = 0, bwv = -1; const ws = [bw.getX(i), bw.getY(i), bw.getZ(i), bw.getW(i)], is = [bi.getX(i), bi.getY(i), bi.getZ(i), bi.getW(i)];
        for (let k = 0; k < 4; k++) if (ws[k] > bwv) { bwv = ws[k]; best = is[k]; }
        B[i] = san(m.skeleton.bones[best].name);
        m.getVertexPosition(i, tmp); tmp.applyMatrix4(m.matrixWorld); P[i * 3] = tmp.x; P[i * 3 + 1] = tmp.y; P[i * 3 + 2] = tmp.z;
        const st = stats[B[i]] || (stats[B[i]] = { n: 0, cx: 0, cz: 0, y0: 1e9, y1: -1e9 }); st.n++; st.cx += tmp.x; st.cz += tmp.z; st.y0 = Math.min(st.y0, tmp.y); st.y1 = Math.max(st.y1, tmp.y);
      }
      pass.push({ m, g, n, vm, P, B });
    });
    for (const k in stats) { stats[k].cx /= stats[k].n; stats[k].cz /= stats[k].n; }
    const wp = (nm) => { const v = new V(); this.bones[nm].getWorldPosition(v); return v; };
    const arm = {}; ['L', 'R'].forEach((sd) => { arm[sd] = { e: wp('LowerArm' + sd), w: wp('Palm' + sd) }; });
    const bibPts = []; const clamp01 = (v) => Math.max(0, Math.min(1, v)); const R = (v, thr, w) => clamp01((v - thr) / w + 0.5);   // field: 0.5 at the threshold
    pass.forEach(({ g, n, vm, P, B }) => {
      const out = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        const nm = vm[i], b = B[i]; if (nm !== 'Shirt' && nm !== 'Pants' && nm !== 'Skin') continue; const st = stats[b]; const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        const t = (y - st.y0) / Math.max(1e-4, st.y1 - st.y0); const dx = x - st.cx, dz = z - st.cz; const lat = Math.abs(dz) / Math.max(1e-5, Math.hypot(dx, dz)); let tr = 0, ac = 0;
        const side = R(lat, 0.93, 0.06);
        if (nm === 'Skin') { /* none */ }
        else if (b === 'Torso') { ac = R(t, 0.88, 0.06); tr = Math.max(side, Math.min(R(t, 0.47, 0.06), R(-t, -0.63, 0.06))); if (t > 0.3 && t < 0.8 && dx > 0) bibPts.push([x, y, z]); }
        else if (b === 'Abdomen') { ac = R(-t, -0.3, 0.2); }
        else if (b === 'Hips' || b === 'Body') { ac = 0; }
        else if (b.indexOf('Shoulder') === 0) ac = 1;
        else if (b.indexOf('UpperArm') === 0) { const a = arm[b.slice(-1)]; tr = R(lat, 0.94, 0.05) * 0.0; ac = 0; }
        else if (b.indexOf('LowerArm') === 0) { const a = arm[b.slice(-1)]; if (a) { const ax = a.w.clone().sub(a.e), len = ax.lengthSq(); const u = new V(x, y, z).sub(a.e).dot(ax) / Math.max(1e-6, len); tr = R(u, 0.78, 0.1); ac = R(-u, -0.15, 0.15); } }
        else if (b.indexOf('UpperLeg') === 0) { tr = R(lat, 0.9, 0.08); }
        else if (b.indexOf('LowerLeg') === 0) { ac = R(-t, -0.28, 0.1); tr = R(lat, 0.9, 0.08); }
        out[i * 2] = tr; out[i * 2 + 1] = ac;
      }
      { const idx = g.index.array; const nb = Array.from({ length: n }, () => []); for (let k = 0; k < idx.length; k += 3) { const a = idx[k], b2 = idx[k + 1], c2 = idx[k + 2]; nb[a].push(b2, c2); nb[b2].push(a, c2); nb[c2].push(a, b2); }
        let cur = out; for (let it = 0; it < 3; it++) { const nx = new Float32Array(n * 2); for (let i = 0; i < n; i++) { for (let ch = 0; ch < 2; ch++) { let sm = cur[i * 2 + ch], c = 1; const l = nb[i]; for (let q = 0; q < l.length; q++) { sm += cur[l[q] * 2 + ch]; c++; } nx[i * 2 + ch] = sm / c; } } cur = nx; } out.set(cur); }
      g.setAttribute('aPanel', new THREE.BufferAttribute(out, 2));
    });
    // bib planes (front + back) on the torso bone
    let fx = -1e9, bx = 1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9; bibPts.forEach((p) => { fx = Math.max(fx, p[0]); bx = Math.min(bx, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); });
    const cv = document.createElement('canvas'); cv.width = cv.height = 128; this.bibCanvas = cv; this.bibTex = new THREE.CanvasTexture(cv); this.bibTex.minFilter = THREE.LinearFilter; this.bibTex.generateMipmaps = false;
    const bw = (z1 - z0) * 0.62, bh = (y1 - y0) * 0.5, cy = y0 + (y1 - y0) * 0.5;
    this.bibMats = [];
    [[fx + 0.012, Math.PI / 2], [bx - 0.012, -Math.PI / 2]].forEach(([px, ry]) => {
      const mat = new THREE.MeshToonMaterial({ map: this.bibTex, gradientMap: gradient(3), polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }); this.bibMats.push(mat);
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), mat); pl.position.set(px, cy, (z0 + z1) / 2); pl.rotation.y = ry; this.model.parent.add(pl); pl.updateMatrixWorld(true); this.bones.Torso.attach(pl); pl.userData.bib = true;
    });
  }
  _drawBib(num, hex) {
    const c = this.bibCanvas.getContext('2d'); c.clearRect(0, 0, 128, 128); const col = '#' + hex.toString(16).padStart(6, '0');
    c.fillStyle = '#ffffff'; c.beginPath(); c.moveTo(14, 4); c.lineTo(114, 4); c.quadraticCurveTo(124, 4, 124, 14); c.lineTo(124, 114); c.quadraticCurveTo(124, 124, 114, 124); c.lineTo(14, 124); c.quadraticCurveTo(4, 124, 4, 114); c.lineTo(4, 14); c.quadraticCurveTo(4, 4, 14, 4); c.fill();
    c.fillStyle = col; c.fillRect(4, 4, 120, 22); c.lineWidth = 6; c.strokeStyle = '#1b1530'; c.strokeRect(5, 5, 118, 118);
    c.fillStyle = '#1b1530'; c.font = 'bold 84px Arial Black, Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(num), 64, 76); this.bibTex.needsUpdate = true;
  }
  _attachGear(assets) {
    const b = this.bones, V = THREE.Vector3;
    const hp = new V(); b.Head.getWorldPosition(hp);
    const he = new V(); (b.Head_end || b.Head).getWorldPosition(he);
    const headH = Math.max(0.05, he.y - hp.y);
    this.gear = {};
    const mk = (src, matMap0) => { const cache = {}; const matMap = (n, m) => cache[n] || (cache[n] = matMap0(n, m)); const g = src.scene.clone(true); g.traverse((o) => { if (o.isMesh) { const ms = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => matMap(m.name, m)); o.material = Array.isArray(o.material) ? ms : ms[0]; o.castShadow = true; } }); return g; };
    const helmet = mk(assets.helmet, (n) => { const t = toonMat(n === 'HelmetTrim' ? 0x15151c : 0xffffff, n === 'Helmet' ? { rim: 0xdff0ff, rimAmt: 0.55, gloss: 0.95 } : { rim: 0xffffff, rimAmt: 0.3, gloss: n === 'HelmetStripe' ? 0.5 : 0 }); t.name = n; this.mats['H_' + n] = t; return t; });
    const goggles = mk(assets.goggles, (n) => { let t; if (n === 'Lens') { t = new THREE.MeshMatcapMaterial({ color: 0x66c8ff, matcap: matcapTex() }); } else t = toonMat(n === 'GogStrap' ? 0x15151c : 0xffffff, { rim: 0xffffff, rimAmt: 0.3, gloss: 0.5 }); t.name = n; this.mats['G_' + n] = t; return t; });
    // head centre in world (skin head centre is a bit above the Head bone origin)
    const HF = (this.headScale / 1.28) * (this.model.scale.x / this.s0); const headRadius = 0.148 * HF;                              // metres, half-width of the cartoon head
    helmet.scale.setScalar(headRadius); goggles.scale.setScalar(headRadius);
    helmet.position.set(hp.x + 0.03 * HF, hp.y + 0.15 * HF, hp.z); goggles.position.set(hp.x + 0.045 * HF, hp.y + 0.105 * HF, hp.z);
    helmet.traverse((o) => { if (o.isMesh && o.material && o.material.name === 'Collar') o.visible = false; });
    [helmet, goggles].forEach((g) => { g.rotation.y = Math.PI / 2; this.model.parent.add(g); g.updateMatrixWorld(true); b.Head.attach(g); });
    this.gear.helmet = helmet; this.gear.goggles = goggles;
    { // cartoon face: smile and cheeks (decals placed on the measured skin-head front)
      const K = HF / 1.234; const face = new THREE.Group(); this.faceMats = {};
      const mouthM = new THREE.MeshBasicMaterial({ color: 0x5a1f2b, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
      const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.042 * K, 0.0085 * K, 6, 14, Math.PI), mouthM); mouth.rotation.set(0, Math.PI / 2, Math.PI); mouth.position.set(hp.x + 0.238 * K, hp.y + 0.014 * K, hp.z); face.add(mouth);
      const teethM = new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const teeth = new THREE.Mesh(new THREE.CircleGeometry(0.039 * K, 14, Math.PI, Math.PI), teethM); teeth.rotation.y = Math.PI / 2; teeth.position.set(hp.x + 0.236 * K, hp.y + 0.015 * K, hp.z); face.add(teeth);
      const cheekM = new THREE.MeshBasicMaterial({ color: 0xff7f7f, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      [-1, 1].forEach((sd) => { const ch = new THREE.Mesh(new THREE.CircleGeometry(0.026 * K, 12), cheekM); ch.rotation.y = Math.PI / 2 - sd * 0.55; ch.position.set(hp.x + 0.218 * K, hp.y + 0.062 * K, hp.z + sd * 0.085 * K); face.add(ch); });
      this.model.parent.add(face); face.updateMatrixWorld(true); b.Head.attach(face); this.gear.face = face;
    }
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
    const th = 0.0085;
    this.meshes.forEach((m) => addOutline(m, th * 0.9, OUTLINE_COL));
    [helmet, goggles, this.gear.skiL, this.gear.skiR].forEach((g) => { const ms = []; g.traverse((o) => { if (o.isMesh && !o.userData.isOutline) ms.push(o); }); ms.forEach((m) => { if (m.material.name === 'Lens') return; addOutline(m, th * 0.7, OUTLINE_COL); }); });
  }
  setSuit(id) {
    const S = SUITS[id]; this.suitId = id; const M = this.mats;
    const c = (k, hex) => { if (M[k]) M[k].color.setHex(hex); };
    c('Shirt', S.suit); c('Pants', S.suit); c('Skin', S.skin); c('Gloves', S.glove); c('Boots', 0x1b1b24); c('Eyes', 0x1b1b24); c('Hair', S.suit);
    c('H_Helmet', S.helmet); c('H_Collar', S.trim); c('H_HelmetStripe', S.trim); c('H_HelmetTrim', 0x15151c);
    c('G_GogFrame', S.trim); if (M.G_Lens) M.G_Lens.color.setHex(S.lens);
    this.setPanels(S.trim, Math.round(((S.suit >> 16) & 255) * 0.7) * 65536 + Math.round(((S.suit >> 8) & 255) * 0.7) * 256 + Math.round((S.suit & 255) * 0.7));
    if (this.bibCanvas) this._drawBib(S.num, S.suit);
    for (const side of ['L', 'R']) { c('S_SkiTop' + side, S.ski); c('S_SkiBase' + side, 0x15151c); c('S_Binding' + side, 0x2b2b35); c('S_SkiStripe' + side, S.trim); }
  }
  setPanels(trim, accent) { if (this.panels) { this.panels.trim.value.setHex(trim); this.panels.accent.value.setHex(accent); } }
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
