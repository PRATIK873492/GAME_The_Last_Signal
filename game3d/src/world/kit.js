/* =====================================================================
   BUILD KIT: helpers shared by every "world" module.

   1. tint / part / merge
      Props (cars, poles, tents...) are several primitives MERGED into one
      geometry. Each part carries its own vertex colour, so a whole car is
      ONE geometry + ONE material, and can be instanced hundreds of times.

   2. Chunked instancing = frustum culling + LOD
      Instances are grouped into 96 m chunks, one InstancedMesh per chunk.
      Three.js skips chunks outside the camera view (frustum culling), and
      updateLOD() hides small-detail chunks beyond the preset's detail
      distance (level of detail).
   ===================================================================== */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Give every vertex of a geometry one colour (multiplied by the material / instance colour). */
export function tint(geo, hex) {
  const c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
/** A coloured, positioned primitive ready to merge. */
export function part(geo, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  if (rx) geo.rotateX(rx); if (ry) geo.rotateY(ry); if (rz) geo.rotateZ(rz);
  geo.translate(x, y, z);
  return tint(geo, hex);
}
/** Merge parts into one geometry (all converted to non-indexed so attributes line up). */
export function merge(parts) {
  const g = mergeGeometries(parts.map(p => (p.index ? p.toNonIndexed() : p)));
  g.computeBoundingSphere();
  return g;
}

const WHITE = new THREE.Color(1, 1, 1);
const REGISTRY = [];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

/** Compose a matrix from position / Y rotation / scale (the common case). */
export function mat(x, y, z, ry = 0, sx = 1, sy = sx, sz = sx, rx = 0, rz = 0) {
  _q.setFromEuler(_e.set(rx, ry, rz));
  return _m.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz)).clone();
}

export class Chunked {
  /**
   * @param parent  scene / group to add meshes to
   * @param lod     multiplier on the preset detail distance (big things: 3, tiny things: 0.5)
   */
  constructor(parent, geo, material, { chunk = 96, shadow = true, receive = true, lod = 1 } = {}) {
    Object.assign(this, { parent, geo, material, chunk, shadow, receive, lod });
    this.buckets = new Map(); this.meshes = []; this.count = 0;
    REGISTRY.push(this);
  }
  add(matrix, color = WHITE) {
    _v.setFromMatrixPosition(matrix);
    const k = Math.floor(_v.x / this.chunk) + ',' + Math.floor(_v.z / this.chunk);
    let b = this.buckets.get(k);
    if (!b) { b = { m: [], c: [] }; this.buckets.set(k, b); }
    b.m.push(matrix); b.c.push(color instanceof THREE.Color ? color : new THREE.Color(color));
    this.count++;
    return this;
  }
  build() {
    for (const b of this.buckets.values()) {
      const im = new THREE.InstancedMesh(this.geo, this.material, b.m.length);
      b.m.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, b.c[i]); });
      im.castShadow = this.shadow; im.receiveShadow = this.receive;
      im.computeBoundingSphere();
      im.userData.center = im.boundingSphere.center.clone();
      im.userData.radius = im.boundingSphere.radius;
      this.parent.add(im); this.meshes.push(im);
    }
    this.buckets = null;
    return this;
  }
}

/** Hide detail chunks that are further than detailDist * lod from the camera. */
export function updateLOD(camPos, detailDist) {
  for (const c of REGISTRY) for (const m of c.meshes) {
    m.visible = m.userData.center.distanceTo(camPos) - m.userData.radius < detailDist * c.lod;
  }
}
export function instanceStats() {
  let meshes = 0, inst = 0; for (const c of REGISTRY) { meshes += c.meshes.length; inst += c.count; } return { meshes, inst };
}

/** A canvas texture helper (sRGB, repeat-wrapped). */
export function canvasTex(w, h, draw, { repeat = false, srgb = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
