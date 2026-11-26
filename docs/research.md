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

## What the clock says, class by class

Measured from the public archive in October 2026: 328 bullet and blitz games gave
medians of 0.70 s and 1.60 s per move. The rapid ladder was not in that sample,
so it was measured separately from the October rapid leaderboard - the top 50,
every fourth player, one month of games: eight of twelve had rapid games, 3,000+
rapid moves in total, and the median of their per-game medians was **4.3 s**
(spread 2.0-13.5 s). The default stays at 5.5 s for a fresh profile because that
sample is the strongest end of the ladder, and the leaderboard's `time_class`
values confirm the boundaries the code uses: 60 s and 30 s games are bullet, 180
and 300 s are blitz, 600 and 900 s are rapid.


## Eight hours of nothing to look at

A tab left alone all night is a log with no reader: every decision was already
made, and the state at dawn is one line. That is why the last five transitions
are kept rather than the current warning — a warning is overwritten by the next
one, and the interesting one is usually the oldest.

The cap is five because the panel is 322 px wide: two lines fit under the foot,
the rest live in the tooltip. Repeats are collapsed, because a retry loop can
fire the same reason every four seconds and would otherwise erase its own
history.

## The night outlives the tab

An in-memory history has a hole a user would find in a week: the update
checker itself reloads nothing, but a Tampermonkey update, a laptop waking from
sleep with a discarded tab, or a `chess.com` navigation all start the script
again — and the log with it. The five entries are therefore written per account
under `chess-wraith-history-v1:<user>`, cleared when the list is empty, and
capped on read as well as on write: storage is shared with everything else on
the origin, and a hand-edited value must not paint 200 lines into a 322 px
panel.

Dates matter once the list survives midnight. A line from 23:40 shown as
`23:40` next to a line from 00:10 reads as "twenty minutes ago" when it is a
day older, so anything not from today carries `DD/MM`.

## A limit that resets itself is not a limit

The defaults are 15 games and three hours, and until 1.28.0 both counters lived
in `state`: `gamesPlayed` and `sessionStart` were rebuilt on every page load.
That made the limit advisory. A Tampermonkey auto-update — which this script
checks for every six hours — reloads nothing by itself, but the update prompt
the user accepts at 03:00 does, and the account starts a brand-new 15-game
allowance. The same applies to a discarded tab restored by the browser.

The fix is a small stored object `{startedAt, games}` per account. It is
resumed only while the elapsed time is inside the configured limit, so a tab
opened the next morning is a new session rather than a 19-hour one; a start
time in the future (a clock that jumped) is treated the same way. Turning auto
play off clears it, and so does the limit firing: tomorrow should not inherit
yesterday's exhausted run.

## The engine floor is a wall, not an opinion

Stockfish's option table is explicit (`src/search.h`, current master):

```
constexpr static int LowestElo  = 1320;
constexpr static int HighestElo = 3190;
```

`UCI_Elo` is registered with those bounds in `src/engine.cpp`, so `setoption name
UCI_Elo value 900` is clamped by the engine itself. Anything under 1320 is played
at 1320 whatever the panel says. The script used to clamp silently: a 900-rated
account was told the engine was aimed at 900.

A live probe of the bundled lite build did not answer a plain `uci` in a bare
worker (twenty seconds, zero messages: the build wants its own boot handshake),
so the 1320 here rests on upstream source, not on a measurement of this artifact.
The clamp is conservative either way: if the shipped build had a higher floor, the
panel would still be telling the truth about a number it cannot request.

## A rating with two games behind it

`/pub/player/{u}/stats` returns `record { win, loss, draw }` next to each
`last.rating`. The games count was being thrown away, so an account with two
rated games was anchored as if the number were stable. Glicko-2, which chess.com
uses, starts a rating at RD 350 and settles it by roughly `1/sqrt(n)` while the
opponents are close and the results even:

```
games  RD   weight  target when the rating is 2100 and the prior 1200
    0  350   0.000   1200
    1  247   0.295   1466
    2  201   0.425   1583
    3  174   0.503   1652
    5  142   0.594   1735
   10  105   0.700   1830
   20   76   0.783   1905
   50   49   0.861   1975
  100   35   0.900   2010
```

Weight is `1 - RD/350`, capped at 0.9 so a prior never disappears entirely, and
below 20 games the panel shows `· prov`. This is a prior derived from the rating
system, not a measurement of chess.com's internal RD: if a class rating is missing
the code still borrows the nearest class as it did before, which the earlier
measurement (37 accounts, 31 of 33 differ by more than 400 Elo between classes)
says is a guess and not a substitute.

## Two models of one archive read it once

Sharing has a price: a boot that cached the archive would keep the openings from
the minute it loaded, and the 20-minute refresh below it would re-read a promise
instead of the archive. The cache therefore lives **15 minutes** (`ARCHIVE_TTL_MS`),
one pacing refresh, and after that the next read is real. Measured in the harness:
two reads inside the window cost one request, a read after 16 minutes costs another.


The pace profile and the repertoire were reading `pub/player/<user>/games/<month>`
independently: two requests per month, and the second one is exactly what chess.com
answers with a 429 (measured threshold: keep >=1.1 s between requests).

`archiveGames(user, offset)` now caches the in-flight promise per month, so both
models await one read and a failed read is dropped instead of poisoning the next
scan. Measured in the test harness: the pace profile reads N months, the repertoire
adds **zero** requests on top. A manual refresh (`force`) clears the cache for that
account so the click still means fresh.

## The probe spends think time like a person does

