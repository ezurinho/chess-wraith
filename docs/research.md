# Engine and detection research

Everything below is measured on this machine against the live site, or cited to a
public source. Nothing here is a guess dressed as a fact.

## 1. Which engine can a userscript actually run

| Build | Ship size | Boot on chess.com | Speed | WDL | Verdict |
| --- | --- | --- | --- | --- | --- |
| `stockfish-19-lite-single` (WASM NNUE) | 28 KB js + 1.17 MB wasm | 111 ms to `uciok` | 1,285,348 nodes in 1,657 ms = ~776 kN/s, depth 18 | yes | **used** |
| `stockfish.js` (2019, asm.js) | 1.4 MB | ~600 ms | ~40–60 kN/s, depth ~14 | no | fallback |
| Multi-threaded Stockfish WASM | 1.2 MB + threads | — | up to 4× on paper | yes | **impossible here** |
| chess.com's own analysis | 0 (server) | — | full depth, cloud | yes | not reachable from a userscript |

Multi-threading needs `SharedArrayBuffer`, which needs `Cross-Origin-Opener-Policy`
and `Cross-Origin-Embedder-Policy` headers on the top-level page. chess.com does
not send them, and a userscript cannot add response headers. Single-thread NNUE is
the ceiling, and it is the same engine the analysis board shows when you open it
locally.

Why the wasm failed for three releases is documented in `src/50-engine.js`: the
build derives its wasm URL from `self.location.href` plus a content hash, so the
request is `https://www.chess.comhttps://www.chess.com/554211df-…`. A shim that
matched on `.wasm` never saw it; the current shim answers every request that is
not the engine's own script with the mirror bytes.

## 2. What fair-play systems can see

Chess.com publishes the shape of its process, not the model: games are analysed
and accounts are closed in bulk (the fair-play page reports ~314,000 closures in
one quarter and ~105,000 per month), with human review before closure
([chess.com/cheating](https://www.chess.com/cheating),
[Fair Play Policy](https://www.chess.com/legal/fair-play)). Two categories of
signal follow from that, and they are not equally hard to beat:

- **Statistical**: move quality against the player's own history, centipawn loss,
  engine-correlation scores, and the timing of moves. This is what the pacing in
  `src/60-analysis.js` is built for: a window per account, a floor set by the
  opponent, the gap between the top lines, and a rare second thought.
- **Client-side**: whether the events that produced a move were real. A userscript
  dispatches `PointerEvent`s, and `event.isTrusted` is `false` for every one of
  them ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted)).
  There is no API a page script can call to mint a trusted event. If chess.com
  checks that flag on move input, the only workaround is driving the browser from
  outside the page (extension with `chrome.debugger`, CDP, or Playwright), which is
  exactly what `nitro-wraith` does for typing and what this userscript cannot do.

What the script does about the ambiguity: it never plays the move the user is
about to make (a pointerdown outside the panel defers and then stops it), it
paces against the opponent, and it stops when the turn cannot be read instead of
guessing. What it cannot do is make its own input plausible to a check that asks
the browser for provenance.

## 3. How this compares with nitro-wraith

| | `nitro-wraith` | `chess-wraith` |
| --- | --- | --- |
| Delivery | Tampermonkey userscript | same |
| Heavy lifting | none (typing) | Stockfish 19 NNUE in a blob worker |
| Input | synthetic `KeyboardEvent` | synthetic `PointerEvent` |
| Account model | per-account pace ceiling from the account's own top speed | per-account opening memory + learned think-time band |
| Session model | queue with breaks, DQ streak handling | rematch loop, keep-alive, hand-on-board stop |
| Tests | 96 files | 78 tests in 10 files |
| Release | dispatch, gated by checks | same, plus a version/mirror gate |

The gap that remains is verification: nitro-wraith has a test file per module and
a canary workflow against the live site; this repo has unit tests for the pure
logic and manual live probes. That is the honest difference between the two,
not the features.

