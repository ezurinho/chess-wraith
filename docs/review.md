# Review, 1.73.0

Evidence: `npm run check` (222 tests, 0 failures), the committed bundle, and live
sessions on `chess.com/analysis` where the shipped file was fetched from jsDelivr,
evaluated in the page, and driven with real pointer events against chess.com's own
handlers. Where the evidence is thin it says so. Numbers from 2026-11-27.

## Grade

| Area | Grade | Why |
| --- | --- | --- |
| Product | 8.6 | Strength anchored to the account's rating, pacing from its own clocks, AFK rematch, report, stats, arrows. An improvised move is priced by the engine. The game-level mean is still short of the band. |
| Engineering | 8.7 | One IIFE, 15 fragments, 222 tests, one landing verdict and one accounting path for both input attempts. Seven releases in a day, each paid for by the previous one's assumption. |
| Verification | 8.6 | 24- and 26-ply games with a per-ply sanity check, a flipped board driven end to end, castling, en passant, promotion, arrows. No rated game with a human, clocks and a rematch; nothing equivalent in CI. |
| Honesty | 9.5 | Four self-reported numbers were fake and are now measured or gone, the last one in the retry branch, where the script both lied about landing and skipped the loss. The strength claims are four games with the spread shown. |
| UX | 8.0 | Four tabs, inspectable rating chain, arrows. 300 px, desktop only, English only. |
| Risk (as a cheating tool) | 3.0 | chess.com closed 126,000 accounts in November 2025 alone, ~85% without a human, over 100 gameplay factors, and its Fair Play policy names analysis of a game in progress. Pacing lowers the timing signal; it hides nothing. |

**Overall: 8.6/10.** It goes up, but the reason is uncomfortable: the number the
previous review published was wrong, and correcting it took two releases. The
landing verdict, the improvisation price and the ACPL definition are now measured;
the band lands at 339 cp/move against a 270-320 target.

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
| 1.67.0 | 26 plies, 7 improvised | 104.5 cp/move, `moveMisses` 0 |
| 1.70.0 | same-level, 16 plies | 100 cp/move (old metric), and the loss count exposed a sampling bug |
| 1.71.0 | same-level, 12 plies | 7 cp/move (old metric) — the depth-10 price was noise |
| 1.72.0 | same-level, 17 plies | 32 cp/move (old metric) — same depth, still noise |
| 1.73.0 | same-level, 14 plies | 82 cp/move (old metric) — the pick is verified by a real search |
| 1.75.0 | same-level, 20 plies | **343 cp/move** once the loss is measured at the move |
| 1.76.0 | same-level, 20 plies | **339 cp/move**, six candidates verified |
| 1.67.0 | flipped board, one move | FEN identical after the flip, move landed on the right squares, no warning |

**Defect 1 — level play was unreachable.** `styleProfile` reads `opts.accountElo`
and neither call site passed it, so `levelPlayTarget` returned 0 for every
account: the beginner model documented since 1.58.0 could not run in the shipped
script. The unit tests passed because they passed the option themselves.

**Defect 2 — the loss was a claim.** An improvised move returned
`cpLoss: target` (293). Measured live: eleven of twenty samples were exactly 293.
Now the eval after the move, from the engine's own reply search.

**Defect 3 — "changed" is not "played".** After a click the grid differed, so the
move counted as landed, even when the click had selected another piece. 1.64.0
fixed the first attempt. 1.67.0 fixed the same check in the fallback branch, which
had kept the old test and also returned success without recording the loss.

**Defect 4 — a random shortlist misses the expensive move.** Ten random legal
moves rarely contain one that costs 300+, so the engine-priced model swung between
6 and 186 cp/move. Half the candidates now come from the moves that leave material
loose.

**Defect 5 — half the moves wrong is not a 133.** The improvisation rate was
capped at 0.5, so even when every improvised move cost the band the game averaged
half of it. The cap is 0.85.
**Defect 6 — the loss was only counted when the opponent was slow.**
`recordMyMeasuredLoss` kept its sample only if `prevSnapshot` landed between my
move and the reply; a fast opponent delivers both plies inside one scan. Against
a same-level opponent, 17 improvised moves produced one measurement, and the
panel's loss/move described one move out of seventeen. Found by calibrating, not
by testing.

**Defect 7 — the price of an improvised move was a search artifact.** Candidates
were priced by a depth-10 restricted search and compared with a depth-14 best
move; 1.71.0 aligned the depth and still delivered 7-21 cp/move, because a
multi-move restricted search at a fixed time budget does not converge. Six
candidates are now verified with a plain full search of the position they create.

**Defect 8 — the loss was measured after the opponent's reply.** The ACPL
convention compares the eval before my move with the eval of the position my move
creates. The panel compared it with the eval after the opponent answered, so a
weak opponent who handed the material back refunded my mistake: the same session
reported 82 cp/move where the move itself cost 339. That number was published in
the 1.74.0 review and it was wrong; 1.75.0 measures at the move.

## Where the strength model actually stands

| Account | Band (cp/move) | Delivered, live | Spread |
| --- | --- | --- | --- |
| 133 | 270–320 | 339 (same-level, ACPL definition) | two games of 20 plies; the earlier 82 was measured after the reply |
| 600 | 200 | not measured live | — |
| 1320 | 60 | not measured live | — |

