/* =====================================================================
   3D CHARACTERS
   One articulated rig per person (pivots at hips, knees, shoulders,
   elbows), coloured from the SAME config objects the 2D game uses
   (CR.CAST / CR.enemyConfig / CR.randomSurvivor: skin, hair, jacket...).
   The rig is posed every frame from the simulation's state:
     speed -> walk/run cycle     aiming -> arms forward + gun
     swing -> melee arc          hitT   -> flinch
     dead  -> falls and lies     crouch -> lowered hips
   Geometries are shared; materials are cached per colour, so 60 people
   cost ~60 small groups, and far ones are hidden (distance culling).
   ===================================================================== */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const cap = (r, len) => new THREE.CapsuleGeometry(r, len, 6, 12).translate(0, -(len / 2 + r) + r * 0.6, 0);   // hangs down from its pivot
const G = {
  limb: cap(0.5, 1).scale(1, 0.5, 1),
  box: new THREE.BoxGeometry(1, 1, 1),
  rbox: new THREE.CapsuleGeometry(0.5, 0.35, 6, 14).scale(1, 0.72, 1),                     // rounded torso block
  sphere: new THREE.SphereGeometry(0.5, 16, 12),
  head: new THREE.SphereGeometry(0.115, 24, 18),
  hair: new THREE.SphereGeometry(0.124, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.55),
  hand: new THREE.SphereGeometry(0.05, 10, 8),
  shoe: new THREE.CapsuleGeometry(0.5, 0.9, 4, 10).rotateX(Math.PI / 2),
  pistol: new THREE.BoxGeometry(0.05, 0.1, 0.24).translate(0, 0, 0.1),
  rifle: new THREE.BoxGeometry(0.06, 0.1, 0.8).translate(0, 0, 0.3),
  pipe: new THREE.CylinderGeometry(0.025, 0.025, 0.8, 8).rotateX(Math.PI / 2).translate(0, 0, 0.32),
};
const matCache = new Map();
function M(col, rough = 0.85, metal = 0, opacity = 1) {
  const k = col + rough + metal + opacity;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color: col, roughness: rough, metalness: metal, transparent: opacity < 1, opacity }));
  return matCache.get(k);
}
const gunMat = new THREE.MeshStandardMaterial({ color: '#1b1c1e', roughness: 0.4, metalness: 0.8 });
const shade = (hex, k) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();

