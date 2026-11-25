'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the committed bundle is up to date with src/', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build.js'), '--check'], {
    cwd: ROOT,
    stdio: 'pipe'
  });
});

test('header, version and metadata agree', () => {
  const pkg = JSON.parse(read('package.json'));
  const bundle = read('chess-wraith.user.js');
  const meta = read('chess-wraith.meta.js');

  assert.match(bundle, /^\/\/ ==UserScript==/);
  assert.match(bundle, /@name\s+CHESS WRAITH/);
  assert.ok(bundle.includes(`@version      ${pkg.version}`), 'header version must match package.json');
  assert.ok(meta.includes(`@version      ${pkg.version}`), 'meta version must match package.json');
  assert.ok(bundle.includes('@match        https://www.chess.com/*'));
  assert.ok(!/@grant\s+none/.test(bundle) === false, 'the script must not request grants');
  assert.ok(!bundle.includes('@require'), 'no external requires: the bundle is self-contained');
});

test('bundle parses as one script and has no leftover markers', () => {
  const bundle = read('chess-wraith.user.js');
  assert.doesNotThrow(() => new vm.Script(bundle, { filename: 'chess-wraith.user.js' }));
  assert.ok(!/TODO|FIXME|XXX/.test(bundle), 'no TODO markers in the artifact');
  assert.ok(!/console\.log\(/.test(bundle), 'no console.log in the artifact');
  assert.equal((bundle.match(/==UserScript==/g) || []).length, 1);
  assert.ok(bundle.trimEnd().endsWith('})();'), 'bundle must close its IIFE');
});

test('vendor engine files are present and the wasm has the right magic', () => {
  const wasm = fs.readFileSync(path.join(ROOT, 'vendor', 'stockfish-19-lite-single.wasm'));
  assert.equal(wasm.subarray(0, 4).toString('binary'), '\x00asm');
  assert.ok(fs.existsSync(path.join(ROOT, 'vendor', 'stockfish-19-lite-single.js')));
  assert.ok(fs.existsSync(path.join(ROOT, 'vendor', 'stockfish.js')));
  assert.ok(fs.readFileSync(path.join(ROOT, 'vendor', 'Copying.txt'), 'utf8').includes('GNU'));
});
