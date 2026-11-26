'use strict';

// The worker lifecycle was the one thing nothing tested: the panel can say
// "engine ready" and still be lying if the UCI handshake never finished. This
// file boots the real engine class against a fake Worker and drives the
// protocol by hand, so handshake, options, queued searches and resolution are
// covered without a browser.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, 'src', rel), 'utf8');
const FRAGMENTS = ['10-config.js', '20-utils.js', '30-chess.js', '35-chess-glue.js', '40-board.js', '50-engine.js'];

function harness({ nnueSkip = true, fetchImpl = null } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://www.chess.com/play/online' });
  const workers = [];
  class FakeWorker {
    constructor(url) {
      this.url = url;
      this.sent = [];
      this.terminated = false;
      workers.push(this);
    }
    postMessage(cmd) { this.sent.push(cmd); }
    terminate() { this.terminated = true; }
    reply(line) { this.onmessage && this.onmessage({ data: line }); }
  }
  const storage = new Map();
  if (nnueSkip) storage.set('chess-wraith-nnue-skip-v1', JSON.stringify({ mirror: 'v0.0.0-test', at: Date.now() }));
  // Fake timers: the watchdog only matters after ten real seconds, which no test
  // should wait for. advance() runs what is due in order, like the event loop.
  const timers = new Map();
  let timerId = 1;
  let fakeNow = 0;
  const fakeSetTimeout = (fn, ms, ...args) => {
    const id = timerId++;
    timers.set(id, { at: fakeNow + (Number(ms) || 0), fn, args });
    return id;
  };
  const fakeClearTimeout = (id) => timers.delete(id);
  const advance = (ms) => {
    const target = fakeNow + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      fakeNow = due[1].at;
      due[1].fn(...due[1].args);
    }
    fakeNow = target;
  };
  const context = vm.createContext({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    location: dom.window.location,
    Blob: dom.window.Blob,
    Worker: FakeWorker,
    URL: { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} },
    fetch: fetchImpl || (async () => ({ ok: true, status: 200, text: async () => '/* engine */' })),
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k)
    },
    setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout, setInterval, clearInterval, console, Math, Number, Date, JSON, Promise, Array, Object, String, Map, Set, RegExp, Error
  });
  const source = FRAGMENTS.map(read).join('\n') + '\n;globalThis.__t = { WraithEngine, positionMoves, CONFIG, ENGINE_MIRROR, engineLabel };';
  vm.runInContext(source, context, { filename: 'engine-harness.js' });
  const api = vm.runInContext('globalThis.__t', context);
  return { api, dom, workers, storage, advance };
}

test('the UCI handshake ends with a ready engine and a mode', async () => {
  const { api, workers } = harness();
  const engine = new api.WraithEngine();
  let readyMode = null;
  engine.onReady = (mode) => { readyMode = mode; };
  const booting = engine.boot();
  await new Promise((r) => setImmediate(r));
  const worker = workers[workers.length - 1];
  assert.ok(worker, 'a worker was spawned');
  assert.ok(worker.sent.includes('uci'), 'the handshake is asked for');
  worker.reply('uciok');
  assert.ok(worker.sent.some((c) => c.startsWith('setoption name Hash value ')), 'hash is set before isready');
  assert.ok(worker.sent.includes('isready'));
  worker.reply('readyok');
  await booting;
  assert.equal(engine.ready, true);
  assert.equal(readyMode, engine.mode);
  engine.destroy();
});

test('a search sends position and go, then resolves the formatted best move', async () => {
  const { api, workers } = harness();
  const engine = new api.WraithEngine();
  const finals = [];
  engine.onFinal = (p) => finals.push(p);
  const booting = engine.boot();
  await new Promise((r) => setImmediate(r));
  const worker = workers[workers.length - 1];
  worker.reply('uciok');
  worker.reply('readyok');
  await booting;

  const done = engine.analyze({
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    turn: 'w',
    flipped: false,
    uciMoves: ['e2e4', 'e7e5'],
    depth: 12,
    moveTimeMs: 400,
    multiPv: 1,
    elo: 0,
    skill: 20
  });
  await new Promise((r) => setImmediate(r));
  assert.ok(worker.sent.includes('position startpos moves e2e4 e7e5'), 'the move history is replayed');
  assert.ok(worker.sent.some((c) => c.startsWith('go depth 12 movetime 400')));
  worker.reply('info depth 12 seldepth 16 multipv 1 score cp 34 nodes 120000 pv g1f3 b8c6 f1b5');
  worker.reply('bestmove g1f3');
  const lines = await done;
  assert.equal(lines.length, 1);
  assert.equal(lines[0].bestUci, 'g1f3');
  assert.equal(lines[0].bestSan, 'Nf3');
  assert.equal(finals.length, 1);
  assert.equal(finals[0].bestmove, 'g1f3');
  assert.equal(finals[0].final, true);
  engine.destroy();
});

