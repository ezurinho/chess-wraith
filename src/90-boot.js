// Orchestrator: read the board, ask the engine, wait like a human, play, verify.

const OPENING_KEY = 'chess-wraith-openings-v1';
// The account's published rating and the slack it has earned so far are part of
// the same per-account fingerprint as its pace and its openings.
const RATING_KEY = 'chess-wraith-rating-v1';
const GUARD_KEY = 'chess-wraith-guard-v1';
const RATING_TTL_MS = 6 * 60 * 60 * 1000;
const RATING_RETRY_MS = 15 * 60 * 1000;

// One board per browser: the lease is renewed every few seconds, so a closed
// tab hands the wheel over instead of blocking it forever.
const TAB_KEY = 'chess-wraith-tab-v1';
const HISTORY_KEY = 'chess-wraith-history-v1';
const SESSION_KEY = 'chess-wraith-session-v1';
const TAB_TTL_MS = 9000;
const TAB_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);
// A move landing while a hand is on the board is the one case where the script
// must yield: playing over someone who just grabbed a piece looks exactly like
// what it is.
const TOUCH_GUARD_MS = 2000;

// The boot pass reads settings as early as it can, but the navbar can paint
// after that, and chess.com swaps accounts inside one tab. A late name must not
// leave the whole session on the anonymous settings set.
function adoptAccountSettings(user) {
  const name = normalizeAccountName(user || currentAccount());
  if (!name || name === 'anonymous' || name === state.settingsAccount) return false;
  const adopted = loadSettings(name);
  Object.assign(cfg, adopted);
  state.settingsAccount = name;
  // A name learned late also unlocks the published pace and the repertoire.
  if (state.clockPeak || state.clockSeconds) syncPaceProfile();
  syncRepertoire();
  // The history is per account too: another login must not inherit the night.
  state.events = readHistory();
  // The last game's card is per account as well: the numbers belong to a player.
  state.lastReport = readReport(name);
  state.reportHistory = readReportHistory(name);
  // The probe count belongs to the account it was counted for; the report would
  // otherwise add one login's probes to another's repertoire line.
  state.probes = 0;
  state.probeLine = null;
  state.probedKey = '';
  resumeSessionState();
  refreshPanel();
  return true;
}

function paceKey() {
  return paceSamplesKey(currentAccount(), timeClassFromSeconds(state.clockPeak || state.clockSeconds));
}

function ratingKey() {
  return `${RATING_KEY}:${currentAccount()}`;
}

function historyKey() {
  return `${HISTORY_KEY}:${state.settingsAccount || currentAccount()}`;
}

function readHistory() {
  try {
    const raw = localStorage.getItem(historyKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.text === 'string' && item.text.trim())
      .slice(-5)
      .map((item) => ({ at: Number(item.at) || 0, text: item.text.slice(0, 120) }));
  } catch (error) {
    return [];
  }
}

function saveHistory() {
  try {
    if (!state.events.length) localStorage.removeItem(historyKey());
    else localStorage.setItem(historyKey(), JSON.stringify(state.events.slice(-5)));
  } catch (error) {
    /* storage full or blocked: the panel still shows this session */
  }
}

function sessionKey() {
  return `${SESSION_KEY}:${state.settingsAccount || currentAccount()}`;
}

