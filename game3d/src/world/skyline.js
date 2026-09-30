/* =====================================================================
   DISTANT SKYLINE & MOUNTAINS (background scene, beyond the playable map)
   So the world feels endless: a ring of dead towers 350-900 m away and a
   jagged mountain range ~2 km away. Rendered in the background pass with
   its own light fog, so it fades into the haze instead of being cut off.
   ===================================================================== */
import * as THREE from 'three';
import { MAP_TO_M as S, WORLD, mulberry } from '../core/worldLayout.js';
import { facadeMaterial } from './city.js';
import { mat } from './kit.js';

export function buildSkyline(bg) {
  const r = mulberry(77);
  const C = WORLD * S / 2;                            // city centre (metres)
  const n = 320;
  const unit = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const towers = new THREE.InstancedMesh(unit, facadeMaterial(), n);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, d = 360 + Math.pow(r(), 0.7) * 560;
    const w = 14 + r() * 30, h = 18 + Math.pow(r(), 2) * 110 * (d < 600 ? 1 : 0.7);
    towers.setMatrixAt(i, mat(C + Math.cos(a) * d, -1, C + Math.sin(a) * d, r() * 3, w, h, 10 + r() * 26));
    towers.setColorAt(i, new THREE.Color().setHSL(0.08, 0.06, 0.32 + r() * 0.16));
  }
  bg.add(towers);

  // mountains: a ring whose top edge is shaped by layered sine "noise"
  const seg = 256, geo = new THREE.CylinderGeometry(2200, 2200, 1, seg, 6, true);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = pos.getY(i) + 0.5;           // 0 bottom .. 1 top
    const a = Math.atan2(z, x);
    const ridge = 160 + 110 * Math.sin(a * 3 + 1) + 70 * Math.sin(a * 7.3) + 35 * Math.sin(a * 17.1 + 2) + 18 * Math.sin(a * 41);
    pos.setY(i, -20 + y * Math.max(60, ridge));
  }
  geo.computeVertexNormals();
  const mountains = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#4a4f55', roughness: 1, side: THREE.BackSide }));
  mountains.position.set(C, 0, C);
  bg.add(mountains);
  return { towers, mountains };
}
