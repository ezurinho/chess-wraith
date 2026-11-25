'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFragments } = require('./helpers');

const api = loadFragments(
  ['10-config.js', '20-utils.js', '60-analysis.js'],
  '{ chooseMove, computeDelay, styleProfile, clamp, clampInt, STYLES }'
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

test('club slack keeps only near-equal candidates and never a losing line', () => {
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