The restricted search is not free: 70 ms on a warm worker, up to ~400 ms cold. The
first version added that on top of the delay `computeDelay` had already chosen, so
opening moves came out one probe slower than the account's own median — a pace
regression introduced by the feature that was supposed to fix the opening.

Now the delay is reduced by exactly what the probe spent (`spentMs`, clamped to
0..4000, floor still 95 ms), so probe + pause is the same think time as a move
without a probe. Measured in the bundle: `computeDelay(...spentMs: 0)` minus
`computeDelay(...spentMs: 400)` is 400 ms.

The probe's budget follows the clock: `min(400, cfg.moveTimeMs, max(180, 0.6 x
searchBudget))` ms, never under 80.
In a 3+0 game the main search gets 300–700 ms per move, and a fixed 400 ms probe
would have spent most of it on a move the account plays on instinct.

`report()` carries `probe N` next to the repertoire line once a restricted search
has fired, so the panel says out loud whether the account's own move was judged
or only reordered.

The probe also re-enters `scheduleAutoMove` about 70 ms later, which is long
enough for the board to have moved on. That function now refuses a `result` whose
`fen` no longer matches the board: a move computed for one position is never
armed for another.

## The account's move gets its own search

1.48.0 could only reorder the moves the engine already had. The signature line
of the measured account proves the hole: after 1.e4 e5 it plays **2.Ne2 in 9 of 9**
games, and a MultiPV 4 search at that position answers Nf3 / Nc6 / Nc3 / Bc4
territory — 2.Ne2 is not on the table at any price, so the tree was silent in
exactly the case that matters.

`probeOpeningMove` asks a second, restricted question: `go depth 12 movetime 400
searchmoves g1e2` (MultiPV forced to 1, since a restricted search has one line).
The answer is merged into the main result as a normal candidate flagged
`opening`; the slack for it is `slack + 70` cp and the eval spread is 3x the
normal one, because in the opening the evidence is the account's record, not the
eval. A probed move that loses more than that is not played at all.

Table weights were also compressed: `0.2 + 4.5 * share` turned a 60-of-60 habit
into an 89 % pick. `0.02 + share` turns it into 95 %, and a 60/40 habit into
60/40, which is what the shares mean.

## The repertoire is a tree, and above four plies the tree is thin

1.47.0 read only the first move, so the third was the engine's again. Reading
the whole opening from the same archive (last 60 games of `aloka_27`, 167 games
in the month) gives a tree keyed by the moves that lead to a position:

| plies before the account's move | nodes | nodes with ≥2 games |
|---|---|---|
| 0 (its first move) | 1 | 1 |
| 1 | 4 | 4 |
| 2 | 7 | 6 |
| 3 | 16 | 4 |
| 4 | 19 | 7 |
| 5 | 20 | 6 |
| 6 | 24 | 4 |
| 7 | 26 | 3 |

117 nodes from 60 games, and the deep ones are single samples: above four plies
the account's own record stops being evidence. That is why a node needs two
games and why an unknown prefix falls back to the deepest node that does exist.

Where the tree does bind it is unmistakable: after 1.e4 e5 this account plays
2.Ne2 in **9 of 9** games, and after 1.e4 e5 2.Nf3 it answers 2...d6 in 9 of 9.
No engine picks 2.Ne2.

**The limit that keeps it honest:** the tree only reweights the moves the engine
already put on the table (MultiPV 4). A signature move the search never
considered is not forced, because the strength envelope is not negotiable. So
the tree shapes the order of its own candidates, it does not override them —
after 1.e4 e5 the engine's list is Nf3/Nc6 territory and 2.Ne2 loses to it.

## A reply is an answer, not an average

The repertoire shipped in 1.46.0 had a modelling bug: black's moves were
averaged over every white first move. Measured on a real 1631-blitz account
(`aloka_27`, `games/2026/10`, 167 games):

| white plays | the account answered | share |
|---|---|---|
| 1.e4 | e5 | 93 % (n=42) |
| 1.d4 | d5 | 89 % (n=27) |
| 1.Nf3 | b6 | 60 % (n=5) |

Marginal over the same games: e5 56 %, d5 32 %, b6 11 %. The average would
answer 1.d4 with e5 — a move this player never chose against 1.d4. The same
account as white played 1.e4 in **60 of 60** games (100 %).

The black table is now keyed by the move it answers, in UCI because that is what
the tracker reads off the board: `blackByFirst['e2e4'] = { e5: 0.93 }`. A first
move faced fewer than twice is left to the engine, never to the average.

## The repertoire only loaded where there was a clock

`syncPaceProfile` returns early without a clock, because a pace needs a time
class. A bot game has none, so on `/play/computer` — the page auto-play exists
for — the repertoire never loaded and the picker stayed uniform. `syncRepertoire`
reads the same archive for the first moves only: one request per account per six
hours, cached under `chess-wraith-repertoire-v1:<user>`, with the same
20-minute backoff when the month is empty.

## A repertoire from the account's own games

The opening picker was a dice roll with a good excuse: four near-equal engine
lines, weights from the centipawn loss, and the only anti-repeat rule multiplied
the repeated first move by 0.28. Measured over 400 draws on the start position
with `e2e4, d2d4, g1f3, c2c4` within 20 cp: **26 % / 26 % / 26 % / 23 %**. With
`repeatUci='e2e4'` that move fell to **12 %** — a player who changes first move
seven games out of eight is rarer than one who keeps it.

The archive the pace reader already downloads carries every PGN, so the
repertoire is free: `repertoireFromGames()` counts the first move of the last
60 games per colour and hands the shares to `chooseMove`. Checked against a real
public archive (hikaru, `games/2026/11`, 486 games):

| side | first moves read |
|---|---|
| white | e4 39 %, c4 39 %, d4 18 %, e3 4 % |
| black | c5 38 %, d5 28 %, Nf6 16 %, g6 13 % |

Two things that had been assumed are now measured. A repertoire has *shares*,
not one move: 39/39/18 is what a real player looks like, not 100/0/0. And the
first move is not the place for diversity — the anti-repeat rule made the
script *less* human, so it now stands down when the move is one the account
actually plays that often (share ≥ 0.3).

With the shares in play the same 400 draws land at roughly **55 % / 25 % / 12 % /
8 %**, which is the account's own distribution with the engine's eval as a tie-
breaker. An account that never played these lines gets the old uniform draw.
## The panel was naming the engine from memory

Asked directly over UCI in the browser (2026-11-26, the shipped tag), the
vendored worker answers:

```
id name Stockfish 19 Lite WASM
id author the Stockfish developers (see AUTHORS file)
uciok
```

The panel printed `Stockfish 19 NNUE`, a constant in `50-engine.js`. The family
was right, the build was not: the string it reports is the **Lite WASM** port,
and the net is the lite-single one. Nothing broke, because this tag ships that
build — but the label was a promise nothing checked, and the release that serves
a different binary would have kept claiming 19.

`engineLabel()` now parses the `id name` line, so the panel and the report say
what the engine says. The JS fallback keeps its own name: it is the 2019 build
whatever number it carries.
## The search was paid for twice

The delay is meant to be the interval between the opponent's move and ours. It
was armed *after* the engine answered, so the real interval was search + delay:

| class | account median | search (measured) | real interval | error |
|---|---|---|---|---|
| bullet | 0.70 s | 0.12-0.72 s | 0.82-1.42 s | **+17 % to +103 %** |
| blitz | 1.60 s | 0.12-0.72 s | 1.72-2.32 s | +7 % to +45 % |
| rapid | 5.50 s | 0.12-3.0 s | 5.62-8.50 s | +2 % to +55 % |

The search numbers are the ones measured for the depth cap (121 ms at depth 14,
715 ms at 22 with a 700 ms budget, 3014 ms at 22 with a 3000 ms budget). The
error is not cosmetic: in a 40-move bullet game the extra 0.7 s per move is 28 s
of clock, which is the whole increment.

`visibleDelayMs(target, spent)` now returns what is left of the target after the
search, with a 120 ms floor so the click is never instant. The report prints both
numbers — `last delay 1600ms · search 715ms` — so the interval can be read off the
panel instead of inferred.
## The depth cap was the strength ceiling, and it did not follow the account

Measured 2026-11-26 in the browser with the bundled engine, MultiPV 4, on a
normal Italian middlegame (`r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b`):

| budget | cap | search stopped at | depth | move |
|---|---|---|---|---|
| 700 ms | 14 | **121 ms** | 14 | g8f6 |
| 700 ms | 22 | 715 ms | **16** | f8c5 |
| 3000 ms | 14 | **218 ms** | 14 | g8f6 |
| 3000 ms | 22 | 3014 ms | **21** | f8c5 |

Two things follow. First, the cap is what stops the search, not the clock: the
engine finishes depth 14 in a sixth of the time it is given and then plays the
move depth 14 found. Second, the move is different — g8f6 against f8c5 — so the
cap is not cosmetic, it changes what the account plays.

`depthForAccount(base, elo)` now adds one ply per 100 points above 1500, clamped
to the engine's own 22. A 1425 account keeps 14 and pays nothing; a 2200 account
gets 21 and spends the budget it already had.
## The three numbers a report needs, and the ones it had

Measured on 2026-11-26 with 1.41.0 in the browser:

| Claim | How it was measured | Result |
|---|---|---|
| a scan is cheap | 50 × `ChessWraith.scan()` on a 17-piece game page | **1.8 ms** per scan, of which 0.01 ms is listing the pieces and 0.04 ms reading their boxes |
| the script survives the other pages | booted 1.41.0 on `/analysis` and `/play/online` | board found, engine `Stockfish 19 NNUE`, no warning, **0 uncaught errors** |
| the opening is not a book | 400 draws of `chooseMove()` over four opening lines | d2d4 26 %, e2e4 26 %, g1f3 26 %, c2c4 23 %; with `repeatUci = e2e4` the same move drops to **12 %** |

The report line is now the whole chain — `rating 1480 rapid · rival 1000 · form 0 ·
effective 1425 (default)` — because "effective 1374" cannot be checked by anyone
without knowing what it was anchored to. A test boots the script, waits for both
the rival and the account rating, and asserts every link.
## What the five public scripts actually are

Read from the published source on 2026-11-26 (greasyfork `/code`), not from
their descriptions:

| Script | Version | Where the move is computed | Account rating | Persistence |
|---|---|---|---|---|
| Auto Move 548147 | — | local Stockfish | no | none |
| Bot v2.1 550809 | — | local engine | no | none |
| Chess Assist 603538 | — | local engine | no | none |
| OmniChess 586665 | — | local engine | no | none |
| Dual engine 526240 | 7.0 | **remote** (`GM_xmlhttpRequest`, Stockfish 19 + Patricia 5.1) | no `pub/player`, no `rating`, no `setoption`, so the strength cannot follow anyone | no `localStorage` |

Measured by counting the source: 526240 has 12 mentions of Patricia, 2 of
`GM_xmlhttpRequest`, 11 `setTimeout`, 17 `delay`, one `Math.random`, and zero of
`UCI_Elo`, `setoption`, `pub/player`, `rating` or `localStorage`. Its licence
forbids modification and redistribution. In other words: the position leaves the
browser, and the engine cannot be told who it is playing.

chess-wraith 1.41.0 keeps the engine in the tab (`@grant none`, no network for
moves), pins `UCI_Elo` to the account, and stores per account.
## The rating had three names and the script knew none of them

Census on two real pages, 2026-11-26 (`/game/live/168072860134` and
`/play/computer`), counting what `readOpponentRating` looked for:

| Selector | game page | vs computer |
|---|---|---|
| `.user-tagline-rating` | 0 | 0 |
| `[data-cy="user-tagline-rating"]` | 0 | 0 |
| `[data-user-block-part="rating"]` | 0 | 1 (`(300)`) |
| `[class*="user-rating"]` | 0 | 1 |
| `.player-top` / `.player-bottom` | 1 / 1 | 0 / 0 |
| `.player-row-top` | 0 | 1 |
| `.clock-component` | 2 | 0 |

So the rating reader was aimed at a name that no page uses, and the clocks —
which are correct — sit in `.clock-component`, inside `.player-top` on the game
page and nowhere on a clockless bot game. The reader now walks the opponent's
player container (`board-layout`, `player-top/bottom`, `player-row-top/bottom`),
looks for the rating under all three names, and only then accepts a lone
`(1234)` tag inside that container. A page that hides ratings (signed out) still
returns `null`: unknown is not 1500.
## The default never ran

`state.effectiveElo` was only resolved inside the rating callbacks. A signed-out
tab, or an account whose profile request comes back 403/429, never reached them,
so the value stayed `null` — and the search falls back to `cfg.targetElo`, which
is `0` by default. The engine then clamps 0 to its own floor: an account-less tab
played at 1320 while the panel documented 1500, and a manual target typed into
the panel did not apply until the next rating fetch.

Resolved once at boot and again whenever settings change. The boot test removes
the navbar name, makes the stats endpoint answer 404, and asserts the strength is
1500; before the fix it was `null`.
## The strength follows the account, and keeps following it

`effectiveElo` has always been anchored to the account: `base` is the published
rating in the class the clock says, the ceiling is `base + 25`, the floor is
`base - 75`, and a stronger opponent cannot pull it up past that ceiling. What
was missing was time. Two things:

- **Form.** One strength for a whole night is its own fingerprint. Each game now
  carries a deterministic offset in ±30 points, keyed by `account:gameNumber`, so
  the same game always asks for the same strength and the next one differs. It is
  applied inside the envelope and only when an account rating exists.
- **The anchor moved while the tab was open.** The profile cache is six hours
  (`RATING_TTL_MS`) and nothing refreshed it mid-session, so a night of wins was
  played at the rating the account had at boot. `ratingRefreshDue` re-reads the
  profile at game boundaries after three games and twenty minutes, and the panel
  keeps working while the fetch is in flight.

Measured with `effectiveElo` and the five form offsets -30/-15/0/+15/+30
(min..max asked of the engine):

| Account | vs 200 lower | vs same | vs 200 higher |
|---|---|---|---|
| 1200 | 1245..1245 | 1300..1345 | 1315..1345 |
| 1400 | 1325..1360 | 1395..1425 | 1395..1425 |
| 1800 | 1725..1760 | 1795..1825 | 1795..1825 |
| 2400 | 2325..2360 | 2395..2425 | 2395..2425 |

No row exceeds `account + 25`: against a stronger opponent the script plays its
own level and loses more often, which is the trade a legitimate account makes.
Below 1320 the engine clamps at its own floor (the 1200 row reads 1245 because
`base` clamps to 1320 and the window is `-75`); the compensation there is the
wider slack, 84 cp for a 900-rated account.
## The archive page has no move list at all

Probed 2026-11-25 on `https://www.chess.com/game/live/168072860134`, signed out:

