// SKI PARK: automatic side-scrolling downhill run with 7 painted park features. The ride is a deterministic pre-simulation
// (can't crash or fail); the player only times the TRICK tap for each feature. Ramps/rails/boxes are painted sprites and the
// riding surface is taken from the painted top-edge outline (tools/park_art.py -> art/park/park.json).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import PJ from '../art/park/park.json';
import { Batch, rectUV, rectAspect, flagMaterial, sideTime, waveU } from './runside.js';
import { bobMat, bobTick } from './world.js';
import { Spray, Confetti } from './fx.js';
import * as A from './audio.js';

const D2R = Math.PI / 180;
const sstep = (k) => { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const V3 = THREE.Vector3;
export const PARK_UNLOCKS = [
  { id: 'neon', name: 'Neon Skis', need: 7000, kind: 'ski' },
  { id: 'aurora', name: 'Aurora Suit', need: 15000, kind: 'suit' },
];

// ------------------------------------------------------------------ course
const V_RUN = 11.5, X_START = 14, X_FIN = 700;
const slopeDeg = (x) => 5 + 6 * sstep((x - 35) / 45) - 7.5 * sstep((x - (X_FIN - 90)) / 70);
const GX0 = -140, GSTEP = 0.25, GN = Math.ceil((X_FIN + 280 - GX0) / GSTEP); const GY = new Float32Array(GN + 1);
{ let y = 0; for (let i = 0; i <= GN; i++) { GY[i] = y; y -= Math.tan(slopeDeg(GX0 + i * GSTEP + GSTEP / 2) * D2R) * GSTEP; } }
export function groundY(x) { const f = (x - GX0) / GSTEP; const i = clamp(Math.floor(f), 0, GN - 1); const k = f - i; return GY[i] * (1 - k) + GY[i + 1] * k; }
const groundAng = (x) => -slopeDeg(x) * D2R;

// kind: kick (ramp + airtime), rail / box (ride the painted top, grind)
const FEATS = [
  { id: 'grab',  art: 'kick_s', kind: 'kick', x0: 78,  W: 4.2, name: 'GRAB',            say: 'Grab!',           base: 300,  tair: 1.05, t: 'grab' },
  { id: 'rail',  art: 'rail',   kind: 'rail', x0: 160, W: 9.5, name: 'RAIL GRIND',      say: 'Rail grind!',     base: 400,  t: 'grind' },
  { id: 'back',  art: 'kick_m', kind: 'kick', x0: 250, W: 5.6, name: 'BACKFLIP',        say: 'Backflip!',       base: 500,  tair: 1.3,  t: 'back', revs: 1 },
  { id: 'box',   art: 'box',    kind: 'box',  x0: 338, W: 8,   name: 'BOX SLIDE',       say: 'Box slide!',      base: 400,  t: 'grind' },
  { id: 'spin',  art: 'kick_m', kind: 'kick', x0: 428, W: 5.6, name: '360 SPIN',        say: 'Three sixty!',    base: 600,  tair: 1.35, t: 'spin' },
  { id: 'front', art: 'kick_s', kind: 'kick', x0: 512, W: 4.6, name: 'FRONT FLIP',      say: 'Front flip!',     base: 700,  tair: 1.2,  t: 'front', revs: 1 },
  { id: 'big',   art: 'kick_b', kind: 'kick', x0: 596, W: 9.5, name: 'DOUBLE BACKFLIP', say: 'Double backflip!', base: 1500, tair: 2.0,  t: 'back', revs: 2 },
];
const QMULT = { PERFECT: 2, GOOD: 1.5, EARLY: 1, LATE: 1 };
const WIN_EARLY = 1.5, WIN_LATE = 0.55, PERF = 0.12, GOODW = 0.28;

function layoutFeature(F) {
  const r = PJ.r[F.art], prof = PJ.prof[F.art], N = prof.length; const W = F.W, H = W * r[3] / r[2];
  const th = slopeDeg(F.x0 + W / 2) * D2R, y0 = groundY(F.x0), c = Math.cos(th), s = Math.sin(th);
  const T = (lx, ly) => [F.x0 + lx * c + ly * s, y0 - lx * s + ly * c];
  const sink = 0.5 * prof[0] * H; const L = [[-1.0, 0], [-0.35, 0]]; const mx = Math.max(...prof);
  const lxOf = (i) => (i + 0.5) / N * W; let lipAng = 0.8, sOn = null, plat = null, iend = N - 1;
  if (F.kind === 'kick') {
    let iL = prof.findIndex((v) => v >= 0.965 * mx); if (iL < 0) iL = N - 1;
    for (let i = 0; i <= iL; i++) L.push([lxOf(i), Math.max(0, prof[i] * H - sink - 0.05 * H)]);
    const a = L[L.length - 6], b = L[L.length - 1]; lipAng = Math.atan2(b[1] - a[1], b[0] - a[0]);
  } else {
    let sum = 0, cnt = 0; for (let i = Math.floor(N * 0.5); i < Math.floor(N * 0.9); i++) { sum += prof[i]; cnt++; } plat = sum / cnt;
    const iw = prof.findIndex((v) => v >= 0.93 * plat); for (let i = N - 1; i >= 0; i--) if (prof[i] >= 0.85 * plat) { iend = i; break; }
    for (let i = 0; i <= iw; i++) L.push([lxOf(i), Math.max(0, prof[i] * H - sink - 0.045 * H)]);
    const yp = plat * H - sink - 0.045 * H; L.push([lxOf(iw) + 0.05, yp]); L.push([lxOf(iend), yp]);
  }
  const pts = L.map((p) => T(p[0], p[1])); const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  if (F.kind !== 'kick') { sOn = cum[cum.length - 2]; }
  const ang = L.map((p, i) => { const a = L[Math.max(0, i - 1)], b = L[Math.min(L.length - 1, i + 1)]; return Math.atan2(b[1] - a[1], b[0] - a[0]) - th; });
  return { F, W, H, th, y0, sink, corners: [T(0, -sink), T(W, -sink), T(W, H - sink), T(0, H - sink)], pts, cum, ang, total: cum[cum.length - 1], sOn, lipAng: lipAng - th, entryX: pts[0][0] };
}
const LAY = FEATS.map(layoutFeature);
function routeAt(lay, s) {
  const { cum, pts, ang } = lay; s = clamp(s, 0, lay.total); let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
  const k = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]); return { x: pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, y: pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k, a: ang[i - 1] + (ang[i] - ang[i - 1]) * k, plat: lay.sOn != null && s >= lay.sOn };
}

