'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadFragments } = require('./helpers');

const engine = loadFragments(
  ['10-config.js', '20-utils.js', '50-engine.js'],
  `{ buildNnueShim }`
);

const WASM = 'https://cdn.example/stockfish-19-lite-single.wasm';
const JS = 'https://cdn.example/stockfish-19-lite-single.js';

// The real failure this guards against: the build asks for its wasm at a URL
// built from self.location.href plus a content hash, with no ".wasm" in it.
function shimmed() {
  const calls = [];
  const fakeSelf = {
    fetch(url) {
      calls.push(String(url));
      return { ok: true };
    }
  };
  const context = vm.createContext({ self: fakeSelf, String });
  vm.runInContext(engine.buildNnueShim(WASM, JS), context, { filename: 'nnue-shim.js' });
  return { self: fakeSelf, calls };
}

test('the wasm request is redirected whatever URL the engine built', () => {
  const { self, calls } = shimmed();
  self.fetch('https://www.chess.comhttps://www.chess.com/554211df-16e6-4404');
  assert.deepEqual(calls, [WASM]);
  self.fetch('https://www.chess.com/stockfish.wasm');
  assert.deepEqual(calls, [WASM, WASM]);
});

test('the engine script itself is never rewritten', () => {
  const { self, calls } = shimmed();
  self.fetch(JS);
  assert.deepEqual(calls, [JS]);
});

test('the shim forwards the request options and survives a missing fetch', () => {
  const seen = [];
  const fakeSelf = {
    fetch(url, options) {
      seen.push([String(url), options]);
      return {};
    }
  };
  const context = vm.createContext({ self: fakeSelf, String });
  vm.runInContext(engine.buildNnueShim(WASM, JS), context, { filename: 'nnue-shim.js' });
  fakeSelf.fetch('whatever', { credentials: 'same-origin' });
  assert.deepEqual(seen[0], [WASM, { credentials: 'same-origin' }]);

  const bare = {};
  const bareContext = vm.createContext({ self: bare, String });
  assert.doesNotThrow(() => vm.runInContext(engine.buildNnueShim(WASM, JS), bareContext));
  assert.equal(typeof bare.fetch, 'undefined', 'no fetch means no patching');
});

