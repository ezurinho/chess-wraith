# Changelog

## 1.65.2 — 2026-11-27

A random list of candidates misses the expensive move.

- Measured on 1.65.1, live: one game at 185.8 cp/move and the next at 6.5 with
  the same release and the same account. With ten random legal moves, nothing in
  the list is expensive often enough to pick.
- Half the candidates now come from the moves that leave material loose, the
  other half at random. The engine still prices all ten and picks.

## 1.65.1 — 2026-11-27

Aim above the band, because the opponent declines.

- Measured on 1.65.0, live: 185.8 cp/move against 293, with four improvised moves
  that cost 0 in the end. A candidate priced at 293 by a depth-10 search is often
  not taken by the opponent, so the realised loss is smaller than the price.
- The candidate is chosen to be priced at 1.6x the band. The price is still what
  the panel reports, not the band.

## 1.65.0 — 2026-11-27

The improvised move is priced by the engine.

- Measured on 1.64.0, live, at a 133 account: 66.5 cp/move against a 293 band.
  A static taste can only pick among the moves it can judge, and the ones that
  hang material are rare; the opponent does not always take them.
- An improvised move now gets one restricted search over ten legal moves at low
  depth. The engine prices each candidate and the one nearest the band is played.
  The panel's loss is that price, not the band.
- `searchmoves` accepts a list: one line per candidate, up to ten. A single move
  still forces MultiPV 1.
- Mate in one is still refused, and the price is thrown away if the board moved
  while the engine was answering.

## 1.64.1 — 2026-11-27

The review is the release note.

- `docs/review.md` rewritten for 1.64.0: the three measurement defects the live
  sessions found, the strength table (133 asks 270–320 cp/move, 66.5 delivered),
  the competitor table, and the next release named.
- No code change.

## 1.64.0 — 2026-11-27

A click can move a piece I did not ask for.

- The live game of 1.63.3 lost black's a8 rook out of the position: the click
  selected the wrong piece, the board moved it, the grid changed, and `playMove`
  called that a success because it only compared "changed" with "not changed".
- The landed position is now compared with the position the rules say that move
  produces (`generateLegalMoves` → `nextState.grid`). A different move is
  reported as such and is not counted as played.

## 1.63.3 — 2026-11-27

A hanging move is chosen, not weighed.

- Measured on 1.63.2, live, at a 133 account: five improvised moves in ten and
  6 cp/move. Weighting the hanging move at 2.5 per point was not enough — a free
  pawn capture weighs more, and most moves leave nothing hanging at all, so the
  pool fell back to good moves.
- When the pool has a move that leaves material on a covered square, that move is
  picked. Otherwise the old weighting stands.

## 1.63.2 — 2026-11-27

The improvised move hung nothing.

- Measured on 1.63.1, live, at a 133 account: ten moves, three of them
  improvised, 40 cp/move against a 293 band. The capture-first weighting was
  the problem — taking a free piece is a good move, so the "beginner" played
  well and the band was never reachable.
- `hangingAfter` reads the board after each candidate: the worst of the account's
  pieces the opponent attacks and nobody defends. `beginnerWeight` adds 2.5 per
  point, so leaving the queen on a covered square outweighs a pawn capture. That
  is the shape of a 133's move: material first, then the piece back.
- `isSquareAttacked` is exported for it.

## 1.63.1 — 2026-11-27

The loss of an improvised move was the target, not a measurement.

- `chooseMove` returned `cpLoss: target` for an improvised move, so the panel's
  loss/move mixed real search drops with a constant. The live game on 1.63.0:
  eleven of twenty samples were exactly 293 cp, the number the script wanted,
  not the number it played.
- An improvised move's loss is measured after the fact now: the eval of the
  position after the move (`whiteCp`) against the one the script chose from, with
  a ply guard so a stale pairing is dropped instead of counted. The arithmetic is
  `myLossFromWhiteCp`, tested from both sides.
- A move that improves is not a loss, and one move is capped at 600 cp.

## 1.63.0 — 2026-11-27

The beginner model could never run.

