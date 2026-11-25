// Orchestrator: read the board, ask the engine, wait like a human, play, verify.

const OPENING_KEY = 'chess-wraith-openings-v1';
const PACE_KEY = 'chess-wraith-pace-v1';
// One board per browser: the lease is renewed every few seconds, so a closed
// tab hands the wheel over instead of blocking it forever.
const TAB_KEY = 'chess-wraith-tab-v1';
const TAB_TTL_MS = 9000;
const TAB_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);
// A move landing while a hand is on the board is the one case where the script
// must yield: playing over someone who just grabbed a piece looks exactly like
// what it is.
const TOUCH_GUARD_MS = 2000;

// Two accounts on the same browser should not share a pace fingerprint or an
// opening habit, so everything adaptive is keyed by whoever is signed in.
function currentAccount() {
  for (const sel of ['#user-username-component', '.user-username', '.profile-username']) {
    const el = document.querySelector(sel);
    const text = el ? (el.textContent || '').trim() : '';
    if (text) return text.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'anonymous';
  }
  return 'anonymous';
}

function paceKey() {
  return `${PACE_KEY}:${currentAccount()}`;
}

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
  opponentRating: null,
  gameOverSeen: false,
  rematchTried: false,
  rematchTimer: null,
  keepAlive: 'off',
  lastMyMoveAt: 0,
  lastDelayMs: 0,
  tempoSamples: [],
  boardTouchAt: 0,
  defers: 0,
  sessionStart: Date.now(),
  gamesPlayed: 1,
  slackBoost: 0,
  passiveTab: false,
  autoMovedGrid: null,
  updateLatest: '',
  updateAt: 0,
  updateError: '',
  updateChecking: false
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
    const raw = JSON.parse(localStorage.getItem(`${OPENING_KEY}:${currentAccount()}`) || '[]');
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
    localStorage.setItem(`${OPENING_KEY}:${currentAccount()}`, JSON.stringify(list));
  } catch {
    /* storage can be blocked; variety is a bonus, not a requirement */
  }
}

// This account's usual think time, learned from its own moves. Null until there
// is enough history to mean something.
function readPaceSamples() {
  try {
    const raw = JSON.parse(localStorage.getItem(paceKey()) || '[]');
    return Array.isArray(raw) ? raw.filter((n) => Number.isFinite(n) && n > 0) : [];
  } catch {
    return [];
  }
}

function paceBaseline() {
  const samples = readPaceSamples();
  return samples.length >= 6 ? median(samples) : null;
}

