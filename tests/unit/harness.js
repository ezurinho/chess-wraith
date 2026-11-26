'use strict';

// One jsdom bench, two callers: `session.test.js` runs the src/ fragments and
// `bundle.test.js` runs the file that ships. The artifact is what users load, and
// a fragment dropped by tools/build.js would keep every other test green.

const vm = require('node:vm');
const { JSDOM } = require('jsdom');

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

function bootSource(source, options = {}) {
  const html = options.html || PAGE;
  const seed = options.seed || null;
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
    if (this.matches && this.matches('.game-over-modal, .game-over-modal-shell-container, .board-modal-component, .game-over-modal-header-component, .board-modal, .modal-content, .game-review-buttons')) {
      return { left: 200, top: 200, width: 420, height: 260, right: 620, bottom: 460, x: 200, y: 200 };
    }
    return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 };
  };
  // Two callers: the engine downloads its source as text (a fake worker never
  // runs it), and the account lookup asks the public API for stats.
  window.fetch = async (url) => {
    if (options.signedOut && String(url).includes('/pub/player/')) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    return ({
    ok: true,
    status: 200,
    text: async () => '/* stubbed engine source */',
    arrayBuffer: async () => new ArrayBuffer(8),
    json: async () => ({
      chess_rapid: { last: { rating: 1480 }, record: { win: 40, loss: 38, draw: 2 } }
    })
  });
  }
  if (options.signedOut) {
    const user = window.document.getElementById('user-username-component');
    if (user) user.textContent = '';
  }
  // jsdom has no object URLs; the engine only needs one to hand the fake worker
  // a URL it never fetches.
  window.URL.createObjectURL = () => 'blob:chess-wraith';
  window.URL.revokeObjectURL = () => {};

  if (seed) seed(window.localStorage);

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
  // The fragments run in the context scope, so they can be exported by name. The
  // built bundle closes over its own IIFE and only leaves `ChessWraith` behind.
  const tail = options.export === false
    ? ''
    : '\n;globalThis.__cw = { state, cfg, engine, panel, scanBoard, isGameOverDom, adoptAccountSettings, report: reportText, openingShares, openingProbeTarget, selftest: ChessWraith.selftest };';
  vm.runInContext(`${source}\n${tail}`, context, {
    filename: options.filename || 'chess-wraith-boot.js'
  });
  const api = vm.runInContext('globalThis.__cw || globalThis.ChessWraith', context);
  const stop = () => {
    for (const id of timers) { clearTimeout(id); clearInterval(id); }
    timers.clear();
    try { window.close(); } catch (error) { /* already closed */ }
  };
  return { window, api, stop };
}

module.exports = { bootSource, PAGE, START, FakeWorker };
