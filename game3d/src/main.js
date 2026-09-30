/* =====================================================================
   THE LAST SIGNAL 3D - entry point & main loop  (Phases 1-4)

   Frame order:
     1. input            -> what the player wants
     2. player.update    -> Rapier character controller computes the move
     3. world.step       -> physics advances
     4. player.sync      -> mesh + MAP coordinates updated from physics
     5. camera.update    -> follow, orbit, wall collision
     6. weather/lighting -> sky, sun (CSM), fog, rain, light pool
     7. mission check    -> uses MAP coordinates, exactly like the 2D game
     8. render           -> background pass (sky, skyline) then the city,
                            through post-processing (Medium and up)
   ===================================================================== */
import * as THREE from 'three';
import { genLayout, P } from './core/worldLayout.js';
import { GT } from './core/gtState.js';
import { PRESETS, createRenderer, applyPreset, loadPresetName, savePresetName } from './world/renderer.js';
import { buildCity } from './world/city.js';
import { buildDetails } from './world/details.js';
import { buildVegetation, windUniform } from './world/vegetation.js';
import { buildDistricts } from './world/districts.js';
import { buildSkyline } from './world/skyline.js';
import { createLightPool } from './world/lightpool.js';
import { createLighting } from './world/lighting.js';
import { createWeather, wetU } from './world/weather.js';
import { createPost } from './world/post.js';
import { updateLOD, instanceStats } from './world/kit.js';
import { createMarker } from './world/markers.js';
import { createPhysics } from './game/physics.js';
import { createInput } from './game/input.js';
import { createPlayer } from './game/player.js';
import { createCamera } from './game/camera.js';
import { createHud } from './ui/hud.js';

const $ = id => document.getElementById(id);
const canvas = $('view');
let presetName = loadPresetName();
$('preset').value = presetName;
let preset = PRESETS[presetName];

// ---------- scenes ----------
const renderer = createRenderer(canvas, preset);
renderer.autoClear = false;                              // we draw two scenes per frame
const scene = new THREE.Scene();                          // the playable city
const bg = new THREE.Scene();                             // sky, stars, skyline, mountains
const cam = createCamera(preset);
const bgCam = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 20, 6000);

const layout = genLayout();                               // same footprints as the 2D game
const pool = createLightPool(scene, preset.lights);
const city = buildCity(scene, layout);
for (const f of city.fires) pool.add(f.x, 1.8, f.z, '#ff9a4a', 40, 22, 'fire');
const details = buildDetails(scene, layout, city.box, pool);
buildVegetation(scene, layout, preset, city.box);
const districts = buildDistricts(scene, layout, city.box, pool);
buildSkyline(bg);
const lighting = createLighting({ scene, bg, renderer, camera: cam.camera, preset });
const weather = createWeather(scene, preset, renderer);
const marker = createMarker(scene);
const hud = createHud(layout);
const input = createInput(canvas);
const post = createPost({ renderer, scene, bg, camera: cam.camera, bgCamera: bgCam, preset });

/** Post-processing does its own tone mapping; Low renders straight to screen with the renderer's ACES. */
function applyToneMapping() {
  renderer.toneMapping = preset.post ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
  weather.fakeShafts = !(preset.post && post.settings.godrays);
  scene.traverse(o => { if (o.material && !Array.isArray(o.material)) o.material.needsUpdate = true; });
}
applyToneMapping();

// Effects toggles on the start / pause screen
for (const k of ['ao', 'bloom', 'godrays', 'ssr', 'dof', 'motion', 'grain']) {
  const box = document.getElementById('fx-' + k);
  if (!box) continue;
  box.checked = post.settings[k] ?? preset[k];
  box.onchange = () => { post.setSettings({ [k]: box.checked }); applyToneMapping(); };
}

// Flashlight (F): a spotlight in Veer's hand for the dark streets at night.
const flashlight = new THREE.SpotLight('#fff4e0', 0, 32, 0.42, 0.45, 1.6);
flashlight.userData.on = true;
scene.add(flashlight, flashlight.target);

// ---------- test route: walk to real mission points (map coordinates) ----------
const ROUTE = [
  [P.radio, 'Walk to the radio at the Lakeside docks'],
  [P.elena, 'Head north to Mercy Hospital, where Dr. Elena Cruz waits'],
  [{ x: 1190, y: 1200 }, 'Cross the bridge over the river'],
  [P.rhea, 'Reach Ironside Refinery'],
  [P.station, 'Find the power station in the Dead Zone'],
  [P.silas, "Visit Crow's Market under the flyover"],
];
let routeI = 0;
function setRoute(i) { routeI = i % ROUTE.length; marker.set(ROUTE[routeI][0]); hud.setObjective(ROUTE[routeI][1]); }

let player, phys, clock = 7.5 * 60;

async function boot() {
  $('load-msg').textContent = 'Building physics…';
  phys = await createPhysics(city.colliders);
  player = createPlayer(scene, phys, P.home);
  lighting.registerMaterials(scene);                      // every lit material gets cascaded shadows
  setRoute(0);
  const st = instanceStats();
  $('load-msg').textContent = `City built: ${layout.buildings.length} buildings, ${st.inst.toLocaleString()} instanced props, ${city.colliders.length} colliders.`;
  $('play').disabled = false;
  requestAnimationFrame(loop);
}