test('a destroyed engine does not claim to be ready', async () => {
  const { api, workers } = harness();
  const engine = new api.WraithEngine();
  const booting = engine.boot();
  await new Promise((r) => setImmediate(r));
  workers[workers.length - 1].reply('uciok');
  workers[workers.length - 1].reply('readyok');
  await booting;
  assert.equal(engine.ready, true);
  engine.destroy();
  assert.equal(engine.ready, false, 'nothing is ready after destroy');
  assert.equal(engine.worker, null);
  assert.equal(Object.keys(engine.lastOptions).length, 0, 'a fresh worker has default options');
});

test('a worker that dies after booting is replaced instead of timing out', async () => {
  // Plain engine on purpose: the NNUE spawn already falls back to the JS build
  // when its worker fails, so the case that had no answer is a dead JS worker.
  const { api, workers, storage } = harness({ nnueSkip: false });
  storage.set('chess-wraith-nnue-skip-v1', JSON.stringify({ mirror: api.ENGINE_MIRROR, at: Date.now() }));
  const engine = new api.WraithEngine();
  const errors = [];
  engine.onError = (m) => errors.push(m);
  const booting = engine.boot();
  await new Promise((r) => setImmediate(r));
  const first = workers[workers.length - 1];
  first.reply('uciok');
  first.reply('readyok');
  await booting;
  assert.equal(engine.ready, true);
  assert.equal(engine.nnue, false, 'the plain build is the one under test');

  first.onerror({ message: 'boom' });
  assert.equal(engine.ready, false, 'a dead worker is not ready any more');
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
  const second = workers[workers.length - 1];
  assert.notEqual(second, first, 'a fresh worker was spawned');
  assert.ok(second.sent.includes('uci'), 'and it is asked to handshake');
  assert.match(errors.join(' '), /boom/);
  engine.destroy();
});

test('an empty move list analyses the FEN, not the starting position', async () => {
  const { api, workers } = harness();
  const engine = new api.WraithEngine();
  const booting = engine.boot();
  await new Promise((r) => setImmediate(r));
  const worker = workers[workers.length - 1];
  worker.reply('uciok');
  worker.reply('readyok');
  await booting;

  const fen = '8/5pk1/6p1/8/3K4/5P2/6P1/8 w - - 0 40';
  const done = engine.analyze({
    fen,
    turn: 'w',
    flipped: false,
    uciMoves: [],
    depth: 12,
    moveTimeMs: 300,
    multiPv: 1,
    elo: 0,
    skill: 20
  });
  await new Promise((r) => setImmediate(r));
  assert.ok(worker.sent.includes('position fen ' + fen), 'the position comes from the FEN');
  assert.ok(!worker.sent.includes('position startpos'), 'the start position is not sent');
  worker.reply('info depth 12 seldepth 16 multipv 1 score cp 12 nodes 900 pv d4d5');
  worker.reply('bestmove d4d5');
  const lines = await done;
  assert.equal(lines[0].bestUci, 'd4d5');
  engine.destroy();
});

test('a request with neither a fen nor moves resolves without searching', async () => {
  const { api, workers } = harness();
  const engine = new api.WraithEngine();
  const booting = engine.boot();
  await new Promise((r) => setImmediate(r));
  const worker = workers[workers.length - 1];
  worker.reply('uciok');
  worker.reply('readyok');
  await booting;

  const lines = await engine.analyze({ turn: 'w', uciMoves: [] });
  assert.equal(lines.length, 0);
  assert.ok(!worker.sent.some((c) => c.startsWith('position')), 'nothing was sent');
  engine.destroy();
});

test('the NNUE build gets the strength options the 2019 build cannot take', async () => {
  const { api, workers } = harness({ nnueSkip: false });
  const engine = new api.WraithEngine();
  const booting = engine.boot();
  await new Promise((r) => setImmediate(r));
  const worker = workers[workers.length - 1];
  assert.equal(engine.mode, 'Stockfish 19 NNUE');
  worker.reply('uciok');
  assert.ok(worker.sent.includes('setoption name UCI_ShowWDL value true'));
  worker.reply('readyok');
  await booting;

  const done = engine.analyze({
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    turn: 'w',
    uciMoves: [],
    depth: 12,
    moveTimeMs: 400,
    multiPv: 1,
    elo: 1800,
    skill: 20
  });
  await new Promise((r) => setImmediate(r));
  assert.ok(worker.sent.includes('setoption name UCI_LimitStrength value true'));
  assert.ok(worker.sent.includes('setoption name UCI_Elo value 1800'));
  // The FEN is authoritative: an empty move list is not a position.
  assert.ok(worker.sent.includes('position fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'), 'the position comes from the FEN');
  worker.reply('bestmove e2e4');
  await done;
  engine.destroy();
});

