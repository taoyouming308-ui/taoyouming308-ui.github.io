const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('operations.html', 'utf8');
const helper = html.match(/  function dailyHistoricalValidationWarning\(entry\)\{[\s\S]*?\n  \}/);
assert.ok(helper, 'daily calendar must format actionable historical validation warnings');
const makeWarning = vm.runInNewContext(`${helper[0]}; dailyHistoricalValidationWarning`);

assert.equal(makeWarning({ current_validation: {
  stylist_subtotal_mismatch: true, staff_atomic_total: 6087, stylist_subtotal: 6081,
} }), '员工明细与造型小计相差 ¥6.00 · 点开核对');
assert.equal(makeWarning({ current_validation: {
  stylist_subtotal_mismatch: true, staff_atomic_total: 15598, stylist_subtotal: 15998,
} }), '员工明细与造型小计相差 ¥400.00 · 点开核对');
assert.equal(makeWarning({ current_validation: { staff_row_mismatches: 2 } }), '员工行小计不符 2 行 · 点开核对');
assert.equal(makeWarning({ current_validation: { category_mismatches: 3 } }), '项目小计不符 3 项 · 点开核对');
assert.equal(makeWarning({ current_validation: { missing_controls: ['现金流'] } }), '缺少校验项 · 点开核对');
assert.match(html, /role="alert" title="打开当天日报可查看差额和原始明细">'\+esc\(dailyHistoricalValidationWarning\(entry\)\)/);
assert.match(html, /造型区总小计 ¥'\+subtotal\.toFixed\(2\).*员工明细合计 ¥'\+staff\.toFixed\(2\).*相差 ¥'\+Math\.abs\(subtotal-staff\)\.toFixed\(2\)/);
assert.match(html, /系统没有修改历史金额，请财务对照原始日报后按修订\/冲销流程处理/);

console.log('ZYSYR v557 historical daily validation warning: exact delta, actionable calendar alert and source-preserving correction guidance passed');
