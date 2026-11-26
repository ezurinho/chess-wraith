// Move selection and pacing. The engine is not asked to play its raw #1 every
// time: on a fixed style it may take a near-equal alternative, in adaptive mode
// it studies the opponent and sits slightly above them, and the weaker presets
// miss on purpose at a low rate instead of playing every move perfectly.

function sideScore(line) {
  if (!line) return 0;
  if (line.mateIn !== null && line.mateIn !== undefined) {
    return line.mateIn > 0 ? 30000 - Math.min(2000, line.mateIn * 50) : -30000 + Math.min(2000, Math.abs(line.mateIn) * 50);
  }
  return typeof line.scoreCp === 'number' ? line.scoreCp : 0;
}

// Stockfish's Skill Level is 0..20 and roughly one step per ~90 Elo at the
// bottom of the scale, flattening at the top. This is the only strength dial
// the bundled 2019 build honours, so the styles go through it.
// The rating this account is allowed to play at. The account's own published
// rating is the anchor: a 1400 account that suddenly scores like a 2000 is the
// pattern every fair-play system looks for first, so the ceiling is its own
// level plus a hair, and the floor is its own level minus a bad day.
function effectiveElo(cfg, opts = {}) {
  const account = Number(opts.accountElo) > 0 ? Number(opts.accountElo) : null;
  const manual = Number(cfg.targetElo) > 0 ? Number(cfg.targetElo) : null;
  const base = clampInt(account || manual || 1500, 1320, 3190, 1500);
  const opp = Number(opts.oppElo) > 0 ? Number(opts.oppElo) : null;
  const anchored = opp ? opp + 130 : base;
  const hi = Math.min(base + 25, 3190);
  const lo = Math.min(base - 75, hi);
  // Form only moves inside the account's envelope: a bad game is the account
  // minus a few points, never a different player.
  const form = account ? clampInt(opts.form, -60, 60, 0) : 0;
  return Math.round(clamp(Math.min(anchored, hi) + form, lo, hi));
}

// How many centipawns a human at this rating actually loses per move. Rough
// fit to the published ACPL-vs-rating curve: generous at the bottom, tight at
// the top, and clamped so neither end becomes absurd.
function acplBand(elo) {
  const e = clamp(Number(elo) || 1500, 100, 3200);
  // Two curves, joined at the engine floor: below 1320 the beginner end is
  // steep (a 133 account gives away a piece every few moves), above it the
  // published rating/ACPL fit is the one that holds.
  const low = 320 - e * 0.2;
  const high = 96 - e / 34;
  return Math.round(clamp(e < 1320 ? low : high, 8, 320));
}

// Stockfish cannot be asked to play under 1320, so below that the strength
// cannot follow the account. What can follow it is the loss rate: aim the
// chooser at ~acplBand(account) and the moves look like the account's, not like
// a 1320 wall. Off with `levelPlay: false`.
function levelPlayTarget(accountElo, cfg) {
  if (cfg && cfg.levelPlay === false) return 0;
  const account = Number(accountElo) || 0;
  if (!account || account >= ELO_FLOOR) return 0;
  return clampInt(acplBand(account), 60, 320, 60);
}

// The engine's tenth-best move is still a master's tenth-best move: below its
// floor, re-weighting its own list cannot reach the account's loss rate. The
// moves that are missing get improvised instead, at a rate that closes the gap
// between what the search offers and the target: p = (target - 8) / 400. The cap
// is 0.85, not a half: measured on 1.65.2, an improvised move cost 286 cp at a
// 133 account but only half the moves were improvised, so the game averaged 118
// at a 293 band. A 133 misses most moves, not half of them.
function improvisationChance(target) {
  const t = Number(target) || 0;
  if (!(t > 0)) return 0;
  // The rate is what makes the band reachable at all, so it is derived from the
  // band: an improvised move costs roughly 300 cp and p * 300 has to reach the
  // band. Below the old curve nothing changes (a 133 account still draws 0.71);
  // above it, the rate stops promising what the game never pays - at a 1320
  // account the old curve asked for 13% and a whole game went by without one,
  // measuring 2 cp/move against a 60 cp band.
  return clamp(Math.max((t - 8) / 400, t / 300), 0, 0.85);
}

