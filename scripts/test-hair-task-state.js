#!/usr/bin/env node
const fs = require('fs');
const vm = require('vm');

function fail(message) {
  console.error('HAIR TASK STATE TEST FAILED: ' + message);
  process.exit(1);
}

const html = fs.readFileSync('perm-app.html', 'utf8');
const start = html.indexOf('function hairUserIsAssistantForStylist');
const end = html.indexOf('// ===== 渲染待上传记录列表', start);
if (start < 0 || end < 0) fail('state helper block not found');

const context = {};
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);

const cases = [
  ['new assistant task', '待技师填写', { technician: '助理A' }, 'assistant', false],
  ['legacy assistant task', '待回访', { technician: '助理A' }, 'assistant', false],
  ['assistant returned', '技师已完成', { technician: '助理A' }, 'followup', false],
  ['legacy saved', '已完成', { technician: '助理A' }, 'followup', false],
  ['invalid completed without evidence', '回访完成', { technician: '助理A' }, 'followup', false],
  ['completed with rating', '回访完成', { feedbackRating: 'A' }, 'complete', true],
  ['completed with own screenshot', '回访完成', { followUpScreenshot: 'data:image/jpeg;base64,abc' }, 'complete', true],
];

for (const [label, status, record, expectedStage, expectedComplete] of cases) {
  const stage = context.hairTaskStage(status, record);
  const complete = context.hairTaskHasFollowup(status, record);
  if (stage !== expectedStage) fail(`${label}: expected stage ${expectedStage}, got ${stage}`);
  if (complete !== expectedComplete) fail(`${label}: expected complete=${expectedComplete}, got ${complete}`);
}

const archiveCases = [
  ['assistant returned with rating', '技师已完成', { technician: '助理A', feedbackRating: 'A' }, '回访完成'],
  ['assistant returned with screenshot', '技师已完成', { technician: '助理A', followUpScreenshot: 'data:image/jpeg;base64,abc' }, '回访完成'],
  ['assistant returned without evidence', '技师已完成', { technician: '助理A' }, '技师已完成'],
  ['assistant still pending with rating', '待技师填写', { technician: '助理A', feedbackRating: 'A' }, '待技师填写'],
  ['legacy assistant pending with rating', '待回访', { technician: '助理A', feedbackRating: 'A' }, '待技师填写'],
  ['direct stylist record with rating', '待回访', { feedbackRating: 'B' }, '回访完成'],
  ['legacy saved without evidence', '已完成', { technician: '助理A' }, '技师已完成'],
  ['invalid completed without evidence', '回访完成', { technician: '助理A' }, '技师已完成'],
  ['legacy saved record with screenshot', '已完成', { technician: '助理A', followUpScreenshot: 'data:image/jpeg;base64,abc' }, '回访完成'],
];

for (const [label, previousStatus, record, expectedStatus] of archiveCases) {
  const actualStatus = context.resolveHairArchiveStatus(previousStatus, record);
  if (actualStatus !== expectedStatus) {
    fail(`${label}: expected archive status ${expectedStatus}, got ${actualStatus}`);
  }
}

const creationCases = [
  ['stylist assigns assistant', false, '助理A', '待技师填写'],
  ['stylist keeps record', false, '', '待回访'],
  ['assistant creates for stylist', true, '助理A', '技师已完成'],
];

for (const [label, createdByAssistant, technician, expectedStatus] of creationCases) {
  const actualStatus = context.hairInitialTaskStatus(createdByAssistant, technician);
  if (actualStatus !== expectedStatus) {
    fail(`${label}: expected initial status ${expectedStatus}, got ${actualStatus}`);
  }
}

if (!context.hairUserIsAssistantForStylist('发型师A', '技师A', '技师')) {
  fail('technician creating for another stylist must be detected as assistant-created');
}
if (context.hairUserIsAssistantForStylist('发型师A', '发型师A', '发型师')) {
  fail('stylist creating own record must not be detected as assistant-created');
}
if (context.mergeHairTechnicianNames('助理A', '助理A') !== '助理A') {
  fail('creator technician merge must not duplicate the same technician');
}

if (!html.includes('rows = rows.filter(isHairTaskWithinVisibleWindow);')) {
  fail('all task states must use the 30-day visibility window');
}

if (/\.hair-tasks-group-body\.expanded\s*\{[^}]*max-height\s*:\s*\d+/s.test(html)) {
  fail('expanded task groups must not cap visible record height');
}
if (!/\.hair-tasks-group-body\.collapsed\s*\{[^}]*display\s*:\s*none/s.test(html)) {
  fail('collapsed task groups must hide without clipping expanded records');
}
if (!html.includes('class="ht-status-badge ')) {
  fail('task status must render as a readable badge');
}
if (!html.includes('class="hair-task-card-info pending">待技师填写</span>')) {
  fail('stylist pending-assistant action must use the emphasized pending style');
}

console.log(`hair task state test ok: ${cases.length + archiveCases.length + creationCases.length + 7} cases`);
