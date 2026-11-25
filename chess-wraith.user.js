// ==UserScript==
// @name         CHESS WRAITH
// @namespace    chess.wraith
// @version      1.0.3
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

(function () {
'use strict';

const VERSION = '1.0.3';
const STORAGE_KEY = 'chess-wraith-settings-v1';

const CONFIG = {
  // Engine
  targetElo: 1650,
  style: 'adaptive', // 'adaptive' | 'gm' | 'club' | 'casual' | 'engine'
  maxDepth: 14,
  moveTimeMs: 700,
  multiPv: 4,
  hashMb: 32,

  // Pacing: the whole point of this script is that it does not look like a bot.
  autoPlayOnLoad: false,
  minThinkMs: 700,
  maxThinkMs: 4200,
  humanSlackCp: 40,
  clockFloorSeconds: 12,
  verifyMoveMs: 1400,
  retryMoveOnce: true,

  // Safety
  pauseWhenHidden: true,
  pauseOnLowClock: true,
  sideOverride: 'auto', // 'auto' | 'w' | 'b'
  onlyMyTurn: true,

  // Panel
  panelCollapsed: false,
  showLines: 3
};

// Public, user-facing presets. The panel writes these into CONFIG.
const STYLES = {
  // `miss` is the chance of a deliberate, capped inaccuracy: only the weaker
  // presets carry one, so "Casual" looks casual instead of merely random.
  adaptive: { elo: null, skill: 20, slack: 40, miss: 0.05, label: 'Adaptive' },
  gm: { elo: 2250, skill: 20, slack: 26, miss: 0, label: 'GM-like' },
  club: { elo: 1650, skill: 20, slack: 70, miss: 0, label: 'Club' },
  casual: { elo: 1350, skill: 20, slack: 120, miss: 0.12, label: 'Casual' },
  engine: { elo: null, skill: 20, slack: 0, miss: 0, label: 'Full engine' }
};

const ENGINE_MIRROR = 'https://cdn.jsdelivr.net/gh/ezurinho/chess-wraith@main/vendor';
const ENGINE_FILES = {
  nnueJs: `${ENGINE_MIRROR}/stockfish-19-lite-single.js`,
  nnueWasm: `${ENGINE_MIRROR}/stockfish-19-lite-single.wasm`,
  fallbackJs: `${ENGINE_MIRROR}/stockfish.js`
};


const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clampInt = (v, lo, hi, fallback) => {
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? fallback : clamp(n, lo, hi);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const gaussian = () => (Math.random() + Math.random() + Math.random()) / 3 - 0.5;

// Skill Level 0..20 is all the bundled 2019 engine honours; map the target Elo
// onto it so a "Club" preset is actually weaker, not just more random.
function eloToSkill(elo) {
  const value = Number(elo);
  if (!Number.isFinite(value) || value <= 0) return 20;
  const clamped = clamp(value, 1320, 3190);
  return Math.round(((clamped - 1320) / (3190 - 1320)) * 20);
}

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const merged = { ...CONFIG, ...raw };
    merged.style = pickEnum(merged.style, Object.keys(STYLES), CONFIG.style);
    merged.sideOverride = pickEnum(merged.sideOverride, ['auto', 'w', 'b'], 'auto');
    merged.targetElo = clampInt(merged.targetElo, 1320, 3190, CONFIG.targetElo);
    merged.maxDepth = clampInt(merged.maxDepth, 4, 20, CONFIG.maxDepth);
    merged.moveTimeMs = clampInt(merged.moveTimeMs, 150, 5000, CONFIG.moveTimeMs);
    merged.multiPv = clampInt(merged.multiPv, 1, 5, CONFIG.multiPv);
    merged.minThinkMs = clampInt(merged.minThinkMs, 250, 6000, CONFIG.minThinkMs);
    merged.maxThinkMs = clampInt(merged.maxThinkMs, 400, 15000, CONFIG.maxThinkMs);
    merged.humanSlackCp = clampInt(merged.humanSlackCp, 0, 300, CONFIG.humanSlackCp);
    merged.clockFloorSeconds = clampInt(merged.clockFloorSeconds, 3, 120, CONFIG.clockFloorSeconds);
    merged.autoPlayOnLoad = Boolean(merged.autoPlayOnLoad);
    merged.pauseWhenHidden = Boolean(merged.pauseWhenHidden);
    merged.pauseOnLowClock = Boolean(merged.pauseOnLowClock);
    merged.onlyMyTurn = Boolean(merged.onlyMyTurn);
    merged.panelCollapsed = Boolean(merged.panelCollapsed);
    merged.showLines = clampInt(merged.showLines, 1, 4, CONFIG.showLines);
    if (merged.maxThinkMs < merged.minThinkMs) merged.maxThinkMs = merged.minThinkMs;
    return merged;
  } catch {
    return { ...CONFIG };
  }
}

function saveSettings(cfg) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    /* storage can be blocked; the panel keeps the in-memory value */
  }
}