| Selector | Nodes |
|---|---|
| `wc-simple-move-list` | 0 |
| `wc-move-list` | 0 |
| `.move-list` `.node` `[data-ply]` `.vertical-move-list` | 0 |
| any element whose text starts `1.` | 0 |
| custom elements other than `wc-chess-board` | 0 |

The archived game page renders the result, the clock and the buttons, and no
move list in the light DOM. So `readPlyCount` returns `null` there — not because
the selector is wrong, but because there is nothing to read. That makes the
`ply < 2` guard from 1.35.0 inert on exactly the page where the score is read.

A finished game also cannot end on the starting position: chess.com aborts a
game that never really started, and aborted games are not scored. So the stale
dialog guard now leads with the board itself — `placement === Chess.START_PLACEMENT`
is a no-count — and keeps the ply check for pages that do expose a list. The
regression test for the score fixture had to move two pawns: a start-position
fixture under a finished dialog is a state chess.com never produces.
## The snapshot never knew which side we were on

`tracker.updateFromDomSnapshot(grid, hints)` reads `hints.flipped` and
`hints.plyCount` to parse the board, and `getSnapshot()` returns the *position*
— a live snapshot's keys are exactly:

```
grid placement turn castling ep halfmove fullmove turnSource fen
uciMoves turnCertain changed lastMoveUci
```

