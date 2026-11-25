// 30-chess.js is the rules engine taken from the verified ChessBench build:
// perft(1..3) = 20/400/8902, Kiwipete 48/2039, SAN replay of long games exact.
// It registers itself on globalThis; take a local reference and leave the page
// globals clean.
const Chess = globalThis.ChessBenchLogic;
if (!Chess) throw new Error('CHESS WRAITH: rules module missing');
try {
  delete globalThis.ChessBenchLogic;
} catch {
  globalThis.ChessBenchLogic = undefined;
}
