'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { loadFragments } = require('./helpers');

const dom = new JSDOM('<!doctype html><html><body><div id="board"></div></body></html>');
const api = loadFragments(
  ['10-config.js', '20-utils.js', '30-chess.js', '35-chess-glue.js', '45-overlay.js'],
  '{ overlayCell, overlayArrow, paintBoardOverlay }',
  { document: dom.window.document, getComputedStyle: dom.window.getComputedStyle }
);
const board = dom.window.document.getElementById('board');

test('a square maps to the right cell in both orientations', () => {
  assert.deepEqual({ ...api.overlayCell('a1', false) }, { x: 0, y: 7 });
  assert.deepEqual({ ...api.overlayCell('h8', false) }, { x: 7, y: 0 });
  assert.deepEqual({ ...api.overlayCell('a1', true) }, { x: 7, y: 0 });
  assert.deepEqual({ ...api.overlayCell('h8', true) }, { x: 0, y: 7 });
  assert.equal(api.overlayCell('z9', false), null);
  assert.equal(api.overlayCell('', false), null);
});

test('the arrow leaves the origin square and stops short of the target', () => {
  const a = api.overlayArrow('e2e4', false);
  assert.ok(a, 'a legal uci has an arrow');
  assert.ok(a.y1 > a.y2, 'white moves up the board in an unflipped view');
  assert.equal(a.x2, 4.5, 'a vertical move keeps its file');
  assert.ok(a.y2 > 4.5, 'the head stops before the target centre');
  const d = api.overlayArrow('b1c3', false);
  assert.ok(d.x2 < 2.5 && d.y2 > 5.5, 'a diagonal is shortened in both axes');
  const b = api.overlayArrow('e2e4', true);
  assert.ok(b.y1 < b.y2, 'and down the board when the view is flipped');
  assert.ok(api.overlayArrow('e7e8q', false), 'a promotion keeps its four squares');
  assert.equal(api.overlayArrow('e2e9', false), null);
  assert.equal(api.overlayArrow(null, false), null);
  assert.equal(api.overlayArrow('e2e2', false), null);
});

test('one svg, two arrows, and a repaint of the same move changes nothing', () => {
  api.paintBoardOverlay(board, [{ bestUci: 'e2e4', pv: ['e2e4', 'e7e5'] }], false, true);
  const svg = board.querySelector('svg[data-cw-overlay]');
  assert.ok(svg, 'the svg is mounted on the board');
  assert.equal(board.querySelectorAll('svg[data-cw-overlay]').length, 1);
  assert.equal(svg.querySelectorAll('[data-cw-arrow]').length, 4, 'two shafts, two heads');
  assert.equal(svg.getAttribute('viewBox'), '0 0 8 8');
  assert.equal(svg.style.pointerEvents, 'none', 'the board stays clickable');
  const before = svg.getAttribute('data-sig');
  api.paintBoardOverlay(board, [{ bestUci: 'e2e4', pv: ['e2e4', 'e7e5'] }], false, true);
  assert.equal(svg.getAttribute('data-sig'), before);
  assert.equal(svg.querySelectorAll('[data-cw-arrow]').length, 4);
});

test('the toggle clears it and a missing board does not throw', () => {
  api.paintBoardOverlay(board, [{ bestUci: 'e2e4', pv: ['e2e4', 'e7e5'] }], false, true);
  api.paintBoardOverlay(board, [{ bestUci: 'g1f3', pv: ['g1f3'] }], false, true);
  const svg = board.querySelector('svg[data-cw-overlay]');
  assert.equal(svg.querySelectorAll('[data-cw-arrow]').length, 2, 'one move, one arrow');
  api.paintBoardOverlay(board, [{ bestUci: 'g1f3' }], false, false);
  assert.equal(svg.querySelectorAll('[data-cw-arrow]').length, 0);
  assert.equal(svg.getAttribute('data-sig'), null);
  assert.doesNotThrow(() => api.paintBoardOverlay(null, [{ bestUci: 'e2e4' }], false, true));
  assert.doesNotThrow(() => api.paintBoardOverlay(board, null, false, true));
});
