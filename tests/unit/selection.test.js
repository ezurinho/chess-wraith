'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFragments } = require('./helpers');

const api = loadFragments(
  ['10-config.js', '20-utils.js', '60-analysis.js'],
  `{ chooseMove, computeDelay, styleProfile, effectiveElo, eloToSkill, fatigueFactor, sideScore, clamp, clampInt, median, pushBounded, depthForAccount, openingProbeTarget, LEGIT }`
);

const line = (uci, cp, mate = null) => ({ bestUci: uci, scoreCp: cp, mateIn: mate, evalText: '' });
const baseCfg = {
  humanSlackCp: 70,
  minThinkMs: 700,
  maxThinkMs: 3200,
  pauseOnLowClock: true,
  clockFloorSeconds: 12
};

test('there is one way to play and there is no switch out of it', () => {
  assert.equal(api.LEGIT.miss, 0);
  const profile = api.styleProfile({ humanSlackCp: 40 }, { oppElo: 1200 });
  assert.equal(profile.label, 'Legit');
  assert.equal(profile.miss, 0);
  // 1500 is the fallback anchor when the account's rating is not known yet.
  assert.equal(profile.elo, 1425);
});

test('the slack is the ceiling on how far a pick may drift from the best', () => {
  const lines = [line('e2e4', 40), line('d2d4', -90), line('a2a3', -300)];
  const narrow = { ...baseCfg, humanSlackCp: 30 };
  for (let i = 0; i < 200; i++) {
    const pick = api.chooseMove(lines, narrow, { top1Streak: 0 });
    assert.equal(pick.line.bestUci, 'e2e4');
    assert.equal(pick.cpLoss, 0);
  }
});

test('a mate in one is never traded for a quieter move', () => {
  const lines = [line('d8h4', null, 1), line('f8e7', 120)];
  const pick = api.chooseMove(lines, baseCfg, { top1Streak: 5 });
  assert.equal(pick.line.bestUci, 'd8h4');
  assert.equal(pick.reason, 'mate');
});

test('the legit band keeps only near-equal candidates and never a losing line', () => {
  const lines = [line('e2e4', 40), line('d2d4', 10), line('a2a3', -260)];
  for (let i = 0; i < 40; i++) {
    const pick = api.chooseMove(lines, baseCfg, { top1Streak: 0 });
    assert.ok(['e2e4', 'd2d4'].includes(pick.line.bestUci));
    assert.ok(pick.cpLoss <= 70);
  }
});

test('a three-move top-1 streak lowers the weight of move one', () => {
  const lines = [line('e2e4', 40), line('d2d4', 36)];
  let top1 = 0;
  for (let i = 0; i < 200; i++) {
    if (api.chooseMove(lines, baseCfg, { top1Streak: 4 }).line.bestUci === 'e2e4') top1++;
  }
  assert.ok(top1 < 160, `expected the streak to shift the choice, got ${top1}/200 top-1`);
});

test('delays stay inside the configured window and respect the clock', () => {
  for (let i = 0; i < 200; i++) {
    const normal = api.computeDelay(baseCfg, { plyCount: 20, legalMoveCount: 30, clockSeconds: 120 });
    assert.ok(normal >= 700 && normal <= 3200, `out of range: ${normal}`);
    const bullet = api.computeDelay(baseCfg, { plyCount: 20, legalMoveCount: 30, clockSeconds: 5 });
    assert.ok(bullet <= 420, `low clock not respected: ${bullet}`);
  }
});

test('clamp helpers reject garbage instead of producing NaN', () => {
  assert.equal(api.clampInt('nope', 0, 10, 7), 7);
  assert.equal(api.clampInt(99, 0, 10, 7), 10);
  assert.equal(api.clamp(-5, 0, 10), 0);
});

test('Skill Level is derived from the target Elo, not left at 20', () => {
  assert.equal(api.eloToSkill(1320), 0);
  assert.equal(api.eloToSkill(3190), 20);
  assert.ok(api.eloToSkill(1650) < 6, 'a club player is not a full-strength engine');
  assert.ok(api.eloToSkill(2400) > api.eloToSkill(1800));
  assert.equal(api.eloToSkill(null), 20);
  assert.equal(api.eloToSkill(0), 20);
});

