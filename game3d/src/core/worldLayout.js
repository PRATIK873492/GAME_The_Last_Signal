/* =====================================================================
   WORLD LAYOUT  (moved out of web/game.js section 3, same data & seed)
   Pure data in MAP coordinates (the 2D game's pixels). Missions, markers
   and districts all speak map coordinates. The 3D code converts with
   toWorld() / toMap(): 1 map pixel = 0.2 metres.
   ===================================================================== */

export const MAP_TO_M = 0.2;                         // the one conversion factor
export const toWorld = (mx, my) => ({ x: mx * MAP_TO_M, z: my * MAP_TO_M });
export const toMap = (x, z) => ({ x: x / MAP_TO_M, y: z / MAP_TO_M });

export const WORLD = 2400;                           // map is 2400 x 2400 px = 480 x 480 m
export const RIVER = { x: 1120, w: 140 };
export const BRIDGE = { y: 1150, h: 100 };
export const ROADV = [250, 700, 1650, 2100];
export const ROADH = [250, 700, 1200, 1700, 2150];
export const RW = 80;
export const DISTRICTS = [
  { id: 'mercy', name: 'Mercy Heights', x: 0, y: 0, w: 1120, h: 1200, tint: '#161c20' },
  { id: 'lakeside', name: 'Lakeside', x: 0, y: 1200, w: 1120, h: 1200, tint: '#141d22' },
  { id: 'ironside', name: 'Ironside', x: 1260, y: 0, w: 1140, h: 900, tint: '#1e1a17' },
  { id: 'deadzone', name: 'The Dead Zone', x: 1260, y: 900, w: 1140, h: 600, tint: '#1b1720' },
  { id: 'crows', name: "Crow's Market", x: 1260, y: 1500, w: 1140, h: 900, tint: '#1d1b15' },
];
export const SPECIAL = [
  { x0: 250, x1: 700, y0: 1700, y1: 2150 },   // Lakeside base
  { x0: 250, x1: 700, y0: 250, y1: 700 },     // Mercy Hospital
  { x0: 1650, x1: 2100, y0: 250, y1: 700 },   // Ironside Refinery
  { x0: 1650, x1: 2100, y0: 1700, y1: 2150 }, // Crow's Market
  { x0: 1650, x1: 2100, y0: 700, y1: 1200 },  // Power station
  { x0: 2100, x1: 2400, y0: 700, y1: 1200 },  // Helix depot
];
export const DOCKS = { x: 950, y: 1880, w: 170, h: 170 };
/** Named points used by missions (map coordinates). */
export const P = {
  home: { x: 470, y: 1990 }, radio: { x: 1070, y: 1965 },
  elena: { x: 475, y: 560 }, rhea: { x: 1875, y: 610 }, silas: { x: 1875, y: 2060 },
  station: { x: 1875, y: 1010 }, depot: { x: 2255, y: 960 },
};

export function mulberry(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * Generates building footprints exactly like the 2D game (seed 2041).
 * Each building: { x, y, w, h (map px), hgt (height hint), roof colour, flags }
 */
export function genLayout() {
  const r = mulberry(2041);
  let buildings = []; const props = []; const lights = [];
  const xs = [0, 250, 700, 1120, 1260, 1650, 2100, 2400], ys = [0, 250, 700, 1200, 1700, 2150, 2400];
  const edge = v => v === 0 || v === 2400 ? 24 : v === 1120 || v === 1260 ? 64 : 0;

  function subdivide(x0, y0, x1, y1) {
    const w = x1 - x0, h = y1 - y0;
    if (w < 60 || h < 60) return;
    if (w < 230 && h < 230) {
      if (r() < 0.14) { props.push({ type: 'rubble', x: x0, y: y0, w, h }); return; }
      const g = 8, hgt = 20 + r() * 55, shade = 34 + Math.floor(r() * 18);
      buildings.push({ x: x0 + g, y: y0 + g, w: w - 2 * g, h: h - 2 * g, hgt, roof: `rgb(${shade},${shade + 4},${shade + 7})`, ruined: r() < 0.3, seed: r() });
      return;
    }
    if (w > h) { const s = x0 + w * (0.35 + r() * 0.3); subdivide(x0, y0, s, y1); subdivide(s, y0, x1, y1); }
    else { const s = y0 + h * (0.35 + r() * 0.3); subdivide(x0, y0, x1, s); subdivide(x0, s, x1, y1); }
  }

  for (let i = 0; i < xs.length - 1; i++) {
    if (xs[i] === 1120) continue;
    for (let j = 0; j < ys.length - 1; j++) {
      const bx0 = xs[i], bx1 = xs[i + 1], by0 = ys[j], by1 = ys[j + 1];
      if (SPECIAL.some(s => s.x0 === bx0 && s.y0 === by0)) continue;
      subdivide(bx0 + (edge(bx0) || RW / 2 + 14), by0 + (edge(by0) || RW / 2 + 14), bx1 - (edge(bx1) || RW / 2 + 14), by1 - (edge(by1) || RW / 2 + 14));
    }
  }
  buildings = buildings.filter(b => !overlap(b, DOCKS));

  // ---- Landmarks (same as the 2D game) ----
  const L = (x, y, w, h, o) => buildings.push(Object.assign({ x, y, w, h, hgt: 40, roof: '#2a2f33', land: true }, o));
  L(300, 290, 260, 150, { hgt: 70, roof: '#d8d5cc', cross: true, name: 'MERCY' });
  L(590, 300, 70, 110, { hgt: 45, roof: '#8f8a80' });
  L(1700, 450, 80, 60, { hgt: 30, roof: '#3b3027' });
  L(1800, 780, 180, 120, { hgt: 55, roof: '#2d2a36', station: true });
  L(2150, 760, 90, 60, { hgt: 30, roof: '#3a3346', helix: true });
  L(2280, 1060, 80, 70, { hgt: 30, roof: '#3a3346', helix: true });
  L(560, 1760, 110, 70, { hgt: 30, roof: '#35434a' });
  for (const tx of [1740, 1850, 1960]) buildings.push({ x: tx - 38, y: 290, w: 76, h: 76, hgt: 50, roof: '#6b625a', tank: true });
  for (const tx of [310, 380]) buildings.push({ x: tx, y: 2080, w: 50, h: 50, hgt: 45, roof: '#4d6d78', tank: true });
  const stallCols = ['#8a3b2c', '#3b6a5a', '#a07a2c', '#4b4f7a'];
  for (let k = 0; k < 6; k++) buildings.push({ x: 1700 + (k % 3) * 120, y: 1760 + Math.floor(k / 3) * 110, w: 70, h: 40, hgt: 12, roof: stallCols[k % 4], stall: true });
  for (let k = 0; k < 5; k++) buildings.push({ x: 2150 + (k % 3) * 70, y: 880 + Math.floor(k / 3) * 150, w: 36, h: 36, hgt: 14, roof: '#5a4d3a', crate: true });

  for (const f of [[430, 1900], [620, 2090], [470, 470], [1820, 520], [1990, 1920], [1760, 2080], [1060, 2000], [700, 1250], [1650, 1500]]) lights.push({ x: f[0], y: f[1], fire: true });
  return { buildings, props, lights };
}

export function districtAt(x, y) {
  if (x >= RIVER.x && x < RIVER.x + RIVER.w) return { id: 'river', name: 'The River' };
  return DISTRICTS.find(d => x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h) || DISTRICTS[1];
}
