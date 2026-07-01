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

const versionReadyStart = html.indexOf('var _onVersionReady = function()');
const versionReadyEnd = html.indexOf('// 立即执行版本检查', versionReadyStart);
const versionReadySource = versionReadyStart >= 0 && versionReadyEnd > versionReadyStart
  ? html.slice(versionReadyStart, versionReadyEnd)
  : '';
if (!versionReadySource) {
  fail('version-ready handler not found');
}
if (versionReadySource.includes('location.replace(')) {
  fail('normal startup must not force a second page navigation for cache busting');
}
if (!html.includes('showUpdatePrompt(sv)') || !html.includes('location.href = buildVersionUrl(v)')) {
  fail('version updates must still require an explicit user-triggered refresh');
}

const careAddStart = html.indexOf('window.addCareRecord = function()');
const careAddEnd = html.indexOf('window.removeCareRecord', careAddStart);
const careAddSource = careAddStart >= 0 && careAddEnd > careAddStart ? html.slice(careAddStart, careAddEnd) : '';
if (careAddSource.includes('care_outbound_queue')) {
  fail('adding a care item must not enqueue inventory before the hair record is saved');
}
for (const marker of ['enqueueCareOutboundForRecord', 'prepareCareOutboundBaseline', 'retryLatestCareOutbound', 'scheduleCareOutboundStatusPoll']) {
  if (!html.includes(marker)) fail('missing care outbound safety marker: ' + marker);
}
const careQueueStart = html.indexOf('function careOutboundPendingRows(');
const careQueueEnd = html.indexOf('function refreshCareOutboundStatus(', careQueueStart);
const careQueueSource = careQueueStart >= 0 && careQueueEnd > careQueueStart ? html.slice(careQueueStart, careQueueEnd) : '';
if (careQueueSource.includes('barber:')) {
  fail('care outbound payload uses barber, but care_outbound_queue has no barber column');
}
if (!careQueueSource.includes("resolution=ignore-duplicates,return=representation")) {
  fail('care outbound insert must use deterministic-id conflict protection');
}

try {
  cp.execFileSync('node', ['scripts/check-version-sync.js'], { stdio: 'inherit' });
} catch (_) {
  fail('version sync check failed');
}

console.log(`smoke test ok: ${scripts.length} script blocks`);
