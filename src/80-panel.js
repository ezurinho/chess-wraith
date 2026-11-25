// Shadow-DOM panel. No page styles, no light-DOM ids: the host is fixed,
// pointer-events:none, and only the card itself accepts the pointer.

const PANEL_CSS = `
:host{all:initial;font-family:Inter,"Segoe UI",system-ui,sans-serif}
.wrap{position:fixed;top:16px;right:16px;width:304px;box-sizing:border-box;pointer-events:auto;z-index:2147483000;
  color:#ece7dc;background:rgba(18,17,15,.96);border:1px solid #3a3630;border-radius:12px;
  box-shadow:0 16px 40px rgba(0,0,0,.55);overflow:hidden;font-size:12px;line-height:1.4;user-select:none}
.wrap.collapsed{width:auto}
.wrap.collapsed .body{display:none}
.head{display:flex;align-items:center;gap:8px;padding:8px 8px 8px 10px;background:#1d1b18;border-bottom:1px solid #33302b;cursor:grab}
.head:active{cursor:grabbing}
.brand{font-weight:700;letter-spacing:.4px;font-size:11px;color:#f0e9db;flex:1}
.brand small{font-weight:500;color:#8d877c;margin-left:6px;letter-spacing:0}
.dot{width:7px;height:7px;border-radius:50%;background:#4a443c;flex:none}
.dot.on{background:#39b57f}.dot.busy{background:#d8a84c}.dot.warn{background:#d9655f}
.body{padding:10px;display:flex;flex-direction:column;gap:8px}
.row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.eval{font-family:ui-monospace,Consolas,monospace;font-variant-numeric:tabular-nums;font-weight:700;
  font-size:15px;color:#6fe0b0;background:#0d0c0a;border:1px solid #2fa474;border-radius:7px;padding:2px 8px}
.eval.neg{color:#e08c8c;border-color:#7a4141}
.move{font-family:ui-monospace,Consolas,monospace;font-weight:700;font-size:16px;color:#f4efe4}
.meta{color:#948d80;font-size:10.5px;font-variant-numeric:tabular-nums}
.lines{background:#0d0c0a;border:1px solid #2b2721;border-radius:8px;padding:6px 7px;display:flex;flex-direction:column;gap:3px}
.line{display:flex;gap:6px;font-family:ui-monospace,Consolas,monospace;font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.line b{color:#6fe0b0;min-width:42px;flex:none}.line.alt b{color:#d8a84c}
.line span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.badge{font-size:9.5px;border:1px solid #3a3630;border-radius:999px;padding:1px 6px;color:#a29a8c}
.badge.live{border-color:#2fa474;color:#6fe0b0}
.badge.warn{border-color:#7a4141;color:#e08c8c}
.btns{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px}
button{font:inherit;font-size:10.5px;font-weight:600;color:#e6e0d3;background:#26221d;border:1px solid #3c3830;
  border-radius:7px;padding:6px 2px;cursor:pointer;min-width:0;box-sizing:border-box}
button:hover{background:#332e27}
button.on{background:rgba(57,181,127,.18);border-color:#2fa474;color:#7fe3b8}
button.active{background:#2a3a33;border-color:#2fa474}
.sep{height:1px;background:#2b2721;margin:1px 0}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
label{display:flex;flex-direction:column;gap:2px;font-size:10px;color:#948d80}
select,input[type=number]{font:inherit;font-size:11px;color:#ece7dc;background:#161513;border:1px solid #3a3630;border-radius:6px;padding:3px 5px}
input[type=range]{width:100%}
.hidden{display:none}
.foot{display:flex;justify-content:space-between;align-items:center;gap:6px}
.warnline{color:#d8a84c;font-size:10px}
`;

