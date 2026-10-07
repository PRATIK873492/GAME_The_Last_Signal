/* =====================================================================
   THE LAST SIGNAL - top-down open-world game
   Sections:
     1. Utilities & state          6. Missions (7 chapters + prologue)
     2. Game theory state (GT)     7. UI: dialog, decision, matrix, panels
     3. World generation           8. HUD, minimap, codex, demo mode
     4. Entities & physics         9. Endings & strategy report
     5. Rendering                 10. Save / load, main loop
   ===================================================================== */
'use strict';
const { C, D, MATRICES, STRATEGIES, COMMONS, PUBLIC } = GTE;

// =====================================================================
// 1. UTILITIES & CORE STATE
// =====================================================================
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
function mulberry(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function storeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function storeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }

const cv = $('game'), ctx = cv.getContext('2d');
const dark = document.createElement('canvas'), dctx = dark.getContext('2d');
let VW = 0, VH = 0, DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  VW = innerWidth; VH = innerHeight;
  cv.width = VW * DPR; cv.height = VH * DPR;
  dark.width = Math.max(1, Math.ceil(VW / 2)); dark.height = Math.max(1, Math.ceil(VH / 2));
}
addEventListener('resize', resize); resize();

const state = {
  running: false,     // a game is in progress
  modal: 0,           // >0 while dialog / decision / panel is open -> world freezes
  timeScale: 1,
  clock: 7 * 60,      // minutes since midnight. 1 in-game day = 20 real minutes
  weather: 'clear', weatherT: 60,
  god: true,              // infinite health (Examiner panel can turn it off)
  dawn: false,
  codex: {},
  weapons: [true, false, true],   // pistol, rifle, pipe
};
const CAM = { x: 0, y: 0, zoom: 1 };

// ---- 3D MODE ----------------------------------------------------------
// The 3D engine (web/engine/engine.js) renders this same simulation at human
// scale. A person in the 2D view is ~4 m wide and runs 30 m/s, which looks
// absurd in 3D, so in 3D mode every character/vehicle size and speed goes
// through SCALE (1 map px = 0.2 m). The 2D game keeps SCALE = 1.
const IS3D = !!window.GAME_3D;
const SCALE = IS3D ? { r: 0.25, walk: 0.16, veh: 0.42, reach: 0.4, vdim: 0.5 } : { r: 1, walk: 1, veh: 1, reach: 1, vdim: 1 };
let extraColliders = [];                       // 3D props (wrecks, barriers...) that also block movement

// =====================================================================
// 2. GAME THEORY STATE  (the "subsystem")
// =====================================================================
const COLONY_INFO = {
  ironside: { short: 'Rhea', name: 'Ironside', leader: 'Rhea "Iron" Dutta', res: 'Fuel', color: '#d9824a', district: 'ironside' },
  mercy: { short: 'Elena', name: 'Mercy Hospital', leader: 'Dr. Elena Cruz', res: 'Medicine', color: '#e46a78', district: 'mercy' },
  crows: { short: 'Silas', name: "Crow's Market", leader: 'Silas Crow', res: 'Food', color: '#c9b04a', district: 'crows' },
};
const AI_COLS = ['ironside', 'mercy', 'crows'];
let GT = freshGT();
function freshGT() {
  return {
    col: { ironside: { strat: 'grim', hist: [] }, mercy: { strat: 'gtft', hist: [] }, crows: { strat: 'opp', hist: [] } },
    log: [],                // every round in order, for the Strategy Report
    river: COMMONS.start, riverDead: false, day: 0,
    res: { lakeside: 0, ironside: 0, mercy: 0, crows: 0 },
    core: false,            // Chapter 5 stag success
    traitor: {},            // Chapter 6: colony secretly took Kane's bribe and was not exposed
    chapter: 0,
  };
}
const trustOf = c => GTE.trust(GT.col[c].hist);
function hostility(c) {
  const col = GT.col[c];
  if (col.strat === 'grim' && col.hist.some(r => r.p === D)) return 5;
  return clamp(Math.ceil((50 - trustOf(c)) / 10), 0, 5);
}
/** Simultaneous round: AI decides from past history only, then the round is recorded. */
function playRound(c, pAct, mKey, ch) {
  const m = MATRICES[mKey], col = GT.col[c];
  const a = STRATEGIES[col.strat].choose(col.hist, m, Math.random);
  return recordRound(c, pAct, a, mKey, ch);
}
/** Record a round whose AI move was decided elsewhere (Chicken, Stag Hunt). */
function recordRound(c, pAct, a, mKey, ch) {
  const m = MATRICES[mKey];
  const r = { p: pAct, a, pp: m.A[pAct][a], ap: m.B[pAct][a], ch, game: mKey };
  GT.col[c].hist.push(r);
  GT.log.push(Object.assign({ c }, r));
  GT.res.lakeside += r.pp; GT.res[c] += r.ap;
  updateTrustHud(true);
  return r;
}
function playerCoopRate() {
  if (!GT.log.length) return 1;
  return GT.log.filter(r => r.p === C).length / GT.log.length;
}

// =====================================================================
// 3. WORLD GENERATION
// =====================================================================
const WORLD = 2400;
const RIVER = { x: 1120, w: 140 }, BRIDGE = { y: 1150, h: 100 };
const ROADV = [250, 700, 1650, 2100], ROADH = [250, 700, 1200, 1700, 2150], RW = 80;
const DISTRICTS = [
  { id: 'mercy', name: 'Mercy Heights', x: 0, y: 0, w: 1120, h: 1200, tint: '#161c20' },
  { id: 'lakeside', name: 'Lakeside', x: 0, y: 1200, w: 1120, h: 1200, tint: '#141d22' },
  { id: 'ironside', name: 'Ironside', x: 1260, y: 0, w: 1140, h: 900, tint: '#1e1a17' },
  { id: 'deadzone', name: 'The Dead Zone', x: 1260, y: 900, w: 1140, h: 600, tint: '#1b1720' },
  { id: 'crows', name: "Crow's Market", x: 1260, y: 1500, w: 1140, h: 900, tint: '#1d1b15' },
];
// Special blocks: kept free of random buildings so landmarks fit.
const SPECIAL = [
  { x0: 250, x1: 700, y0: 1700, y1: 2150 },   // Lakeside base
  { x0: 250, x1: 700, y0: 250, y1: 700 },     // Mercy Hospital
  { x0: 1650, x1: 2100, y0: 250, y1: 700 },   // Ironside Refinery
  { x0: 1650, x1: 2100, y0: 1700, y1: 2150 }, // Crow's Market
  { x0: 1650, x1: 2100, y0: 700, y1: 1200 },  // Power station
  { x0: 2100, x1: 2400, y0: 700, y1: 1200 },  // Helix depot
];
const DOCKS = { x: 950, y: 1880, w: 170, h: 170 };
const P = {  // named points
  home: { x: 470, y: 1990 }, radio: { x: 1070, y: 1965 },
  elena: { x: 475, y: 560 }, rhea: { x: 1875, y: 610 }, silas: { x: 1875, y: 2060 },
  station: { x: 1875, y: 1010 }, depot: { x: 2255, y: 960 },
};
let buildings = [], colliders = [], props = [], lights = [];
const GRID = 200, grid = new Map();

function genWorld() {
  const r = mulberry(2041);
  buildings = []; props = []; lights = [];
  const xs = [0, 250, 700, 1120, 1260, 1650, 2100, 2400], ys = [0, 250, 700, 1200, 1700, 2150, 2400];
  const edge = v => v === 0 || v === 2400 ? 24 : v === 1120 || v === 1260 ? 64 : 0;
  for (let i = 0; i < xs.length - 1; i++) {
    if (xs[i] === 1120) continue;
    for (let j = 0; j < ys.length - 1; j++) {
      const bx0 = xs[i], bx1 = xs[i + 1], by0 = ys[j], by1 = ys[j + 1];
      if (SPECIAL.some(s => s.x0 === bx0 && s.y0 === by0)) continue;
      const x0 = bx0 + (edge(bx0) || RW / 2 + 14), x1 = bx1 - (edge(bx1) || RW / 2 + 14);
      const y0 = by0 + (edge(by0) || RW / 2 + 14), y1 = by1 - (edge(by1) || RW / 2 + 14);
      subdivide(r, x0, y0, x1, y1);
    }
  }
  // Remove anything overlapping the docks.
  buildings = buildings.filter(b => !overlap(b, DOCKS));

  // ---- Landmarks ----
  const L = (x, y, w, h, o) => buildings.push(Object.assign({ x, y, w, h, hgt: 40, roof: '#2a2f33', land: true }, o));
  L(300, 290, 260, 150, { hgt: 70, roof: '#d8d5cc', cross: true, name: 'MERCY' });          // hospital
  L(590, 300, 70, 110, { hgt: 45, roof: '#8f8a80' });
  L(1700, 450, 80, 60, { hgt: 30, roof: '#3b3027' });                                     // refinery office
  L(1800, 780, 180, 120, { hgt: 55, roof: '#2d2a36', station: true });                    // power station
  L(2150, 760, 90, 60, { hgt: 30, roof: '#3a3346', helix: true });
  L(2280, 1060, 80, 70, { hgt: 30, roof: '#3a3346', helix: true });
  L(560, 1760, 110, 70, { hgt: 30, roof: '#35434a' });                                   // lakeside hall
  // Ironside tanks (round, drawn as circles, collide as squares)
  for (const tx of [1740, 1850, 1960]) buildings.push({ x: tx - 38, y: 290, w: 76, h: 76, hgt: 50, roof: '#6b625a', tank: true });
  // Lakeside water tanks
  for (const tx of [310, 380]) buildings.push({ x: tx, y: 2080, w: 50, h: 50, hgt: 45, roof: '#4d6d78', tank: true });
  // Crow's market stalls (low)
  for (let k = 0; k < 6; k++) buildings.push({ x: 1700 + (k % 3) * 120, y: 1760 + Math.floor(k / 3) * 110, w: 70, h: 40, hgt: 12, roof: pick(['#8a3b2c', '#3b6a5a', '#a07a2c', '#4b4f7a']), stall: true });
  // Depot crates
  for (let k = 0; k < 5; k++) buildings.push({ x: 2150 + (k % 3) * 70, y: 880 + Math.floor(k / 3) * 150, w: 36, h: 36, hgt: 14, roof: '#5a4d3a', crate: true });

  // Fire barrels (light + flicker)
  for (const f of [[430, 1900], [620, 2090], [470, 470], [1820, 520], [1990, 1920], [1760, 2080], [1060, 2000], [700, 1250], [1650, 1500]]) lights.push({ x: f[0], y: f[1], r: 150, fire: true });

  rebuildColliders();
}
function subdivide(r, x0, y0, x1, y1) {
  const w = x1 - x0, h = y1 - y0;
  if (w < 60 || h < 60) return;
  if (w < 230 && h < 230) {
    if (r() < 0.14) { props.push({ type: 'rubble', x: x0, y: y0, w, h }); return; }
    const g = 8;
    const hgt = 20 + r() * 55;
    const shade = 34 + Math.floor(r() * 18);
    buildings.push({
      x: x0 + g, y: y0 + g, w: w - 2 * g, h: h - 2 * g, hgt,
      roof: `rgb(${shade},${shade + 4},${shade + 7})`, ruined: r() < 0.3, seed: r()
    });
    return;
  }
  if (w > h) { const s = x0 + w * (0.35 + r() * 0.3); subdivide(r, x0, y0, s, y1); subdivide(r, s, y0, x1, y1); }
  else { const s = y0 + h * (0.35 + r() * 0.3); subdivide(r, x0, y0, x1, s); subdivide(r, x0, s, x1, y1); }
}
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function rebuildColliders() {
  // Chapter 4 consequence: if both drivers stayed, the collapsed bridge stays blocked for cars (a footpath remains)
  if (GT.flags && GT.flags.bridgeClosed && !buildings.some(b => b.bridgeRubble)) {
    const gap = IS3D ? 12 : 30;
    buildings.push({ x: RIVER.x + 40, y: BRIDGE.y - 4, w: 50, h: BRIDGE.h / 2 + 4 - gap / 2, hgt: 10, roof: '#4a4038', ruined: true, bridgeRubble: true },
                   { x: RIVER.x + 40, y: BRIDGE.y + BRIDGE.h / 2 + gap / 2, w: 50, h: BRIDGE.h / 2 - gap / 2 + 4, hgt: 10, roof: '#4a4038', ruined: true, bridgeRubble: true });
  }
  colliders = buildings.concat(extraColliders);
  if (!GT.riverDead) {
    colliders.push({ x: RIVER.x, y: -50, w: RIVER.w, h: BRIDGE.y + 50, water: true });
    colliders.push({ x: RIVER.x, y: BRIDGE.y + BRIDGE.h, w: RIVER.w, h: WORLD - BRIDGE.y - BRIDGE.h + 50, water: true });
  }
  // Bridge rails are always solid (stops cars flying off the bridge sides into the riverbed).
  colliders.push({ x: RIVER.x, y: BRIDGE.y - 8, w: RIVER.w, h: 8, rail: true });
  colliders.push({ x: RIVER.x, y: BRIDGE.y + BRIDGE.h, w: RIVER.w, h: 8, rail: true });
  if (GT.riverDead) { colliders.pop(); colliders.pop(); }
  grid.clear();
  for (const c of colliders) {
    for (let gx = Math.floor(c.x / GRID); gx <= Math.floor((c.x + c.w) / GRID); gx++)
      for (let gy = Math.floor(c.y / GRID); gy <= Math.floor((c.y + c.h) / GRID); gy++) {
        const k = gx + ',' + gy; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(c);
      }
  }
}
function nearColliders(x, y) {
  const out = [], gx = Math.floor(x / GRID), gy = Math.floor(y / GRID);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const l = grid.get((gx + i) + ',' + (gy + j)); if (l) for (const c of l) out.push(c);
  }
  return out;
}
/** Push a circle out of solid rectangles. Returns true if it hit something. */
function collide(e, r, ignoreWater) {
  let hit = false;
  for (const c of nearColliders(e.x, e.y)) {
    if (ignoreWater && (c.water || c.rail)) continue;
    const nx = clamp(e.x, c.x, c.x + c.w), ny = clamp(e.y, c.y, c.y + c.h);
    const dx = e.x - nx, dy = e.y - ny, d2 = dx * dx + dy * dy;
    if (d2 < r * r) {
      hit = true;
      if (d2 > 0.0001) { const d = Math.sqrt(d2); e.x = nx + dx / d * r; e.y = ny + dy / d * r; }
      else { // centre inside the rect: push out along the shortest axis
        const l = e.x - c.x, rr = c.x + c.w - e.x, t = e.y - c.y, b = c.y + c.h - e.y, m = Math.min(l, rr, t, b);
        if (m === l) e.x = c.x - r; else if (m === rr) e.x = c.x + c.w + r; else if (m === t) e.y = c.y - r; else e.y = c.y + c.h + r;
      }
    }
  }
  e.x = clamp(e.x, r, WORLD - r); e.y = clamp(e.y, r, WORLD - r);
  return hit;
}
function solidAt(x, y) {
  for (const c of nearColliders(x, y)) if (!c.water && !c.rail && x > c.x && x < c.x + c.w && y > c.y && y < c.y + c.h) return true;
  return false;
}
function lineOfSight(a, b) {
  if (a.roof || b.roof) return Action.elevatedLOS(a, b);   // rooftops see over the streets
  const d = dist(a, b), n = Math.ceil(d / 24);
  for (let i = 1; i < n; i++) if (solidAt(lerp(a.x, b.x, i / n), lerp(a.y, b.y, i / n))) return false;
  return true;
}
function districtAt(x, y) {
  if (x >= RIVER.x && x < RIVER.x + RIVER.w) return { id: 'river', name: 'The River' };
  return DISTRICTS.find(d => x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h) || DISTRICTS[1];
}

