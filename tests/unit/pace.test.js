// The labels under test live in a userscript fragment, so they are loaded the
// same way the build loads them: ordered concat inside one vm context.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const FRAGMENTS = ['10-config.js', '20-utils.js', '55-pace.js'];

function harness(store, fetcher) {
  const source = FRAGMENTS.map((name) => fs.readFileSync(path.join(ROOT, 'src', name), 'utf8')).join('\n');
  const context = vm.createContext({
    console,
    Date,
    Math,
    JSON,
    Number,
    String,
    Array,
    Object,
    RegExp,
    fetch: fetcher || (() => { throw new Error('unexpected fetch'); }),
    localStorage: {
      getItem: (key) => (store && store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { if (store) store.set(key, String(value)); }
    },
    document: { querySelector: () => ({ textContent: 'hikaru' }) },
    window: {},
    refreshPanel: () => {},
    state: { clockPeak: 0, clockSeconds: 0, paceProfile: null, pacePending: false, paceError: '' }
  });
  vm.runInContext(source, context, { filename: 'fragments.js' });
  return vm.runInContext('globalThis', context);
}

// A real chess.com PGN: the clock is a separate token because the comment has a
// space in it, and the move number carries the dots for the black move.
const PGN = [
  '[Event "Live Chess"]',
  '[White "Someone"]',
  '',
  '1. e4 {[%clk 0:03:00]} 1... c5 {[%clk 0:02:58]} 2. Nf3 {[%clk 0:02:57]} 2... d6 {[%clk 0:02:55]}',
  '3. d4 {[%clk 0:02:53]} 3... cxd4 {[%clk 0:02:50]} 4. Nxd4 {[%clk 0:02:47]} 4... Nf6 {[%clk 0:02:40]}',
  '5. Nc3 {[%clk 0:02:44.5]} 5... a6 {[%clk 0:02:30.5]} 6. Be3 {[%clk 0:02:20.5]} 6... e6 {[%clk 0:02:26.5]}',
  '7. f3 {[%clk 0:01:50]} 7... b5 {[%clk 0:02:00]}'
].join(' ');

test('clock deltas are measured per side and every move below the opening is counted', () => {
  const api = harness();
  const times = api.parseClockTimes(PGN).sort((a, b) => a - b);
  // White after move 3: 6s, 2.5s, 24s, 30.5s.
  // Black after move 3: 10s, 9.5s, 4s, 26.5s.
  // Moves 1-3 are book and are excluded before the delta is taken.
  const expected = [2500, 4000, 6000, 9500, 10000, 24000, 26500, 30500];
  assert.equal(times.length, expected.length);
  assert.deepEqual(times, expected);
});

// Premoves take zero seconds and a lost connection takes minutes: neither is a
// think time, and both would be dragged into the median if the filters were gone.
const PGN_NOISE = [
  '1. e4 {[%clk 0:10:00]} 1... c5 {[%clk 0:10:00]} 2. Nf3 {[%clk 0:09:00]} 2... d6 {[%clk 0:09:00]}',
  '3. d4 {[%clk 0:08:00]} 3... cxd4 {[%clk 0:08:00]} 4. Nxd4 {[%clk 0:05:10]} 4... Nf6 {[%clk 0:08:00]}',
  '5. Nc3 {[%clk 0:05:10]} 5... a6 {[%clk 0:03:10]}'
].join(' ');

test('a premove and a three minute stall are dropped instead of skewing the median', () => {
  const api = harness();
  const times = api.parseClockTimes(PGN_NOISE);
  // White 4. Nxd4: 170s (stall, dropped). White 5. Nc3: 0s (premove, dropped).
  // Black 4... Nf6: 0s (premove). Black 5... a6: 290s (stall). Nothing survives.
  assert.deepEqual(JSON.parse(JSON.stringify(times)), []);
});

test('a pgn without clocks and a game with fewer than thirty samples yield no pace', () => {
  const api = harness();
  assert.deepEqual(JSON.parse(JSON.stringify(api.parseClockTimes('1. e4 e5 2. Nf3 Nc6'))).length, 0);
  const few = api.paceFromGames([{ rules: 'chess', time_class: 'blitz', pgn: PGN }], 'blitz');
  assert.equal(few.medianMs, null, 'eight samples is not a median worth anchoring to');
  assert.equal(few.samples, 8);
});

test('only chess games of the requested class are read, and the median is per class', () => {
  const api = harness();
  const games = [];
  for (let i = 0; i < 12; i++) games.push({ rules: 'chess', time_class: 'blitz', pgn: PGN });
  games.push({ rules: 'chess960', time_class: 'blitz', pgn: PGN });
  games.push({ rules: 'chess', time_class: 'rapid', pgn: PGN });
  const blitz = api.paceFromGames(games, 'blitz');
  const rapid = api.paceFromGames(games, 'rapid');
  assert.equal(blitz.samples, 96, 'twelve chess blitz games, eight clocks each');
  assert.equal(blitz.games, 12);
  assert.equal(rapid.samples, 8, 'the rapid game is the only rapid game');
  assert.equal(rapid.medianMs, null, 'and it is too small to use');
  assert.ok(blitz.medianMs > 0);
});
// The account is only one of the two players in its archive. Mixing the
// opponent's clocks in halves the signal, and in a game against a much slower
// player it does something worse: it teaches the script the wrong rhythm.
const PGN_BOTH = [
  '[White "Slowpoke"]',
  '[Black "Hikaru"]',
  '',
  '1. e4 {[%clk 0:10:00]} 1... c5 {[%clk 0:10:00]} 2. Nf3 {[%clk 0:09:40]} 2... d6 {[%clk 0:09:58]}',
  '3. d4 {[%clk 0:09:20]} 3... cxd4 {[%clk 0:09:56]} 4. Nxd4 {[%clk 0:09:00]} 4... Nf6 {[%clk 0:09:54]}',
  '5. Nc3 {[%clk 0:08:40]} 5... a6 {[%clk 0:09:52]} 6. Be3 {[%clk 0:08:20]} 6... e6 {[%clk 0:09:50]}',
  '7. f3 {[%clk 0:08:00]} 7... b5 {[%clk 0:09:48]}'
].join(' ');

test('the pace is the account\'s own clocks, not its opponents\'', () => {
  const api = harness();
  assert.equal(api.pgnPlayerSide(PGN_BOTH, 'Hikaru'), 'b');
  assert.equal(api.pgnPlayerSide(PGN_BOTH, 'slowpoke'), 'w');
  assert.equal(api.pgnPlayerSide(PGN_BOTH, 'someoneelse'), null);
  const black = api.parseClockTimes(PGN_BOTH, 'b').sort((a, b) => a - b);
  assert.deepEqual(black, [2000, 2000, 2000, 2000], 'black spent two seconds a move');
  const white = api.parseClockTimes(PGN_BOTH, 'w').sort((a, b) => a - b);
  assert.deepEqual(white, [20000, 20000, 20000, 20000], 'white spent twenty');
  const both = api.parseClockTimes(PGN_BOTH).length;
  assert.equal(both, 8);
});

test('the newest games are read first, so an old season cannot set the pace', () => {
  const api = harness();
  const games = [];
  for (let i = 0; i < 40; i++) games.push({ rules: 'chess', time_class: 'blitz', pgn: '[Event "old"] 1. e4 e5' });
  games.push({ rules: 'chess', time_class: 'blitz', pgn: PGN.replace('White \"Someone\"', 'White \"Hikaru\"') });
  const profile = api.paceFromGames(games, 'blitz', 'Hikaru');
  assert.equal(profile.games, 1, 'the one recent game is the one that is read');
  assert.ok(profile.samples >= 4);
});
test('the cache is per time class, so switching bullet and blitz does not refetch', () => {
  const api = harness();
  const bullet = api.paceProfileKey('bullet');
  const blitz = api.paceProfileKey('blitz');
  assert.notEqual(bullet, blitz);
  assert.ok(bullet.includes('hikaru'), 'and it is per account');
});
test('a failed fetch backs off for twenty minutes instead of retrying forever', () => {
  const store = new Map();
  const api = harness(store);
  api.persistPaceProfile({ cls: 'blitz', retryAt: Date.now() + 60000, error: 'HTTP 429' });
  const cached = api.readPaceProfile('blitz');
  assert.deepEqual(cached, { error: 'HTTP 429' }, 'the error is remembered while it is fresh');
  api.persistPaceProfile({ cls: 'blitz', retryAt: Date.now() - 1000, error: 'HTTP 429' });
  assert.equal(api.readPaceProfile('blitz'), null, 'an expired backoff asks again');
});

test('a fresh profile is served from the cache and an old one is not', () => {
  const store = new Map();
  const api = harness(store);
  api.persistPaceProfile({ cls: 'blitz', at: Date.now(), medianMs: 1500, samples: 900, games: 40 });
  assert.equal(api.readPaceProfile('blitz').medianMs, 1500);
  api.persistPaceProfile({ cls: 'blitz', at: Date.now() - 7 * 60 * 60 * 1000, medianMs: 1500 });
  assert.equal(api.readPaceProfile('blitz'), null, 'six hour TTL');
  assert.equal(api.readPaceProfile('bullet'), null, 'and the class is part of the key');
});

test('a click while a request is in flight does not download the archive twice', async () => {
  let calls = 0;
  const context = harness(new Map());
  context.state.clockPeak = 300;
  context.fetch = () => { calls += 1; return new Promise(() => {}); };
  const first = context.syncPaceProfile(true);
  const second = context.syncPaceProfile(true);
  const secondValue = await second;
  assert.equal(secondValue, null, 'the second call returns immediately');
  assert.equal(calls, 1, 'only one request went out');
  assert.ok(first);
});
// The archive that carries the clocks carries the PGNs, so the account's first
// move is a free fact: it is what a repertoire is made of.
const game = (white, black, moves, rules = 'chess') => ({
  rules,
  pgn: `[White "${white}"] [Black "${black}"]\n\n${moves} 1-0`
});

test('the first move is read from the movetext, not from the headers', () => {
  const api = harness();
  assert.equal(api.firstMoveOf(PGN, 'w'), 'e4');
  assert.equal(api.firstMoveOf(PGN, 'b'), 'c5');
  // A game that starts from a FEN has no white move to read: black moves first.
  assert.equal(api.firstMoveOf('1... c5 2. Nf3 d6', 'b'), 'c5');
  assert.equal(api.firstMoveOf('1... c5 2. Nf3 d6', 'w'), 'Nf3');
  assert.equal(api.firstMoveOf('', 'w'), null);
  assert.equal(api.firstMoveOf(undefined, 'b'), null);
});

test('the repertoire is shares of the games, not a vote for one move', () => {
  const api = harness();
  const games = [
    game('hikaru', 'a', '1. e4 e5'),
    game('hikaru', 'b', '1. e4 c5'),
    game('hikaru', 'c', '1. e4 e6'),
    game('hikaru', 'd', '1. d4 Nf6'),
    game('e', 'hikaru', '1. e4 e5'),
    game('f', 'hikaru', '1. e4 e5'),
    game('g', 'hikaru', '1. d4 d5'),
    game('h', 'hikaru', '1. d4 d5'),
    game('hikaru', 'i', '1. e4 e5', 'chess960'),
    game('someone', 'else', '1. c4 e5')
  ];
  const out = api.repertoireFromGames(games, 'hikaru');
  assert.equal(out.games, 8, 'eight chess games with this player in them');
  assert.ok(Math.abs(out.white.e4 - 0.75) < 0.001, JSON.stringify(out.white));
  assert.ok(Math.abs(out.white.d4 - 0.25) < 0.001, JSON.stringify(out.white));
  // The marginal table, kept for the report.
  assert.deepEqual(JSON.parse(JSON.stringify(out.black)), { e5: 0.5, d5: 0.5 });
  // Nothing to copy from an empty archive or a player who is not in it.
  assert.deepEqual(JSON.parse(JSON.stringify(api.repertoireFromGames([], 'hikaru'))), { white: {}, black: {}, blackByFirst: {}, tree: {}, games: 0 });
});

test('a reply is counted against the move it answers, not averaged', () => {
  const api = harness();
  const games = [
    game('a', 'hikaru', '1. e4 e5'),
    game('b', 'hikaru', '1. e4 e5'),
    game('c', 'hikaru', '1. d4 d5'),
    game('d', 'hikaru', '1. d4 d5'),
    game('e', 'hikaru', '1. c4 c5')
  ];
  const out = api.repertoireFromGames(games, 'hikaru');
  // Averaged, black 'prefers' e5 and d5 equally and would answer 1.d4 with e5.
  assert.deepEqual(JSON.parse(JSON.stringify(out.black)), { e5: 0.4, d5: 0.4, c5: 0.2 });
  assert.deepEqual(JSON.parse(JSON.stringify(out.blackByFirst)), {
    e2e4: { e5: 1 },
    d2d4: { d5: 1 }
    // One game against 1.c4 is not a habit: the table is not built from it.
  });
  assert.deepEqual(JSON.parse(JSON.stringify(api.firstMoveUci('e4'))), 'e2e4');
  assert.equal(api.firstMoveUci('d4'), 'd2d4');
  assert.equal(api.firstMoveUci('Nf3'), 'g1f3');
  assert.equal(api.firstMoveUci('b3'), 'b2b3');
  assert.equal(api.firstMoveUci('Ke2'), null);
  assert.equal(api.firstMoveUci(null), null);
});

test('the repertoire is read even when there is no clock to key it on', async () => {
  const calls = [];
  const store = new Map();
  const games = [
    game('hikaru', 'a', '1. e4 e5'),
    game('hikaru', 'b', '1. e4 c5'),
    game('hikaru', 'c', '1. e4 e6'),
    game('hikaru', 'd', '1. e4 d5'),
    game('hikaru', 'e', '1. d4 Nf6')
  ];
  const fetcher = async (url) => {
    calls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ games }) };
  };
  const api = harness(store, fetcher);
  const out = await api.syncRepertoire();
  assert.equal(calls.length, 1, 'one request, and only the current month');
  assert.ok(Math.abs(out.white.e4 - 0.8) < 0.001, JSON.stringify(out.white));
  assert.ok(store.get('chess-wraith-repertoire-v1:hikaru'), 'cached for the next page');
  // A reload inside the six hours must not hit the archive again.
  const again = harness(store, fetcher);
  const cached = await again.syncRepertoire();
  assert.equal(calls.length, 1, 'the cache served the second boot');
  assert.ok(Math.abs(cached.white.e4 - 0.8) < 0.001, 'same repertoire from the cache');
});

