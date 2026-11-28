#!/usr/bin/env node
'use strict';

/*
 * The installable artifact is one userscript. The source is split into ordered
 * fragments so each part can be read and tested on its own, and this tool
 * concatenates them inside a single IIFE (they share one lexical scope).
 *
 *   node tools/build.js           write chess-wraith.user.js, .meta.js and update.json
 *   node tools/build.js --check   fail if any artifact on disk is stale
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'chess-wraith.user.js');
const META = path.join(ROOT, 'chess-wraith.meta.js');
const MANIFEST = path.join(ROOT, 'update.json');
const HEADER = '00-header.js';

const MODULES = [
  '10-config.js',
  '20-utils.js',
  '25-update.js',
  '30-chess.js',
  '35-chess-glue.js',
  '40-board.js',
  '45-overlay.js',
  '50-engine.js',
  '55-pace.js',
  '60-analysis.js',
  '62-report.js',
  '65-afk.js',
  '70-input.js',
  '80-panel.js',
  '90-boot.js'
];

const normalize = (text) => text.replace(/\r\n?/g, '\n');
const read = (name) => normalize(fs.readFileSync(path.join(ROOT, 'src', name), 'utf8'));

function header() {
  return read(HEADER);
}

function metaHeader(text) {
  const marker = '// ==/UserScript==';
  const end = text.indexOf(marker);
  if (end < 0) throw new Error('src/00-header.js has no ==/UserScript== block');
  const lineEnd = text.indexOf('\n', end);
  return lineEnd < 0 ? `${text.slice(0, end + marker.length)}\n` : text.slice(0, lineEnd + 1);
}

function bundle() {
  const body = MODULES.map(read).join('\n');
  return `${header()}\n(function () {\n'use strict';\n\n${body}\n})();\n`;
}

// The updater's proof is generated from the exact bytes written above, not
// maintained by hand. `--check` compares both, so a release cannot tag a stale
// manifest beside a new bundle.
function manifest(text) {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const bytes = Buffer.from(text, 'utf8');
  return `${JSON.stringify({
    version: pkg.version,
    file: path.basename(SCRIPT),
    size: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex')
  }, null, 2)}\n`;
}

function main() {
  const next = bundle();
  const meta = metaHeader(next);
  const update = manifest(next);
  const check = process.argv.includes('--check');
  const current = fs.existsSync(SCRIPT) ? normalize(fs.readFileSync(SCRIPT, 'utf8')) : '';
  const currentMeta = fs.existsSync(META) ? normalize(fs.readFileSync(META, 'utf8')) : '';
  const currentManifest = fs.existsSync(MANIFEST) ? normalize(fs.readFileSync(MANIFEST, 'utf8')) : '';

  if (check) {
    if (current !== next) {
      console.error('chess-wraith.user.js is stale: run `npm run build`');
      process.exit(1);
    }
    if (currentMeta !== meta) {
      console.error('chess-wraith.meta.js is stale: run `npm run build`');
      process.exit(1);
    }
    if (currentManifest !== update) {
      console.error('update.json is stale: run `npm run build`');
      process.exit(1);
    }
    console.log(`bundle ok · ${Buffer.byteLength(next, 'utf8')} bytes · ${MODULES.length + 1} fragments`);
    return;
  }

  fs.writeFileSync(SCRIPT, next);
  fs.writeFileSync(META, meta);
  fs.writeFileSync(MANIFEST, update);
  console.log(`wrote chess-wraith.user.js (${Buffer.byteLength(next, 'utf8')} bytes)`);
}

main();
