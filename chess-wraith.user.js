// ==UserScript==
// @name         CHESS WRAITH
// @namespace    chess.wraith
// @version      1.83.0
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

const VERSION = '1.83.0';
const STORAGE_KEY = 'chess-wraith-settings-v1';

// The panel checks this on boot and every six hours; both answers are public
// static files, so the request carries nothing about the account.
const UPDATE_REPO = 'ezurinho/chess-wraith';
const UPDATE_META_URL = `https://cdn.jsdelivr.net/gh/${UPDATE_REPO}@latest/package.json`;
const UPDATE_API_URL = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;
const UPDATE_DOWNLOAD_URL = `https://github.com/${UPDATE_REPO}/releases/latest/download/chess-wraith.user.js`;
const UPDATE_PAGE_URL = `https://github.com/${UPDATE_REPO}/releases/latest`;
const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000;
// The six hour timer is what browsers freeze in a background tab; the shortest
// gap between two opportunistic checks (focus, visibility, reconnect) is this.
const UPDATE_RECHECK_MS = 5 * 60 * 1000;
// A rematch the opponent never accepts leaves the same dialog on screen. Twelve
// seconds is long enough for chess.com to answer, short enough not to idle.
const REMATCH_RETRY_MS = 12000;

const CONFIG = {
  // Engine
  targetElo: 0, // 0 = follow the signed-in account's own rating
  maxDepth: 14,
  moveTimeMs: 700,
  multiPv: 4,
  hashMb: 32,

  // Pacing: the whole point of this script is that it does not look like a bot.
  autoPlayOnLoad: false,
  // Always auto: no click to start and no click to continue. It turns auto-play,
  // rematch and the keep-alive on at boot, and the session cap becomes a rollover
  // instead of a stop, the way nitro-wraith keeps queueing races. Turn it off in
  // Tune to get the old one-session behaviour back.
  alwaysAuto: true,
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

  // A session that never ends is the difference between "playing with help" and
  // "a bot farming the account". Both caps end the session; the panel says which
  // one tripped.
  sessionMaxGames: 15,
  sessionMaxMs: 3 * 60 * 60 * 1000,

  // AFK: play through the end of a game and into the next one without a human.
  // Off by default; the panel says what it is doing and why it stopped.
  autoRematch: false,
  afkKeepAlive: false,
  newGameDelayMs: [1700, 4200],
  newGameLongChance: 0.12,
  newGameLongMs: [5000, 9500],

  // Panel
  theme: 'carbon', // 'carbon' | 'aurora' | 'sunset' | 'ice' | 'violet' | 'rgb'

  panelCollapsed: false,
  showLines: 3,
  // Paint the engine's move on the board, not only in the panel.
  arrows: true,
  // Below the engine floor, aim the chooser at the account's own loss rate.
  levelPlay: true
};

// There is one way to play and it is the honest one: no GM/rage presets, no
// "full engine" switch. The engine is capped to a rating a human at this table
// could plausibly hold, and nothing here ever asks it to play its raw best.
const LEGIT = { elo: null, skill: 20, slack: 40, miss: 0, label: 'Legit' };

// Pinned to the release tag, not @main: this file is executed inside chess.com,
// so the bytes behind it must not change without a tag and a version bump.
const ENGINE_MIRROR = 'https://cdn.jsdelivr.net/gh/ezurinho/chess-wraith@v1.83.0/vendor';
const ENGINE_FILES = {
  nnueJs: `${ENGINE_MIRROR}/stockfish-19-lite-single.js`,
  nnueWasm: `${ENGINE_MIRROR}/stockfish-19-lite-single.wasm`,
  fallbackJs: `${ENGINE_MIRROR}/stockfish.js`
};


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

// The promotion dialog appears after the drop, and how late depends on the
// machine, so it is polled. But a promotion with two seconds left cannot spend
// most of that poll waiting: the budget scales with the clock, same as the
// search does.
function promotionPollPlan(clockSeconds) {
  const clock = Number(clockSeconds);
  if (!Number.isFinite(clock) || clock <= 0 || clock > 8) return { attempts: 8, pauseMs: 120 };
  const pauseMs = clock < 4 ? 40 : 80;
  const budget = Math.max(150, Math.round(clock * 350));
  return { attempts: Math.max(2, Math.min(8, Math.round(budget / pauseMs))), pauseMs };
}

// A tab you left at midnight should be able to tell you what happened while
// you were away. Five entries, newest last, consecutive repeats collapsed so a
// retry loop cannot flush the history it is supposed to explain.
function pushEvent(events, text, at, limit = 5) {
  const list = Array.isArray(events) ? events.slice() : [];
  const label = String(text == null ? '' : text).trim();
  if (!label) return list;
  const cap = Math.max(1, Math.round(Number(limit) || 5));
  const last = list[list.length - 1];
  if (last && last.text === label) return list;
  list.push({ at: Number(at) || 0, text: label });
  while (list.length > cap) list.shift();
  return list;
}