function recordPace(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  try {
    localStorage.setItem(paceKey(), JSON.stringify(pushBounded(readPaceSamples(), ms, 40)));
  } catch {
    /* storage can be blocked; the baseline is an optimization, not a rule */
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

// Two public static files answer this, and neither knows who is asking. The
// API goes first because it is immediate: jsDelivr's @latest can keep answering
// with the previous tag for hours after a release.
async function readVersion(url) {
  const response = await fetch(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!response || !response.ok) throw new Error(`HTTP ${response ? response.status : 0}`);
  const text = await response.text();
  const tagged = text.match(/@version\s+v?([\d.]+)/i);
  if (tagged) return tagged[1];
  const parsed = JSON.parse(text);
  return String(parsed.version || parsed.tag_name || '').replace(/^v/i, '');
}

async function checkUpdate() {
  if (state.updateChecking) return false;
  state.updateChecking = true;
  refreshPanel();
  try {
    let latest = '';
    try {
      latest = await readVersion(UPDATE_API_URL);
    } catch {
      latest = '';
    }
    if (!versionParts(latest)) latest = await readVersion(UPDATE_META_URL);
    if (!versionParts(latest)) throw new Error('no version');
    state.updateLatest = latest;
    state.updateError = '';
  } catch (error) {
    state.updateLatest = '';
    state.updateError = String((error && error.message) || error).slice(0, 60);
  } finally {
    state.updateChecking = false;
    state.updateAt = Date.now();
    refreshPanel();
  }
  return !state.updateError;
}

function startUpdateCheck() {
  // Six seconds: the engine and the board matter more than a version number.
  setTimeout(() => {
    checkUpdate();
  }, 6000);
  setInterval(() => {
    checkUpdate();
  }, UPDATE_CHECK_MS);
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
    retryEngine: () => engine.retryNnue(),
    checkUpdate,
    analyzeNow: () => analyze(state.snapshot, true),
    playNow,
    unload() {
      clearAutoTimer();
      clearRematchTimer();
      stopKeepAlive();
      engine.destroy();
      panel.unmount();
      if (boardObserver) boardObserver.disconnect();
      if (docObserver) docObserver.disconnect();
      window.removeEventListener('keydown', onKeyDown, true);
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

function clearRematchTimer() {
  if (state.rematchTimer) {
    clearTimeout(state.rematchTimer);
    state.rematchTimer = null;
  }
}

function syncKeepAlive() {
  if (cfg.afkKeepAlive) state.keepAlive = startKeepAlive();
  else state.keepAlive = stopKeepAlive();
  return state.keepAlive;
}

// AFK, in the same shape as nitro-wraith: wait like a person, press the button
// the site offers, and give up out loud instead of pretending to work.
function queueRematch() {
  if (!cfg.autoRematch || state.rematchTried || state.rematchTimer) return;
  const limit = sessionLimit({
    startedAt: state.sessionStart,
    games: state.gamesPlayed,
    now: Date.now(),
    maxGames: cfg.sessionMaxGames,
    maxMs: cfg.sessionMaxMs
  });
  if (limit.stop) {
    state.autoPlay = false;
    cfg.autoRematch = false;
    state.warn = limit.reason;
    saveSettings(cfg);
    refreshPanel();
    return;
  }
  const delay = nextGameDelay(cfg);
  state.rematchTimer = setTimeout(() => {
    state.rematchTimer = null;
    if (!cfg.autoRematch) return;
    if (!hasGameOverModal()) {
      state.rematchTried = true;
      return;
    }
    const button = findRematchButton();
    if (!button) {
      state.rematchTried = true;
      state.warn = 'no rematch button; AFK stopped';
      cfg.autoRematch = false;
      saveSettings(cfg);
      refreshPanel();
      return;
    }
    button.click();
    state.rematchTried = true;
    state.warn = '';
    scheduleScan(900);
    refreshPanel();
  }, delay);
  refreshPanel();
}

function onNewGame() {
  state.gamesPlayed += 1;
  state.gameOverSeen = false;
  state.rematchTried = false;
  state.myCpLosses = [];
  state.myAcpl = 0;
  state.lossRecordedFen = null;
  state.top1Streak = 0;
  if (cfg.autoRematch) state.autoPlay = true;
}

// The AFK chip is a single switch for "keep the session moving": rematch, and
// the keep-alive audio that gives the hidden tab a reason to stay awake.
function toggleAfk(next) {
  if (next && typeof next === 'object') {
    // Called from a Tune switch: settings are already mutated.
  } else {
    const on = !(cfg.autoRematch || cfg.afkKeepAlive);
    cfg.autoRematch = on;
    cfg.afkKeepAlive = on;
    if (on) cfg.pauseWhenHidden = false;
  }
  if (!cfg.autoRematch) {
    clearRematchTimer();
    state.rematchTried = false;
  }
  if (!cfg.autoRematch && !cfg.afkKeepAlive) cfg.pauseWhenHidden = true;
  syncKeepAlive();
  saveSettings(cfg);
  refreshPanel();
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
    turnCertain: snap ? snap.turnCertain !== false : null,
    status: state.thinking ? 'thinking' : '',
    warn: state.warn || (snap && snap.turnCertain === false ? 'turn not readable; not playing' : ''),
    clock: state.clockSeconds,
    opponent: state.opponentRating,
    estimate: state.oppEloEstimate,
    acpl: state.myAcpl,
    elo: state.effectiveElo,
    ply: snap ? plyOf(snap) : 0,
    styleLabel: LEGIT.label,
    keepAlive: cfg.afkKeepAlive ? keepAliveStatus() : 'off',
    account: currentAccount(),
    pace: paceBaseline(),
    tempo: median(state.tempoSamples),
    band: acplBand(state.effectiveElo || cfg.targetElo),
    slackBoost: state.slackBoost,
    passiveTab: state.passiveTab,
    updateLatest: state.updateLatest,
    updateAt: state.updateAt,
    updateError: state.updateError,
    updateChecking: state.updateChecking,
    sessionMs: Date.now() - state.sessionStart,
    restMs: Math.max(0, cfg.sessionMaxMs - (Date.now() - state.sessionStart)),
    games: state.gamesPlayed,
    version: VERSION
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

  // A guessed turn means the eval and the move belong to somebody else.
  if (snapshot.turnCertain === false) {
    state.thinking = false;
    state.analysis = null;
    state.analyzedFen = null;
    clearAutoTimer();
    refreshPanel();
    return;
  }

  clearAutoTimer();
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
  engine
    .analyze(request)
    .catch(() => [])
    .then(() => {
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

// The guard raises slack for this session only; the user's saved setting is
// never rewritten behind their back.
function slackCfg() {
  if (!state.slackBoost) return cfg;
  return {
    ...cfg,
    humanSlackCp: clampInt(cfg.humanSlackCp + state.slackBoost, 0, 300, cfg.humanSlackCp)
  };
}

function scheduleAutoMove(result) {
  clearAutoTimer();
  const snap = state.snapshot;
  if (!snap || !state.boardEl || !result || !result.lines || result.lines.length === 0) return;
  if (snap.gameOver) return;
  if (snap.turnCertain === false) return;
  if (state.autoMovedFen === result.fen) return;
  // onlyMyTurn keeps the script on its own side; off, it plays both seats.
  if (cfg.onlyMyTurn && mySide(snap.flipped) !== snap.turn) return;
  if (cfg.pauseWhenHidden && document.hidden) return;
  if (cfg.pauseOnLowClock && Number.isFinite(state.clockSeconds) && state.clockSeconds <= 5) return;
  if (isPromotionWindowOpen() || hasPremove(state.boardEl)) return;

  const ply = plyOf(snap);
  const choice = chooseMove(result.lines, slackCfg(), {
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

  // The opponent just moved while we were on their time: that gap is their
  // think time, and it is the only tempo signal on the page.
  if (state.lastMyMoveAt) {
    const tempo = Date.now() - state.lastMyMoveAt;
    if (tempo > 400 && tempo < 240000) state.tempoSamples = pushBounded(state.tempoSamples, tempo, 9);
    state.lastMyMoveAt = 0;
  }

  const delay = computeDelay(cfg, {
    plyCount: ply,
    legalMoveCount: legal.length,
    isCapture,
    isCheck: /[+#]$/.test(bestSan),
    gapCp,
    allowRethink: true,
    clockSeconds: state.clockSeconds,
    oppTempoMs: median(state.tempoSamples),
    baselineMs: paceBaseline()
  });

  const targetFen = result.fen;
  state.lastDelayMs = delay;
  armAutoMove(move, targetFen, choice, delay);

  refreshPanel();
}

function armAutoMove(move, targetFen, choice, delay) {
  state.autoTimer = setTimeout(() => {
    state.autoTimer = null;
    if (!state.autoPlay || !state.snapshot || state.snapshot.fen !== targetFen) return;
    if (mySide(state.snapshot.flipped) !== state.snapshot.turn) return;
    if (cfg.pauseWhenHidden && document.hidden) return;

    // Somebody is holding the board. Give them a couple of seconds, twice; if
    // they are still there, staying out of the way is the whole point.
    if (Date.now() - state.boardTouchAt < TOUCH_GUARD_MS) {
      state.defers += 1;
      if (state.defers > 2) {
        state.warn = 'paused: your hand is on the board';
        refreshPanel();
        return;
      }
      armAutoMove(move, targetFen, choice, Math.round(rand(1500, 2600)));
      return;
    }
    state.defers = 0;
    playMove(move, targetFen, choice);
  }, delay);
}

function applyAcplGuard() {
  const verdict = acplGuard({
    acpl: state.myAcpl,
    samples: state.myCpLosses.length,
    elo: state.effectiveElo || cfg.targetElo,
    boost: state.slackBoost
  });
  if (verdict.verdict === 'raise' || verdict.verdict === 'lower') state.slackBoost = verdict.boost;
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
    state.autoMovedGrid = after.grid;
    if (choice && choice.cpLoss === 0) state.top1Streak += 1;
    else state.top1Streak = 0;
    if (choice) {
      state.myCpLosses.push(clamp(Math.round(choice.cpLoss || 0), 0, 600));
      if (state.myCpLosses.length > 20) state.myCpLosses.shift();
      state.myAcpl = state.myCpLosses.reduce((a, b) => a + b, 0) / state.myCpLosses.length;
      applyAcplGuard();
    }
    recordOpening(move, plyOf(snap));
    recordPace(state.lastDelayMs);
    state.lastMyMoveAt = Date.now();
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
      state.autoMovedGrid = second.grid;
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
  if (snap.turnCertain === false) return false;
  if (result.fen !== snap.fen) return false;
  const ply = plyOf(snap);
  const choice = chooseMove(result.lines, slackCfg(), {
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
    if (state.autoPlay && prev) {
      const foreign = foreignMoveSeen({
        prevCertain: prev.turnCertain !== false,
        nextCertain: snapshot.turnCertain !== false,
        prevMine: prev.turn === mySide(prev.flipped),
        nextMine: snapshot.turn === mySide(snapshot.flipped),
        hasClock: Number.isFinite(state.clockSeconds) && state.clockSeconds > 0,
        plyAdvanced: plyOf(snapshot) === plyOf(prev) + 1,
        matchedOurGrid: Boolean(state.autoMovedGrid && Chess.gridsEqual(state.autoMovedGrid, scanned.grid))
      });
      if (foreign) {
        state.autoPlay = false;
        clearAutoTimer();
        state.warn = 'paused: manual move detected';
      }
    }
    state.autoMovedFen = null;
    state.autoMovedGrid = null;
    if (scanned.gameOver) {
      state.gameOverSeen = true;
      state.warn = cfg.autoRematch ? 'game over · next in a moment' : 'game over';
      clearAutoTimer();
      if (cfg.autoRematch) queueRematch();
      else state.autoPlay = false;
      refreshPanel();
      return;
    }
    if (state.gameOverSeen) onNewGame();
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
  } else if (key === 'f') {
    event.preventDefault();
    toggleAfk();
  }
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

// Settings that change the question we ask the engine: the running search is
// now wrong, so drop it and rescan.
function settingsChanged(next) {
  Object.assign(cfg, next);
  saveSettings(cfg);
  state.analyzedFen = null;
  engine.stop();
  scheduleScan(60);
  refreshPanel();
}

// Settings that only change how we present or pace the answer. The analysis
// already in flight is still valid; killing it on a theme click was a bug.
function settingsApplied(next) {
  Object.assign(cfg, next);
  saveSettings(cfg);
  refreshPanel();
}

const panel = new WraithPanel(cfg, {
  toggleAuto,
  toggleAfk,
  step: () => playNow(),
  scan: () => {
    state.analyzedFen = null;
    runScan();
    analyze(state.snapshot, true);
  },
  checkUpdate,
  hide: () => panel.toggleHidden(),
  refresh: () => refreshPanel(),
  settingsChanged,
  settingsApplied
});

engine.onReady = (mode) => {
  // A guard message is the reason the panel exists in that moment; the engine
  // coming up must not wipe the reason auto-play is off.
  if (!state.passiveTab && !/^(paused|another tab)/.test(state.warn)) state.warn = '';
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

function heartbeatTab() {
  let entry = null;
  try {
    entry = JSON.parse(localStorage.getItem(TAB_KEY) || 'null');
  } catch {
    entry = null;
  }
  const decision = tabLeaseDecision(entry, Date.now(), TAB_TTL_MS, TAB_ID);
  if (decision === 'passive') {
    if (!state.passiveTab) {
      state.passiveTab = true;
      state.autoPlay = false;
      state.warn = 'another tab is playing';
      refreshPanel();
    }
    return;
  }
  state.passiveTab = false;
  try {
    localStorage.setItem(TAB_KEY, JSON.stringify({ id: TAB_ID, at: Date.now() }));
  } catch {
    /* storage blocked: no lock, no crash */
  }
}

function releaseTab() {
  try {
    const entry = JSON.parse(localStorage.getItem(TAB_KEY) || 'null');
    if (entry && entry.id === TAB_ID) localStorage.removeItem(TAB_KEY);
  } catch {
    /* nothing to clean */
  }
}

function boot() {
  panel.mount();
  heartbeatTab();
  setInterval(heartbeatTab, 3000);
  startUpdateCheck();
  window.addEventListener('pagehide', releaseTab);
  panel.render(statusView());
  refreshPanel();
  syncKeepAlive();
  engine.boot();
  window.addEventListener('keydown', onKeyDown, true);
  // Clicks on the panel itself are not "a hand on the board".
  window.addEventListener(
    'pointerdown',
    (event) => {
      if (panel.host && event.target === panel.host) return;
      state.boardTouchAt = Date.now();
    },
    true
  );

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