test('the rating sits just above the opponent, with no preset to move it', () => {
  // A manual ceiling still cannot push the account far above its own level.
  assert.equal(api.effectiveElo({ targetElo: 1650 }, { oppElo: 1200 }), 1575);
  assert.equal(api.effectiveElo({ targetElo: 1650 }, { oppElo: 2000 }), 1675);
  assert.equal(api.effectiveElo({ targetElo: 1650 }, {}), 1650);
  // targetElo 0 follows the account; with no reading there is a neutral anchor.
  assert.equal(api.effectiveElo({ targetElo: 0 }, {}), 1500);
  assert.equal(api.effectiveElo({}, { oppElo: 5000 }), 1525);
  // The published rating wins over the knob, and a 1400 account never plays 2000.
  assert.equal(api.effectiveElo({ targetElo: 2000 }, { accountElo: 1400, oppElo: 1450 }), 1425);
  assert.equal(api.effectiveElo({ targetElo: 2000 }, { accountElo: 1400, oppElo: 900 }), 1325);
  assert.equal(api.effectiveElo({ targetElo: 0 }, { accountElo: 2400, oppElo: 2600 }), 2425);
  assert.equal(api.effectiveElo({ targetElo: 0 }, { accountElo: 2400 }), 2400);
  // Above the engine's ceiling the anchor saturates instead of wrapping around.
  assert.equal(api.effectiveElo({ targetElo: 0 }, { accountElo: 3450 }), 3190);
  // A 133 account is under the engine's 1320 floor: the target is the floor,
  // never the old 1500 default dressed up as the account's rating.
  assert.equal(api.effectiveElo({ targetElo: 0 }, { accountElo: 133, oppElo: 113 }), 1245);
});

test('nothing misses on purpose: there is no sloppy preset to fall into', () => {
  // Even with the slack setting at zero the legit floor of 40 cp stands: this
  // script is never asked to play the engine's raw best line.
  const cfg = { ...baseCfg, humanSlackCp: 0 };
  const lines = [line('e2e4', 40), line('d2d4', 0), line('a2a3', -160)];
  for (let i = 0; i < 300; i++) {
    const pick = api.chooseMove(lines, cfg, { top1Streak: 0 });
    assert.notEqual(pick.reason, 'miss');
    assert.ok(pick.cpLoss <= 40, `played ${pick.cpLoss} cp off the best`);
  }
});

test('a repeated first move is down-weighted across games', () => {
  const lines = [line('e2e4', 40), line('d2d4', 34)];
  let plain = 0;
  let repeated = 0;
  for (let i = 0; i < 500; i++) {
    if (api.chooseMove(lines, baseCfg, { top1Streak: 0 }).line.bestUci === 'e2e4') plain++;
    if (api.chooseMove(lines, baseCfg, { top1Streak: 0, repeatUci: 'e2e4' }).line.bestUci === 'e2e4') repeated++;
  }
  assert.ok(repeated < plain, `repeat penalty did nothing (${repeated} vs ${plain})`);
});

test('a harder decision takes longer than an obvious one', () => {
  const sample = (gapCp) => {
    let total = 0;
    for (let i = 0; i < 400; i++) {
      total += api.computeDelay(baseCfg, { plyCount: 24, legalMoveCount: 30, gapCp, clockSeconds: 180 });
    }
    return total / 400;
  };
  const obvious = sample(4);
  const decision = sample(180);
  assert.ok(decision > obvious * 1.25, `gap did not move the delay: ${decision} vs ${obvious}`);
});

test('the rare rethink can exceed the window, but only when allowed', () => {
  let boundedMax = 0;
  let rethinkMax = 0;
  for (let i = 0; i < 4000; i++) {
    boundedMax = Math.max(boundedMax, api.computeDelay(baseCfg, { plyCount: 24, clockSeconds: 300 }));
    rethinkMax = Math.max(rethinkMax, api.computeDelay(baseCfg, { plyCount: 24, clockSeconds: 300, allowRethink: true }));
  }
  assert.ok(boundedMax <= 3200, `bounded delay escaped its window: ${boundedMax}`);
  assert.ok(rethinkMax > 3200, `rethink never fired: ${rethinkMax}`);
  assert.ok(rethinkMax <= 9000, `rethink exceeded the hard cap: ${rethinkMax}`);
});