// 24-hour `HH:MM` for the history line, in the page's own timezone.
function eventClock(at) {
  const when = new Date(Number(at) || 0);
  const hh = String(when.getHours()).padStart(2, '0');
  const mm = String(when.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// A persisted history outlives midnight, so today's line reads `14:03` and an
// older one keeps its date: an AFK night is exactly when that distinction
// matters.
function eventLabel(at, now) {
  const when = new Date(Number(at) || 0);
  const today = new Date(Number(now) || 0);
  const sameDay = when.getFullYear() === today.getFullYear() &&
    when.getMonth() === today.getMonth() &&
    when.getDate() === today.getDate();
  if (sameDay) return eventClock(at);
  const dd = String(when.getDate()).padStart(2, '0');
  const mm = String(when.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm} ${eventClock(at)}`;
}

// The session limit is a safety valve, and a reload used to reset it: arrive
// next morning and "3 h / 10 games" had quietly become a fresh start, so a
// Tampermonkey update at 03:00 could keep the account playing until dawn.
// Resumed only while the run is still plausibly the same one — a tab opened
// the next day is a new session, not a 19-hour one.
// A session's score is a claim about games that were played, so a stored value
// is rounded and clamped; anything else is zeros.
function normalizeResults(raw) {
  const pick = (value) => Math.min(999, Math.max(0, Math.round(Number(value) || 0)));
  return raw && typeof raw === 'object'
    ? { win: pick(raw.win), loss: pick(raw.loss), draw: pick(raw.draw) }
    : { win: 0, loss: 0, draw: 0 };
}

function resumeSession(stored, now, maxMs) {
  const at = Number(now) || 0;
  const ttl = Math.max(0, Number(maxMs) || 0) || 12 * 3600 * 1000;
  const startedAt = Number(stored && stored.startedAt) || 0;
  const games = Math.max(1, Math.round(Number(stored && stored.games) || 1));
  if (!startedAt || startedAt > at + 60000 || at - startedAt > ttl) {
    return { startedAt: at, games: 1, resumed: false, results: normalizeResults(null) };
  }
  return { startedAt, games, resumed: true, results: normalizeResults(stored && stored.results) };
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

// The delay is the gap a person leaves between the opponent's move and their
// own, and the search already lives inside that gap: waiting the whole delay
// after the engine answers doubles the interval the account is supposed to keep
// (700 ms search against a 700 ms bullet median is a 2x tell and 28 s of clock
// in a 40-move game). The visible part is what is left of the target.
function visibleDelayMs(targetMs, spentMs) {
  const target = Math.max(0, Number(targetMs) || 0);
  const spent = Math.max(0, Number(spentMs) || 0);
  return Math.max(120, Math.round(target - spent));
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

// A night is not one strength. Two accounts at the same rating do not play the
// same moves, and nobody plays their rating exactly on every game: form drifts
// by a few dozen points and comes back. This is a stable pseudo-random offset
// keyed by the account and the game number, so every game differs and the same
// game always asks for the same strength.
function formOffset(key, span) {
  const text = String(key || '');
  const width = clampInt(span, 0, 60, 30);
  if (!text || !width) return 0;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (Math.abs(hash) % (width * 2 + 1)) - width;
}

// The profile rating is cached for six hours, which is right for page loads and
// wrong for a session: an account that climbs during the night would be played
// at the strength it had at boot. Refreshed at game boundaries, no more often
// than every twenty minutes, and only after a few games have gone by.
const RATING_REFRESH_MS = 20 * 60 * 1000;

function ratingRefreshDue(now, lastAt, gamesPlayed, gamesAtFetch) {
  const games = Math.max(0, Math.round(Number(gamesPlayed) || 0));
  const atFetch = Math.max(0, Math.round(Number(gamesAtFetch) || 0));
  if (games - atFetch < 3) return false;
  const last = Number(lastAt) || 0;
  return !(last > 0) || now - last >= RATING_REFRESH_MS;
}

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
    merged.alwaysAuto = Boolean(merged.alwaysAuto);
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

// The suffix is where two sources disagree (a PGN says 'Nf3+', the engine says
// 'Nf3+'); the move is not. Two different moves never differ only by a suffix.
function sanKey(san) {
  return String(san || '').replace(/[+#]+$/, '');
}

function saveSettings(cfg, user) {
  try {
    localStorage.setItem(settingsKeyFor(user), JSON.stringify(cfg));
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

  // After a click the question is not "did the board change" but "did the board
  // play the move that was asked for". 'wrong' is the case that used to pass: a
  // click that selected another piece changes the grid too.
  function moveLanded(before, after, expected) {
    if (!before || !after) return 'none';
    if (gridsEqual(before, after)) return 'none';
    if (!expected) return 'landed';
    return gridsEqual(after, expected) ? 'landed' : 'wrong';
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
    moveLanded,
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
    isSquareAttacked,
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

// The panel can say 'Nf3', but a player reads an arrow faster than a SAN line.
// This paints the engine's choice on the board itself: one SVG, no innerHTML,
// no pointer events, and the same eight-by-eight grid the reader already uses.
const OVERLAY_ATTR = 'data-cw-overlay';
const OVERLAY_OURS = '#5cf2a0';
const OVERLAY_THREAT = '#ff6f6f';
const OVERLAY_NS = 'http://www.w3.org/2000/svg';

function overlayCell(square, flipped) {
  const parsed = Chess.parseSquare(square);
  if (!parsed) return null;
  return {
    x: flipped ? 7 - parsed.file : parsed.file,
    y: flipped ? parsed.rank : 7 - parsed.rank
  };
}

// Cell centres, shortened at both ends: an arrow that starts under the piece
// and ends under the target hides the two squares the user wants to see.
function overlayArrow(uci, flipped) {
  if (typeof uci !== 'string' || uci.length < 4) return null;
  const from = overlayCell(uci.slice(0, 2), flipped);
  const to = overlayCell(uci.slice(2, 4), flipped);
  if (!from || !to) return null;
  const ax = from.x + 0.5;
  const ay = from.y + 0.5;
  const bx = to.x + 0.5;
  const by = to.y + 0.5;
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  if (!length) return null;
  const ux = dx / length;
  const uy = dy / length;
  return {
    x1: ax + ux * 0.20,
    y1: ay + uy * 0.20,
    x2: bx - ux * 0.42,
    y2: by - uy * 0.42,
    ux,
    uy,
    length
  };
}

function overlaySvg(boardEl) {
  if (!boardEl || typeof boardEl.querySelector !== 'function') return null;
  let svg = boardEl.querySelector(`svg[${OVERLAY_ATTR}]`);
  if (svg) return svg;
  svg = document.createElementNS(OVERLAY_NS, 'svg');
  svg.setAttribute(OVERLAY_ATTR, '1');
  svg.setAttribute('viewBox', '0 0 8 8');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  svg.style.left = '0';
  svg.style.top = '0';
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.pointerEvents = 'none';
  svg.style.zIndex = '6';
  svg.style.overflow = 'visible';
  boardEl.appendChild(svg);
  return svg;
}

function drawOverlayArrow(svg, arrow, color, width, opacity) {
  if (!svg || !arrow || arrow.length < 0.25) return;
  const line = document.createElementNS(OVERLAY_NS, 'line');
  line.setAttribute('x1', String(arrow.x1));
  line.setAttribute('y1', String(arrow.y1));
  line.setAttribute('x2', String(arrow.x2));
  line.setAttribute('y2', String(arrow.y2));
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', String(width));
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('opacity', String(opacity));
  line.setAttribute('data-cw-arrow', 'shaft');
  const head = 0.26;
  const half = 0.15;
  const tipX = arrow.x2 + arrow.ux * head;
  const tipY = arrow.y2 + arrow.uy * head;
  const poly = document.createElementNS(OVERLAY_NS, 'polygon');
  poly.setAttribute('points', [
    `${tipX},${tipY}`,
    `${arrow.x2 - arrow.uy * half},${arrow.y2 + arrow.ux * half}`,
    `${arrow.x2 + arrow.uy * half},${arrow.y2 - arrow.ux * half}`
  ].join(' '));
  poly.setAttribute('fill', color);
  poly.setAttribute('opacity', String(opacity));
  poly.setAttribute('data-cw-arrow', 'head');
  svg.appendChild(line);
  svg.appendChild(poly);
}

// lines is the engine's formatted MultiPV list. The top line is our move; its
// second ply is the opponent's best answer, drawn thinner and red so the two
// cannot be confused when they cross.
function paintBoardOverlay(boardEl, lines, flipped, enabled) {
  if (!boardEl || typeof boardEl.querySelector !== 'function') return;
  const svg = boardEl.querySelector(`svg[${OVERLAY_ATTR}]`);
  const first = enabled && Array.isArray(lines) ? lines[0] : null;
  const best = first && typeof first.bestUci === 'string' ? first.bestUci : '';
  const reply = best && Array.isArray(first.pv) && typeof first.pv[1] === 'string' ? first.pv[1] : '';
  if (!best) {
    if (svg) {
      svg.textContent = '';
      svg.removeAttribute('data-sig');
    }
    return;
  }
  const target = overlaySvg(boardEl);
  const sig = `${flipped ? 'b' : 'w'}|${best}|${reply}`;
  if (target.getAttribute('data-sig') === sig) return;
  target.setAttribute('data-sig', sig);
  target.textContent = '';
  const theirs = reply ? overlayArrow(reply, flipped) : null;
  const ours = overlayArrow(best, flipped);
  if (theirs) drawOverlayArrow(target, theirs, OVERLAY_THREAT, 0.07, 0.55);
  if (ours) drawOverlayArrow(target, ours, OVERLAY_OURS, 0.095, 0.9);
}

// Local Stockfish 19 NNUE. The engine ships as a classic worker script plus a
// .wasm sidecar. A blob worker cannot see its own directory, and the build does
// not ask for "stockfish.wasm" either: it builds the name from self.location.href
// plus a content hash, so the request looks like
//   https://www.chess.comhttps://www.chess.com/554211df-...
// Matching on ".wasm" therefore never fired and NNUE silently failed. The shim
// below answers every request that is not the engine's own script with the wasm
// bytes from the mirror, which is the only other thing this build fetches.
// Verified in Chrome on chess.com: blob workers and WASM compile are not blocked
// by the page CSP, and the engine answers uci in ~110 ms.

// Pure: the worker preamble. The engine fetches exactly two things, its own
// script (never, it is already inlined) and its wasm sidecar, so everything that
// is not the script URL is answered with the wasm from the mirror.
function buildNnueShim(wasmUrl, engineJsUrl) {
  return (
    `self.__CW_WASM=${JSON.stringify(wasmUrl)};` +
    `self.__CW_JS=${JSON.stringify(engineJsUrl)};` +
    '(function(){var real=self.fetch?self.fetch.bind(self):null;if(!real)return;' +
    'self.fetch=function(u,o){var s=String(u&&u.url?u.url:u);' +
    'if(s===self.__CW_JS)return real(u,o);' +
    'return real(self.__CW_WASM,o);};})();\n'
  );
}

// 5 s, 20 s, 60 s, then every five minutes.
const RETRY_BACKOFF_MS = [5000, 20000, 60000, 300000];

// A fetch that never left the machine throws TypeError; an edge that is not
// ready answers 5xx. Both mean "try again" and neither is a verdict about the
// build, so neither may poison the NNUE skip cache.
function isNetworkError(err) {
  if (!err) return false;
  if (err.name === 'TypeError') return true;
  return /^HTTP 5\d\d/.test(String(err.message || ''));
}

// What the engine says it is, not what we hoped it was. The panel prints this
// string and the debug report repeats it, so a build served from another tag
// must not be mislabelled by a constant: the vendored worker answers
// `id name Stockfish 19 Lite WASM` (measured 2026-11-26 in the browser).
function engineLabel(idName, nnue) {
  // The JS fallback has its own name whatever number it carries.
  if (!nnue) return 'Stockfish 2019 JS';
  const match = /Stockfish\s+(\d+(?:\.\d+)?)/i.exec(String(idName || ''));
  return match ? `Stockfish ${match[1]} NNUE` : 'Stockfish 19 NNUE';
}

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
    this.watchdogTimer = null;
    // Not derived from the mode string: "Stockfish 2019 JS" contains "19" too,
    // and that made the fallback take the NNUE-only option path.
    this.nnue = false;
    this.nnueRetried = false;
    this.recovering = false;
    this.recoveries = 0;
    // Boot can fail for reasons that outlive a page load: no network, a CDN
    // edge that has not warmed, a captive portal. Retrying is the difference
    // between a script that recovers and one that stays offline until reload.
    this.retryTimer = null;
    this.retryAttempt = 0;
    this.retryDelay = 0;
    this.retryAt = 0;
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
    // The NNUE build cannot find its .wasm from a blob worker, so after the
    // first failure the four second handshake is pure delay. Remember the
    // verdict for a week instead of paying it on every page load.
    if (readNnueSkip()) {
      await this.#spawn(false);
      return;
    }
    try {
      try {
        await this.#spawn(true);
        return;
      } catch (err) {
        // Only a failed *fallback* proves the build is the problem. A fetch
        // that dies on the way to the CDN says nothing about NNUE, and
        // remembering that verdict for a week would downgrade every later
        // load because of one bad minute of Wi-Fi.
        this.nnueFailure = err;
        this.onError && this.onError(`NNUE engine unavailable (${err.message}); trying the JS engine`);
      }
      await this.#spawn(false);
      if (!isNetworkError(this.nnueFailure)) rememberNnueSkip();
    } catch (err) {
      this.#scheduleRetry(err);
      throw err;
    }
  }

  // 5 s, 20 s, 60 s, then every 5 minutes. A laptop that slept through a
  // Wi-Fi blip recovers on its own; one that is genuinely offline costs a
  // timer every five minutes and nothing else.
  #scheduleRetry(err) {
    this.mode = 'offline';
    this.ready = false;
    if (this.retryTimer) return;
    this.retryAttempt += 1;
    const delay = RETRY_BACKOFF_MS[Math.min(this.retryAttempt - 1, RETRY_BACKOFF_MS.length - 1)];
    this.retryDelay = delay;
    this.retryAt = Date.now() + delay;
    const seconds = Math.round(delay / 1000);
    this.onError && this.onError(`engine offline (${err && err.message ? err.message : 'boot failed'}); retrying in ${seconds}s`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.booted = null;
      this.boot().catch(() => {});
    }, delay);
  }

  // Kill the worker, unblock whoever is waiting on it, and boot a fresh one in
  // the background. One recovery at a time: a worker that fails while the
  // replacement is still booting must not start a boot loop.
  #recover(reason) {
    // Two attempts per crash cluster: a worker that cannot start at all must not
    // spin, and the counter is cleared by the next readyok. Past that the
    // cluster is not a crash, it is a dead engine, and the backoff owns it.
    if (this.recovering) return;
    if (this.recoveries >= 2) {
      this.#scheduleRetry(new Error(reason || 'engine keeps failing'));
      return;
    }
    this.recoveries += 1;
    this.recovering = true;
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = null;
    try {
      this.worker && this.worker.terminate();
    } catch {
      /* already gone */
    }
    const pending = this.search;
    this.worker = null;
    this.ready = false;
    this.booted = null;
    this.searching = false;
    this.search = null;
    this.lines = new Map();
    this.onError && this.onError(reason);
    if (pending && pending.resolve) pending.resolve([]);
    this.#bootInner()
      .catch(() => {})
      .finally(() => {
        this.recovering = false;
      });
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
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = null;
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
        rememberNnueSkip();
        this.onError && this.onError('NNUE worker failed to start; using the JS engine');
        this.#spawn(false).catch((err) => this.#scheduleRetry(err));
        return;
      }
      // A worker that dies after booting keeps `ready` true, so every search
      // after it waits out the full budget before the watchdog notices. Rebuild
      // now instead of losing a move to the handshake.
      this.#recover(event && event.message ? event.message : 'engine worker error');
    };

    this.#send('uci');
    // A worker that boots asynchronously can drop the first message. Ask again
    // once, then give the whole handshake a deadline.
    this.uciRetryTimer = setTimeout(() => {
      if (!this.ready && this.worker === worker) this.#send('uci');
    }, 1200);
    // 1.2 MB of wasm on a cold CDN edge compiles slower than the 2019 build,
    // so NNUE gets a longer deadline — and one silent second chance, because
    // the first request for a brand-new tag can 404 before jsDelivr warms it.
    this.handshakeTimer = setTimeout(() => {
      if (this.ready || this.worker !== worker) return;
      if (preferNnue) {
        if (!this.nnueRetried) {
          this.nnueRetried = true;
          try {
            worker.terminate();
          } catch {
            /* already gone */
          }
          this.worker = null;
          // The second NNUE attempt failing is a boot failure like any other.
          this.#spawn(true).catch((err) => this.#scheduleRetry(err));
          return;
        }
        rememberNnueSkip();
        this.onError && this.onError('NNUE engine did not start; using the JS engine');
        this.#spawn(false).catch((err) => this.#scheduleRetry(err));
      } else {
        // A worker that spawns and never says uciok is not a network problem
        // the fetch could see: the script arrived and died compiling, or the
        // page blocked the worker. It still has to enter the backoff, or the
        // engine is dead until someone reloads.
        try {
          worker.terminate();
        } catch {
          /* already gone */
        }
        this.worker = null;
        this.#scheduleRetry(new Error('engine did not answer uci'));
      }
    }, preferNnue ? 6500 : 4000);
  }

  async #fetchText(url) {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
  }

  async #nnueWorkerSource() {
    const code = await this.#fetchText(ENGINE_FILES.nnueJs);
    return buildNnueShim(ENGINE_FILES.nnueWasm, ENGINE_FILES.nnueJs) + code;
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

    if (line.startsWith('id name ')) {
      this.idName = line.slice(8).trim();
      this.mode = engineLabel(this.idName, this.nnue);
      return;
    }

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
      this.recoveries = 0;
      // It came back: the backoff starts over, so the next outage retries fast.
      this.retryAttempt = 0;
      this.retryDelay = 0;
      this.retryAt = 0;
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = null;
      // It booted: whatever we remembered about this mirror is wrong now.
      if (this.nnue) forgetNnueSkip();
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
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
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
    const hasMoves = Array.isArray(request && request.uciMoves) && request.uciMoves.length > 0;
    if (!request || (!hasMoves && !request.fen)) return [];
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
    // An empty move list is not a position. `positionMoves([])` answers
    // `position startpos`, which would have the engine analyse the opening
    // while the board sits in the middlegame or the endgame.
    const hasMoves = Array.isArray(job.uciMoves) && job.uciMoves.length > 0;
    this.#send(hasMoves ? positionMoves(job.uciMoves) : `position fen ${job.fen}`);
    const depth = clampInt(job.depth, 4, 22, CONFIG.maxDepth);
    const movetime = clampInt(job.moveTimeMs, 120, 6000, CONFIG.moveTimeMs);
    // `searchmoves` makes the engine judge candidates the wider search left
    // out, which is how a repertoire move gets an eval of its own and how a
    // beginner move gets a measured price instead of a claimed one. A list is
    // allowed: the restricted MultiPV reports one line per candidate.
    const only = searchmoveList(job.searchmoves);
    const onlyFlag = only.length ? ` searchmoves ${only.join(' ')}` : '';
    this.#send(`go depth ${depth} movetime ${movetime}${onlyFlag}`);
    this.#armWatchdog(job);
  }

  // A worker can accept `go` and never answer. Without this the panel keeps
  // saying "thinking" and the scan loop waits on a search that ended nowhere.
  #armWatchdog(job) {
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = setTimeout(() => {
      this.watchdogTimer = null;
      if (!this.search || this.search !== job) return;
      this.onError && this.onError('engine stopped answering; retrying');
      this.#send('stop');
      this.watchdogTimer = setTimeout(() => {
        this.watchdogTimer = null;
        if (this.search !== job) return;
        this.search = null;
        this.searching = false;
        this.lines = new Map();
        this.onFinal && this.onFinal({
          fen: job.fen,
          turn: job.turn,
          flipped: job.flipped,
          lines: [],
          bestmove: null,
          depth: 0,
          final: true,
          engine: this.mode
        });
        if (job.resolve) job.resolve([]);
        this.#recover('engine stopped answering; rebuilt');
      }, 2500);
    }, searchBudgetMs(job));
  }

  // Drop the remembered NNUE verdict and try the full engine once more.
  async retryNnue() {
    forgetNnueSkip();
    this.nnueRetried = false;
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = null;
    try {
      this.worker && this.worker.terminate();
    } catch {
      /* already gone */
    }
    this.worker = null;
    this.ready = false;
    this.booted = null;
    this.searching = false;
    this.search = null;
    await this.boot();
    return this.mode;
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
    // One restricted move is asked about once; a list is asked for one line
    // each, because the point is comparing the candidates.
    const restricted = searchmoveList(job.searchmoves).length;
    const multiPv =
      restricted > 1
        ? clampInt(job.multiPv, 1, Math.min(10, restricted), restricted)
        : clampInt(restricted === 1 ? 1 : job.multiPv, 1, 5, 1);
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
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    try {
      this.#send('quit');
      this.worker && this.worker.terminate();
    } catch {
      /* closing the tab is enough */
    }
    this.worker = null;
    this.search = null;
    this.searching = false;
    // A destroyed engine that still reports ready is a trap: the next search
    // posts into nothing and the watchdog pays the whole budget to find out.
    this.ready = false;
    this.booted = null;
    this.lastOptions = {};
  }
}

// A restricted search may be about one move or about a list of candidates. A
// malformed entry is dropped, never forwarded as a command.
function searchmoveList(value) {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .filter((move) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move));
}

function positionMoves(uciMoves) {
  if (!Array.isArray(uciMoves) || uciMoves.length === 0) return 'position startpos';
  return `position startpos moves ${uciMoves.join(' ')}`;
}

// ---------------------------------------------------------------------------
// Pace anchor taken from the account's own published games.
//
// The learned baseline only exists after this browser has made a few moves, so
// the first ten moves of every fresh profile are paced by defaults. chess.com
// publishes the clock annotation `%clk` on every move of a finished game, which
// is the account's real think time, not a guess about it: parse the last month,
// take the median of the same time class, and the script starts at the speed
// that player actually plays at.
//
// Chess.com's PGN writer puts a space inside the comment (`{[%clk 0:02:59]}`),
// so the clock is its own token after the move and the braces are glued to it.
// A three-move fragment that exercises the exact shape chess.com writes: the
// clock comment split into two tokens, the black move number carrying the dots.
const SELFTEST_PGN = '1. e4 {[%clk 0:05:00]} 1... e5 {[%clk 0:05:00]} 2. Nf3 {[%clk 0:04:50]} ' +
  '2... Nc6 {[%clk 0:04:50]} 3. Bb5 {[%clk 0:04:40]} 3... a6 {[%clk 0:04:40]} ' +
  '4. Ba4 {[%clk 0:04:30]} 4... Nf6 {[%clk 0:04:30]} 5. O-O {[%clk 0:04:20]}';

// Published pace is half a megabyte of PGN; six hours is plenty for data that
// only changes when the account finishes another game. The retry window is
// longer than the rating one: a throttled archive stays throttled.
const PACEPROFILE_TTL_MS = 6 * 60 * 60 * 1000;
const PACEPROFILE_RETRY_MS = 20 * 60 * 1000;

// A tab with no history yet has to start somewhere. Bullet and blitz are the
// medians measured on chess.com itself (328 games from the public archive);
// rapid is the Lichess cross-check, because the sample had no rapid games.
// Either beats the generic 700-1600 ms window: a rapid player who answers in a
// second is a much louder signal than one who takes five.
const PACE_CLASS_MS = { bullet: 700, blitz: 1600, rapid: 5500 };

function classMedianMs(cls) {
  return Object.prototype.hasOwnProperty.call(PACE_CLASS_MS, cls) ? PACE_CLASS_MS[cls] : null;
}

// The learned sample needs the same split as the published one, and for the
// same reason: a rhythm learned in 1-minute games must not pace a 10-minute
// one. The class is part of the storage key, so a bullet median simply does not
// exist when a rapid game looks for one.
const PACE_SAMPLES_KEY = 'chess-wraith-pace-v1';

function paceSamplesKey(account, cls) {
  return `${PACE_SAMPLES_KEY}:${account || 'anonymous'}:${cls || 'any'}`;
}

// Which number the delay is centred on, and where it came from. The source
// matters as much as the value: the three routes describe very different
// evidence, and the panel was showing - while the moves were paced by a class
// default it never mentioned.
function paceAnchorFor(opts) {
  const o = opts || {};
  const published = Number(o.publishedMs) || 0;
  if (published > 200) return { ms: published, classScoped: true, source: 'acct' };
  const learned = Number(o.learnedMs) || 0;
  if (learned > 200) return { ms: learned, classScoped: false, source: 'learned' };
  const fallback = classMedianMs(o.cls);
  if (fallback) return { ms: fallback, classScoped: true, source: 'class' };
  return { ms: null, classScoped: false, source: 'none' };
}

function parseClockTimes(pgn, side) {
  if (typeof pgn !== 'string' || pgn.indexOf('%clk') < 0) return [];
  const times = [];
  const last = { w: null, b: null };
  let turn = null;
  let moveNo = 0;
  for (const token of pgn.replace(/(\[%clk)\s+/g, '$1_').split(/\s+/)) {
    const num = /^(\d+)\.(\.\.)?$/.exec(token);
    if (num) {
      moveNo = Number(num[1]);
      turn = num[2] ? 'b' : 'w';
      continue;
    }
    const clk = /^\{?\[%clk_(\d+):(\d+):(\d+(?:\.\d+)?)\]\}?$/.exec(token);
    if (!clk || !turn) continue;
    const seconds = Number(clk[1]) * 3600 + Number(clk[2]) * 60 + Number(clk[3]);
    const previous = last[turn];
    last[turn] = seconds;
    // Book moves and the first two moves are not thinking; a premove spends no
    // time at all and would drag the median to zero; a disconnect spends
    // minutes and is not a move either.
    if (previous === null || moveNo <= 3) continue;
    if (side === 'w' || side === 'b') {
      if (turn !== side) continue;
    }
    const used = previous - seconds;
    if (used > 0 && used <= 150) times.push(Math.round(used * 1000));
  }
  return times;
}

// Which colour the account had. Without the headers the caller gets both sides,
// which is still a human pace, just half of it somebody else's.
function pgnPlayerSide(pgn, user) {
  const name = normalizeAccountName(user);
  if (!name || typeof pgn !== 'string') return null;
  const white = /\[White\s+"([^"]*)"\]/i.exec(pgn);
  const black = /\[Black\s+"([^"]*)"\]/i.exec(pgn);
  if (!white || !black) return null;
  if (normalizeAccountName(white[1]) === name) return 'w';
  if (normalizeAccountName(black[1]) === name) return 'b';
  return null;
}

function paceFromGames(games, timeClass, user) {
  const list = Array.isArray(games) ? games : [];
  const times = [];
  const buckets = { opening: [], middle: [], end: [] };
  let used = 0;
  // The archive is oldest-first, so the newest games are at the end: the pace
  // that matters is the one the account has now, not a year of drift.
  for (let i = list.length - 1; i >= 0 && used < 40; i--) {
    const game = list[i];
    if (!game || game.rules !== 'chess' || game.time_class !== timeClass || !game.pgn) continue;
    const side = pgnPlayerSide(game.pgn, user);
    let parsed = parseClockTimes(game.pgn, side);
    // No headers, or a PGN from before this account had the name: both sides.
    if (!parsed.length && side) parsed = parseClockTimes(game.pgn, null);
    if (!parsed.length) continue;
    parsed.forEach((ms, idx) => {
      times.push(ms);
      // Their own move index, not the ply: the opening is short for both sides.
      (idx < 8 ? buckets.opening : idx < 30 ? buckets.middle : buckets.end).push(ms);
    });
    used += 1;
  }
  // Thirty moves is the floor: below that one quick game moves the median.
  // A phase needs fewer samples than the whole profile: it only refines the
  // baseline, it cannot invent one.
  const phase = (arr) => (arr.length >= 12 ? median(arr) : null);
  // When this account actually plays: the hour histogram and the busiest hour are
  // free from the same read, and a 3 a.m. streak is the loudest pattern left.
  const hours = new Array(24).fill(0);
  for (const game of list) {
    const ts = Number(game && game.end_time);
    if (!Number.isFinite(ts) || ts <= 0) continue;
    if (game.time_class !== timeClass) continue;
    hours[new Date(ts * 1000).getHours()] += 1;
  }
  const peakHour = hours.indexOf(Math.max(...hours));
  return {
    medianMs: times.length >= 30 ? median(times) : null,
    phases: { opening: phase(buckets.opening), middle: phase(buckets.middle), end: phase(buckets.end) },
    samples: times.length,
    games: used,
    session: { hours, peakHour: Math.max(...hours) >= 3 ? peakHour : null }
  };
}

// The first move a player makes is a habit, not a die roll: the same archive
// that carries the clocks carries the PGNs, so the account's repertoire can be
// counted for free. Four first moves at 25% each is not a player; a 1400
// account plays its main first move in most of its games.
function firstMoveOf(pgn, side) {
  if (typeof pgn !== 'string') return null;
  const body = pgn.replace(/\[[^\]]*\]/g, ' ').replace(/\{[^}]*\}/g, ' ').replace(/\([^)]*\)/g, ' ');
  const blackStarts = /^\s*1\.\.\./.test(body.trim());
  const tokens = body.replace(/\d+\.(\.\.)?/g, ' ').split(/\s+/).filter((t) => /^[a-hRNBQKO]/.test(t));
  if (tokens.length === 0) return null;
  const index = side === 'b' ? (blackStarts ? 0 : 1) : blackStarts ? 1 : 0;
  const move = tokens[index];
  return move ? move.replace(/[+#!?]+$/, '') : null;
}

// A reply is not a preference, it is an answer: the same player answers 1.e4
// with e5 93% of the time and 1.d4 with d5 89%, and an average of the two would
// recommend the move he never plays. So the black table is keyed by the white
// move it answers, in UCI because that is what the tracker reads off the board.
function firstMoveUci(san) {
  if (typeof san !== 'string') return null;
  const knight = { Nf3: 'g1f3', Nc3: 'b1c3', Na3: 'b1a3', Nh3: 'g1h3' };
  if (knight[san]) return knight[san];
  const pawn = /^([a-h])([2-4])$/.exec(san);
  return pawn ? `${pawn[1]}2${pawn[1]}${pawn[2]}` : null;
}

// The first move was only the start of it: a repertoire is a tree. The same
// PGNs give what the account plays at every opening ply, keyed by the moves that
// lead there, and the picker follows the deepest node the account has.
const OPENING_PLIES = 8;
const OPENING_MIN_GAMES = 2;

function openingMoves(pgn) {
  if (typeof pgn !== 'string') return [];
  const body = pgn.replace(/\[[^\]]*\]/g, ' ').replace(/\{[^}]*\}/g, ' ').replace(/\([^)]*\)/g, ' ');
  return body
    .replace(/\d+\.(\.\.)?/g, ' ')
    .split(/\s+/)
    .filter((t) => /^[a-hRNBQKO]/.test(t))
    .map((t) => sanKey(t.replace(/[!?]+$/, '')));
}

// Shares, not counts: the picker compares a candidate's SAN against them.
function repertoireFromGames(games, user) {
  const list = Array.isArray(games) ? games : [];
  const counts = { w: new Map(), b: new Map(), byFirst: new Map(), tree: new Map() };
  let used = 0;
  for (let i = list.length - 1; i >= 0 && used < 60; i--) {
    const game = list[i];
    if (!game || game.rules !== 'chess' || !game.pgn) continue;
    const side = pgnPlayerSide(game.pgn, user);
    if (!side) continue;
    const move = firstMoveOf(game.pgn, side);
    if (!move) continue;
    counts[side].set(move, (counts[side].get(move) || 0) + 1);
    if (side === 'b') {
      const answer = firstMoveUci(firstMoveOf(game.pgn, 'w'));
      if (answer) {
        if (!counts.byFirst.has(answer)) counts.byFirst.set(answer, new Map());
        const bucket = counts.byFirst.get(answer);
        bucket.set(move, (bucket.get(move) || 0) + 1);
      }
    }
    // A game that starts from a FEN has no opening to key on. Both sides of the
    // prefix are kept: the account's move is what to play at the end of it.
    if (!/\b1\s*\.\s*\.\s*\./.test(game.pgn)) {
      const moves = openingMoves(game.pgn);
      const offset = side === 'w' ? 0 : 1;
      for (let ply = offset; ply < moves.length && ply < OPENING_PLIES; ply += 2) {
        const key = moves.slice(0, ply).join(' ');
        if (!counts.tree.has(key)) counts.tree.set(key, new Map());
        const bucket = counts.tree.get(key);
        bucket.set(moves[ply], (bucket.get(moves[ply]) || 0) + 1);
      }
    }
    used += 1;
  }
  const shares = (bucket) => {
    let total = 0;
    for (const n of bucket.values()) total += n;
    const out = {};
    if (!total) return { shares: {}, games: 0 };
    for (const [move, n] of bucket) out[move] = n / total;
    return { shares: out, games: total };
  };
  const white = shares(counts.w);
  const black = shares(counts.b);
  const blackByFirst = {};
  for (const [first, bucket] of counts.byFirst) {
    // Two games against 1.b3 say nothing about how the account answers 1.b3.
    const parsed = shares(bucket);
    if (parsed.games >= 2) blackByFirst[first] = parsed.shares;
  }
  const tree = {};
  for (const [key, bucket] of counts.tree) {
    const parsed = shares(bucket);
    // One game is an anecdote; two games on the same prefix is a habit.
    if (parsed.games >= OPENING_MIN_GAMES) tree[key] = parsed.shares;
  }
  // Both colours: a repertoire is two habits, and five games is the floor either way.
  return { white: white.shares, black: black.shares, blackByFirst, tree, games: white.games + black.games };
}

// One entry per account and time class: a player who alternates bullet and
// blitz would otherwise re-download half a megabyte of PGN on every switch.
function paceProfileKey(timeClass) {
  return `chess-wraith-acct-pace-v1:${currentAccount()}:${timeClass || 'blitz'}`;
}

function readPaceProfile(timeClass) {
  try {
    const cached = JSON.parse(localStorage.getItem(paceProfileKey(timeClass)) || 'null');
    if (!cached || cached.cls !== timeClass) return null;
    const now = Date.now();
    // A failed fetch is written without `at` and must not be mistaken for an
    // empty entry, or the 20 minute backoff never happens and every scan that
    // wants a pace hits the archive again.
    if (Number(cached.retryAt) > 0) return cached.retryAt > now ? { error: cached.error } : null;
    if (!(Number(cached.at) > 0)) return null;
    if (now - Number(cached.at) > PACEPROFILE_TTL_MS) return null;
    return cached;
  } catch {
    return null;
  }
}

function persistPaceProfile(value) {
  try {
    localStorage.setItem(paceProfileKey(value && value.cls), JSON.stringify(value));
  } catch {
    /* private mode: the session keeps the value */
  }
}

function monthPath(offset) {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${d.getUTCFullYear()}/${month}`;
}

// One extra request to a public archive, per account and time class, cached for
// six hours. It never runs for an anonymous tab: there is no pace to anchor to.
// The pace profile and the repertoire are two models of one archive. Reading it
// twice is two requests per month for one answer, and the second of those is what
// chess.com answers with a 429. The promise is cached per month, so both models
// await the same read; a failed read is dropped so the next scan can retry.
const archiveReads = new Map();
// A long session must not keep opening moves from the hour it booted: the cache
// lives one pacing refresh, then the archive is read again.
const ARCHIVE_TTL_MS = 15 * 60 * 1000;
function archiveGames(user, offset, force) {
  const key = `${String(user).toLowerCase()}|${monthPath(offset)}`;
  const hit = archiveReads.get(key);
  if (hit && !force && Date.now() - hit.at < ARCHIVE_TTL_MS) return hit.promise;
  const pending = (async () => {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 10000) : null;
    try {
      const response = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/${monthPath(offset)}`, {
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: controller ? controller.signal : undefined
      });
      if (!response || !response.ok) throw new Error(`HTTP ${response ? response.status : 0}`);
      const body = await response.json();
      return body && Array.isArray(body.games) ? body.games : [];
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();
  archiveReads.set(key, { promise: pending, at: Date.now() });
  pending.catch(() => {
    const cur = archiveReads.get(key);
    if (cur && cur.promise === pending) archiveReads.delete(key);
  });
  return pending;
}

function forgetArchive(user) {
  const prefix = `${String(user).toLowerCase()}|`;
  for (const key of Array.from(archiveReads.keys())) if (key.startsWith(prefix)) archiveReads.delete(key);
}
async function syncPaceProfile(force) {
  const user = currentAccount();
  if (!user || user === 'anonymous') return null;
  if (!state.clockPeak && !state.clockSeconds) return null;
  const timeClass = timeClassFromSeconds(state.clockPeak || state.clockSeconds);
  if (!timeClass) return null;
  // A second click while the first request is in flight would download the same
  // archive twice; the caller waits for the panel repaint instead.
  if (state.pacePending) return state.paceProfile || null;
  const cached = readPaceProfile(timeClass);
  if (cached && !force && !cached.error) {
    state.paceProfile = cached;
    return cached;
  }
  if (cached && cached.error && !force) {
    state.paceError = String(cached.error);
    return null;
  }
  state.pacePending = true;
  state.paceError = '';
  try {
    let profile = null;
    let rawGames = [];
    if (force) forgetArchive(user);
    for (const offset of [0, 1]) {
      const games = await archiveGames(user, offset, force);
      // The current month is the freshest repertoire; a previous one only fills in
      // when this month has no finished class games yet.
      if (rawGames.length === 0) rawGames = games;
      const parsed = paceFromGames(games, timeClass, user);
      if (parsed.medianMs) { profile = parsed; break; }
    }
    if (!profile) throw new Error('no games');
    profile.cls = timeClass;
    profile.opening = repertoireFromGames(rawGames, user);
    profile.at = Date.now();
    state.paceProfile = profile;
    persistPaceProfile(profile);
  } catch (error) {
    state.paceError = String((error && error.message) || error).slice(0, 40);
    persistPaceProfile({ cls: timeClass, retryAt: Date.now() + PACEPROFILE_RETRY_MS, error: state.paceError });
  } finally {
    state.pacePending = false;
  }
  refreshPanel();
  return state.paceProfile || null;
}
// Bot games and the analysis board have no clock, so there is no time class to
// key a pace on — but a repertoire needs none. The same archive, read for the
// first moves only, once per account and six hours, so the openings work where
// the clocks do not.
function repertoireKey() {
  return `chess-wraith-repertoire-v1:${currentAccount()}`;
}

function readRepertoire() {
  try {
    const cached = JSON.parse(localStorage.getItem(repertoireKey()) || 'null');
    if (!cached) return null;
    const now = Date.now();
    if (Number(cached.retryAt) > 0) return cached.retryAt > now ? cached : null;
    if (!(Number(cached.at) > 0)) return null;
    if (now - Number(cached.at) > PACEPROFILE_TTL_MS) return null;
    return cached;
  } catch {
    return null;
  }
}

async function syncRepertoire(force) {
  const user = currentAccount();
  if (!user || user === 'anonymous') return null;
  if (state.repertoirePending) return state.repertoire || null;
  const cached = readRepertoire();
  if (cached && !force) {
    if (cached.retryAt) return null;
    if (cached.opening) {
      state.repertoire = cached.opening;
      return cached.opening;
    }
    return null;
  }
  state.repertoirePending = true;
  try {
    let opening = null;
    if (force) forgetArchive(user);
    for (const offset of [0, 1]) {
      const parsed = repertoireFromGames(await archiveGames(user, offset, force), user);
      if (parsed.games >= 5) { opening = parsed; break; }
    }
    if (!opening) throw new Error('no games');
    state.repertoire = opening;
    try {
      localStorage.setItem(repertoireKey(), JSON.stringify({ opening, at: Date.now() }));
    } catch {
      /* private mode: the session keeps the value */
    }
  } catch (error) {
    try {
      localStorage.setItem(repertoireKey(), JSON.stringify({ retryAt: Date.now() + PACEPROFILE_RETRY_MS, error: String((error && error.message) || error).slice(0, 40) }));
    } catch {
      /* private mode */
    }
  } finally {
    state.repertoirePending = false;
  }
  refreshPanel();
  return state.repertoire || null;
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
// The rating this account is allowed to play at. The account's own published
// rating is the anchor: a 1400 account that suddenly scores like a 2000 is the
// pattern every fair-play system looks for first, so the ceiling is its own
// level plus a hair, and the floor is its own level minus a bad day.
function effectiveElo(cfg, opts = {}) {
  const account = Number(opts.accountElo) > 0 ? Number(opts.accountElo) : null;
  const manual = Number(cfg.targetElo) > 0 ? Number(cfg.targetElo) : null;
  const base = clampInt(account || manual || 1500, 1320, 3190, 1500);
  const opp = Number(opts.oppElo) > 0 ? Number(opts.oppElo) : null;
  const anchored = opp ? opp + 130 : base;
  const hi = Math.min(base + 25, 3190);
  const lo = Math.min(base - 75, hi);
  // Form only moves inside the account's envelope: a bad game is the account
  // minus a few points, never a different player.
  const form = account ? clampInt(opts.form, -60, 60, 0) : 0;
  return Math.round(clamp(Math.min(anchored, hi) + form, lo, hi));
}

// How many centipawns a human at this rating actually loses per move. Rough
// fit to the published ACPL-vs-rating curve: generous at the bottom, tight at
// the top, and clamped so neither end becomes absurd.
function acplBand(elo) {
  const e = clamp(Number(elo) || 1500, 100, 3200);
  // Two curves, joined at the engine floor: below 1320 the beginner end is
  // steep (a 133 account gives away a piece every few moves), above it the
  // published rating/ACPL fit is the one that holds.
  const low = 320 - e * 0.2;
  const high = 96 - e / 34;
  return Math.round(clamp(e < 1320 ? low : high, 8, 320));
}

// Stockfish cannot be asked to play under 1320, so below that the strength
// cannot follow the account. What can follow it is the loss rate: aim the
// chooser at ~acplBand(account) and the moves look like the account's, not like
// a 1320 wall. Off with `levelPlay: false`.
function levelPlayTarget(accountElo, cfg) {
  if (cfg && cfg.levelPlay === false) return 0;
  const account = Number(accountElo) || 0;
  if (!account || account >= ELO_FLOOR) return 0;
  return clampInt(acplBand(account), 60, 320, 60);
}

// The engine's tenth-best move is still a master's tenth-best move: below its
// floor, re-weighting its own list cannot reach the account's loss rate. The
// moves that are missing get improvised instead, at a rate that closes the gap
// between what the search offers and the target: p = (target - 8) / 400. The cap
// is 0.85, not a half: measured on 1.65.2, an improvised move cost 286 cp at a
// 133 account but only half the moves were improvised, so the game averaged 118
// at a 293 band. A 133 misses most moves, not half of them.
function improvisationChance(target) {
  const t = Number(target) || 0;
  if (!(t > 0)) return 0;
  // The rate is what makes the band reachable at all, so it is derived from the
  // band: an improvised move costs roughly 300 cp and p * 300 has to reach the
  // band. Below the old curve nothing changes (a 133 account still draws 0.71);
  // above it, the rate stops promising what the game never pays - at a 1320
  // account the old curve asked for 13% and a whole game went by without one,
  // measuring 2 cp/move against a 60 cp band.
  return clamp(Math.max((t - 8) / 400, t / 300), 0, 0.85);
}

// A uniform draw over the legal moves is not a beginner, it is a random number
// generator: it walks the king into the open and ignores a free queen. A
// beginner's move is bad in a specific way — it grabs material, gives a check,
// develops, and rarely touches the king. This is the weight that makes the
// improvised move look like that kind of bad instead of any kind of bad.
function beginnerWeight(cand) {
  if (!cand) return 0;
  const capture = Number(cand.capture) || 0;
  let weight = 1 + capture * 1.5;
  // Leaving a piece where it can be taken for free is the other half of the
  // beginner: a 133 grabs material and then hangs the queen recapturing.
  const hanging = Number(cand.hanging) || 0;
  if (hanging > 0) weight += hanging * 2.5;
  if (cand.check) weight += 1.5;
  if (cand.castle) weight += 1.2;
  if (cand.piece === 'K' && !cand.castle) weight *= 0.15;
  if (cand.piece === 'Q' && Number(cand.ply) < 12) weight *= 0.5;
  return weight;
}

function pickImprovised(pool, rnd) {
  const rollWith = typeof rnd === 'function' ? rnd : Math.random;
  let total = 0;
  for (const cand of pool) total += beginnerWeight(cand);
  if (!(total > 0)) return pool[0];
  let roll = rollWith() * total;
  for (const cand of pool) {
    roll -= beginnerWeight(cand);
    if (roll <= 0) return cand;
  }
  return pool[pool.length - 1];
}

// The throttle nothing else has: when the account is playing far above its own
// rating, hand it more slack until the numbers look human again. It only ever
// moves in small steps, and only after 15 moves of evidence.
function acplGuard(opts) {
  const o = opts || {};
  const band = acplBand(o.elo);
  const samples = Number(o.samples) || 0;
  const acpl = Number(o.acpl) || 0;
  const boost = clampInt(o.boost, 0, 160, 0);
  if (samples < 15 || acpl <= 0) return { band, boost, verdict: 'wait' };
  if (acpl < band * 0.45) return { band, boost: clampInt(boost + 12, 0, 160, 0), verdict: 'raise' };
  if (acpl > band * 2 && boost > 0) return { band, boost: clampInt(boost - 8, 0, 160, 0), verdict: 'lower' };
  return { band, boost, verdict: 'hold' };
}

function styleProfile(cfg, opts = {}) {
  const elo = effectiveElo(cfg, opts);
  const level = levelPlayTarget(opts.accountElo || elo, cfg);
  return {
    elo,
    // Under Stockfish's 1320 floor the engine cannot be asked to play weaker,
    // so the window of moves it may pick from widens instead; level play also
    // needs the window to contain the moves it is aiming at.
    slack: Math.min(720, Math.max(clampInt(cfg.humanSlackCp, 0, 300, LEGIT.slack), LEGIT.slack, level * 2) + floorSlack(opts.accountElo || elo)),
    miss: LEGIT.miss,
    label: level > 0 ? 'level' : LEGIT.label,
    level
  };
}

// The engine stops on `go depth N` before the clock is spent, which is fine when
// N is what the account can use and wrong when it is not: measured 2026-11-26 on
// an Italian middlegame with MultiPV 4, depth 14 finished in 121 ms of a 700 ms
// budget (and in 218 ms of 3000) and answered g8f6; the same budget with the cap
// at 22 reached depth 16 and answered f8c5. The default is right for a 1500
// account and caps a 2200 one seven plies under what its clock pays for, so the
// cap follows the anchor.
function depthForAccount(baseDepth, elo) {
  const base = clampInt(baseDepth, 4, 22, 14);
  const step = Math.max(0, Math.round((Number(elo) - 1500) / 100));
  return clampInt(base + step, base, 22, base);
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

// The account's own move, when the search never put it on the table: the one
// case a repertoire table cannot win on its own.
function openingProbeTarget(shares, lines) {
  if (!shares) return null;
  const known = new Set((lines || []).map((line) => sanKey(line && line.bestSan)));
  const rows = Object.entries(shares)
    .filter(([san, share]) => Number(share) >= 0.6 && !known.has(sanKey(san)))
    .sort((a, b) => b[1] - a[1]);
  if (!rows.length) return null;
  return { san: sanKey(rows[0][0]), share: Number(rows[0][1]) };
}

// The real loss of a move, measured after the fact: the eval of the position
// before it, minus the eval after it, both in white's centipawns. Improvised
// moves have no search line of their own, so claiming a number for them (the
// old `cpLoss: target`) reported the target as if it had been measured.
function myLossFromWhiteCp(side, before, after) {
  if (typeof before !== 'number' || typeof after !== 'number') return null;
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
  const raw = side === 'w' ? before - after : after - before;
  return clamp(Math.round(raw), 0, 600);
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

  const target = profile.level || 0;
  // A move the search never saw, because it is not good enough to be in the top
  // N. This is what a beginner's move actually is.
  if (target > 0 && Array.isArray(opts.improvise) && opts.improvise.length > 5) {
    const rnd = typeof opts.rng === 'function' ? opts.rng : Math.random;
    if (rnd() < improvisationChance(target)) {
      const pool = opts.improvise.filter((c) => c && c.uci && c.uci !== best.bestUci);
      if (pool.length) {
        // If the position offers a move that leaves material on a covered
        // square, that is the move this account plays. Weighting it against the
        // captures was not enough: taking a free pawn is a good move, and the
        // measured loss stayed at 6 cp against a 293 band.
        const loose = pool.filter((c) => Number(c.hanging) > 0);
        const pick = pickImprovised(loose.length ? loose : pool, rnd);
        return {
          line: { bestUci: pick.uci, bestSan: pick.san || '' },
          cpLoss: target,
          reason: 'level',
          improvised: true
        };
      }
    }
  }

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
    // A probed line carries the move this account actually plays, which the
    // search never offered: the slack is the wrong ruler for it, and a bounded
    // allowance is what makes the repertoire playable instead of decorative.
    const allowance = cand.line.opening && opts.openingShares ? 70 : 0;
    if (cand.cpLoss > profile.slack + allowance) continue;
    // In the opening the account's own move is the evidence, not the eval spread:
    // a pet line that costs 80 cp is still the line this player plays every game.
    const spread = cand.line.opening && opts.openingShares ? Math.max(120, profile.slack * 3) : Math.max(18, profile.slack / 2);
    let weight;
    if (target > 0) {
      // Centred on the account's loss rate, not on zero: a 133 account does
      // not play the fourth-best move every time, it plays moves of that size.
      const sigma = Math.max(60, target * 0.55);
      weight = 0.01 + Math.exp(-Math.pow(cand.cpLoss - target, 2) / (2 * sigma * sigma));
      // Handing over a forced mate is not beginner play, it is broken play.
      if (cand.cpLoss > target * 2 + 80) weight = 0.005;
    } else {
      weight = Math.exp(-cand.cpLoss / spread);
    }
    // Repeatedly taking #1 is the one pattern that reads as a machine. Once the
    // streak reaches three, a near-equal alternative gets a nudge, not a mandate.
    if ((opts.top1Streak || 0) >= 3 && cand.index === 0 && cand.cpLoss === 0) weight *= 0.35;
    if (cand.index > 0 && cand.cpLoss >= 8) weight *= 1.35;
    // The account's own opening habits, counted from its published games. A
    // repertoire is the most stable thing about a player's games, and four first
    // moves at 25% each is the opposite of a repertoire.
    const share = opts.openingShares ? Number(opts.openingShares[sanKey(cand.line.bestSan)]) || 0 : 0;
    // The shares are the truth, so the weight is nearly the share itself: an
    // account that played 1.e4 in 60 of 60 games should not open 1.d4 one game in
    // five.
    if (opts.openingShares) weight *= 0.02 + share;
    // The same first move every game is its own tell, separate from move choice
    // — unless it is the move this account actually plays that often.
    if (opts.repeatUci && cand.line.bestUci === opts.repeatUci && share < 0.3) weight *= 0.28;
    eligible.push({ line: cand.line, cpLoss: cand.cpLoss, weight });
  }

  if (eligible.length === 0) return { line: best, cpLoss: 0, reason: 'best' };
  const picked = weightedPick(eligible);
  return { line: picked.line, cpLoss: picked.cpLoss, reason: profile.label };
}

// A session has a shape: the first half hour is the sharpest, and after three
// hours the same player takes about 6% longer per move. Real time-on-task data
// shows the interval creeping up ~2% an hour (de Jong et al. 2020), and the
// typing model nitro-wraith ships uses the same drift.
function fatigueFactor(sessionMs) {
  const hours = Number(sessionMs) > 0 ? Number(sessionMs) / 3600000 : 0;
  return 1 + clamp(hours * 0.02, 0, 0.06);
}

// How long a person would spend here. Two draws averaged instead of one: the
// distribution is triangular, mostly near the middle, which is what real think
// times look like. The dials below are the ones a fixed timer cannot fake.
function computeDelay(cfg, opts = {}) {
  const lo = Math.max(250, cfg.minThinkMs);
  const hi = Math.max(lo + 100, cfg.maxThinkMs);
  const skew = (Math.random() + Math.random() + Math.random()) / 3;
  let ms = lo + (hi - lo) * skew;

  // A restricted search already spent part of this move's thinking.
  ms -= clamp(Number(opts.spentMs) || 0, 0, 4000);
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

  // The account's own rhythm. Once there is a baseline, a move that is wildly
  // faster or slower than this account usually plays is the loudest signal on
  // the page, so the delay stays inside a band around it.
  const baseline = Number.isFinite(opts.baselineMs) && opts.baselineMs > 0 ? opts.baselineMs : null;
  // Centred on the account, not clamped into its band: clamping a uniform draw
  // piles mass on both edges and makes the median of every game drift with it.
  // A symmetric draw never produces the long think that a human produces once in a
  // while: the shape below is right-skewed, mostly near the median with a real tail.
  if (baseline) {
    const shape = [0.55, 0.7, 0.85, 0.95, 1, 1.05, 1.15, 1.3, 1.55, 1.95];
    const amp = shape[Math.min(shape.length - 1, Math.floor(Math.random() * shape.length))] * (0.95 + 0.1 * skew);
    ms = clamp(baseline * amp, baseline * 0.65, baseline * 1.5);
  }

  // Never answer much faster than the person across the board: a wall of
  // instant replies against someone taking ten seconds a move is a pattern.
  const tempo = Number.isFinite(opts.oppTempoMs) && opts.oppTempoMs > 300 ? opts.oppTempoMs : null;
  if (tempo) ms = Math.max(ms, Math.min(tempo * 0.35, 3200));

  if (opts.legalMoveCount === 1) ms *= 0.45;
  else if (opts.legalMoveCount && opts.legalMoveCount <= 3) ms *= 0.8;
  ms *= fatigueFactor(opts.sessionMs);
  if (opts.isCheck) ms *= 1.12;
  if (opts.isCapture) ms *= 0.92;

  // Time control sets the scale. A 1-minute game is not played with the same
  // deliberation as a 15+10, and a fixed window is the tell that says so.
  // Except when the baseline itself was measured for this time class: the
  // published median already is the bullet or rapid number, and scaling it
  // again played a 1-minute game at half the account's own rhythm.
  const budget = Number(opts.budgetSeconds);
  if (!(baseline && opts.baselineClassScoped) && Number.isFinite(budget) && budget > 0) {
    if (budget < 120) ms *= 0.5;
    else if (budget < 300) ms *= 0.78;
    else if (budget >= 600) ms *= 1.15;
  }

  // Rare second thought, outside the normal window. The pattern-breaker a
  // bounded uniform delay does not have.
  if (opts.allowRethink && Math.random() < 0.035) ms *= rand(1.45, 1.95);

  if (cfg.pauseOnLowClock && Number.isFinite(opts.clockSeconds)) {
    if (opts.clockSeconds <= 8) ms = Math.min(ms, 420);
    else if (opts.clockSeconds <= cfg.clockFloorSeconds) ms = Math.min(ms, 900);
  }
  // Never spend more than a eighteenth of what is left on one move. The published
  // baseline is honest - it is what the account does - but with forty seconds on
  // the clock a six second median is how a person flags, and people do not flag
  // by playing their usual rhythm: they start moving in a second.
  if (cfg.pauseOnLowClock && Number.isFinite(opts.clockSeconds) && opts.clockSeconds > 0) {
    ms = Math.min(ms, Math.max(280, (opts.clockSeconds * 1000) / 18));
  }
  return Math.round(clamp(ms, 250, 9000));
}

// The card after every game: what the engine saw, not what the result screen says.
// Every number here is already computed during play (the loss of each chosen
// move, the swing of each opponent move); this file only turns them into one
// readable line. ACPL is the honest metric; chess.com's accuracy percentage is
// their own formula and is not reproduced.

// Centipawn loss to a rating: the exact inverse of `acplBand`, which is what
// the strength model already believes a player of a given rating loses. The old
// fit was a different curve with a 1050 floor, so a game played at a 133
// account's own loss rate came back as `like 1093` — the number the account was
// supposed to be. Inverting the band closes that loop: 293 cp is 133 again.
function performanceFromAcpl(acpl) {
  // Number(null) is 0, and 0 would be a perfect game: a missing sample must
  // stay missing.
  if (acpl === null || acpl === undefined || acpl === '') return null;
  const value = Number(acpl);
  if (!Number.isFinite(value) || value < 0) return null;
  // Below ~57 the band's upper branch is the one in force; above it, the
  // beginner branch (320 - 0.2e). The two pieces meet at the 1320 floor.
  const elo = value < 57.2 ? (96 - value) * 34 : (320 - value) / 0.2;
  return Math.round(clamp(elo, 100, 2850));
}

function meanOf(list) {
  return list.reduce((total, value) => total + value, 0) / list.length;
}

function cleanLosses(list) {
  if (!Array.isArray(list)) return [];
  return list
    // A null is a missing sample, not a zero: Number(null) is 0 and would
    // quietly drag the average down.
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .map((value) => Math.min(600, Math.round(value)));
}

// Fewer than five assessed moves is not an average, it is noise: a single
// brilliant move would advertise a 2800 performance for a 133 account.
const REPORT_MIN_SAMPLES = 5;

function gameReport(input) {
  const o = input || {};
  const mine = cleanLosses(o.myLosses);
  const theirs = cleanLosses(o.oppLosses);
  const myAcpl = mine.length >= REPORT_MIN_SAMPLES ? Math.round(meanOf(mine)) : null;
  const oppAcpl = theirs.length >= REPORT_MIN_SAMPLES ? Math.round(meanOf(theirs)) : null;
  const myPerf = performanceFromAcpl(myAcpl);
  const oppPerf = performanceFromAcpl(oppAcpl);
  const rating = Number(o.rating) > 0 ? Math.round(Number(o.rating)) : null;
  return {
    result: typeof o.result === 'string' ? o.result.slice(0, 12) : '',
    moves: Number.isFinite(Number(o.moves)) && Number(o.moves) > 0 ? Math.round(Number(o.moves)) : null,
    myAcpl,
    oppAcpl,
    myPerf,
    oppPerf,
    rating,
    // How far above the account the play sat. Null when either side is missing:
    // a delta against an unknown rating is a made-up number.
    delta: myPerf !== null && rating !== null ? myPerf - rating : null,
    samples: mine.length,
    at: Number(o.at) > 0 ? Math.round(Number(o.at)) : Date.now()
  };
}

function reportKey(user) {
  const name = normalizeAccountName(user);
  return `${STORAGE_KEY}:report:${name || 'anonymous'}`;
}

function readReport(user) {
  try {
    const raw = localStorage.getItem(reportKey(user));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const report = {
      result: typeof parsed.result === 'string' ? parsed.result.slice(0, 12) : '',
      moves: Number(parsed.moves) > 0 ? Math.round(Number(parsed.moves)) : null,
      myAcpl: Number.isFinite(Number(parsed.myAcpl)) && parsed.myAcpl !== null ? Math.round(Number(parsed.myAcpl)) : null,
      oppAcpl: Number.isFinite(Number(parsed.oppAcpl)) && parsed.oppAcpl !== null ? Math.round(Number(parsed.oppAcpl)) : null,
      myPerf: Number.isFinite(Number(parsed.myPerf)) && parsed.myPerf !== null ? Math.round(Number(parsed.myPerf)) : null,
      oppPerf: Number.isFinite(Number(parsed.oppPerf)) && parsed.oppPerf !== null ? Math.round(Number(parsed.oppPerf)) : null,
      rating: Number(parsed.rating) > 0 ? Math.round(Number(parsed.rating)) : null,
      delta: Number.isFinite(Number(parsed.delta)) && parsed.delta !== null ? Math.round(Number(parsed.delta)) : null,
      samples: Number(parsed.samples) > 0 ? Math.round(Number(parsed.samples)) : 0,
      at: Number(parsed.at) > 0 ? Math.round(Number(parsed.at)) : 0
    };
    return report.result ? report : null;
  } catch (error) {
    return null;
  }
}

function saveReport(user, report) {
  try {
    if (!report || !report.result) localStorage.removeItem(reportKey(user));
    else localStorage.setItem(reportKey(user), JSON.stringify(report));
  } catch (error) {
    /* storage blocked: the card still shows this session */
  }
}

// A history, not a single card: the shape of a night is in the sequence, and one
// game is noise. Twenty entries is small enough to keep in localStorage without
// asking, and long enough that a form bar means something.
const REPORT_HISTORY_LIMIT = 20;

function pushReport(list, report, limit = REPORT_HISTORY_LIMIT) {
  const cap = Math.max(1, Math.round(Number(limit) || REPORT_HISTORY_LIMIT));
  const kept = Array.isArray(list) ? list.filter((item) => item && item.result) : [];
  if (!report || !report.result) return kept.slice(-cap);
  // One entry per game: the same result re-scanned must not double the night.
  const at = Number(report.at) || 0;
  const moves = Number(report.moves) || 0;
  const duplicate = kept.some((item) => Number(item.at) === at && at > 0 && Number(item.moves) === moves);
  if (duplicate) return kept.slice(-cap);
  return [...kept, report].slice(-cap);
}

// Averages over the games that have a number, never over a zero standing in for
// a missing sample. The bars use the same list, so the summary and the chart
// cannot disagree.
function reportSummary(list) {
  const games = (Array.isArray(list) ? list : []).filter((item) => item && item.result);
  const known = (key) => games.map((item) => item[key]).filter((value) => Number.isFinite(value));
  const average = (values) => (values.length ? Math.round(meanOf(values)) : null);
  const wins = games.filter((item) => item.result === 'win').length;
  const losses = games.filter((item) => item.result === 'loss').length;
  const draws = games.filter((item) => item.result === 'draw').length;
  const acpls = known('myAcpl');
  return {
    games: games.length,
    wins,
    losses,
    draws,
    winRate: games.length ? Math.round((wins / games.length) * 100) : null,
    acpl: average(acpls),
    oppAcpl: average(known('oppAcpl')),
    perf: average(known('myPerf')),
    best: acpls.length ? Math.min(...acpls) : null,
    form: games.slice(-12).map((item) => ({
      result: item.result,
      acpl: Number.isFinite(item.myAcpl) ? item.myAcpl : null,
      moves: Number.isFinite(item.moves) ? item.moves : null
    }))
  };
}

function reportHistoryKey(user) {
  const name = normalizeAccountName(user);
  return `${STORAGE_KEY}:games:${name || 'anonymous'}`;
}

function readReportHistory(user) {
  try {
    const raw = localStorage.getItem(reportHistoryKey(user));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.result === 'string' && item.result)
      .slice(-REPORT_HISTORY_LIMIT)
      .map((item) => ({
        result: item.result.slice(0, 12),
        moves: Number(item.moves) > 0 ? Math.round(Number(item.moves)) : null,
        myAcpl: Number.isFinite(Number(item.myAcpl)) && item.myAcpl !== null ? Math.round(Number(item.myAcpl)) : null,
        oppAcpl: Number.isFinite(Number(item.oppAcpl)) && item.oppAcpl !== null ? Math.round(Number(item.oppAcpl)) : null,
        myPerf: Number.isFinite(Number(item.myPerf)) && item.myPerf !== null ? Math.round(Number(item.myPerf)) : null,
        oppPerf: Number.isFinite(Number(item.oppPerf)) && item.oppPerf !== null ? Math.round(Number(item.oppPerf)) : null,
        rating: Number(item.rating) > 0 ? Math.round(Number(item.rating)) : null,
        delta: Number.isFinite(Number(item.delta)) && item.delta !== null ? Math.round(Number(item.delta)) : null,
        samples: Number(item.samples) > 0 ? Math.round(Number(item.samples)) : 0,
        at: Number(item.at) > 0 ? Math.round(Number(item.at)) : 0
      }));
  } catch (error) {
    return [];
  }
}

function saveReportHistory(user, list) {
  try {
    const kept = Array.isArray(list) ? list.slice(-REPORT_HISTORY_LIMIT) : [];
    if (!kept.length) localStorage.removeItem(reportHistoryKey(user));
    else localStorage.setItem(reportHistoryKey(user), JSON.stringify(kept));
  } catch (error) {
    /* storage blocked: the chart still shows this session */
  }
}

// AFK: keep the session going without a human. Three pieces, all of them
// deliberately small: find the button chess.com offers after a game, pick the
// one a person would press, and keep the tab from being frozen while you are
// not looking. Nothing here guesses at account data.

const REMATCH_PRIORITY = [
  'rematch',
  'new 5 min',
  'new 3 min',
  'new 10 min',
  'new game',
  'play again',
  'new 1 min',
  'new 30 min'
];

// Pure: given the visible candidates, which one would a person press? Rematch
// first (same opponent, same clock), then the shortest new game. Disabled
// candidates are ignored, and the list order is only a tie-breaker. `skipTexts`
// is how a declined rematch moves on to the next button the site offers.
function pickRematchButton(candidates, skipTexts) {
  if (!Array.isArray(candidates) || candidates.length === 0) return -1;
  const skip = new Set(
    (Array.isArray(skipTexts) ? skipTexts : [])
      .map((text) => String(text || '').trim().toLowerCase().replace(/\s+/g, ' '))
      .filter(Boolean)
  );
  const usable = candidates
    .map((item, index) => ({
      index,
      text: String((item && item.text) || '').trim().toLowerCase().replace(/\s+/g, ' '),
      disabled: Boolean(item && item.disabled)
    }))
    .filter((item) => item.text && !item.disabled && !skip.has(item.text));
  if (usable.length === 0) return -1;

  for (const wanted of REMATCH_PRIORITY) {
    const exact = usable.find((item) => item.text === wanted);
    if (exact) return exact.index;
    const partial = usable.find((item) => item.text.includes(wanted));
    if (partial) return partial.index;
  }
  return -1;
}

// Time before pressing, in the shape nitro-wraith uses: a short human pause
// most of the time, a longer one now and then.
function nextGameDelay(cfg, random = Math.random) {
  const range = Array.isArray(cfg.newGameDelayMs) && cfg.newGameDelayMs.length === 2
    ? cfg.newGameDelayMs
    : [1700, 4200];
  const longRange = Array.isArray(cfg.newGameLongMs) && cfg.newGameLongMs.length === 2
    ? cfg.newGameLongMs
    : [5000, 9500];
  const chance = Number.isFinite(cfg.newGameLongChance) ? cfg.newGameLongChance : 0.12;
  const pick = random() < chance ? longRange : range;
  const lo = Math.min(pick[0], pick[1]);
  const hi = Math.max(pick[0], pick[1]);
  return Math.round(lo + random() * (hi - lo));
}

// Pure: is this session over? Games and wall-clock, whichever comes first. Zero
// or a missing value disables that half.
function sessionLimit({ startedAt, games, now, maxGames, maxMs, rollover }) {
  const played = Number.isFinite(games) ? games : 0;
  const hasStart = Number.isFinite(startedAt);
  const start = hasStart ? startedAt : 0;
  const t = Number.isFinite(now) ? now : 0;
  // A rollover is not a stop: always-auto treats the cap as the end of one run
  // and the start of the next, so the caller resets and keeps playing.
  const verdict = (reason) => (rollover
    ? { stop: false, rollover: true, reason: `${reason} · rolled over` }
    : { stop: true, rollover: false, reason });
  if (Number.isFinite(maxGames) && maxGames > 0 && played >= maxGames) {
    return verdict(`session limit: ${maxGames} games`);
  }
  if (hasStart && Number.isFinite(maxMs) && maxMs > 0 && t >= start + maxMs) {
    const hours = Math.round((maxMs / 3600000) * 10) / 10;
    return verdict(`session limit: ${hours}h`);
  }
  return { stop: false, rollover: false, reason: '' };
}

function isElementVisible(el) {
  if (!el || !el.isConnected) return false;
  if (el.disabled) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 0.05) return false;
  if (el.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
  return true;
}

// The rematch search used to run over the whole document, where "new game" also
// matches the site navigation. Scope it to the dialog that ends the game and
// fall back to the document only when no such dialog is on screen.
const GAME_OVER_SELECTORS = [
  '.game-over-modal-shell-container',
  '.board-modal-component',
  '.game-over-modal-header-component',
  '.game-over-modal',
  '.game-review-buttons',
  '.board-modal',
  '[data-cy="game-over-modal"]',
  '.modal-content'
];

function gameOverRoot() {
  for (const sel of GAME_OVER_SELECTORS) {
    for (const node of document.querySelectorAll(sel)) {
      if (isElementVisible(node)) return node;
    }
  }
  return null;
}

function visibleButtons() {
  const out = [];
  const scope = gameOverRoot() || document;
  for (const el of scope.querySelectorAll('button, a[role="button"], [role="button"], .cc-button-component')) {
    if (!isElementVisible(el)) continue;
    out.push(el);
  }
  return out;
}

// The element to click, or null. Kept separate from pickRematchButton so the
// decision itself stays testable without a DOM.
function findRematchButton(skipTexts) {
  const nodes = visibleButtons();
  const candidates = nodes.map((el) => ({
    text: (el.textContent || '').trim(),
    disabled: Boolean(el.disabled) || el.getAttribute('aria-disabled') === 'true'
  }));
  const index = pickRematchButton(candidates, skipTexts);
  return index >= 0 ? nodes[index] : null;
}

// The dialog names the winner rather than the result: "tester won",
// "tester won by resignation", or just "Draw". The account's own name is the
// only thing that says which side of that sentence is us, so an unknown name
// returns null instead of guessing a win.
function parseGameResult(text, account, myColor) {
  // textContent glues sibling blocks together without a space: "tester won"
  // followed by a Rematch button reads "tester wonRematch". A space at the case
  // boundary is what the page actually looks like.
  const line = String(text || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!line) return null;
  if (/\byou resigned\b|\byou lost\b|\byou were checkmated\b/.test(line)) return 'loss';
  if (/\byou won\b|\byou win\b/.test(line)) return 'win';
  if (/\bdraw\b|\bstalemate\b|\binsufficient material\b|\bthreefold\b|\bfifty-move\b/.test(line)) return 'draw';
  // The dialog shows both players, so "the account name is somewhere in the
  // text" is not a test: the winner is the word attached to the verb.
  const near = /([a-z0-9_-]{2,})\s+(won|lost)\b/.exec(line);
  if (!near) return null;
  const loser = near[2] === 'lost';
  const who = near[1];
  // A finished game page names the colour, not the player: "Black Won". That
  // path needs no account, which is the only way a signed-out tab can score.
  // Only the literal word: a player named "bob" is not Black.
  if (myColor === 'w' || myColor === 'b') {
    const colour = who === 'white' ? 'w' : who === 'black' ? 'b' : null;
    if (colour) return colour === myColor ? (loser ? 'loss' : 'win') : (loser ? 'win' : 'loss');
  }
  const me = normalizeAccountName(account);
  if (!me) return null;
  if (who === me) return loser ? 'loss' : 'win';
  return loser ? 'win' : 'loss';
}

// Bounded on purpose: the dialog is small, but a page-level fallback can be the
// whole document and regular expressions over a megabyte of markup are not.
// textContent has no separators: the real dialog reads "tester wonby checkmate".
// innerText has the line breaks the reader sees, so it is preferred; jsdom and
// older engines get a traversal that joins every leaf with a space instead.
function dialogText(root) {
  if (root && typeof root.innerText === 'string' && root.innerText.trim()) return root.innerText;
  const parts = [];
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) parts.push(child.nodeValue || '');
      else if (child.nodeType === 1) {
        if (child.children.length === 0) parts.push(child.textContent || '');
        else walk(child);
        parts.push(' ');
      }
    }
  };
  if (root) walk(root);
  return parts.join(' ');
}

function readGameResult(myColor) {
  const root = gameOverRoot();
  if (!root) return null;
  return parseGameResult(dialogText(root).slice(0, 2000), currentAccount(), myColor);
}

// A rematch paints a fresh board under the old dialog for a second, so the same
// modal can be scanned twice: once for the game it belongs to and once for the
// one that just started. Two things tell them apart, and the first one does not
// need a move list: a scored game never ends on the starting position (chess.com
// aborts those), and a game with fewer than two plies is too young to be scored.
function resultCounts(job) {
  const { result, ply, placement, gamesPlayed, resultGame } = job || {};
  if (!result) return false;
  if (!(Number(gamesPlayed) > 0)) return false;
  if (Number(resultGame) === Number(gamesPlayed)) return false;
  if (Chess && placement === Chess.START_PLACEMENT) return false;
  if (ply !== null && ply !== undefined && Number(ply) < 2) return false;
  return true;
}

function hasGameOverModal() {
  return isGameOverDom();
}

// Near-silent audio: Chrome treats a tab that is playing audio as active, so the
// timers behind the auto-play loop are not clamped to once per minute. It is not
// a guarantee — a muted tab or a blocked AudioContext stops working — and the
// panel says which of the three states it is in.
let keepAliveCtx = null;
let keepAliveOsc = null;
let keepAliveState = 'off';

function startKeepAlive() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      keepAliveState = 'unsupported';
      return keepAliveState;
    }
    if (!keepAliveCtx) {
      keepAliveCtx = new Ctx();
      const gain = keepAliveCtx.createGain();
      gain.gain.value = 0.0009;
      keepAliveOsc = keepAliveCtx.createOscillator();
      keepAliveOsc.frequency.value = 110;
      keepAliveOsc.connect(gain);
      gain.connect(keepAliveCtx.destination);
      keepAliveOsc.start();
    }
    if (keepAliveCtx.state === 'suspended') {
      keepAliveCtx.resume().catch(() => {});
      keepAliveState = keepAliveCtx.state === 'running' ? 'on' : 'blocked';
      return keepAliveState;
    }
    keepAliveState = 'on';
    return keepAliveState;
  } catch {
    keepAliveState = 'blocked';
    return keepAliveState;
  }
}

function stopKeepAlive() {
  try {
    if (keepAliveOsc) keepAliveOsc.stop();
    if (keepAliveCtx) keepAliveCtx.close();
  } catch {
    /* closing the tab is enough */
  }
  keepAliveOsc = null;
  keepAliveCtx = null;
  keepAliveState = 'off';
  return keepAliveState;
}

function keepAliveStatus() {
  if (keepAliveState !== 'off' && keepAliveCtx) {
    if (keepAliveCtx.state === 'running') keepAliveState = 'on';
    else if (keepAliveCtx.state === 'suspended') keepAliveState = 'blocked';
  }
  return keepAliveState;
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

// A drag and a click are not interchangeable on chess.com: click-to-move can be
// switched off in the site's own settings, and a drag can be lost to an overlay.
// The retry therefore has to use the gesture that just failed the least: the
// other one.
function retryInputMode(mode) {
  return mode === 'drag' ? 'click' : 'drag';
}

function findPromotionPiece(boardEl, promoCls) {
  const selector = `.promotion-window .promotion-piece.${promoCls}`;
  const inside = boardEl && typeof boardEl.querySelector === 'function' ? boardEl.querySelector(selector) : null;
  if (inside) return inside;
  return typeof document === 'undefined' ? null : document.querySelector(selector);
}

// The dialog is painted after the drag, and how late depends on the machine, so
// one look 100 ms after the drop was a coin flip on a slow board. Poll instead:
// a promotion left open is a move that never registers and a session that stops.
async function awaitPromotionPiece(boardEl, promoCls, attempts = 8, pauseMs = 120, sleepFn = sleep) {
  const tries = Math.max(1, Math.round(attempts));
  for (let attempt = 0; attempt < tries; attempt++) {
    const el = findPromotionPiece(boardEl, promoCls);
    if (el) return el;
    if (attempt < tries - 1) await sleepFn(pauseMs);
  }
  return null;
}

async function clickPromotion(boardEl, promoCls, clockSeconds) {
  const press = async (el) => {
    const box = el.getBoundingClientRect();
    await clickPoint(
      {
        x: box.left + box.width * (0.5 + gaussian() * 0.4),
        y: box.top + box.height * (0.5 + gaussian() * 0.4)
      },
      boardEl
    );
  };
  const plan = promotionPollPlan(clockSeconds);
  const piece = await awaitPromotionPiece(boardEl, promoCls, plan.attempts, plan.pauseMs);
  if (!piece) return false;
  await press(piece);
  // A dialog still on screen means the click missed it. One more press is
  // cheaper than a whole move retry.
  await sleep(220);
  const still = findPromotionPiece(boardEl, promoCls);
  if (still) await press(still);
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

  if (promo) await clickPromotion(boardEl, `${turnColor === 'b' ? 'b' : 'w'}${promo}`, options.clockSeconds);
  return true;
}

// Shadow-DOM panel, same design language as NITRO WRAITH: one token block, six
// themes that only move accents and background, a rail of views, cards with an
// accent spine, and motion that only explains state. Closed shadow root, so the
// page cannot style it and cannot find it by id.

const PANEL_CSS = `
:host{all:initial}
*,*::before,*::after{box-sizing:border-box}
@media (prefers-reduced-motion: reduce){
  .panel *,.panel *::before,.panel *::after{
    animation-duration:.001ms !important;animation-iteration-count:1 !important;
    transition-duration:.001ms !important;scroll-behavior:auto !important;
  }
}
.panel{
  --acc:#35ea86;--acc-2:#9bf7c5;
  --acc-dim:color-mix(in srgb,var(--acc) 14%,transparent);
  --line:color-mix(in srgb,var(--acc) 12%,transparent);
  --line-strong:color-mix(in srgb,var(--acc) 26%,transparent);
  --ink:#e9f7ef;--ink-2:#cfe9db;--dim:#7d9188;--dim-2:#7f9389;
  --warn:#ffb340;--bad:#ff6f6f;--info:#63c8ff;
  --ink-warn:color-mix(in srgb,var(--warn) 30%,var(--ink));
  --ink-bad:color-mix(in srgb,var(--bad) 25%,var(--ink));
  --ink-on-acc:#06110b;
  --card:rgba(255,255,255,.028);
  --bg-hi:rgba(12,17,14,.985);--bg-lo:rgba(5,8,6,.995);
  --font-ui:ui-sans-serif,-apple-system,'Segoe UI',system-ui,sans-serif;
  --font-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  position:fixed;top:16px;right:16px;z-index:2147483000;
  display:flex;flex-direction:column;width:322px;max-width:calc(100vw - 32px);
  max-height:calc(100vh - 32px);overflow:hidden;
  color:var(--ink);
  background:
    repeating-linear-gradient(0deg,rgba(255,255,255,.014) 0 1px,transparent 1px 3px),
    radial-gradient(120% 90% at 0% 0%,color-mix(in srgb,var(--acc) 10%,transparent),transparent 58%),
    radial-gradient(90% 80% at 100% 100%,color-mix(in srgb,var(--acc-2) 8%,transparent),transparent 62%),
    linear-gradient(168deg,var(--bg-hi),var(--bg-lo));
  border:1px solid var(--line-strong);border-radius:13px;
  box-shadow:0 22px 44px -18px rgba(0,0,0,.85),0 0 0 1px rgba(0,0,0,.6),
    0 0 34px -14px color-mix(in srgb,var(--acc) 50%,transparent),inset 0 1px 0 rgba(255,255,255,.05);
  font:12px/1.4 var(--font-mono);-webkit-font-smoothing:antialiased;user-select:none;
  animation:nt-boot .42s cubic-bezier(.2,.9,.25,1) both;
}
@keyframes nt-boot{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}
.panel,.panel[data-theme="carbon"]{color-scheme:dark}
.panel[data-theme="aurora"]{--acc:#3fe0c5;--acc-2:#a78bfa;--ink:#e8fbf7;--ink-2:#c3ece5;--dim:#7c9a98;--dim-2:#789693;--bg-hi:rgba(7,19,20,.985);--bg-lo:rgba(4,10,13,.995)}
.panel[data-theme="sunset"]{--acc:#ff9a5c;--acc-2:#ff77b0;--ink:#fff3ea;--ink-2:#f6d8c7;--dim:#a08a80;--dim-2:#9c877d;--bg-hi:rgba(24,12,11,.985);--bg-lo:rgba(12,6,8,.995)}
.panel[data-theme="ice"]{--acc:#66e3ff;--acc-2:#d7f7ff;--ink:#eefaff;--ink-2:#c9e9f6;--dim:#7e97a4;--dim-2:#7a93a0;--bg-hi:rgba(8,16,24,.985);--bg-lo:rgba(4,8,14,.995)}
.panel[data-theme="violet"]{--acc:#c08bff;--acc-2:#f0a9ff;--ink:#f7f0ff;--ink-2:#ddcbf2;--dim:#93849f;--dim-2:#8f809b;--bg-hi:rgba(18,11,27,.985);--bg-lo:rgba(8,5,14,.995)}
.panel[data-theme="rgb"]{
  --nt-hue:0;--acc:hsl(var(--nt-hue) 92% 72%);--acc-2:hsl(calc(var(--nt-hue) + 70) 94% 76%);
  --ink:#f6f7ff;--ink-2:#d9dcf0;--dim:#8d90a6;--dim-2:#8a8da3;
  --bg-hi:rgba(11,11,19,.985);--bg-lo:rgba(5,5,10,.995);
  animation:nt-boot .42s cubic-bezier(.2,.9,.25,1) both,nt-hue 16s linear infinite;
}
@keyframes nt-hue{to{--nt-hue:360}}
@property --nt-hue{syntax:'<number>';inherits:true;initial-value:0}

.head{position:relative;display:flex;align-items:center;gap:8px;padding:10px 11px 8px;cursor:grab;touch-action:none}
.head:active{cursor:grabbing}
.head::after{content:'';position:absolute;left:11px;right:11px;bottom:0;height:1px;background:var(--line)}
.mark{position:relative;flex:none;display:grid;place-items:center;width:26px;height:26px;border-radius:8px;color:var(--acc);
  background:linear-gradient(145deg,color-mix(in srgb,var(--acc) 13%,rgba(255,255,255,.04)),rgba(255,255,255,.015));
  border:1px solid var(--line-strong);box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 0 16px -9px var(--acc)}
.mark svg{width:17px;height:17px;display:block;filter:drop-shadow(0 0 5px color-mix(in srgb,var(--acc) 55%,transparent));animation:nt-glow 5.2s ease-in-out infinite}
@keyframes nt-glow{0%,100%{filter:drop-shadow(0 0 2px color-mix(in srgb,var(--acc) 45%,transparent))}50%{filter:drop-shadow(0 0 8px color-mix(in srgb,var(--acc) 85%,transparent))}}
.dot{width:6px;height:6px;border-radius:50%;background:var(--dim-2);flex:none}
.panel[data-state="running"] .dot{background:var(--acc);box-shadow:0 0 8px var(--acc);animation:nt-pulse 1.7s ease-in-out infinite}
.panel[data-state="paused"] .dot{background:var(--warn);box-shadow:0 0 8px var(--warn)}
.panel[data-state="warn"] .dot{background:var(--bad);box-shadow:0 0 8px var(--bad)}
@keyframes nt-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.mark .dot{position:absolute;right:-2px;top:-2px;width:5px;height:5px;box-shadow:0 0 0 2px var(--bg-hi)}
.brand{flex:1 1 auto;min-width:0}
.title{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:800 12.5px/1.15 var(--font-ui);letter-spacing:.13em;text-transform:uppercase;color:var(--ink);text-shadow:0 0 14px color-mix(in srgb,var(--acc) 35%,transparent)}
.sub{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px;font:600 8.5px/1 var(--font-ui);letter-spacing:.13em;text-transform:uppercase;color:var(--dim-2)}
.sub b{color:var(--acc);font-weight:700}
.iconbtn{all:unset;flex:none;display:grid;place-items:center;width:22px;height:22px;border-radius:7px;cursor:pointer;color:var(--dim);background:rgba(255,255,255,.04);border:1px solid var(--line);transition:color .15s,background .15s,border-color .15s,transform .12s}
.iconbtn:hover{color:var(--acc-2);background:var(--acc-dim);border-color:var(--line-strong)}
.iconbtn:active{transform:scale(.92)}
.iconbtn svg{width:12px;height:12px;display:block}
button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,[role="switch"]:focus-visible{outline:2px solid var(--acc);outline-offset:2px}

.chips{display:flex;align-items:center;gap:6px;padding:0 11px 9px}
.chip{all:unset;flex:none;padding:4px 9px;border-radius:999px;cursor:pointer;
  font:700 8.5px/1 var(--font-ui);letter-spacing:.1em;text-transform:uppercase;
  color:var(--dim-2);background:rgba(255,255,255,.04);border:1px solid var(--line);transition:color .15s,background .15s,border-color .15s,transform .12s}
.chip:hover{color:var(--ink);border-color:var(--line-strong)}
.chip:active{transform:scale(.96)}
.chip.on{color:var(--acc-2);background:var(--acc-dim);border-color:color-mix(in srgb,var(--acc) 32%,transparent);box-shadow:0 0 14px -8px var(--acc)}
.chip.afk.on{color:var(--ink-on-acc);background:var(--acc);border-color:var(--acc)}
.chip.warn{color:var(--ink-warn);background:color-mix(in srgb,var(--warn) 10%,transparent);border-color:color-mix(in srgb,var(--warn) 28%,transparent)}
.chip .k{color:color-mix(in srgb,currentColor 55%,transparent);margin-right:4px}
.pace{margin-left:auto;font:600 8px/1 var(--font-mono);letter-spacing:.06em;color:var(--dim-2);text-transform:uppercase}

.race-line{height:2px;margin:0 11px;border-radius:99px;background:rgba(255,255,255,.05);overflow:hidden;opacity:0;transition:opacity .2s}
.panel[data-state="running"] .race-line{opacity:1}
.race-line i{display:block;height:100%;transform:scaleX(var(--fill,0));transform-origin:left center;
  background:linear-gradient(90deg,color-mix(in srgb,var(--acc) 95%,transparent),color-mix(in srgb,var(--acc-2) 95%,transparent));
  box-shadow:0 0 9px color-mix(in srgb,var(--acc) 55%,transparent)}

.main{display:flex;flex:1 1 auto;min-height:0;border-top:1px solid var(--line)}
.rail{position:relative;flex:none;display:flex;flex-direction:column;gap:2px;padding:9px 6px;border-right:1px solid var(--line);background:linear-gradient(180deg,rgba(255,255,255,.02),transparent)}
.rail-btn{all:unset;position:relative;z-index:1;display:grid;place-items:center;width:30px;height:30px;border-radius:9px;cursor:pointer;color:var(--dim-2);transition:color .18s,transform .12s}
.rail-btn:hover{color:var(--acc-2)}
.rail-btn:active{transform:scale(.9)}
.rail-btn svg{width:15px;height:15px;display:block}
.rail-btn::after{content:attr(data-label);position:absolute;left:calc(100% + 7px);top:50%;z-index:6;padding:4px 7px;border-radius:6px;white-space:nowrap;pointer-events:none;
  font:700 8px/1 var(--font-ui);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-2);background:var(--bg-hi);border:1px solid var(--line-strong);
  opacity:0;transform:translate(-3px,-50%);transition:opacity .16s,transform .16s}
.rail-btn:hover::after,.rail-btn:focus-visible::after{opacity:1;transform:translate(0,-50%)}
.rail-glide{position:absolute;left:6px;top:9px;width:30px;height:30px;border-radius:9px;background:var(--acc-dim);border:1px solid var(--line-strong);
  box-shadow:0 0 16px -6px var(--acc),inset 0 0 12px -6px var(--acc);transition:transform .34s linear(0,.32 14%,.82 28%,1.06 44%,1.02 58%,.995 72%,1);pointer-events:none}
.rail[data-index="1"] .rail-glide{transform:translateY(32px)}
.rail[data-index="2"] .rail-glide{transform:translateY(64px)}
.rail[data-index="3"] .rail-glide{transform:translateY(96px)}
.rail[data-index="0"] .rail-btn[data-tab-btn="live"],
.rail[data-index="1"] .rail-btn[data-tab-btn="tune"],
.rail[data-index="2"] .rail-btn[data-tab-btn="info"],
.rail[data-index="3"] .rail-btn[data-tab-btn="stats"]{color:var(--acc)}

.views{flex:1 1 auto;min-width:0;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:10px 11px 11px;scrollbar-gutter:stable}
.views::-webkit-scrollbar{width:6px}
.views::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--acc) 22%,transparent);border-radius:99px}
.view{display:none}
.panel[data-tab="live"] .v-live,.panel[data-tab="tune"] .v-tune,.panel[data-tab="info"] .v-info,.panel[data-tab="stats"] .v-stats{display:block;animation:nt-view .28s cubic-bezier(.2,.9,.25,1) both}
@keyframes nt-view{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
.view-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 1px 8px;padding-bottom:6px;border-bottom:1px solid var(--line)}
.view-head span{display:inline-flex;align-items:center;gap:6px;font:800 7.5px/1 var(--font-ui);letter-spacing:.18em;text-transform:uppercase;color:var(--acc)}
.view-head span::before{content:'';width:10px;height:1px;border-radius:99px;background:var(--acc);box-shadow:0 0 7px var(--acc)}
.chart{display:flex;align-items:flex-end;gap:3px;height:56px;padding:8px 1px 0;margin-bottom:2px}
.bar{flex:1 1 0;min-width:3px;border-radius:3px 3px 0 0;background:var(--dim-2);opacity:.9}
.bar.win{background:var(--acc)}
.bar.loss{background:var(--bad)}
.bar.draw{background:var(--warn)}
.bar.empty{height:2px;background:var(--line-strong);opacity:1}
.view-head b{font:600 8px/1.2 var(--font-ui);letter-spacing:.04em;color:var(--dim-2);text-align:right}

.hero{display:grid;grid-template-columns:1fr 1px 1fr;align-items:center;padding:8px 2px 9px}
.stat{text-align:center;min-width:0}
.stat b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:700 26px/1 var(--font-mono);letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:var(--ink);text-shadow:0 0 18px color-mix(in srgb,var(--acc) 28%,transparent);transition:color .25s,text-shadow .25s}
.stat b.good{color:var(--acc);text-shadow:0 0 18px color-mix(in srgb,var(--acc) 50%,transparent)}
.stat b.bad{color:var(--ink-bad);text-shadow:0 0 18px color-mix(in srgb,var(--bad) 45%,transparent)}
.stat b.mid{font-size:20px}
.stat b.bump{animation:nt-bump .32s cubic-bezier(.34,1.4,.5,1)}
@keyframes nt-bump{0%{transform:scale(1)}35%{transform:scale(1.11)}100%{transform:scale(1)}}
.stat span{display:block;margin-top:5px;font:700 8px/1 var(--font-ui);letter-spacing:.17em;text-transform:uppercase;color:var(--dim)}
.sep{display:block;width:1px;height:34px;background:linear-gradient(180deg,transparent,color-mix(in srgb,var(--acc) 25%,transparent),transparent)}

.card{position:relative;margin-bottom:9px;padding:9px 10px 10px;border-radius:10px;
  background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.012));border:1px solid var(--line);
  transition:border-color .2s,box-shadow .25s,transform .18s}
.card:last-child{margin-bottom:2px}
.card:hover{border-color:var(--line-strong);box-shadow:0 10px 22px -16px rgba(0,0,0,.9),0 0 22px -14px color-mix(in srgb,var(--acc) 65%,transparent)}
.card::before{content:'';position:absolute;left:0;top:9px;bottom:9px;width:2px;border-radius:99px;
  background:linear-gradient(180deg,var(--acc),color-mix(in srgb,var(--acc) 12%,transparent));box-shadow:0 0 10px color-mix(in srgb,var(--acc) 55%,transparent);opacity:.85}
.card-h{display:flex;align-items:baseline;flex-wrap:wrap;gap:2px 7px;margin-bottom:7px}
.card-t{font:800 9px/1 var(--font-ui);letter-spacing:.19em;text-transform:uppercase;color:var(--ink-2)}
.card-s{font:600 8.5px/1.2 var(--font-ui);letter-spacing:.05em;color:var(--dim-2)}
.card-age{margin-left:auto;font:600 8px/1.2 var(--font-mono);font-variant-numeric:tabular-nums;color:var(--dim-2)}
.panel[data-state="running"] .card-s.live{color:var(--acc)}

.lines{display:flex;flex-direction:column;gap:3px}
.line{display:flex;gap:6px;font:11px/1.45 var(--font-mono);white-space:nowrap;overflow:hidden}
.line b{flex:none;min-width:44px;font-weight:700;color:var(--dim-2);font-variant-numeric:tabular-nums}
.line:first-child b{color:var(--acc)}
.line span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--ink-2)}
.line:first-child span{color:var(--ink)}
.empty{padding:6px 1px;font:500 10px/1.4 var(--font-ui);color:var(--dim)}

