import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Skier, SUITS, loadSkierAssets } from './skier.js';
import { buildWorld, terrainY } from './world.js';
import { Spray, Confetti, Streaks } from './fx.js';
import * as P from './physics.js';
import * as A from './audio.js';

const $ = (id) => document.getElementById(id);
const V3 = THREE.Vector3, Q4 = THREE.Quaternion;
const sstep = (k) => { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); };
const lerp = (a, b, k) => a + (b - a) * k;
const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------- quality tier
const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const mobile = params.get('q') === 'low' || (params.get('q') !== 'high' && (isIOS || /Android/.test(ua) || (window.matchMedia && matchMedia('(pointer:coarse)').matches)));
const QUAL = mobile ? { pr: 1.5, shadows: true, shadowMap: 1024, shadowTower: false, trees: 90, sparkles: 220 } : { pr: 2, shadows: true, shadowMap: 2048, shadowTower: true, trees: 300, sparkles: 500 };
let qLevel = 0;

// ---------------------------------------------------------------- storage
const store = {
  get(k, d) { try { const v = localStorage.getItem('sj_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('sj_' + k, JSON.stringify(v)); } catch (e) {} },
};

// ---------------------------------------------------------------- renderer / loading
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!params.get('shots') });
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = QUAL.shadows; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
let pixelRatio = Math.min(window.devicePixelRatio || 1, QUAL.pr);
const cam = new THREE.PerspectiveCamera(60, 1, 0.05, 2500);
const tcam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);

const texLoader = new THREE.TextureLoader();
function loadTex(url, srgb) { return new Promise((res) => texLoader.load(url, (t) => { if (srgb !== false) t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 1; res(t); }, undefined, () => res(null))); }
const TEXFILES = { ridge: 'ridge.png', cloud: 'cloud.png', bunting: 'bunting.png', crowdA: 'crowd_a.png', crowdB: 'crowd_b.png', stormy: 'dog_stormy.png', emma: 'dog_emma.png', puff: 'puff.png' };
function loadGLB(url) { return new Promise((res, rej) => new GLTFLoader().load(url, res, undefined, rej)); }
async function loadPine() {
  const g = await loadGLB('models/pine.glb'); const geos = [];
  g.scene.updateMatrixWorld(true);
  g.scene.traverse((o) => { if (!o.isMesh) return; const ge = o.geometry.clone(); ge.applyMatrix4(o.matrixWorld); const mats = Array.isArray(o.material) ? o.material : [o.material];
    ['uv', 'uv1', 'tangent'].forEach((a) => ge.deleteAttribute(a)); const n = ge.attributes.position.count; const col = new Float32Array(n * 3); const c = new THREE.Color();
    const groups = ge.groups.length ? ge.groups : [{ start: 0, count: ge.index ? ge.index.count : n, materialIndex: 0 }];
    const idx = ge.index; const nonIdx = ge.toNonIndexed(); const cols = new Float32Array(nonIdx.attributes.position.count * 3);
    groups.forEach((gr) => { const m = mats[gr.materialIndex] || mats[0]; c.copy(m.color); const nm = (m.name || '').toLowerCase(); if (nm.indexOf('snow') >= 0) c.setHex(0xffffff).convertSRGBToLinear(); else if (nm.indexOf('green') >= 0) c.setHex(0x2f9c66).convertSRGBToLinear(); else if (nm.indexOf('wood') >= 0) c.setHex(0x6b4a30).convertSRGBToLinear(); for (let i = gr.start; i < gr.start + gr.count; i++) { cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; } });
    nonIdx.setAttribute('color', new THREE.BufferAttribute(cols, 3)); geos.push(nonIdx); });
  const m = mergeGeometries(geos, false); m.computeVertexNormals(); return m;
}

// ---------------------------------------------------------------- DOM refs
const el = { title: $('title'), hud: $('hud'), result: $('result'), bg: $('bg'), go: $('go'), count: $('count'), call: $('call'), grade: $('grade'), dnum: $('dnum'), dlab: $('dlab'), dunit: $('dunit'), hsub: $('hsub'),
  mSpeed: $('m-speed'), mLaunch: $('m-launch'), mLand: $('m-land'), ndl: $('ndl'), mk: $('mk'), rot: $('dial-rot'), banner: $('banner'), bnum: $('bnum'), blab: $('blab'), newrec: $('newrec'), score: $('score'), toast: $('unlocktoast') };

// ---------------------------------------------------------------- game state
const G = { state: 'loading', t: 0, ts: 1, tsTarget: 1, wall: 0 };
let fpSkis, world, skier, titleScene, spray, confetti, streaks;
let suitId = store.get('suit', 'wyatt'); let equip = store.get('equip', { suit: null, ski: null });
let auto = null;                             // QA autoplay
const run = { s: 0, v: 0, tapped: false, speedPos: 0.5, speedRes: null, t: 0, tn: 0 };
const lip = { t: 0, tapped: false, pos: 0, res: null };
const fl = { sim: null, ft: 0, landTap: false, landDt: 0, grade: null, landT0: 0, landed: false, x: 0, y: 0, dist: 0, slide: null, touchT: 0, cheering: false };
let flash = 0;

