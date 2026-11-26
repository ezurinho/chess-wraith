// Board reader for chess.com. Verified against the live analysis board: the
// grid, orientation, ply list, SAN list, last-move highlights, clock and
// opponent rating all come from the same DOM shapes the extension used.

const BOARD_SELECTORS = ['wc-chess-board', 'chess-board', '#board-single', '.board'];
const MOVE_LIST_SELECTOR = 'wc-simple-move-list, wc-vertical-move-list, wc-move-list, .vertical-move-list, vertical-move-list, .move-list, .move-list-component';

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
  return sanFromNodeText(node.textContent, figurine);
}

// Pure: a move node's text can carry a leading move number ("1.e4") or a whole
// pair ("1. e4 e5"), and the piece can live in an icon instead of the text.
function sanFromNodeText(text, figurine) {
  const clean = String(text || '').trim().replace(/\s+/g, '').replace(/^\d+\.+/, '');
  if (!clean) return '';
  // A pawn "figurine" is just a pawn: prefixing it would turn exd5 into Pexd5.
  const piece = String(figurine || '').toUpperCase();
  if (/^[KQRBN]$/.test(piece) && !/^[KQRBNO0]/.test(clean)) return `${piece}${clean}`;
  return clean;
}

// Move lists show up in two shapes: nodes tagged with data-ply (analysis boards
// and older layouts) and plain .node rows inside a move-list component. The
// second shape carries no reliable ply attribute, so DOM order is the ply.
// Both are read here once per scan; callers pass the result to the helpers.
function readMoveNodes() {
  const tagged = Array.from(document.querySelectorAll('[data-ply]'));
  if (tagged.length > 0) {
    return tagged.map((node) => {
      const ply = Number.parseInt(node.getAttribute('data-ply'), 10);
      return {
        node,
        ply: Number.isNaN(ply) ? null : ply,
        selected: node.matches('.selected') || Boolean(node.querySelector('.selected'))
      };
    });
  }
  const rows = [];
  for (const list of document.querySelectorAll(MOVE_LIST_SELECTOR)) {
    for (const node of list.querySelectorAll('.node')) rows.push(node);
  }
  if (rows.length === 0) return [];
  return rows.map((node, index) => ({
    node,
    ply: index + 1,
    selected: node.classList.contains('selected') || node.classList.contains('current')
  }));
}

function readSanMoveList(entries = readMoveNodes()) {
  return sanListFromEntries(
    entries.map((entry) => ({
      ply: entry.ply,
      san: extractSanFromNode(entry.node),
      selected: entry.selected
    }))
  );
}

// Pure: a list with a hole cannot be trusted as a move history, so it becomes
// an empty list instead of a wrong one.
function sanListFromEntries(entries) {
  const moves = (entries || []).filter((entry) => entry && entry.ply > 0 && entry.san);
  if (moves.length === 0) return [];
  const byPly = new Map();
  let maxPly = 0;
  for (const entry of moves) {
    if (!byPly.has(entry.ply)) byPly.set(entry.ply, entry.san);
    if (entry.ply > maxPly) maxPly = entry.ply;
  }
  if (maxPly === 0 || byPly.size < maxPly) return [];
  const list = [];
  for (let i = 1; i <= maxPly; i++) list.push(byPly.get(i));
  return list;
}

function readPlyCount(entries = readMoveNodes()) {
  return plyFromEntries(entries);
}

// Pure: the highlighted node is the current ply; otherwise the last one is.
function plyFromEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const selected = entries.find((entry) => entry && entry.selected && entry.ply);
  if (selected) return selected.ply;
  let maxPly = 0;
  for (const entry of entries) {
    if (entry && entry.ply && entry.ply > maxPly) maxPly = entry.ply;
  }
  return maxPly || null;
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

// Measured 2026-11-26: the live layout puts the players in `.board-layout-top` /
// `.player-top`, and the rating survives under three different names depending
// on the page (`user-tagline-rating`, `[data-cy]`, and the vs-computer
// `[data-user-block-part="rating"]` holding `(1234)`). Signed out, the game
// page shows no rating at all, so this returns null there — the caller treats
// that as "unknown opponent", not as 1500.
function ratingNumber(text) {
  if (!text) return null;
  const m = /(\d{3,4})/.exec(String(text).replace(/\s+/g, ' '));
  if (!m) return null;
  const rating = Number.parseInt(m[1], 10);
  // 100 is the floor of the rating pool, not of the bot market: the account in
  // front of the script was 133 and the opponent 113, and the old 250 minimum
  // threw both away — leaving the estimate to invent a 2000 for a 113 player.
  return rating >= 100 && rating <= 3500 ? rating : null;
}

// Both player rows carry a rating; which row is the opponent depends on the
// side we play. The lookup used to require one of four container classes, so a
// layout the list did not know (or the computer page) returned null — and the
// panel filled that gap with the ACPL estimate, showing a 113 opponent as ~2000.
// Read the two numbers wherever they live, then assign them to top and bottom.
const RATING_NODE_SELECTOR = [
  '.user-tagline-rating',
  '[data-cy="user-tagline-rating"]',
  '[data-user-block-part="rating"]',
  '[class*="user-rating"]',
  '[class*="tagline-rating"]',
  '[data-test-element="rating"]'
].join(',');

const PLAYER_BLOCK_SELECTOR = [
  '.player-component',
  '.player-row-component',
  '.board-layout-top',
  '.board-layout-bottom',
  '.player-top',
  '.player-bottom',
  '[class*="player-component"]'
].join(',');

