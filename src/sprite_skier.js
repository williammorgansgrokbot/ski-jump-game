import * as THREE from 'three';
import SPR from '../art/sprites/sprites.json';
import PARK from '../art/sprites/park.json';
import { toonMat, addOutline } from './toon.js';

// Painted sprite skier: frames generated as sprite sheets (see tools/sprites.py), drawn on a camera-facing billboard.
export const SUITS = {
  wyatt:   { num: 7,  name: 'Wyatt',   suit: 0xe8302c },
  reid:    { num: 12, name: 'Reid',    suit: 0x2a6df4 },
  brady:   { num: 5,  name: 'Brady',   suit: 0x23b35a },
  stetson: { num: 21, name: 'Stetson', suit: 0xffd21a },
  gold:    { num: 1,  name: 'Gold',    suit: 0xf0a81a },
  aurora:  { num: 88, name: 'Aurora',  suit: 0x2fd6c4 },
  galaxy:  { num: 99, name: 'Galaxy',  suit: 0x8a3fe0 },
};
export const MPP = 0.0080;                         // metres per atlas pixel (ski ~1.9 m, standing figure ~2 m)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const texLoader = new THREE.TextureLoader();
const cache = {};
// two sprite sets: the jump animations (sprites.json) and the ski-park tricks (park.json, fetched only when park mode is used)
const SETS = [{ meta: SPR, pre: '' }, { meta: PARK, pre: 'park_' }];
const ANIMSET = {}; SETS.forEach((st, i) => Object.keys(st.meta.anims).forEach((n) => { ANIMSET[n] = i; }));
function loadAtlas(name, pages) {
  const key = name + '#' + pages; if (cache[key]) return cache[key];
  const one = (pi) => new Promise((res, rej) => texLoader.load('art/sprites/' + name + '_' + pi + '.webp', (t) => {
    t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = false; t.minFilter = t.magFilter = THREE.LinearFilter; t.anisotropy = 1; res(t);
  }, undefined, rej));
  return (cache[key] = Promise.all(Array.from({ length: pages }, (_, i) => one(i))));
}
let _shadowTex = null;
function shadowTex() {
  if (_shadowTex) return _shadowTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 2, 32, 32, 31); g.addColorStop(0, 'rgba(24,40,86,0.62)'); g.addColorStop(0.55, 'rgba(24,40,86,0.38)'); g.addColorStop(1, 'rgba(24,40,86,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  _shadowTex = new THREE.CanvasTexture(cv); _shadowTex.generateMipmaps = false; _shadowTex.minFilter = _shadowTex.magFilter = THREE.LinearFilter; return _shadowTex;
}
const _p = new THREE.Vector3();

