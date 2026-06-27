#!/usr/bin/env node
const fs = require('fs');
const vm = require('vm');

function fail(message) {
  console.error('HAIR TASK STATE TEST FAILED: ' + message);
  process.exit(1);
}

const html = fs.readFileSync('perm-app.html', 'utf8');
const start = html.indexOf('function hairTaskHasFollowup');
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

if (!html.includes('rows = rows.filter(isHairTaskWithinVisibleWindow);')) {
  fail('all task states must use the 30-day visibility window');
}

console.log(`hair task state test ok: ${cases.length} cases`);
