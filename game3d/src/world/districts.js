/* =====================================================================
   DISTRICT IDENTITY - each colony should be recognisable at a glance
     Lakeside      : fishing boats bobbing at the docks, pier posts, crates
     Ironside      : distillation towers, pipe racks, a burning flare stack
     Mercy Heights : red-cross banners, relief tents, abandoned ambulances
     Crow's Market : string lights, stall awnings, a neon sign
     Dead Zone     : clean white Helix walls with teal light strips,
                     Helix logo panels, patrolling quadcopter drones
   ===================================================================== */
import * as THREE from 'three';
import { MAP_TO_M as S, RIVER, mulberry } from '../core/worldLayout.js';
import { part, merge, mat, canvasTex } from './kit.js';
import { WATER_Y, RIVER_BED } from './city.js';

const vc = (o = {}) => new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, roughness: 0.8 }, o));
const add = (g, geo, m, x, y, z, ry = 0, shadow = true) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.y = ry; o.castShadow = shadow; o.receiveShadow = true; g.add(o); return o; };

export function buildDistricts(scene, layout, box, pool) {
  const group = new THREE.Group(); scene.add(group);
  const r = mulberry(2026);
  const anim = [];                                   // things that move every frame

  // ============== LAKESIDE: docks & fishing boats ==============
  const boatGeo = merge([
    part(new THREE.BoxGeometry(5.2, 0.9, 1.9), '#ffffff', 0, 0.2, 0),
    part(new THREE.ConeGeometry(0.95, 1.6, 4, 1), '#ffffff', 3.3, 0.2, 0, 0, Math.PI / 4, -Math.PI / 2),
    part(new THREE.BoxGeometry(1.6, 1.1, 1.3), '#d8d4c8', -0.8, 1.2, 0),
    part(new THREE.BoxGeometry(0.1, 2.6, 0.1), '#3a3a3a', 0.8, 1.9, 0),
    part(new THREE.BoxGeometry(5.3, 0.12, 1.95), '#2b2b2b', 0, 0.62, 0),
  ]);
  const boatCols = ['#2f5f8a', '#9a3a2a', '#e0d8c0'];
  const rx0 = RIVER.x * S;
  [[rx0 + 3.2, 380, 0.08], [rx0 + 3.4, 392, -0.05], [rx0 + 7, 404, 0.4]].forEach(([x, z, ry], i) => {
    const b = add(group, boatGeo, vc({ color: boatCols[i], roughness: 0.6 }), x, WATER_Y, z, Math.PI / 2 + ry);
    anim.push(t => {                                  // bob on the water, or lie stranded on a dead riverbed
      const dead = group.userData.riverDead;
      b.position.y = dead ? RIVER_BED + 0.4 : WATER_Y + Math.sin(t * 1.3 + i) * 0.08;
      b.rotation.z = dead ? 0.25 : Math.sin(t * 1.1 + i * 2) * 0.04;
    });
  });
  const postGeo = new THREE.CylinderGeometry(0.16, 0.18, 4, 8), wood = new THREE.MeshStandardMaterial({ color: '#4a3a2a', roughness: 0.9 });
  for (let z = 377; z <= 409; z += 3.2) add(group, postGeo, wood, rx0 + 0.9, -1.4, z, 0, false);
  const crateMat = new THREE.MeshStandardMaterial({ color: '#7a5f3e', roughness: 0.9 });
  for (let i = 0; i < 9; i++) {
    const s = 0.9 + r() * 0.4, x = 196 + r() * 18, z = 378 + r() * 28, stack = r() < 0.4 ? 2 : 1;
    for (let k = 0; k < stack; k++) add(group, new THREE.BoxGeometry(s, s, s), crateMat, x, s / 2 + k * s, z, r() * 0.4);
    box(x, s * stack / 2, z, s / 2, s * stack / 2, s / 2);
  }

  // ============== IRONSIDE: refinery ==============
  const steel = new THREE.MeshStandardMaterial({ color: '#77716a', metalness: 0.75, roughness: 0.45 });
  const rust = new THREE.MeshStandardMaterial({ color: '#6b4a34', metalness: 0.5, roughness: 0.7 });
  for (const [mx, my, h] of [[2025, 470, 26], [2025, 560, 21], [1965, 520, 17]]) {       // distillation columns
    const x = mx * S, z = my * S;
    add(group, new THREE.CylinderGeometry(1.4, 1.5, h, 20), steel, x, h / 2, z);
    for (let y = 5; y < h; y += 5) add(group, new THREE.TorusGeometry(1.75, 0.08, 6, 24), rust, x, y, z, 0, false).rotation.x = Math.PI / 2;
    add(group, new THREE.BoxGeometry(0.5, h, 0.06), rust, x + 1.55, h / 2, z, 0, false);                 // ladder
    box(x, h / 2, z, 1.5, h / 2, 1.5);
  }
  // pipe rack between the tanks and the towers (3 pipes on steel frames)
  const rackZ = 395 * S, rx = [1712 * S, 2040 * S];
  for (const [dy, dz, rad, m] of [[3.6, 0, 0.35, steel], [3.6, 0.9, 0.25, rust], [4.4, 0.45, 0.2, steel]]) {
    add(group, new THREE.CylinderGeometry(rad, rad, rx[1] - rx[0], 12), m, (rx[0] + rx[1]) / 2, dy, rackZ + dz).rotation.z = Math.PI / 2;
  }
  for (let x = rx[0]; x <= rx[1]; x += 8) {
    for (const dz of [-0.6, 1.5]) add(group, new THREE.BoxGeometry(0.25, 3.4, 0.25), rust, x, 1.7, rackZ + dz);
    add(group, new THREE.BoxGeometry(0.25, 0.25, 2.3), rust, x, 3.35, rackZ + 0.45);
    box(x, 1.7, rackZ + 0.45, 0.2, 1.7, 1.1);
  }
  // flare stack: tall pipe with a burning flame, orange glow over the district, smoke plume
  const fx = 2065 * S, fz = 650 * S, fh = 32;
  add(group, new THREE.CylinderGeometry(0.45, 0.7, fh, 12), rust, fx, fh / 2, fz);
  box(fx, fh / 2, fz, 0.7, fh / 2, 0.7);
  const flame = add(group, new THREE.ConeGeometry(0.9, 4.5, 10, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb44a').multiplyScalar(4), transparent: true, opacity: 0.95, fog: false }), fx, fh + 2.2, fz, 0, false);
  const flameCore = add(group, new THREE.ConeGeometry(0.45, 2.6, 8, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff1c2').multiplyScalar(6), fog: false }), fx, fh + 1.4, fz, 0, false);
  pool.add(fx, fh + 2, fz, '#ff8a3a', 900, 110, 'glow');
  anim.push(t => { const k = 1 + Math.sin(t * 11) * 0.12 + Math.sin(t * 17.3) * 0.08; flame.scale.set(1, k, 1); flameCore.scale.set(1, k * 0.9, 1); flame.rotation.y = t * 2; });
  const smokeTex = canvasTex(128, 128, (g, w) => { const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(60,55,50,.55)'); gr.addColorStop(1, 'rgba(60,55,50,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); });
  const puffs = Array.from({ length: 14 }, (_, i) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false }));
    group.add(s); return { s, off: i / 14 };
  });
  anim.push(t => { for (const p of puffs) { const k = (t * 0.06 + p.off) % 1; p.s.position.set(fx + k * 22, fh + 4 + k * 40, fz - k * 8); const sc = 4 + k * 20; p.s.scale.set(sc, sc, 1); p.s.material.opacity = (1 - k) * 0.8; } });

  // ============== MERCY HEIGHTS: banners, tents, ambulances ==============
  const bannerTex = canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#ece9e1'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#b3262b'; g.fillRect(w * 0.38, h * 0.18, w * 0.24, h * 0.36); g.fillRect(w * 0.2, h * 0.28, w * 0.6, h * 0.16);
    g.globalCompositeOperation = 'destination-out';                                    // torn bottom edge
    g.beginPath(); g.moveTo(0, h); for (let x = 0; x <= w; x += 8) g.lineTo(x, h - 10 - Math.random() * 30); g.lineTo(w, h); g.fill();
  });
  const bannerMat = new THREE.MeshStandardMaterial({ map: bannerTex, transparent: true, side: THREE.DoubleSide, roughness: 0.9 });
  const hosp = layout.buildings.find(b => b.cross);
  if (hosp) {
    const z = (hosp.y + hosp.h) * S + 0.08, top = hosp.h3 || 21;
    for (let i = 0; i < 4; i++) {
      const bn = add(group, new THREE.PlaneGeometry(3, 7, 1, 6), bannerMat, (hosp.x + 40 + i * 58) * S, top - 4.5, z, 0, false);
      anim.push(t => { bn.rotation.x = Math.sin(t * 1.2 + i) * 0.05; });
    }
  }
  // relief tents: a triangular prism (3-sided cylinder lying on its side)
  const tentGeo = new THREE.CylinderGeometry(1.7, 1.7, 4.2, 3, 1).rotateZ(Math.PI / 2).rotateX(Math.PI / 6);
  const tentCols = ['#d9d4c6', '#6d7a52', '#d9d4c6', '#9aa3a0', '#d9d4c6', '#6d7a52'];
  [[420, 500], [600, 500], [360, 610], [610, 610], [540, 640], [390, 520]].forEach(([mx, my], i) => {
    const x = mx * S, z = my * S, ry = r() * 0.5;
    add(group, tentGeo, new THREE.MeshStandardMaterial({ color: tentCols[i], roughness: 0.95 }), x, 0.85, z, ry);
    box(x, 1, z, 2.1, 1, 1.5, ry);
  });
  const vanGeo = (() => {                              // ambulance: van body + red stripe + light bar
    const L = 4.8, H = 1.2;
    const ps = [part(new THREE.BoxGeometry(L, H, 1.9), '#f0eee8', 0, 0.35 + H / 2, 0), part(new THREE.BoxGeometry(3.3, 0.95, 1.86), '#f0eee8', -0.7, 0.35 + H + 0.47, 0),
      part(new THREE.BoxGeometry(1.2, 0.6, 1.8), '#1c2226', 1.3, 0.35 + H + 0.1, 0), part(new THREE.BoxGeometry(L * 0.99, 0.2, 1.92), '#b3262b', 0, 0.35 + H * 0.55, 0),
      part(new THREE.BoxGeometry(0.4, 0.15, 1.2), '#c43030', 0.4, 0.35 + H + 0.98, 0)];
    for (const [x, z] of [[1.5, 0.9], [1.5, -0.9], [-1.5, 0.9], [-1.5, -0.9]]) ps.push(part(new THREE.CylinderGeometry(0.38, 0.38, 0.26, 14), '#1e2224', x, 0.38, z, Math.PI / 2));
    return merge(ps);
  })();
  [[340, 470, 0.3], [520, 690, 1.6]].forEach(([mx, my, ry]) => { add(group, vanGeo, vc({ roughness: 0.5 }), mx * S, 0, my * S, ry); box(mx * S, 1.2, my * S, 2.4, 1.2, 1, ry); });

  // ============== CROW'S MARKET: string lights, awnings, neon ==============
  const poleMat = new THREE.MeshStandardMaterial({ color: '#3a3530', roughness: 0.8 });
  const anchors = [[1700, 1830], [1790, 1840], [1880, 1830], [1970, 1840], [2050, 1830], [1700, 1980], [1790, 2000], [1880, 1985], [1970, 2000], [2050, 1985]];
  for (const [mx, my] of anchors) { add(group, new THREE.CylinderGeometry(0.07, 0.09, 5, 6), poleMat, mx * S, 2.5, my * S); box(mx * S, 2.5, my * S, 0.1, 2.5, 0.1); }
  const strands = [];
  for (let i = 0; i < 4; i++) strands.push([i, i + 1], [i + 5, i + 6], [i, i + 6]);
  strands.push([4, 9]);
  const bulbCols = ['#ffcf6a', '#ff7a5a', '#8fe0ff', '#ffe9b0', '#c58bff'];
  const bulbs = [], wirePts = [];
  for (const [a, b] of strands) {
    const A = new THREE.Vector3(anchors[a][0] * S, 4.9, anchors[a][1] * S), B = new THREE.Vector3(anchors[b][0] * S, 4.9, anchors[b][1] * S);
    const n = Math.ceil(A.distanceTo(B) / 1.1), at = t => { const p = A.clone().lerp(B, t); p.y -= 1.1 * 4 * t * (1 - t); return p; };   // sagging strand
    for (let i = 0; i <= n; i++) {
      const p = at(i / n); bulbs.push({ p, c: bulbCols[i % bulbCols.length] });
      if (i < n) { const q = at((i + 1) / n); wirePts.push(p.x, p.y + 0.08, p.z, q.x, q.y + 0.08, q.z); }
    }
  }
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
  group.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: '#111' })));
  const bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 3) }), bulbs.length);   // x3 = HDR glow for bloom
  bulbs.forEach((b, i) => { bulbMesh.setMatrixAt(i, mat(b.p.x, b.p.y, b.p.z)); bulbMesh.setColorAt(i, new THREE.Color(b.c)); });
  group.add(bulbMesh);
  for (const [mx, my] of [[1790, 1915], [1970, 1915], [1880, 2050]]) pool.add(mx * S, 4.2, my * S, '#ffb070', 45, 26, 'night');
  for (const st of layout.buildings.filter(b => b.stall)) {           // cloth awnings over the stalls
    const aw = add(group, new THREE.PlaneGeometry(st.w * S + 1.6, st.h * S + 2.2), new THREE.MeshStandardMaterial({ color: st.roof, roughness: 0.9, side: THREE.DoubleSide }), (st.x + st.w / 2) * S, 3.3, (st.y + st.h / 2) * S + 0.6, 0);
    aw.rotation.x = -Math.PI / 2 + 0.28;
  }
  const neon = canvasTex(512, 160, (g, w, h) => {
    g.fillStyle = '#120a10'; g.fillRect(0, 0, w, h);
    g.font = "800 104px 'Big Shoulders Stencil Display', Impact, sans-serif"; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = '#ff4fa0'; g.shadowBlur = 24; g.fillStyle = '#ffd1ea'; g.fillText("CROW'S", w / 2, h / 2 + 6);
    g.shadowBlur = 0; g.strokeStyle = '#ff4fa0'; g.lineWidth = 3; g.strokeRect(10, 10, w - 20, h - 20);
  });
  const neonMesh = add(group, new THREE.PlaneGeometry(5.5, 1.7), new THREE.MeshBasicMaterial({ map: neon }), 1880 * S, 5.2, 1940 * S + 6.1, 0, false);
  pool.add(1880 * S, 5, 1940 * S + 7, '#ff4fa0', 25, 14, 'night');
  anim.push(t => { neonMesh.material.color.setScalar(Math.sin(t * 17) > 0.93 ? 0.6 : 2.4); });   // neon stutter

  // ============== DEAD ZONE: Helix walls, logo panels, drones ==============
  const dz = { x0: 1270 * S, x1: 2395 * S, z0: 905 * S, z1: 1495 * S };
  const wallMat = new THREE.MeshStandardMaterial({ color: '#e6ebec', roughness: 0.35, metalness: 0.1 });
  const teal = new THREE.MeshBasicMaterial({ color: new THREE.Color('#39e0cf').multiplyScalar(2.5) });
  const wallSeg = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0); if (len < 1) return;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, ry = Math.atan2(-(z1 - z0), x1 - x0);
    add(group, new THREE.BoxGeometry(len, 3.8, 0.5), wallMat, cx, 1.9, cz, ry);
    add(group, new THREE.BoxGeometry(len, 0.12, 0.54), teal, cx, 3.5, cz, ry, false);
    box(cx, 1.9, cz, len / 2, 1.9, 0.25, ry);
  };
  const gaps = [1650 * S, 2100 * S];               // roads through the north & south walls
  for (const z of [dz.z0, dz.z1]) { let x = dz.x0; for (const g of gaps) { wallSeg(x, z, g - 10, z); x = g + 10; } wallSeg(x, z, dz.x1, z); }
  wallSeg(dz.x0, dz.z0, dz.x0, 1200 * S - 10); wallSeg(dz.x0, 1200 * S + 10, dz.x0, dz.z1);   // west wall, open for the bridge road
  wallSeg(dz.x1, dz.z0, dz.x1, dz.z1);
  for (const [x, z] of [[dz.x0, dz.z0], [dz.x1, dz.z0], [dz.x0, dz.z1], [dz.x1, dz.z1], [1650 * S, dz.z0], [2100 * S, dz.z1]]) pool.add(x, 5, z, '#39e0cf', 60, 30, 'glow');
  const logo = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#f2f5f5'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1aa89a'; g.lineWidth = 10;
    for (const sgn of [1, -1]) { g.beginPath(); for (let x = 40; x < 170; x += 2) { const y = h / 2 + sgn * Math.sin(x * 0.07) * 50; x === 40 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke(); }   // double-helix mark
    g.fillStyle = '#16323a'; g.font = "800 64px 'IBM Plex Sans', Arial, sans-serif"; g.fillText('HELIX', 190, 125);
    g.font = "600 26px 'IBM Plex Mono', monospace"; g.fillStyle = '#1aa89a'; g.fillText('DYNAMICS · RESTRICTED', 192, 170);
  });
  const logoMat = new THREE.MeshStandardMaterial({ map: logo, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const x of [1450, 1850, 2250]) { add(group, new THREE.PlaneGeometry(6, 3), logoMat, x * S, 1.9, dz.z0 - 0.27, Math.PI, false); add(group, new THREE.PlaneGeometry(6, 3), logoMat, x * S, 1.9, dz.z1 + 0.27, 0, false); }

  // Helix patrol drones: body, four arms, spinning rotors, a teal eye
  const droneMat = new THREE.MeshStandardMaterial({ color: '#dfe5e8', roughness: 0.35, metalness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: '#1a1d1f', roughness: 0.5 });
  const rotorMat = new THREE.MeshBasicMaterial({ color: '#222', transparent: true, opacity: 0.45, side: THREE.DoubleSide });
  for (let i = 0; i < 5; i++) {
    const d = new THREE.Group(), rotors = [];
    d.add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.7), droneMat));
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#39e0cf').multiplyScalar(4) })); eye.position.set(0, -0.12, 0.34); d.add(eye);
    for (const [ax, az] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.06, 0.08), dark); arm.position.set(ax * 0.4, 0.05, az * 0.4); arm.rotation.y = -Math.atan2(az, ax); d.add(arm);
      const rot = new THREE.Mesh(new THREE.CircleGeometry(0.34, 16), rotorMat); rot.rotation.x = -Math.PI / 2; rot.position.set(ax * 0.72, 0.12, az * 0.72); d.add(rot); rotors.push(rot);
    }
    d.traverse(o => { o.castShadow = true; });
    group.add(d);
    const cx = (1400 + r() * 900) * S, cz = (1000 + r() * 400) * S, rad = 12 + r() * 25, sp = 0.15 + r() * 0.2, hgt = 7 + r() * 7;
    anim.push(t => {
      const a = t * sp + i * 1.3;
      d.position.set(cx + Math.cos(a) * rad, hgt + Math.sin(t * 1.7 + i) * 0.4, cz + Math.sin(a) * rad);
      d.rotation.set(0, -a, 0.12);
      for (const rr of rotors) rr.rotation.z = t * 40;
    });
  }

  return { group, update(t, riverDead) { group.userData.riverDead = riverDead; for (const f of anim) f(t); } };
}
