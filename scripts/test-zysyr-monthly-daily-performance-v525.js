const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('operations.html', 'utf8');
const api = fs.readFileSync('supabase/functions/operations-api/index.ts', 'utf8');
const moduleSource = fs.readFileSync('operations-monthly-daily-performance.js', 'utf8');

assert.match(html, /id="monthly-daily-performance"/, 'the readable all-month report occupies the original monthly report area');
assert.match(html, /ZysyrMonthlyDailyPerformance\.render\(/, 'monthly render updates the independent full-width daily report');
assert.ok(html.indexOf('id="monthly-daily-performance"') < html.indexOf('id="monthly-sheet"'), 'daily performance precedes and preserves the original monthly source sheet');
assert.match(moduleSource, /尚无已入账日报；不代表 0 元/, 'unconfirmed daily values are explicitly distinguished from zero');
assert.match(html, /查看本月月报和已入账日报业绩；未显示的日期不会按零收入处理。/, 'monthly first layer explains the key shareholder interpretation without implementation notes');
assert.match(html, /<details class="monthly-source-details"><summary>数据来源与统计口径<\/summary><div class="monthly-source-body">月报栏目保留原表结构；金额由财务上传的原表数据及财务确认的月报调整组成。调整不覆盖日报原数，且数据不来自美管加同步。<\/div><\/details>/, 'secondary source and accounting scope stays available in an accessible disclosure');
assert.match(moduleSource, /\['labor_performance', '劳动业绩', '日报“总计”'\]/, 'the finance mapping is visible and unambiguous');
assert.match(moduleSource, /monthly-daily-mobile-cards/, 'small screens use readable daily cards instead of shrinking a wide table');
assert.match(moduleSource, /monthly-daily-mobile-totals/, 'small screens retain all seven month totals');
assert.doesNotMatch(moduleSource, /renderIntoSheet|monthly-daily-embedded/, 'daily performance no longer overwrites or shrinks original monthly sheet cells');
assert.match(html, /#view-monthly \.sheet-table td:not\([^\n]+\{font-size:14px\}/, 'original monthly sheet labels use the increased font size');
assert.match(html, /#view-monthly \.sheet-table td\.amount-cell\{font-size:13px\}/, 'original monthly sheet amounts use the increased font size');
assert.match(html, /\.monthly-daily-mobile-total strong\{font-size:15px/, 'mobile monthly total amounts use the increased font size');
assert.match(html, /\.monthly-daily-mobile-metric dd\{margin:0;font-size:15px/, 'mobile daily-card amounts use the increased font size');

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

console.log('ZYSYR monthly daily performance: full-width month placement, confirmed-day projection, finance mapping, store scope and responsive rendering passed');
