/* =====================================================================
   RIVER WATER
   A standard PBR surface (so it gets real sky reflections, fog & lights)
   with a small shader patch that adds:
     - flowing ripples: 4 sine waves travelling DOWNSTREAM (+z), turned into
       a surface normal from their analytic slope (no textures needed)
     - foam lines along both banks
     - colour driven by the Chapter 3 river health:
         1.0 clean blue-green  ->  0.0 murky brown with yellow scum
     - when the river dies: the water disappears and the bed turns into
       cracked, dried mud
   ===================================================================== */
import * as THREE from 'three';
import { canvasTex } from './kit.js';

export function createWater(group, { x0, x1, length, y, bed }) {
  const uniforms = { uTime: { value: 0 }, uHealth: { value: 1 } };
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.06, metalness: 0.05, transparent: true, opacity: 0.92 });
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec2 vWUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWUv = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uHealth; varying vec3 vWPos; varying vec2 vWUv;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 clean = vec3(0.035, 0.12, 0.15);
        vec3 murky = vec3(0.13, 0.11, 0.05);
        diffuseColor.rgb = mix(murky, clean, uHealth);
        // foam hugging the banks (uv.x runs across the river), broken up by a moving wave
        float edge = min(vWUv.x, 1.0 - vWUv.x);
        float n = sin(vWPos.z * 1.7 - uTime * 2.0) * 0.5 + 0.5;
        float foam = smoothstep(0.06, 0.0, edge) * (0.55 + 0.45 * n);
        foam += smoothstep(0.96, 1.0, sin(vWPos.z * 0.9 + vWPos.x * 2.3 - uTime * 1.3)) * 0.18;    // drifting flecks
        vec3 foamCol = mix(vec3(0.62, 0.56, 0.32), vec3(0.8, 0.84, 0.85), uHealth);            // pollution = yellow scum
        diffuseColor.rgb = mix(diffuseColor.rgb, foamCol, clamp(foam, 0.0, 1.0));`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        // slope of a sum of travelling sine waves -> surface normal (in world space)
        vec2 p = vWPos.xz; float t = uTime; vec2 g = vec2(0.0); vec2 d;
        d = vec2(0.0, 1.0);                g += d * cos(dot(p, d) * 0.9 - t * 1.6) * 0.9 * 0.05;
        d = normalize(vec2(0.6, 1.0));     g += d * cos(dot(p, d) * 1.7 - t * 2.1) * 1.7 * 0.028;
        d = normalize(vec2(-0.7, 1.0));    g += d * cos(dot(p, d) * 2.9 - t * 2.7) * 2.9 * 0.014;
        d = normalize(vec2(0.3, 1.0));     g += d * cos(dot(p, d) * 6.3 - t * 4.1) * 6.3 * 0.004;
        g *= mix(0.45, 1.0, uHealth);                         // polluted water is sluggish
        vec3 nW = normalize(vec3(-g.x, 1.0, -g.y));
        normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);`);
  };
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, length), mat);
  mesh.rotation.x = -Math.PI / 2; mesh.position.set((x0 + x1) / 2, y, length / 2);
  mesh.receiveShadow = true;
  group.add(mesh);

  // Dried-mud texture for the dead river: polygon cracks on a pale clay colour.
  const cracked = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#7a6448'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? '255,240,210' : '40,30,20'},.05)`; g.fillRect(Math.random() * w, Math.random() * h, 12, 12); }
    g.strokeStyle = '#3a2c1d'; g.lineWidth = 3;
    const pts = Array.from({ length: 70 }, () => [Math.random() * w, Math.random() * h]);
    for (const [px, py] of pts) {                 // crack from each seed toward its 3 nearest neighbours
      pts.map(q => [q, Math.hypot(q[0] - px, q[1] - py)]).sort((a, b) => a[1] - b[1]).slice(1, 4).forEach(([q]) => {
        g.beginPath(); g.moveTo(px, py); g.lineTo((px + q[0]) / 2 + (Math.random() - .5) * 8, (py + q[1]) / 2 + (Math.random() - .5) * 8); g.lineTo(q[0], q[1]); g.stroke();
      });
    }
  }, { repeat: true });
  cracked.repeat.set(3, length / 9);
  const wetBed = bed.material, dryBed = new THREE.MeshStandardMaterial({ map: cracked, roughness: 1 });

  let dead = false;
  return {
    mesh,
    /** health 0..1 from the game theory state (GT.river / 100); riverDead switches to the dry bed. */
    update(t, health, riverDead) {
      uniforms.uTime.value = t;
      uniforms.uHealth.value += (health - uniforms.uHealth.value) * 0.02;   // colour eases in over a few seconds
      mat.roughness = 0.06 + (1 - uniforms.uHealth.value) * 0.3;
      if (riverDead !== dead) { dead = riverDead; mesh.visible = !dead; bed.material = dead ? dryBed : wetBed; }
    },
    get health() { return uniforms.uHealth.value; },
  };
}