(function initChessBenchLogic(root) {
  'use strict';

  const FILES = 'abcdefgh';
  const START_PLACEMENT = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR';
  const START_FEN = `${START_PLACEMENT} w KQkq - 0 1`;

  function createEmptyGrid() {
    return Array.from({ length: 8 }, () => Array(8).fill(null));
  }

  function cloneGrid(grid) {
    return grid.map((row) => row.slice());
  }

  function gridsEqual(a, b) {
    if (!a || !b) return false;
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        if (a[r][f] !== b[r][f]) return false;
      }
    }
    return true;
  }

  function squareName(file, rank) {
    return `${FILES[file]}${rank + 1}`;
  }

  function parseSquare(sq) {
    if (!sq || typeof sq !== 'string' || sq.length < 2) return null;
    const file = FILES.indexOf(sq[0].toLowerCase());
    const rank = Number.parseInt(sq[1], 10) - 1;
    if (file < 0 || file > 7 || rank < 0 || rank > 7 || Number.isNaN(rank)) return null;
    return { file, rank };
  }

  function chessComClassToSquare(fileNum, rankNum) {
    const f = Number.parseInt(fileNum, 10) - 1;
    const r = Number.parseInt(rankNum, 10) - 1;
    if (f < 0 || f > 7 || r < 0 || r > 7 || Number.isNaN(f) || Number.isNaN(r)) return null;
    return squareName(f, r);
  }

  function pieceColor(ch) {
    if (!ch) return null;
    return ch === ch.toUpperCase() ? 'w' : 'b';
  }

  function chessComCodeToFenChar(code) {
    if (!code || code.length !== 2) return null;
    const color = code[0];
    const kind = code[1].toLowerCase();
    if ((color !== 'w' && color !== 'b') || !'prnbqk'.includes(kind)) return null;
    return color === 'w' ? kind.toUpperCase() : kind;
  }

  function gridToPlacement(grid) {
    const ranks = [];
    for (let r = 7; r >= 0; r--) {
      let row = '';
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const piece = grid[r][f];
        if (!piece) {
          empty++;
        } else {
          if (empty > 0) {
            row += String(empty);
            empty = 0;
          }
          row += piece;
        }
      }
      if (empty > 0) row += String(empty);
      ranks.push(row);
    }
    return ranks.join('/');
  }

  function placementToGrid(placement) {
    const grid = createEmptyGrid();
    const parts = String(placement || '').trim().split('/');
    if (parts.length !== 8) return null;
    for (let i = 0; i < 8; i++) {
      const rank = 7 - i;
      let file = 0;
      for (const ch of parts[i]) {
        if (ch >= '1' && ch <= '8') {
          file += Number.parseInt(ch, 10);
        } else if ('PNBRQKpnbrqk'.includes(ch)) {
          if (file > 7) return null;
          grid[rank][file] = ch;
          file++;
        } else {
          return null;
        }
      }
      if (file !== 8) return null;
    }
    return grid;
  }

  function formatCastling(c) {
    let out = '';
    if (c.K) out += 'K';
    if (c.Q) out += 'Q';
    if (c.k) out += 'k';
    if (c.q) out += 'q';
    return out || '-';
  }

  function parseCastling(str) {
    const s = str || '-';
    return {
      K: s.includes('K'),
      Q: s.includes('Q'),
      k: s.includes('k'),
      q: s.includes('q')
    };
  }

  function parseFen(fen) {
    const parts = String(fen || START_FEN).trim().split(/\s+/);
    const grid = placementToGrid(parts[0]);
    if (!grid) return null;
    return {
      grid,
      placement: parts[0],
      turn: parts[1] === 'b' ? 'b' : 'w',
      castling: parseCastling(parts[2] || '-'),
      ep: parts[3] && parts[3] !== '-' ? parts[3] : '-',
      halfmove: Number.parseInt(parts[4] || '0', 10) || 0,
      fullmove: Number.parseInt(parts[5] || '1', 10) || 1
    };
  }

  function buildFen(state) {
    const placement = state.placement || gridToPlacement(state.grid);
    const castlingStr = typeof state.castling === 'string' ? state.castling : formatCastling(state.castling || {});
    return `${placement} ${state.turn === 'b' ? 'b' : 'w'} ${castlingStr || '-'} ${state.ep || '-'} ${state.halfmove ?? 0} ${state.fullmove ?? 1}`;
  }

  function isValidBoardSnapshot(grid) {
    let wk = 0;
    let bk = 0;
    let total = 0;
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const p = grid[r][f];
        if (!p) continue;
        total++;
        if (p === 'K') wk++;
        if (p === 'k') bk++;
      }
    }
    return wk === 1 && bk === 1 && total >= 2 && total <= 32;
  }

  function findKing(grid, color) {
    const target = color === 'w' ? 'K' : 'k';
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        if (grid[r][f] === target) return { file: f, rank: r };
      }
    }
    return null;
  }

  function isSquareAttacked(grid, file, rank, byColor) {
    const pawnDir = byColor === 'w' ? -1 : 1;
    const enemyPawn = byColor === 'w' ? 'P' : 'p';
    for (const df of [-1, 1]) {
      const pf = file + df;
      const pr = rank + pawnDir;
      if (pf >= 0 && pf < 8 && pr >= 0 && pr < 8 && grid[pr][pf] === enemyPawn) {
        return true;
      }
    }

    const enemyKnight = byColor === 'w' ? 'N' : 'n';
    const knightDeltas = [
      [1, 2], [2, 1], [2, -1], [1, -2],
      [-1, -2], [-2, -1], [-2, 1], [-1, 2]
    ];
    for (const [df, dr] of knightDeltas) {
      const nf = file + df;
      const nr = rank + dr;
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8 && grid[nr][nf] === enemyKnight) {
        return true;
      }
    }

    const enemyKing = byColor === 'w' ? 'K' : 'k';
    for (let df = -1; df <= 1; df++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (df === 0 && dr === 0) continue;
        const kf = file + df;
        const kr = rank + dr;
        if (kf >= 0 && kf < 8 && kr >= 0 && kr < 8 && grid[kr][kf] === enemyKing) {
          return true;
        }
      }
    }

    const enemyBishop = byColor === 'w' ? 'B' : 'b';
    const enemyRook = byColor === 'w' ? 'R' : 'r';
    const enemyQueen = byColor === 'w' ? 'Q' : 'q';

    const ortho = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [df, dr] of ortho) {
      let cf = file + df;
      let cr = rank + dr;
      while (cf >= 0 && cf < 8 && cr >= 0 && cr < 8) {
        const p = grid[cr][cf];
        if (p) {
          if (p === enemyRook || p === enemyQueen) return true;
          break;
        }
        cf += df;
        cr += dr;
      }
    }

    const diag = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const [df, dr] of diag) {
      let cf = file + df;
      let cr = rank + dr;
      while (cf >= 0 && cf < 8 && cr >= 0 && cr < 8) {
        const p = grid[cr][cf];
        if (p) {
          if (p === enemyBishop || p === enemyQueen) return true;
          break;
        }
        cf += df;
        cr += dr;
      }
    }

    return false;
  }

  function isKingInCheck(grid, color) {
    const king = findKing(grid, color);
    if (!king) return false;
    return isSquareAttacked(grid, king.file, king.rank, color === 'w' ? 'b' : 'w');
  }

  function applyMoveToState(state, move) {
    const nextGrid = cloneGrid(state.grid);
    const { fromFile, fromRank, toFile, toRank, promotion } = move;
    const moving = nextGrid[fromRank][fromFile];
    const color = pieceColor(moving);
    const kind = moving.toLowerCase();
    const target = nextGrid[toRank][toFile];
    const castling = { ...state.castling };
    let nextEp = '-';
    let isCapture = Boolean(target);

    nextGrid[fromRank][fromFile] = null;

    // En passant capture
    if (kind === 'p' && state.ep && state.ep !== '-') {
      const epSq = parseSquare(state.ep);
      if (epSq && epSq.file === toFile && epSq.rank === toRank && !target) {
        nextGrid[fromRank][toFile] = null;
        isCapture = true;
      }
    }

    // Double pawn push sets ep square
    if (kind === 'p' && Math.abs(toRank - fromRank) === 2) {
      nextEp = squareName(fromFile, (fromRank + toRank) / 2);
    }

    // Castling rook shift
    if (kind === 'k' && Math.abs(toFile - fromFile) === 2) {
      if (toFile === 6) {
        nextGrid[fromRank][5] = nextGrid[fromRank][7];
        nextGrid[fromRank][7] = null;
      } else if (toFile === 2) {
        nextGrid[fromRank][3] = nextGrid[fromRank][0];
        nextGrid[fromRank][0] = null;
      }
    }

    // Update castling rights
    if (moving === 'K') {
      castling.K = false;
      castling.Q = false;
    } else if (moving === 'k') {
      castling.k = false;
      castling.q = false;
    }
    if ((fromFile === 0 && fromRank === 0) || (toFile === 0 && toRank === 0)) castling.Q = false;
    if ((fromFile === 7 && fromRank === 0) || (toFile === 7 && toRank === 0)) castling.K = false;
    if ((fromFile === 0 && fromRank === 7) || (toFile === 0 && toRank === 7)) castling.q = false;
    if ((fromFile === 7 && fromRank === 7) || (toFile === 7 && toRank === 7)) castling.k = false;

    let placed = moving;
    if (kind === 'p' && (toRank === 7 || toRank === 0)) {
      const promoChar = (promotion || 'q').toLowerCase();
      placed = color === 'w' ? promoChar.toUpperCase() : promoChar;
    }
    nextGrid[toRank][toFile] = placed;

    const nextTurn = color === 'w' ? 'b' : 'w';
    const halfmove = kind === 'p' || isCapture ? 0 : (state.halfmove || 0) + 1;
    const fullmove = color === 'b' ? (state.fullmove || 1) + 1 : (state.fullmove || 1);
    const placement = gridToPlacement(nextGrid);

    return {
      grid: nextGrid,
      placement,
      turn: nextTurn,
      castling,
      ep: nextEp,
      halfmove,
      fullmove,
      capturedPiece: isCapture ? (target || (color === 'w' ? 'p' : 'P')) : null,
      isCastling: kind === 'k' && Math.abs(toFile - fromFile) === 2,
      isEnPassant: kind === 'p' && !target && fromFile !== toFile
    };
  }

  function generatePseudoMoves(state) {
    const moves = [];
    const { grid, turn, castling, ep } = state;
    const enemy = turn === 'w' ? 'b' : 'w';
    const epSq = ep && ep !== '-' ? parseSquare(ep) : null;

    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const piece = grid[r][f];
        if (!piece || pieceColor(piece) !== turn) continue;
        const kind = piece.toLowerCase();

        if (kind === 'p') {
          const dir = turn === 'w' ? 1 : -1;
          const startRank = turn === 'w' ? 1 : 6;
          const promoRank = turn === 'w' ? 7 : 0;
          const r1 = r + dir;
          if (r1 >= 0 && r1 < 8 && !grid[r1][f]) {
            if (r1 === promoRank) {
              for (const promo of ['q', 'r', 'b', 'n']) {
                moves.push({ fromFile: f, fromRank: r, toFile: f, toRank: r1, promotion: promo, piece });
              }
            } else {
              moves.push({ fromFile: f, fromRank: r, toFile: f, toRank: r1, piece });
              const r2 = r + dir * 2;
              if (r === startRank && !grid[r2][f]) {
                moves.push({ fromFile: f, fromRank: r, toFile: f, toRank: r2, piece });
              }
            }
          }
          for (const df of [-1, 1]) {
            const cf = f + df;
            if (cf < 0 || cf > 7 || r1 < 0 || r1 > 7) continue;
            const target = grid[r1][cf];
            const isEp = epSq && epSq.file === cf && epSq.rank === r1 && !target;
            if ((target && pieceColor(target) === enemy) || isEp) {
              if (r1 === promoRank) {
                for (const promo of ['q', 'r', 'b', 'n']) {
                  moves.push({ fromFile: f, fromRank: r, toFile: cf, toRank: r1, promotion: promo, piece });
                }
              } else {
                moves.push({ fromFile: f, fromRank: r, toFile: cf, toRank: r1, piece });
              }
            }
          }
        } else if (kind === 'n') {
          const deltas = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
          for (const [df, dr] of deltas) {
            const nf = f + df;
            const nr = r + dr;
            if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
            if (!grid[nr][nf] || pieceColor(grid[nr][nf]) === enemy) {
              moves.push({ fromFile: f, fromRank: r, toFile: nf, toRank: nr, piece });
            }
          }
        } else if (kind === 'b' || kind === 'r' || kind === 'q') {
          const dirs = [];
          if (kind === 'b' || kind === 'q') dirs.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
          if (kind === 'r' || kind === 'q') dirs.push([1, 0], [-1, 0], [0, 1], [0, -1]);
          for (const [df, dr] of dirs) {
            let cf = f + df;
            let cr = r + dr;
            while (cf >= 0 && cf < 8 && cr >= 0 && cr < 8) {
              const target = grid[cr][cf];
              if (!target) {
                moves.push({ fromFile: f, fromRank: r, toFile: cf, toRank: cr, piece });
              } else {
                if (pieceColor(target) === enemy) {
                  moves.push({ fromFile: f, fromRank: r, toFile: cf, toRank: cr, piece });
                }
                break;
              }
              cf += df;
              cr += dr;
            }
          }
        } else if (kind === 'k') {
          for (let df = -1; df <= 1; df++) {
            for (let dr = -1; dr <= 1; dr++) {
              if (df === 0 && dr === 0) continue;
              const nf = f + df;
              const nr = r + dr;
              if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
              if (!grid[nr][nf] || pieceColor(grid[nr][nf]) === enemy) {
                moves.push({ fromFile: f, fromRank: r, toFile: nf, toRank: nr, piece });
              }
            }
          }
          const homeRank = turn === 'w' ? 0 : 7;
          if (f === 4 && r === homeRank && !isSquareAttacked(grid, 4, homeRank, enemy)) {
            const ks = turn === 'w' ? castling.K : castling.k;
            const qs = turn === 'w' ? castling.Q : castling.q;
            const rookChar = turn === 'w' ? 'R' : 'r';
            if (ks && grid[homeRank][7] === rookChar && !grid[homeRank][5] && !grid[homeRank][6] &&
                !isSquareAttacked(grid, 5, homeRank, enemy) && !isSquareAttacked(grid, 6, homeRank, enemy)) {
              moves.push({ fromFile: 4, fromRank: homeRank, toFile: 6, toRank: homeRank, piece });
            }
            if (qs && grid[homeRank][0] === rookChar && !grid[homeRank][3] && !grid[homeRank][2] && !grid[homeRank][1] &&
                !isSquareAttacked(grid, 3, homeRank, enemy) && !isSquareAttacked(grid, 2, homeRank, enemy)) {
              moves.push({ fromFile: 4, fromRank: homeRank, toFile: 2, toRank: homeRank, piece });
            }
          }
        }
      }
    }

    return moves;
  }

  function generateLegalMoves(state) {
    const pseudo = generatePseudoMoves(state);
    const legal = [];
    for (const move of pseudo) {
      const next = applyMoveToState(state, move);
      if (!isKingInCheck(next.grid, state.turn)) {
        legal.push({ ...move, nextState: next });
      }
    }
    return legal;
  }

  function moveToUci(move) {
    return `${squareName(move.fromFile, move.fromRank)}${squareName(move.toFile, move.toRank)}${move.promotion || ''}`;
  }

  function formatMoveSan(state, legalMoves, targetMove) {
    const piece = targetMove.piece;
    const kind = piece.toLowerCase();
    const toSq = squareName(targetMove.toFile, targetMove.toRank);
    const next = targetMove.nextState || applyMoveToState(state, targetMove);
    const inCheck = isKingInCheck(next.grid, next.turn);
    let suffix = '';
    if (inCheck) {
      const replies = generateLegalMoves(next);
      suffix = replies.length === 0 ? '#' : '+';
    }

    if (kind === 'k' && Math.abs(targetMove.toFile - targetMove.fromFile) === 2) {
      return (targetMove.toFile === 6 ? 'O-O' : 'O-O-O') + suffix;
    }

    const isCapture = Boolean(state.grid[targetMove.toRank][targetMove.toFile]) ||
      (kind === 'p' && targetMove.fromFile !== targetMove.toFile);

    if (kind === 'p') {
      const prefix = isCapture ? `${FILES[targetMove.fromFile]}x` : '';
      const promo = targetMove.promotion ? `=${targetMove.promotion.toUpperCase()}` : '';
      return `${prefix}${toSq}${promo}${suffix}`;
    }

    const siblings = legalMoves.filter(
      (m) =>
        m.piece === piece &&
        m.toFile === targetMove.toFile &&
        m.toRank === targetMove.toRank &&
        (m.fromFile !== targetMove.fromFile || m.fromRank !== targetMove.fromRank)
    );

    let disambig = '';
    if (siblings.length > 0) {
      const sameFile = siblings.some((m) => m.fromFile === targetMove.fromFile);
      const sameRank = siblings.some((m) => m.fromRank === targetMove.fromRank);
      if (!sameFile) {
        disambig = FILES[targetMove.fromFile];
      } else if (!sameRank) {
        disambig = String(targetMove.fromRank + 1);
      } else {
        disambig = `${FILES[targetMove.fromFile]}${targetMove.fromRank + 1}`;
      }
    }

    return `${kind.toUpperCase()}${disambig}${isCapture ? 'x' : ''}${toSq}${suffix}`;
  }

  function pvToSan(fen, uciMoves) {
    let state = parseFen(fen);
    if (!state || !Array.isArray(uciMoves)) return [];
    const out = [];
    for (const uci of uciMoves) {
      if (!uci || uci.length < 4) break;
      const legal = generateLegalMoves(state);
      const match = legal.find((m) => moveToUci(m) === uci.slice(0, 5));
      if (!match) {
        out.push(uci);
        break;
      }
      out.push(formatMoveSan(state, legal, match));
      state = match.nextState;
    }
    return out;
  }

  const FIGURINE_MAP = {
    '\u2654': 'K', '\u265A': 'K',
    '\u2655': 'Q', '\u265B': 'Q',
    '\u2656': 'R', '\u265C': 'R',
    '\u2657': 'B', '\u265D': 'B',
    '\u2658': 'N', '\u265E': 'N'
  };

  function normalizeSanToken(raw) {
    if (!raw || typeof raw !== 'string') return '';
    let s = raw.trim();
    for (const [glyph, letter] of Object.entries(FIGURINE_MAP)) {
      if (s.includes(glyph)) s = s.replaceAll(glyph, letter);
    }
    s = s.replace(/[+#!?]+$/g, '').replace(/\s+/g, '');
    if (s === '0-0' || s === '0-0-0') s = s.replaceAll('0', 'O');
    return s;
  }

  function matchSanMove(state, rawSan) {
    const clean = normalizeSanToken(rawSan);
    if (!clean) return null;
    const legal = generateLegalMoves(state);

    if (clean === 'O-O' || clean === 'O-O-O') {
      const targetFile = clean === 'O-O' ? 6 : 2;
      return legal.find((m) => m.piece.toLowerCase() === 'k' && Math.abs(m.toFile - m.fromFile) === 2 && m.toFile === targetFile) || null;
    }

    const promoMatch = /=([QRBN])$/i.exec(clean);
    const promo = promoMatch ? promoMatch[1].toLowerCase() : null;
    const body = promo ? clean.slice(0, -2) : clean;

    const match = /^([KQRBN])?([a-h])?([1-8])?x?([a-h][1-8])$/.exec(body);
    if (!match) return null;

    const pieceKind = (match[1] || 'P').toLowerCase();
    const fromFileHint = match[2] ? FILES.indexOf(match[2]) : null;
    const fromRankHint = match[3] ? Number.parseInt(match[3], 10) - 1 : null;
    const dest = parseSquare(match[4]);
    if (!dest) return null;

    const candidates = legal.filter((m) => {
      if (m.piece.toLowerCase() !== pieceKind) return false;
      if (m.toFile !== dest.file || m.toRank !== dest.rank) return false;
      if (fromFileHint !== null && m.fromFile !== fromFileHint) return false;
      if (fromRankHint !== null && m.fromRank !== fromRankHint) return false;
      if (promo && m.promotion !== promo) return false;
      if (!promo && m.promotion && m.promotion !== 'q') return false;
      return true;
    });

    return candidates.length === 1 ? candidates[0] : (candidates[0] || null);
  }

  function replaySanMoves(sanList) {
    if (!Array.isArray(sanList) || sanList.length === 0) return null;
    let state = parseFen(START_FEN);
    const uciMoves = [];
    for (const raw of sanList) {
      const move = matchSanMove(state, raw);
      if (!move) return null;
      uciMoves.push(moveToUci(move));
      state = move.nextState;
    }
    return { state, uciMoves };
  }

  function formatPvWithNumbers(fen, uciMoves, maxPlies) {
    const parsed = parseFen(fen);
    if (!parsed) return (uciMoves || []).join(' ');
    const sans = pvToSan(fen, (uciMoves || []).slice(0, maxPlies || 8));
    const tokens = [];
    let moveNum = parsed.fullmove;
    let turn = parsed.turn;
    for (let i = 0; i < sans.length; i++) {
      if (turn === 'w') {
        tokens.push(`${moveNum}. ${sans[i]}`);
        turn = 'b';
      } else {
        if (i === 0) tokens.push(`${moveNum}... ${sans[i]}`);
        else tokens.push(sans[i]);
        turn = 'w';
        moveNum++;
      }
    }
    return tokens.join(' ');
  }

  function inferMidgameState(grid, hints = {}) {
    const placement = gridToPlacement(grid);
    let turn = 'w';
    let ep = '-';

    if (hints.turnOverride === 'w' || hints.turnOverride === 'b') {
      turn = hints.turnOverride;
    } else if (typeof hints.plyCount === 'number' && hints.plyCount >= 0) {
      turn = hints.plyCount % 2 === 0 ? 'w' : 'b';
    } else if (Array.isArray(hints.lastHighlightSquares) && hints.lastHighlightSquares.length === 2) {
      const sqA = parseSquare(hints.lastHighlightSquares[0]);
      const sqB = parseSquare(hints.lastHighlightSquares[1]);
      if (sqA && sqB) {
        const pieceA = grid[sqA.rank][sqA.file];
        const pieceB = grid[sqB.rank][sqB.file];
        let dest = null;
        let orig = null;
        if (pieceA && !pieceB) {
          dest = { ...sqA, piece: pieceA };
          orig = sqB;
        } else if (pieceB && !pieceA) {
          dest = { ...sqB, piece: pieceB };
          orig = sqA;
        }
        if (dest) {
          const movedColor = pieceColor(dest.piece);
          turn = movedColor === 'w' ? 'b' : 'w';
          if (dest.piece.toLowerCase() === 'p' && orig.file === dest.file && Math.abs(dest.rank - orig.rank) === 2) {
            ep = squareName(dest.file, (orig.rank + dest.rank) / 2);
          }
        }
      }
    } else if (hints.activeClockTurn === 'w' || hints.activeClockTurn === 'b') {
      turn = hints.activeClockTurn;
    }

    const castling = {
      K: grid[0][4] === 'K' && grid[0][7] === 'R',
      Q: grid[0][4] === 'K' && grid[0][0] === 'R',
      k: grid[7][4] === 'k' && grid[7][7] === 'r',
      q: grid[7][4] === 'k' && grid[7][0] === 'r'
    };

    const fullmove = typeof hints.plyCount === 'number' && hints.plyCount >= 0
      ? Math.floor(hints.plyCount / 2) + 1
      : 1;

    return {
      grid: cloneGrid(grid),
      placement,
      turn,
      castling,
      ep,
      halfmove: 0,
      fullmove
    };
  }

  class ChessStateTracker {
    constructor() {
      this.reset();
    }

    reset() {
      this.currentState = null;
      this.uciMoves = null; // null when attached mid-game without full history from startpos
      this.history = [];
    }

    recordHistory(state, plyCount, uciMoves) {
      this.history.push({
        placement: state.placement,
        turn: state.turn,
        castling: { ...state.castling },
        ep: state.ep,
        halfmove: state.halfmove,
        fullmove: state.fullmove,
        plyCount: typeof plyCount === 'number' ? plyCount : null,
        uciMoves: Array.isArray(uciMoves) ? uciMoves.slice() : null
      });
      if (this.history.length > 250) {
        this.history.shift();
      }
    }

    flipTurn() {
      if (!this.currentState) return null;
      this.currentState = {
        ...this.currentState,
        turn: this.currentState.turn === 'w' ? 'b' : 'w',
        ep: '-'
      };
      this.uciMoves = null;
      return this.getSnapshot(false, null);
    }

    getSnapshot(changed, lastMoveUci) {
      return {
        ...this.currentState,
        fen: buildFen(this.currentState),
        uciMoves: Array.isArray(this.uciMoves) ? this.uciMoves.slice() : null,
        changed,
        lastMoveUci
      };
    }

    updateFromDomSnapshot(grid, hints = {}) {
      if (!isValidBoardSnapshot(grid)) return null;
      const placement = gridToPlacement(grid);

      // Standard start position always resets cleanly
      if (placement === START_PLACEMENT && (!hints.plyCount || hints.plyCount === 0)) {
        const prevFen = this.currentState ? buildFen(this.currentState) : null;
        const start = parseFen(START_FEN);
        if (hints.turnOverride === 'w' || hints.turnOverride === 'b') {
          start.turn = hints.turnOverride;
        }
        const changed = prevFen !== buildFen(start);
        this.currentState = start;
        this.uciMoves = [];
        if (changed) {
          this.history = [];
          this.recordHistory(start, 0, []);
        }
        return this.getSnapshot(changed, null);
      }

      // Highest accuracy path: exact SAN replay from move 1 when Chess.com move list matches the board
      if (Array.isArray(hints.sanMoves) && hints.sanMoves.length > 0 && hints.turnOverride !== 'w' && hints.turnOverride !== 'b') {
        const targetPlies = typeof hints.plyCount === 'number' && hints.plyCount > 0 && hints.plyCount <= hints.sanMoves.length
          ? hints.sanMoves.slice(0, hints.plyCount)
          : hints.sanMoves;
        const replayed = replaySanMoves(targetPlies);
        if (replayed && replayed.state.placement === placement) {
          const prevFen = this.currentState ? buildFen(this.currentState) : null;
          const prevMovesLen = Array.isArray(this.uciMoves) ? this.uciMoves.length : -1;
          this.currentState = replayed.state;
          this.uciMoves = replayed.uciMoves;
          const nextFen = buildFen(this.currentState);
          const changed = prevFen !== nextFen || prevMovesLen !== replayed.uciMoves.length;
          if (changed) {
            this.recordHistory(this.currentState, replayed.uciMoves.length, replayed.uciMoves);
          }
          return this.getSnapshot(changed, replayed.uciMoves[replayed.uciMoves.length - 1] || null);
        }
      }

      // Same board placement as current
      if (this.currentState && this.currentState.placement === placement) {
        let changed = false;
        if ((hints.turnOverride === 'w' || hints.turnOverride === 'b') && this.currentState.turn !== hints.turnOverride) {
          this.currentState = { ...this.currentState, turn: hints.turnOverride };
          this.uciMoves = null;
          changed = true;
        }
        return this.getSnapshot(changed, null);
      }

      // Try 1-ply legal move match from currentState
      if (this.currentState) {
        const legal = generateLegalMoves(this.currentState);
        const matched = legal.find((m) => m.nextState.placement === placement);
        if (matched) {
          const uci = moveToUci(matched);
          this.currentState = matched.nextState;
          if (hints.turnOverride === 'w' || hints.turnOverride === 'b') {
            this.currentState.turn = hints.turnOverride;
            this.uciMoves = null;
          } else if (Array.isArray(this.uciMoves)) {
            this.uciMoves = [...this.uciMoves, uci];
          }
          this.recordHistory(this.currentState, hints.plyCount, this.uciMoves);
          return this.getSnapshot(true, uci);
        }

        // Check history stack for takeback / analysis scrubbing
        for (let i = this.history.length - 1; i >= 0; i--) {
          const entry = this.history[i];
          if (entry.placement !== placement) continue;
          if (typeof hints.plyCount === 'number' && entry.plyCount !== null && entry.plyCount !== hints.plyCount) {
            continue;
          }
          this.currentState = {
            grid: cloneGrid(grid),
            placement: entry.placement,
            turn: hints.turnOverride === 'w' || hints.turnOverride === 'b' ? hints.turnOverride : entry.turn,
            castling: { ...entry.castling },
            ep: entry.ep,
            halfmove: entry.halfmove,
            fullmove: entry.fullmove
          };
          this.uciMoves = Array.isArray(entry.uciMoves) ? entry.uciMoves.slice() : null;
          return this.getSnapshot(true, null);
        }
      }

      // Mid-game attach or board jump fallback
      this.currentState = inferMidgameState(grid, hints);
      this.uciMoves = null;
      this.recordHistory(this.currentState, hints.plyCount, null);
      return this.getSnapshot(true, null);
    }
  }

  function parseUciInfoLine(line) {
    if (!line || !line.startsWith('info ')) return null;
    if (!line.includes(' pv ') && !line.includes(' score ')) return null;
    const tokens = line.trim().split(/\s+/);
    const result = {
      depth: 0,
      seldepth: 0,
      multipv: 1,
      scoreCp: null,
      mateIn: null,
      wdl: null,
      bound: null,
      nodes: 0,
      nps: 0,
      pv: []
    };

    for (let i = 1; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok === 'depth' && tokens[i + 1]) {
        result.depth = Number.parseInt(tokens[++i], 10) || 0;
      } else if (tok === 'seldepth' && tokens[i + 1]) {
        result.seldepth = Number.parseInt(tokens[++i], 10) || 0;
      } else if (tok === 'multipv' && tokens[i + 1]) {
        result.multipv = Number.parseInt(tokens[++i], 10) || 1;
      } else if (tok === 'nodes' && tokens[i + 1]) {
        result.nodes = Number.parseInt(tokens[++i], 10) || 0;
      } else if (tok === 'nps' && tokens[i + 1]) {
        result.nps = Number.parseInt(tokens[++i], 10) || 0;
      } else if (tok === 'wdl' && tokens[i + 3]) {
        const w = Number.parseInt(tokens[++i], 10);
        const d = Number.parseInt(tokens[++i], 10);
        const l = Number.parseInt(tokens[++i], 10);
        if (!Number.isNaN(w) && !Number.isNaN(d) && !Number.isNaN(l)) {
          result.wdl = [w, d, l];
        }
      } else if (tok === 'score' && tokens[i + 1]) {
        const kind = tokens[++i];
        const val = Number.parseInt(tokens[++i], 10);
        if (!Number.isNaN(val)) {
          if (kind === 'cp') result.scoreCp = val;
          else if (kind === 'mate') result.mateIn = val;
        }
        if (tokens[i + 1] === 'lowerbound' || tokens[i + 1] === 'upperbound') {
          result.bound = tokens[++i];
        }
      } else if (tok === 'pv') {
        result.pv = tokens.slice(i + 1);
        break;
      }
    }

    if (result.pv.length === 0 && result.scoreCp === null && result.mateIn === null) return null;
    return result;
  }

  function normalizeWdlForWhite(wdl, turn) {
    if (!Array.isArray(wdl) || wdl.length !== 3) return null;
    const total = wdl[0] + wdl[1] + wdl[2];
    if (total <= 0) return null;
    const sideWin = (wdl[0] / total) * 100;
    const draw = (wdl[1] / total) * 100;
    const sideLoss = (wdl[2] / total) * 100;
    if (turn === 'b') {
      return {
        white: Math.round(sideLoss),
        draw: Math.round(draw),
        black: Math.max(0, 100 - Math.round(sideLoss) - Math.round(draw))
      };
    }
    return {
      white: Math.round(sideWin),
      draw: Math.round(draw),
      black: Math.max(0, 100 - Math.round(sideWin) - Math.round(draw))
    };
  }

  function buildArrowGeometry(fromSq, toSq, flipped, opts = {}) {
    const from = parseSquare(fromSq);
    const to = parseSquare(toSq);
    if (!from || !to) return null;

    const fx = ((flipped ? 7 - from.file : from.file) + 0.5) * 100;
    const fy = ((flipped ? from.rank : 7 - from.rank) + 0.5) * 100;
    const tx = ((flipped ? 7 - to.file : to.file) + 0.5) * 100;
    const ty = ((flipped ? to.rank : 7 - to.rank) + 0.5) * 100;

    const df = Math.abs(to.file - from.file);
    const dr = Math.abs(to.rank - from.rank);
    const isKnight = (df === 1 && dr === 2) || (df === 2 && dr === 1);

    const shaftW = opts.shaftWidth || 16;
    const headW = opts.headWidth || 38;
    const headLen = opts.headLength || 36;
    const tailTrim = opts.tailTrim || 20;
    const tipTrim = opts.tipTrim || 14;

    if (isKnight) {
      // L-shaped bent knight path: travel 2 squares on long leg, then 1 square perpendicular
      const dx = tx - fx;
      const dy = ty - fy;
      const bendX = Math.abs(dx) > Math.abs(dy) ? tx : fx;
      const bendY = Math.abs(dx) > Math.abs(dy) ? fy : ty;

      const u1x = Math.sign(bendX - fx);
      const u1y = Math.sign(bendY - fy);
      const u2x = Math.sign(tx - bendX);
      const u2y = Math.sign(ty - bendY);

      const sx = fx + u1x * tailTrim;
      const sy = fy + u1y * tailTrim;
      const tipX = tx - u2x * tipTrim;
      const tipY = ty - u2y * tipTrim;
      const baseX = tipX - u2x * headLen;
      const baseY = tipY - u2y * headLen;

      const p2x = -u2y;
      const p2y = u2x;
      const hw = headW / 2;

      return {
        kind: 'knight',
        shaftPath: `M ${sx} ${sy} L ${bendX} ${bendY} L ${baseX} ${baseY}`,
        headPath: `M ${tipX} ${tipY} L ${baseX + p2x * hw} ${baseY + p2y * hw} L ${baseX - p2x * hw} ${baseY - p2y * hw} Z`,
        shaftWidth: shaftW
      };
    }

    const dx = tx - fx;
    const dy = ty - fy;
    const len = Math.hypot(dx, dy);
    if (len < 1) return null;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;

    const sx = fx + ux * tailTrim;
    const sy = fy + uy * tailTrim;
    const tipX = tx - ux * tipTrim;
    const tipY = ty - uy * tipTrim;
    const baseX = tipX - ux * headLen;
    const baseY = tipY - uy * headLen;

    const sw = shaftW / 2;
    const hw = headW / 2;

    const polygon = [
      `M ${sx + px * sw} ${sy + py * sw}`,
      `L ${baseX + px * sw} ${baseY + py * sw}`,
      `L ${baseX + px * hw} ${baseY + py * hw}`,
      `L ${tipX} ${tipY}`,
      `L ${baseX - px * hw} ${baseY - py * hw}`,
      `L ${baseX - px * sw} ${baseY - py * sw}`,
      `L ${sx - px * sw} ${sy - py * sw}`,
      'Z'
    ].join(' ');

    return {
      kind: 'straight',
      polygonPath: polygon,
      shaftWidth: shaftW
    };
  }

  function normalizeScoreForWhite(scoreCp, mateIn, turn) {
    const sign = turn === 'b' ? -1 : 1;
    return {
      whiteCp: scoreCp === null || scoreCp === undefined ? null : scoreCp * sign,
      whiteMate: mateIn === null || mateIn === undefined ? null : mateIn * sign
    };
  }

  function formatEvalText(whiteCp, whiteMate) {
    if (whiteMate !== null && whiteMate !== undefined) {
      return whiteMate > 0 ? `+M${whiteMate}` : `-M${Math.abs(whiteMate)}`;
    }
    if (whiteCp === null || whiteCp === undefined) return '0.0';
    const pawns = whiteCp / 100;
    const sign = pawns > 0 ? '+' : '';
    return `${sign}${pawns.toFixed(2)}`;
  }

  function evalToWhitePercent(whiteCp, whiteMate) {
    if (whiteMate !== null && whiteMate !== undefined) {
      return whiteMate > 0 ? 100 : 0;
    }
    if (whiteCp === null || whiteCp === undefined) return 50;
    const winPct = 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * whiteCp)) - 1);
    return Math.min(96, Math.max(4, winPct));
  }

  function sideScoreCp(line) {
    if (!line) return 0;
    if (line.mateIn !== null && line.mateIn !== undefined) {
      return line.mateIn > 0
        ? 30000 - Math.min(2000, line.mateIn * 50)
        : -30000 + Math.min(2000, Math.abs(line.mateIn) * 50);
    }
    return typeof line.scoreCp === 'number' ? line.scoreCp : 0;
  }

  const HUMAN_PROFILES = {
    gm: { temperature: 28, maxDropCp: 48 },
    club: { temperature: 80, maxDropCp: 150 },
    casual: { temperature: 155, maxDropCp: 290 }
  };

  function pickHumanizedMove(lines, playstyle, rng = Math.random) {
    if (!Array.isArray(lines) || lines.length === 0) return null;
    const best = lines[0];
    const profile = HUMAN_PROFILES[playstyle];
    if (!profile || lines.length === 1) {
      return { line: best, index: 0, cpLoss: 0, mode: 'engine' };
    }
    if (best.mateIn !== null && best.mateIn > 0 && best.mateIn <= 2) {
      return { line: best, index: 0, cpLoss: 0, mode: playstyle };
    }

    const bestScore = sideScoreCp(best);
    const eligible = [];
    for (let i = 0; i < lines.length; i++) {
      const cand = lines[i];
      if (!cand || !cand.bestUci) continue;
      if (cand.mateIn !== null && cand.mateIn < 0 && (best.mateIn === null || best.mateIn >= 0)) {
        continue;
      }
      const drop = Math.max(0, bestScore - sideScoreCp(cand));
      if (drop <= profile.maxDropCp) {
        eligible.push({
          line: cand,
          index: i,
          cpLoss: drop,
          weight: Math.exp(-drop / profile.temperature)
        });
      }
    }

    if (eligible.length <= 1) {
      return { line: best, index: 0, cpLoss: 0, mode: playstyle };
    }

    const totalWeight = eligible.reduce((acc, item) => acc + item.weight, 0);
    let roll = rng() * totalWeight;
    for (const item of eligible) {
      roll -= item.weight;
      if (roll <= 0) {
        return { line: item.line, index: item.index, cpLoss: item.cpLoss, mode: playstyle };
      }
    }
    const last = eligible[eligible.length - 1];
    return { line: last.line, index: last.index, cpLoss: last.cpLoss, mode: playstyle };
  }

  function computeHumanDelayMs({
    baseDelayMs = 750,
    legalMoveCount = 25,
    plyCount = 12,
    isCapture = false,
    clockSeconds = null,
    clockAware = true,
    rng = Math.random
  } = {}) {
    const base = Math.max(150, baseDelayMs);
    const skew = (rng() + rng() + rng()) / 3;
    const spike = rng() < 0.14 ? 1.45 + rng() * 0.55 : 0.65 + skew * 0.8;
    let delay = base * spike;

    if (legalMoveCount <= 2) {
      delay *= 0.38;
    } else if (plyCount >= 0 && plyCount < 6) {
      delay *= 0.55;
    } else if (isCapture) {
      delay *= 0.72;
    }

    if (clockAware && typeof clockSeconds === 'number' && Number.isFinite(clockSeconds)) {
      if (clockSeconds <= 6) {
        delay = Math.min(delay, 100 + rng() * 110);
      } else if (clockSeconds <= 15) {
        delay = Math.min(delay, 160 + rng() * 240);
      } else if (clockSeconds <= 30) {
        delay *= 0.65;
      }
    }

    return Math.round(Math.min(4500, Math.max(95, delay)));
  }

  const api = {
    FILES,
    START_PLACEMENT,
    START_FEN,
    createEmptyGrid,
    cloneGrid,
    gridsEqual,
    squareName,
    parseSquare,
    chessComClassToSquare,
    pieceColor,
    chessComCodeToFenChar,
    gridToPlacement,
    placementToGrid,
    parseFen,
    buildFen,
    isValidBoardSnapshot,
    isKingInCheck,
    generateLegalMoves,
    moveToUci,
    pvToSan,
    matchSanMove,
    replaySanMoves,
    formatPvWithNumbers,
    inferMidgameState,
    ChessStateTracker,
    parseUciInfoLine,
    normalizeScoreForWhite,
    normalizeWdlForWhite,
    formatEvalText,
    evalToWhitePercent,
    buildArrowGeometry,
    pickHumanizedMove,
    computeHumanDelayMs
  };

  root.ChessBenchLogic = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

