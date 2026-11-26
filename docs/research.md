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

## 3. How this compares with nitro-wraith

| | `nitro-wraith` | `chess-wraith` |
| --- | --- | --- |
| Delivery | Tampermonkey userscript | same |
| Heavy lifting | none (typing) | Stockfish 19 NNUE in a blob worker |
| Input | synthetic `KeyboardEvent` | synthetic `PointerEvent` |
| Account model | per-account pace ceiling from the account's own top speed | published rating per time class + learned pace + opening memory + earned accuracy slack, all keyed by username |
| Session model | queue with breaks, DQ streak handling | rematch loop, keep-alive, hand-on-board stop |
| Tests | 22 files | 163 tests in 22 files (7 of them boot the whole script) |
| Release | dispatch, gated by checks | same, plus a version/mirror gate |

The gap that remains is verification: nitro-wraith has a test file per module and
a canary workflow against the live site; this repo has unit tests for the pure
logic and manual live probes. That is the honest difference between the two,
not the features.

