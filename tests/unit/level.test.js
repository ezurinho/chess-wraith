'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFragments } = require('./helpers');

const api = loadFragments(
  ['10-config.js', '20-utils.js', '60-analysis.js'],
  '{ acplBand, levelPlayTarget, improvisationChance, beginnerWeight, pickImprovised, styleProfile, chooseMove, LEGIT }'
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

test('the improvisation rate only exists below the floor and never reaches half', () => {
  assert.equal(api.improvisationChance(0), 0);
  assert.equal(api.improvisationChance(100), 0);
  assert.ok(Math.abs(api.improvisationChance(293) - 0.412) < 0.01);
  assert.equal(api.improvisationChance(600), 0.5);
});

test('an improvised move comes from the legal list, not from the engine', () => {
  const pool = ['a2a3', 'h2h4', 'g2g4', 'b2b3', 'f2f3', 'c2c3'].map((uci) => ({ uci }));
  const lines = [line('e2e4', 0), line('d2d4', -15), line('g1f3', -30)];
  const forced = api.chooseMove(lines, cfg, { accountElo: 133, improvise: pool, rng: () => 0 });
  assert.equal(forced.improvised, true);
  assert.equal(forced.reason, 'level');
  assert.ok(pool.some((p) => p.uci === forced.line.bestUci));
  assert.equal(forced.cpLoss, api.acplBand(133), 'the model counts the move at its own target');
  const engine = api.chooseMove(lines, cfg, { accountElo: 133, improvise: pool, rng: () => 0.99 });
  assert.notEqual(engine.improvised, true);
  assert.ok(['e2e4', 'd2d4', 'g1f3'].includes(engine.line.bestUci));
});

test('an improvised move grabs material instead of wandering', () => {
  assert.ok(api.beginnerWeight({ capture: 9 }) > api.beginnerWeight({ capture: 0 }));
  assert.ok(api.beginnerWeight({ check: true }) > api.beginnerWeight({}));
  assert.ok(api.beginnerWeight({ piece: 'K' }) < api.beginnerWeight({ piece: 'N' }));
  const pool = [
    { uci: 'qx', capture: 9 },
    { uci: 'px', capture: 1 },
    { uci: 'nd' },
    { uci: 'kg', piece: 'K' },
    { uci: 'qe', piece: 'Q', ply: 6 },
    { uci: 'pp' }
  ];
  let queens = 0;
  let kings = 0;
  for (let i = 0; i < 600; i += 1) {
    const pick = api.pickImprovised(pool, Math.random);
    if (pick.uci === 'qx') queens += 1;
    if (pick.uci === 'kg') kings += 1;
  }
  assert.ok(queens > 300, `took the free queen ${queens} times of 600`);
  assert.ok(kings < 60, `walked the king ${kings} times of 600`);
});

test('fourteen lines put the delivered loss in the account range', () => {
  const losses = [0, 15, 35, 55, 75, 100, 125, 155, 190, 225, 260, 300, 340, 380];
  const lines = losses.map((l) => line('e2e4', -l));
  let total = 0;
  for (let i = 0; i < 400; i++) total += api.chooseMove(lines, cfg, { accountElo: 133 }).cpLoss;
  const mean = total / 400;
  assert.ok(mean >= 150, `mean loss was ${mean}, the four-line set delivered 43`);
  assert.ok(mean <= 290, `mean loss was ${mean}`);
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
