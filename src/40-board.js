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
