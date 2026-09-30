/* =====================================================================
   THE LAST SIGNAL - MISSION MANAGER & DATA-DRIVEN MISSIONS
   Missions are plain data: a list of steps, each with a `type`.
   The MissionManager compiles those steps into the step objects the
   existing Mission runner (game.js) already understands:
       { text, target, start(), update() -> true when finished }
   so dialogue, decisions, the trust system and the game theory engine
   are reused exactly as they are.

   Step types
     setup      set time, weather, weapons, player position
     checkpoint save a restore point (GT snapshot + setup). Death or a
                failed objective restarts from the latest checkpoint.
     cutscene   letterbox + camera + actors + dialogue beats
     dialog     lines of dialogue            tip   a "How to play" line
     goto       reach a point                kill  defeat spawned enemies
     locker     search a locker with E (gives a weapon)
     sabotage   timed defense: stop bombs being planted on targets
     chase      ChaseController pursuit along a spline
     qte        quick-time event sequence
     action     custom mechanic: run(step, done, fail)
     passed     the MISSION PASSED screen
   Every step may also have: failIf() -> reason string, onDone()
   ===================================================================== */
'use strict';
const MissionManager = (() => {
  const MM = { cp: null, failing: false, t0: 0 };
  const flags = () => (GT.flags = GT.flags || {});

  // -------------------------------------------------------------------
  // Checkpoints
  // -------------------------------------------------------------------
  function snapshot() {
    return { GT: JSON.stringify(GT), weapons: state.weapons.slice(), clock: state.clock, weather: state.weather, stats: JSON.stringify(Action.stats()) };
  }
  MM.active = () => !!(CHAPTERS[Mission.ch] && CHAPTERS[Mission.ch].dataDriven && Mission.started && MM.cp);
  /** Mission failed: show the reason, then restart from the last checkpoint. */
  MM.fail = reason => {
    if (MM.failing || !MM.cp) return;
    MM.failing = true;
    Action.clear();
    panel(`<div class="eyebrow">Mission failed</div><h2 class="failed">${reason}</h2><p>Restarting from checkpoint: <b>${MM.cp.name}</b>.</p>`, 'Retry from checkpoint', () => MM.retry());
  };
  MM.retry = () => {
    const cp = MM.cp; MM.failing = false;
    GT = Object.assign(freshGT(), JSON.parse(cp.snap.GT));
    state.weapons = cp.snap.weapons.slice(); state.clock = cp.snap.clock; state.weather = cp.snap.weather;
    clearMissionStuff(); bullets = []; enemies = enemies.filter(e => !e.dead);
    player = Object.assign(newPlayer(), { x: player.x, y: player.y });
    updateTrustHud(); updateRiverHud();
    Mission.i = cp.i - 1; Mission.cur = null; Mission.next();
  };

  // -------------------------------------------------------------------
  // Step compilers: data -> runnable step
  // -------------------------------------------------------------------
  const T = {};
  const at = p => Array.isArray(p) ? { x: p[0], y: p[1] } : p;
  function applySetup(s) {
    if (s.clock !== undefined) state.clock = s.clock;
    if (s.weather) { state.weather = s.weather; state.weatherT = 999; }
    if (s.weapons) { state.weapons = s.weapons.slice(); const w = state.weapons.findIndex(Boolean); player.weapon = w < 0 ? 2 : w; }
    if (s.pos) { player.car = null; player.x = s.pos[0]; player.y = s.pos[1]; player.hp = s.hp || 100; player.dead = false; CAM.x = player.x; CAM.y = player.y; }
    if (s.trustHud !== undefined) $('hud-br').hidden = !s.trustHud;
    if (s.run) s.run();
    updateHud();
  }
  T.setup = s => ({ start() { applySetup(s); }, update: () => true });
  T.checkpoint = s => ({
    start() {
      MM.cp = { i: Mission.i, name: s.name, snap: snapshot() };
      applySetup(s);
      if (!s.silent) toast('Checkpoint: ' + s.name, 'gold');
      saveGame();
    },
    update: () => true,
  });
  T.dialog = s => ({ text: s.text, start() { this.done = false; dialog(s.lines, () => { this.done = true; }); }, update() { return this.done; } });
  T.tip = s => T.dialog({ lines: [['Tip', s.text, 'sys']] });
  T.goto = s => ({
    text: s.text, target: Object.assign(at(s.to), { r: s.r || 45 }),
    start() { if (s.start) s.start(); },
    update() { const p = at(s.to); return dist(player.car || player, p) < (s.r || 45) && (!s.needCar || player.car); },
  });
  T.kill = s => ({
    text: s.text, target: s.target && at(s.target),
    start() { this.list = s.spawns.map(([type, x, y, extra]) => spawnEnemy(type, x, y, Object.assign({ mission: true, aggro: !s.stealth }, extra))); if (s.start) s.start(this.list); },
    update() { const left = this.list.filter(e => !e.dead).length; setObjective(s.text + (left ? ` (${left} left)` : '')); return left === 0; },
  });
  T.locker = s => ({
    text: s.text, target: { x: s.x, y: s.y, r: 30 },
    start() {
      this.done = false;
      const it = { x: s.x, y: s.y, r: 34 * SCALE.reach + 4, label: s.label || 'Search the locker', fn: () => {
        Action.S().interact = Action.S().interact.filter(i => i !== it);
        if (s.give === 'pistol') { state.weapons[0] = true; player.weapon = 0; }
        if (s.give === 'rifle') { state.weapons[1] = true; player.weapon = 1; }
        if (s.give === 'pipe') { state.weapons[2] = true; }
        sfx('pick'); updateHud();
        if (s.lines) dialog(s.lines, () => { this.done = true; }); else this.done = true;
      } };
      Action.S().interact.push(it);
    },
    update() { return this.done; },
  });
  T.sabotage = s => ({
    text: s.text,
    start() { this.done = false; Action.sabotage(Object.assign({}, s, { onEnd: (lost, tg) => { if (s.onEnd) s.onEnd(lost, tg); this.done = true; } })); },
    update() { return this.done; },
  });
  T.qte = s => ({
    text: s.text,
    start() { this.done = false; Action.qte(s.seq, ok => { if (ok) { this.done = true; if (s.onSuccess) s.onSuccess(); } else MM.fail(s.failText || 'Too slow'); }, { text: s.prompt }); },
    update() { return this.done; },
  });
  T.chase = s => ({
    text: s.text, target: () => s._runner,
    start() {
      this.done = false;
      const r = s._runner = spawnCar(s.runner.type, s.runner.x, s.runner.y, s.runner.a || 0, Object.assign({ mission: true, lit: true, npc: true }, s.runner.extra));
      if (s.beforeStart) s.beforeStart(r);
      const run = () => Action.chase(Object.assign({}, s, { runner: r, onEnd: () => { this.done = true; if (s.onEnd) s.onEnd(r); }, onFail: () => MM.fail(s.failText || 'The target got away') }));
      if (s.waitForCar) { this.wait = true; this.run = run; } else run();
    },
    update() {
      if (this.wait && player.car) { this.wait = false; setObjective(s.text); this.run(); }
      else if (this.wait) setObjective(s.waitText || 'Get on the bike (E)');
      return this.done;
    },
  });
  T.action = s => ({
    text: s.text, target: s.target,
    start() { this.done = false; s.run(this, () => { this.done = true; }, reason => MM.fail(reason)); },
    update(dt) { if (s.tick) s.tick(this, dt); return this.done; },
  });

  /** Cutscene: letterbox, camera moves, actors walk/ride, dialogue, effects. */
  T.cutscene = s => ({
    start() {
      this.done = false;
      const beats = s.beats.slice(); document.body.classList.add('cinematic'); Action.cinematic(true);
      const next = () => {
        if (!beats.length) { document.body.classList.remove('cinematic'); Action.cinematic(false); Action.setCam(null); if (!s.keepActors) for (const id of s.cleanup || []) Action.removeActor(id); this.done = true; return; }
        const b = beats.shift();
        if (b.cam) { Action.setCam({ x: b.cam[0], y: b.cam[1], zoom: b.cam[2] || 1.2 }); next(); }
        else if (b.actor) { Action.actor(b.actor.id, b.actor); next(); }
        else if (b.move) { const a = Action.getActor(b.move.id); a.to = at(b.move.to); a.speed = b.move.speed || 120; if (b.move.wait) a.onArrive = next; else next(); }
        else if (b.remove) { Action.removeActor(b.remove); next(); }
        else if (b.say) dialog(b.say, next);
        else if (b.wait) setTimeout(next, b.wait * 1000);
        else if (b.explode) { explode(b.explode[0], b.explode[1]); shake(12); next(); }
        else if (b.do) { if (b.do.length) b.do(next); else { b.do(); next(); } }
        else next();
      };
      next();
    },
    update() { return this.done; },
  });

  /** MISSION PASSED screen with stats and rewards. */
  T.passed = s => ({
    start() {
      this.done = false;
      const st = Action.stats(), secs = (performance.now() - MM.t0) / 1000;
      const rows = [['Time', `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`], ['Enemies defeated', st.kills], ['Silent takedowns', st.takedowns], ['Accuracy', st.shots ? Math.round(st.hits / st.shots * 100) + '%' : '—'], ...(s.stats ? s.stats() : [])];
      const el = $('passed');
      $('passed-title').textContent = s.title;
      $('passed-rows').innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
      $('passed-rewards').innerHTML = (s.rewards ? s.rewards() : []).map(r => `<li>${r}</li>`).join('');
      el.hidden = false; state.modal++; sfx('pick');
      // Disabled for 1 s so a Space/Enter still held from the action (dodge, QTE) can't skip the screen by accident
      const ok = $('passed-ok'); ok.disabled = true;
      ok.onclick = () => { el.hidden = true; state.modal--; MM.cp = null; this.done = true; };
      setTimeout(() => { ok.disabled = false; ok.focus(); }, 1000);
    },
    update() { return this.done; },
  });

  /** Compile a mission description into the chapter format Mission already runs. */
  MM.compile = m => ({
    label: m.label, title: m.title, sub: m.sub, dataDriven: true,
    steps: m.steps.map(s => {
      const step = T[s.type](s);
      if (s.failIf) { const up = step.update.bind(step); step.update = dt => { const r = s.failIf(); if (r) { MM.fail(r); return false; } return up(dt); }; }
      if (s.onDone) { const up = step.update.bind(step); step.update = dt => { const d = up(dt); if (d) s.onDone(); return d; }; }
      return step;
    }),
  });
  MM.startClock = () => { MM.t0 = performance.now(); Action.resetStats(); };
  MM.flags = flags;
  return MM;
})();

