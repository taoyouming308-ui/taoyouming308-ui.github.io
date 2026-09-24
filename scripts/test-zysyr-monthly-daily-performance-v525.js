const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('operations.html', 'utf8');
const api = fs.readFileSync('supabase/functions/operations-api/index.ts', 'utf8');
const moduleSource = fs.readFileSync('operations-monthly-daily-performance.js', 'utf8');

assert.doesNotMatch(html, /id="monthly-daily-performance"/, 'daily performance must not appear as a separate panel above the original monthly sheet');
assert.match(html, /ZysyrMonthlyDailyPerformance\.renderIntoSheet/, 'monthly render places the automatic table inside the original monthly sheet');
assert.match(html, /id="monthly-daily-completeness"/, 'monthly view provides an accessible daily completeness status');
assert.match(html, /completenessStatus:\$\('monthly-daily-completeness'\)/, 'monthly render updates the completeness status with the selected month');
assert.match(moduleSource, /\['labor_performance', '劳动业绩', '日报“总计”'\]/, 'the finance mapping is visible and unambiguous');
assert.match(moduleSource, /\['P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W'\]/, 'the eight columns occupy the original monthly sheet right-side block');
assert.match(moduleSource, /function ensureDisplayColumns\(cells\)/, 'the display layer supplies the missing W column used by the production 22-column template');
assert.match(moduleSource, /cells\['W' \+ String\(index \+ 1\)\] = cell/, 'the virtual W column is mapped without changing monthly source data');
assert.match(moduleSource, /rowNumber <= 34/, 'the embedded block reserves header, all 31 days and a total row');

assert.match(api, /async function confirmedDailyPerformance/, 'server builds the monthly daily performance projection');
assert.match(api, /status=eq\.confirmed/, 'only confirmed daily sheets are eligible');
assert.match(api, /company_id=eq\.\$\{companyId\}&store_id=eq\.\$\{storeId\}/, 'query is scoped by company and store');
assert.match(api, /column_code=in\.\(grand_total,cash_flow,card_consumption,group_buy,alipay,wechat,douyin\)/, 'all requested finance fields come from the daily sheet');
assert.match(api, /monthly_daily_performance: monthlyDailyPerformance/, 'overview returns the projection without a second client endpoint');
assert.match(api, /source_note: "只读取当前门店已入账日报；草稿和识别候选不计入月报业绩。"/, 'API documents the accounting boundary');
assert.match(api, /select=id,draft_id,section_code,column_code,row_key,cell_role,ocr_numeric,corrected_numeric,manual_override/, 'shared daily source contains performance and exact cash-rollup identifiers');

const context = { window: {}, globalThis: {}, Map, Date, Number, String, Array };
vm.runInNewContext(moduleSource, context);
const feature = context.window.ZysyrMonthlyDailyPerformance;
assert.ok(feature, 'monthly daily performance module initializes');

const rows = feature.buildRows('2026-01', { rows: [
  { date: '2026-01-01', draft_id: 'd1', labor_performance: 2126, cash_performance: 2126,
    card_amount: 0, group_buy: 226, alipay: 1850, wechat: 50, douyin: 0, missing_fields: [] },
  { date: '2026-01-03', draft_id: 'd3', labor_performance: 800, cash_performance: 500,
    card_amount: 300, group_buy: 0, alipay: 300, wechat: 200, douyin: 0, missing_fields: [] }
] });
assert.equal(rows.length, 31, 'January always renders the complete month');
assert.equal(rows[0].confirmed, true, 'confirmed day is populated');
assert.equal(rows[1].confirmed, false, 'missing day stays visibly unbooked');
assert.equal(rows[2].card_amount, 300, 'card amount stays distinct from cash performance');
const totals = feature.totals(rows);
assert.equal(totals.labor_performance, 2926);
assert.equal(totals.cash_performance, 2626);
assert.equal(totals.card_amount, 300);
assert.equal(totals.alipay, 2150);
assert.equal(totals.wechat, 250);
assert.deepEqual(JSON.parse(JSON.stringify(feature.completeness(rows))), { days: 31, confirmed: 2, withoutConfirmedReport: 29 });

console.log('ZYSYR v526 monthly daily performance: production 22-column compatibility, confirmed-day projection, finance mapping, store scope and responsive full-month table passed');
