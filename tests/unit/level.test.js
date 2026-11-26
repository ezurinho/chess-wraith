'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFragments } = require('./helpers');

const api = loadFragments(
  ['10-config.js', '20-utils.js', '60-analysis.js'],
  '{ acplBand, levelPlayTarget, styleProfile, chooseMove, LEGIT }'
);

const line = (uci, cp, mate = null) => ({ bestUci: uci, scoreCp: cp, mateIn: mate, evalText: '' });
const cfg = { humanSlackCp: 40, minThinkMs: 700, maxThinkMs: 3200 };

test('the beginner band is steep, bounded and joins the old curve at the floor', () => {
  assert.ok(api.acplBand(133) >= 270, 'a 133 account gives away close to a piece a move');
  assert.ok(api.acplBand(133) <= 320);
  assert.equal(api.acplBand(600), 200);
  assert.ok(api.acplBand(1320) <= 60, 'and the floor is back on the published curve');
  assert.ok(api.acplBand(1000) > api.acplBand(1320));
});

test('level play exists only below the engine floor, and only when asked', () => {
  assert.equal(api.levelPlayTarget(133, {}), api.acplBand(133));
  assert.equal(api.levelPlayTarget(133, { levelPlay: false }), 0);
  assert.equal(api.levelPlayTarget(1320, {}), 0);
  assert.equal(api.levelPlayTarget(2100, {}), 0);
  assert.equal(api.levelPlayTarget(0, {}), 0);
  assert.ok(api.levelPlayTarget(50, {}) <= 320);
});

test('the profile widens and relabels only for a sub-floor account', () => {
  const low = api.styleProfile(cfg, { accountElo: 133 });
  assert.equal(low.label, 'level');
  assert.ok(low.slack >= 586, `slack was ${low.slack}`);
  assert.ok(low.slack <= 720);
  const high = api.styleProfile(cfg, { accountElo: 1400 });
  assert.equal(high.label, api.LEGIT.label);
  assert.equal(high.level, 0);
});

test('a low account plays moves of its own size, not the best one', () => {
  const lines = [line('e2e4', 0), line('d2d4', -15), line('h2h4', -120), line('a2a3', -290)];
  let total = 0;
  let far = 0;
  for (let i = 0; i < 200; i++) {
    const pick = api.chooseMove(lines, cfg, { accountElo: 133 });
    total += pick.cpLoss;
    if (pick.cpLoss >= 100) far++;
  }
  const mean = total / 200;
  assert.ok(mean >= 110, `mean loss was ${mean}`);
  assert.ok(far >= 100, `only ${far}/200 were 100 cp or worse`);
});

test('turning level play off restores the near-best chooser', () => {
  const lines = [line('e2e4', 0), line('d2d4', -15), line('h2h4', -120), line('a2a3', -290)];
  let total = 0;
  for (let i = 0; i < 100; i++) {
    total += api.chooseMove(lines, { ...cfg, levelPlay: false }, { accountElo: 133 }).cpLoss;
  }
  assert.ok(total / 100 <= 60, `mean loss was ${total / 100}`);
});

test('level play never hands over a forced mate', () => {
  const lines = [line('e2e4', 0), line('a2a3', 0, -1), line('h2h4', -120)];
  for (let i = 0; i < 60; i++) {
    assert.notEqual(api.chooseMove(lines, cfg, { accountElo: 133 }).line.bestUci, 'a2a3');
  }
  const mate = api.chooseMove([line('e2e4', 0, 2), line('a2a3', 0, -1)], cfg, { accountElo: 133 });
  assert.equal(mate.line.bestUci, 'e2e4', 'its own mate in 2 is still taken');
});