test('a second search queues behind the first and starts on its bestmove', async () => {
  const { api, workers } = harness();
  const engine = new api.WraithEngine();
  const booting = engine.boot();
  await new Promise((r) => setImmediate(r));
  const worker = workers[workers.length - 1];
  worker.reply('uciok');
  worker.reply('readyok');
  await booting;

  const first = engine.analyze({ fen: '8/8/8/8/8/8/8/K6k w - - 0 1', turn: 'w', uciMoves: [], depth: 8, moveTimeMs: 300, multiPv: 1 });
  await new Promise((r) => setImmediate(r));
  const second = engine.analyze({ fen: '8/8/8/8/8/8/8/K6k b - - 0 1', turn: 'b', uciMoves: [], depth: 8, moveTimeMs: 300, multiPv: 1 });
  await new Promise((r) => setImmediate(r));
  assert.ok(worker.sent.includes('stop'), 'the running search is stopped, not abandoned');
  worker.reply('bestmove a1a2');
  await first;
  await new Promise((r) => setImmediate(r));
  worker.reply('bestmove h1g2');
  await second;
  engine.destroy();
});
test('a search that never answers is stopped, the worker is dropped and the promise settles', async () => {
  const { api, workers, advance } = harness();
  const engine = new api.WraithEngine();
  const finals = [];
  engine.onFinal = (p) => finals.push(p);
  const booting = engine.boot();
  await new Promise((r) => setImmediate(r));
  const worker = workers[workers.length - 1];
  worker.reply('uciok');
  worker.reply('readyok');
  await booting;

  const pending = engine.analyze({
    fen: '8/8/8/8/8/8/8/K6k w - - 0 1',
    turn: 'w',
    uciMoves: [],
    depth: 20,
    moveTimeMs: 400,
    multiPv: 1
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(engine.searching, true);

  // Nothing replies. The watchdog asks for a stop, then gives it 2.5 s.
  advance(8500);
  assert.ok(worker.sent.filter((c) => c === 'stop').length >= 1, 'the watchdog sends stop');
  advance(2600);
  await new Promise((r) => setImmediate(r));

  const lines = await pending;
  assert.equal(lines.length, 0, 'the search resolves empty instead of hanging');
  assert.equal(worker.terminated, true, 'the worker is terminated');
  assert.equal(engine.ready, false, 'the engine must re-handshake before the next move');
  assert.equal(finals.length, 1);
  assert.equal(finals[0].bestmove, null);
  assert.equal(finals[0].final, true);
  engine.destroy();
});
// The panel could say "offline" for eight hours and nothing ever asked again.
// Boot failures are now retried on a backoff, and a network failure is not
// allowed to poison the NNUE skip cache: one bad minute of Wi-Fi used to
// downgrade the next week of loads.
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('an offline boot is retried on a backoff instead of staying dead', async () => {
  let calls = 0;
  const { api, workers, advance } = harness({
    nnueSkip: false,
    fetchImpl: async () => {
      calls += 1;
      if (calls <= 2) throw new TypeError('Failed to fetch');
      return { ok: true, status: 200, text: async () => '/* engine */' };
    }
  });
  const engine = new api.WraithEngine();
  const errors = [];
  engine.onError = (message) => errors.push(message);
  await assert.rejects(() => engine.boot());
  assert.equal(engine.mode, 'offline');
  assert.equal(engine.retryAttempt, 1, 'the first failure schedules a retry');
  assert.equal(engine.retryDelay, 5000, 'after five seconds');
  assert.ok(errors.some((line) => /retrying in 5s/.test(line)), 'and says so');
  assert.equal(workers.length, 0, 'nothing was spawned while offline');

  advance(5000);
  await flush();
  await flush();
  assert.equal(workers.length, 1, 'the retry spawned a worker');
  const worker = workers[0];
  worker.reply('uciok');
  worker.reply('readyok');
  assert.equal(engine.ready, true);
  assert.equal(engine.retryAttempt, 0, 'a ready engine resets the backoff');
  engine.destroy();
});

test('a network failure does not remember the NNUE skip for a week', async () => {
  let calls = 0;
  const { api, workers, storage } = harness({
    nnueSkip: false,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('Failed to fetch');
      return { ok: true, status: 200, text: async () => '/* engine */' };
    }
  });
  const engine = new api.WraithEngine();
  const booting = engine.boot();
  await flush();
  const worker = workers[workers.length - 1];
  worker.reply('uciok');
  worker.reply('readyok');
  await booting;
  assert.equal(engine.nnue, false, 'this load fell back to the JS engine');
  assert.equal(
    storage.has('chess-wraith-nnue-skip-v1'),
    false,
    'but the next load still tries NNUE: the failure was the network, not the build'
  );
  engine.destroy();
});

test('a 404 on the NNUE script still remembers the skip', async () => {
  let calls = 0;
  const { api, workers, storage } = harness({
    nnueSkip: false,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new Error('HTTP 404 for nnue.js');
      return { ok: true, status: 200, text: async () => '/* engine */' };
    }
  });
  const engine = new api.WraithEngine();
  const booting = engine.boot();
  await flush();
  const worker = workers[workers.length - 1];
  worker.reply('uciok');
  worker.reply('readyok');
  await booting;
  assert.equal(storage.has('chess-wraith-nnue-skip-v1'), true, 'a real 404 is a verdict');
  engine.destroy();
});
test('a worker that never says uciok enters the backoff instead of dying there', async () => {
  const { api, workers, advance, storage } = harness({ nnueSkip: false });
  // Pin the plain engine: the handshake deadline is the 4 s one, not NNUE's 6.5 s.
  storage.set('chess-wraith-nnue-skip-v1', JSON.stringify({ mirror: api.ENGINE_MIRROR, at: Date.now() }));
  const engine = new api.WraithEngine();
  const errors = [];
  engine.onError = (message) => errors.push(message);
  await engine.boot();
  const dead = workers[0];
  assert.ok(dead && dead.sent.includes('uci'), 'the handshake was asked for');
  assert.equal(engine.retryAttempt, 0);

  advance(4000);
  assert.equal(engine.retryAttempt, 1, 'silence is a failure, not a state');
  assert.equal(engine.retryDelay, 5000);
  assert.equal(dead.terminated, true, 'the mute worker is terminated');
  assert.ok(errors.some((line) => /did not answer uci/.test(line)), 'and the reason is named');

  advance(5000);
  await flush();
  await flush();
  const fresh = workers[workers.length - 1];
  assert.notEqual(fresh, dead, 'a new worker was spawned');
  fresh.reply('uciok');
  fresh.reply('readyok');
  assert.equal(engine.ready, true);
  assert.equal(engine.retryAttempt, 0, 'recovery resets the ladder');
  engine.destroy();
});

