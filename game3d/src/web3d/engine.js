/* =====================================================================
   THE LAST SIGNAL - 3D ENGINE FOR THE FULL GAME
   "2D simulation, 3D presentation": the game logic in web/game.js,
   action.js, missions.js, chapter1.js... runs unchanged on the city map
   (map px). This module draws that simulation with the Phase 1-4
   graphics (PBR city, cascaded shadows, sky, weather, post-processing):
     map (x, y) px  ->  world (x * 0.2, height, y * 0.2) metres
   It also gives the game a third-person camera: mouse-look, WASD relative
   to the camera, and aiming through a centre crosshair (R3.aim()).
   game.js calls R3.frame() once per frame from draw().
   ===================================================================== */
import * as THREE from 'three';
import { genLayout, MAP_TO_M as S } from '../core/worldLayout.js';
import { PRESETS, createRenderer, applyPreset, loadPresetName, savePresetName } from '../world/renderer.js';
import { buildCity, WATER_Y } from '../world/city.js';
import { buildDetails } from '../world/details.js';
import { buildVegetation, windUniform } from '../world/vegetation.js';
import { buildDistricts } from '../world/districts.js';
import { buildSkyline } from '../world/skyline.js';
import { createLightPool } from '../world/lightpool.js';
import { createLighting } from '../world/lighting.js';
import { createWeather, wetU } from '../world/weather.js';
import { createPost } from '../world/post.js';
import { updateLOD } from '../world/kit.js';
import { createMarker } from '../world/markers.js';
import { buildRig, poseRig, buildDrone, modelReady } from './chars.js';
import { buildVehicle, wreckVehicle } from './vehicles.js';

const W = (x, y, h = 0) => new THREE.Vector3(x * S, h, y * S);         // map px -> world metres
const heading = a => Math.PI / 2 - a;                                   // 2D angle -> Y rotation of a +z-facing model
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const wrapPI = a => ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
/** Damp an angle along the short way round. */
const dampAngle = (a, b, k, dt) => a + wrapPI(b - a) * (1 - Math.exp(-k * dt));
// Presentation-only motion state (the 2D simulation is untouched): smoothed yaw, lean, suspension.
const motion = new WeakMap();

// ---------------------------------------------------------------------
// Scene set-up (the same world systems as the Phase 1-4 3D preview)
// ---------------------------------------------------------------------
const canvas = document.getElementById('view3d');
let presetName = loadPresetName(), preset = PRESETS[presetName];
const renderer = createRenderer(canvas, preset);
renderer.autoClear = false;
const scene = new THREE.Scene(), bg = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, preset.viewDist);
const bgCam = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 20, 6000);
const layout = genLayout();
const pool = createLightPool(scene, preset.lights);
const city = buildCity(scene, layout);
const nBase = city.colliders.length;                                   // colliders after this are props (wrecks, barriers...)
for (const f of city.fires) pool.add(f.x, 1.8, f.z, '#ff9a4a', 40, 22, 'fire');
const details = buildDetails(scene, layout, city.box, pool);
buildVegetation(scene, layout, preset, city.box);
const districts = buildDistricts(scene, layout, city.box, pool);
buildSkyline(bg);
const lighting = createLighting({ scene, bg, renderer, camera, preset });
const weather = createWeather(scene, preset, renderer); weather.forced = true;
const post = createPost({ renderer, scene, bg, camera, bgCamera: bgCam, preset });
const marker = createMarker(scene);
renderer.toneMapping = preset.post ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;

// Roof heights of the 2D buildings (same generator, same order -> match by position)
const roofH = new Map(layout.buildings.map(b => [b.x + ',' + b.y, b.tank ? b.hgt * 0.22 : b.h3]));
const heightOf = b => roofH.get(b.x + ',' + b.y) ?? (b.fence ? 2.8 : b.chem ? 3.2 : b.crate ? 1.4 : b.barricade ? 1.2 : b.defTarget ? 2.4 : b.billboard ? 1.8 : b.ruined ? 2.6 : 3);

// The props the 3D city adds (wrecked cars, barriers, lamp posts...) also block movement in the simulation.
extraColliders = city.colliders.slice(nBase).map(c => {
  const cs = Math.abs(Math.cos(c.ry || 0)), sn = Math.abs(Math.sin(c.ry || 0));
  const hx = (c.hx * cs + c.hz * sn) / S, hz = (c.hx * sn + c.hz * cs) / S;
  return { x: c.cx / S - hx, y: c.cz / S - hz, w: hx * 2, h: hz * 2, hgt: 5, prop: true };
}).filter(c => c.w > 1 && c.h > 1);
rebuildColliders();

// ---------------------------------------------------------------------
// Camera: third-person orbit with mouse-look (pointer lock)
// ---------------------------------------------------------------------
const cam = { yaw: Math.PI, pitch: 0.32, dist: 5, pivot: new THREE.Vector3(), lastLook: 0, aimZoom: 0 };
let rightDown = false;
addEventListener('mousedown', e => { if (e.button === 2) rightDown = true; });
addEventListener('mouseup', e => { if (e.button === 2) rightDown = false; });

