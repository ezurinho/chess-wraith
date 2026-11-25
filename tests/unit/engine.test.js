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
    setTimeout, clearTimeout, setInterval, clearInterval, console, Math, Number, Date, JSON, Promise, Array, Object, String, Map, Set, RegExp, Error
  });
  const source = FRAGMENTS.map(read).join('\n') + '\n;globalThis.__t = { WraithEngine, positionMoves, CONFIG, ENGINE_MIRROR };';
  vm.runInContext(source, context, { filename: 'engine-harness.js' });
  const api = vm.runInContext('globalThis.__t', context);
  return { api, dom, workers, storage };
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
  assert.ok(worker.sent.includes('position startpos'), 'an empty history is startpos, not an empty moves list');
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
