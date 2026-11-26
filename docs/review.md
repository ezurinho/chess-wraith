# Review, 1.62.0

Evidence: the suite output (221 tests, 0 failures), the committed bundle, and a
live session on `chess.com/analysis` where the shipped file was evaluated in the
page and driven with real pointer events against chess.com's own handlers. Where
the evidence is thin, it says so. Numbers are from 2026-11-27.

## Grade

| Area | Grade | Why |
| --- | --- | --- |
| Product | 8.5 | Strength anchored to the account's published rating, pacing learned from its own games, AFK rematch, a report and a stats tab. Level play now misses the way a beginner misses (captures and checks first). No variants, no second site. |
| Engineering | 8.5 | One IIFE, 15 fragments, 221 tests over 25 files, a boot bench that runs the whole bundle, a release gate that refuses a red check. Three versions shipped an arrow that never drew because one line read a field that does not exist; that costs the point it would take to reach 9. |
| Verification | 7.5 | A normal move, castling, en passant and promotion are now proven on the real board, not in jsdom. Still no rated game with an opponent, clocks and a rematch, and nothing equivalent runs in CI. |
| Honesty | 9.0 | The floor, the risk and the limits are stated; the 1.58.0 review claimed the overlay closed the last visible gap and the overlay had never drawn. This one corrects that instead of deleting it. |
| UX | 8.0 | Arrows draw now, the panel exposes every link of the rating chain, four tabs. 300 px wide, no compact or mobile layout. |
| Risk (as a cheating tool) | 3.0 | chess.com closed ~314,000 accounts in one quarter, ~85% of them without a human, over 100 gameplay factors. Pacing lowers the timing signal; it cannot hide live analysis, which the Fair Play page names explicitly. |

**Overall: 8.0/10.** Up from 7.6: the live path exists now and it found a
bug that three releases of tests did not.

## What the live run found

The 1.61.2/1.62.0 session injected the release from jsDelivr into
`/analysis?cw=1`, waited for the wasm engine, and called `ChessWraith.playMove`.
Every move below was made by synthetic pointer events on chess.com's board and
confirmed by re-reading the FEN afterwards.

| Shape | Move | Result |
| --- | --- | --- |
| Quiet, auto-played | Nf3, e4, Ne5 | FEN advanced each time |
| Castling | `e1g1` | `RNBQ1RK1` — king g1, rook f1 |
| En passant | `e5d6` after `d7d5` | white pawn on d6, d5 empty |
| Promotion | `e7e8q` | dialog appeared, queen on e8, `4Q3/8/...` |

**The bug it found:** `refreshPanel` passed `state.snapshot.boardEl` to
`paintBoardOverlay`. `boardEl` lives on `state`; the snapshot never carried it, so
the function returned on its first line and the arrows shipped in 1.58.0 have
never appeared on a real page. Fixed in 1.61.2; the boot test now asserts the
shaft and the head exist after the engine answers.

## How it compares

Checked 2026-11-27 with the GitHub API (`/search/repositories`) and each project's
README. Stars as returned that day.

| | chess-wraith 1.62.0 | A.C.A.S | chesshook | chess.com Game Review |
| --- | --- | --- | --- | --- |
| Stars | 0 | 195 | 24 | closed source |
| Engine | Stockfish 19 NNUE wasm, one 304 KB userscript, no server | many wasm engines plus an optional localhost engine server | userscript with a local engine server | cloud, no engine on the page |
| Sites | chess.com | chess.com, lichess, pychess, more | chess.com | chess.com |
| Strength model | account rating → cp/move band → weighted improvisation; `UCI_Elo` floor documented | engine options exposed (Elo, depth, MultiPV, Skill) | not stated in the README | fixed cloud depth |
| Human pacing | yes, median from the account's own public clocks | no pacing claim | no | n/a |
| AFK rematch + session caps | yes | no | no | no |
| Arrows / multi-line | yes, arrow + reply, toggle | yes, multiple suggestions, variants | overlay | yes |
| Variants | no | chess960 and Fairy variants | no | no |
| Languages | English only | 30+ | English | 50+ |
| Tests in the repo | 221, boots the bundle | not visible in the README | none visible | n/a |

The two things no one else here has: the strength target comes from the account's
own rating and the delay comes from the account's own games. A.C.A.S. is the
broader tool — variants, sites, languages — and a different product: it shows
moves, it does not try to look like a person playing.

## Research notes

- Stockfish's `UCI_Elo` is a clamped option, not a continuous one:
  `LowestElo = 1320`, `HighestElo = 3190` in
  [`src/search.h`](https://github.com/official-stockfish/Stockfish/blob/master/src/search.h),
  wired in
  [`src/engine.cpp`](https://github.com/official-stockfish/Stockfish/blob/master/src/engine.cpp).
  A 133 account cannot be played by the engine at 133; the band and the chooser
  have to do it, which is why `ELO_FLOOR` exists.
- chess.com's [Fair Play page](https://www.chess.com/cheating) reports ~314,000
  closures for January–March 2025 (~3,500/day, ~105,000/month), ~85% automated,
  over 100 gameplay factors, and fewer than 1% of monthly users cheating. The same
  page says: do not perform automated analysis or blunder-checking of games in
  progress. That sentence describes this script's core loop, and no pacing change
  changes it.
- A.C.A.S. describes itself as "not a chess cheat" while warning that use may
  lead to disqualification. The disclaimer and the behaviour disagree the same way
  they do here.

## What is still weak, in priority order

1. **No opponent in the live loop.** Moves land on the real board; a clocked game
   with a human, a rematch and a rating change has still not been run.
2. **Live analysis is the risk.** It is the behavior chess.com names in writing.
   Delay and pacing are the only levers, and they are not enough.
3. **No variants, no second site, one language.** A.C.A.S. is three years of
   breadth ahead there.
4. **The overlay assumes the eight-by-eight grid is the board element.** A theme
   with a margin shifts every arrow.
5. **Panel is 300 px and desktop-only.**
6. **First run downloads 1.2 MB of engine.** Cached afterwards.

## What the next release should do

- Use the analysis board's play mode to get an opponent: it is the missing half
  of the live test and the only one that can exercise the clock and the rematch.
- Clip the overlay to the board and derive the cell size from the board rect.
- A live checklist in `docs/` with the exact page states, so the next agent
  repeats the session instead of inventing it.
