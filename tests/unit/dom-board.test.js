'use strict';

// The selector layer is the one part unit tests could not touch: it needs a DOM.
// jsdom is enough for it, and a broken selector is the failure that actually
// costs a session, so this file builds chess.com's markup by hand and reads it
// back the way the script does.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, 'src', rel), 'utf8');

const FRAGMENTS = ['10-config.js', '20-utils.js', '30-chess.js', '35-chess-glue.js', '40-board.js'];

function mount(html) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { url: 'https://www.chess.com/play/online' });
  const { window } = dom;
  // jsdom has no layout: the board reports its own box so the readers that fall
  // back to geometry can still be exercised.
  window.Element.prototype.getBoundingClientRect = function () {
    if (this.matches && this.matches('wc-chess-board, chess-board, .board')) {
      return { left: 0, top: 0, width: 800, height: 800, right: 800, bottom: 800, x: 0, y: 0 };
    }
    return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 };
  };
  const context = vm.createContext({
    window,
    document: window.document,
    navigator: window.navigator,
    localStorage: window.localStorage,
    location: window.location,
    Element: window.Element,
    Node: window.Node,
    MutationObserver: window.MutationObserver,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
    Math,
    Date,
    JSON,
    Promise,
    AbortSignal
  });
  const source = FRAGMENTS.map(read).join('\n') + '\n;globalThis.__t = { readGridFromBoard, readSanMoveList, readMoveNodes, scanBoard, Chess };';
  vm.runInContext(source, context, { filename: 'dom-harness.js' });
  return { window, api: vm.runInContext('globalThis.__t', context), dom };
}

// chess.com writes a piece as `piece wp square-52`: the class names the square,
// file first (1 = a) and rank second, so square-52 is e2.
const START = [
  ['br', '18'], ['bn', '28'], ['bb', '38'], ['bq', '48'], ['bk', '58'], ['bb', '68'], ['bn', '78'], ['br', '88'],
  ['bp', '17'], ['bp', '27'], ['bp', '37'], ['bp', '47'], ['bp', '57'], ['bp', '67'], ['bp', '77'], ['bp', '87'],
  ['wp', '12'], ['wp', '22'], ['wp', '32'], ['wp', '42'], ['wp', '52'], ['wp', '62'], ['wp', '72'], ['wp', '82'],
  ['wr', '11'], ['wn', '21'], ['wb', '31'], ['wq', '41'], ['wk', '51'], ['wb', '61'], ['wn', '71'], ['wr', '81']
];

function boardHtml(pieces = START) {
  const cells = pieces.map(([code, square]) => `<div class="piece ${code} square-${square}"></div>`).join('');
  return `<wc-chess-board class="board">${cells}</wc-chess-board>`;
}

test('the board reader turns chess.com markup back into the start position', () => {
  const { api, dom } = mount(boardHtml());
  const boardEl = dom.window.document.querySelector('wc-chess-board');
  const read0 = api.readGridFromBoard(boardEl, false);
  assert.equal(read0.valid, true);
  assert.equal(api.Chess.gridToPlacement(read0.grid), 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
});

test('a piece being dragged invalidates the snapshot instead of guessing', () => {
  const html = boardHtml().replace('square-22', 'square-22 dragging');
  const { api, dom } = mount(html);
  const boardEl = dom.window.document.querySelector('wc-chess-board');
  const read0 = api.readGridFromBoard(boardEl, false);
  assert.equal(read0.isDragging, true);
  assert.equal(read0.valid, false);
});

test('promotion and spare-piece pieces are not part of the board', () => {
  const html = boardHtml([['wk', '11'], ['bk', '88'], ['wp', '54']])
    .replace('<wc-chess-board', '<div class="spare-pieces"><div class="piece wq square-88"></div></div><wc-chess-board');
  const { api, dom } = mount(html);
  const boardEl = dom.window.document.querySelector('wc-chess-board');
  const read0 = api.readGridFromBoard(boardEl, false);
  assert.equal(read0.valid, true);
  assert.equal(api.Chess.gridToPlacement(read0.grid), '7k/8/8/8/4P3/8/8/K7');
});

test('the move list is read from .node rows, figurines included', () => {
  const html = `<wc-simple-move-list>
    <div class="node" data-ply="1"><span class="node-san">e4</span></div>
    <div class="node" data-ply="2"><span class="node-san">e5</span></div>
    <div class="node" data-ply="3"><span class="node-san"><span data-figurine="N">N</span>f3</span></div>
  </wc-simple-move-list>`;
  const { api } = mount(html);
  const entries = api.readMoveNodes();
  assert.equal(entries.length, 3);
  // The values come from another realm: compare the JSON, not the prototypes.
  assert.equal(JSON.stringify(api.readSanMoveList(entries)), JSON.stringify(['e4', 'e5', 'Nf3']));
});
// A mid-game board plus its move list is the shape the scan loop actually sees;
// the tracker, the list parser and the grid reader have to agree on it.
test('a mid-game scan reports ply, SAN history and whose clock runs', () => {
  const html = [
    '<wc-chess-board class="board">',
    '  <div class="piece bk square-58"></div><div class="piece bq square-48"></div>',
    '  <div class="piece br square-88"></div><div class="piece bp square-57"></div>',
    '  <div class="piece bp square-47"></div><div class="piece bp square-37"></div>',
    '  <div class="piece bp square-27"></div><div class="piece bp square-17"></div>',
    '  <div class="piece wp square-54"></div><div class="piece wp square-44"></div>',
    '  <div class="piece wp square-34"></div><div class="piece wp square-24"></div>',
    '  <div class="piece wp square-12"></div>',
    '  <div class="piece wk square-51"></div><div class="piece wr square-11"></div>',
    '  <div class="piece wr square-81"></div><div class="piece wb square-31"></div>',
    '  <div class="piece wn square-71"></div>',
    '  <div class="piece bn square-78"></div><div class="piece bb square-38"></div>',
    '  <div class="piece wn square-28"></div><div class="piece wr square-18"></div>',
    '</wc-chess-board>',
    '<wc-simple-move-list>',
    '  <div class="node" data-ply="1"><span class="node-san">e4</span></div>',
    '  <div class="node" data-ply="2"><span class="node-san">e5</span></div>',
    '</wc-simple-move-list>',
    '<div class="board-layout-bottom"><div class="clock-component clock-player-turn">0:09</div></div>'
  ].join('');
  const { api } = mount(html);
  const scan = api.scanBoard('w');
  assert.equal(scan.valid, true);
  assert.equal(scan.flipped, false);
  assert.equal(scan.plyCount, 2);
  assert.equal(JSON.stringify(scan.sanMoves), JSON.stringify(['e4', 'e5']));
  assert.equal(scan.activeClockTurn, 'w');
  assert.equal(scan.clockSeconds, 9);
});

test('a board marked flipped is read from the other side', () => {
  const { api, dom } = mount(boardHtml().replace('<wc-chess-board class="board">', '<wc-chess-board class="board flipped">'));
  const boardEl = dom.window.document.querySelector('wc-chess-board');
  const read0 = api.readGridFromBoard(boardEl, true);
  assert.equal(read0.valid, true);
  assert.equal(api.Chess.gridToPlacement(read0.grid), 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
});
