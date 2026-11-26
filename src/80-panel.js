// Shadow-DOM panel, same design language as NITRO WRAITH: one token block, six
// themes that only move accents and background, a rail of views, cards with an
// accent spine, and motion that only explains state. Closed shadow root, so the
// page cannot style it and cannot find it by id.

const PANEL_CSS = `
:host{all:initial}
*,*::before,*::after{box-sizing:border-box}
@media (prefers-reduced-motion: reduce){
  .panel *,.panel *::before,.panel *::after{
    animation-duration:.001ms !important;animation-iteration-count:1 !important;
    transition-duration:.001ms !important;scroll-behavior:auto !important;
  }
}
.panel{
  --acc:#35ea86;--acc-2:#9bf7c5;
  --acc-dim:color-mix(in srgb,var(--acc) 14%,transparent);
  --line:color-mix(in srgb,var(--acc) 12%,transparent);
  --line-strong:color-mix(in srgb,var(--acc) 26%,transparent);
  --ink:#e9f7ef;--ink-2:#cfe9db;--dim:#7d9188;--dim-2:#7f9389;
  --warn:#ffb340;--bad:#ff6f6f;--info:#63c8ff;
  --ink-warn:color-mix(in srgb,var(--warn) 30%,var(--ink));
  --ink-bad:color-mix(in srgb,var(--bad) 25%,var(--ink));
  --ink-on-acc:#06110b;
  --card:rgba(255,255,255,.028);
  --bg-hi:rgba(12,17,14,.985);--bg-lo:rgba(5,8,6,.995);
  --font-ui:ui-sans-serif,-apple-system,'Segoe UI',system-ui,sans-serif;
  --font-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  position:fixed;top:16px;right:16px;z-index:2147483000;
  display:flex;flex-direction:column;width:322px;max-width:calc(100vw - 32px);
  max-height:calc(100vh - 32px);overflow:hidden;
  color:var(--ink);
  background:
    repeating-linear-gradient(0deg,rgba(255,255,255,.014) 0 1px,transparent 1px 3px),
    radial-gradient(120% 90% at 0% 0%,color-mix(in srgb,var(--acc) 10%,transparent),transparent 58%),
    radial-gradient(90% 80% at 100% 100%,color-mix(in srgb,var(--acc-2) 8%,transparent),transparent 62%),
    linear-gradient(168deg,var(--bg-hi),var(--bg-lo));
  border:1px solid var(--line-strong);border-radius:13px;
  box-shadow:0 22px 44px -18px rgba(0,0,0,.85),0 0 0 1px rgba(0,0,0,.6),
    0 0 34px -14px color-mix(in srgb,var(--acc) 50%,transparent),inset 0 1px 0 rgba(255,255,255,.05);
  font:12px/1.4 var(--font-mono);-webkit-font-smoothing:antialiased;user-select:none;
  animation:nt-boot .42s cubic-bezier(.2,.9,.25,1) both;
}
@keyframes nt-boot{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}
.panel,.panel[data-theme="carbon"]{color-scheme:dark}
.panel[data-theme="aurora"]{--acc:#3fe0c5;--acc-2:#a78bfa;--ink:#e8fbf7;--ink-2:#c3ece5;--dim:#7c9a98;--dim-2:#789693;--bg-hi:rgba(7,19,20,.985);--bg-lo:rgba(4,10,13,.995)}
.panel[data-theme="sunset"]{--acc:#ff9a5c;--acc-2:#ff77b0;--ink:#fff3ea;--ink-2:#f6d8c7;--dim:#a08a80;--dim-2:#9c877d;--bg-hi:rgba(24,12,11,.985);--bg-lo:rgba(12,6,8,.995)}
.panel[data-theme="ice"]{--acc:#66e3ff;--acc-2:#d7f7ff;--ink:#eefaff;--ink-2:#c9e9f6;--dim:#7e97a4;--dim-2:#7a93a0;--bg-hi:rgba(8,16,24,.985);--bg-lo:rgba(4,8,14,.995)}
.panel[data-theme="violet"]{--acc:#c08bff;--acc-2:#f0a9ff;--ink:#f7f0ff;--ink-2:#ddcbf2;--dim:#93849f;--dim-2:#8f809b;--bg-hi:rgba(18,11,27,.985);--bg-lo:rgba(8,5,14,.995)}
.panel[data-theme="rgb"]{
  --nt-hue:0;--acc:hsl(var(--nt-hue) 92% 72%);--acc-2:hsl(calc(var(--nt-hue) + 70) 94% 76%);
  --ink:#f6f7ff;--ink-2:#d9dcf0;--dim:#8d90a6;--dim-2:#8a8da3;
  --bg-hi:rgba(11,11,19,.985);--bg-lo:rgba(5,5,10,.995);
  animation:nt-boot .42s cubic-bezier(.2,.9,.25,1) both,nt-hue 16s linear infinite;
}
@keyframes nt-hue{to{--nt-hue:360}}
@property --nt-hue{syntax:'<number>';inherits:true;initial-value:0}

.head{position:relative;display:flex;align-items:center;gap:8px;padding:10px 11px 8px;cursor:grab;touch-action:none}
.head:active{cursor:grabbing}
.head::after{content:'';position:absolute;left:11px;right:11px;bottom:0;height:1px;background:var(--line)}
.mark{position:relative;flex:none;display:grid;place-items:center;width:26px;height:26px;border-radius:8px;color:var(--acc);
  background:linear-gradient(145deg,color-mix(in srgb,var(--acc) 13%,rgba(255,255,255,.04)),rgba(255,255,255,.015));
  border:1px solid var(--line-strong);box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 0 16px -9px var(--acc)}
.mark svg{width:17px;height:17px;display:block;filter:drop-shadow(0 0 5px color-mix(in srgb,var(--acc) 55%,transparent));animation:nt-glow 5.2s ease-in-out infinite}
@keyframes nt-glow{0%,100%{filter:drop-shadow(0 0 2px color-mix(in srgb,var(--acc) 45%,transparent))}50%{filter:drop-shadow(0 0 8px color-mix(in srgb,var(--acc) 85%,transparent))}}
.dot{width:6px;height:6px;border-radius:50%;background:var(--dim-2);flex:none}
.panel[data-state="running"] .dot{background:var(--acc);box-shadow:0 0 8px var(--acc);animation:nt-pulse 1.7s ease-in-out infinite}
.panel[data-state="paused"] .dot{background:var(--warn);box-shadow:0 0 8px var(--warn)}
.panel[data-state="warn"] .dot{background:var(--bad);box-shadow:0 0 8px var(--bad)}
@keyframes nt-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.mark .dot{position:absolute;right:-2px;top:-2px;width:5px;height:5px;box-shadow:0 0 0 2px var(--bg-hi)}
.brand{flex:1 1 auto;min-width:0}
.title{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:800 12.5px/1.15 var(--font-ui);letter-spacing:.13em;text-transform:uppercase;color:var(--ink);text-shadow:0 0 14px color-mix(in srgb,var(--acc) 35%,transparent)}
.sub{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px;font:600 8.5px/1 var(--font-ui);letter-spacing:.13em;text-transform:uppercase;color:var(--dim-2)}
.sub b{color:var(--acc);font-weight:700}
.iconbtn{all:unset;flex:none;display:grid;place-items:center;width:22px;height:22px;border-radius:7px;cursor:pointer;color:var(--dim);background:rgba(255,255,255,.04);border:1px solid var(--line);transition:color .15s,background .15s,border-color .15s,transform .12s}
.iconbtn:hover{color:var(--acc-2);background:var(--acc-dim);border-color:var(--line-strong)}
.iconbtn:active{transform:scale(.92)}
.iconbtn svg{width:12px;height:12px;display:block}
.iconbtn.stop:hover{color:var(--bad);background:color-mix(in srgb,var(--bad) 14%,transparent);border-color:color-mix(in srgb,var(--bad) 40%,transparent)}
button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,[role="switch"]:focus-visible{outline:2px solid var(--acc);outline-offset:2px}

.chips{display:flex;align-items:center;gap:6px;padding:0 11px 9px}
.chip{all:unset;flex:none;padding:4px 9px;border-radius:999px;cursor:pointer;
  font:700 8.5px/1 var(--font-ui);letter-spacing:.1em;text-transform:uppercase;
  color:var(--dim-2);background:rgba(255,255,255,.04);border:1px solid var(--line);transition:color .15s,background .15s,border-color .15s,transform .12s}
.chip:hover{color:var(--ink);border-color:var(--line-strong)}
.chip:active{transform:scale(.96)}
.chip.on{color:var(--acc-2);background:var(--acc-dim);border-color:color-mix(in srgb,var(--acc) 32%,transparent);box-shadow:0 0 14px -8px var(--acc)}
.chip.afk.on{color:var(--ink-on-acc);background:var(--acc);border-color:var(--acc)}
.chip.warn{color:var(--ink-warn);background:color-mix(in srgb,var(--warn) 10%,transparent);border-color:color-mix(in srgb,var(--warn) 28%,transparent)}
.chip .k{color:color-mix(in srgb,currentColor 55%,transparent);margin-right:4px}
.pace{margin-left:auto;font:600 8px/1 var(--font-mono);letter-spacing:.06em;color:var(--dim-2);text-transform:uppercase}

.race-line{height:2px;margin:0 11px;border-radius:99px;background:rgba(255,255,255,.05);overflow:hidden;opacity:0;transition:opacity .2s}
.panel[data-state="running"] .race-line{opacity:1}
.race-line i{display:block;height:100%;transform:scaleX(var(--fill,0));transform-origin:left center;
  background:linear-gradient(90deg,color-mix(in srgb,var(--acc) 95%,transparent),color-mix(in srgb,var(--acc-2) 95%,transparent));
  box-shadow:0 0 9px color-mix(in srgb,var(--acc) 55%,transparent)}

.main{display:flex;flex:1 1 auto;min-height:0;border-top:1px solid var(--line)}
.rail{position:relative;flex:none;display:flex;flex-direction:column;gap:2px;padding:9px 6px;border-right:1px solid var(--line);background:linear-gradient(180deg,rgba(255,255,255,.02),transparent)}
.rail-btn{all:unset;position:relative;z-index:1;display:grid;place-items:center;width:30px;height:30px;border-radius:9px;cursor:pointer;color:var(--dim-2);transition:color .18s,transform .12s}
.rail-btn:hover{color:var(--acc-2)}
.rail-btn:active{transform:scale(.9)}
.rail-btn svg{width:15px;height:15px;display:block}
.rail-btn::after{content:attr(data-label);position:absolute;left:calc(100% + 7px);top:50%;z-index:6;padding:4px 7px;border-radius:6px;white-space:nowrap;pointer-events:none;
  font:700 8px/1 var(--font-ui);letter-spacing:.12em;text-transform:uppercase;color:var(--ink-2);background:var(--bg-hi);border:1px solid var(--line-strong);
  opacity:0;transform:translate(-3px,-50%);transition:opacity .16s,transform .16s}
.rail-btn:hover::after,.rail-btn:focus-visible::after{opacity:1;transform:translate(0,-50%)}
.rail-glide{position:absolute;left:6px;top:9px;width:30px;height:30px;border-radius:9px;background:var(--acc-dim);border:1px solid var(--line-strong);
  box-shadow:0 0 16px -6px var(--acc),inset 0 0 12px -6px var(--acc);transition:transform .34s linear(0,.32 14%,.82 28%,1.06 44%,1.02 58%,.995 72%,1);pointer-events:none}
.rail[data-index="1"] .rail-glide{transform:translateY(32px)}
.rail[data-index="2"] .rail-glide{transform:translateY(64px)}
.rail[data-index="3"] .rail-glide{transform:translateY(96px)}
.rail[data-index="0"] .rail-btn[data-tab-btn="live"],
.rail[data-index="1"] .rail-btn[data-tab-btn="tune"],
.rail[data-index="2"] .rail-btn[data-tab-btn="info"],
.rail[data-index="3"] .rail-btn[data-tab-btn="stats"]{color:var(--acc)}

.views{flex:1 1 auto;min-width:0;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:10px 11px 11px;scrollbar-gutter:stable}
.views::-webkit-scrollbar{width:6px}
.views::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--acc) 22%,transparent);border-radius:99px}
.view{display:none}
.panel[data-tab="live"] .v-live,.panel[data-tab="tune"] .v-tune,.panel[data-tab="info"] .v-info,.panel[data-tab="stats"] .v-stats{display:block;animation:nt-view .28s cubic-bezier(.2,.9,.25,1) both}
@keyframes nt-view{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}
.view-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 1px 8px;padding-bottom:6px;border-bottom:1px solid var(--line)}
.view-head span{display:inline-flex;align-items:center;gap:6px;font:800 7.5px/1 var(--font-ui);letter-spacing:.18em;text-transform:uppercase;color:var(--acc)}
.view-head span::before{content:'';width:10px;height:1px;border-radius:99px;background:var(--acc);box-shadow:0 0 7px var(--acc)}
.chart{display:flex;align-items:flex-end;gap:3px;height:56px;padding:8px 1px 0;margin-bottom:2px}
.bar{flex:1 1 0;min-width:3px;border-radius:3px 3px 0 0;background:var(--dim-2);opacity:.9}
.bar.win{background:var(--acc)}
.bar.loss{background:var(--bad)}
.bar.draw{background:var(--warn)}
.bar.empty{height:2px;background:var(--line-strong);opacity:1}
.view-head b{font:600 8px/1.2 var(--font-ui);letter-spacing:.04em;color:var(--dim-2);text-align:right}

.hero{display:grid;grid-template-columns:1fr 1px 1fr;align-items:center;padding:8px 2px 9px}
.stat{text-align:center;min-width:0}
.stat b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:700 26px/1 var(--font-mono);letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:var(--ink);text-shadow:0 0 18px color-mix(in srgb,var(--acc) 28%,transparent);transition:color .25s,text-shadow .25s}
.stat b.good{color:var(--acc);text-shadow:0 0 18px color-mix(in srgb,var(--acc) 50%,transparent)}
.stat b.bad{color:var(--ink-bad);text-shadow:0 0 18px color-mix(in srgb,var(--bad) 45%,transparent)}
.stat b.mid{font-size:20px}
.stat b.bump{animation:nt-bump .32s cubic-bezier(.34,1.4,.5,1)}
@keyframes nt-bump{0%{transform:scale(1)}35%{transform:scale(1.11)}100%{transform:scale(1)}}
.stat span{display:block;margin-top:5px;font:700 8px/1 var(--font-ui);letter-spacing:.17em;text-transform:uppercase;color:var(--dim)}
.sep{display:block;width:1px;height:34px;background:linear-gradient(180deg,transparent,color-mix(in srgb,var(--acc) 25%,transparent),transparent)}

.card{position:relative;margin-bottom:9px;padding:9px 10px 10px;border-radius:10px;
  background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.012));border:1px solid var(--line);
  transition:border-color .2s,box-shadow .25s,transform .18s}
.card:last-child{margin-bottom:2px}
.card:hover{border-color:var(--line-strong);box-shadow:0 10px 22px -16px rgba(0,0,0,.9),0 0 22px -14px color-mix(in srgb,var(--acc) 65%,transparent)}
.card::before{content:'';position:absolute;left:0;top:9px;bottom:9px;width:2px;border-radius:99px;
  background:linear-gradient(180deg,var(--acc),color-mix(in srgb,var(--acc) 12%,transparent));box-shadow:0 0 10px color-mix(in srgb,var(--acc) 55%,transparent);opacity:.85}
.card-h{display:flex;align-items:baseline;flex-wrap:wrap;gap:2px 7px;margin-bottom:7px}
.card-t{font:800 9px/1 var(--font-ui);letter-spacing:.19em;text-transform:uppercase;color:var(--ink-2)}
.card-s{font:600 8.5px/1.2 var(--font-ui);letter-spacing:.05em;color:var(--dim-2)}
.card-age{margin-left:auto;font:600 8px/1.2 var(--font-mono);font-variant-numeric:tabular-nums;color:var(--dim-2)}
.panel[data-state="running"] .card-s.live{color:var(--acc)}

.lines{display:flex;flex-direction:column;gap:3px}
.line{display:flex;gap:6px;font:11px/1.45 var(--font-mono);white-space:nowrap;overflow:hidden}
.line b{flex:none;min-width:44px;font-weight:700;color:var(--dim-2);font-variant-numeric:tabular-nums}
.line:first-child b{color:var(--acc)}
.line span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--ink-2)}
.line:first-child span{color:var(--ink)}
.empty{padding:6px 1px;font:500 10px/1.4 var(--font-ui);color:var(--dim)}

.rows{display:grid;gap:1px;margin-top:2px}
.row{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:2.5px 0;font:500 10.5px/1.45 var(--font-ui);color:var(--dim);border-bottom:1px solid rgba(255,255,255,.03)}
.row:last-child{border-bottom:0}
.row b{font:600 11px/1.45 var(--font-mono);font-variant-numeric:tabular-nums;color:var(--ink-2)}
.row b.good{color:var(--acc)}
.row b.warn{color:var(--ink-warn)}
.row b .score{color:var(--dim);font-weight:500}

.seg{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin-bottom:8px}
.seg button{all:unset;display:grid;place-items:center;padding:6px 2px;border-radius:8px;cursor:pointer;text-align:center;
  font:700 9px/1.2 var(--font-ui);letter-spacing:.06em;text-transform:uppercase;color:var(--dim);
  background:rgba(255,255,255,.035);border:1px solid var(--line);transition:color .15s,background .15s,border-color .15s}
.seg button:hover{color:var(--ink-2);border-color:var(--line-strong)}
.seg button[aria-pressed="true"]{color:var(--acc-2);background:var(--acc-dim);border-color:color-mix(in srgb,var(--acc) 38%,transparent);box-shadow:0 0 16px -10px var(--acc)}
.set{display:flex;align-items:center;justify-content:space-between;gap:9px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.03)}
.set:last-child{border-bottom:0}
.set-lbl{font:500 10.5px/1.35 var(--font-ui);color:var(--ink-2);min-width:0}
.set-lbl i{display:block;font-style:normal;color:var(--dim-2);font-size:8.5px;letter-spacing:.04em}
.set-val{display:flex;align-items:center;gap:6px;flex:none}
.set-on{font:700 8px/1 var(--font-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--acc-2)}
.num{width:58px;padding:3px 6px;border-radius:6px;border:1px solid var(--line);background:rgba(0,0,0,.28);
  color:var(--ink-2);font:600 10px/1.4 var(--font-mono);font-variant-numeric:tabular-nums;text-align:right;color-scheme:dark}
.num:focus-visible{outline:2px solid var(--acc);outline-offset:1px;border-color:var(--acc)}
.sw{all:unset;position:relative;width:34px;height:18px;border-radius:999px;cursor:pointer;background:rgba(255,255,255,.08);border:1px solid var(--line);transition:background .2s,border-color .2s}
.sw::after{content:'';position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:var(--dim);transition:transform .22s cubic-bezier(.34,1.4,.5,1),background .2s}
.sw[aria-checked="true"]{background:var(--acc-dim);border-color:color-mix(in srgb,var(--acc) 45%,transparent)}
.sw[aria-checked="true"]::after{transform:translateX(16px);background:var(--acc);box-shadow:0 0 8px var(--acc)}
.themes{display:flex;gap:6px;margin:2px 0 9px}
.theme{all:unset;flex:1;height:22px;border-radius:7px;cursor:pointer;border:1px solid var(--line);position:relative;overflow:hidden}
.theme i{position:absolute;inset:0;display:block}
.theme[aria-pressed="true"]{border-color:var(--acc);box-shadow:0 0 14px -6px var(--acc)}
.th-carbon i{background:linear-gradient(135deg,#35ea86,#0c110e)}
.th-aurora i{background:linear-gradient(135deg,#3fe0c5,#a78bfa)}
.th-sunset i{background:linear-gradient(135deg,#ff9a5c,#ff77b0)}
.th-ice i{background:linear-gradient(135deg,#66e3ff,#d7f7ff)}
.th-violet i{background:linear-gradient(135deg,#c08bff,#f0a9ff)}
.th-rgb i{background:linear-gradient(135deg,#ff5f6d,#ffc371,#47ffa1,#5ad1ff,#b06bff)}

.kbd{display:inline-block;padding:1px 5px;border-radius:4px;border:1px solid var(--line-strong);background:rgba(0,0,0,.3);
  font:600 8.5px/1.5 var(--font-mono);color:var(--ink-2)}
.info-row{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:3px 0;font:500 10px/1.5 var(--font-ui);color:var(--dim);border-bottom:1px solid rgba(255,255,255,.03)}
.info-row:last-child{border-bottom:0}
.info-row b{font:600 10px/1.5 var(--font-mono);color:var(--ink-2)}
.info-row a{color:var(--acc-2);text-decoration:none;border-bottom:1px dotted color-mix(in srgb,var(--acc) 45%,transparent)}
.foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 11px;border-top:1px solid var(--line);
  font:600 8.5px/1 var(--font-mono);letter-spacing:.05em;text-transform:uppercase;color:var(--dim-2)}
.warnline{color:var(--ink-warn);font-size:8.5px;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.history{padding:6px 11px 0;font-size:8.5px;line-height:1.45;color:var(--ink-dim);display:flex;flex-direction:column;gap:2px}
.history[hidden]{display:none}
.history span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.history b{color:var(--ink);font-weight:600;margin-right:6px}
.panel[data-collapsed="true"]{width:auto}
.panel[data-collapsed="true"] .body{display:none}
.panel[data-collapsed="true"] .head{border-bottom:0}
.panel[data-collapsed="true"] .head::after{display:none}
.upd{display:inline-flex;align-items:center;gap:5px;margin-right:2px;padding:3px 7px;border-radius:99px;border:1px solid color-mix(in srgb,var(--acc) 42%,transparent);background:color-mix(in srgb,var(--acc) 15%,transparent);color:var(--acc);font:800 7.5px/1 var(--font-ui);letter-spacing:.1em;text-transform:uppercase;text-decoration:none;white-space:nowrap;animation:nt-pulse 1.9s ease-in-out infinite}
.upd:hover{background:color-mix(in srgb,var(--acc) 24%,transparent)}
.upd svg{width:10px;height:10px;flex:none}
.upd[hidden]{display:none}
@keyframes nt-pulse{0%,100%{box-shadow:0 0 0 0 color-mix(in srgb,var(--acc) 45%,transparent)}55%{box-shadow:0 0 0 4px color-mix(in srgb,var(--acc) 0%,transparent)}}
.card-actions{display:flex;gap:6px;padding:7px 0 0}
.card-actions .act{flex:1;padding:5px 8px;border-radius:7px;border:1px solid var(--line-strong);background:rgba(255,255,255,.03);color:var(--ink-2);font:700 8px/1 var(--font-ui);letter-spacing:.1em;text-transform:uppercase;text-align:center;cursor:pointer;text-decoration:none}
.card-actions .act:hover{border-color:var(--acc);color:var(--acc)}
.band{display:grid;gap:5px;margin:2px 0 9px;padding:7px 9px;border-radius:9px;background:rgba(255,255,255,.022);border:1px solid var(--line)}
.band-h{display:flex;align-items:baseline;justify-content:space-between;font:700 7.5px/1 var(--font-ui);letter-spacing:.14em;text-transform:uppercase;color:var(--dim-2)}
.band-h b{font:700 11px/1 var(--font-mono);letter-spacing:0;color:var(--acc)}
.band-bar{height:5px;border-radius:99px;background:rgba(255,255,255,.05);overflow:hidden}
.band-bar i{display:block;height:100%;transform:scaleX(var(--band,0));transform-origin:left center;background:linear-gradient(90deg,var(--acc),var(--acc-2));box-shadow:0 0 8px color-mix(in srgb,var(--acc) 55%,transparent);transition:transform .3s}
.band-f{display:flex;justify-content:space-between;font:600 8px/1 var(--font-mono);color:var(--dim)}
.band-f b{color:var(--ink-2);font-weight:600}
`;

