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
if (!html.includes('showUpdatePrompt(sv)') || !html.includes('refreshToVersion(v)')) {
  fail('version updates must still require an explicit user-triggered refresh');
}
const refreshStart = html.indexOf('var refreshToVersion = function(v)');
const refreshEnd = html.indexOf('var showUpdatePrompt = function(v)', refreshStart);
const refreshSource = refreshStart >= 0 && refreshEnd > refreshStart ? html.slice(refreshStart, refreshEnd) : '';
if (!refreshSource.includes("cache: 'reload'") ||
    !refreshSource.includes('readDocumentVersion(html) < v') ||
    !refreshSource.includes('location.replace(target)')) {
  fail('explicit update must fetch, verify, and then replace with the requested version');
}
const promptStart = html.indexOf('var showUpdatePrompt = function(v)');
const promptEnd = html.indexOf('// 当前页面低于本机见过的最高版本', promptStart);
const promptSource = promptStart >= 0 && promptEnd > promptStart ? html.slice(promptStart, promptEnd) : '';
if (promptSource.includes("localStorage.setItem('app-version', v)")) {
  fail('update prompt must not mark a version installed before the new document loads');
}
if (!versionReadySource.includes("fetch(location.pathname, { cache: 'reload'")) {
  fail('versioned startup must refresh the canonical entry cache for the next launch');
}
if (!html.includes('showUpdatePrompt(MAX_VER)') || html.includes('检测到线上版本异常（当前 v')) {
  fail('a cached old page must show the normal clickable update prompt, not a false downgrade warning');
}

const identityStart = html.indexOf('function checkIdentity()');
const identityEnd = html.indexOf('function applyAuthenticatedIdentity(', identityStart);
const identitySource = identityStart >= 0 && identityEnd > identityStart
  ? html.slice(identityStart, identityEnd)
  : '';
if (!html.includes('var APP_SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000;')) {
  fail('employee login session must use a 30-day maximum age');
}
if (!identitySource.includes('rows[0].active === false') ||
    !identitySource.includes('rows[0].store !== session.store')) {
  fail('employee session renewal must still revoke disabled or moved staff');
}
if (!identitySource.includes('loggedAt: Date.now()') ||
    !identitySource.includes('applyAuthenticatedIdentity({')) {
  fail('valid employee sessions must renew after cloud verification');
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
