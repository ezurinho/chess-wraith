const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFragments } = require('./helpers.js');

const api = loadFragments(
  ['10-config.js', '20-utils.js'],
  `{ moveRetryPlan }`
);

test('a swallowed click gets three growing attempts, then an honest stop', () => {
  assert.deepEqual([api.moveRetryPlan(1).retry, api.moveRetryPlan(1).delayMs], [true, 900]);
  assert.deepEqual([api.moveRetryPlan(2).retry, api.moveRetryPlan(2).delayMs], [true, 1800]);
  assert.deepEqual([api.moveRetryPlan(3).retry, api.moveRetryPlan(3).delayMs], [true, 2700]);
  assert.deepEqual([api.moveRetryPlan(4).retry, api.moveRetryPlan(4).delayMs], [false, 0], 'the fourth miss is the board, not the click');
});

test('the attempts grow and the first one is always taken', () => {
  const first = api.moveRetryPlan(0);
  assert.equal(first.retry, true, 'a bare zero is still one attempt');
  assert.equal(first.delayMs, 900);
  assert.ok(api.moveRetryPlan(2).delayMs > api.moveRetryPlan(1).delayMs);
  assert.equal(api.moveRetryPlan('nonsense').delayMs, 900, 'garbage means the first attempt');
});
