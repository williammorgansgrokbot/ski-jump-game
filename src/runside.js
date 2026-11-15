import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import SIDE from '../art/side/side.json';
import { HILL, runAt } from './physics.js';

// ---- batched billboard quads (many painted decals -> one draw call) --------------------------------
export class Batch {
  constructor() { this.pos = []; this.uv = []; this.idx = []; this.nrm = []; this.ph = []; this.n = 0; }
  quad(p, r, u, w, h, uv, phase) {            // p = bottom-centre, r = right (unit), u = up (unit)
    const hw = w / 2, o = this.n; const c = [[-hw, 0], [hw, 0], [hw, h], [-hw, h]];
    const nx = r.y * u.z - r.z * u.y, ny = r.z * u.x - r.x * u.z, nz = r.x * u.y - r.y * u.x;
    for (let i = 0; i < 4; i++) { this.pos.push(p.x + r.x * c[i][0] + u.x * c[i][1], p.y + r.y * c[i][0] + u.y * c[i][1], p.z + r.z * c[i][0] + u.z * c[i][1]); this.nrm.push(nx, ny, nz); this.ph.push(phase || 0); }
    this.uv.push(uv[0], uv[3], uv[2], uv[3], uv[2], uv[1], uv[0], uv[1]);   // uv = [u0, vTop, u1, vBottom]... see rectUV
    this.idx.push(o, o + 1, o + 2, o, o + 2, o + 3); this.n += 4;
  }
  quad4(a, b, c, d, uv, phase) {               // free quad BL, BR, TR, TL
    const o = this.n; [a, b, c, d].forEach((q) => { this.pos.push(q.x, q.y, q.z); this.nrm.push(0, 0, 1); this.ph.push(phase || 0); });
    this.uv.push(uv[0], uv[3], uv[2], uv[3], uv[2], uv[1], uv[0], uv[1]); this.idx.push(o, o + 1, o + 2, o, o + 2, o + 3); this.n += 4;
  }
  geometry() {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2)); g.setAttribute('aPh', new THREE.Float32BufferAttribute(this.ph, 1)); g.setIndex(this.idx); return g;
  }
}
// uv rect from the atlas json: [u0, v(top), u1, v(bottom)] in GL convention (v up)
export function rectUV(name, json) { const j = json || SIDE; const r = j.r[name]; return [r[0] / j.w, 1 - r[1] / j.h, (r[0] + r[2]) / j.w, 1 - (r[1] + r[3]) / j.h]; }
export function rectAspect(name, json) { const r = (json || SIDE).r[name]; return r[2] / r[3]; }
export const sideRect = (n) => SIDE.r[n];

const U = new THREE.Vector3(0, 1, 0);
const faceN = (s) => new THREE.Vector3(-0.86, 0, -0.5 * s).normalize();          // faces the oncoming skier, a little toward the track
const rightOf = (n) => new THREE.Vector3().crossVectors(U, n).normalize();
const V = (x, y, z) => new THREE.Vector3(x, y, z);

const waveU = { uT: { value: 0 } };
export const sideTime = (t) => { waveU.uT.value = t; };
function flagMaterial(map) {
  const m = new THREE.MeshBasicMaterial({ map, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uT = waveU.uT;
    sh.vertexShader = 'uniform float uT; attribute float aPh;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n float k = uv.x; transformed += normal * sin(k * 7.0 - uT * 6.0 + aPh) * 0.11 * k; transformed.y += sin(k * 5.0 - uT * 4.5 + aPh) * 0.04 * k;');
  };
  return m;
}

