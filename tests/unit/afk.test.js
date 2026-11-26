'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFragments } = require('./helpers');

const api = loadFragments(
  ['10-config.js', '20-utils.js', '65-afk.js'],
  `{ pickRematchButton, nextGameDelay, sessionLimit, parseGameResult, resumeSession, REMATCH_PRIORITY, REMATCH_RETRY_MS }`
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

test('a declined rematch moves on to the next button the site offers', () => {
  const candidates = [{ text: 'Rematch' }, { text: 'Game Review' }, { text: 'New 5 min' }];
  assert.equal(api.pickRematchButton(candidates), 0, 'the first attempt is the rematch');
  assert.equal(api.pickRematchButton(candidates, ['rematch']), 2, 'the second is a new game');
  assert.equal(api.pickRematchButton(candidates, ['  REMATCH ']), 2, 'the skip is normalised');
  assert.equal(api.pickRematchButton(candidates, ['rematch', 'new 5 min']), -1, 'nothing left to press');
  assert.equal(api.pickRematchButton(candidates, null), 0, 'no skip list keeps the old behaviour');
});

test('the retry pause gives the opponent time to answer without idling', () => {
  assert.ok(api.REMATCH_RETRY_MS >= 5000, 'not so short that a human answer is missed');
  assert.ok(api.REMATCH_RETRY_MS <= 30000, 'not so long that an empty session sits there');
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

test('a session stops on games even if the clock has not moved', () => {
  const limit = api.sessionLimit({ startedAt: 1000, games: 15, now: 5000, maxGames: 15, maxMs: 3600000 });
  assert.equal(limit.stop, true);
  assert.match(limit.reason, /15 games/);
});

test('a session stops on wall-clock even with games left', () => {
  const limit = api.sessionLimit({ startedAt: 0, games: 2, now: 7200000, maxGames: 15, maxMs: 7200000 });
  assert.equal(limit.stop, true);
  assert.match(limit.reason, /2h/);
});

test('a session keeps going while both caps have room', () => {
  const limit = api.sessionLimit({ startedAt: 1000, games: 3, now: 2000, maxGames: 15, maxMs: 3600000 });
  assert.equal(limit.stop, false);
  assert.equal(limit.reason, '');
});

test('a zero or missing cap disables that half and never divides by zero', () => {
  assert.equal(api.sessionLimit({ startedAt: 0, games: 999, now: 0, maxGames: 0, maxMs: 0 }).stop, false);
  assert.equal(api.sessionLimit({}).stop, false);
  assert.equal(api.sessionLimit({ games: NaN, now: NaN, maxGames: Infinity, maxMs: NaN }).stop, false);
});
test('the dialog names the winner, so the account name decides the result', () => {
  assert.equal(api.parseGameResult('tester won', 'tester'), 'win');
  assert.equal(api.parseGameResult('tester won by resignation', 'tester'), 'win');
  assert.equal(api.parseGameResult('tester won', 'someoneelse'), 'loss');
  assert.equal(api.parseGameResult('  TESTER  WON  ', 'Tester'), 'win');
  // The modal's textContent glues the header to the Rematch button.
  assert.equal(api.parseGameResult('tester wonRematch', 'tester'), 'win');
  assert.equal(api.parseGameResult('tester wonNewGame', 'someoneelse'), 'loss');
});

test('draws never depend on a name', () => {
  assert.equal(api.parseGameResult('Draw', 'tester'), 'draw');
  assert.equal(api.parseGameResult('Draw by agreement', ''), 'draw');
  assert.equal(api.parseGameResult('Draw by stalemate', 'x'), 'draw');
});

test('a sentence that is not a result is null, not a guess', () => {
  assert.equal(api.parseGameResult('', 'tester'), null);
  assert.equal(api.parseGameResult('Game Review', 'tester'), null);
  assert.equal(api.parseGameResult('tester won', ''), null, 'no account name means no verdict');
});

test('a session keeps its score across a reload and drops nonsense', () => {
  const now = 1_700_000_000_000;
  const same = api.resumeSession({ startedAt: now - 60_000, games: 4, results: { win: 3, loss: 1, draw: 0 } }, now, 3 * 3600e3);
  assert.equal(same.resumed, true);
  assert.deepEqual({ ...same.results }, { win: 3, loss: 1, draw: 0 });
  const junk = api.resumeSession({ startedAt: now - 60_000, games: 4, results: { win: -5, loss: 'x', draw: 2.7 } }, now, 3 * 3600e3);
  assert.deepEqual({ ...junk.results }, { win: 0, loss: 0, draw: 3 });
  const old = api.resumeSession({ startedAt: now - 40 * 3600e3, games: 4, results: { win: 3 } }, now, 3 * 3600e3);
  assert.equal(old.resumed, false);
  assert.deepEqual({ ...old.results }, { win: 0, loss: 0, draw: 0 });
});
