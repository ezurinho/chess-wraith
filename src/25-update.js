// Update channel: the same shape as NITRO WRAITH, smaller.
// 
// The script cannot replace itself (Tampermonkey owns that), but it can find a
// newer release, show it in the panel and hand the installer a download URL.
// GitHub's release asset does not send CORS headers, so the check reads the
// public API first and the raw meta file as a mirror. Neither request carries
// credentials.

const UPDATE_API_URL = 'https://api.github.com/repos/ezurinho/chess-wraith/releases/latest';
const UPDATE_MIRROR_META_URL = 'https://raw.githubusercontent.com/ezurinho/chess-wraith/main/chess-wraith.meta.js';
const UPDATE_DOWNLOAD_URL = 'https://github.com/ezurinho/chess-wraith/releases/latest/download/chess-wraith.user.js';
const UPDATE_STATE_KEY = 'chess-wraith-update-v1';
const UPDATE_AUTO_KEY = 'chess-wraith-auto-update';
const UPDATE_CHECK_MS = 5 * 60 * 1000;
const UPDATE_MIN_GAP_MS = 60 * 1000;
const UPDATE_AUTO_DELAY_MS = 12000;
const UPDATE_AUTO_RETRY_MS = 20000;
const UPDATE_AUTO_COOLDOWN_MS = 30 * 60 * 1000;

