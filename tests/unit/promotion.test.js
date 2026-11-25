// A promotion dialog that is painted one frame late used to be a missed click:
// the move never registered and the session stopped. The poll is what fixes it,
// so the poll is what gets tested.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFragments } = require('./helpers');

const api = loadFragments(
  ['10-config.js', '20-utils.js', '30-chess.js', '35-chess-glue.js', '70-input.js'],
  `{ awaitPromotionPiece, findPromotionPiece, promotionPollPlan }`
);

function boardWithPieceAfter(hits) {
  const calls = { lookups: 0, sleeps: [] };
  const piece = { id: 'queen' };
  const boardEl = {
    querySelector: () => {
      calls.lookups += 1;
      return calls.lookups >= hits ? piece : null;
    }
  };
  return { boardEl, piece, calls };
}

test('a dialog that appears late is waited for, not missed', async () => {
  const { boardEl, piece, calls } = boardWithPieceAfter(3);
  const slept = [];
  const found = await api.awaitPromotionPiece(boardEl, 'wq', 8, 120, async (ms) => { slept.push(ms); });
  assert.equal(found, piece);
  assert.equal(calls.lookups, 3);
  assert.deepEqual(slept, [120, 120], 'it pauses between looks, not after the last one');
});

test('a dialog already on screen is pressed without waiting', async () => {
  const { boardEl, piece } = boardWithPieceAfter(1);
  const slept = [];
  const found = await api.awaitPromotionPiece(boardEl, 'wq', 8, 120, async (ms) => { slept.push(ms); });
  assert.equal(found, piece);
  assert.equal(slept.length, 0);
});

test('a dialog that never appears gives up instead of hanging the move', async () => {
  const { boardEl, calls } = boardWithPieceAfter(99);
  const slept = [];
  const found = await api.awaitPromotionPiece(boardEl, 'wq', 8, 120, async (ms) => { slept.push(ms); });
  assert.equal(found, null);
  assert.equal(calls.lookups, 8);
  assert.equal(slept.length, 7);
  assert.ok(slept.every((ms) => ms === 120));
});

test('one attempt means one look', async () => {
  const { boardEl, calls } = boardWithPieceAfter(99);
  const found = await api.awaitPromotionPiece(boardEl, 'wq', 1, 120, async () => {});
  assert.equal(found, null);
  assert.equal(calls.lookups, 1);
});

test('a promoted pawn with two seconds left does not spend them waiting', () => {
  const full = api.promotionPollPlan(null);
  assert.equal(full.attempts, 8, 'no clock: the old patience');
  assert.equal(full.pauseMs, 120);
  const long = api.promotionPollPlan(300);
  assert.equal(long.attempts, 8, 'a long clock too');
  assert.equal(long.pauseMs, 120);

  const short = api.promotionPollPlan(1);
  assert.ok(short.pauseMs < 120, 'polls faster');
  assert.ok(short.attempts * short.pauseMs <= 400, 'well under a second of clock');

  const mid = api.promotionPollPlan(6);
  assert.ok(mid.attempts >= 2 && mid.attempts <= 8);
  assert.ok(mid.attempts * mid.pauseMs <= 6 * 1000 * 0.4, 'a fraction of the clock');

  assert.equal(api.promotionPollPlan('x').attempts, 8, 'junk falls back to the full poll');
  assert.equal(api.promotionPollPlan(-4).pauseMs, 120);
});

test('the class asked for is the colour and the piece', async () => {
  const seen = [];
  const boardEl = { querySelector: (sel) => { seen.push(sel); return null; } };
  await api.awaitPromotionPiece(boardEl, 'bq', 1, 1, async () => {});
  assert.match(seen[0], /promotion-window \.promotion-piece\.bq$/);
});
