const VERSION = '1.89.0';
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
  // Four lines were not enough to price a 60 cp band at a 1320 account: the
  // engine's fourth-best move was still within a few centipawns of its best, so
  // the slack model had nothing worth picking and delivered 5 cp/move.
  multiPv: 8,
  hashMb: 32,

  // Pacing: the whole point of this script is that it does not look like a bot.
  // AUTO is the only mode. It starts with the page, re-arms after every game and
  // has no off switch; the chip resumes a stopped tab and Stop is the escape hatch.
  autoPlayOnLoad: true,
  // Kept as a field because the session cap and the panel read it. The boot pass
  // pins it to true so no stale per-account setting can turn AUTO off.
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
  // "a bot farming the account". Both caps are hard stops: AUTO does not roll
  // them over. The stop is persisted per account and only Alt+Shift+A (or the
  // AUTO chip) starts the next run.
  sessionMaxGames: 15,
  sessionMaxMs: 3 * 60 * 60 * 1000,
  // Written by the cap and read on the next boot. A reload must not rearm AUTO.
  sessionStopped: false,
  sessionStopReason: '',

  // Rematch is part of AUTO, not a separate switch: a finished game always asks
  // for the next one. AFK only decides whether the tab keeps playing while hidden.
  autoRematch: true,
  afkKeepAlive: false,
  newGameDelayMs: [1700, 4200],
  newGameLongChance: 0.12,
  newGameLongMs: [5000, 9500],

  // Panel
  theme: 'carbon', // 'carbon' | 'aurora' | 'sunset' | 'ice' | 'violet' | 'rgb'

  panelCollapsed: false,
  // The rail remembers the view: `live`, `tune`, `info` or `stats`.
  panelTab: 'live',
  // Where the panel was left, in CSS pixels; null means the default corner.
  // Saved with the rest of the settings, so a reload keeps the panel where it
  // was instead of sending it back to the top-right.
  panelX: null,
  panelY: null,
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
const ENGINE_MIRROR = 'https://cdn.jsdelivr.net/gh/ezurinho/chess-wraith@v1.89.0/vendor';
const ENGINE_FILES = {
  nnueJs: `${ENGINE_MIRROR}/stockfish-19-lite-single.js`,
  nnueWasm: `${ENGINE_MIRROR}/stockfish-19-lite-single.wasm`,
  fallbackJs: `${ENGINE_MIRROR}/stockfish.js`
};

