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
function effectiveElo(cfg, opts = {}) {
  const base = Number(opts.oppElo) > 0 ? Number(opts.oppElo) : clampInt(cfg.targetElo, 1320, 3190, 1650);
  return Math.round(clamp(base + 130, 1320, 2600));
}

// How many centipawns a human at this rating actually loses per move. Rough
// fit to the published ACPL-vs-rating curve: generous at the bottom, tight at
// the top, and clamped so neither end becomes absurd.
function acplBand(elo) {
  const e = clamp(Number(elo) || 1500, 600, 3200);
  return Math.round(clamp(96 - e / 34, 8, 90));
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
  return {
    elo: effectiveElo(cfg, opts),
    slack: Math.max(clampInt(cfg.humanSlackCp, 0, 300, LEGIT.slack), LEGIT.slack),
    miss: LEGIT.miss,
    label: LEGIT.label
  };
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
    if (cand.cpLoss > profile.slack) continue;
    let weight = Math.exp(-cand.cpLoss / Math.max(18, profile.slack / 2));
    // Repeatedly taking #1 is the one pattern that reads as a machine. Once the
    // streak reaches three, a near-equal alternative gets a nudge, not a mandate.
    if ((opts.top1Streak || 0) >= 3 && cand.index === 0 && cand.cpLoss === 0) weight *= 0.35;
    if (cand.index > 0 && cand.cpLoss >= 8) weight *= 1.35;
    // The same first move every game is its own tell, separate from move choice.
    if (opts.repeatUci && cand.line.bestUci === opts.repeatUci) weight *= 0.28;
    eligible.push({ line: cand.line, cpLoss: cand.cpLoss, weight });
  }

  if (eligible.length === 0) return { line: best, cpLoss: 0, reason: 'best' };
  const picked = weightedPick(eligible);
  return { line: picked.line, cpLoss: picked.cpLoss, reason: profile.label };
}

// How long a person would spend here. Two draws averaged instead of one: the
// distribution is triangular, mostly near the middle, which is what real think
// times look like. The dials below are the ones a fixed timer cannot fake.
function computeDelay(cfg, opts = {}) {
  const lo = Math.max(250, cfg.minThinkMs);
  const hi = Math.max(lo + 100, cfg.maxThinkMs);
  const skew = (Math.random() + Math.random() + Math.random()) / 3;
  let ms = lo + (hi - lo) * skew;

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
  if (baseline) ms = clamp(baseline * (0.78 + 0.44 * skew), baseline * 0.65, baseline * 1.5);

  // Never answer much faster than the person across the board: a wall of
  // instant replies against someone taking ten seconds a move is a pattern.
  const tempo = Number.isFinite(opts.oppTempoMs) && opts.oppTempoMs > 300 ? opts.oppTempoMs : null;
  if (tempo) ms = Math.max(ms, Math.min(tempo * 0.35, 3200));

  if (opts.legalMoveCount && opts.legalMoveCount <= 3) ms *= 0.8;
  if (opts.isCheck) ms *= 1.12;
  if (opts.isCapture) ms *= 0.92;

  // Rare second thought, outside the normal window. The pattern-breaker a
  // bounded uniform delay does not have.
  if (opts.allowRethink && Math.random() < 0.035) ms *= rand(1.45, 1.95);

  if (cfg.pauseOnLowClock && Number.isFinite(opts.clockSeconds)) {
    if (opts.clockSeconds <= 8) ms = Math.min(ms, 420);
    else if (opts.clockSeconds <= cfg.clockFloorSeconds) ms = Math.min(ms, 900);
  }
  return Math.round(clamp(ms, 250, 9000));
}