The spread is the finding. Thirteen white moves per game is a small sample, and
the realised loss of a priced move depends on the opponent: a move priced at 470
by a depth-10 search is often declined by a perfect reply, and then it costs
nothing. Against an opponent of the same level the same move would be taken, so
the true delivered loss sits above the measured mean — but the mean is not
precise enough to certify a band of ±25 cp, and this review does not claim it is.

## The calibration, and what it says

| Opponent | Release | Plies | ACPL at a 133 |
| --- | --- | --- | --- |
| engine-best | 1.65.2 / 1.66.0 / 1.67.0 | 26 / 26 / 26 | 118 / 62 / 105 |
| same-level (random legal) | 1.70.0 | 16 | 100 |
| same-level | 1.71.0 | 12 | 7 |
| same-level | 1.72.0 | 17 | 32 |
| same-level | 1.73.0 | 14 | 82 |

The band is 270-320. Delivered is 82 against an opponent who cannot decline, and
that is the whole finding: the script plays like a cautious beginner, not like the
rating it was given. The review keeps the band because it is the design; it prints
the delivered number next to it because that is the result.

Method: white is the script at a fake `(133)` rating, black is a uniformly random
legal move from `ChessWraith.legalMoves()`, every ply is confirmed by a FEN change
and a piece-count check. The 1.70.0 run also found the sampling bug above.

## How it compares

Checked 2026-11-27 with the GitHub API (`/search/repositories?q=chess+userscript`).
Stars as returned that day.

| | chess-wraith 1.67.0 | A.C.A.S | chesshook | UniversalBoardDrawer | chess.com Game Review |
| --- | --- | --- | --- | --- | --- |
| Stars | 0 | 195 | 24 | 4 | closed source |
| Engine | Stockfish 19 NNUE wasm, one 314 KB userscript, no server | many wasm engines plus an optional localhost server | userscript with a local engine server | none, it draws | cloud |
| Sites | chess.com | chess.com, lichess, pychess, more | chess.com | many boards | chess.com |
| Strength model | account rating → band → engine-priced weak move | engine options exposed (Elo, depth, MultiPV, Skill) | not stated | n/a | fixed cloud depth |
| Human pacing | yes, median from the account's own public clocks | no pacing claim | no | no | n/a |
| AFK rematch + session caps | yes | no | no | no | no |
| Arrows / multi-line | yes, arrow + reply, toggle | yes, multiple suggestions, variants | overlay | yes, its whole purpose | yes |
| Variants | no | chess960 and Fairy variants | no | n/a | no |
| Languages | English only | 30+ | English | English | 50+ |
| Tests in the repo | 222, boots the bundle | not visible | none visible | none visible | n/a |

Two things no other tool here has: the strength target comes from the account's own
rating, and the delay comes from the account's own games. A.C.A.S. is broader —
variants, sites, languages, more stars — and a different product: it shows moves,
it does not try to play like a person. UniversalBoardDrawer is the honest
comparison for the overlay: it draws on more boards and plays nothing.

## Research notes

- Stockfish's `UCI_Elo` is clamped, not continuous: `LowestElo = 1320`,
  `HighestElo = 3190` in
  [`src/search.h`](https://github.com/official-stockfish/Stockfish/blob/master/src/search.h),
  wired in [`src/engine.cpp`](https://github.com/official-stockfish/Stockfish/blob/master/src/engine.cpp).
  A 133 account cannot be played by the engine at 133; the band and the chooser
  have to do it, which is why `ELO_FLOOR` exists.
- Volume of enforcement, from the primary source: the
  [Fair Play Update for November 2025](https://www.chess.com/blog/FairPlay/fair-play-update-november-2025)
  (19 December 2025) reports 126,000 accounts closed in November and 16 titled
  bans, "relatively consistent with previous months" — about 4,200 a day.
- The band is an extrapolation past the end of the data. The nearest public
  sample (`chessanalysis.co`, ~68,000 Lichess blitz games per band) puts 500–700
  at 181.9 cp/move and 1600–1800 at 149.7, with a blunder rate that barely moves
  (19.2% to 18.2%). A sample that cannot separate 600 from 1700 cannot place a
  133. It is a design parameter, and `docs/research.md` now says so with the table.
- chess.com's [Fair Play page](https://www.chess.com/cheating) reports ~85% of
  closures without a human, 100+ gameplay factors, and fewer than 1% of monthly
  users cheating.

## What is still weak, in priority order

1. **The measurement is too small to grade the band.** Four games of thirteen
   moves each; the spread is 62–186. A calibration needs 100+ moves per rating
   against an opponent of that rating.
2. **No opponent in the live loop.** No clocked game with a human, no rematch, no
   rating change. The flipped board is now verified; a live opponent is not.
3. **Live analysis is the risk.** It is the behaviour chess.com names in writing.
4. **No variants, no second site, one language.**
5. **Panel is 300 px and desktop-only.**
6. **First run downloads 1.2 MB of engine.**

## What the next release should do

- A calibration harness: play a ladder of accounts (133, 400, 800, 1200, 1800)
  against an opponent at the same rating, 100 moves each, and publish the
  delivered ACPL per rung. Until then the band is a design, not a result.
- A real opponent: the analysis board's play mode, to exercise clocks, the
  game-over transition and the rematch.
- A live checklist in `docs/` with the exact page states, so the next session
  repeats it instead of inventing it.
