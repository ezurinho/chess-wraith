'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFragments } = require('./helpers');

const api = loadFragments(
  ['10-config.js', '20-utils.js'],
  `{ timeClassFromSeconds, normalizeRatings, pickRating, RATING_CLASSES }`
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
});

test('the published classes map to the public endpoint keys', () => {
  assert.equal(
    JSON.stringify(api.RATING_CLASSES),
    JSON.stringify({ bullet: 'chess_bullet', blitz: 'chess_blitz', rapid: 'chess_rapid', daily: 'chess_daily' })
  );
});