- Neither chooser call site passed `accountElo`, and `styleProfile` takes the
  level from that option only. `levelPlayTarget` therefore saw the target setting
  (1500 or the account's own number) and returned 0 for every account, so the
  band and the improvisation added in 1.60 and 1.61 were unreachable in the real
  script. Measured live on chess.com's board before the fix: a 133 account
  delivered 11.5 cp/move against a 293 band.
- Both call sites pass `accountRatingNow() || state.boardRating` now.
- The improvisation rate is solved instead of guessed: the best line costs ~8 cp
  and an improvised move ~490, so `p = (target - 8) / 480`, clamped at 0.5.
  At 1245 that is one move in eight; at 133, one in two.

## 1.62.0 — 2026-11-27

A review with the live board behind it.

- New `docs/review.md`: grade per area, the comparison with A.C.A.S., chesshook
  and Game Review, and the primary sources (Stockfish 1320–3190, chess.com's
  closure numbers and the sentence about analysing games in progress).
- The review records what the live run proved — quiet move, castling, en passant
  and promotion through real pointer events — and what it broke: the arrows.

## 1.61.2 — 2026-11-27

The board arrows never drew.

- `refreshPanel` passed `state.snapshot.boardEl`, which does not exist: `state`
  owns the board element, the snapshot never did. `paintBoardOverlay` returned on
  its first line, so the arrows shipped in 1.58.0 have never appeared on a real
  page. Both call sites pass `state.boardEl` now.
- The boot test asserts the arrow elements exist once the engine answers, so the
  module cannot be wired to nothing again.
- Found by driving the shipped bundle on chess.com's real analysis board with
  `?cw=1` and the real wasm engine: the script played Nf3 and Ne5 through real
  pointer events and verified them; the overlay was the one thing missing.

## 1.61.1 — 2026-11-27

Debug hooks for the one path tests cannot reach.

- `?cw=1` exposes `__cw.snapshot()`, `__cw.playMove(uci)` and `__cw.analyze()`,
  so the click geometry and the move verification can be exercised on a real
  chess.com board instead of only in jsdom. No user-visible change.

## 1.61.0 — 2026-11-27

Bad moves that look like a beginner, not like a dice roll.

- The improvised move was a uniform draw over the legal moves. That is not how a
  133 plays: it walks the king into the open and ignores a free queen, which is
  the one way the account's moves could still look like a machine. It is weighted
  now — material first, then checks, then castling, with king moves cut to 15%
  and an early queen halved — so the miss is a human miss.
- The chooser learns what the move does (`capture`, `check`, `castle`, `piece`)
  from the board in `90-boot.js`; the taste stays in `60-analysis.js` and is
  testable on its own.

## 1.60.1 — 2026-11-27

The card's rating stops lying about beginners.

- `performanceFromAcpl` was a different fit from `acplBand`, floored at 1050:
  a game the account played at its own 293 cp/move came back as `like 1093`,
  the exact number the feature exists to avoid. It is the inverse of the band
  now: 293 cp is 135 again, and `acplBand(133)` round-trips within a few points.
- The opponent estimate carried the same formula copied inline; both sites call
  the one function, so the card and the panel cannot disagree.

## 1.60.0 — 2026-11-27

Beginner moves, not a beginner-shaped re-weighting.

- Measured what level play actually delivered instead of assuming: the chooser over
  the four MultiPV lines averaged 43 cp/move against a 293 target. The four best
  moves are all good, so the bell around the target was flat and the pick was a
  coin toss between near-best moves.
- Below the floor the search now returns ten lines (157 cp/move measured on the
  same harness) and four moves in ten are improvised uniformly from the legal
  moves, the way a beginner's are. The delivered loss lands near the account's
  band instead of near the engine's.
- An improvised move that hands over mate in one is swapped for the engine's own,
  so the promise survives the improvisation.
- The band caption read `accuracy 19 cp` for what is a loss per move; it says
  `loss/move`.

## 1.59.0 — 2026-11-26

Play at your level, not at the engine's floor.

- `acplBand` is two curves joined at Stockfish's 1320 floor: a 133 account is
  expected to lose ~293 cp a move, a 1320 account ~57. The panel's `Playing at`
  row now says `133 · your level` instead of `1320 · floor`.
- `chooseMove` aims at that loss rate when the account is under the floor: the
  weight is centred on the target instead of on 0, so the account plays moves of
  its own size rather than the fourth-best move every time. `Level play` in Tune
  turns it off; above 1320 it is a no-op. Forced mate is still taken, and a move
  that walks into a forced mate is still rejected.
- Slack follows the target (up to 720 cp), so MultiPV 4 can actually contain the
  moves the account is supposed to play.

## 1.58.0 — 2026-11-26

The engine's move, on the board.

- `src/45-overlay.js` draws the top line as a green arrow from square to square
  and the opponent's best answer as a thinner red one, inside the board element
  (`viewBox="0 0 8 8"`, `pointer-events: none`, no innerHTML).
- It follows the board's flip, keeps one SVG per board, skips a repaint when the
  move has not changed, clears on a new game and on a turn it cannot read.
- `Board arrows` in Tune turns it off; the default is on.
- `docs/review.md`: a graded review (7.6/10) with the eight weakest points,
  including the unexplained `gameOverSeen` flake under load.
- `docs/research.md`: what the 2026 public scripts actually ship (Complete Move
  Guide, Chess.com Bot 7.1, chess-sniper, Chessvision, Game Review) and the one
  thing none of them does — anchor the engine to the account's own rating.

## 1.57.0 — 2026-11-26

A Stats tab: the shape of the night, not one card.

- `pushReport` keeps the last twenty games per account in localStorage, one
  entry per game even if the same result screen is scanned twice.
- `reportSummary` gives the record, win rate, both sides' average loss per move,
  the rating that play looks like and the best game — and skips missing samples
  instead of averaging zeros.
- New rail tab **Stats**: one bar per game in the last twelve (height is the
  inverse of the loss, colour is the result), plus the six numbers above.
- The tab is rebuilt only when the sequence changes, so the 2 s render cannot
  make the bars flicker.

## 1.56.0 — 2026-11-26

The panel now says how the game went, with the same numbers it played by.

- `gameReport` (new fragment `src/62-report.js`) turns the loss of every chosen
  move and the swing of every opponent move into one card: result, moves, both
  sides' centipawn loss per move, the rating that play looks like, and the gap to
  the account. Under five assessed moves it reports the result and no average.
- The card lives in the Info tab, is stored per account and survives a reload.
  The copy-report text carries it too, so a bug report includes the last game.
- `performanceFromAcpl` is the inverse of the opponent estimate, so `like 2288`
  on the card and `~2086` on the rival row cannot be two different curves.
- `Your accuracy` is now `Loss / move`: it always showed centipawns, never a
  percentage, and the label was the only thing claiming otherwise.

## 1.55.1 — 2026-11-26

The ratings on the panel are the ones on the board.

- `ratingNumber` accepts ratings from 100, not 250. A 133 account and a 113
  opponent were both discarded as fragments, which is why the panel said
  `anonymous` while the rows under the board had the numbers.
- `readBoardRatings` no longer needs one of four container classes: it finds the
  two ratings wherever they live and assigns top/bottom from the row class, the
  board geometry, or document order. `readMyRating` is the signed-in player's.
- The anchor now falls back to your own row (`133 · page`) before the 1500
  default, so `Playing at` shows `1245 · floor` instead of `1525`.
- A real opponent rating wins over the ACPL estimate in the target, the move
  choice and the panel. `~2086` was an estimate shown in place of a known 113.

## 1.55.0 — 2026-11-26

The run does not end by itself any more.

- `alwaysAuto` is on by default. It turns auto-play, rematch and the keep-alive on at
  boot, so opening a game is enough: no click, no `Alt+Shift+A`, no second tab kept
  open by hand.
- The session cap is a rollover, not a stop. When 15 games or 3 hours trip, the run
  closes and the next one opens with the same settings; the history says
  `session limit: 15 games · rolled over` instead of the panel going quiet.
- Tune has an Always auto switch. Turning it on restores the three settings; turning
  them off one by one still works, and the per-account settings survive a reload.
- `sessionLimit` takes `rollover` and its verdict always carries the flag. Three tests
  cover the rollover, the plain stop and the default.

## 1.54.2 — 2026-11-26

The report shows the hour the account usually plays.

- `report()` adds `usual hour N` to the pace line when the archive had at least
  three games in that hour. The data was collected in 1.54.1 and had no reader.

## 1.54.1 — 2026-11-26

The profile learns when the account plays.

- `paceFromGames` now returns a 24-hour histogram and the busiest hour of the
  archive it already reads (three games in an hour before it trusts one). Same read,
  no extra request; nothing acts on it yet.

## 1.54.0 — 2026-11-26

The account's rhythm has phases.

- `paceFromGames` now keeps the median of the account's own moves in three buckets:
  their first 8 moves, moves 9-30, and everything after. Thirty moves still buy a
  whole profile; twelve buy a phase.
- `paceBaseline(ply)` prefers the phase median, so a slow middlegame and a quick
  opening are both the account's, not an average of the two.

## 1.53.0 — 2026-11-26

Move times are right-skewed, like a person's.

- With a pace baseline the delay was drawn symmetrically around the median, which
  never produces the occasional long think. It now samples an empirical shape
  (0.55x to 1.95x, mostly near 1x) with a real tail, inside the same 0.65x-1.5x band.

## 1.52.3 — 2026-11-26

The probe request exists once.

- `probeRequest(fen, uciMoves, uci)` owns the restricted-search shape — MultiPV 1,
  depth cap, `searchmoves`, budget — for both the timer and the play button. That
  shape is what drifted in 1.52.0; one copy is left.

## 1.52.2 — 2026-11-26

One probe budget, one place.

- The restricted-search budget existed as two copies of the same formula, one per
  caller, and the second copy drifted in 1.52.0. `probeBudgetMs()` now owns it and
  both the timer and the button call it.

## 1.52.1 — 2026-11-26

The button's probe obeys the same budget as the timer's.

- 1.52.0 gave `playNow` a fixed `min(400, cfg.moveTimeMs)` probe, which on a short
  clock let the manual path think longer than the auto path. Both now use
  `min(400, cfg.moveTimeMs, max(180, 0.6 x searchBudget))`.

## 1.52.0 — 2026-11-26

The play button plays the account's move too.

- `playNow` (the panel button and the debug API) only reordered candidates; it
  never asked the engine about the move the account actually plays. It now runs the
  same restricted search the timer runs, re-checks the position after the await, and
  falls back to the old path when the position moved on.
- It became `async`; every caller already ignored its return value.

## 1.51.6 — 2026-11-26

`probe N` counts the probes that actually judged a move.

- The counter went up when the restricted search answered, even if the position
  had moved on or the move was already a candidate. It now increments only when the
  line reaches the decision, so the report means "N of my moves were judged".

## 1.51.5 — 2026-11-26

The probe count belongs to the account that earned it.

- Switching accounts in one tab keeps its own settings, history and now its own
  probe counter: `probes`, `probeLine` and `probedKey` reset in
  `adoptAccountSettings`, so the report never adds one login's probes to another's
  repertoire line.

## 1.51.4 — 2026-11-26

The probe never outlasts the search the user chose.

- The 180 ms floor could exceed `cfg.moveTimeMs` when that was set below it, so the
  subsidary search ran longer than the main one. The budget is now
  `min(400, cfg.moveTimeMs, max(180, 0.6 x searchBudget))` ms with an 80 ms floor.

## 1.51.3 — 2026-11-26

The probe's budget follows the clock.

- The restricted search used a fixed 400 ms, which is a rapid budget: on 1+0 it
  spent most of the move's search on a move the account plays without thinking.
  It is now `min(400, max(180, 0.6 x searchBudget))` ms.

## 1.51.2 — 2026-11-26

The report says whether the repertoire was really consulted.

- `report()` adds `probe N` next to the repertoire line: the count of restricted
  searches that answered this session, the only visible sign that the account's own
  move was judged instead of merely reordered.
- 194 tests.

## 1.51.1 — 2026-11-26

A long session keeps reading the archive instead of the hour it booted.

- The shared archive read now lives 15 minutes (`ARCHIVE_TTL_MS`), so the
  repertoire follows the account through a long AFK session instead of freezing at
  the first read. Measured: two reads inside the window cost one request, a read
  after 16 minutes costs another.
- 194 tests.

## 1.51.0 — 2026-11-26

One archive read feeds both the pace and the openings.

- The pace profile and the repertoire both read `pub/player/<user>/games/<month>`;
  they now share one request per month instead of two, and a failed read is not
  cached. Measured: the repertoire adds zero requests on top of the pace read.
- A manual refresh still clears that account's cached reads.
- 193 tests.

## 1.50.0 — 2026-11-26

The probe's thinking counts as thinking, and a stale result never gets a move.

- The opening probe's 70–400 ms is now subtracted from the pace delay (`spentMs`),
  so a move with a probe takes the same wall-clock time as one without it.
- `scheduleAutoMove` refuses a result whose `fen` no longer matches the board: the
  probe re-enters it a moment later, and a move computed for one position is never
  armed for another.
- 192 tests.

## 1.49.0 — 2026-11-26

The account's own move gets its own search, so the repertoire can be played.

- `searchmoves`: the engine can now be asked about one move (`go depth 12 movetime
  400 searchmoves g1e2`, MultiPV forced to 1).
- When the tree's top move has a share of 0.6 or more and the main search never
  offered it, auto-play runs that restricted search and merges the answer as a
  candidate flagged `opening`, once per position.
- That candidate is allowed `slack + 70` cp and a 3× wider eval spread: in the
  opening the evidence is the account's record, not the eval. A probed move that
  loses more than that is never played.
- Shares are no longer compressed: `0.02 + share` instead of `0.2 + 4.5 * share`,
  so a 60-of-60 habit is now a 95 % pick (was 89 %) and a 60/40 habit is 60/40.
- 191 tests.

## 1.48.0 — 2026-11-26

The openings come from the whole tree, not just the first move.

- `repertoireFromGames` also builds a tree of the account's opening plies (the
  last 60 games, 8 plies, a node needs two games), keyed by the SAN moves that
  lead to the position; the picker follows the deepest node it has and falls back
  to the next one up when a line is unknown.
- Measured on a 167-game account: 117 nodes, six of them two plies in. After
  1.e4 e5 it plays 2.Ne2 in 9 of 9 games; after 1.e4 e5 2.Nf3 it answers 2...d6
  in 9 of 9. An engine never picks 2.Ne2 — that is the point.
- The repertoire now applies at every opening ply (`ply < 8`), not only the first.
- A PGN's `Nf3+` and an engine's `Nf3+` are the same move: `sanKey` strips the
  suffix on both sides, so a check never silently drops into the engine's line.
- Limit, stated once: the tree reweights the engine's candidates; a signature
  move the search never considered is not forced (MultiPV 4).
- 187 tests.

## 1.47.0 — 2026-11-26

Black's repertoire is keyed by the move it answers, and it loads without a clock.

