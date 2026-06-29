#!/usr/bin/env node
const fs = require('fs');

function fail(message) {
  console.error('ADMIN WORKFLOW TEST FAILED: ' + message);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

const admin = fs.readFileSync('admin.html', 'utf8');
const app = fs.readFileSync('perm-app.html', 'utf8');
const legacyAdmin = fs.readFileSync('admin-panel.html', 'utf8');

for (const tab of ['dashboard', 'registrations', 'staff', 'customers', 'followups', 'hair-analysis', 'care', 'assessment', 'content', 'system', 'audit']) {
  assert(admin.includes(`data-tab="${tab}"`), `missing backend navigation: ${tab}`);
}

for (const removed of ['data-tab="hair"', 'data-tab="style"', 'data-tab="perm"', 'id="tab-hair"', 'id="tab-style"', 'id="tab-perm"']) {
  assert(!admin.includes(removed), `removed configuration UI returned: ${removed}`);
}

for (const table of ['hair_types', 'perm_styles', 'perm_data']) {
  assert(!admin.includes(`/rest/v1/${table}`), `backend still reads or writes removed configuration table: ${table}`);
}
assert(app.includes('/rest/v1/perm_data'), 'app runtime unexpectedly lost perm_data usage');

assert(admin.includes('active=eq.false') && admin.includes('openRegistrationReview'), 'registration review is not separated from active staff');
assert(admin.includes("hashPasswordValue(pass)"), 'new employee passwords are not hashed');
assert(admin.includes('recordAdminAction'), 'backend operation audit is missing');

const assessment = admin.slice(admin.indexOf('window.loadAssessment'), admin.indexOf('// ===== 护理管理 ====='));
assert(assessment.includes('/rest/v1/hair_records?'), 'monthly report does not use hair_records');
assert(!assessment.includes('/rest/v1/hair_analysis_queue?'), 'monthly report still uses the AI queue');
assert(assessment.includes('adminHairFollowupComplete'), 'monthly report does not use strict follow-up completion');

const followups = admin.slice(admin.indexOf('function loadFollowups'), admin.indexOf('// ===== 记录回访弹窗 ====='));
assert(followups.includes('followupMetaFromProfile'), 'follow-up task list does not use planned dates');
assert(followups.includes("filter === 'overdue'"), 'follow-up task list has no overdue filter');

const carousel = admin.slice(admin.indexOf('async function loadCarousel'), admin.indexOf('async function uploadCarousel'));
assert(carousel.includes('is_carousel=eq.true'), 'homepage list is not limited to carousel images');
const removeCarousel = carousel.slice(carousel.indexOf('async function deleteCarousel'));
assert(removeCarousel.includes('is_carousel: false'), 'removing from homepage does not clear is_carousel');
assert(!removeCarousel.includes("status: 'rejected'"), 'removing from homepage incorrectly rejects the work');

assert(app.includes('function loadHomeCarousel()'), 'app homepage does not load managed carousel images');
assert(app.includes('is_carousel=eq.true'), 'app homepage carousel query is missing');
assert(app.includes('网络失败时保留首屏静态图'), 'app homepage has no non-flicker fallback');
assert(legacyAdmin.includes("location.replace('admin.html')"), 'legacy backend does not redirect to the canonical admin');

console.log('admin workflow test ok');
