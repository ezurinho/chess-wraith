// Every other test loads a slice of the script. This one loads the whole thing
// into a DOM and lets boot run: board reader, engine protocol, panel mount and
// the scan loop in one page, because a crash there is what actually ends a
// session and no unit test had ever started the script.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, 'src', rel), 'utf8');
const FRAGMENTS = [
  '10-config.js', '20-utils.js', '30-chess.js', '35-chess-glue.js', '40-board.js',
  '50-engine.js', '55-pace.js', '60-analysis.js', '65-afk.js', '70-input.js',
  '80-panel.js', '90-boot.js'
];

const START = [
  ['br', '18'], ['bn', '28'], ['bb', '38'], ['bq', '48'], ['bk', '58'], ['bb', '68'], ['bn', '78'], ['br', '88'],
  ['bp', '17'], ['bp', '27'], ['bp', '37'], ['bp', '47'], ['bp', '57'], ['bp', '67'], ['bp', '77'], ['bp', '87'],
  ['wp', '12'], ['wp', '22'], ['wp', '32'], ['wp', '42'], ['wp', '52'], ['wp', '62'], ['wp', '72'], ['wp', '82'],
  ['wr', '11'], ['wn', '21'], ['wb', '31'], ['wq', '41'], ['wk', '51'], ['wb', '61'], ['wn', '71'], ['wr', '81']
];

const PAGE = [
  '<div class="board-layout-bottom"><div class="clock-component clock-top">10:00</div>',
  '<div class="clock-component clock-bottom">10:00</div></div>',
  '<wc-chess-board class="board">',
  START.map(([code, square]) => `<div class="piece ${code} square-${square}"></div>`).join(''),
  '</wc-chess-board>',
  '<div id="user-username-component">tester</div>'
].join('');

// The engine is a protocol stand-in: it answers the handshake and one legal
// move, so boot settles instead of waiting on a wasm download a test cannot do.
class FakeWorker {
  constructor() {
    this.onmessage = null;
    this.onerror = null;
    this.sent = [];
  }
  emit(data) { if (this.onmessage) this.onmessage({ data }); }
  postMessage(cmd) {
    const line = String(cmd);
    this.sent.push(line);
    if (line === 'uci') {
      this.emit('id name Stockfish 19');
      this.emit('option name UCI_Elo type spin default 1320 min 1320 max 3190');
      this.emit('uciok');
    } else if (line === 'isready') {
      this.emit('readyok');
    } else if (line.startsWith('go')) {
      this.emit('info depth 11 seldepth 16 multipv 1 score cp 24 nodes 1200 pv e2e4 e7e5');
      this.emit('bestmove e2e4');
    }
  }
  terminate() {}
}

function boot(html = PAGE) {
  // Boot owns intervals and a mutation observer, and a test process will not
  // exit while they are alive: every timer is tracked so the test can stop the
  // page the way a tab close would.
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, {
    url: 'https://www.chess.com/play/online?cw=1',
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.Element.prototype.getBoundingClientRect = function () {
    if (this.matches && this.matches('wc-chess-board, chess-board, .board')) {
      return { left: 0, top: 0, width: 800, height: 800, right: 800, bottom: 800, x: 0, y: 0 };
    }
    if (this.matches && this.matches('button, .cc-button-component, [role="button"]')) {
      return { left: 10, top: 10, width: 180, height: 40, right: 190, bottom: 50, x: 10, y: 10 };
    }
    if (this.matches && this.matches('.game-over-modal, .board-modal, .modal-content, .game-review-buttons')) {
      return { left: 200, top: 200, width: 420, height: 260, right: 620, bottom: 460, x: 200, y: 200 };
    }
    return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 };
  };
  // Two callers: the engine downloads its source as text (a fake worker never
  // runs it), and the account lookup asks the public API for stats.
  window.fetch = async (url) => ({
    ok: true,
    status: 200,
    text: async () => '/* stubbed engine source */',
    arrayBuffer: async () => new ArrayBuffer(8),
    json: async () => ({
      chess_rapid: { last: { rating: 1480 }, record: { win: 40, loss: 38, draw: 2 } }
    })
  });
  // jsdom has no object URLs; the engine only needs one to hand the fake worker
  // a URL it never fetches.
  window.URL.createObjectURL = () => 'blob:chess-wraith';
  window.URL.revokeObjectURL = () => {};

  const timers = new Set();
  const trackedTimeout = (fn, ms, ...rest) => {
    const id = setTimeout(() => { timers.delete(id); fn(...rest); }, ms);
    timers.add(id);
    return id;
  };
  const trackedInterval = (fn, ms, ...rest) => {
    const id = setInterval(fn, ms, ...rest);
    timers.add(id);
    return id;
  };
  const context = vm.createContext({
    window,
    document: window.document,
    navigator: window.navigator,
    localStorage: window.localStorage,
    location: window.location,
    Element: window.Element,
    Node: window.Node,
    Event: window.Event,
    CustomEvent: window.CustomEvent,
    MouseEvent: window.MouseEvent,
    KeyboardEvent: window.KeyboardEvent,
    MutationObserver: window.MutationObserver,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: (fn) => setTimeout(fn, 16),
    cancelAnimationFrame: (id) => clearTimeout(id),
    URL: window.URL,
    Blob: window.Blob,
    Worker: FakeWorker,
    fetch: window.fetch,
    performance: window.performance,
    setTimeout: trackedTimeout,
    clearTimeout: (id) => { timers.delete(id); clearTimeout(id); },
    setInterval: trackedInterval,
    clearInterval: (id) => { timers.delete(id); clearInterval(id); },
    console, Math, Date, JSON, Promise
  });
  const source = FRAGMENTS.map(read).join('\n');
  vm.runInContext(`${source}\n;globalThis.__cw = { state, cfg, engine, panel, scanBoard, isGameOverDom, adoptAccountSettings };`, context, {
    filename: 'chess-wraith-boot.js'
  });
  const api = vm.runInContext('globalThis.__cw', context);
  const stop = () => {
    for (const id of timers) { clearTimeout(id); clearInterval(id); }
    timers.clear();
    try { window.close(); } catch (error) { /* already closed */ }
  };
  return { window, api, stop };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, budgetMs = 9000, stepMs = 100) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await wait(stepMs);
  }
  return false;
}

