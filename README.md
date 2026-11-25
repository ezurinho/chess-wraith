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
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-1.0.0-5CF2A0?style=flat-square&labelColor=0B1711" alt="version"></a>
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#controls">Controls</a> ·
  <a href="#what-it-does">What it does</a> ·
  <a href="#honest-limits">Honest limits</a> ·
  <a href="#development">Development</a> ·
  <a href="CHANGELOG.md">Changelog</a>
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
| **Step** / `Alt+Shift+M` | Plays the current suggestion once, even with auto-play off. |
| **Scan** | Re-reads the board and re-runs the engine now. |
| **⚙** | Style, target Elo, depth, think time, delay window, slack, line count. |
| **–** / double-click the header | Collapses the panel to a header. |
| **Hide** / `Alt+Shift+H` | Hides the panel completely; the script keeps running. |
| Header drag | Moves the panel anywhere. |

## What it does

| Area | Behaviour |
| --- | --- |
| **Board reading** | Grid, orientation, ply/SAN move list, last-move highlights, clocks, opponent rating and the game-over modal, straight from the DOM. |
| **Engine** | Stockfish 19 NNUE (Lite, single thread) compiled to WASM and started in a blob worker, with WDL win/draw/loss and MultiPV. A pure-JS `stockfish.js` is the fallback. |
| **Analysis** | Evaluation from White's point of view, best move in SAN, candidate lines with depth, and the engine's own strength limiter (`UCI_Elo`) when a style asks for it. |
| **Styles** | `adaptive` (studies the opponent, then plays slightly above them), `gm`, `club`, `casual` and `full engine`. |
| **Pacing** | Delays inside your own window with capture/check nudges, faster play on a low clock, and a governor that stops it from taking move #1 every single turn. |
| **Verification** | After playing, it re-reads the board. If the move did not land it retries once, then pauses auto-play and says why. |
| **Pauses** | Game over, promotion dialog, premove on the board, low clock, hidden tab. |
| **Panel** | Closed Shadow DOM, no page styles and no light-DOM ids, draggable and collapsible. |

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
- **Not tested on a live rated game.** Verified on the live analysis board:
  board reading in both orientations, clocks, highlights, SAN list, synthetic
  click and drag moves, engine boot and a full auto-play turn.

## How the engine is loaded

The userscript is a single file; the 1.8 MB engine is not embedded. On boot it
fetches `vendor/stockfish-19-lite-single.js` from this repo through jsDelivr,
prefixes it with a small shim that points the `.wasm` request at the matching
mirror URL, and starts it as a blob worker. If that fails it falls back to
`vendor/stockfish.js` (no WASM). Nothing is fetched from anywhere else.

## Development

```sh
npm ci
npm run build        # src/*.js  ->  chess-wraith.user.js + .meta.js
npm run build:check  # fails if the committed bundle is stale
npm run lint
npm test             # node --test tests/unit/*.test.js
npm run check        # all of the above, in CI order
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
| `src/70-input.js` | Synthetic pointer input (click and drag). |
| `src/80-panel.js` | Shadow-DOM panel. |
| `src/90-boot.js` | Orchestrator and `window.ChessWraith` debug API. |
| `tools/build.js` | Concatenator and `--check` guard. |
| `tests/unit/` | Perft, SAN replay, UCI parsing, selection, pacing, bundle integrity. |

The rules engine is checked with real perft counts: `20 / 400 / 8902` from the
start position, `48 / 2039` on Kiwipete and `14 / 191 / 2812` on the en-passant
position. Move selection and pacing are property-tested over hundreds of draws.

`window.ChessWraith` is left available for debugging (`state`, `board()`,
`analyzeNow()`, `playNow()`, `unload()`).

## License

MIT for the userscript. Bundled Stockfish builds are GPLv3 — see
[`vendor/Copying.txt`](vendor/Copying.txt).
