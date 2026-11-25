// Synthetic input: the coordinates decide whether a click lands on the right
// square, and the retry gesture decides whether a failed move is recoverable.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const FRAGMENTS = ['10-config.js', '20-utils.js', '30-chess.js', '35-chess-glue.js', '70-input.js'];

function harness() {
  const source = FRAGMENTS.map((name) => fs.readFileSync(path.join(ROOT, 'src', name), 'utf8')).join('\n');
  const context = vm.createContext({
    console,
    Date,
    Math,
    JSON,
    Number,
    String,
    Array,
    Object,
    RegExp,
    Promise,
    setTimeout,
    clearTimeout,
    document: { elementFromPoint: () => null, querySelector: () => null },
    window: { outerHeight: 900, innerHeight: 800, screenX: 0, screenY: 0 },
    localStorage: { getItem: () => null, setItem: () => {} },
    state: {},
    cfg: {}
  });
  vm.runInContext(source, context, { filename: 'fragments.js' });
  return vm.runInContext('globalThis', context);
}

const BOARD = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }) };

test('a square maps to its own 100px cell, and flipping mirrors both axes', () => {
  const api = harness();
  const cases = [
    ['a1', false, 50, 750],
    ['a1', true, 750, 50],
    ['h8', false, 750, 50],
    ['h8', true, 50, 750],
    ['e4', false, 450, 450]
  ];
  for (const [square, flipped, cx, cy] of cases) {
    for (let i = 0; i < 40; i++) {
      const pt = api.jitteredSquareClientXY(BOARD, square, flipped);
      assert.ok(pt, `${square} resolves`);
      assert.ok(Math.abs(pt.x - cx) <= 53, `${square} x within the cell (${pt.x} vs ${cx})`);
      assert.ok(Math.abs(pt.y - cy) <= 53, `${square} y within the cell (${pt.y} vs ${cy})`);
    }
  }
});

test('a board that is too small to click returns nothing instead of guessing', () => {
  const api = harness();
  const tiny = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 20, height: 20 }) };
  assert.equal(api.jitteredSquareClientXY(tiny, 'e4', false), null);
  assert.equal(api.jitteredSquareClientXY(BOARD, 'z9', false), null);
});

test('the retry uses the other gesture, because click-to-move can be off', () => {
  const api = harness();
  assert.equal(api.retryInputMode('drag'), 'click');
  assert.equal(api.retryInputMode('click'), 'drag');
  assert.equal(api.retryInputMode('mixed'), 'drag', 'a mixed first attempt retries as a drag');
  assert.notEqual(api.retryInputMode('drag'), 'drag');
});