// ---------------------------------------------------------------- layout
function resize() {
  const w = window.innerWidth, h = window.innerHeight; renderer.setPixelRatio(pixelRatio); renderer.setSize(w, h, false);
  cam.aspect = w / h; cam.updateProjectionMatrix(); tcam.aspect = w / h; tcam.updateProjectionMatrix();
  fitTitleCam();
}
function fitTitleCam() { const a = tcam.aspect; tcam.fov = 30; tcam.position.set(0, 1.1, a > 1.6 ? 9.5 : 8); tcam.lookAt(0.0, 0.9, 0); const shift = Math.min(0.28, 0.12 + (a - 1.5) * 0.1); tcam.setViewOffset(1000, 1000, -shift * 1000, 0, 1000, 1000); tcam.updateProjectionMatrix(); }
window.addEventListener('resize', resize); window.addEventListener('orientationchange', () => setTimeout(resize, 200));
document.addEventListener('gesturestart', (e) => e.preventDefault()); document.addEventListener('dblclick', (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

// ---------------------------------------------------------------- UI helpers
function show(e, on) { e.classList.toggle('hidden', !on); }
function setMuteIcons() { const m = A.isMuted(); ['mute', 'mute2'].forEach((i) => { $(i).textContent = m ? '🔇' : '♪'; }); }
function pop(textEl, text, cls) { textEl.textContent = text; textEl.style.color = cls || '#fff'; textEl.classList.remove('show'); void textEl.offsetWidth; textEl.classList.add('show'); }
const GRADE_COL = { PERFECT: '#ffe27a', GREAT: '#7dffb0', GOOD: '#8fd2ff', OK: '#ffffff', SLOPPY: '#ffb199' };
function showGrade(g) { pop(el.grade, g + (g === 'OK' || g === 'GOOD' || g === 'SLOPPY' ? '' : '!'), GRADE_COL[g] || '#fff'); A.sfx(g === 'PERFECT' ? 'perfect' : g === 'GREAT' ? 'great' : g === 'GOOD' ? 'good' : 'ok'); }
function best() { return store.get('best', 0); }
function recordsList() { return store.get('records', []); }

function buildTitleUI() {
  const row = $('skiers'); row.innerHTML = '';
  Object.keys(SUITS).forEach((id) => { const S = SUITS[id]; const b = document.createElement('button'); b.className = 'chip txt'; b.dataset.id = id; b.innerHTML = '<span class="dot" style="background:#' + S.suit.toString(16).padStart(6, '0') + '"></span>' + S.name; b.onclick = () => { pickSuit(id); A.sfx('click'); }; row.appendChild(b); });
  const gr = $('gears'); gr.innerHTML = ''; const bd = best();
  P.UNLOCKS.forEach((u) => { const b = document.createElement('button'); const ok = bd >= u.need; b.className = 'chip gear txt' + (ok ? '' : ' locked'); b.dataset.id = u.id; b.innerHTML = (ok ? '' : '🔒 ') + u.name + '<small>' + (ok ? (equip[u.kind] === u.id ? 'ON' : 'TAP') : u.need + ' m') + '</small>'; b.onclick = () => { if (!ok) { A.sfx('ok'); return; } equip[u.kind] = equip[u.kind] === u.id ? null : u.id; store.set('equip', equip); applyLook(); buildTitleUI(); A.sfx('click'); }; if (ok && equip[u.kind] === u.id) b.classList.add('sel'); gr.appendChild(b); });
  const recs = recordsList(); const r = $('recs'); r.innerHTML = '<div class="best txt">' + (bd ? 'HILL RECORD<br>' + bd.toFixed(1) + ' m' : 'HILL RECORD<br>— — —') + '</div>';
  recs.slice(0, 5).forEach((x, i) => { const d = document.createElement('div'); d.className = 'rec txt'; d.innerHTML = '<img src="art/' + (i === 0 ? 'trophy' : 'medal') + '.png" alt="">' + x.d.toFixed(0) + ' m<br>' + x.who; r.appendChild(d); });
  document.querySelectorAll('#skiers .chip').forEach((c) => c.classList.toggle('sel', c.dataset.id === suitId));
  setMuteIcons();
}
function pickSuit(id) { suitId = id; store.set('suit', id); applyLook(); document.querySelectorAll('#skiers .chip').forEach((c) => c.classList.toggle('sel', c.dataset.id === id)); if (skier && G.state === 'title') { skier.play('cheerFist', 0.15); skier.rainbow = !!skier.rainbow; setTimeout(() => { if (G.state === 'title') skier.play('idle', 0.4); }, 1300); } }
function applyLook() {
  if (!skier) return; skier.setSuit(suitId); skier.rainbow = false;
  const M = skier.mats; const setc = (k, h) => { if (M[k]) M[k].color.setHex(h); };
  if (equip.suit === 'gold') { setc('Shirt', 0xf5b800); setc('Pants', 0xf5b800); setc('H_Helmet', 0xffd84a); setc('H_Collar', 0x2b2b35); setc('H_HelmetStripe', 0x2b2b35); skier.setPanels(0x2b2b35, 0xb88a00); }
  if (equip.suit === 'galaxy') { setc('Shirt', 0x5b2bd1); setc('Pants', 0x3b1d9c); setc('H_Helmet', 0x7a4cff); setc('H_Collar', 0x45f0ff); setc('H_HelmetStripe', 0x45f0ff); skier.setPanels(0x45f0ff, 0x2a1580); if (M.G_Lens) M.G_Lens.color.setHex(0x45f0ff); }
  ['L', 'R'].forEach((s) => { if (equip.ski === 'flame') { setc('S_SkiTop' + s, 0xff7a1a); setc('S_SkiStripe' + s, 0xffe14a); } if (equip.ski === 'rainbow') skier.rainbow = true; });
}
// ---------------------------------------------------------------- camera rigs
const camState = { pos: new V3(), look: new V3(), fov: 60, roll: 0 };
const blend = { t: 1, dur: 0.4, p: new V3(), q: new Q4(), f: 60 };
const _m = new THREE.Matrix4(), _q = new Q4(), _up = new V3(0, 1, 0);
function startBlend(dur) { blend.t = 0; blend.dur = dur; blend.p.copy(cam.position); blend.q.copy(cam.quaternion); blend.f = cam.fov; }
function applyCam(dt, snap) {
  _m.lookAt(camState.pos, camState.look, _up); _q.setFromRotationMatrix(_m);
  if (camState.roll) { _q.multiply(new Q4().setFromAxisAngle(new V3(0, 0, 1), camState.roll)); }
  if (blend.t < 1 && !snap) { blend.t = Math.min(1, blend.t + dt / blend.dur); const w = sstep(blend.t); cam.position.lerpVectors(blend.p, camState.pos, w); cam.quaternion.slerpQuaternions(blend.q, _q, w); cam.fov = lerp(blend.f, camState.fov, w); }
  else { cam.position.copy(camState.pos); cam.quaternion.copy(_q); cam.fov = camState.fov; }
  cam.updateProjectionMatrix();
}
const headW = new V3(), fwdW = new V3();
function camFP(dt) {
  skier.root.updateMatrixWorld(true); skier.bones.Head.getWorldPosition(headW);
  const ang = skier.root.rotation.z;                 // negative when pointing downhill
  const fwd = fwdW.set(Math.cos(ang * 0.97), Math.sin(ang * 0.97), 0).normalize();
  const spd = run.v; const sh = Math.min(1, spd / 24);
  const nz = G.wall * 40;
  const bx = headW.x + fwd.x * 0.05 - fwd.y * 0.12, by = headW.y + fwd.y * 0.05 + fwd.x * 0.12;
  camState.pos.set(bx, by + Math.sin(nz) * 0.012 * sh + Math.sin(nz * 2.7) * 0.01 * sh, Math.sin(nz * 1.7) * 0.015 * sh);
  camState.look.copy(camState.pos).addScaledVector(fwd, 20); camState.look.y += -1.4 + Math.sin(nz * 1.3) * 0.12 * sh;
  camState.fov = 66 + 14 * sh + 3 * sstep((run.t - 0.3) / 3); camState.roll = Math.sin(nz * 0.9) * 0.01 * sh;
}
const droneP = new V3(), droneL = new V3(); let droneInit = false;
function camDrone(dt, mode) {
  // three-quarter chase drone: behind and beside the skier, looking down the hill so the landing zone is ahead
  const r = skier.root.position; const t = G.wall;
  let dz = 3.8, dy = 2.5, back = 5.0, lx = 8.0, ly = -2.3, fov = 40, kp = 9, kl = 12;
  if (mode === 'land') { dz = 4.0; dy = 2.2; back = 4.2; lx = 5.0; ly = -0.3; fov = 40; kp = 6; kl = 8; }
  if (mode === 'celebrate') { dz = 8.4; dy = 3.0; back = 0; lx = 0.4; ly = 2.3; fov = 42; kp = 3; kl = 4; }
  const tp = new V3(r.x - back, r.y + dy, dz + Math.sin(t * 0.7) * 0.25);
  const tl = new V3(r.x + lx, r.y + ly, -0.6);
  if (!droneInit) { droneP.copy(tp); droneL.copy(tl); camState.fov = fov; droneInit = true; }
  const kyp = 1 - Math.exp(-dt * kp * 2.4), kyl = 1 - Math.exp(-dt * kl * 2.4); droneP.x += (tp.x - droneP.x) * (1 - Math.exp(-dt * kp)); droneP.y += (tp.y - droneP.y) * kyp; droneP.z += (tp.z - droneP.z) * (1 - Math.exp(-dt * kp)); droneL.x += (tl.x - droneL.x) * (1 - Math.exp(-dt * kl)); droneL.y += (tl.y - droneL.y) * kyl; droneL.z += (tl.z - droneL.z) * 0.2;
  camState.pos.copy(droneP); camState.pos.y += Math.sin(t * 1.3) * 0.08; camState.look.copy(droneL); camState.fov = lerp(camState.fov, fov, 1 - Math.exp(-dt * 8)); camState.roll = Math.sin(t * 0.8) * 0.01;
  if (G.shake > 0) { camState.pos.x += (Math.random() - 0.5) * G.shake * 0.4; camState.pos.y += (Math.random() - 0.5) * G.shake * 0.4; G.shake = Math.max(0, G.shake - dt * 2.2); }
}
function sampleVel() { const s = P.sampleAt(fl.sim, Math.min(fl.ft, fl.sim.tHit)); return { x: s.vx, y: s.vy }; }

// ---------------------------------------------------------------- run flow
function setTimeScale(v) { G.tsTarget = v; }
function toTitle() {
  G.state = 'title'; show(el.title, true); show(el.hud, false); show(el.result, false); el.bg.style.opacity = 1; el.banner.classList.remove('show'); el.newrec.classList.remove('show'); confetti && confetti.stop();
  titleScene.add(skier.root); skier.root.scale.setScalar(1); skier.root.position.set(0, 0, 0); skier.root.rotation.set(0, -1.25, 0); skier.fp && skier.fp(false); applyLook(); skier.play('idle', 0.3); G.tt = 6.2;
  droneInit = false; A.music('title'); A.stopWind(); world && (world.cheer = 0); buildTitleUI(); G.ts = G.tsTarget = 1;
}
function startRun() {
  A.initAudio(); A.unlockSpeech(); A.music('run'); A.startWind(); A.sfx('click');
  G.state = 'ready'; G.t = 0; show(el.title, false); show(el.result, false); show(el.hud, true); el.bg.style.opacity = 0; el.banner.classList.remove('show'); el.banner.style.opacity = ''; el.newrec.classList.remove('show'); confetti.stop();
  world.resetMarkers(); world.cheer = 0; world.scene.add(skier.root); skier.root.scale.setScalar(1); applyLook(); skier.fp(true);
  const p = P.runAt(0); skier.root.position.set(p.x, p.y, 0); skier.root.rotation.set(0, 0, -p.ang); skier.play('crouch', 0.5);
  Object.assign(run, { s: 0, v: 0, tapped: false, speedPos: 0.5, speedRes: null, t: 0, tn: 0 }); Object.assign(lip, { t: 0, tapped: false, pos: 0, res: null });
  Object.assign(fl, { sim: null, ft: 0, landTap: false, landDt: 0, grade: null, landed: false, dist: 0, slide: null, touchT: 0, cheering: false });
  G.ts = G.tsTarget = 1; G.readyT = 0; G.shake = 0; droneInit = false; streaks.setMode('fp');
  show(el.mSpeed, false); show(el.mLaunch, false); show(el.mLand, false); el.dlab.textContent = 'SPEED'; el.dunit.textContent = 'km/h'; el.dnum.textContent = '0'; el.hsub.textContent = '';
  camFP(0.016); applyCam(0.016, true); blend.t = 1;
  const sw = 0.11, pf = 0.04; $('sw-great').style.left = (0.86 - sw) * 100 + '%'; $('sw-great').style.width = sw * 2 * 100 + '%'; $('sw-perfect').style.left = (0.86 - pf) * 100 + '%'; $('sw-perfect').style.width = pf * 2 * 100 + '%';
  el.count.textContent = '3'; A.sfx('beep');
}
function beginInrun() { G.state = 'inrun'; el.count.textContent = ''; pop(el.call, 'GO!', '#7dffb0'); A.sfx('go'); show(el.mSpeed, true); run.t = 0; run.v = 0.6; }
function lipPos() { return 0.5 - 0.5 * Math.cos(2 * Math.PI * lip.t / 1.5); }
function onTap() {
  if (G.state === 'inrun' && !run.tapped && run.t > 0.35) {
    run.tapped = true; run.speedRes = P.speedFromMeter(run.speedPos); showGrade(run.speedRes.grade); $('m-speed').querySelector('.name').textContent = run.speedRes.grade + '!'; A.sfx('tap');
  } else if (G.state === 'lip' && !lip.tapped) {
    lip.tapped = true; lip.res = P.launchFromMeter(lip.pos); showGrade(lip.res.grade); setTimeScale(0.6); show(el.mLaunch, false);
  } else if (G.state === 'flight' && fl.sim && !fl.landTap && fl.ft > fl.sim.tHit - 1.5 && !fl.landed) {
    fl.landTap = true; fl.landDt = fl.sim.tHit - fl.ft; A.sfx('tap'); $('m-land').querySelector('.name').textContent = '✔';
  } else if (G.state === 'flight' && fl.landed && !fl.landTap && fl.ft - fl.sim.tHit < 0.4) { fl.landTap = true; fl.landDt = fl.sim.tHit - fl.ft; A.sfx('tap'); }
}
function beginLip() { G.state = 'lip'; lip.t = 0; show(el.mSpeed, false); show(el.mLaunch, true); setTimeScale(0.3); A.sfx('whoosh');
  const sw = P.LAUNCH_SWEET; const arc = (a) => { const ang = Math.PI * (1 - a); return [110 + 96 * Math.cos(ang), 112 - 96 * Math.sin(ang)]; };
  const seg = (c, h) => { const a0 = arc(c - h), a1 = arc(c + h); return 'M' + a0[0].toFixed(1) + ' ' + a0[1].toFixed(1) + ' A96 96 0 0 1 ' + a1[0].toFixed(1) + ' ' + a1[1].toFixed(1); };
  $('dial-great').setAttribute('d', seg(sw, 0.09)); $('dial-perfect').setAttribute('d', seg(sw, 0.035)); }
function takeoff() {
  const v0 = run.v; const lres = lip.res || P.launchFromMeter(lip.pos); const e = lres.e; if (!lip.res) { lip.res = lres; showGrade(lres.grade); }
  const wind = (Math.random() - 0.5) * 0.0; fl.sim = P.simulateFlight(v0, e, wind); fl.ft = 0; fl.v0 = v0; fl.e = e;
  G.state = 'flight'; setTimeScale(1); skier.fp(false); skier.root.scale.setScalar(1.35); startBlend(0.55); droneInit = false; streaks.setMode('side'); show(el.mLand, false);
  skier.play('takeoff', 0.05); fl.flightQueued = true; A.sfx('launch'); G.shake = 0.5; spray.burst(skier.root.position.x, skier.root.position.y, 0, 14, 6, 6, 0.9);
  el.dlab.textContent = 'DISTANCE'; el.dunit.textContent = 'm'; el.dnum.textContent = '0';
  const mp = P.speedFromMeter(run.speedPos); fl.speedGrade = (run.speedRes || mp).grade; if (!run.speedRes) run.speedRes = mp;
}
function touchdown() {
  const h = fl.sim.hit; fl.landed = true; fl.dist = fl.sim.dist; fl.touchT = G.wall;
  const dtp = fl.landTap ? fl.landDt : 9; fl.grade = P.gradeLanding(dtp); const wait = !fl.landTap;
  fl.pendingGrade = wait; fl.grace = 0.2;
  const x = h.x, y = P.groundY(x); skier.root.position.set(x, y, 0);
  const tang = Math.max(8, h.sp * 0.82); fl.slide = { x, v: tang };
  if (fl.grade.name === 'SLOPPY' && !wait) skier.play('sloppy', 0.04); else skier.play('telemark', 0.04);
  spray.burst(x, y, 0, 30, 8, h.vx * 0.3, 1.1); A.sfx('land'); A.sfx('skid'); G.shake = 0.9; world.cheer = 0.6;
  el.dnum.textContent = fl.dist.toFixed(1); show(el.mLand, false);
  // style points
  fl.styleLaunch = Math.round(20 * lip.res.q * (lip.res.grade === 'PERFECT' ? 1 : 0.9)); fl.styleSpeed = Math.round(10 * run.speedRes.q);
  if (!wait) finishGrade();
  setTimeout(() => { if (G.state !== 'landing' && G.state !== 'flight') return; announce(); }, 650);
}
function finishGrade() { fl.pendingGrade = false; showGrade(fl.grade.name); fl.styleLand = fl.grade.pts; }
function announce() {
  if (fl.announced) return; fl.announced = true;
  const d = fl.dist; el.bnum.textContent = d.toFixed(1); el.blab.textContent = d >= P.HILL.HS ? 'HILL RECORD DISTANCE!' : d >= P.HILL.K ? 'PAST THE K-POINT!' : 'DISTANCE'; el.banner.classList.remove('show'); void el.banner.offsetWidth; el.banner.classList.add('show');
  confetti.start(); A.sfx('cheer'); A.sfx('fanfare'); world.cheer = d >= P.HILL.K ? 1 : 0.75; A.speak(Math.round(d) + ' meters!');
  G.shake = 0.4;
}
function enterCelebrate() {
  G.state = 'celebrate'; const pick = Math.random() < 0.5 ? 'cheerFist' : 'cheerShow'; skier.play(pick, 0.35); skier.root.rotation.z = lerp(skier.root.rotation.z, -P.groundAngle(skier.root.position.x), 0.5); A.music('win'); A.stopWind();
  setTimeout(showResult, 1700);
}
function showResult() {
  if (G.state !== 'celebrate') return; G.state = 'result'; el.banner.style.opacity = 0;
  const d = fl.dist; const style = (fl.styleLaunch || 0) + (fl.styleLand || 0) + (fl.styleSpeed || 0); const total = Math.round(d) + style;
  const oldBest = best(); const isRec = d > oldBest + 0.001; const nm = SUITS[suitId].name;
  el.score.innerHTML = '<span>Distance</span><b>' + d.toFixed(1) + ' m</b><span>Speed (' + (run.speedRes.grade) + ')</span><b>+' + (fl.styleSpeed || 0) + '</b><span>Takeoff (' + lip.res.grade + ')</span><b>+' + (fl.styleLaunch || 0) + '</b><span>Landing (' + fl.grade.name + ')</span><b>+' + (fl.styleLand || 0) + '</b><div class="tot"><span>SCORE</span><b>' + total + '</b></div>';
  show(el.result, true);
  const recs = recordsList(); recs.push({ d: Math.round(d * 10) / 10, score: total, who: nm, ts: Date.now() }); recs.sort((a, b) => b.d - a.d); store.set('records', recs.slice(0, 5));
  if (isRec) { store.set('best', d); el.newrec.classList.remove('show'); void el.newrec.offsetWidth; el.newrec.classList.add('show'); A.sfx('record'); if (oldBest > 0) A.speak('New record!'); }
  P.UNLOCKS.forEach((u, i) => { if (oldBest < u.need && d >= u.need) setTimeout(() => { el.toast.innerHTML = '🎉 UNLOCKED: ' + u.name + '!'; el.toast.classList.add('show'); A.sfx('unlock'); setTimeout(() => el.toast.classList.remove('show'), 3500); }, 1200 + i * 4000); });
  window.__lastResult = { dist: d, total, style, isRec };
}
// ---------------------------------------------------------------- per-frame update
const _tmp = new V3();
function update(dt) {
  G.wall += dt; A.windLevel && (G.state === 'inrun' || G.state === 'flight' || G.state === 'lip' ? A.windLevel(Math.min(1, (G.state === 'flight' ? 1.0 : run.v / 26) * 0.6), 0.5 + 0.5 * Math.sin(G.wall * 3.1) * Math.sin(G.wall * 1.7)) : A.windLevel(0, 0));
  G.ts += (G.tsTarget - G.ts) * Math.min(1, dt * (G.tsTarget < G.ts ? 12 : 5)); const gdt = dt * G.ts;
  const st = G.state;
  if (st === 'title') { G.tt = (G.tt || 0) + dt; if (G.tt > 6.5) { G.tt = 0; skier.play(Math.random() < 0.5 ? 'cheerShow' : 'cheerFist', 0.3); G.titleCheer = 2.8; } if (G.titleCheer > 0) { G.titleCheer -= dt; if (G.titleCheer <= 0) skier.play('idle', 0.5); } skier.update(dt); if (!window.__freeze) skier.root.rotation.y = -1.25 + Math.sin(G.wall * 0.5) * 0.15; }
  else if (st === 'ready') {
    G.readyT += dt; const n = 3 - Math.floor(G.readyT / 0.55); if (n >= 1) { if (el.count.textContent !== String(n)) { el.count.textContent = String(n); A.sfx('beep'); } } else beginInrun();
    skier.update(gdt); camFP(dt); applyCam(dt);
  } else if (st === 'inrun') {
    run.t += gdt; run.tn += dt;
    // needle: smooth ping-pong, period shortens a bit
    if (!run.tapped) { const per = 1.15; run.speedPos = 0.5 - 0.5 * Math.cos(2 * Math.PI * (run.tn - 0.0) / per); el.ndl.style.left = run.speedPos * 100 + '%'; }
    const vt = run.tapped ? run.speedRes.v + 0.8 : 21.2; const k = 0.62; run.v += (vt - run.v) * (1 - Math.exp(-k * gdt)); run.s += run.v * gdt;
    if (!run.tapped && run.s > 58) { run.tapped = true; run.speedRes = P.speedFromMeter(run.speedPos); showGrade(run.speedRes.grade); }
    const p = P.runAt(run.s); skier.root.position.set(p.x, p.y, 0); skier.root.rotation.z = -p.ang; skier.update(gdt);
    el.dnum.textContent = Math.round(run.v * 3.6); camFP(dt); applyCam(dt);
    if (run.s > 8 && Math.random() < 0.5) spray.emit(p.x - 1.2, p.y + 0.15, (Math.random() < 0.5 ? -1 : 1) * 0.5, -run.v * 0.12, 0.6 + Math.random(), (Math.random() - 0.5) * 1.5, 0.35, 0.5);
    if (run.s >= P.HILL.RUN_LEN - 17 && run.tapped) beginLip();
    else if (run.s >= P.HILL.RUN_LEN - 17) { run.tapped = true; run.speedRes = P.speedFromMeter(run.speedPos); beginLip(); }
    world.updateMarkers(0, G.wall);
  } else if (st === 'lip') {
    lip.t += dt; if (!lip.tapped) { lip.pos = lipPos(); el.rot.setAttribute('transform', 'rotate(' + ((lip.pos - 0.5) * 180).toFixed(1) + ')'); }
    run.t += gdt; run.v += (run.speedRes.v + 0.8 - run.v) * (1 - Math.exp(-0.6 * gdt)); run.s += run.v * gdt;
    const p = P.runAt(Math.min(P.HILL.RUN_LEN, run.s)); skier.root.position.set(p.x, p.y, 0); skier.root.rotation.z = -p.ang; skier.update(gdt);
    el.dnum.textContent = Math.round(run.v * 3.6); camFP(dt); applyCam(dt);
    if (run.s >= P.HILL.RUN_LEN) { if (!lip.tapped) { lip.tapped = true; lip.res = P.launchFromMeter(lip.pos); } show(el.mLaunch, false); takeoff(); }
  } else if (st === 'flight') {
    fl.ft += gdt; const sim = fl.sim; const t = Math.min(fl.ft, sim.tHit); const s = P.sampleAt(sim, t);
    if (fl.flightQueued && fl.ft > 0.62) { fl.flightQueued = false; skier.play('flight', 0.35); }
    if (!fl.landed) {
      const tl = sim.tHit - fl.ft;
      if (tl < 0.5 && !fl.preland) { fl.preland = true; skier.play('preland', 0.2); } if (fl.ft < 0.1) fl.preland = false;
      if (tl < 1.5 && !fl.meterOn) { fl.meterOn = true; show(el.mLand, true); $('m-land').querySelector('.name').textContent = 'LAND IT!'; } if (fl.ft < 0.1) fl.meterOn = false;
      if (fl.meterOn) el.mk.style.left = (0.5 - (tl / 1.3) * 0.5) * 100 + '%';
      const gam = Math.atan2(s.vy, s.vx); skier.root.position.set(s.x, s.y, 0); skier.root.rotation.z = gam * 0.9 + 0.1;
      el.dnum.textContent = Math.max(0, P.arcAt(s.x)).toFixed(0); world.updateMarkers(P.arcAt(s.x), G.wall);
      skier.update(gdt); camDrone(dt, 'flight');
      if (fl.ft >= sim.tHit) touchdown();
    }
    if (fl.landed) { G.state = 'landing'; fl.sl = 0; }
    streaksLevel = 1;
  }
  if (G.state === 'landing') {
    const sl = fl.slide; fl.sl += gdt;
    if (fl.pendingGrade) { fl.ft += gdt; if (fl.landTap || fl.sl > fl.grace) { fl.grade = P.gradeLanding(fl.landTap ? fl.landDt : 9); finishGrade(); if (fl.grade.name === 'SLOPPY') skier.play('sloppy', 0.06); } }
    const ang = P.groundAngle(sl.x); const dec = (1.1 + 0.34 * sl.v) * (sl.x > P.K_X + 12 ? 1.35 : 1) - 0.25 * 9.81 * Math.sin(ang) ; sl.v = Math.max(0, sl.v - dec * gdt); sl.x += sl.v * Math.cos(ang) * gdt;
    const gy = P.groundY(sl.x); skier.root.position.set(sl.x, gy, 0); const tgt = -ang; skier.root.rotation.z += (tgt - skier.root.rotation.z) * Math.min(1, gdt * 10);
    if (fl.sl > 0.35 && !fl.skidPlayed) { fl.skidPlayed = true; skier.play(fl.grade.name === 'SLOPPY' ? 'sloppy' : 'telemark', 0.2); }
    if (fl.sl > 1.15 && !fl.skidP2) { fl.skidP2 = true; if (sl.v > 1.5) skier.play('skid', 0.5); }
    if (sl.v > 1.2 && Math.random() < Math.min(1, sl.v / 14)) spray.emit(sl.x - 0.8, gy + 0.2, (Math.random() - 0.5) * 1.6, -sl.v * 0.15, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 3, 0.6, 0.8);
    el.dnum.textContent = fl.dist.toFixed(1); world.updateMarkers(P.arcAt(sl.x), G.wall);
    skier.update(gdt); camDrone(dt, sl.v < 3.5 ? 'celebrate' : 'land'); streaksLevel = Math.min(1, sl.v / 20) * 0.6;
    if (!fl.announced && fl.sl > 0.7) announce();
    if ((sl.v < 0.6 || fl.sl > 5.5) && G.state === 'landing') enterCelebrate();
  }
  if (G.state === 'celebrate' || G.state === 'result') { skier.update(gdt); camDrone(dt, 'celebrate'); streaksLevel = 0; }
  if (G.state === 'celebrate' || G.state === 'result' || G.state === 'landing' || G.state === 'flight') applyCam(dt);
  if (fpSkis) { const on = st === 'ready' || st === 'inrun' || st === 'lip'; fpSkis.visible = on; if (on) fpSkis.children.forEach((h, i) => { h.rotation.x = Math.sin(G.wall * 11 + i * 2) * 0.012 * Math.min(1, run.v / 20); h.position.y = -0.66 + Math.sin(G.wall * 17 + i) * 0.004 * Math.min(1, run.v / 20); }); }
  if (skier && skier.rainbow) { const h = (G.wall * 0.4) % 1; ['L', 'R'].forEach((s) => { const m = skier.mats['S_SkiTop' + s]; if (m) m.color.setHSL(h, 0.9, 0.55); }); }
  // fx
  const sp = G.state === 'inrun' || G.state === 'lip' ? run.v : (fl.sim && G.state === 'flight' ? fl.v0 : (fl.slide ? fl.slide.v * 2 : 0));
  streaks.update(dt, sp, G.state === 'inrun' ? Math.min(1, run.v / 26) * 0.9 : (G.state === 'lip' ? 0.9 : (G.state === 'flight' ? 0.75 : (G.state === 'landing' ? streaksLevel : 0))));
  spray.update(gdt, canvas.height, cam.fov); confetti.update(dt);
  world.update(dt, G.wall, skier.root.position);
  if (flash > 0) flash = Math.max(0, flash - dt * 3);
}
let streaksLevel = 0;
// ---------------------------------------------------------------- frame loop + adaptive quality
let last = 0, fpsAcc = 0, fpsN = 0, slowWin = 0;
function frame(now) {
  requestAnimationFrame(frame); if (!world) return;
  const raw = Math.min(0.05, (now - last) / 1000 || 0.016); last = now; const dt = Math.min(1 / 30, raw);
  if (auto) autoplay(dt);
  if (G.state === 'title') { update(dt); renderer.setClearColor(0x000000, 0); renderer.render(titleScene, tcam); }
  else if (G.state !== 'loading') { update(dt); renderer.render(world.scene, cam); }
  fpsAcc += raw; fpsN++; if (fpsAcc > 2.0) { const fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; window.__fps = fps; if (G.state !== 'title' && fps < 40) slowWin++; else slowWin = 0; if (slowWin >= 2 && qLevel < 2 && !params.get('noadapt')) { slowWin = 0; qLevel++; if (qLevel === 1) { pixelRatio = Math.max(1, pixelRatio * 0.75); resize(); } else { renderer.shadowMap.enabled = false; world.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; }); } console.log('[quality] lowered to', qLevel); } }
}
// ---------------------------------------------------------------- QA autoplay hooks
function autoplay(dt) {
  const a = auto; const st = G.state;
  if (st === 'inrun' && !run.tapped && a.speed != null && run.tn > 0.4) { if (Math.abs(run.speedPos - a.speed) < 0.035 && Math.sin(2 * Math.PI * run.tn / 1.15) > -2) { onTap(); } }
  if (st === 'lip' && !lip.tapped && a.launch != null && lip.t > 0.1 && Math.abs(lip.pos - a.launch) < 0.03) onTap();
  if (st === 'flight' && fl.sim && !fl.landTap && a.landOffset != null && fl.ft >= fl.sim.tHit - a.landOffset - 0.001 && !fl.landed) onTap();
  if (st === 'result' && a.again) { a.again--; if (a.again <= 0) { auto = null; } }
}
window.__game = { tcam, G, run, lip, fl, get state() { return G.state; }, startRun, toTitle, onTap, setAuto(o) { auto = o; }, P, skier: () => skier, world: () => world, cam, fps: () => window.__fps, info: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures }), pr: () => pixelRatio, tap: onTap, press: () => $('go').click(), result: () => window.__lastResult, QUAL, mobile,
  warp(state) { /* QA helper: jump the world state for screenshots */ } };

