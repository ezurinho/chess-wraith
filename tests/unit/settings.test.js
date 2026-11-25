'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE = ['10-config.js', '20-utils.js']
  .map((name) => fs.readFileSync(path.join(ROOT, 'src', name), 'utf8'))
  .join('\n');

// document and window are the only host objects these two functions touch, so a
// stub is enough: the real page logic is the selector list, not the DOM.
function harness({ domUser = null, siteUser = null } = {}) {
  const store = new Map();
  const document = {
    querySelector: (sel) => (domUser ? { textContent: domUser, selector: sel } : null)
  };
  const window = siteUser ? { chesscom: { user: { username: siteUser } } } : {};
  const context = vm.createContext({
    console, Math, Date, JSON, Number, String, Array, Object, RegExp,
    performance: { now: () => 0 },
    document,
    window,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); }
    }
  });
  vm.runInContext(
    `${SOURCE}\n;globalThis.__t = { loadSettings, saveSettings, settingsKeyFor, currentAccount, normalizeAccountName, CONFIG, STORAGE_KEY };`,
    context,
    { filename: 'settings-fragments.js' }
  );
  return { api: context.__t, store };
}

test('the account name is sanitized and the storage key follows it', () => {
  const { api } = harness();
  assert.equal(api.normalizeAccountName('  Hikaru_99!! '), 'hikaru_99');
  assert.equal(api.normalizeAccountName('a'.repeat(60)).length, 32);
  assert.equal(api.settingsKeyFor('Anonymous'), api.STORAGE_KEY);
  assert.equal(api.settingsKeyFor(''), api.STORAGE_KEY);
  assert.equal(api.settingsKeyFor('Hikaru'), `${api.STORAGE_KEY}:hikaru`);
});

test('signed-in name comes from the navbar, and from chess.com state before it paints', () => {
  assert.equal(harness({ domUser: 'MagnusCarlsen' }).api.currentAccount(), 'magnuscarlsen');
  assert.equal(harness({ siteUser: 'Hikaru' }).api.currentAccount(), 'hikaru');
  assert.equal(harness().api.currentAccount(), 'anonymous');
});

test('two accounts on one browser do not share their settings', () => {
  const { api } = harness();
  const alice = { ...api.CONFIG, maxDepth: 12, theme: 'ice' };
  api.saveSettings(alice, 'alice');
  const bob = api.loadSettings('bob');
  assert.equal(bob.maxDepth, api.CONFIG.maxDepth, 'bob starts at the defaults');
  assert.equal(bob.theme, api.CONFIG.theme);
  const back = api.loadSettings('alice');
  assert.equal(back.maxDepth, 12);
  assert.equal(back.theme, 'ice');
});

test('an existing install keeps its tuning through the one-time migration', () => {
  const { api } = harness();
  api.saveSettings({ ...api.CONFIG, maxDepth: 11 }, 'anonymous');
  const migrated = api.loadSettings('alice');
  assert.equal(migrated.maxDepth, 11, 'the global settings become this account\'s first settings');
  api.saveSettings({ ...migrated, maxDepth: 15 }, 'alice');
  assert.equal(api.loadSettings('alice').maxDepth, 15);
  assert.equal(api.loadSettings('bob').maxDepth, 11, 'and the legacy value is untouched for the next account');
});
