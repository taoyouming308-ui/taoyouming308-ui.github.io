const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const api = fs.readFileSync('supabase/functions/operations-api/index.ts', 'utf8');
const start = api.indexOf('async function reportUploadVouchers(');
const end = api.indexOf('\n}', start) + 2;
assert(start >= 0 && end > start, 'scoped report voucher reader must exist');
const helper = api.slice(start, end);
const calls = [];
const sandbox = {
  cleanText: value => String(value ?? '').trim().slice(0, 40),
  uuidIn: values => `(${Array.from(new Set(values.filter(value => /^[0-9a-f-]{36}$/i.test(value)))).join(',')})`,
  restRowsAll: async (path, maxRows) => { calls.push({ path, maxRows }); return [{ record_id: path.match(/record_id=in\.\(([^)]*)\)/)?.[1] || '' }]; },
};
vm.createContext(sandbox);
vm.runInContext(stripTypeScriptTypes(`${helper}\nthis.readVouchers = reportUploadVouchers;`), sandbox);

(async () => {
  const ids = Array.from({ length: 205 }, (_, index) => `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`);
  const reports = ids.map(id => ({ id })).concat([{ id: ids[0] }, { id: 'not-a-uuid' }]);
  const rows = await sandbox.readVouchers('company-id', 'store-id', reports);
  assert.equal(calls.length, 3, 'the lookup must keep each filter URL bounded to 100 report IDs');
  assert.deepEqual(calls.map(call => call.maxRows), [1000, 1000, 1000]);
  for (const call of calls) {
    assert.match(call.path, /company_id=eq\.company-id&store_id=eq\.store-id&record_type=eq\.report/);
    assert.match(call.path, /record_id=in\.\(/);
    const filterIds = call.path.match(/record_id=in\.\(([^)]*)\)/)?.[1] || '';
    assert.ok(filterIds.split(',').length <= 100, 'each request must include at most 100 unique report IDs');
  }
  assert.equal(rows.length, 3);
  calls.length = 0;
  assert.equal((await sandbox.readVouchers('company-id', 'store-id', [])).length, 0);
  assert.equal(calls.length, 0, 'an empty month must not read unrelated store history');
  const overview = api.slice(api.indexOf('async function overview('), api.indexOf('async function reportAcknowledge('));
  assert.match(overview, /const reports = rawReports\.filter\([\s\S]*?reportUploadVouchers\(companyId, storeId, reports\)/);
  assert.doesNotMatch(overview, /record_type=eq\.report&order=uploaded_at\.desc&limit=1000/);
  assert.match(overview, /const \[rawReports, dailySource, acknowledgements\] = await Promise\.all\([\s\S]*?restRowsAll\(acknowledgementPath, 500\)/,
    'overview should read report, daily source, and acknowledgements concurrently');
  assert.match(overview, /const \[vouchers, uploaders\] = await Promise\.all\(/,
    'voucher metadata and uploader profiles should be fetched concurrently');
  assert.match(overview, /const \[cells, evidenceRules\] = await Promise\.all\(/,
    'monthly cells and evidence rules should be fetched concurrently');
  assert.match(overview, /restRowsAll\(monthlyTraceRevisionsPath\(companyId, storeId, reportId\), 5000\)[\s\S]*?monthlyIncomeAdjustments\(companyId, storeId, month\)/,
    'monthly adjustment reads should share the concurrent revision batch');
  for (const phase of ['store_scope', 'base_reads', 'report_evidence_and_uploaders', 'monthly_cells_and_rules',
    'monthly_revisions_and_locks', 'historical_fallback_and_projection', 'acknowledgement_enrichment', 'unlock_requests']) {
    assert.ok(overview.includes(`markOverviewStage("${phase}")`), `overview timing must measure ${phase}`);
  }
  assert.match(overview, /overviewStageMs\.acknowledgement_users = Math\.round\(performance\.now\(\) - acknowledgementUsersStartedAt\)/,
    'overlapped acknowledgement lookup timing must measure its actual wall duration');
  const timingLog = overview.match(/console\.log\(JSON\.stringify\(\{([\s\S]*?)\}\)\);/);
  assert.ok(timingLog, 'overview must emit one compact timing event');
  assert.match(timingLog[1], /event: "zysyr_overview_timing_v1"/);
  assert.match(timingLog[1], /total_ms:[\s\S]*stage_ms:/);
  assert.doesNotMatch(timingLog[1], /company|store|month|user|account|reportId|token/i,
    'timing telemetry must not include finance identifiers or credentials');
  const timingEvents = [];
  const syntheticMonthlyReport = {
    id: '00000000-0000-4000-8000-000000000001', report_type: 'monthly_profit_loss', report_date: '2026-01-01',
    template_code: 'synthetic', display_data: { original: 'preserved' },
  };
  const timingSandbox = {
    performance,
    console: { log: value => timingEvents.push(JSON.parse(value)) },
    cleanText: (value, max = 500) => String(value ?? '').trim().slice(0, max),
    validDate: value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
    selectedStoreInfo: async () => ({ company_id: 'synthetic-company', id: 'synthetic-store', name: 'synthetic' }),
    restRowsAll: async path => {
      await new Promise(resolve => setTimeout(resolve, 2));
      if (path.startsWith('zysyr_report_uploads?')) return [syntheticMonthlyReport];
      if (path.startsWith('zysyr_report_cells?')) return [];
      return [];
    },
    confirmedDailySource: async () => [],
    confirmedDailyPerformanceFromSource: () => [],
    confirmedDailyRollupFromSource: () => ({}),
    uuidIn: () => '()',
    reportUploadVouchers: async () => [],
    monthlyEvidenceRules: async () => [],
    monthlyEvidencePolicyMap: () => ({}),
    monthlyIncomeAdjustments: async () => ({}),
    latestMonthlyCellRevisionMap: () => new Map(),
    effectiveMonthlyDisplay: display => display,
    hasAuthCapability: () => false,
    historicalMonthlyReport: async () => null,
  };
  vm.createContext(timingSandbox);
  vm.runInContext(stripTypeScriptTypes(`${overview}\nthis.runOverview = overview;`), timingSandbox);
  const syntheticResponse = await timingSandbox.runOverview({ month: '2026-01' }, { operations_role: 'shareholder' });
  assert.deepEqual(JSON.parse(JSON.stringify(syntheticResponse.monthly_report.display_data)), { original: 'preserved' },
    'adding timing telemetry must not alter the monthly report payload');
  assert.equal(timingEvents.length, 1, 'one request must emit exactly one aggregate timing event');
  assert.equal(timingEvents[0].event, 'zysyr_overview_timing_v1');
  assert.ok(Number.isFinite(timingEvents[0].total_ms) && timingEvents[0].total_ms >= 0);
  assert.ok(Number.isFinite(timingEvents[0].stage_ms.base_reads) && timingEvents[0].stage_ms.base_reads >= 0);
  assert.ok(Number.isFinite(timingEvents[0].stage_ms.monthly_cells_and_rules));
  assert.ok(Number.isFinite(timingEvents[0].stage_ms.acknowledgement_users));
  assert.doesNotMatch(JSON.stringify(timingEvents[0]), /synthetic-company|synthetic-store|2026-01|original|account|token/i,
    'runtime telemetry must not include tenant, period, report data, or credentials');
  console.log('ZYSYR monthly overview: store/report voucher scope and independent-read concurrency passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
