# THE LAST SIGNAL
### A Third-Person Story Game Built on Game Theory

**Project report**

Student name: ____________________  Roll no.: __________
Course / Department: ____________________
Institution: ____________________
Guide: ____________________  Academic year: __________

---

## Abstract

*The Last Signal* is a third-person, open-world story game set in Solace City, 18 months after a total blackout. Four surviving colonies (Lakeside, Ironside, Mercy Hospital and Crow's Market) must decide whether to trust each other long enough to restart the city's power grid, while a private company, Helix, tries to keep the lights off.

The main idea of the project is that **every major story decision is a real game-theory model**. It is not a scripted choice. The player meets the Prisoner's Dilemma, the Repeated Prisoner's Dilemma, the Game of Chicken, the Stag Hunt, the Tragedy of the Commons, Bayesian updating with signalling, and a Threshold Public Goods game. Each rival colony leader is controlled by a classical strategy from the literature, such as Tit-for-Tat, Grim Trigger, Generous Tit-for-Tat or an Opportunist that learns. Each leader remembers every past interaction through a weighted trust model. The ending the player receives, and a final "strategy report" that says which known strategy the player most resembled, both come from how the player actually behaved.

The project has two parts:
1. **A game-theory engine in Unreal Engine 5 (C++).** It includes a Nash-equilibrium solver, seven AI strategies, trust and hostility systems, save/load, a debug console and automated tests.
2. **A complete, playable browser version (JavaScript + Three.js).** It has a Prologue and seven chapters of action gameplay: combat, stealth, driving, chases, boss fights and defence. It uses real-time 3D graphics with day/night lighting, weather, animated clothed characters and detailed vehicles.

---

## 1. Introduction

### 1.1 Motivation
Game theory is usually taught with abstract payoff tables, which students find hard to relate to real decisions. Video games are good at making players *feel* the consequences of their choices. This project combines the two. The player does not read about the Prisoner's Dilemma; they live through it, and they see the equilibrium, the payoff matrix and the reasoning behind the AI's move right after they decide.

### 1.2 Problem statement
To design and build a playable game in which:
- each key decision is a formally correct game-theory model with a real payoff matrix;
- AI opponents follow well-known strategies and remember the player's history;
- earlier choices change later chapters, the ending, and the player's allies and enemies;
- the underlying maths (equilibria, mixed strategies, Bayes' rule) is shown and explained to the player.

### 1.3 Objectives
1. Build a reusable game-theory engine: payoff matrices, a 2×2 Nash solver, and seven strategies.
2. Model trust and reputation, so that the AI reacts to the player's *history* and not only to the last move.
3. Build a story campaign in which each chapter teaches one game-theory concept through gameplay.
4. Deliver action gameplay (combat, stealth, vehicles, chases, bosses) so that the game is engaging, not just a quiz.
5. Present the game in real-time 3D with a believable atmosphere.
6. Verify the maths with automated tests.

### 1.4 Scope
- **Unreal Engine 5 project:** Milestone 1 (project setup) and Milestone 2 (the complete game-theory engine in C++, with tests and a debug console).
- **Browser game:** the full playable campaign: Prologue plus Chapters 1–7, four endings and a strategy report.

---

## 2. Background: game-theory concepts used

| Concept | Short definition | Where it appears |
|---|---|---|
| Nash equilibrium | A pair of strategies where neither player can gain by changing only their own move | Every decision screen |
| Prisoner's Dilemma (PD) | Defecting is dominant for both players, yet mutual cooperation pays more | Chapter 1 |
| Repeated PD / shadow of the future | When players meet again, cooperation can be rational | Chapter 2 |
| Game of Chicken, mixed strategies | Two pure equilibria; the mixed equilibrium randomises | Chapter 4 |
| Stag Hunt | Payoff dominance vs risk dominance; coordination needs trust | Chapter 5 |
| Tragedy of the Commons | Individually rational over-use destroys a shared resource | Chapter 3 |
| Incomplete information, Bayes' rule, signalling | Updating beliefs from evidence; cheap talk | Chapter 6 |
| Threshold Public Goods | The good is provided only if total contributions reach a threshold; free-riding is tempting | Chapter 7 |
| Axelrod's tournaments | Round-robin competition between repeated-PD strategies | Debug console, strategy report |

### 2.1 Payoff matrices used (row player = you, column player = AI)
Action 0 is always the cooperative move and action 1 the selfish move.

- **Prisoner's Dilemma** (T = 5, R = 3, P = 1, S = 0): A = [[3, 0], [5, 1]]. Valid because T > R > P > S and 2R > T + S.
- **Game of Chicken:** A = [[3, 1], [5, 0]] (Swerve / Stay).
- **Stag Hunt:** A = [[5, 0], [3, 3]] (Stag / Hare).
- **Matching Pennies:** A = [[1, −1], [−1, 1]] (used to test the solver).

### 2.2 Solver results (checked by the automated tests)
- **PD:** the only Nash equilibrium is (Defect, Defect). Defect is strictly dominant, and (D, D) is *not* Pareto-optimal.
- **Chicken:** pure equilibria are (Swerve, Stay) and (Stay, Swerve). In the mixed equilibrium each driver swerves with probability 1/3.
- **Stag Hunt:** equilibria are (Stag, Stag), which is payoff-dominant, and (Hare, Hare), which is risk-dominant. Hunting the stag is a best response only when the belief that the partner will also hunt it is at least 0.6.
- **Matching Pennies:** no pure equilibrium; the mixed equilibrium is 50/50.

---

## 3. Game design

### 3.1 Story and setting
Solace City has been dark for 18 months. The player is **Veer Malhotra**, an engineer from Lakeside who holds the city's water. Each other colony controls one resource that the grid restart needs:

| Colony | Leader | Resource | AI strategy |
|---|---|---|---|
| Ironside Refinery | Rhea "Iron" Dutta | Fuel | Grim Trigger |
| Mercy Hospital | Dr. Elena Cruz | Medicine | Generous Tit-for-Tat |
| Crow's Market | Silas Crow | Food | Opportunist |

Supporting characters: Tara "Sparks" Nair (engineer and ally), Baba Jogi (radio operator), Director Kane (Helix, the antagonist) and Razor (a raider boss).

### 3.2 Chapter structure

| Chapter | Title | Game-theory model | Main gameplay |
|---|---|---|---|
| Prologue | Blackout | Introduction | Warehouse fight, defending the water tanks, meeting Razor |
| 1 | First Contact | One-shot Prisoner's Dilemma | Turret run with a burning-bus QTE, rooftop snipers, climbing and ziplines, courtyard fight |
| 2 | Iron Handshake | Repeated PD against Grim Trigger | Refinery fire rescue on a timer, tanker escort, 5 repeated rounds |
| 3 | The Poisoned River | Tragedy of the Commons | Boat chase, dam jump, night stealth infiltration, 4-day river council |
| 4 | The Bridge | Game of Chicken (mixed strategies) | Foot chase over rooftops, market brawl, head-on convoy standoff |
| 5 | Stag Hunt | Stag Hunt (coordination) | Choose a partner, stealth depot raid, drone nest, defend the generator core |
| 6 | Kane's Offer | Bayesian updating + signalling | Hack three relay towers (drones, rooftop sniper, stealth post), retaliation fight |
| 7 | The Last Signal | Threshold Public Goods | Road to the power station, 3-wave siege with earned allies, Razor boss fight, the restart vote |

### 3.3 How choices carry forward
Consequences are stored as flags and read by later chapters. For example:
- Betraying Elena in Chapter 1 means she confronts Veer at the Chapter 3 council. Keeping the deal brings a Mercy medic to the final siege.
- Betraying Rhea in Chapter 2 triggers Grim Trigger for good. Ironside guards turn hostile, there is no fuel in Chapter 7 (Veer must walk), and Rhea ambushes him on the way to the station. Staying loyal gives an armoured jeep and brings Rhea to the finale as an ally.
- If the river dies in Chapter 3, the riverbed stays dry, dust storms follow for the rest of the game, and every colony loses 50 resources.
- A crash in the Chapter 4 Chicken game collapses the bridge to vehicles for the rest of the game.
- Securing the generator core in Chapter 5 adds +30 to the final restart.
- A colony that secretly accepted Kane's bribe in Chapter 6 and was not exposed holds back half its contribution in Chapter 7.

### 3.4 Endings
The ending is computed from the final Public Goods result and from the player's overall cooperation rate:

| Ending | Condition |
|---|---|
| **Dawn** | The grid restarts and every colony, including you, contributes at least 50 |
| **Brownout** | The grid restarts but some colonies held back, or the total came close (≥ 200) |
| **Iron Rule** | The player cooperated in less than 35% of all decisions |
| **Silence** | The restart fails |

After the ending, a **strategy report** shows a cooperation-over-time chart, total payoffs against each colony, final trust, and which classical strategy the player's moves matched most closely.

---

## 4. The game-theory engine

### 4.1 Design principles
- **Simultaneous moves:** the AI chooses its move *before* the player's move is recorded, so it only ever sees past rounds.
- **Stateless strategies:** each strategy computes its move from the history alone. A colony's strategy can therefore be swapped at any time, and the new strategy still responds correctly to the existing history.
- **One engine, many games:** action 0 is always "cooperate" and action 1 "defect". The payoff table supplies the labels (Swerve/Stay, Stag/Hare…).

### 4.2 AI strategies

| Strategy | Rule |
|---|---|
| Always Cooperate | Cooperates every round |
| Always Defect | Defects every round (the one-shot Nash strategy) |
| Tit-for-Tat | Cooperates first, then copies the player's last move |
| Generous Tit-for-Tat | Like Tit-for-Tat, but forgives a betrayal 30% of the time |
| Grim Trigger | Cooperates until the player defects once, then defects forever |
| Pavlov (Win-Stay, Lose-Shift) | Repeats its move after a good payoff (R or T), otherwise switches |
| Opportunist | Learns how the player reacts and plays whatever maximises its expected payoff |

### 4.3 Key formulas

| Item | Formula |
|---|---|
| Pure Nash equilibrium at (i, j) | A[i][j] ≥ A[1−i][j] **and** B[i][j] ≥ B[i][1−j] |
| Mixed equilibrium | q = (A₁₁ − A₀₁) / (A₀₀ − A₀₁ − A₁₀ + A₁₁), p = (B₁₁ − B₁₀) / (B₀₀ − B₁₀ − B₀₁ + B₁₁), valid only if both are strictly between 0 and 1 |
| Risk dominance | The equilibrium with the larger product (A[i][j] − A[1−i][j]) · (B[i][j] − B[i][1−j]) |
| Trust (0–100) | 100 · Σ wₖ·coopₖ / Σ wₖ, with wₖ = 0.8^age. The starting trust of 50 counts as the oldest "phantom" round, so recent moves matter most |
| Hostility (0–5 stars) | 5 if Grim Trigger has fired; otherwise ⌈(50 − trust) / 10⌉, clamped to 0–5 |
| Opportunist | V(a) = EV(a, p_now) + δ · max EV(p_after(a)), δ = 0.9, where p_after is the player's learned reaction |
| Silas in Chicken | Belief that you will Stay = s = (defections + 1) / (decisions + 2). Swerve pays 3 − 2s and Stay pays 5 − 5s, so Silas stays when s < 2/3 |
| Partner in Stag Hunt | Hunts the stag only if trust / 100 ≥ 0.6 (the mixed-equilibrium threshold) |
| Repeated PD | Cooperation is sustainable when δ ≥ (T − R) / (T − P) = 0.5 |
| Commons | River health ← min(100, health + 15 − Σ extraction). Low/Medium/High = 5/10/20. At 0 the river dies and every colony loses 50 |
| Bayes (Chapter 6) | Posterior = P(E \| bribed) · P(bribed) / P(E), with P(suspicious \| bribed) = 0.8 and P(suspicious \| refused) = 0.3 |
| Public goods | Endowment 100; the grid restarts if the total is ≥ 280; each colony's payoff = (100 − contribution) + 150 if restarted. AI contribution = base(strategy) × trust / 100, halved for a hidden bribe-taker |

### 4.4 Teaching layer
After every decision the game shows the **payoff matrix** with the chosen cell highlighted, the equilibrium or equilibria, and a plain-language explanation of *why* the AI chose its move, for example "Silas estimated you would Stay with probability 0.42…". A **Codex** unlocks an entry for each concept met (Nash equilibrium, Pareto optimality, Grim Trigger, Axelrod's tournaments, mixed strategies and so on).

---

## 5. System architecture

### 5.1 Unreal Engine 5 implementation (C++)
```
Source/LastSignal/GameTheory/
  GameTheoryTypes.h        Enums, FRoundRecord, FColonyHistory, FPayoffMatrix (Data Table row)
  NashSolver.h/.cpp        2x2 solver: pure NE, mixed NE, dominance, Pareto, risk dominance
  Strategies/              Abstract UStrategy base class + 7 concrete strategies
  GameTheorySubsystem.*    UGameInstanceSubsystem: rounds, trust, hostility, Commons,
                           Public Goods, save/load, debug console commands
  LastSignalSettings.*     Project Settings page (strategy per colony, tunable numbers)
  LastSignalSaveGame.h     USaveGame
Source/LastSignal/Tests/   Automation tests for the maths
Data/DT_PayoffMatrices.csv Payoff matrices as an Unreal Data Table
```
- The subsystem is a `GameInstanceSubsystem`, so colony memory survives level changes, and Blueprints can reach it directly.
- Rendering settings target UE5 features (Lumen, Nanite, Virtual Shadow Maps), with a Low preset for mid-range GPUs (GTX 1660).
- **Debug console:** `LS.Status`, `LS.Play`, `LS.SetStrategy`, `LS.Solve`, `LS.Commons`, `LS.PublicGoods`, `LS.Tournament` and `LS.Reset`.

### 5.2 Browser implementation: "2D simulation, 3D presentation"
All game logic (missions, dialogue, game theory, combat, stealth, vehicles, bosses) runs as a 2D simulation on the city map in `web/*.js`. A separate 3D engine (`game3d/`, built with Vite and Three.js into `web/engine/engine.js`) *draws* that simulation every frame, converting map coordinates to world metres (1 map pixel = 0.2 m). This separation means:
- gameplay code stays simple and testable, and can also be played as a classic top-down 2D game (`?2d`);
- the graphics can be improved independently of the gameplay.

| Module | Responsibility |
|---|---|
| `gametheory.js` | Payoff matrices, strategies, Nash solver, tournament, strategy matching |
| `game.js` | World, player, combat, vehicles, trust, dialogue, decisions, codex, endings, strategy report |
| `action.js` | Cover, dodge roll, melee, takedowns, stealth AI (vision cones, alarms), climbing and ziplines, turrets, chases, hacking, QTEs, bosses, ally AI, defence waves |
| `missions.js` | Data-driven `MissionManager` (checkpoints, fail/retry, cutscenes, "Mission Passed" screen), the Prologue, the Action Lab test scenes |
| `chapter1.js` … `chapter7.js` | Each chapter written as data: a list of steps (`cutscene`, `goto`, `kill`, `chase`, `qte`, `action`, `checkpoint`, `passed`…) |
| `game3d/src/web3d/` | 3D engine: characters, vehicles, camera, aiming, effects |
| `game3d/src/world/` | City generation, sky and lighting, weather, water, vegetation, post-processing |

**Data-driven missions.** A mission is an ordered list of step objects, for example `{ type: 'kill', spawns: [...] }`. `MissionManager.compile()` turns each step into a `{ start, update }` object that the mission runner executes. Checkpoint steps save the game-theory state, weapons, time and weather, so a failed objective restarts from the last checkpoint.

---

## 6. Gameplay features
- **Third-person controls:** mouse-look camera over the shoulder, WASD relative to the camera, and aiming through a centre crosshair. The player accelerates and decelerates smoothly and turns toward the direction of travel, facing the crosshair only while aiming or shooting.
- **Combat:** pistol, rifle, melee pipe, cover (Q) with peeking, dodge roll, light and heavy melee, silent takedowns.
- **Stealth:** guard vision cones, a detection meter, security cameras (hackable), searchlights, hiding bodies, alarms that call reinforcements.
- **Traversal:** climbing fire escapes, rooftop ziplines, collapsing scaffolds.
- **Vehicles:** jeep, pickup, motorbike, tanker and boat; drive-by shooting, a mounted turret, ramming, chases.
- **Set pieces:** QTEs (quick-time events), timed escapes, a refinery fire, a boat chase with a dam jump, boss fights with three phases, and multi-wave defence with barricades, turrets and ally orders.
- **Allies:** companions who fight, can be downed and revived, and take commands (G).
- **Presentation:** letterboxed cutscenes with camera moves, radio dialogue, a "Mission Passed" screen with statistics, and an Examiner/demo panel that can jump to any chapter.

---

## 7. Graphics and presentation

### 7.1 World and lighting
- A procedurally laid-out city with districts, roads, props, vegetation and a river.
- A physically based sky (Rayleigh and Mie scattering) driven by an in-game clock, with sunrise, golden hour, sunset, and night with stars and moon.
- Cascaded shadow maps for sharp shadows near the player.
- Weather (fog, rain, dust) that changes fog, tint and sunlight.
- Point lights for street lamps, fires and floodlights, pooled for performance.
- **Night visibility:** strong moonlight and ambient light, automatic exposure adjustment, a lifted-shadow night colour grade, a soft fill light around the player, and a flashlight (L) that points where the player aims.

### 7.2 Post-processing
Ambient occlusion, bloom, god rays, ACES filmic tone mapping, a colour grade that blends day, golden hour, night and a special "Dawn" ending grade, depth of field when aiming or in cutscenes, motion blur, and screen-space reflections on wet streets. Graphics presets (Low, Medium, High, Ultra) are in the pause menu.

### 7.3 Characters
All people are **rigged, clothed and animated 3D models** from the *Ultimate Animated Character Pack* by Quaternius (CC0 public domain). Each character is given a fitting outfit:

| Character | Outfit |
|---|---|
| Veer | Casual (T-shirt, jeans) |
| Kane, Silas | Business suit |
| Rhea | Punk |
| Elena | Casual |
| Tara | Adventurer |
| Baba Jogi | Farmer |
| Razor | Worker |
| Helix troopers | SWAT |

Survivors receive a stable, randomly chosen outfit with recoloured skin and hair. An **animation state machine** crossfades between 24 motion-captured clips (idle, walk, run, gun idle, aim, shoot, run-and-shoot, punches, kicks, dodge roll, hit reaction and death), driven by the simulation state. Weapons are attached to the character's hand bone.

### 7.4 Vehicles
Vehicles are generated in code from **extruded side profiles** with rounded edges, so they have real silhouettes (hood, windscreen rake, roof, tailgate). They use clear-coat metallic paint, reflective tinted glass, rimmed tyres, wheel arches, bumpers, grilles, head and tail lights, mirrors and door lines. Each type has its own details: a roof rack and spare wheel on the jeep, a load bed on the pickup, and a rounded tank with bands, walkway and twin axles on the tanker.

---

## 8. Testing and validation
1. **Unit tests for the maths (Unreal Automation):** these check the Nash solutions of PD, Chicken, Stag Hunt and Matching Pennies, every strategy rule, and the trust weighting. Run them from Tools → Session Frontend → Automation, filtering on `LastSignal`.
2. **Axelrod-style tournament:** a round robin of all seven strategies over 200-round repeated PD matches, available from the debug console and the Examiner panel. It reproduces the classic result that "nice but retaliatory" strategies do well.
3. **Automated play-through:** a script drove Chapters 5, 6 and 7 from start to finish (dialogue, decisions, combat, hacking and defence), reaching the ending and the strategy report with no runtime errors.
4. **Action Lab:** one-click test scenes for each mechanic (stealth, boss, allies and defence, turret, boat, climbing, hacking, QTE, chase).
5. **Visual checks** in the browser for night lighting, character models and animations, weapons in hand, and vehicles.

*(Add your own screenshots and test results here: for example the automation test summary, a tournament ranking, and one screenshot per chapter.)*

---

## 9. Results and discussion
- The game shows that abstract concepts become intuitive when the player carries the consequences. For example, a single betrayal of Rhea (Grim Trigger) permanently changes the finale, which makes the "shadow of the future" concrete.
- Because strategies are stateless and trust is a weighted history, AI leaders behave consistently and believably: Elena forgives, Rhea never does, and Silas exploits a player he believes is soft.
- The ending and the strategy report close the loop by showing the player which strategy they were playing, which is an effective reflection tool for learning.

---

## 10. Limitations
- The Unreal Engine version currently covers Milestones 1 and 2 (engine and tests). The full campaign is playable in the browser version.
- Characters use stylised low-poly models, not photorealistic ones, and there is no dedicated crouch animation (the body is lowered instead).
- Vehicles are generated in code, not artist-modelled.
- The player cannot jump or vault; the simulation is 2D with no vertical physics for the player.
- The solver handles 2×2 games; larger games are not supported.

## 11. Future work
- Port the full campaign to Unreal Engine 5 using MetaHuman characters and the existing C++ engine (Milestone 3: the Decision Screen with slow motion, desaturation, cards, a timer and an animated payoff matrix).
- Solve n×m games and add evolutionary dynamics (replicator equations) between colonies.
- Add voice acting, a soundtrack, and a settings menu for graphics presets in Unreal.
- Run user studies to measure learning gains compared with textbook teaching.

## 12. Conclusion
*The Last Signal* shows that a game can be both an action game and a faithful, explainable model of strategic interaction. A reusable engine (a Nash solver, seven classical strategies, trust and reputation) drives a branching seven-chapter story in which every major decision is a real game. The maths is shown, explained and remembered, and the player's own behaviour is reflected back to them at the end.

---

## References
1. J. von Neumann and O. Morgenstern, *Theory of Games and Economic Behavior*, Princeton University Press, 1944.
2. J. F. Nash, "Equilibrium points in n-person games," *Proceedings of the National Academy of Sciences*, 36(1), 1950.
3. R. Axelrod, *The Evolution of Cooperation*, Basic Books, 1984.
4. G. Hardin, "The Tragedy of the Commons," *Science*, 162(3859), 1968.
5. J. Harsanyi and R. Selten, *A General Theory of Equilibrium Selection in Games*, MIT Press, 1988.
6. B. Skyrms, *The Stag Hunt and the Evolution of Social Structure*, Cambridge University Press, 2004.
7. M. Nowak and K. Sigmund, "A strategy of win-stay, lose-shift that outperforms tit-for-tat in the Prisoner's Dilemma game," *Nature*, 364, 1993.
8. Epic Games, *Unreal Engine 5 Documentation*, https://dev.epicgames.com/documentation
9. three.js, *three.js Documentation*, https://threejs.org/docs

## Acknowledgements / asset credits
- Character models and animations: *Ultimate Animated Character Pack* by **Quaternius** (quaternius.com), CC0 1.0 (public domain), obtained via poly.pizza.
- 3D rendering: three.js (MIT licence), postprocessing and n8ao (MIT licence), Rapier physics (Apache 2.0).
