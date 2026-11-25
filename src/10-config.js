const VERSION = '1.0.2';
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

  // Panel
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

const ENGINE_MIRROR = 'https://cdn.jsdelivr.net/gh/ezurinho/chess-wraith@main/vendor';
const ENGINE_FILES = {
  nnueJs: `${ENGINE_MIRROR}/stockfish-19-lite-single.js`,
  nnueWasm: `${ENGINE_MIRROR}/stockfish-19-lite-single.wasm`,
  fallbackJs: `${ENGINE_MIRROR}/stockfish.js`
};

