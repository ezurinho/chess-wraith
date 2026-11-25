// Search time follows the position: the opening does not need the budget, the
// endgame is where the game is decided. And a check timestamp should read like
// a sentence.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFragments } = require('./helpers');

const api = loadFragments(['10-config.js', '20-utils.js'], `{ phaseTimeScale, phaseMoveTime, formatAge, searchBudgetMs }`);

const OPENING = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const MIDDLE = 'r1bq1rk1/pp2bppp/2n1pn2/3p4/3P4/2N1PN2/PP2BPPP/R1BQ1RK1 w - - 8 9';
const ENDGAME = '8/5pk1/6p1/8/3K4/5P2/6P1/8 w - - 0 40';
const ROOK_ENDING = 'r4rk1/pp3ppp/8/8/8/8/PP3PPP/R4RK1 w - - 0 20';

test('material decides the phase, and the opening is the cheap phase', () => {
  assert.equal(api.phaseTimeScale(OPENING, 2), 0.85);
  assert.equal(api.phaseTimeScale(MIDDLE, 20), 1);
  assert.equal(api.phaseTimeScale(ENDGAME, 40), 1.35);
  // 14 men: an endgame, but not the last pawns.
  assert.equal(api.phaseTimeScale(ROOK_ENDING, 20), 1.15);
  assert.equal(api.phaseTimeScale('', 0), 1, 'no fen, no scaling');
  assert.equal(api.phaseTimeScale(null, 4), 1);
});

test('the scaled budget stays inside the range the watchdog expects', () => {
  assert.equal(api.phaseMoveTime(700, OPENING, 4), 595);
  assert.equal(api.phaseMoveTime(700, MIDDLE, 30), 700);
  assert.equal(api.phaseMoveTime(700, ENDGAME, 60), 945);
  assert.equal(api.phaseMoveTime(5000, ENDGAME, 60), 5000, 'clamped at the ceiling');
  assert.equal(api.phaseMoveTime('nonsense', MIDDLE, 20), 700, 'garbage falls back to the config default');
  for (const value of [api.phaseMoveTime(150, ENDGAME, 9), api.phaseMoveTime(6000, MIDDLE, 9)]) {
    assert.ok(value >= 150 && value <= 5000);
    assert.ok(api.searchBudgetMs({ moveTimeMs: value }) > value);
  }
});

test('a check timestamp reads like a sentence', () => {
  assert.equal(api.formatAge(0), 'just now');
  assert.equal(api.formatAge(30_000), 'just now');
  assert.equal(api.formatAge(5 * 60_000), '5m ago');
  assert.equal(api.formatAge(59 * 60_000), '59m ago');
  assert.equal(api.formatAge(3 * 3600_000), '3h ago');
  assert.equal(api.formatAge(47 * 3600_000), '47h ago');
  assert.equal(api.formatAge(3 * 86400_000), '3d ago');
  assert.equal(api.formatAge(-1), 'never');
  assert.equal(api.formatAge(undefined), 'never');
});