function readSession() {
  try {
    const raw = localStorage.getItem(sessionKey());
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function saveSession() {
  try {
    localStorage.setItem(sessionKey(), JSON.stringify({
      startedAt: state.sessionStart,
      games: state.gamesPlayed,
      results: state.results
    }));
  } catch (error) {
    /* storage blocked: the limit still holds for this tab */
  }
}

function clearSession() {
  try {
    localStorage.removeItem(sessionKey());
  } catch (error) {
    /* nothing to clear */
  }
}

// Called once, after a late account name has been adopted: the key is per
// account and must not be read before the name is known.
function resumeSessionState() {
  if (!cfg.autoPlayOnLoad && !cfg.alwaysAuto) {
    clearSession();
    return;
  }
  const next = resumeSession(readSession(), Date.now(), cfg.sessionMaxMs);
  state.sessionStart = next.startedAt;
  state.gamesPlayed = Math.max(state.gamesPlayed, next.games);
  // Adopting a late account name runs this a second time: a stored session that
  // is not resumed (or a fresh one) must not wipe a score already counted here.
  if (next.resumed) state.results = next.results;
  if (next.resumed) noteEvent(`resumed: ${next.games} games, ${Math.round((Date.now() - next.startedAt) / 60000)} min`);
  saveSession();
}

function guardKey() {
  return `${GUARD_KEY}:${currentAccount()}`;
}

const cfg = loadSettings(currentAccount());
// Always auto is one switch for the three that make an unattended session: auto-play,
// the rematch queue and the keep-alive that keeps the tab awake. It is forced here,
// before any of them is read, so a stale per-account setting cannot defeat it.
if (cfg.alwaysAuto) {
  cfg.autoPlayOnLoad = true;
  cfg.autoRematch = true;
  cfg.afkKeepAlive = true;
  cfg.pauseWhenHidden = false;
}
if (settingsNeedsSave) saveSettings(cfg);
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
  // An improvised move has no line to measure against; its loss is read from the
  // eval of the position after it, when that analysis arrives.
  pendingMyLoss: null,
  improvisedPicks: 0,
  // The card after the last finished game; read back per account on boot.
  lastReport: null,
  // The last twenty games, oldest first. The Stats tab reads this, not the card.
  reportHistory: [],
  effectiveElo: null,
  warn: '',
  clockSeconds: null,
  opponentRating: null,
  boardRating: null,
  gameOverSeen: false,
  results: { win: 0, loss: 0, draw: 0 },
  resultGame: 0,
  rematchTried: false,
  rematchTimer: null,
  rematchAttempts: 0,
  rematchTriedTexts: [],
  rematchMisses: 0,
  keepAlive: 'off',
  lastMyMoveAt: 0,
  lastDelayMs: 0,
  lastSearchMs: 0,
  searchStartAt: 0,
  tempoSamples: [],
  boardTouchAt: 0,
  defers: 0,
  sessionStart: Date.now(),
  gamesPlayed: 1,
  slackBoost: 0,
  events: readHistory(),
  // Which account the loaded settings belong to; see adoptAccountSettings().
  settingsAccount: '',
  paceProfile: null,
  pacePending: false,
  paceError: '',
  // The same archive, read for openings only: a bot game has no clock to key a
  // time class on, but it still deserves the account's repertoire.
  repertoire: null,
  repertoirePending: false,
  // One restricted search per position for the move the account plays when the
  // wider search never offered it.
  probedKey: '',
  probeLine: null,
  probeSpentMs: 0,
  // How many times a restricted search has been asked this session: the only
  // Learned from this account's games, then carried across reloads.
  accountRatings: null,
  accountGames: null,
  ratingAt: 0,
  ratingGames: 0,
  formOffset: 0,
  ratingError: '',
  ratingPending: false,
  ratingClass: 'blitz',
  eloSource: 'target',
  clockPeak: 0,
  passiveTab: false,
  throttled: false,
  lastScanAt: 0,
  lastTickAt: 0,
  autoMovedGrid: null,
  // A click that did not land, and a move that showed up on our turn without us:
  // both are counted before the session stops, because one bad scan is not a
  // reason to end the night.
  moveMisses: 0,
  foreignHits: 0,
  foreignFen: null,
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

function accountRatingNow() {
  state.ratingClass = timeClassFromSeconds(state.clockPeak || state.clockSeconds);
  return pickRating(state.accountRatings, state.ratingClass);
}

// The number the engine is aimed at. A provisional rating is shrunk towards the
// prior, because twenty games is not the player and two games is not a rating.
function anchoredRating() {
  const raw = accountRatingNow();
  // No public profile rating for this time class (or the endpoint is cold):
  // your own player row states it on the page, and that number is exact for
  // the game being played, so it is a better anchor than a 1500 default.
  if (!raw) return state.boardRating || raw;
  const games = state.accountGames ? state.accountGames[state.ratingClass] : null;
  if (!games) return raw;
  return settledRating(raw, games, Number(cfg.targetElo) > 0 ? cfg.targetElo : RATING_PRIOR_ELO);
}

function provisionalRating() {
  const games = state.accountGames ? state.accountGames[state.ratingClass] : null;
  return Boolean(games && games < 20);
}

function resolveElo() {
  const account = anchoredRating();
  // Form is per game, keyed by the account and the game number: the same night
  // asks for the same strength on the same game, and the next one differs.
  const form = account ? formOffset(`${currentAccount()}:${state.gamesPlayed}`, 30) : 0;
  const elo = effectiveElo(cfg, {
    accountElo: account,
    oppElo: state.opponentRating || state.oppEloEstimate,
    form
  });
  state.effectiveElo = elo;
  state.formOffset = form;
  state.eloSource = account
    ? (accountRatingNow() ? 'account' : 'board')
    : Number(cfg.targetElo) > 0
      ? 'target'
      : 'default';
  return elo;
}

// The public ratings endpoint is static data about a public profile; nothing
// about the game leaves the tab. Cached for six hours, per account. chess.com's
// own docs say serial requests are never rate limited but a blocked or throttled
// answer is possible (429), so a failure also stores a retry time: reloading the
// tab must not turn one bad minute into a request per page load.
async function syncAccountRatings(force) {
  const user = currentAccount();
  if (user !== 'anonymous') adoptAccountSettings(user);
  try {
    const cached = JSON.parse(localStorage.getItem(ratingKey()) || '{}');
    const fresh = cached && cached.ratings && Date.now() - Number(cached.at || 0) < RATING_TTL_MS;
    if (cached && cached.ratings && !fresh) {
      state.accountRatings = cached.ratings;
      state.accountGames = cached.games || null;
    }
    if (fresh) {
      state.accountRatings = cached.ratings;
      state.accountGames = cached.games || null;
      state.ratingAt = Number(cached.at) || 0;
      state.ratingError = '';
      resolveElo();
      refreshPanel();
      return state.accountRatings;
    }
    if (cached && cached.retryAt && Number(cached.retryAt) > Date.now() && !force) {
      state.ratingError = String(cached.error || 'throttled');
      resolveElo();
      refreshPanel();
      return state.accountRatings;
    }
  } catch {
    /* a broken cache is just a cache miss */
  }
  if (user === 'anonymous') return null;
  if (state.ratingPending) return state.accountRatings;
  state.ratingPending = true;
  try {
    const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined;
    const response = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/stats`, {
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal
    });
    if (!response || !response.ok) throw new Error(`HTTP ${response ? response.status : 0}`);
    const payload = await response.json();
    const ratings = normalizeRatings(payload);
    if (!ratings) throw new Error('no ratings');
    state.accountRatings = ratings;
    state.accountGames = normalizeGameCounts(payload);
    state.ratingAt = Date.now();
    state.ratingGames = state.gamesPlayed;
    state.ratingError = '';
    persistRating({ at: state.ratingAt, ratings, games: state.accountGames });
  } catch (error) {
    state.ratingError = String((error && error.message) || error).slice(0, 40);
    // Fifteen minutes is long enough to stop a reload loop and short enough
    // that a warm start the same evening still gets the real number.
    persistRating({ retryAt: Date.now() + RATING_RETRY_MS, error: state.ratingError });
  } finally {
    state.ratingPending = false;
  }
  resolveElo();
  refreshPanel();
  return state.accountRatings;
}

function persistRating(value) {
  try {
    localStorage.setItem(ratingKey(), JSON.stringify(value));
  } catch {
    /* private mode: the session keeps the value */
  }
}

function readGuard() {
  try {
    const raw = JSON.parse(localStorage.getItem(guardKey()) || '{}');
    return clampInt(raw.boost, 0, 160, 0);
  } catch {
    return 0;
  }
}

function saveGuard() {
  try {
    localStorage.setItem(guardKey(), JSON.stringify({ boost: state.slackBoost, at: Date.now() }));
  } catch {
    /* storage can be blocked; the guard still works in this tab */
  }
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

// The account's published median wins over the learned one: the learned sample
// starts empty on a new browser, and the first ten moves of a fresh profile are
// exactly where a bot-looking rhythm would show.
// `ply` lets a phase answer first: the account's own opening is faster than its
// middlegame, and one median for both is a rhythm nobody has.
function paceBaseline(ply) {
  const phases = state.paceProfile && state.paceProfile.phases;
  if (phases && Number.isFinite(ply)) {
    const own = Number(ply < 16 ? phases.opening : ply < 60 ? phases.middle : phases.end);
    if (Number.isFinite(own) && own > 200) return own;
  }
  const published = state.paceProfile && Number(state.paceProfile.medianMs);
  if (Number.isFinite(published) && published > 200) return published;
  const samples = readPaceSamples();
  return samples.length >= 6 ? median(samples) : null;
}

// What the delay should be centred on: the account's published median for this
// class, the median this browser has learned, or the class default for a profile
// that has neither. The first and third are already class-specific numbers.
function paceAnchor() {
  return paceAnchorFor({
    publishedMs: Number(state.paceProfile && state.paceProfile.medianMs) || 0,
    learnedMs: paceBaseline(plyOf(state.snapshot)),
    cls: timeClassFromSeconds(state.clockPeak || state.clockSeconds)
  });
}

function recordPace(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return;
  try {
    localStorage.setItem(paceKey(), JSON.stringify(pushBounded(readPaceSamples(), ms, 40)));
  } catch {
    /* storage can be blocked; the baseline is an optimization, not a rule */
  }
}

// The repertoire the pace archive already contains: the first-move shares for
// the side this account is playing. Nothing extra is fetched for it.
function openingFor() {
  const fromPace = state.paceProfile && state.paceProfile.opening;
  if (fromPace && Number(fromPace.games) >= 5) return fromPace;
  return state.repertoire && Number(state.repertoire.games) >= 5 ? state.repertoire : null;
}

// The moves already played, as SAN from the start position: the tree is keyed by
// what was played, and the tracker only has UCI.
function openingPrefix(snap) {
  const uci = snap && Array.isArray(snap.uciMoves) ? snap.uciMoves.slice(0, OPENING_PLIES) : [];
  if (!uci.length || typeof Chess === 'undefined' || !Chess.pvToSan) return [];
  const start = Chess.START_FEN || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  return (Chess.pvToSan(start, uci) || []).map(sanKey);
}

function openingShares() {
  const opening = openingFor();
  if (!opening) return null;
  const snap = state.snapshot;
  if (!snap) return null;
  const played = Array.isArray(snap.uciMoves) ? snap.uciMoves.length : 0;
  // Past the tree the engine has the position; an opening table would be wrong.
  if (played >= OPENING_PLIES) return null;
  if (opening.tree) {
    const prefix = openingPrefix(snap);
    // The deepest node the account has: the point of a tree is that the third
    // move is conditioned on the first two.
    for (let n = prefix.length; n >= 0; n--) {
      const table = opening.tree[prefix.slice(0, n).join(' ')];
      if (table && Object.keys(table).length) return table;
    }
  }
  if (snap.turn === 'b') {
    // The answer depends on the question: a table of black's moves averaged over
    // every white first move recommends replies this account never plays.
    const first = Array.isArray(snap.uciMoves) ? snap.uciMoves[0] : null;
    const table = first && opening.blackByFirst ? opening.blackByFirst[first] : null;
    return table && Object.keys(table).length >= 2 ? table : null;
  }
  return opening.white && Object.keys(opening.white).length ? opening.white : null;
}

// The two moves this account actually plays, for the report: a repertoire that
// cannot be read is a claim that cannot be checked.
function openingTop(table) {
  const rows = Object.entries(table || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([move, share]) => `${move} ${Math.round(share * 100)}%`);
  return rows.length ? rows.join(' · ') : 'none';
}

// UCI to the two characters a report can read: the first move is a pawn push or
// a knight, and the source square is always the home rank.
function firstMoveSan(uci) {
  const match = /^([a-h])([1-8])([a-h][1-8])$/.exec(uci || '');
  if (!match) return String(uci || '?');
  return match[2] === '1' ? `N${match[3]}` : match[3];
}

// Two answers, not one average: what the account does against each first move.
function openingByFirstTop(opening) {
  const rows = Object.entries((opening && opening.blackByFirst) || {})
    .map(([first, table]) => {
      const best = Object.entries(table || {}).sort((a, b) => b[1] - a[1])[0];
      return best ? `${firstMoveSan(first)} ${best[0]} ${Math.round(best[1] * 100)}%` : null;
    })
    .filter(Boolean)
    .slice(0, 3);
  return rows.length ? rows.join(' · ') : openingTop(opening && opening.black);
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

// Two public static files answer this, and neither knows who is asking. They
// are asked at the same time and the higher answer wins: jsDelivr's @latest is
// fast but can keep serving the previous tag for hours, while the release API
// is immediate but rate-limited. Either one alone would be wrong or slow.
async function readVersion(url) {
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined;
  const response = await fetch(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal });
  if (!response || !response.ok) throw new Error(`HTTP ${response ? response.status : 0}`);
  const text = await response.text();
  const tagged = text.match(/@version\s+v?([\d.]+)/i);
  if (tagged) return tagged[1];
  const parsed = JSON.parse(text);
  return String(parsed.version || parsed.tag_name || '').replace(/^v/i, '');
}

const UPDATE_CACHE_KEY = 'chess-wraith-update-v1';

// The last known version, so a reload paints the button immediately instead of
// four seconds later.
function readUpdateCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(UPDATE_CACHE_KEY) || 'null');
    return cached && versionParts(cached.latest) ? cached : null;
  } catch {
    return null;
  }
}

function writeUpdateCache(latest) {
  try {
    localStorage.setItem(UPDATE_CACHE_KEY, JSON.stringify({ latest, at: Date.now() }));
  } catch {
    /* private mode: the in-memory value is still correct */
  }
}

function restoreUpdateCache() {
  const cached = readUpdateCache();
  if (!cached) return;
  state.updateAt = Number(cached.at) || 0;
  if (versionNewer(cached.latest, VERSION)) state.updateLatest = cached.latest;
}

async function checkUpdate(force) {
  if (state.updateChecking) return false;
  if (!force && !updateCheckDue(Date.now(), state.updateAt, UPDATE_RECHECK_MS)) return false;
  state.updateChecking = true;
  refreshPanel();
  try {
    const answers = await Promise.all([
      readVersion(UPDATE_API_URL).catch(() => ''),
      readVersion(UPDATE_META_URL).catch(() => '')
    ]);
    let latest = '';
    for (const answer of answers) {
      if (!versionParts(answer)) continue;
      if (!latest || versionNewer(answer, latest)) latest = answer;
    }
    if (!latest) throw new Error('no version');
    state.updateLatest = latest;
    state.updateError = '';
    writeUpdateCache(latest);
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
  restoreUpdateCache();
  refreshPanel();
  // Four seconds: the engine and the board matter more than a version number.
  setTimeout(() => {
    checkUpdate();
  }, 4000);
  setInterval(() => {
    checkUpdate();
  }, UPDATE_CHECK_MS);
  // A tab left open for a day is exactly when a release appears, and a frozen
  // background timer never fires. Coming back to the tab is the reliable moment,
  // and UPDATE_RECHECK_MS keeps the three events from becoming a burst. A
  // manual click on the row skips the throttle.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkUpdate();
  });
  window.addEventListener('focus', () => checkUpdate());
  window.addEventListener('online', () => checkUpdate());
}

function registerButler() {
  if (!debugEnabled()) return;
  const api = {
    version: VERSION,
    state,
    config: cfg,
    engine,
    panel,
    openingShares: () => openingShares(),
  chooseMove: (lines, opts) => chooseMove(lines, cfg, { top1Streak: state.top1Streak, oppElo: state.oppEloEstimate, ...(opts || {}) }),
    computeDelay: (opts) => computeDelay(cfg, opts),
    phaseTime: (fen, ply) => phaseMoveTime(cfg.moveTimeMs, fen, ply),
    // "Why did it not rematch?" answered without reading the source: what the
    // picker would press right now, and what it would press after a decline.
    rematchButton: (skip) => {
      const el = findRematchButton(skip);
      return el ? (el.textContent || '').trim() : null;
    },
    scan: () => runScan(),
    // The play path is the one thing unit tests cannot reach: these two let the
    // debug build be driven on a real board, which is how the click geometry is
    // checked against chess.com instead of against a fixture.
    snapshot: () => state.snapshot,
    playMove: (uci, fen) => playMove(uci, fen || (state.snapshot && state.snapshot.fen), null),
    analyze: (force) => state.snapshot && analyze(state.snapshot, force !== false),
    report: () => reportText(),
    board: () => {
      const scan = scanBoard(mySide(state.snapshot ? state.snapshot.flipped : false));
      if (!scan || !scan.valid) return { valid: false };
      return { valid: true, flipped: scan.flipped, placement: Chess.gridToPlacement(scan.grid), fen: buildSnapshotFen(scan) };
    },
    ready: () => engine.ready,
    retryEngine: () => engine.retryNnue(),
    checkUpdate: () => checkUpdate(true),
    refreshRating: () => syncAccountRatings(true),
    // One call that answers "is this install actually working", so a report is
    // a list of facts instead of a screenshot and a guess.
    selftest: async () => {
      const checks = [];
      const add = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail: detail == null ? '' : String(detail) });
      add('version', /^\d+\.\d+\.\d+$/.test(VERSION), VERSION);
      const scan = scanBoard(mySide(state.snapshot ? state.snapshot.flipped : false));
      add('board', scan && scan.valid, scan && scan.valid ? `${scan.plyCount || 0} ply` : 'no board on this page');
      add('tracker', Boolean(state.snapshot) && state.snapshot.turnCertain !== false, state.snapshot ? `${state.snapshot.fen.split(' ')[1]} to move` : 'no snapshot');
      add('engine', engine.ready, state.engineMode || (engine.ready ? 'ready' : 'booting'));
      // The panel lives in a shadow root: a plain querySelectorAll would count
      // zero and call a working panel broken. `panel.host` is the mount point,
      // so the tree is found from one of the elements the panel bound.
      const root = panel.el.rating ? panel.el.rating.getRootNode() : panel.host;
      const names = root && root.querySelectorAll ? Array.from(root.querySelectorAll('[data-el]')).map((node) => node.getAttribute('data-el')) : [];
      const bound = Object.keys(panel.el || {}).length;
      add('panel', names.length > 0 && new Set(names).size === names.length && bound >= new Set(names).size, `${new Set(names).size} bindings, ${bound} resolved`);
      let storage = false;
      try {
        localStorage.setItem('chess-wraith-selftest', '1');
        storage = localStorage.getItem('chess-wraith-selftest') === '1';
        localStorage.removeItem('chess-wraith-selftest');
      } catch {
        storage = false;
      }
      add('storage', storage, storage ? 'read-write' : 'blocked');
      add('rating', state.eloSource !== 'default' || !state.accountRatings, state.accountRatings ? `${accountRatingNow() || '?'} ${state.ratingClass}` : state.ratingError || 'no account');
      add('update', !state.updateLatest || !versionNewer(state.updateLatest, VERSION), state.updateLatest || 'not checked');
      // The pace and the pace parser are the part of the script that cannot be
      // checked by looking at the page: if the parser breaks on a chess.com
      // format change, the delay silently falls back to a fixed window.
      const paced = parseClockTimes(SELFTEST_PGN, 'w');
      add('pace parser', paced.length >= 2 && paced.every((ms) => ms === 10000), paced.length ? `${paced.length} moves, ${paced[0]} ms` : 'no samples');
      const probe = computeDelay(cfg, { plyCount: 24, gapCp: 40, clockSeconds: 180, budgetSeconds: 180, oppTempoMs: 1400 });
      add('delay', Number.isFinite(probe) && probe >= 250 && probe <= 9000, `${Math.round(probe)} ms`);
      add('settings key', settingsKeyFor('Someone') === `${STORAGE_KEY}:someone` && settingsKeyFor('') === STORAGE_KEY, settingsKeyFor(currentAccount() || ''));
      return { ok: checks.every((check) => check.ok), checks };
    },
    analyzeNow: () => analyze(state.snapshot, true),
    playNow,
    unload() {
      clearAutoTimer();
      clearRematchTimer();
      stopKeepAlive();
      stopPageTicker();
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

let moveRetryTimer = null;

function clearMoveRetry() {
  if (moveRetryTimer) {
    clearTimeout(moveRetryTimer);
    moveRetryTimer = null;
  }
}

// A swallowed click is not a stopped session: retry the same analysis a few times
// with growing pauses, then stop and say so.
function armMoveRetry() {
  const plan = moveRetryPlan(state.moveMisses + 1);
  if (!plan.retry) {
    state.warn = 'the board is not taking moves; auto-play paused';
    state.autoPlay = false;
    refreshPanel();
    return;
  }
  state.moveMisses = Math.max(1, state.moveMisses + 1);
  state.warn = `move not taken, retrying (${state.moveMisses}/3)`;
  refreshPanel();
  clearMoveRetry();
  moveRetryTimer = setTimeout(() => {
    moveRetryTimer = null;
    if (!state.autoPlay || !state.snapshot || !state.analysis) return;
    if (state.gameOverSeen) return;
    // The game moved on while we waited; the next scan has fresh work to do.
    if (state.analysis.fen !== state.snapshot.fen) return;
    if (mySide(state.snapshot.flipped) !== state.snapshot.turn) return;
    playNow()
      .then((played) => {
        if (played) {
          state.moveMisses = 0;
          if (/^move not taken/.test(state.warn)) state.warn = '';
          refreshPanel();
        } else armMoveRetry();
      })
      .catch(() => armMoveRetry());
  }, plan.delayMs);
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

function stopRematch(reason) {
  state.rematchTried = true;
  noteEvent(reason);
  cfg.autoRematch = false;
  state.warn = reason;
  saveSettings(cfg);
  refreshPanel();
}

// Press one button and, if the dialog is still there later, the next one. A
// rematch the opponent never accepts otherwise leaves the session parked on a
// dead dialog with no way back.
function pressRematch() {
  const button = findRematchButton(state.rematchTriedTexts);
  if (!button) {
    stopRematch('no rematch button; AFK stopped');
    return;
  }
  const text = (button.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (text) state.rematchTriedTexts.push(text);
  state.rematchAttempts += 1;
  button.click();
  noteEvent(`pressed ${text || 'the game button'}`);
  state.warn = '';
  scheduleScan(900);
  if (state.rematchAttempts >= 3) {
    stopRematch('rematch declined; AFK stopped');
    return;
  }
  state.rematchTimer = setTimeout(() => {
    state.rematchTimer = null;
    if (!cfg.autoRematch) return;
    if (!hasGameOverModal() || !state.gameOverSeen) {
      state.rematchTried = true;
      return;
    }
    pressRematch();
  }, REMATCH_RETRY_MS);
  refreshPanel();
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
    maxMs: cfg.sessionMaxMs,
    rollover: cfg.alwaysAuto
  });
  if (limit.rollover) {
    // The cap closed one run; the next game opens another. The event history is
    // the audit trail, so the rollover is written down instead of hidden.
    noteEvent(limit.reason);
    clearSession();
    state.sessionStart = Date.now();
    state.gamesPlayed = 0;
    state.results = { win: 0, loss: 0, draw: 0 };
    saveSession();
  } else if (limit.stop) {
    state.autoPlay = false;
    cfg.autoRematch = false;
    state.warn = limit.reason;
    noteEvent(limit.reason);
    // Tomorrow's run is a new run, not a continuation of a finished one.
    clearSession();
    saveSettings(cfg);
    refreshPanel();
    return;
  }
  const delay = nextGameDelay(cfg);
  state.rematchTimer = setTimeout(() => {
    state.rematchTimer = null;
    if (!cfg.autoRematch) return;
    if (!hasGameOverModal()) {
      // The dialog can paint late. Look once more before calling it a miss.
      state.rematchMisses += 1;
      if (state.rematchMisses < 3) {
        state.rematchTimer = setTimeout(() => {
          state.rematchTimer = null;
          queueRematch();
        }, 4000);
        return;
      }
      state.rematchTried = true;
      return;
    }
    pressRematch();
  }, delay);
  refreshPanel();
}

function onNewGame() {
  // A retry armed for the old game must not fire into the new one and mark the
  // rematch as already tried, which would silently end the session later.
  clearRematchTimer();
  clearMoveRetry();
  state.moveMisses = 0;
  state.foreignHits = 0;
  state.foreignFen = null;
  state.gamesPlayed += 1;
  state.resultGame = 0;
  // The account's rating is the anchor, so a long session has to follow it:
  // three games and twenty minutes is often enough to have moved, and rare
  // enough to keep the public endpoint quiet.
  if (ratingRefreshDue(Date.now(), state.ratingAt, state.gamesPlayed, state.ratingGames)) {
    syncAccountRatings(true);
  }
  resolveElo();
  saveSession();
  state.gameOverSeen = false;
  state.rematchTried = false;
  state.rematchAttempts = 0;
  state.rematchTriedTexts = [];
  state.rematchMisses = 0;
  state.myCpLosses = [];
  state.myAcpl = 0;
  state.pendingMyLoss = null;
  state.improvisedPicks = 0;
  state.lossRecordedFen = null;
  state.top1Streak = 0;
  // A new game is a new clock and a new opponent. Carrying the previous peak
  // would rate a 1-minute game as rapid and pace it like a 10-minute one.
  state.clockPeak = 0;
  state.tempoSamples = [];
  // The old game's arrow is not this game's plan.
  paintBoardOverlay(state.boardEl, null, false, true);
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
    state.rematchAttempts = 0;
    state.rematchTriedTexts = [];
    state.rematchMisses = 0;
  }
  if (!cfg.autoRematch && !cfg.afkKeepAlive) cfg.pauseWhenHidden = true;
  syncKeepAlive();
  saveSettings(cfg);
  refreshPanel();
}

// Every meaningful transition is written here, not just the current warn: the
// user comes back hours later and the last line is what explains the night.
function noteEvent(text) {
  const next = pushEvent(state.events, text, Date.now());
  if (next.length === state.events.length && state.events.length > 0) return;
  state.events = next;
  saveHistory();
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
    events: state.events,
    clock: state.clockSeconds,
    opponent: state.opponentRating,
    boardRating: state.boardRating,
    estimate: state.oppEloEstimate,
    acpl: state.myAcpl,
    elo: state.effectiveElo,
    eloSource: state.eloSource,
    accountRating: accountRatingNow(),
    provisional: provisionalRating(),
    eloGap: strengthFloor(accountRatingNow() || state.boardRating || 0).gap,
    levelTarget: levelPlayTarget(accountRatingNow() || state.boardRating || 0, cfg),
    ratingClass: state.ratingClass,
    ratingAt: state.ratingAt,
    ratingError: state.ratingError,
    ply: snap ? plyOf(snap) : 0,
    styleLabel: LEGIT.label,
    keepAlive: cfg.afkKeepAlive ? keepAliveStatus() : 'off',
    account: currentAccount(),
    pace: paceAnchor().ms,
    paceSamples: state.paceProfile ? state.paceProfile.samples || 0 : readPaceSamples().length,
    paceSource: paceAnchor().source,
    paceError: state.paceError,
    tempo: median(state.tempoSamples),
    band: acplBand(state.effectiveElo || cfg.targetElo),
    slackBoost: state.slackBoost,
    passiveTab: state.passiveTab,
    updateLatest: state.updateLatest,
    updateAt: state.updateAt,
    updateError: state.updateError,
    updateChecking: state.updateChecking,
    throttled: state.throttled,
    results: state.results,
    report: state.lastReport,
    reportHistory: state.reportHistory,
    reportSummary: reportSummary(state.reportHistory),
    sessionMs: Date.now() - state.sessionStart,
    restMs: Math.max(0, cfg.sessionMaxMs - (Date.now() - state.sessionStart)),
    games: state.gamesPlayed,
    version: VERSION
  };
}

function refreshPanel() {
  panel.render(statusView());
  // The board overlay follows the same state as the panel, including the
  // toggle, so one place keeps it from going stale after a setting change.
  if (state.snapshot) {
    // boardEl lives on `state`, not on the snapshot: the first version of this
    // line read `snapshot.boardEl`, always undefined, and the arrows never drew
    // on a real page. `refreshPanel` is the only place that paints them.
    paintBoardOverlay(state.boardEl, state.analysis && state.analysis.lines, state.snapshot.flipped, cfg.arrows);
  }
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
  state.oppEloEstimate = performanceFromAcpl(avg);
  state.effectiveElo = resolveElo();
}

function pushMyLoss(cp) {
  if (typeof cp !== 'number' || !Number.isFinite(cp)) return;
  state.myCpLosses.push(clamp(Math.round(cp), 0, 600));
  if (state.myCpLosses.length > 20) state.myCpLosses.shift();
  state.myAcpl = state.myCpLosses.reduce((a, b) => a + b, 0) / state.myCpLosses.length;
  applyAcplGuard();
}

// Same shape as the opponent's measurement, for the moves that have no line of
// their own. The eval before the move is the one the script chose from.
function recordMyMeasuredLoss(result) {
  const pending = state.pendingMyLoss;
  if (!pending) return;
  const snap = state.snapshot;
  const prev = state.prevSnapshot;
  if (!snap || !prev || !result || !result.lines || result.lines.length === 0) return;
  state.pendingMyLoss = null;
  if (plyOf(prev) + 1 !== pending.ply) return;
  if (prev.turn !== mySide(snap.flipped)) return;
  const after = result.lines[0].whiteCp;
  const loss = myLossFromWhiteCp(pending.side, pending.before, after);
  if (loss !== null) pushMyLoss(loss);
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
  state.searchStartAt = Date.now();
  refreshPanel();

  const anchor = resolveElo();
  const levelTarget = levelPlayTarget(accountRatingNow() || state.boardRating || 0, cfg);
  const request = {
    fen: snapshot.fen,
    uciMoves: snapshot.uciMoves,
    turn: snapshot.turn,
    flipped: snapshot.flipped,
    depth: depthForAccount(cfg.maxDepth, anchor),
    clockSeconds: state.clockSeconds,
    moveTimeMs: clockBoundMoveTime(phaseMoveTime(cfg.moveTimeMs, snapshot.fen, plyOf(snapshot)), state.clockSeconds),
    // Below the engine floor the move this account would play is not in the top
    // four at all: the four best lines are all good, which is why the panel used
    // to promise a 293 cp/move account and deliver ~60. Ten lines reach the size
    // of move the account actually makes.
    multiPv: Math.max(1, levelTarget > 0 ? Math.max(cfg.multiPv, 10) : cfg.multiPv),
    elo: anchor,
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
  recordMyMeasuredLoss(result);
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

// A SAN move the account plays, as UCI on this board. The tracker already knows
// how to match one; a table entry that does not match is not played.
// One budget for the restricted search, whoever asks for it: a hand on the button
// has no more right to think than the timer has.
// The request shape, too, exists once: it is what drifted in 1.52.0.
function probeRequest(fen, uciMoves, uci) {
  return {
    fen,
    uciMoves: Array.isArray(uciMoves) ? uciMoves : [],
    multiPv: 1,
    searchmoves: uci,
    depth: Math.min(cfg.maxDepth, 12),
    moveTimeMs: probeBudgetMs()
  };
}

function probeBudgetMs() {
  const paced = Math.round(searchBudgetMs({ moveTimeMs: cfg.moveTimeMs, clockSeconds: state.clockSeconds }) * 0.6);
  return Math.max(80, Math.min(400, cfg.moveTimeMs, Math.max(180, paced)));
}

function openingUci(snap, san) {
  try {
    const move = Chess.matchSanMove(snap, san);
    return move ? Chess.moveToUci(move) : null;
  } catch {
    return null;
  }
}

// One restricted search for that move. Its eval is merged into the main result
// as a normal candidate, flagged so only the opening slack treats it specially.
function probeOpeningMove(probe, result) {
  state.probedKey = probe.key;
  const started = Date.now();
  // A fixed 400 ms is a rapid budget: on 1+0 the probe would spend most of the
  // move's search on a move the account plays without thinking.
  const request = probeRequest(probe.fen, probe.uciMoves, probe.uci);
  engine
    .analyze(request)
    .then((lines) => {
      const line = lines && lines[0];
      if (!line || line.bestUci !== probe.uci) return;
      state.probeLine = { ...line, opening: true, fen: probe.fen };
    })
    .catch(() => [])
    .finally(() => {
      state.probeSpentMs = Date.now() - started;
      const probed = state.probeLine;
      const known = (result.lines || []).some((line) => line.bestUci === (probed && probed.bestUci));
      // Only a probe that reaches the decision counts: one whose position moved on,
      // or whose move the search had already found, judged nothing.
      const used = Boolean(probed) && probed.fen === result.fen && !known;
      if (used) state.probes += 1;
      const merged = used ? { ...result, lines: [...result.lines, probed] } : result;
      scheduleAutoMove(merged);
    });
}

function scheduleAutoMove(result) {
  clearAutoTimer();
  const snap = state.snapshot;
  if (!snap || !state.boardEl || !result || !result.lines || result.lines.length === 0) return;
  if (snap.gameOver) return;
  if (snap.turnCertain === false) return;
  // The probe re-enters this function a fraction of a second later, and the board
  // can have moved on in between: a move computed for one position must never be
  // armed for another.
  if (result.fen !== snap.fen) return;
  if (state.autoMovedFen === result.fen) return;
  // onlyMyTurn keeps the script on its own side; off, it plays both seats.
  if (cfg.onlyMyTurn && mySide(snap.flipped) !== snap.turn) return;
  if (cfg.pauseWhenHidden && document.hidden) return;
  if (cfg.pauseOnLowClock && Number.isFinite(state.clockSeconds) && state.clockSeconds <= 5) return;
  if (isPromotionWindowOpen() || hasPremove(state.boardEl)) return;

  const ply = plyOf(snap);
  const shares = ply < OPENING_PLIES ? openingShares() : null;
  // The account's move when the search never offered it: one extra search so the
  // repertoire can be played, not only reordered.
  const target = openingProbeTarget(shares, result.lines);
  const probeKey = target ? `${snap.fen}|${target.san}` : '';
  if (target && state.probedKey !== probeKey) {
    const uci = openingUci(snap, target.san);
    if (uci) {
      probeOpeningMove({ key: probeKey, uci, fen: snap.fen, uciMoves: snap.uciMoves }, result);
      return;
    }
  }
  const legal = Chess.generateLegalMoves(snap);
  const choice = chooseMove(result.lines, slackCfg(), {
    // The account's own rating is what level play is aimed at. Without it the
    // chooser falls back to the target setting and a 133 account plays at the
    // engine's floor: the whole beginner path was unreachable in the real script.
    accountElo: accountRatingNow() || state.boardRating || 0,
    top1Streak: state.top1Streak,
    oppElo: state.opponentRating || state.oppEloEstimate,
    repeatUci: repeatedOpening(result.bestmove, ply),
    openingShares: shares,
    improvise: improvisedCandidates(legal, snap, ply)
  });
  let move = (choice && choice.line && choice.line.bestUci) || result.bestmove;
  if (!move) return;
  // An improvised move is allowed to be bad, not to hand over mate in one.
  if (choice && choice.improvised && allowsMateInOne(legal, move)) {
    move = result.bestmove;
    choice.improvised = false;
    choice.cpLoss = 0;
    choice.line = result.lines[0];
  }
  const toRank = move.charCodeAt(3) - 49;
  const toFile = move.charCodeAt(2) - 97;
  const isCapture = Boolean(snap.grid[toRank] && snap.grid[toRank][toFile]);
  const gapCp = result.lines.length > 1 ? Math.abs(sideScore(result.lines[0]) - sideScore(result.lines[1])) : null;
  const bestSan =
    (choice && choice.line && choice.line.bestSan) ||
    (choice && choice.improvised ? Chess.pvToSan(snap.fen, [move])[0] || '' : '');

  // The opponent just moved while we were on their time: that gap is their
  // think time, and it is the only tempo signal on the page.
  if (state.lastMyMoveAt) {
    const tempo = Date.now() - state.lastMyMoveAt;
    if (tempo > 400 && tempo < 240000) state.tempoSamples = pushBounded(state.tempoSamples, tempo, 9);
    state.lastMyMoveAt = 0;
  }

  const anchor = paceAnchor();
  // The probe already spent part of this move's thinking; counting it again would
  // make the account take longer in the opening than it ever does.
  const spentMs = state.probeSpentMs;
  state.probeSpentMs = 0;
  const delay = computeDelay(cfg, {
    plyCount: ply,
    spentMs,
    legalMoveCount: legal.length,
    isCapture,
    isCheck: /[+#]$/.test(bestSan),
    gapCp,
    allowRethink: true,
    clockSeconds: state.clockSeconds,
    oppTempoMs: median(state.tempoSamples),
    baselineMs: anchor.ms,
    budgetSeconds: state.clockPeak,
    // The published median and the class default are per class already; the
    // learned one is not, and still scales with the clock.
    baselineClassScoped: anchor.classScoped,
    sessionMs: Date.now() - state.sessionStart
  });

  const targetFen = result.fen;
  // What the engine already spent is part of the interval, not extra to it.
  const spent = state.searchStartAt ? Math.min(15000, Math.max(0, Date.now() - state.searchStartAt)) : 0;
  state.searchStartAt = 0;
  state.lastSearchMs = spent;
  state.lastDelayMs = delay;
  armAutoMove(move, targetFen, choice, visibleDelayMs(delay, spent));

  refreshPanel();
}

const PIECE_WORTH = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// What an improvised move needs to know about itself: what it takes, whether it
// checks, what it moves. The chooser owns the taste; the board owns the facts.
function improvisedCandidates(legal, snap, ply) {
  return legal.map((m) => {
    const target = snap.grid[m.toRank] && snap.grid[m.toRank][m.toFile];
    const from = snap.grid[m.fromRank] && snap.grid[m.fromRank][m.fromFile];
    const piece = (from || '').toUpperCase();
    return {
      uci: Chess.moveToUci(m),
      capture: PIECE_WORTH[(target || '').toLowerCase()] || 0,
      check: Chess.isKingInCheck(m.nextState.grid, m.nextState.turn),
      piece,
      castle: piece === 'K' && Math.abs(m.toFile - m.fromFile) === 2,
      ply: Number(ply) || 0
    };
  });
}

// Mate in one is the one loss the promise does not allow. A move that hands one
// over is replaced by the engine's own, which keeps the improvisation honest
// without pretending every legal move is safe.
function allowsMateInOne(legal, uci) {
  const chosen = legal.find((m) => Chess.moveToUci(m) === uci);
  if (!chosen) return true;
  for (const reply of Chess.generateLegalMoves(chosen.nextState)) {
    if (!Chess.isKingInCheck(reply.nextState.grid, reply.nextState.turn)) continue;
    if (Chess.generateLegalMoves(reply.nextState).length === 0) return true;
  }
  return false;
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
    // A rejected promise here used to leave auto-play on with no timer and no
    // message: the panel said "playing" while nothing was playing.
    playMove(move, targetFen, choice)
      .then((played) => {
        if (played) state.moveMisses = 0;
        else armMoveRetry();
      })
      .catch((error) => {
        state.warn = `move failed: ${String((error && error.message) || error).slice(0, 40)}`;
        refreshPanel();
        armMoveRetry();
      });
  }, delay);
}

function applyAcplGuard() {
  const verdict = acplGuard({
    acpl: state.myAcpl,
    samples: state.myCpLosses.length,
    elo: state.effectiveElo || cfg.targetElo,
    boost: state.slackBoost
  });
  if (verdict.verdict === 'raise' || verdict.verdict === 'lower') {
    state.slackBoost = verdict.boost;
    saveGuard();
  }
}

async function playMove(move, targetFen, choice) {
  const snap = state.snapshot;
  if (!snap || !state.boardEl) return false;
  state.autoMovedFen = targetFen;
  const firstMode = Math.random() < 0.65 ? 'drag' : 'click';
  const ok = await executeMoveOnBoard(state.boardEl, move, snap.flipped, snap.turn, {
    inputMode: firstMode,
    clockSeconds: state.clockSeconds
  });
  if (!ok) return false;

  // The click can be swallowed by an ad overlay, a promotion dialog or a slow
  // board. Look at the board before assuming the move landed, and look twice:
  // a board that paints 400 ms late is a landed move, not a failed one.
  let after = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    await sleep(attempt === 0 ? cfg.verifyMoveMs : Math.max(160, Math.round(cfg.verifyMoveMs * 0.7)));
    after = scanBoard(mySide(state.snapshot ? state.snapshot.flipped : false));
    if (after && after.valid && after.grid && !Chess.gridsEqual(snap.grid, after.grid)) break;
  }
  const landed = after && after.valid && after.grid && !Chess.gridsEqual(snap.grid, after.grid);
  if (landed) {
    state.autoMovedGrid = after.grid;
    state.moveMisses = 0;
    if (choice && choice.cpLoss === 0) state.top1Streak += 1;
    else state.top1Streak = 0;
    if (choice) {
      if (choice.improvised) {
        const before = state.analysis && state.analysis.lines && state.analysis.lines[0]
          ? state.analysis.lines[0].whiteCp
          : null;
        state.pendingMyLoss = { ply: plyOf(snap) + 1, side: snap.turn, before };
        state.improvisedPicks += 1;
      } else {
        pushMyLoss(choice.cpLoss);
      }
    }
    recordOpening(move, plyOf(snap));
    recordPace(state.lastDelayMs);
    state.lastMyMoveAt = Date.now();
    scheduleScan(120);
    return true;
  }

  if (cfg.retryMoveOnce) {
    const fallback = retryInputMode(firstMode);
    state.warn = `move not registered, retrying with ${fallback}`;
    refreshPanel();
    await sleep(450);
    await executeMoveOnBoard(state.boardEl, move, snap.flipped, snap.turn, { inputMode: fallback, clockSeconds: state.clockSeconds });
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
  // Not a pause: the caller re-arms from here, and only three misses in a row
  // stop the session. A board that painted late is the common case, not a bug.
  state.warn = 'chess.com did not register the move';
  refreshPanel();
  return false;
}

async function playNow() {
  const snap = state.snapshot;
  let result = state.analysis;
  if (!snap || !state.boardEl || !result) return false;
  // A finished game keeps the last position and sometimes the last turn on the
  // board; nothing should be played into it.
  if (state.gameOverSeen) return false;
  if (snap.turnCertain === false) return false;
  if (result.fen !== snap.fen) return false;
  const ply = plyOf(snap);
  // The button asks the same question the timer asks: is this move the account's?
  // The probe runs here too, and the position is re-checked afterwards because the
  // board can move while the engine thinks.
  const shares = ply < OPENING_PLIES ? openingShares() : null;
  const target = shares ? openingProbeTarget(shares, result.lines) : null;
  const probe = target ? openingUci(snap, target.san) : null;
  const probeKey = probe ? `${snap.fen}|${target.san}` : '';
  if (probe && probeKey !== state.probedKey) {
    state.probedKey = probeKey;
    const started = Date.now();
    // Same shape and budget the timer uses: a hand on the button thinks what the clock allows.
    const lines = await engine.analyze(probeRequest(snap.fen, result.uciMoves, probe));
    state.probeSpentMs = Date.now() - started;
    if (!state.snapshot || state.snapshot.fen !== snap.fen) return false;
    const probed = lines && lines[0];
    if (probed && probed.bestUci === probe) {
      state.probes += 1;
      result = { ...result, lines: [...result.lines, { ...probed, opening: true, fen: snap.fen }] };
    }
  }
  const legal = Chess.generateLegalMoves(snap);
  const choice = chooseMove(result.lines, slackCfg(), {
    accountElo: accountRatingNow() || state.boardRating || 0,
    top1Streak: state.top1Streak,
    oppElo: state.opponentRating || state.oppEloEstimate,
    repeatUci: repeatedOpening(result.bestmove, ply),
    openingShares: ply < OPENING_PLIES ? openingShares() : null,
    improvise: improvisedCandidates(legal, snap, ply)
  });
  let move = (choice && choice.line && choice.line.bestUci) || result.bestmove;
  if (!move) return false;
  if (choice && choice.improvised && allowsMateInOne(legal, move)) {
    move = result.bestmove;
    choice.improvised = false;
    choice.cpLoss = 0;
    choice.line = result.lines[0];
  }
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
  state.lastScanAt = Date.now();
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
  if (Number(scanned.clockSeconds) > state.clockPeak) {
    state.clockPeak = Number(scanned.clockSeconds);
    // The clock names the time class, and the time class picks which published
    // rating anchors the game: a bullet game against the rapid anchor would be
    // three hundred Elo of drift nobody asked for.
    const cls = timeClassFromSeconds(state.clockPeak);
    if (state.accountRatings && cls !== state.ratingClass) resolveElo();
    // The clock also names which published pace to anchor to.
    if (state.accountRatings && (!state.paceProfile || state.paceProfile.cls !== cls)) syncPaceProfile();
  }
  // The opponent's published rating is part of the anchor, and it is read from
  // the page, not from the account: learning it after boot used to wait for the
  // next game, so game one was played as if he were unrated.
  if (scanned.opponentRating !== state.opponentRating) {
    state.opponentRating = scanned.opponentRating;
    if (scanned.opponentRating) resolveElo();
  }
  // Same for the signed-in player: the panel used to say "anonymous" while the
  // row under the board said (133), and the engine anchored to 1500.
  if (scanned.myRating !== state.boardRating) {
    state.boardRating = scanned.myRating;
    if (scanned.myRating) resolveElo();
  }

  const prev = state.snapshot;
  const tracked = tracker.updateFromDomSnapshot(scanned.grid, {
    flipped: scanned.flipped,
    plyCount: scanned.plyCount,
    sanMoves: scanned.sanMoves,
    lastHighlightSquares: scanned.lastHighlightSquares,
    activeClockTurn: scanned.activeClockTurn
  });
  if (!tracked) return;
  // The tracker returns the position, not the view: it parses `flipped` and
  // `plyCount` but does not hand them back. Everything downstream asks the
  // snapshot which side we are on (`mySide(snapshot.flipped)`), so without this
  // the answer was always "white" — wrong clock, wrong turn gate and, since
  // 1.36.0, a wrong result for every game played as black.
  const snapshot = { ...tracked, flipped: scanned.flipped, plyCount: scanned.plyCount };

  // A resignation or a flag fall leaves the position untouched, so this cannot
  // live inside `changed` like it used to: a game that ended on time sat on the
  // last board forever, and a session with rematch armed never asked for one.
  if (scanned.gameOver) {
    state.snapshot = snapshot;
    if (!state.gameOverSeen) {
      state.gameOverSeen = true;
      // One result per game: a lingering dialog that is scanned twice must not
      // count twice, so the game number that produced a result is remembered.
      const result = readGameResult(mySide(snapshot.flipped));
      if (resultCounts({ result, ply: snapshot.plyCount, placement: snapshot.placement, gamesPlayed: state.gamesPlayed, resultGame: state.resultGame })) {
        state.resultGame = state.gamesPlayed;
        state.results[result] += 1;
        saveSession();
        // The card is built while the losses of this game are still in memory:
        // `onNewGame` clears them, so a report made a second later would be empty.
        state.lastReport = gameReport({
          result,
          moves: snapshot.plyCount,
          myLosses: state.myCpLosses,
          oppLosses: state.oppCpLosses,
          rating: anchoredRating(),
          at: Date.now()
        });
        state.reportHistory = pushReport(state.reportHistory, state.lastReport);
        saveReport(state.settingsAccount || currentAccount(), state.lastReport);
        saveReportHistory(state.settingsAccount || currentAccount(), state.reportHistory);
        if (state.lastReport.myAcpl != null) noteEvent(`report: ${result} · ${state.lastReport.myAcpl} cp`);
      }
      state.warn = cfg.autoRematch ? 'game over · next in a moment' : 'game over';
      clearAutoTimer();
      clearMoveRetry();
      state.moveMisses = 0;
      if (cfg.autoRematch) queueRematch();
      else {
        state.autoPlay = false;
        noteEvent('game over · auto play off');
      }
    }
    refreshPanel();
    return;
  }

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
        // One scan can catch the board mid-paint. The second one, same position,
        // is a person moving, and then stopping is the right answer.
        const samePosition = state.foreignFen === snapshot.fen;
        state.foreignFen = snapshot.fen;
        state.foreignHits = samePosition ? state.foreignHits + 1 : 1;
        clearAutoTimer();
        if (state.foreignHits >= 2) {
          state.autoPlay = false;
          state.warn = 'paused: manual move detected';
          noteEvent('paused: manual move suspected');
        } else {
          state.warn = 'checking a move that was not mine';
          scheduleScan(700);
        }
      } else {
        state.foreignHits = 0;
        state.foreignFen = null;
      }
    }
    state.autoMovedFen = null;
    state.autoMovedGrid = null;
    if (state.gameOverSeen) onNewGame();
    analyze(snapshot, false);
  } else {
    state.snapshot = snapshot;
    refreshPanel();
  }
}

let boardObserver = null;
let docObserver = null;

// A hidden tab is not allowed to run its timers on time, and chess.com keeps the
// clock running anyway: the 2 s scan returns a minute late and the flag falls in
// between. A worker runs its intervals on a different budget, so this one pings
// the page while the tab is out of sight. If the browser batches it too, the
// panel says so and the user knows it is the tab, not the board.
let pageTicker = null;

function startPageTicker() {
  if (pageTicker) return;
  try {
    const source = [
      'let t = null;',
      'self.onmessage = (e) => {',
      '  if (e.data === "start" && t === null) t = setInterval(() => self.postMessage(1), 1000);',
      '  if (e.data === "stop") { clearInterval(t); t = null; }',
      '};'
    ].join('\n');
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = () => {
      if (document.visibilityState !== 'hidden' || !state.autoPlay || state.thinking) return;
      if (Date.now() - state.lastScanAt < 3000) return;
      scheduleScan(0);
    };
    worker.postMessage('start');
    pageTicker = worker;
  } catch {
    pageTicker = null;
  }
}

function stopPageTicker() {
  if (!pageTicker) return;
  try {
    pageTicker.terminate();
  } catch {
    /* already gone */
  }
  pageTicker = null;
}

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

// Hiding the panel is not stopping: the scan loop keeps playing while the window
// is out of sight. This key is for the moment someone walks in — auto play off,
// AFK off, timers cleared, panel gone.
function panicStop() {
  state.autoPlay = false;
  cfg.autoPlayOnLoad = false;
  cfg.autoRematch = false;
  saveSettings(cfg);
  clearAutoTimer();
  clearMoveRetry();
  clearRematchTimer();
  engine.stop();
  state.thinking = false;
  state.warn = 'stopped';
  noteEvent('panic stop · auto play and AFK off');
  if (!panel.hidden) panel.toggleHidden();
  refreshPanel();
}

function onKeyDown(event) {
  if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
  const key = event.key.toLowerCase();
  if (key === 'a') {
    event.preventDefault();
    toggleAuto();
  } else if (key === 'm') {
    event.preventDefault();
    playNow().catch(() => {});
  } else if (key === 'h') {
    event.preventDefault();
    panel.toggleHidden();
  } else if (key === 'f') {
    event.preventDefault();
    toggleAfk();
  } else if (key === 's') {
    event.preventDefault();
    panicStop();
  }
}

// A bug report that fits in a chat: what version, what engine, what the board
// said, what the account anchored it to, and which settings were live. The
// panel's own text is not selectable, so a button beats asking people to retype.
function reportText() {
  const snap = state.snapshot;
  const cls = state.ratingClass;
  const ratings = state.accountRatings;
  const rating = ratings && cls && ratings[cls] ? `${ratings[cls]} ${cls}` : 'no account rating';
  // The anchor chain, not just its result: a report that says "effective 1374"
  // cannot be checked without knowing what it was anchored to.
  const rival = state.oppEloEstimate
    ? `~${state.oppEloEstimate}`
    : state.opponentRating
      ? String(state.opponentRating)
      : 'unknown';
  const form = state.formOffset > 0 ? `+${state.formOffset}` : String(state.formOffset || 0);
  const opening = openingFor();
  const lines = [
    `chess-wraith ${VERSION}`,
    `engine ${engine.ready ? 'ready' : 'not ready'} · ${engine.mode}`,
    snap
      ? `board ply ${plyOf(snap)} · ${snap.turn === 'w' ? 'white' : 'black'} to move${snap.turnCertain === false ? ' (guess)' : ''}`
      : 'board not readable',
    `rating ${rating} · rival ${rival} · form ${form} · effective ${state.effectiveElo || 'full'} (${state.eloSource})${strengthFloor(accountRatingNow() || 0).gap ? ` · ${strengthFloor(accountRatingNow() || 0).gap} under the engine floor` : ''}`,
    state.events.length
      ? `history ${state.events.map((item) => `${eventLabel(item.at, Date.now())} ${item.text}`).join(' | ')}`
      : 'history empty',
    `clock ${Number.isFinite(state.clockSeconds) ? Math.round(state.clockSeconds) + 's' : 'none'} · last delay ${Math.round(state.lastDelayMs || 0)}ms · search ${Math.round(state.lastSearchMs || 0)}ms · search budget ${searchBudgetMs({ moveTimeMs: cfg.moveTimeMs, clockSeconds: state.clockSeconds })}ms`,
    `pace ${paceBaseline() ? (paceBaseline() / 1000).toFixed(1) + 's · ' + (state.paceProfile && state.paceProfile.medianMs ? 'acct' : 'learned') : 'default'}${state.paceProfile && state.paceProfile.session && state.paceProfile.session.peakHour != null ? ` · usual hour ${state.paceProfile.session.peakHour}` : ''}${state.paceError ? ' · ' + state.paceError : ''}`,
    opening
      ? `repertoire w ${openingTop(opening.white)} · b vs ${openingByFirstTop(opening)} (${opening.games} games)${state.probes ? ` · probe ${state.probes}` : ''}`
      : '',
    `settings depth ${cfg.maxDepth}${depthForAccount(cfg.maxDepth, state.effectiveElo) > cfg.maxDepth ? `->${depthForAccount(cfg.maxDepth, state.effectiveElo)}` : ''} · ${cfg.moveTimeMs} ms · slack ${cfg.humanSlackCp}${state.slackBoost ? `+${state.slackBoost}` : ''} cp · auto ${state.autoPlay ? 'on' : 'off'} · afk ${cfg.autoRematch ? 'on' : 'off'} · theme ${cfg.theme}`,
    state.lastReport
      ? `last game ${state.lastReport.result || '?'}${state.lastReport.moves ? ' · ' + state.lastReport.moves + ' moves' : ''} · you ${state.lastReport.myAcpl ?? '–'} cp/move${state.lastReport.myPerf ? ' (like ' + state.lastReport.myPerf + ')' : ''} · rival ${state.lastReport.oppAcpl ?? '–'}${state.lastReport.oppPerf ? ' (like ' + state.lastReport.oppPerf + ')' : ''} · account ${state.lastReport.rating ?? '–'}${Number.isFinite(state.lastReport.delta) ? ' (' + (state.lastReport.delta >= 0 ? '+' : '') + state.lastReport.delta + ')' : ''}`
      : '',
    state.throttled ? 'tab hidden: timers batched' : '',
    state.warn ? `warn ${state.warn}` : ''
  ];
  return lines.filter(Boolean).join('\n');
}

async function copyReport() {
  const text = reportText();
  let copied = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch {
    /* the page can deny it; the textarea is the fallback */
  }
  if (!copied) {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:-200px;left:0;opacity:0';
    document.body.appendChild(area);
    area.select();
    try {
      copied = Boolean(document.execCommand && document.execCommand('copy'));
    } catch {
      copied = false;
    }
    area.remove();
  }
  // No console: the artifact is checked for console calls. A prompt prefilled
  // with the text is the only fallback every browser still selects for you.
  if (!copied && typeof prompt === 'function') prompt('chess-wraith report', text);
  state.warn = copied ? 'report copied' : 'copy blocked; select the box and copy';
  refreshPanel();
}

function toggleAuto() {
  state.autoPlay = !state.autoPlay;
  cfg.autoPlayOnLoad = state.autoPlay;
  saveSettings(cfg);
  if (!state.autoPlay) {
    clearAutoTimer();
    clearMoveRetry();
    // A stopped run is finished: the next one starts the clock again.
    clearSession();
  } else {
    state.sessionStart = Date.now();
    state.gamesPlayed = 1;
    saveSession();
    if (state.analysis && state.snapshot && state.analysis.fen === state.snapshot.fen) {
      scheduleAutoMove(state.analysis);
    }
  }
  refreshPanel();
}

// Settings that change the question we ask the engine: the running search is
// now wrong, so drop it and rescan.
function settingsChanged(next) {
  Object.assign(cfg, next);
  saveSettings(cfg);
  resolveElo();
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
  resolveElo();
  refreshPanel();
}

const panel = new WraithPanel(cfg, {
  toggleAuto,
  toggleAfk,
  step: () => playNow().catch(() => false),
  scan: () => {
    state.analyzedFen = null;
    runScan();
    analyze(state.snapshot, true);
  },
  checkUpdate: () => checkUpdate(true),
  copyReport,
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
  // The guard this account already earned, and its published rating: both are
  // what makes the script behave like this player and not like a generic bot.
  state.slackBoost = readGuard();
  heartbeatTab();
  setInterval(heartbeatTab, 3000);
  startUpdateCheck();
  syncAccountRatings();
  syncPaceProfile();
  syncRepertoire();
  // Clicking the rating asks again instead of waiting out the six-hour cache.
  if (panel.el && panel.el.rating) {
    panel.el.rating.style.cursor = 'pointer';
    panel.el.rating.addEventListener('click', () => syncAccountRatings(true));
  }
  // Same idea for the pace: clicking it re-reads the account's public games
  // instead of waiting out the six-hour cache.
  if (panel.el && panel.el.pace) {
    panel.el.pace.style.cursor = 'pointer';
    panel.el.pace.addEventListener('click', () => syncPaceProfile(true));
  }
  window.addEventListener('pagehide', releaseTab);
  panel.render(statusView());
  refreshPanel();
  syncKeepAlive();
  engine.boot();
  // The strength must exist before the first search, not after the first rating
  // fetch: a signed-out tab or a blocked profile request used to leave it null
  // and the engine fell back to its own 1320 floor.
  resolveElo();
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
  startPageTicker();
  scanTimer = setInterval(() => {
    const tickAt = Date.now();
    if (state.lastTickAt) {
      const throttled = throttleDecision({
        hidden: document.visibilityState === 'hidden',
        lagMs: tickAt - state.lastTickAt,
        expectedMs: 2000
      });
      if (throttled !== state.throttled) {
        state.throttled = throttled;
        if (throttled && !state.warn) state.warn = 'tab hidden · timers batched by the browser';
        if (!throttled && /timers batched/.test(state.warn || '')) state.warn = '';
        refreshPanel();
      }
    }
    state.lastTickAt = tickAt;
    if (!state.boardEl || !state.boardEl.isConnected) {
      scheduleScan(0);
      return;
    }
    if (!state.analysis && !state.thinking) {
      runScan();
      return;
    }
    // Self-heal. Our turn, a fresh analysis, and nothing armed: every other path
    // that arms a move lives inside a callback that already ran or was skipped.
    // This tick is the only thing left that can notice, and without it the panel
    // says "playing" while nothing plays.
    if (!state.snapshot) return;
    if (!autoArmDecision({
      autoPlay: state.autoPlay,
      thinking: state.thinking,
      autoTimer: state.autoTimer,
      retryTimer: moveRetryTimer,
      gameOver: state.gameOverSeen,
      analysisFen: state.analysis ? state.analysis.fen : '',
      snapshotFen: state.snapshot.fen,
      ourTurn: mySide(state.snapshot.flipped) === state.snapshot.turn
    })) return;
    if (!state.analysis || !state.snapshot) return;
    if (state.analysis.fen !== state.snapshot.fen) return;
    if (mySide(state.snapshot.flipped) !== state.snapshot.turn) return;
    scheduleAutoMove(state.analysis);
  }, 2000);

  registerButler();
}

boot();
