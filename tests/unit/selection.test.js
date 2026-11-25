'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFragments } = require('./helpers');

const api = loadFragments(
  ['10-config.js', '20-utils.js', '60-analysis.js'],
  `{ chooseMove, computeDelay, styleProfile, effectiveElo, eloToSkill, fatigueFactor, sideScore, clamp, clampInt, median, pushBounded, LEGIT }`
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
