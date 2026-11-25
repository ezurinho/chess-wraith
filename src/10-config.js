const VERSION = '1.3.0';
const STORAGE_KEY = 'chess-wraith-settings-v1';

const CONFIG = {
  // Engine
  targetElo: 1650,
  style: 'adaptive', // 'adaptive' | 'gm' | 'club' | 'casual' | 'engine'
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

// Public, user-facing presets. The panel writes these into CONFIG.
const STYLES = {
  // `miss` is the chance of a deliberate, capped inaccuracy: only the weaker
  // presets carry one, so "Casual" looks casual instead of merely random.
  adaptive: { elo: null, skill: 20, slack: 40, miss: 0.05, label: 'Adaptive' },
  gm: { elo: 2250, skill: 20, slack: 26, miss: 0, label: 'GM-like' },
  club: { elo: 1650, skill: 20, slack: 70, miss: 0, label: 'Club' },
  casual: { elo: 1350, skill: 20, slack: 120, miss: 0.12, label: 'Casual' },
  engine: { elo: null, skill: 20, slack: 0, miss: 0, label: 'Full engine' }
};

// Pinned to the release tag, not @main: this file is executed inside chess.com,
// so the bytes behind it must not change without a tag and a version bump.
const ENGINE_MIRROR = 'https://cdn.jsdelivr.net/gh/ezurinho/chess-wraith@v1.3.0/vendor';
const ENGINE_FILES = {
  nnueJs: `${ENGINE_MIRROR}/stockfish-19-lite-single.js`,
  nnueWasm: `${ENGINE_MIRROR}/stockfish-19-lite-single.wasm`,
  fallbackJs: `${ENGINE_MIRROR}/stockfish.js`
};

