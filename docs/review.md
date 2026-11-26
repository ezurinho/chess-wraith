# Review, 1.66.0

Evidence: `npm run check` (221 tests, 0 failures), the committed bundle, and live
sessions on `chess.com/analysis` where the shipped file was fetched from jsDelivr,
evaluated in the page, and driven with real pointer events against chess.com's own
handlers. Where the evidence is thin it says so. Numbers are from 2026-11-27.

## Grade

| Area | Grade | Why |
| --- | --- | --- |
| Product | 8.5 | Strength anchored to the account's rating, pacing from its own clocks, AFK rematch, report, stats. An improvised move is now priced by the engine instead of tasted. The game-level mean is still noisy and short of the band. |
| Engineering | 8.5 | One IIFE, 15 fragments, 221 tests, a bench that boots the bundle, a release gate that refuses a red check. Six releases in one day, each one paying for the previous one's assumption. |
| Verification | 8.0 | 24- and 26-ply games on the real board with a per-ply position sanity check, plus castling, en passant, promotion and arrows. No rated game with a human, clocks and a rematch; nothing equivalent in CI. |
| Honesty | 9.5 | Three self-reported numbers were fake and are now measured or gone: the account rating never reached the chooser, an improvised move reported its target as its loss, and "landed" meant "changed". The strength claims are now three numbers from three games, with the spread shown. |
| UX | 8.0 | Arrows draw, four tabs, the rating chain is inspectable. 300 px, desktop only, English only. |
| Risk (as a cheating tool) | 3.0 | chess.com closed ~314,000 accounts in one quarter, ~85% without a human, over 100 gameplay factors, and its Fair Play page names live analysis of a game in progress. Pacing lowers the timing signal; it does not hide the analysis. |

**Overall: 8.3/10.** Up from 8.2. The model no longer guesses what a move
costs: it asks the engine, then plays the move nearest the band.

## What the live runs found, in order

Each session fetched the release from jsDelivr into `/analysis?cw=1`, waited for
the wasm engine, and played through `ChessWraith.playNow` / `playMove`, which
dispatch synthetic pointer events on chess.com's board. Every ply was confirmed by
re-reading the FEN and re-checking the piece count.

| Release | Session | Result |
| --- | --- | --- |
| 1.61.2 | quiet move, castling, en passant, promotion | all four landed; arrows appeared |
| 1.63.0 | 20 plies at a fake 133 | loss/move 208 — every improvised move reported 293, a number the script chose |
| 1.63.1 | 10 moves, 3 improvised | 40 cp/move: the "beginner" was taking free material |
| 1.63.2 | 20 plies, 5 improvised | 6 cp/move: weighting a hanging move was not enough |
| 1.63.3 | 24 plies | black's a8 rook vanished; the click moved another piece and `playMove` called it a success |
| 1.64.0 | 24 plies, 8 improvised | 66.5 cp/move, no impossible position, no stuck move |
| 1.65.0 | 24 plies, 7 improvised | 185.8 cp/move; the engine prices each candidate |
| 1.65.2 | 26 plies, 5 improvised | 118.2 cp/move |
| 1.66.0 | 26 plies, 6 improvised | 62.0 cp/move |

**Defect 1 — level play was unreachable.** `styleProfile` reads `opts.accountElo`
and neither call site passed it, so `levelPlayTarget` returned 0 for every
account: the beginner model documented since 1.58.0 could not run in the shipped
script. The unit tests passed because they passed the option themselves.

**Defect 2 — the loss was a claim.** An improvised move returned
`cpLoss: target` (293). Measured live: eleven of twenty samples were exactly 293.
Now the eval after the move, from the engine's own reply search, with a ply guard.

**Defect 3 — "changed" is not "played".** After a click the grid differed, so the
move counted as landed, even when the click had selected another piece. 1.64.0
compares the landed grid with the grid the rules say the move produces.

**Defect 4 — a random shortlist misses the expensive move.** Ten random legal
moves rarely contain one that costs 300+, so the engine-priced model swung between
6 and 186 cp/move on identical settings. Half the candidates now come from the
moves that leave material loose.

**Defect 5 — half the moves wrong is not a 133.** The improvisation rate was
capped at 0.5, so even when every improvised move cost the band the game averaged
half of it. The cap is 0.85 now.

## Where the strength model actually stands

| Account | Band (cp/move) | Delivered, live | Spread |
| --- | --- | --- | --- |
| 133 | 270–320 | 185.8 / 118.2 / 62.0 | three 24–26 ply games, engine-best opponent |
| 600 | 200 | not measured live | — |
| 1320 | 60 | not measured live | — |

The spread is the finding. Thirteen white moves per game is a small sample, and
the realised loss of a priced move depends on the opponent: a move priced at 470 by
a depth-10 search is often declined by a perfect reply, and then it costs nothing.
Against an opponent of the same level the same move would be taken. So the true
delivered loss sits above the measured mean, and the measured mean is not precise
enough to certify a band of ±25 cp.

## How it compares

Checked 2026-11-27 with the GitHub API (`/search/repositories`) and each project's
README. Stars as returned that day.

| | chess-wraith 1.66.0 | A.C.A.S | chesshook | chess.com Game Review |
| --- | --- | --- | --- | --- |
| Stars | 0 | 195 | 24 | closed source |
| Engine | Stockfish 19 NNUE wasm, one 313 KB userscript, no server | many wasm engines plus an optional localhost server | userscript with a local engine server | cloud, no engine on the page |
| Sites | chess.com | chess.com, lichess, pychess, more | chess.com | chess.com |
| Strength model | account rating → band → engine-priced weak move | engine options exposed (Elo, depth, MultiPV, Skill) | not stated | fixed cloud depth |
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
- `UCI_LimitStrength`/`UCI_Elo` weakens the engine by its own skill schedule, not
  by making human mistakes: the moves it plays are still its best at that level.
  A blunder that looks human has to be chosen deliberately, which is what the
  restricted search does.
- chess.com's [Fair Play page](https://www.chess.com/cheating) reports ~314,000
  closures for January–March 2025 (~3,500/day), ~85% automated, over 100 gameplay
  factors, and fewer than 1% of monthly users cheating. The same page says not to
  run automated analysis on games in progress. That is this script's core loop.
- The ACPL of a 133 account is not published anywhere authoritative; the 270–320
  band in this repo is a model, not a dataset. It remains the weakest number the
  script builds on.

## What is still weak, in priority order

1. **The measurement is too small to grade the band.** Three games of thirteen
   moves each; the spread is 62–186. A proper calibration needs 100+ moves per
   rating against an opponent of that rating, not against best play.
2. **No opponent in the live loop.** No clocked game with a human, no rematch, no
   rating change.
3. **Live analysis is the risk.** It is the behaviour chess.com names in writing.
4. **No variants, no second site, one language.**
5. **The overlay assumes the board element is the eight-by-eight grid.**
6. **Panel is 300 px and desktop-only.**
7. **First run downloads 1.2 MB of engine.**

## What the next release should do

- A calibration harness: play a ladder of accounts (133, 400, 800, 1200, 1800)
  against an opponent at the same rating, 100 moves each, and publish the
  delivered ACPL per rung. Until then the band is a design, not a result.
- A real opponent: the analysis board's play mode, to exercise clocks, the
  game-over transition and the rematch.
- A live checklist in `docs/` with the exact page states, so the next session
  repeats it instead of inventing it.
