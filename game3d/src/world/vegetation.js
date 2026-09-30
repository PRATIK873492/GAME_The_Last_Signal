/* =====================================================================
   VEGETATION - nature taking the city back
     grass & weeds : crossed cards with a generated blade texture, pushed
                     around by wind in the vertex shader (the tip moves,
                     the root stays planted: offset * uv.y)
     trees         : low-poly trunk + canopy clumps on rubble lots, plazas
                     and ~12% of rooftops (overgrown buildings)
     vines         : alpha-cut ivy sheets climbing street-facing walls
   Counts scale with the graphics preset; all instanced and chunked.
   ===================================================================== */
import * as THREE from 'three';
import { MAP_TO_M as S, RIVER, ROADV, ROADH, mulberry } from '../core/worldLayout.js';
import { part, merge, mat, Chunked, canvasTex } from './kit.js';

export const windUniform = { value: 0 };           // shared time uniform (seconds)

/** Patch any standard material so vertices sway with height (uv.y or local y). */
function addWind(material, strength, useUvY = true) {
  material.onBeforeCompile = sh => {
    sh.uniforms.uWindTime = windUniform;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wWorld = instanceMatrix * vec4(position, 1.0);
        float wH = ${useUvY ? 'uv.y' : 'clamp(position.y / 6.0, 0.0, 1.0)'};
        float wPhase = uWindTime * 1.6 + wWorld.x * 0.35 + wWorld.z * 0.21;
        transformed.x += (sin(wPhase) + 0.4 * sin(wPhase * 2.7)) * ${strength.toFixed(3)} * wH * wH;
        transformed.z += cos(wPhase * 0.8) * ${(strength * 0.6).toFixed(3)} * wH * wH;`);
  };
  return material;
}

function grassTexture() {
  return canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const r = mulberry(12);
    for (let i = 0; i < 70; i++) {
      const x = 20 + r() * (w - 40), top = h * (0.05 + r() * 0.55), lean = (r() - 0.5) * 60;
      const hue = 60 + r() * 45, light = 22 + r() * 22, sat = 25 + r() * 30;
      g.strokeStyle = `hsl(${hue},${sat}%,${light}%)`; g.lineWidth = 3 + r() * 5; g.lineCap = 'round';
      g.beginPath(); g.moveTo(x, h); g.quadraticCurveTo(x + lean * 0.3, (h + top) / 2, x + lean, top); g.stroke();
      if (r() < 0.12) { g.fillStyle = `hsl(${40 + r() * 20},60%,55%)`; g.beginPath(); g.arc(x + lean, top, 5, 0, 6.28); g.fill(); }   // weed flowers
    }
  });
}
function vineTexture() {
  return canvasTex(256, 512, (g, w, h) => {
    const r = mulberry(31);
    g.clearRect(0, 0, w, h);
    for (let s = 0; s < 7; s++) {
      let x = 30 + r() * (w - 60), y = h;
      g.strokeStyle = '#3c3a24'; g.lineWidth = 3;
      for (let k = 0; k < 40 && y > 0; k++) {
        const nx = x + (r() - 0.5) * 30, ny = y - 8 - r() * 16;
        g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
        for (let l = 0; l < 3; l++) {                 // leaves
          g.fillStyle = `hsl(${85 + r() * 40},${35 + r() * 25}%,${18 + r() * 18}%)`;
          g.beginPath(); g.ellipse(nx + (r() - 0.5) * 22, ny + (r() - 0.5) * 16, 6 + r() * 5, 4 + r() * 3, r() * 3, 0, 6.28); g.fill();
        }
        x = nx; y = ny;
      }
    }
  });
}
function treeGeo() {
  const g = ['#3d5a2a', '#4a6b32', '#35502a'];
  return merge([
    part(new THREE.CylinderGeometry(0.12, 0.22, 3.2, 6), '#4a3a2a', 0, 1.6, 0),
    part(new THREE.IcosahedronGeometry(1.6, 0), g[0], 0, 3.6, 0),
    part(new THREE.IcosahedronGeometry(1.2, 0), g[1], 0.9, 3.1, 0.4),
    part(new THREE.IcosahedronGeometry(1.1, 0), g[2], -0.7, 3.3, -0.6),
    part(new THREE.IcosahedronGeometry(0.9, 0), g[1], 0.1, 4.6, 0.2),
  ]);
}

export function buildVegetation(scene, layout, preset, box) {
  const group = new THREE.Group(); scene.add(group);
  const r = mulberry(808);

  // ---------- grass & weeds ----------
  const card = new THREE.PlaneGeometry(1, 0.8).translate(0, 0.4, 0);
  const grassGeo = merge([card.clone(), card.clone().rotateY(Math.PI / 2)].map(g => { g.deleteAttribute('color'); return g; }));
  const grassMat = addWind(new THREE.MeshStandardMaterial({ map: grassTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1 }), 0.14);
  const grass = new Chunked(group, grassGeo, grassMat, { lod: 0.9, shadow: false });
  const plant = (x, z, s = 1) => grass.add(mat(x, 0, z, r() * 3.14, s * (0.6 + r() * 0.9), s * (0.5 + r() * 1.0), s * (0.6 + r() * 0.9)),
    new THREE.Color().setHSL(0.18 + r() * 0.06, 0.25, 0.55 + r() * 0.3));

  const N = preset.grass;
  const perBuilding = Math.floor(N * 0.55 / layout.buildings.length);
  for (const b of layout.buildings) {                  // tufts hugging building bases
    if (b.tank || b.crate) continue;
    for (let i = 0; i < perBuilding; i++) {
      const side = Math.floor(r() * 4), u = r(), off = 1 + r() * 5;
      const mx = side < 2 ? b.x + u * b.w : side === 2 ? b.x - off : b.x + b.w + off;
      const my = side >= 2 ? b.y + u * b.h : side === 0 ? b.y - off : b.y + b.h + off;
      plant(mx * S, my * S);
    }
  }
  for (const p of layout.props) {                      // rubble lots: dense and tall
    const n = Math.floor(N * 0.3 / Math.max(1, layout.props.length));
    for (let i = 0; i < n; i++) plant((p.x + r() * p.w) * S, (p.y + r() * p.h) * S, 1.5);
  }
  const roadEdge = N * 0.15;                           // weeds pushing through the kerbs
  for (let i = 0; i < roadEdge; i++) {
    if (r() < 0.5) { const v = ROADV[Math.floor(r() * 4)]; plant((v + (r() < .5 ? -1 : 1) * (38 + r() * 6)) * S, r() * 2400 * S, 0.8); }
    else { const h = ROADH[Math.floor(r() * 5)], mx = r() * 2400; if (mx > RIVER.x - 20 && mx < RIVER.x + RIVER.w + 20) continue; plant(mx * S, (h + (r() < .5 ? -1 : 1) * (38 + r() * 6)) * S, 0.8); }
  }
  grass.build();

  // ---------- trees ----------
  const treeMat = addWind(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), 0.12, false);
  const trees = new Chunked(group, treeGeo(), treeMat, { lod: 3 });
  const treeCol = () => new THREE.Color().setHSL(0.22 + r() * 0.06, 0.25 + r() * 0.2, 0.75 + r() * 0.25);
  for (const p of layout.props) for (let i = 0; i < 2 + Math.floor(r() * 3); i++) {
    const x = (p.x + 10 + r() * (p.w - 20)) * S, z = (p.y + 10 + r() * (p.h - 20)) * S, s = 1 + r() * 1.2;
    trees.add(mat(x, 0, z, r() * 6, s), treeCol());
    box(x, 1.6 * s, z, 0.25 * s, 1.6 * s, 0.25 * s);
  }
  for (const b of layout.buildings) {                  // overgrown rooftops
    if (!b.h3 || b.land || b.stall || b.crate || b.tank || r() > 0.12) continue;
    for (let i = 0; i < 1 + Math.floor(r() * 3); i++) trees.add(mat((b.x + 8 + r() * (b.w - 16)) * S, b.h3, (b.y + 8 + r() * (b.h - 16)) * S, r() * 6, 0.6 + r() * 0.6), treeCol());
  }
  trees.build();

  // ---------- vines on walls ----------
  const vineMat = new THREE.MeshStandardMaterial({ map: vineTexture(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.95 });
  const vines = new Chunked(group, new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), vineMat, { lod: 1.5, shadow: false });
  for (const b of layout.buildings) {
    if (!b.h3 || b.land || b.stall || b.crate || b.tank || r() > 0.35) continue;
    const side = Math.floor(r() * 4), w = 2.5 + r() * 4, h = Math.min(b.h3, 4 + r() * 10);
    const faces = [[b.x + r() * b.w, b.y, Math.PI], [b.x + r() * b.w, b.y + b.h, 0], [b.x, b.y + r() * b.h, -Math.PI / 2], [b.x + b.w, b.y + r() * b.h, Math.PI / 2]];
    const [mx, my, ry] = faces[side];
    const nx = Math.sin(ry) * 0.05, nz = Math.cos(ry) * 0.05;
    vines.add(mat(mx * S + nx, 0, my * S + nz, ry, w, h, 1), new THREE.Color().setHSL(0.25, 0.2, 0.7 + r() * 0.3));
  }
  vines.build();

  return { group };
}