function canvasSigns(plateImg) {
  const plates = ['sign0', 'sign1', 'sign3', 'sign4', 'sign5'];
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 512; const g = cv.getContext('2d'); const rects = {};
  const items = [['d80', '80 m', 0], ['d60', '60 m', 0], ['d40', '40 m', 0], ['d20', '20 m', 0], ['s50', '50', 1], ['s70', '70', 1], ['s90', '90', 1], ['jump', 'JUMP!', 4]];
  const cw = 256, ch = 256; const lay = [];
  items.forEach(([id, label, pi], i) => {
    const cx = (i % 4) * cw, cy = Math.floor(i / 4) * ch; const r = sideRect(plates[pi]); const sc = Math.min((cw - 8) / r[2], (ch - 8) / r[3]); const w = r[2] * sc, h = r[3] * sc; const x = cx + (cw - w) / 2, y = cy + (ch - h);
    g.drawImage(plateImg, r[0], r[1], r[2], r[3], x, y, w, h);
    // number on the plate face (UI text, not character art)
    const fcx = x + w / 2, fcy = y + h * (pi === 1 ? 0.5 : 0.42); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    const fs = label.length > 3 ? h * 0.3 : h * 0.34; g.font = '900 ' + fs + 'px "Arial Black", Arial, sans-serif'; g.lineWidth = fs * 0.14; g.strokeStyle = 'rgba(20,30,70,.9)'; g.fillStyle = pi === 4 ? '#3b1d6a' : '#ffffff';
    if (pi !== 4) g.strokeText(label, fcx, fcy); g.fillText(label, fcx, fcy);
    if (pi === 1) { g.font = '900 ' + h * 0.11 + 'px "Arial Black", Arial, sans-serif'; g.lineWidth = 3; g.strokeText('km/h', fcx, fcy + h * 0.22); g.fillText('km/h', fcx, fcy + h * 0.22); }
    rects[id] = [x / 1024, 1 - y / 512, (x + w) / 1024, 1 - (y + h) / 512, w / h];
  });
  const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4; return { tx, rects };
}