// ---- night visibility: a soft fill light around the player + a flashlight (L toggles it) ----
const playerFill = new THREE.PointLight('#bcd0ff', 0, 16, 1.6); scene.add(playerFill);
const flashlight = new THREE.SpotLight('#fff1d6', 0, 55, 0.48, 0.5, 1.1); scene.add(flashlight, flashlight.target);
let flashOn = true;
addEventListener('keydown', e => { if (e.code === 'KeyL' && state.running && !state.modal) { flashOn = !flashOn; toast(flashOn ? 'Flashlight on (L)' : 'Flashlight off (L)'); } });
function updateNightLights() {
  const night = 1 - lighting.state.daylight;
  const who = player.car || player;
  const p = W(who.x, who.y, player.car ? 2.2 : 1.6), a = who.a || 0;
  playerFill.position.copy(p).add(new THREE.Vector3(0, 1.2, 0));
  playerFill.intensity = night * 3.5;
  flashlight.position.copy(p).add(new THREE.Vector3(Math.cos(a) * 0.3, 0, Math.sin(a) * 0.3));
  const aimAt = rightDown && !player.car ? W(aimPt.x, aimPt.y, 0.6) : W(who.x + Math.cos(a) * 60, who.y + Math.sin(a) * 60, 0.2);
  flashlight.target.position.copy(aimAt);
  flashlight.intensity = flashOn && night > 0.3 ? night * 60 : 0;
}
cv.addEventListener('click', () => { if (state.running && !state.modal && document.pointerLockElement !== cv) cv.requestPointerLock?.()?.catch?.(() => {}); });

function camFocus() {
  const g = player.gunner, me = g && g.car ? g.car : player.car || player;
  const h = player.roof ? heightOf(player.roof) : 0;
  return W(me.x, me.y, h + (player.car ? 1.6 : player.gunner ? 2.6 : player.crouch ? 1.15 : 1.55));
}

