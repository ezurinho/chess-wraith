# Review, 1.64.0

Evidence: `npm run check` (221 tests, 0 failures), the committed bundle, and live
sessions on `chess.com/analysis` where the shipped file was fetched from jsDelivr,
evaluated in the page, and driven with real pointer events against chess.com's own
handlers. Where the evidence is thin it says so. Numbers are from 2026-11-27.

## Grade

| Area | Grade | Why |
| --- | --- | --- |
| Product | 8.5 | Strength is anchored to the account's published rating, pacing comes from its own clocks, AFK rematch, report, stats. Measured against that promise the delivered strength is still 4x too strong (66 cp/move where a 133 asks for 293). |
| Engineering | 8.5 | One IIFE, 15 fragments, 221 tests, a bench that boots the whole bundle, a release gate that refuses a red check. Two live-play defects (arrows that never drew, a move verified as "the board changed") came from shipped code, which is why this is not 9. |
| Verification | 8.0 | Quiet move, castling, en passant, promotion, arrows, 24-ply games, and a per-ply position sanity check now run on the real board. No rated game with a human, clocks and a rematch; nothing equivalent in CI. |
| Honesty | 9.5 | Three self-reported numbers were fake and are now measured or gone: the move was never at the account's rating (the account rating never reached the chooser), an improvised move reported its target as its loss, and "landed" meant "changed". |
| UX | 8.0 | Arrows draw, four tabs, the rating chain is inspectable. 300 px wide, desktop only, English only. |
| Risk (as a cheating tool) | 3.0 | chess.com closed ~314,000 accounts in one quarter, ~85% without a human, over 100 gameplay factors, and its Fair Play page names live analysis of a game in progress. Pacing lowers the timing signal; it does not hide the analysis. |

**Overall: 8.2/10.** Up from 8.0. The gain is not a feature: it is that the
number the panel shows is now the number the board produced.

## What the live runs found, in order

Each session fetched the release from jsDelivr into `/analysis?cw=1`, waited for
the wasm engine, and played through `ChessWraith.playNow` / `playMove`, which
dispatch synthetic pointer events on chess.com's board. Every move was confirmed
by re-reading the FEN, and each ply re-checked that the piece count could not have
jumped.

| Release | Session | Result |
| --- | --- | --- |
| 1.61.2 | quiet move, castling, en passant, promotion | all four shapes landed; arrows appeared |
| 1.63.0 | 20 plies at a fake 133 account | loss/move 208 — every improvised move reported 293, a number the script chose, not one it measured |
| 1.63.1 | 10 moves, 3 improvised | **40 cp/move** against a 293 band: the "beginner" was taking free material, which is good play |
| 1.63.2 | 20 plies, 5 improvised | **6 cp/move**; weighting a hanging move was not enough to make it happen |
| 1.63.3 | 24 plies, 2 improvised before it broke | black's a8 rook vanished from the position — the click moved a different piece and `playMove` called it a success |
| 1.64.0 | 24 plies, 8 improvised | **66.5 cp/move**, one move at the 600 clamp, no impossible position, no stuck move, zero mismatches |

**Defect 1 — level play was unreachable.** `styleProfile` takes its level from
`opts.accountElo`, and neither call site passed it, so `levelPlayTarget` returned 0
for every account: the beginner model that 1.58.0–1.62.0 documented could not run
in the shipped script. The unit tests passed because they passed the option
themselves. Fixed in 1.63.0; `accountRatingNow() || state.boardRating` now reaches
both call sites.

**Defect 2 — the loss was a claim.** An improvised move returned
`cpLoss: target` (293), so the panel averaged a constant with real search drops.
Measured live: eleven of twenty samples were exactly 293. Now the eval after the
move, from the engine's own reply search, with a ply guard; `myLossFromWhiteCp` is
tested from both sides.

**Defect 3 — "changed" is not "played".** After a click the board grid differed,
so the move counted as landed, even when the click had selected another piece.
Black lost its a8 rook out of the position that way. 1.64.0 compares the landed
grid with the grid the rules say the move produces.

