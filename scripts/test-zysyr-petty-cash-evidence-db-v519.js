#!/usr/bin/env node
// Isolated PostgreSQL regression only. Never connects to production.
const { execFileSync } = require('child_process');
const fs = require('fs');
const assert = require('assert/strict');

const name = 'zysyr-petty-evidence-v519-' + process.pid + '-' + Date.now();
const docker = args => execFileSync('docker', args, { encoding: 'utf8' });
const sql = text => execFileSync('docker', ['exec', '-i', name, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], {
  input: text,
  encoding: 'utf8',
  stdio: ['pipe', 'pipe', 'pipe']
}).trim();
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

async function run() {
  docker(['run', '--rm', '-d', '--network', 'none', '--name', name, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
  try {
    for (let i = 0; i < 80; i += 1) {
      try { sql('select 1'); break; } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    sql(`
      create extension if not exists pgcrypto;
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema zysyr_private;
      create function zysyr_private.assert_finance_scope(uuid,uuid,uuid,text) returns void language plpgsql as $$
      begin
        if $1 <> '${id(3)}' or $2 <> '${id(1)}' or $3 <> '${id(2)}' or $4 <> 'expense.create_submit' then
          raise exception 'FINANCE_SCOPE_FORBIDDEN';
        end if;
      end $$;
      create table public.zysyr_history_ledger_entries(
        id uuid primary key, company_id uuid not null, store_id uuid not null,
        import_batch_id uuid not null, import_row_id uuid not null, entry_type text not null,
        period_month date not null, status text not null, source_locator text not null,
        source_row_hash text not null, posted_payload jsonb not null,
        current_payload jsonb not null, version integer not null
      );
      create table public.zysyr_history_import_evidence(
        id uuid primary key default gen_random_uuid(), company_id uuid not null,
        store_id uuid not null, import_batch_id uuid not null, period_month date not null,
        evidence_kind text not null, original_filename text not null, mime_type text not null,
        size_bytes bigint not null, sha256 text not null, bucket_id text not null,
        object_path text not null, embedded_asset_count integer not null,
        uploaded_by_user_id uuid not null,
        unique(company_id,store_id,import_batch_id,sha256)
      );
      create table public.zysyr_history_import_row_evidence(
        id uuid primary key default gen_random_uuid(), company_id uuid not null,
        store_id uuid not null, import_batch_id uuid not null, import_row_id uuid not null,
        evidence_id uuid not null, source_locator text not null, link_level text not null,
        linked_by_user_id uuid not null,
        unique(company_id,store_id,import_row_id,evidence_id,source_locator)
      );
      create table public.zysyr_history_import_events(
        id uuid primary key default gen_random_uuid(), company_id uuid not null,
        store_id uuid not null, import_batch_id uuid not null, import_row_id uuid,
        action text not null, after_json jsonb, reason text not null, actor_user_id uuid not null
      );
      insert into public.zysyr_history_ledger_entries values(
        '${id(4)}','${id(1)}','${id(2)}','${id(5)}','${id(6)}','petty_cash',
        '2026-01-01','posted','Sheet1!A2','${'a'.repeat(64)}',
        '{"summary":"纸巾","credit":11.80}','{"summary":"纸巾","credit":11.80}',1
      );
    `);
    sql(fs.readFileSync('supabase/migrations/20260922093000_zysyr_history_item_evidence_upload.sql', 'utf8'));

    const before = sql(`select source_locator||'|'||source_row_hash||'|'||posted_payload::text||'|'||current_payload::text||'|'||version from zysyr_history_ledger_entries where id='${id(4)}'`);
    const saved = JSON.parse(sql(`select row_to_json(saved) from zysyr_attach_history_ledger_evidence(
      '${id(3)}','${id(1)}','${id(2)}','${id(4)}','纸巾凭证.png','image/png',128,
      '${'b'.repeat(64)}','zysyr-reports','history/${id(4)}.png','补充逐笔消费凭证'
    ) saved;`));
    assert.equal(saved.original_filename, '纸巾凭证.png');
    assert.equal(saved.evidence_kind, 'supporting_document');
    assert.equal(sql('select source_locator||\'|\'||link_level from zysyr_history_import_row_evidence'), 'manual-upload:' + 'b'.repeat(16) + '|page_confirmed');
    assert.equal(sql('select string_agg(action,\',\' order by action) from zysyr_history_import_events'), 'evidence_link,evidence_upload');
    assert.equal(sql(`select source_locator||'|'||source_row_hash||'|'||posted_payload::text||'|'||current_payload::text||'|'||version from zysyr_history_ledger_entries where id='${id(4)}'`), before, 'receipt upload must not rewrite posted or current finance data');

    sql(`select zysyr_attach_history_ledger_evidence(
      '${id(3)}','${id(1)}','${id(2)}','${id(4)}','纸巾凭证.png','image/png',128,
      '${'b'.repeat(64)}','zysyr-reports','history/${id(4)}.png','重复请求'
    );`);
    assert.equal(sql('select count(*) from zysyr_history_import_evidence'), '1');
    assert.equal(sql('select count(*) from zysyr_history_import_row_evidence'), '1');
    assert.equal(sql('select count(*) from zysyr_history_import_events'), '2');
    assert.throws(() => sql(`select zysyr_attach_history_ledger_evidence(
      '${id(3)}','${id(1)}','${id(7)}','${id(4)}','跨店.png','image/png',128,
      '${'c'.repeat(64)}','zysyr-reports','history/cross-store.png','跨店测试'
    );`), /FINANCE_SCOPE_FORBIDDEN/);
    assert.equal(sql("select has_function_privilege('authenticated','zysyr_attach_history_ledger_evidence(uuid,uuid,uuid,uuid,text,text,bigint,text,text,text,text)','execute')"), 'f');
    assert.equal(sql("select has_function_privilege('service_role','zysyr_attach_history_ledger_evidence(uuid,uuid,uuid,uuid,text,text,bigint,text,text,text,text)','execute')"), 't');
    console.log('PostgreSQL v519 petty evidence: exact link, idempotency, audit, store scope and immutable finance data passed');
  } finally {
    docker(['stop', name]);
  }
}

run().catch(error => {
  console.error(error.stderr ? String(error.stderr) : error);
  process.exitCode = 1;
});