function updateCamera(dt) {
  const f = camFocus();
  cam.pivot.x = damp(cam.pivot.x, f.x, 14, dt); cam.pivot.z = damp(cam.pivot.z, f.z, 14, dt); cam.pivot.y = damp(cam.pivot.y, f.y, 8, dt);
  if (Math.abs(cam.pivot.x - f.x) > 20 || Math.abs(cam.pivot.z - f.z) > 20) cam.pivot.copy(f);          // teleports (checkpoints)
  // cutscene: the mission takes the camera -> slow orbit around the scene
  const cs = Action.camTarget();
  if (cs) {
    const t = W(cs.x, cs.y, 1.4), ang = performance.now() / 9000;
    const d = 9 / (cs.zoom || 1.2);
    camera.position.lerp(new THREE.Vector3(t.x + Math.sin(ang) * d, 4.5, t.z + Math.cos(ang) * d), 1 - Math.exp(-3 * dt));
    camera.lookAt(t); return;
  }
  // in a vehicle, drift the camera behind the car when the mouse is idle
  if (player.car && performance.now() - cam.lastLook > 1500 && Math.abs(player.car.v) > 20) {
    const want = Math.atan2(-Math.cos(player.car.a), -Math.sin(player.car.a));                      // camera offset = opposite of the car's forward
    let d = ((want - cam.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI; cam.yaw += d * Math.min(1, dt * 2);
  }
  cam.aimZoom = damp(cam.aimZoom, rightDown && !player.car ? 1 : 0, 12, dt);
  let want = (player.car ? 8.5 : player.gunner ? 6.5 : 4.6) - cam.aimZoom * 2.4;
  const side = (player.car ? 0 : 0.55 + cam.aimZoom * 0.15);
  const dir = new THREE.Vector3(Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch));
  const right = new THREE.Vector3(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
  // wall collision: walk from the pivot toward the camera spot; stop in front of any building taller than the ray there
  for (let d = 0.6; d < want; d += 0.4) {
    const p = cam.pivot.clone().addScaledVector(dir, d).addScaledVector(right, side);
    const hit = nearColliders(p.x / S, p.z / S).find(c => !c.water && !c.rail && p.x / S > c.x && p.x / S < c.x + c.w && p.z / S > c.y && p.z / S < c.y + c.h && p.y < heightOf(c) + 0.3);
    if (hit) { want = Math.max(0.8, d - 0.4); break; }
  }
  cam.dist = want < cam.dist ? want : damp(cam.dist, want, 4, dt);
  camera.position.copy(cam.pivot).addScaledVector(dir, cam.dist).addScaledVector(right, side);
  camera.position.y = Math.max(0.4, camera.position.y);
  camera.lookAt(cam.pivot.clone().addScaledVector(right, side));
  // sprint: wider view + a light running sway, like a real third-person game
  const pSpd = (player.spd || 0) * S, sprint = !player.car && pSpd > 4 ? 1 : 0;
  cam.bobT = (cam.bobT || 0) + dt * pSpd * 1.9;
  const bob = player.car ? 0 : Math.min(1, pSpd / 6) * 0.045;
  camera.position.y += Math.abs(Math.sin(cam.bobT)) * bob; camera.position.addScaledVector(right, Math.sin(cam.bobT * 0.5) * bob * 0.6);
  // handheld feel: two slow incommensurate sines on pitch / roll, damped right down when aiming
  const tt = performance.now() / 1000, hh = (1 - cam.aimZoom * 0.85) * (player.car ? 0.4 : 1);
  camera.rotateX((Math.sin(tt * 0.9) * 0.6 + Math.sin(tt * 2.3 + 1.7) * 0.4) * 0.0035 * hh);
  camera.rotateZ((Math.sin(tt * 0.7 + 0.4) * 0.6 + Math.sin(tt * 1.9) * 0.4) * 0.0028 * hh);
  const fov = rightDown && !player.car ? 46 : player.car ? 68 + Math.min(10, Math.abs(player.car.v || 0) * 0.02) : 62 + sprint * 8;
  if (Math.abs(camera.fov - fov) > 0.1) { camera.fov = damp(camera.fov, fov, 10, dt); camera.updateProjectionMatrix(); }
}

// ---------------------------------------------------------------------
// Aiming: ray through the centre crosshair -> enemy under it, or the
// point where it meets the player's chest height.
// ---------------------------------------------------------------------
const ray = new THREE.Raycaster(), tmpV = new THREE.Vector3();
let aimPt = { x: 0, y: 0 };
function computeAim() {
  ray.setFromCamera(new THREE.Vector2(0, 0), camera);
  let best = null, bt = 1e9;
  for (const e of enemies) {
    if (e.dead) continue;
    const p = entPos(e); p.y += e.fly ? 0 : 1.1;
    const t = tmpV.copy(p).sub(ray.ray.origin).dot(ray.ray.direction);
    if (t < 0 || t > 160) continue;
    const d = ray.ray.distanceSqToPoint(p);
    if (d < 0.8 * 0.8 && t < bt) { bt = t; best = e; }
  }
  if (best) { aimPt = { x: best.x, y: best.y }; return; }
  const h = (player.roof ? heightOf(player.roof) : 0) + 1.2;
  const d = ray.ray.direction, o = ray.ray.origin;
  let t = Math.abs(d.y) > 1e-3 ? (h - o.y) / d.y : -1;
  if (t < 0 || t > 120) t = 60;
  aimPt = { x: (o.x + d.x * t) / S, y: (o.z + d.z * t) / S };
}

// ---------------------------------------------------------------------
// Entity renderers
// ---------------------------------------------------------------------
const rigs = new Map(), vehs = new Map(), drones = new Map(), dyn = new Map(), used = new Set();
function entPos(e) {
  if (e.fly) return W(e.x, e.y, 4.5 + Math.sin(performance.now() / 500 + e.x) * 0.3);
  if (e.roof) return W(e.x, e.y, heightOf(e.roof));
  if (e.mount) return W(e.x, e.y, e.mount.type === 'boat' ? (GT.riverDead ? -2.6 : WATER_Y + 0.5) : 0.15);
  return W(e.x, e.y, 0);
}
function drawPerson(e, cfg, st, pos) {
  let r = rigs.get(e);
  if (r && r.proc && modelReady(cfg || e.cfg)) { scene.remove(r.root); r = null; }          // swap in the skinned human once it has loaded
  if (!r) { r = buildRig(cfg || e.cfg); scene.add(r.root); rigs.set(e, r); }
  used.add(e);
  r.root.visible = true;
  r.root.position.copy(pos || entPos(e));
  // Weight and inertia: the body turns toward the sim heading over a few frames instead of snapping,
  // leans into turns in proportion to speed x turn rate, and tips forward when speeding up.
  const dt = Math.min(0.05, st.dt || 0.016), want = heading(e.a || 0);
  let m = motion.get(e);
  if (!m) { m = { yaw: want, lean: 0, tilt: 0, spd: st.speed || 0 }; motion.set(e, m); r.root.rotation.order = 'YXZ'; }
  const prevYaw = m.yaw;
  m.yaw = st.dead || st.mounted ? want : dampAngle(m.yaw, want, st.aiming ? 22 : 11, dt);   // aiming stays crisp
  const turnRate = wrapPI(m.yaw - prevYaw) / dt, spd = st.speed || 0, acc = (spd - m.spd) / dt; m.spd = spd;
  const moving = !st.dead && !st.mounted && !st.roll;
  m.lean = damp(m.lean, moving ? THREE.MathUtils.clamp(-turnRate * spd * 0.018, -0.22, 0.22) : 0, 8, dt);
  m.tilt = damp(m.tilt, moving ? THREE.MathUtils.clamp(acc * 0.012 + spd * 0.012, -0.08, 0.14) : 0, 6, dt);
  r.root.rotation.y = m.yaw; r.root.rotation.z = m.lean; r.root.rotation.x = m.tilt;
  poseRig(r, st);
}
const leaderList = [['elena', 'P.elena'], ['rhea', 'P.rhea'], ['silas', 'P.silas']];
const leaderEnts = leaderList.map(([id]) => ({ id, x: 0, y: 0, a: 0 }));

// shared headlight beam (a long cone pointing along +z, brightest at the lamp) and one real spotlight for the player's car
const BEAM_GEO = (() => {
  const g = new THREE.ConeGeometry(1.8, 13, 24, 6, true).rotateX(-Math.PI / 2).translate(0, 0, 6.5).rotateX(0.06);   // tipped down onto the road
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const k = Math.pow(Math.max(0, 1 - p.getZ(i) / 13), 2.6); c.set([k, k, k], i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g;
})();
const BEAM_MAT = new THREE.MeshBasicMaterial({ color: '#fff1d0', vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
const headSpot = new THREE.SpotLight('#fff1d6', 0, 45, 0.45, 0.5, 1.6);
let headSpotAdded = false;

function drawEntities(dt, camMap) {
  used.clear();
  if (!headSpotAdded) { scene.add(headSpot, headSpot.target); headSpotAdded = true; }
  headSpot.visible = false;
  const near = (e, r = 550) => Math.abs(e.x - camMap.x) < r && Math.abs(e.y - camMap.y) < r;
  const st = (e, extra) => Object.assign({ dt, speed: (e.spd || 0) * S, aiming: !!e.aiming, weapon: e.weaponName, swing: e.swing || 0, hit: e.hitT || 0, cd: e.cd || 0, dead: !!e.dead, armed: !!e.weaponName && e.weaponName !== 'none' }, extra);
  // player (standing on the turret jeep, or hidden while driving)
  if (!player.car) {
    const g = player.gunner, pos = g && g.car ? W(g.car.x, g.car.y, 1.25) : undefined;
    drawPerson(player, CR.CAST.veer, st(player, { roll: player.dodgeT > 0 ? 1 - player.dodgeT / 0.32 : 0, crouch: player.crouch, aiming: player.aiming || rightDown || (mouse.down && player.weapon !== 2), weapon: player.gunner ? 'rifle' : ['pistol', 'rifle', 'pipe'][player.weapon], dead: player.dead }), pos);
  }
  for (const e of enemies) {
    if (e.hidden || !near(e) || e.camera) continue;                   // cameras are drawn as props (see drawFx)
    if (e.fly) {
      let d = drones.get(e); if (!d) { d = buildDrone(); scene.add(d); drones.set(e, d); }
      used.add(e); d.visible = !e.dead; d.position.copy(entPos(e)); d.rotation.y = heading(e.a || 0);
      for (const r of d.userData.rotors) r.rotation.z += dt * 40;
      continue;
    }
    drawPerson(e, null, st(e, { mounted: !!e.mount }));
  }
  for (const n of npcs) if (near(n, 400)) drawPerson(n, null, st(n));
  for (const a of Action.S().allies) if (!a.dead) drawPerson(a, null, st(a, { dead: a.down }));
  for (const a of Action.S().actors) if (!a.bike) drawPerson(a, null, st(a));
  // colony leaders stand at their bases and face you
  for (const L of leaderEnts) {
    const p = P[L.id]; L.x = p.x; L.y = p.y; L.a = Math.atan2(player.y - p.y, player.x - p.x);
    if (near(L)) drawPerson(L, CR.CAST[L.id], { dt, speed: 0 });
  }
  // vehicles (+ cutscene bike actors)
  const allCars = cars.concat(Action.S().actors.filter(a => a.bike).map(a => { a.type = 'bike'; a.hp = 1; a.color = a.bikeColor || '#9a9a9a'; return a; }));
  for (const c of allCars) {
    if (!near(c, 700) || c.hidden) continue;
    const T = VEH[c.type] || VEH.jeep;
    let v = vehs.get(c);
    if (!v) { v = buildVehicle(c.type, T.w * S, T.h * S, c.color || T.color); scene.add(v.g); vehs.set(c, v); }
    used.add(c);
    v.g.visible = true;
    const y = c.type === 'boat' ? (GT.riverDead ? -3 : WATER_Y) + Math.sin(performance.now() / 700 + c.x) * 0.06 : 0;
    v.g.position.copy(W(c.x, c.y, y));
    // Suspension: the body pitches back when accelerating and dives when braking, rolls outward in corners,
    // and bounces a little at speed. Pure presentation: the 2D car still drives exactly the same.
    {
      let m = motion.get(c);
      if (!m) { m = { v: c.v || 0, a: c.a, pitch: 0, roll: 0, ph: Math.random() * 9 }; motion.set(c, m); v.g.rotation.order = 'YXZ'; }
      const sp = (c.v || 0) * S, acc = (sp - m.v) / Math.max(dt, 1e-3), yawRate = wrapPI(c.a - m.a) / Math.max(dt, 1e-3);
      m.v = sp; m.a = c.a;
      const bike = c.type === 'bike', boat = c.type === 'boat';
      const k = c.hp <= 0 ? 0 : 1;
      m.pitch = damp(m.pitch, k * THREE.MathUtils.clamp(-acc * 0.004, -0.06, 0.06), 5, dt);
      // cars roll OUT of the turn; bikes lean INTO it, much harder
      m.roll = damp(m.roll, k * THREE.MathUtils.clamp(yawRate * sp * (bike ? -0.06 : 0.012), bike ? -0.5 : -0.07, bike ? 0.5 : 0.07), bike ? 6 : 4, dt);
      m.ph += dt * Math.abs(sp) * 0.9;
      const bounce = boat ? 0 : Math.sin(m.ph) * Math.min(1, Math.abs(sp) / 20) * 0.012;
      v.g.rotation.y = heading(c.a); v.g.rotation.x = m.pitch + (boat ? Math.sin(performance.now() / 900 + c.x) * 0.03 : 0); v.g.rotation.z = m.roll;
      v.g.position.y += bounce + Math.abs(m.roll) * 0.05;
    }
    if (c.jump > 0) { v.g.position.y += Math.sin(Math.min(1, c.jump) * Math.PI) * 2; c.jump = Math.max(0, c.jump - dt); }
    v.spin += (c.v || 0) * S * dt * 2; for (const w of v.wheels) w.rotation.x = v.spin;
    if (c.hp <= 0) wreckVehicle(v);
    // Headlight beams: driven vehicles at night get two visible light cones + (player only) a real spotlight
    {
      const driven = c === player.car || c.lit || c.scripted || c.id;
      const night = 1 - lighting.state.daylight;
      if (driven && c.hp > 0 && night > 0.1 && c.type !== 'boat') {
        if (!v.beams) {
          v.beams = new THREE.Group();
          for (const s of (c.type === 'bike' ? [0] : [-1, 1])) {
            const b = new THREE.Mesh(BEAM_GEO, BEAM_MAT); b.position.set(s * T.w * S * 0.32, 0.75, T.h * S * 0.5); v.beams.add(b);
          }
          v.g.add(v.beams);
        }
        v.beams.visible = true;
        BEAM_MAT.opacity = 0.055 * night;
        if (c === player.car) {
          headSpot.visible = true; headSpot.intensity = 60 * night;
          headSpot.position.copy(v.g.position).add(new THREE.Vector3(0, 1, 0));
          const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(v.g.quaternion);
          headSpot.target.position.copy(v.g.position).addScaledVector(fwd, 20);
        }
      } else if (v.beams) v.beams.visible = false;
    }
    v.gun.visible = !!c.turret;
    if (c.turret && player.gunner && player.gunner.car === c) v.gun.rotation.y = heading(player.a) - heading(c.a);
    // a rider sits on a bike actor in cutscenes
    if (c.id && c.bike) { const rider = { x: c.x, y: c.y, a: c.a, id: 'rider-' + c.id }; c._rider = c._rider || rider; Object.assign(c._rider, { x: c.x, y: c.y, a: c.a }); drawPerson(c._rider, c.id === 'razor' ? CR.CAST.razor : CR.enemyConfig('scav'), { dt, speed: 0, mounted: true }, W(c.x, c.y, 0.15)); }
  }
  // hide / free what is no longer drawn
  for (const [e, r] of rigs) if (!used.has(e)) { if (!(enemies.includes(e) || npcs.includes(e) || e === player || Action.S().allies.includes(e) || Action.S().actors.includes(e) || leaderEnts.includes(e) || (e.id && String(e.id).startsWith('rider')))) { scene.remove(r.root); rigs.delete(e); } else r.root.visible = false; }
  for (const [c, v] of vehs) if (!used.has(c)) { if (!cars.includes(c) && !Action.S().actors.includes(c)) { scene.remove(v.g); vehs.delete(c); } else v.g.visible = false; }
  for (const [e, d] of drones) if (!used.has(e)) { if (!enemies.includes(e)) { scene.remove(d); drones.delete(e); } else d.visible = false; }
}

// ---- mission buildings (crates, barricades, burning bus, billboard, generator) ----
const crateMat = new THREE.MeshStandardMaterial({ color: '#6b5a40', roughness: 0.9 }), rubbleMat = new THREE.MeshStandardMaterial({ color: '#4a4038', roughness: 1 });
const chemMat = new THREE.MeshStandardMaterial({ color: '#3f6b45', roughness: 0.35, metalness: 0.7 }), fenceMat = new THREE.MeshStandardMaterial({ color: '#8a9094', roughness: 0.5, metalness: 0.8 }), doorMat = new THREE.MeshStandardMaterial({ color: '#8a3a2a', roughness: 0.5, metalness: 0.6 });
const barMat = new THREE.MeshStandardMaterial({ color: '#7a6548', roughness: 0.9 }), genMat = new THREE.MeshStandardMaterial({ color: '#35434a', roughness: 0.5, metalness: 0.6 });
const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
function syncMissionBuildings() {
  const seen = new Set();
  for (const b of buildings) {
    if (!b.mission && !b.bridgeRubble) continue;
    seen.add(b);
    if (!dyn.has(b)) {
      const m = new THREE.Mesh(unitBox, b.chem ? chemMat : b.door ? doorMat : b.fence ? fenceMat : b.crate ? crateMat : b.barricade ? barMat : b.defTarget ? genMat : rubbleMat);
      const h = heightOf(b); m.scale.set(b.w * S, h, b.h * S); m.position.copy(W(b.x + b.w / 2, b.y + b.h / 2, 0)); m.castShadow = m.receiveShadow = true;
      scene.add(m); dyn.set(b, m);
    }
  }
  for (const [b, m] of dyn) if (!seen.has(b)) { scene.remove(m); dyn.delete(b); }
}

// ---- bullets, particles, fires, cones, telegraphs, pickups, ziplines ----
const MAXB = 256, bGeo = new THREE.BufferGeometry(), bPos = new Float32Array(MAXB * 6);
bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
const bLines = new THREE.LineSegments(bGeo, new THREE.LineBasicMaterial({ color: new THREE.Color('#ffd27a').multiplyScalar(4) })); bLines.frustumCulled = false; scene.add(bLines);
const MAXP = 1500, pGeo = new THREE.BufferGeometry(), pPos = new Float32Array(MAXP * 3), pCol = new Float32Array(MAXP * 3);
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const pts = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.28, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false })); pts.frustumCulled = false; scene.add(pts);
const colCache = new Map();
function parseCol(s) {
  let c = colCache.get(s); if (c) return c;
  const m = /rgba?\(([^)]+)\)/.exec(s);
  c = m ? (([r, g, b]) => new THREE.Color(r / 255, g / 255, b / 255))(m[1].split(',').map(Number)) : new THREE.Color(s);
  colCache.set(s, c); return c;
}
const fireMeshes = new Map(), flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff9a3a').multiplyScalar(3.5), transparent: true, opacity: 0.85, depthWrite: false });
const flameGeo = new THREE.ConeGeometry(1, 1.6, 10, 1, true);
const coneMeshes = new Map(), coneMatW = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide });
const extras = new THREE.Group(); scene.add(extras);                       // rebuilt every frame: telegraphs, lasers, ziplines, pickups
const redMat = new THREE.MeshBasicMaterial({ color: '#ff3b2a', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
const medMat = new THREE.MeshStandardMaterial({ color: '#e6e2d8' }), crossMat = new THREE.MeshBasicMaterial({ color: '#c33' });
function drawFx(dt, t) {
  // bullets as tracers at chest height
  let n = 0;
  for (const b of bullets) {
    if (n >= MAXB) break;
    const h = b.elev ? 3 : 1.3, x = b.x * S, z = b.y * S, k = 0.012;
    bPos.set([x, h, z, (b.x - b.vx * k) * S, h, (b.y - b.vy * k) * S], n * 6); n++;
  }
  bGeo.setDrawRange(0, n * 2); bGeo.attributes.position.needsUpdate = true;
  // particles (sparks, blood, smoke, debris) rise a little as they fade
  n = 0;
  for (const p of parts) {
    if (n >= MAXP) break;
    const life = Math.max(0, p.life / p.max), c = parseCol(p.color);
    pPos.set([p.x * S, 0.4 + (1 - life) * 1.4, p.y * S], n * 3); pCol.set([c.r, c.g, c.b], n * 3); n++;
  }
  pGeo.setDrawRange(0, n); pGeo.attributes.position.needsUpdate = pGeo.attributes.color.needsUpdate = true;
  // mission fires: flames + a light each
  const fires = Action.S().fires, alive = new Set(fires);
  for (const f of fires) {
    let m = fireMeshes.get(f);
    if (!m) { m = { mesh: new THREE.Mesh(flameGeo, flameMat), light: pool.add(f.x * S, 1.2, f.y * S, '#ff8a3a', 60, 18, 'fire') }; scene.add(m.mesh); fireMeshes.set(f, m); }
    const r = f.r * S; m.mesh.scale.set(r, r * (1 + Math.sin(t * 11 + f.x) * 0.15), r); m.mesh.position.copy(W(f.x, f.y, r * 0.8));
  }
  for (const [f, m] of fireMeshes) if (!alive.has(f)) { scene.remove(m.mesh); pool.remove(m.light); fireMeshes.delete(f); }
  // stealth vision cones on the ground
  const seen = new Set();
  for (const e of enemies) {
    if (e.dead || !(e.stealth || (e.sniper && e.state !== 'alert' && !e.aggro))) continue;
    seen.add(e);
    let m = coneMeshes.get(e);
    const R = (e.vision || 250) * S * (darkness() > 0.45 ? 0.72 : 1);
    if (!m || m.userData.R !== R) { if (m) scene.remove(m); m = new THREE.Mesh(new THREE.CircleGeometry(R, 24, -0.62, 1.24).rotateX(-Math.PI / 2), coneMatW.clone()); m.userData.R = R; scene.add(m); coneMeshes.set(e, m); }
    const p = entPos(e); m.position.set(p.x, p.y + 0.05, p.z); m.rotation.y = -e.a;
    m.material.color.set(e.det >= 0.45 ? '#ffc83c' : '#ffffff'); m.material.opacity = 0.07 + (e.det || 0) * 0.12;
  }
  for (const [e, m] of coneMeshes) if (!seen.has(e)) { scene.remove(m); coneMeshes.delete(e); }
  // per-frame extras
  for (const c of extras.children) c.geometry !== unitBox && c.geometry.dispose?.();
  extras.clear();
  const line = (a, b, col, op = 0.8) => { const g = new THREE.BufferGeometry().setFromPoints([a, b]); extras.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op }))); };
  for (const e of enemies) {
    if (e.boss && e.atk) {
      const k = e.atk, p = entPos(e);
      if (k.kind === 'charge' && k.t < 0.7) { const m = new THREE.Mesh(new THREE.PlaneGeometry(e.r * 2 * S, 100 * S).rotateX(-Math.PI / 2).translate(0, 0.06, 50 * S), redMat); m.position.copy(p); m.rotation.y = heading(k.a); extras.add(m); }
      if (k.kind === 'slam' && k.t < 1) { const R = 95 * SCALE.reach * S; const m = new THREE.Mesh(new THREE.RingGeometry(R * 0.9, R, 32).rotateX(-Math.PI / 2), redMat); m.position.copy(W(k.tx, k.ty, 0.07)); extras.add(m); }
    }
    if (e.sniper && !e.dead && e.aimT > 0) line(entPos(e).add(new THREE.Vector3(0, 1.4, 0)), camFocus(), '#ff2a1a', 0.3 + e.aimT / 1.4 * 0.6);
  }
  for (const z of Action.S().zips) line(W(z.p1.x, z.p1.y, heightOf(z.b1) + 2), W(z.p2.x, z.p2.y, heightOf(z.b2) + 1.6), '#c9c2b0', 1);
  for (const k of pickups) if (!k.taken) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.5), medMat); m.position.copy(W(k.x, k.y, 0.5 + Math.sin(t * 3) * 0.08)); m.rotation.y = t; extras.add(m); const c = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.36, 0.36), crossMat); c.position.copy(m.position); c.rotation.y = t; extras.add(c); }
  if (Action.S().sab) for (const s of Action.S().sab.targets) if (s.bomb > 0) { const on = (t * (s.bomb < 3 ? 8 : 3) | 0) % 2; const m = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), new THREE.MeshBasicMaterial({ color: on ? new THREE.Color(4, 0.4, 0.2) : '#3a0a08' })); const bp = s.plant || s; m.position.copy(W(bp.x, bp.y, 1)); extras.add(m); }
  for (const h of Action.S().hideSpots) { const m = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 1.2).translate(0, 0.6, 0), new THREE.MeshStandardMaterial({ color: '#2d4a3a', roughness: 0.8, metalness: 0.3 })); m.position.copy(W(h.x, h.y)); extras.add(m); }
  // bursting pipes (valve rigs) glow and show a red danger ring just before they blow; smoke columns
  for (const h of Action.S().hazards) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 3, 12).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: h.warning ? new THREE.Color(2.5, 0.4, 0.2) : '#5a5048', emissive: h.warning ? new THREE.Color(1.2, 0.15, 0.05) : new THREE.Color(0), metalness: 0.6, roughness: 0.5 }));
    m.position.copy(W(h.x, h.y, 1.1)); extras.add(m);
    if (h.warning) { const R = (h.r * SCALE.reach + 8) * S; const ring = new THREE.Mesh(new THREE.RingGeometry(R * 0.92, R, 40).rotateX(-Math.PI / 2), redMat); ring.position.copy(W(h.x, h.y, 0.08)); extras.add(ring); }
  }
  for (const s of Action.S().smoke) { const m = new THREE.Mesh(new THREE.CylinderGeometry(s.r * S, s.r * S * 1.2, 2.6, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#2a2826', transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide })); m.position.copy(W(s.x, s.y, 1.3)); extras.add(m); }
  // floating debris, security cameras, searchlight beams
  for (const d of Action.S().debris) { const m = new THREE.Mesh(new THREE.BoxGeometry(d.r * 2 * S, 0.5, d.r * 0.8 * S), crateMat); m.position.copy(W(d.x, d.y, GT.riverDead ? -2.8 : WATER_Y + 0.15)); m.rotation.y = d.spin; extras.add(m); }
  for (const e of enemies) if (e.camera && !e.hidden) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 6).translate(0, 1.6, 0), fenceMat); pole.position.copy(W(e.x, e.y)); extras.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.5), new THREE.MeshStandardMaterial({ color: '#dfe5e8', metalness: 0.5, roughness: 0.4 })); head.position.copy(W(e.x, e.y, 3.2)); head.rotation.y = heading(e.a); extras.add(head);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), new THREE.MeshBasicMaterial({ color: e.off ? '#222' : new THREE.Color(4, 0.3, 0.2) })); led.position.copy(W(e.x, e.y, 3.35)); extras.add(led);
  }
  for (const s of Action.S().searchlights) if (!s.off) {
    const beam = new THREE.Mesh(new THREE.ConeGeometry(s.r * S, 9, 24, 1, true).translate(0, 4.5, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.55, 1.3), transparent: true, opacity: 0.12 + s.det * 0.15, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    beam.position.copy(W(s.x, s.y, 0)); extras.add(beam);
    const spot = new THREE.Mesh(new THREE.CircleGeometry(s.r * S, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.1, 1.7), transparent: true, opacity: 0.45, depthWrite: false })); spot.position.copy(W(s.x, s.y, 0.07)); extras.add(spot);
  }
  for (const tu of Action.S().turrets) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1, 0.9).translate(0, 0.5, 0), genMat); m.position.copy(W(tu.x, tu.y)); extras.add(m); }
}

