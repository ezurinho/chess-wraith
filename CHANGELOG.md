# Changelog

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



