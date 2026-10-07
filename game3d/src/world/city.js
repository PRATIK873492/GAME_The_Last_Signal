/* =====================================================================
   CITY BUILDER  - turns the 2D layout (map px) into 3D geometry (metres)
   Returns the scene objects AND a list of collider boxes, so physics is
   built from exactly the same data as the visuals (one source of truth).
   ===================================================================== */
import * as THREE from 'three';
import { createWater } from './water.js';
import { wetU } from './weather.js';

// ---------------------------------------------------------------------
// Photographed PBR texture sets (ambientCG, CC0) in web/engine/assets/tex.
// Each shader samples them in WORLD space (no UVs needed), so every wall
// and street of any size tiles correctly. Until a file arrives, a neutral
// 1x1 map stands in, so the game never waits on a download.
// ---------------------------------------------------------------------
const texLoader = new THREE.TextureLoader();
const neutral = (r, g, b) => { const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1); t.needsUpdate = true; return t; };
function pbrSet(name) {
  const set = { color: { value: neutral(128, 128, 128) }, normal: { value: neutral(128, 128, 255) }, rough: { value: neutral(220, 220, 220) } };
  for (const [k, file, srgb] of [['color', 'color', true], ['normal', 'normal', false], ['rough', 'roughness', false]]) {
    texLoader.load(new URL('assets/tex/' + name + '_' + file + '.jpg', import.meta.url).href, t => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      set[k].value = t;
    }, undefined, () => { /* missing file: keep the neutral map */ });
  }
  return set;
}
export const TEX = { asphalt: pbrSet('asphalt'), brick: pbrSet('brick'), concrete: pbrSet('concrete'), plaster: pbrSet('plaster') };
const texUniforms = sh => {
  for (const [n, set] of Object.entries(TEX)) { sh.uniforms[`t_${n}C`] = set.color; sh.uniforms[`t_${n}N`] = set.normal; sh.uniforms[`t_${n}R`] = set.rough; }
};
const TEX_DECL = Object.keys({ asphalt: 1, brick: 1, concrete: 1, plaster: 1 }).map(n => `uniform sampler2D t_${n}C, t_${n}N, t_${n}R;`).join('\n');
import { MAP_TO_M as S, WORLD, RIVER, BRIDGE, ROADV, ROADH, RW, DISTRICTS, SPECIAL, DOCKS, mulberry } from '../core/worldLayout.js';

export const RIVER_BED = -3.2, WATER_Y = -1.3;