// ---- explosions: a flash of light, a fireball and a camera kick ----
const booms = [];
const _explode = explode;
window.explode = (x, y) => {
  _explode(x, y);
  const light = pool.add(x * S, 2, y * S, '#ffb050', 400, 30, 'glow');
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb050').multiplyScalar(5), transparent: true }));
  ball.position.copy(W(x, y, 1)); scene.add(ball);
  booms.push({ light, ball, t: 0 }); post.kick(0.8);
};
function updateBooms(dt) {
  for (const b of booms) { b.t += dt; b.ball.scale.setScalar(1 + b.t * 9); b.ball.material.opacity = Math.max(0, 1 - b.t * 2.5); }
  for (let i = booms.length - 1; i >= 0; i--) if (booms[i].t > 0.5) { scene.remove(booms[i].ball); pool.remove(booms[i].light); booms.splice(i, 1); }
}

// ---- screen-space overlay on the transparent 2D canvas: names, health, detection ----
const proj = new THREE.Vector3();
function toScreen(v) { proj.copy(v).project(camera); if (proj.z > 1) return null; return [(proj.x + 1) / 2 * cv.width, (1 - proj.y) / 2 * cv.height]; }
function drawOverlay() {
  const k = DPR;
  ctx.font = `600 ${11 * k}px IBM Plex Mono, monospace`; ctx.textAlign = 'center';
  const bar = (p, f, col, w = 26) => { ctx.fillStyle = '#000a'; ctx.fillRect(p[0] - w / 2 * k, p[1], w * k, 4 * k); ctx.fillStyle = col; ctx.fillRect(p[0] - w / 2 * k, p[1], w * k * Math.max(0, f), 4 * k); };
  for (const e of enemies) {
    if (e.dead || e.hidden) continue;
    const d = Math.hypot(e.x - player.x, e.y - player.y); if (d > 400) continue;
    const p = toScreen(entPos(e).add(new THREE.Vector3(0, e.fly ? 0.6 : 2.1, 0))); if (!p) continue;
    if (e.hp < e.maxHp) bar(p, e.hp / e.maxHp, e.fly ? '#a898ff' : '#e0533f');
    if ((e.stealth || e.sniper || e.state === 'alert') && (e.det || 0) > 0.02) {
      const col = e.det >= 1 ? '#e0533f' : e.det >= 0.45 ? '#f2c93b' : '#ffffff';
      ctx.strokeStyle = '#0008'; ctx.lineWidth = 5 * k; ctx.beginPath(); ctx.arc(p[0], p[1] - 12 * k, 7 * k, 0, 6.28); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 3 * k; ctx.beginPath(); ctx.arc(p[0], p[1] - 12 * k, 7 * k, -Math.PI / 2, -Math.PI / 2 + e.det * 6.28); ctx.stroke();
      if (e.det >= 0.45) { ctx.fillStyle = col; ctx.fillText(e.det >= 1 ? '!' : '?', p[0], p[1] - 8 * k); }
    }
    if (e.planter && e.plantT > 0) bar([p[0], p[1] + 8 * k], e.plantT / 4, '#ff9a3a');
  }
  for (const a of Action.S().allies) if (!a.dead) { const p = toScreen(W(a.x, a.y, 2.2)); if (p) { ctx.fillStyle = '#4fb3a9'; ctx.fillText(a.down ? `${a.name} ▼ ${Math.ceil(a.bleed)}s` : a.name, p[0], p[1]); if (!a.down && a.hp < a.maxHp) bar([p[0], p[1] + 4 * k], a.hp / a.maxHp, '#4fb3a9'); } }
  for (const a of Action.S().actors) if (a.label) { const p = toScreen(W(a.x, a.y, a.bike ? 2 : 2.2)); if (p) { ctx.fillStyle = a.labelColor || '#dde0d7'; ctx.fillText(a.label, p[0], p[1]); } }
  for (const L of leaderEnts) { if (Math.hypot(L.x - player.x, L.y - player.y) > 300) continue; const p = toScreen(W(L.x, L.y, 2.3)); if (p) { ctx.fillStyle = { elena: '#e46a78', rhea: '#d9824a', silas: '#c9b04a' }[L.id]; ctx.fillText({ elena: 'Elena', rhea: 'Rhea', silas: 'Silas' }[L.id], p[0], p[1]); } }
  for (const c of cars) if ((c.escort || c.silas) && c.hp > 0) { const p = toScreen(W(c.x, c.y, 3.6)); if (p) bar(p, c.hp / (c.maxHp || VEH[c.type].hp), c.silas ? '#c9b04a' : '#4fb3a9', 48); }
  if (Action.S().sab) for (const s of Action.S().sab.targets) if (s.bomb > 0) { const bp = s.plant || s, p = toScreen(W(bp.x, bp.y, 1.6)); if (p) { ctx.fillStyle = '#fff'; ctx.fillText(s.bomb.toFixed(1) + 's', p[0], p[1]); } }
  ctx.textAlign = 'left';
  if (player.hurtT > 0) { ctx.fillStyle = `rgba(200,30,20,${player.hurtT})`; ctx.fillRect(0, 0, cv.width, cv.height); }
}

