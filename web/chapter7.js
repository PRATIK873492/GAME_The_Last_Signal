/* =====================================================================
   CHAPTER 7 - "THE LAST SIGNAL"  (the power station, Dead Zone)
   Game theory: THRESHOLD PUBLIC GOODS GAME -> endings
     Road to the station    : armoredJeep (Rhea's ally reward) gives you a
                              jeep; noFuelCh7 means you go on foot. If Rhea
                              was betrayed, Ironside fighters ambush you.
                              bridgeClosed forces the long way round.
     Siege                  : defend the station's control room against 3
                              Helix waves. Allies depend on earlier choices:
                              Tara always, Rhea if rheaAlly, a Mercy medic if
                              doctorAlly, the Chapter 5 partner if GT.core.
     Boss                   : Razor, now on Helix's payroll (3 phases).
     Decision               : the existing publicGoodsScreen(): contributions,
                              the 280 threshold, the core bonus, hidden
                              bribe-takers (GT.traitor) -> ending + report.
   ===================================================================== */
'use strict';
(() => {
  const F = () => MissionManager.flags();
  const ST = { x: 1875, y: 1010 };

  const CH7 = {
    label: 'Chapter 7', title: 'The Last Signal', sub: 'The power station. Four resources. One chance.',
    steps: [
      { type: 'setup', clock: 5 * 60 + 30, pos: [760, 1230], trustHud: true, run: () => { state.weather = GT.riverDead ? 'dust' : 'clear'; MissionManager.startClock(); Action.resetAllies(); } },
      { type: 'cutscene', cleanup: ['tara', 'jogi'], beats: [
        { cam: [760, 1210, 1.5] },
        { actor: { id: 'tara', cast: 'tara', x: 735, y: 1245, a: 0, label: 'Tara', labelColor: '#2d7fd6' } },
        { actor: { id: 'jogi', cast: 'jogi', x: 790, y: 1245, a: Math.PI, label: 'Baba Jogi', labelColor: '#4fb3a9' } },
        { do: next => {
          const f = F(), lines = [['Baba Jogi', 'Restart day. Every colony brings what it promised to the power station. Water, fuel, medicine, parts.'],
                                   ['Tara "Sparks" Nair', 'Helix knows the date too. Kane will throw everything he has at that station.']];
          if (f.armoredJeep) lines.push(['Tara "Sparks" Nair', 'Rhea left her armoured jeep for us. Fuel tank’s full.']);
          if (f.noFuelCh7) lines.push(['Tara "Sparks" Nair', 'No fuel since Ironside cut us off. We walk.']);
          if (f.bridgeClosed) lines.push(['Baba Jogi', 'And the bridge is down, so it’s the long way round.']);
          if (GT.core) lines.push(['Veer', 'And we bring the Helix core. Kane’s own generator will restart his rivals’ grid.']);
          lines.push(['Veer', 'Then let’s go and turn the lights back on.']);
          dialog(lines, next);
        } },
      ] },

      // ---------------- ROAD TO THE STATION ----------------
      { type: 'checkpoint', name: 'The Road', pos: [760, 1230], run: () => {
        const f = F();
        if (f.armoredJeep) { const j = spawnCar('jeep', 800, 1200, 0, { mission: true, color: '#6b5a3a' }); j.hp = (j.hp || 100) * 2; }
        else if (!f.noFuelCh7) spawnCar('pickup', 800, 1200, 0, { mission: true });
      } },
      { type: 'goto', to: [1600, 1010], text: 'Get to the edge of the Dead Zone', r: 90 },
      { type: 'action', text: 'Ironside ambush!', run: (st, done) => {
        if (!F().rheaBetrayed) { done(); return; }
        if (player.car) { player.car.v = 0; }
        dialog([['Rhea "Iron" Dutta', '(radio) I said no second chances, engineer. You’re not reaching that station.', 'radio']], () => {
          st.list = [['guard', 1450, 900], ['guard', 1450, 1120], ['guard', 1720, 880], ['brute', 1720, 1140]].map(([t, x, y]) => spawnEnemy(t, x, y, { mission: true, aggro: true, colony: 'ironside', color: '#d9824a' }));
          st.boss = spawnEnemy('guard', 1760, 1010, { mission: true, aggro: true, colony: 'ironside', hp: 260, cfg: CR.CAST.rhea, color: '#d9824a' });
          st.boss.label = 'Rhea'; st.list.push(st.boss);
          st.finish = done;
        });
      }, tick: st => {
        if (!st.list || st.fin) return;
        const left = st.list.filter(e => !e.dead).length;
        setObjective(`Grim Trigger: fight off Rhea’s ambush (${left} left)`);
        if (!left) { st.fin = true; dialog([['Veer', 'Grim Trigger. One betrayal, and she never stopped punishing it.']], st.finish); }
      } },

      // ---------------- SIEGE ----------------
      { type: 'checkpoint', name: 'The Siege', pos: [1875, 940], run: () => {
        const f = F();
        Action.resetAllies();
        Action.addAlly({ id: 'tara', name: 'Tara', x: 1840, y: 950, dmg: 12 });
        if (f.rheaAlly) Action.addAlly({ id: 'rhea', name: 'Rhea', x: 1910, y: 950, dmg: 16, hp: 140, maxHp: 140, weaponName: 'rifle' });
        if (f.doctorAlly) Action.addAlly({ name: 'Mercy medic', x: 1875, y: 960, dmg: 8, cfg: CR.enemyConfig('guard', 'mercy') });
        if (GT.core && GT.ally && GT.ally !== 'ironside') Action.addAlly({ id: { mercy: 'elena', crows: 'silas' }[GT.ally], name: COLONY_INFO[GT.ally].leader, x: 1860, y: 970, dmg: 11 });
      } },
      { type: 'cutscene', beats: [
        { cam: [ST.x, 900, 1.2] },
        { say: [['Tara "Sparks" Nair', 'I need five minutes in the control room to prime the turbines. Keep them off the doors!'],
                ['Director Kane', '(loudspeaker) All units. Nothing leaves that building. Nothing turns on.', 'radio'],
                ['Tip', 'DEFENCE: protect the control room. T places a barricade, E mans a turret, G orders your allies. Hold E beside a downed ally to revive them.', 'sys']] },
      ] },
      { type: 'action', text: 'Defend the control room', run: (st, done) => {
        Action.defend({ target: { x: 1850, y: 905, w: 50, h: 30, name: 'the control room' }, hp: 700, barricades: 5, turrets: [[1800, 960], [1950, 960]],
          waves: [[['drone', 1600, 900], ['drone', 2150, 900], ['trooper', 1650, 1150], ['trooper', 2100, 1150]],
                  [['trooper', 1550, 1000], ['trooper', 2200, 1000], ['drone', 1875, 1300], ['brute', 1600, 1250], ['drone', 2150, 1250]],
                  [['trooper', 1550, 880], ['trooper', 2200, 880], ['brute', 1650, 1250], ['brute', 2100, 1250], ['drone', 1875, 1350], ['drone', 1700, 700], ['trooper', 2050, 700]]],
          onWin: done, onLose: () => MissionManager.fail('Helix stormed the control room') });
      } },

      // ---------------- BOSS: RAZOR ----------------
      { type: 'checkpoint', name: 'Razor', pos: [1875, 1000] },
      { type: 'dialog', lines: [['Razor', '(revving) Remember me, water boy? Helix pays better than scrap.'], ['Veer', 'Then Helix just bought itself a very short contract.']] },
      { type: 'action', text: 'Defeat Razor', run: (st, done) => {
        for (const [x, y] of [[1760, 1060], [1990, 1060], [1760, 1180], [1990, 1180]]) buildings.push({ x, y, w: 40, h: 40, hgt: 14, roof: '#5a4d3a', crate: true, mission: true });
        rebuildColliders();
        Action.boss({ name: 'RAZOR', hp: 1100, x: 2020, y: 1120, cfg: CR.CAST.razor, weapon: 'pistol',
          phases: [{ at: 1, patterns: ['charge', 'spray'] },
                   { at: 0.66, patterns: ['flame', 'charge'], armor: 0.35, backOnly: true, onEnter: () => toast('Helix flamethrower! Shoot the fuel tank on his back (get behind him).', 'warn') },
                   { at: 0.33, patterns: ['summon', 'missiles', 'slam'] }],
          finisher: [{ key: 'KeyF', label: 'F', t: 1.2, text: 'COUNTER' }, { key: 'KeyV', label: 'V', t: 1.2, text: 'HEAVY BLOW' }, { mash: 'KeyF', label: 'F', count: 6, t: 2.5, text: 'FINISH' }],
          onDefeat: done });
        toast('Dodge-roll (Space) through charges and slams. Charging into a crate stuns him (double damage).');
      } },

      // ---------------- THE RESTART ----------------
      { type: 'cutscene', cleanup: ['elena', 'rhea', 'silas'], beats: [
        { cam: [ST.x, 900, 1.6] },
        { do: () => { if (!F().rheaBetrayed) Action.actor('rhea', { cast: 'rhea', x: 1835, y: 950, a: -Math.PI / 2, label: 'Rhea', labelColor: '#d9824a' }); } },
        { actor: { id: 'elena', cast: 'elena', x: 1875, y: 960, a: -Math.PI / 2, label: 'Dr. Elena Cruz', labelColor: '#e46a78' } },
        { actor: { id: 'silas', cast: 'silas', x: 1915, y: 950, a: -Math.PI / 2, label: 'Silas Crow', labelColor: '#c9b04a' } },
        { say: [['Tara "Sparks" Nair', '(radio) Turbines primed! Now it just needs the resources. Enough of them.', 'radio'],
                ['Silas Crow', 'And here we all are. Each of us hoping the others pay.'],
                ['Dr. Elena Cruz', 'If everyone thinks that, nobody pays, and we all sit in the dark.'],
                ['Tip', 'THRESHOLD PUBLIC GOODS: everyone decides at once how much to give. The grid restarts only if the total reaches the threshold, and then EVERYONE gets the power, even those who gave nothing.', 'sys']] },
      ] },
      { type: 'action', text: 'The last signal', run: () => publicGoodsScreen(() => {}) },
    ],
  };
  CHAPTERS[7] = MissionManager.compile(CH7);
})();
