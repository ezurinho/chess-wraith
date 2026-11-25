// Move selection and pacing. The engine is not asked to play its raw #1 every
// time: on a fixed style it may take a near-equal alternative, and in adaptive
// mode it studies the opponent first and then plays slightly above them.

function sideScore(line) {
  if (!line) return 0;
  if (line.mateIn !== null && line.mateIn !== undefined) {
    return line.mateIn > 0 ? 30000 - Math.min(2000, line.mateIn * 50) : -30000 + Math.min(2000, Math.abs(line.mateIn) * 50);
  }
  return typeof line.scoreCp === 'number' ? line.scoreCp : 0;
}

function styleProfile(cfg) {
  const preset = STYLES[cfg.style] || STYLES.adaptive;
  return {
    elo: preset.elo,
    slack: cfg.style === 'engine' ? 0 : Math.max(cfg.humanSlackCp, preset.slack),
    label: preset.label
  };
}

function chooseMove(lines, cfg, opts = {}) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const best = lines[0];
  if (!best || !best.bestUci) return null;

  if (best.mateIn !== null && best.mateIn > 0 && best.mateIn <= 3) {
    return { line: best, cpLoss: 0, reason: 'mate' };
  }
  const profile = styleProfile(cfg);
  if (profile.slack <= 0 || lines.length === 1) {
    return { line: best, cpLoss: 0, reason: 'best' };
  }

  const bestScore = sideScore(best);
  const eligible = [];
  for (let i = 0; i < lines.length; i++) {
    const cand = lines[i];
    if (!cand || !cand.bestUci) continue;
    if (cand.mateIn !== null && cand.mateIn < 0 && (best.mateIn === null || best.mateIn >= 0)) continue;
    const drop = Math.max(0, bestScore - sideScore(cand));
    if (drop > profile.slack) continue;
    let weight = Math.exp(-drop / Math.max(18, profile.slack / 2));
    // Repeatedly taking #1 is the one pattern that reads as a machine. Once the
    // streak reaches three, a near-equal alternative gets a nudge, not a mandate.
    if ((opts.top1Streak || 0) >= 3 && i === 0 && drop === 0) weight *= 0.35;
    if (i > 0 && drop >= 8 && drop <= profile.slack) weight *= 1.35;
    eligible.push({ line: cand, cpLoss: drop, weight });
  }

  if (eligible.length === 0) return { line: best, cpLoss: 0, reason: 'best' };
  const total = eligible.reduce((acc, item) => acc + item.weight, 0);
  let roll = Math.random() * total;
  for (const item of eligible) {
    roll -= item.weight;
    if (roll <= 0) return { line: item.line, cpLoss: item.cpLoss, reason: profile.label };
  }
  return { line: eligible[0].line, cpLoss: eligible[0].cpLoss, reason: profile.label };
}

function computeDelay(cfg, opts = {}) {
  const lo = Math.max(250, cfg.minThinkMs);
  const hi = Math.max(lo + 100, cfg.maxThinkMs);
  const skew = (Math.random() + Math.random() + Math.random()) / 3;
  let ms = lo + (hi - lo) * skew;

  const ply = Number.isFinite(opts.plyCount) ? opts.plyCount : 16;
  if (ply < 6) ms *= 0.7;
  if (opts.legalMoveCount && opts.legalMoveCount <= 3) ms *= 0.8;
  if (opts.isCapture) ms *= 0.85;
  if (opts.isCheck) ms *= 0.9;

  if (cfg.pauseOnLowClock && Number.isFinite(opts.clockSeconds)) {
    if (opts.clockSeconds <= 8) ms = Math.min(ms, 420);
    else if (opts.clockSeconds <= cfg.clockFloorSeconds) ms = Math.min(ms, 900);
  }
  return Math.round(clamp(ms, 250, 9000));
}