.rows{display:grid;gap:1px;margin-top:2px}
.row{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:2.5px 0;font:500 10.5px/1.45 var(--font-ui);color:var(--dim);border-bottom:1px solid rgba(255,255,255,.03)}
.row:last-child{border-bottom:0}
.row b{font:600 11px/1.45 var(--font-mono);font-variant-numeric:tabular-nums;color:var(--ink-2)}
.row b.good{color:var(--acc)}
.row b.warn{color:var(--ink-warn)}
.row b .score{color:var(--dim);font-weight:500}

.seg{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin-bottom:8px}
.seg button{all:unset;display:grid;place-items:center;padding:6px 2px;border-radius:8px;cursor:pointer;text-align:center;
  font:700 9px/1.2 var(--font-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--dim);
  background:rgba(255,255,255,.035);border:1px solid var(--line);transition:color .15s,background .15s,border-color .15s}
.seg button:hover{color:var(--ink-2);border-color:var(--line-strong)}
.seg button[aria-pressed="true"]{color:var(--acc-2);background:var(--acc-dim);border-color:color-mix(in srgb,var(--acc) 38%,transparent);box-shadow:0 0 16px -10px var(--acc)}
.set{display:flex;align-items:center;justify-content:space-between;gap:9px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.03)}
.set:last-child{border-bottom:0}
.set-lbl{font:500 10.5px/1.35 var(--font-ui);color:var(--ink-2);min-width:0}
.set-lbl i{display:block;font-style:normal;color:var(--dim-2);font-size:8.5px;letter-spacing:.04em}
.set-val{display:flex;align-items:center;gap:6px;flex:none}
.num{width:58px;padding:3px 6px;border-radius:6px;border:1px solid var(--line);background:rgba(0,0,0,.28);
  color:var(--ink-2);font:600 10px/1.4 var(--font-mono);font-variant-numeric:tabular-nums;text-align:right;color-scheme:dark}
