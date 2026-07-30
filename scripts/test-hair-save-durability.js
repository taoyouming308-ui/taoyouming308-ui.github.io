#!/usr/bin/env node
const fs = require('fs');
const vm = require('vm');

function fail(message) {
  console.error('HAIR SAVE DURABILITY TEST FAILED: ' + message);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

const app = fs.readFileSync('perm-app.html', 'utf8');
const helperStart = app.indexOf('function saveHairRecords(records)');
const helperEnd = app.indexOf('function normalizeHairCustomerPhone', helperStart);
assert(helperStart >= 0 && helperEnd > helperStart, 'save durability helper block not found');

const context = {
  console: { warn() {} },
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_KEY: 'publishable-test-key',
  localStorage: {
    setItem() {},
  },
  setTimeout(fn) { fn(); },
};
vm.createContext(context);
vm.runInContext(app.slice(helperStart, helperEnd), context);

context.localStorage.setItem = function() { throw new Error('quota'); };
assert(context.saveHairRecords([{ id: 'draft-1' }]) === false, 'local storage failure must be reported without aborting cloud save');
context.localStorage.setItem = function() {};
assert(context.saveHairRecords([{ id: 'draft-1' }]) === true, 'successful local draft save must return true');

const saveStart = app.indexOf('window.saveHairRecordLocal = function(silent)');
const saveEnd = app.indexOf('// ===== 加载已有记录到表单', saveStart);
const saveSource = app.slice(saveStart, saveEnd);
assert(saveSource.includes("if (_editingHairId) return _editingHairId;"), 'retry must retain the same record id');
assert(saveSource.includes("'☁️ 正在保存并核验...'"), 'save button must show a pending verification state');
assert(saveSource.includes('persistAndVerifyHairRecord(record).then'), 'new records must use verified cloud persistence');
assert(saveSource.includes("'✅ 云端已确认保存'"), 'success must only be shown after cloud verification');
assert(saveSource.includes("'⚠️ 未保存成功，点此重试'"), 'failed saves must expose an explicit retry state');
assert(!saveSource.includes("persistAndVerifyHairRecord(record).then(function() {}).catch(function(){});"), 'cloud save failures must not be swallowed');
assert(app.includes('if(autoSaveHairForm()!==false)closeHairAnalysisModal()'), 'failed local auto-save must prevent the form from closing');
assert(app.includes('☁️ 保存完整档案'), 'primary save action must describe the complete cloud archive outcome');

const retryStart = app.indexOf('window.syncHairRecord = function(id, propagateFailure)');
const retryEnd = app.indexOf('// ===== 一键上传', retryStart);
const retrySource = app.slice(retryStart, retryEnd);
assert(retrySource.includes('persistAndVerifyHairRecord(rec)'), 'manual retry must upload the complete canonical hair record');
assert(!retrySource.includes('hair_analysis_queue'), 'manual retry must not reduce the record to the legacy analysis queue payload');

async function run() {
  const record = {
    id: 'hair-appointment-1',
    customerName: '测试顾客',
    customerPhone: '13800000000',
    bookingId: 'booking-1',
    bookingDate: '2026-08-01',
    barber: '测试发型师',
    technician: '',
    status: '待回访',
    formFields: { diagnosis: '完整字段' },
    synced: false,
  };
  let stored = null;
  const calls = [];
  context.fetch = async function(url, options) {
    calls.push({ url, options });
    if (options.method === 'POST') {
      stored = JSON.parse(options.body);
      return { ok: true, status: 201, text: async () => '' };
    }
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => [{
        id: stored.id,
        customer_name: stored.customer_name,
        customer_phone: stored.customer_phone,
        status: stored.status,
        record_data: stored.record_data,
      }],
    };
  };
  await context.persistAndVerifyHairRecord(record);
  assert(calls.length === 2, 'verified save must perform exactly one write and one readback when healthy');
  assert(calls[0].options.method === 'POST' && calls[1].options.method === 'GET', 'cloud write must be followed by readback');
  assert(calls[1].options.cache === 'no-store', 'readback must bypass stale caches');

  context.fetch = async function() {
    return { ok: false, status: 400, text: async () => 'invalid row' };
  };
  let rejected = false;
  try { await context.persistAndVerifyHairRecord(record); } catch (_) { rejected = true; }
  assert(rejected, 'non-success cloud response must reject instead of reporting success');

  let phase = 0;
  context.fetch = async function(url, options) {
    phase += 1;
    if (options.method === 'POST') return { ok: true, status: 201, text: async () => '' };
    return {
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => [{ id: record.id, record_data: Object.assign({}, record, { bookingId: 'wrong-booking' }) }],
    };
  };
  rejected = false;
  try { await context.persistAndVerifyHairRecord(record); } catch (_) { rejected = true; }
  assert(phase === 2 && rejected, 'mismatched readback must reject the save');

  console.log('hair save durability test ok: local fallback, cloud write, exact readback, retry path');
}

run().catch((error) => fail(error && error.stack ? error.stack : String(error)));