// A uniform draw over the legal moves is not a beginner, it is a random number
// generator: it walks the king into the open and ignores a free queen. A
// beginner's move is bad in a specific way — it grabs material, gives a check,
// develops, and rarely touches the king. This is the weight that makes the
// improvised move look like that kind of bad instead of any kind of bad.
function beginnerWeight(cand) {
  if (!cand) return 0;
  const capture = Number(cand.capture) || 0;
  let weight = 1 + capture * 1.5;
  // Leaving a piece where it can be taken for free is the other half of the
  // beginner: a 133 grabs material and then hangs the queen recapturing.
  const hanging = Number(cand.hanging) || 0;
  if (hanging > 0) weight += hanging * 2.5;
  if (cand.check) weight += 1.5;
  if (cand.castle) weight += 1.2;
  if (cand.piece === 'K' && !cand.castle) weight *= 0.15;
  if (cand.piece === 'Q' && Number(cand.ply) < 12) weight *= 0.5;
  return weight;
}

function pickImprovised(pool, rnd) {
  const rollWith = typeof rnd === 'function' ? rnd : Math.random;
  let total = 0;
  for (const cand of pool) total += beginnerWeight(cand);
  if (!(total > 0)) return pool[0];
  let roll = rollWith() * total;
  for (const cand of pool) {
    roll -= beginnerWeight(cand);
    if (roll <= 0) return cand;
  }
  return pool[pool.length - 1];
}

// The throttle nothing else has: when the account is playing far above its own
// rating, hand it more slack until the numbers look human again. It only ever
// moves in small steps, and only after 15 moves of evidence.
function acplGuard(opts) {
  const o = opts || {};
  const band = acplBand(o.elo);
  const samples = Number(o.samples) || 0;
  const acpl = Number(o.acpl) || 0;
  const boost = clampInt(o.boost, 0, 160, 0);
  if (samples < 15 || acpl <= 0) return { band, boost, verdict: 'wait' };
  if (acpl < band * 0.45) return { band, boost: clampInt(boost + 12, 0, 160, 0), verdict: 'raise' };
  if (acpl > band * 2 && boost > 0) return { band, boost: clampInt(boost - 8, 0, 160, 0), verdict: 'lower' };
  return { band, boost, verdict: 'hold' };
}

function styleProfile(cfg, opts = {}) {
  const elo = effectiveElo(cfg, opts);
  const level = levelPlayTarget(opts.accountElo || elo, cfg);
  return {
    elo,
    // Under Stockfish's 1320 floor the engine cannot be asked to play weaker,
    // so the window of moves it may pick from widens instead; level play also
    // needs the window to contain the moves it is aiming at.
    slack: Math.min(720, Math.max(clampInt(cfg.humanSlackCp, 0, 300, LEGIT.slack), LEGIT.slack, level * 2) + floorSlack(opts.accountElo || elo)),
    miss: LEGIT.miss,
    label: level > 0 ? 'level' : LEGIT.label,
    level
  };
}

// The engine stops on `go depth N` before the clock is spent, which is fine when
// N is what the account can use and wrong when it is not: measured 2026-11-26 on
// an Italian middlegame with MultiPV 4, depth 14 finished in 121 ms of a 700 ms
// budget (and in 218 ms of 3000) and answered g8f6; the same budget with the cap
// at 22 reached depth 16 and answered f8c5. The default is right for a 1500
// account and caps a 2200 one seven plies under what its clock pays for, so the
// cap follows the anchor.
function depthForAccount(baseDepth, elo) {
  const base = clampInt(baseDepth, 4, 22, 14);
  const step = Math.max(0, Math.round((Number(elo) - 1500) / 100));
  return clampInt(base + step, base, 22, base);
}

