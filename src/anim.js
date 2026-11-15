import * as THREE from 'three';
// ---------------------------------------------------------------------------------------------
// Skeletal clip authoring. Poses are authored in skier-local metres/degrees (x fwd, y up, z right),
// solved onto the real Quaternius rig (aim-at + two-bone leg IK so boots stay glued to the skis),
// and baked at 30fps into THREE.AnimationClips (QuaternionKeyframeTracks / VectorKeyframeTracks).
// At runtime only AnimationMixer plays them.
// ---------------------------------------------------------------------------------------------
const V3 = THREE.Vector3, Q = THREE.Quaternion, E = THREE.Euler;
const D2R = Math.PI / 180;
const FPS = 30;

// ---- tiny param interpolation -------------------------------------------------------------
const lerp = (a, b, k) => a + (b - a) * k;
function mix(A, B, k) {
  if (typeof A === 'number') return lerp(A, B, k);
  if (Array.isArray(A)) return A.map((v, i) => mix(v, B[i], k));
  const o = {}; for (const key in A) o[key] = mix(A[key], B[key], k); return o;
}
const smooth = (k) => k * k * (3 - 2 * k);
const smoother = (k) => k * k * k * (k * (k * 6 - 15) + 10);
function seq(keys) {                       // keys: [{t, p}] -> fn(t)
  return (t) => {
    if (t <= keys[0].t) return keys[0].p;
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      if (t <= b.t) return mix(a.p, b.p, (b.ease || smooth)((t - a.t) / (b.t - a.t)));
    }
    return keys[keys.length - 1].p;
  };
}
const mirror = (v) => [v[0], v[1], -v[2]];

// ---- default pose -----------------------------------------------------------------------------
function P(o) {
  const base = {
    hips: [0, 0, 0],                        // offset from rest hips
    spine: [0, 0, 0, 0, 0],                 // forward pitch (deg from vertical) for Hips,Abdomen,Torso,Neck,Head
    twist: 0,                               // upper-body yaw (deg)
    armR: { u: [0.05, -1, 0.18], l: [0.15, -1, 0.1] },
    armL: null,                             // null => mirror armR
    footR: { p: [0, 0.0, 0.12], pitch: 0, yaw: 0, roll: 0 },   // p: ankle offset from rest (x,y), z = lateral half-stance
    footL: null,
    knee: 0.35,
  };
  return Object.assign(base, o || {});
}
const arms = (u, l, uL, lL) => ({ armR: { u, l }, armL: { u: uL || mirror(u), l: lL || mirror(l) } });
const feet = (o) => ({ footR: o, footL: { p: [o.p[0], o.p[1], -o.p[2]], pitch: o.pitch, yaw: -o.yaw, roll: -o.roll } });