- Measured on a real 1631-blitz account (167 games): vs 1.e4 e5 93 %, vs 1.d4 d5
  89 %, while the marginal table says e5 56 %, d5 32 % — the average would answer
  1.d4 with a move that player never played against it.
- `blackByFirst` keys black's shares by the white first move in UCI; a first move
  faced fewer than twice is left to the engine, never to the average.
- `syncRepertoire` reads the same archive for the openings only, so bot games and
  the analysis board (no clock, no time class) get the repertoire too: one request
  per account per six hours, cached, with a 20-minute backoff on an empty month.
- The report shows the conditioned table: `repertoire w e4 100% · b vs e4 e5 93% ·
  d4 d5 89% (60 games)`.
- 186 tests.

## 1.46.0 — 2026-11-26

The opening comes from the account's own games, not from a dice roll.

- Measured: four near-equal lines gave 26 %/26 %/26 %/23 % over 400 draws, and
  the anti-repeat rule pushed the repeated first move down to **12 %** — less
  human than repeating it.
- `repertoireFromGames()` counts the first move of the last 60 games per colour
  from the archive the pace reader already downloads; no extra request. Real
  archive check (hikaru, 2026/11, 486 games): white e4 39 %, c4 39 %, d4 18 %.
- `chooseMove` weights candidates by those shares, so the script plays the
  account's repertoire with the engine's eval as a tie-breaker. The anti-repeat
  rule stands down for a move with share ≥ 0.3.
- The report prints the repertoire it read: `repertoire w e4 75% · d4 25% · b c5
  100% (9 games)`.
- 182 tests.

## 1.45.0 — 2026-11-26

The engine is named by the engine, not by a constant.

- Asked over UCI, the shipped worker answers `id name Stockfish 19 Lite WASM`;
  the panel printed a hardcoded `Stockfish 19 NNUE`. The family was right, the
  build was not, and a different tag would have been mislabelled silently.
- `engineLabel()` parses the `id name` line at handshake; the panel and the
  report follow it. The 2019 JS fallback keeps its own name.
- 178 tests.

## 1.44.0 — 2026-11-26

The delay is the whole interval, so the search is no longer paid for twice.

- The move was armed with the full delay *after* the engine answered: a 700 ms
  search against a 700 ms bullet median made the real interval 1.4 s, and 28 s
  of clock over a 40-move game. `visibleDelayMs()` now waits only what is left of
  the target, with a 120 ms floor.
- The report prints `last delay … · search …` so the interval can be checked
  instead of assumed.
- 177 tests.

## 1.43.0 — 2026-11-26

The depth cap follows the account, so a strong account is not played at a 1500
account's depth.

- Measured: at depth 14 the engine stops after **121 ms** of a 700 ms budget
  (218 ms of 3000) and answers `g8f6` on an Italian middlegame; with the cap at
  22 the same budget reaches depth 16 and answers `f8c5`. The cap, not the clock,
  was deciding the move.
- `depthForAccount()` adds one ply per 100 points above 1500, clamped to the
  engine's 22. A 1425 account keeps the old 14 and costs nothing; a 2200 one gets
  21. The report prints `depth 14->21` when the cap is raised.
- 176 tests.

## 1.42.0 — 2026-11-26

The bug report carries the anchor chain, and the page costs 1.8 ms.

- `copy report` now prints `rating … · rival … · form … · effective … (source)`.
  "effective 1374" was unverifiable without the numbers it was anchored to.
- New research section with three measurements: a scan is 1.8 ms on a real
  game page, 1.41.0 boots clean on `/analysis` and `/play/online` with no
  uncaught error, and the opening picker spreads over four moves (23-26 % each)
  while the repeated move drops to 12 %.
- 175 tests.

## 1.41.0 — 2026-11-26

The rival's rating lands in the anchor in the same scan, and the comparison is
now read from the competitors' source.

- `resolveElo()` used to wait for the next game or for the opponent's first
  measured loss; the anchor is now resolved in the scan that learns the rating.
  The end state was already right (an integration test pins it at 1425 for a
  1500 default against a 1000 opponent), but the script no longer depends on a
  second, indirect path to get there.
- New research section with the five public scripts read from source, dated:
  one of them computes the move on a remote server and none of them reads the
  account's rating.
- 174 tests.

## 1.40.1 — 2026-11-26

The rating floor is 250, not 400.

- Chess.com's cheapest bot is 250 and a club player can be 300; the old floor
  threw those away. The 3–4 digit regex plus the player-container scope already
  reject clocks and usernames, so the floor only has to reject fragments.
- 173 tests: the measured vs-computer markup reads `(300)` as 300.

## 1.40.0 — 2026-11-26

The opponent's rating is read where chess.com actually keeps it.

- Measured on two real pages: `.user-tagline-rating` and
  `[data-cy="user-tagline-rating"]` do not exist (0 nodes), while the live
  layouts expose the rating as `[data-user-block-part="rating"]` or a
  `cc-user-rating-*` class inside `.player-top` / `.player-row-top`. The reader
  walks the opponent's player container, tries all three names, and only then
  accepts a lone numeric tag there.
- It still returns `null` when the page hides ratings: an unknown opponent must
  not become a 1500 guess in the strength calculation.
- 173 tests, including the measured vs-computer markup and a page with a clock
  and no rating.

## 1.39.1 — 2026-11-26

The strength exists before the first search.

- `state.effectiveElo` was resolved only inside the rating callbacks, so a
  signed-out tab or a blocked profile request left it `null` and the search fell
  back to `cfg.targetElo` (0), which the engine clamps to 1320 — the panel
  documented 1500. It is now resolved at boot and on every settings change.
- A manual target typed into the panel applies immediately, not after the next
  rating fetch.
- 171 tests: the signed-out boot removes the navbar name, makes the stats
  endpoint answer 404, and asserts 1500.

## 1.39.0 — 2026-11-26

The strength stays the account's while the night moves the account.

- Form: each game asks for a deterministic ±30 point offset keyed by the
  account and the game number, inside the existing `-75/+25` envelope. One
  strength for a whole session is a fingerprint; a player has good and bad days.
- The profile rating used to be cached for six hours and never refreshed while
  the tab was open, so a session was played at the rating the account had at
  boot. It is now re-read at game boundaries after three games and twenty
  minutes (`ratingRefreshDue`), and the panel says when it was last measured.
- 170 tests, including the envelope at the boot level: a 1480 account is never
  asked to play above 1505.

## 1.38.0 — 2026-11-25

The score no longer depends on a move list that the page does not render.

- The archived game page has no move list in the light DOM (nine selectors,
  all zero), so `plyCount` is `null` there and the "fewer than two plies"
  guard never ran. The stale-dialog guard now leads with the board: a finished
  game is never sitting on the starting position, and an aborted game is not
  scored, so that placement cannot be counted.
- The score fixtures now start from a position two plies in, because a start
  position under a finished dialog is a state the site never produces.

## 1.37.0 — 2026-11-25

Playing as Black is no longer treated as playing as White.

- The tracker parses `flipped` and `plyCount` from the DOM but its snapshot
  returns the position only, so `mySide(state.snapshot.flipped)` answered
  "white" for every game. The snapshot the scan loop keeps now carries both,
  which fixes the side-aware clock, the `onlyMyTurn` gate for Black, and the
  session score: a "Black Won" dialog in a game you played as Black counts as
  a win instead of a loss.
- 167 tests, including one that flips the board and reads the dialog; it fails
  by name if the view facts are dropped again.

## 1.36.0 — 2026-11-25

Game-over detection now matches the page it runs on.

- Every game-over selector in this repo was invented: on a real finished game
  `.game-over-modal`, `.game-over-modal-content`, `.game-over-header-component`
  and `.game-review-buttons` are all absent. The real dialog is
  `.game-over-modal-shell-container` > `.board-modal-component` >
  `.game-over-modal-header-component`. Detection, rematch and the session score
  had been looking for classes the site does not use; the old names stay as a
  fallback.
- The real title names the colour ("Black Won"), not the player, so the parser
  resolves white/black against the side you are playing — which also makes a
  signed-out tab able to score a draw.
- `textContent` glues every sibling block ("tester wonby checkmate"), not just
  capitalised ones. The dialog text now prefers `innerText`, with a leaf-walk
  fallback for engines that do not have it.
- `isGameOverDom()` treats an element inside a fixed overlay as shown; a
  `position: relative` header inside a fixed modal used to read as hidden.
- 166 tests, and the session test now uses the real markup class for class.

## 1.35.0 — 2026-11-25

The session score no longer trusts a name it can see anywhere in the dialog.

- 1.34.0 asked whether the account's name appeared in the game-over dialog.
  Both players do — the player rows list both names and both ratings — so the
  loser's own name made a loss read as a win. The result is now decided by the
  word attached to `won`/`lost`, which is the only token in that text that
  means anything.
- A dialog can outlive its game by a second after a rematch. A game with fewer
  than two plies on the board is not the game the dialog is about, so it is not
  counted; chess.com never scores a game that young.
- 165 tests.

## 1.34.0 — 2026-11-25

The panel can tell you how the night went.

- The session now keeps a score. It is read from the game-over dialog, which
  names the winner ("you won", "<name> won", "Draw"), and it is shown next to
  the session clock as `w-l-d`.
- Persisted with the session, so a reload keeps the tally, and a name the script
  does not recognise is `null` instead of a guess.
- Fixed while testing it: `resumeSessionState()` is called twice (boot, then a
  late account name) and the second call overwrote a score already counted with
  the stored one. It now only takes the stored results when the session resumed.
