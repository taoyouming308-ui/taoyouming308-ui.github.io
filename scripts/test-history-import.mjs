import assert from "node:assert/strict";
import fs from "node:fs";
import { parseHistoricalWorkbook } from "../supabase/functions/_shared/zysyr-history-import.mjs";

function columnLetters(column) {
  let value = column;
  let output = "";
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + value % 26) + output;
    value = Math.floor(value / 26);
  }
  return output;
}

function sheet(name, matrix) {
  return {
    name,
    actualRowCount: matrix.length,
    actualColumnCount: Math.max(...matrix.map((row) => row.length)),
    getCell(row, column) {
      const value = matrix[row - 1]?.[column - 1] ?? null;
      return { address: `${columnLetters(column)}${row}`, value, text: String(value ?? ""), numFmt: "General" };
    },
  };
}

function workbook(...worksheets) {
  return { worksheets };
}

const employee = { id: "00000000-0000-0000-0000-000000000001", name: "陈鹏" };
const product = { id: "00000000-0000-0000-0000-000000000002", name: "盈亮液态发蜡" };

const salaryValues = ["发型师", "陈鹏", 2000, 0, 0, 300, 5000, 0, 0, 0, 7300, 100, 20, 0, 0, 0, 0, 500, 620, 6680, "核对"];
const salary = parseHistoricalWorkbook(workbook(sheet("1月", [
  ["职位", "姓名"],
  salaryValues,
])), { import_type: "salary", year: 2026, target_store_label: "自由手艺人", employees: [employee], products: [] });
assert.equal(salary.rows.length, 1);
assert.equal(salary.rows[0].mapped.employee_id, employee.id);
assert.equal(salary.rows[0].mapped.net_pay, 6680);
assert.equal(salary.rows[0].validation_status, "valid");

const salaryWithoutShooting = parseHistoricalWorkbook(workbook(sheet("6月", [
  ["职位", "姓名", "基本工资", "工龄工资", "岗位工资", "饭补", "业绩提成", "外卖办卡提成",
    "加班费／活动津贴", "补发补扣", "应发", "成本", "迟到／早退", "请假", "成长", "自购",
    "社保（员工缴）", "应扣", "实发", "备注／签字"],
  ["发型师", "陈鹏", 2000, 0, 0, 300, 5000, 0, 0, 0, 7300, 100, 20, 0, 0, 0, 500, 620, 6680, "核对"],
])), { import_type: "salary", year: 2026, target_store_label: "自由手艺人",
  employees: [employee], products: [] });
assert.equal(salaryWithoutShooting.rows[0].mapped.shooting_deduction, 0);
assert.equal(salaryWithoutShooting.rows[0].mapped.total_deduction, 620);
assert.equal(salaryWithoutShooting.rows[0].mapped.net_pay, 6680);
assert.equal(salaryWithoutShooting.rows[0].validation_status, "valid");

const petty = parseHistoricalWorkbook(workbook(sheet("01", [
  ["自由手艺人门店备用金明细"],
  [null, null, null, null, null],
  [46023, 1, "柠檬", null, 21.8, "食品", "小爱", null],
])), { import_type: "petty_cash", year: 2026, target_store_label: "自由手艺人", employees: [], products: [] });
assert.equal(petty.rows.length, 1);
assert.equal(petty.rows[0].mapped.transaction_date, "2026-01-01");
assert.equal(petty.rows[0].mapped.amount, 21.8);

const purchases = parseHistoricalWorkbook(workbook(sheet("2026.1", [
  ["日期", "产品"],
  [46024, "盈亮液态发蜡", null, null, 25, "陈鹏", 20],
])), { import_type: "employee_purchase", year: 2026, target_store_label: "自由手艺人", employees: [employee], products: [product] });
assert.equal(purchases.rows.length, 1);
assert.equal(purchases.rows[0].mapped.transaction_kind, "employee_purchase");
assert.equal(purchases.rows[0].mapped.product_id, product.id);

