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
    // Where the turn came from. Anything but 'assumed' is evidence; 'assumed'
    // is the fallback and the caller must not play on it.
    let turnSource = 'assumed';

    if (hints.turnOverride === 'w' || hints.turnOverride === 'b') {
      turn = hints.turnOverride;
      turnSource = 'override';
    } else if (typeof hints.plyCount === 'number' && hints.plyCount >= 0) {
      turn = hints.plyCount % 2 === 0 ? 'w' : 'b';
      turnSource = 'ply';
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
          turnSource = 'highlight';
          if (dest.piece.toLowerCase() === 'p' && orig.file === dest.file && Math.abs(dest.rank - orig.rank) === 2) {
            ep = squareName(dest.file, (orig.rank + dest.rank) / 2);
          }
        }
      }
    } else if (hints.activeClockTurn === 'w' || hints.activeClockTurn === 'b') {
      turn = hints.activeClockTurn;
      turnSource = 'clock';
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
      fullmove,
      turnSource
    };
  }

  class ChessStateTracker {
    constructor() {
      this.reset();
    }

    reset() {
      this.currentState = null;
      this.uciMoves = null; // null when attached mid-game without full history from startpos
      this.turnSource = 'assumed';
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
        turnSource: this.turnSource,
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
      this.turnSource = 'override';
      return this.getSnapshot(false, null);
    }

    getSnapshot(changed, lastMoveUci) {
      return {
        ...this.currentState,
        fen: buildFen(this.currentState),
        uciMoves: Array.isArray(this.uciMoves) ? this.uciMoves.slice() : null,
        turnSource: this.turnSource,
        // A guess is not evidence: display it, never act on it.
        turnCertain: this.turnSource !== 'assumed',
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
        this.turnSource = hints.turnOverride === 'w' || hints.turnOverride === 'b' ? 'override' : 'start';
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
          this.turnSource = 'moves';
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
          this.turnSource = 'override';
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
            this.turnSource = 'override';
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
          this.turnSource = hints.turnOverride === 'w' || hints.turnOverride === 'b'
            ? 'override'
            : (entry.turnSource || 'history');
          return this.getSnapshot(true, null);
        }
      }

      // Mid-game attach or board jump fallback
      this.currentState = inferMidgameState(grid, hints);
      this.uciMoves = null;
      this.turnSource = this.currentState.turnSource || 'assumed';
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