- Fixed with it: `textContent` glues the dialog header to the Rematch button
  ("tester wonRematch"), which made the first parser miss every real dialog.
- 163 tests.

## 1.33.0 — 2026-11-25

The retry now covers the ways the engine dies quietly.

- 1.32.0 only retried a fetch that threw. A worker that spawned and never said
  `uciok` got one warning and stayed dead; a crash cluster past its second
  rebuild returned early into the same silence; the NNUE fallback's
  fire-and-forget spawns swallowed their failures.
- All three route to the same backoff (5 s, 20 s, 60 s, then 5 min). A `readyok`
  resets the ladder whichever path brought the engine back.
- 159 tests, including the mute worker and the exhausted crash cluster.

## 1.32.0 — 2026-11-25

Offline at boot is no longer permanent.

- Boot happened once. If both the NNUE fetch and the JS fallback threw — a
  laptop waking from sleep, a CDN edge without the new tag, a captive portal —
  the engine stayed `offline` until the tab was reloaded, with AFK armed and
  nothing playing.
- The engine now retries on a backoff: 5 s, 20 s, 60 s, then every 5 minutes,
  and a `readyok` resets the ladder. The panel's warning line says which attempt
  and when the next one is.
- Fixed underneath it: `rememberNnueSkip()` was writing a seven-day verdict on
  *any* NNUE failure, `TypeError: Failed to fetch` included. One bad minute of
  Wi-Fi downgraded every load for a week to the 2019 build. The skip is now
  written only when the failure is not a network error (5xx counts as network, a
  404 does not).
- 157 tests: the backoff, the network-vs-build distinction, and the 404 case.

## 1.31.0 — 2026-11-25

A key that stops the session, not just the panel.

- `Alt+Shift+H` hides the panel by setting `display:none`. Nothing in the play
  loop reads that flag, so a hidden panel kept playing: the one gesture that looks
  like stopping did not stop anything.
- `Alt+Shift+S` is a panic stop: auto-play off, `autoPlayOnLoad` off, AFK off,
  search cancelled, move and rematch timers cleared, panel hidden, and a
  `panic stop` line in the per-account history so the state is legible later.
- The panel's key list and the README table both carry it.
- 154 tests: a jsdom test turns auto-play and AFK on, sends the key, and asserts
  all four effects.

## 1.30.0 — 2026-11-25

The docs prove their numbers.

Twice in two days the test count printed in `AGENTS.md` and in the research
table described a suite that no longer existed, and nothing failed — including
the release check. A stale count is small, but it is the kind of small that
teaches people to stop reading the docs.

- `tests/unit/docs.test.js` counts the `test(` declarations in `tests/unit/`,
  counts the files, and fails when `AGENTS.md` or `docs/research.md` disagree.
  Add a test without updating the docs and the suite says so by name.
- The two documents were rewritten to the current numbers (153 tests, 22 files).
- 1.29.0's `bundle.test.js` entry is unchanged; this only guards the claims
  around it.

## 1.29.0 — 2026-11-25

The artifact is tested, not just the source.

- Every boot test read `src/`. The file people install is
  `chess-wraith.user.js`, built by a manual `MODULES` order in
  `tools/build.js`; a fragment dropped from that list kept every unit test green
  and shipped a script that throws on load.
- `bundle.test.js` now boots the committed bundle in jsdom — chess.com-shaped
  board, protocol-level fake worker, stubbed public API and storage — and runs
  the script's own `selftest`: engine up, board read as the start position, 11
  checks green. It sits next to the five static checks that were already there.
- `tests/unit/harness.js` holds the page, the fake worker and the timer tracking
  so the fragments test and the bundle test cannot drift apart.
- While adding it I overwrote the existing `bundle.test.js` instead of extending
  it; the test count (150 → 146) is what caught it. The five checks are back,
  byte for byte, with the boot test appended.
- 151 tests, 22 files.

## 1.28.0 — 2026-11-25

A limit that resets itself is not a limit.

- `gamesPlayed` and `sessionStart` lived in memory, so every page load handed
  the account a fresh allowance. A Tampermonkey update accepted at 03:00, or a
  discarded tab the browser restored, silently moved `9 of 15` back to `1 of
  15` — the safety valve the user set was advisory.
- The run is now stored per account (`chess-wraith-session-v1:<user>`) and
  resumed on boot while it is still the same run: inside `sessionMaxMs`, with a
  start time that is not in the future. Anything else starts fresh.
- Turning auto play off clears it; so does the limit firing. A resumed run
  writes a `resumed:` line into the history, which is how you see that the
  counter came back.
- The AFK toggle now starts the clock on a new run instead of continuing the
  old counters.
- 150 tests: the resume rules (fresh, kept, stale, clock skew, junk) and a boot
  that restores six games and the original start time.

## 1.27.0 — 2026-11-25

The night outlives the tab.

- The panel history from 1.26.0 lived in memory only. A Tampermonkey update, a
  discarded tab or a chess.com navigation started the script again and wiped
  the only record of why it stopped — which is the exact moment you want it.
- The five entries are now written per account
  (`chess-wraith-history-v1:<user>`), restored on boot and when a late account
  name is adopted, and cleared once the list is empty.
- Read back through a filter and a cap: a hand-edited storage value cannot
  paint two hundred lines into a 322 px panel.
- Lines from another day carry `DD/MM` (`24/11 23:40`); today's keep `HH:MM`,
  so a night that crosses midnight is not misread as twenty minutes.
- 148 tests: the date label, the per-account restore, and the epoch line.

## 1.26.0 — 2026-11-25

A tab you left alone can say what happened.

- `state.warn` was a single line: the newest reason overwrote the one before it,
  so coming back to "paused" never said whether it stopped at 01:12 or 05:40.
- The panel now keeps the last five transitions with an `HH:MM` — session limit,
  AFK stopped, rematch declined, manual move suspected, rematch pressed, game
  over with auto-play off — and shows the newest two under the foot. The
  tooltip carries all five.
- The bug report gained a `history` line with the same entries.
- `pushEvent` collapses consecutive repeats and caps the list, so a retry loop
  cannot flush the history it is meant to explain.
- 146 tests: the cap, the repeat collapse, the blank line, the 24-hour clock,
  and the AFK rematch press showing up in the history end to end.

## 1.25.0 — 2026-11-25

The bench that starts the script.

Every other test loaded a slice. Boot was never run outside a browser, so the
one failure that ends a session first — the script throwing on page load — had
no test at all.

- `tests/unit/session.test.js` loads all twelve fragments into jsdom and lets
  boot run against chess.com-shaped markup, a protocol-level fake worker
  (`uci`/`uciok`, `isready`/`readyok`, one `info` + `bestmove`) and a stubbed
  account API.
- Three cases: boot reads the start position and brings the engine up; the
  engine answer reaches `state.analysis`; and a finished game with AFK on
  presses Rematch once, without a human.
- Timers are tracked and the page is closed in a `finally`, so the suite still
  exits on its own.
- 144 tests, 21 files.

## 1.24.0 — 2026-11-25

Promotion does not spend a low clock waiting.

- The promotion poll was a fixed eight looks at 120 ms: up to 840 ms between
  the drop and the piece choice. With 1:30 on the clock that is nothing; with
  two seconds it is the game.
- `promotionPollPlan(clockSeconds)` scales it: below 8 s the pauses drop to 40 ms
  and the budget is a third of the clock (`1 s` → 4 looks over 160 ms), above it
  the old patience is unchanged.
- The bug report now carries the clock, the last move delay and the search
  budget, so a "it stopped" report says whether the clock was the cause.
- Docs: the test table said 106 tests in 14 files; it is 20 files and 141 tests.

## 1.23.0 — 2026-11-25

Say when the engine cannot be as weak as the account.

- `UCI_Elo` bottoms out at 1320 upstream (`LowestElo` in `src/search.h`). Every
  account under that was aimed at a number the engine silently ignored: a
  900-rated player was told `900` and got 1320.
- The panel now marks the clamp: `1320 · floor`, and the tooltip says how far
  under the floor the account is. The report text carries it too.
- Compensation instead of pretence: `floorSlack(elo)` widens the accepted move
  window by a fifth of the gap (capped at 120 cp), so a 900 account picks from
  looser candidates rather than playing 1320 chess with the panel lying about it.
- 140 tests: the clamp at both ends, no slack above the floor, 84 cp at 900,
  the cap at 600, monotone in the gap.

## 1.22.0 — 2026-11-25

Strength anchored to a rating that has games behind it.

- The stats endpoint already returned `record { win, loss, draw }` per class and
  it was being dropped. An account with two rated games was aimed at its rating
  as if it were settled: a lucky 2100 played like a 2100.
- `ratingWeight(games)` follows Glicko-2's `1/sqrt(n)` settling from RD 350 and
  `settledRating(rating, games, prior)` blends the rating with a 1200 prior by
  that weight. Two games at 2100 aim at 1583; twenty aim at 1905; the weight is
  capped at 0.9 so the prior never fully disappears.
- Panel: `· prov` instead of `· acct` under 20 games in the class, with the real
  published number in the tooltip. The games count rides along in the six-hour
  cache, so a reload does not un-shrink it.
- The published rate now also survives a stale cache: the old code only restored
  `ratings` on a fresh entry, so a stale one fell through to the network.
- 140 tests: weight monotonic and capped, two games under the settled value, zero
  games all prior, garbage in null out.

## 1.21.1 — 2026-11-25