// ---------------------------------------------------------------------
// Public API used by game.js
// ---------------------------------------------------------------------
let lastT = performance.now(), lodTimer = 0, lastWeather = '';
window.R3 = {
  /** Mouse-look while the pointer is locked. */
  look(e) { if (document.pointerLockElement !== cv) return; cam.yaw -= e.movementX * 0.0024 * (rightDown ? 0.55 : 1); cam.pitch = Math.max(-0.5, Math.min(1.2, cam.pitch + e.movementY * 0.0024)); cam.lastLook = performance.now(); },
  /** WASD relative to the camera: returns the move direction in map axes. */
  rel(mx, my) {
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    return [rx * mx + fx * -my, rz * mx + fz * -my];
  },
  aim: () => aimPt,
  setPreset(name) { presetName = name; preset = PRESETS[name]; savePresetName(name); applyPreset(renderer, preset); lighting.setPreset(preset); pool.setCount(preset.lights); post.setPreset(preset); camera.far = preset.viewDist; camera.updateProjectionMatrix(); renderer.toneMapping = preset.post ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping; },
  frame() {
    const now = performance.now(), dt = Math.min(0.05, (now - lastT) / 1000); lastT = now; const t = now / 1000;
    // release the mouse whenever a menu / dialogue / decision needs it
    if ((!state.running || state.modal) && document.pointerLockElement === cv) document.exitPointerLock();
    if (!state.running) { renderer.clear(); return; }
    updateCamera(dt);
    computeAim();
    const camMap = { x: camera.position.x / S, y: camera.position.z / S };
    drawEntities(dt, camMap);
    syncMissionBuildings();
    drawFx(dt, t);
    updateBooms(dt);
    const m = Mission.target(); marker.set(m ? { x: m.x, y: m.y } : null); marker.update(t);
    // world simulation visuals driven by the game state
    if (state.weather !== lastWeather) { lastWeather = state.weather; weather.set(state.weather); }
    weather.riverDead = GT.riverDead;
    const wx = weather.update(dt, t, camera, lighting.state);
    lighting.update(state.clock, camFocus(), dt, wx);
    pool.update(camera.position, t, dt, lighting.state.daylight);
    updateNightLights();
    windUniform.value = t;
    city.water.update(t, GT.river / 100, GT.riverDead);
    details.update(t, dt, camera.position, 1 + wx.fogMul * 0.1, 1 - lighting.state.daylight);
    districts.update(t, GT.riverDead);
    for (const f of city.fires) f.flame.scale.y = 0.8 + 0.25 * Math.sin(t * 13 + f.seed) * Math.sin(t * 7.3 + f.seed * 2);
    lodTimer -= dt; if (lodTimer <= 0) { lodTimer = 0.25; updateLOD(camera.position, preset.detailDist); }
    // render
    bgCam.position.copy(camera.position); bgCam.quaternion.copy(camera.quaternion);
    if (bgCam.fov !== camera.fov) { bgCam.fov = camera.fov; bgCam.updateProjectionMatrix(); }
    if (preset.post) {
      // depth of field: while aiming, focus on the aim point; in cutscenes, on the scene being shown
      const cs = Action.camTarget();
      const focus = cs ? camera.position.distanceTo(W(cs.x, cs.y, 1.4)) : Math.max(2, camera.position.distanceTo(W(aimPt.x, aimPt.y, 1.2)));
      post.render({ dt, exposure: renderer.toneMappingExposure, daylight: lighting.state.daylight, golden: lighting.state.golden, sunDir: lighting.state.sunDir,
        wet: wetU.value, haze: Math.min(1, (wx.fogMul - 1) / 4), aiming: rightDown && !player.car, focusDist: focus,
        cinematic: !!Action.camTarget(), dawnEnding: !!state.dawn });
    } else { renderer.clear(); renderer.render(bg, bgCam); renderer.clearDepth(); renderer.render(scene, camera); }
    drawOverlay();
  },
};
addEventListener('resize', () => { applyPreset(renderer, preset); camera.aspect = bgCam.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); bgCam.updateProjectionMatrix(); post.setSize(innerWidth, innerHeight); });
document.body.classList.add('mode3d');
window.dispatchEvent(new Event('r3-ready'));