export class Rig {
  constructor(sk) {
    this.sk = sk; this.b = sk.bones;
    this.names = Object.keys(this.b).filter((n) => this.b[n].userData.skin);
    this.all = Object.keys(this.b);
    this.root = sk.root;
    sk.root.updateMatrixWorld(true);
    this.rest = {}; this.names.forEach((n) => { const o = this.b[n]; this.rest[n] = { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() }; });
    const W = (n) => this.b[n].getWorldPosition(new V3());
    this.rest.hipsW = W('Body'); this.rest.headQ = this.b.Head.getWorldQuaternion(new Q());
    this.rest.hipJoint = { L: W('UpperLegL'), R: W('UpperLegR') };
    this.rest.knee = { L: W('LowerLegL'), R: W('LowerLegR') };
    this.rest.ankle = { L: W('LowerLegL_end'), R: W('LowerLegR_end') };
    this.rest.foot = { L: W('FootL'), R: W('FootR') };
    this.rest.footQ = { L: this.b.FootL.getWorldQuaternion(new Q()), R: this.b.FootR.getWorldQuaternion(new Q()) };
    this.thigh = this.rest.hipJoint.L.distanceTo(this.rest.knee.L);
    this.shin = this.rest.knee.L.distanceTo(this.rest.ankle.L);
    this.rest.skiAnkleH = this.rest.ankle.L.y;
    this.rest.hipH = this.rest.hipJoint.L.y;
  }
  reset() { this.names.forEach((n) => { const r = this.rest[n]; const o = this.b[n]; o.position.copy(r.p); o.quaternion.copy(r.q); }); this.root.updateMatrixWorld(true); }
  setWorldPos(bone, p) { bone.parent.updateWorldMatrix(true, false); bone.position.copy(bone.parent.worldToLocal(p.clone())); bone.updateMatrixWorld(true); }
  setWorldQuat(bone, q) { const pq = bone.parent.getWorldQuaternion(new Q()); bone.quaternion.copy(pq.invert().multiply(q)); bone.updateMatrixWorld(true); }
  aim(bone, child, dir) {
    const bp = bone.getWorldPosition(new V3()), cp = child.getWorldPosition(new V3());
    const cur = cp.sub(bp).normalize(); const des = dir.clone().normalize();
    const dq = new Q().setFromUnitVectors(cur, des);
    const wq = bone.getWorldQuaternion(new Q()); this.setWorldQuat(bone, dq.multiply(wq));
  }
  apply(p) {
    this.reset(); const b = this.b;
    // body
    this.setWorldPos(b.Body, this.rest.hipsW.clone().add(new V3(p.hips[0], p.hips[1], p.hips[2])));
    // spine chain
    const chain = [['Hips', 'Abdomen'], ['Abdomen', 'Torso'], ['Torso', 'Neck'], ['Neck', 'Head']];
    chain.forEach(([a, c], i) => { if (!b[a] || !b[c]) return; const th = p.spine[i] * D2R; this.aim(b[a], b[c], new V3(Math.sin(th), Math.cos(th), 0)); });
    { const th = p.spine[4] * D2R; const q = new Q().setFromAxisAngle(new V3(0, 0, 1), -th).multiply(this.rest.headQ); this.setWorldQuat(b.Head, q); }
    if (p.twist) { const q = new Q().setFromAxisAngle(new V3(0, 1, 0), p.twist * D2R); const wq = b.Torso.getWorldQuaternion(new Q()); this.setWorldQuat(b.Torso, q.multiply(wq)); }
    // arms
    const armL = p.armL || { u: mirror(p.armR.u), l: mirror(p.armR.l) };
    [['R', p.armR], ['L', armL]].forEach(([s, a]) => {
      this.aim(b['UpperArm' + s], b['LowerArm' + s], new V3(a.u[0], a.u[1], a.u[2]));
      this.aim(b['LowerArm' + s], b['Palm' + s], new V3(a.l[0], a.l[1], a.l[2]));
    });
    // legs + feet
    const footL = p.footL || { p: [p.footR.p[0], p.footR.p[1], -p.footR.p[2]], pitch: p.footR.pitch, yaw: -p.footR.yaw, roll: -p.footR.roll };
    [['R', p.footR, 1], ['L', footL, -1]].forEach(([s, f, sg]) => {
      const qa = new Q().setFromEuler(new E(f.roll * D2R, f.yaw * D2R, f.pitch * D2R, 'YXZ'));
      // ankle target: rest ankle x, ground height, lateral = +- stance (f.p[2]) ; offsets f.p[0], f.p[1]
      const ra = this.rest.ankle[s];
      const A = new V3(ra.x + f.p[0], ra.y + f.p[1], sg * Math.abs(f.p[2]));
      const hj = b['UpperLeg' + s].getWorldPosition(new V3());
      const a = this.thigh, bl = this.shin;
      let d = A.clone().sub(hj); let dl = d.length(); const maxd = (a + bl) * 0.995; const mind = Math.abs(a - bl) + 0.02;
      dl = Math.min(maxd, Math.max(mind, dl)); const dn = d.normalize(); const Aeff = hj.clone().add(dn.clone().multiplyScalar(dl));
      const x = (a * a - bl * bl + dl * dl) / (2 * dl); const h = Math.sqrt(Math.max(0, a * a - x * x));
      let pole = new V3(1, 0, sg * (p.kneeOut || 0.12)); pole.sub(dn.clone().multiplyScalar(pole.dot(dn))).normalize();
      const K = hj.clone().add(dn.clone().multiplyScalar(x)).add(pole.multiplyScalar(h));
      this.aim(b['UpperLeg' + s], b['LowerLeg' + s], K.clone().sub(hj));
      this.aim(b['LowerLeg' + s], b['LowerLeg' + s + '_end'], Aeff.clone().sub(K));
      // foot bone follows ankle with ski attitude
      const off = this.rest.foot[s].clone().sub(this.rest.ankle[s]).applyQuaternion(qa);
      const fq = qa.clone().multiply(this.rest.footQ[s]);
      this.setWorldPos(b['Foot' + s], Aeff.clone().add(off)); this.setWorldQuat(b['Foot' + s], fq);
    });
    this.root.updateMatrixWorld(true);
  }
  snapshot() { const o = {}; this.names.forEach((n) => { const bo = this.b[n]; o[n] = { p: bo.position.clone(), q: bo.quaternion.clone() }; }); return o; }
}