// =====================================================================
// PROLOGUE - "BLACKOUT"
// =====================================================================
(() => {
  // plant = the open side of each tank where a scavenger kneels to plant the charge
  const W = { tankW: { x: 335, y: 2105, r: 28, name: 'the west water tank', plant: { x: 335, y: 2062 } }, tankE: { x: 405, y: 2105, r: 28, name: 'the east water tank', plant: { x: 405, y: 2062 } } };
  const crate = (x, y) => { buildings.push({ x: x - 18, y: y - 18, w: 36, h: 36, hgt: 14, roof: '#5a4d3a', crate: true, mission: true }); };
  // Razor's escape route: road waypoints (map px) -> smoothed into a spline by the ChaseController
  const ROUTE = [[1040, 2150], [760, 2150], [700, 2090], [700, 1760], [640, 1700], [310, 1700], [250, 1640], [250, 1260], [310, 1200], [700, 1200], [1190, 1200], [1600, 1200], [1650, 1260], [1650, 1640], [1700, 1705], [1795, 1740], [1795, 1835], [1915, 1840], [1915, 1948], [2010, 1948], [2150, 1948]].map(([x, y]) => ({ x, y }));

  const PROLOGUE = {
    label: 'Prologue', title: 'Blackout', sub: 'Eighteen months without power. Somebody is still transmitting.',
    steps: [
      { type: 'setup', clock: 23 * 60 + 10, weather: 'clear', weapons: [false, false, false], pos: [1030, 1965], trustHud: false, run: () => { MissionManager.startClock(); Action.resetAllies(); } },

      // ---------------- INTRO CUTSCENE ----------------
      { type: 'cutscene', cleanup: ['b1', 'b2', 'b3', 'razor'], beats: [
        { cam: [1060, 1965, 1.45] },
        { actor: { id: 'jogi', cast: 'jogi', x: 1088, y: 1962, a: Math.PI, label: 'Baba Jogi', labelColor: '#c9b48a' } },
        { say: [['Radio', '…seven… four… one… one… nine… seven… four…', 'radio'],
                ['Baba Jogi', 'Veer… someone is still transmitting. After eighteen months.'],
                ['Veer', 'Same numbers every night this week. Somebody wants to be heard.']] },
        { cam: [720, 2020, 1.1] },
        { explode: [712, 1975] }, { explode: [700, 2010] },
        { do: () => { Action.fire(700, 1990, 26, { grow: 1.5, max: 42 }); } },
        { actor: { id: 'b1', bike: true, x: 700, y: 2260, a: -Math.PI / 2, bikeColor: '#7a4a3a' } },
        { actor: { id: 'b2', bike: true, x: 730, y: 2300, a: -Math.PI / 2, bikeColor: '#7a4a3a' } },
        { actor: { id: 'razor', bike: true, x: 715, y: 2340, a: -Math.PI / 2, bikeColor: '#c43d2a', label: 'Razor', labelColor: '#e0533f' } },
        { move: { id: 'b1', to: [640, 1985], speed: 320 } }, { move: { id: 'b2', to: [620, 2040], speed: 320 } },
        { move: { id: 'razor', to: [690, 2070], speed: 300, wait: true } },
        { say: [['Razor', '(loudspeaker) Heard you got a magic radio, engineer!', 'radio'],
                ['Razor', '(loudspeaker) Hand it over and I’ll leave your water tanks standing!', 'radio'],
                ['Veer', 'Baba, stay down. I’ll deal with them.']] },
      ] },

      // ---------------- ACTION SEQUENCE 1: "Wake Up Fighting" ----------------
      { type: 'checkpoint', name: 'Wake Up Fighting', clock: 23 * 60 + 12, pos: [1030, 1965], weapons: [false, false, true], run: () => {
        for (const [x, y] of [[1105, 1895], [965, 2035], [985, 1890]]) Action.fire(x, y, 18, { grow: 1, max: 34, spread: 1 });
        Action.S().fireCap = 12;
      } },
      { type: 'tip', text: 'You grabbed a pipe. F = light attack, V = heavy attack (slow, knocks enemies down). Space = dodge roll: you can’t be hurt mid-roll (Ctrl also works, but Ctrl+W closes the browser tab, so use Space while moving). Keep out of the fire.' },
      { type: 'kill', text: 'Fight off the scavengers in the burning dock warehouse', target: [1020, 1960], spawns: [['brute', 975, 1915, { hp: 45 }], ['brute', 990, 2020, { hp: 45 }], ['brute', 955, 1965, { hp: 70 }]] },
      { type: 'locker', text: 'Search the dock locker for a weapon', x: 1098, y: 2030, label: 'Open the locker', give: 'pistol',
        lines: [['Veer', 'Dad’s old service pistol. Never thought I’d need it.'], ['Tip', 'Press 1 for the pistol, 3 for the pipe. Aim with the mouse and click to shoot.', 'sys']] },

      { type: 'checkpoint', name: 'Crossfire', pos: [600, 1985], weapons: [true, false, true], clock: 23 * 60 + 16, run: () => {
        for (const [x, y] of [[400, 1915], [485, 1915], [570, 1905], [330, 1800], [430, 1790]]) crate(x, y);
        rebuildColliders();
        Action.fire(655, 1880, 22, { grow: 1.2, max: 36, spread: 1, spreadDir: Math.PI });
        Action.S().fireCap = 14;
      } },
      { type: 'tip', text: 'COVER: stand next to a crate, wall or car and press Q. In cover, A/D slide along it. Hold the RIGHT mouse button to peek and aim; clicking without peeking is blind fire (inaccurate). Bullets from the far side hit the crate, not you.' },
      { type: 'kill', text: 'Take cover behind the crates and drive the scavengers out of the base', target: [485, 1945],
        spawns: [['scav', 330, 1760], ['scav', 430, 1752], ['scav', 290, 1790], ['scav', 520, 1760], ['scav', 380, 1740], ['scav', 470, 1790]] },

      // ---------------- timed: the water tanks ----------------
      { type: 'checkpoint', name: 'The Water Tanks', pos: [460, 2000], weapons: [true, false, true], run: () => { for (const b of buildings) if (b.tank && b.y > 2000) { b.roof = '#4d6d78'; b.ruined = false; } } },
      { type: 'dialog', lines: [['Baba Jogi', '(radio) Veer! They’re at the water tanks with explosives!', 'radio'], ['Tip', 'TIMED OBJECTIVE: survive 90 seconds. Kill scavengers before they finish planting (orange bar). If a bomb is planted, hold E next to it to defuse it before it blows.', 'sys']] },
      { type: 'sabotage', text: 'Stop the scavengers blowing up the water tanks', label: 'Protect the water tanks', duration: 90,
        targets: [W.tankW, W.tankE],
        waves: [{ at: 1, spawns: [[700, 2160], [250, 2170]] }, { at: 16, spawns: [[700, 2160], [720, 2110]] }, { at: 30, spawns: [[250, 2160], [260, 2110], [700, 2170]] },
                { at: 46, spawns: [[700, 2160], [250, 2160]] }, { at: 60, spawns: [[720, 2120], [700, 2170], [250, 2150]] }, { at: 74, spawns: [[260, 2120], [700, 2160]] }],
        onEnd: lost => { MissionManager.flags().tanksLost = lost; } },
      { type: 'action', run: (st, done) => {
        const lost = MissionManager.flags().tanksLost;
        dialog(lost === 0 ? [['Veer', 'Both tanks are standing. Lakeside still has its water.']]
          : lost === 1 ? [['Veer', 'We lost one tank. That’s a month of water gone.'], ['Baba Jogi', 'Then we ration. We’ve done it before.']]
            : [['Veer', 'Both tanks… gone.'], ['Baba Jogi', 'We’ll have to beg the river for every drop now.']], done);
      } },

      // ---------------- ACTION SEQUENCE 2: "Razor's Run" ----------------
      { type: 'cutscene', cleanup: ['razor', 'jogi'], beats: [
        { cam: [1070, 1990, 1.35] },
        { actor: { id: 'jogi', cast: 'jogi', x: 1085, y: 1962, a: Math.PI, label: 'Baba Jogi', labelColor: '#c9b48a' } },
        { actor: { id: 'razor', bike: true, x: 1040, y: 2150, a: -Math.PI / 2, bikeColor: '#c43d2a', label: 'Razor', labelColor: '#e0533f' } },
        { move: { id: 'razor', to: [1060, 1985], speed: 260, wait: true } },
        { say: [['Baba Jogi', 'No! Not the radio!'], ['Razor', 'Thanks for the souvenir, old man!']] },
        { move: { id: 'razor', to: [1040, 2150], speed: 300, wait: true } },
        { say: [['Veer', 'He’s got the radio! I need wheels!']] },
      ] },
      { type: 'checkpoint', name: 'Razor’s Run', pos: [1075, 2120], weapons: [true, false, true], run: () => {
        const bike = spawnCar('bike', 1100, 2150, Math.PI, { mission: true }); bike.hp = 140;
      } },
      { type: 'tip', text: 'CHASE: get on the bike (E) and follow Razor. While driving, hold the left mouse button to shoot at the mouse pointer (drive-by). If you fall too far behind for 10 seconds, he escapes.' },
      { type: 'chase', text: 'Chase Razor and get the radio back', waitForCar: true, waitText: 'Get on the bike (press E next to it)', label: 'Razor', failText: 'Razor got away with the radio',
        runner: { type: 'bike', x: 1040, y: 2150, a: Math.PI, extra: { color: '#c43d2a', hp: 9999 } },
        path: ROUTE, base: 235, boost: 85, escapeDist: 650, escapeTime: 10,
        events: [
          { at: 0.12, fn: () => { for (const [dx, dy] of [[60, 60], [-60, 90]]) Action.spawnBiker(player.x + dx, player.y + dy, { a: -Math.PI / 2 }); toast('Scavenger bikes behind you!', 'warn'); } },
          { at: 0.28, fn: ch => {                                  // scripted: a billboard collapses right behind Razor, blocking half the road
            const r = ch.runner, bx = r.x - Math.cos(r.a) * 70, by = r.y - Math.sin(r.a) * 70;
            const vert = Math.abs(Math.sin(r.a)) > 0.7, w = vert ? 44 : 34, h = vert ? 34 : 44;
            const side = vert ? -18 : 0, sideY = vert ? 0 : -18;
            buildings.push({ x: bx - w / 2 + side, y: by - h / 2 + sideY, w, h, hgt: 8, roof: '#4a4038', ruined: true, mission: true, billboard: true }); rebuildColliders();
            explode(bx, by); shake(12); toast('The billboard is coming down! Swerve!', 'warn');
            if (dist(player.car || player, { x: bx, y: by }) < 45) damagePlayer(25);
          } },
          { at: 0.5, fn: () => { for (const [dx, dy] of [[-80, 50], [-80, -50]]) Action.spawnBiker(player.x + dx, player.y + dy, { a: 0 }); toast('More bikes on the bridge!', 'warn'); } },
          { at: 0.74, fn: () => { Action.spawnBiker(player.x - 40, player.y - 80, { a: Math.PI / 2 }); toast('Razor’s cutting through Crow’s Market!', 'warn'); } },
          { at: 0.93, fn: ch => { ch.runner.jump = 1; toast('Razor jumps the broken flyover!', 'warn'); } },
        ],
        onEnd: () => {} },
      { type: 'action', run: (st, done, fail) => {
        // Veer's bike can't make the gap: he has to be close enough to leap for the strap
        const r = cars.find(c => c.lit && c.mission);
        const me = player.car || player;
        if (r && dist(r, me) > 320) { fail('You were too far behind. Razor escaped with the radio'); return; }
        if (player.car) { player.car.v = 0; player.car.scripted = true; }
        done();
      } },
      { type: 'qte', text: 'Leap for the radio!', failText: 'You missed the jump. Razor escaped with the radio',
        seq: [{ key: 'Space', label: 'SPACE', t: 1.5, text: 'LEAP OFF THE BIKE' }, { key: 'KeyE', label: 'E', t: 1.1, text: 'GRAB THE STRAP' }, { mash: 'KeyF', label: 'F', count: 8, t: 3, text: 'PULL' }],
        onSuccess: () => { shake(10); sfx('thud'); MissionManager.flags().radioBack = true; } },
      { type: 'action', run: (st, done) => {
        const bike = player.car; if (bike) { player.car = null; bike.v = 0; }
        player.x = 1990; player.y = 1960; collide(player, player.r); player.hp = Math.max(player.hp - 10, 10);
        const r = cars.find(c => c.lit && c.mission); if (r) { r.scripted = true; r.x = 2240; r.y = 1910; }
        dialog([['Razor', '(fading) Keep the junk, engineer! This isn’t over!', 'radio'], ['Veer', 'Got it. The strap snapped, but the radio’s in one piece.']], done);
      } },

      // ---------------- OUTRO ----------------
      { type: 'setup', pos: [1040, 1975], clock: 5 * 60 + 40, run: () => { clearMissionStuff(); } },
      { type: 'cutscene', cleanup: ['jogi'], beats: [
        { cam: [1065, 1968, 1.5] },
        { actor: { id: 'jogi', cast: 'jogi', x: 1088, y: 1962, a: Math.PI, label: 'Baba Jogi', labelColor: '#c9b48a' } },
        { say: [['Baba Jogi', 'Dawn already. Let me see… the numbers are a key. Here… a message.'],
                ['Radio', '…this is Arjun Rao, shift engineer, Solace power station… the blackout was not an accident… Helix Dynamics triggered the cascade…', 'radio'],
                ['Radio', '…the grid can restart with the code in this signal… but only if all four colonies feed power at the same moment… water, fuel, medicine, food…', 'radio'],
                ['Veer', 'Helix. All this time it was Helix.'],
                ['Veer', 'Four colonies who hate each other. Doing something together. At the same time.'],
                ['Baba Jogi', 'Then you’d better start making friends.']] },
        { do: () => { $('hud-br').hidden = false; updateTrustHud(true); } },
        { say: [['Tip', 'TRUST METER (bottom right): how much each colony trusts you, from 0 to 100. Every deal is a real game-theory round, and each leader follows a known strategy. The stars show hostility, like a wanted level: at 3 stars a colony’s guards attack you in its district.', 'sys']] },
      ] },
      { type: 'passed', title: 'Prologue · Blackout',
        stats: () => { const f = MissionManager.flags(); return [['Water tanks saved', `${2 - (f.tanksLost || 0)} / 2`], ['Radio recovered', f.radioBack ? 'Yes' : 'No']]; },
        rewards: () => { const f = MissionManager.flags(); const lost = f.tanksLost || 0; return ['Weapons: pipe, pistol', 'Trust meter unlocked', lost ? `Lakeside water: −${lost * 20} (Chapter 1 starts with less to trade)` : 'Lakeside water: full supply']; },
        onDone: () => {
          const f = MissionManager.flags(); GT.res.lakeside -= (f.tanksLost || 0) * 20;
          player.x = P.home.x; player.y = P.home.y; CAM.x = player.x; CAM.y = player.y; state.clock = 7 * 60;
          if (!cars.some(c => c.home && c.hp > 0)) spawnCar('jeep', 600, 2060, 0, { home: true });
        } },
    ],
  };

  CHAPTERS[0] = MissionManager.compile(PROLOGUE);
})();

