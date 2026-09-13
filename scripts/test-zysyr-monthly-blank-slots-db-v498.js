#!/usr/bin/env node
// Isolated disposable PostgreSQL only; never connects to production.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const name = 'zysyr-monthly-slots-v498-' + process.pid + '-' + Date.now();
const docker = args => execFileSync('docker', args, { encoding: 'utf8' });
const sql = text => execFileSync('docker', ['exec', '-i', name, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const fail = (text, pattern) => assert.throws(() => sql(text), error => pattern.test(String(error.stderr)));
async function run() {
  docker(['run', '--rm', '-d', '--network', 'none', '--name', name, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:15']);
  try {
    for (let i = 0; i < 80; i += 1) { try { sql('select 1'); break; } catch { await new Promise(resolve => setTimeout(resolve, 250)); } }
    sql(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema zysyr_private;
      create table zysyr_companies(id uuid primary key);
      create table zysyr_stores(company_id uuid,id uuid,primary key(company_id,id));
      create table zysyr_user_accounts(company_id uuid,id uuid,primary key(company_id,id));
      create table zysyr_report_uploads(
        id uuid primary key,company_id uuid,store_id uuid,report_type text,report_date date,status text,
        template_code text,template_version integer,version integer,supersedes_report_id uuid,
        original_filename text,mime_type text,size_bytes bigint,sha256 text,bucket_id text,object_path text,
        display_data jsonb,uploaded_by_user_id uuid,uploaded_at timestamptz default now()
      );
      create table zysyr_report_cells(
        id uuid primary key default gen_random_uuid(),company_id uuid,store_id uuid,report_id uuid,
        sheet_name text,cell_address text,row_number integer,column_number integer,cell_kind text,
        display_value text,numeric_value numeric,formula text,precedent_addresses jsonb,label text,
        unique(company_id,report_id,sheet_name,cell_address)
      );
      create table zysyr_trace_nodes(id uuid primary key default gen_random_uuid(),company_id uuid,store_id uuid,entity_type text,entity_id uuid,unique(company_id,entity_type,entity_id));
      create table zysyr_trace_edges(id uuid primary key default gen_random_uuid(),company_id uuid,store_id uuid,from_node_id uuid,to_node_id uuid,relation_type text,created_by_user_id uuid,unique(company_id,from_node_id,to_node_id,relation_type));
      create table zysyr_audit_events(id bigint generated always as identity,company_id uuid,store_id uuid,actor_type text,actor_user_id uuid,channel text,entity_type text,entity_id uuid,action text,before_json jsonb,after_json jsonb,reason text,sensitivity text);
      create function zysyr_private.request_role() returns text language sql as $$select coalesce(current_setting('test.role',true),'')$$;
      create function zysyr_private.assert_finance_scope(uuid,uuid,uuid,text) returns void language plpgsql as $$begin if $1<>'${id(3)}' or $2<>'${id(1)}' or $3<>'${id(2)}' or $4<>'confirmed_finance.adjust' then raise exception 'FINANCE_SCOPE_FORBIDDEN'; end if; end$$;
      create function zysyr_private.period_is_locked(uuid,uuid,date) returns boolean language sql as $$select coalesce(current_setting('test.locked',true),'')='yes'$$;
      insert into zysyr_companies values('${id(1)}'); insert into zysyr_stores values('${id(1)}','${id(2)}'); insert into zysyr_user_accounts values('${id(1)}','${id(3)}');
      insert into zysyr_report_uploads(id,company_id,store_id,report_type,report_date,status,display_data) values('${id(4)}','${id(1)}','${id(2)}','monthly_profit_loss','2026-09-01','active','{"sheet_name":"9月"}');
      insert into zysyr_trace_nodes(company_id,store_id,entity_type,entity_id) values('${id(1)}','${id(2)}','finance_report','${id(4)}');`);
    sql(fs.readFileSync(path.join(root(), 'supabase/migrations/20260913063300_zysyr_monthly_blank_amount_slots.sql'), 'utf8'));
    const cells = JSON.stringify([{ sheet_name: '9月', cell_address: 'G12', row_number: 12, column_number: 7, cell_kind: 'input', display_value: '', numeric_value: 0, formula: null, precedent_addresses: [], label: '技术人员 / 第12行 / 底薪' }]);
    const call = `set test.role='service_role';select zysyr_prepare_monthly_editable_slots('${id(3)}','${id(1)}','${id(2)}','${id(4)}','${cells}'::jsonb);`;
    assert.match(sql(call).split('\n').at(-1), /"prepared": 1/);
    assert.equal(sql(`select display_value||':'||numeric_value from zysyr_report_cells where cell_address='G12'`), ':0');
    assert.equal(sql(`select count(*) from zysyr_trace_nodes where entity_type='report_cell'`), '1');
    assert.equal(sql(`select count(*) from zysyr_trace_edges where relation_type='contains'`), '1');
    assert.equal(sql(`select count(*) from zysyr_audit_events where action='monthly_editable_slots_prepare'`), '1');
    assert.match(sql(call).split('\n').at(-1), /"prepared": 0/);
    fail(`set test.role='service_role';select zysyr_prepare_monthly_editable_slots('${id(3)}','${id(1)}','${id(2)}','${id(4)}','[{"sheet_name":"9月","cell_address":"E12","row_number":12,"column_number":5,"cell_kind":"input","display_value":"","numeric_value":0,"label":"员工编号"}]');`, /PAYLOAD_INVALID/);
    fail(`set test.role='service_role';set test.locked='yes';select zysyr_prepare_monthly_editable_slots('${id(3)}','${id(1)}','${id(2)}','${id(4)}','${cells}'::jsonb);`, /FINANCE_PERIOD_LOCKED/);
    fail(`set role authenticated;select zysyr_prepare_monthly_editable_slots('${id(3)}','${id(1)}','${id(2)}','${id(4)}','${cells}'::jsonb);`, /permission denied/);
    console.log('PostgreSQL monthly blank amount-slot scope, lock, audit and idempotency checks passed');
  } finally { docker(['stop', name]); }
}
function root() { return path.resolve(__dirname, '..'); }
run().catch(error => { console.error(error.stderr ? String(error.stderr) : error); process.exitCode = 1; });