// Pre-render the static ground (districts, roads) once.
const groundCv = document.createElement('canvas');
function renderGround() {
  groundCv.width = WORLD / 2; groundCv.height = WORLD / 2;
  const g = groundCv.getContext('2d'); g.scale(0.5, 0.5);
  for (const d of DISTRICTS) { g.fillStyle = d.tint; g.fillRect(d.x, d.y, d.w, d.h); }
  // dirt noise
  const r = mulberry(7);
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${r() < .5 ? '255,255,255' : '0,0,0'},${0.02 + r() * 0.03})`; g.fillRect(r() * WORLD, r() * WORLD, 4 + r() * 30, 4 + r() * 30); }
  for (const p of props) { g.fillStyle = '#231f1c'; g.fillRect(p.x, p.y, p.w, p.h); for (let k = 0; k < 14; k++) { g.fillStyle = `rgba(90,80,70,${0.3 + r() * .4})`; g.fillRect(p.x + r() * p.w, p.y + r() * p.h, 6 + r() * 16, 5 + r() * 10); } }
  // roads
  g.fillStyle = '#23272a';
  for (const x of ROADV) g.fillRect(x - RW / 2, 0, RW, WORLD);
  for (const y of ROADH) {
    if (y === 1200) g.fillRect(0, y - RW / 2, WORLD, RW);
    else { g.fillRect(0, y - RW / 2, RIVER.x, RW); g.fillRect(RIVER.x + RIVER.w, y - RW / 2, WORLD, RW); }
  }
  // lane markings
  g.strokeStyle = 'rgba(210,190,120,.28)'; g.lineWidth = 3; g.setLineDash([26, 30]);
  for (const x of ROADV) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, WORLD); g.stroke(); }
  for (const y of ROADH) { g.beginPath(); g.moveTo(0, y); g.lineTo(WORLD, y); g.stroke(); }
  g.setLineDash([]);
  // cracks
  g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 2;
  for (let i = 0; i < 260; i++) { let x = r() * WORLD, y = r() * WORLD; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += rnd(-30, 30); y += rnd(-30, 30); g.lineTo(x, y); } g.stroke(); }
  // plazas
  g.fillStyle = '#2a2d2c';
  for (const s of SPECIAL) g.fillRect(s.x0 + RW / 2 + 4, s.y0 + RW / 2 + 4, s.x1 - s.x0 - RW - 8, s.y1 - s.y0 - RW - 8);
  // docks planks
  g.fillStyle = '#3d3226'; g.fillRect(DOCKS.x, DOCKS.y, DOCKS.w, DOCKS.h);
  g.strokeStyle = '#2a2219'; g.lineWidth = 2;
  for (let x = DOCKS.x; x < DOCKS.x + DOCKS.w; x += 14) { g.beginPath(); g.moveTo(x, DOCKS.y); g.lineTo(x, DOCKS.y + DOCKS.h); g.stroke(); }
  // Dead Zone hazard stripes
  g.fillStyle = 'rgba(168,140,255,.05)'; g.fillRect(1260, 900, 1140, 600);
}

// =====================================================================
// 4. ENTITIES & PHYSICS
// =====================================================================
const VEH = {
  jeep: { max: 330, acc: 280, turn: 2.6, w: 46, h: 24, r: 17, color: '#556b4a', hp: 160 },
  pickup: { max: 300, acc: 220, turn: 2.2, w: 52, h: 26, r: 18, color: '#7a5a3c', hp: 200 },
  bike: { max: 390, acc: 340, turn: 3.3, w: 30, h: 11, r: 11, color: '#9a9a9a', hp: 90 },
  tanker: { max: 90, acc: 60, turn: 1.4, w: 74, h: 30, r: 22, color: '#8a3a2a', hp: 420 },
};
function scaleVehicle(v) { v.max *= SCALE.veh; v.acc *= SCALE.veh; v.w *= SCALE.vdim; v.h *= SCALE.vdim; v.r *= SCALE.vdim; }
for (const v of Object.values(VEH)) scaleVehicle(v);
const WEAPONS = [
  { name: 'Pistol', dmg: 22, rate: 0.32, spread: 0.04, range: 0.9 },
  { name: 'Rifle', dmg: 15, rate: 0.1, spread: 0.07, range: 1.0 },
  { name: 'Pipe', dmg: 40, rate: 0.45, melee: true },
];
let player, cars = [], enemies = [], npcs = [], bullets = [], parts = [], pickups = [], markers = [];

function newPlayer() {
  return { x: P.home.x, y: P.home.y, a: 0, hp: 100, r: 11 * SCALE.r, car: null, weapon: 0, cd: 0, hurtT: 0, cfg: CR.CAST.veer };
}
function spawnCar(type, x, y, a = 0, extra) {
  const t = VEH[type];
  const c = Object.assign({ type, x, y, a, v: 0, hp: t.hp, color: t.color, r: t.r }, extra || {});
  cars.push(c); return c;
}
function spawnEnemy(type, x, y, extra) {
  const base = {
    scav: { hp: 40, speed: 105, dmg: 6, r: 11, color: '#a8683f', rate: 1.3, range: 520 },
    drone: { hp: 30, speed: 140, dmg: 5, r: 10, color: '#8f7cff', rate: 1.1, range: 560, fly: true },
    trooper: { hp: 70, speed: 95, dmg: 8, r: 12, color: '#6c5fb5', rate: 1.0, range: 560 },
    guard: { hp: 60, speed: 100, dmg: 7, r: 11, color: '#cc5544', rate: 1.2, range: 520 },
    brute: { hp: 80, speed: 118, dmg: 12, r: 12, color: '#7a4a2f', rate: 1.1, range: 60, melee: true },   // Part A: melee attacker
    sniper: { hp: 35, speed: 0, dmg: 26, r: 11, color: '#a8683f', rate: 3, range: 900, sniper: true },     // Part A: rooftop marksman
  }[type];
  const e = Object.assign({ type, x, y, a: 0, cd: rnd(0.5, 1.5), wander: 0, ...base }, extra || {});
  if (!e.boss && !e.camera && e.hp < 5000) e.hp = Math.max(1, Math.round(e.hp * DIFF.enemyHp));   // difficulty
  e.maxHp = e.hp;
  e.r *= SCALE.r; e.speed *= SCALE.walk; if (e.range < 100) e.range *= SCALE.reach;   // 3D: human scale
  e.cfg = e.cfg || CR.enemyConfig(type === 'sniper' ? 'scav' : type, e.colony);                        // Phase 1: procedural look
  e.weaponName = { scav: 'pistol', trooper: 'rifle', guard: e.colony === 'ironside' ? 'rifle' : 'pistol', brute: 'pipe', sniper: 'rifle' }[type] || 'none';
  enemies.push(e); return e;
}
function spawnNPCs() {
  npcs = [];
  const spots = [[470, 1950], [1875, 2000], [470, 520], [1880, 560], [700, 1500], [250, 1300], [1650, 2300]];
  for (let i = 0; i < 26; i++) {
    const s = pick(spots);
    npcs.push({ x: s[0] + rnd(-120, 120), y: s[1] + rnd(-120, 120), a: rnd(0, 6.28), t: rnd(0, 3), r: 9 * SCALE.r, cfg: CR.randomSurvivor() });
  }
}
function particle(x, y, n, color, speed = 120, life = 0.5, size = 3) {
  for (let i = 0; i < n; i++) {
    const a = rnd(0, 6.28), s = rnd(speed * 0.3, speed);
    parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(life * 0.5, life), max: life, color, size });
  }
}
function explode(x, y) { particle(x, y, 40, '#f2a93b', 260, 0.8, 5); particle(x, y, 30, '#555', 120, 1.4, 7); sfx('boom'); shake(10); }
let shakeT = 0, shakeA = 0;
function shake(a) { shakeA = Math.max(shakeA, a); shakeT = 0.35; }

// ---- Input ----
const keys = {};
const mouse = { x: 0, y: 0, down: false };
addEventListener('keydown', e => {
  if (e.key === '`' || e.key === 'F2') { e.preventDefault(); toggleDemo(); return; }
  if (e.code === 'Space' && !$('dialog').hidden) { e.preventDefault(); advanceDialog(); return; }
  if (e.key === 'Enter' && !$('dialog').hidden) { advanceDialog(); return; }
  if (!$('decision').hidden && ['1', '2', '3'].includes(e.key)) { const b = $('dec-cards').children[+e.key - 1]; if (b && !b.disabled) b.click(); return; }
  if (e.key === 'Escape') { if (state.running) togglePause(); return; }
  if ((e.key === 'j' || e.key === 'J') && state.running && !state.modal) { openCodex(); return; }
  if ((e.key === 'h' || e.key === 'H') && state.running && !state.modal && Mission.started) { showBriefing(Mission.ch, () => {}); return; }
  keys[e.code] = true;
  if (Action.keydown(e)) { e.preventDefault(); return; }       // Part A: E, Q, Ctrl, F, V, C, G, B, T and QTE keys
  if (!state.running || state.modal) return;
  if (e.key === '1') setWeapon(0);
  if (e.key === '2') setWeapon(1);
  if (e.key === '3') setWeapon(2);
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.down = false; });
cv.addEventListener('mousemove', e => { if (IS3D) { if (window.R3) R3.look(e); return; } mouse.x = e.clientX; mouse.y = e.clientY; const ch = $('crosshair'); ch.style.left = e.clientX + 'px'; ch.style.top = e.clientY + 'px'; });
cv.addEventListener('mousedown', e => { if (e.button === 0) mouse.down = true; });
addEventListener('mouseup', () => { mouse.down = false; });
cv.addEventListener('contextmenu', e => e.preventDefault());
$('dialog').addEventListener('click', advanceDialog);

function setWeapon(i) {
  if (!state.weapons[i]) { toast('You don’t have the ' + WEAPONS[i].name.toLowerCase() + ' yet.', 'warn'); return; }
  player.weapon = i; updateHud();
}
function toggleCar() {
  if (player.car) {
    const c = player.car; if (c.scripted) return;
    player.car = null; c.v *= 0.3;
    player.x = c.x - Math.sin(c.a) * 30 * SCALE.vdim; player.y = c.y + Math.cos(c.a) * 30 * SCALE.vdim; collide(player, player.r);
    return;
  }
  let best = null, bd = 60 * SCALE.reach;
  for (const c of cars) { const d = dist(c, player); if (d < bd && c.hp > 0 && c.type !== 'tanker' && !c.npc && !c.scripted) { bd = d; best = c; } }
  if (best) { player.car = best; sfx('door'); }
}
function worldMouse() { if (IS3D && window.R3) return R3.aim(); return { x: CAM.x + (mouse.x - VW / 2) / CAM.zoom, y: CAM.y + (mouse.y - VH / 2) / CAM.zoom }; }

// ---- Difficulty (Easy by default; change in the pause menu or with ?normal / ?hard) ----
const DIFFICULTIES = {
  easy:   { label: 'Easy',   dmgTaken: 0.35, enemyHp: 0.6, timers: 1.6, qte: 1.8, mash: 0.6, detect: 0.5, objectiveHp: 1.8, regen: 10 },
  normal: { label: 'Normal', dmgTaken: 1,   enemyHp: 1,   timers: 1,   qte: 1,   mash: 1,   detect: 1,   objectiveHp: 1,   regen: 0 },
  hard:   { label: 'Hard',   dmgTaken: 1.5, enemyHp: 1.3, timers: 0.85, qte: 0.8, mash: 1.2, detect: 1.3, objectiveHp: 0.8, regen: 0 },
};
let DIFF = DIFFICULTIES[(/[?&](normal|hard)/.exec(location.search) || [])[1] || (() => { try { return localStorage.getItem('ls-difficulty'); } catch (e) { return null; } })() || 'easy'] || DIFFICULTIES.easy;
function setDifficulty(k) { DIFF = DIFFICULTIES[k] || DIFFICULTIES.easy; try { localStorage.setItem('ls-difficulty', k); } catch (e) {} toast('Difficulty: ' + DIFF.label, 'gold'); }
function damagePlayer(n) {
  if (state.god || Action.invulnerable()) return;   // dodge-roll i-frames / takedown animation
  n = Action.damageFilter(n);                        // the turret jeep absorbs part of the hit
  if (player.car) { player.car.hp -= n * 0.6; n *= 0.35; }
  n *= DIFF.dmgTaken;
  player.hp -= n; player.hurtT = 0.25; player.lastHurt = performance.now();
  if (player.hp <= 0) playerDied();
}

// ---- Animation bookkeeping for the Character Renderer ----
/** Measures how far an entity moved this frame -> smoothed speed + walk-cycle phase. */
function animTick(e, dt) {
  if (e.px === undefined) { e.px = e.x; e.py = e.y; }
  const d = Math.hypot(e.x - e.px, e.y - e.py);
  e.spd = lerp(e.spd || 0, dt > 0 ? d / dt : 0, 0.3);
  e.walk = (e.walk || 0) + d * 0.17;            // one full stride roughly every 37 px
  e.px = e.x; e.py = e.y;
  if (e.hitT > 0) e.hitT -= dt;
  if (e.swingT > 0) { e.swingT -= dt; e.swing = 1 - Math.max(0, e.swingT) / 0.25; } else e.swing = 0;
}

// ---- Update ----
function update(dt) {
  // clock & weather
  state.clock = (state.clock + dt * 1.2) % 1440;   // 1440 min / 1200 s = 20 real minutes per day
  state.weatherT -= dt;
  if (state.weatherT <= 0) {
    state.weatherT = rnd(60, 120);
    const opts = GT.riverDead ? ['dust', 'dust', 'clear', 'fog'] : ['clear', 'clear', 'rain', 'fog'];
    state.weather = pick(opts);
  }

  updatePlayer(dt);
  for (const c of cars) updateCar(c, dt);
  updateEnemies(dt);
  updateNPCs(dt);
  updateBullets(dt);
  Action.update(dt);                                   // Part A: allies, chases, timers, bosses, defense, fire
  for (const p of parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96; p.life -= dt; }
  parts = parts.filter(p => p.life > 0);
  for (const k of pickups) if (!k.taken && dist(k, player) < 24 * SCALE.reach) { k.taken = true; player.hp = Math.min(100, player.hp + 40); toast('+40 health'); sfx('pick'); }
  ambientSpawns(dt);
  Mission.update(dt);

  // camera
  const tgt = Action.camTarget() || player.car || player;   // cutscenes can take the camera
  const look = player.car ? { x: Math.sin(player.car.a + Math.PI / 2) * player.car.v * 0.35, y: -Math.cos(player.car.a + Math.PI / 2) * player.car.v * 0.35 } : { x: 0, y: 0 };
  CAM.x = lerp(CAM.x, tgt.x + look.x, 1 - Math.pow(0.001, dt));
  CAM.y = lerp(CAM.y, tgt.y + look.y, 1 - Math.pow(0.001, dt));
  const zTarget = (Action.camZoom() || (player.car ? 0.82 : 1)) * clamp(Math.min(VW, VH) / 760, 0.62, 1.3);
  CAM.zoom = lerp(CAM.zoom, zTarget, dt * 2);
  if (shakeT > 0) { shakeT -= dt; } else shakeA = 0;
}

