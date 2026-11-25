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
    for (const ms of parsed) times.push(ms);
    used += 1;
  }
  // Thirty moves is the floor: below that one quick game moves the median.
  return { medianMs: times.length >= 30 ? median(times) : null, samples: times.length, games: used };
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
    for (const offset of [0, 1]) {
      // One timeout per request: a signal shared by both months leaves the
      // second request with whatever is left of the first one's budget.
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 10000) : null;
      const response = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/${monthPath(offset)}`, {
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: controller ? controller.signal : undefined
      });
      if (timer) clearTimeout(timer);
      if (!response || !response.ok) throw new Error(`HTTP ${response ? response.status : 0}`);
      const body = await response.json();
      const parsed = paceFromGames(body && body.games, timeClass, user);
      if (parsed.medianMs) { profile = parsed; break; }
    }
    if (!profile) throw new Error('no games');
    profile.cls = timeClass;
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