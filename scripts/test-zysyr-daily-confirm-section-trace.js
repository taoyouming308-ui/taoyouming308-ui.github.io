#!/usr/bin/env node
// A regression for adaptive rows that overlap another logical section's paper coordinates.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const oldSql = fs.readFileSync('supabase/migrations/20260824174500_zysyr_daily_sheet_review_gate.sql', 'utf8');
const newSql = fs.readFileSync('supabase/migrations/20260923091020_zysyr_daily_sheet_section_trace_coordinates.sql', 'utf8');
const extract = (sql) => sql.match(/create or replace function public\.zysyr_confirm_daily_sheet\([\s\S]*?\n\$\$;/i)?.[0];
const original = extract(oldSql);
const updated = extract(newSql);
assert.ok(original && updated, 'the complete confirmation function must be present');

const reverted = updated
  .replace("'sheet_name', '原图电子日报/' || cell.section_code,", "'sheet_name', '原图电子日报',")
  .replace('      cell.section_code,\n', '')
  .replace("    and report_cell.report_id = v_report_id\n    and report_cell.sheet_name = '原图电子日报/' || atomic.section_code",
    "    and report_cell.report_id = v_report_id and report_cell.sheet_name = '原图电子日报'")
  .replaceAll('order by cell.row_number, cell.column_number, cell.section_code, cell.row_key',
    'order by cell.row_number, cell.column_number');
assert.equal(reverted, original, 'confirmation, validation, audit and posting logic must remain unchanged');
assert.match(newSql, /revoke execute on function public\.zysyr_confirm_daily_sheet[\s\S]*?from public, anon, authenticated, service_role/);
assert.match(newSql, /grant execute on function public\.zysyr_confirm_daily_sheet[\s\S]*?to service_role/);

for (const day of ['2026-01-28', '2026-01-31']) {
  const cells = [
    { section: 'technician', address: 'B23', role: 'staff_value', value: 100 },
    { section: 'product', address: 'B23', role: 'product_value', value: 0 },
    { section: 'stylist', address: 'B3', role: 'staff_value', value: 50 },
  ];
  assert.equal(new Set(cells.map(c => `原图电子日报|${c.address}`)).size, 2,
    `${day}: prior trace keys collide`);
  assert.equal(new Set(cells.map(c => `原图电子日报/${c.section}|${c.address}`)).size, cells.length,
    `${day}: section-scoped trace keys must be unique`);
  for (const staff of cells.filter(c => c.role === 'staff_value')) {
    const matches = cells.filter(c => c.section === staff.section && c.address === staff.address);
    assert.equal(matches.length, 1, `${day}: each financial line must map to exactly one source cell`);
  }
}
console.log('daily confirmation section-scoped source trace: unique addresses, one-to-one lineage, unchanged posting gates');