// ---------------------------------------------------------------- input
const tz = $('tapzone');
tz.addEventListener('pointerdown', (e) => { e.preventDefault(); onTap(); });
document.addEventListener('keydown', (e) => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); if (G.state === 'title') startRun(); else onTap(); } });
$('go').addEventListener('click', () => { startRun(); });
$('again').addEventListener('click', () => { A.sfx('click'); startRun(); });
$('totitle').addEventListener('click', () => { A.sfx('click'); toTitle(); });
['mute', 'mute2'].forEach((id) => $(id).addEventListener('click', (e) => { e.stopPropagation(); A.initAudio(); A.setMuted(!A.isMuted()); setMuteIcons(); }));
['pointerdown'].forEach((ev) => document.addEventListener(ev, () => { A.initAudio(); if (G.state === 'title') A.music('title'); }, { once: false, passive: true }));
document.addEventListener('visibilitychange', () => { if (document.hidden) { try { speechSynthesis.cancel(); } catch (e) {} } });

// ---------------------------------------------------------------- boot
(async function boot() {
  const bar = $('lbar'); let done = 0; const total = Object.keys(TEXFILES).length + 3; const tick = () => { done++; bar.style.width = (done / total * 100) + '%'; };
  const tex = {}; await Promise.all(Object.keys(TEXFILES).map((k) => loadTex('art/' + TEXFILES[k]).then((t) => { tex[k] = t; tick(); })));
  const [assets, pineGeo] = await Promise.all([loadSkierAssets('models/').then((a) => { tick(); return a; }), loadPine().then((g) => { tick(); return g; }).catch(() => null)]);
  world = buildWorld({ tex, pineGeo, quality: QUAL }); tick();
  world.scene.add(cam);
  titleScene = new THREE.Scene(); titleScene.add(new THREE.HemisphereLight(0xdff0ff, 0xaec4e6, 1.25)); const tl = new THREE.DirectionalLight(0xfff1d6, 2.0); tl.position.set(3, 5, 4); titleScene.add(tl);
  skier = new Skier(assets, { quality: mobile ? 'low' : 'high' });
  skier.fp = function (on) { this.bones.Head.scale.setScalar(on ? 0.001 : this.headBoneScale); };
  fpSkis = new THREE.Group(); [-1, 1].forEach((sd) => { const c = (sd < 0 ? skier.gear.skiL : skier.gear.skiR).clone(true); c.position.set(0, 0, 0); c.rotation.set(0, 0, 0); c.scale.setScalar(1); c.traverse((o) => { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; }); const h = new THREE.Group(); h.add(c); h.position.set(sd * 0.2, -0.66, -1.15); h.rotation.y = sd * 0.1; h.userData.sd = sd; fpSkis.add(h); }); fpSkis.visible = false; cam.add(fpSkis);
  spray = new Spray(world.scene, tex.puff, 150); confetti = new Confetti(cam, 150); streaks = new Streaks(cam, 70);
  resize(); toTitle(); el.go.disabled = false;
  $('loading').style.opacity = 0; setTimeout(() => $('loading').remove(), 600);
  requestAnimationFrame(frame);
})().catch((e) => { console.error(e); const l = $('loading'); if (l) l.textContent = 'Could not load: ' + e.message; });