// builds all the colourful trackside graphics; returns meshes already added to scene + animated bits
export function buildRunSide(scene, tex, Q, helpers) {
  const { terrainY, bobMat, runY } = helpers; const out = { meshes: [], dogs: [] };
  const atlas = tex.side; if (!atlas) return out;
  const add = (m) => { scene.add(m); out.meshes.push(m); return m; };
  const L = HILL.RUN_LEN;
  const P = (s) => runAt(Math.max(0, Math.min(L, s)));
  const decals = new Batch(), flags = new Batch(), signsB = new Batch();
  const BANN = ['banner0', 'banner1', 'banner2', 'banner3', 'banner4', 'banner5', 'banner6', 'banner7'];
  const FLAG = ['flag0', 'flag1', 'flag2', 'flag3', 'flag4', 'flag5', 'flag6', 'flag7', 'flag8'];
  const POST = ['post0', 'post1', 'post3', 'post4', 'post5'];
  const metal = [];   // poles etc (vertex-coloured boxes)
  const boxg = (w, h, d, x, y, z, color) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); g.deleteAttribute('uv'); const c = new THREE.Color(color); const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  const pole = (x, y0, y1, z, t, color) => metal.push(boxg(t, y1 - y0, t, x, (y0 + y1) / 2, z, color));

  // --- sponsor banners hung on the inner faces of both walls (follow the slope)
  let bi = 0;
  for (const s of [-1, 1]) {
    for (let a = 2.5 + (s > 0 ? 1.7 : 0); a < L - 3; a += 3.4) {
      const name = BANN[(bi++ * 3 + (s > 0 ? 1 : 0)) % BANN.length]; const asp = rectAspect(name); const hgt = 0.62, len = Math.min(3.0, hgt * asp);
      const p0 = P(a), p1 = P(a + len); const z = s * 1.243; const y0 = 0.09, y1 = y0 + hgt; const uv = rectUV(name);
      if (s < 0) decals.quad4(V(p0.x, p0.y + y0, z), V(p1.x, p1.y + y0, z), V(p1.x, p1.y + y1, z), V(p0.x, p0.y + y1, z), uv);
      else decals.quad4(V(p1.x, p1.y + y0, z), V(p0.x, p0.y + y0, z), V(p0.x, p0.y + y1, z), V(p1.x, p1.y + y1, z), uv);
    }
  }
  // --- big angled sponsor boards on posts + country-style flag poles + colourful light posts + signs
  const sg = canvasSigns(atlas.image); const sgUV = (id) => sg.rects[id];
  let k = 0;
  for (let a = 7; a < L - 2; a += 8) {
    const si = k % 2 ? 1 : -1; k++;
    // flags: both sides every 8 m
    for (const s of [-1, 1]) {
      const p = P(a + (s > 0 ? 2 : 0)); const n = faceN(s), r = rightOf(n); const zc = s * 3.3; const base = p.y - 0.35; const H = 4.6;
      pole(p.x, base, base + H, zc, 0.09, 0xf2f2f8); metal.push(new THREE.SphereGeometry(0.1, 6, 4).translate(p.x, base + H + 0.08, zc));
      const fn = FLAG[(k * 2 + (s > 0 ? 5 : 0)) % FLAG.length]; const fa = rectAspect(fn); const fw = 1.9, fh = fw / fa;
      // flag hangs from the pole toward the track side (r direction), top at pole top
      const ph = k * 1.3 + s; const pos0 = V(p.x, base + H - fh, zc);
      const rr = r.clone().multiplyScalar(s > 0 ? -1 : 1);
      flags.quad(pos0.clone().addScaledVector(rr, fw / 2 + 0.05), rr, U, fw, fh, rectUV(fn), ph);
    }
    // light posts (painted sprites)
    for (const s of [-1, 1]) {
      const p = P(a + 4 + (s > 0 ? 1.5 : 0)); const n = faceN(s), r = rightOf(n); const pn = POST[(k + (s > 0 ? 2 : 0)) % POST.length]; const h = 3.1; const w = h * rectAspect(pn);
      decals.quad(V(p.x, p.y - 0.33, s * 2.3), r, U, w, h, rectUV(pn));
    }
    // sponsor billboard on posts, alternating sides
    {
      const s = si; const p = P(a + 2.5); const n = faceN(s), r = rightOf(n); const name = BANN[(k * 5 + 2) % BANN.length]; const asp = rectAspect(name); const w = 4.4, h = w / asp; const zc = s * 4.2; const base = p.y - 0.4;
      pole(p.x - r.x * 1.7, base, base + 2.6, zc - r.z * 1.7, 0.12, 0x3b4a78); pole(p.x + r.x * 1.7, base, base + 2.6, zc + r.z * 1.7, 0.12, 0x3b4a78);
      decals.quad(V(p.x, base + 1.35, zc), r, U, w, h, rectUV(name)); metal.push(boxg(w + 0.12, 0.1, 0.1, p.x, base + 1.3, zc, 0xffffff).applyMatrix4(new THREE.Matrix4()));
    }
  }
  // distance + speed signs (UI text on painted plates)
  const sigList = [[12, 'd80', -1], [24, 's50', 1], [36, 'd60', -1], [48, 's70', 1], [60, 'd40', -1], [70, 's90', 1], [78, 'd20', -1], [86, 'jump', 1]];
  sigList.forEach(([a, id, s]) => {
    const p = P(a); const n = faceN(s), r = rightOf(n); const uv = sgUV(id); const h = 1.35, w = h * uv[4]; const base = p.y - 0.33; const z = s * 2.65;
    pole(p.x, base, base + 1.4, z, 0.08, 0xdfe8f6); signsB.quad(V(p.x, base + 1.2, z), r, U, w, h, uv);
  });

  // --- walkway apron along both rails (candy stripes) + start gallery decks
  const dg = [];
  const stripe = (pts0, z0, z1, y, color, flipS) => { const n = pts0.length; const pos = [], col = [], idx = []; const c = new THREE.Color(color); for (let i = 0; i < n; i++) { pos.push(pts0[i].x, pts0[i].y + y, z0, pts0[i].x, pts0[i].y + y, z1); col.push(c.r, c.g, c.b, c.r, c.g, c.b); } for (let i = 0; i < n - 1; i++) { const a = i * 2; if (flipS) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals(); return g; };
  const CANDY = [0xff5d73, 0xffffff, 0x45b6fe, 0xffffff, 0xffd23f, 0xffffff, 0x5be37d, 0xffffff];
  for (const s of [-1, 1]) {
    let ci = 0;
    for (let a = 0; a < L; a += 2.5) { const pts = []; for (let q = a; q <= Math.min(L, a + 2.5) + 0.01; q += 0.625) pts.push(P(q)); dg.push(stripe(pts, s * 1.5, s * 1.78, 0.0, CANDY[ci++ % CANDY.length], s > 0)); }   // painted rail cap
    const pts2 = []; for (let q = 0; q <= L; q += 1) pts2.push(P(q)); dg.push(stripe(pts2, s * 1.78, s * 5.2, -0.35, 0xb98a56, s > 0));   // wooden walkway
    ci = 0; for (let a = 0; a < L; a += 3) { const pts = []; for (let q = a; q <= Math.min(L, a + 1.5) + 0.01; q += 0.5) pts.push(P(q)); dg.push(stripe(pts, s * 4.9, s * 5.2, -0.33, CANDY[(ci++ * 2) % CANDY.length], s > 0)); }
    // gallery deck near the top for the cheering crowd
    const gp = []; for (let q = 0; q <= 38; q += 1) gp.push(P(q)); dg.push(stripe(gp, s * 5.2, s * 9.5, -0.35, 0xa77c4e, s > 0)); dg.push(stripe(gp, s * 9.1, s * 9.5, 0.3, 0xffd23f, s > 0));
    for (let q = 2; q <= 38; q += 6) { const p = P(q); [5.8, 9.2].forEach((zz) => { const g0 = terrainY(p.x, s * zz) - 1.2; const h = p.y - 0.4 - g0; if (h > 0.3) metal.push(boxg(0.4, h, 0.4, p.x, g0 + h / 2, s * zz, 0x4e6a8e)); }); }
  }
  if (dg.length) add(new THREE.Mesh(mergeGeometries(dg, false), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  if (metal.length) { metal.forEach((g) => { if (!g.attributes.color) { const n = g.attributes.position.count, a = new Float32Array(n * 3).fill(0.95); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); } if (g.attributes.uv) g.deleteAttribute('uv'); }); add(new THREE.Mesh(mergeGeometries(metal.map((g) => (g.index ? g.toNonIndexed() : g)), false), new THREE.MeshLambertMaterial({ vertexColors: true }))); }

  // --- cheering crowd on the gallery + dogs
  {
    const bat = { a: new Batch(), b: new Batch() }; const texes = [tex.crowdA, tex.crowdB];
    let c = 0;
    for (const s of [-1, 1]) for (let row = 0; row < 2; row++) for (let a = 1.5 + row * 2.2; a < 38; a += 4.6) {
      const p = P(a); const n = faceN(s), r = rightOf(n); const ti = (c++) % 2; const t = texes[ti]; if (!t) continue; const W = 5.6; const ar = t.image ? t.image.height / t.image.width : 0.37;
      bat[ti ? 'b' : 'a'].quad(V(p.x, p.y - 0.33 + row * 0.55, s * (6.2 + row * 2.2)), r, U, W, W * ar, [0, 1, 1, 0], Math.random() * 6.28);
    }
    ['a', 'b'].forEach((q, i) => { if (bat[q].n && texes[i]) add(new THREE.Mesh(bat[q].geometry(), bobMat(texes[i]))); });
    [['stormy', 5, -1], ['emma', 5.5, 1], ['emma', 17, -1], ['stormy', 19, 1]].forEach(([nm, a, s], i) => {
      const t = tex[nm]; if (!t) return; const ar = t.image ? t.image.height / t.image.width : 1.2; const h = 1.9; const p = P(a); const n = faceN(s), r = rightOf(n);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(h / ar, h), new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide })); const y0 = p.y - 0.3;
      m.position.set(p.x, y0 + h / 2, s * 3.7); m.rotation.y = Math.atan2(n.x, n.z); m.userData = { base: y0 + h / 2, ph: i * 1.9 }; scene.add(m); out.dogs.push(m);
    });
  }

  // --- gates and pennant strings across the run
  {
    [['archA', 15, 7.6], ['archB', 57, 7.6]].forEach(([k2, a, w]) => {
      const t = tex[k2]; if (!t) return; const p = P(a); const h = w * (t.image ? t.image.height / t.image.width : 0.54);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide })); m.position.set(p.x, p.y - 0.55 + h / 2, 0); m.rotation.y = -Math.PI / 2; m.renderOrder = 2; add(m);
    });
    if (tex.bunting) {
      const bg = []; const ar = tex.bunting.image ? tex.bunting.image.height / tex.bunting.image.width : 0.45;
      [30, 44, 72, 84].forEach((a) => { const p = P(a); const w = 7.4, h = w * ar; const g = new THREE.PlaneGeometry(w, h); g.rotateY(-Math.PI / 2); g.translate(p.x, p.y + 4.0 - h / 2, 0); bg.push(g); });
      add(new THREE.Mesh(mergeGeometries(bg, false), new THREE.MeshBasicMaterial({ map: tex.bunting, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide })));
    }
  }
  // --- batched decal meshes
  if (decals.n) { const m = new THREE.Mesh(decals.geometry(), new THREE.MeshBasicMaterial({ map: atlas, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide })); m.renderOrder = 1; add(m); }
  if (flags.n) { const m = new THREE.Mesh(flags.geometry(), flagMaterial(atlas)); m.renderOrder = 1; add(m); }
  if (signsB.n) { const m = new THREE.Mesh(signsB.geometry(), new THREE.MeshBasicMaterial({ map: sg.tx, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide })); m.renderOrder = 1; add(m); }

  // --- glowing lane lines (additive, scrolling chevron pulse)
  {
    const pos = [], uv = [], idx = [], cl = []; let o = 0;
    const lines = [[0.55, 0.11, 0], [-0.55, 0.11, 1], [1.02, 0.06, 2], [-1.02, 0.06, 3]];
    for (const [z, w, id] of lines) { for (let q = 0; q <= L + 0.01; q += 0.75) { const p = P(q); pos.push(p.x, p.y + 0.035, z - w / 2, p.x, p.y + 0.035, z + w / 2); uv.push(q, 0, q, 1); cl.push(id, id); } for (let i = 0; i < Math.floor(L / 0.75 + 1) - 1; i++) { const a = o + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } o = pos.length / 3; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('lane', new THREE.Float32BufferAttribute(cl, 1)); g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: waveU,
      vertexShader: 'attribute float lane; varying vec2 vUv; varying float vL; void main(){ vUv = uv; vL = lane; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform float uT; varying vec2 vUv; varying float vL; void main(){ float e = 1.0 - abs(vUv.y - 0.5) * 2.0; float pulse = 0.5 + 0.5 * sin(vUv.x * 0.9 - uT * 9.0 + vL * 1.7); vec3 c = mix(vec3(0.1,0.95,1.0), vec3(1.0,0.2,0.9), 0.5 + 0.5 * sin(vUv.x * 0.07 + uT * 1.3 + vL)); gl_FragColor = vec4(c * (0.55 + 0.9 * pulse) * e, e * (0.6 + 0.4 * pulse)); }' });
    const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 3; add(m);
  }
  // --- coloured sparkles hanging around the run
  {
    const n = Q.runSparkles || 260; const pos = new Float32Array(n * 3), ph = new Float32Array(n), col = new Float32Array(n * 3); const pal = [0x66e0ff, 0xff7ad8, 0xffe14a, 0x9bff8a, 0xffffff, 0xb28bff]; const c = new THREE.Color();
    for (let i = 0; i < n; i++) { const p = P(Math.random() * L); pos[i * 3] = p.x + (Math.random() - 0.5) * 3; pos[i * 3 + 1] = p.y + 0.3 + Math.random() * 3.2; pos[i * 3 + 2] = (Math.random() - 0.5) * 9; ph[i] = Math.random() * 6.28; c.setHex(pal[i % pal.length]); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('ph', new THREE.BufferAttribute(ph, 1)); g.setAttribute('col', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: Object.assign({ scale: { value: 500 } }, waveU),
      vertexShader: 'attribute float ph; attribute vec3 col; uniform float uT; uniform float scale; varying vec3 vC; varying float vA; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); float tw = 0.35 + 0.65 * pow(max(0.0, sin(uT*3.0 + ph*7.0)), 2.0); vA = tw; vC = col; gl_PointSize = min(34.0, (0.22 + tw*0.3) * scale / -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying vec3 vC; varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); float a = smoothstep(0.5, 0.0, r); a += 0.6 * smoothstep(0.08, 0.0, abs(d.x)) * (1.0 - r*2.0) + 0.6 * smoothstep(0.08, 0.0, abs(d.y)) * (1.0 - r*2.0); gl_FragColor = vec4(vC, clamp(a, 0.0, 1.0) * vA); }' });
    const pts = new THREE.Points(g, mat); pts.frustumCulled = false; add(pts); out.sparkMat = mat;
  }
  return out;
}