const ICON = {
  mark: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3c-1.4 0-2.4.9-2.4 2 0 .8.4 1.3 1 1.7-1.3 1-2 2.6-2 4.4 0 1.7.6 2.8 1.5 3.6-1.2.8-2 2-2 3.4 0 1.5.9 2.7 2.2 3.3L9 24h6l-1.3-2.6c1.3-.6 2.2-1.8 2.2-3.3 0-1.4-.8-2.6-2-3.4.9-.8 1.5-1.9 1.5-3.6 0-1.8-.7-3.4-2-4.4.6-.4 1-.9 1-1.7 0-1.1-1-2-2.4-2Z" fill="currentColor"/></svg>',
  live: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12h3l3-7 3 14 3-9 3 4h3"/></svg>',
  tune: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.6M12 18.4V21M3 12h2.6M18.4 12H21M5.6 5.6l1.9 1.9M16.5 16.5l1.9 1.9M18.4 5.6l-1.9 1.9M7.5 16.5l-1.9 1.9"/></svg>',
  stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.4v.2"/></svg>',
  min: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>',
  hide: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 12h16M12 4v16"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="none"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>'
};

const PANEL_HTML = `
<div class="head" data-el="head">
  <span class="mark" aria-hidden="true">${ICON.mark}<i class="dot" data-el="dot"></i></span>
  <div class="brand">
    <span class="title">CHESS WRAITH</span>
    <span class="sub" data-el="engine">starting</span>
  </div>
  <a class="upd" data-el="update" href="${UPDATE_DOWNLOAD_URL}" target="_blank" rel="noopener noreferrer" hidden title="A newer version is on GitHub" aria-label="Update available"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M8 11l4 4 4-4M5 20h14"/></svg><span>Update</span></a>
  <button class="iconbtn stop" type="button" data-el="stop" title="Stop AUTO (Alt+Shift+S)" aria-label="Stop AUTO">${ICON.stop}</button>
  <button class="iconbtn" type="button" data-el="min" title="Collapse (double-click the title)" aria-label="Collapse panel">${ICON.min}</button>
  <button class="iconbtn" type="button" data-el="hide" title="Hide (Alt+Shift+H)" aria-label="Hide panel">${ICON.hide}</button>
</div>
<div class="body">
  <div class="chips">
    <button class="chip" type="button" data-el="auto" aria-pressed="true" title="AUTO is always on; click to resume if stopped"><span class="k">AUTO</span><span data-el="autoTxt">ON</span></button>
    <button class="chip afk" type="button" data-el="afk" aria-pressed="false"><span class="k">AFK</span><span data-el="afkTxt">OFF</span></button>
    <span class="chip legit" data-el="styleChip" style="cursor:default" title="One way to play: never the engine's raw best, always inside a human band">LEGIT</span>
    <span class="pace" data-el="clock">—</span>
  </div>
  <div class="race-line" aria-hidden="true"><i data-el="fill"></i></div>
  <div class="main">
    <div class="rail" data-el="rail" data-index="0">
      <span class="rail-glide" aria-hidden="true"></span>
      <button class="rail-btn" type="button" data-tab-btn="live" data-label="Live" aria-label="Live">${ICON.live}</button>
      <button class="rail-btn" type="button" data-tab-btn="tune" data-label="Tune" aria-label="Tune">${ICON.tune}</button>
      <button class="rail-btn" type="button" data-tab-btn="info" data-label="Info" aria-label="Info">${ICON.info}</button>
      <button class="rail-btn" type="button" data-tab-btn="stats" data-label="Stats" aria-label="Stats">${ICON.stats}</button>
    </div>
    <div class="views">
      <div class="view v-live">
        <div class="hero">
          <div class="stat"><b data-el="eval">–</b><span>Eval</span></div>
          <span class="sep" aria-hidden="true"></span>
          <div class="stat"><b class="mid" data-el="best">–</b><span>Best</span></div>
        </div>
        <div class="band">
          <div class="band-h"><span>Target</span><b data-el="target2">–</b></div>
          <div class="band-bar"><i data-el="bandFill"></i></div>
          <div class="band-f"><span>loss/move <b data-el="acpl2">–</b></span><span>band <b data-el="bandCap">–</b></span></div>
        </div>
        <div class="card">
          <div class="card-h"><span class="card-t">Lines</span><span class="card-s live" data-el="engineTag">waiting</span><span class="card-age" data-el="depth">–</span></div>
          <div class="lines" data-el="lines"><div class="empty">waiting for a board…</div></div>
        </div>
        <div class="card">
          <div class="card-h"><span class="card-t">Session</span><span class="card-s" data-el="turn">–</span></div>
          <div class="rows">
            <div class="row"><span>Loss / move</span><b data-el="acpl">–</b></div>
            <div class="row"><span>Opponent</span><b data-el="opp">–</b></div>
            <div class="row"><span>Playing at</span><b data-el="target">–</b></div>
            <div class="row"><span>Your pace</span><b data-el="pace">–</b></div>
            <div class="row"><span>Their tempo</span><b data-el="tempoRow">–</b></div>
            <div class="row"><span>Games</span><b data-el="games">–</b></div>
            <div class="row"><span>Rest</span><b data-el="rest">–</b></div>
          </div>
        </div>
        <div class="card">
          <div class="card-h"><span class="card-t">Account</span><span class="card-s">profile only</span></div>
          <div class="rows">
            <div class="row"><span>User</span><b data-el="account">anonymous</b></div>
            <div class="row"><span>Rating</span><b data-el="rating">–</b></div>
            <div class="row"><span>Session</span><b><span data-el="sessionLen">–</span> <span data-el="sessionScore" class="score"></span></b></div>
            <div class="row"><span>Guard</span><b data-el="guard">off</b></div>
          </div>
        </div>
      </div>
      <div class="view v-tune">
        <div class="view-head"><span>Tune</span><b>legit · engine · panel</b></div>
        <div class="card">
          <div class="card-h"><span class="card-t">Engine</span><span class="card-s">local, no server</span></div>
          <div class="set"><span class="set-lbl">Target Elo<i>0 = your own rating</i></span><span class="set-val"><input class="num" type="number" data-el="elo" min="0" max="3190" step="10"></span></div>
          <div class="set"><span class="set-lbl">Depth</span><span class="set-val"><input class="num" type="number" data-el="depthInput" min="4" max="20" step="1"></span></div>
          <div class="set"><span class="set-lbl">Search ms</span><span class="set-val"><input class="num" type="number" data-el="movetime" min="150" max="5000" step="50"></span></div>
          <div class="set"><span class="set-lbl">Slack cp<i>how far from best it may drift</i></span><span class="set-val"><input class="num" type="number" data-el="slack" min="0" max="300" step="5"></span></div>
        </div>
        <div class="card">
          <div class="card-h"><span class="card-t">Pacing</span><span class="card-s">human window</span></div>
          <div class="set"><span class="set-lbl">Min delay</span><span class="set-val"><input class="num" type="number" data-el="mint" min="250" max="6000" step="50"></span></div>
          <div class="set"><span class="set-lbl">Max delay</span><span class="set-val"><input class="num" type="number" data-el="maxt" min="400" max="15000" step="100"></span></div>
          <div class="set"><span class="set-lbl">Lines shown</span><span class="set-val"><input class="num" type="number" data-el="showLines" min="1" max="4" step="1"></span></div>
        </div>
        <div class="card">
          <div class="card-h"><span class="card-t">Board</span><span class="card-s">drawn on the page</span></div>
          <div class="set"><span class="set-lbl">Board arrows<i>best move and the reply, on the squares</i></span><span class="set-val"><button class="sw" type="button" role="switch" data-toggle="arrows" aria-checked="true" aria-label="Board arrows"></button></span></div>
          <div class="set"><span class="set-lbl">Level play<i>below 1320, play at your own loss rate</i></span><span class="set-val"><button class="sw" type="button" role="switch" data-toggle="levelPlay" aria-checked="true" aria-label="Level play"></button></span></div>
        </div>
        <div class="card">
          <div class="card-h"><span class="card-t">AFK</span><span class="card-s">unattended session</span></div>
          <div class="set"><span class="set-lbl">AUTO<i>always on; Stop pauses this tab only</i></span><span class="set-val"><span class="set-on">ON</span></span></div>
          <div class="set"><span class="set-lbl">Next game<i>automatic when a game ends</i></span><span class="set-val"><span class="set-on">ON</span></span></div>
          <div class="set"><span class="set-lbl">Keep-alive<i>near-silent audio holds the tab</i></span><span class="set-val"><button class="sw" type="button" role="switch" data-toggle="afkKeepAlive" aria-checked="false" aria-label="Keep alive"></button></span></div>
          <div class="set"><span class="set-lbl">Play while hidden<i>off by default; Chrome may freeze tabs</i></span><span class="set-val"><button class="sw" type="button" role="switch" data-toggle="playHidden" aria-checked="false" aria-label="Play while hidden"></button></span></div>
        </div>
        <div class="card">
          <div class="card-h"><span class="card-t">Theme</span><span class="card-s" data-el="themeName">Carbon</span></div>
          <div class="themes" data-el="themes">
            <button class="theme th-carbon" type="button" data-theme-btn="carbon" aria-label="Carbon"><i></i></button>
            <button class="theme th-aurora" type="button" data-theme-btn="aurora" aria-label="Aurora"><i></i></button>
            <button class="theme th-sunset" type="button" data-theme-btn="sunset" aria-label="Sunset"><i></i></button>
            <button class="theme th-ice" type="button" data-theme-btn="ice" aria-label="Ice"><i></i></button>
            <button class="theme th-violet" type="button" data-theme-btn="violet" aria-label="Violet"><i></i></button>
            <button class="theme th-rgb" type="button" data-theme-btn="rgb" aria-label="RGB"><i></i></button>
          </div>
        </div>
      </div>
      <div class="view v-info">
        <div class="view-head"><span>Info</span><b>one tab, no server</b></div>
        <div class="card">
          <div class="card-h"><span class="card-t">Build</span><span class="card-s" data-el="build">–</span></div>
          <div class="info-row"><span>Engine</span><b data-el="engineInfo">–</b></div>
          <div class="info-row"><span>Keep-alive</span><b data-el="kaInfo">off</b></div>
          <div class="info-row"><span>Source</span><a href="https://github.com/ezurinho/chess-wraith" target="_blank" rel="noopener noreferrer">github.com/ezurinho/chess-wraith</a></div>
          <div class="card-actions">
            <button class="act" type="button" data-el="copyReport">copy report</button>
          </div>
        </div>
        <div class="card">
          <div class="card-h"><span class="card-t">Last game</span><span class="card-s" data-el="reportAt">none yet</span></div>
          <div class="rows">
            <div class="row"><span>Result</span><b data-el="reportResult">–</b></div>
            <div class="row"><span>You</span><b data-el="reportYou">–</b></div>
            <div class="row"><span>Rival</span><b data-el="reportRival">–</b></div>
            <div class="row"><span>Account</span><b data-el="reportAccount">–</b></div>
          </div>
        </div>
        <div class="card">
          <div class="card-h"><span class="card-t">Updates</span><span class="card-s" data-el="updateState">checking…</span></div>
          <div class="rows">
            <div class="row"><span>Installed</span><b data-el="installed">–</b></div>
            <div class="row"><span>Latest</span><b data-el="latest">–</b></div>
            <div class="row"><span>Manifest</span><b data-el="updateVerified">unverified</b></div>
            <div class="row"><span>Checked</span><b data-el="checked">never</b></div>
          </div>
          <div class="card-actions">
            <button class="act" type="button" data-el="checkNow">check now</button>
            <a class="act" href="${UPDATE_PAGE_URL}" target="_blank" rel="noopener noreferrer">open GitHub</a>
          </div>
        </div>
        <div class="card">
          <div class="card-h"><span class="card-t">Keys</span><span class="card-s">while the tab is focused</span></div>
          <div class="info-row"><span>Resume AUTO</span><span><span class="kbd">Alt</span> <span class="kbd">Shift</span> <span class="kbd">A</span></span></div>
          <div class="info-row"><span>AFK</span><span><span class="kbd">Alt</span> <span class="kbd">Shift</span> <span class="kbd">F</span></span></div>
          <div class="info-row"><span>Play one move</span><span><span class="kbd">Alt</span> <span class="kbd">Shift</span> <span class="kbd">M</span></span></div>
          <div class="info-row"><span>Hide panel</span><span><span class="kbd">Alt</span> <span class="kbd">Shift</span> <span class="kbd">H</span></span></div>
          <div class="info-row"><span>Stop AUTO</span><span><span class="kbd">Alt</span> <span class="kbd">Shift</span> <span class="kbd">S</span></span></div>
        </div>
      </div>
      <div class="view v-stats">
        <div class="view-head"><span>Stats</span><b>last 20 games</b></div>
        <div class="card">
          <div class="card-h"><span class="card-t">Form</span><span class="card-s" data-el="statsForm">no games yet</span></div>
          <div class="chart" data-el="chart" aria-hidden="true"></div>
          <div class="rows">
            <div class="row"><span>Games</span><b data-el="statsGames">–</b></div>
            <div class="row"><span>Record</span><b data-el="statsRecord">–</b></div>
            <div class="row"><span>Loss / move</span><b data-el="statsAcpl">–</b></div>
            <div class="row"><span>Rival loss</span><b data-el="statsOpp">–</b></div>
            <div class="row"><span>Looks like</span><b data-el="statsPerf">–</b></div>
            <div class="row"><span>Best game</span><b data-el="statsBest">–</b></div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class="history" data-el="history" hidden></div>
  <div class="foot"><span data-el="foot">waiting</span><span class="warnline" data-el="warn"></span></div>
</div>
`;