No `flipped`, no `plyCount`. Every caller downstream asked the snapshot
nevertheless: `mySide(state.snapshot.flipped)` answered `'w'` for every game,
and `resultCounts(... ply: snapshot.plyCount ...)` never saw a move list at all.

For a game played as Black that is a wrong clock, a wrong turn gate and, since
1.36.0, a wrong score: the dialog says `Black Won`, the script believes it is
White, and records a loss. The fix is four fields: the snapshot boot keeps is a
shallow copy of the tracker's with the two view facts re-attached. The
regression test flips the board and reads the dialog, and fails by name
(`the snapshot knows the board is flipped`) when the copy is removed.
## The selectors were wrong

Everything about the game-over dialog in this repo was invented, and it was
wrong. A real finished game, read from the DOM on 2026-11-25:

| Selector in this repo | On the real page |
| --- | --- |
| `.game-over-modal` | absent |
| `.game-over-modal-content` | absent |
| `.game-over-header-component` | absent |
| `.game-review-buttons` | absent |
| `.board-modal` | absent |
| `.game-over-modal-shell-container` | **400×163, visible** |
| `.board-modal-component` | **400×163, visible** |
| `.game-over-modal-header-component` | **400×75, flex, visible** |

When the repo's names match nothing on the page, `isGameOverDom()` answers
`false` for a game that has just ended — no rematch, no result — and 165 tests
agreed with it, because every fixture was built from the same invented names.
That is what a fixture is for and that is exactly how it lies.

