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
function searchBudgetMs(job) {
  const movetime = clampInt(job && job.moveTimeMs, 120, 6000, 700);
  return movetime * 6 + 6000;
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

function saveSettings(cfg) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    /* storage can be blocked; the panel keeps the in-memory value */
  }
}
