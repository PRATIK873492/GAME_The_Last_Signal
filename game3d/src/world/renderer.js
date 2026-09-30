/* =====================================================================
   RENDERER + QUALITY PRESETS
   - Physically based lighting (default since three r155)
   - ACES Filmic tone mapping + sRGB output = film-like highlights
   - PCF soft shadows
   ===================================================================== */
import * as THREE from 'three';

/** Everything a preset controls. Later phases add post-processing flags here. */
//   cascades   : shadow-map cascades (CSM); shadowDist = how far shadows reach (m)
//   lights     : real point lights in the light pool; detailDist = small-prop LOD distance (m)
//   grass/rain : vegetation cards and rain drops (built at load time)
//   post       : post-processing on/off (Low renders directly); ssr = wet-street reflections
//   ao         : ambient occlusion default (costly: off on Medium unless the player turns it on)
export const PRESETS = {
  low:    { label: 'Low',    pixelRatio: 0.75, shadows: false, cascades: 0, shadowMap: 1024, shadowDist: 0,   viewDist: 220, antialias: false, lights: 4,  detailDist: 55,  grass: 1800,  rain: 2500,  post: false, ssr: false, ao: false, aoHalfRes: true,  aoQuality: 'Performance' },
  medium: { label: 'Medium', pixelRatio: 1.0,  shadows: true,  cascades: 2, shadowMap: 2048, shadowDist: 140, viewDist: 340, antialias: true,  lights: 8,  detailDist: 90,  grass: 5000,  rain: 5000,  post: true,  ssr: false, ao: false, aoHalfRes: true,  aoQuality: 'Performance' },
  high:   { label: 'High',   pixelRatio: 1.5,  shadows: true,  cascades: 3, shadowMap: 2048, shadowDist: 220, viewDist: 480, antialias: true,  lights: 12, detailDist: 130, grass: 9000,  rain: 8000,  post: true,  ssr: true,  ao: true,  aoHalfRes: false, aoQuality: 'Medium' },
  ultra:  { label: 'Ultra',  pixelRatio: 2.0,  shadows: true,  cascades: 4, shadowMap: 4096, shadowDist: 300, viewDist: 650, antialias: true,  lights: 16, detailDist: 180, grass: 14000, rain: 12000, post: true,  ssr: true,  ao: true,  aoHalfRes: false, aoQuality: 'High' },
};

export function loadPresetName() {
  try { return localStorage.getItem('ls3d-preset') || 'medium'; } catch (e) { return 'medium'; }
}
export function savePresetName(n) { try { localStorage.setItem('ls3d-preset', n); } catch (e) { /* storage blocked */ } }

export function createRenderer(canvas, preset) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: preset.antialias, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = preset.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;           // soft-filtered PCF (r180+ merged PCFSoft into this)
  applyPreset(renderer, preset);
  return renderer;
}

export function applyPreset(renderer, preset) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatio));
  renderer.shadowMap.enabled = preset.shadows;
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}
