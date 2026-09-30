/* =====================================================================
   CHAPTER 2 - "IRON HANDSHAKE"  (Ironside Refinery, Rhea "Iron" Dutta)
   Game theory: REPEATED PRISONER'S DILEMMA vs GRIM TRIGGER
     Action 1 "Refinery Fire" : 3-minute timer. Free 4 trapped workers (hold E),
                                dodge bursting pipes (red glow = about to blow),
                                crouch under smoke, turn valves (hold E) to cut
                                the gas; then Helix saboteurs in the pipe maze.
     Action 2 "Tanker Escort" : drive beside Rhea's fuel tanker to Lakeside.
                                Wave 1 bikes, wave 2 Helix drones, wave 3 an
                                armoured Helix truck that rams the tanker
                                (shoot its engine from the front or tyres from
                                the side; the rear is armoured).
     Decision (5 rounds)      : Round 1 = Kane's private offer mid-escort
                                (deliver the tanker or detach it for Helix).
                                Rounds 2-5 = side jobs across the city.
                                Rhea plays GRIM TRIGGER: one defection and she
                                defects forever. The running total after every
                                round is compared with "always cooperate" and
                                "defect once" (the shadow of the future).
     Consequences (GT.flags)  : rheaBetrayed -> Ironside hostile, no fuel in
                                Chapter 7, Rhea fights you in the finale;
                                rheaAlly -> armoured jeep + Rhea's fighters.
   ===================================================================== */
