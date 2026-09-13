#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'operations.html'), 'utf8');
const api = fs.readFileSync(path.join(root, 'supabase/functions/operations-api/index.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260913063300_zysyr_monthly_blank_amount_slots.sql'), 'utf8');
const expect = (value, message) => { if (!value) throw new Error(message); };

expect(api.includes('function monthlyEditableBlankCells('), 'monthly blank-slot inference is missing');
expect(api.includes('"产品进货": 3') && api.includes('"备用金": 4'), 'monthly detail amount blocks are not covered');
expect(api.includes('person = valueAt(row, nameColumn) || `第${row}行`'), 'reserved blank staff rows are not covered');
expect(api.includes('cells.push(...monthlyEditableBlankCells(display, cells))'), 'new monthly workbooks do not register blank amount slots');
expect(api.includes('async function prepareMonthlyEditableSlots('), 'existing monthly reports cannot prepare blank amount slots');
expect(api.includes('operation === "monthly_editable_slots_prepare"'), 'blank amount-slot route is missing');
expect(api.includes('untouchedBlank ? "" : numeric'), 'untouched amount slots must remain visually blank');
expect(page.includes("api('monthly_editable_slots_prepare'"), 'finance edit mode does not prepare existing reports');
expect(page.includes('monthly-empty-amount'), 'blank amount input boundary is missing');
expect(page.includes('所有金额格已可填写；编号、姓名和文字栏保持固定'), 'finance confirmation text is missing');
expect(migration.includes('zysyr_private.request_role()') && migration.includes("'service_role'"), 'privileged RPC service-role guard is missing');
expect(migration.includes("assert_finance_scope") && migration.includes("'confirmed_finance.adjust'"), 'finance scope guard is missing');
expect(migration.includes('on conflict (company_id, report_id, sheet_name, cell_address) do nothing'), 'slot preparation must be idempotent');
expect(migration.includes("'monthly_editable_slots_prepare'"), 'slot preparation audit event is missing');
expect(migration.includes('revoke execute') && migration.includes('from public, anon, authenticated'), 'browser roles must not call the slot RPC directly');
const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)];
expect(scripts.length === 1, 'operations inline script missing or duplicated');
new vm.Script(scripts[0][1], { filename: 'operations.html' });
console.log('ZYSYR monthly blank amount-slot static checks passed');
