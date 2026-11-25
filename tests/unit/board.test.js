'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFragments } = require('./helpers');

// The board reader cannot run without chess.com's markup, so its parsing is
// split into pure functions and those are what the tests cover. The fragments
// run in their own vm realm, so lists are compared as text.
const board = loadFragments(
  ['10-config.js', '20-utils.js', '40-board.js'],
  `{ sanFromNodeText, sanListFromEntries, plyFromEntries }`
);
const joined = (entries) => board.sanListFromEntries(entries).join(' ');

test('a move node loses its move number but keeps the san', () => {
  assert.equal(board.sanFromNodeText('1.e4', ''), 'e4');
  assert.equal(board.sanFromNodeText(' 12. Qh5+ ', ''), 'Qh5+');
  assert.equal(board.sanFromNodeText('1... c5', ''), 'c5');
  assert.equal(board.sanFromNodeText('', ''), '');
  assert.equal(board.sanFromNodeText(null, ''), '');
});

test('a figurine icon supplies the piece only when the text lacks it', () => {
  assert.equal(board.sanFromNodeText('f3', 'N'), 'Nf3');
  assert.equal(board.sanFromNodeText('Nf3', 'N'), 'Nf3');
  assert.equal(board.sanFromNodeText('O-O', 'K'), 'O-O');
  assert.equal(board.sanFromNodeText('exd5', 'P'), 'exd5');
});

test('a complete move list is ordered by ply regardless of DOM order', () => {
  assert.equal(
    joined([{ ply: 2, san: 'e5' }, { ply: 1, san: 'e4' }, { ply: 3, san: 'Nf3' }]),
    'e4 e5 Nf3'
  );
});

test('a list with a hole is refused instead of played wrong', () => {
  assert.equal(joined([{ ply: 1, san: 'e4' }, { ply: 3, san: 'Nf3' }]), '');
  assert.equal(joined([]), '');
  assert.equal(joined(null), '');
  assert.equal(joined([{ ply: 1, san: '' }]), '');
});

test('a duplicated ply keeps the first node, which is the one that was rendered', () => {
  assert.equal(
    joined([{ ply: 1, san: 'e4' }, { ply: 1, san: 'd4' }, { ply: 2, san: 'e5' }]),
    'e4 e5'
  );
});

test('the ply is the highlighted node, else the last one', () => {
  assert.equal(board.plyFromEntries([{ ply: 1 }, { ply: 2 }, { ply: 3 }]), 3);
  assert.equal(board.plyFromEntries([{ ply: 1 }, { ply: 2, selected: true }, { ply: 3 }]), 2);
  assert.equal(board.plyFromEntries([]), null);
  assert.equal(board.plyFromEntries([{ ply: null }]), null);
});