/** Face + hair (head centre at y 0.18 above the neck pivot). Shared by both rig types. */
function buildHead(cfg, neck, add) {
  const acc = cfg.acc || [];
  const skinCol = cfg.skin || '#b98a67', hairCol = cfg.hairColor || '#15120f', skin = M(skinCol, 0.55);
  add(G.head, skin, neck, 0.88, 1.08, 0.98, 0, 0.18, 0.01);
  add(G.sphere, skin, neck, 0.15, 0.1, 0.14, 0, 0.1, 0.035);                                            // jaw / chin
  add(G.box, skin, neck, 0.025, 0.05, 0.035, 0, 0.17, 0.115);                                           // nose bridge
  add(G.sphere, skin, neck, 0.035, 0.028, 0.03, 0, 0.145, 0.125);                                       // nose tip
  for (const s of [-1, 1]) {
    add(G.sphere, skin, neck, 0.025, 0.045, 0.02, 0.1 * s, 0.18, 0);                                     // ears
    add(G.sphere, M('#f1ece4', 0.3), neck, 0.028, 0.016, 0.01, 0.04 * s, 0.2, 0.105);                    // eye white
    add(G.sphere, M('#2b1d14', 0.2), neck, 0.014, 0.014, 0.008, 0.04 * s, 0.2, 0.11);                    // iris
    const brow = add(G.box, M(hairCol, 0.9), neck, 0.045, 0.012, 0.01, 0.042 * s, 0.228, 0.106); brow.rotation.z = -0.12 * s;
  }
  add(G.box, M(shade(skinCol, 0.7), 0.6), neck, 0.05, 0.01, 0.01, 0, 0.1, 0.112);                        // mouth
  if (acc.includes('stubble')) add(G.sphere, M(hairCol, 1, 0, 0.5), neck, 0.158, 0.11, 0.146, 0, 0.1, 0.037);
  if (acc.includes('glasses')) for (const s of [-1, 1]) add(G.box, M('#222', 0.3, 0.6), neck, 0.05, 0.03, 0.005, 0.042 * s, 0.2, 0.12);
  const hairMat = M(hairCol, 0.6);
  if (cfg.hair === 'slick') {                                                                            // slicked back: tight to the skull, fuller at the back
    add(G.hair, hairMat, neck, 0.93, 0.8, 1.0, 0, 0.225, -0.02);
    add(G.sphere, hairMat, neck, 0.2, 0.13, 0.17, 0, 0.215, -0.04);
    for (const s of [-1, 1]) add(G.sphere, M(shade(hairCol, 2.4), 0.7), neck, 0.03, 0.06, 0.08, 0.1 * s, 0.215, -0.01);   // grey at the temples
  } else if (cfg.hair !== 'bald') add(G.hair, hairMat, neck, cfg.hair === 'mohawk' ? 0.4 : 0.95, 1.05, 1.02, 0, 0.19, -0.01);
  if (acc.includes('helmet')) add(G.hair, M('#dfe5e8', 0.4), neck, 1.1, 1.1, 1.1, 0, 0.19, 0);
  if (acc.includes('beard')) add(G.box, M('#d8d0c0'), neck, 0.16, 0.12, 0.06, 0, 0.08, 0.1);
}

/**
 * Builds a rig from a 2D character config. Height ~1.78 m x cfg.height.
 * Realistic proportions: rounded limbs, tapered torso (shoulders wider than
 * the waist), a face (jaw, nose, brows, eyes, ears, mouth), collar, belt, shoes.
 */
