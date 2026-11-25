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

## 2b. The account is the anchor, and the clock picks the class

Chess.com publishes one rating per time class, and the endpoint is readable from
a chess.com tab: on 2026-11-25 an injected script on `www.chess.com` fetched
`https://api.chess.com/pub/player/hikaru/stats`, got HTTP 200 with
`type: "cors"`, and read `chess_blitz.last.rating = 3450`
([Published-Data API](https://www.chess.com/news/view/published-data-api)).
The response does not carry an `Access-Control-Allow-Origin` header visible to
JS, which is normal: CORS response headers are not on the safelisted list, so
`headers.get` returns `null` while the request still passes.

Which class applies is decided by the clock on the board, not by a setting: the
peak clock seen in the game maps to bullet (below 3 minutes), blitz (below 10),
rapid (below 30) and daily. That is why the same account can be anchored at 1650
in rapid and 1500 in bullet. The anchor is the account's own number, and
`effectiveElo` lets the engine drift at most 75 below and 25 above it; a
published 1400 can no longer be told to play like a 2000 by a knob, and an
account with no readable rating falls back to the manual target and then to 1500.

Why anchor at all: chess.com says its system weighs "over 100 gameplay factors"
and closes about 85% of cases automatically
([chess.com/cheating](https://www.chess.com/cheating), June 2025), and the one
comparison such a system always has is the account's own history. A player who
suddenly scores two rating bands above their published level is the least
defensible pattern there is.

Timing follows the same logic. The largest public study of human think time - 519
million moves from 12.49 million Lichess games - shows time spent tracks the
value of computation in the position: people think longer where the position is
sharp and shorter where there is only one move
([Russek et al. 2025](https://cocosci.princeton.edu/papers/RussekThinking2025.pdf)).
A model trained on human games allocates more time in the early middle game
(plies 2-30) than an engine does
([Rheude et al. 2021](https://ml-research.github.io/papers/rheude2021time.pdf)).
So the delay here moves with the gap between the top two lines, checks, captures,
the phase, the time control and the account's own learned median, and a forced
move is played almost at once. A long session also drifts 2% slower per hour,
capped at 6% after three hours - the same time-on-task effect the typing model in
`nitro-wraith` carries. A fixed window is the part that looks like a clock.

## 3. How this compares with nitro-wraith

| | `nitro-wraith` | `chess-wraith` |
| --- | --- | --- |
| Delivery | Tampermonkey userscript | same |
| Heavy lifting | none (typing) | Stockfish 19 NNUE in a blob worker |
| Input | synthetic `KeyboardEvent` | synthetic `PointerEvent` |
| Account model | per-account pace ceiling from the account's own top speed | published rating per time class + learned pace + opening memory + earned accuracy slack, all keyed by username |
| Session model | queue with breaks, DQ streak handling | rematch loop, keep-alive, hand-on-board stop |
| Tests | 96 files | 82 tests in 11 files |
| Release | dispatch, gated by checks | same, plus a version/mirror gate |

The gap that remains is verification: nitro-wraith has a test file per module and
a canary workflow against the live site; this repo has unit tests for the pure
logic and manual live probes. That is the honest difference between the two,
not the features.

