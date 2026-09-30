/* =====================================================================
   THE LAST SIGNAL - GAME THEORY ENGINE (JavaScript port of the C++ M2)
   Pure logic, no drawing. Everything the story decides goes through here.

   Conventions
   - Action index 0 = cooperative move (Cooperate / Swerve / Stag)
     Action index 1 = selfish move    (Defect / Stay / Hare)
   - A[i][j] = PLAYER payoff, B[i][j] = AI payoff,
     i = player's action, j = AI's action.
   - A round record: { p: playerAction, a: aiAction, pp: playerPayoff,
                       ap: aiPayoff, ch: chapter, game: matrixKey }
   ===================================================================== */
(function (root) {
  'use strict';

  const C = 0, D = 1;

  // -------------------------------------------------------------------
  // 5.1  PAYOFF MATRICES   (standard PD: T=5, R=3, P=1, S=0)
  // -------------------------------------------------------------------
  const MATRICES = {
    PD_OneShot: {
      name: "Prisoner's Dilemma", a0: 'Send full shipment', a1: 'Send fake shipment',
      explain: 'Defecting pays more whatever the other side does, so in a single meeting both defect, even though both cooperating pays more.',
      A: [[3, 0], [5, 1]], B: [[3, 5], [0, 1]]
    },
    PD_Repeated: {
      name: "Repeated Prisoner's Dilemma", a0: 'Honour the deal', a1: 'Skim the cache',
      explain: 'When you will meet again, today’s betrayal costs tomorrow’s cooperation. The shadow of the future makes cooperating rational.',
      A: [[3, 0], [5, 1]], B: [[3, 5], [0, 1]]
    },
    Chicken: {
      name: 'Game of Chicken', a0: 'Swerve', a1: 'Stay',
      explain: 'Two stable outcomes: one side swerves, the other stays. Reputation decides who blinks, and both staying is a disaster.',
      A: [[3, 1], [5, 0]], B: [[3, 5], [1, 0]]
    },
    StagHunt: {
      name: 'Stag Hunt', a0: 'Go for the core', a1: 'Grab supplies',
      explain: 'Hunting the stag together pays most (payoff-dominant), but grabbing the hare is safe whatever your partner does (risk-dominant).',
      A: [[5, 0], [3, 3]], B: [[5, 3], [0, 3]]
    },
    Pennies: {
      name: 'Matching Pennies', a0: 'Heads', a1: 'Tails',
      explain: 'Pure conflict: no pure equilibrium exists, so both players must randomise 50/50.',
      A: [[1, -1], [-1, 1]], B: [[-1, 1], [1, -1]]
    }
  };

  /** T > R > P > S and 2R > T + S */
  function isPrisonersDilemma(m) {
    const T = m.A[1][0], R = m.A[0][0], P = m.A[1][1], S = m.A[0][1];
    return T > R && R > P && P > S && 2 * R > T + S;
  }

  // -------------------------------------------------------------------
  // 5.5  NASH EQUILIBRIUM SOLVER for any 2x2 game
  // -------------------------------------------------------------------
  const EPS = 1e-6;
  function solve(m) {
    const A = m.A, B = m.B;
    const r = { pure: [], mixed: null, domP: -1, domA: -1, pareto: [], risk: null };

    // Pure NE: each action is a best response to the other.
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const rowBest = A[i][j] >= A[1 - i][j] - EPS;
      const colBest = B[i][j] >= B[i][1 - j] - EPS;
      if (rowBest && colBest) r.pure.push([i, j]);
    }

    // Strictly dominant strategies (better against BOTH opponent actions).
    if (A[0][0] > A[1][0] && A[0][1] > A[1][1]) r.domP = 0;
    if (A[1][0] > A[0][0] && A[1][1] > A[0][1]) r.domP = 1;
    if (B[0][0] > B[0][1] && B[1][0] > B[1][1]) r.domA = 0;
    if (B[0][1] > B[0][0] && B[1][1] > B[1][0]) r.domA = 1;

    // Mixed NE (indifference principle):
    //   q = P(AI plays 0) makes the player indifferent,
    //   p = P(player plays 0) makes the AI indifferent.
    const dq = A[0][0] - A[0][1] - A[1][0] + A[1][1];
    const dp = B[0][0] - B[1][0] - B[0][1] + B[1][1];
    if (Math.abs(dq) > EPS && Math.abs(dp) > EPS) {
      const q = (A[1][1] - A[0][1]) / dq;
      const p = (B[1][1] - B[1][0]) / dp;
      if (p > EPS && p < 1 - EPS && q > EPS && q < 1 - EPS) {
        r.mixed = { p, q, payP: q * A[0][0] + (1 - q) * A[0][1], payA: p * B[0][0] + (1 - p) * B[1][0] };
      }
    }

    // Pareto-optimal cells: no other cell is >= for both and > for one.
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      let dominated = false;
      for (let k = 0; k < 2; k++) for (let l = 0; l < 2; l++) {
        if (A[k][l] >= A[i][j] && B[k][l] >= B[i][j] && (A[k][l] > A[i][j] || B[k][l] > B[i][j])) dominated = true;
      }
      if (!dominated) r.pareto.push([i, j]);
    }

    // Risk dominance (Harsanyi-Selten): larger product of deviation losses.
    if (r.pure.length === 2) {
      const [e1, e2] = r.pure;
      if (e1[0] !== e2[0] && e1[1] !== e2[1]) {
        const loss = e => (A[e[0]][e[1]] - A[1 - e[0]][e[1]]) * (B[e[0]][e[1]] - B[e[0]][1 - e[1]]);
        const l1 = loss(e1), l2 = loss(e2);
        if (Math.abs(l1 - l2) > EPS) r.risk = l1 > l2 ? e1 : e2;
      }
    }
    return r;
  }

  // -------------------------------------------------------------------
  // 5.2  AI STRATEGIES  (all stateless: they decide from history only,
  //      so they can be swapped live and still react to the past)
  //      History is from the AI's point of view: rec.p = opponent's move.
  // -------------------------------------------------------------------
  const everDefected = h => h.some(r => r.p === D);
  const byTrust = (h, trust) => trust >= 66 ? 'low' : trust >= 33 ? 'medium' : 'high';

  const STRATEGIES = {
    allc: {
      name: 'Always Cooperate', rule: 'Cooperates every round, no matter what.',
      choose: () => C, extract: () => 'low', base: () => 100
    },
    alld: {
      name: 'Always Defect', rule: 'Defects every round: the one-shot Nash strategy.',
      choose: () => D, extract: () => 'high', base: () => 0
    },
    tft: {
      name: 'Tit-for-Tat', rule: 'Cooperates first, then copies your last move.',
      choose: h => h.length ? h[h.length - 1].p : C, extract: byTrust, base: () => 90
    },
    gtft: {
      name: 'Generous Tit-for-Tat', rule: 'Copies your last move, but forgives a betrayal 30% of the time.',
      forgiveness: 0.3,
      choose(h, m, rng) {
        if (!h.length || h[h.length - 1].p === C) return C;
        return rng() < this.forgiveness ? C : D;
      },
      extract: byTrust, base: () => 95
    },
    grim: {
      name: 'Grim Trigger', rule: 'Cooperates until you defect once, then defects forever.',
      choose: h => everDefected(h) ? D : C,
      extract: h => everDefected(h) ? 'high' : 'low',
      base: h => everDefected(h) ? 0 : 100
    },
    pavlov: {
      name: 'Pavlov', rule: 'Win-Stay, Lose-Shift: repeats its move after R or T, otherwise switches.',
      choose(h, m) {
        if (!h.length) return C;
        const last = h[h.length - 1];
        const won = last.ap >= m.B[0][0] - EPS;   // "win" = got at least R
        return won ? last.a : 1 - last.a;
      },
      extract: byTrust, base: () => 85
    },
    opp: {
      name: 'Opportunist', rule: 'Learns how you react and plays whatever maximises its expected payoff.',
      delta: 0.9,   // shadow of the future
      choose(h, m) {
        // Learn: P(player cooperates | what I did last round), Laplace-smoothed.
        const coop = [0, 0], tot = [0, 0];
        for (let k = 1; k < h.length; k++) {
          const prev = h[k - 1].a;
          tot[prev]++; if (h[k].p === C) coop[prev]++;
        }
        const pAfter = [(coop[0] + 1) / (tot[0] + 2), (coop[1] + 1) / (tot[1] + 2)];
        const pNow = h.length ? pAfter[h[h.length - 1].a] : 0.5;
        // Expected payoff of my action a if the player cooperates with prob p.
        const ev = (a, p) => p * m.B[C][a] + (1 - p) * m.B[D][a];
        const best = p => Math.max(ev(C, p), ev(D, p));
        // One-step look-ahead: my move now changes how the player treats me next.
        const vC = ev(C, pNow) + this.delta * best(pAfter[C]);
        const vD = ev(D, pNow) + this.delta * best(pAfter[D]);
        return vC > vD ? C : D;
      },
      extract: (h, trust, river) => river > 60 ? 'high' : river > 30 ? 'medium' : 'low',
      base: () => 70
    }
  };

  // -------------------------------------------------------------------
  // 5.4  TRUST  = recency-weighted cooperation rate (0-100)
  //      newest round weight 1, older rounds 0.8, 0.64, ...
  //      Initial trust (50) is an extra, oldest "phantom" round.
  // -------------------------------------------------------------------
  function trust(h, decay = 0.8, initial = 50) {
    const n = h.length;
    let wSum = Math.pow(decay, n), score = wSum * initial / 100;
    for (let k = 0; k < n; k++) {
      const w = Math.pow(decay, n - 1 - k);
      wSum += w; score += w * (h[k].p === C ? 1 : 0);
    }
    return 100 * score / wSum;
  }

  // -------------------------------------------------------------------
  // 5.6  TRAGEDY OF THE COMMONS parameters
  // 5.7  PUBLIC GOODS parameters
  // -------------------------------------------------------------------
  const COMMONS = { start: 100, regen: 15, amounts: { low: 5, medium: 10, high: 20 }, deathPenalty: 50 };
  const PUBLIC = { endowment: 100, threshold: 280, gridBenefit: 150 };

  // -------------------------------------------------------------------
  // AXELROD-STYLE TOURNAMENT (viva demo)
  // -------------------------------------------------------------------
  function tournament(rounds = 200, rng = Math.random) {
    const ids = Object.keys(STRATEGIES), m = MATRICES.PD_Repeated;
    const total = Object.fromEntries(ids.map(i => [i, 0]));
    for (let x = 0; x < ids.length; x++) for (let y = x; y < ids.length; y++) {
      const X = STRATEGIES[ids[x]], Y = STRATEGIES[ids[y]];
      const hx = [], hy = []; let sx = 0, sy = 0;
      for (let r = 0; r < rounds; r++) {
        const ax = X.choose(hx, m, rng), ay = Y.choose(hy, m, rng);
        const px = m.B[ay][ax], py = m.B[ax][ay];
        sx += px; sy += py;
        hx.push({ p: ay, a: ax, ap: px, pp: py });
        hy.push({ p: ax, a: ay, ap: py, pp: px });
      }
      total[ids[x]] += sx; if (x !== y) total[ids[y]] += sy;
    }
    return ids.map(id => ({ id, name: STRATEGIES[id].name, score: total[id], perRound: total[id] / (rounds * ids.length) }))
      .sort((a, b) => b.score - a.score);
  }

  /**
   * "You played like..." - how often each strategy would have made the same
   * move as the player, given the moves the AI colonies actually made.
   * (Player becomes the "AI" in a mirrored history.)
   */
  function matchPlayer(histories) {
    const out = [];
    for (const id of Object.keys(STRATEGIES)) {
      const S = STRATEGIES[id]; let agree = 0, n = 0;
      for (const h of histories) {
        const mirror = [];
        for (const r of h) {
          const m = MATRICES[r.game] || MATRICES.PD_Repeated;
          let pC;   // probability the strategy cooperates here
          if (id === 'gtft') pC = (!mirror.length || mirror[mirror.length - 1].p === C) ? 1 : S.forgiveness;
          else pC = S.choose(mirror, m, Math.random) === C ? 1 : 0;
          agree += r.p === C ? pC : 1 - pC; n++;
          mirror.push({ p: r.a, a: r.p, ap: r.pp, pp: r.ap });
        }
      }
      out.push({ id, name: S.name, match: n ? agree / n : 0 });
    }
    return out.sort((a, b) => b.match - a.match);
  }

  const api = { C, D, MATRICES, STRATEGIES, COMMONS, PUBLIC, solve, trust, isPrisonersDilemma, tournament, matchPlayer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GTE = api;
})(typeof window !== 'undefined' ? window : globalThis);