// deterministic pre-simulation: mode 0 ground, 1 air, 2 ramp/wedge, 3 on rail/box
export function simulate() {
  const dt = 1 / 120; const S = { dt, t: [], x: [], y: [], vx: [], vy: [], m: [], a: [], ev: LAY.map(() => ({})) };
  let t = 0, x = X_START, y = groundY(x), v = 0, mode = 0, fi = 0, rs = 0, vx = 0, vy = 0, g = 16, a = groundAng(x), stopT = null, rel = 0;
  for (let n = 0; n < 120 * 140; n++) {
    let mm = mode;
    if (mode === 0) {
      if (x >= X_FIN && S.tFin == null) S.tFin = t;
      if (x >= X_FIN + 14) { v = Math.max(0, v - 5.5 * dt); if (v <= 0 && stopT == null) stopT = t; }
      else if (t < 2.4) v = V_RUN * Math.pow(Math.min(1, t / 2.4), 0.75); else v += (V_RUN - v) * Math.min(1, dt * 2.2);
      const th = slopeDeg(x) * D2R; x += v * Math.cos(th) * dt; y = groundY(x); a = -th; vx = v * Math.cos(th); vy = -v * Math.sin(th);
      if (fi < LAY.length && x >= LAY[fi].entryX) { mode = 2; rs = 0; S.ev[fi].tEnter = t; }
    } else if (mode === 2 || mode === 3) {
      const L = LAY[fi]; v += (V_RUN - v) * Math.min(1, dt * 2); rs += v * dt; const p = routeAt(L, rs); x = p.x; y = p.y; a = p.a; vx = v * Math.cos(a); vy = v * Math.sin(a);
      if (L.sOn != null && rs >= L.sOn && mode === 2) { mode = 3; S.ev[fi].tOn = t; }
      mm = mode;
      if (rs >= L.total) {
        S.ev[fi].tRel = t; rel = t;
        if (L.F.kind === 'kick') { const phi = clamp(L.lipAng, 36 * D2R, 52 * D2R); vx = v * Math.cos(phi); vy = v * Math.sin(phi); g = 2 * v * Math.sin(phi) / L.F.tair; }
        else { vx = v * Math.cos(L.ang[L.ang.length - 1]); vy = v * Math.sin(L.ang[L.ang.length - 1]); g = 18; }
        mode = 1; mm = 1;
      }
    } else {
      x += vx * dt; y += vy * dt; vy -= g * dt; a = Math.atan2(vy, vx);
      if (vy < 0 && t - rel > 0.2 && y <= groundY(x)) { y = groundY(x); mode = 0; S.ev[fi].tLand = t; fi++; v = V_RUN * 0.88; }
    }
    S.t.push(t); S.x.push(x); S.y.push(y); S.vx.push(vx); S.vy.push(vy); S.m.push(mm); S.a.push(a);
    t += dt; if (stopT != null && t > stopT + 0.15) break;
  }
  S.dur = stopT != null ? stopT : t;
  S.at = (tt) => { const f = clamp(tt / dt, 0, S.t.length - 1.001); const i = Math.floor(f), k = f - i; const L = (arr) => arr[i] * (1 - k) + arr[i + 1] * k;
    return { x: L(S.x), y: L(S.y), vx: L(S.vx), vy: L(S.vy), m: S.m[i], a: L(S.a) }; };
  S.target = LAY.map((l, j) => (l.F.kind === 'kick' ? S.ev[j].tRel : S.ev[j].tOn));
  return S;
}

// ------------------------------------------------------------------ scenery
const TINTS = [0xffb3d9, 0xb7f2d0, 0xa9d4ff, 0xffe9a0, 0xd6bcff, 0xffc7a3].map((h) => new THREE.Color(h));
function terrainY(x, z) { const g = groundY(x); if (z <= 1.3) return g + (z < -6 ? 0.05 * Math.pow(-z - 6, 1.2) : 0) + (z < -10 ? 0.35 * Math.sin(x * 0.05 + z * 0.1) : 0); return g - (z - 1.3) * 60; }
function vcBox(w, h, d, x, y, z, color) { const g = new THREE.BoxGeometry(w, h, d); g.deleteAttribute('uv'); g.translate(x, y, z); const c = new THREE.Color(color); const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }
const lambertVC = (o) => new THREE.MeshLambertMaterial(Object.assign({ vertexColors: true }, o || {}));