// 30-chess.js is the rules engine taken from the verified ChessBench build:
// perft(1..3) = 20/400/8902, Kiwipete 48/2039, SAN replay of long games exact.
// It registers itself on globalThis; take a local reference and leave the page
// globals clean.
const Chess = globalThis.ChessBenchLogic;
if (!Chess) throw new Error('CHESS WRAITH: rules module missing');
try {
  delete globalThis.ChessBenchLogic;
} catch {
  globalThis.ChessBenchLogic = undefined;
}

// Board reader for chess.com. Verified against the live analysis board: the
// grid, orientation, ply list, SAN list, last-move highlights, clock and
// opponent rating all come from the same DOM shapes the extension used.

const BOARD_SELECTORS = ['wc-chess-board', 'chess-board', '#board-single', '.board'];
const MOVE_LIST_SELECTOR = 'wc-simple-move-list, .vertical-move-list, vertical-move-list, .move-list';

function findBoardElement() {
  for (const sel of BOARD_SELECTORS) {
    for (const node of document.querySelectorAll(sel)) {
      const rect = node.getBoundingClientRect();
      if (rect.width >= 150 && rect.height >= 150 && node.querySelector('.piece')) return node;
    }
  }
  return null;
}

function isBoardFlipped(boardEl) {
  if (!boardEl) return false;
  if (boardEl.classList.contains('flipped')) return true;
  const attr = boardEl.getAttribute('flipped');
  if (attr === 'true' || attr === '') return true;
  for (const txt of boardEl.querySelectorAll('svg.coordinates text')) {
    if (txt.textContent && txt.textContent.trim() === '1') {
      const y = Number.parseFloat(txt.getAttribute('y') || '50');
      if (!Number.isNaN(y) && y < 40) return true;
    }
  }
  return false;
}