test('the whole script boots on a real board without throwing', async () => {
  const { window, api, stop } = boot();
  try {
    await wait(1600);
    assert.ok(api.state.snapshot, 'the board was read');
    assert.equal(api.state.snapshot.placement, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR', 'start position');
    assert.equal(api.state.snapshot.turn, 'w', 'white to move');
    assert.ok(api.state.boardEl, 'the board element was found');
    assert.equal(api.engine.mode, 'Stockfish 19 NNUE', 'the engine came up');
    assert.ok(window.document.body.children.length > 0, 'the panel has a host');
  } finally {
    stop();
  }
});

test('a finished game with AFK on presses the button a person would press', async () => {
  const { window, api, stop } = boot(PAGE +
    '<div class="game-over-modal" style="position:fixed"><div class="game-over-modal-content">tester won</div>' +
    '<button class="cc-button-component">Rematch</button></div>');
  try {
    api.cfg.autoRematch = true;
    // The first scan may already have seen the dialog while AFK was off; make
    // the next one a fresh transition, which is what queues the rematch.
    api.state.gameOverSeen = false;
    const pressed = [];
    const button = window.document.querySelector('.game-over-modal .cc-button-component');
    button.addEventListener('click', () => pressed.push(button.textContent));
    assert.equal(api.isGameOverDom(), true, 'the dialog is found');
    assert.equal(api.scanBoard('w').gameOver, true, 'the scan sees a finished game');
    // The human delay is 1.7–4.2 s and the scan runs every 2 s; the budget has
    // to cover the worst case, not the average one.
    const ok = await until(() => pressed.length > 0, 15000);
    assert.ok(ok, `no rematch; afk=${api.cfg.autoRematch} warn=${api.state.warn} seen=${api.state.gameOverSeen} tried=${api.state.rematchTried}` +
      ` scanning=${Boolean(api.state.analysis)} thinking=${api.state.thinking} lastScanAt=${api.state.lastScanAt} modal=${window.document.querySelectorAll('.game-over-modal-content').length}`);
    assert.deepEqual(pressed, ['Rematch'], 'the first choice, not a random button');
    assert.equal(api.state.gameOverSeen, true, 'the game over was seen');
    assert.equal(api.state.rematchAttempts, 1, 'pressed once, not in a loop');
    const last = api.state.events[api.state.events.length - 1];
    assert.match(last.text, /rematch/i, 'the press landed in the history');
    assert.ok(api.state.events.length <= 5, 'and the history stays short');
  } finally {
    stop();
  }
});

test('the history is per account, so a second login does not inherit the night', async () => {
  const { window, api, stop } = boot();
  try {
    window.localStorage.setItem('chess-wraith-history-v1:other', JSON.stringify([
      { at: Date.now(), text: 'session limit: 3h' }
    ]));
    api.adoptAccountSettings('other');
    assert.equal(api.state.events.length, 1, 'the stored line came back');
    assert.equal(api.state.events[0].text, 'session limit: 3h');
    assert.equal(api.state.settingsAccount, 'other');
  } finally {
    stop();
  }
});

test('boot reaches the engine and asks it for a move', async () => {
  const { api, stop } = boot();
  try {
    await wait(1400);
    assert.ok(api.state.analysis, 'an analysis exists');
    assert.ok(Array.isArray(api.state.analysis.lines) && api.state.analysis.lines.length > 0, 'with lines');
    assert.equal(api.state.analysis.lines[0].bestUci.slice(0, 4), 'e2e4', 'the engine answer reached the panel');
  } finally {
    stop();
  }
});
