#!/usr/bin/env node
'use strict';

// Version bookkeeping for the four places the version lives. The release
// workflow runs prepare -> build -> check before it tags anything, so a tag
// can never point at a bundle that disagrees with itself.

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SEMVER = /^\d+\.\d+\.\d+$/;

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const write = (rel, text) => fs.writeFileSync(path.join(ROOT, rel), text);

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function bumpIn(rel, pattern, version) {
  const text = read(rel);
  if (!pattern.test(text)) fail(`cannot find the version line in ${rel}`);
  pattern.lastIndex = 0;
  write(rel, text.replace(pattern, version));
}

function versions() {
  return {
    package: JSON.parse(read('package.json')).version,
    header: (/@version\s+(\S+)/.exec(read('src/00-header.js')) || [])[1],
    config: (/const VERSION = '([^']+)'/.exec(read('src/10-config.js')) || [])[1],
    readme: (/version-(\d+\.\d+\.\d+)-/.exec(read('README.md')) || [])[1],
    changelog: (/^## (\d+\.\d+\.\d+)/m.exec(read('CHANGELOG.md')) || [])[1]
  };
}

function check() {
  const found = versions();
  const entries = Object.entries(found);
  for (const [where, version] of entries) {
    if (!version) fail(`no version found in ${where}`);
    if (!SEMVER.test(version)) fail(`${where} has a malformed version: ${version}`);
  }
  const distinct = new Set(entries.map(([, version]) => version));
  if (distinct.size !== 1) {
    fail(`versions disagree: ${entries.map(([where, version]) => `${where}=${version}`).join(', ')}`);
  }
  console.log(`release: all sources agree on ${found.package}`);
}

function changelogSection(version) {
  const text = read('CHANGELOG.md');
  const start = text.indexOf(`## ${version}`);
  if (start < 0) fail(`CHANGELOG.md has no section for ${version}`);
  const rest = text.slice(start);
  const end = rest.indexOf('\n## ', 1);
  const body = end < 0 ? rest : rest.slice(0, end);
  return body.replace(/^## /, '### ').trim();
}

function prepare(version) {
  if (!SEMVER.test(version || '')) fail('usage: release.js prepare <major.minor.patch>');
  if (versions().changelog !== version && !read('CHANGELOG.md').includes(`## ${version}`)) {
    fail(`write the ${version} section in CHANGELOG.md first`);
  }
  bumpIn('src/00-header.js', /@version\s+\S+/, `@version      ${version}`);
  bumpIn('src/10-config.js', /const VERSION = '[^']+';/, `const VERSION = '${version}';`);
  bumpIn('package.json', /"version": "[^"]+"/, `"version": "${version}"`);
  const lock = JSON.parse(read('package-lock.json'));
  lock.version = version;
  if (lock.packages && lock.packages['']) lock.packages[''].version = version;
  write('package-lock.json', `${JSON.stringify(lock, null, 2)}\n`);
  bumpIn('README.md', /version-\d+\.\d+\.\d+-/, `version-${version}-`);
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build.js')], { cwd: ROOT, stdio: 'inherit' });
  check();
  console.log(`release: prepared ${version}`);
}

function notes(version) {
  process.stdout.write(`${changelogSection(version)}\n`);
}

const [command, argument] = process.argv.slice(2);
if (command === 'check') check();
else if (command === 'prepare') prepare(argument);
else if (command === 'notes') notes(argument);
else fail('usage: release.js check | prepare <version> | notes <version>');