function weightedPick(items) {
  const total = items.reduce((acc, item) => acc + item.weight, 0);
  if (!(total > 0)) return items[0] || null;
  let roll = Math.random() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

// The account's own move, when the search never put it on the table: the one
// case a repertoire table cannot win on its own.
function openingProbeTarget(shares, lines) {
  if (!shares) return null;
  const known = new Set((lines || []).map((line) => sanKey(line && line.bestSan)));
  const rows = Object.entries(shares)
    .filter(([san, share]) => Number(share) >= 0.6 && !known.has(sanKey(san)))
    .sort((a, b) => b[1] - a[1]);
  if (!rows.length) return null;
  return { san: sanKey(rows[0][0]), share: Number(rows[0][1]) };
}

// The real loss of a move, measured after the fact: the eval of the position
// before it, minus the eval after it, both in white's centipawns. Improvised
// moves have no search line of their own, so claiming a number for them (the
// old `cpLoss: target`) reported the target as if it had been measured.
function myLossFromWhiteCp(side, before, after) {
  if (typeof before !== 'number' || typeof after !== 'number') return null;
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
  const raw = side === 'w' ? before - after : after - before;
  return clamp(Math.round(raw), 0, 600);
}

function chooseMove(lines, cfg, opts = {}) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const best = lines[0];
  if (!best || !best.bestUci) return null;

  if (best.mateIn !== null && best.mateIn > 0 && best.mateIn <= 3) {
    return { line: best, cpLoss: 0, reason: 'mate' };
  }
  const profile = styleProfile(cfg, opts);
  if (profile.slack <= 0 || lines.length === 1) {
    return { line: best, cpLoss: 0, reason: 'best' };
  }

  const bestScore = sideScore(best);
  const legal = [];
  for (let i = 0; i < lines.length; i++) {
    const cand = lines[i];
    if (!cand || !cand.bestUci) continue;
    if (cand.mateIn !== null && cand.mateIn < 0 && (best.mateIn === null || best.mateIn >= 0)) continue;
    const drop = Math.max(0, bestScore - sideScore(cand));
    legal.push({ line: cand, cpLoss: drop, index: i });
  }
  if (legal.length === 0) return { line: best, cpLoss: 0, reason: 'best' };

  const target = profile.level || 0;
  // A move the search never saw, because it is not good enough to be in the top
  // N. This is what a beginner's move actually is.
  // `length > 5` was a proxy for "there is something to choose from", and it
  // silently disabled improvising wherever the search only offered a short list:
  // at a 1320 account the list is four moves, so the gate never opened and a
  // 0.20 rate produced zero improvised moves in twelve.
  if (target > 0 && Array.isArray(opts.improvise) && opts.improvise.length > 1) {
    const rnd = typeof opts.rng === 'function' ? opts.rng : Math.random;
    if (rnd() < improvisationChance(target)) {
      const pool = opts.improvise.filter((c) => c && c.uci && c.uci !== best.bestUci);
      if (pool.length) {
        // If the position offers a move that leaves material on a covered
        // square, that is the move this account plays. Weighting it against the
        // captures was not enough: taking a free pawn is a good move, and the
        // measured loss stayed at 6 cp against a 293 band.
        const loose = pool.filter((c) => Number(c.hanging) > 0);
        const pick = pickImprovised(loose.length ? loose : pool, rnd);
        return {
          line: { bestUci: pick.uci, bestSan: pick.san || '' },
          cpLoss: target,
          reason: 'level',
          improvised: true
        };
      }
    }
  }

  // A deliberate miss. Only the weaker presets carry a rate, it is capped at
  // 2.5x the normal slack so it stays plausible for the level, and it never
  // throws away a forced mate.
  if (profile.miss > 0 && Math.random() < profile.miss) {
    const misses = legal.filter((c) => c.cpLoss > profile.slack && c.cpLoss <= profile.slack * 2.5);
    if (misses.length > 0) {
      const picked = weightedPick(misses.map((c) => ({ ...c, weight: 1 / (1 + c.cpLoss / 60) })));
      if (picked) return { line: picked.line, cpLoss: picked.cpLoss, reason: 'miss' };
    }
  }

  const eligible = [];
  for (const cand of legal) {
    // A probed line carries the move this account actually plays, which the
    // search never offered: the slack is the wrong ruler for it, and a bounded
    // allowance is what makes the repertoire playable instead of decorative.
    const allowance = cand.line.opening && opts.openingShares ? 70 : 0;
    if (cand.cpLoss > profile.slack + allowance) continue;
    // In the opening the account's own move is the evidence, not the eval spread:
    // a pet line that costs 80 cp is still the line this player plays every game.
    const spread = cand.line.opening && opts.openingShares ? Math.max(120, profile.slack * 3) : Math.max(18, profile.slack / 2);
    let weight;
    if (target > 0) {
      // Centred on the account's loss rate, not on zero: a 133 account does
      // not play the fourth-best move every time, it plays moves of that size.
      const sigma = Math.max(60, target * 0.55);
      weight = 0.01 + Math.exp(-Math.pow(cand.cpLoss - target, 2) / (2 * sigma * sigma));
      // Handing over a forced mate is not beginner play, it is broken play.
      if (cand.cpLoss > target * 2 + 80) weight = 0.005;
    } else {
      weight = Math.exp(-cand.cpLoss / spread);
    }
    // Repeatedly taking #1 is the one pattern that reads as a machine. Once the
    // streak reaches three, a near-equal alternative gets a nudge, not a mandate.
    if ((opts.top1Streak || 0) >= 3 && cand.index === 0 && cand.cpLoss === 0) weight *= 0.35;
    if (cand.index > 0 && cand.cpLoss >= 8) weight *= 1.35;
    // The account's own opening habits, counted from its published games. A
    // repertoire is the most stable thing about a player's games, and four first
    // moves at 25% each is the opposite of a repertoire.
    const share = opts.openingShares ? Number(opts.openingShares[sanKey(cand.line.bestSan)]) || 0 : 0;
    // The shares are the truth, so the weight is nearly the share itself: an
    // account that played 1.e4 in 60 of 60 games should not open 1.d4 one game in
    // five.
    if (opts.openingShares) weight *= 0.02 + share;
    // The same first move every game is its own tell, separate from move choice
    // — unless it is the move this account actually plays that often.
    if (opts.repeatUci && cand.line.bestUci === opts.repeatUci && share < 0.3) weight *= 0.28;
    eligible.push({ line: cand.line, cpLoss: cand.cpLoss, weight });
  }

  if (eligible.length === 0) return { line: best, cpLoss: 0, reason: 'best' };
  const picked = weightedPick(eligible);
  return { line: picked.line, cpLoss: picked.cpLoss, reason: profile.label };
}

