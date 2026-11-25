// The labels under test live in a userscript fragment, so they are loaded the
// same way the build loads them: ordered concat inside one vm context.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const FRAGMENTS = ['10-config.js', '20-utils.js', '55-pace.js'];

function harness() {
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
    fetch: () => { throw new Error('unexpected fetch'); },
    localStorage: { getItem: () => null, setItem: () => {} },
    currentAccount: () => 'hikaru',
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