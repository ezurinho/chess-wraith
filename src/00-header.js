// ==UserScript==
// @name         CHESS WRAITH
// @namespace    chess.wraith
// @version      1.45.0
// @updateURL    https://github.com/ezurinho/chess-wraith/releases/latest/download/chess-wraith.meta.js
// @downloadURL  https://github.com/ezurinho/chess-wraith/releases/latest/download/chess-wraith.user.js
// @description  Human-paced Chess.com assistant: local Stockfish 19 NNUE, evaluation, candidate lines and optional auto-play that waits like a person and stops when something needs you. One account, no passwords, no telemetry.
// @homepageURL  https://github.com/ezurinho/chess-wraith
// @supportURL   https://github.com/ezurinho/chess-wraith/issues
// @author       CHESS WRAITH
// @match        https://www.chess.com/*
// @icon         https://raw.githubusercontent.com/ezurinho/chess-wraith/main/assets/logo.svg
// @license      MIT
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

/*
===================================================================================
QUICK CONFIGURATION
===================================================================================

Everything adjustable lives in CONFIG, in src/10-config.js, and at runtime in the
panel's gear menu. Nothing is hidden:

  CONFIG.autoPlayOnLoad -> false: auto-play never starts by itself.
  CONFIG.targetElo      -> strength requested from Stockfish (UCI_Elo).
  CONFIG.style          -> 'adaptive' studies your opponent, 'gm'/'club'/'casual'
                           are fixed levels, 'engine' is full strength.
  CONFIG.maxDepth       -> search depth ceiling per position.
  CONFIG.moveTimeMs     -> search time ceiling per position.
  CONFIG.humanSlackCp   -> centipawns of slack used to pick a human-looking
                           move instead of always move #1.

Auto-play is OFF on first run and stays off across restarts until you turn it on
in the panel or press Alt+Shift+A. Nothing is sent anywhere: the engine, the
board reader and the panel all run in this tab.
*/
