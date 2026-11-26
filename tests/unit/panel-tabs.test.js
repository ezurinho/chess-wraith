// The rail was four buttons with no tab semantics: no role, no roving tabindex,
// no keyboard path and no memory. These tests boot the whole script and check
// the same contract Nitro's panel uses.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { bootSource } = require('./harness');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (name) => fs.readFileSync(path.join(ROOT, 'src', name), 'utf8');
const FRAGMENTS = [
  '10-config.js', '20-utils.js', '30-chess.js', '35-chess-glue.js', '40-board.js',
  '45-overlay.js',
  '50-engine.js', '55-pace.js', '60-analysis.js', '62-report.js', '65-afk.js', '70-input.js',
  '80-panel.js', '90-boot.js'
];
const KEY = 'chess-wraith-settings-v1:tester';

function boot(seed) {
  return bootSource(FRAGMENTS.map(read).join('\n'), { seed });
}

test('the panel restores the last tab and exposes a real tablist', () => {
  const { api, stop } = boot((store) => {
    store.setItem(KEY, JSON.stringify({ panelTab: 'tune' }));
  });
  try {
    assert.equal(api.panel.panel.dataset.tab, 'tune');
    const rail = api.panel.el.rail;
    assert.equal(rail.getAttribute('role'), 'tablist');
    assert.equal(rail.getAttribute('aria-label'), 'Panel views');
    const tune = rail.querySelector('[data-tab-btn="tune"]');
    const live = rail.querySelector('[data-tab-btn="live"]');
    assert.equal(tune.getAttribute('role'), 'tab');
    assert.equal(tune.getAttribute('aria-selected'), 'true');
    assert.equal(tune.tabIndex, 0, 'only the active tab is in the tab order');
    assert.equal(live.getAttribute('aria-selected'), 'false');
    assert.equal(live.tabIndex, -1);
    assert.equal(tune.getAttribute('aria-controls'), 'cw-view-tune');
    const view = api.panel.panel.querySelector('#cw-view-tune');
    assert.equal(view.getAttribute('role'), 'tabpanel');
  } finally {
    stop();
  }
});

test('arrows, Home and End move the tablist and save the active view', () => {
  const { window, api, stop } = boot((store) => {
    store.setItem(KEY, JSON.stringify({ panelTab: 'live' }));
  });
  try {
    const rail = api.panel.el.rail;
    const fire = (el, key) => el.dispatchEvent(new window.KeyboardEvent('keydown', {
      key, bubbles: true, cancelable: true,
    }));
    const tab = (name) => rail.querySelector(`[data-tab-btn="${name}"]`);

    fire(tab('live'), 'ArrowDown');
    assert.equal(api.panel.panel.dataset.tab, 'tune');
    assert.equal(tab('tune').getAttribute('aria-selected'), 'true');
    assert.equal(tab('tune').tabIndex, 0);
    assert.equal(JSON.parse(window.localStorage.getItem(KEY)).panelTab, 'tune');

    fire(tab('tune'), 'End');
    assert.equal(api.panel.panel.dataset.tab, 'stats');
    fire(tab('stats'), 'Home');
    assert.equal(api.panel.panel.dataset.tab, 'live');
    assert.equal(JSON.parse(window.localStorage.getItem(KEY)).panelTab, 'live');
  } finally {
    stop();
  }
});

test('Alt+Shift+T cycles the theme without opening Tune', () => {
  const { window, api, stop } = boot((store) => {
    store.setItem(KEY, JSON.stringify({ panelTab: 'live' }));
  });
  try {
    assert.equal(api.cfg.theme, 'carbon');
    assert.equal(api.panel.panel.dataset.tab, 'live');
    window.dispatchEvent(new window.KeyboardEvent('keydown', {
      key: 't', altKey: true, shiftKey: true, bubbles: true, cancelable: true,
    }));
    assert.equal(api.cfg.theme, 'aurora');
    assert.equal(api.panel.panel.dataset.theme, 'aurora');
    assert.equal(api.panel.panel.dataset.tab, 'live', 'the hotkey does not change the view');
    assert.equal(JSON.parse(window.localStorage.getItem(KEY)).theme, 'aurora');
  } finally {
    stop();
  }
});