function readGridFromBoard(boardEl, flipped) {
  const grid = Chess.createEmptyGrid();
  const boardRect = boardEl.getBoundingClientRect();
  if (boardRect.width < 100 || boardRect.height < 100) return null;

  let hasDragging = false;
  for (const pieceEl of boardEl.querySelectorAll('.piece')) {
    if (
      pieceEl.closest('.promotion-window') ||
      pieceEl.closest('.board-modal') ||
      pieceEl.closest('.spare-pieces') ||
      pieceEl.classList.contains('ghost') ||
      pieceEl.classList.contains('capture-hint')
    ) {
      continue;
    }
    if (pieceEl.classList.contains('dragging')) hasDragging = true;

    let fenChar = null;
    let sqName = null;
    for (const cls of pieceEl.classList) {
      if (!fenChar && /^[wb][prnbqk]$/.test(cls)) fenChar = Chess.chessComCodeToFenChar(cls);
      const m = /^square-([1-8])([1-8])$/.exec(cls);
      if (m) sqName = Chess.chessComClassToSquare(m[1], m[2]);
    }
    if (!fenChar) continue;

    if (!sqName && pieceEl.dataset && pieceEl.dataset.square) {
      const ds = pieceEl.dataset.square;
      if (/^[a-h][1-8]$/.test(ds)) sqName = ds;
      else if (/^[1-8][1-8]$/.test(ds)) sqName = Chess.chessComClassToSquare(ds[0], ds[1]);
    }

    if (!sqName) {
      const pRect = pieceEl.getBoundingClientRect();
      if (pRect.width > 0 && pRect.height > 0) {
        const rx = (pRect.left + pRect.width / 2 - boardRect.left) / boardRect.width;
        const ry = (pRect.top + pRect.height / 2 - boardRect.top) / boardRect.height;
        if (rx >= 0 && rx <= 1 && ry >= 0 && ry <= 1) {
          const col = clamp(Math.floor(rx * 8), 0, 7);
          const row = clamp(Math.floor(ry * 8), 0, 7);
          const file = flipped ? 7 - col : col;
          const rank = flipped ? row : 7 - row;
          grid[rank][file] = fenChar;
          continue;
        }
      }
    }

    const parsed = Chess.parseSquare(sqName);
    if (parsed) grid[parsed.rank][parsed.file] = fenChar;
  }

  if (hasDragging) return { grid, isDragging: true, valid: false };
  return { grid, isDragging: false, valid: Chess.isValidBoardSnapshot(grid) };
}

function readLastHighlightSquares(boardEl) {
  const squares = new Set();
  for (const el of boardEl.querySelectorAll('.highlight')) {
    const bg = el.style && el.style.backgroundColor;
    if (bg && !bg.includes('255, 255, 51') && !bg.includes('246, 246, 105')) continue;
    for (const cls of el.classList) {
      const m = /^square-([1-8])([1-8])$/.exec(cls);
      if (m) {
        const sq = Chess.chessComClassToSquare(m[1], m[2]);
        if (sq) squares.add(sq);
      }
    }
  }
  return squares.size === 2 ? Array.from(squares) : [];
}

function extractSanFromNode(node) {
  if (!node) return '';
  let figurine = '';
  const figEl = node.querySelector('[data-figurine]');
  if (figEl) figurine = figEl.getAttribute('data-figurine') || '';
  else {
    const iconEl = node.querySelector('.icon-font-chess');
    if (iconEl) {
      const cls = iconEl.className || '';
      if (cls.includes('knight')) figurine = 'N';
      else if (cls.includes('bishop')) figurine = 'B';
      else if (cls.includes('rook')) figurine = 'R';
      else if (cls.includes('queen')) figurine = 'Q';
      else if (cls.includes('king')) figurine = 'K';
    }
  }
  const text = (node.textContent || '').trim().replace(/\s+/g, '');
  if (!text) return '';
  if (figurine && !/^[KQRBNO0]/.test(text)) return `${figurine}${text}`;
  return text;
}

function readSanMoveList() {
  const nodes = document.querySelectorAll('[data-ply]');
  if (nodes.length === 0) return [];
  const byPly = new Map();
  for (const node of nodes) {
    const ply = Number.parseInt(node.getAttribute('data-ply'), 10);
    if (Number.isNaN(ply) || ply <= 0) continue;
    const san = extractSanFromNode(node);
    if (san && !byPly.has(ply)) byPly.set(ply, san);
  }
  const maxPly = Math.max(0, ...byPly.keys());
  if (maxPly === 0 || byPly.size < maxPly) return [];
  const list = [];
  for (let i = 1; i <= maxPly; i++) list.push(byPly.get(i));
  return list;
}

function readPlyCount() {
  const selected = document.querySelector('[data-ply].selected, [data-ply] .selected');
  if (selected) {
    const host = selected.hasAttribute('data-ply') ? selected : selected.closest('[data-ply]');
    if (host) {
      const ply = Number.parseInt(host.getAttribute('data-ply'), 10);
      if (!Number.isNaN(ply) && ply >= 0) return ply;
    }
  }
  const nodes = document.querySelectorAll('[data-ply]');
  if (nodes.length > 0) {
    let maxPly = 0;
    for (const node of nodes) {
      const ply = Number.parseInt(node.getAttribute('data-ply'), 10);
      if (!Number.isNaN(ply) && ply > maxPly) maxPly = ply;
    }
    return maxPly;
  }
  return null;
}

function readActiveClockTurn(flipped) {
  const activeClock = document.querySelector('.clock-player-turn');
  if (!activeClock) return null;
  if (activeClock.closest('.board-layout-bottom, .player-bottom, #board-layout-player-bottom')) {
    return flipped ? 'b' : 'w';
  }
  if (activeClock.closest('.board-layout-top, .player-top, #board-layout-player-top')) {
    return flipped ? 'w' : 'b';
  }
  return null;
}