const PANEL_HTML = `
<div class="head" data-el="head">
  <span class="dot" data-el="dot"></span>
  <div class="brand">CHESS WRAITH <small data-el="engine">starting</small></div>
  <button type="button" data-el="min" style="border:none;background:none;padding:0 2px;font-size:13px;color:#8d877c">–</button>
</div>
<div class="body">
  <div class="row">
    <span class="eval" data-el="eval">–</span>
    <span class="move" data-el="best">–</span>
    <span class="badge" data-el="turn">–</span>
  </div>
  <div class="meta" data-el="meta">waiting for a board…</div>
  <div class="lines" data-el="lines"></div>
  <div class="meta" data-el="sub"></div>
  <div class="row">
    <span class="badge" data-el="mode">Auto: OFF</span>
    <span class="warnline" data-el="warn"></span>
  </div>
  <div class="btns">
    <button type="button" data-el="auto">Auto</button>
    <button type="button" data-el="step">Step</button>
    <button type="button" data-el="scan">Scan</button>
    <button type="button" data-el="conf">⚙</button>
  </div>
  <div class="sep"></div>
  <div class="grid hidden" data-el="settings">
    <label>Style
      <select data-el="style">
        <option value="adaptive">Adaptive</option>
        <option value="gm">GM-like</option>
        <option value="club">Club</option>
        <option value="casual">Casual</option>
        <option value="engine">Full engine</option>
      </select>
    </label>
    <label>Target Elo <input type="number" data-el="elo" min="1320" max="3190" step="10"></label>
    <label>Depth <input type="number" data-el="depth" min="4" max="20" step="1"></label>
    <label>Think ms <input type="number" data-el="movetime" min="150" max="5000" step="50"></label>
    <label>Min delay <input type="number" data-el="mint" min="250" max="6000" step="50"></label>
    <label>Max delay <input type="number" data-el="maxt" min="400" max="15000" step="100"></label>
    <label>Slack cp <input type="number" data-el="slack" min="0" max="300" step="5"></label>
    <label>Lines <input type="number" data-el="showLines" min="1" max="4" step="1"></label>
  </div>
  <div class="foot">
    <span class="meta">Alt+Shift+A auto · M step · H hide</span>
    <button type="button" data-el="hide">Hide</button>
  </div>
</div>
`;

class WraithPanel {
  constructor(cfg, handlers) {
    this.cfg = cfg;
    this.handlers = handlers;
    this.host = document.createElement('div');
    this.host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483000;';
    this.shadow = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    this.shadow.appendChild(style);

    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    wrap.innerHTML = PANEL_HTML;
    this.shadow.appendChild(wrap);
    this.wrap = wrap;
    this.el = {};
    for (const node of wrap.querySelectorAll('[data-el]')) this.el[node.dataset.el] = node;

    this.#wire();
    this.render();
    this.hidden = false;
  }

  mount() {
    if (!this.host.isConnected) (document.body || document.documentElement).appendChild(this.host);
  }

  unmount() {
    if (this.host.isConnected) this.host.remove();
  }

  #wire() {
    const on = (el, type, fn) => el && el.addEventListener(type, fn);
    on(this.el.auto, 'click', () => this.handlers.toggleAuto());
    on(this.el.step, 'click', () => this.handlers.step());
    on(this.el.scan, 'click', () => this.handlers.scan());
    on(this.el.hide, 'click', () => this.handlers.hide());
    on(this.el.conf, 'click', () => {
      this.el.settings.classList.toggle('hidden');
      this.el.conf.classList.toggle('active');
    });
    on(this.el.min, 'click', () => this.toggleCollapsed());
    on(this.el.head, 'dblclick', () => this.toggleCollapsed());

    const bindNumber = (el, key) => {
      if (!el) return;
      el.value = String(this.cfg[key]);
      on(el, 'change', () => {
        this.cfg[key] = clampInt(el.value, Number(el.min), Number(el.max), this.cfg[key]);
        el.value = String(this.cfg[key]);
        this.handlers.settingsChanged(this.cfg);
      });
    };
    bindNumber(this.el.elo, 'targetElo');
    bindNumber(this.el.depth, 'maxDepth');
    bindNumber(this.el.movetime, 'moveTimeMs');
    bindNumber(this.el.mint, 'minThinkMs');
    bindNumber(this.el.maxt, 'maxThinkMs');
    bindNumber(this.el.slack, 'humanSlackCp');
    bindNumber(this.el.showLines, 'showLines');