test('an archive with no games backs off instead of asking every scan', async () => {
  const calls = [];
  const store = new Map();
  const fetcher = async (url) => {
    calls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ games: [] }) };
  };
  const api = harness(store, fetcher);
  assert.equal(await api.syncRepertoire(), null);
  // Current and previous month, then the backoff is written and respected.
  assert.equal(calls.length, 2);
  assert.equal(await harness(store, fetcher).syncRepertoire(), null);
  assert.equal(calls.length, 2, 'no request inside the retry window');
});

test('the repertoire is a tree: every opening ply the account actually played', () => {
  const api = harness();
  const games = [
    // Three white games down 1.e4 e5 2.Nf3, one down 1.e4 c5 2.Nf3.
    game('hikaru', 'a', '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6'),
    game('hikaru', 'b', '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6'),
    game('hikaru', 'c', '1. e4 e5 2. Nf3 d6 3. d4'),
    game('hikaru', 'd', '1. e4 c5 2. Nf3 d6 3. d4'),
    // Two black games: after 1.e4 it answers e5, then after 2.Nf3 it plays Nc6.
    game('x', 'hikaru', '1. e4 e5 2. Nf3 Nc6'),
    game('y', 'hikaru', '1. e4 e5 2. Nf3 Nc6')
  ];
  const out = api.repertoireFromGames(games, 'hikaru');
  assert.equal(out.tree[''].e4, 1, 'the account opens 1.e4 in all four white games');
  assert.equal(out.tree['e4'].e5, 1, 'and answers 1.e4 with e5 every time');
  assert.equal(out.tree['e4 e5'].Nf3, 1);
  assert.equal(out.tree['e4 e5 Nf3'].Nc6, 1, 'black games continue the node too');
  assert.equal(out.tree['e4 e5 Nf3 Nc6'].Bb5, 1, 'two games make a node');
  // One game on a prefix is not a habit.
  assert.equal(out.tree['e4 c5'], undefined, '1.e4 c5 was played once');
  assert.equal(out.tree['e4 e5 Nf3 d6'], undefined, 'and so was 2...d6');
  // The suffix a PGN or an engine adds to a check is not part of the move name.
  assert.deepEqual(JSON.parse(JSON.stringify(api.openingMoves('1. e4+ e5 2. Nf3#'))), ['e4', 'e5', 'Nf3']);
  // A game that starts from a FEN has no opening to key on.
  const fromFen = { rules: 'chess', pgn: '[SetUp "1"] [White "hikaru"] [Black "y"]\n\n1... c5 2. Nf3' };
  const fenOut = api.repertoireFromGames([fromFen], 'hikaru');
  // The first move is still readable (white's first move is the second token),
  // but there is no opening tree to key on.
  assert.deepEqual(JSON.parse(JSON.stringify(fenOut.white)), { Nf3: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(fenOut.tree)), {});
});