function parseClockTextSeconds(raw) {
  if (!raw) return null;
  const parts = raw.replace(/\s+/g, '').trim().split(':');
  if (parts.length === 1) {
    const val = Number.parseFloat(parts[0]);
    return Number.isFinite(val) ? val : null;
  }
  if (parts.length === 2) {
    const mins = Number.parseInt(parts[0], 10);
    const secs = Number.parseFloat(parts[1]);
    if (Number.isNaN(mins) || !Number.isFinite(secs)) return null;
    return mins * 60 + secs;
  }
  if (parts.length === 3) {
    const hrs = Number.parseInt(parts[0], 10);
    const mins = Number.parseInt(parts[1], 10);
    const secs = Number.parseFloat(parts[2]);
    if (Number.isNaN(hrs) || Number.isNaN(mins) || !Number.isFinite(secs)) return null;
    return hrs * 3600 + mins * 60 + secs;
  }
  return null;
}

function readClockSeconds(mySide, flipped) {
  const bottomColor = flipped ? 'b' : 'w';
  const isBottom = !mySide || mySide === bottomColor;
  const sel = isBottom
    ? '.board-layout-bottom .clock-component, .player-bottom .clock-component, #board-layout-player-bottom .clock-component, .clock-bottom'
    : '.board-layout-top .clock-component, .player-top .clock-component, #board-layout-player-top .clock-component, .clock-top';
  const clockEl = document.querySelector(sel) || document.querySelector('.clock-player-turn');
  if (!clockEl) return null;
  return parseClockTextSeconds(clockEl.textContent);
}

function readOpponentRating(mySide, flipped) {
  const bottomColor = flipped ? 'b' : 'w';
  const oppIsTop = !mySide || mySide === bottomColor;
  const sel = oppIsTop
    ? '.board-layout-top .user-tagline-rating, .player-top .user-tagline-rating, #board-layout-player-top .user-tagline-rating, .board-layout-top [data-cy="user-tagline-rating"]'
    : '.board-layout-bottom .user-tagline-rating, .player-bottom .user-tagline-rating, #board-layout-player-bottom .user-tagline-rating, .board-layout-bottom [data-cy="user-tagline-rating"]';
  const el = document.querySelector(sel);
  if (!el || !el.textContent) return null;
  const m = /(\d{3,4})/.exec(el.textContent);
  if (!m) return null;
  const rating = Number.parseInt(m[1], 10);
  return rating >= 400 && rating <= 3500 ? rating : null;
}

function isGameOverDom() {
  for (const sel of [
    '.game-over-modal-content',
    '.game-over-header-component',
    '.game-over-modal',
    '.modal-game-over-component'
  ]) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const style = getComputedStyle(el);
    const visible = el.offsetParent !== null || style.position === 'fixed';
    if (visible && style.visibility !== 'hidden' && style.display !== 'none') return true;
  }
  return false;
}

function isPromotionWindowOpen() {
  return Boolean(document.querySelector('.promotion-window'));
}

function hasPremove(boardEl) {
  try {
    return Boolean(
      document.querySelector('.premove-square, .premove') ||
        (boardEl && boardEl.querySelector('.premove'))
    );
  } catch {
    return false;
  }
}

function scanBoard(mySide) {
  const boardEl = findBoardElement();
  if (!boardEl) return null;

  const flipped = isBoardFlipped(boardEl);
  const read = readGridFromBoard(boardEl, flipped);
  if (!read || read.isDragging || !read.valid) {
    return { boardEl, flipped, valid: false, isDragging: Boolean(read && read.isDragging) };
  }

  return {
    boardEl,
    rect: boardEl.getBoundingClientRect(),
    flipped,
    valid: true,
    grid: read.grid,
    plyCount: readPlyCount(),
    sanMoves: readSanMoveList(),
    lastHighlightSquares: readLastHighlightSquares(boardEl),
    activeClockTurn: readActiveClockTurn(flipped),
    clockSeconds: readClockSeconds(mySide, flipped),
    opponentRating: readOpponentRating(mySide, flipped),
    gameOver: isGameOverDom()
  };
}

// Local Stockfish 19 NNUE. The engine ships as a classic worker script plus a
// .wasm sidecar. A blob worker cannot see its own directory, so the worker code
// is prefixed with a fetch shim that redirects the .wasm request to the mirror
// URL. Verified in Chrome on chess.com: blob workers and WASM compile are not
// blocked by the page CSP.

class WraithEngine {
  constructor() {
    this.worker = null;
    this.mode = 'offline';
    this.ready = false;
    this.searching = false;
    this.lines = new Map();
    this.search = null;
    this.onProgress = null;
    this.onReady = null;
    this.onError = null;
    this.lastOptions = {};
    this.booted = null;
    // Not derived from the mode string: "Stockfish 2019 JS" contains "19" too,
    // and that made the fallback take the NNUE-only option path.
    this.nnue = false;
  }

  async boot() {
    if (!this.booted) this.booted = this.#bootInner();
    try {
      await this.booted;
    } finally {
      this.booted = null;
    }
  }

  async ensureReady() {
    if (this.ready) return true;
    if (!this.worker) {
      try {
        await this.boot();
      } catch (err) {
        this.onError && this.onError(err && err.message ? err.message : 'engine boot failed');
      }
    }
    const started = Date.now();
    while (!this.ready && Date.now() - started < 9000) await sleep(90);
    return this.ready;
  }

  async #bootInner() {
    try {
      await this.#spawn(true);
    } catch (err) {
      this.onError && this.onError(`NNUE engine unavailable (${err.message}); using the JS engine`);
      await this.#spawn(false);
    }
  }

  async #spawn(preferNnue) {
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        /* already gone */
      }
    }
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    if (this.uciRetryTimer) clearTimeout(this.uciRetryTimer);
    this.worker = null;
    this.ready = false;
    this.searching = false;

    const source = preferNnue ? await this.#nnueWorkerSource() : await this.#plainWorkerSource();
    this.mode = preferNnue ? 'Stockfish 19 NNUE' : 'Stockfish 2019 JS';
    this.nnue = Boolean(preferNnue);
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    this.worker = worker;

    worker.onmessage = (event) => this.#onLine(event.data);
    worker.onerror = (event) => {
      if (preferNnue) {
        this.onError && this.onError('NNUE worker failed to start; using the JS engine');
        this.#spawn(false).catch(() => {});
        return;
      }
      this.onError && this.onError(event && event.message ? event.message : 'engine worker error');
    };

    this.#send('uci');
    // A worker that boots asynchronously can drop the first message. Ask again
    // once, then give the whole handshake a deadline.
    this.uciRetryTimer = setTimeout(() => {
      if (!this.ready && this.worker === worker) this.#send('uci');
    }, 1200);
    this.handshakeTimer = setTimeout(() => {
      if (this.ready || this.worker !== worker) return;
      if (preferNnue) {
        this.onError && this.onError('NNUE engine did not start; using the JS engine');
        this.#spawn(false).catch(() => {});
      } else {
        this.onError && this.onError('engine did not answer uci');
      }
    }, 4000);
  }

  async #fetchText(url) {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
  }

  async #nnueWorkerSource() {
    const code = await this.#fetchText(ENGINE_FILES.nnueJs);
    const shim =
      `self.__CW_WASM=${JSON.stringify(ENGINE_FILES.nnueWasm)};` +
      `(function(){var f=self.fetch?self.fetch.bind(self):null;` +
      `if(!f)return;self.fetch=function(u,o){var s=String(u&&u.url?u.url:u);` +
      `if(s.indexOf('.wasm')>=0)return f(self.__CW_WASM,o);return f(u,o);};})();\n`;
    return shim + code;
  }

  async #plainWorkerSource() {
    return this.#fetchText(ENGINE_FILES.fallbackJs);
  }

  #send(cmd) {
    if (this.worker) this.worker.postMessage(cmd);
  }

  #onLine(raw) {
    const line = typeof raw === 'string' ? raw.trim() : '';
    if (!line) return;

    if (line === 'uciok') {
      if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
      if (this.uciRetryTimer) clearTimeout(this.uciRetryTimer);
      this.#send(`setoption name Hash value ${CONFIG.hashMb}`);
      if (this.nnue) this.#send('setoption name UCI_ShowWDL value true');
      this.#send('isready');
      return;
    }

    if (line === 'readyok') {
      this.ready = true;
      if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
      this.onReady && this.onReady(this.mode);
      return;
    }

    if (line.startsWith('bestmove ')) {
      this.#finish(line);
      return;
    }

    if (line.startsWith('info ') && this.searching && this.search) {
      const info = Chess.parseUciInfoLine(line);
      if (!info || info.bound || !info.pv || info.pv.length === 0) return;
      this.lines.set(info.multipv, info);
      if (info.depth >= 6) this.#emit(false);
    }
  }

  #emit(final, bestmove) {
    if (!this.search) return;
    const payload = {
      fen: this.search.fen,
      turn: this.search.turn,
      flipped: this.search.flipped,
      lines: this.#formatted(),
      bestmove: bestmove || (this.lines.get(1) && this.lines.get(1).pv[0]) || null,
      depth: this.search.depth,
      final,
      engine: this.mode
    };
    if (final) this.onFinal && this.onFinal(payload);
    else this.onProgress && this.onProgress(payload);
  }

  #formatted() {
    if (!this.search) return [];
    const turn = this.search.turn;
    const fen = this.search.fen;
    return Array.from(this.lines.entries())
      .sort((a, b) => a[0] - b[0])
      .slice(0, this.search.multiPv)
      .map(([, info]) => {
        const { whiteCp, whiteMate } = Chess.normalizeScoreForWhite(info.scoreCp, info.mateIn, turn);
        return {
          multipv: info.multipv,
          depth: info.depth,
          scoreCp: info.scoreCp,
          mateIn: info.mateIn,
          whiteCp,
          whiteMate,
          wdl: info.wdl ? Chess.normalizeWdlForWhite(info.wdl, turn) : null,
          evalText: Chess.formatEvalText(whiteCp, whiteMate),
          pv: info.pv,
          bestUci: info.pv[0] || null,
          bestSan: (Chess.pvToSan(fen, info.pv.slice(0, 1)) || [])[0] || null,
          sanLine: Chess.formatPvWithNumbers(fen, info.pv, 6)
        };
      });
  }

  #finish(line) {
    const parts = line.split(/\s+/);
    const bestmove = parts[1] && parts[1] !== '(none)' ? parts[1] : null;
    const search = this.search;
    this.searching = false;
    this.#emit(true, bestmove);
    if (this.search && this.search.resolve) this.search.resolve(this.#formatted());
    this.search = null;
    if (search && search.queued) this.#runNow(search.queued);
  }

  async analyze(request) {
    const ready = await this.ensureReady();
    if (!ready) return [];
    return new Promise((resolve) => {
      const job = { ...request, resolve };
      if (this.searching) {
        this.#send('stop');
        if (this.search) this.search.queued = job;
        return;
      }
      this.#runNow(job);
    });
  }

  #runNow(job) {
    this.#applyOptions(job);
    this.lines = new Map();
    this.search = job;
    this.searching = true;
    this.#send(job.uciMoves ? positionMoves(job.uciMoves) : `position fen ${job.fen}`);
    const depth = clampInt(job.depth, 4, 22, CONFIG.maxDepth);
    const movetime = clampInt(job.moveTimeMs, 120, 6000, CONFIG.moveTimeMs);
    this.#send(`go depth ${depth} movetime ${movetime}`);
  }

  #applyOptions(job) {
    const elo = job.elo;
    const limit = Number.isFinite(elo) && elo > 0;
    if (this.nnue) {
      this.#send(`setoption name UCI_LimitStrength value ${limit ? 'true' : 'false'}`);
      if (limit) this.#send(`setoption name UCI_Elo value ${clampInt(elo, 1320, 3190, 1650)}`);
      this.#send(`setoption name Skill Level value ${clampInt(job.skill, 0, 20, 20)}`);
    } else {
      // The 2019 build has no UCI_Elo: Skill Level is the whole strength dial.
      const skill = limit ? eloToSkill(elo) : clampInt(job.skill, 0, 20, 20);
      if (this.lastOptions.skill !== skill) {
        this.#send(`setoption name Skill Level value ${skill}`);
        this.lastOptions.skill = skill;
      }
    }
    const multiPv = clampInt(job.multiPv, 1, 5, 1);
    if (this.lastOptions.multiPv !== multiPv) {
      this.#send(`setoption name MultiPV value ${multiPv}`);
      this.lastOptions.multiPv = multiPv;
    }
  }

  stop() {
    if (this.searching) this.#send('stop');
    if (this.search) this.search.queued = null;
  }

  destroy() {
    try {
      this.#send('quit');
      this.worker && this.worker.terminate();
    } catch {
      /* closing the tab is enough */
    }
    this.worker = null;
    this.search = null;
    this.searching = false;
  }
}

function positionMoves(uciMoves) {
  if (!Array.isArray(uciMoves) || uciMoves.length === 0) return 'position startpos';
  return `position startpos moves ${uciMoves.join(' ')}`;
}

// Move selection and pacing. The engine is not asked to play its raw #1 every
// time: on a fixed style it may take a near-equal alternative, in adaptive mode
// it studies the opponent and sits slightly above them, and the weaker presets
// miss on purpose at a low rate instead of playing every move perfectly.

function sideScore(line) {
  if (!line) return 0;
  if (line.mateIn !== null && line.mateIn !== undefined) {
    return line.mateIn > 0 ? 30000 - Math.min(2000, line.mateIn * 50) : -30000 + Math.min(2000, Math.abs(line.mateIn) * 50);
  }
  return typeof line.scoreCp === 'number' ? line.scoreCp : 0;
}

