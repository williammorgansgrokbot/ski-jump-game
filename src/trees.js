// Painted cartoon trees: one atlas (art/trees.webp), drawn as ONE instanced draw call of upright, camera-facing billboards
// with per-instance size / mirror / tone, distance haze + cool desaturation toward the horizon colour. Replaces the old low-poly pine.
import * as THREE from 'three';
import TJ from '../art/trees.json';

// [sprite, weight]: greens dominate, amber / violet are rare colourful accents
const KINDS = [['pine_tall', 3], ['fir_fluffy', 2], ['pine_trio', 1.3], ['fir_snowy', 2], ['spruce_teal', 2], ['fir_amber', 0.45], ['pine_young', 1], ['fir_violet', 0.45]];
const TOTAL = KINDS.reduce((a, k) => a + k[1], 0);
export function pickKind(r) { let x = r * TOTAL; for (const [n, w] of KINDS) { x -= w; if (x <= 0) return n; } return KINDS[0][0]; }
export const GREEN_KINDS = ['pine_tall', 'fir_fluffy', 'pine_trio', 'fir_snowy', 'spruce_teal', 'pine_young'];

const VS = `
attribute vec4 aRect; attribute vec3 aPos; attribute vec2 aSize; attribute float aTone;
varying vec2 vUv; varying float vTone; varying float vDepth;
void main(){
  vec3 toCam = cameraPosition - aPos; toCam.y = 0.0; float l = length(toCam); toCam = l > 1e-4 ? toCam / l : vec3(0.0, 0.0, 1.0);
  vec3 right = vec3(toCam.z, 0.0, -toCam.x);
  vec3 wp = aPos + right * (position.x * aSize.x * aSize.y) + vec3(0.0, 1.0, 0.0) * (position.y * aSize.x);
  vUv = mix(aRect.xy, aRect.zw, vec2(aSize.y < 0.0 ? 1.0 - uv.x : uv.x, uv.y)); vTone = aTone;
  vec4 mv = viewMatrix * vec4(wp, 1.0); vDepth = -mv.z; gl_Position = projectionMatrix * mv;
}`;
const FS = `
uniform sampler2D map; uniform vec3 fogColor; uniform float hazeNear; uniform float hazeFar; uniform float hazeMax;
varying vec2 vUv; varying float vTone; varying float vDepth;
void main(){
  vec4 c = texture2D(map, vUv); if (c.a < 0.1) discard;
  vec3 col = c.rgb * vTone;
  float f = smoothstep(hazeNear, hazeFar, vDepth);
  float g = dot(col, vec3(0.3, 0.59, 0.11)); col = mix(col, vec3(g) * vec3(0.92, 0.98, 1.1), 0.4 * f);
  col = mix(col, fogColor, f * hazeMax);
  gl_FragColor = vec4(col, c.a);
  #include <colorspace_fragment>
}`;

export class TreeField {
  constructor() { this.items = []; }
  add(kind, x, y, z, h, o) {          // h = world height of a full-size tree; per-sprite relative height is applied here
    o = o || {}; const rel = TJ.rel[kind] || 1; this.items.push({ kind, x, y, z, h: h * rel, flip: o.flip != null ? o.flip : Math.random() < 0.5, tone: o.tone != null ? o.tone : 0.9 + Math.random() * 0.2 });
  }
  build(tex, haze) {
    const n = this.items.length, g = new THREE.InstancedBufferGeometry(); const q = new THREE.PlaneGeometry(1, 1); q.translate(0, 0.5, 0);
    g.index = q.index; g.setAttribute('position', q.attributes.position); g.setAttribute('uv', q.attributes.uv);
    const rect = new Float32Array(n * 4), pos = new Float32Array(n * 3), size = new Float32Array(n * 2), tone = new Float32Array(n);
    this.items.forEach((t, i) => {
      const r = TJ.r[t.kind], e = 0.5; rect.set([(r[0] + e) / TJ.w, 1 - (r[1] + r[3] - e) / TJ.h, (r[0] + r[2] - e) / TJ.w, 1 - (r[1] + e) / TJ.h], i * 4);
      pos.set([t.x, t.y, t.z], i * 3); size.set([t.h, (t.flip ? -1 : 1) * TJ.aspect[t.kind]], i * 2); tone[i] = t.tone;
    });
    g.setAttribute('aRect', new THREE.InstancedBufferAttribute(rect, 4)); g.setAttribute('aPos', new THREE.InstancedBufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 2)); g.setAttribute('aTone', new THREE.InstancedBufferAttribute(tone, 1)); g.instanceCount = n;
    if (tex) { tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.needsUpdate = true; }
    const mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, side: THREE.DoubleSide, alphaToCoverage: true, fog: false,
      uniforms: { map: { value: tex }, fogColor: { value: new THREE.Color(haze.color) }, hazeNear: { value: haze.near }, hazeFar: { value: haze.far }, hazeMax: { value: haze.max != null ? haze.max : 0.85 } } });
    const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.renderOrder = 0; return mesh;
  }
}
