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

function harness({ nnueSkip = true } = {}) {
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
    fetch: async () => ({ ok: true, status: 200, text: async () => '/* engine */' }),
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k)
    },
    setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout, setInterval, clearInterval, console, Math, Number, Date, JSON, Promise, Array, Object, String, Map, Set, RegExp, Error
  });
  const source = FRAGMENTS.map(read).join('\n') + '\n;globalThis.__t = { WraithEngine, positionMoves, CONFIG, ENGINE_MIRROR };';
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