Two more things the real page settled:

- The title names the **colour**, not the player: `Black Won` / `by checkmate`.
  A name-only parser returns `null` there (or worse, a loss for the side that
  actually won), so the parser now maps `white`/`black` against the colour we
  are playing. That also works signed out, where there is no account name.
- `textContent` glues *every* sibling block, not just a header and a capitalised
  button: the real dialog reads `tester wonby checkmate`. The case-boundary
  trick from 1.34.0 missed this one. `innerText` has the line breaks a reader
  sees, and a leaf-walking fallback gives jsdom the same shape.

`isGameOverDom()` also stopped asking only about the element's own
`offsetParent`: the real header is `position: relative` inside a fixed overlay,
so it reported a 400×75 modal as hidden.
## The name next to the verb

1.34.0 decided a result by asking whether the account's name appeared in the
dialog. Both players appear in that dialog — the header shows the winner, and the
player rows show both names and both ratings — so the test was satisfied by the
loser's own name.

    tester 1480 · opponent 1502 · opponent won

reads as a win for `tester` under a substring test. The correct reading is
local: the word attached to `won`/`lost` is the side that verb is about, and it
is the only token in the text that means anything:

```js
const near = /([a-z0-9_-]{2,})\s+(won|lost)\b/.exec(line);
```

That also removes the need for a name-based escape hatch: an empty account name
still returns `null`, and a recognised name still wins only when it is the one
holding the verb.

Second fix in the same function: a rematch paints a fresh board under the old
dialog for a moment, so the same text can be scanned once for the game it
belongs to and once for the one that just started. A game with fewer than two
plies on the board is not that game — chess.com aborts anything that never
reached two moves, so a real result can never be that young. When there is no
move list at all the dialog is all there is, and it is trusted.
## "tester wonRematch"

The game-over dialog is the only place chess.com states a result, and it states
the *winner*, not the outcome: "tester won", "tester won by resignation", or a
bare "Draw". Turning that into a session score needs three decisions:

1. **Whose name.** The dialog says who won, and `#user-username-component` says
   who we are. A name we do not recognise returns `null` rather than assuming a
   win; a wrong score is worse than no score.
2. **Glued text.** `textContent` concatenates sibling blocks without a space, so
   the header and the Rematch button arrive as "tester wonRematch" and a strict
   `\bwon\b` never matches. A space at the lower→upper case boundary is what the
   page looks like to a reader, and it is what the parser inserts.
3. **Counting once.** A dialog that survives into the next scan, or a rematch
   where the old modal lingers, would count the same game twice. The result is
   tagged with the game number that produced it and ignored while that number
   has not changed.

The first attempt at this scored zero because `resumeSessionState()` runs twice —
once at boot and again when a late account name is adopted — and the second call
assigned the stored session's empty results over a score that had just been
counted. It now adopts the stored results only when the session was actually
resumed, the same shape as the `Math.max` already guarding the game count.
## Silence is a failure

The first version of the backoff only covered a fetch that threw. Three other
ways for the engine to be dead had no owner:

1. **A worker that spawns and never says `uciok`.** The handshake deadline ran,
   printed `engine did not answer uci` and stopped. The obvious causes — a page
   that blocks blob workers, a wasm compile that dies — are not network errors,
   so no retry ever happened.
2. **A crash cluster past its second rebuild.** `#recover` returned early once
   `recoveries >= 2`, by design, to stop a boot loop. It stopped everything else
   too, and the engine stayed dead behind a single line.
3. **The fire-and-forget spawns** in the NNUE fallback (`.catch(() => {})`)
   swallowed a failed fetch whole.

All three now end in `#scheduleRetry`, and a `readyok` resets the ladder either
way. The rule is one sentence: any path that leaves the engine unable to answer
has to have a timer attached to it.

Worth recording from the tests: the harness seeds an NNUE-skip entry with
`mirror: 'v0.0.0-test'`, but `nnueSkipActive` requires the mirror to match the
pinned URL, so the seed was inert and the engine booted NNUE. The first two
assertions failed because they waited 4 s for a 6.5 s deadline — the test was
exercising the wrong branch and passing the right vibe. It now pins the skip with
`ENGINE_MIRROR` before boot.
## Offline at boot used to be permanent

`#bootInner` had one failure path nobody had taken: if both the NNUE fetch and
the JS fallback fetch threw, the promise rejected, the caller swallowed it, and
`mode` stayed `'offline'` until the tab was reloaded. On a laptop that is the
normal ending of a Wi-Fi blip — and with AFK armed, eight hours of nothing.

Two things were wrong in that path.

1. **No retry.** Boot happens once. It now schedules 5 s, 20 s, 60 s, then every
   five minutes, and a `readyok` resets the ladder. A genuinely offline machine
   pays a timer every five minutes; a machine that came back plays.
