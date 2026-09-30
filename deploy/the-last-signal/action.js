/* =====================================================================
   THE LAST SIGNAL - ACTION MECHANICS (Part A)
   Loaded AFTER game.js and uses its globals (player, enemies, cars,
   bullets, keys, mouse, state, CAM ...). game.js calls the functions
   marked "HOOK" at fixed points in its update / draw loop, so the
   original engine is extended, not rewritten.

     A1  State & helpers          A10 Quick-time events (QTE)
     A2  Input                    A11 Timed objectives
     A3  Player moves: dodge,     A12 Boss fights (phases + patterns)
         crouch, cover, melee,    A13 Ally AI (follow, cover, revive)
         takedowns, body drag     A14 Defense mode (waves, barricades,
     A4  Stealth AI (vision cones,     mounted turrets)
         detection meter, alarms) A15 Fire hazards & sabotage (bombs)
     A5  Other enemy AI (melee,   A16 Interaction (E key) & prompts
         snipers, bikers, planters) A17 Drawing (world, roofs, minimap)
     A6  Roofs, climbing, ziplines A18 Hooks called by game.js
     A7  Vehicle combat (drive-by, turret, ramming) & the boat
     A8  Chase controller (spline path)
     A9  Hacking minigame (nodes / frequency wave)
   ===================================================================== */
