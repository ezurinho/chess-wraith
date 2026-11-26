// Every other test loads a slice of the script. This one loads the whole thing
// into a DOM and lets boot run: board reader, engine protocol, panel mount and
// the scan loop in one page, because a crash there is what actually ends a
// session and no unit test had ever started the script.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { bootSource, PAGE, START, FakeWorker } = require('./harness');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, 'src', rel), 'utf8');
const FRAGMENTS = [
  '10-config.js', '20-utils.js', '30-chess.js', '35-chess-glue.js', '40-board.js',
  '50-engine.js', '55-pace.js', '60-analysis.js', '65-afk.js', '70-input.js',
  '80-panel.js', '90-boot.js'
];

function boot(html = PAGE, seed = null, options = {}) {
  return bootSource(FRAGMENTS.map(read).join('\n'), { html, seed, ...options });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// A scored game never ends on the starting position, so the fixture after a
// game over is a position two plies in: 1. e4 d5.
const RATED = PAGE.replace(
  '<wc-chess-board',
  '<div class="board-layout-top"><div class="player-top"><div class="user-tagline-rating">(1000)</div></div></div><wc-chess-board'
);

const MIDGAME = PAGE
  .replace('<div class="piece wp square-12"></div>', '<div class="piece wp square-14"></div>')
  .replace('<div class="piece bp square-27"></div>', '<div class="piece bp square-25"></div>');


async function until(check, budgetMs = 9000, stepMs = 100) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await wait(stepMs);
  }
  return false;
}

