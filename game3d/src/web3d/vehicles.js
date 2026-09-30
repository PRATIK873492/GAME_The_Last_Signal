/* =====================================================================
   3D VEHICLES - jeep (SUV), pickup, bike, tanker, boat.
   Sizes come from the game's VEH table (length = w, width = h, in map
   px, x 0.2 m). Body colour = the car's colour in the simulation.

   Realism comes from three things:
     1. Silhouettes: each body is a side PROFILE (hood, windscreen rake,
        roof, tailgate) extruded across the width with rounded (bevelled)
        edges, instead of stacked boxes.
     2. Materials: clear-coat metallic paint that reflects the sky, dark
        tinted glass, rubber tyres, chrome / steel rims, black plastic
        trim, glowing lenses. A dusty, slightly rough coat fits the
        post-blackout city.
     3. Detail: wheel arches, bumpers, grille, head / tail lights, side
        mirrors, door seams, handles, roof rack + spare wheel (jeep),
        load bed (pickup), tank with end caps and walkway (tanker).
   Wrecks turn charred; wheels spin with speed; the escort jeep gets a
   mounted gun that follows the player's aim.
   ===================================================================== */
import * as THREE from 'three';

const box = new THREE.BoxGeometry(1, 1, 1);
const tyreGeo = (() => {                                       // rounded tyre: a lathed profile, axle along X
  const pts = [];
  for (let i = 0; i <= 12; i++) { const a = -Math.PI / 2 + (i / 12) * Math.PI; pts.push(new THREE.Vector2(0.78 + Math.cos(a) * 0.22, Math.sin(a) * 0.5)); }
  return new THREE.LatheGeometry(pts, 28).rotateZ(Math.PI / 2);
})();
const rimGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.8, 24).rotateZ(Math.PI / 2);
const hubGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.9, 12).rotateZ(Math.PI / 2);
const lensGeo = new THREE.SphereGeometry(0.5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(Math.PI / 2);

const glass = new THREE.MeshPhysicalMaterial({ color: '#0e1417', roughness: 0.05, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02, reflectivity: 1 });
const tyre = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.92 });
const rimMat = new THREE.MeshStandardMaterial({ color: '#9aa0a4', roughness: 0.25, metalness: 0.95 });
const trim = new THREE.MeshStandardMaterial({ color: '#1c1d1f', roughness: 0.6, metalness: 0.1 });
const chrome = new THREE.MeshStandardMaterial({ color: '#d8dadc', roughness: 0.12, metalness: 1 });
const charred = new THREE.MeshStandardMaterial({ color: '#141312', roughness: 1 });
const lampMat = new THREE.MeshStandardMaterial({ color: '#fff6dc', emissive: new THREE.Color('#fff1c8'), emissiveIntensity: 2.2, roughness: 0.1 });
const tailMat = new THREE.MeshStandardMaterial({ color: '#7a0f0a', emissive: new THREE.Color('#ff2a1a'), emissiveIntensity: 1.4, roughness: 0.2 });
const steel = new THREE.MeshStandardMaterial({ color: '#c8c2b6', roughness: 0.35, metalness: 0.55 });
const archMat = new THREE.MeshStandardMaterial({ color: '#0d0d0e', roughness: 0.95, side: THREE.BackSide });

const paintCache = new Map();
function paintFor(color) {
  if (!paintCache.has(color)) paintCache.set(color, new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.42, clearcoat: 0.8, clearcoatRoughness: 0.25 }));   // dusty clear-coat
  return paintCache.get(color);
}

/** Extrude a side profile [[z, y], ...] (z along the car, y up) across width W with rounded edges. */
function profileBody(points, W, bevel = 0.08) {
  const sh = new THREE.Shape(); points.forEach(([z, y], i) => (i ? sh.lineTo(z, y) : sh.moveTo(z, y)));
  const depth = Math.max(0.1, W - bevel * 2);
  const geo = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 4 });
  geo.translate(0, 0, -depth / 2).rotateY(-Math.PI / 2);         // shape X -> car length (+Z), extrusion -> width (X)
  geo.computeVertexNormals();
  return geo;
}

