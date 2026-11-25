'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFragments } = require('./helpers');

const api = loadFragments(
  ['10-config.js', '20-utils.js', '60-analysis.js'],
  `{ chooseMove, computeDelay, styleProfile, effectiveElo, eloToSkill, sideScore, clamp, clampInt, STYLES }`
);

const line = (uci, cp, mate = null) => ({ bestUci: uci, scoreCp: cp, mateIn: mate, evalText: '' });
const baseCfg = {
  style: 'club',
  humanSlackCp: 70,
  minThinkMs: 700,
  maxThinkMs: 3200,
  pauseOnLowClock: true,
  clockFloorSeconds: 12
};

test('engine style always takes the top move', () => {
  const lines = [line('e2e4', 40), line('d2d4', 30), line('g1f3', 20)];
  const pick = api.chooseMove(lines, { ...baseCfg, style: 'engine' }, { top1Streak: 0 });
  assert.equal(pick.line.bestUci, 'e2e4');
  assert.equal(pick.cpLoss, 0);
});

test('a mate in one is never traded for a quieter move', () => {
  const lines = [line('d8h4', null, 1), line('f8e7', 120)];
  const pick = api.chooseMove(lines, baseCfg, { top1Streak: 5 });
  assert.equal(pick.line.bestUci, 'd8h4');
  assert.equal(pick.reason, 'mate');
});

test('club keeps only near-equal candidates and never a losing line', () => {
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

test('adaptive sits just above the opponent it has measured', () => {
  assert.equal(api.effectiveElo({ style: 'adaptive', targetElo: 1650 }, { oppElo: 1200 }), 1330);
  assert.equal(api.effectiveElo({ style: 'adaptive', targetElo: 1650 }, { oppElo: 2000 }), 2130);
  assert.equal(api.effectiveElo({ style: 'adaptive', targetElo: 1650 }, {}), 1630);
  assert.equal(api.effectiveElo({ style: 'engine' }, { oppElo: 1200 }), null);
  assert.equal(api.effectiveElo({ style: 'club', targetElo: 1700 }, {}), 1700);
});

test('the casual preset misses on purpose, capped near its own slack', () => {
  const casualCfg = { ...baseCfg, style: 'casual', humanSlackCp: 0 };
  const lines = [line('e2e4', 40), line('d2d4', 0), line('a2a3', -160)];
  let misses = 0;
  for (let i = 0; i < 600; i++) {
    const pick = api.chooseMove(lines, casualCfg, { top1Streak: 0 });
    if (pick.reason === 'miss') {
      misses++;
      assert.ok(pick.cpLoss <= 120 * 2.5, `miss too large: ${pick.cpLoss}`);
    }
  }
  assert.ok(misses > 0, 'casual never missed in 600 draws');
  assert.ok(misses < 180, `casual missed too often: ${misses}/600`);
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