function updatePlayer(dt) {
  player.cd -= dt; player.hurtT -= dt;
  if (player.car) { const c = player.car; player.x = c.x; player.y = c.y; Action.inCar(dt); return; }   // drive-by shooting
  if (Action.controlPlayer(dt)) { animTick(player, dt); return; }     // dodge, takedown, zipline, mounted gun
  let mx = 0, my = 0;
  if (keys.KeyW || keys.ArrowUp) my -= 1; if (keys.KeyS || keys.ArrowDown) my += 1;
  if (keys.KeyA || keys.ArrowLeft) mx -= 1; if (keys.KeyD || keys.ArrowRight) mx += 1;
  if (IS3D && window.R3) [mx, my] = R3.rel(mx, my);                   // 3D: W = away from the camera
  const sp = Action.moveSpeed(((keys.ShiftLeft || keys.ShiftRight) ? 245 : 150) * SCALE.walk);   // crouching / carrying slow you down
  const l = Math.hypot(mx, my) || 1;
  // momentum: speed ramps up and down instead of starting / stopping instantly
  const moving = mx || my, k = 1 - Math.exp(-(moving ? 9 : 12) * dt);
  player.vx = lerp(player.vx || 0, moving ? mx / l * sp : 0, k); player.vy = lerp(player.vy || 0, moving ? my / l * sp : 0, k);
  if (!Action.coverMove(mx / l, my / l, dt)) {                        // in cover you slide along the wall
    player.x += player.vx * dt; player.y += player.vy * dt;
    Action.collidePlayer();                                           // walls on the ground, roof edges up top
  } else { player.vx = player.vy = 0; }
  // facing: aiming / shooting -> face the crosshair; otherwise turn smoothly toward where you walk
  const wm = worldMouse(), aimA = Math.atan2(wm.y - player.y, wm.x - player.x);
  const aimingNow = !IS3D || mouse.down || Action.aimHeld() || player.cd > -0.5 || player.cover;
  const wantA = aimingNow ? aimA : Math.hypot(player.vx, player.vy) > 4 ? Math.atan2(player.vy, player.vx) : player.a;
  const da = ((wantA - player.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  player.a += aimingNow ? da * Math.min(1, dt * 22) : da * Math.min(1, dt * 10);
  if (mouse.down) player.a = aimA;                                    // shots always go where you aim
  if (mouse.down && player.cd <= 0 && Action.canFire()) fire();
  player.weaponName = ['pistol', 'rifle', 'pipe'][player.weapon];
  player.aiming = player.weapon !== 2 && (mouse.down || player.cd > -0.7);   // arms up while shooting
  animTick(player, dt);
  player.hitT = player.hurtT > 0 ? player.hurtT * 0.6 : 0;
  if (DIFF.regen && !player.dead && player.hp < 100 && performance.now() - (player.lastHurt || 0) > 4000) player.hp = Math.min(100, player.hp + DIFF.regen * dt);   // Easy: health recovers out of combat
}
function fire() {
  const w = WEAPONS[player.weapon]; player.cd = w.rate;
  if (w.melee) {
    sfx('swing'); player.swingT = 0.25;
    for (const e of enemies) if (dist(e, player) < 42 * SCALE.reach) { const a = Math.atan2(e.y - player.y, e.x - player.x); if (Math.abs(((a - player.a + 9.42) % 6.283) - 3.14) < 1.1) hitEnemy(e, w.dmg); }
    return;
  }
  const a = player.a + rnd(-w.spread, w.spread) * Action.spreadMul();     // blind fire from cover is wild
  const b = { x: player.x + Math.cos(a) * 16 * SCALE.r, y: player.y + Math.sin(a) * 16 * SCALE.r, vx: Math.cos(a) * 820, vy: Math.sin(a) * 820, life: w.range, dmg: w.dmg, own: 'p' };
  Action.decorateBullet(b); bullets.push(b);
  Action.noise(player.x, player.y, 600);                                  // gunshots alert stealth guards
  particle(player.x + Math.cos(a) * 18, player.y + Math.sin(a) * 18, 3, '#ffd27a', 90, 0.12, 2);
  sfx('shot');
  alertColonyGuards();
}
function updateCar(c, dt) {
  const t = VEH[c.type];
  if (c.hp <= 0) {
    if (!c.wreck) { c.wreck = true; explode(c.x, c.y); if (player.car === c) { player.car = null; damagePlayer(35); } }
    return;
  }
  if (c.scripted) return;
  const driven = player.car === c;
  let thr = 0, steer = 0;
  if (driven) {
    if (keys.KeyW || keys.ArrowUp) thr = 1; if (keys.KeyS || keys.ArrowDown) thr = -1;
    if (keys.KeyA || keys.ArrowLeft) steer = -1; if (keys.KeyD || keys.ArrowRight) steer = 1;
  } else if (c.ai) { [thr, steer] = c.ai(c, dt);   // Part A: enemy bikers
  } else if (c.path) { // AI-driven (escort tanker, turret jeep)
    const wp = c.path[c.wp];
    if (wp) {
      const want = Math.atan2(wp.y - c.y, wp.x - c.x);
      let da = ((want - c.a + 9.42) % 6.283) - 3.14; steer = clamp(da * 2, -1, 1);
      thr = c.halt ? -0.5 : 1;
      // un-stick: an AI vehicle wedged against a wall backs up and tries again
      if (!c.halt && Math.abs(c.v) < 5 * SCALE.veh) c.stuckT = (c.stuckT || 0) + dt; else c.stuckT = 0;
      if (c.stuckT > 0.8) { c.revT = 0.9; c.stuckT = 0; }
      if (c.revT > 0) { c.revT -= dt; thr = -1; steer = -steer; }
      if (Math.hypot(wp.x - c.x, wp.y - c.y) < (c.wpR || 30)) c.wp++;   // heavy trucks use a bigger radius (wide turns)
    }
  }
  if (thr > 0) c.v += t.acc * dt; else if (thr < 0) c.v -= (c.v > 0 ? t.acc * 1.6 : t.acc * 0.6) * dt; else c.v *= Math.pow(0.35, dt);
  if (keys.Space && driven) c.v *= Math.pow(0.05, dt); // handbrake
  c.v = clamp(c.v, -t.max * 0.4, t.max);
  if (c.halt && c.v < 0) c.v = 0;
  c.a += steer * t.turn * dt * clamp(c.v / (140 * SCALE.veh), -1, 1);
  c.x += Math.cos(c.a) * c.v * dt; c.y += Math.sin(c.a) * c.v * dt;
  if (c.type === 'boat') Action.boatClamp(c);          // boats stay in the river
  else if (collide(c, c.r)) {
    if (Math.abs(c.v) > 160 * SCALE.veh) { c.hp -= Math.abs(c.v) / SCALE.veh * 0.05; particle(c.x, c.y, 6, '#bbb', 120, 0.3); shake(4); sfx('thud'); }
    c.v *= -0.3;
  }
  // run over enemies / NPCs
  if (Math.abs(c.v) > 110 * SCALE.veh) {
    for (const e of enemies) if (!e.fly && dist(e, c) < c.r + e.r) { hitEnemy(e, Math.abs(c.v) / SCALE.veh * 0.25); e.x += Math.cos(c.a) * 20 * SCALE.reach; e.y += Math.sin(c.a) * 20 * SCALE.reach; }
  }
}
function hitEnemy(e, dmg) {
  if (e.dead) return;
  dmg = Action.onHitEnemy(e, dmg); if (dmg <= 0) return;   // boss armour / weak points
  e.hp -= dmg; e.aggro = true; e.hitT = 0.18; particle(e.x, e.y, 5, e.fly ? '#b6a8ff' : '#8a2a22', 100, 0.3);
  if (e.hp <= 0 && !e.dead) {
    e.dead = true; e.deadT = 0; Action.onKill(e); particle(e.x, e.y, 14, e.fly ? '#b6a8ff' : '#6d1f19', 150, 0.6, 4);
    if (e.fly) explode(e.x, e.y);
    if (Math.random() < 0.18) pickups.push({ x: e.x, y: e.y });
  }
}
function updateEnemies(dt) {
  for (const e of enemies) {
    if (e.dead) { e.deadT += dt; continue; }      // corpse: lies still, fades after 10 s
    e.cd -= dt;
    if (Action.think(e, dt)) { if (!Action.skipCollide(e)) collide(e, e.r, e.fly); animTick(e, dt); continue; }   // Part A AI
    // Targets: the player, allies, the defended target, or the tanker we are escorting.
    let tgt = Action.pickTarget(e, player.car || player);
    const tank = cars.find(c => c.type === 'tanker' && c.hp > 0 && c.escort);
    if (tank && dist(e, tank) < dist(e, tgt)) tgt = tank;
    const d = dist(e, tgt);
    const hostile = e.type !== 'guard' || e.mission || hostility(e.colony) >= 3;   // mission guards always fight
    const sees = d < e.range && (e.fly || lineOfSight(e, tgt));
    e.aiming = hostile && sees;
    if (hostile && (sees || e.aggro) && d < e.range * 1.4) {
      e.a = Math.atan2(tgt.y - e.y, tgt.x - e.x);
      const want = e.fly ? 180 : 210;
      const dir = d > want ? 1 : d < want * 0.6 ? -0.7 : 0;
      const strafe = Math.sin(performance.now() / 700 + e.x) * 0.6;
      e.x += (Math.cos(e.a) * dir - Math.sin(e.a) * strafe) * e.speed * dt;
      e.y += (Math.sin(e.a) * dir + Math.cos(e.a) * strafe) * e.speed * dt;
      if (sees && e.cd <= 0) {
        e.cd = e.rate * rnd(0.8, 1.3);
        const a = e.a + rnd(-0.1, 0.1);
        bullets.push({ x: e.x + Math.cos(a) * 14, y: e.y + Math.sin(a) * 14, vx: Math.cos(a) * 520, vy: Math.sin(a) * 520, life: 1.1, dmg: e.dmg, own: 'e' });
        sfx(e.fly ? 'zap' : 'eshot');
      }
    } else {
      e.wander -= dt;
      if (e.wander <= 0) { e.wander = rnd(1, 3); e.wa = rnd(0, 6.28); }
      e.x += Math.cos(e.wa || 0) * e.speed * 0.3 * dt; e.y += Math.sin(e.wa || 0) * e.speed * 0.3 * dt;
      e.a = e.wa || 0;
      if (e.home && dist(e, e.home) > 200) e.wa = Math.atan2(e.home.y - e.y, e.home.x - e.x);
    }
    collide(e, e.r, e.fly);
    animTick(e, dt);
  }
  enemies = enemies.filter(e => !e.hidden && (!e.dead || (!e.fly && (e.deadT < 11 || e.keepBody))));   // mission bodies stay until hidden
}
function updateNPCs(dt) {
  for (const n of npcs) {
    n.t -= dt;
    if (n.t <= 0) { n.t = rnd(1.5, 5); n.a = rnd(0, 6.28); n.stop = Math.random() < 0.35; }
    if (!n.stop) { n.x += Math.cos(n.a) * 35 * SCALE.walk * dt; n.y += Math.sin(n.a) * 35 * SCALE.walk * dt; }
    if (collide(n, n.r)) n.a += Math.PI;
    animTick(n, dt);
    for (const c of cars) if (Math.abs(c.v) > 60 && dist(c, n) < 60) { n.a = Math.atan2(n.y - c.y, n.x - c.x); n.x += Math.cos(n.a) * 80 * SCALE.walk * dt; n.y += Math.sin(n.a) * 80 * SCALE.walk * dt; }
  }
}
function updateBullets(dt) {
  for (const b of bullets) {
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (!b.elev && solidAt(b.x, b.y)) { Action.bulletHitSolid(b); b.life = 0; particle(b.x, b.y, 3, '#aaa', 80, 0.2, 2); continue; }
    if (b.own === 'p') {
      for (const e of enemies) { const hp = Action.hitPos(e); if (!e.dead && Math.hypot(hp.x - b.x, hp.y - b.y) < e.r + 3) { hitEnemy(e, b.dmg); b.life = 0; if (!b.ally) Action.stats().hits++; break; } }
    } else {
      if (Action.enemyBullet(b)) continue;                 // player (cover, dodge), allies: Part A
      for (const c of cars) if (c.escort && c.hp > 0 && Math.hypot(c.x - b.x, c.y - b.y) < c.r + 3) { c.hp -= b.dmg; b.life = 0; particle(b.x, b.y, 3, '#ffb070', 80, .2); }
    }
  }
  bullets = bullets.filter(b => b.life > 0);
}

// Ambient life: Helix drones in the Dead Zone, scavengers, hostile colony guards.
let ambientT = 0;
function ambientSpawns(dt) {
  ambientT -= dt; if (ambientT > 0) return; ambientT = 3;
  if (!Mission.started) return;
  const d = districtAt(player.x, player.y).id;
  const amb = enemies.filter(e => e.ambient);
  // despawn far ambient enemies
  for (const e of amb) if (dist(e, player) > 1300) e.dead = true;
  if (d === 'deadzone' && amb.filter(e => e.type === 'drone').length < 3) spawnEnemy('drone', player.x + rnd(-500, 500), player.y + pick([-450, 450]), { ambient: true, home: { x: 1830, y: 1200 } });
  if (d !== 'deadzone' && Math.random() < 0.12 && amb.filter(e => e.type === 'scav').length < 2 && GT.chapter >= 1) {
    const a = rnd(0, 6.28), p = { x: player.x + Math.cos(a) * 600, y: player.y + Math.sin(a) * 600 };
    if (!solidAt(p.x, p.y)) for (let i = 0; i < 2; i++) spawnEnemy('scav', p.x + rnd(-30, 30), p.y + rnd(-30, 30), { ambient: true, home: p });
  }
  // GTA-style hostility: colonies at 3+ stars send guards after you in their district.
  for (const c of AI_COLS) {
    const stars = hostility(c), guards = enemies.filter(e => e.type === 'guard' && e.colony === c && !e.dead);
    if (stars >= 3 && d === COLONY_INFO[c].district && guards.length < stars - 1) {
      const home = { ironside: P.rhea, mercy: P.elena, crows: P.silas }[c];
      spawnEnemy('guard', home.x + rnd(-80, 80), home.y + rnd(-80, 80), { colony: c, color: COLONY_INFO[c].color, home: { ...home } });
    }
    if (stars < 3) for (const g of guards) g.dead = true;
  }
}
function alertColonyGuards() { /* guards only attack at 3+ stars; hook kept for future "provocation" rules */ }

// =====================================================================
// 5. RENDERING
// =====================================================================
let tNow = 0;
function draw() {
  const W = cv.width, H = cv.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (IS3D) { ctx.clearRect(0, 0, W, H); if (window.R3) R3.frame(); return; }   // 3D engine renders the world
  ctx.fillStyle = '#07090b'; ctx.fillRect(0, 0, W, H);
  if (!state.running) return;
  const sx = shakeA ? rnd(-shakeA, shakeA) : 0, sy = shakeA ? rnd(-shakeA, shakeA) : 0;
  const z = CAM.zoom * DPR;
  ctx.setTransform(z, 0, 0, z, W / 2 - CAM.x * z + sx, H / 2 - CAM.y * z + sy);
  const view = { x: CAM.x - VW / 2 / CAM.zoom - 100, y: CAM.y - VH / 2 / CAM.zoom - 100, w: VW / CAM.zoom + 200, h: VH / CAM.zoom + 200 };

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(groundCv, 0, 0, WORLD, WORLD);
  drawRiver(view);
  drawMarkers();
  for (const k of pickups) if (!k.taken) { ctx.fillStyle = '#e6e2d8'; ctx.fillRect(k.x - 7, k.y - 7, 14, 14); ctx.fillStyle = '#c33'; ctx.fillRect(k.x - 2, k.y - 5, 4, 10); ctx.fillRect(k.x - 5, k.y - 2, 10, 4); }
  const LIGHT = sunLight();
  for (const e of enemies) if (e.dead && !e.fly && !e.roof && !e.camera) drawChar(e, LIGHT);        // corpses underneath everyone
  for (const n of npcs) drawChar(n, LIGHT);
  for (const e of enemies) if (!e.dead && !e.fly && !e.roof && !e.camera) drawChar(e, LIGHT);
  drawLeaders(LIGHT);
  Action.drawGround(LIGHT);                                  // Part A: fire, cones, allies, actors, telegraphs
  for (const c of cars) if (!c.hidden) drawCar(c);
  if (!player.car && !player.roof && !player.gunner) drawChar(player, LIGHT);
  for (const b of bullets) { ctx.strokeStyle = b.own === 'p' ? '#ffd27a' : '#ff7a6a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * 0.02, b.y - b.vy * 0.02); ctx.stroke(); }
  drawBuildings(view);
  Action.drawAbove(LIGHT);                                   // Part A: rooftops, ziplines, detection meters
  for (const e of enemies) if (!e.dead && e.fly) drawDrone(e);
  for (const p of parts) { ctx.globalAlpha = clamp(p.life / p.max, 0, 1); ctx.fillStyle = p.color; ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size); }
  ctx.globalAlpha = 1;
  for (const l of lights) if (l.fire && l.x > view.x && l.x < view.x + view.w && l.y > view.y && l.y < view.y + view.h) drawFire(l);
  drawObjectiveArrow();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawLighting();
  drawWeather();
  if (player.hurtT > 0) { ctx.fillStyle = `rgba(200,30,20,${player.hurtT})`; ctx.fillRect(0, 0, W, H); }
  // vignette + film grain
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 60; i++) { ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`; ctx.fillRect(Math.random() * W, Math.random() * H, 2 * DPR, 2 * DPR); }
}
function drawRiver(view) {
  const x = RIVER.x, w = RIVER.w;
  if (GT.riverDead) {
    ctx.fillStyle = '#4a3a2a'; ctx.fillRect(x, 0, w, WORLD);
    ctx.strokeStyle = '#2d2218'; ctx.lineWidth = 2;
    const r = mulberry(99);
    for (let i = 0; i < 160; i++) { const cx = x + r() * w, cy = r() * WORLD; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + rnd(-1, 1) * 0 + (r() - .5) * 40, cy + (r() - .5) * 40); ctx.stroke(); }
  } else {
    const h = GT.river / 100;
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    const deep = `rgb(${lerp(70, 20, h)|0},${lerp(80, 60, h)|0},${lerp(50, 95, h)|0})`;
    g.addColorStop(0, '#1d2a2a'); g.addColorStop(0.2, deep); g.addColorStop(0.8, deep); g.addColorStop(1, '#1d2a2a');
    ctx.fillStyle = g; ctx.fillRect(x, 0, w, WORLD);
    ctx.strokeStyle = `rgba(160,200,220,${0.08 + h * 0.1})`; ctx.lineWidth = 2;
    const off = (tNow * 30) % 60;
    for (let y = Math.max(0, view.y - (view.y % 60)); y < Math.min(WORLD, view.y + view.h); y += 60) {
      ctx.beginPath(); ctx.moveTo(x + 20, y + off); ctx.quadraticCurveTo(x + 50, y + off + 10, x + 80, y + off); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 70, y + off + 30); ctx.quadraticCurveTo(x + 95, y + off + 40, x + 120, y + off + 30); ctx.stroke();
    }
    if (h < 0.6) { ctx.fillStyle = `rgba(120,140,40,${(0.6 - h) * 0.5})`; ctx.fillRect(x + 10, 0, w - 20, WORLD); }
  }
  // bridge
  ctx.fillStyle = '#2d3134'; ctx.fillRect(x - 10, BRIDGE.y, w + 20, BRIDGE.h);
  ctx.fillStyle = '#595e5f'; ctx.fillRect(x - 10, BRIDGE.y - 8, w + 20, 8); ctx.fillRect(x - 10, BRIDGE.y + BRIDGE.h, w + 20, 8);
  ctx.strokeStyle = 'rgba(210,190,120,.3)'; ctx.setLineDash([16, 18]); ctx.beginPath(); ctx.moveTo(x - 10, 1200); ctx.lineTo(x + w + 10, 1200); ctx.stroke(); ctx.setLineDash([]);
}
function drawBuildings(view) {
  const k = 0.0021;
  for (const b of buildings) {
    if (b.x > view.x + view.w || b.x + b.w < view.x || b.y > view.y + view.h || b.y + b.h < view.y) continue;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const ox = (cx - CAM.x) * b.hgt * k, oy = (cy - CAM.y) * b.hgt * k;
    if (b.tank) {
      const r = b.w / 2;
      ctx.fillStyle = '#1b1d1e'; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.28); ctx.fill();
      ctx.fillStyle = shadeCol(b.roof, -20); ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx - r + ox, cy + oy); ctx.lineTo(cx + r + ox, cy + oy); ctx.lineTo(cx + r, cy); ctx.fill();
      ctx.fillStyle = b.roof; ctx.beginPath(); ctx.arc(cx + ox, cy + oy, r, 0, 6.28); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx + ox, cy + oy, r * 0.6, 0, 6.28); ctx.stroke();
      continue;
    }
    const x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
    const wall = shadeCol(b.roof, -18);
    // side walls (only the ones facing away from camera are visible)
    ctx.fillStyle = shadeCol(wall, -10);
    quad(x0, y1, x1, y1, x1 + ox, y1 + oy, x0 + ox, y1 + oy);
    quad(x0, y0, x1, y0, x1 + ox, y0 + oy, x0 + ox, y0 + oy);
    ctx.fillStyle = wall;
    quad(x1, y0, x1, y1, x1 + ox, y1 + oy, x1 + ox, y0 + oy);
    quad(x0, y0, x0, y1, x0 + ox, y1 + oy, x0 + ox, y0 + oy);
    // roof
    ctx.fillStyle = b.roof; ctx.fillRect(x0 + ox, y0 + oy, b.w, b.h);
    ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.lineWidth = 2; ctx.strokeRect(x0 + ox + 3, y0 + oy + 3, b.w - 6, b.h - 6);
    if (b.ruined) {
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.beginPath(); ctx.moveTo(x0 + ox + b.w * 0.2, y0 + oy + b.h * 0.3); ctx.lineTo(x0 + ox + b.w * 0.6, y0 + oy + b.h * 0.15); ctx.lineTo(x0 + ox + b.w * 0.7, y0 + oy + b.h * 0.6); ctx.lineTo(x0 + ox + b.w * 0.35, y0 + oy + b.h * 0.7); ctx.fill();
    } else if (!b.land && !b.stall && !b.crate && b.w > 60) {
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(x0 + ox + b.w * (0.2 + (b.seed || 0) * 0.4), y0 + oy + b.h * 0.3, 14, 14);
    }
    if (b.cross) { ctx.fillStyle = '#c23b3b'; ctx.fillRect(cx + ox - 8, cy + oy - 26, 16, 52); ctx.fillRect(cx + ox - 26, cy + oy - 8, 52, 16); }
    if (b.station) { ctx.strokeStyle = GT.chapter >= 8 && state.dawn ? '#f2d46b' : '#6a6480'; ctx.lineWidth = 3; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x0 + ox + 20 + i * 45, y0 + oy + 10); ctx.lineTo(x0 + ox + 20 + i * 45, y1 + oy - 10); ctx.stroke(); } }
    if (b.helix) { ctx.fillStyle = '#a898ff'; ctx.font = '600 11px IBM Plex Mono, monospace'; ctx.fillText('HELIX', x0 + ox + 8, y0 + oy + 18); }
    if (b.stall) { ctx.strokeStyle = 'rgba(255,255,255,.2)'; for (let i = 6; i < b.w; i += 10) { ctx.beginPath(); ctx.moveTo(x0 + ox + i, y0 + oy); ctx.lineTo(x0 + ox + i, y1 + oy); ctx.stroke(); } }
  }
  // Crow's Market flyover (overhead, translucent)
  ctx.fillStyle = 'rgba(70,72,74,.55)'; ctx.fillRect(1640, 1880, 480, 60);
  ctx.fillStyle = 'rgba(40,40,40,.6)'; ctx.fillRect(2000, 1880, 40, 60);
}
function quad(a, b, c, d, e, f, g, h) { ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.lineTo(e, f); ctx.lineTo(g, h); ctx.closePath(); ctx.fill(); }
function shadeCol(col, amt) {
  let r, g, b;
  if (col[0] === '#') { const n = parseInt(col.slice(1), 16); r = n >> 16; g = n >> 8 & 255; b = n & 255; }
  else { [r, g, b] = col.match(/\d+/g).map(Number); }
  return `rgb(${clamp(r + amt, 0, 255)},${clamp(g + amt, 0, 255)},${clamp(b + amt, 0, 255)})`;
}
/** Shadow direction/length from the day clock: long in the morning & evening, short at noon. */
function sunLight() {
  const h = state.clock / 60;
  if (h < 6 || h > 19) return { dx: 1.5, dy: 2.5, a: 0.2 };        // night: soft, short
  const t = (h - 6) / 13;                                        // 0 = sunrise (east), 1 = sunset (west)
  const len = 3 + 8 * Math.abs(2 * t - 1);
  return { dx: (2 * t - 1) * len, dy: 2.5, a: 0.38 };
}
/** Draw any walking entity through the Character Renderer. */
function drawChar(e, L) {
  CR.draw(ctx, e.cfg, {
    x: e.x, y: e.y, a: e.a || 0, speed: e.spd || 0, walk: e.walk || 0,
    aim: !!e.aiming, weapon: e.weaponName || 'none', swing: e.swing || 0,
    hit: e.hitT || 0, dead: e.dead ? e.deadT : -1, t: tNow, light: L,
    rim: e === player ? 'rgba(242,169,59,.75)' : undefined,          // the player gets an amber rim light
  });
  if (e.maxHp && !e.dead && e.hp < e.maxHp) {
    ctx.fillStyle = '#000a'; ctx.fillRect(e.x - 12, e.y - 22, 24, 4);
    ctx.fillStyle = '#e0533f'; ctx.fillRect(e.x - 12, e.y - 22, 24 * e.hp / e.maxHp, 4);
  }
}
function drawLeaders(L) {
  const list = [[P.elena, 'elena', '#e46a78'], [P.rhea, 'rhea', '#d9824a'], [P.silas, 'silas', '#c9b04a']];
  for (const [p, id, col] of list) {
    CR.draw(ctx, CR.CAST[id], { x: p.x, y: p.y, a: Math.atan2(player.y - p.y, player.x - p.x), speed: 0, t: tNow, light: L });
    ctx.fillStyle = col; ctx.font = '600 11px IBM Plex Mono, monospace'; ctx.textAlign = 'center';
    ctx.fillText({ elena: 'Elena', rhea: 'Rhea', silas: 'Silas' }[id], p.x, p.y - 22); ctx.textAlign = 'left';
  }
}
function drawCar(c) {
  const t = VEH[c.type];
  ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.a);
  ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(-t.w / 2 + 4, -t.h / 2 + 4, t.w, t.h);
  if (c.hp <= 0) { ctx.fillStyle = '#1a1a1a'; ctx.fillRect(-t.w / 2, -t.h / 2, t.w, t.h); ctx.restore(); return; }
  ctx.fillStyle = c.color; ctx.fillRect(-t.w / 2, -t.h / 2, t.w, t.h);
  if (c.type === 'bike') { ctx.fillStyle = '#222'; ctx.fillRect(-t.w / 2 - 2, -2, 6, 4); ctx.fillRect(t.w / 2 - 4, -2, 6, 4); }
  else {
    ctx.fillStyle = 'rgba(20,30,35,.85)'; ctx.fillRect(t.w * 0.05, -t.h / 2 + 3, t.w * 0.22, t.h - 6);
    ctx.fillStyle = shadeCol(c.color, 18); ctx.fillRect(-t.w / 2 + 3, -t.h / 2 + 3, t.w * 0.45, t.h - 6);
    if (c.type === 'tanker') { ctx.fillStyle = '#b9b2a6'; ctx.beginPath(); ctx.ellipse(-t.w * 0.15, 0, t.w * 0.32, t.h * 0.42, 0, 0, 6.28); ctx.fill(); }
  }
  // headlights
  ctx.fillStyle = '#ffe9a8'; ctx.fillRect(t.w / 2 - 3, -t.h / 2 + 2, 3, 4); ctx.fillRect(t.w / 2 - 3, t.h / 2 - 6, 3, 4);
  ctx.restore();
  if (c.escort || c.silas) { const f = clamp(c.hp / VEH[c.type].hp, 0, 1); ctx.fillStyle = '#000a'; ctx.fillRect(c.x - 24, c.y - 30, 48, 5); ctx.fillStyle = c.silas ? '#c9b04a' : '#4fb3a9'; ctx.fillRect(c.x - 24, c.y - 30, 48 * f, 5); }
}
function drawDrone(e) {
  ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(tNow * 3);
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.arc(10, 14, 10, 0, 6.28); ctx.fill();
  ctx.strokeStyle = '#8f7cff'; ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(12, 0); ctx.stroke(); ctx.beginPath(); ctx.arc(12, 0, 5, 0, 6.28); ctx.stroke(); }
  ctx.restore();
  ctx.fillStyle = (tNow * 4 | 0) % 2 ? '#ff5a4a' : '#a898ff'; ctx.beginPath(); ctx.arc(e.x, e.y, 4, 0, 6.28); ctx.fill();
  if (e.hp < e.maxHp) { ctx.fillStyle = '#000a'; ctx.fillRect(e.x - 12, e.y - 22, 24, 4); ctx.fillStyle = '#a898ff'; ctx.fillRect(e.x - 12, e.y - 22, 24 * e.hp / e.maxHp, 4); }
}
function drawFire(l) {
  ctx.fillStyle = '#2b2b2b'; ctx.beginPath(); ctx.arc(l.x, l.y, 9, 0, 6.28); ctx.fill();
  for (let i = 0; i < 3; i++) { ctx.fillStyle = pick(['#f2a93b', '#ff7a3a', '#ffd27a']); ctx.beginPath(); ctx.arc(l.x + rnd(-4, 4), l.y + rnd(-4, 4), rnd(3, 7), 0, 6.28); ctx.fill(); }
  if (Math.random() < 0.3) parts.push({ x: l.x, y: l.y, vx: rnd(-10, 10), vy: rnd(-40, -20), life: 0.8, max: 0.8, color: 'rgba(90,90,90,.5)', size: 5 });
}
function drawMarkers() {
  const t = Mission.target();
  if (t) {
    const pulse = 1 + Math.sin(tNow * 4) * 0.15;
    ctx.strokeStyle = '#f2a93b'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(t.x, t.y, (t.r || 40) * pulse, 0, 6.28); ctx.stroke();
    ctx.fillStyle = 'rgba(242,169,59,.12)'; ctx.fill();
  }
  for (const m of markers) { ctx.fillStyle = m.color || '#4fb3a9'; ctx.beginPath(); ctx.arc(m.x, m.y, 9 + Math.sin(tNow * 5) * 2, 0, 6.28); ctx.fill(); }
}
function drawObjectiveArrow() {
  const t = Mission.target(); if (!t) return;
  const from = player.car || player, d = dist(from, t);
  if (d < 220) return;
  const a = Math.atan2(t.y - from.y, t.x - from.x);
  ctx.save(); ctx.translate(from.x + Math.cos(a) * 46, from.y + Math.sin(a) * 46); ctx.rotate(a);
  ctx.fillStyle = '#f2a93b'; ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-6, -8); ctx.lineTo(-2, 0); ctx.lineTo(-6, 8); ctx.fill();
  ctx.restore();
}
function darkness() {
  // 0 at noon, ~0.78 at midnight, smooth dusk/dawn.
  const h = state.clock / 60;
  const day = Math.cos((h - 13) / 24 * 2 * Math.PI);    // 1 at 13:00, -1 at 01:00
  let d = clamp(0.35 - day * 0.55, 0, 0.8);
  if (state.dawn) d *= 0.35;
  return d;
}
function drawLighting() {
  const dk = darkness(); if (dk < 0.03) return;
  const w = dark.width, h = dark.height, s = 0.5;
  dctx.globalCompositeOperation = 'source-over';
  dctx.clearRect(0, 0, w, h);
  dctx.fillStyle = `rgba(4,7,14,${dk})`; dctx.fillRect(0, 0, w, h);
  dctx.globalCompositeOperation = 'destination-out';
  const toS = (x, y) => [(x - CAM.x) * CAM.zoom * s + w / 2, (y - CAM.y) * CAM.zoom * s + h / 2];
  const hole = (x, y, r, a = 1) => {
    const [px, py] = toS(x, y), rr = r * CAM.zoom * s;
    if (px < -rr || py < -rr || px > w + rr || py > h + rr) return;
    const g = dctx.createRadialGradient(px, py, 0, px, py, rr);
    g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    dctx.fillStyle = g; dctx.beginPath(); dctx.arc(px, py, rr, 0, 6.28); dctx.fill();
  };
  hole(player.x, player.y, 170, 0.85);
  for (const l of lights) hole(l.x, l.y, l.r * (0.9 + Math.random() * 0.15), 0.9);
  for (const c of cars) if (c.hp > 0 && (c === player.car || c.path || c.silas || c.lit || c.enemyBike)) {
    for (let i = 1; i <= 3; i++) hole(c.x + Math.cos(c.a) * 60 * i, c.y + Math.sin(c.a) * 60 * i, 60 + i * 20, 0.6);
  }
  if (state.dawn) for (const b of buildings) if (!b.ruined && b.w > 70) hole(b.x + b.w / 2, b.y + b.h / 2, 70, 0.7);
  for (const b of bullets) hole(b.x, b.y, 40, 0.5);
  ctx.drawImage(dark, 0, 0, cv.width, cv.height);
  // warm fire tint
  ctx.globalCompositeOperation = 'lighter';
  for (const l of lights) {
    const px = (l.x - CAM.x) * CAM.zoom * DPR + cv.width / 2, py = (l.y - CAM.y) * CAM.zoom * DPR + cv.height / 2, rr = 90 * CAM.zoom * DPR;
    if (px < -rr || py < -rr || px > cv.width + rr || py > cv.height + rr) continue;
    const g = ctx.createRadialGradient(px, py, 0, px, py, rr);
    g.addColorStop(0, `rgba(242,140,50,${0.18 * dk})`); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(px - rr, py - rr, rr * 2, rr * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
}
const rain = Array.from({ length: 160 }, () => ({ x: Math.random(), y: Math.random(), s: rnd(0.6, 1) }));
function drawWeather() {
  const W = cv.width, H = cv.height;
  if (state.weather === 'rain') {
    ctx.strokeStyle = 'rgba(170,190,210,.35)'; ctx.lineWidth = 1 * DPR;
    for (const r of rain) { r.y = (r.y + 0.03 * r.s) % 1; r.x = (r.x + 0.004) % 1; ctx.beginPath(); ctx.moveTo(r.x * W, r.y * H); ctx.lineTo(r.x * W - 6 * DPR, r.y * H + 18 * DPR); ctx.stroke(); }
    ctx.fillStyle = 'rgba(30,45,60,.15)'; ctx.fillRect(0, 0, W, H);
  } else if (state.weather === 'fog') {
    ctx.fillStyle = 'rgba(150,160,165,.18)'; ctx.fillRect(0, 0, W, H);
  } else if (state.weather === 'dust') {
    ctx.fillStyle = 'rgba(140,100,55,.28)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(190,150,100,.35)';
    for (const r of rain) { r.x = (r.x + 0.012 * r.s) % 1; ctx.fillRect(r.x * W, r.y * H, 3 * DPR, 2 * DPR); }
  }
}

// =====================================================================
// 6. MISSIONS
// =====================================================================
const Mission = {
  ch: 0, i: -1, cur: null, started: false,
  target() { return this.cur && this.cur.target ? (typeof this.cur.target === 'function' ? this.cur.target() : this.cur.target) : null; },
  update(dt) {
    if (!this.cur || state.modal) return;
    if (this.cur.update && this.cur.update(dt)) this.next();
  },
  start(ch) {
    this.ch = ch; this.i = -1; this.cur = null; this.started = true; GT.chapter = ch;
    clearMissionStuff();
    saveGame();
    const c = CHAPTERS[ch];
    $('hud-chapter').textContent = c.label;
    chapterCard(c.label, c.title, c.sub, () => showBriefing(ch, () => this.next()));
  },
  next() {
    this.i++;
    const steps = CHAPTERS[this.ch].steps;
    if (this.i >= steps.length) { if (this.ch + 1 < CHAPTERS.length) this.start(this.ch + 1); return; }
    this.cur = steps[this.i];
    setObjective(this.cur.text || '');
    if (this.cur.start) this.cur.start();
  },
  retry() { clearMissionStuff(); if (this.cur && this.cur.start) this.cur.start(); if (this.cur) setObjective(this.cur.text || ''); }
};
function clearMissionStuff() {
  enemies = enemies.filter(e => !e.mission);
  cars = cars.filter(c => !c.mission);
  markers = [];
  Action.clear();
}
// ---- Step builders ----
const goTo = (pt, text, o = {}) => ({
  text, target: { x: pt.x, y: pt.y, r: o.r || 45 },
  start() { if (o.start) o.start.call(o); }, update(dt) { if (o.tick) o.tick.call(o, dt); return dist(player.car || player, pt) < (o.r || 45) && (!o.needCar || player.car); }
});
const act = (fn, text = '') => ({ text, start() { this.done = false; fn(() => { this.done = true; }); }, update() { return this.done; } });
const talk = lines => act(done => dialog(lines, done));
const killAll = (text, spawner, target) => ({
  text, target, start() { spawner().forEach(e => { e.mission = true; e.aggro = true; }); },
  update() { const left = enemies.filter(e => e.mission && !e.dead).length; setObjective(text + (left ? ` — ${left} left` : '')); return left === 0; }
});

// ---- Shared decision flows ----
/** One 2x2 round with decision cards + animated payoff matrix. */
function tradeDecision(o, done) {
  const m = MATRICES[o.game];
  decision({
    eyebrow: o.eyebrow, title: o.title, prompt: o.prompt,
    cards: [{ k: 'Cooperate', t: o.c0 || m.a0, s: o.s0 || '' }, { k: 'Defect', t: o.c1 || m.a1, s: o.s1 || '' }],
    timeout: 1
  }, choice => {
    const r = o.decide ? o.decide(choice) : playRound(o.colony, choice, o.game, o.ch);
    showMatrix(o.game, r, COLONY_INFO[o.colony].short, o.note ? o.note(r) : '', () => done(r));
  });
}

const CHAPTERS = [
  // ------------------------------------------------------------------
  { label: 'Prologue', title: 'Blackout', sub: 'Eighteen months without power. Somebody is still transmitting.',
    steps: [
      talk([['Veer', 'Eighteen months since the grid died. I was on shift that night. I keep thinking I should have seen it coming.'],
            ['Veer', 'That static on the old radio at the docks has been repeating all week. It isn’t random.'],
            ['Tip', 'Move with W A S D. Hold Shift to sprint. Follow the amber arrow.', 'sys']]),
      goTo(P.radio, 'Reach the radio at the Lakeside docks'),
      talk([['Radio', '…this is the Last Signal… the blackout was not an accident… Helix Dynamics triggered the cascade…', 'radio'],
            ['Radio', '…restart code attached… the city grid needs all four resources at once: water, fuel, medicine, food… if any colony holds back, it fails…', 'radio'],
            ['Veer', 'Helix did this? Then the only way back is getting all four colonies to trust each other. Me included.'],
            ['Tip', 'The TRUST METER (bottom right) shows how much each colony trusts you. Stars show hostility, like wanted levels.', 'sys']]),
      act(done => { updateTrustHud(); $('hud-br').hidden = false; done(); }),
      killAll('Scavengers followed the signal. Fight them off (aim with the mouse, click to shoot)',
        () => [spawnEnemy('scav', 760, 1830), spawnEnemy('scav', 740, 2080), spawnEnemy('scav', 830, 1960)]),
      talk([['Veer', 'Mercy Hospital needs water and we need medicine. Time for a trade.'],
            ['Tip', 'Walk to a vehicle and press E to get in. W/S drive, A/D steer, Space handbrake. Press E again to get out.', 'sys']]),
      { text: 'Get in the jeep (press E next to it)', target: () => cars.find(c => c.home) || P.home, update() { return !!player.car; } },
    ] },
  // ------------------------------------------------------------------
  { label: 'Chapter 1', title: 'First Contact', sub: 'Mercy Hospital. A one-shot deal with a stranger.',
    steps: [
      goTo(P.elena, 'Drive to Mercy Hospital and meet Dr. Elena Cruz', {
        start() { this.amb = false; },
        tick() { if (!this.amb && (player.y < 1350)) { this.amb = true; toast('Ambush on the road!', 'warn'); [[660, 1000], [745, 950], [700, 880], [760, 1060]].forEach(p => { const e = spawnEnemy('scav', p[0], p[1]); e.mission = false; e.aggro = true; }); } }
      }),
      talk([['Dr. Elena Cruz', 'So you’re the water engineer. We have antibiotics and you have clean water. Simple trade.'],
            ['Dr. Elena Cruz', 'Both convoys leave at dawn, sealed. Neither of us sees the other’s crates until it’s too late to back out.'],
            ['Veer', '(A sealed shipment. I could send half the water and she’d never know until tomorrow…)']]),
      act(done => tradeDecision({
        game: 'PD_OneShot', colony: 'mercy', ch: 1, eyebrow: 'Chapter 1 · One-shot Prisoner’s Dilemma',
        title: 'The sealed shipment', prompt: 'You both choose at the same moment. You can’t see Elena’s crates.',
        s0: 'All 40 barrels of clean water.', s1: 'Half the barrels are river water.',
        note: r => 'In a one-shot game Defect is a strictly dominant strategy: 5 > 3 if she cooperates, 1 > 0 if she defects. Both defecting is the only Nash equilibrium, yet (Cooperate, Cooperate) is better for both. That gap is the dilemma.'
      }, r => {
        unlock('pd'); unlock('nash'); unlock('pareto');
        const lines = {
          '0,0': [['Dr. Elena Cruz', 'Full crates on both sides. You kept your word, Veer. That’s rarer than antibiotics these days.']],
          '1,0': [['Dr. Elena Cruz', 'Half of these barrels are river water. I sent you everything we had.'], ['Dr. Elena Cruz', 'I’ll remember this. But I’m a doctor. I believe in second chances… sometimes.']],
          '0,1': [['Dr. Elena Cruz', 'I… held some of the medicine back. I’m sorry. I didn’t know you.']],
          '1,1': [['Dr. Elena Cruz', 'Short on both sides. We deserve each other.']],
        }[r.p + ',' + r.a];
        dialog(lines.concat([['Veer', 'If this were the only deal we ever made, cheating would always pay. But this city is small. We’ll meet again.']]), done);
      })),
    ] },
  // ------------------------------------------------------------------
  { label: 'Chapter 2', title: 'Iron Handshake', sub: 'Ironside Refinery. The same partner, again and again.',
    steps: [
      goTo(P.rhea, 'Cross the bridge to Ironside Refinery and meet Rhea Dutta'),
      talk([['Rhea "Iron" Dutta', 'You want fuel. I want water. We’ll run supplies together for a while.'],
            ['Rhea "Iron" Dutta', 'I trust once. Cross me once and we’re done. No second chances, no speeches.'],
            ['Rhea "Iron" Dutta', 'First job: my tanker goes to Lakeside. Keep the scavengers off it.']]),
      {
        text: 'Escort the fuel tanker to Lakeside. Keep it alive',
        target: () => cars.find(c => c.escort) || P.home,
        start() {
          const path = [{ x: 1900, y: 700 }, { x: 1650, y: 700 }, { x: 1650, y: 1200 }, { x: 700, y: 1200 }, { x: 700, y: 1700 }, { x: 700, y: 1930 }];
          this.tank = spawnCar('tanker', 1880, 700, Math.PI, { escort: true, mission: true, path, wp: 0 });
          this.waves = 0;
          if (!player.car) { const j = spawnCar('jeep', 1820, 740, Math.PI, { mission: true }); toast('Rhea left you a jeep.'); }
        },
        update() {
          const t = this.tank; if (!t) return false;
          if (t.hp <= 0) { toast('The tanker exploded. Try again.', 'warn'); Mission.retry(); return false; }
          const near = enemies.some(e => !e.dead && dist(e, t) < 220);
          t.halt = near; if (near && Math.random() < 0.01) toast('Tanker stopped. Clear the road!', 'warn');
          if (this.waves === 0 && t.wp >= 2) { this.waves = 1;[[1600, 950], [1700, 1000], [1590, 1050]].forEach(p => Object.assign(spawnEnemy('scav', p[0], p[1]), { mission: true, aggro: true })); }
          if (this.waves === 1 && t.wp >= 4) { this.waves = 2;[[650, 1450], [760, 1500], [640, 1560], [770, 1400]].forEach(p => Object.assign(spawnEnemy('scav', p[0], p[1]), { mission: true, aggro: true })); }
          if (t.wp >= t.path.length) { t.path = null; t.v = 0; toast('Tanker delivered.', 'gold'); return true; }
          return false;
        }
      },
      talk([['Rhea "Iron" Dutta', '(radio) Tanker’s in. Now the real work: five supply caches around Ironside. We split each one. You pick up, you decide how honest the split is.'],
            ['Tip', 'This is a REPEATED game. Rhea plays Grim Trigger: she cooperates until you defect once, then never again.', 'sys']]),
      ...[0, 1, 2, 3, 4].flatMap(k => {
        const spots = [{ x: 1650, y: 250 }, { x: 2100, y: 250 }, { x: 2300, y: 700 }, { x: 2100, y: 700 }, { x: 1450, y: 700 }];
        return [
          goTo(spots[k], `Supply run ${k + 1}/5: reach the cache`),
          act(done => tradeDecision({
            game: 'PD_Repeated', colony: 'ironside', ch: 2, eyebrow: `Chapter 2 · Repeated game · Round ${k + 1} of 5`,
            title: 'Split the cache', prompt: 'Rhea sends her half of the manifest over the radio at the same time as you.',
            s0: 'Report everything, split 50/50.', s1: 'Hide a crate for Lakeside.',
            note: r => {
              const grim = GT.col.ironside.strat === 'grim' && GT.col.ironside.hist.some(x => x.p === D);
              return grim ? 'Grim Trigger has fired: Rhea will defect in every future round. Your short-term +5 cost you 3 per round forever. With repeated play, cooperation is only rational while the future matters enough (discount factor δ ≥ (T−R)/(T−P) = 0.5).'
                : 'Mutual cooperation can be sustained: defecting once gains +2 (5 instead of 3) but loses at least 2 in every later round (1 instead of 3). That is the shadow of the future.';
            }
          }, r => {
            if (k === 0) { unlock('repeated'); unlock('grim'); }
            const betrayed = r.p === D && GT.col.ironside.strat === 'grim';
            if (betrayed && !this_flag('rheaBroke')) { dialog([['Rhea "Iron" Dutta', '(radio) Count’s off by a crate. I warned you, Veer. We’re done. My people will shoot on sight.', 'radio']], done); }
            else done();
          }))
        ];
      }),
      act(done => { state.weapons[1] = true; toast('Rifle unlocked (press 2)', 'gold'); unlock('shadow'); done(); }),
      talk([['Veer', 'Five deals with the same person changes everything. When tomorrow matters, honesty is not kindness. It is strategy.']]),
    ] },
  // ------------------------------------------------------------------
  { label: 'Chapter 3', title: 'The Poisoned River', sub: 'One river feeds every colony. Everyone wants just a little more.',
    steps: [
      talk([['Dr. Elena Cruz', '(radio) Veer, people are getting sick from the river. The water is changing colour upstream.', 'radio'],
            ['Veer', 'I’ll walk the banks. If someone’s poisoning it, there’ll be evidence.']]),
      act(done => { $('hud-river').hidden = false; updateRiverHud(); done(); }),
      ...[{ x: 1085, y: 430 }, { x: 1300, y: 820 }, { x: 1085, y: 1560 }].map((p, i) =>
        goTo(p, `Investigate the riverbank (${i + 1}/3 evidence)`, { r: 40, start() { markers = [{ x: p.x, y: p.y, color: '#a898ff' }]; } })),
      act(done => { markers = []; done(); }),
      talk([['Veer', 'Helix waste drums, all three. But the river would survive the poison if we stopped draining it dry.'],
            ['Veer', 'Each colony pumps what it wants. The river regenerates 15 units a day. Four colonies on Medium already take 40.'],
            ['Tip', 'Tragedy of the Commons: for 4 days, choose how much water Lakeside extracts. The river dies at 0 health, and then every colony loses 50 resources.', 'sys']]),
      act(done => commonsDay(1, done)),
      act(done => { unlock('commons'); if (GT.riverDead) dialog([['Veer', 'It’s gone. A dry bed of cracked mud. Everyone took a little more than their share, and together we killed it.']], done); else dialog([['Veer', 'The river held. Barely. Nobody was forced to hold back, but enough of us did.']], done); }),
      act(done => { $('hud-river').hidden = true; done(); }),
    ] },
  // ------------------------------------------------------------------
  { label: 'Chapter 4', title: 'The Bridge', sub: 'Crow’s Market. One bridge, two convoys, no brakes.',
    steps: [
      talk([['Silas Crow', '(radio) Veer! Lovely to hear you. The bridge is mine now. Toll’s simple: you swerve, you pay.', 'radio'],
            ['Silas Crow', '(radio) My convoy comes across at noon, full speed. So does yours, if you have the nerve.', 'radio'],
            ['Tip', 'Game of Chicken. Silas watches your reputation: the more you have defected so far, the more he believes you will not swerve.', 'sys']]),
      goTo({ x: 950, y: 1200 }, 'Get a vehicle and drive to the west end of the bridge', { r: 70, needCar: true }),
      { text: 'Hold your nerve…', start() { this.done = false; chickenScene(() => { this.done = true; }); }, update() { return this.done; } },
      talk([['Silas Crow', '(at the market) Business is business, Veer. Everybody is a price. Even you.']]),
    ] },
  // ------------------------------------------------------------------
  { label: 'Chapter 5', title: 'Stag Hunt', sub: 'A Helix depot, a generator core, and a partner you have to trust.',
    steps: [
      talk([['Veer', 'The Helix depot in the Dead Zone holds a generator core. With it, the grid restart gets a huge boost.'],
            ['Veer', 'Two teams can carry it out. One team alone can only grab loose supplies and run.']]),
      act(done => {
        const cards = AI_COLS.map(c => ({ k: `Trust ${trustOf(c).toFixed(0)}`, t: COLONY_INFO[c].leader, s: `${COLONY_INFO[c].name} · ${hostility(c)}★ hostility` }));
        decision({ eyebrow: 'Chapter 5 · Choose your partner', title: 'Who covers your back?', prompt: 'Your partner goes for the core only if they believe you will too.', cards, timeout: 0 },
          i => { GT.ally = AI_COLS[i]; toast(COLONY_INFO[GT.ally].leader + ' joins the raid.'); done(); });
      }),
      goTo(P.depot, 'Raid the Helix depot in the Dead Zone', { r: 90 }),
      killAll('Take out the Helix drones guarding the depot', () => [[2200, 850], [2320, 900], [2180, 1080], [2330, 1100], [2250, 780]].map(p => spawnEnemy('drone', p[0], p[1])), P.depot),
      act(done => {
        const ally = GT.ally, m = MATRICES.StagHunt;
        decision({ eyebrow: 'Chapter 5 · Stag Hunt', title: 'The core or the crates?', prompt: `${COLONY_INFO[ally].leader} is at the other end of the depot. Carrying the core takes both of you. Crates are safe to grab alone.`,
          cards: [{ k: 'Stag', t: m.a0, s: 'Huge payoff, only if your partner commits too.' }, { k: 'Hare', t: m.a1, s: 'Safe, small payoff whatever they do.' }], timeout: 1 },
          choice => {
            // Partner hunts the stag iff their trust (belief you'll cooperate) >= 60%,
            // exactly the mixed-equilibrium threshold q* = 0.6 for this matrix.
            const belief = trustOf(ally) / 100, a = belief >= 0.6 ? C : D;
            const r = recordRound(ally, choice, a, 'StagHunt', 5);
            if (r.p === C && r.a === C) GT.core = true;
            unlock('stag');
            showMatrix('StagHunt', r, COLONY_INFO[ally].short,
              `Your partner believed you would hunt the stag with probability ${belief.toFixed(2)}. Hunting the stag is their best response only when that belief is at least 0.60 (the mixed-equilibrium threshold). (Stag, Stag) is payoff-dominant; (Hare, Hare) is risk-dominant.`,
              () => dialog(GT.core ? [['Veer', 'The core is ours. Trust built over months paid off in one moment.']] : [['Veer', r.p === C ? 'I went for the core alone and came back with nothing.' : 'Crates. Safe, small, and the core stays with Helix.']], done));
          });
      }),
    ] },
  // ------------------------------------------------------------------
  { label: 'Chapter 6', title: "Kane's Offer", sub: 'Everyone got the same radio call. Nobody knows who said yes.',
    steps: [
      talk([['Director Kane', '(radio) Veer Malhotra. Helix is prepared to be generous. Power for Lakeside, only Lakeside. All you need to do is… hold back on restart day.', 'radio'],
            ['Director Kane', '(radio) I’ve made the same offer to the others. Ask yourself which of them said yes.', 'radio'],
            ['Veer', 'Three old relay towers could pick up Helix traffic. If I climb them, I can intercept the replies.']]),
      ...[{ x: 700, y: 700 }, { x: 1650, y: 700 }, { x: 1650, y: 1700 }].map((p, i) =>
        goTo(p, `Climb relay tower ${i + 1}/3 to intercept Helix traffic`, { start() { markers = [{ x: p.x, y: p.y, color: '#a898ff' }]; } })),
      act(done => { markers = []; bayesScreen(done); }),
    ] },
  // ------------------------------------------------------------------
  { label: 'Chapter 7', title: 'The Last Signal', sub: 'The power station. Four resources. One chance.',
    steps: [
      talk([['Veer', 'Restart day. Every colony brings its resource to the power station. Helix will throw everything at us.']]),
      goTo(P.station, 'Get to the power station in the Dead Zone', { r: 80 }),
      killAll('Defend the power station: wave 1 of 3', () => [[1700, 900], [2050, 900], [1720, 1130], [2040, 1130]].map(p => spawnEnemy('drone', p[0], p[1])), P.station),
      killAll('Defend the power station: wave 2 of 3', () => [[1500, 1000], [2250, 1000], [1875, 1450], [1600, 1400], [2150, 1400]].map((p, i) => spawnEnemy(i % 2 ? 'trooper' : 'drone', p[0], p[1])), P.station),
      killAll('Defend the power station: wave 3 of 3', () => [[1500, 900], [2250, 900], [1500, 1300], [2250, 1300], [1875, 1450], [1875, 700]].map((p, i) => spawnEnemy(i % 2 ? 'drone' : 'trooper', p[0], p[1])), P.station),
      act(done => publicGoodsScreen(done)),
    ] },
];
function this_flag(k) { if (GT[k]) return true; GT[k] = true; return false; }

// ---- Chapter 3: one day of the commons ----
function commonsDay(day, done) {
  if (day > 4 || GT.riverDead) { done(); return; }
  const amt = COMMONS.amounts;
  decision({ eyebrow: `Chapter 3 · Tragedy of the Commons · Day ${day} of 4`, title: 'How much water do you take?',
    prompt: `River health ${GT.river.toFixed(0)}. It regenerates +${COMMONS.regen} per day. Each colony keeps what it extracts.`,
    cards: [{ k: `+${amt.low}`, t: 'Low', s: 'Lakeside rations hard.' }, { k: `+${amt.medium}`, t: 'Medium', s: 'Normal usage.' }, { k: `+${amt.high}`, t: 'High', s: 'Fill every tank while you can.' }], timeout: 2 },
    i => {
      const mine = ['low', 'medium', 'high'][i];
      const choices = { lakeside: mine };
      for (const c of AI_COLS) choices[c] = STRATEGIES[GT.col[c].strat].extract(GT.col[c].hist, trustOf(c), GT.river);
      const before = GT.river; let total = 0;
      for (const c in choices) { total += amt[choices[c]]; GT.res[c] += amt[choices[c]]; }
      GT.river = Math.min(COMMONS.start, GT.river + COMMONS.regen - total);
      let died = false;
      if (GT.river <= 0) { GT.river = 0; GT.riverDead = true; died = true; for (const c in GT.res) GT.res[c] -= COMMONS.deathPenalty; rebuildColliders(); state.weather = 'dust'; state.weatherT = 120; }
      GT.day++; state.clock = 7 * 60;
      updateRiverHud();
      const rows = Object.entries(choices).map(([c, v]) => `<tr><td>${c === 'lakeside' ? 'Lakeside (you)' : COLONY_INFO[c].name}</td><td>${v}</td><td class="good">+${amt[v]}</td></tr>`).join('');
      const html = `<div class="eyebrow">Day ${day} results</div><h2>${died ? 'The river is dead' : 'River ' + before.toFixed(0) + ' → ' + GT.river.toFixed(0)}</h2>
        <div class="matrix-wrap"><table class="data"><tr><th>Colony</th><th>Extraction</th><th>Individual gain</th></tr>${rows}
        <tr><td><b>Total</b></td><td></td><td><b>${total}</b> vs regeneration ${COMMONS.regen}</td></tr></table></div>
        <p>Collective loss today: <b class="${total > COMMONS.regen ? 'bad' : 'good'}">${(before - GT.river).toFixed(0)} river health</b>. ${died ? `Every colony now loses ${COMMONS.deathPenalty} resources, including the ones that held back.` : ''}</p>
        <p class="mono" style="font-size:12px;color:var(--mute)">Your gain from taking High instead of Low is +${amt.high - amt.low} for you alone, but the river pays the whole cost and it is shared by everyone. Individually rational, collectively ruinous (Hardin, 1968).</p>`;
      panel(html, day < 4 && !died ? 'Next day' : 'Continue', () => commonsDay(day + 1, done));
    });
}

// ---- Chapter 4: scripted Chicken on the bridge ----
function chickenScene(done) {
  const pc = player.car;
  pc.scripted = true; pc.x = 880; pc.y = 1200; pc.a = 0; pc.v = 0;
  const sc = spawnCar('pickup', 1560, 1200, Math.PI, { scripted: true, silas: true, color: '#b58a3a', mission: true });
  let phase = 'go', t = 0, choice = -1, silasStay = false, crashed = false, belief = 0;
  const speed = 230 * SCALE.veh;
  const tick = dt => {
    if (phase === 'go') {
      pc.x += speed * dt; sc.x -= speed * dt;
      if (sc.x - pc.x < 320) {
        phase = 'wait';
        // Silas's belief that you will STAY = your reputation (Laplace-smoothed defection rate).
        const n = GT.log.length, d = GT.log.filter(r => r.p === D).length;
        belief = (d + 1) / (n + 2);
        decision({ eyebrow: 'Chapter 4 · Game of Chicken', title: 'Swerve or stay?', prompt: 'Silas is coming straight at you. Whoever swerves looks weak. If nobody swerves…',
          cards: [{ k: 'Swerve', t: 'Swerve', s: 'Pull onto the rail. Lose face, keep your life.' }, { k: 'Stay', t: 'Stay', s: 'Floor it and dare him.' }], timeout: 1 },
          i => {
            choice = i;
            // Silas's expected payoffs given belief s = P(you stay):
            //   Swerve: 3(1-s) + 1s = 3 - 2s      Stay: 5(1-s) + 0s = 5 - 5s
            //   Stay is better  <=>  s < 2/3  (the mixed-equilibrium threshold)
            silasStay = belief < 2 / 3;
            phase = 'resolve'; t = 0;
          });
      }
    } else if (phase === 'resolve') {
      t += dt;
      const gap = sc.x - pc.x;
      if (!crashed) { pc.x += speed * dt; sc.x -= speed * dt; }
      if (choice === 0) { pc.y = lerp(pc.y, 1162, dt * 5); pc.a = lerp(pc.a, -0.25, dt * 5); }
      if (!silasStay) { sc.y = lerp(sc.y, 1238, dt * 5); sc.a = lerp(sc.a, Math.PI - 0.25, dt * 5); }
      if (choice === 1 && silasStay && gap < 50 * SCALE.vdim && !crashed) { crashed = true; explode((pc.x + sc.x) / 2, 1200); damagePlayer(45); pc.hp -= 120; sc.hp = Math.max(1, sc.hp - 150); }
      if (t > 1.8) {
        phase = 'done'; chickenTick = null;
        pc.scripted = false; sc.scripted = false; sc.v = 0; pc.v = 0; sc.keep = true;
        const r = recordRound('crows', choice, silasStay ? D : C, 'Chicken', 4);
        unlock('chicken'); unlock('mixed');
        showMatrix('Chicken', r, 'Silas',
          `Silas estimated you would Stay with probability ${belief.toFixed(2)} (your reputation: how often you have defected so far). His payoffs: Swerve = 3 − 2s, Stay = 5 − 5s, so he stays whenever s < 2/3. That 2/3 is exactly the mixed-strategy equilibrium: each driver swerves with probability 1/3.`,
          () => done());
      }
    }
  };
  chickenTick = tick;
}
let chickenTick = null;

// ---- Chapter 6: Bayesian inference + signaling ----
function bayesScreen(done) {
  // Hidden truth: did each colony accept Kane's bribe? Prior from trust & history.
  const L1 = 0.8, L0 = 0.3;   // P(suspicious traffic | accepted), P(suspicious | refused)
  const rows = AI_COLS.map(c => {
    const grimFired = GT.col[c].strat === 'grim' && GT.col[c].hist.some(r => r.p === D);
    const prior = grimFired ? 0.9 : clamp(0.9 * (1 - trustOf(c) / 100), 0.02, 0.95);
    const accepted = Math.random() < prior;
    // one intercept per relay tower: the belief is updated three times, once per clue
    const upd = (b, sus) => sus ? b * L1 / (b * L1 + (1 - b) * L0) : b * (1 - L1) / (b * (1 - L1) + (1 - b) * (1 - L0));
    const clues = [0, 1, 2].map(() => Math.random() < (accepted ? L1 : L0));
    const steps = []; let b = prior; for (const sus of clues) { b = upd(b, sus); steps.push(b); }
    const post = b, evidence = post >= 0.5;          // the player acts on what the evidence says
    return { c, prior, accepted, clues, steps, evidence, post };
  });
  unlock('bayes');
  const cell = (sus, v) => `<td><span class="${sus ? 'bad' : 'good'}">${sus ? 'Suspicious' : 'Clean'}</span> → <b>${v.toFixed(2)}</b></td>`;
  const html = `<div class="eyebrow">Chapter 6 · Incomplete information</div><h2>Who took the bribe?</h2>
    <p><b>In simple words:</b> you can’t see who said yes to Kane. Each tower gave you one clue about each colony. A suspicious clue pushes your belief up, a clean one pushes it down. None of them is proof on its own.</p>
    <p>A colony that took the bribe looks suspicious 80% of the time; an honest one, 30% of the time. Your starting belief comes from each colony’s trust and history.</p>
    <div class="matrix-wrap"><table class="data"><tr><th>Colony</th><th>Start</th><th>Tower 1</th><th>Tower 2</th><th>Tower 3</th><th>Verdict</th></tr>
    ${rows.map(r => `<tr><td>${COLONY_INFO[r.c].name}</td><td>${r.prior.toFixed(2)}</td>${r.clues.map((sus, k) => cell(sus, r.steps[k])).join('')}<td class="${r.evidence ? 'bad' : 'good'}">${r.evidence ? 'Probably bribed' : 'Probably loyal'}</td></tr>`).join('')}
    </table></div>
    <p class="mono" style="font-size:12px;color:var(--mute)">Bayes’ rule, once per tower: P(bribed | clue) = P(clue | bribed)·P(bribed) / P(clue). Example from 0.50: one suspicious clue → 0.73, two → 0.88, three → 0.95.</p>`;
  panel(html, 'Decide what to broadcast', () => {
    decision({ eyebrow: 'Chapter 6 · Signaling', title: 'What do you tell the city?', prompt: 'Your message will shape what every colony believes about the others and about you.',
      cards: [{ k: 'Honest signal', t: 'Broadcast the intercepts', s: 'Share everything. Colonies your evidence points to (belief 0.50 or more) are exposed.' },
              { k: 'False signal', t: 'Forge a message', s: 'Frame the others and look like the only loyal colony. Lakeside gains +40, if nobody catches the lie.' }], timeout: 1 },
      i => {
        const out = [];
        for (const r of rows) {
          if (i === 0) {
            playRound(r.c, C, 'PD_Repeated', 6);
            GT.traitor[r.c] = r.accepted && !r.evidence;   // exposed traitors return to the fold
            out.push(`${COLONY_INFO[r.c].name}: ${r.accepted ? (r.evidence ? '<span class="gold">had taken the bribe and was exposed. They back down.</span>' : '<span class="bad">took the bribe, but the intercept missed it.</span>') : '<span class="good">was loyal.</span>'}`);
          } else {
            const caught = Math.random() < 0.5;   // cheap talk: lies are detected half the time
            playRound(r.c, caught ? D : C, 'PD_Repeated', 6);
            GT.traitor[r.c] = r.accepted;
            out.push(`${COLONY_INFO[r.c].name}: ${caught ? '<span class="bad">saw through your forgery.</span>' : 'believed you.'} ${r.accepted ? '<span class="bad">(It had secretly taken the bribe.)</span>' : ''}`);
          }
        }
        if (i === 1) GT.res.lakeside += 40;
        unlock('signal');
        panel(`<div class="eyebrow">Chapter 6 · Results</div><h2>${i === 0 ? 'The truth is out' : 'The lie is out there'}</h2><p>${out.join('<br>')}</p>
          <p class="mono" style="font-size:12px;color:var(--mute)">A signal is only worth what it costs to fake. Cheap talk (a message that costs nothing to send) is believed only when senders have a reputation for honesty. Each forgery that gets caught is recorded as a betrayal.</p>`, 'Continue', done);
      });
  });
}

// ---- Chapter 7: threshold public goods + endings ----
function publicGoodsScreen(done) {
  const html = `<div class="eyebrow">Chapter 7 · Public Goods Game</div><h2>The restart</h2>
    <p>Every colony holds ${PUBLIC.endowment} units. The grid restarts if the total contribution reaches <b>${PUBLIC.threshold}</b>. If it restarts, <i>everyone</i> gets the power (+${PUBLIC.gridBenefit}), including anyone who gave little. You keep whatever you don’t contribute.</p>
    ${GT.core ? `<p class="good">The Helix generator core adds +30 to the total.</p>` : ''}
    <label for="pg-slider" class="eyebrow" style="color:var(--mute)">Lakeside's water contribution</label>
    <div class="row"><input type="range" id="pg-slider" min="0" max="100" step="5" value="80" style="flex:1"><span class="big-num" id="pg-val">80</span></div>
    <p class="mono" style="font-size:12px;color:var(--mute)">The others decide at the same time. Their contribution = strategy base × trust in you.</p>`;
  panel(html, 'Commit water to the grid', () => {
    const mine = +$('pg-slider').value;
    const contrib = { lakeside: mine };
    for (const c of AI_COLS) {
      const base = STRATEGIES[GT.col[c].strat].base(GT.col[c].hist);
      const fair = clamp(base * trustOf(c) / 100, 0, PUBLIC.endowment);
      contrib[c] = Math.round(GT.traitor[c] ? fair * 0.5 : fair);   // a hidden bribe-taker holds back half
    }
    let total = Object.values(contrib).reduce((a, b) => a + b, 0) + (GT.core ? 30 : 0);
    const restarted = total >= PUBLIC.threshold;
    for (const c in contrib) GT.res[c] += PUBLIC.endowment - contrib[c] + (restarted ? PUBLIC.gridBenefit : 0);
    unlock('public');
    // ---- ending logic ----
    let ending;
    if (playerCoopRate() < 0.35) ending = 'iron';
    else if (restarted && AI_COLS.every(c => contrib[c] >= 50) && mine >= 50) ending = 'dawn';
    else if (restarted || total >= 200) ending = 'brownout';
    else ending = 'silence';
    GT.pg = { contrib, total, restarted, ending };
    const rows = Object.entries(contrib).map(([c, v]) => `<tr><td>${c === 'lakeside' ? 'Lakeside (you)' : COLONY_INFO[c].name}</td><td>${c === 'lakeside' ? 'You' : STRATEGIES[GT.col[c].strat].name}</td><td>${c === 'lakeside' ? '' : trustOf(c).toFixed(0)}</td><td><b>${v}</b>${GT.traitor[c] ? ' <span class="bad">(held back half: Kane’s bribe)</span>' : ''}</td></tr>`).join('');
    panel(`<div class="eyebrow">Chapter 7 · Results</div><h2>${total} / ${PUBLIC.threshold}</h2>
      <div class="matrix-wrap"><table class="data"><tr><th>Colony</th><th>Strategy</th><th>Trust</th><th>Contribution</th></tr>${rows}${GT.core ? '<tr><td>Generator core</td><td></td><td></td><td><b>30</b></td></tr>' : ''}</table></div>
      <p class="${restarted ? 'good' : 'bad'}"><b>${restarted ? 'The grid restarts.' : 'The restart fails.'}</b> Contributing is costly for each colony, but the grid only comes back if enough of them pay. Free-riding is individually tempting and collectively fatal.</p>`,
      'See the ending', () => { saveGame(); showEnding(ending); });
  });
  requestAnimationFrame(() => { const s = $('pg-slider'); if (s) s.oninput = () => { $('pg-val').textContent = s.value; }; });
}

// =====================================================================
// 7. UI: dialog, decision, matrix, panels, toasts
// =====================================================================
let dlgQueue = [], dlgDone = null;
const WHO_COLOR = { 'Veer': '#f2a93b', 'Dr. Elena Cruz': '#e46a78', 'Rhea "Iron" Dutta': '#d9824a', 'Silas Crow': '#c9b04a', 'Director Kane': '#a898ff', 'Radio': '#4fb3a9', 'Tip': '#8d9892' };
function dialog(lines, done) {
  dlgQueue = lines.slice(); dlgDone = done; state.modal++;
  $('dialog').hidden = false; showLine();
}
function showLine() {
  const [who, text, kind] = dlgQueue[0];
  const el = $('dialog');
  el.className = kind === 'radio' ? 'radio' : '';
  el.querySelector('.who').textContent = who === 'Tip' ? 'How to play' : who;
  el.querySelector('.who').style.color = WHO_COLOR[who] || '#dde0d7';
  el.querySelector('.line').textContent = text;
  if (kind === 'radio') sfx('static');
}
function advanceDialog() {
  if ($('dialog').hidden) return;
  dlgQueue.shift();
  if (dlgQueue.length) { showLine(); return; }
  $('dialog').hidden = true; state.modal--;
  const d = dlgDone; dlgDone = null; if (d) d();
}

let decTimer = null;
function decision(o, cb) {
  state.modal++; cv.classList.add('desat'); sfx('tension');
  $('dec-eyebrow').textContent = o.eyebrow; $('dec-title').textContent = o.title; $('dec-prompt').textContent = o.prompt;
  const box = $('dec-cards'); box.innerHTML = '';
  let finished = false;
  const finish = i => {
    if (finished) return; finished = true;
    clearInterval(decTimer); $('decision').hidden = true; cv.classList.remove('desat'); state.modal--; sfx('pick');
    cb(i);
  };
  o.cards.forEach((c, i) => {
    const b = document.createElement('button'); b.className = 'card'; b.disabled = !!c.disabled;
    b.innerHTML = `<span class="k">[${i + 1}] ${c.k}</span><span class="t"></span><span class="s"></span>`;
    b.querySelector('.t').textContent = c.t; b.querySelector('.s').textContent = c.s;
    b.onclick = () => finish(i); box.appendChild(b);
  });
  const total = 15, t0 = performance.now();
  const bar = $('dec-timer').firstElementChild;
  $('dec-timer').hidden = $('dec-timer-num').hidden = o.timeout === 0;
  if (o.timeout !== 0) {
    decTimer = setInterval(() => {
      const left = total - (performance.now() - t0) / 1000;
      bar.style.width = clamp(left / total * 100, 0, 100) + '%';
      $('dec-timer-num').textContent = left > 0 ? `${left.toFixed(0)}s · hesitating picks "${o.cards[o.timeout].t}"` : '';
      if (left <= 0) finish(o.timeout);
    }, 100);
  }
  $('decision').hidden = false;
  setTimeout(() => box.firstElementChild && box.firstElementChild.focus(), 50);
}

function matrixHTML(mKey, r, oppName, note) {
  const m = MATRICES[mKey], s = GTE.solve(m);
  const has = (arr, i, j) => arr.some(e => e[0] === i && e[1] === j);
  const labels = [m.a0, m.a1];
  let cells = `<div class="hd"></div><div class="hd">${oppName}: ${labels[0]}</div><div class="hd">${oppName}: ${labels[1]}</div>`;
  for (let i = 0; i < 2; i++) {
    cells += `<div class="hd rh">You: ${labels[i]}</div>`;
    for (let j = 0; j < 2; j++) {
      const chosen = r && r.p === i && r.a === j;
      const tags = [chosen ? '<span class="tag you">Result</span>' : '', has(s.pure, i, j) ? '<span class="tag nash">Nash</span>' : '', has(s.pareto, i, j) ? '<span class="tag pareto">Pareto</span>' : '', s.risk && s.risk[0] === i && s.risk[1] === j ? '<span class="tag risk">Risk-dom.</span>' : ''].join('');
      cells += `<div class="cell ${chosen ? 'chosen' : ''}"><div class="pay">${m.A[i][j]} <small>you</small> · ${m.B[i][j]} <small>them</small></div><div class="tags">${tags}</div></div>`;
    }
  }
  const lab = k => k === 0 ? labels[0] : labels[1];
  const facts = [
    `<div><b>Nash equilibria:</b> ${s.pure.length ? s.pure.map(e => `(${lab(e[0])}, ${lab(e[1])})`).join(', ') : 'none in pure strategies'}</div>`,
    `<div><b>Dominant strategy:</b> ${s.domP < 0 && s.domA < 0 ? 'none. Your best move depends on theirs' : `you: ${s.domP >= 0 ? lab(s.domP) : 'none'} · them: ${s.domA >= 0 ? lab(s.domA) : 'none'}`}</div>`,
    s.mixed ? `<div><b>Mixed equilibrium:</b> each side plays "${labels[0]}" with p = ${s.mixed.p.toFixed(2)} (expected payoff ${s.mixed.payP.toFixed(2)})</div>` : '',
    `<div><b>Pareto-optimal:</b> ${s.pareto.map(e => `(${lab(e[0])}, ${lab(e[1])})`).join(', ')}</div>`,
  ].join('');
  return `<div class="eyebrow">Payoff matrix · ${m.name}</div>
    ${r ? `<h3>You: ${labels[r.p]} · ${oppName}: ${labels[r.a]} → you ${r.pp}, them ${r.ap}</h3>` : ''}
    <div class="matrix-wrap"><div class="matrix">${cells}</div></div>
    <div class="legend"><span><span class="tag you">Result</span> what happened</span><span><span class="tag nash">Nash</span> no one gains by switching alone</span><span><span class="tag pareto">Pareto</span> can’t improve one side without hurting the other</span></div>
    ${PLAIN[mKey] ? `<p class="plain"><b>In simple words:</b> ${PLAIN[mKey]}</p>` : ''}
    ${note ? `<p style="color:var(--text)">${note}</p>` : ''}
    <details class="more"><summary>Show the game theory</summary><p>${m.explain}</p><div class="facts">${facts}</div></details>`;
}
// ---- Chapter briefings: the story in plain words before each chapter ----
// Shown after the title card (and again at any time with H) so the player always knows
// who is who, what they are doing, and what the big choice at the end of the chapter is about.
const BRIEFS = [
  { story: 'It is 2041. Eighteen months ago the power grid of Solace City died, and the city split into four colonies that do not trust each other: <b>Lakeside</b> (your home, has water), <b>Mercy Hospital</b> (medicine), <b>Ironside Refinery</b> (fuel) and <b>Crow’s Market</b> (food). You are <b>Veer</b>, a former power-station engineer. An old radio has started repeating a strange signal.',
    goal: 'Protect Lakeside from Razor’s scavengers, save the water tanks, and get the radio back if they steal it.',
    choice: 'No big choice yet. Learn to move, fight and take cover. At the end you will find out what the signal means.' },
  { story: 'The signal said the blackout was caused by a company called <b>Helix</b>, and that the grid can restart only if <b>all four colonies</b> feed power together. So you need friends. Lakeside has water; Mercy Hospital has medicine.',
    goal: 'Escort a water truck to Mercy Hospital, help Dr. Elena Cruz fight off snipers, then trade with her.',
    choice: '<b>Honest trade or cheat?</b> You and Elena each send a sealed crate. Cheating gives you more today, but Elena will remember it. Hint: Elena is generous and starts by trusting you.' },
  { story: 'Fuel is the next piece. Rhea “Iron” Dutta runs Ironside Refinery. She is tough and fair, and she <b>never forgives a betrayal</b>.',
    goal: 'Save Rhea’s workers from a refinery fire, then escort her fuel tanker home. After that, do several jobs with her.',
    choice: '<b>Keep your word or skim a bit?</b> You will deal with Rhea five times. One cheat and she treats you as an enemy for the rest of the game. Being honest every time pays the most in the long run.' },
  { story: 'Helix is dumping poison into the river that every colony drinks from. The river heals a little every day, but only if nobody takes too much.',
    goal: 'Chase the Helix barge by boat, then sneak into their pump station and blow it up. Then meet all four leaders.',
    choice: '<b>How much water do you take?</b> Taking a lot helps you now, but if everyone does it the river dies for good. Watch the river health bar at the top right and take a small or medium amount.' },
  { story: 'Silas Crow controls the market and the only bridge across the river. He wants to see who backs down first.',
    goal: 'Catch the thief who stole Lakeside’s pump part, then drive your convoy onto the bridge, head-on with Silas.',
    choice: '<b>Swerve or stay on the road?</b> If one side swerves, the other wins. If both stay, both crash. Silas decides based on your reputation: if you have been tough before, he is more likely to swerve.' },
  { story: 'The grid needs a generator core, and Helix is guarding one at a depot in the Dead Zone. You cannot carry it out alone.',
    goal: 'Pick one leader as your partner, sneak into the depot together, and clear the drones guarding the vault.',
    choice: '<b>Carry the core together, or grab the supply crates?</b> The core is the big prize, but only if your partner commits too. They will only trust you if their trust meter is 60 or more.' },
  { story: 'Director Kane of Helix has secretly offered every colony a bribe to sabotage the restart. Nobody knows who said yes.',
    goal: 'Hack three radio relay towers to listen in on the colonies.',
    choice: '<b>Who took the bribe, and what do you tell the city?</b> Use the clues you intercepted to guess who is lying. Then decide whether to tell the truth or bluff.' },
  { story: 'This is it. Everyone meets at the power station. Helix will throw everything they have at you, and Razor is back on their side.',
    goal: 'Get to the power station, defend the control room, and defeat Razor.',
    choice: '<b>Restart the grid.</b> Every colony gives some power; the city needs 280 in total. Colonies that trust you give more. Everything you did in earlier chapters decides the ending.' },
];
function showBriefing(ch, done) {
  const b = BRIEFS[ch], c = CHAPTERS[ch];
  if (!b) { done(); return; }
  panel(`<div class="eyebrow">${c.label} · Briefing</div><h2>${c.title}</h2>
    <div class="brief"><div><span class="bk">The story so far</span><p>${b.story}</p></div>
    <div><span class="bk">Your goal</span><p>${b.goal}</p></div>
    <div><span class="bk">The big choice</span><p>${b.choice}</p></div></div>
    <p class="mono" style="font-size:12px;color:var(--mute)">Follow the amber arrow and the objective at the top right. Press H at any time to read this briefing again.</p>`,
    'Start', done);
}

// Plain-language summary for each game, shown at the top of the result screen.
const PLAIN = {
  PD_OneShot: 'Cheating pays more for whoever does it, but if you both cheat you both end up worse off than if you had both been honest.',
  PD_Repeated: 'You will meet again. Cheating wins a little today but costs you a partner for every future deal.',
  Chicken: 'Someone has to back down. If nobody does, both lose badly.',
  StagHunt: 'Working together pays the most, but only if you can trust your partner to commit.',
  Pennies: 'There is no safe move: being unpredictable is the best strategy.',
};
function showMatrix(mKey, r, oppName, note, done) {
  panel(matrixHTML(mKey, r, oppName, note), 'Continue', done);
}
function panel(html, btnLabel, cb) {
  state.modal++;
  const sh = $('panel-sheet'); sh.className = 'sheet';
  sh.innerHTML = html + `<div class="row"><button class="btn" id="panel-ok">${btnLabel}</button></div>`;
  $('panel').hidden = false;
  const ok = $('panel-ok'); ok.focus();
  ok.onclick = () => { $('panel').hidden = true; state.modal--; if (cb) cb(); };
}
function chapterCard(eyebrow, title, sub, done) {
  state.modal++;
  $('cc-eyebrow').textContent = eyebrow; $('cc-title').textContent = title; $('cc-sub').textContent = sub;
  $('chaptercard').hidden = false; sfx('static');
  setTimeout(() => { $('chaptercard').hidden = true; state.modal--; done(); }, 2800);
}
function toast(msg, kind = '') {
  const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg;
  $('toasts').appendChild(t); setTimeout(() => t.remove(), 3600);
  while ($('toasts').children.length > 4) $('toasts').firstElementChild.remove();
}
function setObjective(t) { $('hud-objective').textContent = t || '—'; }

// =====================================================================
// 8. HUD, minimap, codex, pause, demo mode
// =====================================================================
function updateHud() {
  $('hp-bar').firstElementChild.style.width = clamp(player.hp, 0, 100) + '%';
  $('hud-weapon').textContent = player.car ? `${player.car.type.toUpperCase()} · ${Math.abs(player.car.v * 0.12).toFixed(0)} km/h` : `[${player.weapon + 1}] ${WEAPONS[player.weapon].name}`;
  $('hud-district').textContent = districtAt(player.x, player.y).name;
  const h = Math.floor(state.clock / 60), mi = Math.floor(state.clock % 60);
  $('hud-clock').textContent = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')} · ${state.weather}`;
}
function updateTrustHud(flash) {
  $('hud-br').innerHTML = AI_COLS.map(c => {
    const t = trustOf(c), s = hostility(c);
    return `<div class="trow"><b style="color:${COLONY_INFO[c].color}">${COLONY_INFO[c].name}</b><span class="stars">${'★'.repeat(s)}<span class="off">${'★'.repeat(5 - s)}</span></span>
      <div class="tbar"><i style="width:${t}%"></i></div><span class="tnum">trust ${t.toFixed(0)}</span><span class="tnum">${STRATEGIES[GT.col[c].strat].name}</span></div>`;
  }).join('');
}
function updateRiverHud() { $('river-num').textContent = GT.river.toFixed(0); $('river-bar').firstElementChild.style.width = GT.river + '%'; }

const mm = $('minimap'), mctx = mm.getContext('2d');
function drawMinimap() {
  const s = mm.width / WORLD;
  mctx.drawImage(groundCv, 0, 0, mm.width, mm.height);
  mctx.fillStyle = GT.riverDead ? '#5a4632' : '#2f6d8a'; mctx.fillRect(RIVER.x * s, 0, RIVER.w * s, mm.height);
  mctx.fillStyle = '#3a4146'; mctx.fillRect(RIVER.x * s, BRIDGE.y * s, RIVER.w * s, BRIDGE.h * s);
  mctx.fillStyle = '#3b444a'; for (const b of buildings) mctx.fillRect(b.x * s, b.y * s, Math.max(1, b.w * s), Math.max(1, b.h * s));
  mctx.strokeStyle = 'rgba(255,255,255,.12)'; mctx.lineWidth = 1;
  for (const d of DISTRICTS) mctx.strokeRect(d.x * s, d.y * s, d.w * s, d.h * s);
  const dot = (p, c, r = 4) => { mctx.fillStyle = c; mctx.beginPath(); mctx.arc(p.x * s, p.y * s, r, 0, 6.28); mctx.fill(); };
  dot(P.elena, '#e46a78', 3); dot(P.rhea, '#d9824a', 3); dot(P.silas, '#c9b04a', 3);
  for (const e of enemies) if (!e.dead) dot(e, '#e0533f', 2.5);
  Action.drawMinimap(mctx, s);                               // vision cones, allies, chase target
  const t = Mission.target(); if (t) { dot(t, '#f2a93b', 7); mctx.strokeStyle = '#000'; mctx.stroke(); }
  const me = player.car || player; dot(me, '#fff', 5);
  mctx.save(); mctx.translate(me.x * s, me.y * s); mctx.rotate(player.car ? player.car.a : player.a);
  mctx.fillStyle = '#f2a93b'; mctx.beginPath(); mctx.moveTo(9, 0); mctx.lineTo(-3, -4); mctx.lineTo(-3, 4); mctx.fill(); mctx.restore();
}

const CODEX = {
  nash: ['Nash Equilibrium', 'A set of choices where no player can do better by changing only their own move. Named after John Nash (1950).'],
  pareto: ['Pareto Optimality', 'An outcome where nobody can be made better off without making someone else worse off. Equilibria are not always Pareto-optimal.'],
  pd: ['Prisoner’s Dilemma', 'Payoffs T=5 > R=3 > P=1 > S=0. Defecting is dominant, so rational players end up at (Defect, Defect), even though (Cooperate, Cooperate) is better for both.'],
  repeated: ['Repeated Games', 'When the same players meet again and again, future payoffs can punish today’s betrayal. Cooperation becomes an equilibrium (the Folk Theorem).'],
  grim: ['Grim Trigger', 'Cooperate until the other side defects once, then defect forever. It sustains cooperation when the future matters: δ ≥ (T−R)/(T−P) = 0.5.'],
  shadow: ['Axelrod’s Tournaments', 'Robert Axelrod (1980) pitted strategies against each other in a repeated PD. Tit-for-Tat won: nice, retaliatory, forgiving, and clear.'],
  commons: ['Tragedy of the Commons', 'Garrett Hardin (1968): when a shared resource is free to use, each user gains the full benefit of taking more but bears only a fraction of the cost, so the resource gets over-used.'],
  chicken: ['Game of Chicken', 'Two pure Nash equilibria (one swerves, the other stays) and a mixed one. Reputation and commitment decide who blinks.'],
  mixed: ['Mixed Strategies', 'Randomising so that the opponent is indifferent between their options. In Chicken each driver swerves with probability 1/3.'],
  stag: ['Stag Hunt', 'A coordination game (Rousseau). (Stag, Stag) is payoff-dominant, (Hare, Hare) is risk-dominant. You only hunt the stag if you believe your partner will, here at 60% or more.'],
  bayes: ['Bayesian Updating', 'Incomplete information: start from a prior belief and update it with evidence: P(H|E) = P(E|H)P(H) / P(E).'],
  signal: ['Signaling & Cheap Talk', 'Messages that cost nothing to send are only credible if the sender has a reason, or a reputation, to be honest.'],
  public: ['Public Goods Game', 'Everyone benefits from the public good whether they paid or not, so each is tempted to free-ride. A threshold means a few free-riders can sink everyone.'],
};
function unlock(k) { if (state.codex[k]) return; state.codex[k] = true; toast('Codex updated: ' + CODEX[k][0], 'gold'); }
function openCodex() {
  const items = Object.entries(CODEX).map(([k, [t, d]]) => state.codex[k]
    ? `<div class="codex-item"><h4>${t}</h4><p>${d}</p></div>` : `<div class="codex-item locked"><h4>Locked entry</h4><p>Keep playing to unlock.</p></div>`).join('');
  panel(`<div class="eyebrow">Journal · press J</div><h2>Codex</h2><div class="codex-list">${items}</div>`, 'Close', null);
}
function togglePause() {
  if (!$('panel').hidden && $('panel-sheet').dataset.pause) { $('panel-ok').click(); return; }
  if (state.modal) return;
  const rows = AI_COLS.map(c => `<tr><td style="color:${COLONY_INFO[c].color}">${COLONY_INFO[c].name}</td><td>${COLONY_INFO[c].leader}</td><td>${trustOf(c).toFixed(0)}</td><td>${hostility(c)}★</td><td>${GT.col[c].hist.map(r => r.p === C ? 'C' : 'D').join('') || '—'}</td></tr>`).join('');
  panel(`<div class="eyebrow">Paused</div><h2>Solace City</h2>
    <div class="matrix-wrap"><table class="data"><tr><th>Colony</th><th>Leader</th><th>Trust</th><th>Hostility</th><th>Your moves</th></tr>${rows}</table></div>
    <div class="row"><button class="btn ghost" id="p-codex">Codex (J)</button><button class="btn ghost" id="p-save">Save</button><button class="btn ghost" id="p-sound">Sound: ${audioOn ? 'on' : 'off'}</button><button class="btn ghost" id="p-menu">Main menu</button><label class="row" style="gap:6px">Difficulty <select id="p-diff"><option value="easy">Easy</option><option value="normal">Normal</option><option value="hard">Hard</option></select></label>${IS3D ? '<label class="row" style="gap:6px">Graphics <select id="p-gfx"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="ultra">Ultra</option></select></label>' : ''}</div>
    <div class="keys"><kbd>WASD</kbd><span>Move / drive</span><kbd>Mouse</kbd><span>Aim, click to shoot</span><kbd>E</kbd><span>Enter / exit vehicle</span><kbd>1 2 3</kbd><span>Pistol, rifle, pipe</span><kbd>Shift</kbd><span>Sprint</span><kbd>\`</kbd><span>Examiner demo panel</span></div>`, 'Resume', null);
  $('panel-sheet').dataset.pause = '1';
  $('p-codex').onclick = () => { $('panel-ok').click(); openCodex(); };
  $('p-save').onclick = () => { saveGame(); toast('Game saved'); };
  $('p-sound').onclick = e => { audioOn = !audioOn; e.target.textContent = 'Sound: ' + (audioOn ? 'on' : 'off'); };
  if ($('p-diff')) { $('p-diff').value = Object.keys(DIFFICULTIES).find(k => DIFFICULTIES[k] === DIFF); $('p-diff').onchange = e => setDifficulty(e.target.value); }
  if (IS3D && $('p-gfx')) { $('p-gfx').value = storeGet('ls3d-preset') || 'medium'; $('p-gfx').onchange = e => window.R3 && R3.setPreset(e.target.value); }
  $('p-menu').onclick = () => { $('panel-ok').click(); saveGame(); state.running = false; showMenu(); };
  const ok = $('panel-ok'), prev = ok.onclick; ok.onclick = () => { delete $('panel-sheet').dataset.pause; prev(); };
}

// ---- Examiner demo mode ----
function toggleDemo() {
  if (!$('panel').hidden && $('panel-sheet').dataset.demo) { $('panel-ok').click(); return; }
  if (!state.running) { newGame(true); return; }
  if (state.modal) return;
  const opts = Object.entries(STRATEGIES).map(([k, s]) => `<option value="${k}">${s.name}</option>`).join('');
  const html = `<div class="eyebrow">Examiner demo mode · press \` to close</div><h2>Control room</h2>
    <div class="demo-grid">
      <div><h3>Jump to chapter</h3><div class="row" id="d-ch">${CHAPTERS.map((c, i) => `<button class="btn ghost" data-ch="${i}">${c.label.replace('Chapter ', 'Ch ')}</button>`).join('')}<button class="btn ghost" data-end="1">Ending</button></div></div>
      <div><h3>AI strategies (swap live)</h3>${AI_COLS.map(c => `<div class="row" style="margin-top:6px"><label for="d-s-${c}" style="width:110px">${COLONY_INFO[c].name}</label><select id="d-s-${c}" data-col="${c}">${opts}</select></div>`).join('')}</div>
      <div><h3>Play test rounds</h3>${AI_COLS.map(c => `<div class="row" style="margin-top:6px"><span style="width:110px">${COLONY_INFO[c].name}</span><button class="btn ghost" data-play="${c}" data-a="0">+C</button><button class="btn ghost" data-play="${c}" data-a="1">+D</button></div>`).join('')}</div>
      <div><h3>Nash solver</h3><div class="row"><select id="d-m">${Object.keys(MATRICES).map(k => `<option value="${k}">${MATRICES[k].name}</option>`).join('')}</select><button class="btn ghost" id="d-solve">Show matrix</button></div>
        <h3>Tournament</h3><button class="btn ghost" id="d-tour">Run Axelrod round-robin</button>
        <div class="row" style="margin-top:8px"><label><input type="checkbox" id="d-god" ${state.god ? 'checked' : ''}> God mode</label></div></div>
      <div style="grid-column:1/-1"><h3>Action lab (Part A mechanics)</h3><div class="row" id="d-lab">${ActionLab.list.map(([k, n]) => `<button class="btn ghost" data-lab="${k}">${n}</button>`).join('')}</div></div>
    </div>
    <div class="out" id="d-out">Colony memory:\n${AI_COLS.map(c => `${COLONY_INFO[c].name.padEnd(15)} trust ${trustOf(c).toFixed(1).padStart(5)}  ${GT.col[c].hist.map(r => (r.p ? 'D' : 'C') + (r.a ? 'D' : 'C')).join(' ')}`).join('\n')}</div>`;
  panel(html, 'Close', null);
  $('panel-sheet').dataset.demo = '1';
  const ok = $('panel-ok'), prev = ok.onclick; ok.onclick = () => { delete $('panel-sheet').dataset.demo; prev(); };
  for (const c of AI_COLS) { const s = $('d-s-' + c); s.value = GT.col[c].strat; s.onchange = () => { GT.col[c].strat = s.value; updateTrustHud(); toast(`${COLONY_INFO[c].name} now plays ${STRATEGIES[s.value].name}`); }; }
  $('d-ch').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    ok.click();
    if (b.dataset.end) { GT.pg = GT.pg || { contrib: {}, total: 0 }; publicGoodsScreen(() => { }); return; }
    jumpTo(+b.dataset.ch);
  };
  $('panel-sheet').querySelectorAll('[data-play]').forEach(b => b.onclick = () => {
    const r = playRound(b.dataset.play, +b.dataset.a, 'PD_Repeated', 0);
    $('d-out').textContent += `\n${COLONY_INFO[b.dataset.play].name}: you ${r.p ? 'D' : 'C'}, AI ${r.a ? 'D' : 'C'} → ${r.pp}/${r.ap}, trust ${trustOf(b.dataset.play).toFixed(1)}, hostility ${hostility(b.dataset.play)}★`;
  });
  $('d-solve').onclick = () => { const k = $('d-m').value; ok.click(); showMatrix(k, null, 'AI', '', null); };
  $('d-tour').onclick = () => { $('d-out').textContent = 'Axelrod-style round robin (200 rounds per match, PD T5 R3 P1 S0)\n' + GTE.tournament(200).map((r, i) => `#${i + 1} ${r.name.padEnd(22)} ${r.perRound.toFixed(2)} per round`).join('\n'); };
  $('d-god').onchange = e => { state.god = e.target.checked; };
  $('d-lab').onclick = e => { const b = e.target.closest('button'); if (!b) return; ok.click(); Mission.started = true; $('hud-br').hidden = false; ActionLab[b.dataset.lab](); };
}
function jumpTo(ch) {
  clearMissionStuff(); enemies = [];
  if (chickenTick) chickenTick = null;
  const starts = [P.home, P.home, { x: 700, y: 1250 }, { x: 1000, y: 700 }, { x: 800, y: 1200 }, { x: 1650, y: 1250 }, { x: 700, y: 1250 }, { x: 1650, y: 1250 }];
  player.car = null; player.hp = 100;
  Object.assign(player, starts[ch]);
  const c = spawnCar('jeep', player.x + 40, player.y + 30, 0);
  if (ch >= 3) state.weapons[1] = true;
  if (ch >= 1) $('hud-br').hidden = false;
  toast('Jumped to ' + CHAPTERS[ch].label + '. A jeep is next to you.');
  Mission.start(ch);
}

// =====================================================================
// 9. ENDINGS & STRATEGY REPORT
// =====================================================================
const ENDINGS = {
  dawn: ['Dawn', 'The substation hums. One by one, the windows of Solace City light up. Four colonies with every reason to betray each other chose not to. The city is warm again.'],
  brownout: ['Brownout', 'The grid stutters back, but not everywhere. Some districts stay dark, the ones whose leaders never quite trusted you, or that you never quite trusted. It’s a start. It’s not enough.'],
  iron: ['Iron Rule', 'You played everyone and won. The power station answers to Lakeside alone now. From the control room, the city looks exactly the way it must have looked to Director Kane.'],
  silence: ['Silence', 'The restart code runs, the turbines turn once and stop. Helix drones cross the river by nightfall. The Last Signal goes quiet.'],
};
function showEnding(key) {
  state.dawn = key === 'dawn';
  cv.classList.toggle('dawn', state.dawn);
  if (state.dawn) state.clock = 6 * 60;
  const [t, d] = ENDINGS[key];
  panel(`<div class="eyebrow">Ending</div><h2>${t}</h2><p>${d}</p>`, 'Strategy report', () => strategyReport(key));
}
function strategyReport(key) {
  const hist = AI_COLS.map(c => GT.col[c].hist);
  const matches = GTE.matchPlayer(hist);
  const best = matches[0];
  const totals = AI_COLS.map(c => ({ c, you: GT.col[c].hist.reduce((s, r) => s + r.pp, 0), them: GT.col[c].hist.reduce((s, r) => s + r.ap, 0) }));
  const html = `<div class="eyebrow">Strategy report · ${ENDINGS[key][0]}</div><h2>You played like ${best ? best.name : '—'}</h2>
    <p>Across ${GT.log.length} decisions you cooperated ${(playerCoopRate() * 100).toFixed(0)}% of the time. Your moves matched ${best ? best.name : ''} in ${(best ? best.match * 100 : 0).toFixed(0)}% of rounds, given what the colonies actually did.</p>
    <h3>Cooperation rate over time</h3><canvas class="chart" id="rep-chart" width="1400" height="400"></canvas>
    <h3>Total payoff vs each colony</h3>
    <div class="matrix-wrap"><table class="data"><tr><th>Colony</th><th>AI strategy</th><th>Your payoff</th><th>Their payoff</th><th>Final trust</th></tr>
    ${totals.map(t => `<tr><td style="color:${COLONY_INFO[t.c].color}">${COLONY_INFO[t.c].name}</td><td>${STRATEGIES[GT.col[t.c].strat].name}</td><td><b>${t.you}</b></td><td>${t.them}</td><td>${trustOf(t.c).toFixed(0)}</td></tr>`).join('')}</table></div>
    <h3>Closest known strategies</h3>
    <div class="matrix-wrap"><table class="data"><tr><th>Strategy</th><th>Match</th></tr>${matches.map(m => `<tr><td>${m.name}</td><td>${(m.match * 100).toFixed(0)}%</td></tr>`).join('')}</table></div>`;
  panel(html, 'Back to main menu', () => { state.running = false; showMenu(); });
  $('panel-sheet').dataset.report = '1';
  requestAnimationFrame(() => drawReportChart($('rep-chart')));
}
function drawReportChart(c) {
  if (!c) return;
  const g = c.getContext('2d'), W = c.width, H = c.height, pad = 50;
  const cs = getComputedStyle(document.documentElement);
  g.fillStyle = cs.getPropertyValue('--panel-2'); g.fillRect(0, 0, W, H);
  g.strokeStyle = cs.getPropertyValue('--line'); g.fillStyle = cs.getPropertyValue('--mute'); g.font = '22px IBM Plex Mono, monospace'; g.lineWidth = 1;
  for (const v of [0, 0.5, 1]) { const y = H - pad - v * (H - 2 * pad); g.beginPath(); g.moveTo(pad, y); g.lineTo(W - 20, y); g.stroke(); g.fillText((v * 100) + '%', 2, y + 7); }
  const L = GT.log; if (!L.length) return;
  let coop = 0; const pts = L.map((r, i) => { if (r.p === C) coop++; return [pad + (i / Math.max(1, L.length - 1)) * (W - pad - 30), H - pad - (coop / (i + 1)) * (H - 2 * pad)]; });
  g.beginPath(); g.moveTo(pts[0][0], H - pad); pts.forEach(p => g.lineTo(p[0], p[1])); g.lineTo(pts[pts.length - 1][0], H - pad); g.closePath();
  g.fillStyle = 'rgba(242,169,59,.15)'; g.fill();
  g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.strokeStyle = '#f2a93b'; g.lineWidth = 4; g.stroke();
  L.forEach((r, i) => { g.fillStyle = COLONY_INFO[r.c].color; g.beginPath(); g.arc(pts[i][0], pts[i][1], 7, 0, 6.28); g.fill(); });
  g.fillStyle = cs.getPropertyValue('--mute'); g.fillText('decision #1', pad, H - 12); g.fillText('#' + L.length, W - 90, H - 12);
}

// =====================================================================
// 10. SAVE / LOAD, AUDIO, MENU, MAIN LOOP
// =====================================================================
function saveGame() { storeSet('lastsignal-save', JSON.stringify({ GT, codex: state.codex, weapons: state.weapons })); }
function loadGame() { try { return JSON.parse(storeGet('lastsignal-save')); } catch (e) { return null; } }

let actx = null, audioOn = true;
function sfx(type) {
  if (!audioOn) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime, g = actx.createGain(); g.connect(actx.destination);
    const noise = (dur, vol, f) => {
      const b = actx.createBuffer(1, actx.sampleRate * dur, actx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const s = actx.createBufferSource(); s.buffer = b; const fl = actx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = f;
      s.connect(fl); fl.connect(g); g.gain.value = vol; s.start(t);
    };
    const tone = (f0, f1, dur, vol, type = 'square') => {
      const o = actx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(g); o.start(t); o.stop(t + dur);
    };
    if (type === 'shot') noise(0.12, 0.25, 2200);
    else if (type === 'eshot') noise(0.1, 0.08, 1400);
    else if (type === 'zap') tone(900, 200, 0.12, 0.05);
    else if (type === 'boom') noise(0.8, 0.5, 400);
    else if (type === 'static') noise(0.6, 0.06, 5000);
    else if (type === 'pick') tone(600, 1200, 0.1, 0.05, 'sine');
    else if (type === 'tension') tone(80, 60, 1.2, 0.12, 'sawtooth');
    else if (type === 'thud') noise(0.15, 0.2, 300);
    else if (type === 'door') noise(0.08, 0.1, 800);
    else if (type === 'swing') noise(0.1, 0.08, 600);
  } catch (e) { /* audio unavailable */ }
}

function playerDied() {
  if (player.dead) return;
  if (MissionManager.active()) { player.dead = true; MissionManager.fail('Veer is down'); return; }   // data-driven missions restart at the checkpoint
  player.dead = true; player.hp = 0; state.modal++;
  panel(`<div class="eyebrow">Signal lost</div><h2>Veer is down</h2><p>Lakeside medics pull you out. The current objective restarts.</p>`, 'Try again', () => {
    state.modal--;
    player = Object.assign(newPlayer(), (Mission.ch >= 2 && Mission.ch <= 7) ? { x: 700, y: 1250 } : {});
    spawnCar('jeep', player.x + 40, player.y + 30, 0);
    Mission.retry();
  });
}

function resetWorldEntities() {
  cars = []; enemies = []; bullets = []; parts = []; markers = [];
  player = newPlayer();
  spawnCar('jeep', 600, 2060, 0, { home: true });
  spawnCar('pickup', 700, 1300, Math.PI / 2); spawnCar('pickup', 1650, 780, Math.PI / 2);
  spawnCar('bike', 250, 1650, -Math.PI / 2); spawnCar('jeep', 2100, 1650, Math.PI / 2);
  spawnCar('pickup', 1650, 2230, 0); spawnCar('bike', 700, 640, Math.PI / 2); spawnCar('jeep', 250, 800, Math.PI / 2);
  if (GT.flags && GT.flags.armoredJeep) spawnCar('jeep', 640, 2080, 0, { color: '#3a4a36', hp: 420, armored: true });   // Rhea's gift (Chapter 2)
  pickups = [[520, 1990], [470, 620], [1880, 700], [1880, 1980], [700, 1100], [1650, 1500]].map(p => ({ x: p[0], y: p[1] }));
  spawnNPCs();
  CAM.x = player.x; CAM.y = player.y;
}
function startSession() {
  state.running = true; state.modal = 0;
  $('menu').hidden = true;
  ['hud-tl', 'hud-tr'].forEach(id => $(id).hidden = false);
  $('crosshair').hidden = false;
  $('minimap').hidden = false;
  cv.focus && cv.focus();
}
function newGame(demo) {
  GT = freshGT(); state.codex = {}; state.weapons = [true, false, true]; state.dawn = false; cv.classList.remove('dawn');
  state.clock = 7 * 60; state.weather = 'clear';
  genWorld(); renderGround(); resetWorldEntities(); updateTrustHud(); updateRiverHud();
  $('hud-br').hidden = true;
  startSession();
  if (demo) { $('hud-br').hidden = false; Mission.started = true; setObjective('Demo mode: press ` to open the control room'); toggleDemo(); }
  else Mission.start(0);
}
function continueGame() {
  const s = loadGame(); if (!s) return newGame();
  GT = Object.assign(freshGT(), s.GT); state.codex = s.codex || {}; state.weapons = s.weapons || [true, false, true];
  genWorld(); renderGround(); resetWorldEntities(); updateTrustHud(); updateRiverHud();
  if (GT.riverDead) state.weather = 'dust';
  $('hud-br').hidden = GT.chapter === 0;
  startSession();
  jumpTo(GT.chapter);
}
function showMenu() {
  $('menu').hidden = false;
  ['hud-tl', 'hud-tr', 'hud-br', 'crosshair'].forEach(id => $(id).hidden = true);
  $('minimap').hidden = true;
  $('btn-continue').hidden = !loadGame();
}
$('btn-new').onclick = () => newGame(false);
$('btn-lab').onclick = () => { $('menu').hidden = true; characterLab(() => { $('menu').hidden = false; }); };
$('btn-continue').onclick = continueGame;
$('btn-demo').onclick = () => newGame(true);
$('btn-controls').onclick = () => {
  $('menu').hidden = true;
  panel(`<div class="eyebrow">Controls</div><h2>How to play</h2>
    <div class="keys"><kbd>W A S D</kbd><span>Walk, or drive when in a vehicle</span><kbd>Shift</kbd><span>Sprint</span><kbd>Mouse</kbd><span>Aim. Click (or hold) to shoot</span><kbd>E</kbd><span>Get in / out of a vehicle</span><kbd>Space</kbd><span>Handbrake in a vehicle, dodge roll on foot, or continue a dialogue</span><kbd>Ctrl</kbd><span>Dodge roll (brief invulnerability)</span><kbd>Q</kbd><span>Take cover next to a wall, crate or car. Hold right mouse to peek</span><kbd>F / V</kbd><span>Light / heavy melee</span><kbd>E</kbd><span>Interact: vehicles, takedown from behind, climb, zipline, revive, defuse, turret</span><kbd>C</kbd><span>Crouch (quieter, harder to spot)</span><kbd>B</kbd><span>Carry a body / drop it in a dumpster</span><kbd>G</kbd><span>Ally command: coordinated takedown or focus fire</span><kbd>T</kbd><span>Place a barricade (defense missions)</span><kbd>1 2 3</kbd><span>Pistol, rifle (after Chapter 2), pipe</span><kbd>1 2 3</kbd><span>Pick a card on a decision screen</span><kbd>H</kbd><span>Story briefing: who is who, your goal, and the next big choice</span><kbd>J</kbd><span>Codex: every game theory concept you’ve met</span><kbd>Esc</kbd><span>Pause, trust meters, save</span><kbd>\`</kbd><span>Examiner demo mode: jump chapters, swap AI strategies, run the solver</span></div>
    <p>Follow the amber arrow and the objective at the top right. Your choices change each colony’s trust (bottom right). Colonies at 3+ hostility stars send guards after you in their district.</p>`, 'Back', () => { $('menu').hidden = false; });
};

// ---- Character Lab: showcase of the Phase 1 renderer ----
function characterLab(onClose) {
  panel(`<div class="eyebrow">Phase 1 \u00b7 Character renderer</div><h2>Character lab</h2>
    <p>Every figure is drawn from layered shapes (shadow, legs, arms, torso, head, hair, accessories) using one config object each. Nothing here is an image file.</p>
    <canvas class="lab" id="lab" width="1920" height="1500"></canvas>
    <div class="row"><button class="btn ghost" id="lab-shuffle">Shuffle survivors</button><span class="mono" style="font-size:12px;color:var(--mute)">Row 1 is Veer in every pose. The death pose loops every 4 s (in game, bodies fade after 10 s).</span></div>`, 'Close', onClose);
  $('panel-sheet').classList.add('wide');
  const cv2 = $('lab'), g = cv2.getContext('2d');
  let survivors = Array.from({ length: 16 }, () => CR.randomSurvivor());
  $('lab-shuffle').onclick = () => { survivors = Array.from({ length: 16 }, () => CR.randomSurvivor()); };
  const poses = [['Idle', { speed: 0 }], ['Walk', { speed: 140 }], ['Run', { speed: 240 }], ['Aim pistol', { aim: true, weapon: 'pistol' }],
    ['Aim rifle', { aim: true, weapon: 'rifle' }], ['Pipe swing', { weapon: 'pipe', swingLoop: true }], ['Hit', { hitLoop: true, aim: true, weapon: 'pistol' }], ['Death', { deathLoop: true }]];
  const castIds = [['veer', 'Veer'], ['rhea', 'Rhea'], ['elena', 'Elena'], ['silas', 'Silas'], ['kane', 'Kane'], ['tara', 'Tara'], ['jogi', 'Baba Jogi'], ['razor', 'Razor']];
  const foes = [['Scavenger', CR.enemyConfig('scav'), 'pistol'], ['Scavenger', CR.enemyConfig('scav'), 'pistol'], ['Brute', CR.enemyConfig('brute'), 'pipe'], ['Helix soldier', CR.enemyConfig('trooper'), 'rifle'],
    ['Ironside guard', CR.enemyConfig('guard', 'ironside'), 'rifle'], ['Mercy guard', CR.enemyConfig('guard', 'mercy'), 'pistol'], ["Crow's guard", CR.enemyConfig('guard', 'crows'), 'pistol'], ['Survivor', CR.randomSurvivor(), 'none']];
  const CW = 240, CH = 250, S = 4.2, t0 = performance.now();
  function frame(now) {
    if (!document.body.contains(cv2) || $('panel').hidden) return;
    const t = (now - t0) / 1000;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#182126'; g.fillRect(0, 0, cv2.width, cv2.height);
    const cell = (col, row, label, cfg, st) => {
      const cx = col * CW + CW / 2, cy = row * CH + 105;
      g.fillStyle = '#1e292f'; g.fillRect(col * CW + 6, row * CH + 6, CW - 12, CH - 12);
      g.save(); g.translate(cx, cy); g.scale(S, S);
      CR.draw(g, cfg, Object.assign({ x: 0, y: 0, a: -Math.PI / 2, t, light: { dx: 3, dy: 3, a: 0.4 } }, st));
      g.restore();
      g.fillStyle = '#8d9892'; g.font = '600 20px IBM Plex Mono, monospace'; g.textAlign = 'center'; g.fillText(label, cx, row * CH + CH - 22);
    };
    poses.forEach(([label, p], i) => {
      const st = Object.assign({}, p);
      st.walk = t * (p.speed || 0) * 0.17;
      if (p.swingLoop) st.swing = (t * 1.6) % 1;
      if (p.hitLoop) st.hit = (t % 1.2) < 0.18 ? 0.18 - (t % 1.2) : 0;
      if (p.deathLoop) st.dead = t % 4;
      cell(i, 0, label, CR.CAST.veer, st);
    });
    castIds.forEach(([id, label], i) => cell(i, 1, label, CR.CAST[id], { a: t * 0.7 + i, speed: 0 }));
    foes.forEach(([label, cfg, w], i) => cell(i, 2, label, cfg, { speed: 120, walk: t * 20, weapon: w, aim: w !== 'none' && w !== 'pipe' && (t + i) % 3 < 1.5 }));
    survivors.forEach((cfg, i) => cell(i % 8, 3 + Math.floor(i / 8), 'Survivor', cfg, { speed: i % 3 ? 110 : 0, walk: t * 18 + i, a: -Math.PI / 2 + Math.sin(t * 0.5 + i) * 0.6 }));
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// Menu signal waveform
const wv = $('wave'), wctx = wv.getContext('2d');
function drawWave(t) {
  wctx.clearRect(0, 0, wv.width, wv.height);
  wctx.strokeStyle = '#f2a93b'; wctx.lineWidth = 3; wctx.beginPath();
  for (let x = 0; x < wv.width; x += 4) {
    const burst = Math.sin(x * 0.012 - t * 0.002) > 0.55 ? 1 : 0.12;
    const y = wv.height / 2 + Math.sin(x * 0.09 + t * 0.01) * 22 * burst + (Math.random() - 0.5) * 6 * burst;
    x ? wctx.lineTo(x, y) : wctx.moveTo(x, y);
  }
  wctx.stroke();
}

let last = performance.now(), hudT = 0;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; tNow = now / 1000;
  if (!$('menu').hidden) drawWave(now);
  if (state.running) {
    if (!state.modal) update(dt * state.timeScale);
    if (chickenTick && !state.modal) chickenTick(dt);
    hudT -= dt;
    if (hudT <= 0) { hudT = 0.1; updateHud(); drawMinimap(); }
  }
  draw();
  requestAnimationFrame(loop);
}
showMenu();
requestAnimationFrame(loop);
