'use strict';

/*
 * Keeps the generated release block in README.md in sync with the changelog.
 * The hand-written parts of the README are left alone.
 *
 * `sync`  rewrites the release block and version links.
 * `check` fails when the block or version links are stale.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const README = path.join(ROOT, 'README.md');
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');
const SCRIPT = path.join(ROOT, 'chess-wraith.user.js');
const PACKAGE = path.join(ROOT, 'package.json');
const REPO = 'https://github.com/ezurinho/chess-wraith';
const START = '<!-- release:start -->';
const END = '<!-- release:end -->';

function readFile(file) {
  return fs.readFileSync(file, 'utf8');
}

function currentVersion() {
  const script = readFile(SCRIPT).match(/@version\s+(\S+)/m);
  const pkg = JSON.parse(readFile(PACKAGE)).version;
  if (!script) throw new Error('chess-wraith.user.js has no @version.');
  if (!pkg) throw new Error('package.json has no version.');
  if (script[1] !== pkg) {
    throw new Error('Version mismatch: userscript=' + script[1] + ', package=' + pkg + '.');
  }
  return script[1];
}

function latestEntry() {
  const text = readFile(CHANGELOG);
  // Find the first ## X.Y.Z date entry
  const body = text.split('## ');
  if (body.length < 2) throw new Error('CHANGELOG.md has no release headings.');

  const firstEntry = body[1];
  // Format: "1.89.2 — 2026-11-26" or "1.89.2 - 2026-11-26"
  const versionMatch = firstEntry.match(/^(\d+\.\d+\.\d+)/);
  if (!versionMatch) throw new Error('CHANGELOG.md first entry has no version.');

  const version = versionMatch[1];
  // Find the date after the version
  const rest = firstEntry.substring(versionMatch[0].length).trim();
  const dateMatch = rest.match(/(\d{4}-\d{2}-\d{2})/);
  if (!dateMatch) throw new Error('CHANGELOG.md first entry has no date.');

  const date = dateMatch[1];

  // Get the bullets from the CHANGELOG
  const allLines = text.split('\n');
  const bullets = [];
  let inBullets = false;
  for (let i = 0; i < allLines.length; i++) {
    const line = allLines[i].trim();
    if (line.startsWith('- ')) {
      inBullets = true;
      bullets.push(line);
    } else if (inBullets && line === '') {
      // Empty line after bullets might end the section, but keep collecting
    } else if (inBullets && !line.startsWith('-') && line !== '') {
      // Non-bullet line ends the bullet section
      inBullets = false;
    }
  }

  if (!bullets.length) throw new Error('CHANGELOG.md first entry has no bullets.');

  return { version: version, date: date, bullets: bullets };
}

function render(entry, eol) {
  return [
    START,
    '## Current release',
    '',
    '**' + '[' + entry.version + ']' + '(https://github.com/ezurinho/chess-wraith/releases/tag/v' + entry.version + ')' + ' · ' + entry.date,
    '',
    ...entry.bullets,
    '',
    '[Full changelog](CHANGELOG.md)',
    END
  ].join(eol);
}

function sync() {
  var version = currentVersion();
  var entry = latestEntry();
  if (entry.version !== version) {
    throw new Error('README release would be ' + entry.version + ', but the userscript is ' + version + '.');
  }

  var old = readFile(README);
  var eol = old.includes('\r\n') ? '\r\n' : '\n';
  var block = render(entry, eol);
  var start = old.indexOf(START);
  var end = old.indexOf(END, start + START.length);
  if (start === -1 || end === -1) {
    throw new Error('README.md needs release:start and release:end markers.');
  }

  var next = old.slice(0, start) + block + old.slice(end + END.length);
  next = next.replace(/version-\d+\.\d+\.\d+-/, 'version-' + version + '-');

  if (next !== old) {
    fs.writeFileSync(README, next);
    console.log('README.md updated for ' + version + '.');
  } else {
    console.log('README.md already in sync for ' + version + '.');
  }
}

function check() {
  var version = currentVersion();
  var entry = latestEntry();
  if (entry.version !== version) {
    throw new Error('CHANGELOG.md is at ' + entry.version + ', but the userscript is ' + version + '.');
  }

  var text = readFile(README);
  var eol = text.includes('\r\n') ? '\r\n' : '\n';
  var block = render(entry, eol);
  if (!text.includes(block)) throw new Error('README.md release block is stale; run npm run readme:sync.');
  if (!text.includes('version-' + version + '-')) throw new Error('README.md version badge is not ' + version + '.');
  if (!text.includes('releases/tag/v' + version)) throw new Error('README.md release link is not v' + version + '.');
  console.log('README.md is in sync for ' + version + '.');
}

try {
  var command = process.argv[2] || 'check';
  if (command === 'sync') sync();
  else if (command === 'check') check();
  else throw new Error('Unknown command: ' + command);
} catch (error) {
  console.error('readme: ' + error.message);
  process.exit(1);
}