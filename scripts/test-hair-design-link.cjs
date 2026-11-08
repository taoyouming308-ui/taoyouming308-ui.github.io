#!/usr/bin/env node
'use strict';

// Exercise the actual form adapter with synthetic appointments. Opening design
// must never save, replace, or infer the identity of an in-progress hair form.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'perm-app.html'), 'utf8');
function section(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert(first >= 0 && last > first, 'production adapter marker: ' + start);
  return source.slice(first, last);
}
const code = [
  section('function normalizeHairBookingDate(value)', 'function hairRecordBookingId(row)'),
  section('function normalizeHairCustomerPhone(value)', 'function normalizeHairCloudRecord(row)'),
  section('function hairBookingContext(bookingId, bookingDate, phone, name, barber)', '// ===== 烫染标记'),
  section('function hairFormDesignContext(form, anchor)', 'function mountCustomerDesignArchive(container, context)')
].join('\n');
const fields = {
  'hair-form-name': { value: '合成顾客' },
  'hair-form-phone': { value: '13800000000' },
  'hair-form-barber': { value: '合成发型师' },
  'hair-form-color-notes': { value: '尚未保存的配方草稿' }
};
const calls = [], alerts = [];
const context = {
  document: { getElementById: id => fields[id] || null },
  showPlanModal: (...args) => { calls.push(args); return 'opened'; },
  alert: message => alerts.push(message),
  getHairRecords: () => context.records,
  records: [], _cloudRecordData: null, _editingHairId: null,
  autoSaveHairForm: () => { throw new Error('design entry must not save the hair form'); },
  getLocalDateStr: () => { throw new Error('design entry must not infer today'); }
};
context.window = context;
vm.createContext(context);
vm.runInContext(code, context);
const form = { name: '合成顾客', phone: '13800000000', barber: '合成发型师' };
const anchor = { bookingId: '900001', bookingDate: '2026.11.08', phone: form.phone, name: form.name, barber: form.barber };
let cases = 0;
function rejects(label, f, a, pattern) {
  assert.throws(() => context.hairFormDesignContext(f, a), pattern, label);
  cases++;
}
assert.deepEqual(JSON.parse(JSON.stringify(context.hairFormDesignContext(form, anchor))), {
  phone: form.phone, name: form.name, barberName: form.barber, bookingId: '900001', bookingDate: '2026-11-08'
}); cases++;
assert.equal(context.hairFormDesignContext({ ...form, phone: '+86 138-0000-0000' }, anchor).phone, form.phone); cases++;
rejects('unbound form', form, {}, /从预约选择客户/);
rejects('missing actual service date', form, { ...anchor, bookingDate: '' }, /从预约选择客户/);
rejects('invalid calendar date', form, { ...anchor, bookingDate: '2026-02-30' }, /从预约选择客户/);
rejects('unsafe appointment identifier', form, { ...anchor, bookingId: '9007199254740992' }, /从预约选择客户/);
rejects('invalid appointment identifier', form, { ...anchor, bookingId: '900001_other' }, /从预约选择客户/);
rejects('missing name', { ...form, name: '' }, anchor, /补全/);
rejects('masked phone', { ...form, phone: '138****0000' }, anchor, /完整手机号/);
rejects('changed customer phone', { ...form, phone: '13900000000' }, anchor, /预约不一致/);
rejects('changed customer name', { ...form, name: '另一位合成顾客' }, anchor, /预约不一致/);
rejects('masked anchor cannot silently select person', form, { ...anchor, phone: '138****0000' }, /预约不一致/);

const before = JSON.stringify(fields);
context._activeHairBookingContext = anchor;
assert.equal(context.openHairFormDesignArchive(), 'opened');
assert.deepEqual(JSON.parse(JSON.stringify(calls.pop())), [form.phone, form.name, form.barber, '2026-11-08', '900001', { hairForm: true }]);
assert.equal(JSON.stringify(fields), before, 'opening leaves every hair-form draft field untouched');
cases++;

context._activeHairBookingContext = null;
context._cloudRecordData = { booking_id: 900002, booking_date: '2026-10-10', customerName: form.name, customerPhone: form.phone, barber: form.barber };
assert.equal(context.openHairFormDesignArchive(), 'opened');
assert.equal(calls.pop()[4], '900002', 'saved cloud record retains its own appointment'); cases++;

context._activeHairBookingContext = anchor;
assert.equal(context.openHairFormDesignArchive(), 'opened');
assert.equal(calls.pop()[4], '900001', 'explicit current appointment wins over stale cloud fallback'); cases++;

context._activeHairBookingContext = null;
context._cloudRecordData = null;
context._editingHairId = 'synthetic-local';
context.records = [{ id: 'synthetic-local', bookingId: 900003, bookingDate: '2026-09-09', customerName: form.name, customerPhone: form.phone }];
assert.equal(context.openHairFormDesignArchive(), 'opened');
assert.equal(calls.pop()[4], '900003', 'saved local record retains its own appointment'); cases++;

context._activeHairBookingContext = anchor;
fields['hair-form-name'].value = '另一位合成顾客';
assert.equal(context.openHairFormDesignArchive(), false);
assert.equal(calls.length, 0, 'changed form identity must not open the old customer archive');
assert.match(alerts.pop(), /预约不一致/); cases++;
fields['hair-form-name'].value = form.name;

context._activeHairBookingContext = null;
context._editingHairId = null;
assert.equal(context.openHairFormDesignArchive(), false);
assert.equal(calls.length, 0);
assert.match(alerts.pop(), /从预约选择客户/); cases++;
assert.equal(JSON.stringify(fields), before, 'all accepted and rejected paths retain unsaved hair-form content');
assert(source.includes('id="hair-form-design-open"'), 'hair form exposes the shared design entry');
assert(source.includes('showPlanModal(phone, name, barberName, bookingDate, bookingId, contextOptions)'), 'scope reopen retains originating entry context');
assert(/\.plan-modal\.hair-form-design-modal\s*\{\s*z-index:100001/.test(source), 'nested design modal stays above the hair form');
console.log('hair design link tests passed: ' + cases + ' synthetic identity/context cases');