Softened 1.21.0's claim. "Worker timers are not batched the same way page timers
are" is folklore: practitioners repeat it, no official document states it, and
the honest position is that the worker is a best-effort wake-up while the lag
check is the guarantee. README and `docs/research.md` now say that, with the
stage schedule Chrome does document.

## 1.21.0 — 2026-11-25

AFK in a hidden tab, which is how AFK actually runs.

- **Chrome batches a hidden tab's timers to about one per minute.** With AFK on,
  `pauseWhenHidden` is off on purpose, so the 2 s scan and the move delay come
  back late while chess.com's clock keeps counting. Nothing in the panel said
  so: it looked like the board had stopped taking moves.
- A 1 s worker ticker now pings the page while the tab is hidden, since worker
  intervals are not batched the same way page timers are. Best effort by
  nature — the browser sets the rules — but it is the only wake-up left when the
  main thread is starved.
- The scan tick measures its own lag. More than 1.8× late (or 2.5 s, whichever
  is bigger) while the tab is hidden sets `state.throttled` and the panel foot
  says `tab hidden · timers batched`. The report text carries it too. Detection
  is exact; the ticker is the mitigation.
- A test for the rule: a minute for a 2 s tick is throttling, 2.4 s is jitter, a
  visible tab is never throttled. 140 tests.

## 1.20.0 — 2026-11-25

Time management that reads the clock instead of the config.

- **The search was bounded by the setting, never by the clock.** `moveTimeMs`
  came from `phaseMoveTime` and the watchdog waited `movetime * 6 + 6000`, so
  with 4 s on the clock the engine could still be thinking after the flag fell.
  `clockBoundMoveTime` caps the search at a fifth of what is left (never above
  the configured value, floor 150 ms) and `searchBudgetMs` now caps the deadline
  at half the clock, so a dead engine is noticed while there is still time to
  click.
- Measured why it matters: 57,340 blitz moves from the public archives, 2.6%
  played with under 5 s left — about one such move per game.
- Three tests for the bounds, including that a healthy clock changes nothing.
  139 tests.

## 1.19.2 — 2026-11-25

Measured the thing 1.19.0 assumed: a destroyed NNUE worker is ready again in
206, 205 and 306 ms on the live analysis page, shim fetch and wasm compile
included. Recovery is cheaper than a stalled search by two orders of magnitude,
and `docs/research.md` now records it.

## 1.19.1 — 2026-11-25

`destroy()` left `ready: true` behind. The next search posted into a null worker
and waited out the whole budget for an answer that could not come — the same
failure the 1.19.0 recovery exists to catch, arriving through the front door.
Found while measuring a rebuild in the browser: `boot()` reported ready in 3 ms,
which is not a wasm compile, it is a lie. Destroy now clears `ready`, `booted`
and the option cache, and a test pins it so a destroyed engine cannot pretend.
136 tests.

## 1.19.0 — 2026-11-25

The engine can now lose a worker and come back inside the same move.

- **A worker that died after booting kept `ready` true.** The UCI handshake had
  said readyok, so `ensureReady` returned immediately and every search after the
  crash waited out the whole budget (6–40 s) before the watchdog noticed. On a
  3-second clock that is the game. `#recover` now kills the worker, drops the
  ready flag, settles whoever was waiting and boots a replacement in the
  background, so the next scan finds a live engine instead of paying a
  handshake mid-move.
- The stall watchdog uses the same path: it stays responsible for unblocking the
  caller, and `#recover` rebuilds instead of leaving `worker: null` for the next
  `ensureReady` to discover.
- Two recoveries per crash cluster, cleared by the next readyok: a worker that
  cannot start at all must not spin.
- Test with the fake worker: kill it after readyok, the engine is not ready any
  more, and a fresh worker is spawned and handshaking. 135 tests.

## 1.18.2 — 2026-11-25

The measurement behind 1.18.1, recorded so the claim does not rest on a hunch:
661 rapid games from the October leaderboard, 521 of them (79%) ended with the
board untouched — 318 resignations, 195 flags, 5 agreed draws, 3 abandonments.
`docs/research.md` now says so, next to the reason it mattered.

## 1.18.1 — 2026-11-25

The rematch never fired after a game that ended on the clock, which is the
normal way a session ends at night.

- **Game over was only read when the position changed.** `runScan` checked
  `scanned.gameOver` inside the `if (changed)` branch. A flag fall or a
  resignation does not move a piece, so the check never ran: the script sat on
  the last position, `gameOverSeen` stayed false, and `queueRematch` — which is
  called from that same branch — was never reached. The modal is now read on
  every scan, before the changed/unchanged split. This is the likeliest reason
  the session "stopped" mid-game in the first place.
- **The 1.18.0 watchdog could fire into a finished game.** It is now gated by
  `autoArmDecision`, which refuses a finished board, and `playNow` refuses too,
  because a timeout leaves the last analysis and the last turn still on screen.
- A jsdom test for the modal itself (visible modal → game over, hidden modal →
  not), and the decision helper is tested case by case. 134 tests.

## 1.18.0 — 2026-11-25

Auto-play could stop mid-game and never say why, and the panel could show no
pace while the moves were paced. The stalls first.

- **A swallowed click ended the session.** `playMove` paused auto-play the first
  time chess.com did not register a move. An ad overlay, a promotion dialog that
  painted late or a board still animating is a *transient*, not a broken board.
  It now re-arms the same analysis up to three times (0.9 s, 1.8 s, 2.7 s) and
  stops on the fourth miss with `the board is not taking moves`.
- **A rejected coordinate returned silently.** When `executeMoveOnBoard` failed,
  `playMove` returned false with no warning, no retry and `state.analysis` still
  set, so the 2 s tick skipped the rescan and the position sat there. Every
  failure path now lands in the retry.
- **Nothing noticed a dead loop.** The 2 s tick also checks: auto-play on, our
  turn, a fresh analysis, no auto timer and no retry timer — then arms the move.
  That is the watchdog for the stall nobody predicted.
- **A takeover takes two scans.** One scan can see the board mid-paint and accuse
  you of moving when the script's own click was late; it now confirms the same
  position twice before pausing. The rule is otherwise unchanged: real clock,
  certain turn, ply advanced, grid not the one we produced.
- **The panel names the pace source.** It showed `–` while a fresh profile was
  paced by its class default, and `learned` even when the learned sample came
  from another time class. `paceAnchorFor` is now the single answer — acct,
  learned, class or none — and the row prints it next to the milliseconds.
- Five tests for `moveRetryPlan`, one for the anchor sources. 132 tests.

## 1.17.0 — 2026-11-25

Pace, third pass: the learned sample was still class-blind, and the rapid number
was finally measured on chess.com instead of borrowed.

- **The learned median was one bucket for every time class.** The published
  median has been per class since it was written, but the locally learned one was
  stored under `chess-wraith-pace-v1:<user>`, so a bullet rhythm learned in
  1-minute games could pace a 10-minute game — the same failure as the double
  scaling fixed in 1.16.0, one layer down. The key now carries the class
  (`…:<user>:bullet`), and a class with no history falls to its class default
  instead of to another class's rhythm. Old samples are left in the old key and
  ignored: forty moves rebuild the profile in one game.
- **Rapid measured, not inherited.** October 2026 rapid leaderboard, top 50, one
  month of games: eight of twelve sampled players had rapid games, 3,000+ moves,
  median of per-player medians **4.3 s** (2.0-13.5 s). The default stays 5.5 s
  for a fresh profile because that sample is the strongest end of the ladder.
  The same dump validated the class boundaries the code uses (60/30 s bullet,
  180/300 s blitz, 600/900 s rapid).
- One test for the new key, and the research note that backs the numbers.
- 129 tests.

## 1.16.1 — 2026-11-25

Wording, not behaviour: 1.16.0 said the three class medians were measured on
chess.com. Bullet and blitz were (328 games from the public archive); rapid was
the Lichess cross-check, because that sample contained no rapid games. The
comment, the README row and the note under 1.16.0 now say which is which.

Also unwrapped the `AGENTS.md` line that had run past the column.

## 1.16.0 — 2026-11-25

Pacing: the account's own rhythm was being scaled twice, and a fresh profile had
no class to stand on.

- **Double scaling.** The published median is fetched per time class, so it is
  already the bullet or rapid number. `computeDelay` then multiplied it by the
  clock (×0.5 under two minutes, ×1.15 from ten) again: a bullet account whose
  own games average 700 ms was played at 350 ms, half its own rhythm — exactly
  the gap a fair-play check compares against the account's history. A
  class-scoped baseline now skips the clock multiplier; the locally learned
  sample, which is class-agnostic, still scales.
- **A fresh profile opened rapid games at blitz speed.** With no published and
  no learned baseline, a 10-minute game used the generic 700–1600 ms window, so
  the first moves came in around 1.4 s. Now the fallback is the class median —
  bullet 0.7 s and blitz 1.6 s measured on chess.com, rapid 5.5 s from the
  Lichess cross-check — and the band sits on it. Daily and unknown classes keep the generic window.
- Six tests: the skipped multiplier, the scaled learned sample, the unchanged
  class scale, the class table and the rapid default. 128 tests.

## 1.15.0 — 2026-11-25

Promotion: the one move that used to be clicked blind.

- After the drop, the script slept 95–175 ms, looked **once** for
  `.promotion-window .promotion-piece` and clicked if it was there. On a slow
  board the dialog is painted later than that; the click went nowhere, the move
  never registered, the opposite-gesture retry dragged the pawn again onto the
  same square and the session ended in a pause. Promotions are rare enough that
  it never showed up in the games that were tested.