// Stockfish's Skill Level is 0..20 and roughly one step per ~90 Elo at the
// bottom of the scale, flattening at the top. This is the only strength dial
// the bundled 2019 build honours, so the styles go through it.
function effectiveElo(cfg, opts = {}) {
  if (cfg.style === 'engine') return null;
  if (cfg.style === 'adaptive') {
    const base = Number(opts.oppElo) > 0 ? Number(opts.oppElo) : 1500;
    return Math.round(clamp(base + 130, 1320, 2600));
  }
  return clampInt(cfg.targetElo, 1320, 3190, 1650);
}

function styleProfile(cfg, opts = {}) {
  const preset = STYLES[cfg.style] || STYLES.adaptive;
  return {
    elo: effectiveElo(cfg, opts),
    slack: cfg.style === 'engine' ? 0 : Math.max(cfg.humanSlackCp, preset.slack),
    miss: cfg.style === 'engine' ? 0 : Number(preset.miss) || 0,
    label: preset.label
  };
}

function weightedPick(items) {
  const total = items.reduce((acc, item) => acc + item.weight, 0);
  if (!(total > 0)) return items[0] || null;
  let roll = Math.random() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

function chooseMove(lines, cfg, opts = {}) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const best = lines[0];
  if (!best || !best.bestUci) return null;

  if (best.mateIn !== null && best.mateIn > 0 && best.mateIn <= 3) {
    return { line: best, cpLoss: 0, reason: 'mate' };
  }
  const profile = styleProfile(cfg, opts);
  if (profile.slack <= 0 || lines.length === 1) {
    return { line: best, cpLoss: 0, reason: 'best' };
  }

  const bestScore = sideScore(best);
  const legal = [];
  for (let i = 0; i < lines.length; i++) {
    const cand = lines[i];
    if (!cand || !cand.bestUci) continue;
    if (cand.mateIn !== null && cand.mateIn < 0 && (best.mateIn === null || best.mateIn >= 0)) continue;
    const drop = Math.max(0, bestScore - sideScore(cand));
    legal.push({ line: cand, cpLoss: drop, index: i });
  }
  if (legal.length === 0) return { line: best, cpLoss: 0, reason: 'best' };

  // A deliberate miss. Only the weaker presets carry a rate, it is capped at
  // 2.5x the normal slack so it stays plausible for the level, and it never
  // throws away a forced mate.
  if (profile.miss > 0 && Math.random() < profile.miss) {
    const misses = legal.filter((c) => c.cpLoss > profile.slack && c.cpLoss <= profile.slack * 2.5);
    if (misses.length > 0) {
      const picked = weightedPick(misses.map((c) => ({ ...c, weight: 1 / (1 + c.cpLoss / 60) })));
      if (picked) return { line: picked.line, cpLoss: picked.cpLoss, reason: 'miss' };
    }
  }

  const eligible = [];
  for (const cand of legal) {
    if (cand.cpLoss > profile.slack) continue;
    let weight = Math.exp(-cand.cpLoss / Math.max(18, profile.slack / 2));
    // Repeatedly taking #1 is the one pattern that reads as a machine. Once the
    // streak reaches three, a near-equal alternative gets a nudge, not a mandate.
    if ((opts.top1Streak || 0) >= 3 && cand.index === 0 && cand.cpLoss === 0) weight *= 0.35;
    if (cand.index > 0 && cand.cpLoss >= 8) weight *= 1.35;
    // The same first move every game is its own tell, separate from move choice.
    if (opts.repeatUci && cand.line.bestUci === opts.repeatUci) weight *= 0.28;
    eligible.push({ line: cand.line, cpLoss: cand.cpLoss, weight });
  }

  if (eligible.length === 0) return { line: best, cpLoss: 0, reason: 'best' };
  const picked = weightedPick(eligible);
  return { line: picked.line, cpLoss: picked.cpLoss, reason: profile.label };
}

// How long a person would spend here. Two draws averaged instead of one: the
// distribution is triangular, mostly near the middle, which is what real think
// times look like. The dials below are the ones a fixed timer cannot fake.
function computeDelay(cfg, opts = {}) {
  const lo = Math.max(250, cfg.minThinkMs);
  const hi = Math.max(lo + 100, cfg.maxThinkMs);
  const skew = (Math.random() + Math.random() + Math.random()) / 3;
  let ms = lo + (hi - lo) * skew;

  const ply = Number.isFinite(opts.plyCount) ? opts.plyCount : 16;
  if (ply < 6) ms *= 0.72;
  else if (ply > 60) ms *= 0.86;

  // Uncertainty: a position with one obvious move is played faster than one
  // where two lines are 100cp apart.
  const gap = Number.isFinite(opts.gapCp) ? Math.abs(opts.gapCp) : null;
  if (gap !== null) {
    if (gap <= 12) ms *= 0.82;
    else if (gap >= 90) ms *= 1.28;
  }

  if (opts.legalMoveCount && opts.legalMoveCount <= 3) ms *= 0.8;
  if (opts.isCheck) ms *= 1.12;
  if (opts.isCapture) ms *= 0.92;

  // Rare second thought, outside the normal window. The pattern-breaker a
  // bounded uniform delay does not have.
  if (opts.allowRethink && Math.random() < 0.035) ms *= rand(1.45, 1.95);

  if (cfg.pauseOnLowClock && Number.isFinite(opts.clockSeconds)) {
    if (opts.clockSeconds <= 8) ms = Math.min(ms, 420);
    else if (opts.clockSeconds <= cfg.clockFloorSeconds) ms = Math.min(ms, 900);
  }
  return Math.round(clamp(ms, 250, 9000));
}

// Synthetic board input. Verified on the live chess.com board: a click pair and
// a drag both move the piece (e2e4, e7e5, g1f3). Coordinates are jittered and
// the pointer travels a curved path, so the event stream is not a fixed cadence.

function jitteredSquareClientXY(boardEl, squareStr, flipped) {
  const sq = Chess.parseSquare(squareStr);
  if (!sq || !boardEl) return null;
  const rect = boardEl.getBoundingClientRect();
  if (rect.width < 40 || rect.height < 40) return null;

  const sqW = rect.width / 8;
  const sqH = rect.height / 8;
  const col = flipped ? 7 - sq.file : sq.file;
  const row = flipped ? sq.rank : 7 - sq.rank;
  return {
    x: rect.left + (col + 0.5) * sqW + gaussian() * sqW * 0.52,
    y: rect.top + (row + 0.5) * sqH + gaussian() * sqH * 0.52
  };
}

function isInsideBoard(el, boardEl) {
  return Boolean(el && boardEl && (el === boardEl || boardEl.contains(el)));
}

function eventInit(x, y, buttons) {
  const chromeOffsetY = Math.max(72, window.outerHeight - window.innerHeight || 88);
  return {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: Math.round(x),
    clientY: Math.round(y),
    screenX: Math.round(x + (window.screenX || 0)),
    screenY: Math.round(y + (window.screenY || 0) + chromeOffsetY),
    button: 0,
    buttons
  };
}

function emitPointer(target, type, x, y, buttons) {
  const opts = eventInit(x, y, buttons);
  if (type.startsWith('pointer')) {
    try {
      target.dispatchEvent(
        new PointerEvent(type, { ...opts, pointerId: 1, pointerType: 'mouse', isPrimary: true })
      );
    } catch {
      /* very old engines: the mouse event below is still delivered */
    }
  } else {
    target.dispatchEvent(new MouseEvent(type, opts));
  }
}

async function movePointerCurve(fromPt, toPt, buttons, boardEl) {
  const dist = Math.hypot(toPt.x - fromPt.x, toPt.y - fromPt.y);
  const steps = Math.max(6, Math.min(16, Math.round(dist / 28) + 4));
  const dx = toPt.x - fromPt.x;
  const dy = toPt.y - fromPt.y;
  const perp = Math.hypot(dx, dy) || 1;
  const arc = (Math.random() - 0.5) * Math.min(34, dist * 0.18);
  const ctrlX = (fromPt.x + toPt.x) / 2 + (-dy / perp) * arc;
  const ctrlY = (fromPt.y + toPt.y) / 2 + (dx / perp) * arc;

  for (let i = 1; i <= steps; i++) {
    const raw = i / steps;
    const t = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
    const inv = 1 - t;
    const x = inv * inv * fromPt.x + 2 * inv * t * ctrlX + t * t * toPt.x;
    const y = inv * inv * fromPt.y + 2 * inv * t * ctrlY + t * t * toPt.y;
    let target = document.elementFromPoint(x, y);
    if (!isInsideBoard(target, boardEl)) target = boardEl;
    emitPointer(target, 'pointermove', x, y, buttons);
    emitPointer(target, 'mousemove', x, y, buttons);
    await sleep(rand(7, 15));
  }
}

async function clickPoint(pt, boardEl) {
  let target = document.elementFromPoint(pt.x, pt.y);
  if (!isInsideBoard(target, boardEl)) target = boardEl;
  emitPointer(target, 'pointermove', pt.x, pt.y, 0);
  emitPointer(target, 'pointerdown', pt.x, pt.y, 1);
  emitPointer(target, 'mousedown', pt.x, pt.y, 1);
  await sleep(rand(18, 42));
  emitPointer(target, 'pointerup', pt.x, pt.y, 0);
  emitPointer(target, 'mouseup', pt.x, pt.y, 0);
  emitPointer(target, 'click', pt.x, pt.y, 0);
  return true;
}

async function executeMoveOnBoard(boardEl, uciMove, flipped, turnColor, options = {}) {
  if (!boardEl || !uciMove || uciMove.length < 4) return false;
  const fromSq = uciMove.slice(0, 2);
  const toSq = uciMove.slice(2, 4);
  const promo = uciMove.length >= 5 ? uciMove[4].toLowerCase() : null;

  const fromPt = jitteredSquareClientXY(boardEl, fromSq, flipped);
  const toPt = jitteredSquareClientXY(boardEl, toSq, flipped);
  if (!fromPt || !toPt) return false;

  const mode = options.inputMode || 'mixed';
  const useDrag = mode === 'drag' ? true : mode === 'click' ? false : Math.random() < 0.65;

  if (useDrag) {
    let fromTarget = document.elementFromPoint(fromPt.x, fromPt.y);
    if (!isInsideBoard(fromTarget, boardEl)) fromTarget = boardEl;
    emitPointer(fromTarget, 'pointermove', fromPt.x, fromPt.y, 0);
    await sleep(rand(15, 35));
    emitPointer(fromTarget, 'pointerdown', fromPt.x, fromPt.y, 1);
    emitPointer(fromTarget, 'mousedown', fromPt.x, fromPt.y, 1);
    await sleep(rand(28, 60));
    await movePointerCurve(fromPt, toPt, 1, boardEl);
    await sleep(rand(18, 45));
    let toTarget = document.elementFromPoint(toPt.x, toPt.y);
    if (!isInsideBoard(toTarget, boardEl)) toTarget = boardEl;
    emitPointer(toTarget, 'pointerup', toPt.x, toPt.y, 0);
    emitPointer(toTarget, 'mouseup', toPt.x, toPt.y, 0);
  } else {
    await clickPoint(fromPt, boardEl);
    await sleep(rand(45, 110));
    await movePointerCurve(fromPt, toPt, 0, boardEl);
    await clickPoint(toPt, boardEl);
  }

  if (promo) {
    await sleep(rand(95, 175));
    const promoCls = `${turnColor === 'b' ? 'b' : 'w'}${promo}`;
    const promoEl =
      boardEl.querySelector(`.promotion-window .promotion-piece.${promoCls}`) ||
      document.querySelector(`.promotion-window .promotion-piece.${promoCls}`);
    if (promoEl) {
      const pr = promoEl.getBoundingClientRect();
      await clickPoint(
        {
          x: pr.left + pr.width * (0.5 + gaussian() * 0.4),
          y: pr.top + pr.height * (0.5 + gaussian() * 0.4)
        },
        boardEl
      );
    }
  }
  return true;
}

// Shadow-DOM panel. No page styles, no light-DOM ids: the host is fixed,
// pointer-events:none, and only the card itself accepts the pointer.