test('a crash cluster that exhausts its retries hands the engine to the backoff', async () => {
  const { api, workers, advance, storage } = harness({ nnueSkip: false });
  storage.set('chess-wraith-nnue-skip-v1', JSON.stringify({ mirror: api.ENGINE_MIRROR, at: Date.now() }));
  const engine = new api.WraithEngine();
  await engine.boot();
  const worker = workers[0];
  worker.reply('uciok');
  worker.reply('readyok');
  assert.equal(engine.ready, true);

  engine.recoveries = 2;
  engine.worker.onerror({ message: 'boom' });
  assert.equal(engine.retryAttempt, 1, 'the third crash is not another rebuild');
  assert.equal(engine.ready, false);
  advance(5000);
  await flush();
  await flush();
  assert.ok(workers.length > 1, 'and it boots again after the backoff');
  engine.destroy();
});
test('the label comes from the engine, not from a constant', async () => {
  const { api, workers } = harness({ nnueSkip: false });
  const engine = new api.WraithEngine();
  const booting = engine.boot();
  await new Promise((r) => setImmediate(r));
  const worker = workers[workers.length - 1];
  worker.reply('id name Stockfish 21 Lite WASM');
  assert.equal(engine.mode, 'Stockfish 21 NNUE');
  assert.equal(engine.idName, 'Stockfish 21 Lite WASM');
  worker.reply('uciok');
  worker.reply('readyok');
  await booting;
  assert.equal(engine.mode, 'Stockfish 21 NNUE');
  engine.destroy();

  assert.equal(api.engineLabel('Stockfish 19 Lite WASM', true), 'Stockfish 19 NNUE');
  assert.equal(api.engineLabel('', true), 'Stockfish 19 NNUE', 'no id line, the shipped build');
  assert.equal(api.engineLabel('Stockfish 11 64', false), 'Stockfish 2019 JS', 'the fallback keeps its name');
});

