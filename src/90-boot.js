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
