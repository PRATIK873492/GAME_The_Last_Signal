/* =====================================================================
   CHAPTER 5 - "STAG HUNT"  (Helix depot, Dead Zone)
   Game theory: STAG HUNT (coordination under strategic uncertainty)
     Partner choice         : pick one colony leader to raid with. They fight
                              beside you as an ally for the whole chapter.
     Action 1 "Night Raid"  : stealth approach to the depot: sweeping cameras
                              (hack them), searchlights, patrolling troopers.
                              An alarm brings drones but does not fail the job.
     Action 2 "The Vault"   : clear the drone swarm guarding the core vault.
     Decision               : STAG (carry the core together) or HARE (grab
                              crates alone). The partner hunts the stag only if
                              their trust in you is >= 60: the mixed-equilibrium
                              belief threshold q* = 0.6 of this matrix.
     Consequences (GT)      : GT.core -> +30 to the Chapter 7 restart, then a
                              defence of the core carrier against Helix waves.
                              Hare -> a short fighting escape with the crates.
   ===================================================================== */
'use strict';
(() => {
  const F = () => MissionManager.flags();
  const LEADER = { mercy: 'elena', ironside: 'rhea', crows: 'silas' };
  const DEPOT = { x: 2255, y: 960 };

  const CH5 = {
    label: 'Chapter 5', title: 'Stag Hunt', sub: 'A Helix depot, a generator core, and a partner you have to trust.',
    steps: [
      { type: 'setup', clock: 21 * 60, pos: [1700, 1010], trustHud: true, weather: 'fog', run: () => { MissionManager.startClock(); Action.resetAllies(); } },
      { type: 'cutscene', cleanup: ['tara', 'jogi'], beats: [
        { cam: [1700, 1000, 1.5] },
        { actor: { id: 'tara', cast: 'tara', x: 1675, y: 1030, a: 0, label: 'Tara', labelColor: '#2d7fd6' } },
        { actor: { id: 'jogi', cast: 'jogi', x: 1730, y: 1030, a: Math.PI, label: 'Baba Jogi', labelColor: '#4fb3a9' } },
        { say: [['Tara "Sparks" Nair', 'Helix keeps a generator core in the Dead Zone depot. Plug that into the station and the restart gets a massive boost.'],
                ['Baba Jogi', 'It weighs as much as a small car. One person cannot carry it. Two people who trust each other can.'],
                ['Veer', 'And one person alone can grab crates and run. Safe, and small.'],
                ['Tip', 'STAG HUNT: the core (Stag) pays off hugely, but only if BOTH of you go for it. Crates (Hare) are safe whatever your partner does. Pick a partner who trusts you.', 'sys']] },
      ] },
      { type: 'action', text: 'Choose your partner', run: (st, done) => {
        const cards = AI_COLS.map(c => ({ k: `Trust ${trustOf(c).toFixed(0)}`, t: COLONY_INFO[c].leader, s: `${COLONY_INFO[c].name} · ${hostility(c)}★ hostility${c === 'ironside' && F().rheaBetrayed ? ' · refuses to come' : ''}` }));
        decision({ eyebrow: 'Chapter 5 · Choose your partner', title: 'Who covers your back?', prompt: 'Your partner goes for the core only if they believe you will too. Trust is that belief.', cards, timeout: 0 },
          i => {
            let ally = AI_COLS[i];
            if (ally === 'ironside' && F().rheaBetrayed) { toast('Rhea hangs up on you. Elena comes instead.', 'warn'); ally = 'mercy'; }
            GT.ally = ally; F().ch5ally = ally;
            toast(COLONY_INFO[ally].leader + ' joins the raid.', 'gold'); done();
          });
      } },

      // ---------------- ACTION 1: NIGHT RAID (stealth) ----------------
      { type: 'checkpoint', name: 'Night Raid', pos: [1990, 1180], clock: 22 * 60 + 30, weather: 'fog', run: () => {
        Action.resetAllies();
        const c = GT.ally || 'mercy', id = LEADER[c];
        Action.addAlly({ id, name: COLONY_INFO[c].leader, x: 1960, y: 1200, dmg: 13, cfg: CR.CAST[id] });
        const g = (x, y, route, a) => spawnEnemy('trooper', x, y, { mission: true, stealth: true, aggro: false, route: route && route.map(([x, y]) => ({ x, y })), a: a || 0, baseA: a, vision: 220 });
        g(2120, 1120, [[2120, 1120], [2330, 1120]]);
        g(2350, 1060, [[2350, 1060], [2350, 850]]);
        g(2150, 860, null, Math.PI / 2);
        g(2200, 1060, null, 0);
        const c1 = Action.spawnCamera(2110, 1000, 0.3), c2 = Action.spawnCamera(2380, 900, Math.PI);
        for (const cam of [c1, c2]) Action.addHackable(cam.x + (cam.x < 2250 ? -18 : 18), cam.y + 20, 'wave', 'Hack the camera', () => { cam.off = true; cam.stealth = false; cam.det = 0; F().ch5cams = (F().ch5cams || 0) + 1; });
        Action.addSearchlight(2250, 1000, 60, 0.5, 30);
        Action.addHideSpot(2080, 1150); Action.addHideSpot(2390, 1150);
        Action.setAlarm({ onAlarm: () => { F().depotAlarm = true; for (const [x, y] of [[2400, 800], [2420, 1180], [2100, 780]]) spawnEnemy('drone', x, y, { mission: true, aggro: true }); } });
      } },
      { type: 'tip', text: 'STEALTH: crouch (C), take troopers down from behind (E), hack cameras (hold E beside them). Your partner holds fire until the alarm goes off. G gives your partner orders.' },
      { type: 'action', text: 'Clear the depot yard', target: { x: 2255, y: 1000, r: 60 },
        run: (st, finish) => { st.finish = finish; },
        tick: st => {
          const left = enemies.filter(e => e.mission && !e.dead && !e.camera && e.type === 'trooper').length;
          setObjective(`Clear the depot yard (${left} troopers left) · cameras hacked ${F().ch5cams || 0}/2${F().depotAlarm ? ' · ALARM RAISED' : ''}`);
          if (!left && !st.fin) { st.fin = true; st.finish(); }
        } },

      // ---------------- ACTION 2: THE VAULT ----------------
      { type: 'dialog', lines: [['Veer', 'Yard’s clear. The vault door is open and… something is humming inside.'], ['Tara "Sparks" Nair', '(radio) Helix drone nest! Take them down before they call the whole Dead Zone.', 'radio']] },
      { type: 'checkpoint', name: 'The Vault', pos: [2200, 1000] },
      { type: 'kill', text: 'Destroy the drone nest guarding the core', target: [2255, 960],
        spawns: [['drone', 2200, 850], ['drone', 2320, 900], ['drone', 2180, 1080], ['drone', 2330, 1100], ['drone', 2250, 780], ['trooper', 2360, 960]] },

      // ---------------- DECISION: STAG OR HARE ----------------
      { type: 'cutscene', beats: [
        { cam: [DEPOT.x, DEPOT.y, 1.6] },
        { say: [['Veer', 'There it is. The core. Still warm.'],
                ['Veer', 'Crates of rations by the door, too. I could just grab those and go.'],
                ['Tip', 'You both decide at the same moment, without talking. Your partner believes you will go for the core with probability = their trust / 100.', 'sys']] },
      ] },
      { type: 'action', text: 'The core or the crates?', run: (st, done) => {
        const ally = GT.ally || 'mercy', m = MATRICES.StagHunt;
        decision({ eyebrow: 'Chapter 5 · Stag Hunt', title: 'The core or the crates?', prompt: `${COLONY_INFO[ally].leader} is at the other end of the vault. Carrying the core takes both of you. Crates are safe to grab alone.`,
          cards: [{ k: 'Stag', t: m.a0, s: 'Huge payoff, only if your partner commits too.' }, { k: 'Hare', t: m.a1, s: 'Safe, small payoff whatever they do.' }], timeout: 1 },
          choice => {
            // Partner hunts the stag iff belief (trust) >= 0.6, the mixed-equilibrium threshold of this matrix.
            const belief = trustOf(ally) / 100, a = belief >= 0.6 ? C : D;
            const r = recordRound(ally, choice, a, 'StagHunt', 5);
            GT.core = r.p === C && r.a === C; F().stag = [r.p, r.a];
            unlock('stag');
            showMatrix('StagHunt', r, COLONY_INFO[ally].short,
              `Your partner believed you would hunt the stag with probability ${belief.toFixed(2)}. Hunting the stag is their best response only when that belief is at least 0.60 (the mixed-equilibrium threshold). (Stag, Stag) is payoff-dominant; (Hare, Hare) is risk-dominant: safer when you are unsure of each other.`,
              () => {
                const L = COLONY_INFO[ally].leader;
                dialog(GT.core ? [['Veer', 'On three. One… two…'], [L, 'Lift!'], ['Veer', 'The core is ours. Trust built over months paid off in one moment.']]
                  : r.p === C ? [['Veer', 'I’m at the core. Where are you?'], [L, '(radio) Grabbed the crates and ran. Sorry, Veer. I wasn’t sure you’d show.', 'radio'], ['Veer', 'I went for the core alone and came back with nothing.']]
                  : r.a === C ? [[L, '(radio) Veer? I’m at the core… you’re at the crates, aren’t you.', 'radio'], ['Veer', 'Safe, small, and I left my partner standing alone.']]
                  : [['Veer', 'Crates. Safe, small, and the core stays with Helix.']], done);
              });
          });
      } },

      // ---------------- CONSEQUENCES ----------------
      { type: 'checkpoint', name: 'Extraction', pos: [2230, 1010], silent: true },
      { type: 'action', text: 'Protect the core while Tara brings the truck', run: (st, done) => {
        if (!GT.core) { done(); return; }
        setObjective('Protect the core while Tara brings the truck');
        Action.defend({ target: { x: 2225, y: 935, w: 50, h: 40, name: 'the generator core' }, hp: 450, barricades: 3, turrets: [[2300, 1020]],
          waves: [[['drone', 2450, 850], ['drone', 2450, 1080], ['trooper', 2060, 780]],
                  [['trooper', 2460, 960], ['trooper', 2060, 1180], ['drone', 2250, 720], ['brute', 2450, 1150]]],
          onWin: () => { toast('Tara’s truck is here. The core is loaded!', 'gold'); done(); },
          onLose: () => MissionManager.fail('Helix destroyed the generator core') });
      } },
      { type: 'action', text: 'Fight your way out with the crates', run: (st, done) => {
        if (GT.core) { done(); return; }
        st.list = [['trooper', 2050, 900], ['trooper', 2050, 1120], ['drone', 2000, 1000], ['brute', 1980, 1060]].map(([t, x, y]) => spawnEnemy(t, x, y, { mission: true, aggro: true }));
        st.finish = done;
      }, tick: st => {
        if (!st.list || st.fin) return;
        const left = st.list.filter(e => !e.dead).length;
        setObjective(`Fight your way out with the crates (${left} left)`);
        if (!left) { st.fin = true; GT.res.lakeside += 10; st.finish(); }
      } },
      { type: 'passed', title: 'Chapter 5 · Stag Hunt',
        stats: () => { const f = F(), [p, a] = f.stag || [1, 1]; return [['Partner', COLONY_INFO[GT.ally || 'mercy'].leader], ['Depot alarm', f.depotAlarm ? 'Raised' : 'Never raised (ghost)'], ['You', p ? 'Hare (crates)' : 'Stag (core)'], ['Partner chose', a ? 'Hare (crates)' : 'Stag (core)'], ['Generator core', GT.core ? 'SECURED' : 'Left behind']]; },
        rewards: () => [GT.core ? 'Generator core: +30 to the Chapter 7 restart' : 'Crates: +10 Lakeside resources', 'Codex: Stag Hunt, Risk vs Payoff Dominance'],
        onDone: () => { Action.resetAllies(); player.x = 1700; player.y = 1010; CAM.x = player.x; CAM.y = player.y; } },
    ],
  };
  CHAPTERS[5] = MissionManager.compile(CH5);
})();