// The row a rating belongs to, from the nearest ancestor whose class names it.
// No layout is required, so this also answers on a detached or hidden row.
function ratingBand(el) {
  let node = el;
  for (let depth = 0; node && depth < 14; depth += 1, node = node.parentElement) {
    const cls = String(node.className || '');
    if (/(^|[-_ ])top($|[-_ ])/.test(cls)) return 'top';
    if (/(^|[-_ ])bottom($|[-_ ])/.test(cls)) return 'bottom';
  }
  return '';
}

// Every short `(1234)` leaf on the page, deduped. The tagline selector is
// enough on the layouts measured so far; the leaf sweep under a player block is
// the fallback for a renamed class, because the shape of the number is stable.
function ratingNodes() {
  const out = [];
  const seen = new Set();
  const add = (el) => {
    if (seen.has(el)) return;
    seen.add(el);
    const text = (el.textContent || '').trim();
    if (text.length > 7 || !/^\(?\d{3,4}\)?$/.test(text)) return;
    const rating = ratingNumber(text);
    if (rating) out.push({ el, rating, band: ratingBand(el) });
  };
  for (const el of document.querySelectorAll(RATING_NODE_SELECTOR)) add(el);
  for (const root of document.querySelectorAll(PLAYER_BLOCK_SELECTOR)) {
    for (const leaf of root.querySelectorAll('*')) {
      if (leaf.children.length) continue;
      add(leaf);
    }
  }
  return out;
}

function readBoardRatings() {
  const found = ratingNodes();
  if (!found.length) return { top: null, bottom: null };
  const ordered = found.slice().sort((a, b) => (a.el.compareDocumentPosition(b.el) & 4 ? -1 : 1));
  let top = ordered.find((n) => n.band === 'top') || null;
  let bottom = ordered.find((n) => n.band === 'bottom') || null;
  if (!top && !bottom && ordered.length >= 2) {
    // No row class at all: document order is the only signal, and it is right
    // on chess.com, where the opponent row is painted first.
    top = ordered[0];
    bottom = ordered[ordered.length - 1];
  } else if (!top) {
    top = ordered.find((n) => n !== bottom) || null;
  } else if (!bottom) {
    bottom = ordered.find((n) => n !== top) || null;
  }
  // A single rating: the board's own geometry says which row it is on. jsdom and
  // a hidden page report zeros, so the answer stays unknown there instead of
  // guessing a side.
  if (ordered.length === 1) {
    const only = top || bottom;
    const board = findBoardElement();
    const rect = board && board.getBoundingClientRect();
    const r = only && only.el.getBoundingClientRect();
    if (only && r && r.height > 0 && rect && rect.height > 0) {
      const isTop = r.top + r.height / 2 < rect.top + rect.height / 2;
      return isTop ? { top: only.rating, bottom: null } : { top: null, bottom: only.rating };
    }
  }
  return { top: top ? top.rating : null, bottom: bottom ? bottom.rating : null };
}

function opponentRatingFrom(ratings, mySide, flipped) {
  const bottomColor = flipped ? 'b' : 'w';
  const oppIsTop = !mySide || mySide === bottomColor;
  return (oppIsTop ? ratings.top : ratings.bottom) || null;
}

function myRatingFrom(ratings, mySide, flipped) {
  const bottomColor = flipped ? 'b' : 'w';
  const oppIsTop = !mySide || mySide === bottomColor;
  return (oppIsTop ? ratings.bottom : ratings.top) || null;
}

function readOpponentRating(mySide, flipped) {
  return opponentRatingFrom(readBoardRatings(), mySide, flipped);
}

function readMyRating(mySide, flipped) {
  return myRatingFrom(readBoardRatings(), mySide, flipped);
}

// Measured on a real finished game page (chess.com, August 2026): the dialog is
// `.game-over-modal-shell-container` > `.board-modal-component` >
// `.game-over-modal-header-component`, whose title names the winner ("Black
// Won"). The older `.game-over-modal` / `.game-review-buttons` markup is kept as
// a fallback because it is what this file used to look for.
function isGameOverDom() {
  for (const sel of [
    '.game-over-modal-header-component',
    '.game-over-modal-title-component',
    '.game-over-modal-shell-container',
    '.board-modal-component',
    '.game-over-modal-content',
    '.game-over-header-component',
    '.game-over-modal',
    '.modal-game-over-component'
  ]) {
    const el = document.querySelector(sel);
    if (el && domShown(el)) return true;
  }
  return false;
}

// An element is on screen when it, or something above it, is laid out. The real
// dialog sits inside a fixed board overlay and is itself `position: relative`,
// so asking only about the element's own offsetParent answers "hidden" for a
// modal that fills the board.
function domShown(el) {
  let node = el;
  for (let depth = 0; node && depth < 8; depth += 1) {
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (node.offsetParent !== null || style.position === 'fixed') return true;
    node = node.parentElement;
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

  const moveNodes = readMoveNodes();
  return {
    boardEl,
    rect: boardEl.getBoundingClientRect(),
    flipped,
    valid: true,
    grid: read.grid,
    plyCount: readPlyCount(moveNodes),
    sanMoves: readSanMoveList(moveNodes),
    lastHighlightSquares: readLastHighlightSquares(boardEl),
    activeClockTurn: readActiveClockTurn(flipped),
    clockSeconds: readClockSeconds(mySide, flipped),
    opponentRating: readOpponentRating(mySide, flipped),
    myRating: readMyRating(mySide, flipped),
    gameOver: isGameOverDom()
  };
}
