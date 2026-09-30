/* =====================================================================
   LIGHT POOL
   The city has dozens of light sources (fire barrels, lamps, flare stacks,
   market bulbs, Helix floodlights). Every real PointLight costs shader
   time on every pixel, so we create a FIXED number of lights (set by the
   preset) and each 0.3 s move them to the sources nearest the camera.
   Far sources still glow (emissive meshes) - they just don't light walls.
   ===================================================================== */
import * as THREE from 'three';

export function createLightPool(scene, count) {
  const sources = [];
  let lights = [], timer = 0, assigned = [];

  function setCount(n) {
    for (const l of lights) scene.remove(l);
    lights = Array.from({ length: n }, () => { const l = new THREE.PointLight('#ffffff', 0, 20, 2); scene.add(l); return l; });
    timer = 0;
  }
  setCount(count);

  return {
    /**
     * Register a light source.
     * kind: 'fire' (flickers, always on) | 'lamp' (night only, may flicker) | 'glow' (steady, always on) | 'night' (steady, night only)
     */
    add(x, y, z, color, intensity, distance, kind = 'glow') {
      const src = { pos: new THREE.Vector3(x, y, z), color: new THREE.Color(color), intensity, distance, kind, seed: Math.random() * 100, broken: kind === 'lamp' && Math.random() < 0.15 };
      sources.push(src); return src;
    },
    /** Remove a source added with add() (mission fires, explosions). */
    remove(src) { const i = sources.indexOf(src); if (i >= 0) sources.splice(i, 1); timer = 0; },
    setCount,
    get sources() { return sources; },
    update(camPos, t, dt, daylight) {
      timer -= dt;
      if (timer <= 0) {
        timer = 0.3;
        assigned = sources
          .filter(s => (s.kind !== 'lamp' && s.kind !== 'night') || daylight < 0.6)
          .map(s => [s, s.pos.distanceToSquared(camPos)])
          .sort((a, b) => a[1] - b[1]).slice(0, lights.length).map(a => a[0]);
      }
      lights.forEach((l, i) => {
        const s = assigned[i];
        if (!s) { l.intensity = 0; return; }
        l.position.copy(s.pos); l.color.copy(s.color); l.distance = s.distance;
        let k = 1;
        if (s.kind === 'fire') k = 0.8 + 0.25 * Math.sin(t * 13 + s.seed) * Math.sin(t * 7.3 + s.seed * 2);
        if (s.kind === 'lamp' && s.broken) k = Math.sin(t * 23 + s.seed) > 0.2 && Math.sin(t * 1.7 + s.seed) > -0.4 ? 1 : 0.35;   // faulty lamp flicker
        const dayK = s.kind === 'fire' ? 1.2 - daylight * 0.7 : s.kind === 'glow' ? 1 - daylight * 0.5 : 1 - daylight;
        l.intensity = s.intensity * k * dayK;
      });
    },
    /** Flicker value for a source (used to animate its emissive mesh too). */
    flicker(s, t) { return s.kind === 'lamp' && s.broken ? (Math.sin(t * 23 + s.seed) > 0.2 && Math.sin(t * 1.7 + s.seed) > -0.4 ? 1 : 0.35) : 1; },
  };
}
