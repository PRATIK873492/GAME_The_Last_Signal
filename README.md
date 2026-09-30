# The Last Signal — M1 + M2

A third-person open-world story game where every major decision is a game-theory model.
This repo contains **Milestone 1** (project setup) and **Milestone 2** (the Game Theory engine).

```
LastSignal.uproject
Config/                       DefaultEngine.ini (Lumen/Nanite/VSM), DefaultGame.ini
Data/DT_PayoffMatrices.csv    Import as a Data Table (row struct: PayoffMatrix)
Source/LastSignal/
  GameTheory/
    GameTheoryTypes.h         Enums, FRoundRecord, FColonyHistory, FPayoffMatrix (Data Table row)
    NashSolver.h/.cpp         2x2 solver: pure NE, mixed NE, dominance, Pareto, risk dominance
    Strategies/Strategy.h     Abstract UStrategy base class
    Strategies/Strategies.*   AlwaysC, AlwaysD, TFT, Generous TFT, Grim, Pavlov, Opportunist
    GameTheorySubsystem.*     UGameInstanceSubsystem: rounds, trust, hostility, Commons, Public Goods, save/load, debug console
    LastSignalSettings.*      Project Settings page (strategy per colony, all tunable numbers)
    LastSignalSaveGame.h      USaveGame
  Tests/GameTheoryTests.cpp   Automation tests that check the maths
```

---

## M1: Project setup (about 1–2 hours)

**Prerequisites:** UE **5.4+** from the Epic Launcher, and **Visual Studio 2022** with the
*Game development with C++* workload plus the **.NET 6/8 SDK**.

1. Right-click `LastSignal.uproject` → **Generate Visual Studio project files**.
   (On 5.5 or later, right-click → *Switch Unreal Engine version* first.)
2. Open `LastSignal.sln`, set the configuration to **Development Editor | Win64**, and press **Build**. Then open the `.uproject`.
3. **Add the third-person character:** Content Browser → **Add → Add Feature or Content Pack → Blueprint → Third Person → Add to Project**.
   This adds `BP_ThirdPersonCharacter`, Enhanced Input actions and animations. We keep the template character for now; sprint, crouch, climb and cover come in M5.
4. **Create the content folders** from the design doc: `Content/LastSignal/{Blueprints,Core,Data,Maps,UI,Cinematics,Audio,VFX}`.
   Move the ThirdPerson folder into `Blueprints/Player` (right-click → *Fix Up Redirectors* afterwards).
5. **Import the payoff Data Table:** drag `Data/DT_PayoffMatrices.csv` into `Content/LastSignal/Data` and pick **PayoffMatrix** as the row type.
   Then go to **Project Settings → Game → Last Signal - Game Theory → Payoff Table** and select it.
   (The engine has the same four matrices built in, so it still works if you skip this step.)
6. **Basic city block:** File → New Level → *Open World* (World Partition on) → save it as `Maps/SolaceCity`.
   Switch to **Modeling Mode** (Shift+5) and block out one street: road, sidewalks, 4–6 box buildings, a few ramps and crates for traversal.
   Add a *PlayerStart*, then set **World Settings → GameMode Override = BP_ThirdPersonGameMode**.
   Megascans come later (M4). Keep it grey-box for now.
7. **Low preset for the GTX 1660:** type `sg.GlobalIlluminationQuality 1` and `r.Nanite.MaxPixelsPerEdge 2` in the console to test it. The settings menu in M9 will set these for you.
8. Press **Play**, then open the console with the `~` key and type `LS.Status`. If the colony table appears, M1 and M2 are wired up.

---

## M2: Game Theory engine

### Design overview
- **`UGameTheorySubsystem`** is a `GameInstanceSubsystem`, so it survives level changes and holds all colony memory.
  Blueprint access: `Get Game Instance → Get Subsystem (GameTheorySubsystem)`.
- **Simultaneous moves:** `PlayRound` asks the AI for its move *before* recording the player's move. The AI only sees past rounds.
- **Stateless strategies:** every strategy computes its move from the history alone. That means you can swap a colony's strategy
  **live** (Project Settings, `SetColonyStrategy`, or `LS.SetStrategy`) and the new strategy responds correctly to the existing history.
- **Action index convention:** action 0 is the cooperative move (Cooperate, Swerve, Stag) and action 1 is the selfish move (Defect, Stay, Hare).
  The Data Table supplies the labels, so one engine serves every chapter.

