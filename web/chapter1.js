/* =====================================================================
   CHAPTER 1 - "FIRST CONTACT"  (Mercy Hospital, Dr. Elena Cruz)
   Game theory: ONE-SHOT PRISONER'S DILEMMA
     Action 1 "Turret Run"     : Tara drives the escort jeep, Veer mans the
                                 turret; protect the water truck (health bar);
                                 burning-bus QTE on the way.
     Action 2 "Siege at Mercy" : climb + zipline across rooftops to remove 3
                                 snipers (takedown or shoot), then a courtyard
                                 gunfight beside Mercy guards (ally AI).
     Decision                  : sealed crates. Elena plays Generous Tit-for-Tat,
                                 so she cooperates on the first move.
     Consequences (GT.flags)   : truckHealth, elenaDeal, betrayedElena,
                                 doctorAlly -> read by later chapters.
   ===================================================================== */
'use strict';
(() => {
  const F = () => MissionManager.flags();
  // Road route (map px) from Lakeside to the Mercy plaza. x = 715 (east lane): the Lakeside hall juts into the west lane.
  const ROUTE = [[715, 2000], [715, 1700], [715, 1200], [715, 760], [650, 700], [480, 700], [480, 640]].map(([x, y]) => ({ x, y }));

  /** The escort jeep: Tara keeps station 80 px behind the water truck. */
  const followTruck = truck => (c, dt) => {
    if (truck.hp <= 0) return [-0.5, 0];
    const g = 85 * SCALE.vdim, back = { x: truck.x - Math.cos(truck.a) * g, y: truck.y - Math.sin(truck.a) * g };
    const d = dist(c, back), want = Math.atan2(back.y - c.y, back.x - c.x);
    let thr = d > 70 * SCALE.vdim ? 1 : d > 25 * SCALE.vdim ? 0.25 : -0.6;
    if (c.v > truck.v + 60 * SCALE.veh && d < 140 * SCALE.vdim) thr = -0.4;
    return [thr, clamp(((want - c.a + 9.42) % 6.283 - 3.14) * 2, -1, 1)];
  };
  /** Buildings whose roof overlooks the convoy road (x = 700) between two y values. */
  const roofsAlongRoad = (y0, y1, n) => buildings.filter(b => !b.land && !b.tank && !b.crate && !b.stall && b.w > 50 && b.h > 50 && b.y > y0 && b.y < y1 &&
    (Math.abs(b.x - 754) < 40 || Math.abs(b.x + b.w - 646) < 40)).slice(0, n);

  const CH1 = {
    label: 'Chapter 1', title: 'First Contact', sub: 'Mercy Hospital. A one-shot deal with a stranger.',
    steps: [
      { type: 'setup', clock: 8 * 60, weather: 'clear', pos: [470, 1990], trustHud: true, run: () => { MissionManager.startClock(); Action.resetAllies(); } },

      // ---------------- INTRO ----------------
      { type: 'cutscene', cleanup: ['tara', 'jogi'], beats: [
        { cam: [480, 1990, 1.4] },
        { actor: { id: 'tara', cast: 'tara', x: 520, y: 1985, a: Math.PI, label: 'Tara', labelColor: '#2d7fd6' } },
        { actor: { id: 'jogi', cast: 'jogi', x: 440, y: 1960, a: 0, label: 'Baba Jogi', labelColor: '#c9b48a' } },
        { say: [['Dr. Elena Cruz', '(radio) Lakeside, this is Mercy Hospital. Our filters failed. Patients are drinking river water and getting sicker.', 'radio'],
                ['Dr. Elena Cruz', '(radio) Water for medicine. Antibiotics, bandages, whatever you need. Sealed crates, both ways.', 'radio'],
                ['Tara "Sparks" Nair', 'Or we send half, keep the rest, and she never finds out.'],
                ['Baba Jogi', 'And if she has the same idea, Tara?'],
                ['Veer', 'Load the truck. We decide at the loading bay. Tara, you drive the jeep. I’ll take the gun.']] },
      ] },

      // ---------------- ACTION 1: TURRET RUN ----------------
      { type: 'checkpoint', name: 'Turret Run', pos: [700, 2080], run: () => {
        const truck = spawnCar('tanker', 715, 1990, -Math.PI / 2, { mission: true, escort: true, color: '#3c6a8a', path: ROUTE.slice(1).map(p => ({ ...p })), wp: 0 });   // (the first point is where it parks)
        truck.maxHp = truck.hp = 420; truck.wpR = 55;
        const jeep = spawnCar('jeep', 715, 2080, -Math.PI / 2, { mission: true, npc: true, lit: true, turret: true });
        jeep.hp = 700;
        Action.turretRide(jeep, null, { driver: 'tara' });
        jeep.ai = followTruck(truck);
        F().truckHealth = 1;
      } },
      { type: 'tip', text: 'TURRET RUN: Tara drives, you shoot. Aim with the mouse and hold click to fire; release before the gun overheats. Keep the water truck alive: it stops whenever scavengers block the road. If it drops below 30%, less water reaches Mercy.' },
      { type: 'action', text: 'Protect the water truck on the way to Mercy Hospital',
        target: () => cars.find(c => c.type === 'tanker' && c.escort),
        run: (st, done, fail) => {
          st.truck = cars.find(c => c.type === 'tanker' && c.escort);
          st.jeep = cars.find(c => c.turret && c.mission);
          st.finish = done; st.fail = fail; st.stage = 0; st.bikeT = 6;
        },
        tick: (st, dt) => {
          const t = st.truck, j = st.jeep; if (!t || st.over) return;
          if (t.hp <= 0) { st.over = true; st.fail('The water truck was destroyed'); return; }
          if (j.hp <= 0) { st.over = true; st.fail('The escort jeep was destroyed'); return; }
          const pct = t.hp / t.maxHp;
          setObjective(`Protect the water truck: ${Math.round(pct * 100)}%${pct < 0.3 ? ' (Mercy will get less water)' : ''}`);
          t.halt = enemies.some(e => !e.dead && !e.roof && !e.mount && !e.fly && dist(e, t) < 190);
          // --- scripted waves keyed to the truck's progress (waypoint index / position) ---
          if (st.stage === 0 && t.y < 1850) {
            st.stage = 1;
            for (const b of roofsAlongRoad(1350, 1750, 2)) spawnEnemy('sniper', b.x + b.w / 2, b.y + b.h / 2, { mission: true, roof: b, aggro: true, dmg: 7, vision: 500 });
            for (const [x, y] of [[640, 1560], [740, 1520], [735, 1600]]) spawnEnemy('scav', x, y, { mission: true, aggro: true });
            toast('Scavengers on the rooftops!', 'warn');
          }
          if (st.stage === 1 && t.y < 1420) {                              // the burning bus drops off the overpass
            st.stage = 2; setBannerSafe('BUS!');
            Action.qte([{ key: 'KeyD', label: 'D', t: 1.3, text: 'SWERVE RIGHT' }], ok => {
              const by = t.y - 150;
              buildings.push({ x: 658, y: by - 22, w: 32, h: 70, hgt: 22, roof: '#7a3a1a', ruined: true, mission: true }); rebuildColliders();
              Action.fire(672, by, 20, { grow: 0.3, max: 24 }); explode(674, by); shake(14);
              if (ok) toast('Tara swerves past the burning bus!', 'gold');
              else { t.hp -= t.maxHp * 0.2; j.hp -= 120; damagePlayer(15); toast('The bus clips the convoy!', 'warn'); }
            });
          }
          if (st.stage === 2 && t.y < 1300) {
            st.stage = 3;
            for (const [x, y] of [[640, 1060], [745, 1010], [640, 950], [745, 900]]) spawnEnemy('scav', x, y, { mission: true, aggro: true });
            for (const b of roofsAlongRoad(850, 1150, 2)) spawnEnemy('sniper', b.x + b.w / 2, b.y + b.h / 2, { mission: true, roof: b, aggro: true, dmg: 7, vision: 500 });
          }
          // bikers harass from behind every so often
          st.bikeT -= dt;
          if (st.bikeT <= 0 && st.stage >= 1 && t.wp < t.path.length - 2) { st.bikeT = 11; Action.spawnBiker(j.x + 30, j.y + 220, { a: -Math.PI / 2 }); Action.spawnBiker(j.x - 30, j.y + 260, { a: -Math.PI / 2 }); toast('Bikes behind us!', 'warn'); }
          const last = t.path[t.path.length - 1];
          if (t.wp >= t.path.length || (t.wp >= t.path.length - 2 && dist(t, last) < 90)) {      // parked at the loading bay
            st.over = true; t.v = 0; t.path = null;
            F().truckHealth = pct;
            for (const e of enemies) if (e.mount || e.roof) { e.dead = true; e.hidden = true; }
            st.finish();
          }
        } },
      { type: 'action', run: (st, done) => {
        const pct = F().truckHealth;
        Action.S().allies.length = 0;
        const g = player.gunner; player.gunner = null; if (g && g.car) { g.car.npc = true; g.car.ai = null; g.car.v = 0; }
        player.x = 520; player.y = 680; collide(player, player.r);
        dialog(pct >= 0.3
          ? [['Tara "Sparks" Nair', 'Truck’s in one piece. Mostly.'], ['Dr. Elena Cruz', '(radio) I see you. But we have a problem: snipers on the rooftops. Nobody crosses the courtyard.', 'radio']]
          : [['Tara "Sparks" Nair', 'Half the tank leaked out on the road. That’s all we’ve got.'], ['Dr. Elena Cruz', '(radio) Whatever you brought, we need it. But snipers have the courtyard pinned.', 'radio']], done);
      } },

      // ---------------- ACTION 2: SIEGE AT MERCY ----------------
      { type: 'checkpoint', name: 'Siege at Mercy', pos: [280, 520], run: () => {
        const main = buildings.find(b => b.cross), annex = buildings.find(b => b.land && b.x === 590 && b.y === 300);
        // the third sniper sits on a roof across the east road, if there is one close enough
        const east = buildings.filter(b => !b.land && !b.tank && b.w > 50 && b.h > 50 && b.x > 740 && b.x < 900 && b.y > 250 && b.y < 560)[0] || annex;
        Action.addClimb(main, 290, 420, 'Climb the fire escape');
        Action.addZip(main, { x: 550, y: 330 }, annex, { x: 605, y: 330 });
        if (east !== annex) Action.addZip(annex, { x: 650, y: 320 }, east, { x: east.x + 14, y: clamp(320, east.y + 14, east.y + east.h - 14) });
        const sn = (b, x, y, a) => spawnEnemy('sniper', x, y, { mission: true, roof: b, aggro: false, baseA: a, a, vision: 430, dmg: 22, sniperOfMercy: true });
        sn(main, 520, 420, Math.PI / 2);                              // watching the courtyard (south)
        sn(annex, 625, 395, Math.PI / 2);
        sn(east, east.x + east.w / 2, east.y + east.h / 2, Math.PI * 0.75);
        F().snipersStart = true;
      } },
      { type: 'tip', text: 'SNIPERS: a red laser means a sniper is locking on. Break line of sight or dodge. Better: hold E at the fire escape to climb, sneak BEHIND a sniper (their cone faces the courtyard) and press E for a silent takedown. Use E on the orange zipline anchor to cross to the next roof.' },
      { type: 'action', text: 'Take out the 3 rooftop snipers', run: (st, done) => { st.finish = done; },
        tick: st => {
          const left = enemies.filter(e => e.sniperOfMercy && !e.dead).length;
          setObjective(`Take out the rooftop snipers (${left} left)`);
          if (!left && !st.fin) { st.fin = true; st.finish(); }
        } },
      { type: 'dialog', lines: [['Dr. Elena Cruz', '(radio) The snipers are down! But they’re coming through the gates. My guards are with you, Veer!', 'radio'], ['Tip', 'ALLIES: Mercy guards fight beside you and take cover on their own. If one goes down, hold E next to them to revive. G = focus fire on the enemy nearest your mouse.', 'sys']] },
      { type: 'checkpoint', name: 'Courtyard', pos: [430, 520], run: () => {
        player.roof = null;
        Action.resetAllies();
        for (const [x, y, n] of [[400, 480, 'Guard Ana'], [470, 470, 'Guard Rafi'], [540, 480, 'Guard Mei']])
          Action.addAlly({ name: n, x, y, cfg: CR.enemyConfig('guard', 'mercy'), dmg: 10 });
        for (const [x, y] of [[360, 600], [470, 600], [580, 600]]) buildings.push({ x: x - 18, y: y - 18, w: 36, h: 36, hgt: 14, roof: '#5a4d3a', crate: true, mission: true });
        rebuildColliders();
      } },
      { type: 'kill', text: 'Clear the hospital courtyard', target: [470, 560],
        spawns: [['scav', 300, 690], ['scav', 360, 700], ['scav', 640, 690], ['scav', 690, 640], ['brute', 700, 560], ['scav', 250, 620], ['scav', 560, 700], ['brute', 250, 560]],
        failIf: () => { const al = Action.S().allies; return al.length && al.every(a => a.dead) ? 'All the Mercy guards fell' : null; } },

      // ---------------- GAME THEORY DECISION ----------------
      { type: 'cutscene', cleanup: ['elena'], beats: [
        { do: () => Action.resetAllies() },
        { cam: [470, 520, 1.45] },
        { actor: { id: 'elena', cast: 'elena', x: 500, y: 500, a: Math.PI, label: 'Dr. Elena Cruz', labelColor: '#e46a78' } },
        { say: [['Dr. Elena Cruz', 'Thank you. Now the part neither of us can see: the loading bay.'],
                ['Dr. Elena Cruz', 'My crates go on your truck, your barrels come off it. Sealed. We check tomorrow, when it’s too late to take anything back.'],
                ['Veer', '(Full water, or cut it with river water? She’d never know until tomorrow… and she might be thinking the same thing.)']] },
      ] },
      { type: 'action', run: (st, done) => {
        tradeDecision({
          game: 'PD_OneShot', colony: 'mercy', ch: 1, eyebrow: 'Chapter 1 · One-shot Prisoner’s Dilemma',
          title: 'The sealed shipment', prompt: 'You both choose at the same moment. You can’t see Elena’s crates, and she can’t see your barrels.',
          c0: 'Full water', c1: 'Diluted water', s0: 'All 40 barrels, clean.', s1: 'Half the barrels are river water. Lakeside keeps the rest.',
          note: r => {
            const low = F().truckHealth < 0.3;
            return 'Defect is a strictly DOMINANT strategy in a one-shot game: 5 > 3 if Elena cooperates, and 1 > 0 if she defects. So rational players meet at (Defect, Defect), the only Nash equilibrium, even though (Cooperate, Cooperate) gives both players more. That outcome is PARETO OPTIMAL, and the equilibrium is not. ' +
              'Elena plays Generous Tit-for-Tat, which always cooperates on the first move.' + (low ? ' Because the truck arrived below 30%, Mercy received less water whatever you chose (−10 to Mercy).' : '');
          },
        }, r => {
          unlock('pd'); unlock('nash'); unlock('pareto');
          const f = F(); f.elenaDeal = [r.p, r.a]; f.betrayedElena = r.p === D;
          if (f.truckHealth < 0.3) GT.res.mercy -= 10;
          if (r.p === C && r.a === C) { f.doctorAlly = true; for (const [x, y] of [[520, 1990], [450, 1940], [600, 1960]]) pickups.push({ x, y }); }
          const lines = {
            '0,0': [['Dr. Elena Cruz', 'Full crates on both sides. You kept your word, Veer. That’s rarer than antibiotics these days.'], ['Dr. Elena Cruz', 'Take these medkits. And when you need a doctor in the field, call me.']],
            '1,0': [['Dr. Elena Cruz', 'The seals look fine. We’ll open everything tomorrow.'], ['Veer', '(She sent everything. I sent her river water. She’ll find out.)']],
            '0,1': [['Dr. Elena Cruz', 'I… held some of the medicine back. I’m sorry. I didn’t know you.'], ['Veer', 'Now you do.']],
            '1,1': [['Dr. Elena Cruz', 'Short on both sides. We deserve each other.']],
          }[r.p + ',' + r.a];
          dialog(lines, done);
        });
      } },

      // ---------------- OUTRO ----------------
      { type: 'cutscene', beats: [
        { cam: [470, 540, 1.2] },
        { say: [['Radio', '(every frequency at once) …', 'radio'],
                ['Director Kane', '(radio) Touching. But trust is a luxury, Mr. Malhotra.', 'radio'],
                ['Director Kane', '(radio) Helix offers something better: certainty. Kneel, and nobody ever has to wonder what’s in the crates again.', 'radio'],
                ['Veer', 'He was listening. The whole time.']] },
      ] },
      { type: 'passed', title: 'Chapter 1 · First Contact',
        stats: () => { const f = F(); const [p, a] = f.elenaDeal || [0, 0]; return [['Water truck', Math.round((f.truckHealth || 0) * 100) + '%'], ['Your move', p === C ? 'Full water (Cooperate)' : 'Diluted (Defect)'], ['Elena’s move', a === C ? 'Real medicine (Cooperate)' : 'Empty boxes (Defect)'], ['Trust: Mercy', trustOf('mercy').toFixed(0)]]; },
        rewards: () => { const f = F(); return [f.doctorAlly ? 'Medkits delivered to Lakeside · Dr. Elena will send a field medic' : 'No medkits', f.betrayedElena ? 'Elena will find out about the diluted water in Chapter 3' : 'Mercy remembers you kept your word', 'Codex: Prisoner’s Dilemma, Nash Equilibrium, Pareto Optimality']; },
        onDone: () => { player.x = 700; player.y = 1250; CAM.x = player.x; CAM.y = player.y; if (!cars.some(c => c.hp > 0 && dist(c, player) < 120 && !c.npc)) spawnCar('jeep', 740, 1280, 0); } },
    ],
  };
  // A small helper so the bus moment gets a big banner without depending on step order
  function setBannerSafe(t) { Action.banner(t, 'warn', 1.2); }

  CHAPTERS[1] = MissionManager.compile(CH1);
})();
