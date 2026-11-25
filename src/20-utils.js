// Bump the engine pin and the NNUE verdict is re-earned: a new build may fix
// what the shim cannot do today. Keys are scoped to the mirror URL.
const NNUE_SKIP_KEY = 'chess-wraith-nnue-skip-v1';
const NNUE_SKIP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function nnueSkipActive(raw, mirror, nowMs) {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.mirror !== mirror) return false;
    const age = nowMs - Number(parsed.at || 0);
    return Number.isFinite(age) && age >= 0 && age < NNUE_SKIP_TTL_MS;
  } catch {
    return false;
  }
}

function readNnueSkip() {
  try {
    return nnueSkipActive(localStorage.getItem(NNUE_SKIP_KEY), ENGINE_MIRROR, Date.now());
  } catch {
    return false;
  }
}

function rememberNnueSkip() {
  try {
    localStorage.setItem(NNUE_SKIP_KEY, JSON.stringify({ mirror: ENGINE_MIRROR, at: Date.now() }));
  } catch {
    /* storage can be blocked; the four seconds are the whole cost */
  }
}

function forgetNnueSkip() {
  try {
    localStorage.removeItem(NNUE_SKIP_KEY);
  } catch {
    /* nothing to forget */
  }
}

// Median of a small sample. Used for an account's own pace and for the
// opponent's tempo: both are "what usually happens", not "what happened once".
function median(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function pushBounded(list, value, cap) {
  const next = Array.isArray(list) ? list.slice() : [];
  if (Number.isFinite(value) && value > 0) next.push(Math.round(value));
  while (next.length > cap) next.shift();
  return next;
}
// Two tabs of the same browser must not drive the same board. The lease is a
// heartbeat; whoever holds a fresh one keeps the wheel, a closed tab expires.
function versionParts(value) {
  const core = String(value == null ? '' : value).trim().replace(/^v/i, '').split(/[+-]/)[0];
  const parts = core.split('.').map((n) => Number.parseInt(n, 10));
  if (!parts.length || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return parts;
}

// Strictly newer, or it is not an update: a meta file that cannot be parsed
// must never make the panel nag.
// A check is due when there is no usable timestamp yet or the last one is old
// enough. Kept pure so the throttle can be tested without a clock.
function updateCheckDue(now, lastAt, minMs) {
  const current = Number(now);
  const last = Number(lastAt);
  if (!Number.isFinite(last) || last <= 0) return true;
  if (!Number.isFinite(current)) return false;
  return current - last >= (Number(minMs) > 0 ? Number(minMs) : 0);
}

function versionNewer(next, current) {
  const a = versionParts(next);
  const b = versionParts(current);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

function tabLeaseDecision(entry, now, ttlMs, myId) {
  if (!entry || typeof entry !== 'object') return 'claim';
  const at = Number(entry.at);
  if (typeof entry.id !== 'string' || !entry.id || !Number.isFinite(at)) return 'claim';
  if (!(now - at <= ttlMs)) return 'claim';
  return entry.id === myId ? 'renew' : 'passive';
}

// A swallowed click is not a stopped session. Three growing attempts cover the ad
// overlay, the promotion dialog that painted late and the board that was still
// animating; after that the click is the problem and saying so is honest.
function moveRetryPlan(attempt) {
  const n = Math.max(1, Math.floor(Number(attempt) || 1));
  if (n > 3) return { retry: false, delayMs: 0 };
  return { retry: true, delayMs: 900 * n };
}

// A hidden tab gets its timers batched: the 2 s scan can come back a minute late.
// That is the browser, not the board, and knowing it is the difference between
// "the script stalled" and "keep the tab visible".
function throttleDecision(opts) {
  const o = opts || {};
  if (!o.hidden) return false;
  const lag = Number(o.lagMs);
  const expected = Number(o.expectedMs);
  if (!Number.isFinite(lag) || !Number.isFinite(expected) || expected <= 0) return false;
  return lag > Math.max(2500, expected * 1.8);
}

// Should the idle tick arm a move right now? A finished game is the trap: the
// board does not change when the clock runs out, so the last analysis still
// matches the last position and the turn still looks ours.
function autoArmDecision(opts) {
  const o = opts || {};
  if (!o.autoPlay || o.thinking || o.autoTimer || o.retryTimer) return false;
  if (o.gameOver) return false;
  if (!o.analysisFen || !o.snapshotFen || o.analysisFen !== o.snapshotFen) return false;
  return Boolean(o.ourTurn);
}

// A move landed on our own turn that we did not click: a human took over, or
// another tab played. A guessed turn never fires this, only a certain one.
function foreignMoveSeen(opts) {
  const o = opts || {};
  if (!o.prevCertain || !o.nextCertain) return false;
  if (!o.prevMine || o.nextMine) return false;
  // A board with no clocks is an analysis board: the turn is a guess there, so
  // never accuse the user of moving on it.
  if (!o.hasClock) return false;
  if (!o.plyAdvanced) return false;
  return !o.matchedOurGrid;
}

// A search that never answers must not wedge the panel forever. The budget is
// generous relative to the request so a slow-but-working search still finishes.
// Pawn count is the honest phase signal: material is what the position is made
// of, while the move number lies the moment a piece is traded.
function phaseTimeScale(fen, ply) {
  const field = String(fen || '').split(' ')[0];
  const men = (field.match(/[prnbqkPRNBQK]/g) || []).length;
  if (!men) return 1;
  if (men <= 10) return 1.35;
  if (men <= 16) return 1.15;
  if (Number(ply) > 0 && Number(ply) <= 16) return 0.85;
  return 1;
}

// A conversion is where a lost half-pawn decides the game, and an opening book
// move does not need 700 ms of search. The ceiling stays where the engine's
// watchdog expects it.
function phaseMoveTime(baseMs, fen, ply) {
  const base = clampInt(baseMs, 120, 6000, 700);
  return clampInt(Math.round(base * phaseTimeScale(fen, ply)), 150, 5000, base);
}

// "checked 3h ago" reads better than "checked 187m ago".
function formatAge(ms) {
  const delta = Number(ms);
  if (!Number.isFinite(delta) || delta < 0) return 'never';
  if (delta < 60000) return 'just now';
  const minutes = Math.round(delta / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function searchBudgetMs(job) {
  const movetime = clampInt(job && job.moveTimeMs, 120, 6000, 700);
  const base = movetime * 6 + 6000;
  const clock = Number(job && job.clockSeconds);
  // Half the clock is already lost. Waiting longer than that for an engine that
  // may be dead costs the game, not the move.
  if (!Number.isFinite(clock) || clock <= 0) return base;
  return Math.min(base, Math.max(1500, Math.round(clock * 500)));
}

// How long this move is allowed to search. The published budget assumes a full
// clock; with four seconds left, a 900 ms search plus the click is a flag.
function clockBoundMoveTime(moveTimeMs, clockSeconds) {
  const move = clampInt(moveTimeMs, 120, 6000, 700);
  const clock = Number(clockSeconds);
  if (!Number.isFinite(clock) || clock <= 0) return move;
  return Math.max(150, Math.min(move, Math.round(clock * 200)));
}

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

// Stockfish's UCI_Elo stops at 1320: a 900-rated account cannot be asked for.
// The engine plays at the floor and nothing said so, so the panel does now, and
// the move chooser compensates with slack instead of pretending the number took.
const ELO_FLOOR = 1320;

function strengthFloor(elo) {
  const e = Number(elo);
  if (!Number.isFinite(e) || e <= 0) return { requested: 1500, floor: 1500, gap: 0 };
  const floor = Math.round(clamp(e, ELO_FLOOR, 3190));
  return { requested: Math.round(e), floor, gap: Math.max(0, Math.round(ELO_FLOOR - e)) };
}

// A rating 400 under the floor is not playable by strength at all, so it is
// played by looseness: a wider window of acceptable moves, capped like the rest.
function floorSlack(elo) {
  return clampInt(Math.round(strengthFloor(elo).gap / 5), 0, 120, 0);
}

function pickEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

// chess.com publishes one rating per time class. Which one the board is asking
// for is decided by the clock, not by a setting, so the same account plays at
// 1800 in blitz and 1600 in bullet instead of a single invented number.
const RATING_CLASSES = { bullet: 'chess_bullet', blitz: 'chess_blitz', rapid: 'chess_rapid', daily: 'chess_daily' };

function timeClassFromSeconds(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return 'blitz';
  if (s < 180) return 'bullet';
  if (s < 600) return 'blitz';
  if (s < 1800) return 'rapid';
  return 'daily';
}

// Glicko-2 starts a new rating at RD 350 and settles by about 1/sqrt(n) while the
// opponents are close and the results even. A 2100 with two games behind it is not
// a 2100, so the strength anchor weights the rating against a 1200 prior by how
// much of that uncertainty is actually gone. Derived from the rating system, not
// from chess.com's private data: it is a prior, not a measurement.
const RATING_PRIOR_ELO = 1200;
const RATING_RD0 = 350;

function ratingWeight(games) {
  const n = Number(games);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const q = Math.log(10) / 400;
  const d2 = 4 / (q * q);
  const rd = Math.sqrt(1 / (1 / (RATING_RD0 * RATING_RD0) + n / d2));
  return clamp(1 - rd / RATING_RD0, 0.05, 0.9);
}

function settledRating(rating, games, prior) {
  const r = Number(rating);
  if (!Number.isFinite(r) || r <= 0) return null;
  const base = Number(prior) > 0 ? Number(prior) : RATING_PRIOR_ELO;
  const elo = Math.round(ratingWeight(games) * r + (1 - ratingWeight(games)) * base);
  return clamp(elo, 400, 3500);
}

// Games behind each rating class, from the record the stats endpoint already
// returns. Null means "no idea", and the anchor then trusts the number as is.
function normalizeGameCounts(stats) {
  const out = {};
  for (const [cls, key] of Object.entries(RATING_CLASSES)) {
    const rec = stats && stats[key] && stats[key].record;
    if (!rec) continue;
    const n = (Number(rec.win) || 0) + (Number(rec.loss) || 0) + (Number(rec.draw) || 0);
    if (n > 0) out[cls] = n;
  }
  return Object.keys(out).length ? out : null;
}

// Keeps only the classes the account actually has, as a flat map.
function normalizeRatings(stats) {
  const out = {};
  for (const [cls, key] of Object.entries(RATING_CLASSES)) {
    const node = stats && stats[key];
    const rating = node && node.last && Number(node.last.rating);
    if (Number.isFinite(rating) && rating > 0) out[cls] = Math.round(rating);
  }
  return Object.keys(out).length ? out : null;
}

function pickRating(ratings, timeClass) {
  if (!ratings) return null;
  return ratings[timeClass] || ratings.blitz || ratings.rapid || ratings.bullet || ratings.daily || null;
}

// Who is signed in. The navbar is the reliable place, but chess.com also puts the
// session on window.chesscom, and a page that has not painted its navbar yet used
// to be treated as anonymous: wrong rating, wrong pace, and now wrong settings.
function normalizeAccountName(value) {
  const name = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return name.slice(0, 32);
}

function currentAccount() {
  const doc = typeof document !== 'undefined' ? document : null;
  if (doc) {
    for (const sel of ['#user-username-component', '.user-username', '.profile-username']) {
      let el = null;
      try {
        el = doc.querySelector(sel);
      } catch {
        el = null;
      }
      const fromDom = el ? normalizeAccountName(el.textContent) : '';
      if (fromDom) return fromDom;
    }
  }
  const win = typeof window !== 'undefined' ? window : null;
  const site = win && win.chesscom;
  const candidates = [
    site && site.user && site.user.username,
    site && site.userNavigationConfig && site.userNavigationConfig.username
  ];
  for (const candidate of candidates) {
    const name = normalizeAccountName(candidate);
    // A logged-out page can still carry a placeholder name; it is not a player.
    if (name && name !== 'guest' && name !== 'anonymous') return name;
  }
  return 'anonymous';
}

// Settings belong to the account, not to the browser: a second account on the
// same machine used to inherit the first one's depth and theme, which is how a
// 900-rated profile ends up calibrated like a 2400 one. Anonymous keeps the
// legacy global key so a logged-out tab still has somewhere to write.
function settingsKeyFor(user) {
  const name = normalizeAccountName(user === undefined ? currentAccount() : user);
  return name && name !== 'anonymous' ? `${STORAGE_KEY}:${name}` : STORAGE_KEY;
}

// Set when the stored settings were rewritten in memory and should be flushed.
let settingsNeedsSave = false;

function loadSettings(user) {
  try {
    const key = settingsKeyFor(user);
    let stored = localStorage.getItem(key);
    // One-time migration from the single global key: an existing install keeps
    // the tuning it had, then diverges per account.
    if (!stored && key !== STORAGE_KEY) {
      const legacy = localStorage.getItem(STORAGE_KEY);
      if (legacy) {
        stored = legacy;
        try {
          localStorage.setItem(key, legacy);
        } catch {
          /* storage can be full; the value is still used below */
        }
      }
    }
    const raw = JSON.parse(stored || '{}');
    const merged = { ...CONFIG, ...raw };
    // 1650 was this script's own default, not a choice. The first load after
    // 1.6.0 treats it as "no opinion" and lets the account's rating take over.
    if (!raw.anchorMigrated) {
      if (raw.targetElo === undefined || raw.targetElo === 1650) merged.targetElo = 0;
      settingsNeedsSave = true;
    }
    merged.anchorMigrated = true;
    merged.sideOverride = pickEnum(merged.sideOverride, ['auto', 'w', 'b'], 'auto');
    // 0 means "the account's own rating"; anything else is a manual ceiling.
    merged.targetElo = clampInt(merged.targetElo, 0, 3190, CONFIG.targetElo);
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
    merged.theme = pickEnum(merged.theme, ['carbon', 'aurora', 'sunset', 'ice', 'violet', 'rgb'], CONFIG.theme);
    merged.autoRematch = Boolean(merged.autoRematch);
    merged.afkKeepAlive = Boolean(merged.afkKeepAlive);
    merged.newGameLongChance = Number.isFinite(merged.newGameLongChance)
      ? clamp(merged.newGameLongChance, 0, 0.5)
      : CONFIG.newGameLongChance;
    if (merged.maxThinkMs < merged.minThinkMs) merged.maxThinkMs = merged.minThinkMs;
    return merged;
  } catch {
    return { ...CONFIG };
  }
}

function saveSettings(cfg, user) {
  try {
    localStorage.setItem(settingsKeyFor(user), JSON.stringify(cfg));
  } catch {
    /* storage can be blocked; the panel keeps the in-memory value */
  }
}