/** Paints districts, roads and markings onto a canvas (used for the 3D ground AND the minimap). */
export function paintGround(layout, size = 2048, lift = 0) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); g.scale(size / WORLD, size / WORLD);
  for (const d of DISTRICTS) { g.fillStyle = d.tint; g.fillRect(d.x, d.y, d.w, d.h); }
  const r = mulberry(7);
  // dirt / stains break up the flat colour
  for (let i = 0; i < 3500; i++) { g.fillStyle = `rgba(${r() < .5 ? '255,255,255' : '0,0,0'},${0.02 + r() * 0.04})`; g.fillRect(r() * WORLD, r() * WORLD, 4 + r() * 34, 4 + r() * 34); }
  for (const p of layout.props) { g.fillStyle = '#26211d'; g.fillRect(p.x, p.y, p.w, p.h); for (let k = 0; k < 18; k++) { g.fillStyle = `rgba(95,85,72,${0.3 + r() * .4})`; g.fillRect(p.x + r() * p.w, p.y + r() * p.h, 6 + r() * 16, 5 + r() * 10); } }
  // roads (asphalt)
  g.fillStyle = '#26292b';
  for (const x of ROADV) g.fillRect(x - RW / 2, 0, RW, WORLD);
  for (const y of ROADH) {
    if (y === 1200) g.fillRect(0, y - RW / 2, WORLD, RW);
    else { g.fillRect(0, y - RW / 2, RIVER.x, RW); g.fillRect(RIVER.x + RIVER.w, y - RW / 2, WORLD, RW); }
  }
  // sidewalks edge lines
  g.strokeStyle = 'rgba(120,120,110,.35)'; g.lineWidth = 3;
  for (const x of ROADV) for (const s of [-1, 1]) { g.beginPath(); g.moveTo(x + s * RW / 2, 0); g.lineTo(x + s * RW / 2, WORLD); g.stroke(); }
  for (const y of ROADH) for (const s of [-1, 1]) { g.beginPath(); g.moveTo(0, y + s * RW / 2); g.lineTo(WORLD, y + s * RW / 2); g.stroke(); }
  // lane markings
  g.strokeStyle = 'rgba(215,195,120,.45)'; g.lineWidth = 2.5; g.setLineDash([22, 26]);
  for (const x of ROADV) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, WORLD); g.stroke(); }
  for (const y of ROADH) { g.beginPath(); g.moveTo(0, y); g.lineTo(WORLD, y); g.stroke(); }
  g.setLineDash([]);
  // potholes & oil stains on the asphalt (only where there is road)
  const onRoad = (x, y) => ROADV.some(v => Math.abs(x - v) < RW / 2 - 4) || ROADH.some(h => Math.abs(y - h) < RW / 2 - 4 && (h === 1200 || x < RIVER.x || x > RIVER.x + RIVER.w));
  for (let i = 0; i < 2600; i++) {
    const x = r() * WORLD, y = r() * WORLD; if (!onRoad(x, y)) continue;
    const big = r() < 0.3, rx = big ? 2.5 + r() * 3.5 : 1.5 + r() * 2.5, ry = rx * (0.5 + r() * 0.6);   // 0.5-1.2 m potholes
    g.fillStyle = big ? 'rgba(20,18,16,.5)' : 'rgba(0,0,0,.22)';
    g.beginPath(); g.ellipse(x, y, rx, ry, r() * 3, 0, 6.2832); g.fill();
    if (big) { g.strokeStyle = 'rgba(90,85,78,.5)'; g.lineWidth = 1; g.stroke(); }
  }
  // cracks
  g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1.5;
  for (let i = 0; i < 400; i++) { let x = r() * WORLD, y = r() * WORLD; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (r() - .5) * 50; y += (r() - .5) * 50; g.lineTo(x, y); } g.stroke(); }
  // plazas & docks
  g.fillStyle = '#2d302e';
  for (const s of SPECIAL) g.fillRect(s.x0 + RW / 2 + 4, s.y0 + RW / 2 + 4, s.x1 - s.x0 - RW - 8, s.y1 - s.y0 - RW - 8);
  g.fillStyle = '#4a3b2b'; g.fillRect(DOCKS.x, DOCKS.y, DOCKS.w, DOCKS.h);
  g.strokeStyle = '#2e251b'; g.lineWidth = 2;
  for (let x = DOCKS.x; x < DOCKS.x + DOCKS.w; x += 12) { g.beginPath(); g.moveTo(x, DOCKS.y); g.lineTo(x, DOCKS.y + DOCKS.h); g.stroke(); }
  // The 2D palette is tuned for a dark top-down look; lit 3D surfaces need more albedo.
  if (lift) { g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'screen'; g.fillStyle = `rgb(${lift},${lift},${lift - 4})`; g.fillRect(0, 0, size, size); g.globalCompositeOperation = 'source-over'; }
  return c;
}

/** Wall colour palette: plaster, concrete, brick, painted blocks. */
const WALLS = ['#8a857b', '#77746d', '#6f5a4a', '#8c6f58', '#6b7270', '#9a9384', '#5f6a6e', '#7d6b5d'];

/**
 * Building material: standard PBR + a small shader patch that paints
 * window grids, floor bands and ground-level grime from WORLD position.
 * Because it is procedural, every building (any size) gets correct windows
 * with one material and one draw call (InstancedMesh).
 */
