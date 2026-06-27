#!/usr/bin/env node
const cp = require('child_process');
const fs = require('fs');
const vm = require('vm');

function fail(message) {
  console.error('RELEASE INTEGRITY FAILED: ' + message);
  process.exit(1);
}

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function git(args) {
  return cp.execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function hasRef(ref) {
  try {
    git(['rev-parse', '--verify', '--quiet', ref]);
    return true;
  } catch (_) {
    return false;
  }
}

function appVersion(source) {
  const match = source.match(/<html[^>]*data-version="(\d+)"/);
  return match ? Number(match[1]) : 0;
}

const app = read('perm-app.html');
const version = appVersion(app);
if (!version) fail('perm-app.html has no valid data-version');

const requiredMarkers = [
  ['status=neq.deleted', 'cloud task soft-delete filter'],
  ['DATA_LOAD_PROMISE', 'shared perm-data loader'],
  ['care_outbound_queue', 'care outbound queue integration'],
  ['careOutboundSnapshot', 'care outbound delta snapshot'],
];

for (const [marker, label] of requiredMarkers) {
  if (!app.includes(marker)) fail(`missing ${label}: ${marker}`);
}

for (const file of ['perm-app.html', 'admin.html']) {
  const html = read(file);
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  scripts.forEach((match, index) => {
    try {
      new vm.Script(match[1], { filename: `${file}:script-${index}` });
    } catch (error) {
      fail(`${file} script ${index} syntax error: ${error.message}`);
    }
  });
}

const baseRef = process.env.RELEASE_BASE_REF || (hasRef('HEAD^') ? 'HEAD^' : '');
if (baseRef) {
  let oldVersion = 0;
  try {
    oldVersion = Number(git(['show', `${baseRef}:version.txt`]));
  } catch (_) {}

  if (oldVersion && version < oldVersion) {
    fail(`version decreased from ${oldVersion} to ${version}`);
  }

  const changed = git(['diff', '--name-status', baseRef, 'HEAD']).split('\n').filter(Boolean);
  const appCodeChanged = changed.some((line) => /(?:^|\t)(perm-app\.html|admin\.html)$/.test(line));
  if (appCodeChanged && oldVersion && version <= oldVersion) {
    fail(`app code changed without a version bump (still v${version})`);
  }

  const staleSnapshots = changed.filter((line) => {
    const [status, path] = line.split('\t');
    return /^[AM]/.test(status) &&
      (/^perm-app\.v\d+\.html$/.test(path) || path === 'perm-app.backup.html');
  });
  if (staleSnapshots.length) {
    fail('runtime snapshots must not be added or modified: ' + staleSnapshots.join(', '));
  }
}

console.log(`release integrity ok: v${version}`);