### Key formulas (for the viva)
| Item | Formula |
|---|---|
| PD validity | T > R > P > S, and 2R > T + S (5 > 3 > 1 > 0, 6 > 5) |
| Pure NE at (i,j) | A[i][j] ≥ A[1−i][j] **and** B[i][j] ≥ B[i][1−j] |
| Mixed NE | q = (A11−A01)/(A00−A01−A10+A11), p = (B11−B10)/(B00−B10−B01+B11); valid only if both are strictly between 0 and 1 |
| Risk dominance | the NE with the larger (A[i][j]−A[1−i][j])·(B[i][j]−B[i][1−j]) |
| Trust | 100 · Σ wₖ·coopₖ / Σ wₖ, with wₖ = 0.8^(age). The initial trust of 50 counts as the oldest "phantom" round. |
| Hostility | 5 if Grim has been triggered; otherwise ⌈(50 − trust)/10⌉, clamped to 0–5 |
| Opportunist | V(a) = EV(a, p_now) + δ · max EV(p_after(a)), where p_after is the player's learned reaction and δ = 0.9 |
| Commons | health ← min(100, health + 15 − Σ extraction). At 0 or below the river dies and every colony loses 50. |
| Public goods | AI contribution = base(strategy) × trust/100. The grid restarts if the total is ≥ 280. Payoff = (100 − c) + 150 if restarted. |

Solver results (all checked by the tests):
- **Prisoner's Dilemma:** the only NE is (D,D). D is dominant for both players, and (D,D) is *not* Pareto-optimal.
- **Chicken:** the pure NE are (Swerve,Stay) and (Stay,Swerve). The mixed NE is P(swerve) = 1/3.
- **Stag Hunt:** the NE are (Stag,Stag), which is payoff-dominant, and (Hare,Hare), which is risk-dominant. A player needs at least a 60% belief that the partner hunts the stag.

### Debug console (open with `~` in Play mode)
| Command | Example |
|---|---|
| `LS.Status` | Shows strategy, trust, stars, AI contribution and the last 20 moves for each colony |
| `LS.Play <colony> <moves> [row]` | `LS.Play Ironside CCCDC` shows Grim Trigger at work |
| `LS.SetStrategy <colony> <name>` | `LS.SetStrategy Crows TitForTat` |
| `LS.Solve <preset or 8 numbers>` | `LS.Solve Chicken`, or `LS.Solve 3 3 0 5 5 0 1 1` |
| `LS.Commons <Low\|Medium\|High>` | Run it 4 times to watch the river |
| `LS.PublicGoods <0-100>` | `LS.PublicGoods 100` |
| `LS.Tournament [rounds]` | Axelrod-style round robin of all 7 strategies |
| `LS.Reset` | Wipes memory and restores the default strategies |

**Suggested 2-minute viva demo:**
1. `LS.Solve PD`
2. `LS.Play Ironside CCCD`, then `LS.Status`. Ironside now has 5 stars.
3. `LS.Play Crows CCCCCCCC`. Silas exploits you.
4. `LS.Reset`, then `LS.Play Crows CDCDCC`. Silas learns you retaliate.
5. `LS.Tournament`

### Automated tests
Go to Tools → **Session Frontend** → Automation, filter on `LastSignal`, and click **Start Tests**.
The tests check the PD, Chicken, Stag Hunt and Matching Pennies solutions, every strategy rule, and the trust weighting.

---

**Next: M3.** The Decision Screen (slow-mo, desaturate, two cards, 15-second timer) and the animated Payoff Matrix widget. It reads `SolvePayoffMatrix` and binds to `OnRoundResolved`.

---

## Web game: Part A (action mechanics) + data-driven Prologue

Run it: `python -m http.server 8765 --directory web`, then open http://localhost:8765.