const PANEL_CSS = `
:host{all:initial;font-family:Inter,"Segoe UI",system-ui,sans-serif}
.wrap{position:fixed;top:16px;right:16px;width:304px;box-sizing:border-box;pointer-events:auto;z-index:2147483000;
  color:#ece7dc;background:rgba(18,17,15,.96);border:1px solid #3a3630;border-radius:12px;
  box-shadow:0 16px 40px rgba(0,0,0,.55);overflow:hidden;font-size:12px;line-height:1.4;user-select:none}
.wrap.collapsed{width:auto}
.wrap.collapsed .body{display:none}
.head{display:flex;align-items:center;gap:8px;padding:8px 8px 8px 10px;background:#1d1b18;border-bottom:1px solid #33302b;cursor:grab}
.head:active{cursor:grabbing}
.brand{font-weight:700;letter-spacing:.4px;font-size:11px;color:#f0e9db;flex:1}
.brand small{font-weight:500;color:#8d877c;margin-left:6px;letter-spacing:0}
.dot{width:7px;height:7px;border-radius:50%;background:#4a443c;flex:none}
.dot.on{background:#39b57f}.dot.busy{background:#d8a84c}.dot.warn{background:#d9655f}
.body{padding:10px;display:flex;flex-direction:column;gap:8px}
.row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.eval{font-family:ui-monospace,Consolas,monospace;font-variant-numeric:tabular-nums;font-weight:700;
  font-size:15px;color:#6fe0b0;background:#0d0c0a;border:1px solid #2fa474;border-radius:7px;padding:2px 8px}
.eval.neg{color:#e08c8c;border-color:#7a4141}
.move{font-family:ui-monospace,Consolas,monospace;font-weight:700;font-size:16px;color:#f4efe4}
.meta{color:#948d80;font-size:10.5px;font-variant-numeric:tabular-nums}
.lines{background:#0d0c0a;border:1px solid #2b2721;border-radius:8px;padding:6px 7px;display:flex;flex-direction:column;gap:3px}
.line{display:flex;gap:6px;font-family:ui-monospace,Consolas,monospace;font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.line b{color:#6fe0b0;min-width:42px;flex:none}.line.alt b{color:#d8a84c}
.line span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.badge{font-size:9.5px;border:1px solid #3a3630;border-radius:999px;padding:1px 6px;color:#a29a8c}
.badge.live{border-color:#2fa474;color:#6fe0b0}
.badge.warn{border-color:#7a4141;color:#e08c8c}
.btns{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px}
button{font:inherit;font-size:10.5px;font-weight:600;color:#e6e0d3;background:#26221d;border:1px solid #3c3830;
  border-radius:7px;padding:6px 2px;cursor:pointer;min-width:0;box-sizing:border-box}
button:hover{background:#332e27}
button.on{background:rgba(57,181,127,.18);border-color:#2fa474;color:#7fe3b8}
button.active{background:#2a3a33;border-color:#2fa474}
.sep{height:1px;background:#2b2721;margin:1px 0}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
label{display:flex;flex-direction:column;gap:2px;font-size:10px;color:#948d80}
select,input[type=number]{font:inherit;font-size:11px;color:#ece7dc;background:#161513;border:1px solid #3a3630;border-radius:6px;padding:3px 5px}
input[type=range]{width:100%}
.hidden{display:none}
.foot{display:flex;justify-content:space-between;align-items:center;gap:6px}
.warnline{color:#d8a84c;font-size:10px}
`;

const PANEL_HTML = `
<div class="head" data-el="head">
  <span class="dot" data-el="dot"></span>
  <div class="brand">CHESS WRAITH <small data-el="engine">starting</small></div>
  <button type="button" data-el="min" style="border:none;background:none;padding:0 2px;font-size:13px;color:#8d877c">–</button>
</div>
<div class="body">
  <div class="row">
    <span class="eval" data-el="eval">–</span>
    <span class="move" data-el="best">–</span>
    <span class="badge" data-el="turn">–</span>
  </div>
  <div class="meta" data-el="meta">waiting for a board…</div>
  <div class="lines" data-el="lines"></div>
  <div class="meta" data-el="sub"></div>
  <div class="row">
    <span class="badge" data-el="mode">Auto: OFF</span>
    <span class="warnline" data-el="warn"></span>
  </div>
  <div class="btns">
    <button type="button" data-el="auto">Auto</button>
    <button type="button" data-el="step">Step</button>
    <button type="button" data-el="scan">Scan</button>
    <button type="button" data-el="conf">⚙</button>
  </div>
  <div class="sep"></div>
  <div class="grid hidden" data-el="settings">
    <label>Style
      <select data-el="style">
        <option value="adaptive">Adaptive</option>
        <option value="gm">GM-like</option>
        <option value="club">Club</option>
        <option value="casual">Casual</option>
        <option value="engine">Full engine</option>
      </select>
    </label>
    <label>Target Elo <input type="number" data-el="elo" min="1320" max="3190" step="10"></label>
    <label>Depth <input type="number" data-el="depth" min="4" max="20" step="1"></label>
    <label>Think ms <input type="number" data-el="movetime" min="150" max="5000" step="50"></label>
    <label>Min delay <input type="number" data-el="mint" min="250" max="6000" step="50"></label>
    <label>Max delay <input type="number" data-el="maxt" min="400" max="15000" step="100"></label>
    <label>Slack cp <input type="number" data-el="slack" min="0" max="300" step="5"></label>
    <label>Lines <input type="number" data-el="showLines" min="1" max="4" step="1"></label>
  </div>
  <div class="foot">
    <span class="meta">Alt+Shift+A auto · M step · H hide</span>
    <button type="button" data-el="hide">Hide</button>
  </div>
</div>
`;

class WraithPanel {
  constructor(cfg, handlers) {
    this.cfg = cfg;
    this.handlers = handlers;
    this.host = document.createElement('div');
    this.host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483000;';
    this.shadow = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    this.shadow.appendChild(style);

    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML = PANEL_HTML;
    this.shadow.appendChild(wrap);
    this.wrap = wrap;
    this.el = {};
    for (const node of wrap.querySelectorAll('[data-el]')) this.el[node.dataset.el] = node;

    this.#wire();
    this.render();
    this.hidden = false;
  }

  mount() {
    if (!this.host.isConnected) (document.body || document.documentElement).appendChild(this.host);
  }

  unmount() {
    if (this.host.isConnected) this.host.remove();
  }

  #wire() {
    const on = (el, type, fn) => el && el.addEventListener(type, fn);
    on(this.el.auto, 'click', () => this.handlers.toggleAuto());
    on(this.el.step, 'click', () => this.handlers.step());
    on(this.el.scan, 'click', () => this.handlers.scan());
    on(this.el.hide, 'click', () => this.handlers.hide());
    on(this.el.conf, 'click', () => {
      this.el.settings.classList.toggle('hidden');
      this.el.conf.classList.toggle('active');
    });
    on(this.el.min, 'click', () => this.toggleCollapsed());
    on(this.el.head, 'dblclick', () => this.toggleCollapsed());

    const bindNumber = (el, key) => {
      if (!el) return;
      el.value = String(this.cfg[key]);
      on(el, 'change', () => {
        this.cfg[key] = clampInt(el.value, Number(el.min), Number(el.max), this.cfg[key]);
        el.value = String(this.cfg[key]);
        this.handlers.settingsChanged(this.cfg);
      });
    };
    bindNumber(this.el.elo, 'targetElo');
    bindNumber(this.el.depth, 'maxDepth');
    bindNumber(this.el.movetime, 'moveTimeMs');
    bindNumber(this.el.mint, 'minThinkMs');
    bindNumber(this.el.maxt, 'maxThinkMs');
    bindNumber(this.el.slack, 'humanSlackCp');
    bindNumber(this.el.showLines, 'showLines');

    on(this.el.style, 'change', () => {
      this.cfg.style = pickEnum(this.el.style.value, Object.keys(STYLES), 'adaptive');
      this.handlers.settingsChanged(this.cfg);
    });

    this.#drag();
  }

  #drag() {
    let dragging = false;
    let sx = 0;
    let sy = 0;
    let ox = 0;
    let oy = 0;
    this.el.head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      const r = this.wrap.getBoundingClientRect();
      sx = e.clientX;
      sy = e.clientY;
      ox = r.left;
      oy = r.top;
      this.wrap.style.right = 'auto';
      this.wrap.style.left = `${ox}px`;
      this.wrap.style.top = `${oy}px`;
    });
    window.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const maxLeft = Math.max(8, window.innerWidth - this.wrap.offsetWidth - 8);
      const maxTop = Math.max(8, window.innerHeight - 40);
      this.wrap.style.left = `${clamp(ox + e.clientX - sx, 8, maxLeft)}px`;
      this.wrap.style.top = `${clamp(oy + e.clientY - sy, 8, maxTop)}px`;
    });
    window.addEventListener('pointerup', () => {
      dragging = false;
    });
  }

  toggleCollapsed() {
    this.wrap.classList.toggle('collapsed');
    this.cfg.panelCollapsed = this.wrap.classList.contains('collapsed');
    this.handlers.settingsChanged(this.cfg);
  }

  toggleHidden() {
    this.hidden = !this.hidden;
    this.wrap.style.display = this.hidden ? 'none' : '';
    return this.hidden;
  }

  render(view = {}) {
    const { engine, analysis, autoPlay, turn, myTurn, status, warn, clock, opponent } = view;
    if (engine) this.el.engine.textContent = engine;
    this.el.dot.className = `dot ${status === 'thinking' ? 'busy' : analysis ? 'on' : warn ? 'warn' : ''}`;

    const top = analysis && analysis.lines && analysis.lines[0];
    if (top) {
      this.el.eval.textContent = top.evalText;
      this.el.eval.classList.toggle('neg', (top.whiteCp || 0) < -20);
      this.el.best.textContent = (analysis.bestSan || top.bestSan || top.bestUci || '–');
      this.el.meta.textContent = `d${top.depth} · ${analysis.engine || ''}${clock ? ` · ${Math.round(clock)}s` : ''}`;
      const linesBox = this.el.lines;
      linesBox.textContent = '';
      const take = Math.min(this.cfg.showLines, analysis.lines.length);
      for (let i = 0; i < take; i++) {
        const line = analysis.lines[i];
        const row = document.createElement('div');
        row.className = i === 0 ? 'line' : 'line alt';
        const b = document.createElement('b');
        b.textContent = line.evalText;
        const s = document.createElement('span');
        s.textContent = line.sanLine || (line.pv || []).join(' ');
        row.append(b, s);
        linesBox.appendChild(row);
      }
    } else {
      this.el.eval.textContent = '–';
      this.el.best.textContent = '–';
      this.el.meta.textContent = status === 'thinking' ? 'thinking…' : 'waiting for a board…';
    }

    this.el.turn.textContent = turn ? (turn === 'w' ? 'White' : 'Black') : '–';
    this.el.turn.className = `badge ${myTurn ? 'live' : ''}`;
    this.el.mode.textContent = autoPlay ? 'Auto: ON' : 'Auto: OFF';
    this.el.mode.className = `badge ${autoPlay ? 'live' : ''}`;
    this.el.auto.classList.toggle('on', Boolean(autoPlay));
    this.el.warn.textContent = warn || (opponent ? `opp ${opponent}` : '');
    const bits = [];
    if (view.acpl !== null && view.acpl !== undefined && view.acpl > 0) bits.push(`you ${Math.round(view.acpl)} acpl`);
    if (view.estimate) bits.push(`opp ~${view.estimate}`);
    if (view.elo) bits.push(`target ${view.elo}`);
    this.el.sub.textContent = bits.join(' · ');
    if (this.el.style.value !== this.cfg.style) this.el.style.value = this.cfg.style;
    this.el.settings.classList.toggle('hidden', !this.el.conf.classList.contains('active'));
  }
}

// Orchestrator: read the board, ask the engine, wait like a human, play, verify.

const OPENING_KEY = 'chess-wraith-openings-v1';

const cfg = loadSettings();
const engine = new WraithEngine();
const tracker = new Chess.ChessStateTracker();

const state = {
  boardEl: null,
  snapshot: null,
  prevSnapshot: null,
  analysis: null,
  autoPlay: Boolean(cfg.autoPlayOnLoad),
  thinking: false,
  searchSeq: 0,
  latestSearch: 0,
  analyzedFen: null,
  autoMovedFen: null,
  autoTimer: null,
  top1Streak: 0,
  oppCpLosses: [],
  oppEloEstimate: null,
  lossRecordedFen: null,
  myCpLosses: [],
  myAcpl: 0,
  effectiveElo: null,
  warn: '',
  clockSeconds: null,
  opponentRating: null
};

// Diagnostic FEN for the panel/debug API only; the real analysis path uses the
// tracker, which reconstructs turn, en passant and castling rights.
function buildSnapshotFen(scan) {
  const turn = scan.activeClockTurn || (scan.flipped ? 'b' : 'w');
  return `${Chess.gridToPlacement(scan.grid)} ${turn} - - 0 1`;
}

function mySide(flipped) {
  if (cfg.sideOverride === 'w' || cfg.sideOverride === 'b') return cfg.sideOverride;
  return flipped ? 'b' : 'w';
}

function plyOf(snap) {
  if (!snap) return 16;
  if (Number.isFinite(snap.plyCount)) return snap.plyCount;
  if (Number.isFinite(snap.fullmove)) return (snap.fullmove - 1) * 2 + (snap.turn === 'b' ? 1 : 0);
  return 16;
}

function resolveElo() {
  const elo = effectiveElo(cfg, { oppElo: state.oppEloEstimate || state.opponentRating });
  state.effectiveElo = elo;
  return elo;
}

