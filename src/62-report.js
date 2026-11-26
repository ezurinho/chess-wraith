// The card after every game: what the engine saw, not what the result screen says.
// Every number here is already computed during play (the loss of each chosen
// move, the swing of each opponent move); this file only turns them into one
// readable line. ACPL is the honest metric; chess.com's accuracy percentage is
// their own formula and is not reproduced.

// Centipawn loss to a rating. Same curve as the opponent estimate, so the two
// numbers on the panel cannot disagree about what 'like 1800' means. It is a
// fit, not a measurement: the panel says 'like'.
function performanceFromAcpl(acpl) {
  // Number(null) is 0, and 0 would be a perfect game: a missing sample must
  // stay missing.
  if (acpl === null || acpl === undefined || acpl === '') return null;
  const value = Number(acpl);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(clamp(2750 - 380 * Math.log1p(value / 3.8), 1050, 2850));
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
