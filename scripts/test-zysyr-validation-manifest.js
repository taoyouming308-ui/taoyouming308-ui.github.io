'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const nodeVersion = fs.readFileSync(path.join(root, '.node-version'), 'utf8').trim();
assert.equal(nodeVersion, process.versions.node, 'local and CI must use the exact pinned Node.js version');
const result = spawnSync(process.execPath, [path.join(__dirname, 'run-zysyr-finance-tests.js'), '--check'], {
  cwd: root,
  encoding: 'utf8',
});
assert.equal(result.status, 0, result.stderr || result.stdout);
assert.match(result.stdout, /finance test manifest valid: \d+ commands, \d+ test files/);

const hook = fs.readFileSync(path.join(root, '.githooks/pre-push'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github/workflows/validate.yml'), 'utf8');
assert.equal((hook.match(/node scripts\/run-zysyr-finance-tests\.js/g) || []).length, 1, 'pre-push must invoke the shared finance suite exactly once');
assert.equal((workflow.match(/node scripts\/run-zysyr-finance-tests\.js/g) || []).length, 1, 'GitHub Actions must invoke the shared finance suite exactly once');
assert.match(workflow, /node-version-file:\s*\.node-version/, 'GitHub Actions must use the pinned Node.js version');
assert.match(workflow, /runs-on:\s*ubuntu-24\.04/, 'GitHub Actions runner image must not float on ubuntu-latest');

console.log('ZYSYR finance test manifest integration passed');