$('play').onclick = () => canvas.requestPointerLock?.()?.catch?.(() => {});
$('preset').onchange = e => {
  presetName = e.target.value; preset = PRESETS[presetName]; savePresetName(presetName);
  applyPreset(renderer, preset); lighting.setPreset(preset); cam.setPreset(preset); pool.setCount(preset.lights);
  post.setPreset(preset); post.setSize(innerWidth, innerHeight); applyToneMapping();
  const aoBox = document.getElementById('fx-ao'); if (aoBox) aoBox.checked = post.settings.ao ?? preset.ao;
};
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  $('start').hidden = locked;
  if (!locked && player) $('play').textContent = 'Resume';
  if (player) $('hud').hidden = false;
});
addEventListener('resize', () => { applyPreset(renderer, preset); cam.resize(); bgCam.aspect = innerWidth / innerHeight; bgCam.updateProjectionMatrix(); post.setSize(innerWidth, innerHeight); });

let last = performance.now(), lodTimer = 0;
function loop(now) {
  const dt = Math.min(1 / 30, (now - last) / 1000); last = now;
  frame(dt, now / 1000);
  requestAnimationFrame(loop);
}

/** One frame of the game. Split from loop() so tests can step it manually. */
function frame(dt, t) {
  // ---- global keys ----
  if (input.pressed.has('F3')) hud.toggleFps();
  if (input.pressed.has('BracketRight')) clock = (clock + 60) % 1440;
  if (input.pressed.has('BracketLeft')) clock = (clock + 1380) % 1440;
  if (input.pressed.has('KeyN')) weather.cycle();                    // test key: next weather
  if (input.pressed.has('KeyF')) flashlight.userData.on = !flashlight.userData.on;
  clock = (clock + dt * 1.2) % 1440;                                  // 1 in-game day = 20 real minutes

  // ---- player & physics ----
  if (input.locked) player.update(dt, input, cam);
  else { input.takeLook(); player.update(dt, { down: () => false, pressed: new Set(), aim: false }, cam); }
  phys.world.timestep = dt;
  phys.world.step();
  player.sync(dt, cam);
  cam.update(dt, input, player, phys);

  // ---- world simulation ----
  const feet = player.feet();
  weather.riverDead = GT.riverDead;
  const wx = weather.update(dt, t, cam.camera, lighting.state);
  lighting.update(clock, feet, dt, wx);
  pool.update(cam.camera.position, t, dt, lighting.state.daylight);
  windUniform.value = t;
  city.water.update(t, GT.river / 100, GT.riverDead);
  details.update(t, dt, cam.camera.position, 1 + wx.fogMul * 0.1);
  districts.update(t, GT.riverDead);
  for (const f of city.fires) f.flame.scale.y = 0.8 + 0.25 * Math.sin(t * 13 + f.seed) * Math.sin(t * 7.3 + f.seed * 2);
  lodTimer -= dt; if (lodTimer <= 0) { lodTimer = 0.25; updateLOD(cam.camera.position, preset.detailDist); }
  marker.update(t);

  // flashlight follows where Veer faces; only at night
  const fl = flashlight.userData.on && lighting.state.daylight < 0.5;
  flashlight.intensity = fl ? 60 : 0;
  flashlight.position.set(feet.x, feet.y + 1.4, feet.z);
  flashlight.target.position.set(feet.x + Math.sin(player.heading) * 8, feet.y, feet.z + Math.cos(player.heading) * 8);

  // ---- mission-style check in MAP coordinates (identical maths to the 2D goTo step) ----
  if (marker.map && Math.hypot(player.map.x - marker.map.x, player.map.y - marker.map.y) < 45) setRoute(routeI + 1);

  hud.update(dt, player, clock, marker, -cam.yaw, `${presetName} · ${weather.type} · ${renderer.info.render.calls} draws · ${(renderer.info.render.triangles / 1000).toFixed(0)}k tris`);

  // ---- render: background (far camera), then the city on top ----
  bgCam.position.copy(cam.camera.position); bgCam.quaternion.copy(cam.camera.quaternion);
  if (bgCam.fov !== cam.camera.fov) { bgCam.fov = cam.camera.fov; bgCam.updateProjectionMatrix(); }
  if (preset.post) {
    // focus for depth of field: whatever is straight ahead of the camera
    const fwd = new THREE.Vector3(); cam.camera.getWorldDirection(fwd);
    const hit = phys.raycast(cam.camera.position, fwd, 120, player.body);
    post.render({
      dt, exposure: renderer.toneMappingExposure, daylight: lighting.state.daylight, golden: lighting.state.golden,
      sunDir: lighting.state.sunDir, wet: wetU.value, haze: Math.min(1, (wx.fogMul - 1) / 4),
      aiming: cam.aiming, focusDist: hit ?? 40, cinematic: false, dawnEnding: false,
    });
  } else {
    renderer.clear();
    renderer.render(bg, bgCam);
    renderer.clearDepth();
    renderer.render(scene, cam.camera);
  }
  input.pressed.clear();
}

boot().catch(err => { $('load-msg').textContent = 'Failed to start: ' + err.message; console.error(err); });
window.__ls = { get player() { return player; }, post, input, hud, lighting, weather, cam, scene, bg, renderer, GT, pool, setClock: v => { clock = v; }, frame };   // debug handle for testing
