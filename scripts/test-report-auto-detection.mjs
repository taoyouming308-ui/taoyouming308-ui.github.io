#!/usr/bin/env node
import assert from "node:assert/strict";
import { detectReportMetadata } from "../supabase/functions/_shared/report-auto-detection.mjs";
import { assertUploadSourceStore } from "../supabase/functions/_shared/upload-store-guard.mjs";

const monthly = detectReportMetadata({
  filename: "盈亏表模板2026（向里造型）xlsx.xlsx",
  sheetName: "6月",
  storeName: "向里造型",
  values: [["向里造型 太合商业中心 店 6月盈亏统计"], ["收入类别", "美发收入", "支出类别"]],
});
assert.equal(monthly.report_type, "monthly_profit_loss");
assert.equal(monthly.report_date, "2026-06-01");
assert.equal(monthly.month, "2026-06");

const salary = detectReportMetadata({
  filename: "工资表2026（自由手艺人）.xlsx",
  sheetName: "7月",
  storeName: "自由手艺人",
  values: [["自由手艺人工资表"], ["姓名", "基本工资", "应发", "实发"]],
});
assert.equal(salary.report_type, "salary");
assert.equal(salary.report_date, "2026-07-01");

const daily = detectReportMetadata({
  filename: "向里造型2026-09-09日报.xlsx",
  sheetName: "日报",
  storeName: "向里造型",
  values: [["向里造型业绩报表", "2026年9月9日"], ["现金", "支付方式", "总计"]],
});
assert.equal(daily.report_type, "daily");
assert.equal(daily.report_date, "2026-09-09");

assert.throws(() => detectReportMetadata({
  filename: "向里造型盈亏表.xlsx",
  sheetName: "6月",
  storeName: "向里造型",
  values: [["6月盈亏统计"], ["收入类别", "美发收入"]],
}), /未识别到报表年份/);

assert.throws(() => detectReportMetadata({
  filename: "自由手艺人盈亏表2026.xlsx",
  sheetName: "6月",
  storeName: "向里造型",
  values: [["自由手艺人 6月盈亏统计"], ["收入类别", "美发收入"]],
}), /门店与当前选择/);

assert.throws(() => detectReportMetadata({
  filename: "向里造型盈亏表2026.xlsx",
  sheetName: "年度盈亏统计",
  storeName: "向里造型",
  values: [["年度盈亏统计"], ["收入类别", "美发收入"]],
}), /未识别到报表月份/);

const wrongStore = { code: 'UPLOAD_SOURCE_STORE_REJECTED' };
assert.doesNotThrow(() => assertUploadSourceStore('向里造型', ' 向里造型 ', '微信图片.jpg'));
assert.doesNotThrow(() => assertUploadSourceStore('向里造型', undefined, 'legacy.jpg'));
assert.throws(() => assertUploadSourceStore('向里造型', '向里', '微信图片.jpg'), wrongStore, 'partial names do not prove ownership');
assert.throws(() => assertUploadSourceStore('向里造型', '自由手艺人', '微信图片.jpg'), wrongStore);
assert.throws(() => assertUploadSourceStore('向里造型', '向里造型', '自由手艺人_原件.png'), wrongStore);
assert.throws(() => assertUploadSourceStore('向里造型', '向里造型', '向里造型_日报.xlsx', '自由 手艺人 业绩日报'), wrongStore);
assert.throws(() => assertUploadSourceStore('向里造型', '向里造型', '日报.xlsx', '自由手艺人 / 向里造型'), wrongStore);
assert.doesNotThrow(() => assertUploadSourceStore('向里造型', '向里造型', '自由手艺人_副本.xlsx', '向里造型 业绩日报'), 'file title is secondary to the actual header');

console.log("Report detection and upload store guards: exact declared store, authoritative header, ambiguous/cross-store source, filename fallback and ordinary files passed.");
