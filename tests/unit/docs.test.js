'use strict';

// Numbers in docs are claims that rot. Twice in two days the test count in
// AGENTS.md and docs/research.md described a suite that no longer existed, and
// nothing failed. This file counts the tests and makes the docs prove it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const UNIT = path.join(ROOT, 'tests', 'unit');

function census() {
  const files = fs.readdirSync(UNIT).filter((name) => name.endsWith('.test.js')).sort();
  const tests = files.reduce((total, name) => {
    const body = fs.readFileSync(path.join(UNIT, name), 'utf8');
    return total + (body.match(/^test\(/gm) || []).length;
  }, 0);
  return { files, tests };
}

test('the test count in AGENTS.md matches the suite', () => {
  const { tests } = census();
  const agents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
  assert.ok(
    agents.includes(`**${tests} tests.**`),
    `AGENTS.md must say **${tests} tests.** — it says something else`
  );
});

test('the test count in docs/research.md matches the suite', () => {
  const { files, tests } = census();
  const research = fs.readFileSync(path.join(ROOT, 'docs', 'research.md'), 'utf8');
  const row = `| Tests | ${files.length} files | ${tests} tests in ${files.length} files`;
  assert.ok(
    research.includes(row),
    `docs/research.md must carry "${row}" — it carries a stale row`
  );
});
