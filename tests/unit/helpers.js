'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');

// Fragments share one lexical scope in the bundle, so tests load them the same
// way: one context, concatenated sources, then a single export line.
function loadFragments(names, exportExpr, extras = {}) {
  const context = vm.createContext({ console, Math, Date, JSON, performance: { now: () => 0 }, ...extras });
  const source = names
    .map((name) => fs.readFileSync(path.join(ROOT, 'src', name), 'utf8'))
    .join('\n');
  vm.runInContext(`${source}\n;globalThis.__exported = (${exportExpr});`, context, {
    filename: 'bundle-fragments.js'
  });
  return context.__exported;
}

module.exports = { ROOT, loadFragments };
