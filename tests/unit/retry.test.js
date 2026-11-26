const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadFragments } = require('./helpers.js');

const Chess = require(path.resolve(__dirname, '..', '..', 'src', '30-chess.js'));
const api = loadFragments(
  ['10-config.js', '20-utils.js'],
  `{ moveRetryPlan, autoArmDecision, throttleDecision }`
);

test('a swallowed click gets three growing attempts, then an honest stop', () => {
  assert.deepEqual([api.moveRetryPlan(1).retry, api.moveRetryPlan(1).delayMs], [true, 900]);
  assert.deepEqual([api.moveRetryPlan(2).retry, api.moveRetryPlan(2).delayMs], [true, 1800]);
  assert.deepEqual([api.moveRetryPlan(3).retry, api.moveRetryPlan(3).delayMs], [true, 2700]);
  assert.deepEqual([api.moveRetryPlan(4).retry, api.moveRetryPlan(4).delayMs], [false, 0], 'the fourth miss is the board, not the click');
});

test('a landed move is the move that was asked for, on the first try or the second', () => {
  const start = Chess.parseFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1').grid;
  const e4 = Chess.parseFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1').grid;
  const d4 = Chess.parseFen('rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1').grid;
  assert.equal(Chess.moveLanded(start, start, e4), 'none', 'a swallowed click changes nothing');
  assert.equal(Chess.moveLanded(start, e4, e4), 'landed');
  assert.equal(Chess.moveLanded(start, null, e4), 'none', 'an unreadable board claims nothing');
  assert.equal(Chess.moveLanded(start, d4, e4), 'wrong', 'another piece moved is not the move');
  assert.equal(Chess.moveLanded(start, d4, null), 'landed', 'no rule for the expected grid, no verdict against it');
});

test('a batched timer is only called batched when the tab is hidden', () => {
  assert.equal(api.throttleDecision({ hidden: true, lagMs: 60000, expectedMs: 2000 }), true, 'a minute for a 2 s tick');
  assert.equal(api.throttleDecision({ hidden: false, lagMs: 60000, expectedMs: 2000 }), false, 'a visible tab is just busy');
  assert.equal(api.throttleDecision({ hidden: true, lagMs: 2400, expectedMs: 2000 }), false, 'a little jitter is not throttling');
  assert.equal(api.throttleDecision({ hidden: true, lagMs: 5200, expectedMs: 2000 }), true, 'more than 1.8x is a batch');
  assert.equal(api.throttleDecision({ hidden: true, lagMs: NaN, expectedMs: 2000 }), false, 'no measurement, no claim');
});

const idle = {
  autoPlay: true,
  thinking: false,
  autoTimer: null,
  retryTimer: null,
  gameOver: false,
  analysisFen: 'fen-a',
  snapshotFen: 'fen-a',
  ourTurn: true
};

test('the idle tick arms a move only when there is one to arm', () => {
  assert.equal(api.autoArmDecision(idle), true, 'our turn, fresh analysis, nothing armed');
  assert.equal(api.autoArmDecision({ ...idle, gameOver: true }), false, 'a finished game keeps the last position');
  assert.equal(api.autoArmDecision({ ...idle, ourTurn: false }), false, 'not our turn');
  assert.equal(api.autoArmDecision({ ...idle, thinking: true }), false, 'a search is running');
  assert.equal(api.autoArmDecision({ ...idle, autoTimer: 7 }), false, 'already armed');
  assert.equal(api.autoArmDecision({ ...idle, retryTimer: 7 }), false, 'a retry owns the move');
  assert.equal(api.autoArmDecision({ ...idle, autoPlay: false }), false, 'auto-play off');
  assert.equal(api.autoArmDecision({ ...idle, snapshotFen: 'fen-b' }), false, 'analysis for a position that is gone');
  assert.equal(api.autoArmDecision({ ...idle, analysisFen: '' }), false, 'nothing analysed yet');
});

test('the attempts grow and the first one is always taken', () => {
  const first = api.moveRetryPlan(0);
  assert.equal(first.retry, true, 'a bare zero is still one attempt');
  assert.equal(first.delayMs, 900);
  assert.ok(api.moveRetryPlan(2).delayMs > api.moveRetryPlan(1).delayMs);
  assert.equal(api.moveRetryPlan('nonsense').delayMs, 900, 'garbage means the first attempt');
});