// A session has a shape: the first half hour is the sharpest, and after three
// hours the same player takes about 6% longer per move. Real time-on-task data
// shows the interval creeping up ~2% an hour (de Jong et al. 2020), and the
// typing model nitro-wraith ships uses the same drift.
function fatigueFactor(sessionMs) {
  const hours = Number(sessionMs) > 0 ? Number(sessionMs) / 3600000 : 0;
  return 1 + clamp(hours * 0.02, 0, 0.06);
}

// How long a person would spend here. Two draws averaged instead of one: the
// distribution is triangular, mostly near the middle, which is what real think
// times look like. The dials below are the ones a fixed timer cannot fake.
function computeDelay(cfg, opts = {}) {
  const lo = Math.max(250, cfg.minThinkMs);
  const hi = Math.max(lo + 100, cfg.maxThinkMs);
  const skew = (Math.random() + Math.random() + Math.random()) / 3;
  let ms = lo + (hi - lo) * skew;

  // A restricted search already spent part of this move's thinking.
  ms -= clamp(Number(opts.spentMs) || 0, 0, 4000);
  const ply = Number.isFinite(opts.plyCount) ? opts.plyCount : 16;
  if (ply < 6) ms *= 0.72;
  else if (ply > 60) ms *= 0.86;

  // Uncertainty: a position with one obvious move is played faster than one
  // where two lines are 100cp apart.
  const gap = Number.isFinite(opts.gapCp) ? Math.abs(opts.gapCp) : null;
  if (gap !== null) {
    if (gap <= 12) ms *= 0.82;
    else if (gap >= 90) ms *= 1.28;
  }

  // The account's own rhythm. Once there is a baseline, a move that is wildly
  // faster or slower than this account usually plays is the loudest signal on
  // the page, so the delay stays inside a band around it.
  const baseline = Number.isFinite(opts.baselineMs) && opts.baselineMs > 0 ? opts.baselineMs : null;
  // Centred on the account, not clamped into its band: clamping a uniform draw
  // piles mass on both edges and makes the median of every game drift with it.
  // A symmetric draw never produces the long think that a human produces once in a
  // while: the shape below is right-skewed, mostly near the median with a real tail.
  if (baseline) {
    const shape = [0.55, 0.7, 0.85, 0.95, 1, 1.05, 1.15, 1.3, 1.55, 1.95];
    const amp = shape[Math.min(shape.length - 1, Math.floor(Math.random() * shape.length))] * (0.95 + 0.1 * skew);
    ms = clamp(baseline * amp, baseline * 0.65, baseline * 1.5);
  }

  // Never answer much faster than the person across the board: a wall of
  // instant replies against someone taking ten seconds a move is a pattern.
  const tempo = Number.isFinite(opts.oppTempoMs) && opts.oppTempoMs > 300 ? opts.oppTempoMs : null;
  if (tempo) ms = Math.max(ms, Math.min(tempo * 0.35, 3200));

  if (opts.legalMoveCount === 1) ms *= 0.45;
  else if (opts.legalMoveCount && opts.legalMoveCount <= 3) ms *= 0.8;
  ms *= fatigueFactor(opts.sessionMs);
  if (opts.isCheck) ms *= 1.12;
  if (opts.isCapture) ms *= 0.92;

  // Time control sets the scale. A 1-minute game is not played with the same
  // deliberation as a 15+10, and a fixed window is the tell that says so.
  // Except when the baseline itself was measured for this time class: the
  // published median already is the bullet or rapid number, and scaling it
  // again played a 1-minute game at half the account's own rhythm.
  const budget = Number(opts.budgetSeconds);
  if (!(baseline && opts.baselineClassScoped) && Number.isFinite(budget) && budget > 0) {
    if (budget < 120) ms *= 0.5;
    else if (budget < 300) ms *= 0.78;
    else if (budget >= 600) ms *= 1.15;
  }

  // Rare second thought, outside the normal window. The pattern-breaker a
  // bounded uniform delay does not have.
  if (opts.allowRethink && Math.random() < 0.035) ms *= rand(1.45, 1.95);

  if (cfg.pauseOnLowClock && Number.isFinite(opts.clockSeconds)) {
    if (opts.clockSeconds <= 8) ms = Math.min(ms, 420);
    else if (opts.clockSeconds <= cfg.clockFloorSeconds) ms = Math.min(ms, 900);
  }
  // Never spend more than a eighteenth of what is left on one move. The published
  // baseline is honest - it is what the account does - but with forty seconds on
  // the clock a six second median is how a person flags, and people do not flag
  // by playing their usual rhythm: they start moving in a second.
  if (cfg.pauseOnLowClock && Number.isFinite(opts.clockSeconds) && opts.clockSeconds > 0) {
    ms = Math.min(ms, Math.max(280, (opts.clockSeconds * 1000) / 18));
  }
  return Math.round(clamp(ms, 250, 9000));
}
