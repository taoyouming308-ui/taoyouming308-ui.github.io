#!/usr/bin/env node
const fs = require('fs');
const cp = require('child_process');

function fail(message) {
  console.error('VERSION CHECK FAILED: ' + message);
  process.exit(1);
}

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

function gitShow(ref, path) {
  try {
    return cp.execFileSync('git', ['show', `${ref}:${path}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (_) {
    return '';
  }
}

function parseIntStrict(value, label) {
  const n = parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(n) || n <= 0) fail(`invalid ${label}: ${value}`);
  return n;
}

const html = read('perm-app.html');
const htmlMatch = html.match(/<html[^>]*data-version="(\d+)"/);
if (!htmlMatch) fail('perm-app.html missing data-version');

const htmlVersion = parseIntStrict(htmlMatch[1], 'perm-app.html data-version');
const txtVersion = parseIntStrict(read('version.txt'), 'version.txt');
let jsonVersion = 0;
try {
  jsonVersion = parseIntStrict(JSON.parse(read('version.json')).version, 'version.json');
} catch (err) {
  fail('invalid version.json: ' + err.message);
}

if (htmlVersion !== txtVersion || txtVersion !== jsonVersion) {
  fail(`local version mismatch: html=${htmlVersion}, txt=${txtVersion}, json=${jsonVersion}`);
}

const remoteRefs = ['github/main', 'origin/master'];
for (const ref of remoteRefs) {
  const remoteTxt = gitShow(ref, 'version.txt');
  const remoteHtml = gitShow(ref, 'perm-app.html');
  const remoteHtmlMatch = remoteHtml.match(/<html[^>]*data-version="(\d+)"/);
  const remoteVersion = remoteTxt ? parseInt(remoteTxt, 10) : (remoteHtmlMatch ? parseInt(remoteHtmlMatch[1], 10) : 0);
  if (remoteVersion > 0 && txtVersion < remoteVersion) {
    fail(`local version ${txtVersion} is lower than ${ref} version ${remoteVersion}`);
  }
}

console.log(`version check ok: v${txtVersion}`);