function buildProcRig(cfg = {}) {
  const h = cfg.height || 1, acc = cfg.acc || [];
  const build = cfg.body === 'heavy' ? 1.18 : cfg.body === 'slim' ? 0.88 : 1;
  const skinCol = cfg.skin || '#b98a67', hairCol = cfg.hairColor || '#15120f';
  const skin = M(skinCol, 0.55), top = M(cfg.jacket || cfg.coat || cfg.vest || cfg.top || '#4a4a44', 0.8);
  const shirtCol = cfg.top || '#3b3e36', shirt = M(shirtCol, 0.75), pants = M(cfg.pants || '#2b2d2c', 0.85), boots = M('#18161a', 0.45, 0.1);
  const sleeves = cfg.jacket || cfg.coat ? top : shirt;
  const root = new THREE.Group(); root.scale.setScalar(h);
  const add = (geo, mat, parent, sx, sy, sz, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };

  const hips = new THREE.Group(); hips.position.y = 0.92; root.add(hips);
  const legs = [-1, 1].map(s => {
    const g = new THREE.Group(); g.position.set(0.1 * s * build, 0, 0); hips.add(g);
    add(G.limb, pants, g, 0.17 * build, 0.47, 0.18 * build);
    const shin = new THREE.Group(); shin.position.y = -0.46; g.add(shin);
    add(G.limb, pants, shin, 0.135 * build, 0.43, 0.145 * build);
    add(G.shoe, boots, shin, 0.11, 0.09, 0.2, 0, -0.44, 0.05);
    return { g, shin };
  });
  const spine = new THREE.Group(); hips.add(spine);
  add(G.rbox, pants, spine, 0.35 * build, 0.24, 0.21 * build, 0, 0.04, 0);                             // pelvis
  add(G.box, M('#1a1714', 0.4, 0.3), spine, 0.36 * build, 0.045, 0.22 * build, 0, 0.14, 0);              // belt
  add(G.box, M('#b9a57a', 0.3, 0.9), spine, 0.05, 0.035, 0.01, 0, 0.14, 0.112 * build);                  // buckle
  add(G.rbox, top, spine, 0.38 * build, 0.3, 0.22 * build, 0, 0.26, 0);                                  // waist taper
  const chest = add(G.rbox, top, spine, 0.46 * build, 0.5, 0.25 * build, 0, 0.45, 0);                    // rib cage
  chest.userData.sy = 0.5;
  for (const s of [-1, 1]) add(G.sphere, sleeves, spine, 0.13 * build, 0.1, 0.13 * build, 0.22 * s * build, 0.64, 0);    // shoulders
  if (cfg.coat) add(G.box, top, spine, 0.46 * build, 0.52, 0.27 * build, 0, 0.0, 0);                    // long coat skirt (Elena, Silas)
  if (cfg.jacket || cfg.coat) add(G.box, shirt, spine, 0.14, 0.42, 0.02, 0, 0.44, 0.128 * build);       // shirt under an open jacket
  else for (let i = 0; i < 4; i++) add(G.sphere, M(shade(shirtCol, 0.7), 0.4), spine, 0.014, 0.014, 0.008, 0, 0.62 - i * 0.12, 0.128 * build);   // buttons
  for (const s of [-1, 1]) { const c = add(G.box, shirt, spine, 0.09, 0.05, 0.02, 0.045 * s, 0.7, 0.09 * build); c.rotation.z = 0.5 * s; c.rotation.x = -0.35; }   // collar
  if (acc.includes('tie')) add(G.box, M('#2a2f3a', 0.5), spine, 0.05, 0.36, 0.015, 0, 0.5, 0.135 * build);

  const neck = new THREE.Group(); neck.position.y = 0.72; spine.add(neck);
  add(G.limb, skin, neck, 0.1, 0.1, 0.1, 0, 0.1, 0);
  buildHead(cfg, neck, add);
  const arms = [-1, 1].map(s => {
    const g = new THREE.Group(); g.position.set(0.28 * s * build, 0.63, 0); spine.add(g);
    add(G.limb, sleeves, g, 0.12 * build, 0.32, 0.125 * build);
    const fore = new THREE.Group(); fore.position.y = -0.31; g.add(fore);
    add(G.limb, cfg.rolled ? skin : sleeves, fore, 0.1 * build, 0.28, 0.105 * build);
    add(G.hand, skin, fore, 0.95, 1.25, 0.7, 0, -0.32, 0);
    add(G.hand, skin, fore, 0.35, 0.6, 0.35, -0.03 * s, -0.3, 0.035);                                    // thumb
    if (s < 0 && acc.includes('watch')) add(G.box, M('#c9c3b5', 0.25, 0.9), fore, 0.11, 0.03, 0.11, 0, -0.25, 0);
    return { g, fore };
  });
  const guns = { pistol: new THREE.Mesh(G.pistol, gunMat), rifle: new THREE.Mesh(G.rifle, gunMat), pipe: new THREE.Mesh(G.pipe, M('#6a6660', 0.5, 0.7)) };
  for (const k in guns) { guns[k].position.set(0, -0.33, 0.02); guns[k].rotation.x = -Math.PI / 2; guns[k].visible = false; guns[k].castShadow = true; arms[1].fore.add(guns[k]); }
  return { root, hips, spine, legs, arms, neck, chest, guns, phase: Math.random() * 6, deadT: 0, aimK: 0, breathe: Math.random() * 6 };
}

/**
 * Pose a rig from simulation state.
 * st = { speed (m/s), aiming, weapon, swing 0..1, hit, dead, crouch, sit, mounted, dt }
 */
