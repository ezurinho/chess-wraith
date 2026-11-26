#!/usr/bin/env node
'use strict';

// One change, one release. Prepare, verify, commit, tag, publish, wait for the
// CDN. Every step is fatal: a failed check must never reach a tag.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const version = String(process.argv[2] || '').replace(/^v/, '');
// PowerShell splits an unquoted title, so the tail of the command line is the title.
const title = process.argv.slice(3).join(' ') || `chess-wraith ${version}`;

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('usage: node tools/ship.js <x.y.z> [release title]');
  process.exit(2);
}

// `npm.cmd` is a batch file: Node refuses to spawn it without a shell (the
// 2024 command-injection fix), and a shell would re-split any argument with a
// space. When the caller is npm itself (the normal case) it hands over the path
// to its JS entry point, which needs no shell at all.
function runCheck() {
  const cli = process.env.npm_execpath;
  if (cli && /\.js$/.test(cli)) return run(process.execPath, [cli, 'run', 'check']);
  return run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', '--silent', 'check'], { shell: process.platform === 'win32' });
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.status !== 0) {
    const reason = result.error ? result.error.message : `exit ${result.status}`;
    console.error(`\nship: ${cmd} ${args.join(' ')} failed (${reason})`);
    process.exit(result.status || 1);
  }
}

function notesFor(v) {
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const section = changelog.split(/^## /m).find((s) => s.startsWith(v + ' \u2014') || s.startsWith(v + ' -'));
  if (!section) return `chess-wraith ${v}\n`;
  const body = section.replace(/^[^\n]*\n/, '').trim();
  return body ? body + '\n' : `chess-wraith ${v}\n`;
}

async function waitForCdn(v) {
  const urls = [
    `https://cdn.jsdelivr.net/gh/ezurinho/chess-wraith@v${v}/vendor/stockfish-19-lite-single.wasm`,
    `https://cdn.jsdelivr.net/gh/ezurinho/chess-wraith@v${v}/vendor/stockfish.js`,
    `https://cdn.jsdelivr.net/gh/ezurinho/chess-wraith@v${v}/update.json`
  ];
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    let ready = 0;
    for (const url of urls) {
      try {
        const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(12000) });
        if (response.ok) ready += 1;
      } catch {
        /* still warming the edge */
      }
    }
    if (ready === urls.length) return true;
    await new Promise((resolve) => setTimeout(resolve, 6000));
  }
  return false;
}

(async () => {
  console.log(`ship: ${version} - ${title}`);
  run('node', ['tools/release.js', 'prepare', version]);
  runCheck();
  fs.writeFileSync(path.join(root, '.release-notes.md'), notesFor(version));
  run('git', ['add', '-A']);
  run('git', ['commit', '-m', `release: ${version} - ${title}`]);
  run('git', ['tag', '-a', `v${version}`, '-m', `chess-wraith ${version}`]);
  run('git', ['push', 'origin', 'main']);
  run('git', ['push', 'origin', `v${version}`]);
  run('gh', ['release', 'create', `v${version}`, 'chess-wraith.user.js', 'chess-wraith.meta.js', 'update.json', '--title', title, '--notes-file', '.release-notes.md']);
  const cdn = await waitForCdn(version);
  const url = `https://github.com/ezurinho/chess-wraith/releases/tag/v${version}`;
  console.log(`\nship: ${url}`);
  console.log(`ship: CDN ${cdn ? 'ready' : 'NOT READY after 3 minutes - check jsdelivr'}`);
  if (!cdn) process.exit(3);
})();
