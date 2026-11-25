// The account's published median is per time class. Multiplying it by the clock
// a second time is how the script used to play a 1-minute game at 350 ms while
// the account's own bullet games average 700. That is the kind of gap a fair-play
// check looks for, so the arithmetic is worth a test.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFragments } = require('./helpers');

const api = loadFragments(
  ['10-config.js', '20-utils.js', '30-chess.js', '35-chess-glue.js', '55-pace.js', '60-analysis.js'],
  `{ computeDelay, classMedianMs }`
);

const cfg = { minThinkMs: 700, maxThinkMs: 1600, pauseOnLowClock: false, clockFloorSeconds: 30 };

function sample(opts, n = 200) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(api.computeDelay(cfg, opts));
  return out;
}

function range(values) {
  return [Math.min(...values), Math.max(...values)];
}

test('a class-scoped baseline is not scaled by the clock a second time', () => {
  const [lo, hi] = range(sample({ baselineMs: 700, budgetSeconds: 60, baselineClassScoped: true }));
  assert.ok(lo >= 454, `too fast for the account: ${lo}`);
  assert.ok(hi <= 1051, `too slow for the account: ${hi}`);
});

test('without the flag the time control still scales the baseline', () => {
  const [lo, hi] = range(sample({ baselineMs: 700, budgetSeconds: 60 }));
  assert.ok(hi <= 526, `bullet scaling is gone: ${hi}`);
  assert.ok(lo >= 250, `below the floor: ${lo}`);
});

test('with no baseline at all the time control still decides', () => {
  const bullet = range(sample({ budgetSeconds: 60 }));
  const rapid = range(sample({ budgetSeconds: 900 }));
  assert.ok(bullet[1] <= 800, `bullet not the fastest: ${bullet[1]}`);
  assert.ok(rapid[0] >= 805, `rapid not the slowest: ${rapid[0]}`);
});

test('a fresh profile starts from the measured median of its class', () => {
  assert.equal(api.classMedianMs('bullet'), 700);
  assert.equal(api.classMedianMs('blitz'), 1600);
  assert.equal(api.classMedianMs('rapid'), 5500);
  assert.equal(api.classMedianMs('daily'), null, 'no measurement, no invented number');
  assert.equal(api.classMedianMs(undefined), null);
});

test('a rapid game with no history is not played at blitz speed', () => {
  const rapid = api.classMedianMs('rapid');
  const [lo, hi] = range(sample({ baselineMs: rapid, budgetSeconds: 900, baselineClassScoped: true }));
  assert.ok(lo >= 3574, `too fast for rapid: ${lo}`);
  assert.ok(hi <= 8251, `too slow for rapid: ${hi}`);
  const [bulletLo] = range(sample({ baselineMs: api.classMedianMs('bullet'), budgetSeconds: 60, baselineClassScoped: true }));
  assert.ok(bulletLo < lo, 'a bullet default is still faster than a rapid one');
});

test('a long game with no baseline is slower than a short one', () => {
  const avg = (values) => values.reduce((a, b) => a + b, 0) / values.length;
  const short = avg(sample({ budgetSeconds: 120 }, 400));
  const long = avg(sample({ budgetSeconds: 900 }, 400));
  assert.ok(long > short * 1.4, `class scale collapsed: ${short} vs ${long}`);
});