| File | What it holds |
|------|---------------|
| `web/game.js` | The original engine (world, combat, vehicles, trust, dialogue, decisions, codex). Part A adds small **HOOK** calls only; nothing was rewritten. |
| `web/action.js` | Part A mechanics: cover, dodge roll, melee, takedowns, stealth AI (vision cones, detection meter, alarms, bodies), rooftops/climbing/ziplines, drive-by, mounted turret, ramming, boat, ChaseController, hacking, QTEs, timers, bosses, ally AI, defense mode, fire, sabotage. |
| `web/chapter1.js` | Chapter 1 "First Contact": turret run with the burning-bus QTE, rooftop snipers (climb, zipline, takedowns), courtyard fight beside Mercy guards, the one-shot Prisoner's Dilemma, Kane's broadcast. Sets GT.flags (truckHealth, elenaDeal, betrayedElena, doctorAlly) for later chapters. |
| `web/chapter2.js` | Chapter 2 "Iron Handshake": refinery fire (timer, bursting pipes, smoke, valves, 4 rescues), Helix saboteurs, tanker escort (bikes, drones, armoured truck with engine/tyre weak points), Kane's private offer as round 1, and 4 open-world side jobs as rounds 2–5 against Grim Trigger, with running payoff totals. Sets rheaBetrayed / rheaAlly / noFuelCh7 / armoredJeep. |
| `web/chapter3.js` | Chapter 3 "The Poisoned River": boat chase (debris, oil fires, gunboats, dam-jump QTE, boarding QTE), barge crew fight, night stealth at the Helix pump station (cameras to hack, searchlights, patrols, 3 charges, alarm reinforcements), timed escape through a closing door, then the Council and 4 days of the Tragedy of the Commons. Elena confronts Veer if he betrayed her. |
| `web/chapter4.js` | Chapter 4 "The Bridge": foot chase through Crow's Market, climb, rooftop zipline, collapsing scaffold and tackle QTE; market brawl with fleeing civilians; the slow-motion Game of Chicken on the bridge (Silas the Opportunist); consequences bridgeWon / foodTax / bridgeShared / crash, which leaves the bridge closed to vehicles for good. |
| `web/chapter5.js` | Chapter 5 "Stag Hunt": choose a partner (they fight beside you), stealth raid on the Helix depot (cameras, searchlight, patrols; alarm brings drones), drone nest, then Stag or Hare. The partner hunts the stag only if trust ≥ 60 (q* = 0.6). Stag+Stag → GT.core (+30 to the restart) and a defence of the core; otherwise a fighting escape with crates. |
| `web/chapter6.js` | Chapter 6 "Kane's Offer": Kane's broadcast, three relay towers (hack under drone fire; rooftop climb vs a sniper; stealth listening post with a 45 s uplink hack), then `bayesScreen()` (prior → posterior, honest vs forged signal) and a Helix retaliation squad. Sets GT.traitor. |
| `web/chapter7.js` | Chapter 7 "The Last Signal": road to the station (armoured jeep / on foot / Rhea's Grim Trigger ambush, depending on Ch2), 3-wave siege of the control room with allies earned earlier (Tara, Rhea, Mercy medic, Ch5 partner), Razor boss fight, then `publicGoodsScreen()` → ending + strategy report. |
| `web/missions.js` | `MissionManager` (checkpoints, fail/retry, cutscenes, MISSION PASSED screen) plus the Prologue written as data, and `ActionLab` test scenes. |

**Data-driven missions.** A mission is a list of steps such as `{ type: 'kill', spawns: [...] }`. `MissionManager.compile()` turns each step into the `{ start, update }` object that the existing `Mission` runner already executes, so the dialogue, decision, matrix and trust systems are reused unchanged.

**Checkpoints.** A `checkpoint` step snapshots the game-theory state (`GT`), weapons, time and weather. If Veer dies or an objective fails (the chase target escapes, you're too slow on a QTE), the mission restarts from that step.

**Testing each mechanic.** Press **`** for the Examiner panel, then use **Action lab**: Stealth, Boss fight, Allies + defense, Turret run, Boat, Climb + zipline, Hacking, QTE, Chase.

**Controls:** Q cover (hold right mouse to peek) · Space dodge (Ctrl also works, but Ctrl+W closes the browser tab) · F/V light/heavy melee · E interact (takedown, climb, zipline, revive, defuse, turret, vehicles) · C crouch · B carry a body · G ally command · T barricade · L flashlight (night).

### One game, in 3D
Run: `python -m http.server 8765 --directory web`, then open http://localhost:8765. (Add `?2d` for the classic top-down view.)

**How it works (for the viva): "2D simulation, 3D presentation."** All game logic (missions, dialogue, game theory, combat, stealth, vehicles, bosses) runs in `web/*.js` on the city map in map pixels. `web/engine/engine.js` (built from `game3d/src/web3d/`) draws that simulation with the Phase 1–4 graphics: map (x, y) px → world (x·0.2, height, y·0.2) m.
- **Human scale:** `SCALE` in game.js shrinks and slows people and vehicles in 3D mode. The 2D game keeps SCALE = 1.
- **Collisions:** 3D props (wrecks, barriers, lamp posts) are added to the game's colliders, so what you see is what blocks you.
- **Controls:** third-person camera with mouse-look (click the game to lock the mouse). WASD moves relative to the camera, and you aim with the centre crosshair.
- **Graphics presets:** Low / Medium / High / Ultra, in the pause menu (Esc).

After editing `game3d/src`, rebuild the engine with: `cd game3d && npm run build:game`.

### Character models (3D)
- All people are rigged, clothed, animated models from Quaternius's **Ultimate Animated Character Pack** (CC0, public domain; `game3d/public/assets/people/`, credits in `CREDITS.txt`). Outfits: Casual2 (Veer), Suit (Kane, Silas), Punk (Rhea), Casual (Elena), Adventurer (Tara), Farmer (Baba Jogi), Worker (Razor), Swat (Helix troopers); survivors get a stable random outfit, with skin and hair recoloured.
- 24 shared motion clips drive a small state machine in `game3d/src/web3d/chars.js`: idle, walk, run, gun idle / aim / shoot, run-and-shoot, punches and kicks, roll, hit reaction, death. Guns are attached to the right hand bone.
- Vehicles (`game3d/src/web3d/vehicles.js`) are built in code from extruded side profiles with clear-coat paint, glass, rimmed tyres, arches, bumpers, grille, lights and mirrors.
