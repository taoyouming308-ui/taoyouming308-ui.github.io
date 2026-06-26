#!/usr/bin/env node
const fs = require('fs');
const cp = require('child_process');

function fail(message) {
  console.error('ROLLBACK PREP FAILED: ' + message);
  process.exit(1);
}

const stableRef = process.argv[2];
const nextVersion = parseInt(process.argv[3], 10);

if (!stableRef || !Number.isFinite(nextVersion) || nextVersion <= 0) {
  fail('usage: node scripts/rollback-forward.js <stable-git-ref> <new-version>');
}

let html = '';
try {
  html = cp.execFileSync('git', ['show', `${stableRef}:perm-app.html`], { encoding: 'utf8' });
} catch (err) {
  fail('cannot read perm-app.html from ' + stableRef);
}

if (!/<html[^>]*data-version="\d+"/.test(html)) {
  fail('stable perm-app.html missing data-version');
}

html = html.replace(/(<html[^>]*data-version=")\d+(")/, `$1${nextVersion}$2`);
fs.writeFileSync('perm-app.html', html);
fs.writeFileSync('version.txt', String(nextVersion) + '\n');
fs.writeFileSync('version.json', JSON.stringify({ version: nextVersion }) + '\n');

console.log(`prepared forward rollback from ${stableRef} as v${nextVersion}`);
console.log('Next: run node scripts/smoke-test-app.js, commit, then push both remotes.');