// =====================================================================
// ACTION LAB - one-button test scenes for every Part A mechanic
// (opened from the Examiner demo panel, key `)
// =====================================================================
const ActionLab = (() => {
  const L = {};
  const prep = (x, y, o = {}) => {
    clearMissionStuff(); enemies = []; bullets = [];
    Action.resetAllies();
    player.car = null; player.dead = false; player.hp = 100; player.x = x; player.y = y; CAM.x = x; CAM.y = y;
    state.weapons = [true, true, true]; player.weapon = 0;
    if (o.clock !== undefined) state.clock = o.clock;
    Mission.cur = null; setObjective(o.text || 'Action lab');
  };
  const done = msg => () => { toast(msg, 'gold'); setObjective('Action lab: test complete. Press ` for another test.'); };

  L.stealth = () => {
    prep(2130, 1150, { clock: 22 * 60, text: 'Stealth: take down all 4 guards without being seen' });
    const g = (x, y, route, a) => spawnEnemy('trooper', x, y, { mission: true, stealth: true, aggro: false, route: route && route.map(([x, y]) => ({ x, y })), a: a || 0, baseA: a });
    const list = [g(2200, 820, [[2200, 820], [2340, 820], [2340, 1000], [2200, 1000]]), g(2280, 1080, null, Math.PI), g(2330, 1150, [[2330, 1150], [2180, 1150]]), g(2160, 940, null, 0)];
    Action.addHideSpot(2140, 1080); Action.addHideSpot(2370, 760);
    Action.setAlarm({ onAlarm: () => { for (const [x, y] of [[2380, 1180], [2380, 720]]) spawnEnemy('trooper', x, y, { mission: true, aggro: true }); } });
    toast('C crouch · E takedown from behind · B drag bodies to a dumpster · vision cones also show on the minimap');
    Mission.cur = { text: 'Stealth test', update() { if (list.every(e => e.dead)) { done(Action.S().alarm && Action.S().alarm.fired ? 'Guards cleared (the alarm went off)' : 'Ghost! Nobody raised the alarm.')(); Mission.cur = null; } return false; } };
  };
  L.boss = () => {
    prep(1700, 1060, { text: 'Boss test: defeat Razor (3 phases)' });
    for (const [x, y] of [[1760, 980], [1990, 980], [1760, 1120], [1990, 1120]]) buildings.push({ x, y, w: 40, h: 40, hgt: 14, roof: '#5a4d3a', crate: true, mission: true });
    rebuildColliders();
    Action.boss({ name: 'RAZOR', hp: 900, x: 2020, y: 1060, cfg: CR.CAST.razor, weapon: 'pistol',
      phases: [{ at: 1, patterns: ['charge', 'spray'] },
               { at: 0.66, patterns: ['flame', 'charge'], armor: 0.35, backOnly: true, onEnter: () => toast('Flamethrower! Shoot the fuel tank on his back (get behind him).', 'warn') },
               { at: 0.33, patterns: ['summon', 'missiles', 'slam'] }],
      finisher: [{ key: 'KeyF', label: 'F', t: 1.2, text: 'COUNTER' }, { key: 'KeyV', label: 'V', t: 1.2, text: 'HEAVY BLOW' }, { mash: 'KeyF', label: 'F', count: 6, t: 2.5, text: 'FINISH' }],
      onDefeat: done('Boss defeated') });
    toast('Dodge-roll (Ctrl/Space) through charges and slams. Charging into a wall stuns him (double damage).');
  };
  L.allies = () => {
    prep(470, 1990, { text: 'Defense test: protect the generator with Tara' });
    Action.addAlly({ id: 'tara', name: 'Tara', x: 440, y: 2010, dmg: 12 });
    Action.defend({ target: { x: 445, y: 1880, w: 60, h: 40, name: 'the generator' }, hp: 500, barricades: 4, turrets: [[520, 1840]],
      waves: [[['scav', 700, 1750], ['scav', 700, 1800], ['scav', 690, 2140]], [['scav', 260, 1720], ['brute', 700, 1760], ['scav', 700, 2150], ['scav', 280, 2150]], [['trooper', 700, 1740], ['brute', 260, 1730], ['trooper', 700, 2160], ['drone', 480, 1720]]],
      onWin: done('All waves held!'), onLose: () => toast('The generator was destroyed.', 'warn') });
  };
  L.turret = () => {
    prep(600, 2060, { text: 'Turret run: Tara drives, you shoot' });
    const jeep = spawnCar('jeep', 700, 2100, -Math.PI / 2, { mission: true, escort: true });
    jeep.hp = 400;
    Action.turretRide(jeep, [{ x: 700, y: 1700 }, { x: 700, y: 1250 }, { x: 700, y: 750 }, { x: 650, y: 700 }, { x: 300, y: 700 }], { locked: false });
    for (const [x, y] of [[640, 1500], [760, 1400], [650, 1100], [760, 950]]) spawnEnemy('scav', x, y, { mission: true, aggro: true });
    setTimeout(() => { Action.spawnBiker(700, 2200, { a: -Math.PI / 2 }); Action.spawnBiker(740, 2250, { a: -Math.PI / 2 }); }, 2500);
    toast('Mouse aims the mounted gun, hold click to fire. Watch the heat bar. E gets off.');
  };
  L.boat = () => {
    prep(1105, 1965, { text: 'Boat: get in (E) and drive down the river' });
    spawnCar('boat', 1165, 1980, -Math.PI / 2, { mission: true });
    for (const [x, y] of [[1090, 1400], [1290, 1500], [1090, 1600]]) spawnEnemy('scav', x, y, { mission: true, aggro: true });
  };
  L.climb = () => {
    // pick two neighbouring rooftops near the player's start for a climb + zipline + sniper test
    const cand = buildings.filter(b => !b.land && !b.tank && !b.crate && !b.stall && b.w > 70 && b.h > 70 && b.x > 750 && b.x < 1050 && b.y > 1300 && b.y < 1650);
    const b1 = cand[0], b2 = cand.find(b => b !== b1 && Math.abs(b.x - b1.x) + Math.abs(b.y - b1.y) < 320) || cand[1];
    if (!b1 || !b2) { toast('No rooftops found for this test', 'warn'); return; }
    const base = { x: b1.x + b1.w / 2, y: b1.y + b1.h + 16 };
    prep(base.x, base.y + 30, { text: 'Climb the fire escape, zipline across, take out the sniper' });
    Action.addClimb(b1, base.x, base.y);
    const p1 = { x: clamp(b2.x + b2.w / 2, b1.x + 12, b1.x + b1.w - 12), y: clamp(b2.y + b2.h / 2, b1.y + 12, b1.y + b1.h - 12) };
    const p2 = { x: clamp(b1.x + b1.w / 2, b2.x + 12, b2.x + b2.w - 12), y: clamp(b1.y + b1.h / 2, b2.y + 12, b2.y + b2.h - 12) };
    Action.addZip(b1, p1, b2, p2);
    const b3 = cand.find(b => b !== b1 && b !== b2) || b2;
    const s = spawnEnemy('sniper', b3.x + b3.w / 2, b3.y + b3.h / 2, { mission: true, roof: b3, aggro: true });
    Mission.cur = { text: 'Rooftops test', target: base, update() { if (s.dead) { done('Sniper down')(); Mission.cur = null; } return false; } };
    toast('Hold E at the ladder to climb. The sniper’s red laser fires when it turns solid: break line of sight or dodge.');
  };
  L.hack = () => { Action.hack(Math.random() < 0.5 ? 'nodes' : 'wave', ok => toast(ok ? 'Camera disabled' : 'Try again', ok ? 'gold' : 'warn')); };
  L.qte = () => { Action.qte([{ key: 'KeyE', label: 'E', t: 1.2, text: 'DODGE THE BUS' }, { key: 'Space', label: 'SPACE', t: 1.2, text: 'JUMP' }, { mash: 'KeyF', label: 'F', count: 8, t: 3, text: 'PULL' }], ok => toast(ok ? 'QTE passed' : 'QTE failed', ok ? 'gold' : 'warn')); };
  L.chase = () => {
    prep(700, 1700, { text: 'Chase test: catch the runner' });
    const bike = spawnCar('bike', 720, 1720, -Math.PI / 2, { mission: true });
    const r = spawnCar('bike', 700, 1600, -Math.PI / 2, { mission: true, lit: true, npc: true, color: '#c43d2a', hp: 9999 });
    const go = () => Action.chase({ runner: r, label: 'the runner', path: [[700, 1600], [700, 1260], [760, 1200], [1190, 1200], [1600, 1200], [1650, 1150], [1650, 750], [1700, 700], [2050, 700]].map(([x, y]) => ({ x, y })), onEnd: done('Caught up!'), onFail: () => toast('The runner escaped', 'warn') });
    Mission.cur = { text: 'Get on the bike (E), then chase', update() { if (player.car) { go(); Mission.cur = null; setObjective('Chase the runner'); } return false; } };
  };
  L.list = [['stealth', 'Stealth + takedowns'], ['boss', 'Boss fight'], ['allies', 'Allies + defense'], ['turret', 'Turret run'], ['boat', 'Boat'], ['climb', 'Climb + zipline'], ['hack', 'Hacking'], ['qte', 'QTE'], ['chase', 'Chase']];
  return L;
})();