- `awaitPromotionPiece` polls eight times, 120 ms apart (~1 s), and the click is
  re-issued once if the dialog is still on screen 220 ms later — cheaper than a
  whole move retry.
- The lookup no longer throws when there is no `document` (tests, workers).
- Five tests for the poll: late dialog, already-open dialog, never-open dialog,
  single attempt, and the selector it builds. 122 tests.

## 1.14.0 — 2026-11-25

AFK: the one path that parked a session on a dialog nobody was going to press.

- **A declined rematch used to end the session silently.** After the click the
  script marked the rematch as tried and never looked again, so when the
  opponent had left, chess.com kept its `Rematch` button on screen forever and
  auto-play sat there. Now, twelve seconds later, it takes the next button the
  dialog offers — `New 5 min` and friends — skipping the one already pressed, up
  to three attempts before it stops out loud (`rematch declined; AFK stopped`).
- **A late dialog is not a miss.** When the game-over modal is not painted at
  the moment the delay expires, it looks three times, four seconds apart, before
  calling it a miss.
- **A stale retry can no longer kill the next game**: `onNewGame` clears the
  armed timer, which otherwise fired mid-game, set `rematchTried` and left the
  following game over without a rematch.
- The debug API gains `rematchButton(skip)`, which is how the picker was
  verified against a synthetic game-over dialog.
- Two tests for the skip list and the retry window. 117 tests.

## 1.13.0 — 2026-11-25

A real engine bug, found while proving the 1.12.0 timings against a bare FEN.

- **An empty move list analysed the starting position.** `#runNow` asked
  `job.uciMoves ? …`, and the field is always an array, so a snapshot with no
  readable move list (a board joined mid-game, a position without history) sent
  `position startpos` and the engine answered for the opening. On the analysed
  endgame FEN it suggested `Nf3`, a move that does not exist there; auto-play
  then clicked, the click did nothing and the session paused. Now the position
  comes from the FEN unless there is at least one move to replay.
- `analyze()` also refuses a request with neither a FEN nor moves instead of
  sending `position fen undefined`.
- Two tests for both branches; the old assertion that encoded `startpos` for an
  empty history was corrected. 115 tests.

## 1.12.0 — 2026-11-25

Review of the search and of the update row.

- **Search time follows the phase.** An opening move does not need the full
  700 ms and the ten-man endgame is where the half-pawn decides the result, so
  the request is scaled by material: 0.85× in the opening (first 16 plies, full
  board), 1.15× at 11–16 men, 1.35× at 10 men or fewer. The watchdog budget is
  derived from the same number, so nothing waits longer than before.
- **`checked` reads like a sentence**: `just now`, `5m ago`, `3h ago`, `3d ago`
  instead of `4320m ago` after a long break.
- The debug API gains `phaseTime(fen, ply)`, which is how the scaling was
  verified against the live build.
- Three tests for the phase scale, the budget bounds and the age text. 113 tests.

## 1.11.0 — 2026-11-25

The update pill now shows up on its own; it used to depend on a timer that a
background tab freezes.

- **Checks happen at the moments that matter**, not only on the six hour timer:
  on boot (four seconds), when the tab becomes visible again, when the window
  regains focus and when the network comes back. `UPDATE_RECHECK_MS` (five
  minutes) keeps those three events from becoming a burst, and a manual click on
  the row still forces a check.
- **The last answer is cached** in `chess-wraith-update-v1`, so opening the panel
  after a reload shows `UPDATE vX.Y.Z` immediately instead of four seconds later.
- A throttled check used to have no return value at all; it now reports that it
  skipped, which is what the live verification reads.
- One test for the throttle window (`updateCheckDue`). 110 tests.

## 1.10.0 — 2026-11-25

Review of the input path: one real failure mode, one timing assumption.

- **The move retry always clicked.** Chess.com has a Move Method setting (drag,
  click or both), so an account set to drag-only loses every click: the first
  attempt had a 35 % chance of being a click, and when it failed the retry
  clicked again. Now the first gesture is chosen as before and the retry uses
  the other one, which is what makes drag-only and click-only accounts work.
- **The board was checked once.** A board that paints 400 ms late was read as a
  failed move and got retried, which is the one path where a second gesture
  could be sent to a board that already moved. It now looks twice before
  calling the move lost.
- `tests/unit/input.test.js`: square geometry (both orientations, jitter staying
  inside its own 100 px cell), a board too small to click returning nothing, and
  the retry invariant. 109 tests.

## 1.9.1 — 2026-11-25

- `docs/research.md`: the PubAPI rate-limit rule quoted, and why the pace fetch is
  serial (two requests, six-hour cache, twenty-minute backoff on `429`).

## 1.9.0 — 2026-11-25

Three checks that can only fail on a real page, and two pace bugs found by
asking what the cache was actually doing.

- **`selftest()` now covers eleven checks**, not eight: the `%clk` parser is run
  against the exact token shape chess.com writes (a silent break would leave the
  delay on a fixed window), the delay is asserted inside 250–9000 ms for the
  current settings, and the settings key is checked to be the scoped one. That
  is the part of the script a unit test cannot see.
- **The 20 minute archive backoff never worked**: an error entry is written
  without `at`, and `readPaceProfile` rejected anything without `at` before it
  looked at `retryAt`. Every failed fetch was retried immediately.
- **One timeout per request** instead of one 8 s signal shared by this month and
  last month, which left the second request whatever the first had not spent;
  and a click during an in-flight fetch no longer starts a second download.
- The pace constants moved into `src/55-pace.js`; they lived in boot, so the
  standalone pace harness could not see them and the cache silently threw.

## 1.8.1 — 2026-11-25

- The published-pace cache is now per account **and per time class**. A player
  who alternates bullet and blitz was re-downloading the same half megabyte of
  PGN on every switch, because the single entry was keyed only by account.
- One test for the key, and the pace harness now resolves the signed-in name the
  same way the page does. 103 tests.

## 1.8.0 — 2026-11-25

The pace anchor stops averaging the opponent into your own rhythm.

- **Own colour only**: a chess.com PGN carries both players' `%clk`, and the old
  parser summed the two. The headers name White and Black, so the profile now
  takes the account's side only. On the live archive: 1.7 s (1492 of its own
  moves) instead of 1.9 s (2974 mixed moves).
- **Newest games first**: the archive is oldest-first, so reading the first 40
  games anchored a returning player to a season they have already left. The loop
  now walks from the newest game backwards.
- A name learned after boot (navbar painted late) also triggers the pace fetch,
  not only the settings swap.
- Two tests: colour filtering with a fixture where White and Black think 20 s and
  2 s, and recency (a month of clockless games followed by one recent game).
  102 tests.

## 1.7.2 — 2026-11-25

Settings stop belonging to the browser and start belonging to the account.

- **Per-account settings**: `chess-wraith-settings-v1:<username>`. A second
  account on the same machine no longer inherits the first one's depth, slack,
  delay or theme. One-time migration copies the old global key into the account
  that is signed in, so an existing install keeps its tuning. Anonymous keeps
  the global key.
- **The signed-in name no longer depends on the navbar having painted**: it is
  read from `#user-username-component` / `.user-username` / `.profile-username`
  and, failing that, from `window.chesscom.user.username` (or the navigation
  config). A late name is adopted mid-session instead of leaving everything on
  anonymous.
- The pace row is clickable: it re-reads the account's public games instead of
  waiting out the six-hour cache, the same way the rating row already did.
- Five tests: key scoping, name sanitization, navbar vs session-object detection,
  isolation between two accounts, and the migration. 100 tests.

## 1.7.1 — 2026-11-25

A six second pace is honest until the clock is not.

- The published median is now capped at a eighteenth of the remaining clock
  (`min(ms, max(280, clockMs / 18))`, under the same low-clock setting). With ten
  minutes left nothing changes; with forty seconds the account moves like a
  person in time trouble instead of flagging while thinking six seconds per move.
- One test: ten minutes keeps the rhythm, forty seconds keeps an eighteen-move
  tank, nine seconds becomes a scramble and never zero.

## 1.7.0 — 2026-11-25

The pacing stops being a default and becomes the account's own measured rhythm.

- **`src/55-pace.js`**: chess.com writes `%clk` on every move of a finished game,
  so a public archive says exactly how long the account thinks. The script now
  reads the last month of the same time class, drops premoves (0 s) and
  disconnects (over 150 s), takes the median of 30+ moves and uses it as
  `baselineMs` before the locally learned sample exists. Cached six hours per
  account, one request, never for an anonymous tab.
- **Measured what a human pace actually is** (328 games, three 2700+ accounts):
  bullet median 0.70 s (p90 2.3 s), blitz median 1.60 s (p90 8.9 s). A fixed
  400-700 ms think time is not neutral: it is faster than a grandmaster's median
  blitz move. That is the number the account anchor fixes.
- The Session row now reads `1.6s · acct` or `1.6s · learned`, so it is obvious
  which baseline produced the delay, and `copy report` prints it.
- Four tests for the parser and the sample floor: per-side deltas, book moves
  excluded, premove, stall, class filter, 30-move minimum. 95 tests.

## 1.6.8 — 2026-11-25

`copy report` printed `slack undefined cp`.

- The report read `cfg.slackCp`, a setting that never existed; the panel calls it
  `humanSlackCp`. It now prints the real number and the guard's session boost
  (`slack 40+15 cp`), so the one line that explains the move choice is true.

## 1.6.7 — 2026-11-25

The engine stops being the untested part, and a bug report becomes one click.