/** L = length (m), W = width (m). Model faces +z. */
export function buildVehicle(type, L, W, color) {
  const g = new THREE.Group(), paint = paintFor(color);
  const parts = [], wheels = [];
  const mesh = (geo, m, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => { const o = new THREE.Mesh(geo, m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; g.add(o); if (m === paint) parts.push(o); return o; };
  const add = (m, sx, sy, sz, x, y, z) => mesh(box, m, x, y, z, sx, sy, sz);
  const wheel = (x, z, r, w) => {
    const wg = new THREE.Group(); wg.position.set(x, r, z); g.add(wg); wheels.push(wg);
    const t = new THREE.Mesh(tyreGeo, tyre); t.scale.set(w / 1, r, r); t.castShadow = true; wg.add(t);
    const rim = new THREE.Mesh(rimGeo, rimMat); rim.scale.set(w * 0.9, r, r); wg.add(rim);
    const hub = new THREE.Mesh(hubGeo, chrome); hub.scale.set(w, r, r); wg.add(hub);
    for (let i = 0; i < 5; i++) { const s = new THREE.Mesh(box, rimMat); s.scale.set(w * 0.95, r * 0.1, r * 0.95); s.rotation.x = (i / 5) * Math.PI; wg.add(s); }   // spokes
    const arch = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.18, r * 1.18, w * 1.1, 20, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2), archMat); arch.position.set(x * 0.98, r, z); g.add(arch);
  };
  const lights = (zf, zr, y, spread, wide = 0.26) => {
    for (const s of [-1, 1]) {
      mesh(lensGeo, lampMat, s * spread, y, zf, wide, 0.16, 0.08);                          // headlight lens
      add(chrome, wide + 0.04, 0.2, 0.03, s * spread, y, zf - 0.02);                        // bezel
      add(tailMat, wide * 0.8, 0.14, 0.04, s * spread, y + 0.05, zr);                       // tail light
    }
  };
  const mirrors = (z, y, half) => { for (const s of [-1, 1]) { add(trim, 0.04, 0.03, 0.1, s * (half + 0.06), y - 0.05, z); add(paint, 0.1, 0.12, 0.16, s * (half + 0.14), y, z); } };

  if (type === 'bike') {
    const r = 0.34;
    wheel(0, L * 0.34, r, 0.14); wheel(0, -L * 0.34, r, 0.16);
    mesh(profileBody([[-L * 0.3, 0.55], [-L * 0.05, 0.62], [L * 0.1, 0.95], [L * 0.28, 1.0], [L * 0.2, 0.7], [-L * 0.1, 0.5]], 0.28, 0.05), paint);   // tank + frame
    add(trim, 0.26, 0.1, L * 0.3, 0, 0.92, -L * 0.1);                                        // seat
    add(chrome, 0.06, 0.06, L * 0.35, 0.14, 0.42, -L * 0.15);                                // exhaust
    add(chrome, 0.7, 0.04, 0.04, 0, 1.12, L * 0.3);                                           // handlebar
    add(chrome, 0.04, 0.5, 0.04, 0, 0.8, L * 0.34);                                           // fork
    mesh(lensGeo, lampMat, 0, 1.0, L * 0.37, 0.16, 0.16, 0.08);
    add(tailMat, 0.14, 0.06, 0.03, 0, 0.9, -L * 0.37);
  } else if (type === 'boat') {
    mesh(profileBody([[-L / 2, 0.1], [-L / 2, 0.85], [L * 0.2, 0.9], [L / 2, 1.05], [L * 0.3, 0.2], [-L * 0.4, 0]], W * 0.9, 0.2), paint);   // hull
    add(new THREE.MeshStandardMaterial({ color: '#e8e4da', roughness: 0.6 }), W * 0.55, 0.7, L * 0.22, 0, 1.25, -L * 0.08);           // cabin
    add(glass, W * 0.5, 0.35, 0.04, 0, 1.4, L * 0.035);
    add(chrome, W * 0.8, 0.04, 0.04, 0, 1.2, L * 0.3);                                        // bow rail
    add(trim, 0.3, 0.5, 0.3, 0, 0.9, -L / 2 - 0.1);                                           // outboard motor
  } else {
    const r = type === 'tanker' ? 0.5 : 0.44;                                                 // wheel radius
    const half = W * 0.43, bw = half * 2;                                                     // body width
    const zF = L / 2, zR = -L / 2, base = r * 0.75;
    if (type === 'jeep') {
      // boxy off-roader: short hood, upright windscreen, long roof, flat tailgate
      mesh(profileBody([[zR, base], [zR, 1.05], [zR + 0.08, 1.85], [L * 0.1, 1.9], [L * 0.2, 1.25], [zF - 0.05, 1.12], [zF, 0.95], [zF, base]], bw), paint);
      add(trim, bw + 0.02, 0.12, 0.02, 0, base + 0.02, 0);                                   // rocker / sill shadow line
      for (const s of [-1, 1]) {                                                               // side windows
        mesh(profileBody([[zR + 0.25, 1.28], [zR + 0.3, 1.78], [L * 0.08, 1.82], [L * 0.17, 1.3]], 0.02, 0.005), glass, s * (half + 0.01));
        add(trim, 0.02, 0.62, 0.05, s * (half + 0.02), 1.5, -L * 0.1);                         // B-pillar
        add(trim, 0.015, 0.55, 0.012, s * (half + 0.015), 0.95, L * 0.05);                    // door seams
        add(trim, 0.015, 0.55, 0.012, s * (half + 0.015), 0.95, -L * 0.25);
        add(chrome, 0.03, 0.03, 0.14, s * (half + 0.03), 1.12, -L * 0.02);                    // door handle
      }
      mesh(new THREE.PlaneGeometry(1, 1), glass, 0, 1.56, L * 0.155, bw * 0.92, 0.66, 1).rotation.x = -0.4;   // windscreen
      add(trim, bw * 0.9, 0.06, 0.9, 0, 1.97, -L * 0.12);                                      // roof rack
      for (const s of [-1, 1]) add(trim, 0.05, 0.1, L * 0.55, s * half * 0.85, 1.93, -L * 0.1);
      const spare = new THREE.Group(); spare.position.set(0, 1.05, zR - 0.18); g.add(spare);   // spare wheel on the tailgate
      const st = new THREE.Mesh(tyreGeo, tyre); st.scale.set(0.26, 0.4, 0.4); st.rotation.y = Math.PI / 2; spare.add(st);
      mirrors(L * 0.18, 1.3, half);
    } else if (type === 'pickup') {
      // cab forward, open load bed at the back
      mesh(profileBody([[zR, base], [zR, 1.12], [-L * 0.05, 1.12], [-L * 0.05, 1.85], [L * 0.12, 1.88], [L * 0.24, 1.3], [zF - 0.05, 1.15], [zF, 0.95], [zF, base]], bw), paint);
      add(trim, bw - 0.12, 0.05, L * 0.42, 0, 1.0, -L * 0.27);                                 // bed floor (dark, recessed)
      add(trim, bw - 0.12, 0.3, 0.05, 0, 0.98, -L * 0.055);                                    // bed front wall shadow
      for (const s of [-1, 1]) {
        mesh(profileBody([[-L * 0.03, 1.3], [-L * 0.03, 1.78], [L * 0.1, 1.8], [L * 0.2, 1.32]], 0.02, 0.005), glass, s * (half + 0.01));
        add(trim, 0.015, 0.55, 0.012, s * (half + 0.015), 0.95, L * 0.12);
        add(chrome, 0.03, 0.03, 0.14, s * (half + 0.03), 1.1, L * 0.02);
      }
      mesh(new THREE.PlaneGeometry(1, 1), glass, 0, 1.58, L * 0.185, bw * 0.92, 0.62, 1).rotation.x = -0.55;
      add(glass, bw * 0.8, 0.4, 0.02, 0, 1.55, -L * 0.055);                                    // rear cab window
      mirrors(L * 0.2, 1.32, half);
    } else {                                                                                   // tanker: cab + chassis + tank
      const cabL = L * 0.26;
      mesh(profileBody([[zF - cabL, base], [zF - cabL, 2.45], [zF - 0.35, 2.5], [zF - 0.05, 1.7], [zF, 1.2], [zF, base]], bw), paint);
      add(trim, bw * 0.7, 0.3, L - cabL, 0, base + 0.15, -cabL / 2);                           // chassis rails
      const tank = mesh(new THREE.CylinderGeometry(half * 1.02, half * 1.02, L * 0.66, 32).rotateX(Math.PI / 2), steel, 0, base + 0.3 + half, -L * 0.14);
      for (const s of [-1, 1]) mesh(new THREE.SphereGeometry(half * 1.02, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(s * Math.PI / 2), steel, 0, tank.position.y, -L * 0.14 + s * L * 0.33, 1, 1, 0.35);   // domed end caps
      const band = new THREE.TorusGeometry(half * 1.03, 0.035, 6, 32);
      for (let i = -2; i <= 2; i++) mesh(band, trim, 0, tank.position.y, -L * 0.14 + i * L * 0.12);   // tank bands
      add(trim, 0.6, 0.05, L * 0.6, 0, tank.position.y + half + 0.03, -L * 0.14);             // walkway
      for (const s of [-1, 1]) {
        mesh(profileBody([[zF - cabL + 0.25, 1.65], [zF - cabL + 0.25, 2.3], [zF - 0.4, 2.33], [zF - 0.2, 1.75]], 0.02, 0.005), glass, s * (half + 0.01));
        add(chrome, 0.1, 0.6, 0.08, s * (half + 0.05), 2.5, zF - cabL + 0.1);                  // exhaust stacks
      }
      mesh(new THREE.PlaneGeometry(1, 1), glass, 0, 2.05, zF - 0.2, bw * 0.9, 0.75, 1).rotation.x = -0.35;
      mirrors(zF - 0.3, 2.0, half);
    }
    // front & rear: bumpers, grille, lights, plates
    add(trim, bw + 0.08, 0.28, 0.22, 0, base + 0.12, zF + 0.04);                               // front bumper
    add(trim, bw + 0.08, 0.28, 0.2, 0, base + 0.12, zR - 0.04);                                // rear bumper
    add(trim, bw * 0.5, 0.32, 0.03, 0, base + 0.5, zF + 0.01);                                 // grille
    for (let i = 0; i < 5; i++) add(chrome, bw * 0.48, 0.018, 0.035, 0, base + 0.38 + i * 0.06, zF + 0.02);
    add(new THREE.MeshStandardMaterial({ color: '#e8e2c8', roughness: 0.5 }), 0.45, 0.13, 0.02, 0, base + 0.3, zR - 0.15);   // number plate
    lights(zF + 0.01, zR - 0.01, base + 0.55, half * 0.72);
    const wz = type === 'tanker' ? [L * 0.33, -L * 0.15, -L * 0.33] : [L * 0.32, -L * 0.3];
    for (const zz of wz) for (const s of [-1, 1]) wheel(s * (half - 0.08), zz, r, 0.34);
  }
  const gun = new THREE.Group(); gun.visible = false; g.add(gun);                    // mounted turret (escort jeep)
  const gunMesh = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color: '#2a2d2f', metalness: 0.7, roughness: 0.4 })); gunMesh.scale.set(0.12, 0.12, 1.3); gunMesh.position.set(0, 0, 0.55); gun.add(gunMesh);
  gun.position.set(0, 2.2, -L * 0.1);
  return { g, paint, parts, wheels, gun, wrecked: false, spin: 0 };
}

export function wreckVehicle(v) {
  if (v.wrecked) return; v.wrecked = true;
  for (const p of v.parts) p.material = charred;
}