test('a restricted search asks the engine about one move only', async () => {
  const { api, workers } = harness();
  const engine = new api.WraithEngine();
  const booting = engine.boot();
  await new Promise((r) => setImmediate(r));
  const worker = workers[workers.length - 1];
  worker.reply('uciok');
  worker.reply('readyok');
  await booting;

  const done = engine.analyze({
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    turn: 'w',
    flipped: false,
    uciMoves: ['e2e4', 'e7e5'],
    depth: 12,
    moveTimeMs: 400,
    multiPv: 4,
    searchmoves: 'g1f3',
    elo: 0,
    skill: 20
  });
  await new Promise((r) => setImmediate(r));
  assert.ok(worker.sent.includes('setoption name MultiPV value 1'), 'a restricted search has one line');
  assert.ok(worker.sent.includes('go depth 12 movetime 400 searchmoves g1f3'), JSON.stringify(worker.sent.slice(-4)));
  worker.reply('info depth 12 seldepth 16 multipv 1 score cp 12 nodes 400 pv g1f3 b8c6');
  worker.reply('bestmove g1f3');
  const lines = await done;
  assert.equal(lines.length, 1);
  assert.equal(lines[0].bestUci, 'g1f3');

  // A list of candidates is one line each: that is how an improvised move gets
  // a measured price before it is played.
  const many = engine.analyze({
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    turn: 'w',
    flipped: false,
    uciMoves: ['e2e4', 'e7e5'],
    depth: 12,
    moveTimeMs: 400,
    multiPv: 3,
    searchmoves: 'g1f3 b1c3 d2d4',
    elo: 0,
    skill: 20
  });
  await new Promise((r) => setImmediate(r));
  assert.ok(worker.sent.includes('setoption name MultiPV value 3'), JSON.stringify(worker.sent.slice(-3)));
  assert.ok(worker.sent.includes('go depth 12 movetime 400 searchmoves g1f3 b1c3 d2d4'));
  worker.reply('info depth 12 seldepth 16 multipv 1 score cp 12 nodes 400 pv g1f3 b8c6');
  worker.reply('info depth 12 seldepth 16 multipv 2 score cp 4 nodes 400 pv b1c3 b8c6');
  worker.reply('info depth 12 seldepth 16 multipv 3 score cp -38 nodes 400 pv d2d4 d7d5');
  worker.reply('bestmove g1f3');
  const three = await many;
  assert.equal(three.length, 3);
  assert.equal(three[2].bestUci, 'd2d4');
  assert.equal(three[2].scoreCp, -38);

  // A malformed or missing searchmoves must not reach the engine as a command.
  const plain = engine.analyze({
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    turn: 'w',
    flipped: false,
    uciMoves: ['e2e4'],
    depth: 10,
    moveTimeMs: 300,
    multiPv: 4,
    searchmoves: 'not-a-move',
    elo: 0,
    skill: 20
  });
  await new Promise((r) => setImmediate(r));
  assert.ok(worker.sent.some((c) => c === 'go depth 10 movetime 300'), 'the junk flag is dropped');
  worker.reply('info depth 10 seldepth 14 multipv 1 score cp 20 nodes 100 pv e2e4');
  worker.reply('bestmove e2e4');
  await plain;
  engine.destroy();
});

test('a normal search keeps the full MultiPV setting, not the old five', async () => {
  const { api, workers } = harness();
  const engine = new api.WraithEngine();
  const booting = engine.boot();
  await new Promise((r) => setImmediate(r));
  const worker = workers[workers.length - 1];
  worker.reply('uciok');
  worker.reply('readyok');
  await booting;

  const done = engine.analyze({
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    turn: 'w',
    flipped: false,
    uciMoves: ['e2e4'],
    depth: 12,
    moveTimeMs: 400,
    multiPv: 8,
    elo: 0,
    skill: 20
  });
  await new Promise((r) => setImmediate(r));
  assert.ok(
    worker.sent.includes('setoption name MultiPV value 8'),
    JSON.stringify(worker.sent.slice(-4))
  );
  for (let i = 1; i <= 8; i += 1) {
    worker.reply(`info depth 12 seldepth 16 multipv ${i} score cp ${20 - i} nodes 400 pv e2e4 e7e5`);
  }
  worker.reply('bestmove e2e4');
  const lines = await done;
  assert.equal(lines.length, 8, '1.86.0 promised eight lines and the engine only returned five');
  engine.destroy();
});