2. **A network blip was remembered as a broken build.** `rememberNnueSkip()`
   wrote seven days of `NNUE_SKIP_TTL_MS` on *any* NNUE failure, including
   `TypeError: Failed to fetch`. One bad minute of Wi-Fi downgraded every load for
   a week, silently, to the 2019 build. The skip is now written only when the
   fallback also fails to fetch or the error is not a network error (5xx counts as
   network; a 404 does not — that is a real verdict about the mirror).
## Hide is not stop

`panel.toggleHidden()` sets `style.display = 'none'` and flips a boolean. Nothing
in the play path reads that boolean: `grep panel\.hidden src/` returns the panel
itself and one line in `panicStop`. So a hidden panel with auto-play armed is a
script still playing at full speed behind an empty corner — which is the exact
shape of the moment someone walks into the room.

`Alt+Shift+S` therefore does the work hiding does not: auto-play off,
`autoPlayOnLoad` off, `autoRematch` off, the search cancelled, the move and
rematch timers cleared, and only then the panel hidden. It writes a `panic stop`
line to the per-account history, so the next person to open the panel can tell
the difference between 'it never played' and 'it was stopped'.
## Timers in a hidden tab

What is documented: Chrome has throttled timers in hidden pages since 88, in
stages — a 1 s alignment, then chained timers (more than five deep) to 1/minute,
then after five minutes hidden a budget of one wake-up per minute. Chess.com
does not need a page timer to keep a game clock: the clock is server-side, so a
batching tab loses games, not frames.

What is *not* documented: whether a dedicated worker's intervals are batched on
the same schedule. The claim ``worker timers are exempt`` is repeated by
practitioners and contradicted nowhere official, so it is used here as a
best-effort mitigation and not as a guarantee. The guarantee is the lag check:
`throttleDecision` sees a 2 s tick arrive a minute late and says so, whether or
not the worker survived the batching.

## Low clock is not an edge case

57,340 moves from three blitz leaderboard players in October 2026 (Hikaru,
jefferyx, Andreikka), read from the `%clk` comments of their public PGN:

- median clock at a move: **53.7 s**
- **2.6%** of moves are played with under 5 s left
- 6% under 10 s, 23.8% under 30 s

At roughly 40 moves of your own per game, that is about one move per game inside
the window where the old `movetime * 6 + 6000` deadline (10.2 s for a 700 ms
search) could outlive the flag. The budget assumes a full clock; the clock is
what actually runs out.

## What a rebuild costs

Measured in the live tab on the analysis page, three times in a row, each one
after `destroy()`: the NNUE worker is ready again in **206, 205 and 306 ms**,
counting the shim fetch and the wasm compile. That is the number 1.19.0 needed:
a recovery fits inside a bullet move, so rebuilding on the spot beats waiting out
a 6–40 s search budget for an answer that is never coming.

## Most games end without moving a piece

661 games from the October 2026 rapid leaderboard, sorted by how they ended:
318 resignations, 195 flags, 5 agreed draws, 3 abandonments — **521 of 661, 79%**,
end on a board that does not move. The last ply is the opponent's: they resign,
their clock runs out, and the pieces stay exactly where they are. Any code that
only notices a game over when the position changes misses four endings in five,
which is what `runScan` did until 1.18.1: the modal was read inside the
`if (changed)` branch, so those games never armed a rematch.

## The archive API has no free lunch, but it does have a serial lane