function buildScene(tex, pineGeo, Q) {
  const scene = new THREE.Scene(); const park = { scene, mats: {}, dogs: [], clouds: [] };
  const HOR = 0xf6efff; scene.background = new THREE.Color(0x5db8ff); scene.fog = new THREE.Fog(HOR, 90, 520);
  // sky dome (follows the camera) + two painted mountain layers + clouds, all drifting at different rates for parallax
  const skyMat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { top: { value: new THREE.Color(0x1558f0) }, mid: { value: new THREE.Color(0x46b8ff) }, hor: { value: new THREE.Color(HOR) } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 hor; varying vec3 vD; void main(){ float h = clamp(vD.y,0.0,1.0); vec3 c = mix(hor, mid, smoothstep(0.0,0.22,h)); c = mix(c, top, smoothstep(0.18,0.8,h)); gl_FragColor = vec4(c,1.0);\n#include <colorspace_fragment>\n}' });
  park.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 16), skyMat); park.sky.renderOrder = -10; park.sky.frustumCulled = false; scene.add(park.sky);
  park.layers = [];
  if (tex.ridge) {
    [[-640, 1500, 260, 0xe2d2ff, 0.985, 0.98, -8, -6], [-300, 760, 150, 0xffd6ec, 0.9, 0.93, -26, -5.5]].forEach(([z, w, h, col, fx, fy, yo, ro]) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex.ridge, transparent: true, depthWrite: false, fog: false, color: col })); m.position.z = z; m.renderOrder = ro; m.frustumCulled = false; scene.add(m); park.layers.push({ m, fx, fy, yo, h });
    });
  }
  if (tex.cloud) for (let i = 0; i < 7; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.cloud, fog: false, transparent: true, depthWrite: false, opacity: 0.95 })); const sc = 90 + (i % 3) * 40; sp.scale.set(sc, sc * 0.55, 1); sp.renderOrder = -4; sp.position.z = -380 - (i % 3) * 60; scene.add(sp); park.clouds.push({ sp, ox: (i - 3) * 190, oy: 55 + (i % 4) * 22, f: 0.9 + (i % 3) * 0.02, sp0: 0.6 + (i % 3) * 0.4 }); }
  scene.add(new THREE.HemisphereLight(0xe6f2ff, 0xc2d4f0, 2.1)); const sun = new THREE.DirectionalLight(0xfff1d6, 2.4); sun.position.set(30, 60, 45); scene.add(sun);
  // snow terrain with pastel colour bands, a front cliff skirt, painted lane dashes
  {
    const xs = []; for (let x = -120; x <= X_FIN + 240; x += 6) xs.push(x); const zs = [-170, -100, -60, -34, -18, -10, -5, -1.5, 0.6, 1.3, 1.5];
    const nx = xs.length, nz = zs.length; const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), idx = [];
    const white = new THREE.Color(0xf6faff), blue = new THREE.Color(0xc7dcf4), cliff = new THREE.Color(0x7aa0d8), c = new THREE.Color();
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const x = xs[i], z = zs[j]; const k = (i * nz + j) * 3; pos[k] = x; pos[k + 1] = j === nz - 1 ? groundY(x) - 40 : terrainY(x, z); pos[k + 2] = z;
      c.copy(white); const az = -z;
      if (j === nz - 1) c.copy(cliff); else if (z < -5) { const band = Math.floor((az + x * 0.12) / 11); c.lerp(TINTS[((band % 6) + 6) % 6], 0.55 * sstep((az - 5) / 8) * (1 - 0.55 * sstep((az - 70) / 80))); c.lerp(blue, 0.15 * sstep((az - 20) / 120)); }
      else c.lerp(blue, 0.08 + 0.08 * ((Math.floor(x / 9)) % 2));
      c.offsetHSL(0, 0, 0.025 * Math.sin(x * 0.19 + z * 0.23)); col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
    }
    for (let i = 0; i < nx - 1; i++) for (let j = 0; j < nz - 1; j++) { const a = i * nz + j, b = a + 1, c2 = a + nz, d = c2 + 1; idx.push(a, b, c2, b, d, c2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, lambertVC({ side: THREE.DoubleSide })));
    // coloured dash markings along the course (rainbow lane)
    const dg = []; const RB = [0xff5d73, 0xffb23f, 0xffe14a, 0x5be37d, 0x45b6fe, 0xb28bff];
    for (let x = X_START - 20, i = 0; x < X_FIN + 60; x += 5, i++) {
      for (const [z0, z1] of [[-1.55, -1.25], [-2.05, -1.75]]) { const x1 = x + 3.2; const y0 = groundY(x) + 0.03, y1 = groundY(x1) + 0.03; const cc = new THREE.Color(RB[(i + (z0 < -2 ? 3 : 0)) % 6]);
        const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute([x, y0, z0, x, y0, z1, x1, y1, z0, x1, y1, z1], 3)); pg.setAttribute('color', new THREE.Float32BufferAttribute([cc.r, cc.g, cc.b, cc.r, cc.g, cc.b, cc.r, cc.g, cc.b, cc.r, cc.g, cc.b], 3)); pg.setIndex([0, 1, 2, 1, 3, 2]); pg.computeVertexNormals(); dg.push(pg); }
    }
    scene.add(new THREE.Mesh(mergeGeometries(dg, false), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })));
  }
  // painted features
  if (tex.park) {
    const fb = new Batch();
    LAY.forEach((L) => { const c = L.corners; fb.quad4(new V3(c[0][0], c[0][1], 0), new V3(c[1][0], c[1][1], 0), new V3(c[2][0], c[2][1], 0), new V3(c[3][0], c[3][1], 0), rectUV(L.F.art, PJ)); });
    const m = new THREE.Mesh(fb.geometry(), new THREE.MeshBasicMaterial({ map: tex.park, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide })); m.renderOrder = 1; scene.add(m);
    // gates / signs / snowmen (front-facing painted billboards behind the line)
    const sb = new Batch(); const put = (name, x, w, z, lift) => { const a = rectAspect(name, PJ); const h = w / a; const y = groundY(x) - 0.1 + (lift || 0); const th = slopeDeg(x) * D2R;
      const c = Math.cos(th), s = Math.sin(th); sb.quad4(new V3(x - w / 2 * c, y + w / 2 * s, z), new V3(x + w / 2 * c, y - w / 2 * s, z), new V3(x + w / 2 * c - h * s * 0.0, y - w / 2 * s + h, z), new V3(x - w / 2 * c, y + w / 2 * s + h, z), rectUV(name, PJ)); };
    put('start', X_START + 6, 8, -1.3); put('finish', X_FIN, 8, -1.3);
    [FEATS[0], FEATS[2], FEATS[4], FEATS[6]].forEach((F) => put('trick', F.x0 - 34, 3.4, -2.8));
    [40, 190, 380, 560, 640, X_FIN + 22].forEach((x, i) => put('snowman', x, 2.2, -3.8 - (i % 2) * 1.2));
    const sm = new THREE.Mesh(sb.geometry(), new THREE.MeshBasicMaterial({ map: tex.park, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide })); sm.renderOrder = 0; scene.add(sm);
  }
  // sponsor fence, flags, light posts (the colourful side atlas shared with the in-run), crowd galleries, dogs
  if (tex.side) {
    const fb = new Batch(), flg = new Batch(); const metal = []; const U = new V3(0, 1, 0), R = new V3(1, 0, 0);
    let bi = 0; for (let x = 4; x < X_FIN + 50; x += 4.4) { const name = 'banner' + ((bi++ * 3) % 8); const w = 4.0, h = w / rectAspect(name); const y = groundY(x + 2) + 0.12; const th = slopeDeg(x) * D2R;
      const a = new V3(x, groundY(x) + 0.12, -3.3), b = new V3(x + w * Math.cos(th), groundY(x + w) + 0.12, -3.3);
      fb.quad4(a, b, new V3(b.x, b.y + h, -3.3), new V3(a.x, a.y + h, -3.3), rectUV(name)); }
    for (let x = 14, i = 0; x < X_FIN + 40; x += 21, i++) { const y0 = groundY(x) - 0.1; metal.push(vcBox(0.12, 6.2, 0.12, x, y0 + 3.1, -3.4, 0xf2f2f8)); const fn = 'flag' + (i % 9); const fw = 2.2, fh = fw / rectAspect(fn); flg.quad(new V3(x + fw / 2 + 0.06, y0 + 6.1 - fh, -3.4), R, U, fw, fh, rectUV(fn), i * 1.3); }
    for (let x = 22, i = 0; x < X_FIN + 40; x += 15, i++) { const pn = ['post0', 'post1', 'post3', 'post4', 'post5'][i % 5]; const h = 3.3, w = h * rectAspect(pn); fb.quad(new V3(x, groundY(x) - 0.1, -3.6), R, U, w, h, rectUV(pn)); }
    scene.add(new THREE.Mesh(fb.geometry(), new THREE.MeshBasicMaterial({ map: tex.side, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide })));
    const fm = new THREE.Mesh(flg.geometry(), flagMaterial(tex.side)); scene.add(fm);
    metal.forEach((g) => { g.deleteAttribute('uv'); }); scene.add(new THREE.Mesh(mergeGeometries(metal.map((g) => g.toNonIndexed ? g : g), false), lambertVC()));
    const texes = [tex.crowdA, tex.crowdB]; const bats = [new Batch(), new Batch()]; let k = 0;
    const spots = [25, ...LAY.map((L) => L.F.x0 + L.W / 2), X_FIN + 4];
    spots.forEach((cx, si) => { for (const off of [-8.5, 9]) { const ti = (k++) % 2; const t = texes[ti]; if (!t) continue; const W = 7.2; const ar = t.image ? t.image.height / t.image.width : 0.4; const x = cx + off; bats[ti].quad(new V3(x, groundY(x) - 0.1, -6.2 - (si % 2) * 0.4), R, U, W, W * ar, [0, 1, 1, 0], Math.random() * 6.28); } });
    bats.forEach((b, i) => { if (b.n && texes[i]) { const m = new THREE.Mesh(b.geometry(), bobMat(texes[i])); scene.add(m); } });
    [['stormy', 20, -3.0], ['emma', 25, -3.4], ['emma', X_FIN - 10, -3.0], ['stormy', X_FIN - 6, -3.4]].forEach(([nm, x, z], i) => { const t = tex[nm]; if (!t) return; const ar = t.image ? t.image.height / t.image.width : 1.2; const h = 2.0;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(h / ar, h), new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide })); const y0 = groundY(x) - 0.1; m.position.set(x, y0 + h / 2, z); m.userData = { base: y0 + h / 2, ph: i * 1.9 }; scene.add(m); park.dogs.push(m); });
  }
  // pines (instanced parallax mid layer)
  if (pineGeo) {
    const n = Math.min(Q.trees, 200); const im = new THREE.InstancedMesh(pineGeo, lambertVC(), n); const d = new THREE.Object3D(); let k = 0, tries = 0;
    while (k < n && tries < n * 20) { tries++; const x = -40 + Math.random() * (X_FIN + 150); const z = -(14 + Math.random() * 46); const s = 2.6 + Math.random() * 2.4; const sy = s * (0.95 + Math.random() * 0.35);
      d.position.set(x, terrainY(x, z) - 0.3 * 3.11 * sy, z); d.scale.set(s * 1.55, sy, s * 1.55); d.rotation.set(0, Math.random() * 6.28, 0); d.updateMatrix(); im.setMatrixAt(k++, d.matrix); }
    im.count = k; im.instanceMatrix.needsUpdate = true; scene.add(im);
  }
  // coloured twinkling sparkles along the course
  {
    const n = Q.runSparkles ? Math.round(Q.runSparkles * 2) : 400; const pos = new Float32Array(n * 3), ph = new Float32Array(n), col = new Float32Array(n * 3); const pal = [0x66e0ff, 0xff7ad8, 0xffe14a, 0x9bff8a, 0xffffff, 0xb28bff]; const c = new THREE.Color();
    for (let i = 0; i < n; i++) { const x = X_START - 10 + Math.random() * (X_FIN + 40); pos[i * 3] = x; pos[i * 3 + 1] = groundY(x) + 0.5 + Math.random() * 6; pos[i * 3 + 2] = -0.5 - Math.random() * 8; ph[i] = Math.random() * 6.28; c.setHex(pal[i % 6]); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('ph', new THREE.BufferAttribute(ph, 1)); g.setAttribute('col', new THREE.BufferAttribute(col, 3));
    park.spark = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: Object.assign({ scale: { value: 500 } }, waveU),
      vertexShader: 'attribute float ph; attribute vec3 col; uniform float uT; uniform float scale; varying vec3 vC; varying float vA; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); float tw = 0.35 + 0.65 * pow(max(0.0, sin(uT*3.0 + ph*7.0)), 2.0); vA = tw; vC = col; gl_PointSize = min(38.0, (0.3 + tw*0.4) * scale / -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying vec3 vC; varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); float a = smoothstep(0.5, 0.0, r); a += 0.6 * smoothstep(0.08, 0.0, abs(d.x)) * (1.0 - r*2.0) + 0.6 * smoothstep(0.08, 0.0, abs(d.y)) * (1.0 - r*2.0); gl_FragColor = vec4(vC, clamp(a, 0.0, 1.0) * vA); }' });
    const pts = new THREE.Points(g, park.spark); pts.frustumCulled = false; scene.add(pts);
  }
  return park;
}

