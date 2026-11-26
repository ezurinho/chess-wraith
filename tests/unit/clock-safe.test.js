const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFragments } = require('./helpers.js');

// The clock is the only thing in a chess game that cannot be argued with. A
// search that outlives it is a loss with extra steps, so the time spent per move
// and the deadline that waits for it both have to bend to what is left.
const api = loadFragments(['10-config.js', '20-utils.js'], '{ clockBoundMoveTime, searchBudgetMs, visibleDelayMs }');

test('a healthy clock leaves the configured search alone', () => {
  assert.equal(api.clockBoundMoveTime(700, 60), 700);
  assert.equal(api.clockBoundMoveTime(900, 180), 900);
  assert.equal(api.clockBoundMoveTime(1200, null), 1200, 'no clock, no bound');
  assert.equal(api.clockBoundMoveTime(1200, 0), 1200, 'a zero clock is not a clock');
});

test('a short clock shortens the search to a fifth of what is left', () => {
  assert.equal(api.clockBoundMoveTime(700, 3), 600);
  assert.equal(api.clockBoundMoveTime(900, 2), 400);
  assert.equal(api.clockBoundMoveTime(900, 10), 900, 'ten seconds still afford 900 ms');
  assert.equal(api.clockBoundMoveTime(300, 10), 300, 'never lengthens a search');
  assert.equal(api.clockBoundMoveTime(900, 0.5), 150, 'the floor is one click, not zero');
});

test('the watchdog deadline never waits past half the clock', () => {
  assert.equal(api.searchBudgetMs({ moveTimeMs: 700 }), 10200, 'no clock: the published budget');
  assert.equal(api.searchBudgetMs({ moveTimeMs: 700, clockSeconds: 60 }), 10200);
  assert.equal(api.searchBudgetMs({ moveTimeMs: 700, clockSeconds: 4 }), 2000);
  assert.equal(api.searchBudgetMs({ moveTimeMs: 700, clockSeconds: 1 }), 1500, 'never below the floor');
});
test('the search is part of the interval, not extra to it', () => {
  // A 1.6 s rhythm with 700 ms of engine: 900 ms of visible waiting, 1.6 s total.
  assert.equal(api.visibleDelayMs(1600, 700), 900);
  assert.equal(api.visibleDelayMs(1600, 0), 1600);
  // A search longer than the whole target still leaves a beat before the click.
  assert.equal(api.visibleDelayMs(700, 700), 120);
  assert.equal(api.visibleDelayMs(700, 3000), 120);
  assert.equal(api.visibleDelayMs(900, undefined), 900, 'no search, no subtraction');
  assert.equal(api.visibleDelayMs(900, -50), 900, 'a negative gap is not a search');
});
