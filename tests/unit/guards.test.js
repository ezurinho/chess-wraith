// The three account-safety guards: one tab per board, a human takeover pauses
// auto-play, and an account playing far above its rating gets more slack.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFragments } = require('./helpers');

const utils = loadFragments(['10-config.js', '20-utils.js'], `{ tabLeaseDecision, foreignMoveSeen }`);
const analysis = loadFragments(
  ['10-config.js', '20-utils.js', '60-analysis.js'],
  `{ acplBand, acplGuard }`
);

test('an empty lease is claimed', () => {
  assert.equal(utils.tabLeaseDecision(null, 1000, 9000, 'me'), 'claim');
  assert.equal(utils.tabLeaseDecision(undefined, 1000, 9000, 'me'), 'claim');
});

test('a fresh lease held by another tab blocks this one', () => {
  assert.equal(utils.tabLeaseDecision({ id: 'other', at: 900 }, 1000, 9000, 'me'), 'passive');
});

test('a stale lease is taken over, so a closed tab never locks the board', () => {
  assert.equal(utils.tabLeaseDecision({ id: 'other', at: 0 }, 20000, 9000, 'me'), 'claim');
});

test('our own fresh lease is renewed, not contested', () => {
  assert.equal(utils.tabLeaseDecision({ id: 'me', at: 900 }, 1000, 9000, 'me'), 'renew');
});

test('a corrupt lease is ignored instead of bricking auto-play', () => {
  assert.equal(utils.tabLeaseDecision({}, 1000, 9000, 'me'), 'claim');
  assert.equal(utils.tabLeaseDecision({ id: 'x', at: 'soon' }, 1000, 9000, 'me'), 'claim');
  assert.equal(utils.tabLeaseDecision('nope', 1000, 9000, 'me'), 'claim');
});

test('the opponent moving is not a takeover', () => {
  const seen = utils.foreignMoveSeen({
    prevCertain: true, nextCertain: true, prevMine: false, nextMine: true, matchedOurGrid: false
  });
  assert.equal(seen, false);
});

test('a board without clocks never triggers a takeover', () => {
  const seen = utils.foreignMoveSeen({
    prevCertain: true, nextCertain: true, prevMine: true, nextMine: false,
    hasClock: false, plyAdvanced: true, matchedOurGrid: false
  });
  assert.equal(seen, false);
});

test('a board change that does not advance the ply is not a takeover', () => {
  const seen = utils.foreignMoveSeen({
    prevCertain: true, nextCertain: true, prevMine: true, nextMine: false,
    hasClock: true, plyAdvanced: false, matchedOurGrid: false
  });
  assert.equal(seen, false);
});

test('our own click landing is not a takeover', () => {
  const seen = utils.foreignMoveSeen({
    prevCertain: true, nextCertain: true, prevMine: true, nextMine: false,
    hasClock: true, plyAdvanced: true, matchedOurGrid: true
  });
  assert.equal(seen, false);
});

test('a move on our turn that we never clicked is a takeover', () => {
  const seen = utils.foreignMoveSeen({
    prevCertain: true, nextCertain: true, prevMine: true, nextMine: false,
    hasClock: true, plyAdvanced: true, matchedOurGrid: false
  });
  assert.equal(seen, true);
});

test('a guessed turn never triggers the takeover guard', () => {
  const base = { prevMine: true, nextMine: false, matchedOurGrid: false, hasClock: true, plyAdvanced: true };
  assert.equal(utils.foreignMoveSeen({ ...base, prevCertain: false, nextCertain: true }), false);
  assert.equal(utils.foreignMoveSeen({ ...base, prevCertain: true, nextCertain: false }), false);
});

test('the expected accuracy band tightens as the rating rises', () => {
  assert.ok(analysis.acplBand(1200) > analysis.acplBand(1600));
  assert.ok(analysis.acplBand(1600) > analysis.acplBand(2000));
  assert.ok(analysis.acplBand(2000) >= analysis.acplBand(2600));
  assert.equal(analysis.acplBand(3000), analysis.acplBand(3200));
  assert.ok(analysis.acplBand(3000) <= 12);
});

test('the band stays in a sane range at both ends', () => {
  assert.ok(analysis.acplBand(600) <= 90);
  assert.ok(analysis.acplBand(2600) >= 8);
});

test('the guard waits until it has enough moves to judge', () => {
  const verdict = analysis.acplGuard({ acpl: 5, samples: 6, elo: 1600, boost: 0 });
  assert.equal(verdict.verdict, 'wait');
  assert.equal(verdict.boost, 0);
});

test('playing far too well for the rating raises the slack', () => {
  const band = analysis.acplBand(1600);
  const verdict = analysis.acplGuard({ acpl: band * 0.3, samples: 20, elo: 1600, boost: 0 });
  assert.equal(verdict.verdict, 'raise');
  assert.ok(verdict.boost > 0);
  assert.ok(verdict.boost <= 160);
});

test('playing inside the band holds the slack', () => {
  const band = analysis.acplBand(1600);
  const verdict = analysis.acplGuard({ acpl: band, samples: 20, elo: 1600, boost: 12 });
  assert.equal(verdict.verdict, 'hold');
  assert.equal(verdict.boost, 12);
});

test('playing far below the band gives slack back', () => {
  const band = analysis.acplBand(1600);
  const verdict = analysis.acplGuard({ acpl: band * 3, samples: 20, elo: 1600, boost: 40 });
  assert.equal(verdict.verdict, 'lower');
  assert.ok(verdict.boost < 40);
});

test('the guard never lowers a zero boost below zero', () => {
  const band = analysis.acplBand(1600);
  const verdict = analysis.acplGuard({ acpl: band * 3, samples: 20, elo: 1600, boost: 0 });
  assert.equal(verdict.boost, 0);
});

test('a boost is capped so the bot never becomes a random mover', () => {
  const verdict = analysis.acplGuard({ acpl: 1, samples: 40, elo: 1000, boost: 155 });
  assert.ok(verdict.boost <= 160);
});
