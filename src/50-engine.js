// Local Stockfish 19 NNUE. The engine ships as a classic worker script plus a
// .wasm sidecar. A blob worker cannot see its own directory, and the build does
// not ask for "stockfish.wasm" either: it builds the name from self.location.href
// plus a content hash, so the request looks like
//   https://www.chess.comhttps://www.chess.com/554211df-...
// Matching on ".wasm" therefore never fired and NNUE silently failed. The shim
// below answers every request that is not the engine's own script with the wasm
// bytes from the mirror, which is the only other thing this build fetches.
// Verified in Chrome on chess.com: blob workers and WASM compile are not blocked
// by the page CSP, and the engine answers uci in ~110 ms.

// Pure: the worker preamble. The engine fetches exactly two things, its own
// script (never, it is already inlined) and its wasm sidecar, so everything that
// is not the script URL is answered with the wasm from the mirror.
function buildNnueShim(wasmUrl, engineJsUrl) {
  return (
    `self.__CW_WASM=${JSON.stringify(wasmUrl)};` +
    `self.__CW_JS=${JSON.stringify(engineJsUrl)};` +
    '(function(){var real=self.fetch?self.fetch.bind(self):null;if(!real)return;' +
    'self.fetch=function(u,o){var s=String(u&&u.url?u.url:u);' +
    'if(s===self.__CW_JS)return real(u,o);' +
    'return real(self.__CW_WASM,o);};})();\n'
  );
}

// 5 s, 20 s, 60 s, then every five minutes.
const RETRY_BACKOFF_MS = [5000, 20000, 60000, 300000];

// A fetch that never left the machine throws TypeError; an edge that is not
// ready answers 5xx. Both mean "try again" and neither is a verdict about the
// build, so neither may poison the NNUE skip cache.
function isNetworkError(err) {
  if (!err) return false;
  if (err.name === 'TypeError') return true;
  return /^HTTP 5\d\d/.test(String(err.message || ''));
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// SHA-256 is the gate in front of every Worker. In a non-secure context there
// is no subtle crypto; that is a reason to stay offline, not a reason to run
// unverified bytes.
async function sha256Hex(buffer) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle || typeof subtle.digest !== 'function') throw new Error('SHA-256 unavailable in this context');
  return toHex(await subtle.digest('SHA-256', buffer));
}

// What the engine says it is, not what we hoped it was. The panel prints this
// string and the debug report repeats it, so a build served from another tag
// must not be mislabelled by a constant: the vendored worker answers
// `id name Stockfish 19 Lite WASM` (measured 2026-11-26 in the browser).
function engineLabel(idName, nnue) {
  // The JS fallback has its own name whatever number it carries.
  if (!nnue) return 'Stockfish 2019 JS';
  const match = /Stockfish\s+(\d+(?:\.\d+)?)/i.exec(String(idName || ''));
  return match ? `Stockfish ${match[1]} NNUE` : 'Stockfish 19 NNUE';
}

class WraithEngine {
  constructor() {
    this.worker = null;
    this.mode = 'offline';
    this.ready = false;
    this.searching = false;
    this.lines = new Map();
    this.search = null;
    this.onProgress = null;
    this.onReady = null;
    this.onError = null;
    this.lastOptions = {};
    this.booted = null;
    this.watchdogTimer = null;
    // Not derived from the mode string: "Stockfish 2019 JS" contains "19" too,
    // and that made the fallback take the NNUE-only option path.
    this.nnue = false;
    this.nnueRetried = false;
    this.recovering = false;
    this.recoveries = 0;
    // Boot can fail for reasons that outlive a page load: no network, a CDN
    // edge that has not warmed, a captive portal. Retrying is the difference
    // between a script that recovers and one that stays offline until reload.
    this.retryTimer = null;
    this.retryAttempt = 0;
    this.retryDelay = 0;
    this.retryAt = 0;
    // A verified wasm body is handed to the worker as a blob URL. It must live
    // as long as that worker and be revoked when the worker is replaced.
    this.assetUrls = [];
  }