// ---- authored poses ------------------------------------------------------------------------------------
const STAND = P({ hips: [0, 0, 0], spine: [0, 0, 0, 0, 0], ...arms([0.05, -1, 0.22], [0.1, -1, 0.15]), ...feet({ p: [0, 0, 0.12], pitch: 0, yaw: 0, roll: 0 }) });
const TUCK = P({ hips: [-0.13, -0.36, 0], spine: [58, 68, 74, 42, 6], knee: 0.1,
  ...arms([-0.55, -0.82, 0.2], [-0.9, -0.40, 0.12]), ...feet({ p: [0, 0, 0.10], pitch: 0, yaw: 0, roll: 0 }) });
const COIL = P({ hips: [-0.16, -0.42, 0], spine: [62, 72, 78, 46, 8], knee: 0.1,
  ...arms([-0.6, -0.8, 0.2], [-0.95, -0.3, 0.1]), ...feet({ p: [0, 0, 0.10], pitch: 0, yaw: 0, roll: 0 }) });
const EXTEND = P({ hips: [0.12, -0.02, 0], spine: [18, 26, 34, 22, 6], knee: 0.1,
  ...arms([0.7, 0.55, 0.2], [0.8, 0.5, 0.1]), ...feet({ p: [0, 0, 0.10], pitch: 4, yaw: 0, roll: 0 }) });
const FLIGHT = P({ hips: [0.04, -0.17, 0], spine: [64, 72, 78, 48, 8], knee: 0.1,
  ...arms([-0.85, -0.45, 0.25], [-1, -0.12, 0.12]), ...feet({ p: [0, 0.01, 0.17], pitch: 9, yaw: 13, roll: 0 }) });
const PRELAND = P({ hips: [0.08, -0.06, 0], spine: [34, 42, 48, 30, 5], knee: 0.1,
  ...arms([0.25, -0.35, 0.95], [0.3, -0.1, 0.95]), ...feet({ p: [0, 0.0, 0.14], pitch: 4, yaw: 6, roll: 0 }) });
const TELE = P({ hips: [0.0, -0.33, 0], spine: [14, 16, 18, 8, 4], knee: 0.05, twist: 0,
  ...arms([0.12, 0.04, 1], [0.3, 0.1, 1]),
  footR: { p: [0.34, 0, 0.1], pitch: 0, yaw: 0, roll: 0 }, footL: { p: [-0.34, 0.01, 0.1], pitch: 6, yaw: 0, roll: 0 } });
const TELE_UP = P({ hips: [0.0, -0.18, 0], spine: [8, 8, 8, 4, 2],
  ...arms([0.15, 0.15, 1], [0.35, 0.25, 0.95]),
  footR: { p: [0.28, 0, 0.1], pitch: 0, yaw: 0, roll: 0 }, footL: { p: [-0.28, 0, 0.1], pitch: 4, yaw: 0, roll: 0 } });
const SLOPPY = P({ hips: [-0.06, -0.22, 0], spine: [20, 18, 14, 8, 2], knee: 0.2,
  ...arms([0.3, 0.6, 0.8], [0.4, 0.9, 0.3], [0.1, -0.2, -0.95], [0, 0.1, -1]), ...feet({ p: [0, 0, 0.18], pitch: 2, yaw: 10, roll: 0 }) });

function rot2(period, t) { return Math.sin(t * Math.PI * 2 / period); }

