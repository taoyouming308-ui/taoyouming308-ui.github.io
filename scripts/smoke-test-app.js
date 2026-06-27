#!/usr/bin/env node
const fs = require('fs');
const cp = require('child_process');

function fail(message) {
  console.error('SMOKE TEST FAILED: ' + message);
  process.exit(1);
}

const html = fs.readFileSync('perm-app.html', 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
try {
  new Function(scripts.join('\n'));
} catch (err) {
  fail('JavaScript syntax error: ' + err.message);
}

const requiredMarkers = [
  'SUPABASE_URL',
  'window.renderMyTasks',
  'window.saveHairRecordLocal',
  'window.saveAndUploadHairArchive',
  'hairTaskHasFollowup',
  'update-banner',
  'showUpdatePrompt',
  'app-max-version'
];

for (const marker of requiredMarkers) {
  if (!html.includes(marker)) fail('missing required marker: ' + marker);
}

const taskStart = html.indexOf('window.renderMyTasks = function()');
const taskEnd = html.indexOf('window.loadCloudRecord', taskStart);
const taskSource = taskStart >= 0 && taskEnd > taskStart ? html.slice(taskStart, taskEnd) : '';
if (!taskSource.includes('status=neq.deleted')) {
  fail('cloud hair task query must exclude soft-deleted records');
}

try {
  cp.execFileSync('node', ['scripts/check-version-sync.js'], { stdio: 'inherit' });
} catch (_) {
  fail('version sync check failed');
}

console.log(`smoke test ok: ${scripts.length} script blocks`);
