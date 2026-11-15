// Pure deterministic jump physics + hill profile (no three.js). 1 unit = 1 metre. Skier travels toward +x, y up.
const D2R = Math.PI / 180;
const sstep = (k) => { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); };

export const HILL = { K: 120, HS: 134, TABLE_DEG: 9, RUN_LEN: 90, TOWER_H: 0 };

// ---------- landing slope: angle (deg, downhill) as function of horizontal x from the lip
function landDeg(x) {
  if (x < 38) return 9 + 27 * sstep(x / 38);
  if (x < 112) return 36;
  if (x < 196) return 36 - 33 * sstep((x - 112) / 84);
  return 3 * (1 - sstep((x - 196) / 70));
}
const LAND_MAX = 330, STEP = 0.5;
const landX = [], landY = [], landS = [], landAng = [];
{ let y = 0, s = 0; for (let x = 0; x <= LAND_MAX; x += STEP) {
    landX.push(x); landY.push(y); landS.push(s); landAng.push(landDeg(x));
    const t = Math.tan(landDeg(x + STEP * 0.5) * D2R); y -= t * STEP; s += STEP * Math.sqrt(1 + t * t);
  } }
export function groundY(x) {
  if (x <= 0) return 0;
  const i = Math.min(landX.length - 2, Math.floor(x / STEP)); const k = (x - landX[i]) / STEP;
  return landY[i] + (landY[i + 1] - landY[i]) * k - 1.6 * sstep(x / 14);        // the landing slope starts a little below the table lip
}
export function groundAngle(x) { return landDeg(Math.max(0, x)) * D2R; }       // downhill angle, radians
export function arcAt(x) { if (x <= 0) return 0; const i = Math.min(landX.length - 2, Math.floor(x / STEP)); const k = (x - landX[i]) / STEP; return landS[i] + (landS[i + 1] - landS[i]) * k; }
export function xAtArc(s) { for (let i = 0; i < landS.length - 1; i++) if (landS[i + 1] >= s) { const k = (s - landS[i]) / (landS[i + 1] - landS[i]); return landX[i] + k * STEP; } return LAND_MAX; }
export const K_X = xAtArc(HILL.K), HS_X = xAtArc(HILL.HS);

// ---------- in-run profile: arc length s from start gate (0) to the lip (RUN_LEN); returns {x,y,ang}
const RUN = [];
{ const L = HILL.RUN_LEN, n = Math.round(L / 0.5);
  const th = (s) => (36 - (36 - HILL.TABLE_DEG) * sstep((s - (L - 30)) / 30)) * D2R;
  // integrate forward then shift so the lip is the origin
  let x = 0, y = 0; const pts = [];
  for (let i = 0; i <= n; i++) { const s = i * 0.5; pts.push({ s, x, y, ang: th(s) }); x += Math.cos(th(s)) * 0.5; y -= Math.sin(th(s)) * 0.5; }
  const ox = pts[n].x, oy = pts[n].y; pts.forEach((p) => { RUN.push({ s: p.s, x: p.x - ox, y: p.y - oy, ang: p.ang }); });
}
export function runAt(s) {
  s = Math.max(0, Math.min(HILL.RUN_LEN, s)); const i = Math.min(RUN.length - 2, Math.floor(s / 0.5)); const k = (s - RUN[i].s) / 0.5;
  const a = RUN[i], b = RUN[i + 1];
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, ang: a.ang + (b.ang - a.ang) * k };
}
export const RUN_START = runAt(0);

// ---------- speed meter -> in-run speed.  q in [0,1] quality.
export const V_MIN = 22.0, V_MAX = 26.2;
export function speedFromMeter(pos) {        // pos 0..1 needle, sweet spot centred 0.86
  const d = Math.abs(pos - 0.86);
  const q = Math.max(0, 1 - d / 0.62);
  return { q: Math.pow(q, 1.1), v: V_MIN + (V_MAX - V_MIN) * Math.pow(q, 1.1), grade: d < 0.04 ? 'PERFECT' : d < 0.11 ? 'GREAT' : d < 0.24 ? 'GOOD' : 'OK' };
}
// ---------- launch meter: needle 0..1 across the dial; sweet spot centred 0.56
export const LAUNCH_SWEET = 0.55;
export function launchFromMeter(pos) {
  const e = 5 + pos * 10;                     // elevation above the table, degrees (-1 .. 17)
  const d = Math.abs(pos - LAUNCH_SWEET);
  return { e, q: Math.max(0, 1 - d / 0.5), grade: d < 0.035 ? 'PERFECT' : d < 0.09 ? 'GREAT' : d < 0.2 ? 'GOOD' : 'OK' };
}

