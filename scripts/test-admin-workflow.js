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

for (const tab of ['dashboard', 'registrations', 'staff', 'training', 'customers', 'followups', 'hair-analysis', 'care', 'assessment', 'content', 'system', 'audit']) {
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
assert(admin.includes('openCareMonthlyEditor') && admin.includes('编辑用量'), 'care monthly report has no per-barber edit entry');
assert(admin.includes('loadCareDetailRecords();') && admin.includes('loadCareMonthlyStats();'), 'care correction does not refresh detail and monthly summary');
assert(admin.indexOf('initializeAdminPage();') > admin.indexOf('window.loadDashboard ='), 'backend initializes before dashboard loaders are registered');
assert(admin.includes("const STORE_ADMIN_ROLE = 'store_admin'"), 'store administrator role is missing');
assert(admin.includes("const STORE_ADMIN_TABS = ['dashboard', 'registrations', 'staff', 'training', 'hair-analysis', 'care', 'assessment', 'content', 'audit']"), 'store administrator navigation allowlist is wrong');
assert(admin.includes('session.role !== STORE_ADMIN_ROLE || !!session.store'), 'store administrators can log in without a bound store');
assert(admin.includes('role=in.(admin,${STORE_ADMIN_ROLE})'), 'backend login does not accept scoped store administrators');
assert(admin.includes('data-tab="customers" data-super-admin-only') && admin.includes('data-tab="followups" data-super-admin-only'), 'customer or follow-up navigation is exposed to store administrators');
assert(admin.includes('data-tab="system" data-super-admin-only'), 'system exceptions are exposed to store administrators');
assert(admin.includes('data-content-view="carousel" data-super-admin-only'), 'homepage recommendation navigation is exposed to store administrators');
assert(admin.includes("if (view === 'carousel' && !requireSuperAdmin('首页推荐'))"), 'homepage recommendation lacks an action guard');
assert(admin.includes('filterImageRowsForAdmin') && admin.includes('assertImageAdminScope'), 'store work review is not scoped to uploader store');
assert(admin.includes('filterHairRowsForAdmin') && admin.includes('fetchAdminStaffStoreMap'), 'store hair tasks are not scoped through staff stores');
assert(admin.includes("currentAdminStore() || (document.getElementById('care-month-store')"), 'care monthly statistics do not force the administrator store');
assert(admin.includes("currentAdminStore() || (document.getElementById('care-detail-store')"), 'care detail does not force the administrator store');
assert(admin.includes("if (!requireSuperAdmin('护理产品配置')) return;"), 'global care product configuration is exposed to store administrators');
assert(admin.includes("if (!requireSuperAdmin('顾客档案')) return;") && admin.includes("if (!requireSuperAdmin('回访任务')) return;"), 'removed store modules can still be opened directly');
assert(admin.includes('adminCareOutboundContextMap') && admin.includes('protocolVersion === 2'), 'outbound exceptions are not linked to protocol-v2 hair records');
assert(admin.includes('status=in.(pending,processing,failed,needs_review,legacy_review)'), 'backend does not show the full outbound state machine');
assert(admin.includes("Number(id) < 0") && admin.includes('queueIds.map(encodeURIComponent)'), 'backend retry does not protect legacy rows or retry the whole batch');
assert(admin.includes('执行器会先回查单据再决定是否创建'), 'backend retry warning does not require external reconciliation');
assert(admin.includes('/rest/v1/mgj_service_records?') && admin.includes('loadMgjReconciliation'), 'Meiguanjia perm/dye/care reconciliation is missing');
assert(admin.includes("copy.reconcileStatus = match ? 'matched' : 'missing'"), 'Meiguanjia records are not classified against hair forms');
assert(admin.includes('未开单 · 美管加烫染护对账') && admin.includes('不包含回访任务'), 'missing-order queue is not separated from follow-up work');
assert(admin.includes('mgj-reconcile-store') && admin.includes('mgj-reconcile-barber'), 'missing-order queue lacks store and stylist filters');
assert(admin.includes("groupHeader = '<tr><td colspan=\"9\"") && admin.includes("adminMgjBarber(row)"), 'missing-order queue is not grouped by store and stylist');
assert(admin.includes("if (store) serviceUrl += '&shop_name=eq.'"), 'store administrator reconciliation is not scoped to its store');
assert(admin.includes("if (response.status !== 404)") && admin.includes('/rest/v1/customer_profiles?select=phone,name,shop_name,service_history'), 'reconciliation lacks a staged-schema fallback');

const assessment = admin.slice(admin.indexOf('window.loadAssessment'), admin.indexOf('// ===== 护理管理 ====='));
assert(assessment.includes('/rest/v1/hair_records?'), 'monthly report does not use hair_records');
assert(!assessment.includes('/rest/v1/hair_analysis_queue?'), 'monthly report still uses the AI queue');
assert(assessment.includes('adminHairFollowupComplete'), 'monthly report does not use strict follow-up completion');
assert(assessment.includes('filterHairRowsForAdmin'), 'monthly report is not scoped to the administrator store');

const followups = admin.slice(admin.indexOf('function loadFollowups'), admin.indexOf('// ===== 记录回访弹窗 ====='));
assert(followups.includes('followupMetaFromProfile'), 'follow-up task list does not use planned dates');
assert(followups.includes("filter === 'overdue'"), 'follow-up task list has no overdue filter');
assert(followups.includes('shop_name') && followups.includes('lastGroup'), 'follow-up queue is not grouped by store and stylist');
assert(admin.includes('只管理已经开单但尚未完成的回访') && admin.includes('fu-store-filter'), 'follow-up queue is not visibly separated from missing orders');

const carousel = admin.slice(admin.indexOf('async function loadCarousel'), admin.indexOf('async function uploadCarousel'));
assert(carousel.includes('is_carousel=eq.true'), 'homepage list is not limited to carousel images');
const removeCarousel = carousel.slice(carousel.indexOf('async function deleteCarousel'));
assert(removeCarousel.includes('is_carousel: false'), 'removing from homepage does not clear is_carousel');
assert(!removeCarousel.includes("status: 'rejected'"), 'removing from homepage incorrectly rejects the work');

assert(app.includes('function loadHomeCarousel()'), 'app homepage does not load managed carousel images');
assert(app.includes('is_carousel=eq.true'), 'app homepage carousel query is missing');
assert(app.includes('网络失败时保留首屏静态图'), 'app homepage has no non-flicker fallback');
assert(legacyAdmin.includes("location.replace('admin.html')"), 'legacy backend does not redirect to the canonical admin');
assert(admin.includes("trainingAdminRequest('admin_knowledge_overview')"), 'knowledge candidates are not loaded from the protected service');
assert(admin.includes("trainingAdminRequest('admin_create_knowledge_candidate'"), 'knowledge candidate creation is not service-backed');
assert(admin.includes("trainingAdminRequest('admin_review_knowledge_candidate'"), 'knowledge review is not service-backed');
assert(admin.includes('版权与安全边界均已核验'), 'knowledge approval lacks explicit copyright and safety confirmation');
assert(admin.includes('审核通过只表示进入试用'), 'knowledge review could be mistaken for automatic publication');

console.log('admin workflow test ok');