test('an account baseline keeps every move inside a band around its own rhythm', () => {
  const wide = { ...baseCfg, minThinkMs: 400, maxThinkMs: 5000 };
  const picks = [];
  for (let i = 0; i < 200; i++) {
    picks.push(api.computeDelay(wide, { plyCount: 20, legalMoveCount: 30, baselineMs: 2000 }));
  }
  picks.sort((a, b) => a - b);
  const mid = picks[Math.floor(picks.length / 2)];
  // Centred on the account: the jitter is drawn around the baseline, so the
  // median of a session stays on it instead of drifting with the drawn window.
  assert.ok(mid >= 1800 && mid <= 2200, `median off the baseline: ${mid}`);
  assert.ok(picks[0] >= 900, `too fast for the account: ${picks[0]}`);
});

test('a slow opponent sets a floor, a fast one does not', () => {
  const narrow = { ...baseCfg, minThinkMs: 400, maxThinkMs: 600 };
  for (let i = 0; i < 50; i++) {
    const slow = api.computeDelay(narrow, { plyCount: 30, oppTempoMs: 8000 });
    assert.ok(slow >= 2800, `answered a 8s opponent in ${slow}ms`);
    const fast = api.computeDelay(narrow, { plyCount: 30, oppTempoMs: 520 });
    assert.ok(fast <= 900, `no floor expected, got ${fast}`);
  }
});

test('median and pushBounded behave on the edge cases the pace code feeds them', () => {
  assert.equal(api.median([]), null);
  assert.equal(api.median([5]), 5);
  assert.equal(api.median([1, 2, 3, 4]), 3);
  assert.equal(api.median([3, 1, 2]), 2);
  assert.equal(api.median([1, NaN, 0, -4]), 1);
  assert.equal(api.pushBounded([1, 2], 3, 2).join(','), '2,3');
  assert.equal(api.pushBounded(null, 7, 3).join(','), '7');
  assert.equal(api.pushBounded([1], NaN, 3).join(','), '1');
});

test('a long session gets slower, like a person not a metronome', () => {
  assert.equal(api.fatigueFactor(0), 1);
  assert.equal(api.fatigueFactor(NaN), 1);
  assert.equal(api.fatigueFactor(3600000), 1.02);
  assert.equal(api.fatigueFactor(3 * 3600000), 1.06);
  // The cap: eight hours is not eight times slower.
  assert.equal(api.fatigueFactor(8 * 3600000), 1.06);
});
test('the clock caps the published baseline instead of letting it flag the account', () => {
  // The account's own median, read from its games: six seconds a move.
  const opts = { plyCount: 24, legalMoveCount: 30, baselineMs: 6000 };
  const comfortable = api.computeDelay(baseCfg, { ...opts, clockSeconds: 600 });
  const low = api.computeDelay(baseCfg, { ...opts, clockSeconds: 40 });
  const cramped = api.computeDelay(baseCfg, { ...opts, clockSeconds: 9 });
  assert.ok(comfortable > 2000, `ten minutes left, usual rhythm: ${comfortable}`);
  assert.ok(low <= 2222, `forty seconds left keeps a 18-move tank: ${low}`);
  assert.ok(cramped <= 500, `nine seconds left is a scramble: ${cramped}`);
  assert.ok(cramped >= 250, 'but never an impossible zero');
});
test('the depth cap follows the anchor instead of capping a strong account', () => {
  // 1500 is where the default is right, so nothing moves there.
  assert.equal(api.depthForAccount(14, 1425), 14);
  assert.equal(api.depthForAccount(14, 1500), 14);
  assert.equal(api.depthForAccount(14, 900), 14);
  // One extra ply per 100 points above the anchor, up to the engine's own 22.
  assert.equal(api.depthForAccount(14, 1800), 17);
  assert.equal(api.depthForAccount(14, 2200), 21);
  assert.equal(api.depthForAccount(14, 2600), 22);
  assert.equal(api.depthForAccount(14, 3200), 22);
  // A user who already asked for more keeps it, and the clamp still holds.
  assert.equal(api.depthForAccount(18, 1700), 20);
  assert.equal(api.depthForAccount(22, 2000), 22);
  assert.equal(api.depthForAccount(2, 2000), 9);
});
test("the account's own repertoire is played, not averaged away", () => {
  const lines = [
    { bestUci: 'e2e4', bestSan: 'e4', scoreCp: 20, mateIn: null, evalText: '' },
    { bestUci: 'd2d4', bestSan: 'd4', scoreCp: 15, mateIn: null, evalText: '' },
    { bestUci: 'g1f3', bestSan: 'Nf3', scoreCp: 10, mateIn: null, evalText: '' },
    { bestUci: 'c2c4', bestSan: 'c4', scoreCp: 5, mateIn: null, evalText: '' }
  ];
  const cfg = { ...baseCfg, humanSlackCp: 40 };
  const shares = { e4: 0.6, d4: 0.25, Nf3: 0.1, c4: 0.05 };
  const sample = (opts) => {
    const counts = { e4: 0, d4: 0, Nf3: 0, c4: 0 };
    for (let i = 0; i < 400; i++) {
      const pick = api.chooseMove(lines, cfg, { oppElo: 1400, ...opts });
      counts[pick.line.bestSan] += 1;
    }
    return counts;
  };
  const plain = sample({});
  const repertoire = sample({ openingShares: shares });
  // Without the shares four near-equal moves come out near-uniform: no repertoire.
  assert.ok(Math.max(...Object.values(plain)) < 320, JSON.stringify(plain));
  // With them the account's main move keeps most of its own share.
  assert.ok(repertoire.e4 > 170, JSON.stringify(repertoire));
  assert.ok(repertoire.d4 > 50, JSON.stringify(repertoire));
  // The anti-repeat rule used to drop the repeated move to 12%; a repertoire move
  // is exactly the one that is supposed to come back.
  const repeated = sample({ openingShares: shares, repeatUci: 'e2e4' });
  assert.ok(repeated.e4 > 160, JSON.stringify(repeated));
  // An account that never played these lines gets the old behaviour back.
  const unknown = sample({ openingShares: { h2h4: 1 } });
  assert.ok(Math.max(...Object.values(unknown)) < 320, JSON.stringify(unknown));
});

