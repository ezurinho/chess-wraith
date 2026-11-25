const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFragments } = require('./helpers.js');

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
