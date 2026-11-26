// The panel can be dragged, but until 1.87.0 the corner died with the page and
// the header was pointer-only. These tests seed a saved corner, boot the whole
// script, and drive the same keyboard events a focused header receives.
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

test('the panel comes back where it was left', () => {
  const { api, stop } = boot((store) => {
    store.setItem(KEY, JSON.stringify({ panelX: 120, panelY: 90 }));
  });
  try {
    assert.equal(api.panel.panel.style.left, '120px');
    assert.equal(api.panel.panel.style.top, '90px');
    assert.equal(api.panel.panel.style.right, 'auto');
  } finally {
    stop();
  }
});

test('the header moves the panel with the keyboard and Home resets the corner', () => {
  const { window, api, stop } = boot((store) => {
    store.setItem(KEY, JSON.stringify({ panelX: 120, panelY: 90 }));
  });
  try {
    const head = api.panel.el.head;
    const fire = (key, extra = {}) => head.dispatchEvent(new window.KeyboardEvent('keydown', {
      key, bubbles: true, cancelable: true, ...extra,
    }));
    assert.equal(head.tabIndex, 0, 'the header can take focus');
    assert.match(head.getAttribute('aria-keyshortcuts'), /ArrowLeft/);

    fire('ArrowRight');
    assert.equal(api.panel.panel.style.left, '128px', '8 px per arrow');
    fire('ArrowDown', { shiftKey: true });
    assert.equal(api.panel.panel.style.top, '114px', '24 px with Shift');

    const saved = JSON.parse(window.localStorage.getItem(KEY));
    assert.equal(saved.panelX, 128, 'the keyboard persists the corner');
    assert.equal(saved.panelY, 114);

    fire('Home');
    assert.equal(api.panel.panel.style.left, '', 'Home clears the inline corner');
    assert.equal(api.panel.panel.style.right, '', 'and the CSS corner applies again');
    const reset = JSON.parse(window.localStorage.getItem(KEY));
    assert.equal(reset.panelX, null);
    assert.equal(reset.panelY, null);
  } finally {
    stop();
  }
});
