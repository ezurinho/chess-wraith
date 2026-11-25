'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const Chess = require(path.resolve(__dirname, '..', '..', 'src', '30-chess.js'));

function perft(state, depth) {
  const moves = Chess.generateLegalMoves(state);
  if (depth === 1) return moves.length;
  let total = 0;
  for (const move of moves) total += perft(move.nextState, depth - 1);
  return total;
}

test('perft matches the published node counts', () => {
  const start = Chess.parseFen(Chess.START_FEN);
  assert.equal(perft(start, 1), 20);
  assert.equal(perft(start, 2), 400);
  assert.equal(perft(start, 3), 8902);

  const kiwi = Chess.parseFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  assert.equal(perft(kiwi, 1), 48);
  assert.equal(perft(kiwi, 2), 2039);

  const enPassant = Chess.parseFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
  assert.equal(perft(enPassant, 1), 14);
  assert.equal(perft(enPassant, 2), 191);
  assert.equal(perft(enPassant, 3), 2812);
});

test('FEN roundtrip and square helpers', () => {
  assert.equal(Chess.buildFen(Chess.parseFen(Chess.START_FEN)), Chess.START_FEN);
  assert.equal(Chess.chessComClassToSquare('5', '2'), 'e2');
  assert.equal(Chess.chessComClassToSquare('1', '8'), 'a8');
  assert.equal(Chess.chessComCodeToFenChar('wp'), 'P');
});

test('SAN replay rebuilds castling rights and the move list', () => {
  const replay = Chess.replaySanMoves(['e4', 'e5', '\u2658f3', 'Nc6', 'Bc4', 'Bc5', 'O-O']);
  assert.ok(replay);
  assert.deepEqual(replay.uciMoves, ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5', 'e1g1']);
  assert.equal(replay.state.turn, 'b');
  assert.equal(Chess.buildFen(replay.state).split(' ')[2], 'kq');
});

test('mate and disambiguation survive the SAN formatter', () => {
  const fools = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2';
  assert.deepEqual(Chess.pvToSan(fools, ['d8h4']), ['Qh4#']);
  assert.deepEqual(Chess.pvToSan('4k3/8/8/8/8/8/1N3N2/4K3 w - - 0 1', ['b2d3']), ['Nbd3']);
});

test('UCI info parsing keeps score, mate and WDL', () => {
  const parsed = Chess.parseUciInfoLine(
    'info depth 14 seldepth 20 multipv 2 score cp -88 wdl 120 500 380 nodes 42000 nps 390000 pv e7e5 g1f3'
  );
  assert.equal(parsed.depth, 14);
  assert.equal(parsed.multipv, 2);
  assert.equal(parsed.scoreCp, -88);
  assert.deepEqual(parsed.wdl, [120, 500, 380]);
  assert.deepEqual(parsed.pv, ['e7e5', 'g1f3']);
  assert.deepEqual(Chess.normalizeWdlForWhite(parsed.wdl, 'b'), { white: 38, draw: 50, black: 12 });
});

test('the tracker follows ep, castling and takebacks', () => {
  const tracker = new Chess.ChessStateTracker();
  let snap = tracker.updateFromDomSnapshot(Chess.parseFen(Chess.START_FEN).grid, { plyCount: 0 });
  assert.equal(snap.fen, Chess.START_FEN);

  const state = Chess.parseFen(Chess.START_FEN);
  const afterE4 = Chess.generateLegalMoves(state).find((m) => Chess.moveToUci(m) === 'e2e4').nextState;
  snap = tracker.updateFromDomSnapshot(afterE4.grid, { plyCount: 1 });
  assert.equal(snap.turn, 'b');
  assert.equal(snap.ep, 'e3');
  assert.deepEqual(snap.uciMoves, ['e2e4']);
});
