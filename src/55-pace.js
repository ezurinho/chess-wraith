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
function archiveGames(user, offset) {
  const key = `${String(user).toLowerCase()}|${monthPath(offset)}`;
  const hit = archiveReads.get(key);
  if (hit) return hit;
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
  archiveReads.set(key, pending);
  pending.catch(() => archiveReads.delete(key));
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
      const games = await archiveGames(user, offset);
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
      const parsed = repertoireFromGames(await archiveGames(user, offset), user);
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