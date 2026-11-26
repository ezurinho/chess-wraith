<div align="center">
  <img src="assets/hero.jpg" width="100%" alt="CHESS WRAITH">
</div>

<p align="center">
  <img src="assets/logo.svg" width="56" alt="">
</p>

<h1 align="center">CHESS WRAITH</h1>

<p align="center">
  <strong>Chess.com, at your pace.</strong><br>
  A Tampermonkey userscript that runs Stockfish locally, shows what it sees,
  and optionally plays for you with human timing.
</p>

<p align="center">
  <a href="https://github.com/ezurinho/chess-wraith/releases/latest/download/chess-wraith.user.js"><img src="https://img.shields.io/badge/install-userscript-5CF2A0?style=flat-square&labelColor=0B1711" alt="Install CHESS WRAITH"></a>
  <a href="https://github.com/ezurinho/chess-wraith/releases/latest"><img src="https://img.shields.io/github/v/release/ezurinho/chess-wraith?style=flat-square&label=release&labelColor=0B1711&color=62E2D0" alt="Latest release"></a>
  <a href="https://github.com/ezurinho/chess-wraith/actions/workflows/check.yml"><img src="https://github.com/ezurinho/chess-wraith/actions/workflows/check.yml/badge.svg?branch=main" alt="check"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-FFC66D?style=flat-square&labelColor=0B1711" alt="MIT license"></a>
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-1.41.0-5CF2A0?style=flat-square&labelColor=0B1711" alt="version"></a>
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#controls">Controls</a> ·
  <a href="#what-it-does">What it does</a> ·
  <a href="#honest-limits">Honest limits</a> ·
  <a href="#development">Development</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

<p align="center">
  <img src="assets/panel-live.png" width="90%" alt="CHESS WRAITH live panel beside a chess.com analysis board">
</p>

<p align="center">
  <img src="assets/panel-tune.png" width="70%" alt="CHESS WRAITH settings view">
</p>

> One tab, one account, no passwords. The engine, the board reader and the
> panel all run locally; nothing is uploaded and there is no telemetry.

