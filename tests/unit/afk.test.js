'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFragments } = require('./helpers');

const api = loadFragments(
  ['10-config.js', '20-utils.js', '65-afk.js'],
  `{ pickRematchButton, nextGameDelay, REMATCH_PRIORITY }`
);

test('rematch wins over a new game when both are offered', () => {
  const index = api.pickRematchButton([
    { text: 'New 5 min' },
    { text: 'Rematch' },
    { text: 'Game Review' }
  ]);
  assert.equal(index, 1);
});

test('a disabled rematch is skipped, not pressed', () => {
  const index = api.pickRematchButton([
    { text: 'Rematch', disabled: true },
    { text: 'New 5 min' }
  ]);
  assert.equal(index, 1);
});

test('the shortest new game is preferred over the longest', () => {
  const index = api.pickRematchButton([
    { text: 'New 30 min' },
    { text: 'New 3 min' },
    { text: 'New 10 min' }
  ]);
  assert.equal(index, 1);
});

test('unrelated buttons are never chosen', () => {
  assert.equal(api.pickRematchButton([{ text: 'Game Review' }, { text: 'Share' }]), -1);
  assert.equal(api.pickRematchButton([]), -1);
  assert.equal(api.pickRematchButton(null), -1);
});

test('button text is matched regardless of case and extra spaces', () => {
  const index = api.pickRematchButton([{ text: '  REMATCH  ' }]);
  assert.equal(index, 0);
});

test('the next-game delay stays inside the configured windows', () => {
  const cfg = { newGameDelayMs: [1700, 4200], newGameLongMs: [5000, 9500], newGameLongChance: 0.12 };
  let long = 0;
  for (let i = 0; i < 2000; i++) {
    const ms = api.nextGameDelay(cfg);
    assert.ok(ms >= 1700 && ms <= 9500, `out of range: ${ms}`);
    const isShort = ms <= 4200;
    const isLong = ms >= 5000;
    assert.ok(isShort || isLong, `landed between windows: ${ms}`);
    if (isLong) long++;
  }
  const share = long / 2000;
  assert.ok(share > 0.05 && share < 0.2, `long-pause share off: ${share}`);
});

test('a hostile config falls back to the defaults instead of throwing', () => {
  const ms = api.nextGameDelay({ newGameDelayMs: 'nope', newGameLongMs: null, newGameLongChance: 'x' });
  assert.ok(Number.isFinite(ms) && ms > 0);
});
