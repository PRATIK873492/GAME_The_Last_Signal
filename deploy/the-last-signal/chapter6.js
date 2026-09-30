/* =====================================================================
   CHAPTER 6 - "KANE'S OFFER"  (three relay towers across the city)
   Game theory: INCOMPLETE INFORMATION (Bayesian updating) + SIGNALING
     Broadcast              : Kane offers every colony the same bribe.
     Tower 1 "Static"       : hack the relay under drone fire.
     Tower 2 "Rooftop"      : climb the fire escape; a Helix sniper covers
                              the relay dish from the next roof.
     Tower 3 "Listening Post": a Helix-held post; stealth or fight, then
                              hack the uplink before the timer runs out.
     Decision               : the existing bayesScreen(): prior from trust and
                              history, posterior from the intercepts, then an
                              honest or forged signal to the city.
     Consequences (GT)      : GT.traitor[colony] (read by the Chapter 7
                              restart), plus a Helix retaliation squad.
   ===================================================================== */
'use strict';
(() => {
  const F = () => MissionManager.flags();
  const T1 = { x: 700, y: 700 }, T3 = { x: 1650, y: 1700 };
  // a tall rooftop near the middle tower, found at run time (the map is procedural around fixed landmarks)
  const pickRoofs = () => {
    const cand = buildings.filter(b => !b.land && !b.tank && !b.crate && !b.stall && !b.station && b.w > 70 && b.h > 70 && b.x > 1350 && b.x < 1900 && b.y > 480 && b.y < 900)
      .sort((a, b) => Math.hypot(a.x - 1650, a.y - 700) - Math.hypot(b.x - 1650, b.y - 700));
    return [cand[0], cand.find(b => b !== cand[0] && Math.abs(b.x - cand[0].x) + Math.abs(b.y - cand[0].y) < 400) || cand[1]];
  };

  const CH6 = {
    label: 'Chapter 6', title: "Kane's Offer", sub: 'Everyone got the same radio call. Nobody knows who said yes.',
    steps: [
      { type: 'setup', clock: 17 * 60, pos: [520, 760], trustHud: true, run: () => { state.weather = GT.riverDead ? 'dust' : 'clear'; MissionManager.startClock(); Action.resetAllies(); } },
      { type: 'cutscene', cleanup: ['kane'], beats: [
        { cam: [1875, 1010, 1.2] },
        { actor: { id: 'kane', cast: 'kane', x: 1875, y: 1060, a: -Math.PI / 2, label: 'Director Kane', labelColor: '#a898ff' } },
        { say: [['Director Kane', '(every radio in the city) Veer Malhotra. Helix is prepared to be generous. Power for Lakeside, only Lakeside. All you need to do is… hold back on restart day.', 'radio'],
                ['Director Kane', '(radio) I have made the same offer to the others. Ask yourself which of them said yes.', 'radio']] },
        { cam: [700, 740, 1.4] },
        { say: [['Baba Jogi', '(radio) Three old relay towers still carry Helix traffic. Tap all three and we can listen to the replies.', 'radio'],
                ['Veer', 'Then I climb. Whoever took the bribe will have answered.'],
                ['Tip', 'INCOMPLETE INFORMATION: you cannot see who accepted. You will start from a belief (based on trust and history) and update it with evidence, using Bayes’ rule.', 'sys']] },
      ] },

      // ---------------- TOWER 1: STATIC ----------------
      { type: 'checkpoint', name: 'Relay Tower 1', pos: [560, 760] },
      { type: 'action', text: 'Hack relay tower 1 (hold E at the dish)', target: { x: T1.x, y: T1.y, r: 30 },
        run: (st, finish) => {
          st.finish = finish;
          markers = [{ x: T1.x, y: T1.y, color: '#a898ff' }];
          Action.addHackable(T1.x, T1.y, 'nodes', 'Tap the relay', () => { markers = []; F().towers = 1; toast('Relay 1 tapped (1/3)', 'gold'); st.hacked = true; });
          st.list = [['drone', 850, 600], ['drone', 850, 820], ['scav', 600, 560]].map(([t, x, y]) => spawnEnemy(t, x, y, { mission: true, aggro: true }));
        },
        tick: st => {
          const left = st.list.filter(e => !e.dead).length;
          setObjective(st.hacked ? `Clear the drones (${left} left)` : `Hack relay tower 1 (hold E at the dish)${left ? ` · ${left} hostiles` : ''}`);
          if (st.hacked && !left && !st.fin) { st.fin = true; st.finish(); }
        } },

      // ---------------- TOWER 2: ROOFTOP ----------------
      { type: 'checkpoint', name: 'Relay Tower 2', pos: [1500, 1000], clock: 18 * 60 },
      { type: 'action', text: 'Climb to relay tower 2 on the rooftop', run: (st, finish) => {
        const [b1, b2] = pickRoofs();
        st.finish = finish;
        if (!b1) { toast('Relay 2 tapped from the street.', 'gold'); F().towers = 2; finish(); return; }
        const base = { x: b1.x + b1.w / 2, y: b1.y + b1.h + 16 };
        st.b1 = b1; st.base = base;
        Action.addClimb(b1, base.x, base.y, 'Climb to the relay');
        markers = [{ x: base.x, y: base.y, color: '#a898ff' }];
        if (b2) st.sniper = spawnEnemy('sniper', b2.x + b2.w / 2, b2.y + b2.h / 2, { mission: true, roof: b2, aggro: true });
        const dish = { x: b1.x + b1.w / 2, y: b1.y + b1.h / 2 };
        const it = { x: dish.x, y: dish.y, r: 34 * SCALE.reach + 6, hold: 2.5, roof: b1, label: 'Tap the relay', fn: () => { Action.S().interact = Action.S().interact.filter(i => i !== it); F().towers = 2; st.tapped = true; toast('Relay 2 tapped (2/3)', 'gold'); sfx('pick'); } };
        Action.S().interact.push(it);
        toast('A Helix sniper covers the dish. His red laser fires when it turns solid: break line of sight or dodge.', 'warn');
      }, tick: st => {
        if (!st.b1 || st.fin) return;
        if (player.roof === st.b1) markers = [];
        const sn = st.sniper && !st.sniper.dead;
        setObjective(!player.roof && !st.tapped ? 'Climb the fire escape (hold E) to relay tower 2' : !st.tapped ? `Tap the relay on the roof (hold E)${sn ? ' · sniper!' : ''}` : sn ? 'Take out the sniper' : 'Done');
        if (st.tapped && !sn) { st.fin = true; st.finish(); }
      } },

      // ---------------- TOWER 3: LISTENING POST ----------------
      { type: 'checkpoint', name: 'Listening Post', pos: [1500, 1840], clock: 20 * 60 + 30, run: () => { player.roof = null; } },
      { type: 'tip', text: 'The last relay sits inside a Helix listening post. Sneak in (C, takedowns from behind) or go loud. Once you start the uplink hack you have 45 seconds before Helix wipes the logs.' },
      { type: 'action', text: 'Reach the uplink at the listening post', target: { x: T3.x, y: T3.y, r: 30 },
        run: (st, finish, fail) => {
          st.finish = finish;
          const g = (x, y, route, a) => spawnEnemy('trooper', x, y, { mission: true, stealth: true, aggro: false, route: route && route.map(([x, y]) => ({ x, y })), a: a || 0, baseA: a, vision: 210 });
          g(1600, 1640, [[1600, 1640], [1720, 1640]]); g(1720, 1780, null, Math.PI); g(1580, 1780, [[1580, 1780], [1580, 1660]]);
          Action.spawnCamera(1740, 1640, 2.4);
          Action.addHideSpot(1540, 1720);
          Action.setAlarm({ onAlarm: () => { F().postAlarm = true; for (const [x, y] of [[1800, 1700], [1650, 1900]]) spawnEnemy('trooper', x, y, { mission: true, aggro: true }); } });
          markers = [{ x: T3.x, y: T3.y, color: '#a898ff' }];
          Action.addHackable(T3.x, T3.y, 'wave', 'Hack the uplink', () => { Action.stopTimer(); markers = []; F().towers = 3; toast('Relay 3 tapped (3/3)', 'gold'); st.fin = true; finish(); });
          st.timerOn = false; st.fail = fail;
        },
        tick: st => {
          if (!st.timerOn && dist(player, T3) < 60) { st.timerOn = true; Action.startTimer(45, 'Helix is wiping the logs', () => st.fail('Helix wiped the intercept logs')); }
          if (!st.fin) setObjective(`Hack the uplink at the listening post${F().postAlarm ? ' · ALARM RAISED' : ''}`);
        } },

      // ---------------- DECISION: BAYES + SIGNALING ----------------
      { type: 'dialog', lines: [['Baba Jogi', '(radio) I have all three feeds. The traffic is noisy: a flagged reply is not proof, and a clean one is not innocence.', 'radio'],
                                ['Veer', 'Then we reason about it properly. Show me the numbers.']] },
      { type: 'action', text: 'Read the intercepts', run: (st, done) => bayesScreen(done) },

      // ---------------- CONSEQUENCE: HELIX RETALIATION ----------------
      { type: 'checkpoint', name: 'Retaliation', pos: [1650, 1760], silent: true },
      { type: 'dialog', lines: [['Director Kane', '(radio) You have been listening to my mail, engineer. That was rude.', 'radio'], ['Veer', 'Incoming! Helix squad on the road!']] },
      { type: 'kill', text: 'Survive Helix retaliation', target: [1650, 1760],
        spawns: [['trooper', 1850, 1620], ['trooper', 1850, 1900], ['drone', 1450, 1600], ['brute', 1880, 1760], ['drone', 1700, 1950]] },
      { type: 'dialog', lines: [['Veer', 'Tomorrow is restart day. Whoever lied to me, we find out at the station.']] },
      { type: 'passed', title: "Chapter 6 · Kane's Offer",
        stats: () => [['Relays tapped', `${F().towers || 0} / 3`], ['Listening post alarm', F().postAlarm ? 'Raised' : 'Never raised'], ['Lakeside resources', GT.res.lakeside]],
        rewards: () => ['Hidden bribe-takers will hold back half their contribution in Chapter 7', 'Codex: Bayesian Updating, Signaling & Cheap Talk'],
        onDone: () => { player.x = 1650; player.y = 1760; CAM.x = player.x; CAM.y = player.y; } },
    ],
  };
  CHAPTERS[6] = MissionManager.compile(CH6);
})();
