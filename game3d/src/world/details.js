/* =====================================================================
   CITY DETAILS - everything that makes blocks read as a ruined city:
     buildings : parapets, rooftop AC units, water tanks, antennas,
                 balconies, wall AC units, rubble + exposed rebar on ruins,
                 spray-paint graffiti
     streets   : street lamps (dead by day; a few colony-powered ones glow
                 at night, some flicker), power poles with sagging wires,
                 abandoned cars, concrete barriers, trash bags, blowing paper
   All repeated objects are instanced (see kit.js). Big props get physics
   colliders from the same numbers used to place them.
   ===================================================================== */
import * as THREE from 'three';
import { MAP_TO_M as S, WORLD, RIVER, BRIDGE, ROADV, ROADH, P, districtAt, mulberry } from '../core/worldLayout.js';
import { part, merge, mat, Chunked, canvasTex } from './kit.js';

const W = WORLD * S;
const vc = (o = {}) => new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, roughness: 0.85 }, o));

// ---------------------------------------------------------------------
// Prop geometries (merged primitives with vertex colours)
// ---------------------------------------------------------------------
function carGeo(van = false) {
  const L = van ? 4.8 : 4.2, H = van ? 1.2 : 0.75, dark = '#1e2224';
  const parts = [
    part(new THREE.BoxGeometry(L, H, 1.8), '#ffffff', 0, 0.35 + H / 2, 0),                              // body (instance-tinted)
    part(new THREE.BoxGeometry(van ? 3.4 : 2.2, van ? 0.9 : 0.62, 1.66), van ? '#ffffff' : '#262c30', van ? -0.6 : -0.25, 0.35 + H + (van ? 0.45 : 0.31), 0),   // cabin
    part(new THREE.BoxGeometry(0.05, 0.5, 1.4), '#15191b', van ? 1.12 : 0.87, 0.35 + H + 0.3, 0, 0, 0, van ? 0 : 0.5),   // windscreen
    part(new THREE.BoxGeometry(0.06, 0.16, 0.3), '#d8d2b8', L / 2, 0.35 + H * 0.6, 0.62),                 // headlights
    part(new THREE.BoxGeometry(0.06, 0.16, 0.3), '#d8d2b8', L / 2, 0.35 + H * 0.6, -0.62),
    part(new THREE.BoxGeometry(0.06, 0.14, 0.3), '#7a1c16', -L / 2, 0.35 + H * 0.6, 0.62),                // tail lights
    part(new THREE.BoxGeometry(0.06, 0.14, 0.3), '#7a1c16', -L / 2, 0.35 + H * 0.6, -0.62),
  ];
  if (van) parts.push(part(new THREE.BoxGeometry(L * 0.98, 0.18, 1.82), '#b3262b', 0, 0.35 + H * 0.55, 0));   // ambulance stripe
  for (const [x, z] of [[L * 0.32, 0.86], [L * 0.32, -0.86], [-L * 0.32, 0.86], [-L * 0.32, -0.86]])
    parts.push(part(new THREE.CylinderGeometry(0.36, 0.36, 0.26, 14), dark, x, 0.36, z, Math.PI / 2));
  return merge(parts);
}
function barrierGeo() {        // concrete "jersey" barrier, 3 m long
  return merge([
    part(new THREE.BoxGeometry(3, 0.35, 0.7), '#ffffff', 0, 0.175, 0),
    part(new THREE.BoxGeometry(3, 0.5, 0.4), '#ffffff', 0, 0.6, 0),
    part(new THREE.BoxGeometry(3, 0.12, 0.26), '#ffffff', 0, 0.91, 0),
    part(new THREE.BoxGeometry(0.4, 0.18, 0.72), '#c43d2a', 1.2, 0.72, 0),   // faded red/white paint band
  ]);
}
function lampGeo() {           // pole + arm; the lamp head is a separate emissive instance
  return merge([
    part(new THREE.CylinderGeometry(0.09, 0.14, 7, 8), '#4b4e50', 0, 3.5, 0),
    part(new THREE.BoxGeometry(1.8, 0.1, 0.1), '#4b4e50', 0.85, 6.95, 0),
    part(new THREE.CylinderGeometry(0.22, 0.26, 0.4, 8), '#3a3d3f', 0, 0.2, 0),
  ]);
}
function poleGeo() {           // wooden power pole with a crossarm and insulators
  return merge([
    part(new THREE.CylinderGeometry(0.13, 0.17, 9.2, 8), '#4a3a2c', 0, 4.6, 0),
    part(new THREE.BoxGeometry(0.14, 0.14, 2.4), '#3d3024', 0, 8.6, 0),
    part(new THREE.CylinderGeometry(0.05, 0.05, 0.25, 6), '#9aa3a8', 0, 8.8, 1.05),
    part(new THREE.CylinderGeometry(0.05, 0.05, 0.25, 6), '#9aa3a8', 0, 8.8, 0),
    part(new THREE.CylinderGeometry(0.05, 0.05, 0.25, 6), '#9aa3a8', 0, 8.8, -1.05),
    part(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 10), '#555a5c', 0, 7.6, 0.25),   // transformer can
  ]);
}
function acGeo() {
  return merge([part(new THREE.BoxGeometry(1.2, 0.8, 0.9), '#ffffff', 0, 0.4, 0), part(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 14), '#2a2d2f', 0, 0.82, 0)]);
}
function roofTankGeo() {
  const legs = [[0.55, 0.55], [-0.55, 0.55], [0.55, -0.55], [-0.55, -0.55]].map(([x, z]) => part(new THREE.BoxGeometry(0.1, 1, 0.1), '#3c3c3c', x, 0.5, z));
  return merge([part(new THREE.CylinderGeometry(0.85, 0.85, 1.7, 16), '#ffffff', 0, 1.85, 0), part(new THREE.ConeGeometry(0.88, 0.35, 16), '#ffffff', 0, 2.87, 0), ...legs]);
}
function balconyGeo() {        // slab + railing; local +z points away from the wall
  return merge([
    part(new THREE.BoxGeometry(2.3, 0.16, 1.1), '#8b877f', 0, 0, 0.55),
    part(new THREE.BoxGeometry(2.3, 0.06, 0.06), '#3c3f41', 0, 0.95, 1.07),
    part(new THREE.BoxGeometry(0.05, 0.95, 1.1), '#3c3f41', 1.13, 0.47, 0.55),
    part(new THREE.BoxGeometry(0.05, 0.95, 1.1), '#3c3f41', -1.13, 0.47, 0.55),
    ...[-0.8, -0.4, 0, 0.4, 0.8].map(x => part(new THREE.BoxGeometry(0.03, 0.9, 0.03), '#3c3f41', x, 0.47, 1.07)),
  ]);
}

