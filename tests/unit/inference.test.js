'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadFragments } = require('./helpers');

const Chess = require(path.resolve(__dirname, '..', '..', 'src', '30-chess.js'));
const utils = loadFragments(
  ['10-config.js', '20-utils.js'],
  `{ nnueSkipActive, searchBudgetMs, NNUE_SKIP_TTL_MS, ENGINE_MIRROR }`
);

const midgame = () => Chess.replaySanMoves(['e4', 'e5', 'Nf3']);

test('a mid-game board with no move list and no clock never claims to be certain', () => {
  const { state } = midgame(); // black to move
  const snapshot = new Chess.ChessStateTracker().updateFromDomSnapshot(state.grid, {});
  assert.equal(snapshot.turn, 'w', 'the guess is still white, for display');
  assert.equal(snapshot.turnSource, 'assumed');
  assert.equal(snapshot.turnCertain, false, 'callers must not act on a guess');
});

test('the running clock is evidence and wins over the guess', () => {
  const { state } = midgame();
  const snapshot = new Chess.ChessStateTracker().updateFromDomSnapshot(state.grid, {
    activeClockTurn: 'b'
  });
  assert.equal(snapshot.turn, 'b');
  assert.equal(snapshot.turnSource, 'clock');
  assert.equal(snapshot.turnCertain, true);
});

test('a move list gives an exact turn and a full uci history', () => {
  const { state } = midgame();
  const snapshot = new Chess.ChessStateTracker().updateFromDomSnapshot(state.grid, {
    plyCount: 5,
    sanMoves: ['e4', 'e5', 'Nf3']
  });
  assert.equal(snapshot.turn, 'b');
  assert.equal(snapshot.turnSource, 'moves');
  assert.deepEqual(snapshot.uciMoves, ['e2e4', 'e7e5', 'g1f3']);
});

test('a tracked game stays certain after its own move', () => {
  const tracker = new Chess.ChessStateTracker();
  const start = tracker.updateFromDomSnapshot(Chess.parseFen(Chess.START_FEN).grid, {});
  assert.equal(start.turnSource, 'start');
  assert.equal(start.turnCertain, true);
  const afterE4 = Chess.replaySanMoves(['e4']);
  const next = tracker.updateFromDomSnapshot(afterE4.state.grid, {});
  assert.equal(next.turn, 'b');
  assert.equal(next.turnCertain, true);
  assert.deepEqual(next.uciMoves, ['e2e4']);
});

test('the search budget outlives the request but stays bounded', () => {
  assert.equal(utils.searchBudgetMs({ moveTimeMs: 700 }), 10200);
  assert.equal(utils.searchBudgetMs({ moveTimeMs: 150 }), 6900);
  assert.equal(utils.searchBudgetMs({ moveTimeMs: 6000 }), 42000);
  assert.ok(utils.searchBudgetMs({}) >= 6000);
});

test('the NNUE verdict is scoped to the pinned mirror and expires', () => {
  const now = 1_700_000_000_000;
  const fresh = JSON.stringify({ mirror: utils.ENGINE_MIRROR, at: now - 1000 });
  assert.equal(utils.nnueSkipActive(fresh, utils.ENGINE_MIRROR, now), true);
  assert.equal(utils.nnueSkipActive(fresh, 'https://example.test/vendor', now), false);
  const stale = JSON.stringify({ mirror: utils.ENGINE_MIRROR, at: now - utils.NNUE_SKIP_TTL_MS - 1 });
  assert.equal(utils.nnueSkipActive(stale, utils.ENGINE_MIRROR, now), false);
  assert.equal(utils.nnueSkipActive('not json', utils.ENGINE_MIRROR, now), false);
  assert.equal(utils.nnueSkipActive('', utils.ENGINE_MIRROR, now), false);
});

test('the engine mirror is pinned to a tag, never to a branch', () => {
  assert.match(utils.ENGINE_MIRROR, /@v\d+\.\d+\.\d+\//);
  assert.ok(!utils.ENGINE_MIRROR.includes('@main'));
});
