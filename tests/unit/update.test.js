'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFragments } = require('./helpers');

const api = loadFragments(
  ['10-config.js', '20-utils.js'],
  `{ versionNewer, versionParts, updateCheckDue, UPDATE_META_URL, UPDATE_API_URL, UPDATE_DOWNLOAD_URL, UPDATE_PAGE_URL, UPDATE_RECHECK_MS, VERSION }`
);

test('a higher version is newer, an equal or lower one is not', () => {
  assert.equal(api.versionNewer('1.4.3', '1.4.2'), true);
  assert.equal(api.versionNewer('1.4.2', '1.4.2'), false);
  assert.equal(api.versionNewer('1.9.9', '1.10.0'), false);
  assert.equal(api.versionNewer('1.10.0', '1.9.9'), true);
  assert.equal(api.versionNewer('2.0', '1.99.99'), true);
  assert.equal(api.versionNewer('v1.5.0', '1.4.2'), true);
});

test('garbage never pretends to be an update', () => {
  assert.equal(api.versionNewer('', '1.4.2'), false);
  assert.equal(api.versionNewer(null, '1.4.2'), false);
  assert.equal(api.versionNewer('next', '1.4.2'), false);
  assert.equal(api.versionNewer('1.4.3', undefined), false);
  // The fragments run in their own VM realm, so compare the shape as text.
  assert.equal(api.versionParts('1.4.2-beta').join('.'), '1.4.2');
  assert.equal(api.versionParts('x'), null);
});

test('the updater reads public static files and installs from the latest release', () => {
  assert.match(api.UPDATE_META_URL, /@latest\/package\.json$/);
  assert.match(api.UPDATE_API_URL, /api\.github\.com\/repos\/ezurinho\/chess-wraith\/releases\/latest$/);
  assert.match(api.UPDATE_DOWNLOAD_URL, /releases\/latest\/download\/chess-wraith\.user\.js$/);
  assert.match(api.UPDATE_PAGE_URL, /releases\/latest$/);
  assert.match(api.VERSION, /^\d+\.\d+\.\d+$/);
});
test('a check is due at boot, throttled for five minutes, then due again', () => {
  const now = 1_700_000_000_000;
  assert.equal(api.updateCheckDue(now, 0, api.UPDATE_RECHECK_MS), true, 'never checked');
  assert.equal(api.updateCheckDue(now, now - 1000, api.UPDATE_RECHECK_MS), false, 'just checked');
  assert.equal(api.updateCheckDue(now, now - 5 * 60 * 1000, api.UPDATE_RECHECK_MS), true, 'five minutes later');
  assert.equal(api.updateCheckDue(now, undefined, api.UPDATE_RECHECK_MS), true);
  assert.equal(api.updateCheckDue(now, 'nonsense', api.UPDATE_RECHECK_MS), true);
  assert.ok(api.UPDATE_RECHECK_MS > 0 && api.UPDATE_RECHECK_MS < 60 * 60 * 1000);
});
