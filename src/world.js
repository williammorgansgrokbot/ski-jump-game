import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Batch, rectUV, rectAspect, buildRunSide, sideTime } from './runside.js';
import { HILL, groundY, groundAngle, arcAt, xAtArc, runAt, RUN_START, K_X, HS_X } from './physics.js';

const sstep = (k) => { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); };
const C = (hex) => new THREE.Color(hex);

// ------- geometry helpers (vertex-coloured merged boxes: few draw calls) -----------------------
function colorize(g, col) { const n = g.attributes.position.count; const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }
function box(w, h, d, x, y, z, color, ry) { const g = new THREE.BoxGeometry(w, h, d); if (ry) g.rotateY(ry); g.translate(x, y, z); g.deleteAttribute('uv'); return colorize(g, C(color)); }
function beam(a, b, t, color) {
  const d = b.clone().sub(a), L = d.length(); const g = new THREE.BoxGeometry(L, t, t); g.deleteAttribute('uv');
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.clone().normalize());
  g.applyQuaternion(q); const m = a.clone().add(b).multiplyScalar(0.5); g.translate(m.x, m.y, m.z); return colorize(g, C(color));
}
function stripGeo(L, R, color, flip) {                // quads between two 3D polylines (L, R arrays of Vector3)
  const pos = [], col = [], idx = []; const c = C(color);
  for (let i = 0; i < L.length; i++) { pos.push(L[i].x, L[i].y, L[i].z, R[i].x, R[i].y, R[i].z); col.push(c.r, c.g, c.b, c.r, c.g, c.b); }
  for (let i = 0; i < L.length - 1; i++) { const a = i * 2, b = a + 1, c2 = a + 2, d = a + 3; if (flip) idx.push(a, b, c2, b, d, c2); else idx.push(a, c2, b, b, c2, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
const lambertVC = (o) => new THREE.MeshLambertMaterial(Object.assign({ vertexColors: true }, o || {}));

// run profile helpers
const RUN_PTS = []; for (let s = 0; s <= HILL.RUN_LEN + 0.01; s += 1) RUN_PTS.push(runAt(s));
export function runY(x) { if (x <= RUN_PTS[0].x) return RUN_PTS[0].y + (RUN_PTS[0].x - x) * Math.tan(RUN_PTS[0].ang); for (let i = 0; i < RUN_PTS.length - 1; i++) if (RUN_PTS[i + 1].x >= x) { const k = (x - RUN_PTS[i].x) / (RUN_PTS[i + 1].x - RUN_PTS[i].x); return RUN_PTS[i].y + (RUN_PTS[i + 1].y - RUN_PTS[i].y) * k; } return 0; }
export function terrainY(x, z) {
  const az = Math.abs(z); let y, w;
  if (x < 0) { const c = 3.5 + 27 * sstep((-x) / 78); y = runY(x) - c; if (x < RUN_START.x) y = runY(x) - 30.5; w = 16 + 16 * sstep(x / 60 + 1); }
  else { y = groundY(x); w = 34; }
  const side = Math.max(0, az - w); y += 0.0042 * side * side + 0.55 * Math.sin(x * 0.07 + z * 0.11) * sstep(side / 10);
  if (x < 0) y -= 0.4 * sstep((az - 6) / 8) * 0; return y;
}

const bobU = { uT: { value: 0 }, uA: { value: 0 }, uS: { value: 3 } };
export function bobTick(t, amp) { bobU.uT.value = t; bobU.uA.value = 0.05 + amp * 0.35; bobU.uS.value = 3 + amp * 7; }
export function bobMat(map) {
  const m = new THREE.MeshBasicMaterial({ map, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => { Object.assign(sh.uniforms, bobU); sh.vertexShader = 'attribute float aPh; uniform float uT; uniform float uA; uniform float uS;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed.y += max(0.0, sin(uT * uS + aPh)) * uA * 0.9;'); };
  return m;
}
const SZ = 34;   // lateral distance of the stands from the track centre
export function buildWorld(opts) {
  const { tex, pineGeo, quality } = opts; const Q = quality;
  const scene = new THREE.Scene(); const root = scene;
  const HORIZON = 0xf6efff;
  scene.background = new THREE.Color(0x5db8ff); scene.fog = new THREE.Fog(HORIZON, 140, 560);
  const world = { scene, groups: {}, markers: [], passed: 0, cheer: 0, crowd: [], dogs: [], clouds: [], flags: [] };

  // --- sky: coded gradient dome
  const skyMat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: { top: { value: C(0x1558f0) }, mid: { value: C(0x46b8ff) }, hor: { value: C(HORIZON) }, sun: { value: new THREE.Vector3(0.5, 0.45, 0.7).normalize() } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 hor; uniform vec3 sun; varying vec3 vD; void main(){ float h = clamp(vD.y,0.0,1.0); vec3 c = mix(hor, mid, smoothstep(0.0,0.22,h)); c = mix(c, top, smoothstep(0.18,0.8,h)); float s = max(dot(normalize(vD), sun),0.0); c += vec3(1.0,0.9,0.7) * (pow(s,24.0)*0.35 + pow(s,400.0)*0.9); gl_FragColor = vec4(c,1.0);\n#include <colorspace_fragment>\n}' });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 16), skyMat); sky.renderOrder = -10; sky.frustumCulled = false; root.add(sky); world.sky = sky;

  // --- painted mountain ridge ring + clouds
  if (tex.ridge) {
    const geo = new THREE.CylinderGeometry(700, 700, 230, 40, 1, true); const m = new THREE.MeshBasicMaterial({ map: tex.ridge, transparent: true, side: THREE.BackSide, depthWrite: false, fog: false, color: 0xe2d2ff });
    tex.ridge.wrapS = THREE.RepeatWrapping; tex.ridge.repeat.set(2.0, 1); const ridge = new THREE.Mesh(geo, m); ridge.position.y = -10; ridge.renderOrder = -5; root.add(ridge); world.ridge = ridge;
  }
  if (tex.cloud) {
    for (let i = 0; i < 9; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex.cloud, fog: false, transparent: true, depthWrite: false, opacity: 0.95 }); const sp = new THREE.Sprite(mat);
      const a = (i / 9) * Math.PI * 2 + 0.4, r = 520 + (i % 3) * 60; sp.position.set(Math.cos(a) * r, 150 + (i % 4) * 28, Math.sin(a) * r); const sc = 150 + (i % 3) * 50; sp.scale.set(sc, sc * 0.55, 1); sp.renderOrder = -4; root.add(sp); world.clouds.push({ sp, a, r, sp0: 0.0008 + (i % 3) * 0.0003 });
    }
  }

  // --- lights
  const hemi = new THREE.HemisphereLight(0xe6f2ff, 0xc2d4f0, 2.1); root.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.6); sun.position.set(30, 60, 45); sun.castShadow = Q.shadows;
  const sh = sun.shadow; sh.mapSize.set(Q.shadowMap, Q.shadowMap); const sc = sh.camera; sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 5; sc.far = 160; sh.bias = -0.0006; sh.normalBias = 0.04; sh.radius = 3;
  root.add(sun); root.add(sun.target); world.sun = sun;

  // --- terrain mesh
  {
    const xs = []; for (let x = -118; x <= 330; x += (x < -10 ? 4 : 3)) xs.push(x);
    const zs = []; for (let z = -150; z <= 150; z += (Math.abs(z) < 36 ? 3 : (Math.abs(z) < 70 ? 8 : 20))) zs.push(z);
    const nx = xs.length, nz = zs.length; const pos = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3), idx = [];
    const TINTS = [0xffb3d9, 0xb7f2d0, 0xa9d4ff, 0xffe9a0, 0xd6bcff, 0xffc7a3].map(C); const cSnow = C(0xf6faff), cShade = C(0xcfe0f6), cBlue = C(0xb9d2f0);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const x = xs[i], z = zs[j]; const y = terrainY(x, z); const k = (i * nz + j) * 3; pos[k] = x; pos[k + 1] = y; pos[k + 2] = z;
      const az = Math.abs(z); let c = cSnow.clone();
      const stripe = (Math.floor((z + 100) / 3) % 2) ? 0.0 : 1.0; // groomed stripes on the landing hill
      if (x > 0 && az < 22) c.lerp(cBlue, 0.06 + 0.08 * stripe); else c.lerp(cShade, 0.25 + 0.35 * sstep((az - 30) / 60));
      if (x < 14 && az > 3.5) { const pal = TINTS; const band = Math.floor((az + x * 0.22) / 6.5); const kk = 0.62 * sstep((az - 3.5) / 5) * (1 - 0.55 * sstep((az - 40) / 50)) * (1 - sstep((x - 2) / 12)); c.lerp(pal[((band % 6) + 6) % 6], kk); }
      const n = 0.04 * Math.sin(x * 0.19 + z * 0.23) + 0.03 * Math.sin(x * 0.07 - z * 0.31); c.offsetHSL(0, 0, n * 0.6);
      col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
    }
    for (let i = 0; i < nx - 1; i++) for (let j = 0; j < nz - 1; j++) { const a = i * nz + j, b = a + 1, c2 = a + nz, d = c2 + 1; idx.push(a, b, c2, b, d, c2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    const terr = new THREE.Mesh(g, lambertVC()); terr.receiveShadow = true; root.add(terr); world.terrain = terr;
  }

  // --- in-run track (ice lane + wooden side walls)
  {
    const pts = RUN_PTS; const mk = (z, dy) => pts.map((p) => new THREE.Vector3(p.x, p.y + dy, z));
    const ice = new THREE.Group(); const geos = [];
    const lanes = [[-1.25, -0.9, 0xcfe4ff], [-0.9, -0.62, 0xf5fbff], [-0.62, -0.48, 0x3fbfff], [-0.48, 0.48, 0xeaf4ff], [0.48, 0.62, 0xff5fb8], [0.62, 0.9, 0xf5fbff], [0.9, 1.25, 0xffe0f0]];
    lanes.forEach((l) => geos.push(stripGeo(mk(l[0], 0.01), mk(l[1], 0.01), l[2], true)));
    // walls
    [-1, 1].forEach((s) => {
      const zi = 1.25 * s, zo = 1.5 * s, wh = 0.75;
      geos.push(stripGeo(mk(zi, 0.0), mk(zi, wh), 0x2f43a0, s > 0)); geos.push(stripGeo(mk(zi, wh), mk(zo, wh), 0xffd23f, s > 0)); geos.push(stripGeo(mk(zo, wh), mk(zo, -0.1), 0x5c3c22, s > 0));
    });
    const m = new THREE.Mesh(mergeGeometries(geos, false), lambertVC({ side: THREE.DoubleSide })); m.receiveShadow = true; m.name = 'track'; root.add(m); world.track = m;
    // trestle tower
    const tg = []; const POST = 0x4e6a8e, BEAM = 0xc6924f, X = 0x3e4f6a;
    for (let s = 0; s <= HILL.RUN_LEN - 6; s += 6.5) {
      const p = runAt(s); const gy = terrainY(p.x, 2.4) - 1.2; const gy2 = terrainY(p.x, -2.4) - 1.2;
      [[2.6, gy], [-2.6, gy2]].forEach(([z, g]) => { const top = p.y - 0.15; const h = top - g; if (h > 0.4) tg.push(box(0.5, h, 0.5, p.x, g + h / 2, z, POST)); });
      tg.push(box(0.35, 0.45, 5.6, p.x, p.y - 0.4, 0, BEAM));
      const q = runAt(Math.min(HILL.RUN_LEN, s + 6.5));
      [2.6, -2.6].forEach((z) => { const g1 = terrainY(p.x, z) - 1.2, g2 = terrainY(q.x, z) - 1.2; tg.push(beam(new THREE.Vector3(p.x, g1 + (p.y - g1) * 0.15, z), new THREE.Vector3(q.x, q.y - 0.6, z), 0.22, X)); tg.push(beam(new THREE.Vector3(p.x, p.y - 0.6, z), new THREE.Vector3(q.x, g2 + (q.y - g2) * 0.15, z), 0.22, X)); });
      if (s > 0) tg.push(beam(new THREE.Vector3(p.x, p.y - 0.7, 2.6), new THREE.Vector3(p.x, p.y - 0.7, -2.6), 0.2, X));
    }
    // start house on top
    const s0 = RUN_START; tg.push(box(7, 4.2, 6.5, s0.x - 5.5, s0.y + 2.0, 0, 0xb2763f)); tg.push(box(8, 0.8, 7.6, s0.x - 5.5, s0.y + 4.5, 0, 0xe9edf5)); tg.push(box(2.2, 2, 0.2, s0.x - 2.0, s0.y + 2.8, 2.45, 0x8fd2ff)); tg.push(box(0.5, 6.5, 0.5, s0.x - 2.0, s0.y + 5, 2.9, 0x4e6a8e)); tg.push(box(0.5, 6.5, 0.5, s0.x - 2.0, s0.y + 5, -2.9, 0x4e6a8e));
    tg.push(box(1.0, 1.4, 2.6, s0.x + 0.4, s0.y + 0.2, 0, 0xcc3344));            // start gate bench
    // judges tower by the landing hill
    const jx = K_X - 8; const jy = terrainY(jx, -26);
    tg.push(box(8, 7, 4, jx, jy + 3.0, -27, 0x3f6fb2)); tg.push(box(9, 0.8, 5, jx, jy + 6.9, -27, 0xe9edf5)); tg.push(box(6.4, 1.8, 0.2, jx, jy + 5.0, -24.95, 0x9fdcff)); tg.push(box(0.4, 6.6, 0.4, jx - 3.6, jy + 3.2, -24.5, 0x4e6a8e)); tg.push(box(0.4, 6.6, 0.4, jx + 3.6, jy + 3.2, -24.5, 0x4e6a8e));
    const tm = new THREE.Mesh(mergeGeometries(tg, false), lambertVC()); tm.castShadow = Q.shadowTower; tm.receiveShadow = true; root.add(tm); world.tower = tm;
    // flags on tower top (painted bunting)
    if (tex.bunting) {
      const mat = new THREE.MeshBasicMaterial({ map: tex.bunting, transparent: true, side: THREE.DoubleSide, fog: true });
      const make = (w, x, y, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.45), mat); m.position.set(x, y, z); m.rotation.y = ry; root.add(m); world.flags.push(m); return m; };
      make(11, s0.x + 4, s0.y + 9, 0, Math.PI / 2); make(11, s0.x - 5.5, s0.y + 9.6, 0, Math.PI / 2);
      const bg = []; for (const sd of [-1, 1]) for (let k = 0; k < 4; k++) { const sx = 55 + k * 40; const g = new THREE.PlaneGeometry(18, 18 * 0.45); g.translate(sx, terrainY(sx, sd * 23) + 7, sd * 23); bg.push(g); }
      const bm = new THREE.Mesh(mergeGeometries(bg, false), mat); root.add(bm);
    }
  }

  // --- colourful in-run side graphics (banners, flags, gates, signs, lights, gallery crowd)
  { const rs = buildRunSide(scene, tex, Q, { terrainY, bobMat, runY }); world.runSide = rs; rs.dogs.forEach((d) => world.dogs.push(d)); }

  // --- stands + painted crowd
  {
    const sg = []; const rows = 4; const landB = new Batch();
    [-1, 1].forEach((side) => {
      for (let x0 = 44; x0 < 200; x0 += 4) {
        const gx = x0 + 2; const gy = groundY(gx);
        for (let r = 0; r < rows; r++) { const z = side * (SZ + r * 1.9); const y = terrainY(gx, z) + r * 1.15; sg.push(box(4.2, 1.15 * (r + 1) + 0.6, 1.9, gx, y + 0.55 - 0.45, z, r % 2 ? 0x8d6a45 : 0xa77c4e)); }
      }
      // railing / ad boards along the track edge
      for (let x0 = 36; x0 < 215; x0 += 6) { const gx = x0 + 3; const z = side * 24.2; const y = terrainY(gx, z); sg.push(box(5.8, 0.12, 0.3, gx, y + 0.08, z, 0xffffff)); sg.push(box(5.8, 0.12, 0.34, gx, y + 1.5, z, [0xff5d73, 0xffd23f, 0x45b6fe, 0x5be37d][((x0 / 6) | 0) % 4])); if (tex.side) { const nm = 'banner' + ((((x0 / 6) | 0) * 3 + (side > 0 ? 1 : 0)) % 8); const asp = rectAspect(nm); const w = 5.6, h = w / asp; landB.quad(new THREE.Vector3(gx, y + 0.12, z - side * 0.2), new THREE.Vector3(-side, 0, 0), new THREE.Vector3(0, 1, 0), w, h, rectUV(nm)); } }
    });
    const m = new THREE.Mesh(mergeGeometries(sg, false), lambertVC()); m.receiveShadow = true; root.add(m);
    if (landB.n) { const lm = new THREE.Mesh(landB.geometry(), new THREE.MeshBasicMaterial({ map: tex.side, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide })); root.add(lm); }
    // crowd planes
    const texes = [tex.crowdA, tex.crowdB].filter(Boolean);
    if (texes.length) {
      const W = 20; const bats = texes.map(() => new Batch());
      [-1, 1].forEach((side) => {
        for (let x0 = 46; x0 < 200; x0 += 17) {
          for (let r = 0; r < 3; r++) {
            const ti = (((x0 / 17) | 0) + r) % texes.length; const t = texes[ti]; const ar = t.image ? t.image.height / t.image.width : 0.4;
            const gx = x0 + W / 2 - (r * 5); const z = side * (SZ + 0.6 + r * 1.9); const baseY = terrainY(gx, z) + r * 1.15 + 0.55;
            bats[ti].quad(new THREE.Vector3(gx, baseY, z), new THREE.Vector3(-side, 0, 0), new THREE.Vector3(0, 1, 0), W, W * ar, [0, 1, 1, 0], Math.random() * 6.28);
          }
        }
      });
      bats.forEach((b, i) => { if (b.n) root.add(new THREE.Mesh(b.geometry(), bobMat(texes[i]))); });
    }
    // dogs
    [['stormy', 0.2, 112, -1], ['emma', 0.2, 124, -1], ['stormy', 0.2, 76, 1], ['emma', 0.2, 148, 1]].forEach(([nm, _, x, side], i) => {
      const t = tex[nm]; if (!t) return; const ar = t.image ? t.image.height / t.image.width : 1.2; const h = 2.6;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(h / ar, h), new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide })); const z = side * 23.6; const gy = terrainY(x, z) + 1.55 + 0.0;
      m.position.set(x, gy + h / 2, z); m.rotation.y = side < 0 ? 0 : Math.PI; m.scale.x = side < 0 ? 1 : -1; m.userData = { base: gy + h / 2, ph: i * 1.7, x }; root.add(m); world.dogs.push(m);
    });
  }

  // --- pine forests (instanced, shared decimated Quaternius pine)
  if (pineGeo) {
    const mat = lambertVC(); const n = Q.trees; const im = new THREE.InstancedMesh(pineGeo, mat, n); const d = new THREE.Object3D(); let k = 0; let tries = 0;
    while (k < n && tries < n * 30) {
      tries++; const x = -105 + Math.random() * 410; const side = Math.random() < 0.5 ? -1 : 1; const z = side * (46 + Math.random() * 100);
      if (x < 0 && Math.abs(z) < 20) continue; if (Math.abs(z) < 44 && x > 20) continue;
      const s = 2.3 + Math.random() * 2.0; const sy = s * (0.95 + Math.random() * 0.35); d.position.set(x, terrainY(x, z) - 0.3 * 3.11 * sy, z); d.scale.set(s * 1.55, sy, s * 1.55); d.rotation.set(0, Math.random() * 6.28, 0); d.updateMatrix(); im.setMatrixAt(k++, d.matrix);
    }
    im.count = k; im.instanceMatrix.needsUpdate = true; im.castShadow = false; im.receiveShadow = false; root.add(im); world.trees = im;
  }

  // --- distance lines on the landing slope (one InstancedMesh) + number boards (one merged mesh)
  {
    const ds = []; for (let d = 30; d <= 160; d += 10) ds.push(d);
    const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), ds.length);
    const cvs = document.createElement('canvas'); cvs.width = 512; cvs.height = 256; const g = cvs.getContext('2d'); const bb = new Batch(); const poleG = [];
    ds.forEach((d, i) => {
      const x = xAtArc(d); const isK = d === 120, isHS = d === 130; const w = isK ? 1.4 : (d % 50 === 0 ? 0.9 : 0.55); const ang = groundAngle(x);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)); q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -ang));
      const base = C(isK ? 0xff3b3b : (isHS ? 0xffd23b : 0x3b7bff)); im.setColorAt(i, base);
      const u = { d, x, base, lit: false, t: 0, w, isK, q, pos: new THREE.Vector3(x, groundY(x) + 0.06, 0), i }; world.markers.push({ userData: u });
      im.setMatrixAt(i, new THREE.Matrix4().compose(u.pos, q, new THREE.Vector3(w, 44, 1)));
      const cx = (i % 4) * 128, cy = Math.floor(i / 4) * 64; g.fillStyle = isK ? '#d62b2b' : (isHS ? '#e0a300' : '#2e63d8'); g.fillRect(cx, cy, 128, 64); g.strokeStyle = '#fff'; g.lineWidth = 5; g.strokeRect(cx + 3, cy + 3, 122, 58);
      g.fillStyle = '#fff'; g.font = 'bold 40px Arial Black, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(isK ? 'K' + d : String(d), cx + 64, cy + 34);
      const uv = [cx / 512, 1 - cy / 256, (cx + 128) / 512, 1 - (cy + 64) / 256];
      [-1, 1].forEach((s) => { const z = s * 23.2; bb.quad(new THREE.Vector3(x, groundY(x) + 1.7, z), new THREE.Vector3(-s, 0, 0), new THREE.Vector3(0, 1, 0), 3.2, 1.6, uv); const pg = new THREE.BoxGeometry(0.18, 2.4, 0.18); pg.translate(x, groundY(x) + 1.2, z); pg.deleteAttribute('uv'); poleG.push(colorize(pg, C(0x4e6a8e))); });
    });
    im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; root.add(im); world.markerMesh = im;
    const tx = new THREE.CanvasTexture(cvs); tx.colorSpace = THREE.SRGBColorSpace; root.add(new THREE.Mesh(bb.geometry(), new THREE.MeshBasicMaterial({ map: tx, side: THREE.DoubleSide }))); root.add(new THREE.Mesh(mergeGeometries(poleG, false), lambertVC()));
    const tmpM = new THREE.Matrix4(), tmpS = new THREE.Vector3(), tmpC = new THREE.Color(), white = new THREE.Color(0xffffff);
    const setM = (u, sx) => { tmpS.set(sx, 44, 1); im.setMatrixAt(u.i, tmpM.compose(u.pos, u.q, tmpS)); };
    world.updateMarkers = (arcPassed) => { let dirty = false; world.markers.forEach((m) => { const u = m.userData; if (!u.lit && arcPassed >= u.d) { u.lit = true; u.t = 0; } if (u.lit && u.t < 60) { u.t += 1; const k = Math.min(1, u.t / 14); tmpC.copy(u.base).lerp(white, 0.55 * (1 - k * 0.4)); im.setColorAt(u.i, tmpC); setM(u, u.w * (1 + 2.2 * Math.sin(Math.min(1, k) * Math.PI) * (u.t < 24 ? 1 : 0))); dirty = true; } }); if (dirty) { im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; } };
    world.resetMarkers = () => { world.markers.forEach((m) => { const u = m.userData; u.lit = false; u.t = 0; im.setColorAt(u.i, u.base); setM(u, u.w); }); im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; };
  }

  // --- snow sparkle points (twinkle in shader)
  {
    const n = Q.sparkles; const pos = new Float32Array(n * 3), ph = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = -60 + Math.random() * 300; const z = (Math.random() - 0.5) * 70; pos[i * 3] = x; pos[i * 3 + 1] = terrainY(x, z) + 0.15; pos[i * 3 + 2] = z; ph[i] = Math.random() * 6.28; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('ph', new THREE.BufferAttribute(ph, 1));
    const cv = document.createElement('canvas'); cv.width = cv.height = 32; const c = cv.getContext('2d'); const gr = c.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, 32, 32); c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 2; c.beginPath(); c.moveTo(16, 0); c.lineTo(16, 32); c.moveTo(0, 16); c.lineTo(32, 16); c.stroke();
    const tx = new THREE.CanvasTexture(cv);
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { t: { value: 0 }, map: { value: tx }, scale: { value: 400 } },
      vertexShader: 'attribute float ph; uniform float t; uniform float scale; varying float vA; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); float tw = pow(max(0.0, sin(t*3.0 + ph*7.0)), 6.0); vA = tw; gl_PointSize = (0.35 + tw*0.9) * scale / -mv.z; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D map; varying float vA; void main(){ vec4 c = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vec3(1.0,0.98,0.9), c.a * vA); }' });
    const pts = new THREE.Points(g, mat); pts.frustumCulled = false; root.add(pts); world.sparkles = pts;
  }

  // --- per-frame
  world.update = (dt, t, focus) => {
    world.sparkles && (world.sparkles.material.uniforms.t.value = t);
    world.clouds.forEach((c) => { c.a += c.sp0 * dt * 8; c.sp.position.x = Math.cos(c.a) * c.r; c.sp.position.z = Math.sin(c.a) * c.r; });
    world.flags.forEach((f, i) => { f.rotation.z = Math.sin(t * 2 + i) * 0.03; f.position.y += Math.sin(t * 3 + i) * 0.002; });
    sideTime(t); const amp = world.cheer; bobU.uT.value = t; bobU.uA.value = 0.05 + amp * 0.35; bobU.uS.value = 3 + amp * 7;
    world.dogs.forEach((d, i) => { const u = d.userData; const b = Math.max(0, Math.sin(t * (4 + amp * 9) + u.ph)); d.position.y = u.base + b * (0.1 + amp * 0.9); });
    if (focus) { const x = focus.x, y = focus.y; sun.position.set(x + 14, y + 55, 24); sun.target.position.set(x, y, 0); }
  };
  return world;
}
