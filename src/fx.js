import * as THREE from 'three';
// ---- snow spray: pooled point sprites using the painted puff texture --------------------------------
export class Spray {
  constructor(scene, tex, max) {
    this.max = max || 140; this.n = 0; this.head = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.max * 3); this.vel = new Float32Array(this.max * 3); this.age = new Float32Array(this.max).fill(9); this.life = new Float32Array(this.max).fill(1); this.size = new Float32Array(this.max); this.alpha = new Float32Array(this.max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1)); g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { map: { value: tex }, scale: { value: 500 } },
      vertexShader: 'attribute float aSize; attribute float aAlpha; uniform float scale; varying float vA; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vA = aAlpha; gl_PointSize = aSize * scale / max(0.5,-mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D map; varying float vA; void main(){ vec4 c = texture2D(map, gl_PointCoord); gl_FragColor = vec4(c.rgb, c.a * vA); if (gl_FragColor.a < 0.02) discard; }' });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = 11; scene.add(this.pts);
  }
  emit(x, y, z, vx, vy, vz, size, life) {
    const i = this.head; this.head = (this.head + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z; this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz; this.age[i] = 0; this.life[i] = life; this.size[i] = size; this.alpha[i] = 0.9;
  }
  burst(x, y, z, count, speed, dirx, size) {
    for (let k = 0; k < count; k++) { const a = Math.random() * 6.283, r = Math.random(); this.emit(x + (Math.random() - 0.5) * 1.2, y + 0.2, z + (Math.random() - 0.5) * 1.5, dirx * 0.5 + Math.cos(a) * speed * r, 1.5 + Math.random() * speed * 0.5, Math.sin(a) * speed * r * 1.2, size * (0.6 + Math.random() * 0.8), 0.8 + Math.random() * 0.7); }
  }
  update(dt, viewH, fov) {
    this.mat.uniforms.scale.value = viewH / (2 * Math.tan(fov * Math.PI / 360));
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] >= this.life[i]) { this.alpha[i] = 0; continue; }
      this.age[i] += dt; const k = this.age[i] / this.life[i];
      this.vel[i * 3 + 1] -= 3.0 * dt; const drag = Math.exp(-1.6 * dt); this.vel[i * 3] *= drag; this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.alpha[i] = Math.max(0, 0.9 * (1 - k) * Math.min(1, k * 8)); this.size[i] += dt * 1.8 * (this.size[i] > 0 ? 1 : 0);
    }
    this.pts.geometry.attributes.position.needsUpdate = true; this.pts.geometry.attributes.aAlpha.needsUpdate = true; this.pts.geometry.attributes.aSize.needsUpdate = true;
  }
}
// ---- confetti: instanced quads living in camera space ----------------------------------------------------
export class Confetti {
  constructor(camera, count) {
    this.n = count || 160; this.active = false; this.t = 0;
    const g = new THREE.PlaneGeometry(0.12, 0.2); const m = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: false, depthTest: false });
    this.mesh = new THREE.InstancedMesh(g, m, this.n); this.mesh.frustumCulled = false; this.mesh.renderOrder = 20; camera.add(this.mesh); this.mesh.visible = false;
    this.p = []; const cols = [0xff4f4f, 0xffd23b, 0x3be0ff, 0x57e07a, 0xff7ad8, 0xffffff, 0x8a6bff]; const c = new THREE.Color();
    for (let i = 0; i < this.n; i++) { c.setHex(cols[i % cols.length]); this.mesh.setColorAt(i, c); this.p.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, rx: 0, ry: 0, vr: 0, s: 1 }); }
    this.d = new THREE.Object3D();
  }
  start() { this.active = true; this.t = 0; this.mesh.visible = true; this.p.forEach((q) => { q.x = (Math.random() - 0.5) * 7; q.y = 2.6 + Math.random() * 3.5; q.z = -4 - Math.random() * 3; q.vx = (Math.random() - 0.5) * 1.2; q.vy = -0.6 - Math.random() * 1.2; q.rx = Math.random() * 6; q.ry = Math.random() * 6; q.vr = 3 + Math.random() * 6; q.s = 0.7 + Math.random() * 0.9; }); }
  stop() { this.active = false; this.mesh.visible = false; }
  update(dt) {
    if (!this.active) return; this.t += dt; const d = this.d;
    this.p.forEach((q, i) => { q.x += q.vx * dt + Math.sin(this.t * 2 + i) * 0.01; q.y += q.vy * dt; q.rx += q.vr * dt; q.ry += q.vr * 0.7 * dt; if (q.y < -3.6) { q.y = 3.6 + Math.random(); q.x = (Math.random() - 0.5) * 7; } d.position.set(q.x, q.y, q.z); d.rotation.set(q.rx, q.ry, 0); d.scale.setScalar(q.s); d.updateMatrix(); this.mesh.setMatrixAt(i, d.matrix); });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
// ---- speed lines / wind streaks: additive line segments in camera space ---------------------------------------
export class Streaks {
  constructor(camera, count) {
    this.n = count || 40; this.camera = camera; this.mode = 'fp'; this.level = 0;
    this.pos = new Float32Array(this.n * 6); this.seed = []; for (let i = 0; i < this.n; i++) this.seed.push({ a: Math.random() * 6.283, r: 0, z: 0, len: 0, sp: 0 });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, fog: false });
    this.lines = new THREE.LineSegments(g, this.mat); this.lines.frustumCulled = false; this.lines.renderOrder = 15; camera.add(this.lines);
    for (let i = 0; i < this.n; i++) this.respawn(i, true);
  }
  respawn(i, init) {
    const s = this.seed[i];
    if (this.mode === 'fp') { s.r = 0.9 + Math.random() * 3.6; s.a = Math.random() * 6.283; s.z = -(init ? Math.random() * 14 : 14); s.len = 0.8 + Math.random() * 2.2; s.sp = 0.8 + Math.random() * 0.5; }
    else { s.r = 0; s.a = 0; s.z = 0; s.len = 0.5 + Math.random() * 0.9; s.sp = 0.7 + Math.random() * 0.7; s.px = (init ? (Math.random() - 0.5) : 0.55) * 22; s.py = (Math.random() < 0.5 ? -1 : 1) * (1.6 + Math.random() * 2.6); s.pz = -(5 + Math.random() * 4); }
  }
  setMode(m) { this.mode = m; for (let i = 0; i < this.n; i++) this.respawn(i, true); }
  update(dt, speed, level) {
    this.level += (level - this.level) * Math.min(1, dt * 4); this.mat.opacity = Math.min(0.45, this.level * 0.45); this.lines.visible = this.level > 0.02;
    if (!this.lines.visible) return;
    const p = this.pos;
    for (let i = 0; i < this.n; i++) {
      const s = this.seed[i];
      if (this.mode === 'fp') { s.z += speed * s.sp * dt * 0.55; if (s.z > -0.5) this.respawn(i, false); const x = Math.cos(s.a) * s.r * (1 + (14 + s.z) * 0.0), y = Math.sin(s.a) * s.r * 0.75; p[i * 6] = x; p[i * 6 + 1] = y; p[i * 6 + 2] = s.z; p[i * 6 + 3] = x; p[i * 6 + 4] = y; p[i * 6 + 5] = s.z - s.len * (speed / 24); }
      else { s.px -= speed * s.sp * dt * 0.9; if (s.px < -12) this.respawn(i, false), (s.px = 12); p[i * 6] = s.px; p[i * 6 + 1] = s.py; p[i * 6 + 2] = s.pz; p[i * 6 + 3] = s.px + s.len * (speed / 25); p[i * 6 + 4] = s.py; p[i * 6 + 5] = s.pz; }
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
  }
}