The PubAPI documentation is explicit: *"Your serial access rate is unlimited. If
you always wait to receive the response to your previous request before making
your next request, then you should never encounter rate limiting."* Parallel
requests may get `429 Too Many Requests`, and *"if we detect abnormal or
suspicious activity, we may block your application entirely"*
([published-data-api](https://www.chess.com/news/view/published-data-api)).

That sentence shaped the cache: the pace sync asks for one month, waits, then
asks for the previous month, so it is serial by construction, two requests per
account per six hours, and a `429` is written down with a twenty minute backoff
instead of being retried. Before 1.9.0 that backoff was dead code: the reader
rejected entries without `at` before it looked at `retryAt`.

## The pace anchor is measured, not invented

`%clk` is written on every move of a finished chess.com game, so a public
archive is a record of exactly how long the account thinks. Measured on 328
games from three 2700+ accounts (`magnuscarlsen`, `alireza2003`, `gukesh_d`,
2026-08/10):

| Class | Moves sampled | Median | p25 | p75 | p90 |
| --- | --- | --- | --- | --- | --- |
| bullet | 13,158 | **0.70 s** | 0.40 | 1.30 | 2.30 |
| blitz | 11,290 | **1.60 s** | 0.80 | 4.30 | 8.90 |

Two things follow. First, a fixed 400-700 ms budget per move is not a
human rhythm, it is a *fast* human rhythm even for a grandmaster. Second, the
distribution is not uniform: p75 is 2.7x the median in blitz and p90 is 5.6x,
because some moves are taken in a second and some take half a minute. The
delays are drawn from a triangular skew and the visual band matches, but the
median is the number that matters, and it belongs to the account.

So the script now reads the same `%clk` stream: last month of the same time
class, the account's own colour only (the opponent's clocks are right there in
the same PGN and would otherwise halve the signal), newest games first, median of
the deltas, 30-move floor, premoves (0 s) and stalls (over 150 s) dropped, cached
six hours per account. Measured on the live archive, own-side median for one
2700+ account is 1.7 s from 1492 moves, against 1.9 s when both colours are
mixed: the mixed number was the *opponent's* rhythm leaking in. That median becomes `baselineMs`
and is used before the locally learned one exists. A 1800 blitz account whose
games average 3 s a move now moves at 3 s from move one, not after ten moves of
defaults.

## What the fair-play policy actually says

chess.com's Fair Play Policy (last updated 2026-03-25) forbids, in its own
words: *"chess engines, software of any kind, bots, plugins, browser extensions,
or any tools that analyze positions during play. We can detect if you are using
any of these programs."* It also forbids tablebases and "automated analysis or
blunder checking of your games in progress". There is no exemption for a
tool that only paces a human move, so the honest reading is that a userscript
that plays ranked games is a violation whatever its pacing. The pacing work
below is about not looking like a machine, not about being allowed.

## Why the lite single-threaded build, and not the strong one

Stockfish.js 19 ships five builds. The multi-threaded ones need the page to be
cross-origin isolated (`Cross-Origin-Opener-Policy: same-origin` plus
`Cross-Origin-Embedder-Policy: require-corp`), and a userscript cannot add
response headers to chess.com: `crossOriginIsolated` is false there and
`SharedArrayBuffer` is unavailable, so `setoption name Threads` does nothing.
The remaining choice is single-threaded full (about 94 MB of js + wasm per page
load) or single-threaded lite (about 1.7 MB). Lite keeps the NNUE net and loses
a few dozen Elo at long thinking times; at 150-6000 ms per move, on one thread,
the difference is smaller than the strength we deliberately leave on the table.
Source: [stockfish.js engine table](https://github.com/nmrugg/stockfish.js/).

## 2c. Move-level detection is now a benchmark, not a vibe

ChessFraud (ACM, 2026) is the first public benchmark for move-level cheating
detection: 505 tournament games where engine use was explicitly logged, plus
12,000 Lichess games with one move swapped for an engine or human-aligned
model suggestion. Its point is that human-aligned models - the ones that play
like a 1800 rather than like Stockfish - complicate detection precisely because
move choice stops separating them from a person.

That is the design our ACPL band imitates, and it is also why the band is not a
defence: the paper trains detectors on the same signal we optimise. Treat the
guard as a way to not look absurd, not as cover.

Chess.com's own [Fair Play policy](https://www.chess.com/legal/fair-play)
(last updated 2026-03-25) forbids "chess engines, software of any kind, bots,
plugins, browser extensions, or any tools that analyze positions during play" and
states "We can detect if you are using any of these programs". Their
[fair-play explainer](https://www.chess.com/cheating) says about 85% of closures
are automated and lists 100+ gameplay factors.

Volume, from the primary source rather than a summary: the
[Fair Play Update for November 2025](https://www.chess.com/blog/FairPlay/fair-play-update-november-2025)
(19 December 2025) reports **126,000 accounts closed in that month** and 16
titled players banned, "relatively consistent with previous months". That is about
4,200 closures a day, which is the number this project's own cost-benefit
argument rests on: the base rate is high enough that a run of clean games is not
evidence of safety, and low enough that most accounts are never touched.

## 2f. The ladder, and where it cannot be measured yet

Same method, three account ratings. Each run is one game; the band is the target
the model was given, the delivery is what the panel measured at the move.

| Account | Band (cp/move) | Delivered | Moves measured | Note |
| --- | --- | --- | --- | --- |
| 133 | 270-320 | 339-343, then **261** | 20, 14 | improvised share 0.71, then 0.93 after 1.82.0 |
| 600 | 200 | 159, then **236** | 20 each | improvised share 0.48, then 0.60 after 1.81.0 |
| 1320 | 60 | **2** | 18 | engine-best opponent; zero improvised moves in the game |

The random opponent is only a stand-in at the bottom of the ladder: it takes
material, which is what a 133 does, and it hands the game over, which is what a
1320 does not. Against an engine-best opponent instead, a 1320 account delivered
**2 cp/move** over 18 plies, against a 60 cp band, with **no improvised move at
all**: the improvisation chance at that band is (60-8)/400 = 0.13, so the game
was 18 near-optimal moves. Two defects fall out of that: the band is unreachable
by construction at the top (13% of moves cannot carry a 60 cp average unless each
costs 460), and the subtraction is self-consistent — both evaluations come from
the same weakened search, so a loss measured against the engine's own limited
view is a lower bound, not the loss against a full-strength reference.

The 600 rung is 20% under its band for a structural reason: only 48% of the moves
are improvised at that rating and the rest are near-best, so the mean is diluted
below the per-move target. Whether to compensate by scaling the per-move target is
a decision for the next release, not a number to invent now.

## 2e. Measured delivery, against two kinds of opponent

Apology first: until 1.70.0 the panel's loss/move was only recorded when the
opponent was slow, because the sample was keyed on `prevSnapshot` landing between
the two plies. Against a fast opponent, 17 improvised moves produced one
measurement. The numbers below are from after that fix.

Two opponents, both on the real analysis board, script driven through synthetic
pointer events on chess.com's handlers:

- **Engine-best**: the position is analysed and the opponent plays Stockfish's
  first choice. It declines most of the material a beginner move offers.
- **Same-level**: the opponent plays a uniformly random legal move, which is a
  stand-in for a 133 account rather than a model of it. It takes material, and it
  takes nothing back.

| Release | Opponent | Plies measured | Delivered ACPL at a 133 |
| --- | --- | --- | --- |
| 1.65.2 | engine-best | 26 | 118 |
| 1.66.0 | engine-best | 26 | 62 |
| 1.67.0 | engine-best | 26 | 105 |
| 1.70.0 | same-level | 16 | 100 |
| 1.71.0 | same-level | 12 | 7 |
| 1.72.0 | same-level | 17 | 32 |
| 1.73.0 | same-level | 14 | 82 |
| 1.75.0 | same-level | 20 | **343** |
| 1.76.0 | same-level | 20 | **339** |

**The measurement changed on 2026-11-27 and the numbers with it.** Everything
above that is labelled "old metric" measured my loss after the opponent's reply,
which refunds the mistake whenever the opponent errs; the ACPL convention compares
the eval before the move with the eval of the position it creates. Two runs of the
new definition at a 133 account: **343 and 339 cp/move**.

Band for a 133 account: 270-320 cp/move. Under the ACPL definition the delivery
is 339-343, inside the band's ceiling rather than a third of it — and the 82 was a
measurement error, not a strength result. What the table does show is the direction of
travel and where it came from: the restricted multi-move search was pricing moves
inaccurately (a candidate priced 293 realised 0), 1.72.0 used the same depth and
1.73.0 verifies each of the three best candidates with a plain full search before
committing, which nearly tripled the delivered number.

Reproducing this needs `?cw=1`, a fake `(133)` rating node, and a loop that
alternates `playNow()` with a random legal move from `ChessWraith.legalMoves()`.
## 2d. The ACPL band is an extrapolation, and the data says so

The band (270-320 cp/move at a 133 account) has no direct dataset behind it. The
nearest public one is a per-band sample of Lichess blitz games analysed in bulk
(`chessanalysis.co`):

| Chess.com band | Games | Average CPL | Blunder rate |
| --- | --- | --- | --- |
| 500-700 | 68,678 | 181.9 | 19.2% |
| 700-900 | 68,203 | 177.2 | 19.3% |
| 800-1100 | 68,351 | 169.0 | 19.0% |
| 1100-1300 | 69,081 | 161.2 | 18.5% |
| 1300-1600 | 66,704 | 155.7 | 18.3% |
| 1600-1800 | 75,412 | 149.7 | 18.2% |

Two things follow. First, every band measured is below 133's 270-320, so the band
is an extrapolation past the end of the data, not a measurement. Second, the
blunder rate barely moves from 600 to 1700 (19.2% to 18.2%): a sample that cannot
separate those two players cannot be used to place a 133. The band stays as a
design parameter, and the review says so next to the numbers it produces.
Source: [chessanalysis.co CPL by rating](https://chessanalysis.co/research/lichess-blitz-accuracy-by-rating).

## What the 2026 public scripts ship, and what none of them does

Read on 2026-11-26 from GreasyFork and GitHub, not from their screenshots:

| | Complete Move Guide (563087) | Chess.com Bot 7.1 (597658) | chess-sniper | Chessvision.ai | chess.com Game Review | chess-wraith 1.58.0 |
|---|---|---|---|---|---|---|
| Move source | local Stockfish, depth 1–25 | Stockfish 16 WASM NNUE | native Stockfish via a Python bridge | its own cloud engine | server-side, after the game | Stockfish 19 NNUE in a blob worker |
| Shown on the board | from/to circles | tactical threats, undefended pieces | no overlay | scans a diagram, not the live board | arrows inside the review page | green move arrow + red reply arrow |
| Follows the account's rating | no | no | no (it is built for maximum strength) | n/a | n/a | `UCI_Elo` + pace + slack, per account |
| Plays by itself | no | yes, with a human delay | yes (snipe targets) | no | no | yes, with measured pacing and AFK rematch |
| Persistence | none | none documented | `config.json` on disk | account | cloud | per-account settings, session, pace, history, reports |
| Tests in the repo | none | none | none | closed source | n/a | 230 node tests, 7 of them boot the whole script |
| Fair-play stance | silent | silent | advertises streamsniping | training tool | official | states the risk and refuses to hide it |

Two things stand out. First, none of the public scripts anchors the engine to the
**account's own published rating**; they either play full strength or expose a
depth slider, so the account's moves do not match the account's history — the one
statistical signal chess.com's fair-play page says it weighs most. Second, the
ones that do play for you have no test suite; chess-sniper needs a native
Stockfish install and a Python bridge, which rules out the one-tab model.

Sources: [563087](https://greasyfork.org/en/scripts/563087-chess-com-complete-move-guide),
[597658](https://greasyfork.org/en/scripts/597658-chess-com-bot-stockfish-16-wasm-nnue-tactical-analysis-reupload),
[chess-sniper](https://github.com/Akira-Development-Team/chess-sniper),
[chessvision.ai](https://chessvision.ai/),
[Game Review](https://support.chess.com/en/articles/8584089-how-does-game-review-work),
[fair play](https://www.chess.com/cheating).

## 3. How this compares with nitro-wraith

| | `nitro-wraith` | `chess-wraith` |
| --- | --- | --- |
| Delivery | Tampermonkey userscript | same |
| Heavy lifting | none (typing) | Stockfish 19 NNUE in a blob worker |
| Input | synthetic `KeyboardEvent` | synthetic `PointerEvent` |
| Account model | per-account pace ceiling from the account's own top speed | published rating per time class + learned pace + opening memory + earned accuracy slack, all keyed by username |
| Session model | queue with breaks, DQ streak handling | AUTO always on, rematch loop, optional hidden-tab keep-alive, hand-on-board stop |
| Tests | 27 files | 230 tests in 27 files (7 of them boot the whole script) |
| Release | dispatch, gated by checks | same, plus a version/mirror gate |

The gap that remains is verification: nitro-wraith has a test file per module and
a canary workflow against the live site; this repo has unit tests for the pure
logic and manual live probes. That is the honest difference between the two,
not the features.

