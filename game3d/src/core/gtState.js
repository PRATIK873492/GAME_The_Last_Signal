/* =====================================================================
   GAME THEORY STATE  (moved out of web/game.js section 2, logic unchanged)
   Holds every colony's memory and applies rounds through the engine.
   No Three.js here: the 3D renderer only reads from this module.
   ===================================================================== */
import './gametheory.js';                       // unchanged engine, registers window.GTE
export const GTE = window.GTE;
const { C, D, MATRICES, STRATEGIES } = GTE;

export const COLONY_INFO = {
  ironside: { short: 'Rhea', name: 'Ironside', leader: 'Rhea "Iron" Dutta', res: 'Fuel', color: '#d9824a', district: 'ironside' },
  mercy: { short: 'Elena', name: 'Mercy Hospital', leader: 'Dr. Elena Cruz', res: 'Medicine', color: '#e46a78', district: 'mercy' },
  crows: { short: 'Silas', name: "Crow's Market", leader: 'Silas Crow', res: 'Food', color: '#c9b04a', district: 'crows' },
};
export const AI_COLS = ['ironside', 'mercy', 'crows'];

export function freshGT() {
  return {
    col: { ironside: { strat: 'grim', hist: [] }, mercy: { strat: 'gtft', hist: [] }, crows: { strat: 'opp', hist: [] } },
    log: [], river: GTE.COMMONS.start, riverDead: false, day: 0,
    res: { lakeside: 0, ironside: 0, mercy: 0, crows: 0 },
    core: false, traitor: {}, chapter: 0,
  };
}

/** The single live game-theory state object. */
export let GT = freshGT();
export function setGT(v) { GT = v; notify(); }

// Anyone (HUD, 3D world) can listen for changes instead of being called directly.
const listeners = new Set();
export const onGTChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
function notify() { for (const fn of listeners) fn(GT); }

export const trustOf = c => GTE.trust(GT.col[c].hist);
export function hostility(c) {
  const col = GT.col[c];
  if (col.strat === 'grim' && col.hist.some(r => r.p === D)) return 5;
  return Math.max(0, Math.min(5, Math.ceil((50 - trustOf(c)) / 10)));
}
/** Simultaneous round: AI decides from past history only, then the round is recorded. */
export function playRound(c, pAct, mKey, ch) {
  const col = GT.col[c];
  const a = STRATEGIES[col.strat].choose(col.hist, MATRICES[mKey], Math.random);
  return recordRound(c, pAct, a, mKey, ch);
}
/** Record a round whose AI move was decided elsewhere (Chicken, Stag Hunt). */
export function recordRound(c, pAct, a, mKey, ch) {
  const m = MATRICES[mKey];
  const r = { p: pAct, a, pp: m.A[pAct][a], ap: m.B[pAct][a], ch, game: mKey };
  GT.col[c].hist.push(r);
  GT.log.push(Object.assign({ c }, r));
  GT.res.lakeside += r.pp; GT.res[c] += r.ap;
  notify();
  return r;
}
export function playerCoopRate() {
  if (!GT.log.length) return 1;
  return GT.log.filter(r => r.p === C).length / GT.log.length;
}
