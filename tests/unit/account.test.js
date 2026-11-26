'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFragments } = require('./helpers');

const api = loadFragments(
  ['10-config.js', '20-utils.js'],
  `{ timeClassFromSeconds, normalizeRatings, pickRating, normalizeGameCounts, ratingWeight, settledRating, strengthFloor, floorSlack, ELO_FLOOR, RATING_CLASSES, formOffset, ratingRefreshDue, RATING_REFRESH_MS }`
);

test('the clock decides which published rating applies', () => {
  assert.equal(api.timeClassFromSeconds(60), 'bullet');
  assert.equal(api.timeClassFromSeconds(179), 'bullet');
  assert.equal(api.timeClassFromSeconds(180), 'blitz');
  assert.equal(api.timeClassFromSeconds(599), 'blitz');
  assert.equal(api.timeClassFromSeconds(600), 'rapid');
  assert.equal(api.timeClassFromSeconds(1799), 'rapid');
  assert.equal(api.timeClassFromSeconds(1800), 'daily');
  // No clock on the board (analysis page, daily game) reads as blitz.
  assert.equal(api.timeClassFromSeconds(0), 'blitz');
  assert.equal(api.timeClassFromSeconds(NaN), 'blitz');
  assert.equal(api.timeClassFromSeconds(undefined), 'blitz');
});

test('only the classes the account actually has survive normalization', () => {
  const stats = {
    chess_bullet: { last: { rating: 1201.6 } },
    chess_blitz: { last: { rating: 1840 } },
    chess_rapid: { last: {} },
    puzzle_rush: { best: { score: 12 } }
  };
  const ratings = api.normalizeRatings(stats);
  assert.equal(JSON.stringify(ratings), JSON.stringify({ bullet: 1202, blitz: 1840 }));
  assert.equal(api.normalizeRatings({}), null);
  assert.equal(api.normalizeRatings(null), null);
  assert.equal(api.normalizeRatings({ chess_blitz: { last: { rating: 0 } } }), null);
});

test('a missing class falls back to the nearest one the account plays', () => {
  const ratings = { bullet: 1200, rapid: 1650, daily: 1500 };
  assert.equal(api.pickRating(ratings, 'rapid'), 1650);
  // No blitz rating: rapid is the closest thing to a real number.
  assert.equal(api.pickRating(ratings, 'blitz'), 1650);
  assert.equal(api.pickRating({ bullet: 1200 }, 'daily'), 1200);
  assert.equal(api.pickRating(null, 'blitz'), null);
  assert.equal(api.pickRating({}, 'blitz'), null);

  const counted = api.normalizeGameCounts({
    chess_rapid: { last: { rating: 1650 }, record: { win: 210, loss: 80, draw: 10 } },
    chess_bullet: { last: { rating: 1200 }, record: { win: 0, loss: 0, draw: 0 } }
  });
  assert.equal(counted.rapid, 300, 'win + loss + draw');
  assert.equal(counted.bullet, undefined, 'a class with no games is not counted');
  assert.equal(api.normalizeGameCounts({}), null);
  assert.equal(api.normalizeGameCounts(null), null);

  // Provisional ratings move the engine target less than settled ones do.
  assert.ok(api.ratingWeight(2) < api.ratingWeight(20), 'more games, more weight');
  assert.ok(api.ratingWeight(20) < api.ratingWeight(200), 'settling keeps going');
  assert.equal(api.ratingWeight(0), 0);
  assert.equal(api.ratingWeight(NaN), 0);
  assert.ok(api.ratingWeight(100000) <= 0.9, 'a prior never fully disappears');

  const twoGames = api.settledRating(2100, 2, 1200);
  const settled = api.settledRating(2100, 200, 1200);
  assert.ok(twoGames > 1500 && twoGames < 1700, 'two games pull towards the prior: ' + twoGames);
  assert.ok(settled > 1950 && settled < 2100, 'settled stays under the rating: ' + settled);
  assert.equal(api.settledRating(2100, 200, 1200), api.settledRating(2100, 500, 1200), 'capped weight');
  assert.equal(api.settledRating(0, 10), null);
  assert.equal(api.settledRating('x', 10), null);
  assert.equal(api.settledRating(2100, 0, 1200), 1200, 'no games is all prior');

  // Stockfish cannot be asked for less than 1320, and the panel has to say so.
  const low = api.strengthFloor(900);
  assert.equal(low.requested, 900);
  assert.equal(low.floor, api.ELO_FLOOR);
  assert.equal(low.gap, api.ELO_FLOOR - 900);
  assert.equal(api.strengthFloor(1800).gap, 0, 'above the floor nothing is lost');
  assert.equal(api.strengthFloor(4000).floor, 3190, 'top end clamps too');
  assert.equal(api.strengthFloor(NaN).gap, 0);

  assert.equal(api.floorSlack(1800), 0, 'no slack above the floor');
  assert.equal(api.floorSlack(900), 84, '420 points under the floor');
  assert.equal(api.floorSlack(600), 120, 'capped');
  assert.ok(api.floorSlack(700) >= api.floorSlack(900), 'lower rating, more slack');
});

test('the published classes map to the public endpoint keys', () => {
  assert.equal(
    JSON.stringify(api.RATING_CLASSES),
    JSON.stringify({ bullet: 'chess_bullet', blitz: 'chess_blitz', rapid: 'chess_rapid', daily: 'chess_daily' })
  );
});
test('form is per game and never repeats a constant strength', () => {
  const spans = new Set();
  for (let game = 0; game < 24; game += 1) spans.add(api.formOffset(`tester:${game}`, 30));
  assert.ok(spans.size > 8, `24 games produced only ${spans.size} distinct forms`);
  for (const value of spans) {
    assert.ok(Number.isInteger(value) && Math.abs(value) <= 30, `form ${value} outside ±30`);
  }
  // Same game, same strength: a re-scan must not move the dial.
  assert.equal(api.formOffset('tester:7', 30), api.formOffset('tester:7', 30));
  assert.notEqual(api.formOffset('tester:7', 30), api.formOffset('tester:8', 30));
  assert.equal(api.formOffset('', 30), 0, 'no account, no form');
  assert.equal(api.formOffset('tester', 0), 0);
});

test('the profile rating is re-read during a session, but not on every game', () => {
  const now = 1_000_000_000;
  const min = api.RATING_REFRESH_MS;
  assert.equal(api.ratingRefreshDue(now, now - min, 4, 0), true, 'four games after boot');
  assert.equal(api.ratingRefreshDue(now, now - min, 2, 0), false, 'only two games in');
  assert.equal(api.ratingRefreshDue(now, now - 1000, 9, 0), false, 'a minute ago is too soon');
  assert.equal(api.ratingRefreshDue(now, 0, 5, 0), true, 'never fetched');
  assert.equal(api.ratingRefreshDue(now, now - min, 9, 8), false, 'one game since the last fetch');
});