function semverParts(value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareVersions(a, b) {
  const left = semverParts(a);
  const right = semverParts(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

function metaVersion(text) {
  const match = String(text || '').match(/^\/\/\s*@version\s+(\S+)/m);
  return match ? match[1] : '';
}

let updateCache = { latest: '', via: 'api', checkedAt: 0, status: 'idle', error: '' };
let updateLoaded = false;
let updateBusy = false;
let updateArm = null;
let updateBlockedUntil = 0;
let updateTickTimer = null;
let updateLoopTimer = null;
let updateListener = null;
let updateLastCheck = 0;
let updateSafetyFn = () => (typeof document === 'undefined' ? true : !document.hidden);

function loadUpdateCache() {
  if (updateLoaded) return;
  updateLoaded = true;
  try {
    const raw = JSON.parse(localStorage.getItem(UPDATE_STATE_KEY) || 'null');
    if (raw && typeof raw === 'object' && semverParts(raw.latest)) {
      updateCache = {
        latest: String(raw.latest),
        via: raw.via === 'mirror' ? 'mirror' : 'api',
        checkedAt: Number(raw.checkedAt) || 0,
        status: raw.status === 'error' ? 'error' : 'ok',
        error: typeof raw.error === 'string' ? raw.error : ''
      };
    }
  } catch {
    /* storage can be blocked; the check still runs in memory */
  }
}

function saveUpdateCache() {
  try {
    localStorage.setItem(UPDATE_STATE_KEY, JSON.stringify(updateCache));
  } catch {
    /* storage can be blocked */
  }
}

function autoUpdateEnabled() {
  try {
    return localStorage.getItem(UPDATE_AUTO_KEY) !== '0';
  } catch {
    return true;
  }
}

function setAutoUpdateEnabled(on) {
  try {
    localStorage.setItem(UPDATE_AUTO_KEY, on ? '1' : '0');
  } catch {
    /* storage can be blocked */
  }
  if (!on) cancelAutoUpdate('off');
}

function updateAvailable() {
  return Boolean(updateCache.latest) && compareVersions(updateCache.latest, VERSION) > 0;
}

function updateAgeLabel(checkedAt) {
  if (!checkedAt) return '–';
  const seconds = Math.max(0, Math.round((Date.now() - checkedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

function updateSnapshot() {
  const latest = updateCache.latest;
  const available = updateAvailable();
  const auto = autoUpdateEnabled();
  const phase = !available
    ? 'current'
    : !auto
      ? 'off'
      : updateArm
        ? 'armed'
        : Date.now() < updateBlockedUntil
          ? 'waiting'
          : 'ready';
  return {
    current: VERSION,
    latest,
    available,
    status: updateBusy ? 'checking' : updateCache.status,
    checkedAt: updateCache.checkedAt,
    age: updateAgeLabel(updateCache.checkedAt),
    via: updateCache.via,
    error: updateCache.error,
    auto,
    phase,
    leftMs: updateArm ? Math.max(0, updateArm.at - Date.now()) : 0,
    safe: updateSafetyFn()
  };
}

function setUpdateSafety(fn) {
  updateSafetyFn = typeof fn === 'function' ? fn : updateSafetyFn;
}

function notifyUpdate() {
  if (typeof updateListener === 'function') updateListener(updateSnapshot());
}

function updateLog(message, level = '') {
  try {
    if (typeof panel !== 'undefined' && panel && typeof panel.addLog === 'function') {
      panel.addLog(message, level);
    }
  } catch {
    /* the panel is not constructed yet */
  }
}

async function fetchText(url) {
  const controller = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), 8000) : null;
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'omit',
      signal: controller ? controller.signal : undefined
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// The public API gives the release tag without the asset CORS problem. The raw
// meta file is the mirror and also proves the artifact the badge points at.
async function checkForUpdate(force = false) {
  loadUpdateCache();
  if (updateBusy) return updateSnapshot();
  if (!force && Date.now() - updateLastCheck < UPDATE_MIN_GAP_MS) return updateSnapshot();
  updateLastCheck = Date.now();
  updateBusy = true;
  notifyUpdate();

  let version = '';
  let via = 'api';
  let error = '';
  try {
    const body = await fetchText(UPDATE_API_URL);
    const release = JSON.parse(body);
    const tag = release && typeof release.tag_name === 'string' ? release.tag_name : '';
    if (semverParts(tag)) version = tag.replace(/^v/, '');
    else throw new Error('release has no semver tag');
  } catch (apiError) {
    error = apiError && apiError.message ? apiError.message : String(apiError);
    try {
      const text = await fetchText(UPDATE_MIRROR_META_URL);
      const mirror = metaVersion(text);
      if (!mirror) throw new Error('mirror has no @version');
      version = mirror;
      via = 'mirror';
    } catch (mirrorError) {
      error = mirrorError && mirrorError.message ? mirrorError.message : String(mirrorError);
    }
  }

  if (version) {
    updateCache = { latest: version, via, checkedAt: Date.now(), status: 'ok', error: '' };
  } else {
    updateCache = {
      latest: updateCache.latest,
      via: updateCache.via,
      checkedAt: Date.now(),
      status: 'error',
      error
    };
  }
  updateBusy = false;
  saveUpdateCache();
  updateLog(
    version
      ? `update · latest v${version}${via === 'mirror' ? ' (mirror)' : ''}`
      : `update · check failed: ${error}`,
    version ? '' : 'warn'
  );
  notifyUpdate();
  if (updateAvailable()) maybeArmAutoUpdate();
  return updateSnapshot();
}

function autoUpdateSafe() {
  try {
    return Boolean(updateSafetyFn());
  } catch {
    return false;
  }
}

function autoUpdateState() {
  const snapshot = updateSnapshot();
  return {
    phase: snapshot.phase,
    enabled: snapshot.auto,
    version: snapshot.latest,
    leftMs: snapshot.leftMs,
    safe: snapshot.safe
  };
}

function cancelAutoUpdate(reason = '') {
  if (updateTickTimer) clearInterval(updateTickTimer);
  updateTickTimer = null;
  const hadArm = Boolean(updateArm);
  updateArm = null;
  if (reason === 'user' || reason === 'off') updateBlockedUntil = Date.now() + UPDATE_AUTO_COOLDOWN_MS;
  if (hadArm && reason === 'user') {
    updateLog('update · auto-install cancelled; the badge stays available');
  }
  notifyUpdate();
  return autoUpdateState();
}

function installUpdate() {
  if (!updateAvailable()) return '';
  updateBlockedUntil = Date.now() + UPDATE_AUTO_COOLDOWN_MS;
  updateLog(`update · installing v${updateCache.latest}`);
  try {
    location.assign(UPDATE_DOWNLOAD_URL);
  } catch {
    try {
      window.open(UPDATE_DOWNLOAD_URL, '_blank', 'noopener,noreferrer');
    } catch {
      /* both paths blocked; the badge remains a manual link */
    }
  }
  notifyUpdate();
  return UPDATE_DOWNLOAD_URL;
}

function autoUpdateTick() {
  if (!updateArm) return autoUpdateState();
  if (!autoUpdateSafe()) return cancelAutoUpdate('game');
  if (Date.now() >= updateArm.at) {
    if (updateTickTimer) clearInterval(updateTickTimer);
    updateTickTimer = null;
    updateArm = null;
    installUpdate();
    return autoUpdateState();
  }
  notifyUpdate();
  return autoUpdateState();
}

function installUpdateNow() {
  if (!updateAvailable()) return '';
  if (!autoUpdateSafe()) return '';
  if (updateTickTimer) clearInterval(updateTickTimer);
  updateTickTimer = null;
  updateArm = null;
  const url = installUpdate();
  updateLog(`update · installing v${updateCache.latest} now`);
  return url;
}

function armAutoUpdate() {
  if (!updateAvailable() || !autoUpdateEnabled() || updateArm) return autoUpdateState();
  if (Date.now() < updateBlockedUntil) return autoUpdateState();
  if (!autoUpdateSafe()) {
    updateBlockedUntil = Date.now() + UPDATE_AUTO_RETRY_MS;
    return autoUpdateState();
  }
  updateArm = { at: Date.now() + UPDATE_AUTO_DELAY_MS, version: updateCache.latest };
  if (!updateTickTimer) updateTickTimer = setInterval(autoUpdateTick, 1000);
  updateLog(`update · v${updateCache.latest} installs in 12 s unless a game starts`);
  notifyUpdate();
  return autoUpdateState();
}

function maybeArmAutoUpdate() {
  loadUpdateCache();
  if (!updateAvailable() || !autoUpdateEnabled() || updateArm) return null;
  if (Date.now() < updateBlockedUntil) return null;
  return armAutoUpdate();
}

function startUpdateLoop(onChange, safety) {
  loadUpdateCache();
  updateListener = typeof onChange === 'function' ? onChange : null;
  if (typeof safety === 'function') setUpdateSafety(safety);
  notifyUpdate();

  const schedule = () => {
    if (updateLoopTimer) clearInterval(updateLoopTimer);
    updateLoopTimer = setInterval(() => checkForUpdate(), UPDATE_CHECK_MS);
  };
  schedule();
  setTimeout(() => checkForUpdate(), 2500);

  const onVisible = () => {
    if (typeof document !== 'undefined' && !document.hidden) checkForUpdate();
  };
  const onOnline = () => checkForUpdate(true);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  if (typeof window !== 'undefined') window.addEventListener('online', onOnline);

  return function stopUpdateLoop() {
    if (updateLoopTimer) clearInterval(updateLoopTimer);
    updateLoopTimer = null;
    updateListener = null;
    if (updateTickTimer) clearInterval(updateTickTimer);
    updateTickTimer = null;
    updateArm = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
  };
}