function clockText(ms) {
  const total = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}:${String(total % 60).padStart(2, '0')}`;
}

const THEME_NAMES = { carbon: 'Carbon', aurora: 'Aurora', sunset: 'Sunset', ice: 'Ice', violet: 'Violet', rgb: 'RGB' };

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

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Chess Wraith control panel');
    panel.style.pointerEvents = 'auto';
    panel.innerHTML = PANEL_HTML;
    panel.dataset.mode = 'auto';
    this.shadow.appendChild(panel);
    this.panel = panel;
    this.el = {};
    for (const node of panel.querySelectorAll('[data-el]')) this.el[node.dataset.el] = node;

    this.hidden = false;
    this.#wire();
    this.setTab(cfg.panelTab, false);
    this.setTheme(cfg.theme || 'carbon');
    this.panel.dataset.collapsed = String(Boolean(cfg.panelCollapsed));
    this.#restorePosition();
    // An alt-tab, a zoom change or a rotated screen can shrink the viewport
    // under a saved corner; reclamp without rewriting the stored value.
    window.addEventListener('resize', () => {
      if (Number.isFinite(this.cfg.panelX)) this.#placePanel(this.cfg.panelX, this.cfg.panelY);
    });
    this.render();
  }

  mount() {
    if (!this.host.isConnected) (document.body || document.documentElement).appendChild(this.host);
  }

  unmount() {
    if (this.host.isConnected) this.host.remove();
  }

  #wire() {
    const on = (el, type, fn) => el && el.addEventListener(type, fn);
    on(this.el.auto, 'click', () => this.handlers.resumeAuto());
    on(this.el.stop, 'click', () => this.handlers.stop());
    on(this.el.afk, 'click', () => this.handlers.toggleAfk());
    on(this.el.hide, 'click', () => this.handlers.hide());
    on(this.el.min, 'click', () => this.toggleCollapsed());
    on(this.el.checkNow, 'click', () => {
      if (this.handlers.checkUpdate) this.handlers.checkUpdate();
    });
    on(this.el.copyReport, 'click', () => {
      if (this.handlers.copyReport) this.handlers.copyReport();
    });
    on(this.el.head, 'dblclick', () => this.toggleCollapsed());

    this.#wireTabs();

    for (const btn of this.panel.querySelectorAll('[data-theme-btn]')) {
      on(btn, 'click', () => {
        this.cfg.theme = btn.dataset.themeBtn;
        this.setTheme(this.cfg.theme);
        this.handlers.settingsApplied(this.cfg);
      });
    }

    for (const sw of this.panel.querySelectorAll('[data-toggle]')) {
      on(sw, 'click', () => {
        const key = sw.dataset.toggle;
        if (key === 'playHidden') {
          this.cfg.pauseWhenHidden = !this.cfg.pauseWhenHidden;
          sw.setAttribute('aria-checked', String(!this.cfg.pauseWhenHidden));
        } else {
          this.cfg[key] = !this.cfg[key];
          sw.setAttribute('aria-checked', String(Boolean(this.cfg[key])));
        }
        this.handlers.settingsApplied(this.cfg);
        if (key === 'afkKeepAlive') this.handlers.toggleAfk(this.cfg);
      });
    }

    const bindNumber = (el, key, affectsSearch) => {
      if (!el) return;
      el.value = String(this.cfg[key]);
      on(el, 'change', () => {
        this.cfg[key] = clampInt(el.value, Number(el.min), Number(el.max), this.cfg[key]);
        el.value = String(this.cfg[key]);
        if (affectsSearch) this.handlers.settingsChanged(this.cfg);
        else this.handlers.settingsApplied(this.cfg);
      });
    };
    // Only the four knobs that change the search restart it; the rest are
    // display or pacing and must not throw away the running analysis.
    for (const key of ['targetElo', 'maxDepth', 'moveTimeMs']) {
      bindNumber(this.el[{ targetElo: 'elo', maxDepth: 'depthInput', moveTimeMs: 'movetime' }[key]], key, true);
    }
    for (const [el, key] of [[this.el.mint, 'minThinkMs'], [this.el.maxt, 'maxThinkMs'], [this.el.slack, 'humanSlackCp'], [this.el.showLines, 'showLines']]) {
      bindNumber(el, key, false);
    }

    this.#drag();
  }

  #positionLimits() {
    // offsetWidth is 0 before layout; the CSS width is the honest fallback.
    const width = this.panel.offsetWidth || 322;
    return {
      maxLeft: Math.max(8, window.innerWidth - width - 8),
      maxTop: Math.max(8, window.innerHeight - 44),
    };
  }

  #placePanel(left, top) {
    const { maxLeft, maxTop } = this.#positionLimits();
    const x = clamp(Math.round(left), 8, maxLeft);
    const y = clamp(Math.round(top), 8, maxTop);
    this.panel.style.right = 'auto';
    this.panel.style.left = `${x}px`;
    this.panel.style.top = `${y}px`;
    this.cfg.panelX = x;
    this.cfg.panelY = y;
    return { left: x, top: y };
  }

  #savePosition() {
    this.handlers.settingsApplied(this.cfg);
  }

  #restorePosition() {
    if (!Number.isFinite(this.cfg.panelX) || !Number.isFinite(this.cfg.panelY)) return;
    this.#placePanel(this.cfg.panelX, this.cfg.panelY);
  }

  #resetPosition() {
    this.panel.style.left = '';
    this.panel.style.top = '';
    this.panel.style.right = '';
    this.cfg.panelX = null;
    this.cfg.panelY = null;
    this.#savePosition();
  }

  #drag() {
    let dragging = false;
    let moved = false;
    let sx = 0;
    let sy = 0;
    let ox = 0;
    let oy = 0;
    this.el.head.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, a')) return;
      dragging = true;
      moved = false;
      const r = this.panel.getBoundingClientRect();
      sx = e.clientX;
      sy = e.clientY;
      ox = r.left;
      oy = r.top;
      this.panel.style.right = 'auto';
      this.panel.style.left = `${ox}px`;
      this.panel.style.top = `${oy}px`;
    });
    window.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const maxLeft = Math.max(8, window.innerWidth - this.panel.offsetWidth - 8);
      const maxTop = Math.max(8, window.innerHeight - 40);
      const left = clamp(ox + e.clientX - sx, 8, maxLeft);
      const top = clamp(oy + e.clientY - sy, 8, maxTop);
      this.panel.style.left = `${left}px`;
      this.panel.style.top = `${top}px`;
      if (Math.abs(left - ox) > 1 || Math.abs(top - oy) > 1) moved = true;
    });
    window.addEventListener('pointerup', () => {
      if (!dragging) return;
      dragging = false;
      if (!moved) return;
      const left = parseFloat(this.panel.style.left);
      const top = parseFloat(this.panel.style.top);
      if (!Number.isFinite(left) || !Number.isFinite(top)) return;
      this.#placePanel(left, top);
      this.#savePosition();
    });

    // The header is a keyboard control too: arrows move 8 px, Shift 24 and
    // Home returns the panel to its corner. The pointer and the keyboard share
    // placePanel/savePosition, so they cannot drift into two positions.
    const head = this.el.head;
    if (!head) return;
    head.tabIndex = 0;
    head.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown Home');
    head.setAttribute('aria-label', 'Panel header. Arrow keys move the panel, Shift moves 24 pixels, Home resets it.');
    head.addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(e.key)) return;
      if (e.target !== head && e.target.closest && e.target.closest('button, a, input, select, textarea')) return;
      e.preventDefault();
      if (e.key === 'Home') {
        this.#resetPosition();
        return;
      }
      const step = e.shiftKey ? 24 : 8;
      const rect = this.panel.getBoundingClientRect();
      const baseLeft = Number.isFinite(this.cfg.panelX) ? this.cfg.panelX : rect.left;
      const baseTop = Number.isFinite(this.cfg.panelY) ? this.cfg.panelY : rect.top;
      let left = baseLeft;
      let top = baseTop;
      if (e.key === 'ArrowLeft') left -= step;
      else if (e.key === 'ArrowRight') left += step;
      else if (e.key === 'ArrowUp') top -= step;
      else top += step;
      this.#placePanel(left, top);
      this.#savePosition();
    });
  }

  // The rail is a real tablist, the same contract Nitro uses: one tab in the
  // tab order, arrows/Home/End move both the view and the focus, and the
  // active view is stored with the rest of the settings.
  #wireTabs() {
    const rail = this.el.rail;
    if (!rail) return;
    rail.setAttribute('role', 'tablist');
    rail.setAttribute('aria-label', 'Panel views');
    const tabs = [...rail.querySelectorAll('[data-tab-btn]')];
    for (const btn of tabs) {
      const name = btn.dataset.tabBtn;
      const view = this.panel.querySelector(`.v-${name}`);
      if (view) {
        view.id = `cw-view-${name}`;
        view.setAttribute('role', 'tabpanel');
        view.setAttribute('aria-label', name.charAt(0).toUpperCase() + name.slice(1));
      }
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-controls', `cw-view-${name}`);
      btn.setAttribute('aria-selected', 'false');
      btn.tabIndex = -1;
      btn.addEventListener('click', () => this.setTab(name));
    }
    rail.addEventListener('keydown', (event) => {
      const btn = event.target && event.target.closest ? event.target.closest('[data-tab-btn]') : null;
      if (!btn) return;
      const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (!keys.includes(event.key)) return;
      const buttons = [...rail.querySelectorAll('[data-tab-btn]')];
      const current = buttons.indexOf(btn);
      if (current < 0) return;
      let next = current;
      if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = buttons.length - 1;
      else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (current + 1) % buttons.length;
      else next = (current - 1 + buttons.length) % buttons.length;
      event.preventDefault();
      event.stopPropagation();
      this.setTab(buttons[next].dataset.tabBtn);
      buttons[next].focus();
    });
  }

  setTheme(theme) {
    const name = THEME_NAMES[theme] ? theme : 'carbon';
    this.panel.dataset.theme = name;
    if (this.el.themeName) this.el.themeName.textContent = THEME_NAMES[name];
    for (const btn of this.panel.querySelectorAll('[data-theme-btn]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.themeBtn === name));
    }
  }

  setTab(tab, persist = true) {
    const name = ['live', 'tune', 'info', 'stats'].includes(tab) ? tab : 'live';
    const index = { live: 0, tune: 1, info: 2, stats: 3 }[name];
    this.panel.dataset.tab = name;
    this.el.rail.dataset.index = String(index);
    this.cfg.panelTab = name;
    for (const btn of this.panel.querySelectorAll('[data-tab-btn]')) {
      const selected = btn.dataset.tabBtn === name;
      btn.setAttribute('aria-selected', String(selected));
      btn.tabIndex = selected ? 0 : -1;
    }
    if (persist) this.handlers.settingsApplied(this.cfg);
  }

  toggleCollapsed() {
    const next = this.panel.dataset.collapsed !== 'true';
    this.panel.dataset.collapsed = String(next);
    this.cfg.panelCollapsed = next;
    this.handlers.settingsApplied(this.cfg);
  }

  toggleHidden() {
    this.hidden = !this.hidden;
    this.panel.style.display = this.hidden ? 'none' : '';
    return this.hidden;
  }

  render(view = {}) {
    const v = view;
    const top = v.analysis && v.analysis.lines && v.analysis.lines[0];
    const state = v.warn ? 'warn' : v.status === 'thinking' ? 'paused' : v.autoPlay ? 'running' : 'paused';
    this.panel.dataset.state = state;

    if (v.engine) {
      this.el.engine.textContent = v.engine;
      if (this.el.engineInfo) this.el.engineInfo.textContent = v.engine;
    }

    if (top) {
      const cp = typeof top.whiteCp === 'number' ? top.whiteCp : 0;
      this.el.eval.textContent = top.evalText || '–';
      this.el.eval.className = cp > 20 ? 'good' : cp < -20 ? 'bad' : '';
      this.el.best.textContent = v.analysis.bestSan || top.bestSan || '–';
      this.el.depth.textContent = `d${top.depth}`;
      this.el.engineTag.textContent = v.status === 'thinking' ? 'thinking' : (v.engine || 'ready');
      const box = this.el.lines;
      box.textContent = '';
      const take = Math.min(this.cfg.showLines, v.analysis.lines.length);
      for (let i = 0; i < take; i++) {
        const line = v.analysis.lines[i];
        const row = document.createElement('div');
        row.className = 'line';
        const b = document.createElement('b');
        b.textContent = line.evalText;
        const s = document.createElement('span');
        s.textContent = line.sanLine || (line.pv || []).join(' ');
        row.append(b, s);
        box.appendChild(row);
      }
    } else {
      this.el.eval.textContent = '–';
      this.el.eval.className = '';
      this.el.best.textContent = '–';
      this.el.depth.textContent = '–';
      this.el.engineTag.textContent = v.status === 'thinking' ? 'thinking' : 'waiting';
      this.el.lines.textContent = '';
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = v.status === 'thinking' ? 'thinking…' : 'waiting for a board…';
      this.el.lines.appendChild(empty);
    }

    this.el.turn.textContent = v.turn ? (v.turn === 'w' ? 'White to move' : 'Black to move') : '–';
    const band = Number(v.band) || 0;
    const acpl = v.acpl > 0 ? Math.round(v.acpl) : null;
    const boost = Number(v.slackBoost) || 0;
    this.el.acpl.textContent = acpl === null ? '–' : `${acpl} cp${band ? ` · band ${band}` : ''}`;
    this.el.acpl2.textContent = acpl === null ? '–' : `${acpl} cp`;
    this.el.bandCap.textContent = band ? `${band} cp` : '–';
    this.el.bandFill.style.setProperty('--band', String(band && acpl !== null ? clamp(acpl / band, 0, 1) : 0));
    this.el.account.textContent = v.account || 'anonymous';
    this.el.pace.textContent = v.pace ? `${(v.pace / 1000).toFixed(1)}s · ${v.paceSource}` : '–';
    this.el.tempoRow.textContent = v.tempo ? `${(v.tempo / 1000).toFixed(1)}s` : '–';
    this.el.games.textContent = String(Number(v.games) || 1);
    this.el.rest.textContent = Number(v.restMs) > 0 ? clockText(v.restMs) : 'limit reached';
    this.el.sessionLen.textContent = clockText(v.sessionMs);
    const tally = v.results || {};
    const played = (tally.win || 0) + (tally.loss || 0) + (tally.draw || 0);
    // Only after a game has ended: "0-0-0" next to the clock is noise.
    this.el.sessionScore.textContent = played > 0 ? `${tally.win || 0}-${tally.loss || 0}-${tally.draw || 0}` : '';
    this.el.guard.textContent = boost > 0 ? `+${boost} cp` : 'off';
    this.el.rating.textContent = v.accountRating
      ? `${v.accountRating} ${v.ratingClass || ''}`.trim()
      : v.boardRating
        ? `${v.boardRating} · page`
        : v.ratingError
          ? 'offline'
          : 'anonymous';
    this.el.rating.title = v.accountRating
      ? v.ratingAt
        ? `measured from the public profile · checked ${Math.max(0, Math.round((Date.now() - v.ratingAt) / 60000))}m ago`
        : 'the public rating of the signed-in account'
      : v.boardRating
        ? 'read from your player row on this page; the public profile has no rating for this time class yet'
        : 'the public rating of the signed-in account';
    // The real rating wins. The estimate is a fallback derived from the
    // opponent's moves, and showing it in place of a known 113 was the bug.
    this.el.opp.textContent = v.opponent ? String(v.opponent) : v.estimate ? `~${v.estimate}` : '–';
    this.el.opp.title = v.opponent
      ? 'read from the opponent row on this page'
      : v.estimate
        ? 'not published: estimated from the opponent\'s average centipawn loss'
        : 'no opponent rating on this page';
    const level = v.levelTarget > 0;
    const source = level
      ? ' · your level'
      : v.eloSource === 'account' || v.eloSource === 'board'
        ? `${v.provisional ? ' · prov' : v.eloGap ? ' · floor' : v.eloSource === 'board' ? ' · page' : ' · acct'}`
        : v.eloSource === 'target' ? ' · set' : ' · default';
    this.el.target.textContent = level
      ? `${v.accountRating || v.boardRating}${source}`
      : v.elo ? `${v.elo}${source}` : 'full';
    this.el.target.title = level
      ? `under Stockfish's 1320 floor: the engine searches at the floor and the chooser aims at the ~${v.levelTarget} cp/move an account rated ${v.accountRating || v.boardRating} gives away. Turn Level play off in Tune to play at the floor.`
      : v.eloGap
      ? `your ${v.accountRating || v.boardRating} is under Stockfish's 1320 floor: the engine plays at the floor and the move window widens by ${v.eloGap} points worth of slack`
      : v.eloSource === 'account'
        ? v.provisional
          ? `anchored to your published ${v.accountRating} with few games behind it, shrunk towards the prior`
          : 'anchored to your own published rating'
        : v.eloSource === 'board'
          ? `anchored to the ${v.boardRating} in your player row on this page`
          : v.eloSource === 'target'
            ? 'anchored to the manual Target Elo'
            : 'no rating known: anchored to the 1500 default';
    this.el.target2.textContent = v.elo ? String(v.elo) : '–';

    const autoOn = Boolean(v.autoPlay);
    this.el.auto.classList.toggle('on', autoOn);
    this.el.auto.setAttribute('aria-pressed', String(autoOn));
    this.el.autoTxt.textContent = autoOn ? 'ON' : 'PAUSED';
    this.el.auto.title = autoOn
      ? 'AUTO is always on. The square Stop button pauses this tab; this chip resumes it.'
      : 'AUTO is paused. Press this chip or Alt+Shift+A to resume.';
    this.el.auto.setAttribute('aria-label', autoOn ? 'AUTO always on' : 'AUTO paused; resume');

    const afkOn = Boolean(!this.cfg.pauseWhenHidden || this.cfg.afkKeepAlive);
    this.el.afk.classList.toggle('on', afkOn);
    this.el.afk.setAttribute('aria-pressed', String(afkOn));
    this.el.afkTxt.textContent = afkOn ? 'ON' : 'OFF';

    this.el.styleChip.textContent = v.styleLabel || LEGIT.label;
    this.el.clock.textContent = Number.isFinite(v.clock) ? `${Math.round(v.clock)}s` : '—';
    this.el.fill.style.setProperty('--fill', String(clamp((v.ply || 0) / 80, 0, 1)));
    this.el.warn.textContent = v.warn || '';
    const events = Array.isArray(v.events) ? v.events.slice(-2) : [];
    this.el.history.hidden = events.length === 0;
    this.el.history.title = events.map((item) => `${eventLabel(item.at, Date.now())} ${item.text}`).join('\n');
    this.el.history.textContent = '';
    for (const item of events) {
      const line = document.createElement('span');
      const when = document.createElement('b');
      when.textContent = eventLabel(item.at, Date.now());
      line.appendChild(when);
      line.appendChild(document.createTextNode(item.text));
      this.el.history.appendChild(line);
    }
    this.el.foot.textContent = v.passiveTab
      ? 'second tab · passive'
      : v.throttled
        ? 'tab hidden · timers batched'
      : v.status === 'thinking'
        ? 'thinking'
        : autoOn
          ? (v.ply ? 'AUTO · playing' : 'AUTO · waiting')
          : 'AUTO paused · press AUTO';
    this.el.build.textContent = v.version || VERSION;
    this.el.installed.textContent = v.version || VERSION;
    const latest = String(v.updateLatest || '');
    const newer = versionNewer(latest, v.version || VERSION);
    this.el.update.hidden = !newer;
    if (newer) {
      // Only the number: the header has 322 px and the word plus a version
      // ellipsised the title to "CHESS WRA…".
      this.el.update.querySelector('span').textContent = latest;
      this.el.update.title = v.updateVerified
        ? `Download v${latest} (manifest verified)`
        : `Download v${latest} from GitHub (manifest unverified)`;
      this.el.update.setAttribute('aria-label', `Update available: v${latest}`);
    }
    this.el.latest.textContent = latest ? latest : '–';
    const manifest = v.updateManifest;
    this.el.updateVerified.textContent = v.updateVerified && manifest ? 'verified' : 'unverified';
    this.el.updateVerified.title = v.updateVerified && manifest
      ? `${manifest.file} · ${manifest.size} bytes · sha256 ${manifest.sha256.slice(0, 16)}…`
      : 'No valid update.json for the latest release';
    this.el.checked.textContent = v.updateAt ? formatAge(Date.now() - v.updateAt) : 'never';
    this.el.updateState.textContent = v.updateChecking
      ? 'checking…'
      : v.updateError
        ? `failed · ${v.updateError}`
        : newer
          ? (v.updateVerified ? 'newer · verified' : 'newer · unverified')
          : latest
            ? (v.updateVerified ? 'up to date · verified' : 'up to date · unverified')
            : 'not checked';
    this.el.kaInfo.textContent = v.keepAlive || 'off';
    // The card after the last game. `lastReport` is null until one finished,
    // and a game with too few assessed moves shows the result but no average.
    const rep = v.report;
    const cp = (acpl) => (Number.isFinite(acpl) ? `${acpl} cp/move` : '–');
    const like = (perf) => (Number.isFinite(perf) ? ` · like ${perf}` : '');
    this.el.reportAt.textContent = rep && rep.at ? eventLabel(rep.at, Date.now()) : 'none yet';
    this.el.reportResult.textContent = rep && rep.result
      ? `${rep.result}${rep.moves ? ` · ${rep.moves} moves` : ''}`
      : '–';
    this.el.reportYou.textContent = rep && Number.isFinite(rep.myAcpl) ? cp(rep.myAcpl) + like(rep.myPerf) : 'not enough moves';
    this.el.reportRival.textContent = rep && Number.isFinite(rep.oppAcpl) ? cp(rep.oppAcpl) + like(rep.oppPerf) : '–';
    this.el.reportAccount.textContent = rep && rep.rating
      ? `${rep.rating}${Number.isFinite(rep.delta) ? ` · ${rep.delta >= 0 ? '+' : ''}${rep.delta}` : ''}`
      : '–';
    // Stats: the last twenty games, drawn from the same entries the card uses.
    const sum = v.reportSummary;
    const has = Boolean(sum && sum.games);
    this.el.statsGames.textContent = has ? String(sum.games) : '–';
    this.el.statsRecord.textContent = has ? `${sum.wins}W · ${sum.losses}L · ${sum.draws}D · ${sum.winRate}%` : '–';
    this.el.statsAcpl.textContent = has && Number.isFinite(sum.acpl) ? `${sum.acpl} cp` : '–';
    this.el.statsOpp.textContent = has && Number.isFinite(sum.oppAcpl) ? `${sum.oppAcpl} cp` : '–';
    this.el.statsPerf.textContent = has && Number.isFinite(sum.perf) ? `like ${sum.perf}` : '–';
    this.el.statsBest.textContent = has && Number.isFinite(sum.best) ? `${sum.best} cp` : '–';
    this.el.statsForm.textContent = has
      ? `${sum.games} game${sum.games === 1 ? '' : 's'} · ${sum.winRate}% won`
      : 'no games yet';
    // Rebuild the bars only when the sequence changed: this renders every 2 s.
    const formKey = JSON.stringify(has ? sum.form : []);
    if (this.chartKey !== formKey) {
      this.chartKey = formKey;
      const chart = this.el.chart;
      chart.textContent = '';
      for (const game of (has ? sum.form : [])) {
        const bar = document.createElement('i');
        const shape = ['win', 'loss', 'draw'].includes(game.result) ? game.result : 'empty';
        bar.className = `bar ${shape}`;
        // A lower loss is a taller bar: the eye reads the good games as peaks.
        bar.style.height = Number.isFinite(game.acpl)
          ? `${Math.max(8, Math.min(100, 100 - game.acpl / 2))}%`
          : '6%';
        const parts = [game.result];
        if (game.moves) parts.push(`${game.moves} moves`);
        if (Number.isFinite(game.acpl)) parts.push(`${game.acpl} cp/move`);
        bar.title = parts.join(' · ');
        chart.appendChild(bar);
      }
    }


    for (const sw of this.panel.querySelectorAll('[data-toggle]')) {
      const key = sw.dataset.toggle;
      const on = key === 'playHidden' ? !this.cfg.pauseWhenHidden : Boolean(this.cfg[key]);
      sw.setAttribute('aria-checked', String(on));
    }
    if (this.el.elo && document.activeElement !== this.el.elo) this.el.elo.value = String(this.cfg.targetElo);
    if (this.el.slack && document.activeElement !== this.el.slack) this.el.slack.value = String(this.cfg.humanSlackCp);
    this.setTheme(this.cfg.theme || 'carbon');
  }
}
