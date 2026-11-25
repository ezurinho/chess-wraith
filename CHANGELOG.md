# Changelog

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