test('a conditioned reply is not diluted by the moves it answers', () => {
  // aloka_27 (1631 blitz, 2026/10): against 1.e4 e5 93%, against 1.d4 d5 89%.
  // The averaged table says e5 56%, d5 32% and would answer 1.d4 with e5 — a
  // move that player never played against it.
  const lines = [
    { bestUci: 'e7e5', bestSan: 'e5', scoreCp: 15, mateIn: null, evalText: '' },
    { bestUci: 'e7e6', bestSan: 'e6', scoreCp: 12, mateIn: null, evalText: '' },
    { bestUci: 'c7c5', bestSan: 'c5', scoreCp: 8, mateIn: null, evalText: '' }
  ];
  const cfg = { ...baseCfg, humanSlackCp: 60 };
  const counts = { e5: 0, e6: 0, c5: 0 };
  for (let i = 0; i < 400; i++) {
    const pick = api.chooseMove(lines, cfg, { oppElo: 1600, openingShares: { e5: 0.93, e6: 0.07 } });
    counts[pick.line.bestSan] += 1;
  }
  assert.ok(counts.e5 > 300, JSON.stringify(counts));
  assert.ok(counts.c5 < 40, JSON.stringify(counts));
});

test('a 60-of-60 habit is played almost every time, not three times in four', () => {
  const lines = [
    { bestUci: 'e2e4', bestSan: 'e4', scoreCp: 30, mateIn: null, evalText: '' },
    { bestUci: 'd2d4', bestSan: 'd4', scoreCp: 28, mateIn: null, evalText: '' },
    { bestUci: 'g1f3', bestSan: 'Nf3', scoreCp: 26, mateIn: null, evalText: '' }
  ];
  const cfg = { ...baseCfg, humanSlackCp: 60 };
  const counts = { e4: 0, d4: 0, Nf3: 0 };
  for (let i = 0; i < 400; i++) {
    const pick = api.chooseMove(lines, cfg, { oppElo: 1600, openingShares: { e4: 1 } });
    counts[pick.line.bestSan] += 1;
  }
  assert.ok(counts.e4 > 360, JSON.stringify(counts));
  // And a 60/40 habit really is 60/40. 1000 samples, not 400: at 400 the
  // binomial sd is 0.024, so a 0.55-0.65 window failed about once in twenty runs
  // and turned a green suite red for no reason.
  const two = { e4: 0, d4: 0 };
  for (let i = 0; i < 1000; i++) {
    const pick = api.chooseMove(lines, cfg, { oppElo: 1600, openingShares: { e4: 0.6, d4: 0.4 } });
    if (pick.line.bestSan === 'Nf3') continue;
    two[pick.line.bestSan] += 1;
  }
  const ratio = two.e4 / (two.e4 + two.d4);
  assert.ok(ratio > 0.55 && ratio < 0.65, JSON.stringify(two));
});