- **A fake-worker harness for the engine** (`tests/unit/engine.test.js`): the
  real class boots against a stub Worker, so the UCI handshake, the hash and WDL
  options, `UCI_LimitStrength`/`UCI_Elo` on the NNUE build, `position startpos
  moves`, and a queued search that must send `stop` are all asserted. Four tests
  that would have caught a handshake that never says readyok.
- **`copy report`** in the Info tab: version, engine and mode, ply and turn
  certainty, the account's rating and the effective Elo, the live settings and
  the current warning, straight to the clipboard (textarea fallback if the page
  denies it). The panel's text is not selectable, so the old way was retyping.
- **Two more DOM fixtures**: a mid-game scan (ply, SAN history, whose clock runs,
  clock seconds) and a flipped board read from the other side. 90 tests.
- `docs/research.md` now records why the lite single-threaded build is the only
  honest choice: a userscript cannot make chess.com cross-origin isolated, and
  the full build is ~94 MB.

## 1.6.6 — 2026-11-25

A move that failed to register used to fail silently.

- **A rejected `playMove` promise is caught.** When chess.com ignored a click
  the rejection was unhandled: auto-play stayed on, no timer was armed, and the
  panel said "playing" while nothing played. The failure now surfaces in the
  status line and the scan loop resumes.
- `ChessWraith.step()` and the hotkey path no longer leak an unhandled rejection.

## 1.6.5 — 2026-11-25

The selector layer stops being the untested part.

- **jsdom fixtures of chess.com's own markup.** `tests/unit/dom-board.test.js`
  builds a real board (`div.piece.wp.square-52`, the `square-{file}{rank}`
  convention), a move list with figurines and a spare-pieces tray, then reads it
  back through the shipped reader: start position, a dragging piece invalidating
  the snapshot, promotion/spare pieces excluded, `e4 e5 Nf3` parsed in order.
  87 tests (was 83).
- **A daily canary** (`canary.yml`) fails when jsDelivr stops serving the pinned
  tag, when either engine file 404s, when the release is missing an asset, or
  when `ENGINE_MIRROR` drifts from `package.json`. A green release with a dead
  engine URL is the failure this catches.

## 1.6.4 — 2026-11-25

Two things the panel could not tell you, and one it was lying about.

- **A 1-minute game after a 10-minute one was being played as rapid.** The peak
  clock only ever grew, so once the session had seen a 600-second game every
  later game was scaled and anchored as rapid. Both the peak and the opponent
  tempo now reset when a new game starts, and the anchor is renewed the moment
  the clock changes time class.
- **`ChessWraith.selftest()`.** One call returns eight checks - version, board,
  tracker, engine, panel bindings, storage, rating and update - each with a
  detail string. A bug report is now a list of facts.
- **The rating row refreshes.** Clicking it asks the profile again instead of
  waiting out the six-hour cache, and a request already in flight is not
  duplicated.
- 83 tests, unchanged.

## 1.6.3 — 2026-11-25

`npm run ship` passed each word of the release title through a shell. It now
spawns npm through its JavaScript entry point, so arguments keep their exact
boundaries and the deprecation warning about shell concatenation is gone.

## 1.6.2 — 2026-11-25

- **A failed rating request no longer retries on every reload.** chess.com's
  PubAPI docs say serial access is unlimited but a throttled answer is possible
  (`429`), so a failed fetch now stores a retry time fifteen minutes out. The
  last good ratings stay in use meanwhile.
- **`npm run ship <x.y.z> "<title>"`.** One command: prepare, full check, commit,
  tag, push, `gh release create`, then poll jsDelivr until both engine files are
  served. It never tags when a check fails; the working tree and GitHub stop
  drifting apart.
- 83 tests, unchanged.

## 1.6.1 — 2026-11-25

People get slower as a session goes on; the delay now does too, 2% an hour
capped at 6% after three hours (the same drift `nitro-wraith`'s typing model
uses, from de Jong et al. 2020 on time-on-task). 83 tests.

## 1.6.0 — 2026-11-25

The rating is no longer a number you type. It is the account's own.

- **Anchor: the signed-in account.** Once per six hours the script reads
  `api.chess.com/pub/player/<user>/stats` (public, CORS-enabled, measured from a
  chess.com tab on 2026-11-25) and keeps the rating for every time class. The
  clock on the board picks which one applies, so the same account is anchored at
  its rapid rating in a 10-minute game and its blitz rating in a 3-minute one.
  The panel shows `1840 blitz` and `Playing at 1840 · acct`.
- **The ceiling is the account.** `effectiveElo` lets the engine drift 75 Elo
  below and 25 above the published rating instead of aiming 130 above whoever is
  across the board. `Target Elo` in Tune still exists as a manual override; `0`
  (the new default) means "my own". No rating, a blocked request or a signed-out
  browser falls back to the manual value, then to 1500.
- **The guard survives reloads.** The extra slack earned from playing above the
  account's ACPL band is saved per username, so a fresh tab does not forget it.
- **The clock sets the pace.** Bullet games play at half the delay, blitz at
  0.78, rapid and longer at 1.15, on top of the per-account learned median; a
  forced move (exactly one legal reply) is played at 45% to stop the script from
  thinking for three seconds in an obvious position.
- 82 tests (was 78); two new files: the rating normalizer and the account test.

## 1.5.4 — 2026-11-25

The Info tab's Build card showed `–` for its own version: the new Updates card
reused `data-el="build"`, and the second binding won.

- The Updates card row is `installed`, and a unit test now fails when any two
  elements in the panel share a `data-el` name.
- 78 tests (was 76).

## 1.5.3 — 2026-11-25

Two things that only show up on a release day.

- **A cold tag is not a broken engine.** The NNUE worker now gets a 6.5 s
  handshake deadline and one silent retry before the script settles for the 2019
  build. The first request for a just-published tag can 404 while jsDelivr warms
  the edge, and the old code paid for that with the whole session.
- **A slow answer is not a stuck panel.** Both update sources are asked at the
  same time with a 10 s abort, and the higher version wins: `@latest` is fast but
  stale for hours, the release API is exact but rate-limited.
- 76 tests, unchanged.

## 1.5.2 — 2026-11-25

The pill said `UPDATE 1.5.1` and ate the header: the title rendered as
`CHESS WRA…`.

- The pill shows only the version next to its arrow, and the tooltip and
  `aria-label` carry the full sentence.
- 76 tests, unchanged.

## 1.5.1 — 2026-11-25

`@latest` on jsDelivr kept answering `1.4.2` for minutes after 1.5.0 was tagged,
so a copy that had just been released was told it was up to date.

- The update check asks the GitHub release API first (immediate) and falls back
  to the jsDelivr `@latest` copy of `package.json` when that fails.
- 76 tests, unchanged.

## 1.5.0 — 2026-11-25

Two changes: the panel now tells you when there is a newer release, and there is
no longer any way to make it play like an engine.

- **Update pill.** On boot and every six hours the panel reads
  `cdn.jsdelivr.net/gh/ezurinho/chess-wraith@latest/package.json` (GitHub's
  release API as the fallback) and shows `UPDATE vX.Y.Z` in the header when the
  latest tag is newer. Clicking it downloads the latest release; the Info tab has
  the installed/latest/checked rows, a `check now` button and a link to GitHub.
  `versionNewer()` never treats an unparseable answer as an update.
- **One mode: legit.** The `adaptive`/`gm`/`club`/`casual`/`full engine` presets
  are gone, along with the deliberate-miss dice. The header shows a static
  `LEGIT` chip, the rating sits ~130 Elo above the measured opponent (your
  target Elo when there is none), and the slack floor of 40 cp means not even a
  slack setting of zero asks Stockfish for its raw best line.
- 76 tests (was 72): `tests/unit/update.test.js` covers the version comparison
  and the pinned update URLs, and the selection tests now assert the single
  legit contract instead of the removed presets.

## 1.4.2 — 2026-11-25

CI caught a flaky assertion in the pace test, and the flake was the feature
working badly: the account band clamped a uniform draw, so a session's median
sat wherever the clamp put it.

- The delay is now drawn around the account's own baseline (0.78–1.22×, median
  on the baseline) instead of being clamped into 0.65–1.5×, which piled mass on
  both edges and let the median drift past 2 800 ms on a 2 000 ms account.
- The test asserts the median lands within ±10% of the baseline.
- 72 tests, five consecutive green runs.

## 1.4.1 — 2026-11-25

The engine reporting `readyok` cleared every warning, including the two that
explain why auto-play just turned itself off.

- The guard messages (`paused: …`, `another tab is playing`) survive the engine
  boot; a normal warning still clears.
- The footer says `second tab · passive` while the lease belongs to another tab.
- 72 tests, unchanged: the fix is in the wiring, not in the pure helpers.

## 1.4.0 — 2026-11-25

Three ways a bot gets caught that have nothing to do with move quality: it plays
after a human took over, two tabs drive the same board, and the account plays
far above its own rating. Each one now has a guard, and the panel shows the
numbers behind them.

- **Takeover detection.** A move that lands on our turn without our click pauses
  auto-play and says `paused: manual move detected`. It only fires on a board
  with a real clock, a certain turn and a ply that advanced by exactly one, so
  the analysis board never triggers it.
- **One tab per board.** A `localStorage` lease is renewed every 3 s; a second
  tab goes passive with `another tab is playing`, and closing a tab releases the
  lease on `pagehide` instead of leaving the board locked.
- **Accuracy guard.** `acplBand(elo)` is the ACPL a human at that rating loses
  per move. After 15 assessed moves, `acplGuard()` raises the slack 12 cp at a
  time (cap 160) when the account is under 45% of its band, and gives it back
  when it is over twice the band. The boost is per session: the saved setting is
  never rewritten.