function poseProcRig(r, st) {
  const dt = st.dt;
  r.breathe += dt * 2;
  if (st.dead) {                                                     // fall backwards and lie still
    r.deadT = Math.min(1, r.deadT + dt * 2.6);
    r.root.rotation.x = -Math.PI / 2 * r.deadT; r.root.position.y = r.root.position.y * (1 - r.deadT) + 0.15 * r.deadT;
    for (const a of r.arms) { a.g.rotation.x = -0.4 * r.deadT; a.g.rotation.z = 0; }
    for (const g of Object.values(r.guns)) g.visible = false;
    return;
  }
  r.deadT = 0; r.root.rotation.x = st.roll ? Math.PI * 2 * st.roll : 0;          // dodge: a full forward roll
  if (st.roll) r.root.position.y += Math.sin(Math.PI * st.roll) * 0.35;
  const sp = st.speed || 0, moving = sp > 0.3;
  r.phase += sp * dt * 2.3;
  const amp = Math.min(0.9, sp * 0.16), sw = Math.sin(r.phase);
  r.aimK += ((st.aiming ? 1 : 0) - r.aimK) * Math.min(1, dt * 12);
  const crouch = st.crouch ? 1 : 0;
  r.hips.position.y = 0.92 - 0.32 * crouch - (st.mounted ? 0.35 : 0) + (moving ? Math.abs(Math.cos(r.phase)) * 0.035 * Math.min(1, sp / 3) : 0);
  r.spine.rotation.x = (sp > 5 ? 0.2 : moving ? 0.06 : 0) + 0.35 * crouch - (st.hit > 0 ? 0.3 : 0);
  r.legs.forEach((l, i) => {
    const s = i ? -sw : sw;
    if (st.mounted || st.sit) { l.g.rotation.x = -1.3; l.shin.rotation.x = 1.4; return; }
    l.g.rotation.x = s * amp - 0.9 * crouch;
    l.shin.rotation.x = Math.max(0, -s) * amp * 1.2 + 1.3 * crouch;
  });
  const swing = st.swing || 0;
  r.arms.forEach((a, i) => {
    const walkRot = (i ? sw : -sw) * amp * 0.8, aimRot = -Math.PI / 2 + 0.1;
    a.g.rotation.x = walkRot * (1 - r.aimK) + aimRot * r.aimK;
    a.g.rotation.z = (i ? 0.06 : -0.06) * (1 - r.aimK) + (i ? -0.28 : 0.3) * r.aimK;
    a.fore.rotation.x = -0.25 * (1 - r.aimK);
    if (i === 1 && swing > 0) { a.g.rotation.x = -2.6 + swing * 2.6; a.g.rotation.z = -0.3; }   // overhead melee swing
    if (st.mounted) { a.g.rotation.x = -1.1; a.fore.rotation.x = -0.3; }
  });
  r.chest.scale.y = r.chest.userData.sy * (1 + 0.02 * Math.sin(r.breathe));
  const w = st.weapon;
  r.guns.pistol.visible = w === 'pistol' && (r.aimK > 0.3 || st.armed);
  r.guns.rifle.visible = w === 'rifle' && (r.aimK > 0.3 || st.armed);
  r.guns.pipe.visible = w === 'pipe';
}