'use strict';
const Action = (() => {
  const A = {};

  // =====================================================================
  // A1. STATE & HELPERS
  // =====================================================================
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const norm = (x, y) => { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; };
  function fresh() {
    return {
      fires: [], interact: [], zips: [], hazards: [], smoke: [], debris: [], searchlights: [], turrets: [], allies: [], barricades: [], hideSpots: [], actors: [],
      stock: 0, timer: null, chase: null, sab: null, def: null, qte: null, hack: null,
      alarm: null, alarmT: 0, cam: null, holdProg: 0, holdKey: null, stats: { kills: 0, takedowns: 0, shots: 0, hits: 0 },
      banner: null,
    };
  }
  let S = fresh();
  A.S = () => S;
  A.stats = () => S.stats;

  // Two new enemy types used by Part A (added to the engine's spawn table in game.js):
  //   brute  = melee attacker with a pipe      sniper = rooftop marksman with a laser sight
  // Boats join the vehicle table here.
  VEH.boat = { max: 300, acc: 210, turn: 2.2, w: 46, h: 18, r: 14, color: '#3c5a6a', hp: 180 }; scaleVehicle(VEH.boat);

  /** Roof parallax offset: buildings are drawn leaning away from the camera, so
      anything standing ON a roof must be drawn with the same offset as that roof. */
  function roofOff(b) { const k = 0.0021; return { x: (b.x + b.w / 2 - CAM.x) * b.hgt * k, y: (b.y + b.h / 2 - CAM.y) * b.hgt * k }; }
  A.hitPos = e => { if (!e.roof) return e; const o = roofOff(e.roof); return { x: e.x + o.x, y: e.y + o.y }; };

  function setBanner(text, kind = '', secs = 2.2) { S.banner = { text, kind, t: secs }; }
  A.banner = setBanner;

  // =====================================================================
  // A2. INPUT
  // =====================================================================
  const mouseR = { down: false };
  cv.addEventListener('mousedown', e => { if (e.button === 2) mouseR.down = true; });
  addEventListener('mouseup', e => { if (e.button === 2) mouseR.down = false; });
  addEventListener('blur', () => { mouseR.down = false; });

  /** HOOK (keydown). Returns true if Part A used the key. */
  A.keydown = e => {
    if (S.qte) { if (!e.repeat) qteKey(e.code); return true; }
    if (S.hack) { hackKey(e.code); return true; }
    if (!state.running || state.modal) return false;
    if (e.repeat) return ['KeyE'].includes(e.code);
    switch (e.code) {
      case 'KeyE': interact(); return true;
      case 'KeyQ': toggleCover(); return true;
      case 'ControlLeft': case 'ControlRight': dodge(); return true;
      case 'Space': if (player.car) return false; dodge(); return true;
      case 'KeyF': melee(false); return true;
      case 'KeyV': melee(true); return true;
      case 'KeyC': if (!player.car && !player.gunner) { player.crouch = !player.crouch; toast(player.crouch ? 'Crouching: quieter and harder to spot' : 'Standing'); } return true;
      case 'KeyG': allyCommand(); return true;
      case 'KeyB': dragBody(); return true;
      case 'KeyT': placeBarricade(); return true;
    }
    return false;
  };

  // =====================================================================
  // A3. PLAYER MOVES
  // =====================================================================
  const sprinting = () => (keys.ShiftLeft || keys.ShiftRight) && !player.crouch;
  const moveInput = () => {
    let mx = 0, my = 0;
    if (keys.KeyW || keys.ArrowUp) my -= 1; if (keys.KeyS || keys.ArrowDown) my += 1;
    if (keys.KeyA || keys.ArrowLeft) mx -= 1; if (keys.KeyD || keys.ArrowRight) mx += 1;
    return { mx, my };
  };

  /** HOOK: final walking speed after crouch / heavy wind-up / carrying a body. */
  A.moveSpeed = base => {
    let s = base;
    if (player.crouch) s = 90 * SCALE.walk;
    if (player.heavyT > 0) s *= 0.35;
    if (player.carry) s = Math.min(s, 85 * SCALE.walk);
    return s;
  };
  /** HOOK: blind fire from cover is inaccurate; peeking (right mouse) is accurate. */
  A.spreadMul = () => player.cover && !mouseR.down ? 3.2 : player.crouch ? 0.7 : 1;
  A.canFire = () => !player.carry && !(player.heavyT > 0) && !player.takedown;
  A.peeking = () => !!(player.cover && mouseR.down);

  // ---- Dodge roll: short dash with brief invulnerability (i-frames) ----
  function dodge() {
    if (player.car || player.gunner || player.takedown || player.zip || player.climbing || (player.dodgeCd || 0) > 0 || player.carry) return;
    let { mx, my } = moveInput();
    if (!mx && !my) { mx = Math.cos(player.a); my = Math.sin(player.a); }
    player.dodge = norm(mx, my); player.a = Math.atan2(player.dodge.y, player.dodge.x); player.dodgeT = 0.32; player.invT = 0.3; player.dodgeCd = 0.75;
    player.cover = null; sfx('swing'); particle(player.x, player.y, 6, '#6a655c', 60, 0.4, 4);
  }
  A.aimHeld = () => mouseR.down;
  A.invulnerable = () => (player.invT || 0) > 0 || !!player.takedown;

  // ---- Cover: snap to the nearest wall / crate / car edge ----
  function coverCandidate() {
    let best = null, bd = 30 * SCALE.reach;
    for (const c of nearColliders(player.x, player.y)) {
      if (c.water || c.rail) continue;
      if (player.roof) continue;
      const cx = clamp(player.x, c.x, c.x + c.w), cy = clamp(player.y, c.y, c.y + c.h);
      const d = Math.hypot(player.x - cx, player.y - cy) - player.r;
      if (d < bd && d > -player.r) { bd = d; best = { c, n: norm(player.x - cx, player.y - cy) }; }
    }
    for (const c of cars) {
      if (c === player.car) continue;
      const d = dist(c, player) - c.r - player.r;
      if (d < bd) { bd = d; best = { car: c, n: norm(player.x - c.x, player.y - c.y) }; }
    }
    return best;
  }
  function toggleCover() {
    if (player.car || player.gunner) return;
    if (player.cover) { player.cover = null; return; }
    const cand = coverCandidate();
    if (!cand) { toast('No cover here. Get close to a wall, crate or car.', 'warn'); return; }
    player.cover = cand; snapToCover(); sfx('thud');
  }
  function snapToCover() {
    const cv_ = player.cover; if (!cv_) return;
    if (cv_.car) {
      const n = norm(player.x - cv_.car.x, player.y - cv_.car.y); cv_.n = n;
      player.x = cv_.car.x + n.x * (cv_.car.r + player.r + 1); player.y = cv_.car.y + n.y * (cv_.car.r + player.r + 1);
      return;
    }
    const c = cv_.c, cx = clamp(player.x, c.x, c.x + c.w), cy = clamp(player.y, c.y, c.y + c.h);
    const n = norm(player.x - cx, player.y - cy); cv_.n = n;
    player.x = cx + n.x * (player.r + 1); player.y = cy + n.y * (player.r + 1);
  }
  /** HOOK: in cover, WASD slides along the wall (the tangent). Returns true if it handled movement. */
  A.coverMove = (mx, my, dt) => {
    const cv_ = player.cover; if (!cv_) return false;
    if (cv_.car && cv_.car.hp <= 0 && !cv_.car.wreck) { player.cover = null; return false; }
    const t = { x: -cv_.n.y, y: cv_.n.x };
    const along = mx * t.x + my * t.y, away = mx * cv_.n.x + my * cv_.n.y;
    if (away > 0.7) { player.cover = null; return false; }                 // pushing away from the wall leaves cover
    player.x += t.x * along * 105 * SCALE.walk * dt; player.y += t.y * along * 105 * SCALE.walk * dt;
    snapToCover();
    collide(player, player.r);
    return true;
  };

  // ---- Melee: F = light, V = heavy (wind-up, knockback, stagger) ----
  function melee(heavy) {
    if (player.car || player.gunner || (player.meleeCd || 0) > 0 || player.takedown) return;
    if (heavy) { player.heavyT = 0.45; player.meleeCd = 1.1; toast('Heavy swing…'); }
    else { strike(false); player.meleeCd = 0.35; }
  }
  function strike(heavy) {
    player.swingT = 0.25; sfx('swing'); A.noise(player.x, player.y, 90);
    const range = (heavy ? 52 : 40) * SCALE.reach, arc = heavy ? 1.5 : 1.1;
    const dmg = heavy ? 55 : state.weapons[2] ? 30 : 16;
    for (const e of enemies) {
      if (e.dead || e.fly || !!e.roof !== !!player.roof) continue;
      if (dist(e, player) > range + e.r) continue;
      const a = Math.atan2(e.y - player.y, e.x - player.x);
      if (Math.abs(angDiff(a, player.a)) > arc) continue;
      hitEnemy(e, dmg);
      const kb = (heavy ? 60 : 18) * SCALE.reach; e.x += Math.cos(a) * kb; e.y += Math.sin(a) * kb; if (!e.roof) collide(e, e.r);
      if (heavy) { e.stun = 0.9; shake(4); }
    }
  }

  // ---- Stealth takedown from behind (E) ----
  function takedownTarget() {
    if (player.car || player.gunner || player.carry) return null;
    for (const e of enemies) {
      if (e.dead || e.fly || e.boss || e.mount || e.camera || !!e.roof !== !!player.roof) continue;
      if (e.state === 'alert' || (e.aggro && !e.stealth)) continue;
      if (dist(e, player) > 38 * SCALE.reach) continue;
      const fromE = Math.atan2(player.y - e.y, player.x - e.x);
      if (Math.abs(angDiff(fromE, e.a)) > 1.9) return e;          // player is behind the enemy's facing
    }
    return null;
  }
  function takedown(e) {
    player.takedown = { e, t: 0.9 }; player.cover = null;
    e.stun = 2; e.takenDown = true;
    player.a = Math.atan2(e.y - player.y, e.x - player.x);
    S.lastTakedownT = tNow;
    if (S.pendingSync && tNow - S.pendingSync < 1.6) { toast('Coordinated takedown!', 'gold'); S.pendingSync = 0; }
  }

  // ---- Body drag (B): carry a body into a dumpster so nobody finds it ----
  function dragBody() {
    if (player.car || player.gunner) return;
    if (player.carry) {
      const b = player.carry; player.carry = null;
      const spot = S.hideSpots.find(h => dist(h, b) < h.r);
      if (spot) { b.hidden = true; toast('Body hidden.', 'gold'); sfx('thud'); }
      else toast('Body dropped. Guards will raise the alarm if they find it.');
      return;
    }
    const b = enemies.find(e => e.dead && !e.fly && !e.hidden && dist(e, player) < 30 * SCALE.reach);
    if (b) { player.carry = b; b.keepBody = true; player.cover = null; toast('Carrying a body (B to drop). Dumpsters hide it.'); }
  }

  /** HOOK: special player states that replace normal walking. Returns true if handled. */
  A.controlPlayer = dt => {
    if (S.cinematic) { player.aiming = false; return true; }          // cutscene: the player is not in control
    // timers
    player.invT = (player.invT || 0) - dt; player.dodgeCd = (player.dodgeCd || 0) - dt; player.meleeCd = (player.meleeCd || 0) - dt;
    if (player.heavyT > 0) { player.heavyT -= dt; if (player.heavyT <= 0) strike(true); }
    if (player.carry) { const b = player.carry; b.x = player.x - Math.cos(player.a) * 16 * SCALE.reach; b.y = player.y - Math.sin(player.a) * 16 * SCALE.reach; b.deadT = 1; }
    if (player.gunner) { gunnerTick(dt); return true; }
    if (player.dodgeT > 0) {
      player.dodgeT -= dt;
      player.x += player.dodge.x * 390 * SCALE.walk * dt; player.y += player.dodge.y * 390 * SCALE.walk * dt;
      A.collidePlayer();
      return true;
    }
    if (player.takedown) {
      const td = player.takedown; td.t -= dt;
      const e = td.e;
      player.x = lerp(player.x, e.x - Math.cos(e.a) * 18 * SCALE.reach, dt * 10); player.y = lerp(player.y, e.y - Math.sin(e.a) * 18 * SCALE.reach, dt * 10);
      if (td.t < 0.45 && !e.dead) { hitEnemy(e, 9999); S.stats.takedowns++; sfx('thud'); particle(e.x, e.y, 6, '#6d1f19', 60, 0.4); }
      if (td.t <= 0) player.takedown = null;
      return true;
    }
    if (player.zip) { zipTick(dt); return true; }
    return false;
  };
  /** HOOK: keep the player inside its roof, or push it out of walls on the ground. */
  A.collidePlayer = () => { if (player.roof) clampRoof(player, player.roof); else collide(player, player.r); };

  // =====================================================================
  // A4. STEALTH AI
  // Enemies spawned with { stealth: true } patrol a route and must SEE
  // the player inside a vision cone to detect him. Their detection meter
  // fills white -> yellow (suspicious, investigates) -> red (alert).
  // =====================================================================
  const CONE = 0.62;                                  // half-angle of the vision cone (radians, ~35 degrees)
  function visionRange(e) { return (e.vision || 250) * (darkness() > 0.45 ? 0.72 : 1); }
  function canSee(e, t) {
    const d = dist(e, t), R = visionRange(e) * (t === player && player.crouch ? 0.8 : 1);
    if (d > R) return false;
    const a = Math.atan2(t.y - e.y, t.x - e.x);
    if (d > 44 * SCALE.reach && Math.abs(angDiff(a, e.a)) > CONE) return false;
    return lineOfSight(e, t);
  }
  /** Loud events (gunshots, explosions, sprinting) make nearby guards investigate. */
  A.noise = (x, y, r) => {
    for (const e of enemies) if (!e.dead && e.stealth && e.state !== 'alert' && Math.hypot(e.x - x, e.y - y) < r) {
      e.det = Math.max(e.det || 0, 0.55); e.last = { x, y }; e.state = 'suspicious';
    }
  };
  function alertEnemy(e, why) {
    if (e.state === 'alert') return;
    e.state = 'alert'; e.det = 1; e.stealth = false; e.aggro = true;
    if (!S.spottedT || tNow - S.spottedT > 4) { toast(why === 'body' ? 'A guard found a body!' : 'You have been spotted!', 'warn'); S.spottedT = tNow; }
    for (const o of enemies) if (!o.dead && o.stealth && o !== e && dist(o, e) < 280) { o.alertIn = 0.8; o.last = { x: player.x, y: player.y }; }
    if (S.alarm && !S.alarm.fired && S.alarmT <= 0) { S.alarmT = 4; S.alarmBy = e; setBanner('ALARM IN 4 s: silence the guard who saw you', 'warn', 1.5); }
  }
  function stealthThink(e, dt) {
    if (e.alertIn > 0) { e.alertIn -= dt; if (e.alertIn <= 0) alertEnemy(e, 'shout'); }
    const seen = canSee(e, player) && !player.car;
    // a guard who sees a body raises the alarm
    for (const b of enemies) if (b.dead && !b.hidden && !b.fly && !b.camera && b !== e && b !== player.carry && dist(e, b) < visionRange(e) * 0.8 && canSee(e, b)) { alertEnemy(e, 'body'); return; }
    if (seen) {
      const d = dist(e, player);
      let rate = (1.3 - d / visionRange(e)) * 1.5;
      if (player.crouch) rate *= 0.5;
      if (sprinting()) rate *= 1.35;
      if (player.cover && !mouseR.down) rate *= 0.55;
      e.det = Math.min(1, (e.det || 0) + rate * DIFF.detect * dt); e.last = { x: player.x, y: player.y };
    } else e.det = Math.max(0, (e.det || 0) - dt * 0.18);
    if (e.det >= 1) { alertEnemy(e, 'saw'); return; }

    const sp = e.speed * 0.45;
    if (e.det >= 0.45 && e.last) {                                  // suspicious: walk to what they noticed
      e.state = 'suspicious';
      const d = dist(e, e.last);
      if (d > 20) { e.a = Math.atan2(e.last.y - e.y, e.last.x - e.x); e.x += Math.cos(e.a) * sp * dt; e.y += Math.sin(e.a) * sp * dt; }
      else e.a += Math.sin(tNow * 2) * dt * 1.5;                    // look around
    } else if (e.route && e.route.length) {                         // patrol
      e.state = 'patrol';
      const wp = e.route[e.ri || 0];
      if (e.wait > 0) { e.wait -= dt; e.a += Math.sin(tNow * 1.3 + e.x) * dt * 0.9; }
      else if (dist(e, wp) < 10) { e.ri = ((e.ri || 0) + 1) % e.route.length; e.wait = 1.4; }
      else { e.a = Math.atan2(wp.y - e.y, wp.x - e.x); e.x += Math.cos(e.a) * sp * dt; e.y += Math.sin(e.a) * sp * dt; }
    } else { e.state = 'patrol'; e.a = (e.baseA ?? e.a) + Math.sin(tNow * 0.6 + e.x) * 0.9; }   // stationary guard sweeps
  }

  // =====================================================================
  // A5. OTHER ENEMY AI
  // =====================================================================
  /** HOOK: who an enemy attacks: the player, an ally, or the defended target. */
  A.pickTarget = (e, def) => {
    let best = def, bd = dist(e, def);
    for (const a of S.allies) if (!a.down && !a.dead) { const d = dist(e, a); if (d < bd * 0.8) { bd = d; best = a; } }
    if (S.def && e.attackTarget && !S.def.done) { const t = S.def.target; return { x: t.x + t.w / 2, y: t.y + t.h / 2, r: Math.max(t.w, t.h) / 2, defTarget: true }; }
    return best;
  };
  function meleeThink(e, dt) {
    const t = A.pickTarget(e, player.car || player);
    const d = dist(e, t);
    e.a = Math.atan2(t.y - e.y, t.x - e.x); e.aiming = false;
    if (e.windup > 0) {
      e.windup -= dt;
      if (e.windup <= 0) {
        e.swingT = 0.25; sfx('swing');
        if (dist(e, t) < 40 * SCALE.reach + (t.r || 11)) { if (t === player || t === player.car) damagePlayer(e.dmg); else if (t.defTarget) S.def.hp -= e.dmg; else hurtAlly(t, e.dmg); }
      }
      return;
    }
    if (d > 28 * SCALE.reach + (t.r || 11)) { e.x += Math.cos(e.a) * e.speed * dt; e.y += Math.sin(e.a) * e.speed * dt; }
    else if (e.cd <= 0) { e.windup = 0.4; e.cd = e.rate; }
  }
  function sniperThink(e, dt) {
    // unaware snipers watch their sector (baseA); walk up behind one for a takedown
    if (e.state !== 'alert' && !e.aggro) {
      e.a = (e.baseA ?? e.a) + Math.sin(tNow * 0.5 + e.x) * 0.35; e.aiming = false;
      if (canSee(e, player)) { e.det = Math.min(1, (e.det || 0) + dt * (player.crouch ? 0.6 : 1.2)); if (e.det >= 1) { e.state = 'alert'; toast('A sniper spotted you!', 'warn'); } }
      else e.det = Math.max(0, (e.det || 0) - dt * 0.3);
      return;
    }
    e.a = Math.atan2(player.y - e.y, player.x - e.x);
    const d = dist(e, player), sees = d < (e.range || 900) && !player.car;
    if (sees && e.state !== 'patrol') { e.aimT = (e.aimT || 0) + dt; e.aiming = true; }
    else { e.aimT = Math.max(0, (e.aimT || 0) - dt); e.aiming = false; }
    if (e.state === 'patrol' && sees && d < 520) e.state = 'alert';
    if (e.aimT >= 1.4) {                                           // laser locked on for 1.4 s: fire
      e.aimT = 0;
      const a = e.a + rnd(-0.015, 0.015);
      bullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 1400, vy: Math.sin(a) * 1400, life: 1, dmg: e.dmg, own: 'e', elev: true });
      sfx('shot');
    }
  }
  function riderThink(e, dt) {
    const c = e.mount;
    if (!c || c.hp <= 0) { e.mount = null; hitEnemy(e, 9999); return; }
    e.x = c.x; e.y = c.y;
    const t = player.car || player;
    e.a = Math.atan2(t.y - e.y, t.x - e.x); e.aiming = dist(e, t) < 420;
    if (e.aiming && e.cd <= 0) {
      e.cd = e.rate * rnd(0.8, 1.3);
      const a = e.a + rnd(-0.12, 0.12);
      bullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 520, vy: Math.sin(a) * 520, life: 1.1, dmg: e.dmg, own: 'e' });
      sfx('eshot');
    }
  }
  /** Enemy biker: a bike driven by AI that keeps pace beside the player, rider shoots. */
  A.spawnBiker = (x, y, extra = {}, type = 'bike') => {
    const c = spawnCar(type, x, y, extra.a || 0, { mission: true, enemyBike: true, npc: true, color: type === 'boat' ? '#3a3548' : '#7a4a3a', hostile: type === 'boat', name: type === 'boat' ? 'Helix gunboat' : 'Bike' });
    const e = spawnEnemy('scav', x, y, Object.assign({ mission: true, mount: c, aggro: true, rate: 1.1 }, extra));
    c.rider = e;
    c.ai = (car, dt) => {
      if (!car.rider || car.rider.dead) { car.ai = null; car.crashT = 1.2; return [0, 0]; }
      const t = player.car || player, side = (car.side = car.side || (Math.random() < 0.5 ? -1 : 1));
      const ta = t.a || 0, o1 = 70 * SCALE.vdim, o2 = 40 * SCALE.vdim, gx = t.x + Math.cos(ta + side * 1.4) * o1 - Math.cos(ta) * o2, gy = t.y + Math.sin(ta + side * 1.4) * o1 - Math.sin(ta) * o2;
      const want = Math.atan2(gy - car.y, gx - car.x);
      const d = Math.hypot(gx - car.x, gy - car.y);
      return [d > 60 * SCALE.vdim ? 1 : (t.v || 0) > car.v ? 0.6 : -0.2, clamp(angDiff(want, car.a) * 2, -1, 1)];
    };
    return e;
  };
  function planterThink(e, dt) {
    const tg = e.planter;
    if (!tg || tg.destroyed || tg.bomb) { e.planter = null; e.aggro = true; return false; }
    // shoot back at the player if close, but keep heading for the tank
    if (dist(e, player) < 220 && e.cd <= 0 && lineOfSight(e, player)) {
      e.cd = e.rate * 1.3; const a = Math.atan2(player.y - e.y, player.x - e.x) + rnd(-0.12, 0.12);
      bullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 520, vy: Math.sin(a) * 520, life: 1, dmg: e.dmg, own: 'e' }); sfx('eshot');
    }
    // walk to the target's planting spot; if a wall stops progress, side-step around it for a moment
    const spot = tg.plant || tg, ds = dist(e, spot);
    if (ds > 16) {
      if (e.detour > 0) e.detour -= dt;
      else {
        e.a = Math.atan2(spot.y - e.y, spot.x - e.x);
        if (e.lastP && Math.hypot(e.x - e.lastP.x, e.y - e.lastP.y) < e.speed * dt * 0.3) {
          // blocked: move along the other axis toward the spot (up/down if heading sideways, and vice versa)
          e.detour = 0.5;
          e.a = Math.abs(Math.cos(e.a)) > Math.abs(Math.sin(e.a)) ? (spot.y < e.y ? -Math.PI / 2 : Math.PI / 2) : (spot.x < e.x ? Math.PI : 0);
        }
      }
      e.lastP = { x: e.x, y: e.y };
      e.x += Math.cos(e.a) * e.speed * 1.1 * dt; e.y += Math.sin(e.a) * e.speed * 1.1 * dt; e.plantT = 0;
    } else {
      e.plantT = (e.plantT || 0) + dt; e.aiming = false;
      if (e.plantT >= 4) { tg.bomb = 8; e.planter = null; e.aggro = true; toast(`Explosive planted on ${tg.name}! Defuse it (hold E)`, 'warn'); sfx('zap'); }
    }
    return true;
  }

  /** HOOK: custom AI. Returns true if Part A moved this enemy (game.js then skips its default AI). */
  A.think = (e, dt) => {
    if (e.stun > 0) { e.stun -= dt; e.aiming = false; return true; }
    if (e.camera) { cameraThink(e, dt); return true; }
    if (e.boss) { bossThink(e, dt); return true; }
    if (e.mount) { riderThink(e, dt); return true; }
    if (e.sniper) { sniperThink(e, dt); return true; }
    if (e.planter) return planterThink(e, dt);
    if (e.stealth) { stealthThink(e, dt); return true; }
    if (e.melee) { meleeThink(e, dt); return true; }
    return false;
  };
  A.skipCollide = e => !!e.roof || !!e.mount;

  // =====================================================================
  // A6. ROOFS, CLIMBING & ZIPLINES
  // A roof is a building rectangle; entities with .roof = building stand on it.
  // =====================================================================
  function clampRoof(e, b) { e.x = clamp(e.x, b.x + e.r, b.x + b.w - e.r); e.y = clamp(e.y, b.y + e.r, b.y + b.h - e.r); }
  /** HOOK: line of sight when someone is on a roof: they look OVER the streets. */
  A.elevatedLOS = (a, b) => true;
  /** Add a ladder / fire escape: hold E at the base to climb (you can be shot while climbing). */
  A.addClimb = (b, x, y, label = 'Climb the fire escape') => {
    S.interact.push({ x, y, r: 34 * SCALE.reach + 4, hold: 1.4, label, fn() { player.roof = b; player.cover = null; const ix = clamp(x, b.x + 20, b.x + b.w - 20), iy = clamp(y, b.y + 20, b.y + b.h - 20); player.x = ix; player.y = iy; toast('On the roof. E at the ladder to climb down.'); } });
    const ix = clamp(x, b.x + 16, b.x + b.w - 16), iy = clamp(y, b.y + 16, b.y + b.h - 16);
    S.interact.push({ x: ix, y: iy, r: 30 * SCALE.reach + 4, roof: b, label: 'Climb down', fn() { player.roof = null; player.x = x; player.y = y; collide(player, player.r); } });
    S.ladders = S.ladders || []; S.ladders.push({ x, y, b });
  };
  /** Zipline from the roof of building b1 to the roof of b2. */
  A.addZip = (b1, p1, b2, p2) => { S.zips.push({ b1, p1, b2, p2 }); };
  function zipTick(dt) {
    const z = player.zip; z.t += dt / z.dur;
    const k = Math.min(1, z.t);
    player.x = lerp(z.z.p1.x, z.z.p2.x, k); player.y = lerp(z.z.p1.y, z.z.p2.y, k);
    player.a = Math.atan2(z.z.p2.y - z.z.p1.y, z.z.p2.x - z.z.p1.x);
    player.roof = k < 0.5 ? z.z.b1 : z.z.b2;
    if (k >= 1) { player.zip = null; player.roof = z.z.b2; clampRoof(player, z.z.b2); sfx('thud'); }
  }

  // =====================================================================
  // A7. VEHICLE COMBAT & BOAT
  // =====================================================================
  /** HOOK (every frame while driving): drive-by shooting toward the mouse. */
  A.inCar = dt => {
    if (!mouse.down || player.cd > 0) return;
    const w = state.weapons[1] ? WEAPONS[1] : WEAPONS[0];
    if (!state.weapons[0] && !state.weapons[1]) return;
    player.cd = w.rate * 1.2;
    const wm = worldMouse(), c = player.car, a = Math.atan2(wm.y - c.y, wm.x - c.x) + rnd(-w.spread * 1.6, w.spread * 1.6);
    bullets.push({ x: c.x + Math.cos(a) * 20, y: c.y + Math.sin(a) * 20, vx: Math.cos(a) * 820, vy: Math.sin(a) * 820, life: w.range, dmg: w.dmg, own: 'p' });
    S.stats.shots++; sfx('shot'); A.noise(c.x, c.y, 500);
  };
  /** Mounted gun: on a jeep driven by an ally (turretRide) or a fixed emplacement (defense). */
  function gunnerTick(dt) {
    const g = player.gunner;
    if (g.car) { if (g.car.hp <= 0) { dismount(); return; } player.x = g.car.x; player.y = g.car.y; }
    else { player.x = g.x; player.y = g.y; }
    const wm = worldMouse(); player.a = Math.atan2(wm.y - player.y, wm.x - player.x);
    g.heat = Math.max(0, (g.heat || 0) - dt * 0.45);
    if (g.heat < 0.35) g.over = false;
    player.aiming = true; player.weaponName = 'rifle';
    if (mouse.down && player.cd <= 0 && !g.over) {
      player.cd = 0.085; g.heat += 0.055; if (g.heat >= 1) { g.over = true; toast('Overheated!', 'warn'); }
      const a = player.a + rnd(-0.05, 0.05);
      bullets.push({ x: player.x + Math.cos(a) * 22, y: player.y + Math.sin(a) * 22, vx: Math.cos(a) * 950, vy: Math.sin(a) * 950, life: 0.9, dmg: 14, own: 'p', elev: !!g.car });
      particle(player.x + Math.cos(a) * 24, player.y + Math.sin(a) * 24, 3, '#ffd27a', 90, 0.1, 2);
      S.stats.shots++; sfx('shot');
    }
  }
  function mount(g) { player.gunner = g; player.cover = null; player.crouch = false; toast('On the gun. Mouse to aim, hold click to fire. E to get off.'); }
  function dismount() {
    const g = player.gunner; if (!g) return;
    if (g.car && g.locked) { toast('Stay on the gun!', 'warn'); return; }
    player.gunner = null;
    if (g.car) { player.x = g.car.x - 30; player.y = g.car.y; collide(player, player.r); }
    else player.y += 26;
  }
  /** The escort-jeep set piece: an ally drives along a path while the player mans the turret. */
  A.turretRide = (car, path, opts = {}) => {
    car.path = path; car.wp = 0; car.npc = true; car.turret = true; car.driver = opts.driver || 'tara';
    mount({ car, locked: opts.locked !== false });
    return car;
  };
  /** HOOK (updateCar): boats stay inside the river channel. */
  A.boatClamp = c => {
    if (GT.riverDead) { c.v = 0; return; }
    const r = c.r + 2;
    if (c.x < RIVER.x + r || c.x > RIVER.x + RIVER.w - r) { c.v *= 0.5; }
    c.x = clamp(c.x, RIVER.x + r, RIVER.x + RIVER.w - r); c.y = clamp(c.y, r, 2400 - r);
    if (Math.abs(c.v) > 80 && Math.random() < 0.6) parts.push({ x: c.x - Math.cos(c.a) * 22, y: c.y - Math.sin(c.a) * 22, vx: rnd(-20, 20), vy: rnd(-20, 20), life: 0.7, max: 0.7, color: 'rgba(200,225,235,.5)', size: 4 });
  };
  /** Vehicle-vs-vehicle ramming: push apart and damage both by the impact speed. */
  function ramming() {
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      if (a.hp <= 0 && b.hp <= 0) continue;
      const d = dist(a, b), min = a.r + b.r;
      if (d >= min || d < 0.01) continue;
      const n = norm(b.x - a.x, b.y - a.y), push = (min - d) / 2;
      a.x -= n.x * push; a.y -= n.y * push; b.x += n.x * push; b.y += n.y * push;
      const rel = Math.abs((a.v || 0) - (b.v || 0) * Math.cos(angDiff(a.a, b.a)));
      if (rel > 120 * SCALE.veh && !(a.scripted && b.scripted) && !(a.ramCd > tNow) && !(b.ramCd > tNow)) {
        a.ramCd = b.ramCd = tNow + 0.6;                 // one impact per collision, not one per frame
        const dmg = rel / SCALE.veh * 0.08; a.hp -= dmg * (b.type === 'tanker' ? 2 : 1) * (b.ramPower || 1); b.hp -= dmg * (a.type === 'tanker' ? 2 : 1) * (a.ramPower || 1);
        a.v *= 0.5; b.v *= 0.5; sfx('thud'); shake(5); particle((a.x + b.x) / 2, (a.y + b.y) / 2, 8, '#ccc', 140, 0.35);
        for (const c of [a, b]) if (c.enemyBike && c.rider && !c.rider.dead && rel > 180 * SCALE.veh) { hitEnemy(c.rider, 9999); c.hp = 0; }
      }
    }
    for (const c of cars) if (c.crashT > 0) { c.crashT -= 1 / 60; c.v *= 0.97; if (c.crashT <= 0) c.hp = 0; }
  }

  // =====================================================================
  // A8. CHASE CONTROLLER
  // The runner follows a Catmull-Rom spline through road waypoints. It speeds
  // up when the player is close and eases off when far. If the gap stays above
  // escapeDist for escapeTime seconds, the chase is lost.
  // =====================================================================
  function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) };
  }
  /** Samples the spline into an arc-length table so the runner moves at a true px/s speed. */
  function buildSpline(pts) {
    const P = [pts[0], ...pts, pts[pts.length - 1]], out = [];
    for (let i = 1; i < P.length - 2; i++) for (let k = 0; k < 20; k++) out.push(catmull(P[i - 1], P[i], P[i + 1], P[i + 2], k / 20));
    out.push(pts[pts.length - 1]);
    let L = 0; out[0].s = 0;
    for (let i = 1; i < out.length; i++) { L += dist(out[i], out[i - 1]); out[i].s = L; }
    return { pts: out, len: L };
  }
  function splineAt(sp, s) {
    const p = sp.pts; if (s >= sp.len) return { x: p[p.length - 1].x, y: p[p.length - 1].y, a: Math.atan2(p[p.length - 1].y - p[p.length - 2].y, p[p.length - 1].x - p[p.length - 2].x) };
    let i = 1; while (i < p.length - 1 && p[i].s < s) i++;
    const a = p[i - 1], b = p[i], k = (s - a.s) / Math.max(0.001, b.s - a.s);
    return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), a: Math.atan2(b.y - a.y, b.x - a.x) };
  }
  A.chase = o => {
    const sp = buildSpline(o.path);
    S.chase = Object.assign({ sp, s: 0, escT: 0, fired: new Set(), base: 250, boost: 90, escapeDist: 650, escapeTime: 10 }, o);
    const k = o.onFoot ? SCALE.walk : SCALE.veh;                             // mission data is written in 2D units
    S.chase.base *= k; S.chase.boost *= k;
    const r = o.runner; r.scripted = true;
    $('act-chase').hidden = false;
    return S.chase;
  };
  function chaseTick(dt) {
    const ch = S.chase, r = ch.runner, me = player.car || player;
    const gap = dist(r, me);
    const speed = gap < 220 ? ch.base + ch.boost : gap > 480 ? ch.base * 0.82 : ch.base;
    ch.s += speed * dt;
    const p = splineAt(ch.sp, ch.s);
    r.x = p.x; r.y = p.y; r.a = p.a; r.v = speed;
    const k = ch.s / ch.sp.len;
    for (const ev of ch.events || []) if (k >= ev.at && !ch.fired.has(ev)) { ch.fired.add(ev); ev.fn(ch); }
    ch.escT = gap > ch.escapeDist ? ch.escT + dt : Math.max(0, ch.escT - dt * 2);
    const box = $('act-chase');
    box.querySelector('b').textContent = `${Math.round(gap / 5)} m`;
    box.querySelector('i').style.width = clamp(100 - gap / ch.escapeDist * 100, 0, 100) + '%';
    box.classList.toggle('warn', ch.escT > 0);
    box.querySelector('span').textContent = ch.escT > 0 ? `Losing ${ch.label || 'the target'}: ${Math.ceil(ch.escapeTime - ch.escT)} s` : `Chasing ${ch.label || 'the target'}`;
    if (ch.escT >= ch.escapeTime) { const f = ch.onFail; stopChase(); if (f) f(); return; }
    if (ch.s >= ch.sp.len) { const f = ch.onEnd; stopChase(); if (f) f(); }
  }
  function stopChase() { if (!S.chase) return; S.chase.runner.scripted = S.chase.keepScripted || false; S.chase = null; $('act-chase').hidden = true; }
  A.stopChase = stopChase;

  // =====================================================================
  // A9. HACKING MINIGAME
  //   'nodes' : click matching coloured nodes left -> right (wrong = -2 s)
  //   'wave'  : A/D change frequency, W/S amplitude; match the target wave
  //             and hold it steady for 1.2 s
  // =====================================================================
  A.hack = (mode, cb, opts = {}) => {
    const H = S.hack = { mode, cb, time: opts.time || 20, left: opts.time || 20, t0: performance.now(), hold: 0 };
    state.modal++;
    const el = $('hack'), c = $('hack-cv'), g = c.getContext('2d');
    $('hack-title').textContent = mode === 'nodes' ? 'Bypass the circuit' : 'Match the frequency';
    $('hack-help').textContent = mode === 'nodes' ? 'Click a node on the left, then the node of the same colour on the right. Wrong links cost 2 seconds.' : 'A / D change the frequency, W / S change the amplitude. Match the dashed target wave and hold it steady.';
    el.hidden = false;
    const cols = ['#f2a93b', '#4fb3a9', '#e0533f', '#a898ff', '#8ec05a'];
    if (mode === 'nodes') {
      const n = opts.pairs || 4, order = cols.slice(0, n).sort(() => Math.random() - 0.5);
      H.left = cols.slice(0, n).map((col, i) => ({ col, x: 110, y: 60 + i * (240 / (n - 1)), done: false }));
      H.right = order.map((col, i) => ({ col, x: 530, y: 60 + i * (240 / (n - 1)) }));
      H.sel = null;
      c.onclick = ev => {
        const r = c.getBoundingClientRect(), x = (ev.clientX - r.left) * c.width / r.width, y = (ev.clientY - r.top) * c.height / r.height;
        const hit = arr => arr.find(p => Math.hypot(p.x - x, p.y - y) < 26);
        const L = hit(H.left), R = hit(H.right);
        if (L && !L.done) { H.sel = L; sfx('pick'); }
        else if (R && H.sel) {
          if (R.col === H.sel.col) { H.sel.done = true; H.sel.to = R; H.sel = null; sfx('pick'); if (H.left.every(p => p.done)) endHack(true); }
          else { H.t0 -= 2000; H.sel = null; sfx('thud'); }
        }
      };
    } else {
      H.tf = rnd(2, 5); H.ta = rnd(40, 90); H.f = 1; H.a = 20;
      c.onclick = null;
    }
    H.left0 = H.time;
    const frame = () => {
      if (S.hack !== H) return;
      const left = H.time - (performance.now() - H.t0) / 1000;
      $('hack-timer').firstElementChild.style.width = clamp(left / H.time * 100, 0, 100) + '%';
      g.fillStyle = '#0b1114'; g.fillRect(0, 0, c.width, c.height);
      g.strokeStyle = '#1c2a30'; g.lineWidth = 1; for (let x = 0; x < c.width; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, c.height); g.stroke(); }
      if (mode === 'nodes') {
        for (const p of H.left) if (p.done) { g.strokeStyle = p.col; g.lineWidth = 4; g.beginPath(); g.moveTo(p.x, p.y); g.bezierCurveTo(320, p.y, 320, p.to.y, p.to.x, p.to.y); g.stroke(); }
        if (H.sel) { g.strokeStyle = H.sel.col; g.setLineDash([6, 6]); g.beginPath(); g.moveTo(H.sel.x, H.sel.y); g.lineTo(320, H.sel.y); g.stroke(); g.setLineDash([]); }
        for (const p of [...H.left, ...H.right]) { g.fillStyle = p.col; g.beginPath(); g.arc(p.x, p.y, 18, 0, 6.28); g.fill(); g.strokeStyle = H.sel === p ? '#fff' : '#000'; g.lineWidth = 3; g.stroke(); }
      } else {
        // steer the player's wave with held keys
        const k = (code) => keys[code];
        const dt = 1 / 60;
        if (k('KeyA') || k('ArrowLeft')) H.f = Math.max(0.5, H.f - dt * 1.5); if (k('KeyD') || k('ArrowRight')) H.f = Math.min(6, H.f + dt * 1.5);
        if (k('KeyS') || k('ArrowDown')) H.a = Math.max(5, H.a - dt * 40); if (k('KeyW') || k('ArrowUp')) H.a = Math.min(110, H.a + dt * 40);
        const wave = (f, a, col, dash) => { g.strokeStyle = col; g.lineWidth = 3; g.setLineDash(dash ? [8, 8] : []); g.beginPath(); for (let x = 0; x <= c.width; x += 4) { const y = c.height / 2 + Math.sin(x / c.width * f * 6.283 + performance.now() / 400) * a; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); g.setLineDash([]); };
        wave(H.tf, H.ta, '#4fb3a9', true); wave(H.f, H.a, '#f2a93b', false);
        const ok = Math.abs(H.f - H.tf) < 0.18 && Math.abs(H.a - H.ta) < 7;
        H.hold = ok ? H.hold + dt : 0;
        g.fillStyle = ok ? '#4fb3a9' : '#8d9892'; g.font = '600 16px IBM Plex Mono, monospace';
        g.fillText(`freq ${H.f.toFixed(2)} / ${H.tf.toFixed(2)}   amp ${H.a.toFixed(0)} / ${H.ta.toFixed(0)}   ${ok ? 'LOCKED ' + Math.min(100, H.hold / 1.2 * 100).toFixed(0) + '%' : ''}`, 16, 26);
        if (H.hold >= 1.2) { endHack(true); return; }
      }
      if (left <= 0) { endHack(false); return; }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };
  function hackKey(code) { if (code === 'Escape') endHack(false); }
  function endHack(ok) {
    const H = S.hack; if (!H) return;
    S.hack = null; state.modal--; $('hack').hidden = true;
    toast(ok ? 'Hack successful' : 'Hack failed', ok ? 'gold' : 'warn'); sfx(ok ? 'pick' : 'thud');
    if (H.cb) H.cb(ok);
  }
  /** A hackable object in the world (camera, door, radio). E starts the minigame. */
  A.addHackable = (x, y, mode, label, onDone, opts) => {
    const h = { x, y, r: 36 * SCALE.reach + 4, label, hackMode: mode, fn() { A.hack(mode, ok => { if (ok) { h.done = true; S.interact = S.interact.filter(i => i !== h); onDone && onDone(); } }, opts); } };
    S.interact.push(h); return h;
  };

  // =====================================================================
  // A10. QUICK-TIME EVENTS
  // seq: [{ key: 'KeyE', label: 'E', t: 1.2 }, { mash: 'KeyF', label: 'F', count: 8, t: 2.5 }]
  // The world runs in slow motion while a QTE prompt is up.
  // =====================================================================
  A.qte = (seq, cb, opts = {}) => {
    seq = seq.map(st => Object.assign({}, st, { t: st.t * DIFF.qte }, st.mash ? { count: Math.max(2, Math.round(st.count * DIFF.mash)) } : {}));   // difficulty
    S.qte = { seq, i: 0, cb, t0: performance.now(), n: 0, text: opts.text || '' };
    state.timeScale = 0.2;
    $('qte').hidden = false; showQte();
    const tick = () => {
      const Q = S.qte; if (!Q) return;
      const step = Q.seq[Q.i], el = (performance.now() - Q.t0) / 1000;
      const ring = $('qte-ring'); ring.style.strokeDashoffset = String(283 * clamp(el / step.t, 0, 1));
      if (el > step.t) { endQte(false); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  function showQte() {
    const Q = S.qte, s = Q.seq[Q.i];
    $('qte-key').textContent = s.label || s.key.replace('Key', '');
    $('qte-text').textContent = s.mash ? `MASH ${s.label}  ${Q.n}/${s.count}` : (s.text || Q.text || 'PRESS');
  }
  function qteKey(code) {
    const Q = S.qte, s = Q.seq[Q.i];
    if (s.mash) {
      if (code !== s.mash) return;
      Q.n++; sfx('pick'); showQte();
      if (Q.n < s.count) return;
    } else if (code !== s.key) { if (/^Key|Space|Digit/.test(code)) endQte(false); return; }
    sfx('pick');
    Q.i++; Q.n = 0; Q.t0 = performance.now();
    if (Q.i >= Q.seq.length) endQte(true); else showQte();
  }
  function endQte(ok) {
    const Q = S.qte; if (!Q) return;
    S.qte = null; state.timeScale = 1; $('qte').hidden = true;
    if (!ok) toast('Too slow!', 'warn');
    if (Q.cb) Q.cb(ok);
  }

  // =====================================================================
  // A11. TIMED OBJECTIVES
  // =====================================================================
  A.startTimer = (secs, label, onExpire) => { secs *= DIFF.timers; S.timer = { left: secs, label, onExpire }; $('act-timer').hidden = false; };
  A.stopTimer = () => { S.timer = null; $('act-timer').hidden = true; };
  function timerTick(dt) {
    const T = S.timer; T.left -= dt;
    $('act-timer').querySelector('b').textContent = `${Math.floor(Math.max(0, T.left) / 60)}:${String(Math.ceil(Math.max(0, T.left)) % 60).padStart(2, '0')}`;
    $('act-timer').querySelector('span').textContent = T.label;
    $('act-timer').classList.toggle('warn', T.left < 15);
    if (T.left <= 0) { const f = T.onExpire; A.stopTimer(); if (f) f(); }
  }

  // =====================================================================
  // A12. BOSS FIGHTS
  // spec = { name, hp, x, y, cfg, base, phases: [{ at: 1, patterns: [...],
  //          armor, backOnly, speed, onEnter }], finisher: [qte seq], onDefeat }
  // A phase starts when HP falls below phase.at x maxHp. Attack patterns:
  //   charge | spray | slam | missiles | summon | flame
  // =====================================================================
  A.boss = spec => {
    const e = spawnEnemy(spec.base || 'trooper', spec.x, spec.y, { boss: spec, hp: spec.hp, r: spec.r || 16, cfg: spec.cfg, mission: true, aggro: true, dmg: spec.dmg || 10, speed: 110 });
    e.weaponName = spec.weapon || 'rifle';
    e.phaseI = 0; e.patT = 2; e.atk = null; e.invT = 0;
    $('boss-bar').hidden = false; $('boss-name').textContent = spec.name;
    $('boss-pips').innerHTML = spec.phases.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('');
    S.boss = e; return e;
  };
  function bossThink(e, dt) {
    const spec = e.boss, ph = spec.phases[e.phaseI];
    e.invT -= dt; e.stunB = (e.stunB || 0) - dt;
    // phase change
    const next = spec.phases[e.phaseI + 1];
    if (next && e.hp <= next.at * e.maxHp) {
      e.phaseI++; e.atk = null; e.invT = 1.5; e.patT = 1.6;
      setBanner(`${spec.name} · PHASE ${e.phaseI + 1}`, 'warn', 2.4); shake(8); sfx('boom');
      [...$('boss-pips').children].forEach((p, i) => p.classList.toggle('on', i <= e.phaseI));
      if (next.onEnter) next.onEnter(e);
    }
    // finisher QTE when the final phase is almost over
    if (spec.finisher && e.phaseI === spec.phases.length - 1 && e.hp <= e.maxHp * 0.08 && !e.finishing) {
      e.finishing = true; e.invT = 99;
      A.qte(spec.finisher, ok => { e.invT = 0; if (ok) { e.finished = true; hitEnemy(e, 9999); } else { e.hp = e.maxHp * 0.2; e.finishing = false; toast(`${spec.name} breaks free!`, 'warn'); } }, { text: 'FINISH HIM' });
      return;
    }
    if (e.stunB > 0) { e.aiming = false; return; }
    const t = A.pickTarget(e, player.car || player);
    const d = dist(e, t);
    if (!e.atk) {
      e.a = Math.atan2(t.y - e.y, t.x - e.x);
      const want = 210, dir = d > want ? 1 : d < want * 0.6 ? -0.8 : 0, strafe = Math.sin(tNow * 0.9) * 0.7;
      const sp = (ph.speed || 1) * e.speed;
      e.x += (Math.cos(e.a) * dir - Math.sin(e.a) * strafe) * sp * dt; e.y += (Math.sin(e.a) * dir + Math.cos(e.a) * strafe) * sp * dt;
      collide(e, e.r);
      e.aiming = true; e.cd -= dt;
      if (e.cd <= 0 && lineOfSight(e, t) && !ph.noGun) { e.cd = 0.9; fireAt(e, e.a, 560, e.dmg * 0.8); }
      e.patT -= dt;
      if (e.patT <= 0) { e.patI = ((e.patI ?? -1) + 1) % ph.patterns.length; startPattern(e, ph.patterns[e.patI], t); }
      return;
    }
    runPattern(e, dt, t);
  }
  function fireAt(e, a, speed, dmg, extra) { bullets.push(Object.assign({ x: e.x + Math.cos(a) * 18, y: e.y + Math.sin(a) * 18, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: 1.4, dmg, own: 'e' }, extra)); }
  function startPattern(e, kind, t) {
    const a = Math.atan2(t.y - e.y, t.x - e.x);
    e.atk = { kind, t: 0, a, tx: t.x, ty: t.y, n: 0 };
    if (kind === 'summon') { for (let i = 0; i < 2; i++) spawnEnemy('drone', e.x + rnd(-120, 120), e.y + rnd(-120, 120), { mission: true, aggro: true }); toast(`${e.boss.name} calls in drones!`, 'warn'); }
  }
  function runPattern(e, dt, t) {
    const k = e.atk; k.t += dt;
    const done = (cool = 2.2) => { e.atk = null; e.patT = cool; };
    switch (k.kind) {
      case 'charge':                                    // telegraph 0.7 s, then dash; hitting a wall stuns the boss
        if (k.t < 0.7) { k.a = Math.atan2(t.y - e.y, t.x - e.x); e.a = k.a; break; }
        if (k.t < 1.6) {
          const ox = e.x, oy = e.y, cs = 560 * SCALE.walk; e.x += Math.cos(k.a) * cs * dt; e.y += Math.sin(k.a) * cs * dt;
          if (collide(e, e.r) && Math.hypot(e.x - ox, e.y - oy) < cs * dt * 0.5) { e.stunB = 1.8; toast(`${e.boss.name} crashed into the wall. Hit him now!`, 'gold'); shake(8); done(2.4); break; }
          if (!k.hit && dist(e, player) < e.r + player.r + 6 && !player.car) { k.hit = true; damagePlayer(24); shake(8); }
          break;
        }
        done(); break;
      case 'spray':                                     // sweeping fan of bullets
        if (k.t > k.n * 0.07 && k.n < 12) { fireAt(e, k.a - 0.6 + k.n * 0.1, 500, e.dmg * 0.8); k.n++; sfx('eshot'); }
        if (k.t > 1.1) done(1.8);
        break;
      case 'slam':                                      // telegraphed area attack at the player's position
        if (k.t < 1.0) break;
        if (!k.n) { k.n = 1; e.x = k.tx; e.y = k.ty; collide(e, e.r); explode(k.tx, k.ty); const R = 95 * SCALE.reach; if (dist(player, k) < R && !A.invulnerable()) damagePlayer(30); for (const a of S.allies) if (dist(a, k) < R) hurtAlly(a, 30); }
        if (k.t > 1.5) done(2.2);
        break;
      case 'missiles':                                  // three slow homing missiles: dodge-roll or break line of sight
        if (k.t > k.n * 0.35 && k.n < 3) { fireAt(e, k.a + (k.n - 1) * 0.6, 240, 22, { home: true, life: 4, missile: true }); k.n++; sfx('zap'); }
        if (k.t > 1.4) done(2.4);
        break;
      case 'summon': if (k.t > 0.8) done(3); break;
      case 'flame': {                                   // flamethrower cone that tracks slowly
        const want = Math.atan2(t.y - e.y, t.x - e.x); k.a += clamp(angDiff(want, k.a), -0.9 * dt, 0.9 * dt); e.a = k.a;
        for (let i = 0; i < 3; i++) { const aa = k.a + rnd(-0.35, 0.35), sp = rnd(180, 300); parts.push({ x: e.x + Math.cos(aa) * 16, y: e.y + Math.sin(aa) * 16, vx: Math.cos(aa) * sp, vy: Math.sin(aa) * sp, life: 0.5, max: 0.5, color: pick(['#ffb040', '#ff6a2a', '#ffd27a']), size: 6 }); }
        const inCone = o => dist(o, e) < 150 * SCALE.reach && Math.abs(angDiff(Math.atan2(o.y - e.y, o.x - e.x), k.a)) < 0.4 && lineOfSight(e, o);
        if (inCone(player) && !A.invulnerable()) damagePlayer(32 * dt);
        for (const a of S.allies) if (inCone(a)) hurtAlly(a, 32 * dt);
        if (k.t > 2.4) done(1.8);
        break;
      }
      default: done();
    }
  }

  // =====================================================================
  // A13. ALLY AI
  // Allies follow the player, take cover when enemies are near, shoot, and
  // can be downed. Hold E next to a downed ally for 2 s to revive them.
  // =====================================================================
  A.addAlly = o => {
    const a = Object.assign({ x: player.x - 40, y: player.y + 20, a: 0, hp: 100, maxHp: 100, r: 11, cd: 0.5, dmg: 11, weaponName: 'pistol', name: 'Ally' }, o);
    a.cfg = a.cfg || CR.CAST[a.id] || CR.randomSurvivor();
    S.allies.push(a); return a;
  };
  function hurtAlly(a, n) {
    if (a.down || a.dead) return;
    a.hp -= n; a.hitT = 0.18;
    if (a.hp <= 0) { a.hp = 0; a.down = true; a.bleed = 30; toast(`${a.name} is down! Hold E next to them to revive.`, 'warn'); }
  }
  A.hurtAlly = hurtAlly;
  function allyTick(a, dt) {
    if (a.dead) return;
    if (a.down) { a.bleed -= dt; if (a.bleed <= 0) { a.dead = true; a.down = false; toast(`${a.name} didn't make it.`, 'warn'); if (S.onAllyDead) S.onAllyDead(a); } animTick(a, dt); return; }
    a.cd -= dt;
    // G-command: sneak behind a marked guard and take him down
    if (a.task && a.task.kind === 'takedown') {
      const e = a.task.e;
      if (e.dead || e.state === 'alert') a.task = null;
      else {
        const bx = e.x - Math.cos(e.a) * 18 * SCALE.reach, by = e.y - Math.sin(e.a) * 18 * SCALE.reach;
        const d = Math.hypot(bx - a.x, by - a.y);
        a.a = Math.atan2(by - a.y, bx - a.x);
        if (d > 8 * SCALE.reach) { a.x += Math.cos(a.a) * 95 * SCALE.walk * dt; a.y += Math.sin(a.a) * 95 * SCALE.walk * dt; collide(a, a.r); }
        else { hitEnemy(e, 9999); a.swingT = 0.25; S.stats.takedowns++; a.task = null; if (tNow - (S.lastTakedownT || -9) < 1.6) toast('Coordinated takedown!', 'gold'); else S.pendingSync = tNow; }
        animTick(a, dt); return;
      }
    }
    // pick the nearest visible enemy
    let foe = null, fd = 460;
    for (const e of enemies) if (!e.dead && !(e.stealth && e.state !== 'alert') && dist(e, a) < fd && (e.fly || e.roof || lineOfSight(a, e))) { fd = dist(e, a); foe = e; }
    if (a.focus && !a.focus.dead) foe = a.focus;
    const me = player.car || player;
    if (foe) {
      // find cover: a point next to a wall that blocks the enemy's line of fire
      a.coverT = (a.coverT || 0) - dt;
      if (!a.coverPt || a.coverT <= 0) {
        a.coverT = 2.5; a.coverPt = null; let best = 1e9;
        for (const c of nearColliders(a.x, a.y)) {
          if (c.water || c.rail || c.w > 400) continue;
          const o = a.r + 3; for (const [cx, cy] of [[c.x - o, c.y + c.h / 2], [c.x + c.w + o, c.y + c.h / 2], [c.x + c.w / 2, c.y - o], [c.x + c.w / 2, c.y + c.h + o]]) {
            const pt = { x: cx, y: cy };
            if (solidAt(cx, cy) || lineOfSight(foe, pt) || dist(pt, me) > 280) continue;
            const d = dist(pt, a); if (d < best) { best = d; a.coverPt = pt; }
          }
        }
      }
      const goal = a.coverPt || { x: a.x + Math.cos(tNow + a.x) * 20, y: a.y + Math.sin(tNow + a.y) * 20 };
      const d = dist(a, goal);
      if (d > 6 * SCALE.reach) { const an = Math.atan2(goal.y - a.y, goal.x - a.x); a.x += Math.cos(an) * 150 * SCALE.walk * dt; a.y += Math.sin(an) * 150 * SCALE.walk * dt; }
      a.a = Math.atan2(foe.y - a.y, foe.x - a.x); a.aiming = true;
      // shoot from cover (peeking around the corner)
      if (a.cd <= 0 && (foe.fly || foe.roof || lineOfSight(a, foe) || Math.random() < 0.3)) {
        a.cd = rnd(0.45, 0.8); const an = a.a + rnd(-0.08, 0.08);
        bullets.push({ x: a.x + Math.cos(an) * 14, y: a.y + Math.sin(an) * 14, vx: Math.cos(an) * 800, vy: Math.sin(an) * 800, life: 0.9, dmg: a.dmg, own: 'p', ally: true });
        sfx('eshot');
      }
    } else {
      a.aiming = false; a.coverPt = null;
      if (dist(a, me) > 600) { a.x = me.x - 40; a.y = me.y + 30; collide(a, a.r); }            // catch up when left far behind
      const gx = me.x - Math.cos(player.a) * 45 * SCALE.reach + 20 * SCALE.reach, gy = me.y - Math.sin(player.a) * 45 * SCALE.reach;
      const d = Math.hypot(gx - a.x, gy - a.y);
      if (d > 30 * SCALE.reach) { a.a = Math.atan2(gy - a.y, gx - a.x); const sp = (d > 200 ? 240 : 150) * SCALE.walk; a.x += Math.cos(a.a) * sp * dt; a.y += Math.sin(a.a) * sp * dt; }
    }
    collide(a, a.r);
    animTick(a, dt);
  }
  function allyCommand() {
    const a = S.allies.find(x => !x.down && !x.dead);
    if (!a) { toast('No ally with you.'); return; }
    const unaware = enemies.filter(e => !e.dead && e.stealth && e.state !== 'alert' && dist(e, a) < 260).sort((p, q) => dist(p, a) - dist(q, a));
    if (unaware.length) {
      const mine = takedownTarget();
      a.task = { kind: 'takedown', e: unaware.find(e => e !== mine) || unaware[0] };
      toast(`${a.name}: "On it. Go when I go."`); return;
    }
    const wm = worldMouse();
    const foe = enemies.filter(e => !e.dead).sort((p, q) => dist(p, wm) - dist(q, wm))[0];
    if (foe) { a.focus = foe; toast(`${a.name}: "Targeting that one!"`); }
  }

  // =====================================================================
  // A14. DEFENSE MODE
  // =====================================================================
  A.defend = o => {
    const t = Object.assign({ hgt: 18, roof: '#35434a', defTarget: true, mission: true }, o.target);
    buildings.push(t); rebuildColliders();
    const defHp = (o.hp || 400) * DIFF.objectiveHp;
    S.def = { target: t, hp: defHp, maxHp: defHp, waves: o.waves, wave: -1, gap: 3, onWin: o.onWin, onLose: o.onLose, done: false, ratio: o.attackRatio ?? 0.5 };
    S.stock = o.barricades ?? 3;
    for (const [x, y] of o.turrets || []) S.turrets.push({ x, y, heat: 0 });
    $('def-bar').hidden = false; $('def-name').textContent = t.name || 'Objective';
    toast(`Defend ${t.name || 'the objective'}. T places a barricade (${S.stock} left). E mans a turret.`);
  };
  function defTick(dt) {
    const D = S.def; if (D.done) return;
    $('def-bar').querySelector('i').style.width = clamp(D.hp / D.maxHp * 100, 0, 100) + '%';
    $('def-wave').textContent = D.wave >= 0 ? `Wave ${D.wave + 1} / ${D.waves.length}` : 'Get ready';
    if (D.hp <= 0) { D.done = true; $('def-bar').hidden = true; if (D.onLose) D.onLose(); return; }
    const alive = enemies.filter(e => e.defWave === D.wave && !e.dead).length;
    if (D.wave < 0 || alive === 0) {
      D.gap -= dt;
      if (D.gap <= 0) {
        D.wave++;
        if (D.wave >= D.waves.length) { D.done = true; $('def-bar').hidden = true; if (D.onWin) D.onWin(); return; }
        setBanner(`WAVE ${D.wave + 1}`, 'warn');
        for (const [type, x, y, extra] of D.waves[D.wave]) {
          const e = spawnEnemy(type, x, y, Object.assign({ mission: true, aggro: true, defWave: D.wave, attackTarget: Math.random() < D.ratio }, extra));
          e.home = { x: D.target.x + D.target.w / 2, y: D.target.y + D.target.h / 2 };
        }
        D.gap = 4;
      }
    }
  }
  function placeBarricade() {
    if (!S.def && !S.stock) return;
    if (S.stock <= 0) { toast('No barricades left.', 'warn'); return; }
    if (player.car || player.gunner || player.roof) return;
    const horiz = Math.abs(Math.sin(player.a)) > 0.7;          // facing up/down -> barricade lies left-right
    const L = 60 * SCALE.vdim, T = 16 * SCALE.vdim, w = horiz ? L : T, h = horiz ? T : L;
    const cx = player.x + Math.cos(player.a) * 34 * SCALE.reach, cy = player.y + Math.sin(player.a) * 34 * SCALE.reach;
    const b = { x: cx - w / 2, y: cy - h / 2, w, h, hgt: 10, roof: '#6b5b45', barricade: true, hp: 160, mission: true };
    if (overlap(b, { x: player.x - player.r, y: player.y - player.r, w: player.r * 2, h: player.r * 2 })) { toast('Step back a little.', 'warn'); return; }
    buildings.push(b); S.barricades.push(b); rebuildColliders(); S.stock--; sfx('thud');
    toast(`Barricade placed (${S.stock} left).`);
  }

  // ---- Security cameras: fixed, sweeping vision cones. They never shoot; if one spots you the alarm starts.
  //      Hack them (E) to switch them off. Spawned as stealth "enemies" with { camera: true }.
  A.spawnCamera = (x, y, a, sweep = 0.9, vision = 230) => spawnEnemy('trooper', x, y, { mission: true, stealth: true, camera: true, hp: 9999, speed: 0, a, baseA: a, sweep, vision, aggro: false });
  function cameraThink(e, dt) {
    if (e.off) { e.a = e.baseA + 0.6; return; }
    e.a = e.baseA + Math.sin(tNow * 0.7 + e.x) * e.sweep;
    if (canSee(e, player) && !player.car) { e.det = Math.min(1, (e.det || 0) + dt * (player.crouch ? 0.9 : 1.6)); if (e.det >= 1 && e.state !== 'alert') { e.state = 'alert'; toast('A camera spotted you!', 'warn'); if (S.alarm && !S.alarm.fired && S.alarmT <= 0) { S.alarmT = 3; S.alarmBy = null; setBanner('CAMERA ALARM IN 3 s', 'warn', 1.5); } } }
    else e.det = Math.max(0, (e.det || 0) - dt * 0.25);
  }
  /** Searchlight: a bright spot sweeping the ground on a circle. Standing in it fills a detection meter. */
  A.addSearchlight = (cx, cy, rad, speed = 0.5, r = 34) => { const s = { cx, cy, rad, speed, r, t: Math.random() * 6, x: cx, y: cy, det: 0 }; S.searchlights.push(s); return s; };
  function searchlightTick(dt) {
    for (const s of S.searchlights) {
      if (s.off) continue;
      s.t += dt * s.speed; s.x = s.cx + Math.cos(s.t) * s.rad; s.y = s.cy + Math.sin(s.t * 1.3) * s.rad * 0.6;
      if (dist(player, s) < s.r && !player.car) {
        s.det = Math.min(1, s.det + dt * 1.4);
        if (s.det >= 1 && !s.tripped) { s.tripped = true; toast('Caught in the searchlight!', 'warn'); if (S.alarm && !S.alarm.fired && S.alarmT <= 0) { S.alarmT = 2; S.alarmBy = null; setBanner('SEARCHLIGHT ALARM', 'warn', 1.5); } }
      } else { s.det = Math.max(0, s.det - dt * 0.5); if (s.det === 0) s.tripped = false; }
    }
  }
  /** Floating debris on the river: drifts downstream; hitting it damages and slows a boat. */
  A.addDebris = (x, y, r = 12) => { const d = { x, y, r, vy: rnd(8, 18) * SCALE.veh * 2, spin: rnd(0, 6) }; S.debris.push(d); return d; };
  function debrisTick(dt) {
    for (const d of S.debris) {
      d.y += d.vy * dt; d.spin += dt * 0.4;
      for (const c of cars) if (c.type === 'boat' && c.hp > 0 && dist(c, d) < c.r + d.r * SCALE.vdim) {
        c.hp -= 30; c.v *= 0.3; d.hit = true; sfx('thud'); shake(5);
        particle(d.x, d.y, 10, '#6a5a44', 120, 0.5, 4);
        if (c === player.car) toast('Debris! Steer around it.', 'warn');
      }
    }
    S.debris = S.debris.filter(d => !d.hit && d.y < 2450);
  }

  // ---- Bursting pipes: glow red for `warn` seconds, then explode, every `period` seconds ----
  A.addHazard = (x, y, o = {}) => { const h = Object.assign({ x, y, r: 45, period: 7, warn: 1.6, t: Math.random() * 7, dmg: 28, last: 0 }, o); S.hazards.push(h); return h; };
  /** Smoke: breathable only when crouched (C). Standing inside hurts. */
  A.addSmoke = (x, y, r) => { const s = { x, y, r }; S.smoke.push(s); return s; };
  function hazardTick(dt) {
    for (const h of S.hazards) {
      if (h.off) { h.warning = false; continue; }
      h.t += dt; const ph = h.t % h.period;
      h.warning = ph > h.period - h.warn;
      if (ph < h.last) {                                               // wrapped around: BURST
        explode(h.x, h.y); shake(6);
        const R = h.r * SCALE.reach + 8;
        if (dist(player, h) < R && !A.invulnerable()) damagePlayer(h.dmg);
        for (const a of S.allies) if (dist(a, h) < R) hurtAlly(a, h.dmg);
        for (const a of S.actors) if (a.trapped && dist(a, h) < R) a.hurt = (a.hurt || 0) + 1;
      }
      h.last = ph;
    }
    for (const s of S.smoke) {
      if (Math.random() < 0.6) parts.push({ x: s.x + rnd(-s.r, s.r) * 0.8, y: s.y + rnd(-s.r, s.r) * 0.8, vx: rnd(-6, 6), vy: rnd(-6, 6), life: 1.6, max: 1.6, color: 'rgba(60,58,55,.6)', size: 9 });
      if (dist(player, s) < s.r && !player.crouch && !player.car) {
        damagePlayer(9 * dt);
        if (!S.smokeTipT || tNow - S.smokeTipT > 5) { S.smokeTipT = tNow; toast('Thick smoke! Crouch (C) to stay under it.', 'warn'); }
      }
    }
  }
  /** Player bullets vs hostile vehicles: front = engine (x1.5), sides = tyres (x1), rear = armour (x0.25). */
  function hostileVehicleHits() {
    for (const b of bullets) {
      if (b.own !== 'p' || b.life <= 0) continue;
      for (const c of cars) {
        if (!c.hostile || c.hp <= 0 || dist(b, c) > c.r + 2) continue;
        const v = norm(b.vx, b.vy), f = { x: Math.cos(c.a), y: Math.sin(c.a) }, d = v.x * f.x + v.y * f.y;
        const mul = d < -0.5 ? 1.5 : d > 0.5 ? 0.25 : 1;
        c.hp -= b.dmg * mul; b.life = 0;
        particle(b.x, b.y, 3, mul > 1 ? '#ffb050' : '#cccccc', 90, 0.2, 2);
        if (!b.ally) S.stats.hits++;
        if (c.hp <= 0) toast(`${c.name || 'Vehicle'} destroyed!`, 'gold');
        break;
      }
    }
  }

  // =====================================================================
  // A15. FIRE HAZARDS & SABOTAGE
  // =====================================================================
  A.fire = (x, y, r = 30, o = {}) => {
    const f = Object.assign({ x, y, r, max: r * 1.8, grow: 2, spread: 0, spreadT: 6 }, o);
    S.fires.push(f);
    const l = { x, y, r: 150, fire: true, mission: true }; lights.push(l); f.light = l;
    return f;
  };
  function fireTick(dt) {
    for (const f of S.fires) {
      f.r = Math.min(f.max, f.r + f.grow * dt);
      if (f.spread && S.fires.length < (S.fireCap || 24)) {
        f.spreadT -= dt;
        if (f.spreadT <= 0) { f.spreadT = rnd(5, 9); const a = f.spreadDir ?? rnd(0, 6.28); const nx = f.x + Math.cos(a + rnd(-0.6, 0.6)) * f.r * 1.4, ny = f.y + Math.sin(a + rnd(-0.6, 0.6)) * f.r * 1.4; if (!solidAt(nx, ny)) A.fire(nx, ny, 16, { max: f.max, grow: f.grow, spread: f.spread * 0.8, spreadDir: f.spreadDir }); }
      }
      if (dist(player, f) < f.r && !player.roof && !player.car) damagePlayer(20 * dt);
      for (const c of cars) if (c.hp > 0 && dist(c, f) < f.r + c.r * 0.5) { c.hp -= 22 * dt; if (c === player.car && Math.random() < 0.02) toast('Your boat is burning! Get out of the oil.', 'warn'); }
      for (const e of enemies) if (!e.dead && !e.fly && dist(e, f) < f.r) { e.hp -= 14 * dt; if (e.hp <= 0) hitEnemy(e, 1); }
      for (const a of S.allies) if (dist(a, f) < f.r) hurtAlly(a, 14 * dt);
      if (Math.random() < 0.5) parts.push({ x: f.x + rnd(-f.r, f.r) * 0.7, y: f.y + rnd(-f.r, f.r) * 0.7, vx: rnd(-8, 8), vy: rnd(-45, -20), life: 0.9, max: 0.9, color: 'rgba(80,80,80,.45)', size: 6 });
    }
  }
  /** Stop scavengers planting bombs on targets for `duration` seconds. */
  A.sabotage = o => {
    const targets = o.targets.map(t => Object.assign({ destroyed: false, bomb: 0, defuse: 0 }, t));
    S.sab = { targets, t: 0, duration: o.duration, waves: o.waves.map(w => Object.assign({ done: false }, w)), onEnd: o.onEnd, rr: 0 };
    A.startTimer(o.duration, o.label || 'Protect the tanks', () => endSab());
    return S.sab;
  };
  function sabTick(dt) {
    const B = S.sab; B.t += dt;
    for (const w of B.waves) if (!w.done && B.t >= w.at) {
      w.done = true;
      for (const [x, y] of w.spawns) {
        const alive = B.targets.filter(t => !t.destroyed);
        if (!alive.length) break;
        const tg = alive[B.rr++ % alive.length];
        spawnEnemy('scav', x, y, { mission: true, planter: tg, speed: 95 });
      }
      toast('More scavengers heading for the tanks!', 'warn');
    }
    for (const t of B.targets) if (t.bomb > 0 && !t.destroyed) {
      t.bomb -= dt;
      if (t.bomb <= 0) {
        t.destroyed = true; t.bomb = 0; explode(t.x, t.y); explode(t.x + 20, t.y - 10); shake(14);
        if (dist(player, t) < 90) damagePlayer(30);
        toast(`${t.name} destroyed!`, 'warn');
        const bld = buildings.find(b => b.tank && Math.abs(b.x + b.w / 2 - t.x) < 30 && Math.abs(b.y + b.h / 2 - t.y) < 30); if (bld) { bld.roof = '#1d1d1d'; bld.ruined = true; }
        A.fire(t.x, t.y + 10, 26, { grow: 0 });
      }
    }
    if (B.targets.every(t => t.destroyed)) { A.stopTimer(); endSab(); }
  }
  function endSab() {
    const B = S.sab; if (!B) return; S.sab = null;
    for (const e of enemies) if (e.planter) { e.dead = true; e.hidden = true; }                 // unplanted scavengers flee
    for (const t of B.targets) if (t.bomb > 0) { t.bomb = 0; }                                  // (timer ran out: survivors defuse)
    const lost = B.targets.filter(t => t.destroyed).length;
    if (B.onEnd) B.onEnd(lost, B.targets);
  }
  A.addHideSpot = (x, y) => S.hideSpots.push({ x, y, r: 26 * SCALE.reach + 4 });

  // ---- Actors: scripted characters for cutscenes (not enemies, not allies) ----
  A.actor = (id, o) => { A.removeActor(id); const a = Object.assign({ id, a: 0, r: 10, cfg: CR.CAST[o.cast] || o.cfg || CR.randomSurvivor() }, o); S.actors.push(a); return a; };
  A.getActor = id => S.actors.find(a => a.id === id);
  A.removeActor = id => { S.actors = S.actors.filter(a => a.id !== id); };
  A.setCam = c => { S.cam = c; };
  /** HOOK (camera): cutscenes can take the camera. */
  A.camTarget = () => S.cam;
  A.camZoom = () => S.cam && S.cam.zoom;

  // =====================================================================
  // A16. INTERACTION (E) & PROMPTS
  // =====================================================================
  function candidates() {
    const out = [];
    const layerOk = o => (o.roof || null) === (player.roof || null);
    for (const o of S.interact) if (layerOk(o)) out.push(o);   // (their r is scaled when created)
    const td = takedownTarget(); if (td) out.push({ x: td.x, y: td.y, r: 40 * SCALE.reach, label: 'Silent takedown', fn: () => takedown(td), prio: 3 });
    for (const a of S.allies) if (a.down && !player.roof) out.push({ x: a.x, y: a.y, r: 34 * SCALE.reach, hold: 2, label: `Revive ${a.name}`, fn: () => { a.down = false; a.hp = 50; toast(`${a.name} is back up.`, 'gold'); } });
    if (S.sab) for (const t of S.sab.targets) if (t.bomb > 0 && !t.destroyed) out.push({ x: (t.plant || t).x, y: (t.plant || t).y, r: 40 * SCALE.reach + 6, hold: 1.8, label: `Defuse the bomb on ${t.name}`, fn: () => { t.bomb = 0; toast('Bomb defused.', 'gold'); sfx('pick'); } });
    for (const z of S.zips) if (player.roof === z.b1) out.push({ x: z.p1.x, y: z.p1.y, r: 34 * SCALE.reach + 4, roof: z.b1, label: 'Zipline', fn: () => { player.zip = { z, t: 0, dur: Math.max(0.5, dist(z.p1, z.p2) / (420 * SCALE.walk * 1.5)) }; player.cover = null; sfx('swing'); } });
    for (const t of S.turrets) if (!player.roof) out.push({ x: t.x, y: t.y, r: 30 * SCALE.reach + 4, label: 'Man the turret', fn: () => mount(t) });
    return out;
  }
  function bestCandidate() {
    let best = null, bd = 1e9;
    for (const o of candidates()) { const d = dist(o, player); if (d < o.r && d - (o.prio || 0) * 10 < bd) { bd = d - (o.prio || 0) * 10; best = o; } }
    return best;
  }
  function interact() {
    if (player.gunner) { dismount(); return; }
    if (player.car) { if (!player.car.scripted) toggleCar(); return; }
    const b = bestCandidate();
    if (b) { if (!b.hold) b.fn(); return; }       // hold interactions progress in update()
    if (!player.roof) toggleCar();
  }
  function promptTick(dt) {
    const el = $('act-prompt');
    if (state.modal || player.car && !player.gunner) { el.hidden = true; S.holdProg = 0; return; }
    const b = player.gunner ? { label: 'Get off the gun', key: 'E' } : bestCandidate();
    let text = '';
    if (b) {
      if (b.hold) {
        if (keys.KeyE && S.holdKey === b.label) { S.holdProg += dt; if (S.holdProg >= b.hold) { S.holdProg = 0; b.fn(); } }
        else if (keys.KeyE) { S.holdKey = b.label; S.holdProg = 0; }
        else S.holdProg = 0;
        text = `<kbd>Hold E</kbd> ${b.label}${S.holdProg > 0 ? ` <span class="pbar"><i style="width:${S.holdProg / b.hold * 100}%"></i></span>` : ''}`;
      } else text = `<kbd>E</kbd> ${b.label}`;
    } else if (!player.cover && !player.roof && coverCandidate() && (enemies.some(e => !e.dead && dist(e, player) < 500))) text = '<kbd>Q</kbd> Take cover';
    else if (player.cover) text = `<kbd>Right mouse</kbd> ${mouseR.down ? 'Peeking' : 'Peek & aim'} · click to ${mouseR.down ? 'shoot' : 'blind fire'} · <kbd>Q</kbd> leave cover`;
    else if (!player.carry && enemies.some(e => e.dead && !e.fly && !e.hidden && dist(e, player) < 30 * SCALE.reach) && S.hideSpots.length) text = '<kbd>B</kbd> Pick up the body';
    else if (player.carry) text = `<kbd>B</kbd> Drop the body${S.hideSpots.some(h => dist(h, player) < h.r + 10) ? ' in the dumpster' : ''}`;
    el.hidden = !text; if (text && el.innerHTML !== text) el.innerHTML = text;
  }

  // =====================================================================
  // A17. DRAWING
  // =====================================================================
  /** HOOK: ground layer (under buildings): hazards, allies, actors, cones, telegraphs. */
  A.drawGround = L => {
    // dumpsters
    for (const h of S.hideSpots) { ctx.fillStyle = '#2d4a3a'; ctx.fillRect(h.x - 16, h.y - 10, 32, 20); ctx.fillStyle = '#1e3328'; ctx.fillRect(h.x - 16, h.y - 10, 32, 5); }
    // fire
    for (const f of S.fires) {
      const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
      g.addColorStop(0, 'rgba(255,190,90,.75)'); g.addColorStop(0.6, 'rgba(240,90,30,.45)'); g.addColorStop(1, 'rgba(120,30,10,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.28); ctx.fill();
      for (let i = 0; i < 4; i++) { ctx.fillStyle = pick(['#f2a93b', '#ff7a3a', '#ffd27a']); ctx.beginPath(); ctx.arc(f.x + rnd(-f.r, f.r) * 0.5, f.y + rnd(-f.r, f.r) * 0.5, rnd(3, 8), 0, 6.28); ctx.fill(); }
    }
    for (const d of S.debris) { ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(d.spin); ctx.fillStyle = '#5a4a36'; ctx.fillRect(-d.r, -d.r * 0.4, d.r * 2, d.r * 0.8); ctx.restore(); }
    for (const s of S.searchlights) if (!s.off) { const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r); g.addColorStop(0, `rgba(255,250,220,${0.45 + s.det * 0.3})`); g.addColorStop(1, 'rgba(255,250,220,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.28); ctx.fill(); }
    for (const e of enemies) if (e.camera && !e.hidden) { ctx.fillStyle = e.off ? '#444' : '#a898ff'; ctx.fillRect(e.x - 6, e.y - 4, 12, 8); ctx.fillStyle = e.off ? '#222' : (tNow * 2 | 0) % 2 ? '#ff3b2a' : '#551510'; ctx.beginPath(); ctx.arc(e.x, e.y, 2.5, 0, 6.28); ctx.fill(); }
    // bursting pipes (red pulse while about to burst) and smoke
    for (const h of S.hazards) { ctx.fillStyle = '#5a5048'; ctx.fillRect(h.x - 10, h.y - 4, 20, 8); if (h.warning) { ctx.strokeStyle = `rgba(255,60,40,${0.5 + Math.sin(tNow * 20) * 0.4})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(h.x, h.y, h.r * SCALE.reach + 8, 0, 6.28); ctx.stroke(); } }
    for (const s of S.smoke) { ctx.fillStyle = 'rgba(40,38,36,.35)'; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.28); ctx.fill(); }
    // sabotage targets
    if (S.sab) for (const t of S.sab.targets) {
      if (t.bomb > 0) {
        const blink = (tNow * (t.bomb < 3 ? 8 : 3) | 0) % 2;
        const bp = t.plant || t; ctx.fillStyle = blink ? '#ff3b2a' : '#551510'; ctx.beginPath(); ctx.arc(bp.x, bp.y + 8, 7, 0, 6.28); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = '600 12px IBM Plex Mono, monospace'; ctx.textAlign = 'center'; ctx.fillText(t.bomb.toFixed(1) + 's', bp.x, bp.y - 6); ctx.textAlign = 'left';
      }
    }
    for (const e of enemies) if (e.planter && e.plantT > 0) { ctx.fillStyle = '#000a'; ctx.fillRect(e.x - 14, e.y + 14, 28, 4); ctx.fillStyle = '#ff9a3a'; ctx.fillRect(e.x - 14, e.y + 14, 28 * Math.min(1, e.plantT / 4), 4); }
    // vision cones of stealth guards
    for (const e of enemies) if (!e.dead && e.stealth && !e.roof) {
      const R = visionRange(e), col = e.det >= 0.45 ? '255,200,60' : '255,255,255';
      ctx.fillStyle = `rgba(${col},${0.05 + (e.det || 0) * 0.08})`;
      ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.arc(e.x, e.y, R, e.a - CONE, e.a + CONE); ctx.closePath(); ctx.fill();
    }
    // boss telegraphs
    for (const e of enemies) if (e.boss && e.atk) {
      const k = e.atk;
      if (k.kind === 'charge' && k.t < 0.7) { ctx.strokeStyle = `rgba(255,60,40,${0.3 + k.t})`; ctx.lineWidth = e.r * 2; ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + Math.cos(k.a) * 500, e.y + Math.sin(k.a) * 500); ctx.stroke(); }
      if (k.kind === 'slam' && k.t < 1) { ctx.strokeStyle = '#ff3b2a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(k.tx, k.ty, 95, 0, 6.28); ctx.stroke(); ctx.fillStyle = `rgba(255,60,40,${k.t * 0.35})`; ctx.beginPath(); ctx.arc(k.tx, k.ty, 95 * k.t, 0, 6.28); ctx.fill(); }
      if (k.kind === 'flame') { ctx.fillStyle = 'rgba(255,120,40,.12)'; ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.arc(e.x, e.y, 150, k.a - 0.4, k.a + 0.4); ctx.closePath(); ctx.fill(); }
    }
    for (const e of enemies) if (e.melee && e.windup > 0) { ctx.strokeStyle = 'rgba(255,60,40,.8)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(e.x, e.y, 30, e.a - 1, e.a + 1); ctx.stroke(); }
    // turrets
    for (const t of S.turrets) { ctx.fillStyle = '#2a2d2f'; ctx.fillRect(t.x - 14, t.y - 14, 28, 28); ctx.strokeStyle = '#6a6e70'; ctx.lineWidth = 5; const a = player.gunner === t ? player.a : -Math.PI / 2; ctx.beginPath(); ctx.moveTo(t.x, t.y); ctx.lineTo(t.x + Math.cos(a) * 26, t.y + Math.sin(a) * 26); ctx.stroke(); }
    // ladders
    for (const l of S.ladders || []) { ctx.strokeStyle = '#b9a27a'; ctx.lineWidth = 2; for (let i = -8; i <= 8; i += 4) { ctx.beginPath(); ctx.moveTo(l.x - 6, l.y + i); ctx.lineTo(l.x + 6, l.y + i); ctx.stroke(); } }
    // allies & actors
    for (const a of S.allies) if (!a.dead) {
      drawChar(Object.assign({}, a, { dead: a.down ? 1.5 : false, deadT: 1.5, maxHp: 0 }), L);
      ctx.fillStyle = '#4fb3a9'; ctx.font = '600 11px IBM Plex Mono, monospace'; ctx.textAlign = 'center'; ctx.fillText(a.down ? `${a.name} ▼ ${Math.ceil(a.bleed)}s` : a.name, a.x, a.y - 22); ctx.textAlign = 'left';
      if (!a.down && a.hp < a.maxHp) { ctx.fillStyle = '#000a'; ctx.fillRect(a.x - 12, a.y - 18, 24, 3); ctx.fillStyle = '#4fb3a9'; ctx.fillRect(a.x - 12, a.y - 18, 24 * a.hp / a.maxHp, 3); }
    }
    for (const a of S.actors) {
      if (a.bike) { drawCar(Object.assign({ type: 'bike', x: a.x, y: a.y, a: a.a, hp: 1, color: a.bikeColor || '#9a9a9a' })); }
      else drawChar(a, L);
      if (a.label) { ctx.fillStyle = a.labelColor || '#dde0d7'; ctx.font = '600 11px IBM Plex Mono, monospace'; ctx.textAlign = 'center'; ctx.fillText(a.label, a.x, a.y - 22); ctx.textAlign = 'left'; }
    }
    // cover indicator
    if (player.cover && !player.car) { const n = player.cover.n; ctx.strokeStyle = mouseR.down ? '#f2a93b' : '#4fb3a9'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(player.x - n.x * 13 - n.y * 12, player.y - n.y * 13 + n.x * 12); ctx.lineTo(player.x - n.x * 13 + n.y * 12, player.y - n.y * 13 - n.x * 12); ctx.stroke(); }
    if (player.crouch && !player.car) { ctx.strokeStyle = 'rgba(79,179,169,.5)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(player.x, player.y, 16, 0, 6.28); ctx.stroke(); }
    if (player.dodgeT > 0) { ctx.fillStyle = 'rgba(242,169,59,.25)'; ctx.beginPath(); ctx.arc(player.x - player.dodge.x * 14, player.y - player.dodge.y * 14, 10, 0, 6.28); ctx.fill(); }
    if (player.gunner && player.gunner.car) { const c = player.gunner.car; ctx.strokeStyle = '#33373a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + Math.cos(player.a) * 30, c.y + Math.sin(player.a) * 30); ctx.stroke(); }
  };
  /** HOOK: above buildings: roof entities, ziplines, snipers' lasers, detection meters. */
  A.drawAbove = L => {
    for (const z of S.zips) {
      const o1 = roofOff(z.b1), o2 = roofOff(z.b2);
      ctx.strokeStyle = '#c9c2b0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(z.p1.x + o1.x, z.p1.y + o1.y); ctx.lineTo(z.p2.x + o2.x, z.p2.y + o2.y); ctx.stroke();
      ctx.fillStyle = '#f2a93b'; ctx.beginPath(); ctx.arc(z.p1.x + o1.x, z.p1.y + o1.y, 4, 0, 6.28); ctx.fill();
    }
    for (const e of enemies) if (e.roof && !e.dead) drawChar(Object.assign({}, e, A.hitPos(e)), L);
    for (const e of enemies) if (e.roof && e.dead) drawChar(Object.assign({}, e, A.hitPos(e)), L);
    for (const e of enemies) if (e.sniper && !e.dead && e.aimT > 0) {
      const p = A.hitPos(e); ctx.strokeStyle = `rgba(255,40,30,${0.25 + e.aimT / 1.4 * 0.6})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(player.x, player.y); ctx.stroke();
    }
    if (player.roof && !player.car) drawChar(Object.assign({}, player, A.hitPos(player)), L);
    // detection meters: white -> yellow -> red arc above each stealth guard
    for (const e of enemies) if (!e.dead && (e.stealth || e.sniper || e.state === 'alert') && (e.det || 0) > 0.02) {
      const p = A.hitPos(e), d = e.det || 0, col = d >= 1 ? '#e0533f' : d >= 0.45 ? '#f2c93b' : '#ffffff';
      ctx.strokeStyle = '#0008'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(p.x, p.y - 28, 7, 0, 6.28); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x, p.y - 28, 7, -Math.PI / 2, -Math.PI / 2 + d * 6.28); ctx.stroke();
      if (d >= 0.45) { ctx.fillStyle = col; ctx.font = '800 12px IBM Plex Mono, monospace'; ctx.textAlign = 'center'; ctx.fillText(d >= 1 ? '!' : '?', p.x, p.y - 24); ctx.textAlign = 'left'; }
    }
  };
  /** HOOK: minimap extras: vision cones, allies, defended target, chase target. */
  A.drawMinimap = (m, s) => {
    for (const e of enemies) if (!e.dead && e.stealth) {
      m.fillStyle = e.det >= 0.45 ? 'rgba(242,201,59,.35)' : 'rgba(255,255,255,.2)';
      m.beginPath(); m.moveTo(e.x * s, e.y * s); m.arc(e.x * s, e.y * s, visionRange(e) * s, e.a - CONE, e.a + CONE); m.closePath(); m.fill();
    }
    for (const a of S.allies) if (!a.dead) { m.fillStyle = a.down ? '#e0533f' : '#4fb3a9'; m.beginPath(); m.arc(a.x * s, a.y * s, 3, 0, 6.28); m.fill(); }
    if (S.chase) { const r = S.chase.runner; m.fillStyle = '#ff3b2a'; m.beginPath(); m.arc(r.x * s, r.y * s, 5, 0, 6.28); m.fill(); }
    if (S.def) { const t = S.def.target; m.strokeStyle = '#4fb3a9'; m.lineWidth = 2; m.strokeRect(t.x * s, t.y * s, t.w * s, t.h * s); }
    if (S.sab) for (const t of S.sab.targets) { m.fillStyle = t.destroyed ? '#555' : t.bomb > 0 ? '#ff3b2a' : '#4fb3d9'; m.beginPath(); m.arc(t.x * s, t.y * s, 4, 0, 6.28); m.fill(); }
  };

  // =====================================================================
  // A18. HOOKS CALLED BY game.js
  // =====================================================================
  /** HOOK (update): runs every frame after the engine's own update. */
  A.update = dt => {
    for (const a of S.allies) allyTick(a, dt);
    for (const a of S.actors) if (a.follow) { a.x = a.follow.x; a.y = a.follow.y; a.a = a.follow.a; animTick(a, dt); } else if (a.to) {
      const d = dist(a, a.to), sp = (a.speed || 120) * (a.bike ? SCALE.veh : SCALE.walk);
      if (d < sp * dt) { a.x = a.to.x; a.y = a.to.y; const cb = a.onArrive; a.to = null; a.onArrive = null; if (cb) cb(); }
      else { a.a = Math.atan2(a.to.y - a.y, a.to.x - a.x); a.x += Math.cos(a.a) * sp * dt; a.y += Math.sin(a.a) * sp * dt; }
      animTick(a, dt);
    } else if (!a.bike) animTick(a, dt);
    // homing missiles
    for (const b of bullets) if (b.home) {
      const t = player.car || player, want = Math.atan2(t.y - b.y, t.x - b.x), cur = Math.atan2(b.vy, b.vx);
      const na = cur + clamp(angDiff(want, cur), -2.2 * dt, 2.2 * dt), sp = Math.hypot(b.vx, b.vy);
      b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
      if (Math.random() < 0.7) parts.push({ x: b.x, y: b.y, vx: 0, vy: 0, life: 0.4, max: 0.4, color: 'rgba(160,160,160,.5)', size: 4 });
    }
    ramming();
    hostileVehicleHits();
    if (S.hazards.length || S.smoke.length) hazardTick(dt);
    if (S.searchlights.length) searchlightTick(dt);
    if (S.debris.length) debrisTick(dt);
    if (S.fires.length) fireTick(dt);
    if (S.timer) timerTick(dt);
    if (S.chase) chaseTick(dt);
    if (S.sab) sabTick(dt);
    if (S.def) defTick(dt);
    if (S.alarmT > 0) {
      S.alarmT -= dt;
      if (S.alarmBy && S.alarmBy.dead) { S.alarmT = 0; S.alarmBy = null; toast('The guard is down. No alarm.', 'gold'); }
      else if (S.alarmT <= 0) { S.alarm.fired = true; setBanner('ALARM! REINFORCEMENTS INCOMING', 'warn', 3); sfx('tension'); if (S.alarm.onAlarm) S.alarm.onAlarm(); }
    }
    if (sprinting() && !player.car && Math.hypot(player.x - (player.px || player.x), player.y - (player.py || player.y)) > 0.5) A.noise(player.x, player.y, 110);
    if (S.boss) {
      const e = S.boss;
      $('boss-bar').querySelector('i').style.width = clamp(e.hp / e.maxHp * 100, 0, 100) + '%';
      if (e.dead) { $('boss-bar').hidden = true; const cb = e.boss.onDefeat; S.boss = null; if (cb) cb(e); }
    }
    if (S.banner) { S.banner.t -= dt; const el = $('act-banner'); el.hidden = S.banner.t <= 0; el.textContent = S.banner.text; el.className = S.banner.kind; if (S.banner.t <= 0) S.banner = null; }
    promptTick(dt);
    if (S.def || S.stock) $('act-stock').hidden = false, $('act-stock').textContent = `Barricades: ${S.stock} (T)`; else $('act-stock').hidden = true;
    const gun = player.gunner; $('act-heat').hidden = !gun; if (gun) $('act-heat').firstElementChild.style.width = (gun.heat || 0) * 100 + '%';
  };
  /** HOOK (updateBullets): an enemy bullet reached the player / an ally / the defended target. Returns true if it was consumed. */
  A.enemyBullet = b => {
    const me = player.gunner ? player : (player.car || player);
    if (Math.hypot(me.x - b.x, me.y - b.y) < (me.r || 11) + 3) {
      if (A.invulnerable() && !player.car) { return false; }                       // dodge i-frames: bullet passes through
      if (player.cover && !player.car) {
        const n = player.cover.n, v = norm(b.vx, b.vy);
        const fromFront = v.x * n.x + v.y * n.y > 0.25;                             // bullet crosses the wall side
        if (fromFront && (!mouseR.down || Math.random() < 0.5)) { b.life = 0; particle(b.x, b.y, 3, '#aaa', 80, 0.2, 2); return true; }
      }
      if (b.missile) explode(b.x, b.y);
      damagePlayer(b.dmg); b.life = 0; return true;
    }
    for (const a of S.allies) if (!a.down && !a.dead && Math.hypot(a.x - b.x, a.y - b.y) < a.r + 3) { hurtAlly(a, b.dmg * 0.7); b.life = 0; return true; }
    return false;
  };
  /** HOOK (updateBullets): a bullet hit something solid: damage barricades / defended target. */
  A.bulletHitSolid = b => {
    for (const bar of S.barricades) if (b.x > bar.x - 2 && b.x < bar.x + bar.w + 2 && b.y > bar.y - 2 && b.y < bar.y + bar.h + 2) {
      bar.hp -= b.dmg;
      if (bar.hp <= 0) { const i = buildings.indexOf(bar); if (i >= 0) buildings.splice(i, 1); S.barricades = S.barricades.filter(x => x !== bar); rebuildColliders(); particle(b.x, b.y, 12, '#6b5b45', 120, 0.5, 4); toast('A barricade broke!', 'warn'); }
      return;
    }
    if (S.def && b.own === 'e') { const t = S.def.target; if (b.x > t.x - 2 && b.x < t.x + t.w + 2 && b.y > t.y - 2 && b.y < t.y + t.h + 2) S.def.hp -= b.dmg; }
  };
  /** HOOK (hitEnemy): damage multipliers (boss armour, weak points). Returns the final damage. */
  A.onHitEnemy = (e, dmg) => {
    if (!e.boss) return dmg;
    if (e.invT > 0) return 0;
    const ph = e.boss.phases[e.phaseI];
    let m = ph.armor ?? 1;
    if (ph.backOnly) { const behind = Math.abs(angDiff(Math.atan2(player.y - e.y, player.x - e.x), e.a)) > 1.6; if (behind) m = 1; }
    if (e.stunB > 0) m *= 2;
    if (e.hp - dmg * m <= 0 && e.boss.finisher && !e.finished) return Math.max(0, e.hp - 1);   // the finisher QTE ends the fight
    return dmg * m;
  };
  /** HOOK (hitEnemy): called once when an enemy dies. */
  A.onKill = e => { S.stats.kills++; if (e.mount && e.mount.hp > 0) { e.mount.ai = null; e.mount.crashT = 1.2; } };
  /** HOOK (fire): mark bullets fired from a roof so they fly over the streets. */
  A.decorateBullet = b => { if (player.roof || player.gunner) b.elev = true; S.stats.shots++; };
  /** HOOK (damagePlayer): the mounted-gun jeep takes part of the hit. */
  A.damageFilter = n => { const g = player.gunner; if (g && g.car && g.car.hp > 0) { g.car.hp -= n * 0.5; return n * 0.4; } return n; };
  /** HOOK (clearMissionStuff): remove everything a mission created. */
  A.clear = () => {
    for (const l of lights.filter(l => l.mission)) lights.splice(lights.indexOf(l), 1);
    const before = buildings.length;
    for (let i = buildings.length - 1; i >= 0; i--) if (buildings[i].mission) buildings.splice(i, 1);
    if (buildings.length !== before) rebuildColliders();
    for (const id of ['act-timer', 'act-chase', 'boss-bar', 'def-bar', 'qte', 'act-banner', 'act-prompt']) $(id).hidden = true;
    if (S.hack) { state.modal--; $('hack').hidden = true; }
    if (S.qte) state.timeScale = 1;
    const keepAllies = S.allies.filter(a => a.persist), keepStats = S.stats;
    S = fresh(); S.allies = keepAllies; S.stats = keepStats;       // stats last the whole mission
    Object.assign(player, { cover: null, roof: null, gunner: null, zip: null, takedown: null, carry: null, dodgeT: 0, heavyT: 0, crouch: false });
  };
  A.resetAllies = () => { S.allies = []; };
  A.resetStats = () => { S.stats = { kills: 0, takedowns: 0, shots: 0, hits: 0 }; };
  A.cinematic = on => { S.cinematic = on; if (on) { player.cover = null; player.crouch = false; } };
  A.setAlarm = o => { S.alarm = Object.assign({ fired: false }, o); };
  return A;
})();