// --- opening variety -------------------------------------------------------
// Always the same first move is a pattern that has nothing to do with move
// choice, and it is the easiest one to spot across games.
function readOpenings() {
  try {
    const raw = JSON.parse(localStorage.getItem(OPENING_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function recordOpening(uci, ply) {
  if (!uci || ply > 2) return;
  const list = readOpenings();
  list.push(uci);
  while (list.length > 12) list.shift();
  try {
    localStorage.setItem(OPENING_KEY, JSON.stringify(list));
  } catch {
    /* storage can be blocked; variety is a bonus, not a requirement */
  }
}

function repeatedOpening(uci, ply) {
  if (!uci || ply > 2) return null;
  const recent = readOpenings().slice(-6);
  const count = recent.filter((x) => x === uci).length;
  return count >= 2 ? uci : null;
}

// chess.com's own write-up lists "global scope audits" among the things they
// look for in cheat clients. A script that names itself on `window` for every
// visitor is a free fingerprint, so the debug API is opt-in.
function debugEnabled() {
  try {
    if (/[?&]cw=1(&|$)/.test(location.search)) return true;
    return localStorage.getItem('chess-wraith-debug') === '1';
  } catch {
    return false;
  }
}

function registerButler() {
  if (!debugEnabled()) return;
  const api = {
    version: VERSION,
    state,
    config: cfg,
    engine,
    panel,
    chooseMove: (lines) => chooseMove(lines, cfg, { top1Streak: state.top1Streak, oppElo: state.oppEloEstimate }),
    computeDelay: (opts) => computeDelay(cfg, opts),
    scan: () => runScan(),
    board: () => {
      const scan = scanBoard(mySide(state.snapshot ? state.snapshot.flipped : false));
      if (!scan || !scan.valid) return { valid: false };
      return { valid: true, flipped: scan.flipped, placement: Chess.gridToPlacement(scan.grid), fen: buildSnapshotFen(scan) };
    },
    ready: () => engine.ready,
    analyzeNow: () => analyze(state.snapshot, true),
    playNow,
    unload() {
      clearAutoTimer();
      engine.destroy();
      panel.unmount();
      if (boardObserver) boardObserver.disconnect();
      if (docObserver) docObserver.disconnect();
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onGeometry, true);
      if (scanTimer) clearInterval(scanTimer);
      delete globalThis.ChessWraith;
    }
  };
  globalThis.ChessWraith = api;
}

function clearAutoTimer() {
  if (state.autoTimer) {
    clearTimeout(state.autoTimer);
    state.autoTimer = null;
  }
}

function statusView() {
  const snap = state.snapshot;
  const side = mySide(snap ? snap.flipped : false);
  return {
    engine: engine.mode,
    analysis: state.analysis,
    autoPlay: state.autoPlay,
    turn: snap ? snap.turn : null,
    myTurn: Boolean(snap && snap.turn === side),
    status: state.thinking ? 'thinking' : '',
    warn: state.warn,
    clock: state.clockSeconds,
    opponent: state.opponentRating,
    estimate: state.oppEloEstimate,
    acpl: state.myAcpl,
    elo: state.effectiveElo
  };
}

function refreshPanel() {
  panel.render(statusView());
}

// The opponent's centipawn loss is only knowable once the position after their
// move has been evaluated, so it is measured here and not when the move lands.
function recordOpponentLoss(result) {
  const snap = state.snapshot;
  const prev = state.prevSnapshot;
  if (!snap || !prev || !result || !result.lines || result.lines.length === 0) return;
  if (state.lossRecordedFen === snap.fen) return;

  const side = mySide(snap.flipped);
  const opp = side === 'w' ? 'b' : 'w';
  if (prev.turn !== opp) return;

  const before = typeof snap.evalWhiteCp === 'number' ? snap.evalWhiteCp : null;
  if (before === null) return;
  const after = result.lines[0].whiteCp;
  if (typeof after !== 'number') return;

  state.lossRecordedFen = snap.fen;
  const raw = opp === 'w' ? before - after : after - before;
  const loss = clamp(Math.round(raw), 0, 450);
  state.oppCpLosses.push(loss);
  if (state.oppCpLosses.length > 24) state.oppCpLosses.shift();
  const avg = state.oppCpLosses.reduce((a, b) => a + b, 0) / state.oppCpLosses.length;
  state.oppEloEstimate = Math.round(clamp(2750 - 380 * Math.log1p(avg / 3.8), 1050, 2850));
  state.effectiveElo = resolveElo();
}

function analyze(snapshot, force) {
  if (!snapshot || !snapshot.fen) return;
  const legal = Chess.generateLegalMoves(snapshot);
  if (legal.length === 0) {
    state.thinking = false;
    clearAutoTimer();
    refreshPanel();
    return;
  }
  if (!force && snapshot.fen === state.analyzedFen && state.analysis) {
    refreshPanel();
    return;
  }

  clearAutoTimer();
  state.searchSeq += 1;
  state.latestSearch = state.searchSeq;
  state.analyzedFen = snapshot.fen;
  state.thinking = true;
  refreshPanel();

  const request = {
    fen: snapshot.fen,
    uciMoves: snapshot.uciMoves,
    turn: snapshot.turn,
    flipped: snapshot.flipped,
    depth: cfg.maxDepth,
    moveTimeMs: cfg.moveTimeMs,
    multiPv: Math.max(1, cfg.multiPv),
    elo: resolveElo(),
    skill: 20
  };
  engine.analyze(request).then(() => {
    state.thinking = false;
    refreshPanel();
  });
}

function onFinal(result) {
  if (result.fen !== (state.snapshot && state.snapshot.fen)) return;
  state.analysis = result;
  state.thinking = false;
  recordOpponentLoss(result);
  refreshPanel();
  if (state.autoPlay) scheduleAutoMove(result);
}

function scheduleAutoMove(result) {
  clearAutoTimer();
  const snap = state.snapshot;
  if (!snap || !state.boardEl || !result || !result.lines || result.lines.length === 0) return;
  if (snap.gameOver) return;
  if (state.autoMovedFen === result.fen) return;
  if (mySide(snap.flipped) !== snap.turn) return;
  if (cfg.pauseWhenHidden && document.hidden) return;
  if (cfg.pauseOnLowClock && Number.isFinite(state.clockSeconds) && state.clockSeconds <= 5) return;
  if (isPromotionWindowOpen() || hasPremove(state.boardEl)) return;

  const ply = plyOf(snap);
  const choice = chooseMove(result.lines, cfg, {
    top1Streak: state.top1Streak,
    oppElo: state.oppEloEstimate || state.opponentRating,
    repeatUci: repeatedOpening(result.bestmove, ply)
  });
  const move = (choice && choice.line && choice.line.bestUci) || result.bestmove;
  if (!move) return;

  const legal = Chess.generateLegalMoves(snap);
  const toRank = move.charCodeAt(3) - 49;
  const toFile = move.charCodeAt(2) - 97;
  const isCapture = Boolean(snap.grid[toRank] && snap.grid[toRank][toFile]);
  const gapCp = result.lines.length > 1 ? Math.abs(sideScore(result.lines[0]) - sideScore(result.lines[1])) : null;
  const bestSan = (choice && choice.line && choice.line.bestSan) || '';
  const delay = computeDelay(cfg, {
    plyCount: ply,
    legalMoveCount: legal.length,
    isCapture,
    isCheck: /[+#]$/.test(bestSan),
    gapCp,
    allowRethink: true,
    clockSeconds: state.clockSeconds
  });

  const targetFen = result.fen;
  state.autoTimer = setTimeout(() => {
    state.autoTimer = null;
    if (!state.autoPlay || !state.snapshot || state.snapshot.fen !== targetFen) return;
    if (mySide(state.snapshot.flipped) !== state.snapshot.turn) return;
    if (cfg.pauseWhenHidden && document.hidden) return;
    playMove(move, targetFen, choice);
  }, delay);

  refreshPanel();
}

async function playMove(move, targetFen, choice) {
  const snap = state.snapshot;
  if (!snap || !state.boardEl) return false;
  state.autoMovedFen = targetFen;
  const ok = await executeMoveOnBoard(state.boardEl, move, snap.flipped, snap.turn, {
    inputMode: 'mixed'
  });
  if (!ok) return false;

  // The click can be swallowed by an ad overlay, a promotion dialog or a slow
  // board. Look at the board before assuming the move landed.
  await sleep(cfg.verifyMoveMs);
  const after = scanBoard(mySide(state.snapshot ? state.snapshot.flipped : false));
  const landed = after && after.valid && after.grid && !Chess.gridsEqual(snap.grid, after.grid);
  if (landed) {
    if (choice && choice.cpLoss === 0) state.top1Streak += 1;
    else state.top1Streak = 0;
    if (choice) {
      state.myCpLosses.push(clamp(Math.round(choice.cpLoss || 0), 0, 600));
      if (state.myCpLosses.length > 20) state.myCpLosses.shift();
      state.myAcpl = state.myCpLosses.reduce((a, b) => a + b, 0) / state.myCpLosses.length;
    }
    recordOpening(move, plyOf(snap));
    scheduleScan(120);
    return true;
  }

  if (cfg.retryMoveOnce) {
    state.warn = 'move not registered, retrying';
    refreshPanel();
    await sleep(450);
    await executeMoveOnBoard(state.boardEl, move, snap.flipped, snap.turn, { inputMode: 'click' });
    await sleep(cfg.verifyMoveMs);
    const second = scanBoard(mySide(snap.flipped));
    if (second && second.valid && !Chess.gridsEqual(snap.grid, second.grid)) {
      state.warn = '';
      recordOpening(move, plyOf(snap));
      scheduleScan(120);
      return true;
    }
  }
  state.warn = 'chess.com ignored the click; auto-play paused';
  state.autoPlay = false;
  refreshPanel();
  return false;
}

async function playNow() {
  const snap = state.snapshot;
  const result = state.analysis;
  if (!snap || !state.boardEl || !result) return false;
  if (result.fen !== snap.fen) return false;
  const ply = plyOf(snap);
  const choice = chooseMove(result.lines, cfg, {
    top1Streak: state.top1Streak,
    oppElo: state.oppEloEstimate || state.opponentRating,
    repeatUci: repeatedOpening(result.bestmove, ply)
  });
  const move = (choice && choice.line && choice.line.bestUci) || result.bestmove;
  if (!move) return false;
  return playMove(move, snap.fen, choice);
}

let scanTimer = null;
let scanQueued = false;

function scheduleScan(delayMs = 90) {
  if (scanQueued) return;
  scanQueued = true;
  setTimeout(() => {
    scanQueued = false;
    runScan();
  }, delayMs);
}

function runScan() {
  const side = mySide(state.snapshot ? state.snapshot.flipped : false);
  const scanned = scanBoard(side);
  if (!scanned) {
    if (state.boardEl) {
      state.boardEl = null;
      state.snapshot = null;
      state.analysis = null;
      refreshPanel();
    }
    return;
  }

  if (scanned.boardEl !== state.boardEl) attachBoard(scanned.boardEl);

  if (!scanned.valid) {
    refreshPanel();
    return;
  }

  state.clockSeconds = scanned.clockSeconds;
  state.opponentRating = scanned.opponentRating;

  const prev = state.snapshot;
  const snapshot = tracker.updateFromDomSnapshot(scanned.grid, {
    flipped: scanned.flipped,
    plyCount: scanned.plyCount,
    sanMoves: scanned.sanMoves,
    lastHighlightSquares: scanned.lastHighlightSquares,
    activeClockTurn: scanned.activeClockTurn
  });
  if (!snapshot) return;

  const changed = !prev || prev.fen !== snapshot.fen;
  if (changed) {
    // Carry the evaluation of the position we just left onto the new snapshot:
    // the opponent's loss is measured from it once this position is evaluated.
    snapshot.evalWhiteCp =
      prev && state.analysis && state.analysis.lines && state.analysis.lines[0]
        ? state.analysis.lines[0].whiteCp
        : null;
    state.prevSnapshot = prev;
    state.snapshot = snapshot;
    state.analysis = null;
    state.autoMovedFen = null;
    if (scanned.gameOver) {
      state.autoPlay = false;
      state.warn = 'game over';
      clearAutoTimer();
      refreshPanel();
      return;
    }
    analyze(snapshot, false);
  } else {
    state.snapshot = snapshot;
    refreshPanel();
  }
}

let boardObserver = null;
let docObserver = null;

function attachBoard(boardEl) {
  if (boardObserver) boardObserver.disconnect();
  state.boardEl = boardEl;
  boardObserver = new MutationObserver(() => scheduleScan(70 + Math.floor(Math.random() * 60)));
  boardObserver.observe(boardEl, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'flipped']
  });
  const list = document.querySelector(MOVE_LIST_SELECTOR);
  if (list) {
    boardObserver.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }
}

function onKeyDown(event) {
  if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
  const key = event.key.toLowerCase();
  if (key === 'a') {
    event.preventDefault();
    toggleAuto();
  } else if (key === 'm') {
    event.preventDefault();
    playNow();
  } else if (key === 'h') {
    event.preventDefault();
    panel.toggleHidden();
  }
}

function onGeometry() {
  /* the panel is fixed; nothing to recompute */
}

function toggleAuto() {
  state.autoPlay = !state.autoPlay;
  cfg.autoPlayOnLoad = state.autoPlay;
  saveSettings(cfg);
  if (!state.autoPlay) clearAutoTimer();
  else if (state.analysis && state.snapshot && state.analysis.fen === state.snapshot.fen) {
    scheduleAutoMove(state.analysis);
  }
  refreshPanel();
}

function settingsChanged(next) {
  Object.assign(cfg, next);
  saveSettings(cfg);
  state.analyzedFen = null;
  engine.stop();
  scheduleScan(60);
  refreshPanel();
}

const panel = new WraithPanel(cfg, {
  toggleAuto,
  step: () => playNow(),
  scan: () => {
    state.analyzedFen = null;
    runScan();
    analyze(state.snapshot, true);
  },
  hide: () => panel.toggleHidden(),
  settingsChanged
});

engine.onReady = (mode) => {
  state.warn = '';
  panel.render({ ...statusView(), engine: mode });
};

engine.onError = (message) => {
  state.warn = message;
  refreshPanel();
};

engine.onProgress = (result) => {
  if (!state.snapshot || result.fen !== state.snapshot.fen) return;
  state.analysis = result;
  refreshPanel();
};

engine.onFinal = onFinal;

function boot() {
  panel.mount();
  panel.render(statusView());
  refreshPanel();
  engine.boot();
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', onGeometry, true);

  docObserver = new MutationObserver(() => {
    if (!state.boardEl || !state.boardEl.isConnected) scheduleScan(140);
  });
  docObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });

  runScan();
  scanTimer = setInterval(() => {
    if (!state.boardEl || !state.boardEl.isConnected) scheduleScan(0);
    else if (!state.analysis && !state.thinking) runScan();
  }, 2000);

  registerButler();
}

boot();

})();