## Where the strength model actually stands

| Account | Band (cp/move) | Delivered, live | Improvised moves |
| --- | --- | --- | --- |
| 133 | 270–320 | 66.5 over 12 moves | 8 of 12 |
| 600 | 200 | not measured live | — |
| 1320 | 60 | not measured live | — |

The gap is understood: a static taste can only pick among moves it can judge, and
the moves that hang material are rare in any position. The improvised move is
still an engine move that happens to leave something loose; the opponent does not
always take it, so the measured drop is small.

## How it compares

Checked 2026-11-27 with the GitHub API (`/search/repositories`) and each project's
README. Stars as returned that day.

| | chess-wraith 1.64.0 | A.C.A.S | chesshook | chess.com Game Review |
| --- | --- | --- | --- | --- |
| Stars | 0 | 195 | 24 | closed source |
| Engine | Stockfish 19 NNUE wasm, one 308 KB userscript, no server | many wasm engines plus an optional localhost server | userscript with a local engine server | cloud, no engine on the page |
| Sites | chess.com | chess.com, lichess, pychess, more | chess.com | chess.com |
| Strength model | account rating → cp/move band → weighted improvisation, measured after the fact | engine options exposed (Elo, depth, MultiPV, Skill) | not stated in the README | fixed cloud depth |
| Human pacing | yes, median from the account's own public clocks | no pacing claim | no | n/a |
| AFK rematch + session caps | yes | no | no | no |
| Arrows / multi-line | yes, arrow + reply, toggle | yes, multiple suggestions, variants | overlay | yes |
| Variants | no | chess960 and Fairy variants | no | no |
| Languages | English only | 30+ | English | 50+ |
| Tests in the repo | 221, boots the bundle | not visible | none visible | n/a |

Two things no other tool here has: the strength target comes from the account's own
rating, and the delay comes from the account's own games. A.C.A.S. is broader —
variants, sites, languages — and a different product: it shows moves, it does not
try to play like a person.

## Research notes

- Stockfish's `UCI_Elo` is clamped, not continuous: `LowestElo = 1320`,
  `HighestElo = 3190` in
  [`src/search.h`](https://github.com/official-stockfish/Stockfish/blob/master/src/search.h),
  wired in [`src/engine.cpp`](https://github.com/official-stockfish/Stockfish/blob/master/src/engine.cpp).
  A 133 account cannot be played by the engine at 133; the band and the chooser
  have to do it, which is why `ELO_FLOOR` exists.
- chess.com's [Fair Play page](https://www.chess.com/cheating) reports ~314,000
  closures for January–March 2025 (~3,500/day), ~85% automated, over 100 gameplay
  factors, and fewer than 1% of monthly users cheating. The same page says not to
  run automated analysis on games in progress. That is this script's core loop,
  and pacing does not change it.
- The measured ACPL of a 133 account is not published anywhere authoritative; the
  270–320 band in this repo is a model, not a dataset. It is the weakest number
  the script builds on.

## What is still weak, in priority order

1. **The band is not reached.** 66 cp/move delivered against 293 asked. Closing
   it needs an engine-guided choice (search a dozen legal moves, take the one
   whose measured drop is nearest the band), not a better static taste.
2. **No opponent in the live loop.** Moves land on the real board; a clocked game
   with a human, a rematch and a rating change has not been run.
3. **Live analysis is the risk.** It is the behaviour chess.com names in writing.
4. **No variants, no second site, one language.** A.C.A.S. is years ahead there.
5. **The overlay assumes the board element is the eight-by-eight grid.**
6. **Panel is 300 px and desktop-only.**
7. **First run downloads 1.2 MB of engine.** Cached afterwards.

## What the next release should do

- Engine-guided drop selection for improvised moves: one restricted search over
  ~10 legal moves at low depth, take the candidate whose measured loss is closest
  to the band. This is the only path from 66 to 293 that can be verified.
- A real opponent: use the analysis board's play mode to exercise clocks, the
  game-over transition and the rematch.
- A live checklist in `docs/` with the exact page states, so the next session
  repeats it instead of inventing it.
