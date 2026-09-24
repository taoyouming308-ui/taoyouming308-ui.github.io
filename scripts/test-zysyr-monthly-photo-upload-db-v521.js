#!/usr/bin/env node
// Isolated PostgreSQL regression only. Never connects to production.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const name = 'zysyr-monthly-photo-v521-' + process.pid + '-' + Date.now();
const docker = args => execFileSync('docker', args, { encoding: 'utf8' });
const sql = text => execFileSync('docker', ['exec', '-i', name, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], {
  input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
}).trim();
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

(async () => {
  docker(['run', '--rm', '-d', '--network', 'none', '--name', name, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
  try {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try { sql('select 1'); break; } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    sql(`
      create extension if not exists pgcrypto;
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema zysyr_private;
      create function zysyr_private.assert_finance_scope(uuid,uuid,uuid,text) returns void language plpgsql as $$
      begin
        if $1 <> '${id(3)}' or $2 <> '${id(1)}' or $3 <> '${id(2)}' or $4 <> 'report.upload'
        then raise exception 'FINANCE_SCOPE_FORBIDDEN'; end if;
      end $$;
      create table public.zysyr_history_import_batches(
        id uuid primary key, company_id uuid not null, store_id uuid not null,
        import_type text not null, status text not null, period_start date not null, period_end date not null
      );
      create table public.zysyr_history_ledger_entries(
        id uuid primary key, company_id uuid not null, store_id uuid not null,
        import_batch_id uuid not null, import_row_id uuid, entry_type text not null,
        period_month date not null, status text not null, current_payload jsonb not null, version integer not null
      );
      create table public.zysyr_history_import_evidence(
        id uuid primary key default gen_random_uuid(), company_id uuid not null, store_id uuid not null,
        import_batch_id uuid not null, period_month date not null, evidence_kind text not null,
        original_filename text not null, mime_type text not null, size_bytes bigint not null,
        sha256 text not null, bucket_id text not null, object_path text not null,
        embedded_asset_count integer not null default 0, uploaded_by_user_id uuid not null,
        uploaded_at timestamptz not null default now(), unique(company_id,store_id,import_batch_id,sha256)
      );
      create table public.zysyr_history_import_row_evidence(
        id uuid primary key default gen_random_uuid(), company_id uuid not null, store_id uuid not null,
        import_batch_id uuid not null, import_row_id uuid not null, evidence_id uuid not null,
        source_locator text not null, link_level text not null, linked_by_user_id uuid not null,
        linked_at timestamptz not null default now(),
        unique(company_id,store_id,import_row_id,evidence_id,source_locator)
      );
      create table public.zysyr_history_import_events(
        id uuid primary key default gen_random_uuid(), company_id uuid not null, store_id uuid not null,
        import_batch_id uuid not null, import_row_id uuid, action text not null,
        before_json jsonb, after_json jsonb, reason text not null, actor_user_id uuid not null,
        created_at timestamptz not null default now()
      );
      insert into public.zysyr_history_import_batches values
        ('${id(4)}','${id(1)}','${id(2)}','monthly_profit_loss','completed','2026-01-01','2026-06-01');
      insert into public.zysyr_history_ledger_entries values
        ('${id(5)}','${id(1)}','${id(2)}','${id(4)}','${id(20)}','monthly_profit_loss','2026-01-01','posted','{"amount":100}',1),
        ('${id(6)}','${id(1)}','${id(2)}','${id(4)}','${id(21)}','monthly_profit_loss','2026-01-01','posted','{"amount":200}',1),
        ('${id(7)}','${id(1)}','${id(2)}','${id(4)}','${id(22)}','monthly_profit_loss','2026-02-01','posted','{"amount":300}',1);
    `);
    const migration = fs.readFileSync('supabase/migrations/20260922131500_zysyr_completed_history_monthly_attachments.sql', 'utf8');
    assert.doesNotMatch(migration, /update\s+public\.zysyr_history_ledger_entries/i, 'monthly attachment must not rewrite posted ledger rows');
    sql(migration);

    const before = sql(`select string_agg(id||':'||current_payload::text||':'||version,',' order by id) from zysyr_history_ledger_entries`);
    const first = JSON.parse(sql(`select zysyr_attach_completed_history_monthly_evidence(
      '${id(3)}','${id(1)}','${id(2)}','${id(4)}','2026-01-01','一月月报.jpg','image/jpeg',128,
      '${'a'.repeat(64)}','zysyr-reports','monthly/january.jpg','补传一月月报照片'
    )`));
    assert.equal(first.created, true);
    assert.equal(first.linked_rows, 2);
    assert.equal(first.formal_ledger_amount_changed, false);
    assert.equal(sql('select count(*) from zysyr_history_import_evidence'), '1');
    assert.equal(sql("select count(*) from zysyr_history_import_row_evidence where link_level='bundle_only' and source_locator='monthly-report:2026-01'"), '2');
    assert.equal(sql('select count(*) from zysyr_history_import_events'), '1');
    assert.equal(sql(`select string_agg(id||':'||current_payload::text||':'||version,',' order by id) from zysyr_history_ledger_entries`), before);

    const retry = JSON.parse(sql(`select zysyr_attach_completed_history_monthly_evidence(
      '${id(3)}','${id(1)}','${id(2)}','${id(4)}','2026-01-01','一月月报.jpg','image/jpeg',128,
      '${'a'.repeat(64)}','zysyr-reports','monthly/january.jpg','重复点击安全重试'
    )`));
    assert.equal(retry.created, false);
    assert.equal(retry.linked_rows, 0);
    assert.equal(sql('select count(*) from zysyr_history_import_evidence'), '1');
    assert.equal(sql('select count(*) from zysyr_history_import_events'), '1');
    assert.throws(() => sql(`select zysyr_attach_completed_history_monthly_evidence(
      '${id(3)}','${id(1)}','${id(2)}','${id(4)}','2026-02-01','二月月报.jpg','image/jpeg',128,
      '${'a'.repeat(64)}','zysyr-reports','monthly/february.jpg','禁止跨月复用'
    )`), /HISTORY_MONTHLY_ATTACHMENT_ALREADY_USED_OTHER_MONTH/);
    assert.throws(() => sql(`select zysyr_attach_completed_history_monthly_evidence(
      '${id(99)}','${id(1)}','${id(2)}','${id(4)}','2026-01-01','越权.jpg','image/jpeg',128,
      '${'b'.repeat(64)}','zysyr-reports','monthly/forbidden.jpg','越权测试'
    )`), /FINANCE_SCOPE_FORBIDDEN/);
    assert.equal(sql("select has_function_privilege('authenticated','zysyr_attach_completed_history_monthly_evidence(uuid,uuid,uuid,uuid,date,text,text,bigint,text,text,text,text)','execute')"), 'f');
    assert.equal(sql("select has_function_privilege('service_role','zysyr_attach_completed_history_monthly_evidence(uuid,uuid,uuid,uuid,date,text,text,bigint,text,text,text,text)','execute')"), 't');
    console.log('monthly photo upload v521 DB: completed batch scope, append-only evidence, idempotency, month isolation, privilege and immutable amounts passed');
  } finally {
    docker(['stop', name]);
  }
})().catch(error => {
  console.error(error.stderr ? String(error.stderr) : error);
  process.exitCode = 1;
});
