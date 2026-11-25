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
function sessionLimit({ startedAt, games, now, maxGames, maxMs }) {
  const played = Number.isFinite(games) ? games : 0;
  const hasStart = Number.isFinite(startedAt);
  const start = hasStart ? startedAt : 0;
  const t = Number.isFinite(now) ? now : 0;
  if (Number.isFinite(maxGames) && maxGames > 0 && played >= maxGames) {
    return { stop: true, reason: `session limit: ${maxGames} games` };
  }
  if (hasStart && Number.isFinite(maxMs) && maxMs > 0 && t >= start + maxMs) {
    const hours = Math.round((maxMs / 3600000) * 10) / 10;
    return { stop: true, reason: `session limit: ${hours}h` };
  }
  return { stop: false, reason: '' };
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