export class SpriteSkier {
  constructor() {
    this.root = new THREE.Group(); this.root.name = 'skierRoot';
    this.pivot = new THREE.Group(); this.root.add(this.pivot);      // squash/stretch + pose bias (about the ski anchor)
    this.board = new THREE.Group(); this.pivot.add(this.board);     // billboard yaw/tilt (about the ski anchor)
    const geo = new THREE.PlaneGeometry(1, 1);
    const mk = (order) => { const m = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.02, depthWrite: false, fog: false, toneMapped: false }); const mesh = new THREE.Mesh(geo, m); mesh.renderOrder = order; mesh.visible = false; mesh.frustumCulled = false; this.board.add(mesh); return mesh; };
    this.body = mk(8); this.skis = mk(9);
    // soft contact shadow lying on the snow (lives beside the root, not under it, so it stays flat while the sprite rotates)
    const sg = new THREE.PlaneGeometry(1, 1); sg.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ map: shadowTex(), transparent: true, depthWrite: false, fog: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.shadow.renderOrder = 2; this.shadow.frustumCulled = false;
    this.ground = () => ({ y: 0, ang: 0 });
    this.cur = null; this.t = 0; this.last = -1; this.fpOn = false; this.suitId = null; this.skiKind = null; this.bias = 0; this.time = 0;
    this.suitTex = [null, null]; this.skiTex = [null, null]; this.parkOn = false; this.extraRot = 0; this.air = false; this.frameIdx = 0;
    this.sq = { x: 0, v: 0 };
    this.sx = 1; this.pitch = 0;
    this.play('idle', 0);
  }
  attach(scene) { scene.add(this.root); scene.add(this.shadow); }
  _loadSet(si, kind, id) {          // kind 'suit' | 'ski'; returns a promise
    const st = SETS[si]; const name = st.pre + kind + '_' + id;
    return loadAtlas(name, st.meta.pages.length).then((t) => { if (kind === 'suit' ? this.suitId !== id : this.skiKind !== id) return; (kind === 'suit' ? this.suitTex : this.skiTex)[si] = t; this.last = -1; this._apply(); });
  }
  setSuit(id) {
    if (!SUITS[id]) id = 'wyatt';
    if (id === this.suitId) return Promise.resolve(); this.suitId = id; this.suitTex = [null, null]; this.body.visible = true;
    return Promise.all([this._loadSet(0, 'suit', id), this.parkOn ? this._loadSet(1, 'suit', id) : null]);
  }
  setSkis(kind) {
    this.skiKind = kind || null; this.skiTex = [null, null];
    if (!kind) { this.skis.visible = false; return Promise.resolve(); }
    this.skis.visible = true;
    return Promise.all([this._loadSet(0, 'ski', kind), this.parkOn ? this._loadSet(1, 'ski', kind) : null]);
  }
  ensurePark() {                      // lazy: fetch the park atlas (current suit + skis) the first time park mode is entered
    this.parkOn = true; const jobs = [];
    if (this.suitId) jobs.push(this._loadSet(1, 'suit', this.suitId)); if (this.skiKind) jobs.push(this._loadSet(1, 'ski', this.skiKind));
    return Promise.all(jobs);
  }
  fp(on) { this.fpOn = !!on; this.root.visible = !on; this.shadow.visible = !on; }
  play(name, fade, force) {
    if (ANIMSET[name] == null) return; if (this.cur === name && !force) return;
    this.frameOverride = null; this.cur = name; this.t = 0; this.last = -1; this.air = !!SETS[ANIMSET[name]].meta.anims[name].air; this._apply();
    this.bias = name === 'flight' ? -0.05 : 0;
  }
  kick(a) { this.sq.x = a; this.sq.v = 0; }       // + stretch, - squash (springs back)
  setFrame(i) { this.frameOverride = i; this.last = -1; this._apply(); }      // park code drives tumbling/spin frames directly
  _apply() {
    const si = ANIMSET[this.cur]; if (si == null) return; const meta = SETS[si].meta; const A = meta.anims[this.cur]; if (!A) return;
    const n = A.frames.length; let i;
    if (this.frameOverride != null) i = Math.max(0, Math.min(n - 1, this.frameOverride));
    else { i = Math.floor(this.t * A.fps); i = A.loop ? i % n : Math.min(n - 1, i); }
    if (i === this.last && this.lastSet === si) return; this.last = i; this.lastSet = si; this.frameIdx = i;
    const f = A.frames[i]; const PG = meta.pages[f.p];
    const bt = this.suitTex[si], st = this.skiTex[si];
    [[this.body, bt && bt[f.p]], [this.skis, st && st[f.p]]].forEach(([m, tex]) => {
      if (!tex) { if (m === this.body) m.visible = false; return; }
      if (m === this.body) m.visible = true;
      tex.repeat.set(f.w / PG.w, f.h / PG.h); tex.offset.set(f.x / PG.w, 1 - (f.y + f.h) / PG.h);
      if (m.material.map !== tex) { m.material.map = tex; m.material.needsUpdate = true; }
      m.position.set((f.w / 2 - f.ax) * MPP, (f.ay - f.h / 2) * MPP, 0); m.scale.set(f.w * MPP, f.h * MPP, 1);
    });
  }
  update(dt) {
    this.time += dt; this.t += dt; this._apply();
    // squash / stretch spring
    const s = this.sq; s.v += (-190 * s.x - 17 * s.v) * dt; s.x += s.v * dt; s.x = clamp(s.x, -0.45, 0.45);
    this.pivot.scale.set(1 - s.x * 0.55, 1 + s.x, 1);
    // gentle wind wobble in flight + tiny breathing elsewhere
    this.pivot.rotation.z = this.bias + this.extraRot + (this.cur === 'flight' ? Math.sin(this.time * 5.2) * 0.035 + Math.sin(this.time * 8.3) * 0.015 : 0);
    // contact shadow
    const r = this.root.position, g = this.ground(r.x); const h = Math.max(0, r.y - g.y); const sc = this.root.scale.x;
    this.shadow.position.set(r.x + 0.15 * sc, g.y + 0.04, r.z); this.shadow.rotation.z = -g.ang;
    const k = (2.5 + h * 0.18) * sc; this.shadow.scale.set(k, 1, 0.9 * sc * (1 + h * 0.05));
    this.shadow.material.opacity = clamp(1 - h * 0.075, 0.18, 1);
  }
  // face the camera: yaw clamped so side-on sprites never get razor thin, slight tilt to match the camera's elevation
  billboard(cam) {
    this.root.getWorldPosition(_p);
    const dx = cam.position.x - _p.x, dy = cam.position.y - (_p.y + 1), dz = cam.position.z - _p.z;
    const yaw = clamp(Math.atan2(dx, dz), -0.38, 0.38) * 0.8, tilt = clamp(Math.atan2(dy, Math.hypot(dx * 0.3, dz)), -0.2, 0.7) * 0.8;
    this.board.rotation.set(tilt, yaw, 0, 'YXZ');
  }
}

// ---- first-person ski tips (3D, from gear_ski.glb) --------------------------------------------------
export function makeFPSkis(gltf) {
  const mats = {};
  const mk = (sd) => {
    const g = gltf.scene.clone(true);
    g.traverse((o) => { if (!o.isMesh) return; const m = (Array.isArray(o.material) ? o.material[0] : o.material); const n = m.name || '';
      if (!mats[n]) { const col = n === 'SkiBase' ? 0x15151c : n === 'Binding' ? 0x2b2b35 : 0xffffff; mats[n] = toonMat(col); mats[n].name = n; }
      o.material = mats[n]; o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; });
    const ms = []; g.traverse((o) => { if (o.isMesh && !o.userData.isOutline) ms.push(o); }); ms.forEach((m) => addOutline(m, 0.006, 0x2e1d4a));
    return g;
  };
  const look = { kind: null };
  const setKind = (kind) => { look.kind = kind || null; const t = mats.SkiTop, st = mats.Binding; if (!t) return; t.color.setHex(kind === 'flame' ? 0xff7a1a : 0x5a2ca0); };
  const tick = (time) => { if (look.kind === 'rainbow' && mats.SkiTop) mats.SkiTop.color.setHSL((time * 0.4) % 1, 0.9, 0.55); };
  return { mk, mats, setKind, tick };
}
