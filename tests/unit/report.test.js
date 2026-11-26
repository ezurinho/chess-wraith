'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFragments } = require('./helpers');

const api = loadFragments(
  ['10-config.js', '20-utils.js', '30-chess.js', '35-chess-glue.js', '62-report.js'],
  `{ gameReport, performanceFromAcpl, REPORT_MIN_SAMPLES }`
);

test('a better game is a higher performance, monotonically', () => {
  const scores = [2, 5, 10, 20, 40, 80, 160].map((acpl) => api.performanceFromAcpl(acpl));
  for (let i = 1; i < scores.length; i += 1) {
    assert.ok(scores[i] < scores[i - 1], `acpl ${i} must rank below the one before`);
  }
  assert.ok(scores[0] <= 2850 && scores[scores.length - 1] >= 1050);
  assert.equal(api.performanceFromAcpl(-1), null);
  assert.equal(api.performanceFromAcpl('nonsense'), null);
});

test('four assessed moves are not an average', () => {
  const thin = api.gameReport({ result: 'win', moves: 9, myLosses: [10, 10, 10, 10], oppLosses: [20, 20, 20, 20], rating: 133 });
  assert.equal(api.REPORT_MIN_SAMPLES, 5);
  assert.equal(thin.myAcpl, null);
  assert.equal(thin.myPerf, null);
  assert.equal(thin.oppAcpl, null);
  assert.equal(thin.delta, null);
  assert.equal(thin.result, 'win');
  assert.equal(thin.moves, 9);
  assert.equal(thin.samples, 4);
});

test('the report averages both sides and measures the gap to the account', () => {
  const report = api.gameReport({
    result: 'draw',
    moves: 48,
    myLosses: [4, 8, 12, 16, 20],
    oppLosses: [30, 30, 30, 30, 30, 30],
    rating: 133,
    at: 1700000000000
  });
  assert.equal(report.myAcpl, 12);
  assert.equal(report.oppAcpl, 30);
  assert.ok(report.myPerf > report.oppPerf);
  assert.equal(report.delta, report.myPerf - 133);
  assert.equal(report.rating, 133);
  assert.equal(report.at, 1700000000000);
});

test('losses are clamped, junk is dropped and a missing rating means no delta', () => {
  const report = api.gameReport({
    result: 'loss',
    moves: 30,
    myLosses: [0, -5, 5000, '12', NaN, null, 8, 30],
    oppLosses: 'not a list',
    rating: 0
  });
  assert.equal(report.samples, 5, 'a null, a negative and a NaN are not samples');
  assert.equal(report.myAcpl, 130, 'and a 5000 cp loss is clamped to the 600 ceiling: (0+600+12+8+30)/5');
  assert.equal(report.oppAcpl, null);
  assert.equal(report.rating, null);
  assert.equal(report.delta, null);
});

test('an empty report is still a valid shape', () => {
  const report = api.gameReport();
  assert.equal(report.result, '');
  assert.equal(report.moves, null);
  assert.equal(report.myAcpl, null);
  assert.equal(report.samples, 0);
  assert.ok(report.at > 0);
});