test('the whole script boots on a real board without throwing', async () => {
  const { window, api, stop } = boot();
  try {
    await wait(1600);
    assert.ok(api.state.snapshot, 'the board was read');
    assert.equal(api.state.snapshot.placement, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR', 'start position');
    assert.equal(api.state.snapshot.turn, 'w', 'white to move');
    assert.ok(api.state.boardEl, 'the board element was found');
    assert.equal(api.engine.mode, 'Stockfish 19 NNUE', 'the engine came up');
    assert.ok(window.document.body.children.length > 0, 'the panel has a host');
  } finally {
    stop();
  }
});

test('a finished game with AFK on presses the button a person would press', async () => {
  const { window, api, stop } = boot(MIDGAME +
    // The markup from a real finished game page, class for class.
    '<div class="board-modal-container-container" style="position:fixed">' +
    '<div class="board-modal-component"><div class="game-over-modal-shell-container">' +
    '<div class="game-over-modal-header-component"><div class="game-over-modal-title-component">tester won</div>' +
    '<div class="game-over-modal-subtitle-component">by checkmate</div></div>' +
    '<button class="cc-button-component">Rematch</button></div></div></div>');
  try {
    api.cfg.autoRematch = true;
    // The first scan may already have seen the dialog while AFK was off; make
    // the next one a fresh transition, which is what queues the rematch.
    api.state.gameOverSeen = false;
    const pressed = [];
    const button = window.document.querySelector('.game-over-modal-shell-container .cc-button-component');
    button.addEventListener('click', () => pressed.push(button.textContent));
    assert.equal(api.isGameOverDom(), true, 'the dialog is found');
    assert.equal(api.scanBoard('w').gameOver, true, 'the scan sees a finished game');
    // The human delay is 1.7–4.2 s and the scan runs every 2 s; the budget has
    // to cover the worst case, not the average one.
    const ok = await until(() => pressed.length > 0, 15000);
    assert.ok(ok, `no rematch; afk=${api.cfg.autoRematch} warn=${api.state.warn} seen=${api.state.gameOverSeen} tried=${api.state.rematchTried}` +
      ` scanning=${Boolean(api.state.analysis)} thinking=${api.state.thinking} lastScanAt=${api.state.lastScanAt} modal=${window.document.querySelectorAll('.game-over-modal-title-component').length}`);
    assert.deepEqual(pressed, ['Rematch'], 'the first choice, not a random button');
    assert.equal(api.state.gameOverSeen, true, 'the game over was seen');
    assert.equal(api.state.rematchAttempts, 1, 'pressed once, not in a loop');
    assert.equal(api.state.results.win, 1, 'the dialog said "tester won" and the account is tester');
    assert.equal(api.state.results.loss, 0);
    const stored = JSON.parse(window.localStorage.getItem('chess-wraith-session-v1:tester'));
    assert.deepEqual({ ...stored.results }, { win: 1, loss: 0, draw: 0 }, 'and the score is in the session, not just in memory');
    const last = api.state.events[api.state.events.length - 1];
    assert.match(last.text, /rematch/i, 'the press landed in the history');
    assert.ok(api.state.events.length <= 5, 'and the history stays short');
  } finally {
    stop();
  }
});

test('a reload keeps the session limit instead of resetting it', async () => {
  const startedAt = Date.now() - 40 * 60 * 1000;
  const { api, stop } = boot(PAGE, (store) => {
    store.setItem('chess-wraith-settings-v1:tester', JSON.stringify({ autoPlayOnLoad: true }));
    store.setItem('chess-wraith-session-v1:tester', JSON.stringify({ startedAt, games: 6 }));
  });
  try {
    assert.ok(await until(() => api.state.gamesPlayed === 6, 5000), 'six games came back');
    assert.equal(api.state.sessionStart, startedAt, 'the clock did not restart');
    assert.equal(api.state.autoPlay, true, 'auto play restored with it');
    assert.ok(api.state.events.some((item) => /resumed/i.test(item.text)), 'and the history says so');
  } finally {
    stop();
  }
});

test('the history is per account, so a second login does not inherit the night', async () => {
  const { window, api, stop } = boot();
  try {
    window.localStorage.setItem('chess-wraith-history-v1:other', JSON.stringify([
      { at: Date.now(), text: 'session limit: 3h' }
    ]));
    api.adoptAccountSettings('other');
    assert.equal(api.state.events.length, 1, 'the stored line came back');
    assert.equal(api.state.events[0].text, 'session limit: 3h');
    assert.equal(api.state.settingsAccount, 'other');
  } finally {
    stop();
  }
});

test('boot reaches the engine and asks it for a move', async () => {
  const { api, stop } = boot();
  try {
    await wait(1400);
    assert.ok(api.state.analysis, 'an analysis exists');
    assert.ok(Array.isArray(api.state.analysis.lines) && api.state.analysis.lines.length > 0, 'with lines');
    assert.equal(api.state.analysis.lines[0].bestUci.slice(0, 4), 'e2e4', 'the engine answer reached the panel');
  } finally {
    stop();
  }
});

test('the panic key stops the session instead of only hiding the panel', () => {
  const { window, api, stop } = boot();
  try {
    api.state.autoPlay = true;
    api.cfg.autoRematch = true;
    api.cfg.autoPlayOnLoad = true;
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 's', altKey: true, shiftKey: true }));
    assert.equal(api.state.autoPlay, false, 'auto play is off');
    assert.equal(api.cfg.autoRematch, false, 'AFK is off');
    assert.equal(api.cfg.autoPlayOnLoad, false, 'and it will not re-arm on the next load');
    assert.equal(api.panel.hidden, true, 'the panel is gone');
    assert.match(api.state.events[0].text, /panic stop/, 'and the history says why');
  } finally {
    stop();
  }
});
test('a game played as black scores from the colour on screen, not a default', async () => {
  // The board is flipped because we are Black. The dialog says White won, so
  // this is a loss. Before the snapshot carried `flipped`, everything downstream
  // answered "white" and this counted as a win.
  const html = MIDGAME.replace('class="board"', 'class="board flipped"') +
    '<div class="board-modal-container-container" style="position:fixed">' +
    '<div class="board-modal-component"><div class="game-over-modal-shell-container">' +
    '<div class="game-over-modal-header-component"><div class="game-over-modal-title-component">White Won</div>' +
    '<div class="game-over-modal-subtitle-component">by checkmate</div></div></div></div></div>';
  const { api, stop } = boot(html);
  try {
    api.cfg.autoRematch = false;
    assert.equal(await until(() => api.state.gameOverSeen && api.state.snapshot), true, 'the dialog is seen');
    assert.equal(api.state.snapshot.flipped, true, 'the snapshot knows the board is flipped');
    assert.equal(api.state.results.loss, 1, 'White won and we are Black');
    assert.equal(api.state.results.win, 0);
  } finally {
    stop();
  }
});
test('the strength asked of the engine is the account\'s own rating', async () => {
  // The harness profile is 1480 rapid with 80 games, so the rating is settled.
  const { api, stop } = boot();
  try {
    assert.equal(await until(() => api.state.eloSource === 'account', 9000), true, 'the profile rating is adopted');
    assert.ok(api.state.formOffset >= -30 && api.state.formOffset <= 30, 'form stays a bad day or a good one');
    assert.ok(api.state.effectiveElo >= 1405 && api.state.effectiveElo <= 1505,
      `effectiveElo ${api.state.effectiveElo} outside the account envelope`);
    assert.ok(api.state.effectiveElo <= 1480 + 25, 'never asked to play above the account plus a hair');
  } finally {
    stop();
  }
});
test('a signed-out tab plays at the documented default, not the engine floor', async () => {
  // No navbar name and a 404 from the stats endpoint: the fallback chain is
  // manual target, then 1500. It used to be null, which the engine clamps to 1320.
  const { api, stop } = boot(PAGE, null, { signedOut: true });
  try {
    assert.equal(await until(() => api.state.eloSource !== 'target', 6000), true, 'the source is decided');
    assert.equal(api.state.eloSource, 'default');
    assert.equal(api.state.effectiveElo, 1500, 'the documented default, not the floor');
  } finally {
    stop();
  }
});
test('learning the opponent\'s rating re-anchors the strength in the same game', async () => {
  // No account, so there is no async profile fetch to race: base is the
  // documented 1500 and form is 0. Opponent 1000 wants 1130, the envelope floor
  // is 1425, so the answer is exactly 1425 — the boot value was 1500.
  const { api, stop } = boot(RATED, null, { signedOut: true });
  try {
    assert.equal(await until(() => api.state.opponentRating === 1000, 9000), true, 'the rating is read');
    assert.equal(api.state.effectiveElo, 1425, 'the envelope floor, in the same game');
    // A second scan of the same page must not move it again.
    await new Promise((resolve) => setTimeout(resolve, 2400));
    assert.equal(api.state.effectiveElo, 1425, 'stable across scans');
  } finally {
    stop();
  }
});
