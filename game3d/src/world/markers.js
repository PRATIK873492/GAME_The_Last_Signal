/* =====================================================================
   OBJECTIVE MARKERS: a glowing amber ring on the ground plus a tall beam of
   light, placed at MAP coordinates (the same points the missions use).
   ===================================================================== */
import * as THREE from 'three';
import { toWorld } from '../core/worldLayout.js';

export function createMarker(scene) {
  const group = new THREE.Group();
  const amber = new THREE.Color('#f2a93b');
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.0, 48), new THREE.MeshBasicMaterial({ color: amber, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; group.add(ring);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48), new THREE.MeshBasicMaterial({ color: amber, transparent: true, opacity: 0.12, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2; disc.position.y = 0.05; group.add(disc);
  // vertical beam: additive, fades toward the top (vertex colours)
  const beamGeo = new THREE.CylinderGeometry(0.5, 0.9, 60, 20, 1, true);
  const colors = []; const pos = beamGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) { const k = pos.getY(i) > 0 ? 0 : 1; colors.push(k, k * 0.66, k * 0.23); }
  beamGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  beam.position.y = 30; group.add(beam);
  const light = new THREE.PointLight(amber, 25, 14, 2); light.position.y = 1.5; group.add(light);
  scene.add(group);

  return {
    group, map: null,
    /** Place at a MAP point (or hide with null). */
    set(mapPt) { this.map = mapPt; group.visible = !!mapPt; if (mapPt) { const w = toWorld(mapPt.x, mapPt.y); group.position.set(w.x, 0, w.z); } },
    update(t) { const s = 1 + Math.sin(t * 4) * 0.08; ring.scale.set(s, s, 1); beam.material.opacity = 0.28 + Math.sin(t * 2) * 0.07; },
  };
}
