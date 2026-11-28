#!/usr/bin/env node
'use strict';

/*
 * Release helper for CHESS WRAITH.
 *
 * `check`   verifies that every public version marker agrees.
 * `prepare` decides what the next green main run should publish and, when
 *           needed, bumps the patch version and writes the release notes.
 *
 * It intentionally has no dependencies: GitHub Actions runs it with Node 22.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const RELEASE_INSTALL = 'https://github.com/ezurinho/chess-wraith/releases/latest/download/chess-wraith.user.js';
const NOTES_FILE = path.join(ROOT, '.release-notes.md');

const FILES = {
  script: 'chess-wraith.user.js',
  meta: 'chess-wraith.meta.js',
  pkg: 'package.json',
  readme: 'README.md',
  changelog: 'CHANGELOG.md',
  headerSource: 'src/00-header.js',
  configSource: 'src/10-config.js'
};

function readFile(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function writeFile(relative, text) {
  fs.writeFileSync(path.join(ROOT, relative), text);
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function tagExists(tag) {
  return spawnSync('git', ['rev-parse', '-q', '--verify', 'refs/tags/' + tag], {
    cwd: ROOT,
    stdio: 'ignore'
  }).status === 0;
}

function extractVersion(line) {
  // From // @version      1.2.0 or const VERSION = '1.2.0'
  var idx = line.indexOf('version');
  if (idx < 0) return '';
  var after = line.substring(idx + 7).trim();
  // Remove leading spaces and non-version chars
  var start = after.search(/\d/);
  if (start < 0) return '';
  var s = after.substring(start);
  // Take up to 3 number groups separated by dots
  var end = s.search(/[^\d.]/);
  if (end < 0) end = s.length;
  return s.substring(0, end);
}

function versions() {
  var script = readFile(FILES.script);
  var meta = readFile(FILES.meta);
  var headerSource = readFile(FILES.headerSource);
  var configSource = readFile(FILES.configSource);
  var pkg = JSON.parse(readFile(FILES.pkg));
  var readme = readFile(FILES.readme);

  // Script @version - find line with @version and extract
  var scriptVersion = '';
  var sl = script.split('\n');
  for (var i = 0; i < sl.length; i++) {
    var v = extractVersion(sl[i]);
    if (v && /^\d+\.\d+\.\d+$/.test(v)) {
      scriptVersion = v;
      break;
    }
  }

  // Constant VERSION
  var constantVersion = '';
  var ci = configSource.indexOf("const VERSION = '");
  if (ci >= 0) {
    var ce = configSource.indexOf("';", ci);
    if (ce < 0) ce = configSource.length;
    constantVersion = configSource.substring(ci + "const VERSION = '".length, ce).trim();
  }

  // Meta @version
  var metaVersion = '';
  var ml = meta.split('\n');
  for (var i = 0; i < ml.length; i++) {
    var v = extractVersion(ml[i]);
    if (v && /^\d+\.\d+\.\d+$/.test(v)) {
      metaVersion = v;
      break;
    }
  }

  // Source header @version
  var sourceHeaderVersion = '';
  var hl = headerSource.split('\n');
  for (var i = 0; i < hl.length; i++) {
    var v = extractVersion(hl[i]);
    if (v && /^\d+\.\d+\.\d+$/.test(v)) {
      sourceHeaderVersion = v;
      break;
    }
  }

  // Source VERSION constant
  var sourceConfigVersion = '';
  var sci = configSource.indexOf("const VERSION = '");
  if (sci >= 0) {
    var sc = configSource.indexOf("';", sci);
    if (sc < 0) sc = configSource.length;
    sourceConfigVersion = configSource.substring(sci + "const VERSION = '".length, sc).trim();
  }

  // Package version
  var packageVersion = String(pkg.version || '');

  // README badge
  var readmeBadge = '';
  var rb = readme.indexOf('version-');
  if (rb >= 0) {
    var re = readme.indexOf('-', rb + 6);
    if (re >= 0) readmeBadge = readme.substring(rb + 6, re);
    else readmeBadge = readme.substring(rb + 6);
  }

  return {
    script: scriptVersion,
    constant: constantVersion,
    meta: metaVersion,
    sourceHeader: sourceHeaderVersion,
    sourceConfig: sourceConfigVersion,
    package: packageVersion,
    readmeBadge: readmeBadge
  };
}

function check() {
  var found = versions();
  var expected = found.script;
  var bad = [];
  for (var [key, value] of Object.entries(found)) {
    if (value !== expected) bad.push(key + '=' + value);
  }
  if (bad.length) {
    throw new Error('Version mismatch: ' + bad.join(', ') + ' (expected ' + expected +').');
  }
  if (!/^\d+\.\d+\.\d+$/.test(expected)) throw new Error('Version is not a plain semver: ' + expected);
  return expected;
}

function tags() {
  var output = git(['tag', '--sort=-v:refname']);
  if (!output) return [];
  return output.split('\n').filter(function(tag) { return /^v\d+\.\d+\.\d+$/.test(tag); });
}

function latestTag() {
  var tags = tags();
  return tags[0] || '';
}

function bumpPatch(version) {
  var m = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error('Cannot bump non-semver version: ' + version);
  return m[1] + '.' + m[2] + '.' + (Number(m[3]) + 1);
}

function commitsSince(tag) {
  var range = tag ? tag + '..HEAD' : 'HEAD';
  var args = ['log', '--no-merges', '--pretty=format:%s'];
  if (!tag) args.push('--max-count=20');
  args.push(range);
  var output = git(args);
  if (!output) return [];
  return output.split('\n').map(function(line) { return line.trim(); }).filter(Boolean);
}

function releaseBullets(tag) {
  var subjects = commitsSince(tag);
  var filtered = [];
  for (var i = 0; i < subjects.length; i++) {
    var s = subjects[i];
    if (s.indexOf('release') === 0) continue; // starts with "release"
    if (s.indexOf('[skip ci]') >= 0) continue;
    if (s.indexOf('(ci:') === 0 || s.indexOf('(docs:') === 0 || s.indexOf('(chore:') === 0) continue;
    filtered.push(s);
  }
  var unique = [...new Set(filtered)];
  return unique.length ? unique.map(function(subject) { return '- ' + subject; }) : ['- Maintenance release.'];
}

function setVersion(next) {
  var header = readFile(FILES.headerSource);
  // Replace // @version      X.Y.Z
  var hi = header.indexOf('@version');
  if (hi >= 0) {
    var hl = header.indexOf('\n', hi);
    if (hl < 0) hl = header.length;
    var before = header.substring(0, hi);
    var after = header.substring(hl);
    header = before + '// @version      ' + next + after;
  }
  // Replace const VERSION = 'X.Y.Z'
  var ci = configSource.indexOf("const VERSION = '");
  if (ci >= 0) {
    var ce = configSource.indexOf("';", ci);
    if (ce < 0) ce = configSource.length;
    configSource = configSource.substring(0, ci) + "const VERSION = '" + next + "';" + configSource.substring(ce + 2);
  }
  // Replace version-X.Y.Z- in README
  var readme = readFile(FILES.readme);
  readme = readme.replace('version-' + next + '-', 'version-' + next + '-');

  writeFile(FILES.headerSource, header);
  writeFile(FILES.configSource, configSource);
  writeFile(FILES.readme, readme);

  execFileSync(process.execPath, [path.join(ROOT, 'tools/build.js')], {
    cwd: ROOT,
    stdio: 'ignore'
  });
}

function addChangelog(version, bullets) {
  var old = readFile(FILES.changelog);
  if (old.includes('## ' + version + ' ')) return;
  var eol = old.includes('\r\n') ? '\r\n' : '\n';
  var date = new Date().toISOString().slice(0, 10);
  var entry = ['## ' + version + ' - ' + date, '', ...bullets, '', ''].join(eol);
  var updated = old.replace(/^(# Changelog\r?\n\r?\n)/, '$1' + entry);
  if (updated === old) throw new Error('CHANGELOG.md has no "# Changelog" header.');
  writeFile(FILES.changelog, updated);
}

function writeNotes(version, bullets) {
  var lines = [
    '# CHESS WRAITH ' + version,
    '',
    'Published automatically after the `check` workflow passed on `main`.',
    '',
    '## Changes',
    '',
    ...bullets,
    '',
    '## Verification',
    '',
    'GitHub Actions: build check, lint, README/release consistency and the full unit suite passed.',
    '',
    '## Install or update',
    '',
    RELEASE_INSTALL,
    ''
  ];
  fs.writeFileSync(NOTES_FILE, lines.join('\n'), 'utf8');
}

function prepare() {
  var current = check();
  var currentTag = 'v' + current;
  var tagged = tagExists(currentTag);

  var mode = 'publish';
  var previous = latestTag();

  if (tagged) {
    previous = currentTag;
    var changed = git(['diff', '--name-only', currentTag + '..HEAD', '--', FILES.script]);
    mode = changed ? 'bump' : 'skip';
  }

  var next = mode === 'bump' ? bumpPatch(current) : current;
  var bullets = releaseBullets(previous);

  if (mode === 'bump') {
    setVersion(next);
    addChangelog(next, bullets);
  }

  writeNotes(next, bullets);

  console.log('MODE=' + mode);
  console.log('VERSION=' + next);
  console.log('TAG=v' + next);
  console.log('PREV_TAG=' + (previous || ''));
}

try {
  var command = process.argv[2] || 'check';
  if (command === 'check') {
    var version = check();
    console.log('version ' + version + ' is consistent');
  } else if (command === 'prepare') {
    prepare();
  } else {
    throw new Error('Unknown command: ' + command);
  }
} catch (error) {
  console.error('release: ' + error.message);
  process.exit(1);
}