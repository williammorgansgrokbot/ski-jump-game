import * as THREE from 'three';
// 3-step toon gradient (tiny DataTexture; lighting ramp only, not art)
let _grad = null;
export function gradient(steps) {
  steps = steps || 3;
  if (_grad && _grad.__steps === steps) return _grad;
  const data = new Uint8Array(steps * 4);
  const vals = steps === 3 ? [110, 190, 255] : [90, 150, 205, 255];
  for (let i = 0; i < steps; i++) { data[i*4] = data[i*4+1] = data[i*4+2] = vals[i]; data[i*4+3] = 255; }
  const t = new THREE.DataTexture(data, steps, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; t.__steps = steps;
  return (_grad = t);
}
export function toonMat(color, opts) {
  opts = opts || {};
  const m = new THREE.MeshToonMaterial({ color: new THREE.Color(color), gradientMap: gradient(3) });
  if (opts.emissive) { m.emissive = new THREE.Color(opts.emissive); }
  return m;
}
// inverted-hull outline for skinned or rigid meshes (works with skinning: pushes along skinned normal)
const OUT_CACHE = {};
export function outlineMaterial(thick, color) {
  const key = thick.toFixed(5) + color;
  if (OUT_CACHE[key]) return OUT_CACHE[key];
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color || 0x1a1230), side: THREE.BackSide, fog: false });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifndef USE_SKINNING\n transformed += normalize(normal) * ' + thick.toFixed(6) + ';\n#endif')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\n#ifdef USE_SKINNING\n transformed += normalize(objectNormal) * ' + thick.toFixed(6) + ';\n#endif');
  };
  m.customProgramCacheKey = () => 'outline' + key;
  return (OUT_CACHE[key] = m);
}
export function addOutline(mesh, worldThick, color) {
  const ws = new THREE.Vector3(); mesh.updateWorldMatrix(true, false); mesh.getWorldScale(ws);
  const t = worldThick / Math.max(1e-6, (ws.x + ws.y + ws.z) / 3);
  const mat = outlineMaterial(t, color);
  let o;
  if (mesh.isSkinnedMesh) { o = new THREE.SkinnedMesh(mesh.geometry, mat); o.bind(mesh.skeleton, mesh.bindMatrix); o.frustumCulled = false; }
  else { o = new THREE.Mesh(mesh.geometry, mat); }
  o.name = mesh.name + '_outline'; o.userData.isOutline = true; o.castShadow = false; o.receiveShadow = false;
  mesh.add(o);
  return o;
}
