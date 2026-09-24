#!/usr/bin/env node
// Isolated disposable PostgreSQL only; never connects to production.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const name = 'zysyr-monthly-names-v500-' + process.pid + '-' + Date.now();
const docker = args => execFileSync('docker', args, { encoding: 'utf8' });
const sql = text => execFileSync('docker', ['exec', '-i', name, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const fail = (text, pattern) => assert.throws(() => sql(text), error => pattern.test(String(error.stderr)));
const root = path.resolve(__dirname, '..');

async function run() {
  docker(['run', '--rm', '-d', '--network', 'none', '--name', name, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
  try {
    for (let i = 0; i < 80; i += 1) {
      try { sql('select 1'); break; } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    sql(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema zysyr_private;
      create function auth.role() returns text language sql stable as $$select current_user::text$$;
      create table zysyr_companies(id uuid primary key);
      create table zysyr_stores(company_id uuid,id uuid,primary key(company_id,id));
      create table zysyr_user_accounts(company_id uuid,id uuid,primary key(company_id,id));
      create table zysyr_report_uploads(
        id uuid primary key,company_id uuid,store_id uuid,report_type text,report_date date,status text,
        display_data jsonb,unique(company_id,store_id,id)
      );
      create table zysyr_monthly_cell_unlock_requests(
        id uuid primary key,company_id uuid,store_id uuid,period_month date,requested_by_user_id uuid,
        status text,decided_at timestamptz,consumed_at timestamptz,unique(company_id,id)
      );
      create table zysyr_audit_events(
        id bigint generated always as identity,company_id uuid,store_id uuid,actor_type text,
        actor_user_id uuid,channel text,entity_type text,entity_id uuid,action text,
        before_json jsonb,after_json jsonb,reason text,sensitivity text
      );
      create function zysyr_private.request_role() returns text language sql as $$select coalesce(current_setting('test.role',true),'')$$;
      create function zysyr_private.assert_finance_scope(uuid,uuid,uuid,text) returns void language plpgsql as $$begin if $1<>'${id(3)}' or $2<>'${id(1)}' or $3<>'${id(2)}' or $4<>'confirmed_finance.adjust' then raise exception 'FINANCE_SCOPE_FORBIDDEN'; end if; end$$;
      create function zysyr_private.period_is_locked(uuid,uuid,date) returns boolean language sql as $$select coalesce(current_setting('test.locked',true),'')='yes'$$;
      create function zysyr_private.protect_monthly_cell_history() returns trigger language plpgsql as $$begin raise exception 'MONTHLY_CELL_HISTORY_IMMUTABLE'; end$$;
      insert into zysyr_companies values('${id(1)}');
      insert into zysyr_stores values('${id(1)}','${id(2)}');
      insert into zysyr_user_accounts values('${id(1)}','${id(3)}');
      insert into zysyr_report_uploads values('${id(4)}','${id(1)}','${id(2)}','monthly_profit_loss','2026-09-01','active','{}');`);
    sql(fs.readFileSync(path.join(root, 'supabase/migrations/20260913113354_zysyr_monthly_editable_names.sql'), 'utf8'));

    const call = change => `set test.role='service_role'; select zysyr_revise_monthly_text_cells('${id(3)}','${id(1)}','${id(2)}','${id(4)}','${JSON.stringify([change])}'::jsonb,'财务核对名称');`;
    assert.match(sql(call({ cell_address: 'B3', cell_role: 'income_item', base_text: '美发收入', before_text: '美发收入', after_text: '剪发收入', expected_revision: 0 })).split('\n').at(-1), /"count": 1/);
    assert.equal(sql(`select revision||':'||base_text||':'||before_text||':'||after_text from zysyr_monthly_text_revisions where cell_address='B3'`), '1:美发收入:美发收入:剪发收入');
    assert.match(sql(call({ cell_address: 'B3', cell_role: 'income_item', base_text: '美发收入', before_text: '剪发收入', after_text: '剪烫收入', expected_revision: 1 })).split('\n').at(-1), /"count": 1/);
    assert.equal(sql(`select string_agg(after_text,',' order by revision) from zysyr_monthly_text_revisions where cell_address='B3'`), '剪发收入,剪烫收入');
    fail(call({ cell_address: 'B3', cell_role: 'income_item', base_text: '美发收入', before_text: '剪发收入', after_text: '错误覆盖', expected_revision: 1 }), /MONTHLY_TEXT_CHANGED_RELOAD/);
    fail(call({ cell_address: 'E3', cell_role: 'employee_number', base_text: '01', before_text: '01', after_text: '99', expected_revision: 0 }), /MONTHLY_TEXT_VALUE_INVALID/);
    fail(`set test.role='service_role'; set test.locked='yes'; select zysyr_revise_monthly_text_cells('${id(3)}','${id(1)}','${id(2)}','${id(4)}','[{"cell_address":"F12","cell_role":"staff_name","base_text":"","before_text":"","after_text":"新员工","expected_revision":0}]','财务新增员工');`, /MONTHLY_UNLOCK_APPROVAL_REQUIRED/);
    sql(`insert into zysyr_monthly_cell_unlock_requests values('${id(5)}','${id(1)}','${id(2)}','2026-09-01','${id(3)}','approved',now(),null);`);
    assert.match(sql(`set test.role='service_role'; set test.locked='yes'; select zysyr_revise_monthly_text_cells('${id(3)}','${id(1)}','${id(2)}','${id(4)}','[{"cell_address":"F12","cell_role":"staff_name","base_text":"","before_text":"","after_text":"新员工","expected_revision":0}]','财务新增员工');`).split('\n').at(-1), /"count": 1/);
    assert.equal(sql(`select status from zysyr_monthly_cell_unlock_requests where id='${id(5)}'`), 'consumed');
    assert.equal(sql(`select count(*) from zysyr_audit_events where action='monthly_text_change'`), '3');
    fail(`update zysyr_monthly_text_revisions set after_text='覆盖历史' where cell_address='B3';`, /MONTHLY_CELL_HISTORY_IMMUTABLE/);
    fail(`set role authenticated; select zysyr_revise_monthly_text_cells('${id(3)}','${id(1)}','${id(2)}','${id(4)}','[]','x');`, /permission denied/);
    fail(`set role authenticated; select count(*) from zysyr_monthly_text_revisions;`, /permission denied/);
    console.log('PostgreSQL monthly name revisions: append-only history, concurrency, finance scope, lock approval, audit and browser denial passed');
  } finally {
    docker(['stop', name]);
  }
}

run().catch(error => {
  console.error(error.stderr ? String(error.stderr) : error);
  process.exitCode = 1;
});