  #clearAssetUrls() {
    for (const url of this.assetUrls) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* already revoked */
      }
    }
    this.assetUrls = [];
  }

  async boot() {
    if (!this.booted) this.booted = this.#bootInner();
    try {
      await this.booted;
    } finally {
      this.booted = null;
    }
  }

  async ensureReady() {
    if (this.ready) return true;
    if (!this.worker) {
      try {
        await this.boot();
      } catch (err) {
        this.onError && this.onError(err && err.message ? err.message : 'engine boot failed');
      }
    }
    const started = Date.now();
    while (!this.ready && Date.now() - started < 9000) await sleep(90);
    return this.ready;
  }

  async #bootInner() {
    // The NNUE build cannot find its .wasm from a blob worker, so after the
    // first failure the four second handshake is pure delay. Remember the
    // verdict for a week instead of paying it on every page load.
    if (readNnueSkip()) {
      try {
        await this.#spawn(false);
        return;
      } catch (err) {
        // A pinned hash failure is not a reason to stay quietly offline: the
        // backoff may see a repaired mirror, and until then no worker exists.
        this.#scheduleRetry(err);
        throw err;
      }
    }
    try {
      try {
        await this.#spawn(true);
        return;
      } catch (err) {
        // Only a failed *fallback* proves the build is the problem. A fetch
        // that dies on the way to the CDN says nothing about NNUE, and
        // remembering that verdict for a week would downgrade every later
        // load because of one bad minute of Wi-Fi.
        this.nnueFailure = err;
        this.onError && this.onError(`NNUE engine unavailable (${err.message}); trying the JS engine`);
      }
      await this.#spawn(false);
      if (!isNetworkError(this.nnueFailure)) rememberNnueSkip();
    } catch (err) {
      this.#scheduleRetry(err);
      throw err;
    }
  }

  // 5 s, 20 s, 60 s, then every 5 minutes. A laptop that slept through a
  // Wi-Fi blip recovers on its own; one that is genuinely offline costs a
  // timer every five minutes and nothing else.
  #scheduleRetry(err) {
    this.mode = 'offline';
    this.ready = false;
    if (this.retryTimer) return;
    this.retryAttempt += 1;
    const delay = RETRY_BACKOFF_MS[Math.min(this.retryAttempt - 1, RETRY_BACKOFF_MS.length - 1)];
    this.retryDelay = delay;
    this.retryAt = Date.now() + delay;
    const seconds = Math.round(delay / 1000);
    this.onError && this.onError(`engine offline (${err && err.message ? err.message : 'boot failed'}); retrying in ${seconds}s`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.booted = null;
      this.boot().catch(() => {});
    }, delay);
  }

  // Kill the worker, unblock whoever is waiting on it, and boot a fresh one in
  // the background. One recovery at a time: a worker that fails while the
  // replacement is still booting must not start a boot loop.
  #recover(reason) {
    // Two attempts per crash cluster: a worker that cannot start at all must not
    // spin, and the counter is cleared by the next readyok. Past that the
    // cluster is not a crash, it is a dead engine, and the backoff owns it.
    if (this.recovering) return;
    if (this.recoveries >= 2) {
      this.#scheduleRetry(new Error(reason || 'engine keeps failing'));
      return;
    }
    this.recoveries += 1;
    this.recovering = true;
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = null;
    try {
      this.worker && this.worker.terminate();
    } catch {
      /* already gone */
    }
    const pending = this.search;
    this.worker = null;
    this.ready = false;
    this.booted = null;
    this.searching = false;
    this.search = null;
    this.lines = new Map();
    this.#clearAssetUrls();
    this.onError && this.onError(reason);
    if (pending && pending.resolve) pending.resolve([]);
    this.#bootInner()
      .catch(() => {})
      .finally(() => {
        this.recovering = false;
      });
  }

  async #spawn(preferNnue) {
    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {
        /* already gone */
      }
    }
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
    if (this.uciRetryTimer) clearTimeout(this.uciRetryTimer);
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = null;
    this.worker = null;
    this.ready = false;
    this.searching = false;
    this.#clearAssetUrls();

    const source = preferNnue ? await this.#nnueWorkerSource() : await this.#plainWorkerSource();
    this.mode = preferNnue ? 'Stockfish 19 NNUE' : 'Stockfish 2019 JS';
    this.nnue = Boolean(preferNnue);
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    this.worker = worker;

    worker.onmessage = (event) => this.#onLine(event.data);
    worker.onerror = (event) => {
      if (preferNnue) {
        rememberNnueSkip();
        this.onError && this.onError('NNUE worker failed to start; using the JS engine');
        this.#spawn(false).catch((err) => this.#scheduleRetry(err));
        return;
      }
      // A worker that dies after booting keeps `ready` true, so every search
      // after it waits out the full budget before the watchdog notices. Rebuild
      // now instead of losing a move to the handshake.
      this.#recover(event && event.message ? event.message : 'engine worker error');
    };

    this.#send('uci');
    // A worker that boots asynchronously can drop the first message. Ask again
    // once, then give the whole handshake a deadline.
    this.uciRetryTimer = setTimeout(() => {
      if (!this.ready && this.worker === worker) this.#send('uci');
    }, 1200);
    // 1.2 MB of wasm on a cold CDN edge compiles slower than the 2019 build,
    // so NNUE gets a longer deadline — and one silent second chance, because
    // the first request for a brand-new tag can 404 before jsDelivr warms it.
    this.handshakeTimer = setTimeout(() => {
      if (this.ready || this.worker !== worker) return;
      if (preferNnue) {
        if (!this.nnueRetried) {
          this.nnueRetried = true;
          try {
            worker.terminate();
          } catch {
            /* already gone */
          }
          this.worker = null;
          // The second NNUE attempt failing is a boot failure like any other.
          this.#spawn(true).catch((err) => this.#scheduleRetry(err));
          return;
        }
        rememberNnueSkip();
        this.onError && this.onError('NNUE engine did not start; using the JS engine');
        this.#spawn(false).catch((err) => this.#scheduleRetry(err));
      } else {
        // A worker that spawns and never says uciok is not a network problem
        // the fetch could see: the script arrived and died compiling, or the
        // page blocked the worker. It still has to enter the backoff, or the
        // engine is dead until someone reloads.
        try {
          worker.terminate();
        } catch {
          /* already gone */
        }
        this.worker = null;
        this.#scheduleRetry(new Error('engine did not answer uci'));
      }
    }, preferNnue ? 6500 : 4000);
  }

  async #fetchBytes(url) {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : 0} for ${url}`);
    const bytes = await res.arrayBuffer();
    if (!bytes || !bytes.byteLength) throw new Error(`empty engine body for ${url}`);
    return bytes;
  }

  // The only place engine bytes enter the page. Size first, then hash: a body
  // that passed both is the body the release pinned, and only then is it
  // allowed to become a Worker (or an inlined script).
  async #verifiedBytes(kind) {
    const bytes = await this.#fetchBytes(ENGINE_FILES[kind]);
    const expectedSize = ENGINE_BYTES[kind];
    const expectedHash = ENGINE_SHA256[kind];
    if (!expectedHash) throw new Error(`engine integrity: no SHA-256 pinned for ${kind}`);
    if (bytes.byteLength !== expectedSize) {
      throw new Error(`engine integrity: size mismatch for ${kind} (${bytes.byteLength} != ${expectedSize})`);
    }
    const actual = await sha256Hex(bytes);
    if (actual !== expectedHash) {
      throw new Error(`engine integrity: SHA-256 mismatch for ${kind} (${actual.slice(0, 12)}... != ${expectedHash.slice(0, 12)}...)`);
    }
    return bytes;
  }

  async #nnueWorkerSource() {
    const [js, wasm] = await Promise.all([
      this.#verifiedBytes('nnueJs'),
      this.#verifiedBytes('nnueWasm')
    ]);
    // The shim needs a URL, but the bytes are already verified. A blob keeps the
    // worker from fetching the sidecar a second time behind our back.
    const wasmUrl = URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' }));
    this.assetUrls.push(wasmUrl);
    const code = new TextDecoder().decode(js);
    return buildNnueShim(wasmUrl, ENGINE_FILES.nnueJs) + code;
  }

  async #plainWorkerSource() {
    return new TextDecoder().decode(await this.#verifiedBytes('fallbackJs'));
  }

  #send(cmd) {
    if (this.worker) this.worker.postMessage(cmd);
  }

  #onLine(raw) {
    const line = typeof raw === 'string' ? raw.trim() : '';
    if (!line) return;

    if (line.startsWith('id name ')) {
      this.idName = line.slice(8).trim();
      this.mode = engineLabel(this.idName, this.nnue);
      return;
    }

    if (line === 'uciok') {
      if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
      if (this.uciRetryTimer) clearTimeout(this.uciRetryTimer);
      this.#send(`setoption name Hash value ${CONFIG.hashMb}`);
      if (this.nnue) this.#send('setoption name UCI_ShowWDL value true');
      this.#send('isready');
      return;
    }

    if (line === 'readyok') {
      this.ready = true;
      this.recoveries = 0;
      // It came back: the backoff starts over, so the next outage retries fast.
      this.retryAttempt = 0;
      this.retryDelay = 0;
      this.retryAt = 0;
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = null;
      // It booted: whatever we remembered about this mirror is wrong now.
      if (this.nnue) forgetNnueSkip();
      if (this.handshakeTimer) clearTimeout(this.handshakeTimer);
      this.onReady && this.onReady(this.mode);
      return;
    }

    if (line.startsWith('bestmove ')) {
      this.#finish(line);
      return;
    }

    if (line.startsWith('info ') && this.searching && this.search) {
      const info = Chess.parseUciInfoLine(line);
      if (!info || info.bound || !info.pv || info.pv.length === 0) return;
      this.lines.set(info.multipv, info);
      if (info.depth >= 6) this.#emit(false);
    }
  }

  #emit(final, bestmove) {
    if (!this.search) return;
    const payload = {
      fen: this.search.fen,
      turn: this.search.turn,
      flipped: this.search.flipped,
      lines: this.#formatted(),
      bestmove: bestmove || (this.lines.get(1) && this.lines.get(1).pv[0]) || null,
      depth: this.search.depth,
      final,
      engine: this.mode
    };
    if (final) this.onFinal && this.onFinal(payload);
    else this.onProgress && this.onProgress(payload);
  }

  #formatted() {
    if (!this.search) return [];
    const turn = this.search.turn;
    const fen = this.search.fen;
    return Array.from(this.lines.entries())
      .sort((a, b) => a[0] - b[0])
      .slice(0, this.search.multiPv)
      .map(([, info]) => {
        const { whiteCp, whiteMate } = Chess.normalizeScoreForWhite(info.scoreCp, info.mateIn, turn);
        return {
          multipv: info.multipv,
          depth: info.depth,
          scoreCp: info.scoreCp,
          mateIn: info.mateIn,
          whiteCp,
          whiteMate,
          wdl: info.wdl ? Chess.normalizeWdlForWhite(info.wdl, turn) : null,
          evalText: Chess.formatEvalText(whiteCp, whiteMate),
          pv: info.pv,
          bestUci: info.pv[0] || null,
          bestSan: (Chess.pvToSan(fen, info.pv.slice(0, 1)) || [])[0] || null,
          sanLine: Chess.formatPvWithNumbers(fen, info.pv, 6)
        };
      });
  }

  #finish(line) {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    const parts = line.split(/\s+/);
    const bestmove = parts[1] && parts[1] !== '(none)' ? parts[1] : null;
    const search = this.search;
    this.searching = false;
    this.#emit(true, bestmove);
    if (this.search && this.search.resolve) this.search.resolve(this.#formatted());
    this.search = null;
    if (search && search.queued) this.#runNow(search.queued);
  }

  async analyze(request) {
    const hasMoves = Array.isArray(request && request.uciMoves) && request.uciMoves.length > 0;
    if (!request || (!hasMoves && !request.fen)) return [];
    const ready = await this.ensureReady();
    if (!ready) return [];
    return new Promise((resolve) => {
      const job = { ...request, resolve };
      if (this.searching) {
        this.#send('stop');
        if (this.search) this.search.queued = job;
        return;
      }
      this.#runNow(job);
    });
  }

  #runNow(job) {
    this.#applyOptions(job);
    this.lines = new Map();
    this.search = job;
    this.searching = true;
    // An empty move list is not a position. `positionMoves([])` answers
    // `position startpos`, which would have the engine analyse the opening
    // while the board sits in the middlegame or the endgame.
    const hasMoves = Array.isArray(job.uciMoves) && job.uciMoves.length > 0;
    this.#send(hasMoves ? positionMoves(job.uciMoves) : `position fen ${job.fen}`);
    const depth = clampInt(job.depth, 4, 22, CONFIG.maxDepth);
    const movetime = clampInt(job.moveTimeMs, 120, 6000, CONFIG.moveTimeMs);
    // `searchmoves` makes the engine judge candidates the wider search left
    // out, which is how a repertoire move gets an eval of its own and how a
    // beginner move gets a measured price instead of a claimed one. A list is
    // allowed: the restricted MultiPV reports one line per candidate.
    const only = searchmoveList(job.searchmoves);
    const onlyFlag = only.length ? ` searchmoves ${only.join(' ')}` : '';
    this.#send(`go depth ${depth} movetime ${movetime}${onlyFlag}`);
    this.#armWatchdog(job);
  }

  // A worker can accept `go` and never answer. Without this the panel keeps
  // saying "thinking" and the scan loop waits on a search that ended nowhere.
  #armWatchdog(job) {
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = setTimeout(() => {
      this.watchdogTimer = null;
      if (!this.search || this.search !== job) return;
      this.onError && this.onError('engine stopped answering; retrying');
      this.#send('stop');
      this.watchdogTimer = setTimeout(() => {
        this.watchdogTimer = null;
        if (this.search !== job) return;
        this.search = null;
        this.searching = false;
        this.lines = new Map();
        this.onFinal && this.onFinal({
          fen: job.fen,
          turn: job.turn,
          flipped: job.flipped,
          lines: [],
          bestmove: null,
          depth: 0,
          final: true,
          engine: this.mode
        });
        if (job.resolve) job.resolve([]);
        this.#recover('engine stopped answering; rebuilt');
      }, 2500);
    }, searchBudgetMs(job));
  }

  // Drop the remembered NNUE verdict and try the full engine once more.
  async retryNnue() {
    forgetNnueSkip();
    this.nnueRetried = false;
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = null;
    try {
      this.worker && this.worker.terminate();
    } catch {
      /* already gone */
    }
    this.worker = null;
    this.ready = false;
    this.booted = null;
    this.searching = false;
    this.search = null;
    this.#clearAssetUrls();
    await this.boot();
    return this.mode;
  }

  #applyOptions(job) {
    const elo = job.elo;
    const limit = Number.isFinite(elo) && elo > 0;
    if (this.nnue) {
      this.#send(`setoption name UCI_LimitStrength value ${limit ? 'true' : 'false'}`);
      if (limit) this.#send(`setoption name UCI_Elo value ${clampInt(elo, 1320, 3190, 1650)}`);
      this.#send(`setoption name Skill Level value ${clampInt(job.skill, 0, 20, 20)}`);
    } else {
      // The 2019 build has no UCI_Elo: Skill Level is the whole strength dial.
      const skill = limit ? eloToSkill(elo) : clampInt(job.skill, 0, 20, 20);
      if (this.lastOptions.skill !== skill) {
        this.#send(`setoption name Skill Level value ${skill}`);
        this.lastOptions.skill = skill;
      }
    }
    // One restricted move is asked about once; a list is asked for one line
    // each, because the point is comparing the candidates. A normal search
    // keeps the setting's full 1-10 range: 1.86.0 raised the default to eight
    // lines, but this clamp still cut them to five before `go`.
    const restricted = searchmoveList(job.searchmoves).length;
    const multiPv =
      restricted > 1
        ? clampInt(job.multiPv, 1, Math.min(10, restricted), restricted)
        : clampInt(restricted === 1 ? 1 : job.multiPv, 1, 10, 1);
    if (this.lastOptions.multiPv !== multiPv) {
      this.#send(`setoption name MultiPV value ${multiPv}`);
      this.lastOptions.multiPv = multiPv;
    }
  }

  stop() {
    if (this.searching) this.#send('stop');
    if (this.search) this.search.queued = null;
  }

  destroy() {
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    try {
      this.#send('quit');
      this.worker && this.worker.terminate();
    } catch {
      /* closing the tab is enough */
    }
    this.worker = null;
    this.search = null;
    this.searching = false;
    this.#clearAssetUrls();
    // A destroyed engine that still reports ready is a trap: the next search
    // posts into nothing and the watchdog pays the whole budget to find out.
    this.ready = false;
    this.booted = null;
    this.lastOptions = {};
  }
}

// A restricted search may be about one move or about a list of candidates. A
// malformed entry is dropped, never forwarded as a command.
function searchmoveList(value) {
  return String(value || '')
    .trim()
    .split(/\s+/)
    .filter((move) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move));
}

function positionMoves(uciMoves) {
  if (!Array.isArray(uciMoves) || uciMoves.length === 0) return 'position startpos';
  return `position startpos moves ${uciMoves.join(' ')}`;
}
