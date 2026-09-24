const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const source = fs.readFileSync('supabase/functions/operations-api/index.ts', 'utf8');
const extract = name => {
  const asyncStart = source.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : source.indexOf(`function ${name}(`);
  const end = source.indexOf('\n}', start) + 2;
  assert(start >= 0 && end > start, `${name} must exist`);
  return source.slice(start, end);
};
const sandbox = {
  restRowsAll: async path => path.includes('zysyr_daily_sheet_drafts?')
    ? [{ id: '00000000-0000-4000-8000-000000000001', report_date: '2026-01-01', edit_revision: 2,
      confirmed_at: '2026-09-20T10:00:00Z', status: 'confirmed' }]
    : [{ id: '00000000-0000-4000-8000-000000000002', draft_id: '00000000-0000-4000-8000-000000000001',
      section_code: 'payment', column_code: 'cash_flow', row_key: 'payment', cell_role: 'payment_cashflow',
      corrected_numeric: 200, ocr_numeric: 250, manual_override: true }],
};
vm.createContext(sandbox);
vm.runInContext(stripTypeScriptTypes(['cleanText', 'uuidIn', 'effectiveCellValue', 'confirmedDailySource', 'confirmedDailyRollupFromSource', 'confirmedDailyRollup'].map(extract).join('\n')), sandbox);

(async () => {
  const result = await sandbox.confirmedDailyRollup('company', 'store', '2026-01');
  assert.equal(result.amount, 200, 'monthly hair income comes from corrected cash performance, not 250 labor/card total');
  assert.equal(result.source, 'confirmed_daily_cash_flow');
  assert.equal(result.first_confirmed_at, '2026-09-20T10:00:00Z');
  assert.equal(result.confirmed_days, 1);
  assert.equal(result.days[0].amount, 200);
  const api = fs.readFileSync('supabase/functions/operations-api/index.ts', 'utf8');
  assert.match(api, /rpc\/zysyr_save_daily_linked_monthly_adjustment/, 'finance edits use the guarded daily-linked monthly adjustment');
  console.log('ZYSYR v527 monthly cash income: corrected daily cash only, no card, guarded finance edit passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
