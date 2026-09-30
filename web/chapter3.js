/* =====================================================================
   CHAPTER 3 - "THE POISONED RIVER"  (all colonies)
   Game theory: TRAGEDY OF THE COMMONS
     Action 1 "River Chase"   : boat chase after a Helix barge dumping barrels.
                                Floating debris, burning oil slicks, Helix
                                gunboats, a jump over the broken dam (QTE),
                                board the barge (QTE) and fight its crew.
     Action 2 "Pump Station"  : night stealth at the Helix pumping station on
                                the east bank: hack 2 cameras, avoid 2
                                searchlights, silent takedowns, plant 3
                                charges. Detected -> alarm + reinforcements.
                                Escape before the fence door closes, then
                                dive into the river.
     Decision "The Council"   : the four leaders meet under the bridge.
                                Tension depends on trust; Elena confronts Veer
                                if he diluted her water in Chapter 1. Then 4
                                days of extraction (Low 5 / Medium 10 /
                                High 20) against +15 regeneration, using the
                                existing commonsDay() engine. The river's
                                colour follows its health in 3D; if it dies
                                the riverbed dries out for the rest of the game.
   ===================================================================== */
'use strict';
(() => {
  const F = () => MissionManager.flags();
  // Barge route (river centre x ~1190): up from the docks, round the north bend, back down to the pump station.
  const RIVER_ROUTE = [[1190, 1900], [1190, 1400], [1175, 1250], [1190, 900], [1195, 500], [1210, 290], [1240, 330], [1238, 700], [1236, 1000], [1244, 1050]].map(([x, y]) => ({ x, y }));
  const STATION = { x: 1324, y: 933, w: 166, h: 213 };                         // rubble lot on the east bank (Dead Zone)
  const chem = (x, y) => buildings.push({ x: x - 14, y: y - 14, w: 28, h: 28, hgt: 16, roof: '#3f6b45', crate: true, chem: true, mission: true });
  const fence = [];
  function buildFence() {
    // west fence of the station with a door gap (y 1030-1070) that closes during the escape
    for (const [y0, y1] of [[933, 1030], [1070, 1146]]) { const b = { x: 1316, y: y0, w: 8, h: y1 - y0, hgt: 12, roof: '#6a6e70', fence: true, mission: true }; buildings.push(b); fence.push(b); }
    rebuildColliders();
  }

  const CH3 = {
    label: 'Chapter 3', title: 'The Poisoned River', sub: 'One river feeds every colony. Everyone wants just a little more.',
    steps: [
      { type: 'setup', clock: 9 * 60, weather: 'clear', pos: [1080, 1965], trustHud: true, run: () => { MissionManager.startClock(); Action.resetAllies(); $('hud-river').hidden = false; updateRiverHud(); } },
      { type: 'cutscene', cleanup: ['jogi'], beats: [
        { cam: [1150, 1965, 1.4] },
        { actor: { id: 'jogi', cast: 'jogi', x: 1095, y: 1945, a: 0, label: 'Baba Jogi', labelColor: '#c9b48a' } },
        { do: () => { for (let i = 0; i < 30; i++) parts.push({ x: 1140 + rnd(0, 100), y: 1900 + rnd(0, 120), vx: 0, vy: 0, life: 20, max: 20, color: '#c9d0c0', size: 3 }); } },
        { say: [['Veer', 'Dead fish. Hundreds of them.'],
                ['Baba Jogi', 'Three children at Lakeside can’t keep water down. It’s the river, Veer.'],
                ['Baba Jogi', 'Someone upstream is poisoning it. And we’re all taking too much from what’s left.'],
                ['Tara "Sparks" Nair', '(radio) Veer! A Helix barge just passed the docks, dumping barrels as it goes. The boat’s ready!', 'radio']] },
      ] },

      // ---------------- ACTION 1: RIVER CHASE ----------------
      { type: 'checkpoint', name: 'River Chase', pos: [1114, 1985], clock: 9 * 60 + 5, run: () => { const b = spawnCar('boat', 1138, 1985, -Math.PI / 2, { mission: true }); b.hp = 260; } },   // boat moored against the dock
      { type: 'tip', text: 'BOAT CHASE: get in the boat (E). W/S throttle, A/D steer. Steer around floating debris and burning oil. Hold the left mouse button to shoot Helix gunboats (aim for the front: that’s the engine).' },
      { type: 'chase', text: 'Chase the Helix barge', waitForCar: true, waitText: 'Get in the boat (press E at the dock edge)', label: 'the barge', failText: 'The barge got away',
        runner: { type: 'boat', x: 1190, y: 1900, a: -Math.PI / 2, extra: { color: '#4a4f3a', hp: 9999, name: 'Helix barge' } },
        path: RIVER_ROUTE, base: 230, boost: 70, escapeDist: 700, escapeTime: 10, keepScripted: true,
        failIf: () => { const b = cars.find(c => c.type === 'boat' && c === player.car); return b && b.hp <= 0 ? 'Your boat sank' : null; },
        events: [
          { at: 0.06, fn: ch => { ch.dropT = setInterval(() => { if (!Action.S().chase) { clearInterval(ch.dropT); return; } const r = ch.runner; Action.addDebris(r.x + rnd(-15, 15), r.y + 25); }, 2200); } },
          { at: 0.15, fn: () => { for (const [x, y] of [[1150, 1300], [1230, 1100], [1160, 900]]) Action.fire(x, y, 26, { grow: 0, max: 26 }); toast('Burning oil on the water!', 'warn'); } },
          { at: 0.2, fn: () => { Action.spawnBiker(player.x - 30, player.y + 120, { a: -Math.PI / 2, rate: 1.3 }, 'boat'); Action.spawnBiker(player.x + 30, player.y + 160, { a: -Math.PI / 2, rate: 1.3 }, 'boat'); toast('Helix gunboats!', 'warn'); } },
          { at: 0.38, fn: () => {                                  // the broken dam: jump the ramp
            Action.banner('THE DAM!', 'warn', 1.2);
            Action.qte([{ key: 'Space', label: 'SPACE', t: 1.4, text: 'JUMP THE RAMP' }], ok => {
              const b = player.car; if (!b) return;
              if (ok) { b.jump = 1; toast('Airborne!', 'gold'); } else { b.hp -= 60; b.v *= 0.3; shake(10); toast('You slam into the dam wall!', 'warn'); }
            });
          } },
          { at: 0.6, fn: () => { for (let i = 0; i < 6; i++) Action.addDebris(1150 + rnd(0, 90), 500 + i * 60); Action.spawnBiker(1190, 250, { a: Math.PI / 2 }, 'boat'); toast('Another gunboat ahead!', 'warn'); } },
          { at: 0.8, fn: () => { for (const [x, y] of [[1200, 800], [1170, 950]]) Action.fire(x, y, 24, { grow: 0, max: 24 }); } },
        ] },
      { type: 'action', run: (st, done, fail) => {
        const barge = cars.find(c => c.lit && c.mission && c.type === 'boat');
        const me = player.car || player;
        if (barge && dist(barge, me) > 380) { fail('You were too far behind to board the barge'); return; }
        if (player.car) { player.car.v = 0; }
        done();
      } },
      { type: 'qte', text: 'Board the barge!', failText: 'You fell into the water. The barge crew escaped',
        seq: [{ key: 'KeyE', label: 'E', t: 1.3, text: 'GRAB THE RAIL' }, { mash: 'KeyF', label: 'F', count: 7, t: 2.8, text: 'CLIMB ABOARD' }] },
      { type: 'checkpoint', name: 'Barge Crew', pos: [1290, 1060], run: () => {
        const b = player.car; if (b) { player.car = null; b.v = 0; }
        player.x = 1290; player.y = 1060;
        for (const b2 of cars) if (b2.enemyBike && b2.type === 'boat') b2.hp = 0;
      } },
      { type: 'kill', text: 'Fight the barge crew on the jetty', target: [1295, 1050],
        spawns: [['trooper', 1300, 985], ['trooper', 1305, 1120], ['brute', 1290, 1010], ['trooper', 1300, 1095]] },
      { type: 'dialog', lines: [['Veer', '(reading a manifest) “Pump station 7 · dilution schedule”. They’re not dumping by accident. They’re dosing the river on a timetable.'],
                                ['Veer', 'The station’s right here on the bank. I’ll come back after dark.']] },

      // ---------------- ACTION 2: PUMP STATION INFILTRATION ----------------
      { type: 'checkpoint', name: 'Pump Station', pos: [1290, 1180], clock: 23 * 60 + 20, weather: 'fog', run: () => {
        buildFence();
        for (const [x, y] of [[1370, 990], [1450, 1000], [1400, 1090]]) chem(x, y);
        rebuildColliders();
        const g = (x, y, route, a) => spawnEnemy('trooper', x, y, { mission: true, stealth: true, aggro: false, route: route && route.map(([x, y]) => ({ x, y })), a: a || 0, baseA: a, vision: 220 });
        g(1350, 960, [[1350, 960], [1470, 960], [1470, 1040], [1350, 1040]]);
        g(1470, 1130, [[1470, 1130], [1350, 1130]]);
        g(1420, 1040, null, Math.PI);
        g(1340, 1070, null, 0);
        const c1 = Action.spawnCamera(1332, 945, 0.8), c2 = Action.spawnCamera(1482, 1138, -2.3);
        for (const cam of [c1, c2]) Action.addHackable(cam.x + (cam.x < 1400 ? 16 : -16), cam.y + (cam.y < 1000 ? 18 : -18), 'nodes', 'Hack the camera', () => { cam.off = true; cam.stealth = false; cam.det = 0; F().camsHacked = (F().camsHacked || 0) + 1; });
        Action.addSearchlight(1405, 1020, 55, 0.45, 30);
        Action.addSearchlight(1420, 1080, 45, -0.6, 28);
        Action.addHideSpot(1345, 1125);
        Action.setAlarm({ onAlarm: () => { F().stationAlarm = true; for (const [x, y] of [[1600, 1120], [1480, 1190], [1560, 1190], [1350, 1190]]) spawnEnemy('trooper', x, y, { mission: true, aggro: true }); } });
        F().charges = 0;
        for (const [x, y] of [[1370, 1012], [1450, 1022], [1400, 1112]]) {
          const it = { x, y, r: 34 * SCALE.reach + 6, hold: 2, label: 'Plant a charge', fn: () => { Action.S().interact = Action.S().interact.filter(i => i !== it); F().charges++; toast(`Charge planted (${F().charges}/3)`, 'gold'); sfx('pick'); } };
          Action.S().interact.push(it);
        }
      } },
      { type: 'tip', text: 'STEALTH: crouch (C) to stay quiet. Guards’ vision cones show on the ground and the minimap. CAMERAS sweep and can’t be killed: get beside one and hold E to hack it. SEARCHLIGHTS fill a meter if you stand in the beam. Take guards down from behind (E), hide bodies in the dumpster (B). If you’re seen, the alarm brings reinforcements, but you can still finish the job.' },
      { type: 'action', text: 'Plant 3 charges on the chemical tanks', target: { x: 1410, y: 1040, r: 40 },
        run: (st, finish) => { st.finish = finish; },
        tick: st => {
          const n = F().charges || 0, cams = F().camsHacked || 0;
          setObjective(`Plant charges on the chemical tanks (${n}/3) · cameras hacked ${cams}/2${F().stationAlarm ? ' · ALARM RAISED' : ''}`);
          if (n >= 3 && !st.fin) { st.fin = true; st.finish(); }
        } },
      { type: 'dialog', lines: [['Veer', 'Charges set. Thirty seconds on the timer, then this whole place floods.'], ['Tip', 'ESCAPE: get through the fence door on the west side before it seals, and dive into the river. Sprint (Shift) and dodge-roll (Space) through.', 'sys']] },
      { type: 'action', text: 'Escape! Through the door and into the river', target: { x: 1276, y: 1050, r: 18 },
        run: (st, finish, fail) => {
          st.finish = finish; st.t = 0; st.fail = fail;
          Action.startTimer(22, 'The station is flooding', () => fail('The pump station collapsed on you'));
          for (const e of enemies) if (e.mission && !e.dead && !e.camera) { e.stealth = false; e.aggro = true; e.state = 'alert'; }
          explode(1450, 1000); shake(10);
        },
        tick: (st, dt) => {
          st.t += dt;
          // the station collapses behind you: blasts walk from the tanks toward the fence
          if (Math.floor(st.t / 1.3) !== Math.floor((st.t - dt) / 1.3)) { const k = Math.min(1, st.t / 14); explode(lerp(1470, 1335, k) + rnd(-20, 20), 960 + rnd(0, 180)); }
          if (st.t > 9 && !st.doorShut) {                       // the door seals at 9 s
            st.doorShut = true;
            const d = { x: 1316, y: 1030, w: 8, h: 40, hgt: 12, roof: '#8a3a2a', fence: true, door: true, mission: true }; buildings.push(d); rebuildColliders();
            if (player.x > 1320) { st.fail('The door sealed before you got through'); return; }
            toast('The door slammed shut behind you!', 'gold');
          }
          if (player.x < 1300 && dist(player, { x: 1276, y: 1050 }) < 30 && !st.fin) { st.fin = true; Action.stopTimer(); st.finish(); }
        } },
      { type: 'action', run: (st, done) => {
        for (let i = 0; i < 3; i++) explode(1380 + i * 40, 1000 + i * 40);
        buildings.filter(b => b.chem).forEach(b => { b.roof = '#1d1d1d'; b.ruined = true; });
        state.clock = 5 * 60; state.weather = 'clear';
        player.x = 1085; player.y = 1265; CAM.x = player.x; CAM.y = player.y;
        dialog([['Veer', '(gasping, on the west bank) Station 7 is gone. No more barrels.'], ['Baba Jogi', '(radio) Then come to the bridge. The leaders are waiting. The poison was only half the problem.', 'radio']], done);
      } },

      // ---------------- THE COUNCIL (Tragedy of the Commons) ----------------
      { type: 'checkpoint', name: 'The Council', pos: [1085, 1262], clock: 5 * 60 + 5, weather: 'clear' },
      { type: 'cutscene', cleanup: ['elena', 'rhea', 'silas'], keepActors: false, beats: [
        { do: () => Action.fire(1085, 1296, 10, { grow: 0, max: 10 }) },
        { cam: [1085, 1290, 1.7] },
        { actor: { id: 'elena', cast: 'elena', x: 1058, y: 1300, a: 0, label: 'Dr. Elena Cruz', labelColor: '#e46a78' } },
        { actor: { id: 'rhea', cast: 'rhea', x: 1112, y: 1300, a: Math.PI, label: 'Rhea', labelColor: '#d9824a' } },
        { actor: { id: 'silas', cast: 'silas', x: 1085, y: 1325, a: -Math.PI / 2, label: 'Silas Crow', labelColor: '#c9b04a' } },
        { do: next => {
          const f = F(), lines = [];
          if (f.betrayedElena) lines.push(['Dr. Elena Cruz', 'Before we start. Your “clean water” came with river water in half the barrels, Veer. Two of my patients got worse.'],
                                          ['Veer', 'I know. I was wrong. I’m here to fix the river, not to lie about it.'],
                                          ['Dr. Elena Cruz', 'We’ll see. I’m a doctor. I believe in second chances… sometimes.']);
          else if (trustOf('mercy') >= 60) lines.push(['Dr. Elena Cruz', 'Veer kept his word with the water. That’s why I came.']);
          if (f.rheaBetrayed) lines.push(['Rhea "Iron" Dutta', 'I’m only here because the river is bigger than my grudge. Don’t talk to me, engineer.']);
          else if (trustOf('ironside') >= 60) lines.push(['Rhea "Iron" Dutta', 'Helix is poisoning our water. Veer blew their station. Let’s not waste what’s left.']);
          lines.push(['Silas Crow', 'Charming. So: the river gives back fifteen a day. We take what we take. What could go wrong?'],
                     ['Veer', 'Everything, if we all take a little more. Four days. Everyone chooses how much to pump: low, medium or high.'],
                     ['Tip', 'TRAGEDY OF THE COMMONS: river health 100, +15 per day. Each colony pumps Low (5), Medium (10) or High (20), and keeps what it takes. If the river hits 0 it dies: every colony loses 50 and the riverbed dries for the rest of the game. The others choose by their strategy and their trust in you.', 'sys']);
          dialog(lines, next);
        } },
      ] },
      { type: 'action', run: (st, done) => { commonsDay(1, done); } },
      { type: 'action', run: (st, done) => {
        unlock('commons'); F().riverDeadCh3 = GT.riverDead;
        dialog(GT.riverDead
          ? [['Veer', 'It’s gone. A dry bed of cracked mud. Everyone took a little more than their share, and together we killed it.'], ['Silas Crow', 'Well. Dust storms are good for business. Masks, mostly.']]
          : [['Veer', 'The river held. Nobody was forced to hold back, but enough of us did.'], ['Dr. Elena Cruz', 'Then there’s hope for this city yet.']], done);
      } },
      { type: 'passed', title: 'Chapter 3 · The Poisoned River',
        stats: () => { const f = F(); return [['Pump station alarm', f.stationAlarm ? 'Raised' : 'Never raised (ghost)'], ['Cameras hacked', `${f.camsHacked || 0} / 2`], ['River health', GT.riverDead ? 'DEAD' : GT.river.toFixed(0)], ['Lakeside resources', GT.res.lakeside]]; },
        rewards: () => [GT.riverDead ? 'The riverbed is dry: dust storms from now on, and every colony lost 50' : 'The river survives: clean water keeps flowing', 'Codex: Tragedy of the Commons'],
        onDone: () => { $('hud-river').hidden = true; player.x = 950; player.y = 1200; CAM.x = player.x; CAM.y = player.y; } },
    ],
  };
  CHAPTERS[3] = MissionManager.compile(CH3);
})();