'use strict';
(() => {
  const F = () => MissionManager.flags();
  const TO_LAKESIDE = [[1875, 705], [1710, 705], [1662, 730], [1650, 780], [1650, 1140], [1625, 1190], [1580, 1200], [715, 1200], [715, 1700], [715, 1930]].map(([x, y]) => ({ x, y }));   // rounded corners: a tanker turns wide
  const TO_HELIX = [[1900, 1200], [2150, 1200]].map(([x, y]) => ({ x, y }));

  // ---- the repeated game bookkeeping (only Chapter 2 rounds with Rhea) ----
  const rounds = () => GT.col.ironside.hist.filter(r => r.ch === 2);
  /** Running payoff note shown under the matrix after each round. */
  function runningNote() {
    const R = rounds(), n = R.length, mine = R.reduce((s, r) => s + r.pp, 0);
    const always = 3 * n, once = n ? 5 + (n - 1) * 1 : 0;
    const fired = R.some(r => r.p === D);
    return `Round ${n} of 5. Your running total with Rhea: <b>${mine}</b>. ` +
      `"Always cooperate" would have scored <b>${always}</b> (3 per round); "defect once, in round 1" scores <b>${once}</b> (5, then 1 per round once Grim Trigger fires). ` +
      (fired ? 'Grim Trigger has fired: Rhea defects in every remaining round. The +2 you gained once costs 2 in every round after it.'
        : 'In a repeated game the future disciplines the present: defecting gains +2 once but loses 2 in every later round. That is the SHADOW OF THE FUTURE. Cooperation is rational whenever the future matters enough (discount factor δ ≥ (T−R)/(T−P) = 0.5).');
  }
  function round(o, done) {
    tradeDecision(Object.assign({ game: 'PD_Repeated', colony: 'ironside', ch: 2, note: () => runningNote() }, o), r => {
      unlock('repeated'); unlock('grim');
      const broke = r.p === D && !F().rheaBroke;
      if (broke) { F().rheaBroke = true; dialog([['Rhea "Iron" Dutta', '(radio) I warned you, engineer. Once. We’re done. Forever.', 'radio'], ['Tip', 'Grim Trigger fired: Ironside is now hostile (guards attack you in their district) and Rhea will defect in every remaining round.', 'sys']], () => done(r)); }
      else done(r);
    });
  }

  /** One open-world side job: go somewhere, optionally clear enemies, then a round with Rhea. */
  const job = (k, spot, title, text, card, extra = {}) => [
    { type: 'goto', to: spot, text: `Side job ${k}/4 · ${title}: ${text}`, r: 60 },
    ...(extra.spawns ? [{ type: 'kill', text: `Side job ${k}/4 · ${extra.killText}`, spawns: extra.spawns, target: spot }] : []),
    { type: 'action', run: (st, done) => round({ eyebrow: `Chapter 2 · Repeated game · Round ${k + 1} of 5`, title, prompt: card.prompt, c0: card.c0, c1: card.c1, s0: card.s0, s1: card.s1 }, () => done()) },
  ];

  const CH2 = {
    label: 'Chapter 2', title: 'Iron Handshake', sub: 'Ironside Refinery. The same partner, again and again.',
    steps: [
      { type: 'setup', clock: 10 * 60, weather: 'clear', pos: [1875, 790], trustHud: true, run: () => { MissionManager.startClock(); Action.resetAllies(); } },
      { type: 'cutscene', cleanup: ['rhea'], beats: [
        { cam: [1875, 640, 1.3] },
        { explode: [1850, 430] }, { explode: [1950, 390] },
        { actor: { id: 'rhea', cast: 'rhea', x: 1875, y: 700, a: Math.PI / 2, label: 'Rhea "Iron" Dutta', labelColor: '#d9824a' } },
        { move: { id: 'rhea', to: [1875, 760], speed: 110, wait: true } },
        { say: [['Rhea "Iron" Dutta', 'Perfect timing, engineer. Pipe three just blew and I’ve got four people trapped in there.'],
                ['Rhea "Iron" Dutta', 'You want fuel? Help me first.'],
                ['Rhea "Iron" Dutta', 'And listen carefully: cross me once, and we’re done. Forever.']] },
      ] },

      // ---------------- ACTION 1: REFINERY FIRE ----------------
      { type: 'checkpoint', name: 'Refinery Fire', pos: [1875, 690], clock: 10 * 60 + 5, run: () => {
        const S = Action.S();
        S.fireCap = 16;
        for (const [x, y] of [[1800, 400], [1930, 520], [1870, 600], [2010, 470]]) Action.fire(x, y, 18, { grow: 0.8, max: 30, spread: 0.6 });
        const pipes = [[1850, 430], [1950, 390], [1780, 540], [1990, 560]].map(([x, y], i) => Action.addHazard(x, y, { period: 6 + i, t: i * 1.7 }));
        for (const [x, y, r] of [[1880, 470, 55], [1760, 565, 45], [2000, 520, 45]]) Action.addSmoke(x, y, r);
        // valves: each cuts the gas to nearby pipes and fires
        const valve = (x, y, name) => { const it = { x, y, r: 34 * SCALE.reach + 6, hold: 1.5, label: `Turn the ${name} valve`, fn: () => {
          S.interact = S.interact.filter(i => i !== it);
          for (const h of S.hazards) if (dist(h, it) < 260) h.off = true;
          S.fires = S.fires.filter(f => { if (dist(f, it) > 200) return true; const li = lights.indexOf(f.light); if (li >= 0) lights.splice(li, 1); return false; });
          toast(`The ${name} line is shut. Fires dying down.`, 'gold'); sfx('pick');
        } }; S.interact.push(it); };
        valve(1705, 390, 'west'); valve(2045, 390, 'east'); valve(1875, 650, 'main');
        // trapped workers
        const exit = { x: 1875, y: 700 };
        [[1760, 420], [1990, 420], [1720, 600], [2020, 600]].forEach(([x, y], i) => {
          const w = Action.actor('worker' + i, { cfg: CR.enemyConfig('guard', 'ironside'), x, y, a: Math.PI / 2, label: 'Trapped worker', labelColor: '#d9824a', trapped: true });
          const it = { x, y, r: 34 * SCALE.reach + 6, hold: 1.5, label: 'Free the worker', fn: () => {
            S.interact = S.interact.filter(o => o !== it);
            w.trapped = false; w.label = 'Rescued'; w.to = exit; w.speed = 150; w.onArrive = () => Action.removeActor(w.id);
            F().rescued = (F().rescued || 0) + 1; toast(`Worker rescued (${F().rescued}/4)`, 'gold');
          } };
          S.interact.push(it);
        });
        F().rescued = 0;
      } },
      { type: 'tip', text: 'REFINERY FIRE (3 minutes): hold E next to each trapped worker to free them. Pipes glowing RED are about to burst: keep clear or dodge-roll (Space). In thick smoke, crouch (C). Hold E at a valve to cut the gas: that pipe line stops bursting and nearby fires die.' },
      { type: 'action', text: 'Rescue the 4 trapped workers',
        run: (st, finish, fail) => { st.finish = finish; Action.startTimer(180, 'Rescue the workers', () => fail('The fire reached the workers')); },
        tick: st => {
          const n = F().rescued || 0;
          setObjective(`Rescue the trapped workers (${n}/4)`);
          if (n >= 4 && !st.fin) { st.fin = true; Action.stopTimer(); st.finish(); }
        } },
      { type: 'dialog', lines: [['Rhea "Iron" Dutta', '(radio) All four out! But the pipes didn’t burst on their own. There are Helix suits in my pipe maze!', 'radio']] },
      { type: 'checkpoint', name: 'Pipe Maze', pos: [1875, 690] },
      { type: 'kill', text: 'Take down the Helix saboteurs in the pipe maze', target: [1875, 450],
        spawns: [['trooper', 1760, 400], ['trooper', 1990, 400], ['trooper', 1870, 380], ['trooper', 1720, 560], ['trooper', 2030, 560], ['drone', 1875, 330]] },
      { type: 'dialog', lines: [['Rhea "Iron" Dutta', 'Helix sabotaged my refinery and nearly cooked my people. You earned a trade, engineer.'], ['Rhea "Iron" Dutta', 'First run: my tanker to Lakeside. Keep it alive.']] },

      // ---------------- ACTION 2: TANKER ESCORT (+ round 1) ----------------
      { type: 'checkpoint', name: 'Tanker Escort', pos: [1830, 740], run: () => {
        const t = spawnCar('tanker', 1875, 640, Math.PI / 2, { mission: true, escort: true, color: '#8a3a2a', path: TO_LAKESIDE.map(p => ({ ...p })), wp: 0 });
        t.maxHp = t.hp = 520; t.wpR = 55;
        spawnCar('jeep', 1820, 760, Math.PI, { mission: true });
      } },
      { type: 'tip', text: 'ESCORT: get in the jeep (E) and stay with the tanker. It stops when enemies block it. Shoot while driving (hold the left mouse button). An armoured truck can only be stopped through its ENGINE (shoot it from the front) or its TYRES (from the side): the back is armoured.' },
      { type: 'action', text: 'Escort Rhea’s fuel tanker to Lakeside', target: () => cars.find(c => c.type === 'tanker' && c.escort),
        run: (st, finish, fail) => { st.finish = finish; st.fail = fail; st.stage = 0; st.t = cars.find(c => c.type === 'tanker' && c.escort); },
        tick: (st, dt) => {
          const t = st.t; if (!t || st.over) return;
          if (t.hp <= 0) { st.over = true; st.fail('The fuel tanker exploded'); return; }
          setObjective(`${F().tankerToHelix ? 'Take the tanker to Kane’s men' : 'Escort the fuel tanker to Lakeside'}: ${Math.round(t.hp / t.maxHp * 100)}%`);
          t.halt = enemies.some(e => !e.dead && !e.mount && dist(e, t) < (e.fly ? 140 : 190));
          // wave 1: scavenger bikes
          if (st.stage === 0 && t.wp >= 1) { st.stage = 1; for (const k of [0, 1, 2]) Action.spawnBiker(t.x + 80 + k * 30, t.y + 120, { a: Math.PI }); toast('Wave 1: scavenger bikes!', 'warn'); }
          // Kane's private call at the junction before the bridge = ROUND 1
          if (st.stage === 1 && t.wp >= 3 && !enemies.some(e => !e.dead && e.mount)) {
            st.stage = 2;
            dialog([['Director Kane', '(private channel) Mr. Malhotra. A business proposal, between us.', 'radio'],
                    ['Director Kane', '(private channel) At this junction, send the tanker east into the Dead Zone instead. Helix pays you double what Rhea does. She never needs to know who took it.', 'radio']], () => {
              round({ eyebrow: 'Chapter 2 · Repeated game · Round 1 of 5', title: 'The tanker', prompt: 'Rhea is trusting you with her whole fuel run. Kane is offering double to betray her.',
                c0: 'Deliver the tanker', c1: 'Sell it to Kane', s0: 'Fuel reaches Lakeside as agreed.', s1: 'Divert it to Helix. Double pay, and Rhea loses everything.' }, r => {
                if (r.p === D) { F().tankerToHelix = true; t.path = TO_HELIX.map(p => ({ ...p })); t.wp = 0; GT.res.lakeside += 10; }
              });
            });
          }
          // wave 2: Helix drones
          if (st.stage === 2 && !state.modal) { st.stage = 3; for (let k = 0; k < 4; k++) spawnEnemy('drone', t.x + rnd(-200, 200), t.y - 250 + rnd(-60, 60), { mission: true, aggro: true }); toast('Wave 2: Helix drones!', 'warn'); }
          // wave 3: the armoured Helix truck rams the tanker
          if (st.stage === 3 && !enemies.some(e => !e.dead && e.fly && e.mission)) {
            st.stage = 4;
            const fwd = t.path[Math.min(t.wp, t.path.length - 1)];              // it comes down the road ahead of the tanker
            const truck = st.truck = spawnCar('pickup', fwd.x, fwd.y, Math.atan2(t.y - fwd.y, t.x - fwd.x),
              { mission: true, hostile: true, npc: true, color: '#2c2f33', name: 'The armoured truck', ramPower: 3 });
            truck.hp = 320;
            truck.ai = (c, dt) => {
              if (t.hp <= 0) return [0, 0];
              const back = c.ramCd > tNow;
              const want = Math.atan2(t.y - c.y, t.x - c.x);
              return [back ? -0.8 : 1, clamp(((want - c.a + 9.42) % 6.283 - 3.14) * 2, -1, 1) * (back ? -1 : 1)];
            };
            banner('WAVE 3: ARMOURED TRUCK');
          }
          if (st.stage === 4 && st.truck && st.truck.hp <= 0) { st.stage = 5; toast('The armoured truck is down!', 'gold'); }
          if (t.wp >= t.path.length || (t.wp >= t.path.length - 1 && dist(t, t.path[t.path.length - 1]) < 90)) {
            if (st.stage < 3) return;                                // (waves must play out)
            st.over = true; t.v = 0; t.path = null; for (const e of enemies) if (e.mount) { e.dead = true; e.hidden = true; }
            st.finish();
          }
        } },
      { type: 'action', run: (st, done) => dialog(F().tankerToHelix
        ? [['Director Kane', '(private channel) A pleasure doing business. Your payment is in the usual place.', 'radio'], ['Rhea "Iron" Dutta', '(radio) My tanker never reached Lakeside. Funny. Neither will anything else of mine.', 'radio']]
        : [['Rhea "Iron" Dutta', '(radio) Tanker’s at Lakeside, full load. You turned Kane down, didn’t you? I heard the chatter.', 'radio'], ['Rhea "Iron" Dutta', '(radio) Four more jobs this week. Let’s see if you’re still honest when nobody’s watching.', 'radio']], done) },

      // ---------------- ROUNDS 2-5: side jobs in the open world ----------------
      { type: 'tip', text: 'REPEATED GAME: four more deals with Rhea (rounds 2 to 5), each after a side job. After every round the matrix shows your running total compared with "always cooperate" and "defect once".' },
      ...job(1, [1875, 760], 'Fuel for water', 'deliver Lakeside’s water drums to the Ironside gate',
        { prompt: 'Rhea sends fuel cans, you send water drums, both sealed.', c0: 'Full drums', c1: 'Short the drums', s0: 'Every drum full.', s1: 'Fill a few with river water.' }),
      ...job(2, [1450, 700], 'Repair parts', 'meet Rhea’s scavenging crew at the scrapyard',
        { prompt: 'The salvage is shared. Each side reports what it found.', c0: 'Report everything', c1: 'Pocket a regulator', s0: 'Split the parts 50/50.', s1: 'Keep the best part for Lakeside.' },
        { spawns: [['scav', 1400, 650], ['scav', 1500, 760], ['brute', 1460, 620]], killText: 'clear the scavengers off the scrapyard' }),
      ...job(3, [2100, 250], 'Shared patrol', 'join Ironside’s patrol on the north road',
        { prompt: 'Both colonies patrol the north road. Nobody checks who really stood watch.', c0: 'Pull your shift', c1: 'Skip the shift', s0: 'Your people patrol all night.', s1: 'Let Ironside do the work.' },
        { spawns: [['scav', 2050, 200], ['scav', 2160, 300], ['scav', 2200, 220], ['trooper', 2120, 180]], killText: 'hold the north road with the patrol' }),
      ...job(4, [2300, 700], 'Split the salvage', 'open the Helix supply cache east of the refinery',
        { prompt: 'A Helix cache. Rhea’s crew opens one side, yours the other.', c0: 'Split it fairly', c1: 'Take the lion’s share', s0: 'Half each.', s1: 'Load most of it on your truck first.' }),

      // ---------------- OUTRO & CONSEQUENCES ----------------
      { type: 'action', run: (st, done) => {
        const f = F(), betrayed = rounds().some(r => r.p === D);
        f.rheaBetrayed = betrayed; f.rheaAlly = !betrayed; f.noFuelCh7 = betrayed; f.armoredJeep = !betrayed;
        unlock('shadow');
        if (!betrayed) { state.weapons[1] = true; spawnCar('jeep', 640, 2080, 0, { color: '#3a4a36', hp: 420, armored: true }); }
        dialog(betrayed
          ? [['Rhea "Iron" Dutta', '(radio) You had five chances, engineer. You only needed to be honest five times.', 'radio'], ['Rhea "Iron" Dutta', '(radio) Ironside is closed to you. When this city burns, my people will be on the other side.', 'radio']]
          : [['Rhea "Iron" Dutta', 'Five deals, five honest splits. I don’t say this often: I trust you.'], ['Rhea "Iron" Dutta', 'Take the armoured jeep at Lakeside, and the rifle. When you need fighters for the station, call Ironside.']], done);
      } },
      { type: 'passed', title: 'Chapter 2 · Iron Handshake',
        stats: () => { const R = rounds(); return [['Workers rescued', `${F().rescued || 0} / 4`], ['Your moves', R.map(r => r.p === C ? 'C' : 'D').join(' ')], ['Rhea’s moves', R.map(r => r.a === C ? 'C' : 'D').join(' ')], ['Your payoff vs Rhea', R.reduce((s, r) => s + r.pp, 0) + ` (always cooperate: ${R.length * 3})`], ['Trust: Ironside', trustOf('ironside').toFixed(0)]]; },
        rewards: () => { const f = F(); return f.rheaAlly ? ['Armoured jeep waiting at Lakeside', 'Rifle unlocked (press 2)', 'Rhea and her fighters will join the finale'] : ['Ironside is hostile: guards attack you in their district', 'No fuel for vehicles in Chapter 7', 'Rhea will fight against you in the finale']; },
        onDone: () => { player.x = 700; player.y = 1250; CAM.x = player.x; CAM.y = player.y; } },
    ],
  };
  // (the banner helper lives in Action; alias for readability above)
  const banner = t => Action.banner(t, 'warn', 2.4);

  CHAPTERS[2] = MissionManager.compile(CH2);
})();