test('a probed line is the account move, and only the opening lets it in', () => {
  // The engine's own four candidates never included 2.Ne2, so it arrives from a
  // restricted search carrying an 80 cp cost: outside the slack, inside the
  // opening allowance.
  const probed = { bestUci: 'g1e2', bestSan: 'Ne2', scoreCp: -50, mateIn: null, evalText: '', opening: true };
  const lines = [
    { bestUci: 'g1f3', bestSan: 'Nf3', scoreCp: 30, mateIn: null, evalText: '' },
    { bestUci: 'f1c4', bestSan: 'Bc4', scoreCp: 25, mateIn: null, evalText: '' },
    probed
  ];
  const cfg = { ...baseCfg, humanSlackCp: 60 };
  let ne2 = 0;
  for (let i = 0; i < 400; i++) {
    const pick = api.chooseMove(lines, cfg, { oppElo: 1600, openingShares: { Ne2: 1 } });
    if (pick.line.bestSan === 'Ne2') ne2 += 1;
  }
  assert.ok(ne2 > 300, 'the probed move is played: ' + ne2);
  let unflagged = 0;
  for (let i = 0; i < 400; i++) {
    const pick = api.chooseMove([lines[0], lines[1], { ...probed, opening: false }], cfg, { oppElo: 1600, openingShares: { Ne2: 1 } });
    if (pick.line.bestSan === 'Ne2') unflagged += 1;
  }
  assert.equal(unflagged, 0, 'without the flag the slack still rules');
  // And a probed move that loses the position is not played at all.
  const losing = { ...probed, scoreCp: -400 };
  let blunder = 0;
  for (let i = 0; i < 100; i++) {
    const pick = api.chooseMove([lines[0], lines[1], losing], cfg, { oppElo: 1600, openingShares: { Ne2: 1 } });
    if (pick.line.bestSan === 'Ne2') blunder += 1;
  }
  assert.equal(blunder, 0);
});

test('only a strong habit the search missed is worth a probe', () => {
  const lines = [
    { bestUci: 'g1f3', bestSan: 'Nf3', scoreCp: 30, mateIn: null, evalText: '' },
    { bestUci: 'f1c4', bestSan: 'Bc4', scoreCp: 25, mateIn: null, evalText: '' }
  ];
  assert.equal(api.openingProbeTarget({ Nf3: 1 }, lines), null, 'already a candidate');
  assert.equal(api.openingProbeTarget({ Ne2: 0.4 }, lines), null, 'a 40% move is not a habit');
  assert.deepEqual(JSON.parse(JSON.stringify(api.openingProbeTarget({ Ne2: 0.9, d4: 0.1 }, lines))), { san: 'Ne2', share: 0.9 });
  assert.equal(api.openingProbeTarget(null, lines), null);
  // The suffix of a check is not part of the name on either side.
  assert.equal(api.openingProbeTarget({ 'Qh5+': 1 }, [{ bestSan: 'Qh5' }]), null);
});

test('time already spent thinking is not spent twice', () => {
  const cfg = { ...baseCfg };
  const real = Math.random;
  Math.random = () => 0.5;
  try {
    const plain = api.computeDelay(cfg, { plyCount: 12, legalMoveCount: 20, spentMs: 0 });
    const probed = api.computeDelay(cfg, { plyCount: 12, legalMoveCount: 20, spentMs: 400 });
    assert.equal(plain - probed, 400, 'the probe is part of the same move');
    // The floor still holds when the search alone outlasted the whole delay.
    const floored = api.computeDelay(cfg, { plyCount: 12, legalMoveCount: 20, spentMs: 4000 });
    assert.ok(floored >= 95 && floored <= 4500, String(floored));
    assert.equal(api.computeDelay(cfg, { plyCount: 12, legalMoveCount: 20 }), plain, 'absent means zero');
  } finally {
    Math.random = real;
  }
});