test('two models of one archive read it once', async () => {
  const calls = [];
  const store = new Map();
  const games = [
    game('hikaru', 'a', '1. e4 e5'),
    game('hikaru', 'b', '1. e4 c5'),
    game('hikaru', 'c', '1. e4 e6'),
    game('hikaru', 'd', '1. d4 d5'),
    game('hikaru', 'e', '1. e4 Nf6')
  ];
  const fetcher = async (url) => {
    calls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ games }) };
  };
  const api = harness(store, fetcher);
  api.state.clockPeak = 300;
  await api.syncPaceProfile(true);
  const afterPace = calls.length;
  await api.syncRepertoire();
  assert.ok(afterPace >= 1, 'the pace profile read the archive');
  assert.equal(calls.length, afterPace, 'the repertoire reused the same reads, month for month');
  // A reader that fails is not cached: the next attempt must be a real request.
  const failing = [];
  const broken = async (url) => {
    failing.push(String(url));
    return { ok: false, status: 429, json: async () => ({}) };
  };
  const retry = harness(new Map(), broken);
  await retry.syncRepertoire().catch(() => null);
  const first = failing.length;
  await retry.syncRepertoire(true).catch(() => null);
  assert.ok(first >= 1 && failing.length > first, 'a failed read is retried');
});

test('a cached archive is not kept forever', async () => {
  const calls = [];
  const store = new Map();
  const games = [game('hikaru', 'a', '1. e4 e5'), game('hikaru', 'b', '1. d4 d5')];
  const fetcher = async (url) => {
    calls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ games }) };
  };
  const api = harness(store, fetcher);
  await api.syncRepertoire();
  const first = calls.length;
  assert.ok(first >= 1);
  await api.syncRepertoire();
  assert.equal(calls.length, first, 'inside the window the read is shared');
  const realNow = Date.now;
  Date.now = () => realNow() + 16 * 60 * 1000;
  try {
    await api.syncRepertoire(true);
  } finally {
    Date.now = realNow;
  }
  assert.ok(calls.length > first, 'after the window the archive is read again');
});