// Spray-paint graffiti: 16 generated tags in one texture atlas (all original text).
const TAGS = ['LAST SIGNAL', 'HELIX LIES', 'WATER = LIFE', 'CROWS', 'NO GRID', 'LAKESIDE', 'REMEMBER', 'IRON', 'WHO CUT THE LIGHTS?', 'MERCY', 'TRUST NO1', '2041', 'KANE KNOWS', 'SPARKS', 'HOLD THE LINE', 'SOLACE'];
function graffitiAtlas() {
  return canvasTex(1024, 1024, (g) => {
    const r = mulberry(4242);
    TAGS.forEach((tag, i) => {
      const x0 = (i % 4) * 256, y0 = Math.floor(i / 4) * 256;
      g.save(); g.beginPath(); g.rect(x0, y0, 256, 256); g.clip();
      const cols = ['#e04a3a', '#f2a93b', '#39c0b0', '#e8e0d0', '#8f7cff', '#6fd05a', '#ff6fa8'];
      const fill = cols[Math.floor(r() * cols.length)], outline = r() < 0.5 ? '#111' : '#f4f1e8';
      const size = Math.min(92, 1300 / tag.length);
      g.translate(x0 + 128, y0 + 128); g.rotate((r() - 0.5) * 0.3);
      g.font = `900 ${size}px Impact, 'Arial Black', sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      const words = tag.split(' '), lines = words.length > 2 ? [words.slice(0, 2).join(' '), words.slice(2).join(' ')] : [tag];
      lines.forEach((ln, k) => {
        const y = (k - (lines.length - 1) / 2) * size * 0.95;
        g.lineWidth = size * 0.16; g.strokeStyle = outline; g.lineJoin = 'round'; g.strokeText(ln, 0, y);
        g.fillStyle = fill; g.fillText(ln, 0, y);
        // paint drips
        g.fillStyle = fill; for (let d = 0; d < 5; d++) { const dx = (r() - 0.5) * 200; g.fillRect(dx, y + size * 0.35, 3, 10 + r() * 45); }
      });
      g.restore();
    });
  });
}

// ---------------------------------------------------------------------
export function buildDetails(scene, layout, box, pool) {
  const group = new THREE.Group(); scene.add(group);
  const r = mulberry(555);
  const inBuilding = (mx, my, pad = 0) => layout.buildings.some(b => mx > b.x - pad && mx < b.x + b.w + pad && my > b.y - pad && my < b.y + b.h + pad);
  const onBridgeOrRiver = mx => mx > RIVER.x - 30 && mx < RIVER.x + RIVER.w + 30;

  // ================= BUILDINGS =================
  const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const concrete = new THREE.MeshStandardMaterial({ roughness: 0.95 });
  const parapets = new Chunked(group, unitBox, concrete, { lod: 3 });
  const acs = new Chunked(group, acGeo(), vc({ roughness: 0.6, metalness: 0.4 }), { lod: 1 });
  const tanks = new Chunked(group, roofTankGeo(), vc({ roughness: 0.7 }), { lod: 1.5 });
  const antennas = new Chunked(group, new THREE.CylinderGeometry(0.04, 0.05, 1, 5).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: '#555', metalness: 0.8, roughness: 0.4 }), { lod: 1.5, shadow: false });
  const balconies = new Chunked(group, balconyGeo(), vc(), { lod: 1.3 });
  const wallAc = new Chunked(group, new THREE.BoxGeometry(0.8, 0.55, 0.5).translate(0, 0, 0.25), new THREE.MeshStandardMaterial({ color: '#b5b3ab', roughness: 0.6, metalness: 0.3 }), { lod: 0.8 });
  const rubble = new Chunked(group, new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: '#7a7368', roughness: 1, flatShading: true }), { lod: 1.2 });
  const rebar = new Chunked(group, new THREE.CylinderGeometry(0.03, 0.03, 1, 4).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: '#6b3a22', roughness: 0.8, metalness: 0.5 }), { lod: 0.8, shadow: false });
  const tarps = new Chunked(group, new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#2f6fb0', roughness: 0.7, side: THREE.DoubleSide }), { lod: 2, shadow: false });

  const gAtlas = graffitiAtlas();
  const graffiti = [];

  for (const b of layout.buildings) {
    if (b.tank || b.stall || b.crate || !b.h3) continue;
    const x0 = b.x * S, z0 = b.y * S, w = b.w * S, d = b.h * S, h = b.h3;
    const cx = x0 + w / 2, cz = z0 + d / 2;
    const dist = districtAt(b.x + b.w / 2, b.y + b.h / 2).id;

    // --- parapet wall around the flat roof ---
    if (!b.ruined || r() < 0.4) {
      const ph = 0.9, t = 0.3, col = new THREE.Color('#77736b');
      parapets.add(mat(cx, h, z0 + t / 2, 0, w, ph, t), col).add(mat(cx, h, z0 + d - t / 2, 0, w, ph, t), col)
        .add(mat(x0 + t / 2, h, cz, 0, t, ph, d), col).add(mat(x0 + w - t / 2, h, cz, 0, t, ph, d), col);
    }
    // --- rooftop clutter ---
    const spot = () => [x0 + 1.5 + r() * (w - 3), z0 + 1.5 + r() * (d - 3)];
    const nAc = Math.floor(r() * 4);
    for (let i = 0; i < nAc; i++) { const [x, z] = spot(); acs.add(mat(x, h, z, r() * 3), new THREE.Color().setHSL(0.1, 0.05, 0.55 + r() * 0.2)); }
    if (r() < 0.35 && !b.land) { const [x, z] = spot(); tanks.add(mat(x, h, z, 0), new THREE.Color(r() < 0.5 ? '#2a2b2c' : '#8d8a80')); }
    for (let i = 0; i < Math.floor(r() * 3); i++) { const [x, z] = spot(); antennas.add(mat(x, h, z, 0, 1, 2 + r() * 4, 1)); }
    if (dist === 'lakeside' && r() < 0.5) { const [x, z] = spot(); tarps.add(mat(x, h + 0.9, z, r() * 3, 3 + r() * 3, 1, 2.5 + r() * 2, (r() - 0.5) * 0.2, (r() - 0.5) * 0.2), new THREE.Color(r() < 0.7 ? '#2f6fb0' : '#6f8a4a')); }

    // --- ruined buildings: rubble at the base, rebar sticking out of the roof ---
    if (b.ruined) {
      for (let i = 0; i < 7; i++) {
        const side = Math.floor(r() * 4), along = r();
        const x = side < 2 ? x0 + along * w : side === 2 ? x0 - 0.8 : x0 + w + 0.8;
        const z = side >= 2 ? z0 + along * d : side === 0 ? z0 - 0.8 : z0 + d + 0.8;
        const s = 0.4 + r() * 1.1; rubble.add(mat(x, s * 0.3, z, r() * 6, s, s * 0.6, s, r(), r()));
      }
      for (let i = 0; i < 8; i++) { const [x, z] = spot(); rebar.add(mat(x, h, z, 0, 1, 0.8 + r() * 2.2, 1, (r() - 0.5) * 0.7, (r() - 0.5) * 0.7)); }
    }

    // --- facades: balconies, wall AC units, graffiti ---
    if (b.land) continue;
    const faces = [
      { nx: 0, nz: -1, ox: cx, oz: z0, len: w, ry: Math.PI },
      { nx: 0, nz: 1, ox: cx, oz: z0 + d, len: w, ry: 0 },
      { nx: -1, nz: 0, ox: x0, oz: cz, len: d, ry: -Math.PI / 2 },
      { nx: 1, nz: 0, ox: x0 + w, oz: cz, len: d, ry: Math.PI / 2 },
    ];
    const floors = Math.floor(h / 3.4);
    for (const f of faces) {
      const along = (u) => f.nx ? [f.ox, f.oz - f.len / 2 + u] : [f.ox - f.len / 2 + u, f.oz];
      // window columns in the facade shader repeat every 3.1 m in world space; line up with them
      const cols = [];
      const start = f.nx ? f.oz - f.len / 2 : f.ox - f.len / 2;
      for (let u = Math.ceil(start / 3.1) * 3.1 + 1.55 - start; u < f.len - 1.5; u += 3.1) if (u > 1.5) cols.push(u);
      const hasBalconies = floors >= 3 && r() < 0.35;
      for (let fl = 1; fl < floors; fl++) for (const u of cols) {
        const [x, z] = along(u);
        if (hasBalconies && r() < 0.45) balconies.add(mat(x, fl * 3.4, z, f.ry));
        else if (r() < 0.07) wallAc.add(mat(x + f.nx * 0.01, fl * 3.4 + 0.6, z + f.nz * 0.01, f.ry));
      }
      // graffiti on some street-level walls
      if (r() < 0.22 && f.len > 6) {
        const u = 2 + r() * (f.len - 4), [x, z] = along(u), s = 2.6 + r() * 2;
        graffiti.push({ x: x + f.nx * 0.04, z: z + f.nz * 0.04, ry: f.ry, s, tile: Math.floor(r() * 16) });
      }
    }
  }
  [parapets, acs, tanks, antennas, balconies, wallAc, rubble, rebar, tarps].forEach(c => c.build());

  // graffiti: one instanced quad, each instance picks its atlas tile in the shader
  const gMat = new THREE.MeshStandardMaterial({ map: gAtlas, transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  gMat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aTile;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = (uv + aTile) * 0.25;\n#endif');
  };
  const gGeo = new THREE.PlaneGeometry(1, 1);
  const tiles = new Float32Array(graffiti.length * 2);
  graffiti.forEach((g, i) => { tiles[i * 2] = g.tile % 4; tiles[i * 2 + 1] = 3 - Math.floor(g.tile / 4); });
  gGeo.setAttribute('aTile', new THREE.InstancedBufferAttribute(tiles, 2));
  const gMesh = new THREE.InstancedMesh(gGeo, gMat, graffiti.length);
  graffiti.forEach((g, i) => gMesh.setMatrixAt(i, mat(g.x, 1.1 + g.s * 0.35, g.z, g.ry, g.s, g.s * 0.8, 1)));
  gMesh.receiveShadow = true; group.add(gMesh);

  // ================= STREETS =================
  const lamps = new Chunked(group, lampGeo(), vc({ metalness: 0.6, roughness: 0.5 }), { lod: 2.5 });
  const poles = new Chunked(group, poleGeo(), vc(), { lod: 2.5 });
  const heads = [];                    // lamp heads (emissive), few hundred -> one mesh
  const wirePts = [];

  /** Walk along every road; cb gets metres (x, z), road direction angle and side (-1/1). */
  function alongRoads(spacing, offset, cb) {
    for (const v of ROADV) for (let mz = 30; mz < WORLD - 30; mz += spacing / S) {
      if (ROADH.some(h => Math.abs(mz - h) < 70)) continue;
      cb(v, mz, 0, offset);
    }
    for (const h of ROADH) for (let mx = 30; mx < WORLD - 30; mx += spacing / S) {
      if (ROADV.some(v => Math.abs(mx - v) < 70) || onBridgeOrRiver(mx)) continue;
      cb(mx, h, 1, offset);
    }
  }
  // Lamps on one side of every road, power poles on the other.
  const colonies = [P.home, P.elena, P.rhea, P.silas, P.station];
  let lastPole = new Map();
  alongRoads(26, 1, (mx, my, horiz, side) => {
    const ox = horiz ? 0 : side * 45, oy = horiz ? side * 45 : 0;
    const lx = mx + ox, ly = my + oy;
    if (inBuilding(lx, ly, 6)) return;
    const x = lx * S, z = ly * S, ry = horiz ? (side > 0 ? -Math.PI / 2 : Math.PI / 2) : (side > 0 ? Math.PI : 0);
    lamps.add(mat(x, 0, z, ry));
    box(x, 3.5, z, 0.15, 3.5, 0.15);
    // the head hangs at the end of the arm, over the road
    const hx = x + Math.cos(ry) * 1.7, hz = z - Math.sin(ry) * 1.7;
    const powered = colonies.some(c => Math.hypot(c.x - lx, c.y - ly) < 420);   // colony generators keep a few lamps alive
    heads.push({ x: hx, z: hz, powered });
    if (powered) pool.add(hx, 6.6, hz, '#ffcf8a', 30, 24, 'lamp');
  });
  alongRoads(34, -1, (mx, my, horiz, side) => {
    const ox = horiz ? 0 : side * 46, oy = horiz ? side * 46 : 0;
    const lx = mx + ox, ly = my + oy;
    if (inBuilding(lx, ly, 6)) return;
    const x = lx * S, z = ly * S, tilt = r() < 0.15 ? (r() - 0.5) * 0.25 : 0;
    const ry = horiz ? 0 : Math.PI / 2;
    poles.add(mat(x, 0, z, ry, 1, 1, 1, tilt));
    box(x, 4.6, z, 0.18, 4.6, 0.18);
    // wires to the previous pole on the same road line (sagging catenary)
    const key = horiz ? 'h' + my : 'v' + mx, prev = lastPole.get(key);
    if (prev && Math.hypot(prev.x - x, prev.z - z) < 40 && r() > 0.12) {       // ~12% of spans have snapped
      for (const off of [-1.05, 0, 1.05]) {
        const ax = prev.x + (horiz ? 0 : off), az = prev.z + (horiz ? off : 0), bx = x + (horiz ? 0 : off), bz = z + (horiz ? off : 0);
        const sag = 0.7 + r() * 0.5;
        for (let i = 0; i < 10; i++) {
          const t0 = i / 10, t1 = (i + 1) / 10, y0 = 8.9 - sag * 4 * t0 * (1 - t0), y1 = 8.9 - sag * 4 * t1 * (1 - t1);
          wirePts.push(ax + (bx - ax) * t0, y0, az + (bz - az) * t0, ax + (bx - ax) * t1, y1, az + (bz - az) * t1);
        }
      }
    }
    lastPole.set(key, { x, z });
  });
  lamps.build(); poles.build();
  const wireGeo = new THREE.BufferGeometry(); wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
  group.add(new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: '#141414' })));

  const headMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 0.18, 0.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 3) }), heads.length);   // HDR so working lamps bloom
  heads.forEach((h, i) => { headMesh.setMatrixAt(i, mat(h.x, 6.85, h.z)); headMesh.setColorAt(i, new THREE.Color(h.powered ? '#ffd9a0' : '#3a3c3e')); });
  group.add(headMesh);
  // Visible light beams under the working lamps (additive cones, faded in at night)
  const beamMat = new THREE.MeshBasicMaterial({ color: '#ffcf8a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const beamGeo = new THREE.ConeGeometry(3.2, 6.7, 24, 1, true).translate(0, -3.35, 0);
  {
    const vy = beamGeo.attributes.position, col = new Float32Array(vy.count * 3);
    for (let i = 0; i < vy.count; i++) { const k = Math.pow(1 + vy.getY(i) / 6.7, 1.6); col.set([k, k, k], i * 3); }   // brightest at the lamp
    beamGeo.setAttribute('color', new THREE.BufferAttribute(col, 3)); beamMat.vertexColors = true;
  }
  const lit = heads.filter(h => h.powered);
  const beams = new THREE.InstancedMesh(beamGeo, beamMat, Math.max(1, lit.length));
  lit.forEach((h, i) => beams.setMatrixAt(i, mat(h.x, 6.75, h.z)));
  beams.count = lit.length; beams.renderOrder = 2; group.add(beams);
  // Dust motes floating in the air around the camera (catch the light by day)
  const DUST = 700, dustPos = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) dustPos.set([(Math.random() - 0.5) * 30, Math.random() * 8, (Math.random() - 0.5) * 30], i * 3);
  const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({ color: '#fff3dc', size: 0.045, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
  const dust = new THREE.Points(dustGeo, dustMat); dust.frustumCulled = false; group.add(dust);
  const poweredHeads = heads.map((h, i) => [h, i]).filter(([h]) => h.powered)
    .map(([h, i]) => ({ i, src: pool.sources.find(s => Math.abs(s.pos.x - h.x) < 0.01 && Math.abs(s.pos.z - h.z) < 0.01) }));

  // Abandoned cars (some burnt out), in lanes and pushed onto kerbs
  const cars = new Chunked(group, carGeo(), vc({ roughness: 0.55, metalness: 0.35 }), { lod: 2.5 });
  const carCols = ['#7a4a32', '#5a6a70', '#8a8578', '#4a5a48', '#6e2e2a', '#9a8a60', '#3d4a5c', '#2a2a2a'];
  let placed = 0;
  alongRoads(18, 1, (mx, my, horiz) => {
    if (r() > 0.2 || placed > 60) return;
    const lane = (r() < 0.5 ? -1 : 1) * (12 + r() * 20);
    const lx = mx + (horiz ? (r() - 0.5) * 40 : lane), ly = my + (horiz ? lane : (r() - 0.5) * 40);
    if (inBuilding(lx, ly, 14) || (Math.abs(ly - 1200) < 60 && onBridgeOrRiver(lx))) return;
    const x = lx * S, z = ly * S, ry = (horiz ? 0 : Math.PI / 2) + (r() - 0.5) * 0.7 + (r() < 0.5 ? Math.PI : 0);
    const burnt = r() < 0.2;
    cars.add(mat(x, 0, z, ry), new THREE.Color(burnt ? '#1b1a19' : carCols[Math.floor(r() * carCols.length)]));
    box(x, 0.8, z, 2.1, 0.8, 0.92, ry);
    placed++;
  });
  cars.build();

  // Concrete barriers: checkpoints on the roads into the Dead Zone + scattered
  const barriers = new Chunked(group, barrierGeo(), vc(), { lod: 2 });
  const checkpoints = [[1650, 880], [2100, 880], [1650, 1520], [2100, 1520], [1300, 1200]];
  for (const [mx, my] of checkpoints) {
    const vertical = mx !== 1300;
    for (let k = -2; k <= 2; k++) {
      if (k === 0 && r() < 0.7) continue;                      // leave a gap to drive through
      const x = (mx + (vertical ? k * 16 : 0)) * S, z = (my + (vertical ? 0 : k * 16)) * S, ry = vertical ? 0 : Math.PI / 2;
      barriers.add(mat(x, 0, z, ry + (r() - 0.5) * 0.15), new THREE.Color('#9d9a92'));
      box(x, 0.5, z, 1.5, 0.5, 0.35, ry);
    }
  }
  barriers.build();

  // Trash bags & boxes along building bases (tiny: no shadows, short LOD)
  const bags = new Chunked(group, new THREE.IcosahedronGeometry(0.35, 1), new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.1, flatShading: true }), { lod: 0.55, shadow: false });
  const crates = new Chunked(group, new THREE.BoxGeometry(0.6, 0.45, 0.5).translate(0, 0.225, 0), new THREE.MeshStandardMaterial({ color: '#8a7050', roughness: 0.9 }), { lod: 0.55, shadow: false });
  for (const b of layout.buildings) {
    if (b.tank || b.crate || b.land) continue;
    const n = Math.floor(r() * 6);
    for (let i = 0; i < n; i++) {
      const side = Math.floor(r() * 4), u = r();
      const x = (side < 2 ? b.x + u * b.w : side === 2 ? b.x - 3 : b.x + b.w + 3) * S, z = (side >= 2 ? b.y + u * b.h : side === 0 ? b.y - 3 : b.y + b.h + 3) * S;
      if (r() < 0.7) bags.add(mat(x, 0.2, z, r() * 6, 0.8 + r() * 0.6, 0.6, 0.9), new THREE.Color(r() < 0.6 ? '#141617' : '#2b3a2a'));
      else crates.add(mat(x, 0, z, r() * 6, 0.8 + r() * 0.5), new THREE.Color().setHSL(0.08, 0.3, 0.3 + r() * 0.2));
    }
  }
  bags.build(); crates.build();

  // Paper sheets blowing in the wind (recycled around the camera)
  const paperMat = new THREE.MeshStandardMaterial({ color: '#d8d2c2', roughness: 0.9, side: THREE.DoubleSide });
  const papers = Array.from({ length: 26 }, () => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.22), paperMat); group.add(m);
    return { m, vx: 0, vz: 0, y: 0, spin: Math.random() * 6, life: 0 };
  });

  return {
    group,
    update(t, dt, camPos, wind = 1, night = 0) {
      beamMat.opacity = 0.06 * night;
      beams.visible = night > 0.05;
      // dust drifts with the wind and wraps around the camera
      const dp = dustGeo.attributes.position;
      for (let i = 0; i < DUST; i++) {
        let x = dp.getX(i) + (0.35 * wind + Math.sin(t * 0.5 + i) * 0.1) * dt, y = dp.getY(i) + Math.sin(t * 0.8 + i * 1.3) * 0.08 * dt, z = dp.getZ(i) + Math.cos(t * 0.4 + i) * 0.1 * dt;
        if (x - camPos.x > 15) x -= 30; if (x - camPos.x < -15) x += 30; if (z - camPos.z > 15) z -= 30; if (z - camPos.z < -15) z += 30;
        if (y < 0) y += 8; if (y > 8) y -= 8;
        dp.setXYZ(i, x, y, z);
      }
      dp.needsUpdate = true;
      dustMat.opacity = 0.25 + 0.35 * (1 - night);
      // lamp heads blink with their light (broken lamps flicker)
      for (const { i, src } of poweredHeads) if (src) headMesh.setColorAt(i, new THREE.Color(pool.flicker(src, t) > 0.5 ? '#ffd9a0' : '#4a4035'));
      if (headMesh.instanceColor) headMesh.instanceColor.needsUpdate = true;
      for (const p of papers) {
        p.life -= dt;
        if (p.life <= 0 || p.m.position.distanceTo(camPos) > 45) {
          const a = Math.random() * 6.28, d = 8 + Math.random() * 30;
          p.m.position.set(camPos.x + Math.cos(a) * d, 0.05, camPos.z + Math.sin(a) * d);
          p.life = 6 + Math.random() * 10; p.vx = 1.2 + Math.random(); p.vz = (Math.random() - 0.5) * 1.2;
        }
        const gust = (Math.sin(t * 0.7 + p.spin) * 0.5 + 0.7) * wind;
        p.m.position.x += p.vx * gust * dt; p.m.position.z += p.vz * gust * dt;
        p.m.position.y = 0.05 + Math.max(0, Math.sin(t * 2.3 + p.spin)) * 0.9 * gust;
        p.m.rotation.set(Math.sin(t * 3 + p.spin) * 1.2, t * 2 + p.spin, Math.cos(t * 2.4 + p.spin));
      }
    },
  };
}
