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
      await this.#spawn(false);
      return;
    }
    try {
      await this.#spawn(true);
    } catch (err) {
      rememberNnueSkip();
      this.onError && this.onError(`NNUE engine unavailable (${err.message}); using the JS engine`);
      await this.#spawn(false);
    }
  }

  // Kill the worker, unblock whoever is waiting on it, and boot a fresh one in
  // the background. One recovery at a time: a worker that fails while the
  // replacement is still booting must not start a boot loop.
  #recover(reason) {
    // Two attempts per crash cluster: a worker that cannot start at all must not
    // spin, and the counter is cleared by the next readyok.
    if (this.recovering || this.recoveries >= 2) return;
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
        this.#spawn(false).catch(() => {});
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
          this.#spawn(true).catch(() => this.#spawn(false).catch(() => {}));
          return;
        }
        rememberNnueSkip();
        this.onError && this.onError('NNUE engine did not start; using the JS engine');
        this.#spawn(false).catch(() => {});
      } else {
        this.onError && this.onError('engine did not answer uci');
      }
    }, preferNnue ? 6500 : 4000);
  }

  async #fetchText(url) {
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
  }

  async #nnueWorkerSource() {
    const code = await this.#fetchText(ENGINE_FILES.nnueJs);
    return buildNnueShim(ENGINE_FILES.nnueWasm, ENGINE_FILES.nnueJs) + code;
  }

  async #plainWorkerSource() {
    return this.#fetchText(ENGINE_FILES.fallbackJs);
  }

  #send(cmd) {
    if (this.worker) this.worker.postMessage(cmd);
  }

  #onLine(raw) {
    const line = typeof raw === 'string' ? raw.trim() : '';
    if (!line) return;

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
    this.#send(`go depth ${depth} movetime ${movetime}`);
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
    const multiPv = clampInt(job.multiPv, 1, 5, 1);
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
    try {
      this.#send('quit');
      this.worker && this.worker.terminate();
    } catch {
      /* closing the tab is enough */
    }
    this.worker = null;
    this.search = null;
    this.searching = false;
    // A destroyed engine that still reports ready is a trap: the next search
    // posts into nothing and the watchdog pays the whole budget to find out.
    this.ready = false;
    this.booted = null;
    this.lastOptions = {};
  }
}

function positionMoves(uciMoves) {
  if (!Array.isArray(uciMoves) || uciMoves.length === 0) return 'position startpos';
  return `position startpos moves ${uciMoves.join(' ')}`;
}