/** Small quad-rotor drone for Helix drones (enemy type 'drone'). */
export function buildDrone() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.7), new THREE.MeshStandardMaterial({ color: '#dfe5e8', roughness: 0.35, metalness: 0.4 }));
  body.castShadow = true; g.add(body);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#a898ff').multiplyScalar(3) })); eye.position.set(0, -0.12, 0.34); g.add(eye);
  const rotors = [];
  for (const [ax, az] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const rot = new THREE.Mesh(new THREE.CircleGeometry(0.34, 16), new THREE.MeshBasicMaterial({ color: '#222', transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
    rot.rotation.x = -Math.PI / 2; rot.position.set(ax * 0.45, 0.12, az * 0.45); g.add(rot); rotors.push(rot);
  }
  g.userData.rotors = rotors;
  return g;
}

// =====================================================================
// SKINNED CHARACTERS (clothed, animated)
//   assets/people/*.glb : Quaternius "Ultimate Animated Character Pack"
//   (CC0). Every outfit shares one skeleton and 24 motion clips: idle,
//   walk, run, strafe, gun idle / point / shoot, run-and-shoot, punches,
//   kicks, roll, hit reactions, death. Skin and hair are recoloured per
//   character; the outfit is picked from the character's role.
// A small state machine picks one "base" clip per frame from the
// simulation state and crossfades to it; one-shots (shot, punch, hit)
// play on top. Until the files load, the procedural rig is used.
// =====================================================================
const OUTFITS = ['Casual2', 'Suit', 'Worker', 'Farmer', 'Swat', 'Punk', 'Casual', 'Adventurer'];
const MODELS = {};
const loader = new GLTFLoader();
for (const name of OUTFITS) {
  const ready = g => {
    g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    g.clips = Object.fromEntries(g.animations.map(c => [c.name.replace(/^.*\|/, ''), c]));
    const box = new THREE.Box3().setFromObject(g.scene);                  // normalise to 1.78 m tall
    g.fit = 1.78 / Math.max(0.1, box.max.y - box.min.y);
    MODELS[name] = g;
  };
  // Hosts that can't serve .glb get <name>.glb.js (the same file as base64 in a JS module) instead.
  const fallback = () => import(/* @vite-ignore */ new URL('assets/people/' + name + '.glb.js', import.meta.url).href)
    .then(m => { const bin = Uint8Array.from(atob(m.default), c => c.charCodeAt(0)); loader.parse(bin.buffer, '', ready, () => console.warn('Character model failed to load:', name)); })
    .catch(() => console.warn('Character model failed to load:', name));
  loader.load(new URL('assets/people/' + name + '.glb', import.meta.url).href, ready, undefined, fallback);
}
const hashStr = s => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };
const isFemale = cfg => cfg.female ?? (cfg.hair === 'long' || cfg.hair === 'bun' || cfg.hair === 'braid');
function outfitFor(cfg) {
  if (cfg.outfit) return cfg.outfit;
  if ((cfg.acc || []).includes('helmet')) return 'Swat';                // Helix troopers
  const h = hashStr(JSON.stringify([cfg.skin, cfg.top, cfg.hair, cfg.pants]));
  if (isFemale(cfg)) return ['Punk', 'Casual', 'Adventurer'][h % 3];
  if (cfg.jacket && cfg.top && /tie/.test((cfg.acc || []).join())) return 'Suit';
  return ['Casual2', 'Worker', 'Farmer', 'Casual2'][h % 4];
}
const pickModel = cfg => MODELS[outfitFor(cfg)] || null;
/** True when a skinned model is available for this character config. */
export const modelReady = cfg => !!pickModel(cfg || {});

const recolorCache = new Map();
function recolor(base, col) {
  const k = base.uuid + col;
  if (!recolorCache.has(k)) { const m = base.clone(); m.color = new THREE.Color(col); recolorCache.set(k, m); }
  return recolorCache.get(k);
}

// our state -> clip name in the pack
const CLIP = { idle: 'Idle_Neutral', walk: 'Walk', jog: 'Run', sprint: 'Run', crouch: 'Idle_Gun', crouchWalk: 'Walk',
  armed: 'Idle_Gun', aim: 'Idle_Gun_Pointing', aimMove: 'Run_Shoot', drive: 'Idle_Neutral', sit: 'Idle_Neutral', dead: 'Death', roll: 'Roll',
  shoot: 'Idle_Gun_Shoot', punch: 'Punch_Right', jab: 'Punch_Left', hook: 'Kick_Right', hit: 'HitRecieve', talk: 'Wave' };

function buildSkinnedRig(cfg = {}) {
  const MODEL = pickModel(cfg);
  const root = new THREE.Group();
  root.scale.setScalar((cfg.height || 1) * MODEL.fit);
  const body = SkeletonUtils.clone(MODEL.scene); root.add(body);
  body.traverse(o => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const out = mats.map(m => {
      const n = (m && m.name) || '';
      if (/^Skin/i.test(n) && cfg.skin) return recolor(m, /Darker/i.test(n) ? '#' + new THREE.Color(cfg.skin).multiplyScalar(0.8).getHexString() : cfg.skin);
      if (/^Hair/i.test(n) && cfg.hairColor) return recolor(m, cfg.hairColor);
      return m;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
    if (cfg.body === 'heavy') o.scale.x = o.scale.z = 1.1;
    if (cfg.body === 'slim') o.scale.x = o.scale.z = 0.94;
  });
  const hand = body.getObjectByName('WristR') || body.getObjectByName('Wrist.R') || body.getObjectByName('Wrist_R');   // three.js strips the dot from bone names
  const mixer = new THREE.AnimationMixer(body), act = {};
  for (const [state, clipName] of Object.entries(CLIP)) {
    const clip = MODEL.clips[clipName]; if (!clip) continue;
    const a = mixer.clipAction(clip);
    if (['dead', 'roll', 'shoot', 'punch', 'jab', 'hook', 'hit'].includes(state)) { a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; }
    act[state] = a;
  }
  // weapon in the right hand (bone space is scaled with the skeleton, so undo that)
  const guns = { pistol: new THREE.Mesh(G.pistol, gunMat), rifle: new THREE.Mesh(G.rifle, gunMat), pipe: new THREE.Mesh(G.pipe, M('#6a6660', 0.5, 0.7)) };
  const grip = new THREE.Group(); root.add(grip);                      // follows the hand in world space every frame (see poseSkinned)
  for (const g of Object.values(guns)) { g.visible = false; g.castShadow = true; g.rotation.x = -Math.PI / 2; g.position.y = 0.05; grip.add(g); }   // barrel along the fingers
  const r = { skinned: true, root, body, mixer, act, guns, grip, hand, base: null, oneShot: null, lastCd: 0, deadT: 0, aimK: 0 };
  play(r, 'idle', 0); mixer.update(Math.random() * 3);
  return r;
}

const _hp = new THREE.Vector3(), _hq = new THREE.Quaternion(), _rq = new THREE.Quaternion();
function play(r, state, fade = 0.2) {
  const a = r.act[state] || r.act.idle; if (!a || r.base === a) return;
  a.reset().setEffectiveWeight(1).fadeIn(fade).play();
  if (r.base) r.base.fadeOut(fade);
  r.base = a;
}
function oneShot(r, state, timeScale = 1) {
  const a = r.act[state]; if (!a) return;
  if (r.oneShot && r.oneShot !== a) r.oneShot.fadeOut(0.08);
  a.reset().setEffectiveWeight(1).fadeIn(0.06); a.timeScale = timeScale; a.play();
  r.oneShot = a; r.oneShotT = a.getClip().duration / timeScale;
}

function poseSkinned(r, st) {
  const dt = st.dt;
  // ---- death: play the fall once and hold the last frame ----
  if (st.dead) {
    if (!r.deadNow) { r.deadNow = true; if (r.act.dead) { if (r.oneShot) r.oneShot.stop(); r.oneShot = null; play(r, 'dead', 0.1); } }
    if (!r.act.dead) { r.deadT = Math.min(1, r.deadT + dt * 2.6); r.root.rotation.x = -Math.PI / 2 * r.deadT; }
    r.mixer.update(dt);
    for (const g of Object.values(r.guns)) g.visible = false;
    return;
  }
  if (r.deadNow) { r.deadNow = false; r.deadT = 0; r.root.rotation.x = 0; r.base = null; }

  // ---- pick the base clip from the simulation state ----
  const sp = st.speed || 0, armed = st.weapon === 'pistol' || st.weapon === 'rifle';
  r.aimK += ((st.aiming ? 1 : 0) - r.aimK) * Math.min(1, dt * 12);
  let state;
  if (st.roll && r.act.roll) state = 'roll';
  else if (st.mounted) state = r.act.drive ? 'drive' : 'idle';
  else if (st.sit) state = r.act.sit ? 'sit' : 'idle';
  else if (st.crouch) state = sp > 0.3 ? 'crouchWalk' : 'crouch';
  else if (st.aiming && armed) state = sp < 1.4 ? 'aim' : 'aimMove';    // gun up: standing, or run-and-shoot
  else if (sp > 5.8) state = 'sprint';                                  // (3D walking pace is ~4.8 m/s, a jog)
  else if (sp > 1.4) state = 'jog';
  else if (sp > 0.25) state = 'walk';
  else state = st.armed && armed ? 'armed' : 'idle';
  if (!r.act[state]) state = sp > 0.25 ? 'walk' : 'idle';
  play(r, state, state === 'roll' ? 0.06 : 0.2);
  r.body.position.y = (st.crouch ? -0.32 : st.mounted ? -0.45 : 0) / r.root.scale.y;   // crouch / seated in a vehicle
  // playback speed follows the real ground speed so feet don't slide
  const base = r.base;
  if (base) base.timeScale = state === 'walk' ? Math.min(1.5, Math.max(0.6, sp / 1.4)) : state === 'jog' ? Math.min(1.5, Math.max(0.7, sp / 3.6)) : state === 'sprint' ? Math.min(1.4, Math.max(0.85, sp / 6.5)) : state === 'crouchWalk' ? Math.min(1.8, Math.max(0.6, sp / 1.6)) : state === 'roll' ? 1.6 : 1;

  // ---- one-shots layered on top: shot recoil, melee, hit flinch ----
  const cd = st.cd || 0;
  if (armed && cd > r.lastCd + 0.15 && (st.aiming || r.aimK > 0.3)) oneShot(r, 'shoot', 1.6);
  r.lastCd = cd;
  if (st.swing > 0 && !r.swinging) { r.swinging = true; oneShot(r, ['punch', 'jab', 'hook'][Math.floor(Math.random() * 3)], 1.7); }
  if (!st.swing) r.swinging = false;
  if (st.hit > 0.1 && !r.hitNow) { r.hitNow = true; if (!r.oneShot || !r.oneShot.isRunning()) oneShot(r, 'hit', 1.8); }
  if (!(st.hit > 0)) r.hitNow = false;
  if (r.oneShot) { r.oneShotT -= dt; if (r.oneShotT <= 0.05) { r.oneShot.fadeOut(0.15); r.oneShot = null; } }

  r.mixer.update(dt);
  if (r.hand) {                                                          // weapon: glue to the right hand
    r.root.updateWorldMatrix(true, true);
    r.hand.getWorldPosition(_hp); r.root.worldToLocal(_hp); r.grip.position.copy(_hp);
    r.root.getWorldQuaternion(_rq).invert(); r.hand.getWorldQuaternion(_hq); r.grip.quaternion.copy(_rq.multiply(_hq));
    r.grip.scale.setScalar(1 / r.root.scale.x);
  }
  const w = st.weapon, show = r.aimK > 0.3 || st.armed || state === 'aim';
  r.guns.pistol.visible = w === 'pistol' && show;
  r.guns.rifle.visible = w === 'rifle' && show;
  r.guns.pipe.visible = w === 'pipe';
}

/** Builds a character: the skinned human once the models are loaded, the procedural rig before that. */
export function buildRig(cfg = {}) { return pickModel(cfg) ? buildSkinnedRig(cfg) : Object.assign(buildProcRig(cfg), { proc: true }); }
/** Pose a rig from simulation state: { speed (m/s), aiming, weapon, swing 0..1, hit, dead, crouch, sit, mounted, roll 0..1, cd, dt } */
export function poseRig(r, st) { if (r.skinned) poseSkinned(r, st); else poseProcRig(r, st); }