// ---------- flight simulation
const KL = 0.0040, KD = 0.0030, E_STAR = 5 + LAUNCH_SWEET * 10;              // lift / drag per v^2
export function simulateFlight(v0, eDeg, wind) {
  wind = wind || 0;
  const g = 9.81, dt = 1 / 120;
  const phi = (-HILL.TABLE_DEG + eDeg) * D2R;
  let x = 0, y = 0, vx = v0 * Math.cos(phi), vy = v0 * Math.sin(phi) + 1.0 * Math.max(0, eDeg) * 0.05;
  const samples = []; let t = 0; let hit = null;
  for (let n = 0; n < 120 * 12; n++) {
    const rx = vx + wind, ry = vy; const sp = Math.hypot(rx, ry);
    const gam = Math.atan2(ry, rx) / D2R;                      // flight path angle deg (up +)
    const f = Math.max(0.25, Math.min(1.05, 1 - Math.max(0, gam - 3) / 26 + Math.max(0, -gam - 20) * -0.004));
    const fl = Math.max(0.2, 1 - 1.5 * Math.pow((eDeg - E_STAR) / 5.5, 2)); const L = KL * sp * sp * f * fl, D = KD * sp * sp * (1 + Math.max(0, gam) * 0.012);
    const ux = rx / sp, uy = ry / sp;
    const ax = (-D * ux - L * uy), ay = (-D * uy + L * ux) - g;
    if (n % 2 === 0) samples.push({ t, x, y, vx, vy });
    vx += ax * dt; vy += ay * dt; x += vx * dt; y += vy * dt; t += dt;
    if (x > 0 && y <= groundY(x)) { hit = { t, x, y: groundY(x), vx, vy, sp: Math.hypot(vx, vy) }; samples.push({ t, x, y: hit.y, vx, vy }); break; }
  }
  if (!hit) hit = { t, x, y, vx, vy, sp: Math.hypot(vx, vy) };
  const s = arcAt(hit.x);
  return { samples, hit, dist: s, tHit: hit.t, v0, eDeg };
}
export function sampleAt(sim, t) {      // linear interp of flight samples
  const a = sim.samples; if (t <= 0) return a[0]; if (t >= sim.tHit) return a[a.length - 1];
  let lo = 0, hi = a.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (a[m].t <= t) lo = m; else hi = m; }
  const k = (t - a[lo].t) / (a[hi].t - a[lo].t || 1); const A = a[lo], B = a[hi];
  return { t, x: A.x + (B.x - A.x) * k, y: A.y + (B.y - A.y) * k, vx: A.vx + (B.vx - A.vx) * k, vy: A.vy + (B.vy - A.vy) * k };
}

// ---------- scoring
export const LAND_GRADES = [
  { name: 'PERFECT', max: 0.075, pts: 30 }, { name: 'GREAT', max: 0.16, pts: 22 }, { name: 'GOOD', max: 0.3, pts: 14 }, { name: 'SLOPPY', max: 9, pts: 5 },
];
export function gradeLanding(dt) { const a = Math.abs(dt); for (const g of LAND_GRADES) if (a <= g.max) return g; return LAND_GRADES[3]; }
export const UNLOCKS = [
  { id: 'flame', name: 'Flame Skis', need: 90, kind: 'ski' },
  { id: 'gold', name: 'Gold Suit', need: 110, kind: 'suit' },
  { id: 'galaxy', name: 'Galaxy Suit', need: 125, kind: 'suit' },
  { id: 'rainbow', name: 'Rainbow Skis', need: 140, kind: 'ski' },
];