export function facadeMaterial() {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0.0 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uWet = wetU; texUniforms(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLsPos; varying vec3 vLsNrm; varying vec3 vLsBld;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 lsW = vec4(transformed, 1.0);
        vec3 lsN = objectNormal;
        #ifdef USE_INSTANCING
          lsW = instanceMatrix * lsW; lsN = mat3(instanceMatrix) * lsN;
        #endif
        vLsPos = (modelMatrix * lsW).xyz; vLsNrm = normalize(lsN);
        vLsBld = vec3(0.0);
        #ifdef USE_INSTANCING
          vLsBld = instanceMatrix[3].xyz;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLsPos; varying vec3 vLsNrm; varying vec3 vLsBld; uniform float uWet;
        ${TEX_DECL}
        vec3 lsNm;     // tangent-space normal from the photographed texture (0,0,1 = flat)
        vec3 lsT;      // world tangent of the wall (horizontal, along u)
        float lsRo;    // roughness from the texture
        float lsHgt;   // surface relief (0 = wall face, negative = grooves / recesses), turned into a bumped normal below
        float fHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float fNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(fHash(i), fHash(i + vec2(1, 0)), f.x), mix(fHash(i + vec2(0, 1)), fHash(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float lsWin = 0.0; lsHgt = 0.0;
        diffuseColor.rgb *= mix(1.0, 0.72, uWet);                        // rain-soaked walls go darker
        // ---- wall MATERIAL per building: photographed brick, concrete or painted plaster ----
        float bType = fract(sin(dot(floor(vLsBld.xz), vec2(17.13, 91.7))) * 4375.85);
        lsNm = vec3(0.0, 0.0, 1.0); lsRo = -1.0; lsT = vec3(1.0, 0.0, 0.0);
        {
          vec3 wn = normalize(vLsNrm);
          vec3 tint = diffuseColor.rgb / max(dot(diffuseColor.rgb, vec3(0.3333)), 0.02);   // the building's palette HUE, brightness 1.0
          if (abs(wn.y) < 0.5) {
            lsT = normalize(cross(vec3(0.0, 1.0, 0.0), wn));
            float wu = dot(vLsPos, lsT), wy = vLsPos.y;
            float abs_u = abs(wn.x) > 0.5 ? vLsPos.z : vLsPos.x;
            if (bType < 0.42) {
              vec2 uv = vec2(wu, wy) / 1.6;                                   // ~1.6 m per brick tile
              diffuseColor.rgb = texture2D(t_brickC, uv).rgb * mix(vec3(1.0), tint, 0.15) * 1.5;
              lsNm = texture2D(t_brickN, uv).xyz * 2.0 - 1.0; lsRo = texture2D(t_brickR, uv).r;
            } else if (bType < 0.75) {
              vec2 uv = vec2(wu, wy) / 3.0;
              vec3 c = texture2D(t_concreteC, uv).rgb;
              vec2 pf = fract(vec2(wu / 3.1, wy / 3.4));
              float seam = 1.0 - step(0.012, pf.x) * step(pf.x, 0.988) * step(0.012, pf.y) * step(pf.y, 0.988);
              diffuseColor.rgb = c * mix(vec3(1.0), tint, 0.35) * 0.6 * (1.0 - 0.45 * seam);
              lsNm = texture2D(t_concreteN, uv).xyz * 2.0 - 1.0; lsRo = texture2D(t_concreteR, uv).r;
              lsHgt = -seam * 0.9;
            } else {
              vec2 uv = vec2(wu, wy) / 2.4;
              float spall = smoothstep(0.66, 0.68, fNoise(vec2(wu, wy) * 0.8 + bType * 30.0) + 0.12 * fNoise(vec2(wu, wy) * 12.0));
              vec2 buv = vec2(wu, wy) / 1.6;
              diffuseColor.rgb = mix(texture2D(t_plasterC, uv).rgb * mix(vec3(1.0), tint, 0.6) * 0.6, texture2D(t_brickC, buv).rgb * 1.5, spall);
              lsNm = mix(texture2D(t_plasterN, uv).xyz, texture2D(t_brickN, buv).xyz, spall) * 2.0 - 1.0;
              lsRo = mix(texture2D(t_plasterR, uv).r, texture2D(t_brickR, buv).r, spall);
              lsHgt = -spall * 0.5;
            }
            // ---- GRAFFITI: spray-paint tags (squiggly iso-lines of noise) on about half the ground floors ----
            if (wy < 2.6 && fract(bType * 7.7) < 0.5) {
              float seg = floor(wu / 5.0), on = step(0.35, fHash(vec2(seg, bType)));
              float box = smoothstep(0.4, 0.9, wy) * smoothstep(2.4, 1.9, wy) * smoothstep(0.0, 0.6, fract(wu / 5.0)) * smoothstep(1.0, 0.75, fract(wu / 5.0));
              float n1 = fNoise(vec2(wu * 2.6, wy * 3.4) + seg * 13.0) + 0.35 * fNoise(vec2(wu, wy) * 9.0 + seg);
              float stroke = 1.0 - smoothstep(0.0, 0.045, abs(n1 - 0.68));
              float fillT = smoothstep(0.7, 0.74, n1) * step(0.6, fHash(vec2(seg, 5.0)));
              vec3 gc = mix(vec3(0.75, 0.12, 0.1), vec3(0.1, 0.35, 0.7), step(0.5, fHash(vec2(seg, 3.0))));
              gc = mix(gc, vec3(0.9, 0.85, 0.75), step(0.8, fHash(vec2(seg, 4.0))));
              float k = on * box;
              diffuseColor.rgb = mix(diffuseColor.rgb, gc * 0.7, fillT * k * 0.85);
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.02), stroke * k * 0.9);
            }
          }
        }
        vec3 n = normalize(vLsNrm);
        if (abs(n.y) < 0.5) {
          float u = abs(n.x) > 0.5 ? vLsPos.z : vLsPos.x;
          float fy = vLsPos.y;
          vec2 cell = vec2(fract(u / 3.1), fract(fy / 3.4));
          vec2 id = vec2(floor(u / 3.1), floor(fy / 3.4));
          float h = fract(sin(dot(id, vec2(12.9898, 78.233))) * 43758.5453);
          float inWin = step(0.2, cell.x) * step(cell.x, 0.8) * step(0.28, cell.y) * step(cell.y, 0.82) * step(3.4, fy);
          lsWin = inWin * step(0.12, h);                              // ~12% of windows boarded up
          lsHgt = mix(lsHgt, -1.2, inWin);                             // window openings sit deep in the wall
          vec3 glass = mix(vec3(0.03, 0.035, 0.04), vec3(0.16, 0.19, 0.21), h * h);
          diffuseColor.rgb = mix(diffuseColor.rgb, glass, lsWin);
          diffuseColor.rgb *= 1.0 - 0.2 * step(fract(fy / 3.4), 0.07); // floor slab lines
          diffuseColor.rgb *= mix(0.55, 1.0, clamp(fy / 5.0, 0.0, 1.0)); // grime near the street
          diffuseColor.rgb *= 0.9 + 0.1 * h;                            // per-window variation
          // ---- 18 months of weather ----
          // rain streaks: noise stretched vertically, strongest under each window sill
          float streak = fNoise(vec2(u * 2.3, fy * 0.08)) * fNoise(vec2(u * 7.0, fy * 0.25));
          float underSill = smoothstep(0.28, 0.0, cell.y) * step(0.2, cell.x) * step(cell.x, 0.8);
          diffuseColor.rgb *= 1.0 - (1.0 - lsWin) * (0.28 * streak + 0.18 * underSill * h);
          // large water stains and patchy repairs
          float patchN = fNoise(vec2(u, fy) * 0.18);
          diffuseColor.rgb *= mix(1.0, 0.82, smoothstep(0.55, 0.75, patchN) * (1.0 - lsWin));
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.05, 1.0, 0.92), smoothstep(0.2, 0.05, patchN));
          // shattered panes: a jagged dark hole with a faint bright cracked edge
          float broken = step(0.82, fract(h * 7.31)) * lsWin;
          float shard = fNoise(cell * vec2(9.0, 7.0) + h * 40.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.008), broken * step(0.45, shard));
          diffuseColor.rgb += broken * smoothstep(0.42, 0.45, shard) * (1.0 - step(0.45, shard)) * 0.08;
          // AC units under ~1 in 6 windows (a grey box + a rust drip below it)
          float acOn = step(0.83, fract(h * 13.7)) * step(3.4, fy);
          float ac = acOn * step(0.3, cell.x) * step(cell.x, 0.62) * step(0.12, cell.y) * step(cell.y, 0.26);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.33, 0.33) * (0.7 + 0.3 * fNoise(cell * 30.0)), ac);
          float drip = acOn * smoothstep(0.12, 0.0, cell.y) * step(0.42, cell.x) * step(cell.x, 0.5);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.75, 0.55, 0.4), drip * 0.6);
          lsWin *= 1.0 - broken * step(0.45, shard);                    // holes are not shiny
        } else {
          diffuseColor.rgb = texture2D(t_concreteC, vLsPos.xz / 3.0).rgb * 0.4;   // flat concrete roofs, darker
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 wN = normalize(vLsNrm);
          if (abs(wN.y) < 0.5) {
            vec3 wB = vec3(0.0, 1.0, 0.0);
            vec3 pw = normalize(lsT * lsNm.x * 1.4 + wB * lsNm.y * 1.4 + wN * lsNm.z);
            normal = normalize((viewMatrix * vec4(pw, 0.0)).xyz);
          }
        }
        {
          vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
          float dhx = dFdx(lsHgt) * 0.06, dhy = dFdy(lsHgt) * 0.06;
          vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
          float det = dot(dpx, r1);
          vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
          normal = normalize(abs(det) * normal - grad);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        if (lsRo >= 0.0) roughnessFactor = mix(0.55, 1.0, lsRo);
        roughnessFactor = mix(roughnessFactor, 0.18, lsWin);
        roughnessFactor = mix(roughnessFactor, 0.55, uWet * (1.0 - lsWin));`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.6, lsWin);`);
  };
  return m;
}

