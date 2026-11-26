'use strict';

// The engine is code from a CDN, so its URL is not the guarantee: these two
// tests keep the pinned size/hash beside the bytes in the repo and keep
// update.json beside the userscript it claims to describe.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, loadFragments } = require('./helpers');

const api = loadFragments(
  ['10-config.js'],
  `{ ENGINE_BYTES, ENGINE_SHA256, ENGINE_FILES, VERSION }`
);
const VENDOR = {
  nnueJs: 'stockfish-19-lite-single.js',
  nnueWasm: 'stockfish-19-lite-single.wasm',
  fallbackJs: 'stockfish.js'
};
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel));

test('the pinned engine sizes and hashes match the vendored bytes', () => {
  for (const [kind, file] of Object.entries(VENDOR)) {
    const bytes = read(path.join('vendor', file));
    assert.equal(api.ENGINE_BYTES[kind], bytes.length, `${kind} size drifted`);
    assert.equal(api.ENGINE_SHA256[kind], hash(bytes), `${kind} hash drifted`);
    assert.match(api.ENGINE_FILES[kind], new RegExp(`/${file.replace(/\./g, '\\.')}$`));
  }
});

test('update.json describes the committed userscript exactly', () => {
  const manifest = JSON.parse(read('update.json').toString('utf8'));
  const bundle = read('chess-wraith.user.js');
  assert.equal(manifest.version, api.VERSION);
  assert.equal(manifest.file, 'chess-wraith.user.js');
  assert.equal(manifest.size, bundle.length);
  assert.equal(manifest.sha256, hash(bundle));
});
