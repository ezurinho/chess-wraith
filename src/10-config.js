const VERSION = '1.30.0';
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
  showLines: 3
};

// There is one way to play and it is the honest one: no GM/rage presets, no
// "full engine" switch. The engine is capped to a rating a human at this table
// could plausibly hold, and nothing here ever asks it to play its raw best.
const LEGIT = { elo: null, skill: 20, slack: 40, miss: 0, label: 'Legit' };

// Pinned to the release tag, not @main: this file is executed inside chess.com,
// so the bytes behind it must not change without a tag and a version bump.
const ENGINE_MIRROR = 'https://cdn.jsdelivr.net/gh/ezurinho/chess-wraith@v1.30.0/vendor';
const ENGINE_FILES = {
  nnueJs: `${ENGINE_MIRROR}/stockfish-19-lite-single.js`,
  nnueWasm: `${ENGINE_MIRROR}/stockfish-19-lite-single.wasm`,
  fallbackJs: `${ENGINE_MIRROR}/stockfish.js`
};