// ------------------------------------------------------------------ game
export function createPark(deps) {
  const { renderer, skier, store, toast, onExit, loadTex, getTex, getPine, QUAL, GG } = deps;
  const $ = (id) => document.getElementById(id);
  const E = { hud: $('phud'), sc: $('psc'), cx: $('pcx'), cbar: $('pcbar'), prog: $('pprog'), count: $('pcount'), pop: $('ppopup'), pname: $('pname'), ppts: $('ppts'), psub: $('psub'), judge: $('pjudge'), btn: $('ptrick'), btl: $('ptbig'), btn2: $('ptn'), ring: $('pring'), res: $('presult'), rscore: $('pscore'), rnew: $('newrec') };
  const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 2500); const P = { active: false, state: 'idle', cam, scene: null, sim: null, t: 0 };
  let park = null, spray = null, confetti = null, sim = null, rt = [], score = 0, shown = 0, combo = 0, maxCombo = 0, landed = 0, cheer = 0, wall = 0, readyT = 0, finT = 0, auto = null;
  let lift = 0, camX = 0, camY = 0, camZ = 13, built = false, lastPose = '', judgeT = 0, shots = {};
  const info = () => ({ state: P.state, t: P.t, next: nextIdx(), score, combo, feats: FEATS.length, dur: sim && sim.dur, ev: sim && sim.ev, target: sim && sim.target, rt: rt.map((r) => r.res && r.res.q), cur: P.cur || null, shots });

  const pop = (el, text, color) => { el.textContent = text; if (color) el.style.color = color; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); };
  function nextIdx() { for (let j = 0; j < rt.length; j++) if (!rt[j].res) return j; return rt.length; }
  function setScore(n) { score = n; }

  async function build() {
    if (built) return; const tex = getTex();
    if (!tex.park) { tex.park = await loadTex('art/park/park.webp'); if (tex.park) { tex.park.generateMipmaps = true; tex.park.minFilter = THREE.LinearMipmapLinearFilter; tex.park.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy()); tex.park.needsUpdate = true; } }
    park = buildScene(tex, getPine(), QUAL); P.scene = park.scene; P.park = park; park.scene.add(cam);
    spray = new Spray(park.scene, tex.puff, 160); confetti = new Confetti(cam, 170); P.spray = spray; built = true;
  }
  P.resize = (w, h) => { cam.aspect = w / h; cam.updateProjectionMatrix(); };
  P.setAuto = (a) => { auto = a; };
  P.info = info;

  P.enter = async function () {
    A.initAudio(); A.unlockSpeech(); await skier.ensurePark(); await build(); await new Promise((r) => setTimeout(r, 0));
    P.active = true; P.state = 'ready'; sim = simulate(); P.sim = sim; P.t = 0; rt = FEATS.map(() => ({ res: null, awarded: false })); score = shown = combo = maxCombo = landed = 0; cheer = 0; readyT = 0; finT = 0; shots = {}; lift = 0; lastPose = '';
    E.hud.classList.remove('hidden'); E.res.classList.add('hidden'); E.rnew.classList.remove('show'); E.pop.classList.remove('show'); E.sc.textContent = '0'; E.cx.textContent = 'x1'; E.cbar.style.width = '0%'; E.prog.textContent = 'TRICK 1/' + FEATS.length; E.count.textContent = '3'; E.btn.className = 'txt idle'; E.btl.textContent = 'GET READY'; E.btn.disabled = false; E.btn2.textContent = FEATS[0].name;
    skier.attach(park.scene); skier.fp(false); skier.board.rotation.set(0, 0, 0); skier.root.scale.setScalar(1.5); skier.root.position.set(X_START, groundY(X_START), 0.45); skier.root.rotation.set(0, 0, groundAng(X_START)); skier.extraRot = 0; skier.ground = (x) => ({ y: groundY(x), ang: groundAng(x) });
    skier.play('pride', 0, true); camX = X_START + 3; camY = groundY(X_START) + 1.85; camZ = 12.2; confetti.stop(); A.music('run'); A.sfx('beep');
  };
  P.exit = function () { P.active = false; P.state = 'idle'; E.hud.classList.add('hidden'); E.res.classList.add('hidden'); E.rnew.classList.remove('show'); E.pop.classList.remove('show'); confetti && confetti.stop(); skier.extraRot = 0; skier.frameOverride = null; skier.root.scale.setScalar(0.8); };

  // ---- trick input
  P.onTap = function () {
    if (!P.active || P.state !== 'run') return; const j = nextIdx(); if (j >= FEATS.length) return;
    const T = sim.target[j]; const d = P.t - T; if (d < -WIN_EARLY || d > WIN_LATE) return;
    const ad = Math.abs(d); const q = ad <= PERF ? 'PERFECT' : ad <= GOODW ? 'GOOD' : d < 0 ? 'EARLY' : 'LATE';
    const ev = sim.ev[j], F = FEATS[j]; const r = { q, d, tt: P.t };
    if (F.kind === 'kick') { r.start = Math.max(ev.tRel + 0.05, P.t); r.end = ev.tLand - 0.1; if (r.end - r.start < 0.4) r.start = Math.max(ev.tRel + 0.02, r.end - 0.4); }
    else { r.start = Math.max(ev.tOn, P.t); r.end = ev.tRel; }
    rt[j].res = r; A.sfx('tap'); A.sfx(q === 'PERFECT' ? 'perfect' : q === 'GOOD' ? 'great' : 'good');
    pop(E.judge, q + (q === 'PERFECT' || q === 'GOOD' ? '!' : ''), q === 'PERFECT' ? '#ffe27a' : q === 'GOOD' ? '#7dffb0' : '#8fd2ff');
    E.btn.classList.add('hit'); setTimeout(() => E.btn.classList.remove('hit'), 220);
  };
  const award = (j) => {
    const r = rt[j]; if (r.awarded) return; r.awarded = true; const F = FEATS[j]; const res = r.res; const kick = F.kind === 'kick';
    if (!res || res.q === 'MISS') { combo = 0; const pts = 50; score += pts; E.pname.textContent = kick ? 'NICE POP' : 'SLIDE'; E.pname.style.color = '#cfe3ff'; E.ppts.textContent = '+' + pts; E.psub.textContent = 'tap TRICK when the ring closes!'; E.pop.classList.remove('show'); void E.pop.offsetWidth; E.pop.classList.add('show'); A.sfx('ok'); return; }
    combo++; maxCombo = Math.max(maxCombo, combo); landed++; const cm = Math.min(2.5, 1 + 0.25 * (combo - 1)); const pts = Math.round(F.base * QMULT[res.q] * cm / 10) * 10; score += pts;
    E.pname.textContent = F.name + '!'; E.pname.style.color = res.q === 'PERFECT' ? '#ffe27a' : '#ffffff'; E.ppts.textContent = '+' + pts; E.psub.textContent = res.q + ' x' + QMULT[res.q] + '  ·  COMBO x' + cm.toFixed(2).replace(/\.?0+$/, '');
    E.pop.classList.remove('show'); void E.pop.offsetWidth; E.pop.classList.add('show');
    cheer = 1; A.sfx('cheer'); if (res.q === 'PERFECT') A.sfx('fanfare'); A.speak(F.say);
    const p = skier.root.position; spray.burst(p.x, p.y, 0.5, 12, 5, 2, 0.15); if (res.q !== 'EARLY' && res.q !== 'LATE') confetti.start();
    setTimeout(() => confetti.stop(), 900);
  };

  // ---- pose from the timeline
  function pose(t, st, dt) {
    let j = -1; for (let i = 0; i < FEATS.length; i++) { const e = sim.ev[i]; if (e.tEnter != null && t >= e.tEnter - 0.0 && (e.tLand == null || t <= e.tLand + 0.6)) { j = i; break; } }
    let anim = 'pride', frame = null, extra = 0, tricking = false, wantLift = 0, p = 0, name = '';
    if (j >= 0) {
      const F = FEATS[j], e = sim.ev[j], r = rt[j].res, kick = F.kind === 'kick', tr = r && r.q !== 'MISS';
      const tRel = e.tRel != null ? e.tRel : 1e9, tLand = e.tLand != null ? e.tLand : 1e9;
      if (t < tRel) {                                   // on the ramp / wedge
        if (kick || !e.tOn || t < e.tOn) { anim = 'ppop'; frame = (t - e.tEnter) / Math.max(0.1, (e.tOn != null ? e.tOn : tRel) - e.tEnter) < 0.5 ? 0 : 1; }
        else if (tr && t >= Math.max(e.tOn, r.start)) { anim = 'pgrind'; tricking = true; name = F.name; }
        else anim = 'pride';
      } else if (t < tLand) {                           // air
        anim = 'pair'; wantLift = 1;
        if (tr && kick && t >= r.start) {
          const q = clamp((t - r.start) / Math.max(0.2, r.end - r.start), 0, 1); p = q; tricking = true; name = F.name;
          if (F.t === 'back' || F.t === 'front') {
            // orientation is CCW-positive: backflip = +CCW, front flip = -CW. Both frame sets face right (travel direction) and are
            // looked up by nearest orientation, so the rotation sense is right whichever sheet the frames came from.
            const dir = F.t === 'back' ? 1 : -1; const R = q * 360 * (F.revs || 1); const Rm = R >= 359.9 ? 360 : R % 360; const meta = dir > 0 ? BACK : FRONT;
            const ph = dir * Rm; const wrap = (x) => ((x % 360) + 540) % 360 - 180;
            if (Math.abs(wrap(ph)) < 30) { anim = 'pair'; extra = wrap(ph) * D2R; }
            else { let bi = 0, bd = 1e9; meta.forEach((n, k) => { const dd = Math.abs(wrap(ph - n)); if (dd < bd) { bd = dd; bi = k; } }); anim = dir > 0 ? 'pback' : 'pfront'; frame = bi; extra = wrap(ph - meta[bi]) * D2R; }
            if (q >= 1) { anim = 'pair'; extra = 0; }
          } else if (F.t === 'spin') { anim = 'pspin'; frame = q >= 1 ? 0 : Math.floor(q * 8) % 8; }
          else if (F.t === 'grab') { anim = 'pgrab'; frame = q < 0.2 ? 0 : q < 0.9 ? (Math.floor(q * 14) % 2 ? 1 : 2) : 0; if (q >= 1) anim = 'pair'; }
        }
        if (!r && kick) { /* plain pop */ }
      } else if (t < tLand + 0.55) { anim = 'pland'; frame = null; }
    }
    return { anim, frame, extra, tricking, wantLift, p, name, j };
  }

  P.pauseAt = []; P.paused = false;
  P.update = function (dt) {
    if (!P.active) return;
    if (P.pauseAt.length && P.state === 'run' && P.t >= P.pauseAt[0]) { P.pauseAt.shift(); P.paused = true; }
    if (P.paused) dt = 1e-4; wall += dt; bobTick(wall, cheer); sideTime(wall); cheer = Math.max(0, cheer - dt * 0.35);
    park.dogs.forEach((d, i) => { const b = Math.max(0, Math.sin(wall * (4 + cheer * 9) + d.userData.ph)); d.position.y = d.userData.base + b * (0.1 + cheer * 0.7); });
    park.clouds.forEach((c) => { c.ox += c.sp0 * dt; });
    if (P.state === 'ready') {
      readyT += dt; const n = 3 - Math.floor(readyT / 0.6); if (n >= 1) { if (E.count.textContent !== String(n)) { E.count.textContent = String(n); A.sfx('beep'); } } else { E.count.textContent = ''; P.state = 'run'; pop(E.judge, 'GO!', '#7dffb0'); A.sfx('go'); }
      skier.update(dt);
    } else if (P.state === 'run' || P.state === 'finish') {
      if (P.t < sim.dur) P.t += dt; const t = Math.min(P.t, sim.dur); const st = sim.at(t);
      // auto-miss when the window closes
      const nj = nextIdx(); if (nj < FEATS.length && P.t > sim.target[nj] + WIN_LATE) { rt[nj].res = { q: 'MISS' }; }
      if (auto && nj < FEATS.length && !rt[nj].res) { const a = auto[nj]; if (a !== 'miss' && a != null && P.t >= sim.target[nj] + a) P.onTap(); }
      for (let j = 0; j < FEATS.length; j++) { if (rt[j].awarded) continue; const e = sim.ev[j], F = FEATS[j]; const res = rt[j].res; const kick = F.kind === 'kick';
        if (res && res.q !== 'MISS' && P.t >= res.end + (kick ? 0 : 0)) award(j); else if (res && res.q === 'MISS' && e.tLand != null && P.t >= e.tLand) award(j); }
      const pz = P.state === 'finish' ? { anim: 'cheerFist', frame: null, extra: 0, wantLift: 0, p: 0, name: '', j: -1, tricking: false } : pose(t, st, dt); P.cur = { j: pz.j, anim: pz.anim, tricking: pz.tricking, p: pz.p, name: pz.name };
      if (pz.anim !== lastPose) { skier.play(pz.anim, 0, true); lastPose = pz.anim; if (pz.anim === 'pland') { A.sfx('land'); const pp = skier.root.position; spray.burst(pp.x, pp.y, 0.5, 8, 4, 3, 0.15); skier.kick(-0.25); } if (pz.anim === 'pair' && st.m === 1) { A.sfx('launch'); const pp = skier.root.position; spray.burst(pp.x, pp.y, 0.5, 6, 3.5, 3, 0.14); skier.kick(0.2); } if (pz.anim === 'pgrind') A.sfx('skid'); }
      if (pz.frame != null) { if (pz.anim === 'pride') skier.setFrame(pz.frame); else skier.setFrame(pz.frame); } else if (skier.frameOverride != null) { skier.frameOverride = null; skier.last = -1; }
      skier.extraRot = pz.extra;
      lift += ((pz.wantLift ? 0.95 : 0) - lift) * (1 - Math.exp(-dt * 18));
      // placement + orientation
      const root = skier.root; const sc = root.scale.x;
      root.position.set(st.x, st.y + lift * sc, 0.45); const ta = st.m === 0 ? st.a : st.m === 1 ? clamp(st.a * 0.55, -0.7, 0.8) : clamp(st.a * 0.7, -1.0, 1.0);
      root.rotation.z += (ta - root.rotation.z) * (1 - Math.exp(-dt * 16));
      if (pz.anim === 'pgrind' && Math.random() < 0.9) spray.emit(st.x - 0.6, st.y + 0.12, 0.6, -2 - Math.random() * 3, 1.5 + Math.random() * 2.5, (Math.random() - 0.5) * 1.5, 0.16, 0.4);
      else if (st.m === 0 && P.t > 0.6 && Math.random() < 0.55) spray.emit(st.x - 1.0, st.y + 0.12, 0.5, -st.vx * 0.1, 0.5 + Math.random(), (Math.random() - 0.5) * 1.2, 0.17, 0.45);
      skier.update(dt);
      // trick button + ring
      if (P.state === 'run') {
        const j = nextIdx(); const F = FEATS[j]; let lit = false;
        if (j < FEATS.length) { const d = P.t - sim.target[j]; lit = d >= -WIN_EARLY && d <= WIN_LATE; E.btn2.textContent = F.name; if (lit) { const k = clamp(-d / WIN_EARLY, 0, 1); const sc2 = 1 + 1.2 * k * k; E.ring.style.transform = 'scale(' + sc2.toFixed(3) + ')'; E.ring.style.opacity = String(0.35 + 0.65 * (1 - k)); E.ring.style.borderColor = Math.abs(d) <= PERF ? '#ffe27a' : '#ffffff'; } }
        if (!E.btn.classList.contains('hidden')) E.btn.classList.toggle('lit', lit); E.btn.classList.toggle('idle', !lit); E.btl.textContent = lit ? 'TRICK!' : 'GET READY'; E.ring.style.display = lit ? 'block' : 'none';
        E.prog.textContent = j < FEATS.length ? 'TRICK ' + (j + 1) + '/' + FEATS.length : 'FINISH LINE!';
      }
      E.cx.textContent = 'x' + (combo ? Math.min(2.5, 1 + 0.25 * (combo - 1)).toFixed(2).replace(/\.?0+$/, '') : '1'); E.cbar.style.width = Math.min(100, combo / 7 * 100) + '%';
      shown += (score - shown) * (1 - Math.exp(-dt * 8)); E.sc.textContent = Math.round(Math.abs(score - shown) < 1 ? score : shown).toLocaleString('en-US');
      if (P.state === 'run' && P.t >= sim.tFin) { P.state = 'finish'; finT = 0; skier.play('cheerFist', 0.2, true); lastPose = 'cheerFist'; confetti.start(); A.sfx('fanfare'); A.sfx('cheer'); cheer = 1; pop(E.judge, 'FINISH!', '#ffe27a'); A.speak('Finish!'); skier.extraRot = 0; E.btn.className = 'txt idle hidden'; E.ring.style.display = 'none'; }
      if (P.state === 'finish') { finT += dt; skier.extraRot = 0; if (finT > 2.6) showResult(); }
      // camera: side-on follow with look-ahead; pulls back when high above the snow
      const hAir = Math.max(0, st.y - groundY(st.x)); const fin = P.state === 'finish'; const tz = fin ? 15 : 12.2 + clamp(hAir * 0.35, 0, 2.0); const kx = 1 - Math.exp(-dt * 6), ky = 1 - Math.exp(-dt * (st.m === 1 ? 8 : 4.5));
      camX += (st.x + (fin ? -0.5 : 3.0) - camX) * kx; camY += (st.y + (fin ? 2.6 : 1.85 + clamp(hAir * 0.3, 0, 2.2) + (st.m === 1 ? clamp(st.vy * 0.14, -2.2, 2.6) : 0)) - camY) * ky; camZ += (tz - camZ) * (1 - Math.exp(-dt * 2.2));
    }
    confetti.update(dt); spray.update(dt, renderer.domElement.height, cam.fov);
    cam.position.set(camX - 0.6, camY + 1.1, camZ); cam.lookAt(camX, camY + 0.2, 0);
    // parallax backdrop
    park.sky.position.copy(cam.position);
    park.layers.forEach((l) => { l.m.position.x = camX * l.fx; l.m.position.y = camY * l.fy + l.h * 0.5 + l.yo + 10; });
    park.clouds.forEach((c) => { c.sp.position.x = camX * c.f + c.ox; c.sp.position.y = camY * 0.97 + c.oy + 20; });
    park.spark.uniforms.scale.value = renderer.domElement.height / (2 * Math.tan(cam.fov * Math.PI / 360));
  };

  function showResult() {
    if (P.state === 'result') return; P.state = 'result'; const oldBest = store.get('pbest', 0); const isRec = score > oldBest; if (isRec) store.set('pbest', score);
    const nm = FEATS.length; E.rscore.innerHTML = '<span>Tricks landed</span><b>' + landed + ' / ' + nm + '</b><span>Best combo</span><b>x' + Math.min(2.5, 1 + 0.25 * (Math.max(1, maxCombo) - 1)).toFixed(2).replace(/\.?0+$/, '') + '</b><span>Best park score</span><b>' + Math.max(oldBest, score).toLocaleString('en-US') + '</b><div class="tot"><span>TOTAL POINTS</span><b>' + score.toLocaleString('en-US') + '</b></div>';
    E.res.classList.remove('hidden'); E.rnew.classList.toggle('show', isRec); A.music('win'); if (isRec) { A.sfx('record'); }
    PARK_UNLOCKS.forEach((u, i) => { if (oldBest < u.need && score >= u.need) setTimeout(() => toast('🎉 UNLOCKED: ' + u.name + '!'), 1200 + i * 3700); });
    window.__lastParkResult = { score, landed, maxCombo, isRec };
  }
  P.score = () => score;
  P.render = () => renderer.render(park.scene, cam);
  return P;
}

// nominal body angles per tumbling frame (deg), from art/sprites/park.json
import PARK from '../art/sprites/park.json';
const BACK = PARK.anims.pback.ang, FRONT = PARK.anims.pfront.ang;   // orientations (deg, CCW+) of the mirrored, right-facing frames
