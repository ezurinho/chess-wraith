# src/

One IIFE, eleven fragments, concatenated in this order by `tools/build.js`.

| Fragment | Owns | Does not |
| --- | --- | --- |
| `00-header.js` | Userscript metadata and the quick-config note. | Implement anything. |
| `10-config.js` | `VERSION`, `CONFIG`, `LEGIT`, the pinned engine mirror. | Read the DOM. |
| `20-utils.js` | clamp/sleep/random, settings persistence, Elo→skill, NNUE cache, search budget. | Touch the page. |
| `30-chess.js` | Rules, move generation, FEN, SAN, UCI parsing, `ChessStateTracker`, `inferMidgameState`. | Know about chess.com markup. |
| `35-chess-glue.js` | Exposes the rules engine as `globalThis.ChessBenchLogic`. | Hold state. |
| `40-board.js` | Every chess.com selector: grid, orientation, move list, clocks, highlights, modal. | Decide what to play. |
| `50-engine.js` | Worker spawn, UCI lifecycle, WDL/MultiPV formatting, watchdog, NNUE retry. | Choose moves. |
| `60-analysis.js` | `sideScore`, `effectiveElo`, style profiles, `chooseMove`, `computeDelay`. | Touch the DOM. |
| `65-afk.js` | Rematch choice, next-game delay, keep-alive audio. | Know the game state. |
| `70-input.js` | Synthetic pointer input (click and drag) and the landed-move check. | Decide legal moves. |
| `80-panel.js` | Closed Shadow DOM panel, CSS, views, settings handlers. | Read the board. |
| `90-boot.js` | Orchestrator: scan → tracker → engine → delay → play → verify, AFK, hotkeys, account rating, debug API. | Contain business rules. |

The rules engine is the only fragment with no DOM dependency and the only one
with a `module.exports` guard, which is why the tests can `require` it directly.