const rangedPurchases = parseHistoricalWorkbook(workbook(
  sheet("2025.12", [["日期", "产品"], [46000, "盈亮液态发蜡", null, null, 25, "陈鹏", 20]]),
  sheet("2026.1", [["日期", "产品"], [46024, "盈亮液态发蜡", null, null, 25, "陈鹏", 20]]),
), { import_type: "employee_purchase", year: 2026, period_start: "2026-01", period_end: "2026-06",
  target_store_label: "自由手艺人", employees: [employee], products: [product] });
assert.equal(rangedPurchases.rows.length, 1);
assert.equal(rangedPurchases.period_start, "2026-01-01");

const monthly = parseHistoricalWorkbook(workbook(sheet("1月", [
  ["自由手艺人门店月盈亏统计"],
  ["收入", "美发收入", 1000],
  ["支出", "房租", 500],
])), { import_type: "monthly_profit_loss", year: 2026, target_store_label: "自由手艺人", employees: [], products: [] });
assert.equal(monthly.rows.length, 2);
assert.equal(monthly.rows[0].mapped.cell_address, "C2");
assert.match(monthly.rows[0].mapped.label, /美发收入/);

const mismatch = parseHistoricalWorkbook(workbook(sheet("01", [
  ["太合中心店备用金明细"],
  [46023, 1, "水", null, 30, "食品", "小爱"],
])), { import_type: "petty_cash", year: 2026, target_store_label: "自由手艺人", employees: [], products: [] });
assert.equal(mismatch.source_warnings[0].code, "source_store_label_mismatch");
assert.equal(mismatch.source_warnings[0].severity, "warning");

const humanReviewMigration = fs.readFileSync(new URL(
  "../supabase/migrations/20260830040811_zysyr_history_human_review.sql", import.meta.url,
), "utf8");
assert.match(humanReviewMigration, /review_status in \('pending', 'confirmed', 'needs_correction'\)/);
assert.match(humanReviewMigration, /zysyr_review_history_import_row/);
assert.match(humanReviewMigration, /zysyr_confirm_history_import_month/);
assert.match(humanReviewMigration, /HISTORY_IMPORT_HUMAN_REVIEW_INCOMPLETE/);
assert.match(humanReviewMigration, /HISTORY_IMPORT_MONTH_HAS_INVALID_ROWS/);
assert.match(humanReviewMigration, /review_mode', 'whole_source_sheet'/);
assert.match(humanReviewMigration, /review_status = 'confirmed'/);
assert.doesNotMatch(humanReviewMigration, /HISTORY_IMPORT_MONTH_REVIEW_INCOMPLETE/);
assert.match(humanReviewMigration, /formal_ledger_written/);

const formalLedgerMigration = fs.readFileSync(new URL(
  "../supabase/migrations/20260830070134_zysyr_history_formal_ledger.sql", import.meta.url,
), "utf8");
assert.match(formalLedgerMigration, /create table public\.zysyr_history_ledger_entries/);
assert.match(formalLedgerMigration, /create table public\.zysyr_history_ledger_revisions/);
assert.match(formalLedgerMigration, /zysyr_post_history_import_batch/);
assert.match(formalLedgerMigration, /zysyr_revise_history_ledger_entry/);
assert.match(formalLedgerMigration, /zysyr_reverse_history_ledger_entry/);
assert.match(formalLedgerMigration, /unique \(company_id, store_id, import_row_id\)/);
assert.match(formalLedgerMigration, /HISTORY_LEDGER_ROW_COUNT_MISMATCH/);
assert.match(formalLedgerMigration, /posted_with_warning/);
assert.match(formalLedgerMigration, /target_business_type = 'history_ledger'/);
assert.match(formalLedgerMigration, /force row level security/);
assert.match(formalLedgerMigration, /to service_role/);
assert.doesNotMatch(formalLedgerMigration, /grant (insert|update|delete)/i);

console.log("history import parser tests passed");
