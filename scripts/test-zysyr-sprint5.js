#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260822025920_zysyr_sprint5_inventory_procurement.sql'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'scripts/test-zysyr-sprint5-runtime.sql'), 'utf8');
const api = fs.readFileSync(path.join(root, 'supabase/functions/operations-api/index.ts'), 'utf8');
const page = fs.readFileSync(path.join(root, 'operations.html'), 'utf8');

function expect(value, message) { if (!value) throw new Error(message); }

const tables = [
  'zysyr_purchase_orders', 'zysyr_purchase_order_lines', 'zysyr_goods_receipts',
  'zysyr_goods_receipt_lines', 'zysyr_inventory_balances', 'zysyr_inventory_transactions',
  'zysyr_usage_records', 'zysyr_employee_purchases', 'zysyr_employee_purchase_payments',
  'zysyr_stock_transfers', 'zysyr_stock_transfer_lines',
];
for (const table of tables) {
  expect(migration.includes(`create table public.${table}`), `${table} missing`);
  expect(migration.includes(`alter table public.${table} enable row level security`), `${table} RLS missing`);
  expect(migration.includes(`alter table public.${table} force row level security`), `${table} forced RLS missing`);
}
expect(/numeric\(14,4\)/.test(migration) && /numeric\(14,2\)/.test(migration), 'exact quantity and money types missing');
expect(migration.includes('assert_inventory_scope') && migration.includes("'inventory.write'"), 'inventory capability gate missing');
expect(migration.includes('period_is_locked') && migration.includes('FINANCE_PERIOD_LOCKED'), 'period lock gate missing');
expect(migration.includes('zysyr_private.assert_approved_vouchers') && migration.includes('link_finance_vouchers'), 'approved voucher gate missing');
expect(migration.includes('moving_average_cost') && migration.includes('average_cost_before') && migration.includes('average_cost_after'), 'moving-average snapshots missing');
expect(migration.includes('INSUFFICIENT_INVENTORY') && migration.includes('RECEIPT_EXCEEDS_ORDER'), 'inventory quantity guards missing');
expect(migration.includes('zysyr_inventory_transactions_immutable') && migration.includes('INVENTORY_LEDGER_IMMUTABLE'), 'immutable inventory ledger missing');
expect(migration.includes('INVENTORY_REVERSAL_REQUIRES_LATEST_TRANSACTION'), 'ordered reversal safety missing');
expect(migration.includes("'PRODUCT_USAGE_COST'") && migration.includes("'EMPLOYEE_PURCHASE_COST'") && migration.includes("'INCOME_EMPLOYEE_PURCHASE'"), 'monthly inventory metrics missing');
expect(migration.includes("source_node.entity_type='usage_record'") && migration.includes("source_node.entity_type='employee_purchase'"), 'monthly business trace missing');
expect(!/mgj_service_records|from\s+public\.mgj_|join\s+public\.mgj_/i.test(migration), 'inventory must not use Meiguanjia');

const rpcs = [
  'zysyr_save_purchase_order', 'zysyr_transition_purchase_order', 'zysyr_post_goods_receipt',
  'zysyr_record_usage', 'zysyr_record_employee_purchase', 'zysyr_confirm_employee_purchase_payment',
  'zysyr_confirm_purchase_payment', 'zysyr_reverse_inventory_record',
  'zysyr_post_stock_transfer', 'zysyr_reverse_inventory_payment',
];
for (const name of rpcs) {
  expect(migration.includes(`create or replace function public.${name}`), `${name} RPC missing`);
  expect(new RegExp(`revoke execute on function public\\.${name}[\\s\\S]*?from public,anon,authenticated,service_role`, 'i').test(migration), `${name} browser revoke missing`);
  expect(new RegExp(`grant execute on function public\\.${name}[\\s\\S]*?to service_role`, 'i').test(migration), `${name} service-only grant missing`);
}

for (const operation of [
  'inventory_center', 'purchase_order_save', 'purchase_order_transition', 'goods_receipt_post',
  'inventory_usage_record', 'employee_purchase_record', 'inventory_payment_confirm',
  'inventory_record_reverse',
  'stock_transfer_post', 'inventory_payment_reverse',
]) expect(api.includes(`operation === "${operation}"`), `${operation} API route missing`);
expect(api.includes('hasAuthCapability(session, "inventory.write")'), 'inventory API capability check missing');
expect(api.includes('meiguanjia_used:false') || api.includes('meiguanjia_used: false'), 'independent source boundary missing');

const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)];
expect(scripts.length === 1, 'operations inline script missing or duplicated');
new vm.Script(scripts[0][1], { filename: 'operations.html' });
expect(page.includes('data-view="monthly" class="active"'), 'original monthly report must remain default home');
expect(page.includes('data-view="inventory"') && page.includes('id="view-inventory"'), 'inventory center UI missing');
for (const id of ['purchase-order-form', 'goods-receipt-form', 'inventory-usage-form', 'employee-purchase-form', 'stock-transfer-form', 'inventory-payment-form']) {
  expect(page.includes(`id="${id}"`), `${id} missing`);
}
expect(page.includes('移动平均成本') && page.includes('库存流水（成本追溯）'), 'inventory costing and trace display missing');
expect(page.includes('本页是独立的 ZYSYR 库存账，不读取也不回写美管加'), 'source boundary copy missing');

expect(runtime.includes('MOVING_AVERAGE_MISMATCH') && runtime.includes('balance.quantity<>20'), 'moving-average transaction test missing');
expect(runtime.includes('OVER_RECEIPT_WAS_NOT_BLOCKED') && runtime.includes('CROSS_STORE_WRITE_WAS_NOT_BLOCKED'), 'over-receipt/store isolation tests missing');
expect(runtime.includes('REVERSAL_BALANCE_MISMATCH') && runtime.includes('PAID_EMPLOYEE_PURCHASE_REVERSED'), 'reversal guards missing');
expect(runtime.includes('TRANSFER_SOURCE_BALANCE_MISMATCH') && runtime.includes('TRANSFER_REVERSE_DESTINATION_MISMATCH'), 'two-store transfer tests missing');
expect(runtime.includes('EMPLOYEE_PAYMENT_STATUS_NOT_RESTORED') && runtime.includes('PURCHASE_PAYMENT_STATUS_NOT_RESTORED'), 'payment reversal status tests missing');
expect(runtime.includes('MONTHLY_USAGE_COST_MISMATCH') && runtime.includes('MONTHLY_INVENTORY_TRACE_MISSING'), 'monthly trace transaction test missing');

console.log('ZYSYR_SPRINT5_INVENTORY_STATIC_OK');