- **Denser panel.** A target strip with the accuracy band and a fill bar, session
  rows for your pace, their tempo, games played and time left, and an account
  card with the signed-in user, rating, session length and current guard.
- 72 tests (was 53); the 19 new ones live in `tests/unit/guards.test.js`.

## 1.3.1 — 2026-11-25

A session with no end is the one shape that is hard to explain away, and the AFK
loop had none.

- **Session cap.** The AFK loop stops after 15 games or 3 hours, whichever comes
  first, and says which one it was. Both live in `CONFIG`
  (`sessionMaxGames`, `sessionMaxMs`); zero disables either half.
- `sessionLimit()` is pure and tested on both halves, the zero cap and the
  missing-values case.
- 53 tests (was 49).

## 1.3.0 — 2026-11-25

The engine the README promised and the engine that ran were not the same one.
This release makes Stockfish 19 NNUE actually boot, and makes the pacing depend
on the account and the opponent instead of only on a fixed window.

- **NNUE was never failing to load: it was asking for the wrong file.** The
  build does not request `stockfish.wasm`; it builds a name from
  `self.location.href` plus a content hash, so the request looked like
  `https://www.chess.comhttps://www.chess.com/554211df-…` and the old shim --
  which matched on `.wasm` -- never fired. The shim now answers every request
  that is not the engine's own script with the wasm from the mirror.
  Measured in Chrome on chess.com: `uciok` in 111 ms, 1,285,348 nodes in
  1,657 ms with MultiPV 3 and WDL on (≈776 kN/s, depth 18). The JS build stays
  as the documented fallback for a blocked worker or a cold cache.
- **The NNUE verdict is no longer sticky.** A successful boot clears the
  seven-day skip marker, so a fix ships to browsers that had cached the old
  failure.
- **Pace is account-based.** Settings stay global; the opening memory and a new
  rolling median of this account's own think times are stored per signed-in
  username. Once there are six samples, a move is kept inside 0.65×–1.5× of the
  account's own rhythm, so the same account does not play like two people.
- **Pace follows the opponent.** The gap between our move landing and theirs is
  their think time; the delay never drops below 35% of it (capped at 3.2 s),
  because answering a ten-second opponent instantly is a pattern on its own.
- **A hand on the board wins.** A pointerdown outside the panel defers the
  pending move for two seconds, twice; after that the script stops and says
  `paused: your hand is on the board`.
- Panel: the Session card shows the account and your learned pace next to the
  opponent's tempo.
- 49 tests (was 37): the wasm shim against the real garbage URL, the pace band,
  the opponent floor, and the board parser's pure helpers.
- `tools/release.js` now also moves `ENGINE_MIRROR` to the new tag and CI fails
  when the mirror, the package, the header, the README badge and the CHANGELOG
  disagree.

## 1.2.0 — 2026-11-25

A review against the live site found seven ways the script could be confidently
wrong. This release makes the wrong cases visible instead of silent.

- **The turn is evidence, not a default.** The tracker now records where the
  turn came from (`start`, `moves`, `ply`, `clock`, `highlight`, `override`,
  `assumed`). When it is only a guess, the panel says `turn not readable; not
  playing` and neither auto-play nor Step will move a piece. Previously a
  mid-game attach with no move list and no clock assumed White to move, which
  meant the eval and the suggested move belonged to the other player, and a
  click during the opponent's turn became a premove.
- **Move lists without `data-ply` are read.** chess.com also renders moves as
  `.node` rows inside `wc-simple-move-list`; those are now parsed in DOM order,
  so the exact path (full UCI history, exact halfmove clock) works there too.
- **`onlyMyTurn` is honoured.** Off, the script plays both seats; on (default),
  it only moves its own side.
- **A theme click no longer kills the analysis.** Settings are split in two:
  style, target Elo, depth and movetime restart the search; theme, collapse,
  pacing, line count and switches only save and repaint.
- **The collapsed panel stays collapsed** across reloads; the setting was saved
  but never applied on mount.
- **Search watchdog.** A worker that accepts `go` and never answers used to leave
  the panel saying `thinking` forever, with the 2 s scan loop waiting on it. The
  engine now sends `stop` after `movetime * 6 + 6 s`, and if the answer still
  does not arrive 2.5 s later it drops the worker, reports it and reboots.
- **The engine is pinned to a release tag**, not `@main`: the bytes executed
  inside chess.com must not change without a tag. The NNUE verdict is cached for
  seven days per mirror, so the four second handshake that can only fail is paid
  once a week instead of on every page load. `ChessWraith.retryEngine()` clears
  the verdict.
- **AFK button search is scoped** to the game-over dialog, where `new game`
  cannot hit the site navigation.
- Dead code removed: the no-op resize handler, the unwritten search counters and
  the unused `bestSan` branch.
- 37 tests (was 29): turn certainty per source, the search budget, the NNUE
  verdict cache and the README version badge.
## 1.1.0 — 2026-11-25

The interface is now the NITRO WRAITH system, and the session can run unattended.

- **Panel rebuilt** on the same design language as nitro-wraith: one token block,
  six themes (Carbon, Aurora, Sunset, Ice, Violet, RGB) behind a single
  `data-theme`, an icon rail with Live / Tune / Info, cards with an accent spine,
  a big eval-and-best hero, a session card and a footer line. Motion is limited
  to state (boot, pulse, bump, scan) and dies under `prefers-reduced-motion`.
- **AFK** (`Alt+Shift+F`, chip in the header): after a game ends it waits a
  human pause (1.7–4.2 s, 12% of the time 5–9.5 s), presses Rematch or the
  shortest new game it can find, and re-arms auto-play when the next board
  appears. It stops and says so if no button is offered.
- **Keep-alive**: optional near-silent AudioContext tone so Chrome treats the
  tab as active; the panel shows `on`, `blocked` or `off` instead of pretending.
- **Play while hidden**: the pause is now a switch, off by default.
- 29 unit tests (was 22): rematch selection, disabled buttons, delay windows,
  hostile configs and button text normalisation.

## 1.0.3 — 2026-11-25

- The debug API is no longer a global by default. chess.com's own analysis of
  cheat clients lists "global scope audits" as a detection angle; `window.ChessWraith`
  is now exposed only with `?cw=1` in the URL or
  `localStorage['chess-wraith-debug'] = '1'`. The panel, auto-play and engine are
  unaffected.

## 1.0.2 — 2026-11-25

A code review turned up three things the previous release claimed but did not
do. All three are fixed, and the play itself is closer to a person.

- **The styles never weakened the engine.** `mode.includes('19')` is true for
  "Stockfish 2019 JS", so the fallback took the NNUE-only option path and every
  preset played at full strength. A real `nnue` flag now selects the branch, and
  the fallback maps the target Elo onto `Skill Level` (1320 → 0, 3190 → 20).
- **Adaptive mode never measured the opponent.** The loss was read from
  `state.analysis` after it had been cleared, so `oppCpLosses` stayed empty and
  the estimate was always 1500. Measurement moved to the moment the new position
  is evaluated, which is the only point where both evaluations exist.
- **Dead code removed:** `turnOverride: cfg.sideOverride === 'auto' ? 'auto' : 'auto'`.
- **Deliberate misses:** the Casual preset now misses 12% of the time and
  Adaptive 5%, capped at 2.5× the slack, never throwing away a forced mate. Club
  and GM stay clean.
- **Opening variety:** the first two plies are remembered in localStorage and a
  first move repeated three times in six games is down-weighted to 28%.
- **Time from the position, not only the clock:** the gap between the top two
  lines moves the delay (±18–28%), checks add 12%, captures come 8% faster, and
  3.5% of moves get a rare second thought 1.45–1.95× longer.
- **Panel:** live ACPL for your own moves, opponent estimate and the target Elo.
- 22 unit tests (was 16), including the Elo→skill map, adaptive targeting, miss
  rate, repeat penalty, gap-driven delay and the rethink cap.

## 1.0.1 — 2026-11-25

Verified against the published mirror (jsDelivr) on the live chess.com analysis
board, which exposed two real defects:

- The NNUE build never answers `uci` inside a userscript blob worker (it loses
  the script URL it needs to locate `stockfish.wasm`), so the engine stayed
  "starting" forever. The script now asks twice, waits four seconds, and falls
  back to the bundled Stockfish 2019 JS build, which is what actually runs.
- Panel buttons were one pixel family too wide for the header at 286 px; the
  panel is now 304 px with a zero-minimum grid, so the settings button no longer
  sits on the border.

## 1.0.0 — 2026-11-25

First release.

- Local Stockfish 19 NNUE (WASM) running in a blob worker: no remote analysis
  service, no account data leaves the tab.
- Reads the chess.com board from the DOM: grid, orientation, ply/SAN list,
  last-move highlights, clocks, opponent rating, game-over modal.
- Panel in a closed Shadow DOM: evaluation, best move, three candidate lines,
  engine tag, depth, clock, auto-play state.
- Auto-play with human pacing: log-normal-ish delays inside your own window,
  capture/check nudges, low-clock speed-up, adaptive study phase, and a
  top-1 streak governor so it does not play the engine's first move forever.
- Move verification: after playing, the board is re-read and the move is retried
  once before auto-play pauses itself and tells you why.
- Safety pauses: game over, promotion dialog, premove on the board, low clock,
  hidden tab.
- Hotkeys: `Alt+Shift+A` auto-play, `Alt+Shift+M` play one move, `Alt+Shift+H`
  panel.
- Fallback engine (`stockfish.js`, no WASM) when the NNUE worker cannot start.



