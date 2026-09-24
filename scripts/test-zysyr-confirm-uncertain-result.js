#!/usr/bin/env node
// Exercises the real confirmation handler with a synthetic committed write
// whose response is lost. No production network, storage, or database is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const root = path.resolve(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'supabase/functions/operations-api/index.ts'), 'utf8');
const start = api.indexOf('async function confirmDailySheetDraft(');
const end = api.indexOf('\n}', start) + 2;
assert(start >= 0 && end > start, 'confirmation handler missing');
const handler = api.slice(start, end);
const draftId = '00000000-0000-4000-8000-000000000003';
const companyId = '00000000-0000-4000-8000-000000000001';
const storeId = '00000000-0000-4000-8000-000000000002';
const actorId = '00000000-0000-4000-8000-000000000004';

async function run({ committedBeforeLostReply }) {
  const requests = [];
  let persistedStatus = 'draft';
  const scope = {
    SUPABASE_URL: 'https://synthetic.invalid', SERVICE_KEY: 'synthetic-only', REPORT_BUCKET: 'reports',
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000099' },
    cleanText: value => String(value ?? '').trim(),
    uuidValue: value => value,
    hasAuthCapability: (_session, capability) => capability === 'daily_report.write',
    selectedStoreInfo: async () => ({ id: storeId, company_id: companyId, name: '测试门店' }),
    restRows: async () => [{ id: draftId, source_voucher_id: 'voucher', report_date: '2026-01-01', status: 'draft',
      edit_revision: 2, validation_result: { valid: true } }],
    approvedDailyVoucher: async () => ({ original_filename: 'daily.jpg', mime_type: 'image/jpeg' }),
    voucherSourceBytes: async () => new Uint8Array([1, 2, 3]),
    exactArrayBuffer: bytes => bytes,
    storagePath: value => value,
    sha256Bytes: async () => 'synthetic-hash',
    effectiveCellValue: cell => cell.corrected_numeric,
    restRowsAll: async () => [],
    dailySheetRead: async () => ({ draft: { id: draftId, status: persistedStatus } }),
    fetch: async (url, init = {}) => {
      requests.push({ url: String(url), method: init.method || 'GET' });
      return { ok: true, status: 200 };
    },
    financeRpcSaved: async (_endpoint, payload) => {
      assert.equal(payload.p_expected_revision, 2, 'confirmation RPC must use the reviewed draft revision');
      if (committedBeforeLostReply) persistedStatus = 'confirmed';
      throw new Error('财务数据连接暂时失败，请刷新后重试；如刚保存，请先核对保存结果');
    },
    console: { error() {} },
  };
  vm.createContext(scope);
  vm.runInContext(stripTypeScriptTypes(handler), scope);
  const result = await scope.confirmDailySheetDraft({
    store: '测试门店', draft_id: draftId, expected_revision: 2, reason: '原图逐格核对', reviewed_all: true,
  }, { operations_role: 'finance', auth_account_id: actorId }).then(value => value, error => error);
  assert.equal(requests.filter(request => request.method === 'POST').length, 1, 'archive should be uploaded once');
  assert.match(requests.find(request => request.method === 'POST').url,
    new RegExp(`${draftId}-synthetic-hash\\.jpg$`), 'retry identity must be stable for this draft and source hash');
  assert.equal(requests.filter(request => request.method === 'DELETE').length, 0,
    'must never delete archive merely because the RPC response was lost');
  if (committedBeforeLostReply) {
    assert.equal(result.confirmed, true, 'a confirmed draft must recover as successful after readback');
    assert.equal(result.saved.recovered_by_readback, true);
  } else {
    assert.match(result.message || '', /原图归档已保留.*刷新核实日报状态/,
      'an unconfirmed draft must retain its archive and require readback before retry');
  }
}

(async () => {
  await run({ committedBeforeLostReply: true });
  await run({ committedBeforeLostReply: false });
  console.log('daily confirmation uncertain result: committed/lost and uncommitted/lost replies preserve archive and require readback');
})().catch(error => { console.error(error); process.exitCode = 1; });
