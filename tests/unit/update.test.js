'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFragments } = require('./helpers');

const api = loadFragments(
  ['10-config.js', '20-utils.js'],
  `{ versionNewer, versionParts, updateCheckDue, parseUpdateManifest, UPDATE_MANIFEST_URL, UPDATE_API_URL, UPDATE_DOWNLOAD_URL, UPDATE_PAGE_URL, UPDATE_RECHECK_MS, VERSION }`
);
const HASH = 'a'.repeat(64);

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
  assert.match(api.UPDATE_MANIFEST_URL, /@latest\/update\.json$/);
  assert.match(api.UPDATE_API_URL, /api\.github\.com\/repos\/ezurinho\/chess-wraith\/releases\/latest$/);
  assert.match(api.UPDATE_DOWNLOAD_URL, /releases\/latest\/download\/chess-wraith\.user\.js$/);
  assert.match(api.UPDATE_PAGE_URL, /releases\/latest$/);
  assert.match(api.VERSION, /^\d+\.\d+\.\d+$/);
});
test('the update manifest carries the version, size and SHA-256', () => {
  const manifest = api.parseUpdateManifest(JSON.stringify({
    version: '1.89.2',
    file: 'chess-wraith.user.js',
    size: 330000,
    sha256: HASH
  }));
  assert.equal(manifest.version, '1.89.2');
  assert.equal(manifest.size, 330000);
  assert.equal(manifest.sha256, HASH);
  assert.equal(manifest.file, 'chess-wraith.user.js');
});

test('a manifest with a bad hash or size is no manifest at all', () => {
  const base = { version: '1.89.2', file: 'chess-wraith.user.js', size: 330000, sha256: HASH };
  assert.equal(api.parseUpdateManifest({ ...base, sha256: 'abc' }), null);
  assert.equal(api.parseUpdateManifest({ ...base, sha256: 'g'.repeat(64) }), null);
  assert.equal(api.parseUpdateManifest({ ...base, sha256: 'A'.repeat(64) }).sha256, HASH, 'hex is normalised to lower case');
  assert.equal(api.parseUpdateManifest({ ...base, size: 0 }), null);
  assert.equal(api.parseUpdateManifest({ ...base, size: -1 }), null);
  assert.equal(api.parseUpdateManifest({ ...base, file: 'other.user.js' }), null);
  assert.equal(api.parseUpdateManifest('{not json'), null);
  assert.equal(api.parseUpdateManifest(null), null);
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
