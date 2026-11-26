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
