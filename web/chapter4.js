/* =====================================================================
   CHAPTER 4 - "THE BRIDGE"  (Crow's Market, Silas Crow)
   Game theory: GAME OF CHICKEN
     Action 1 "Market Chase" : a thief runs off with Lakeside's pump part.
                               Foot chase through the market stalls (he
                               knocks stalls over behind him), up a fire
                               escape, across the rooftops by zipline and a
                               scaffold that collapses behind you, then a
                               tackle QTE. Silas's guards attack in the
                               market while civilians flee.
     Action 2 "Head-On"      : both convoys drive at each other on the narrow
                               bridge in slow motion (existing chickenScene()).
     Decision                : SWERVE or STAY. Silas plays the Opportunist:
                               he estimates your chance of staying from your
                               reputation (how often you have defected) and
                               stays whenever that belief is below 2/3, the
                               mixed-strategy equilibrium of this matrix.
     Consequences (GT.flags) : bridgeWon | foodTax | bridgeShared | crash ->
                               fight on the burning bridge, then it partly
                               collapses: closed to vehicles for the rest of
                               the game (bridgeClosed).
   ===================================================================== */
'use strict';
(() => {
  const F = () => MissionManager.flags();
  const ROOF_A = { x: 1914, y: 2212 }, ROOF_B = { x: 1712, y: 2212 }, ROOF_C = { x: 1497, y: 2212 };
  const roof = p => buildings.find(b => Math.abs(b.x - p.x) < 2 && Math.abs(b.y - p.y) < 2);
  const GROUND_ROUTE = [[1860, 1835], [1915, 1840], [1915, 1935], [1880, 2010], [1960, 2080], [1976, 2150], [1976, 2196]].map(([x, y]) => ({ x, y }));

  const CH4 = {
    label: 'Chapter 4', title: 'The Bridge', sub: 'Crow’s Market. One bridge, two convoys, no brakes.',
    steps: [
      { type: 'setup', clock: 13 * 60, pos: [1880, 1990], trustHud: true, run: () => { MissionManager.startClock(); Action.resetAllies(); state.weather = GT.riverDead ? 'dust' : 'clear'; } },
      { type: 'cutscene', cleanup: ['silas', 'tara'], beats: [
        { cam: [1880, 1960, 1.4] },
        { actor: { id: 'tara', cast: 'tara', x: 1850, y: 2000, a: 0, label: 'Tara', labelColor: '#2d7fd6' } },
        { actor: { id: 'silas', cast: 'silas', x: 1880, y: 1935, a: Math.PI / 2, label: 'Silas Crow', labelColor: '#c9b04a' } },
        { say: [['Tara "Sparks" Nair', 'The pump’s drive shaft was taken last night. I tracked the cart tracks here, straight to Silas.'],
                ['Silas Crow', 'Stolen? I prefer “acquired”. You can have it back, of course.'],
                ['Silas Crow', 'For your entire water supply.'],
                ['Veer', 'Or I take it back.'],
                ['Tara "Sparks" Nair', 'Veer, the kid by the fruit stall. He’s got the shaft in his bag. He’s running!']] },
      ] },

      // ---------------- ACTION 1: MARKET CHASE ----------------
      { type: 'checkpoint', name: 'Market Chase', pos: [1860, 1990], clock: 13 * 60 + 2 },
      { type: 'tip', text: 'FOOT CHASE: sprint (Shift) after the thief. Stalls he knocks over block the way: go around. If you fall more than about 90 m behind for 10 seconds, he escapes.' },
      { type: 'chase', text: 'Chase the thief through the market', label: 'the thief', failText: 'The thief got away with the pump part', onFoot: true,
        runner: { type: 'bike', x: 1860, y: 1835, a: 0, extra: { hidden: true } },
        path: GROUND_ROUTE, base: 205, boost: 25, escapeDist: 450, escapeTime: 10,
        beforeStart: r => { r.hp = 1e9; Action.actor('thief', { cfg: CR.enemyConfig('scav'), x: r.x, y: r.y, a: 0, label: 'Thief', labelColor: '#e0533f', follow: r }); },
        events: [
          { at: 0.18, fn: ch => { const r = ch.runner; buildings.push({ x: r.x - 20, y: r.y - 50, w: 40, h: 26, hgt: 8, roof: '#8a3b2c', crate: true, mission: true }); rebuildColliders(); toast('He knocked a stall over!', 'warn'); sfx('thud'); } },
          { at: 0.5, fn: ch => { const r = ch.runner; buildings.push({ x: r.x - 45, y: r.y - 50, w: 32, h: 26, hgt: 8, roof: '#3b6a5a', crate: true, mission: true }); rebuildColliders(); for (const n of npcs) if (dist(n, r) < 200) n.a = Math.atan2(n.y - r.y, n.x - r.x); toast('Carts everywhere!', 'warn'); } },
        ],
        onEnd: () => {} },
      { type: 'action', text: 'He’s climbing to the rooftops! Hold E at the fire escape', target: { x: 1976, y: 2200, r: 30 },
        run: (st, finish, fail) => {
          const A_ = roof(ROOF_A), B_ = roof(ROOF_B), C_ = roof(ROOF_C);
          st.finish = finish;
          Action.addClimb(A_, 1976, 2200, 'Climb the fire escape');
          Action.addZip(A_, { x: 1922, y: 2290 }, B_, { x: 1890, y: 2290 });
          // the scaffold: a plank walk to roof C that collapses once you are across
          Action.addZip(B_, { x: 1720, y: 2300 }, C_, { x: 1580, y: 2300 });
          Action.S().zips[1].scaffold = true;
          const th = Action.getActor('thief'); if (th) { th.follow = null; th.roof = A_; th.x = 1990; th.y = 2240; th.to = { x: 1930, y: 2290 }; th.speed = 110; }
          Action.startTimer(60, 'Catch the thief', () => fail('The thief got away across the rooftops'));
          st.stage = 0;
        },
        tick: st => {
          const th = Action.getActor('thief'); if (!th) return;
          const A_ = roof(ROOF_A), B_ = roof(ROOF_B), C_ = roof(ROOF_C);
          // the thief stays one roof ahead of the player
          if (st.stage === 0 && player.roof === A_) { st.stage = 1; setObjective('Follow him across the roofs (E at the zipline)'); th.roof = B_; th.x = 1880; th.y = 2290; th.to = { x: 1740, y: 2300 }; }
          if (st.stage === 1 && player.roof === B_) { st.stage = 2; setObjective('Cross the scaffold (E at the orange anchor)'); th.roof = C_; th.x = 1570; th.y = 2300; th.to = { x: 1530, y: 2330 }; }
          if (st.stage === 2 && player.roof === C_) {
            st.stage = 3; explode(1650, 2300); shake(10); toast('The scaffold collapses behind you!', 'warn');
            Action.S().zips = Action.S().zips.filter(z => !z.scaffold);
            setObjective('Tackle the thief!');
          }
          if (st.stage === 3 && dist(player, th) < 45 * SCALE.reach + 8 && !st.fin) { st.fin = true; Action.stopTimer(); st.finish(); }
        } },
      { type: 'qte', text: 'Tackle him!', failText: 'He slipped out of your grip and got away',
        seq: [{ key: 'Space', label: 'SPACE', t: 1.2, text: 'TACKLE' }, { mash: 'KeyF', label: 'F', count: 8, t: 3, text: 'PIN HIM DOWN' }],
        onSuccess: () => { F().partBack = true; const th = Action.getActor('thief'); if (th) { th.to = null; th.label = 'Pinned'; } } },
      { type: 'dialog', lines: [['Thief', 'Okay, okay! Take it! Silas pays me in bread, man!'], ['Veer', '(holding the drive shaft) Got it.'], ['Silas Crow', '(loudspeaker) Nobody walks out of my market with my property. Boys?', 'radio']] },

      // ---------------- MARKET BRAWL ----------------
      { type: 'checkpoint', name: 'Market Brawl', pos: [1880, 2060], run: () => {
        player.roof = null; Action.removeActor('thief');
        for (let i = 0; i < 10; i++) npcs.push({ x: 1780 + rnd(0, 200), y: 1820 + rnd(0, 200), a: rnd(0, 6.28), t: 0.5, r: 9 * SCALE.r, cfg: CR.randomSurvivor(), panic: true });
      } },
      { type: 'action', text: 'Survive Silas’s guards in the market', target: { x: 1880, y: 1950, r: 60 },
        run: (st, finish) => {
          st.finish = finish;
          st.list = [['guard', 1720, 1830], ['guard', 2040, 1830], ['guard', 1880, 1760], ['brute', 1720, 2080], ['guard', 2040, 2080], ['guard', 1990, 1720]].map(([t, x, y]) => spawnEnemy(t, x, y, { mission: true, aggro: true, colony: 'crows', color: '#c9b04a' }));
        },
        tick: (st, dt) => {
          // civilians flee from the gunfight
          for (const n of npcs) if (n.panic) { const a = Math.atan2(n.y - player.y, n.x - player.x); n.a = a; n.stop = false; n.t = 1; n.x += Math.cos(a) * 60 * SCALE.walk * dt; n.y += Math.sin(a) * 60 * SCALE.walk * dt; }
          const left = st.list.filter(e => !e.dead).length;
          setObjective(`Survive Silas’s guards in the market (${left} left)`);
          if (!left && !st.fin) { st.fin = true; npcs = npcs.filter(n => !n.panic); st.finish(); }
        } },

      // ---------------- ACTION 2: HEAD-ON (Game of Chicken) ----------------
      { type: 'cutscene', beats: [
        { cam: [1190, 1200, 1.1] },
        { say: [['Tara "Sparks" Nair', '(radio) We’re loaded and rolling home. But Silas has parked his whole convoy on the bridge.', 'radio'],
                ['Silas Crow', '(radio) Only one way back to Lakeside, Veer. I’m coming across at full speed. So are you, if you have the nerve.', 'radio'],
                ['Tip', 'GAME OF CHICKEN: whoever swerves loses face; if nobody swerves, both crash. Silas is an OPPORTUNIST: he guesses what you will do from your reputation (how often you have defected so far).', 'sys']] },
      ] },
      { type: 'checkpoint', name: 'Head-On', pos: [880, 1260], run: () => { spawnCar('pickup', 900, 1235, 0, { mission: true, color: '#4d6d78' }); } },
      { type: 'goto', to: [950, 1200], text: 'Take the convoy truck to the west end of the bridge', r: 70, needCar: true },
      { type: 'action', text: 'Hold your nerve…', run: (st, done) => chickenScene(() => { const r = GT.log[GT.log.length - 1]; F().chicken = [r.p, r.a]; done(); }) },

      // ---------------- CONSEQUENCES ----------------
      { type: 'action', run: (st, done) => {
        const [p, a] = F().chicken, f = F();
        if (p === 1 && a === 1) { f.bridgeCrash = true; dialog([['Veer', '(dazed) Nobody swerved…'], ['Silas Crow', '(somewhere in the smoke) Finish them!']], done); return; }
        if (p === 1 && a === 0) { f.bridgeWon = true; dialog([['Silas Crow', '(radio) You actually… Fine. The bridge is yours, engineer. Today.', 'radio'], ['Tip', 'You won the bridge. Silas lost face in front of his men, and Crow’s trust in you dropped a little.', 'sys']], done); return; }
        if (p === 0 && a === 1) { f.foodTax = true; GT.res.lakeside -= 15; dialog([['Silas Crow', '(radio) Sensible man. The bridge is mine, and so is the toll. Food will cost Lakeside extra from now on.', 'radio']], done); return; }
        f.bridgeShared = true; dialog([['Silas Crow', '(radio) Both in the ditch. How embarrassing for us both. Fine: we share the bridge.', 'radio']], done);
      } },
      // crash branch only: fight on the burning bridge, then it partly collapses
      { type: 'action', run: (st, done) => {
        if (!F().bridgeCrash) { done(); return; }
        player.car = null; player.x = 1150; player.y = 1215;
        for (const [x, y] of [[1170, 1190], [1215, 1225], [1245, 1185]]) Action.fire(x, y, 18, { grow: 0.4, max: 26 });
        st.list = [['guard', 1300, 1180], ['guard', 1300, 1225], ['brute', 1330, 1200], ['guard', 1360, 1180], ['guard', 1360, 1230]].map(([t, x, y]) => spawnEnemy(t, x, y, { mission: true, aggro: true, colony: 'crows', color: '#c9b04a' }));
        st.finish = done;
      }, text: 'Fight Silas’s men on the burning bridge',
        tick: st => {
          if (!st.list || st.fin) return;
          const left = st.list.filter(e => !e.dead).length;
          setObjective(`Fight Silas’s men on the burning bridge (${left} left)`);
          if (!left) {
            st.fin = true; explode(1190, 1180); explode(1190, 1230); shake(16);
            F().bridgeClosed = true; rebuildColliders();
            dialog([['Veer', 'The bridge… half of it just went into the river.'], ['Tip', 'The bridge is now closed to vehicles for the rest of the game (a footpath remains). Cross on foot, or take the long way.', 'sys']], st.finish);
          }
        } },
      { type: 'dialog', lines: [['Silas Crow', '(at the market) Business is business, Veer. Everybody has a price. Even you.']] },
      { type: 'passed', title: 'Chapter 4 · The Bridge',
        stats: () => { const f = F(), [p, a] = f.chicken || [0, 0]; return [['Pump part', f.partBack ? 'Recovered' : 'Lost'], ['You', p ? 'Stayed' : 'Swerved'], ['Silas', a ? 'Stayed' : 'Swerved'], ['Outcome', f.bridgeCrash ? 'CRASH: bridge collapsed' : f.bridgeWon ? 'You won the bridge' : f.foodTax ? 'Silas controls the bridge' : 'Shared bridge'], ['Trust: Crow’s', trustOf('crows').toFixed(0)]]; },
        rewards: () => { const f = F(); return [f.bridgeClosed ? 'The bridge is closed to vehicles for the rest of the game' : f.foodTax ? 'Lakeside pays extra for food (−15)' : 'The bridge stays open', 'Codex: Game of Chicken, Mixed Strategies']; },
        onDone: () => { player.car = null; player.x = 950; player.y = 1260; CAM.x = player.x; CAM.y = player.y; } },
    ],
  };
  CHAPTERS[4] = MissionManager.compile(CH4);
})();