    on(this.el.style, 'change', () => {
      this.cfg.style = pickEnum(this.el.style.value, Object.keys(STYLES), 'adaptive');
      this.handlers.settingsChanged(this.cfg);
    });

    this.#drag();
  }

  #drag() {
    let dragging = false;
    let sx = 0;
    let sy = 0;
    let ox = 0;
    let oy = 0;
    this.el.head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      const r = this.wrap.getBoundingClientRect();
      sx = e.clientX;
      sy = e.clientY;
      ox = r.left;
      oy = r.top;
      this.wrap.style.right = 'auto';
      this.wrap.style.left = `${ox}px`;
      this.wrap.style.top = `${oy}px`;
    });
    window.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const maxLeft = Math.max(8, window.innerWidth - this.wrap.offsetWidth - 8);
      const maxTop = Math.max(8, window.innerHeight - 40);
      this.wrap.style.left = `${clamp(ox + e.clientX - sx, 8, maxLeft)}px`;
      this.wrap.style.top = `${clamp(oy + e.clientY - sy, 8, maxTop)}px`;
    });
    window.addEventListener('pointerup', () => {
      dragging = false;
    });
  }

  toggleCollapsed() {
    this.wrap.classList.toggle('collapsed');
    this.cfg.panelCollapsed = this.wrap.classList.contains('collapsed');
    this.handlers.settingsChanged(this.cfg);
  }

  toggleHidden() {
    this.hidden = !this.hidden;
    this.wrap.style.display = this.hidden ? 'none' : '';
    return this.hidden;
  }

  render(view = {}) {
    const { engine, analysis, autoPlay, turn, myTurn, status, warn, clock, opponent } = view;
    if (engine) this.el.engine.textContent = engine;
    this.el.dot.className = `dot ${status === 'thinking' ? 'busy' : analysis ? 'on' : warn ? 'warn' : ''}`;

    const top = analysis && analysis.lines && analysis.lines[0];
    if (top) {
      this.el.eval.textContent = top.evalText;
      this.el.eval.classList.toggle('neg', (top.whiteCp || 0) < -20);
      this.el.best.textContent = (analysis.bestSan || top.bestSan || top.bestUci || '–');
      this.el.meta.textContent = `d${top.depth} · ${analysis.engine || ''}${clock ? ` · ${Math.round(clock)}s` : ''}`;
      const linesBox = this.el.lines;
      linesBox.textContent = '';
      const take = Math.min(this.cfg.showLines, analysis.lines.length);
      for (let i = 0; i < take; i++) {
        const line = analysis.lines[i];
        const row = document.createElement('div');
        row.className = i === 0 ? 'line' : 'line alt';
        const b = document.createElement('b');
        b.textContent = line.evalText;
        const s = document.createElement('span');
        s.textContent = line.sanLine || (line.pv || []).join(' ');
        row.append(b, s);
        linesBox.appendChild(row);
      }
    } else {
      this.el.eval.textContent = '–';
      this.el.best.textContent = '–';
      this.el.meta.textContent = status === 'thinking' ? 'thinking…' : 'waiting for a board…';
    }

    this.el.turn.textContent = turn ? (turn === 'w' ? 'White' : 'Black') : '–';
    this.el.turn.className = `badge ${myTurn ? 'live' : ''}`;
    this.el.mode.textContent = autoPlay ? 'Auto: ON' : 'Auto: OFF';
    this.el.mode.className = `badge ${autoPlay ? 'live' : ''}`;
    this.el.auto.classList.toggle('on', Boolean(autoPlay));
    this.el.warn.textContent = warn || (opponent ? `opp ${opponent}` : '');
    const bits = [];
    if (view.acpl !== null && view.acpl !== undefined && view.acpl > 0) bits.push(`you ${Math.round(view.acpl)} acpl`);
    if (view.estimate) bits.push(`opp ~${view.estimate}`);
    if (view.elo) bits.push(`target ${view.elo}`);
    this.el.sub.textContent = bits.join(' · ');
    if (this.el.style.value !== this.cfg.style) this.el.style.value = this.cfg.style;
    this.el.settings.classList.toggle('hidden', !this.el.conf.classList.contains('active'));
  }
}
