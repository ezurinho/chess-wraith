'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFragments } = require('./helpers');

const api = loadFragments(
  ['10-config.js', '20-utils.js', '30-chess.js', '35-chess-glue.js', '62-report.js'],
  `{ gameReport, performanceFromAcpl, pushReport, reportSummary, REPORT_MIN_SAMPLES, REPORT_HISTORY_LIMIT }`
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

test('the history keeps twenty games and does not double a result', () => {
  let list = [];
  for (let i = 0; i < 25; i += 1) list = api.pushReport(list, { result: 'win', at: 1000 + i, moves: 30 });
  assert.equal(api.REPORT_HISTORY_LIMIT, 20);
  assert.equal(list.length, 20);
  assert.equal(list[0].at, 1005, 'the oldest five fell off');
  const again = api.pushReport(list, list[list.length - 1]);
  assert.equal(again.length, 20, 'the same game scanned twice is still one game');
  assert.equal(api.pushReport(list, null).length, 20);
  assert.equal(api.pushReport(list, { result: '' }).length, 20);
});

test('the summary averages only the games that have a number', () => {
  const list = [
    { result: 'win', myAcpl: 10, oppAcpl: 20, myPerf: 2400, at: 1 },
    { result: 'loss', myAcpl: 30, oppAcpl: null, myPerf: null, at: 2 },
    { result: 'win', myAcpl: null, oppAcpl: 40, myPerf: null, at: 3 },
    { result: 'draw', myAcpl: 20, oppAcpl: 30, myPerf: 2000, at: 4 }
  ];
  const sum = api.reportSummary(list);
  assert.equal(sum.games, 4);
  assert.equal(sum.wins, 2);
  assert.equal(sum.losses, 1);
  assert.equal(sum.draws, 1);
  assert.equal(sum.winRate, 50);
  assert.equal(sum.acpl, 20, '(10+30+20)/3, the missing sample is not a zero');
  assert.equal(sum.oppAcpl, 30, '(20+40+30)/3');
  assert.equal(sum.perf, 2200, '(2400+2000)/2');
  assert.equal(sum.best, 10);
  assert.equal(sum.form.length, 4);
  const empty = api.reportSummary([]);
  assert.equal(empty.games, 0);
  assert.equal(empty.winRate, null);
  assert.equal(empty.acpl, null);
  assert.equal(empty.perf, null);
  assert.equal(empty.best, null);
  assert.equal(empty.form.length, 0);
});