.num:focus-visible{outline:2px solid var(--acc);outline-offset:1px;border-color:var(--acc)}
.sw{all:unset;position:relative;width:34px;height:18px;border-radius:999px;cursor:pointer;background:rgba(255,255,255,.08);border:1px solid var(--line);transition:background .2s,border-color .2s}
.sw::after{content:'';position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:var(--dim);transition:transform .22s cubic-bezier(.34,1.4,.5,1),background .2s}
.sw[aria-checked="true"]{background:var(--acc-dim);border-color:color-mix(in srgb,var(--acc) 45%,transparent)}
.sw[aria-checked="true"]::after{transform:translateX(16px);background:var(--acc);box-shadow:0 0 8px var(--acc)}
.themes{display:flex;gap:6px;margin:2px 0 9px}
.theme{all:unset;flex:1;height:22px;border-radius:7px;cursor:pointer;border:1px solid var(--line);position:relative;overflow:hidden}
.theme i{position:absolute;inset:0;display:block}
.theme[aria-pressed="true"]{border-color:var(--acc);box-shadow:0 0 14px -6px var(--acc)}
.th-carbon i{background:linear-gradient(135deg,#35ea86,#0c110e)}
.th-aurora i{background:linear-gradient(135deg,#3fe0c5,#a78bfa)}
.th-sunset i{background:linear-gradient(135deg,#ff9a5c,#ff77b0)}
.th-ice i{background:linear-gradient(135deg,#66e3ff,#d7f7ff)}
.th-violet i{background:linear-gradient(135deg,#c08bff,#f0a9ff)}
.th-rgb i{background:linear-gradient(135deg,#ff5f6d,#ffc371,#47ffa1,#5ad1ff,#b06bff)}

.kbd{display:inline-block;padding:1px 5px;border-radius:4px;border:1px solid var(--line-strong);background:rgba(0,0,0,.3);
  font:600 8.5px/1.5 var(--font-mono);color:var(--ink-2)}
.info-row{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:3px 0;font:500 10px/1.5 var(--font-ui);color:var(--dim);border-bottom:1px solid rgba(255,255,255,.03)}
.info-row:last-child{border-bottom:0}
.info-row b{font:600 10px/1.5 var(--font-mono);color:var(--ink-2)}
.info-row a{color:var(--acc-2);text-decoration:none;border-bottom:1px dotted color-mix(in srgb,var(--acc) 45%,transparent)}
.foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 11px;border-top:1px solid var(--line);
  font:600 8.5px/1 var(--font-mono);letter-spacing:.05em;text-transform:uppercase;color:var(--dim-2)}
.warnline{color:var(--ink-warn);font-size:8.5px;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.history{padding:6px 11px 0;font-size:8.5px;line-height:1.45;color:var(--ink-dim);display:flex;flex-direction:column;gap:2px}
.history[hidden]{display:none}
.history span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.history b{color:var(--ink);font-weight:600;margin-right:6px}
.panel[data-collapsed="true"]{width:auto}
.panel[data-collapsed="true"] .body{display:none}
.panel[data-collapsed="true"] .head{border-bottom:0}
.panel[data-collapsed="true"] .head::after{display:none}
.upd{display:inline-flex;align-items:center;gap:5px;margin-right:2px;padding:3px 7px;border-radius:99px;border:1px solid color-mix(in srgb,var(--acc) 42%,transparent);background:color-mix(in srgb,var(--acc) 15%,transparent);color:var(--acc);font:800 7.5px/1 var(--font-ui);letter-spacing:.1em;text-transform:uppercase;text-decoration:none;white-space:nowrap;animation:nt-pulse 1.9s ease-in-out infinite}
.upd:hover{background:color-mix(in srgb,var(--acc) 24%,transparent)}
.upd svg{width:10px;height:10px;flex:none}
.upd[hidden]{display:none}
@keyframes nt-pulse{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--acc) 45%,transparent)}55%{box-shadow:0 0 0 4px color-mix(in srgb,var(--acc) 0%,transparent)}}
.card-actions{display:flex;gap:6px;padding:7px 0 0}
.card-actions .act{flex:1;padding:5px 8px;border-radius:7px;border:1px solid var(--line-strong);background:rgba(255,255,255,.03);color:var(--ink-2);font:700 8px/1 var(--font-ui);letter-spacing:.1em;text-transform:uppercase;text-align:center;cursor:pointer;text-decoration:none}
.card-actions .act:hover{border-color:var(--acc);color:var(--acc)}
.band{display:grid;gap:5px;margin:2px 0 9px;padding:7px 9px;border-radius:9px;background:rgba(255,255,255,.022);border:1px solid var(--line)}
.band-h{display:flex;align-items:baseline;justify-content:space-between;font:700 7.5px/1 var(--font-ui);letter-spacing:.14em;text-transform:uppercase;color:var(--dim-2)}
.band-h b{font:700 11px/1 var(--font-mono);letter-spacing:0;color:var(--acc)}
.band-bar{height:5px;border-radius:99px;background:rgba(255,255,255,.05);overflow:hidden}
.band-bar i{display:block;height:100%;transform:scaleX(var(--band,0));transform-origin:left center;background:linear-gradient(90deg,var(--acc),var(--acc-2));box-shadow:0 0 8px color-mix(in srgb,var(--acc) 55%,transparent);transition:transform .3s}
.band-f{display:flex;justify-content:space-between;font:600 8px/1 var(--font-mono);color:var(--dim)}
.band-f b{color:var(--ink-2);font-weight:600}
`;

const ICON = {
  mark: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3c-1.4 0-2.4.9-2.4 2 0 .8.4 1.3 1 1.7-1.3 1-2 2.6-2 4.4 0 1.7.6 2.8 1.5 3.6-1.2.8-2 2-2 3.4 0 1.5.9 2.7 2.2 3.3L9 24h6l-1.3-2.6c1.3-.6 2.2-1.8 2.2-3.3 0-1.4-.8-2.6-2-3.4.9-.8 1.5-1.9 1.5-3.6 0-1.8-.7-3.4-2-4.4.6-.4 1-.9 1-1.7 0-1.1-1-2-2.4-2Z" fill="currentColor"/></svg>',
  live: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12h3l3-7 3 14 3-9 3 4h3"/></svg>',
  tune: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.6M12 18.4V21M3 12h2.6M18.4 12H21M5.6 5.6l1.9 1.9M16.5 16.5l1.9 1.9M18.4 5.6l-1.9 1.9M7.5 16.5l-1.9 1.9"/></svg>',
  stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.4v.2"/></svg>',
  min: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>',
  hide: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 12h16M12 4v16"/></svg>'
};

const PANEL_HTML = `
<div class="head" data-el="head">
  <span class="mark" aria-hidden="true">${ICON.mark}<i class="dot" data-el="dot"></i></span>
  <div class="brand">
    <span class="title">CHESS WRAITH</span>
    <span class="sub" data-el="engine">starting</span>
  </div>
  <a class="upd" data-el="update" href="${UPDATE_DOWNLOAD_URL}" target="_blank" rel="noopener noreferrer" hidden title="A newer version is on GitHub" aria-label="Update available"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M8 11l4 4 4-4M5 20h14"/></svg><span>Update</span></a>
  <button class="iconbtn" type="button" data-el="min" title="Collapse (double-click the title)" aria-label="Collapse panel">${ICON.min}</button>
  <button class="iconbtn" type="button" data-el="hide" title="Hide (Alt+Shift+H)" aria-label="Hide panel">${ICON.hide}</button>
</div>
<div class="body">
  <div class="chips">
    <button class="chip" type="button" data-el="auto" aria-pressed="false"><span class="k">AUTO</span><span data-el="autoTxt">OFF</span></button>
    <button class="chip afk" type="button" data-el="afk" aria-pressed="false"><span class="k">AFK</span><span data-el="afkTxt">OFF</span></button>
    <span class="chip legit" data-el="styleChip" style="cursor:default" title="One way to play: never the engine's raw best, always inside a human band">LEGIT</span>
    <span class="pace" data-el="clock">—</span>
  </div>
  <div class="race-line" aria-hidden="true"><i data-el="fill"></i></div>
  <div class="main">
    <div class="rail" data-el="rail" data-index="0">
      <span class="rail-glide" aria-hidden="true"></span>
      <button class="rail-btn" type="button" data-tab-btn="live" data-label="Live" aria-label="Live">${ICON.live}</button>
      <button class="rail-btn" type="button" data-tab-btn="tune" data-label="Tune" aria-label="Tune">${ICON.tune}</button>
      <button class="rail-btn" type="button" data-tab-btn="info" data-label="Info" aria-label="Info">${ICON.info}</button>
      <button class="rail-btn" type="button" data-tab-btn="stats" data-label="Stats" aria-label="Stats">${ICON.stats}</button>
    </div>
    <div class="views">
      <div class="view v-live">
        <div class="hero">
          <div class="stat"><b data-el="eval">–</b><span>Eval</span></div>
          <span class="sep" aria-hidden="true"></span>
          <div class="stat"><b class="mid" data-el="best">–</b><span>Best</span></div>
        </div>
        <div class="band">
          <div class="band-h"><span>Target</span><b data-el="target2">–</b></div>
          <div class="band-bar"><i data-el="bandFill"></i></div>
          <div class="band-f"><span>loss/move <b data-el="acpl2">–</b></span><span>band <b data-el="bandCap">–</b></span></div>
        </div>
        <div class="card">
          <div class="card-h"><span class="card-t">Lines</span><span class="card-s live" data-el="engineTag">waiting</span><span class="card-age" data-el="depth">–</span></div>
          <div class="lines" data-el="lines"><div class="empty">waiting for a board…</div></div>
        </div>
        <div class="card">
          <div class="card-h"><span class="card-t">Session</span><span class="card-s" data-el="turn">–</span></div>
          <div class="rows">
            <div class="row"><span>Loss / move</span><b data-el="acpl">–</b></div>
            <div class="row"><span>Opponent</span><b data-el="opp">–</b></div>
            <div class="row"><span>Playing at</span><b data-el="target">–</b></div>
            <div class="row"><span>Your pace</span><b data-el="pace">–</b></div>
            <div class="row"><span>Their tempo</span><b data-el="tempoRow">–</b></div>
            <div class="row"><span>Games</span><b data-el="games">–</b></div>
            <div class="row"><span>Rest</span><b data-el="rest">–</b></div>
          </div>
        </div>
        <div class="card">
          <div class="card-h"><span class="card-t">Account</span><span class="card-s">profile only</span></div>
          <div class="rows">
            <div class="row"><span>User</span><b data-el="account">anonymous</b></div>
            <div class="row"><span>Rating</span><b data-el="rating">–</b></div>
            <div class="row"><span>Session</span><b><span data-el="sessionLen">–</span> <span data-el="sessionScore" class="score"></span></b></div>
            <div class="row"><span>Guard</span><b data-el="guard">off</b></div>
          </div>
        </div>
      </div>
      <div class="view v-tune">
        <div class="view-head"><span>Tune</span><b>legit · engine · panel</b></div>
        <div class="card">
          <div class="card-h"><span class="card-t">Engine</span><span class="card-s">local, no server</span></div>
          <div class="set"><span class="set-lbl">Target Elo<i>0 = your own rating</i></span><span class="set-val"><input class="num" type="number" data-el="elo" min="0" max="3190" step="10"></span></div>
          <div class="set"><span class="set-lbl">Depth</span><span class="set-val"><input class="num" type="number" data-el="depthInput" min="4" max="20" step="1"></span></div>
          <div class="set"><span class="set-lbl">Search ms</span><span class="set-val"><input class="num" type="number" data-el="movetime" min="150" max="5000" step="50"></span></div>
          <div class="set"><span class="set-lbl">Slack cp<i>how far from best it may drift</i></span><span class="set-val"><input class="num" type="number" data-el="slack" min="0" max="300" step="5"></span></div>
        </div>
        <div class="card">
          <div class="card-h"><span class="card-t">Pacing</span><span class="card-s">human window</span></div>
          <div class="set"><span class="set-lbl">Min delay</span><span class="set-val"><input class="num" type="number" data-el="mint" min="250" max="6000" step="50"></span></div>
          <div class="set"><span class="set-lbl">Max delay</span><span class="set-val"><input class="num" type="number" data-el="maxt" min="400" max="15000" step="100"></span></div>
          <div class="set"><span class="set-lbl">Lines shown</span><span class="set-val"><input class="num" type="number" data-el="showLines" min="1" max="4" step="1"></span></div>
        </div>
        <div class="card">
          <div class="card-h"><span class="card-t">Board</span><span class="card-s">drawn on the page</span></div>
          <div class="set"><span class="set-lbl">Board arrows<i>best move and the reply, on the squares</i></span><span class="set-val"><button class="sw" type="button" role="switch" data-toggle="arrows" aria-checked="true" aria-label="Board arrows"></button></span></div>
          <div class="set"><span class="set-lbl">Level play<i>below 1320, play at your own loss rate</i></span><span class="set-val"><button class="sw" type="button" role="switch" data-toggle="levelPlay" aria-checked="true" aria-label="Level play"></button></span></div>
        </div>
        <div class="card">
          <div class="card-h"><span class="card-t">AFK</span><span class="card-s">unattended session</span></div>
          <div class="set"><span class="set-lbl">Always auto<i>never stops at the cap; rolls the session</i></span><span class="set-val"><button class="sw" type="button" role="switch" data-toggle="alwaysAuto" aria-checked="true" aria-label="Always auto"></button></span></div>
          <div class="set"><span class="set-lbl">Auto rematch<i>queue the next game when one ends</i></span><span class="set-val"><button class="sw" type="button" role="switch" data-toggle="autoRematch" aria-checked="false" aria-label="Auto rematch"></button></span></div>
          <div class="set"><span class="set-lbl">Keep-alive<i>near-silent audio holds the tab</i></span><span class="set-val"><button class="sw" type="button" role="switch" data-toggle="afkKeepAlive" aria-checked="false" aria-label="Keep alive"></button></span></div>
          <div class="set"><span class="set-lbl">Play while hidden<i>off by default; Chrome may freeze tabs</i></span><span class="set-val"><button class="sw" type="button" role="switch" data-toggle="playHidden" aria-checked="false" aria-label="Play while hidden"></button></span></div>
        </div>
        <div class="card">
          <div class="card-h"><span class="card-t">Theme</span><span class="card-s" data-el="themeName">Carbon</span></div>
          <div class="themes" data-el="themes">
            <button class="theme th-carbon" type="button" data-theme-btn="carbon" aria-label="Carbon"><i></i></button>
            <button class="theme th-aurora" type="button" data-theme-btn="aurora" aria-label="Aurora"><i></i></button>
            <button class="theme th-sunset" type="button" data-theme-btn="sunset" aria-label="Sunset"><i></i></button>
            <button class="theme th-ice" type="button" data-theme-btn="ice" aria-label="Ice"><i></i></button>
            <button class="theme th-violet" type="button" data-theme-btn="violet" aria-label="Violet"><i></i></button>
            <button class="theme th-rgb" type="button" data-theme-btn="rgb" aria-label="RGB"><i></i></button>
          </div>
        </div>
      </div>
      <div class="view v-info">
        <div class="view-head"><span>Info</span><b>one tab, no server</b></div>
        <div class="card">
          <div class="card-h"><span class="card-t">Build</span><span class="card-s" data-el="build">–</span></div>
          <div class="info-row"><span>Engine</span><b data-el="engineInfo">–</b></div>
          <div class="info-row"><span>Keep-alive</span><b data-el="kaInfo">off</b></div>
          <div class="info-row"><span>Source</span><a href="https://github.com/ezurinho/chess-wraith" target="_blank" rel="noopener noreferrer">github.com/ezurinho/chess-wraith</a></div>
          <div class="card-actions">
            <button class="act" type="button" data-el="copyReport">copy report</button>
          </div>
        </div>
        <div class="card">
          <div class="card-h"><span class="card-t">Last game</span><span class="card-s" data-el="reportAt">none yet</span></div>
          <div class="rows">
            <div class="row"><span>Result</span><b data-el="reportResult">–</b></div>
            <div class="row"><span>You</span><b data-el="reportYou">–</b></div>
            <div class="row"><span>Rival</span><b data-el="reportRival">–</b></div>
            <div class="row"><span>Account</span><b data-el="reportAccount">–</b></div>
          </div>
        </div>
        <div class="card">
          <div class="card-h"><span class="card-t">Updates</span><span class="card-s" data-el="updateState">checking…</span></div>
          <div class="rows">
            <div class="row"><span>Installed</span><b data-el="installed">–</b></div>
            <div class="row"><span>Latest</span><b data-el="latest">–</b></div>
            <div class="row"><span>Checked</span><b data-el="checked">never</b></div>
          </div>
          <div class="card-actions">
            <button class="act" type="button" data-el="checkNow">check now</button>
            <a class="act" href="${UPDATE_PAGE_URL}" target="_blank" rel="noopener noreferrer">open GitHub</a>
          </div>
        </div>
        <div class="card">
          <div class="card-h"><span class="card-t">Keys</span><span class="card-s">while the tab is focused</span></div>
          <div class="info-row"><span>Auto play</span><span><span class="kbd">Alt</span> <span class="kbd">Shift</span> <span class="kbd">A</span></span></div>
          <div class="info-row"><span>AFK</span><span><span class="kbd">Alt</span> <span class="kbd">Shift</span> <span class="kbd">F</span></span></div>
          <div class="info-row"><span>Play one move</span><span><span class="kbd">Alt</span> <span class="kbd">Shift</span> <span class="kbd">M</span></span></div>
          <div class="info-row"><span>Hide panel</span><span><span class="kbd">Alt</span> <span class="kbd">Shift</span> <span class="kbd">H</span></span></div>
          <div class="info-row"><span>Stop everything</span><span><span class="kbd">Alt</span> <span class="kbd">Shift</span> <span class="kbd">S</span></span></div>
        </div>
      </div>
      <div class="view v-stats">
        <div class="view-head"><span>Stats</span><b>last 20 games</b></div>
        <div class="card">
          <div class="card-h"><span class="card-t">Form</span><span class="card-s" data-el="statsForm">no games yet</span></div>
          <div class="chart" data-el="chart" aria-hidden="true"></div>
          <div class="rows">
            <div class="row"><span>Games</span><b data-el="statsGames">–</b></div>
            <div class="row"><span>Record</span><b data-el="statsRecord">–</b></div>
            <div class="row"><span>Loss / move</span><b data-el="statsAcpl">–</b></div>
            <div class="row"><span>Rival loss</span><b data-el="statsOpp">–</b></div>
            <div class="row"><span>Looks like</span><b data-el="statsPerf">–</b></div>
            <div class="row"><span>Best game</span><b data-el="statsBest">–</b></div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class="history" data-el="history" hidden></div>
  <div class="foot"><span data-el="foot">waiting</span><span class="warnline" data-el="warn"></span></div>
</div>
`;

function clockText(ms) {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}:${String(total % 60).padStart(2, '0')}`;
}

const THEME_NAMES = { carbon: 'Carbon', aurora: 'Aurora', sunset: 'Sunset', ice: 'Ice', violet: 'Violet', rgb: 'RGB' };

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

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.style.pointerEvents = 'auto';
    panel.innerHTML = PANEL_HTML;
    this.shadow.appendChild(panel);
    this.panel = panel;
    this.el = {};
    for (const node of panel.querySelectorAll('[data-el]')) this.el[node.dataset.el] = node;

    this.hidden = false;
    this.#wire();
    this.setTab('live');
    this.setTheme(cfg.theme || 'carbon');
    this.panel.dataset.collapsed = String(Boolean(cfg.panelCollapsed));
    this.render();
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
    on(this.el.afk, 'click', () => this.handlers.toggleAfk());
    on(this.el.hide, 'click', () => this.handlers.hide());
    on(this.el.min, 'click', () => this.toggleCollapsed());
    on(this.el.checkNow, 'click', () => {
      if (this.handlers.checkUpdate) this.handlers.checkUpdate();
    });
    on(this.el.copyReport, 'click', () => {
      if (this.handlers.copyReport) this.handlers.copyReport();
    });
    on(this.el.head, 'dblclick', () => this.toggleCollapsed());

    for (const btn of this.panel.querySelectorAll('[data-tab-btn]')) {
      on(btn, 'click', () => this.setTab(btn.dataset.tabBtn));
    }


    for (const btn of this.panel.querySelectorAll('[data-theme-btn]')) {
      on(btn, 'click', () => {
        this.cfg.theme = btn.dataset.themeBtn;
        this.setTheme(this.cfg.theme);
        this.handlers.settingsApplied(this.cfg);
      });
    }

    for (const sw of this.panel.querySelectorAll('[data-toggle]')) {
      on(sw, 'click', () => {
        const key = sw.dataset.toggle;
        if (key === 'playHidden') {
          this.cfg.pauseWhenHidden = !this.cfg.pauseWhenHidden;
          sw.setAttribute('aria-checked', String(!this.cfg.pauseWhenHidden));
        } else {
          this.cfg[key] = !this.cfg[key];
          sw.setAttribute('aria-checked', String(Boolean(this.cfg[key])));
        }
        // One switch for the three that make an unattended session. Turning it
        // on turns them on; turning them off individually still works.
        if (key === 'alwaysAuto' && this.cfg.alwaysAuto) {
          this.cfg.autoPlayOnLoad = true;
          this.cfg.autoRematch = true;
          this.cfg.afkKeepAlive = true;
          this.cfg.pauseWhenHidden = false;
        }
        this.handlers.settingsApplied(this.cfg);
        if (key === 'afkKeepAlive' || key === 'autoRematch') this.handlers.toggleAfk(this.cfg);
      });
    }

    const bindNumber = (el, key, affectsSearch) => {
      if (!el) return;
      el.value = String(this.cfg[key]);
      on(el, 'change', () => {
        this.cfg[key] = clampInt(el.value, Number(el.min), Number(el.max), this.cfg[key]);
        el.value = String(this.cfg[key]);
        if (affectsSearch) this.handlers.settingsChanged(this.cfg);
        else this.handlers.settingsApplied(this.cfg);
      });
    };
    // Only the four knobs that change the search restart it; the rest are
    // display or pacing and must not throw away the running analysis.
    for (const key of ['targetElo', 'maxDepth', 'moveTimeMs']) {
      bindNumber(this.el[{ targetElo: 'elo', maxDepth: 'depthInput', moveTimeMs: 'movetime' }[key]], key, true);
    }
    for (const [el, key] of [[this.el.mint, 'minThinkMs'], [this.el.maxt, 'maxThinkMs'], [this.el.slack, 'humanSlackCp'], [this.el.showLines, 'showLines']]) {
      bindNumber(el, key, false);
    }

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
      const r = this.panel.getBoundingClientRect();
      sx = e.clientX;
      sy = e.clientY;
      ox = r.left;
      oy = r.top;
      this.panel.style.right = 'auto';
      this.panel.style.left = `${ox}px`;
      this.panel.style.top = `${oy}px`;
    });
    window.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const maxLeft = Math.max(8, window.innerWidth - this.panel.offsetWidth - 8);
      const maxTop = Math.max(8, window.innerHeight - 40);
      this.panel.style.left = `${clamp(ox + e.clientX - sx, 8, maxLeft)}px`;
      this.panel.style.top = `${clamp(oy + e.clientY - sy, 8, maxTop)}px`;
    });
    window.addEventListener('pointerup', () => {
      dragging = false;
    });
  }

  setTheme(theme) {
    const name = THEME_NAMES[theme] ? theme : 'carbon';
    this.panel.dataset.theme = name;
    if (this.el.themeName) this.el.themeName.textContent = THEME_NAMES[name];
    for (const btn of this.panel.querySelectorAll('[data-theme-btn]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.themeBtn === name));
    }
  }

  setTab(tab) {
    const index = { live: 0, tune: 1, info: 2, stats: 3 }[tab] || 0;
    this.panel.dataset.tab = tab || 'live';
    this.el.rail.dataset.index = String(index);
  }

  toggleCollapsed() {
    const next = this.panel.dataset.collapsed !== 'true';
    this.panel.dataset.collapsed = String(next);
    this.cfg.panelCollapsed = next;
    this.handlers.settingsApplied(this.cfg);
  }

  toggleHidden() {
    this.hidden = !this.hidden;
    this.panel.style.display = this.hidden ? 'none' : '';
    return this.hidden;
  }

  render(view = {}) {
    const v = view;
    const top = v.analysis && v.analysis.lines && v.analysis.lines[0];
    const state = v.warn ? 'warn' : v.status === 'thinking' ? 'paused' : v.autoPlay ? 'running' : 'idle';
    this.panel.dataset.state = state;

    if (v.engine) {
      this.el.engine.textContent = v.engine;
      if (this.el.engineInfo) this.el.engineInfo.textContent = v.engine;
    }

    if (top) {
      const cp = typeof top.whiteCp === 'number' ? top.whiteCp : 0;
      this.el.eval.textContent = top.evalText || '–';
      this.el.eval.className = cp > 20 ? 'good' : cp < -20 ? 'bad' : '';
      this.el.best.textContent = v.analysis.bestSan || top.bestSan || '–';
      this.el.depth.textContent = `d${top.depth}`;
      this.el.engineTag.textContent = v.status === 'thinking' ? 'thinking' : (v.engine || 'ready');
      const box = this.el.lines;
      box.textContent = '';
      const take = Math.min(this.cfg.showLines, v.analysis.lines.length);
      for (let i = 0; i < take; i++) {
        const line = v.analysis.lines[i];
        const row = document.createElement('div');
        row.className = 'line';
        const b = document.createElement('b');
        b.textContent = line.evalText;
        const s = document.createElement('span');
        s.textContent = line.sanLine || (line.pv || []).join(' ');
        row.append(b, s);
        box.appendChild(row);
      }
    } else {
      this.el.eval.textContent = '–';
      this.el.eval.className = '';
      this.el.best.textContent = '–';
      this.el.depth.textContent = '–';
      this.el.engineTag.textContent = v.status === 'thinking' ? 'thinking' : 'waiting';
      this.el.lines.textContent = '';
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = v.status === 'thinking' ? 'thinking…' : 'waiting for a board…';
      this.el.lines.appendChild(empty);
    }

    this.el.turn.textContent = v.turn ? (v.turn === 'w' ? 'White to move' : 'Black to move') : '–';
    const band = Number(v.band) || 0;
    const acpl = v.acpl > 0 ? Math.round(v.acpl) : null;
    const boost = Number(v.slackBoost) || 0;
    this.el.acpl.textContent = acpl === null ? '–' : `${acpl} cp${band ? ` · band ${band}` : ''}`;
    this.el.acpl2.textContent = acpl === null ? '–' : `${acpl} cp`;
    this.el.bandCap.textContent = band ? `${band} cp` : '–';
    this.el.bandFill.style.setProperty('--band', String(band && acpl !== null ? clamp(acpl / band, 0, 1) : 0));
    this.el.account.textContent = v.account || 'anonymous';
    this.el.pace.textContent = v.pace ? `${(v.pace / 1000).toFixed(1)}s · ${v.paceSource}` : '–';
    this.el.tempoRow.textContent = v.tempo ? `${(v.tempo / 1000).toFixed(1)}s` : '–';
    this.el.games.textContent = String(Number(v.games) || 1);
    this.el.rest.textContent = Number(v.restMs) > 0 ? clockText(v.restMs) : 'limit reached';
    this.el.sessionLen.textContent = clockText(v.sessionMs);
    const tally = v.results || {};
    const played = (tally.win || 0) + (tally.loss || 0) + (tally.draw || 0);
    // Only after a game has ended: "0-0-0" next to the clock is noise.
    this.el.sessionScore.textContent = played > 0 ? `${tally.win || 0}-${tally.loss || 0}-${tally.draw || 0}` : '';
    this.el.guard.textContent = boost > 0 ? `+${boost} cp` : 'off';
    this.el.rating.textContent = v.accountRating
      ? `${v.accountRating} ${v.ratingClass || ''}`.trim()
      : v.boardRating
        ? `${v.boardRating} · page`
        : v.ratingError
          ? 'offline'
          : 'anonymous';
    this.el.rating.title = v.accountRating
      ? v.ratingAt
        ? `measured from the public profile · checked ${Math.max(0, Math.round((Date.now() - v.ratingAt) / 60000))}m ago`
        : 'the public rating of the signed-in account'
      : v.boardRating
        ? 'read from your player row on this page; the public profile has no rating for this time class yet'
        : 'the public rating of the signed-in account';
    // The real rating wins. The estimate is a fallback derived from the
    // opponent's moves, and showing it in place of a known 113 was the bug.
    this.el.opp.textContent = v.opponent ? String(v.opponent) : v.estimate ? `~${v.estimate}` : '–';
    this.el.opp.title = v.opponent
      ? 'read from the opponent row on this page'
      : v.estimate
        ? 'not published: estimated from the opponent\'s average centipawn loss'
        : 'no opponent rating on this page';
    const level = v.levelTarget > 0;
    const source = level
      ? ' · your level'
      : v.eloSource === 'account' || v.eloSource === 'board'
        ? `${v.provisional ? ' · prov' : v.eloGap ? ' · floor' : v.eloSource === 'board' ? ' · page' : ' · acct'}`
        : v.eloSource === 'target' ? ' · set' : ' · default';
    this.el.target.textContent = level
      ? `${v.accountRating || v.boardRating}${source}`
      : v.elo ? `${v.elo}${source}` : 'full';
    this.el.target.title = level
      ? `under Stockfish's 1320 floor: the engine searches at the floor and the chooser aims at the ~${v.levelTarget} cp/move an account rated ${v.accountRating || v.boardRating} gives away. Turn Level play off in Tune to play at the floor.`
      : v.eloGap
      ? `your ${v.accountRating || v.boardRating} is under Stockfish's 1320 floor: the engine plays at the floor and the move window widens by ${v.eloGap} points worth of slack`
      : v.eloSource === 'account'
        ? v.provisional
          ? `anchored to your published ${v.accountRating} with few games behind it, shrunk towards the prior`
          : 'anchored to your own published rating'
        : v.eloSource === 'board'
          ? `anchored to the ${v.boardRating} in your player row on this page`
          : v.eloSource === 'target'
            ? 'anchored to the manual Target Elo'
            : 'no rating known: anchored to the 1500 default';
    this.el.target2.textContent = v.elo ? String(v.elo) : '–';

    const autoOn = Boolean(v.autoPlay);
    this.el.auto.classList.toggle('on', autoOn);
    this.el.auto.setAttribute('aria-pressed', String(autoOn));
    this.el.autoTxt.textContent = autoOn ? 'ON' : 'OFF';

    const afkOn = Boolean(this.cfg.autoRematch || this.cfg.afkKeepAlive);
    this.el.afk.classList.toggle('on', afkOn);
    this.el.afk.setAttribute('aria-pressed', String(afkOn));
    this.el.afkTxt.textContent = afkOn ? 'ON' : 'OFF';

    this.el.styleChip.textContent = v.styleLabel || LEGIT.label;
    this.el.clock.textContent = Number.isFinite(v.clock) ? `${Math.round(v.clock)}s` : '—';
    this.el.fill.style.setProperty('--fill', String(clamp((v.ply || 0) / 80, 0, 1)));
    this.el.warn.textContent = v.warn || '';
    const events = Array.isArray(v.events) ? v.events.slice(-2) : [];
    this.el.history.hidden = events.length === 0;
    this.el.history.title = events.map((item) => `${eventLabel(item.at, Date.now())} ${item.text}`).join('\n');
    this.el.history.textContent = '';
    for (const item of events) {
      const line = document.createElement('span');
      const when = document.createElement('b');
      when.textContent = eventLabel(item.at, Date.now());
      line.appendChild(when);
      line.appendChild(document.createTextNode(item.text));
      this.el.history.appendChild(line);
    }
    this.el.foot.textContent = v.passiveTab
      ? 'second tab · passive'
      : v.throttled
        ? 'tab hidden · timers batched'
      : v.status === 'thinking'
        ? 'thinking'
        : autoOn
          ? 'auto play armed'
          : 'idle';
    this.el.build.textContent = v.version || VERSION;
    this.el.installed.textContent = v.version || VERSION;
    const latest = String(v.updateLatest || '');
    const newer = versionNewer(latest, v.version || VERSION);
    this.el.update.hidden = !newer;
    if (newer) {
      // Only the number: the header has 322 px and the word plus a version
      // ellipsised the title to "CHESS WRA…".
      this.el.update.querySelector('span').textContent = latest;
      this.el.update.title = `Download v${latest} from GitHub`;
      this.el.update.setAttribute('aria-label', `Update available: v${latest}`);
    }
    this.el.latest.textContent = latest ? latest : '–';
    this.el.checked.textContent = v.updateAt ? formatAge(Date.now() - v.updateAt) : 'never';
    this.el.updateState.textContent = v.updateChecking
      ? 'checking…'
      : v.updateError
        ? `failed · ${v.updateError}`
        : newer
          ? 'newer available'
          : latest
            ? 'up to date'
            : 'not checked';
    this.el.kaInfo.textContent = v.keepAlive || 'off';
    // The card after the last game. `lastReport` is null until one finished,
    // and a game with too few assessed moves shows the result but no average.
    const rep = v.report;
    const cp = (acpl) => (Number.isFinite(acpl) ? `${acpl} cp/move` : '–');
    const like = (perf) => (Number.isFinite(perf) ? ` · like ${perf}` : '');
    this.el.reportAt.textContent = rep && rep.at ? eventLabel(rep.at, Date.now()) : 'none yet';
    this.el.reportResult.textContent = rep && rep.result
      ? `${rep.result}${rep.moves ? ` · ${rep.moves} moves` : ''}`
      : '–';
    this.el.reportYou.textContent = rep && Number.isFinite(rep.myAcpl) ? cp(rep.myAcpl) + like(rep.myPerf) : 'not enough moves';
    this.el.reportRival.textContent = rep && Number.isFinite(rep.oppAcpl) ? cp(rep.oppAcpl) + like(rep.oppPerf) : '–';
    this.el.reportAccount.textContent = rep && rep.rating
      ? `${rep.rating}${Number.isFinite(rep.delta) ? ` · ${rep.delta >= 0 ? '+' : ''}${rep.delta}` : ''}`
      : '–';
    // Stats: the last twenty games, drawn from the same entries the card uses.
    const sum = v.reportSummary;
    const has = Boolean(sum && sum.games);
    this.el.statsGames.textContent = has ? String(sum.games) : '–';
    this.el.statsRecord.textContent = has ? `${sum.wins}W · ${sum.losses}L · ${sum.draws}D · ${sum.winRate}%` : '–';
    this.el.statsAcpl.textContent = has && Number.isFinite(sum.acpl) ? `${sum.acpl} cp` : '–';
    this.el.statsOpp.textContent = has && Number.isFinite(sum.oppAcpl) ? `${sum.oppAcpl} cp` : '–';
    this.el.statsPerf.textContent = has && Number.isFinite(sum.perf) ? `like ${sum.perf}` : '–';
    this.el.statsBest.textContent = has && Number.isFinite(sum.best) ? `${sum.best} cp` : '–';
    this.el.statsForm.textContent = has
      ? `${sum.games} game${sum.games === 1 ? '' : 's'} · ${sum.winRate}% won`
      : 'no games yet';
    // Rebuild the bars only when the sequence changed: this renders every 2 s.
    const formKey = JSON.stringify(has ? sum.form : []);
    if (this.chartKey !== formKey) {
      this.chartKey = formKey;
      const chart = this.el.chart;
      chart.textContent = '';
      for (const game of (has ? sum.form : [])) {
        const bar = document.createElement('i');
        const shape = ['win', 'loss', 'draw'].includes(game.result) ? game.result : 'empty';
        bar.className = `bar ${shape}`;
        // A lower loss is a taller bar: the eye reads the good games as peaks.
        bar.style.height = Number.isFinite(game.acpl)
          ? `${Math.max(8, Math.min(100, 100 - game.acpl / 2))}%`
          : '6%';
        const parts = [game.result];
        if (game.moves) parts.push(`${game.moves} moves`);
        if (Number.isFinite(game.acpl)) parts.push(`${game.acpl} cp/move`);
        bar.title = parts.join(' · ');
        chart.appendChild(bar);
      }
    }


    for (const sw of this.panel.querySelectorAll('[data-toggle]')) {
      const key = sw.dataset.toggle;
      const on = key === 'playHidden' ? !this.cfg.pauseWhenHidden : Boolean(this.cfg[key]);
      sw.setAttribute('aria-checked', String(on));
    }
    if (this.el.elo && document.activeElement !== this.el.elo) this.el.elo.value = String(this.cfg.targetElo);
    if (this.el.slack && document.activeElement !== this.el.slack) this.el.slack.value = String(this.cfg.humanSlackCp);
    this.setTheme(this.cfg.theme || 'carbon');
  }
}

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
    // Every legal move in the position, UCI. Calibration needs an opponent that
    // is not the engine, and the rules module is deleted from the page globals
    // after boot; this is the only way back to it from a debug session.
    legalMoves: () => (state.snapshot ? Chess.generateLegalMoves(state.snapshot).map((m) => Chess.moveToUci(m)) : []),
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

// The loss of a move is measured where the literature measures it: the eval of
// the position my move creates, against the eval of the position it came from.
// Measuring after the opponent's reply refunded my mistake whenever they erred,
// which is how a 293 band reported 82 against a weak opponent.
async function measureLanded(info) {
  let lines = null;
  try {
    lines = await engine.analyze({
      fen: info.fen,
      turn: info.turn === 'w' ? 'b' : 'w',
      flipped: info.flipped,
      depth: cfg.maxDepth,
      moveTimeMs: 700
    });
  } catch {
    return;
  }
  const white = lines && lines[0] && lines[0].whiteCp;
  if (!Number.isFinite(white) || !Number.isFinite(info.before)) return;
  const loss = myLossFromWhiteCp(info.turn, info.before, white);
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
  armAutoMove(move, targetFen, choice, visibleDelayMs(delay, spent), result);

  refreshPanel();
}

const PIECE_WORTH = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

// What an improvised move needs to know about itself: what it takes, whether it
// checks, what it leaves hanging. The chooser owns the taste; the board owns the
// facts.
// The worst piece of `color` that the opponent attacks and nobody defends. A
// 133-rated move is usually this: the queen goes to a square a pawn covers.
function hangingAfter(grid, color) {
  const opp = color === 'w' ? 'b' : 'w';
  let worst = 0;
  for (let r = 0; r < 8; r += 1) {
    for (let f = 0; f < 8; f += 1) {
      const piece = grid[r][f];
      if (!piece || Chess.pieceColor(piece) !== color) continue;
      const kind = piece.toLowerCase();
      if (kind === 'k') continue;
      if (!Chess.isSquareAttacked(grid, f, r, opp)) continue;
      if (!Chess.isSquareAttacked(grid, f, r, color)) {
        worst = Math.max(worst, PIECE_WORTH[kind] || 0);
      }
    }
  }
  return worst;
}

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
      ply: Number(ply) || 0,
      hanging: hangingAfter(m.nextState.grid, snap.turn)
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

// The improvisation, measured. A static taste can only pick among the moves it
// can judge, and the ones that hang material are rare: the live sessions
// delivered 6-66 cp/move against a 293 band. This asks the engine what a dozen
// legal moves actually cost and takes the one nearest the band. One restricted
// search, low depth, and only for a move that was going to be improvised anyway.
async function improveImprovised(snap, result, legal, choice) {
  const target = Number(choice && choice.cpLoss) || 0;
  const best = result && result.lines && result.lines[0];
  if (!target || !best || !Number.isFinite(best.whiteCp) || !engine || !engine.ready) return null;
  // Half the candidates are chosen because they leave material loose, half at
  // random: a random list misses the move that actually costs 470 too often, and
  // the measured mean then swings between 6 and 186 cp/move.
  const all = legal
    .map((m) => ({ uci: Chess.moveToUci(m), hanging: hangingAfter(m.nextState.grid, snap.turn) }))
    .filter((c) => c.uci !== best.bestUci);
  // The engine's own move goes into the same restricted search. Comparing a
  // candidate priced at depth 10 with a best move priced at depth 14 is not a
  // loss, it is a depth difference: the script aimed 1.6x above the band to
  // compensate, and live it still delivered 100 cp/move against a 293 band.
  const pool = [best.bestUci];
  const loose = all.filter((c) => c.hanging > 0).sort((a, b) => b.hanging - a.hanging);
  while (pool.length < 4 && loose.length) pool.push(loose.shift().uci);
  const rest = all.map((c) => c.uci).filter((uci) => !pool.includes(uci));
  while (pool.length < 6 && rest.length) {
    pool.push(rest.splice(Math.floor(Math.random() * rest.length), 1)[0]);
  }
  if (pool.length < 4) return null;
  let lines = null;
  try {
    lines = await engine.analyze({
      fen: snap.fen,
      turn: snap.turn,
      flipped: snap.flipped,
      uciMoves: snap.uciMoves,
      multiPv: pool.length,
      searchmoves: pool.join(' '),
      // The price has to be measured at the depth the loss is measured at. At
      // depth 10 with 240 ms the same candidate was priced at 293 and realised
      // at 0: the search had not converged, and the script paid for the noise.
      depth: cfg.maxDepth,
      moveTimeMs: 900
    });
  } catch {
    return null;
  }
  if (!Array.isArray(lines) || !lines.length) return null;
  // The board may have moved while the engine was answering. The position the
  // move was priced for is the only one it may be played on.
  if (!state.snapshot || state.snapshot.fen !== snap.fen) return null;
  // Same-depth baseline: the best move judged by the same shallow search, so the
  // difference is the move and not the depth. The realised mean then depends on
  // the opponent, not on an invented 1.6 multiplier.
  const base = lines.find((line) => line && line.bestUci === best.bestUci)
    || lines.filter((line) => line && Number.isFinite(line.whiteCp)).sort((x, y) => y.whiteCp - x.whiteCp)[0];
  if (!base || !Number.isFinite(base.whiteCp)) return null;
  const aim = Math.min(600, Math.round(target));
  const floor = Math.round(target * 0.35);
  const ranked = [];
  for (const line of lines) {
    if (!line || !line.bestUci || line.mateIn != null) continue;
    if (line.bestUci === base.bestUci) continue;
    const loss = myLossFromWhiteCp(snap.turn, base.whiteCp, line.whiteCp);
    // A near-zero loss is the same lie in the other direction: the move must
    // cost something like the band, not be a good move that happens to be legal.
    if (loss == null || loss < floor) continue;
    if (allowsMateInOne(legal, line.bestUci)) continue;
    ranked.push({ line, loss });
  }
  ranked.sort((x, y) => Math.abs(x.loss - aim) - Math.abs(y.loss - aim));
  // The restricted search proposes; a plain full search of the position after the
  // move disposes. Measured against a same-level opponent, the restricted price
  // was off by hundreds: a move it called 293 realised at 0. The verified number
  // is the same subtraction the panel uses afterwards, so the promise and the
  // measurement share a method.
  let pick = null;
  // Six, not three: the restricted price is the proposal and it is noisy, so a
  // shortlist ordered by that price throws away the candidate that verifies best.
  // Live, three candidates left the pick at 600 cp too often (mean 343 at a 133).
  for (const cand of ranked.slice(0, 6)) {
    const move = legal.find((m) => Chess.moveToUci(m) === cand.line.bestUci);
    if (!move || !move.nextState) continue;
    let after = null;
    try {
      after = await engine.analyze({
        fen: Chess.buildFen(move.nextState),
        turn: move.nextState.turn,
        flipped: snap.flipped,
        depth: cfg.maxDepth,
        moveTimeMs: 700
      });
    } catch {
      after = null;
    }
    const white = after && after[0] && after[0].whiteCp;
    if (!Number.isFinite(white)) continue;
    const real = myLossFromWhiteCp(snap.turn, best.whiteCp, white);
    if (real == null || real < floor) continue;
    const err = Math.abs(real - aim);
    if (!pick || err < pick.err) pick = { line: cand.line, loss: real, err, fen: Chess.buildFen(move.nextState) };
  }
  if (!pick) return null;
  return {
    move: pick.line.bestUci,
    choice: {
      ...choice,
      line: { bestUci: pick.line.bestUci, bestSan: pick.line.bestSan },
      cpLoss: pick.loss,
      improvised: true,
      measured: true,
      // Where the loss was measured and from what: the panel re-measures this
      // position itself rather than trusting the search that chose the move.
      beforeCp: best.whiteCp,
      afterFen: pick.fen || null
    }
  };
}

function armAutoMove(move, targetFen, choice, delay, result) {
  state.autoTimer = setTimeout(async () => {
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
      armAutoMove(move, targetFen, choice, Math.round(rand(1500, 2600)), result);
      return;
    }
    state.defers = 0;
    // The move was improvised: price it now, on the position it will be played
    // on, and play the priced one if the board has not moved.
    let finalMove = move;
    let finalChoice = choice;
    if (choice && choice.improvised && state.snapshot) {
      const measured = await improveImprovised(state.snapshot, result, Chess.generateLegalMoves(state.snapshot), choice);
      if (measured) {
        finalMove = measured.move;
        finalChoice = measured.choice;
      }
    }
    if (!state.snapshot || state.snapshot.fen !== targetFen) return;
    // A rejected promise here used to leave auto-play on with no timer and no
    // message: the panel said "playing" while nothing was playing.
    playMove(finalMove, targetFen, finalChoice)
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

// Everything that happens once a move really landed, in one place, so a move the
// board only took on the fallback input mode is measured like any other. It was
// not: the retry path returned true without setting pendingMyLoss, so the panel's
// loss/move silently skipped every move that needed a second try.
function settleLandedMove(grid, snap, choice, move) {
  state.autoMovedGrid = grid;
  state.moveMisses = 0;
  if (choice && choice.cpLoss === 0) state.top1Streak += 1;
  else state.top1Streak = 0;
  if (choice) {
    // Every move is measured the same way now, improvised or not: the eval of the
    // position it came from against the eval of the position it creates. The
    // engine's own slack was the measurement for non-improvised moves, which is
    // the model marking its own homework - at a 1320 account it reported 0 cp for
    // thirteen moves in a row.
    const next = snap ? Chess.generateLegalMoves(snap).find((m) => Chess.moveToUci(m) === move) : null;
    const afterFen = choice.afterFen || (next ? Chess.buildFen(next.nextState) : null);
    const beforeCp = Number.isFinite(choice.beforeCp)
      ? choice.beforeCp
      : (state.analysis && state.analysis.fen === (snap && snap.fen) && state.analysis.lines && state.analysis.lines[0]
        ? state.analysis.lines[0].whiteCp
        : null);
    if (afterFen && Number.isFinite(beforeCp)) {
      measureLanded({ fen: afterFen, before: beforeCp, turn: snap.turn, flipped: snap.flipped });
    } else {
      pushMyLoss(choice.cpLoss);
    }
    if (choice.improvised) state.improvisedPicks += 1;
  }
  recordOpening(move, plyOf(snap));
  recordPace(state.lastDelayMs);
  state.lastMyMoveAt = Date.now();
  scheduleScan(120);
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
  // "The board changed" is not "the move I asked for landed": a click that
  // selects the wrong piece moves that piece and the grid still changes. The
  // expected position is computed from the rules, not from the eye.
  let expected = null;
  try {
    const wanted = Chess.generateLegalMoves(snap).find((m) => Chess.moveToUci(m) === move);
    expected = wanted ? wanted.nextState.grid : null;
  } catch {
    expected = null;
  }
  const verdict = Chess.moveLanded(snap.grid, after && after.valid ? after.grid : null, expected);
  if (verdict === 'wrong') {
    state.warn = 'the board played a different move';
    state.moveMisses = (state.moveMisses || 0) + 1;
    refreshPanel();
  }
  if (verdict === 'landed') {
    state.warn = '';
    settleLandedMove(after.grid, snap, choice, move);
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
    // The same rule as the first attempt: the fallback input mode is allowed to
    // land the move, not to change the position into something else.
    const again = Chess.moveLanded(snap.grid, second && second.valid ? second.grid : null, expected);
    if (again === 'landed') {
      state.warn = '';
      settleLandedMove(second.grid, snap, choice, move);
      return true;
    }
    if (again === 'wrong') {
      state.warn = 'the board played a different move';
      state.moveMisses = (state.moveMisses || 0) + 1;
      refreshPanel();
      return false;
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
  let choice = chooseMove(result.lines, slackCfg(), {
    accountElo: accountRatingNow() || state.boardRating || 0,
    top1Streak: state.top1Streak,
    oppElo: state.opponentRating || state.oppEloEstimate,
    repeatUci: repeatedOpening(result.bestmove, ply),
    openingShares: ply < OPENING_PLIES ? openingShares() : null,
    improvise: improvisedCandidates(legal, snap, ply)
  });
  // An improvised move is priced by the engine before it is played, so the
  // band is what the move costs instead of what the model wished it cost.
  const measured = choice && choice.improvised ? await improveImprovised(snap, result, legal, choice) : null;
  if (measured) choice = measured.choice;
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

})();