export function buildCity(scene, layout) {
  const colliders = [];                         // { cx, cy, cz, hx, hy, hz } in metres
  // collider boxes in metres; ry = optional yaw (radians) for rotated props
  const box = (cx, cy, cz, hx, hy, hz, ry = 0) => colliders.push({ cx, cy, cz, hx, hy, hz, ry });
  const group = new THREE.Group(); scene.add(group);
  const W = WORLD * S, rx0 = RIVER.x * S, rx1 = (RIVER.x + RIVER.w) * S;

  // ---------------- GROUND (two land slabs either side of the river) ----------------
  const tex = new THREE.CanvasTexture(paintGround(layout, 4096, 58));
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const groundMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 });
  // Wet streets: in rain the ground darkens and noise-shaped puddles turn mirror-smooth,
  // so they reflect the sky (environment map). Puddles are always in the same places.
  groundMat.onBeforeCompile = sh => {
    sh.uniforms.uWet = wetU; texUniforms(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGW; uniform float uWet;
        ${TEX_DECL}
        float lsHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float lsNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(lsHash(i), lsHash(i + vec2(1, 0)), f.x), mix(lsHash(i + vec2(0, 1)), lsHash(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float n = lsNoise(vGW.xz * 0.12) * 0.65 + lsNoise(vGW.xz * 0.6) * 0.35;
        // close-up surface detail: the painted ground is ~8 px per metre, so near the camera it
        // looks like flat plastic. Layered noise adds grit, patches of wear and fine speckle.
        float lsGrit = lsNoise(vGW.xz * 3.1) * 0.5 + lsNoise(vGW.xz * 11.0) * 0.3 + lsHash(floor(vGW.xz * 40.0)) * 0.2;
        float lsWear = smoothstep(0.35, 0.75, lsNoise(vGW.xz * 0.35 + 7.0));
        diffuseColor.rgb *= 0.78 + 0.4 * lsGrit;
        // photographed asphalt grain (luminance only, so the painted roads / dirt keep their colour)
        vec3 lsAs = texture2D(t_asphaltC, vGW.xz / 3.0).rgb;
        diffuseColor.rgb *= clamp(dot(lsAs, vec3(0.333)) / 0.195, 0.5, 1.6);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.08, 1.02, 0.92), lsWear * 0.5);
        // CRACKS: edges of a 2.5 m Voronoi pattern, only where the ground is worn
        vec2 cg = vGW.xz / 1.8 + (vec2(lsNoise(vGW.xz * 1.7), lsNoise(vGW.xz * 1.7 + 5.0)) - 0.5) * 0.45, ci = floor(cg), cf = fract(cg);   // wobbly cells
        float d1 = 8.0, d2 = 8.0;
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
          vec2 o = vec2(float(i), float(j)), pt = vec2(lsHash(ci + o), lsHash(ci + o + 19.1));
          float d = length(o + pt - cf); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
        }
        float lsCrack = (1.0 - smoothstep(0.0, 0.018, d2 - d1)) * smoothstep(0.6, 0.8, lsNoise(vGW.xz * 0.07 + 3.0)) * step(0.35, lsNoise(vGW.xz * 0.9 + 11.0));   // thin, broken, only in patches
        diffuseColor.rgb *= 1.0 - 0.5 * lsCrack;
        // OIL STAINS: dark glossy blots
        float lsOil = smoothstep(0.78, 0.82, lsNoise(vGW.xz * 0.45 + 31.0)) * step(0.6, lsNoise(vGW.xz * 0.05));
        diffuseColor.rgb *= 1.0 - 0.6 * lsOil;
        // TYRE MARKS: long thin streaks along both road axes, in patches
        float tmx = smoothstep(0.92, 1.0, lsNoise(vec2(vGW.x * 0.08, vGW.z * 3.0))) * smoothstep(0.6, 0.75, lsNoise(vGW.xz * 0.04 + 9.0));
        float tmz = smoothstep(0.92, 1.0, lsNoise(vec2(vGW.x * 3.0, vGW.z * 0.08))) * smoothstep(0.6, 0.75, lsNoise(vGW.xz * 0.04 + 51.0));
        diffuseColor.rgb *= 1.0 - 0.45 * max(tmx, tmz);
        // LITTER: scattered paper, cans and glass bits
        vec2 lc = floor(vGW.xz * 3.0); float lh = lsHash(lc + 7.7);
        float lsLit = step(0.993, lh) * step(0.25, length(fract(vGW.xz * 3.0) - 0.5) < 0.3 ? 1.0 : 0.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.8, 0.78, 0.7), vec3(0.6, 0.15, 0.1), step(0.997, lh)), lsLit);
        float lsPuddle = smoothstep(0.56, 0.6, n) * smoothstep(0.15, 0.6, uWet);
        diffuseColor.rgb *= mix(1.0, 0.6, uWet);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.4, lsPuddle);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 an = texture2D(t_asphaltN, vGW.xz / 3.0).xyz * 2.0 - 1.0;
          vec3 pw = normalize(vec3(an.x, 0.0, -an.y) * 1.3 + vec3(0.0, an.z, 0.0));   // ground: tangent = +x, bitangent = -z
          normal = normalize((viewMatrix * vec4(pw, 0.0)).xyz);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor - 0.12 * lsGrit + 0.06, 0.6, 1.0);
        roughnessFactor = mix(roughnessFactor, mix(0.7, 1.0, texture2D(t_asphaltR, vGW.xz / 3.0).r), 0.6);
        roughnessFactor = mix(roughnessFactor, 0.25, lsOil);
        roughnessFactor = mix(roughnessFactor, 0.45, uWet);
        roughnessFactor = mix(roughnessFactor, 0.02, lsPuddle);`);
  };
  for (const [x0, x1] of [[0, rx0], [rx1, W]]) {
    const geo = new THREE.PlaneGeometry(x1 - x0, W);
    geo.rotateX(-Math.PI / 2);
    // remap UVs so each slab samples its own part of the shared ground texture
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) { uv.setX(i, (x0 + uv.getX(i) * (x1 - x0)) / W); }
    const m = new THREE.Mesh(geo, groundMat);
    m.position.set((x0 + x1) / 2, 0, W / 2); m.receiveShadow = true; group.add(m);
    box((x0 + x1) / 2, -0.5, W / 2, (x1 - x0) / 2, 0.5, W / 2);
  }
  // endless dusty plain beyond the map edge (fog hides where it ends)
  const outer = new THREE.Mesh(new THREE.RingGeometry(W * 0.75, 2400, 48, 1), new THREE.MeshStandardMaterial({ color: '#2a2724', roughness: 1 }));
  outer.rotation.x = -Math.PI / 2; outer.position.set(W / 2, -0.05, W / 2); group.add(outer);

  // ---------------- RIVER: bed, banks, water ----------------
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(rx1 - rx0, W), new THREE.MeshStandardMaterial({ color: '#3a3024', roughness: 1 }));
  bed.rotation.x = -Math.PI / 2; bed.position.set((rx0 + rx1) / 2, RIVER_BED, W / 2); group.add(bed);
  box((rx0 + rx1) / 2, RIVER_BED - 0.5, W / 2, (rx1 - rx0) / 2, 0.5, W / 2);
  const bankMat = new THREE.MeshStandardMaterial({ color: '#5d5a54', roughness: 0.9 });
  for (const x of [rx0, rx1]) {
    const bank = new THREE.Mesh(new THREE.BoxGeometry(0.6, -RIVER_BED, W), bankMat);
    bank.position.set(x, RIVER_BED / 2, W / 2); bank.receiveShadow = true; group.add(bank);
  }
  const water = createWater(group, { x0: rx0, x1: rx1, length: W, y: WATER_Y, bed });

  // Railings along both banks (with a gap for the bridge). Tall invisible colliders stop jumping in.
  const railMat = new THREE.MeshStandardMaterial({ color: '#6c6f70', roughness: 0.5, metalness: 0.7 });
  const by0 = BRIDGE.y * S, by1 = (BRIDGE.y + BRIDGE.h) * S;
  for (const x of [rx0 - 0.4, rx1 + 0.4]) for (const [z0, z1] of [[0, by0], [by1, W]]) {
    const len = z1 - z0;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, len), railMat);
    rail.position.set(x, 1.05, (z0 + z1) / 2); group.add(rail);
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 1.05, 0.08), railMat, Math.floor(len / 2.5));
    const mtx = new THREE.Matrix4();
    for (let i = 0; i < posts.count; i++) { mtx.makeTranslation(x, 0.52, z0 + 1.25 + i * 2.5); posts.setMatrixAt(i, mtx); }
    group.add(posts);
    box(x, 1.5, (z0 + z1) / 2, 0.3, 1.5, len / 2);
  }

  // ---------------- BRIDGE ----------------
  const deckMat = new THREE.MeshStandardMaterial({ color: '#4a4c4d', roughness: 0.85 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(rx1 - rx0 + 4, 1.2, by1 - by0), deckMat);
  deck.position.set((rx0 + rx1) / 2, -0.6, (by0 + by1) / 2); deck.receiveShadow = true; deck.castShadow = true; group.add(deck);
  box((rx0 + rx1) / 2, -0.6, (by0 + by1) / 2, (rx1 - rx0 + 4) / 2, 0.6, (by1 - by0) / 2);
  for (const z of [by0 + 0.3, by1 - 0.3]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(rx1 - rx0 + 4, 1.0, 0.4), bankMat);
    wall.position.set((rx0 + rx1) / 2, 0.5, z); wall.castShadow = true; group.add(wall);
    box((rx0 + rx1) / 2, 0.5, z, (rx1 - rx0 + 4) / 2, 0.5, 0.2);
  }
  for (const x of [rx0 + 8, rx1 - 8]) {
    const pier = new THREE.Mesh(new THREE.BoxGeometry(3, -RIVER_BED, (by1 - by0) * 0.8), bankMat);
    pier.position.set(x, RIVER_BED / 2 - 0.6, (by0 + by1) / 2); group.add(pier);
  }

  // ---------------- BUILDINGS (one InstancedMesh for all boxes) ----------------
  const r = mulberry(99);
  const blocks = layout.buildings.filter(b => !b.tank);
  const unit = new THREE.BoxGeometry(1, 1, 1); unit.translate(0, 0.5, 0);
  const inst = new THREE.InstancedMesh(unit, facadeMaterial(), blocks.length);
  inst.castShadow = true; inst.receiveShadow = true;
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  blocks.forEach((b, i) => {
    const h = heightOf(b, r);
    b.h3 = h;                                               // remembered for rooftop details later
    const cx = (b.x + b.w / 2) * S, cz = (b.y + b.h / 2) * S, sx = b.w * S, sz = b.h * S;
    m4.compose(new THREE.Vector3(cx, 0, cz), new THREE.Quaternion(), new THREE.Vector3(sx, h, sz));
    inst.setMatrixAt(i, m4);
    col.set(b.cross ? '#d9d5cb' : b.helix ? '#dfe4e6' : b.station ? '#4a4658' : b.stall ? b.roof : b.crate ? '#6b5a40' : WALLS[Math.floor(r() * WALLS.length)]);
    inst.setColorAt(i, col);
    box(cx, h / 2, cz, sx / 2, h / 2, sz / 2);
  });
  group.add(inst);

  // Storage tanks (Ironside fuel, Lakeside water)
  const tanks = layout.buildings.filter(b => b.tank);
  const tankMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 28).translate(0, 0.5, 0),
    new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.8 }), tanks.length);
  tankMesh.castShadow = tankMesh.receiveShadow = true;
  tanks.forEach((b, i) => {
    const rad = b.w * S / 2, h = b.hgt * 0.22, cx = (b.x + b.w / 2) * S, cz = (b.y + b.h / 2) * S;
    m4.compose(new THREE.Vector3(cx, 0, cz), new THREE.Quaternion(), new THREE.Vector3(rad, h, rad));
    tankMesh.setMatrixAt(i, m4); tankMesh.setColorAt(i, col.set(b.roof));
    box(cx, h / 2, cz, rad * 0.9, h / 2, rad * 0.9);
  });
  group.add(tankMesh);

  landmarks(group, layout, box);

  // ---------------- FIRE BARRELS (lights) ----------------
  const fires = [];
  const barrelGeo = new THREE.CylinderGeometry(0.35, 0.33, 0.9, 14);
  const barrelMat = new THREE.MeshStandardMaterial({ color: '#3b2f28', roughness: 0.6, metalness: 0.6 });
  const flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb35a').multiplyScalar(3.5) });   // HDR: blooms
  for (const l of layout.lights) {
    const x = l.x * S, z = l.y * S;
    const bar = new THREE.Mesh(barrelGeo, barrelMat); bar.position.set(x, 0.45, z); bar.castShadow = true; group.add(bar);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.7, 8), flameMat); flame.position.set(x, 1.2, z); group.add(flame);
    fires.push({ x, z, flame, seed: Math.random() * 10 });           // its light comes from the light pool
    box(x, 0.45, z, 0.35, 0.45, 0.35);
  }

  return { group, colliders, water, fires, box };
}

/** Building height in metres from the layout's height hint. */
function heightOf(b, r) {
  if (b.stall) return 2.8;
  if (b.crate) return 1.4;
  if (b.land) return b.hgt * 0.3;
  const floors = 2 + Math.round((b.hgt - 20) / 55 * 7 + r() * 1.5);
  return floors * 3.4;
}

/** District landmarks that make each colony readable from a distance. */
function landmarks(group, layout, box) {
  const S_ = S;
  // Mercy: red cross on the hospital roof + a banner
  const hosp = layout.buildings.find(b => b.cross);
  if (hosp) {
    const cx = (hosp.x + hosp.w / 2) * S_, cz = (hosp.y + hosp.h / 2) * S_, top = hosp.h3 || 21;
    const red = new THREE.MeshStandardMaterial({ color: '#b3262b', roughness: 0.6, emissive: '#400', emissiveIntensity: 0.4 });
    const a = new THREE.Mesh(new THREE.BoxGeometry(12, 0.3, 3.5), red); a.position.set(cx, top + 0.2, cz); group.add(a);
    const b = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.3, 12), red); b.position.set(cx, top + 0.2, cz); group.add(b);
  }
  // Power station: pylons + transformer yard
  const st = layout.buildings.find(b => b.station);
  if (st) {
    const steel = new THREE.MeshStandardMaterial({ color: '#56585c', metalness: 0.8, roughness: 0.4 });
    for (let i = 0; i < 4; i++) {
      const x = (st.x + 20 + i * 45) * S_, z = (st.y + st.h + 60) * S_;
      const py = new THREE.Mesh(new THREE.BoxGeometry(0.6, 16, 0.6), steel); py.position.set(x, 8, z); py.castShadow = true; group.add(py);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 6), steel); arm.position.set(x, 15, z); group.add(arm);
      box(x, 8, z, 0.4, 8, 0.4);
    }
  }
  // Helix: teal light strips on the white buildings
  for (const h of layout.buildings.filter(b => b.helix)) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(h.w * S_ + 0.1, 0.25, h.h * S_ + 0.1), new THREE.MeshBasicMaterial({ color: '#39e0cf' }));
    strip.position.set((h.x + h.w / 2) * S_, 3.2, (h.y + h.h / 2) * S_); group.add(strip);
  }
  // Crow's Market: a collapsed flyover overhead, on pillars
  const conc = new THREE.MeshStandardMaterial({ color: '#6a6862', roughness: 0.95 });
  const fx0 = 1640 * S_, fx1 = 2120 * S_, fz = 1910 * S_;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(fx1 - fx0, 1.4, 12), conc);
  deck.position.set((fx0 + fx1) / 2, 7.5, fz); deck.rotation.z = 0.05; deck.castShadow = true; deck.receiveShadow = true; group.add(deck);
  for (const x of [fx0 + 8, (fx0 + fx1) / 2, fx1 - 20]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.6, 7, 1.6), conc); p.position.set(x, 3.5, fz); p.castShadow = true; group.add(p);
    box(x, 3.5, fz, 0.8, 3.5, 0.8);
  }
}