function addWob(p, o) {                        // additive wobble helper
  const q = JSON.parse(JSON.stringify(p));
  if (o.hips) for (let i = 0; i < 3; i++) q.hips[i] += o.hips[i] || 0;
  if (o.spine) for (let i = 0; i < 5; i++) q.spine[i] += o.spine[i] || 0;
  if (o.ski) { ['footR', 'footL'].forEach((k, i) => { const f = q[k] || (q[k] = { p: [q.footR.p[0], q.footR.p[1], -q.footR.p[2]], pitch: q.footR.pitch, yaw: -q.footR.yaw, roll: -q.footR.roll }); f.pitch += o.ski.pitch * (i ? -1 : 1) || 0; f.roll += o.ski.roll || 0; f.yaw += (o.ski.yaw || 0) * (i ? -1 : 1); f.p[1] += o.ski.y || 0; }); }
  if (o.arm) { ['armR', 'armL'].forEach((k, i) => { const a = q[k] || (q[k] = { u: mirror(q.armR.u), l: mirror(q.armR.l) }); for (let j = 0; j < 3; j++) { a.u[j] += (o.arm.u ? o.arm.u[j] : 0) * (j === 2 && i ? -1 : 1); a.l[j] += (o.arm.l ? o.arm.l[j] : 0) * (j === 2 && i ? -1 : 1); } }); }
  return q;
}
const norm = (p) => { const q = JSON.parse(JSON.stringify(p)); if (!q.footL) q.footL = { p: [q.footR.p[0], q.footR.p[1], -q.footR.p[2]], pitch: q.footR.pitch, yaw: -q.footR.yaw, roll: -q.footR.roll }; if (!q.armL) q.armL = { u: mirror(q.armR.u), l: mirror(q.armR.l) }; return q; };

export const CLIP_DEFS = {
  idle: { dur: 3.0, loop: true, fn: (t) => addWob(norm(STAND), { hips: [0, 0.008 * rot2(3, t), 0], spine: [0, 1 * rot2(3, t), 2 * rot2(3, t + 0.3), 0, -1 * rot2(3, t + 0.5)], arm: { u: [0.04 * rot2(3, t + 0.2), 0, 0], l: [0.03 * rot2(3, t), 0, 0] } }) },
  crouch: { dur: 1.2, loop: true, fn: (t) => addWob(norm(TUCK), { hips: [0.006 * rot2(1.2, t + 0.25), 0.014 * rot2(0.6, t), 0], spine: [-1.2 * rot2(0.6, t + 0.2), 0, 1.2 * rot2(0.6, t + 0.3), 1 * rot2(1.2, t), -2 * rot2(0.6, t)], ski: { pitch: 0.8 * rot2(0.6, t + 0.4), roll: 0.6 * rot2(1.2, t) }, arm: { u: [0.03 * rot2(1.2, t), 0, 0], l: [0.03 * rot2(0.6, t), 0, 0] } }) },
  takeoff: { dur: 0.7, loop: false, fn: (t) => seq([
    { t: 0.0, p: norm(TUCK) }, { t: 0.14, p: norm(COIL), ease: smooth }, { t: 0.30, p: norm(EXTEND), ease: smoother }, { t: 0.45, p: norm(mixPose(EXTEND, FLIGHT, 0.4)), ease: smooth }, { t: 0.7, p: norm(FLIGHT), ease: smoother }])(t) },
  flight: { dur: 1.2, loop: true, fn: (t) => addWob(norm(FLIGHT), { hips: [0.005 * rot2(1.2, t), 0.012 * rot2(0.6, t + 0.1), 0], spine: [1 * rot2(0.6, t), 1.5 * rot2(1.2, t + 0.3), 2 * rot2(0.6, t + 0.2), 1.5 * rot2(1.2, t), 3 * rot2(0.6, t + 0.5)],
    ski: { pitch: 3.2 * rot2(0.6, t + 0.1), roll: 3.5 * rot2(1.2, t + 0.2), yaw: 1.8 * rot2(0.6, t) }, arm: { u: [0.04 * rot2(0.6, t), 0.04 * rot2(1.2, t), 0.05 * rot2(0.6, t + 0.3)], l: [0.03 * rot2(0.6, t + 0.1), 0.03 * rot2(1.2, t), 0] } }) },
  preland: { dur: 0.5, loop: false, fn: (t) => seq([{ t: 0, p: norm(FLIGHT) }, { t: 0.5, p: norm(PRELAND), ease: smoother }])(t) },
  telemark: { dur: 1.1, loop: false, fn: (t) => seq([{ t: 0, p: norm(PRELAND) }, { t: 0.10, p: norm(mixPose(PRELAND, TELE, 0.5)), ease: smooth }, { t: 0.30, p: norm(TELE), ease: smooth }, { t: 0.65, p: norm(TELE), ease: smooth }, { t: 1.1, p: norm(TELE_UP), ease: smoother }])(t) },
  sloppy: { dur: 1.1, loop: false, fn: (t) => addWob(seq([{ t: 0, p: norm(PRELAND) }, { t: 0.12, p: norm(SLOPPY), ease: smooth }, { t: 1.1, p: norm(mixPose(SLOPPY, TELE_UP, 0.5)), ease: smoother }])(t), { spine: [0, 6 * rot2(0.5, t) * Math.exp(-t * 1.5), 8 * rot2(0.5, t + 0.2) * Math.exp(-t * 1.5), 0, 0], arm: { u: [0.2 * rot2(0.45, t), 0.25 * rot2(0.45, t + 0.25), 0], l: [0.2 * rot2(0.45, t + 0.1), 0.2 * rot2(0.45, t + 0.4), 0] } }) },
  skid: { dur: 1.2, loop: true, fn: (t) => addWob(norm(P({ hips: [-0.1, -0.16, 0], spine: [-6, -4, -3, 0, 6], knee: 0.25,
    ...arms([0.05, 0.1, 1], [0.15, 0.3, 0.95]), ...feet({ p: [0, 0, 0.26], pitch: 5, yaw: 8, roll: 0 }) })), { spine: [0, 2 * rot2(1.2, t), 3 * rot2(1.2, t + 0.25), 0, 0], hips: [0, 0.01 * rot2(0.6, t), 0], arm: { u: [0, 0.06 * rot2(1.2, t), 0], l: [0, 0.06 * rot2(1.2, t + 0.3), 0] } }) },
  cheerFist: { dur: 1.2, loop: true, fn: (t) => {
    const a = 0.5 + 0.5 * rot2(0.6, t);   // pump
    const p = norm(P({ hips: [-0.03, -0.09, 0], spine: [-5, -6, -8, -4, 0], knee: 0.2,
      armR: { u: mix([0.2, 0.55, 0.65], [0.1, 1, 0.25], smooth(a)), l: mix([0.5, 0.85, 0.2], [0.1, 1, 0.1], smooth(a)) },
      armL: { u: [0.25, -0.9, -0.3], l: [0.55, -0.7, -0.2] },
      ...feet({ p: [0, 0, 0.16], pitch: 0, yaw: 4, roll: 0 }) }));
    return addWob(p, { hips: [0, 0.02 * rot2(0.6, t + 0.25), 0], spine: [0, 0, 0, 0, 0] }); } },
  cheerShow: { dur: 1.6, loop: true, fn: (t) => {
    const w = rot2(0.8, t);
    const p = norm(P({ hips: [-0.02, -0.07, 0], spine: [-8, -9, -10, -6, -2], knee: 0.2,
      armR: { u: [0.0, 0.95, 0.35 + 0.1 * w], l: [0.1 + 0.4 * w, 0.95, 0.2] },
      armL: { u: [0.0, 0.95, -0.35 + 0.1 * w], l: [0.1 - 0.4 * w, 0.95, -0.2] },
      ...feet({ p: [0, 0, 0.17], pitch: 0, yaw: 6, roll: 0 }) }));
    return addWob(p, { hips: [0, 0.03 * rot2(0.8, t + 0.25), 0], spine: [0, 3 * w, 4 * w, 0, -2 * w] }); } },
};
function mixPose(a, b, k) { return mix(norm(a), norm(b), k); }

