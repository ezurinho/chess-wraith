'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The panel binds `[data-el]` to `this.el[name]`, so two elements sharing a
// name means one of them silently stops updating — exactly what happened to
// the Build card when the Updates card was added.
const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', '80-panel.js'), 'utf8');

test('every data-el name is bound exactly once', () => {
  const names = [...source.matchAll(/data-el="([^"]+)"/g)].map((m) => m[1]);
  const seen = new Set();
  const duplicates = [];
  for (const name of names) {
    if (seen.has(name)) duplicates.push(name);
    seen.add(name);
  }
  assert.deepEqual(duplicates, [], `bound twice: ${duplicates.join(', ')}`);
});

test('the panel has one update pill and one hidden attribute on it', () => {
  const pills = [...source.matchAll(/class="upd"[^>]*/g)].map((m) => m[0]);
  assert.equal(pills.length, 1, 'expected exactly one update pill');
  assert.match(pills[0], /\bhidden\b/, 'the pill must start hidden');
  assert.match(pills[0], /\$\{UPDATE_DOWNLOAD_URL\}/, 'the pill must point at the latest release');
});
