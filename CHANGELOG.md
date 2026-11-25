# Changelog

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