export function buildClips(sk) {
  const rig = new Rig(sk);
  sk.rig = rig;
  rig.thighLen = rig.thigh; 
  const clips = {};
  for (const name in CLIP_DEFS) {
    const d = CLIP_DEFS[name]; const n = Math.max(2, Math.round(d.dur * FPS) + 1);
    const times = []; const store = {}; rig.names.forEach((nm) => { store[nm] = { q: [], p: [] }; });
    for (let i = 0; i < n; i++) {
      const t = d.loop ? (i / (n - 1)) * d.dur : Math.min(d.dur, i / FPS);
      times.push(t); rig.apply(d.fn(t));
      rig.names.forEach((nm) => { const bo = rig.b[nm]; store[nm].q.push(bo.quaternion.x, bo.quaternion.y, bo.quaternion.z, bo.quaternion.w); store[nm].p.push(bo.position.x, bo.position.y, bo.position.z); });
    }
    const tracks = [];
    const posBones = { Body: 1, FootL: 1, FootR: 1 };
    rig.names.forEach((nm) => {
      const bo = rig.b[nm]; const node = bo.name;
      tracks.push(new THREE.QuaternionKeyframeTrack(node + '.quaternion', times, store[nm].q));
      if (posBones[nm]) tracks.push(new THREE.VectorKeyframeTrack(node + '.position', times, store[nm].p));
    });
    const c = new THREE.AnimationClip(name, d.dur, tracks); c.userData = { loop: d.loop };
    clips[name] = c;
  }
  rig.reset();
  return clips;
}