CHESS WRAITH reads the board chess.com already rendered, asks a local Stockfish
19 NNUE for its opinion, and — only if you turn auto-play on — plays a move with
a delay and an input path that a person could have produced.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or Violentmonkey).
2. Open **[chess-wraith.user.js](https://github.com/ezurinho/chess-wraith/releases/latest/download/chess-wraith.user.js)** and confirm the install.
3. Open any game, bot match or analysis board on `https://www.chess.com`.
4. The panel appears in the top-right corner. Auto-play is **off** until you press **Auto** (or `Alt+Shift+A`).

The first run downloads the engine from jsDelivr, once. After that your browser
cache serves it and the whole thing works offline.

## Controls

| Control | What it does |
| --- | --- |
| **Auto** / `Alt+Shift+A` | Turns auto-play on or off. The setting survives reloads. |
| **AFK** / `Alt+Shift+F` | Rematch, keep-alive and play-while-hidden in one switch. |
| Rail (left icons) | Live, Tune and Info views; drag the title to move the panel. |
| Swatches in Tune | Six themes: Carbon, Aurora, Sunset, Ice, Violet, RGB. |
| **Step** / `Alt+Shift+M` | Plays the current suggestion once, even with auto-play off. |
| **Scan** | Re-reads the board and re-runs the engine now. |
| **⚙** | Target Elo (`0` = your own), depth, think time, delay window, slack, line count. |
| **–** / double-click the header | Collapses the panel to a header. |
| **Hide** / `Alt+Shift+H` | Hides the panel completely; the script keeps running. |
| **Stop** / `Alt+Shift+S` | Panic stop: auto-play off, AFK off, search cancelled, timers cleared, panel hidden. |
| Header drag | Moves the panel anywhere. |

## Shipping

Every change is released: `npm run ship <x.y.z> "<title>"` prepares the version,
runs the full check, commits, tags, pushes and publishes the release, then waits
until jsDelivr serves the new tag. A failing check never reaches a tag.

## What it does

| Area | Behaviour |
| --- | --- |
| **Board reading** | Grid, orientation, move list (`data-ply` or `.node` rows), last-move highlights, clocks, opponent rating and the game-over modal, straight from the DOM. |
| **Turn detection** | The turn is taken from the move list, the running clock or the last-move highlight, and the source is recorded. When none of the three is readable the panel says `turn not readable; not playing` and nothing is played on a guess. |
| **Engine** | Stockfish in a blob worker. It tries Stockfish 19 NNUE (Lite, single thread, WASM, WDL + MultiPV) first and falls back to the bundled Stockfish 2019 JS build when the NNUE build cannot resolve its `.wasm` from a blob worker. The panel always shows which one is running. Search time follows the material: 0.85× in the opening, 1.35× with ten men or fewer, because that is where a game is converted or thrown away. |
| **Analysis** | Evaluation from White's point of view, best move in SAN, candidate lines with depth, and the engine's own strength limiter (`Skill Level`) tuned to the rating on the board. |
| **After an AFK night** | The panel keeps the last five transitions (session limit, AFK stopped, manual move suspected, rematch pressed) and shows the newest two with a `HH:MM`. The history is per account and survives a reload, so a Tampermonkey update at 03:00 does not erase the night; lines from another day keep their date (`24/11 23:40`). The tooltip has all five, and the bug report carries them. |
| **Session limits that survive a reload** | The AFK limits (15 games / 3 h by default) used to reset with the page: a Tampermonkey update at 03:00 turned `9 of 15` back into `1 of 15`. The run is now written per account and restored while it is still the same run — switching auto play off, or the limit firing, starts a new one. |
| **Promotion under a flag** | The promotion dialog is painted after the drop, so it is polled — eight looks over 840 ms. That budget is fine with a minute on the clock and fatal with two seconds, so below 8 s the poll speeds up (40 ms looks) and spends at most a third of what is left. |
| **Floor** | Stockfish's `UCI_Elo` bottoms out at 1320 (`src/search.h`, `LowestElo`). An account below that used to be aimed at a number the engine cannot take and told nothing; the panel now says `1320 · floor` and the move window widens with the gap (up to 120 cp of extra slack), so a 900-rated account gets loose choices instead of a 1320 engine pretending to be 900. |
| **One way to play** | No `GM`/`rage`/`full engine` presets and no switch out of it: the panel shows `LEGIT` and means it. The strength is anchored to your own published rating and may drift only 75 cp below or 25 above it (your target Elo ihen nobody is measured yet), the chosen move stays within the slack band of the best one, and the engine is never asked for its raw best line — there is no deliberate-miss dice either. Form moves that number by up to 30 points per game (keyed by the account and the game number, so the same game always asks for the same strength), never past the 75/25 envelope. |
| **Pacing** | Delays inside your own window, moved by the gap between the top two lines (±18–28%), checks (+12%), captures (−8%), the phase, the time control (bullet plays at half the delay, rapid at 1.15× — but only when the rhythm was learned locally, never on top of a median that was already measured for that exact class), a forced move at 45%, a 3.5% chance of a rare second thought, faster play on a low clock and a 2%-an-hour session drift capped at 6%. The window stays inside 0.65×–1.5× of this account's own rhythm and never below 35% of the opponent's think time. The rhythm itself is measured, not guessed: the median `%clk` of the account's own moves in its last 40 games of the same time class (the opponent's clocks are in the same PGN and are ignored), falling back to the locally learned sample, then to class defaults (bullet 0.7 s, blitz 1.6 s and rapid 5.5 s, each from chess.com's own archive; the rapid leaderboard itself medians 4.3 s) so a fresh profile does not open a rapid game at blitz speed. It is also capped at a eighteenth of the remaining clock, so a six second median does not flag the account. |
| **Your own rating** | Once per six hours, and again during a session once three games and twenty minutes have gone by (a night of wins moves the account; the engine has to follow it), the public profile endpoint is asked for the signed-in account's rating in every time class. The class on the board (bullet/blitz/rapid/daily, derived from the clock) picks the anchor; the panel shows `1840 blitz` and `Playing at 1840 · acct`. A rating with fewer than 20 games in that class is shrunk towards the prior by how much of its Glicko-2 uncertainty is left, and the panel says `· prov` instead of `· acct`: a 2100 with two games aims at 1583, not at 2100. No rating, a blocked request or a signed-out browser falls back to the manual Target Elo, then to 1500. |
| **Per account** | Everything is per signed-in username: settings (depth, delay, slack, theme), the rating anchor, the published and learned pace, the opening memory and the accuracy-guard slack. A second account on the same browser starts from its own defaults, not from the first account's tuning. The username is read from the navbar and, if that has not painted yet, from chess.com's own session object. |
| **Hand on the board** | A click outside the panel defers the pending move for 2 s, twice; after that the script stops and says `paused: your hand is on the board`. |
| **Variety** | Your first two plies are remembered locally; a first move repeated three times in six games drops to 28% weight, and a governor keeps it off move #1 every single turn. |
| **AFK** | After a game ends it waits a human pause (1.7–4.2 s, 12% of the time 5–9.5 s), presses Rematch or the shortest new game on screen, and re-arms auto-play when the next board appears. If no button is offered it stops and says so. Optional keep-alive audio keeps the hidden tab awake, and the panel reports `on`, `blocked` or `off`. |
| **Session cap** | 15 games or 3 hours, whichever comes first (`sessionMaxGames`, `sessionMaxMs` in `src/10-config.js`). When it trips, auto-play and rematch stop and the panel says `session limit: 15 games` or `session limit: 3h`. Reloading the page starts a new session. |
| **Takeover** | A move on your turn that the script did not click pauses auto-play with `paused: manual move detected`. It takes two scans of the same position, because one scan can catch the board mid-paint. Only fires on a board with a real clock and a certain turn, so the analysis board never triggers it. |
| **One tab** | A lease in `localStorage`, renewed every 3 s. A second tab on the same board goes passive and says `another tab is playing`; closing a tab releases the lease on unload. |
| **Accuracy guard** | `acplBand(elo)` is the loss a human at that rating averages per move. Past 15 assessed moves, an account under 45% of its band gets 12 cp of extra slack at a time (cap 160) for that session; over twice the band, it gives it back. Your saved setting is never rewritten. |
| **Verification** | After playing, it re-reads the board. If the move did not land it retries with the other gesture, then re-arms the same move up to three times (0.9 s, 1.8 s, 2.7 s) before stopping with `the board is not taking moves`. A promotion dialog is waited for (up to ~1 s) instead of clicked blind. |
| **No stalls** | A 2 s tick that sees your turn, a fresh analysis and nothing armed re-arms the move: the panel used to say `playing` while a swallowed callback left it sitting there. |
| **Hidden tab** | Chrome batches a hidden tab's timers to roughly one per minute, and chess.com keeps the clock running either way. A 1 s worker ticker pings the page while the tab is out of sight; a worker's timer budget is separate in most browsers, though that is not a documented guarantee. The reliable half is the detection: when the 2 s tick itself arrives more than 1.8× late the panel says `tab hidden · timers batched`, so the user knows it is the tab and not the board. |
| **Pauses** | Game over, promotion dialog, premove on the board, low clock, hidden tab while AFK is off. |
| **Updates** | The panel checks `cdn.jsdelivr.net/gh/ezurinho/chess-wraith@latest/package.json` on boot and every six hours (GitHub's release API as fallback), and again whenever you come back to the tab, the window regains focus or the network returns, at most once every five minutes. The last answer is cached, so a reload paints the `UPDATE vX.Y.Z` pill immediately instead of four seconds later. Both requests are public static files; nothing about the account leaves the tab. |
| **Panel** | Closed Shadow DOM, no page styles and no light-DOM ids, draggable and collapsible. A target strip with the accuracy band and a fill bar, live ACPL, the opponent estimate, your pace, their tempo, games played, time left and an account card with the signed-in user. |

## Honest limits

- **This is cheating.** chess.com's Fair Play policy forbids engine assistance in
  rated games. Detection is behavioural as well as client-side; a userscript
  cannot promise you will not be flagged. Use it on accounts you are willing to
  lose, and never in a rated game you care about.
- **It is not "undetectable".** Nothing here defeats a review of your games. The
  pacing and the move-choice governor reduce the obvious *signals* (instant
  moves, identical engine #1 every turn) — that is all they do.
- **Server-side checks are out of reach.** Premove handling, clock arbitration
  and result reporting happen on chess.com's servers. The script only drives the
  client it can see.
- **DOM changes break the reader.** chess.com ships UI changes; when the board
  markup changes, the selectors in `src/40-board.js` need updating. The panel
  will show `waiting for a board…` instead of failing silently.
- **NNUE is not guaranteed.** Stockfish 19 Lite WASM boots in ~110 ms here and
  runs at ~776 kN/s single-threaded, but it depends on a 1.2 MB download from
  jsDelivr and on `WebAssembly` inside a blob worker. If either is blocked the
  script falls back to the 2019 JS build, which is weaker and has no WDL bar.
  The panel always names the engine that is running.
- **Synthetic events are not trusted events.** Moves are dispatched as
  `PointerEvent`s; `event.isTrusted` is `false` for them and no userscript can
  change that (see [research](docs/research.md)). If chess.com ever checks that
  flag on move input, this approach is done and only a real extension driving the
  browser would work.
- **Not tested on a live rated game.** Verified on the live analysis board and
  in a headless browser against today's markup: board reading in both
  orientations, start position and mid-game grids, engine boot with the JS
  fallback, analysis and panel rendering. The clock path, the premove check and
  the promotion dialog are code-reviewed, not reproduced: there are no clocks on
  the analysis board, and a rated game needs the account.
- **A mid-game analysis board is not playable.** Chess.com's board has no clock
  and (until you load a game) no move list there, so the turn cannot be known.
  The panel says so instead of guessing.

## How the engine is loaded

The userscript is a single file; the 1.2 MB engine is not embedded. On boot it
fetches `vendor/stockfish-19-lite-single.js` through jsDelivr, prefixes it with a
shim and starts it as a blob worker. The shim exists because the build asks for
its wasm at a URL it builds from `self.location.href` plus a content hash
(`https://www.chess.comhttps://www.chess.com/554211df-…`); a blob worker has no
directory to resolve that against, so every request that is not the engine's own
script is answered with the wasm bytes from the mirror. `uciok` arrives in about
110 ms and the panel shows `Stockfish 19 NNUE` with WDL.

If the worker does not answer within four seconds, or the boot throws, the script
falls back to `vendor/stockfish.js` (Stockfish 2019, no WASM) from the same
mirror. Nothing is fetched from anywhere else.

Measured on chess.com, MultiPV 3 with WDL:

| Build | Boot | Speed | WDL |
| --- | --- | --- | --- |
| `stockfish-19-lite-single` (WASM) | ~110 ms | ~776 kN/s, depth 18 in 1.7 s | yes |
| `stockfish.js` (2019, asm.js) | ~600 ms | ~40–60 kN/s | no |


The mirror URL is pinned to a release tag and never to `@main`: the engine runs
with chess.com's origin, so the bytes behind it must not change without a tag.
`tools/release.js` moves the pin when it bumps the version, and CI fails when the
pin, the package, the header, the README badge and the CHANGELOG disagree.

A failed NNUE boot is remembered for seven days per mirror so the four second
handshake is not paid on every page load; a successful boot clears the marker,
which is how the 1.3.0 fix reached browsers that had cached the old failure.
`ChessWraith.retryEngine()` (debug API) clears it by hand, and
`ChessWraith.selftest()` reports version, board, tracker, engine, panel bindings,
storage, rating, update state, the `%clk` parser and the delay bounds in one call.

## Development

```sh
npm ci
npm run build        # src/*.js  ->  chess-wraith.user.js + .meta.js
npm run build:check  # fails if the committed bundle is stale
npm run lint
npm test             # node --test "tests/unit/*.test.js" (90, incl. jsdom and engine fixtures)
npm run check        # all of the above, in CI order
node tools/release.js check   # package, header, README badge and CHANGELOG agree
```

| Path | Purpose |
| --- | --- |
| `src/00-header.js` | Userscript metadata and the quick-configuration note. |
| `src/10-config.js` | `CONFIG`, styles, engine mirror URLs. |
| `src/20-utils.js` | Clamp/sleep/random helpers and settings persistence. |
| `src/30-chess.js` | Rules engine: move generation, FEN, SAN, tracker, UCI parsing. |
| `src/40-board.js` | chess.com board reader. |
| `src/50-engine.js` | Stockfish worker, UCI lifecycle, WDL/MultiPV formatting. |
| `src/60-analysis.js` | Move selection, style profiles, pacing. |
| `src/65-afk.js` | Rematch decision, next-game timing, audio keep-alive. |
| `src/70-input.js` | Synthetic pointer input (click and drag). |
| `src/80-panel.js` | Shadow-DOM panel. |
| `src/90-boot.js` | Orchestrator and `window.ChessWraith` debug API. |
| `tools/build.js` | Concatenator and `--check` guard. |
| `tools/release.js` | Version bookkeeping: `check`, `prepare <version>`, `notes <version>`. |
| `tests/unit/` | Perft, SAN replay, UCI parsing, turn certainty, selection, pacing, bundle integrity, version drift. |

The rules engine is checked with real perft counts: `20 / 400 / 8902` from the
start position, `48 / 2039` on Kiwipete and `14 / 191 / 2812` on the en-passant
position. Move selection and pacing are property-tested over hundreds of draws.

For debugging, `window.ChessWraith` (`state`, `board()`, `analyzeNow()`,
`playNow()`, `retryEngine()`, `unload()`) is opt-in: open the page with `?cw=1` or set
`localStorage['chess-wraith-debug'] = '1'`. Without it nothing is added to the
page's global scope.

## License

MIT for the userscript. Bundled Stockfish builds are GPLv3 — see
[`vendor/Copying.txt`](vendor/Copying.txt).
