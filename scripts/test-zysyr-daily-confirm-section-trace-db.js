#!/usr/bin/env node
// Disposable PostgreSQL only. Never connects to production.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const name = `zysyr-confirm-trace-${process.pid}-${Date.now()}`;
const docker = args => execFileSync('docker', args, { encoding: 'utf8' });
const sql = input => execFileSync('docker', ['exec', '-i', name, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'],
  { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();

async function run() {
  docker(['run', '--rm', '-d', '--network', 'none', '--name', name,
    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:15']);
  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      try { sql('select 1'); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    assert.ok(ready, 'disposable PostgreSQL must start');
    sql(`create role anon; create role authenticated; create role service_role;
      create schema zysyr_private;
      create table zysyr_daily_sheet_drafts(id uuid);
      create table zysyr_import_batches(id uuid);
      create table zysyr_daily_reports(id uuid);
      create table zysyr_reconciliation_reports(id uuid);
      create table zysyr_daily_sheet_versions(id uuid);`);
    sql(fs.readFileSync('supabase/migrations/20260923091020_zysyr_daily_sheet_section_trace_coordinates.sql', 'utf8'));
    assert.equal(sql(`select has_function_privilege('anon',
      'zysyr_confirm_daily_sheet(uuid,uuid,uuid,uuid,jsonb,boolean,text)', 'execute')`), 'f');
    assert.equal(sql(`select has_function_privilege('authenticated',
      'zysyr_confirm_daily_sheet(uuid,uuid,uuid,uuid,jsonb,boolean,text)', 'execute')`), 'f');
    assert.equal(sql(`select has_function_privilege('service_role',
      'zysyr_confirm_daily_sheet(uuid,uuid,uuid,uuid,jsonb,boolean,text)', 'execute')`), 't');
    const result = sql(`create temporary table source_cells(section_code text, row_number integer, column_number integer, cell_role text);
      insert into source_cells values ('technician',23,2,'staff_value'),('product',23,2,'product_value'),('stylist',3,2,'staff_value');
      select count(*), count(distinct ('原图电子日报/'||section_code, 'B'||row_number::text))
      from source_cells;`);
    assert.equal(result.split('\n').at(-1), '3|3');
    console.log('isolated PostgreSQL: function compiles, service-role gate holds, overlapping sections trace uniquely');
  } finally {
    docker(['stop', name]);
  }
}
run().catch(error => { console.error(error.stderr ? String(error.stderr) : error); process.exitCode = 1; });
