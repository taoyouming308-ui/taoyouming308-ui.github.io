#!/usr/bin/env node
// Isolated PostgreSQL regression only. Never connects to production.
const { execFileSync } = require('child_process');
const fs = require('fs');
const assert = require('assert/strict');

const name = 'zysyr-petty-batch-v520-' + process.pid + '-' + Date.now();
const docker = args => execFileSync('docker', args, { encoding: 'utf8' });
const sql = text => execFileSync('docker', ['exec', '-i', name, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], {
  input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
}).trim();
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

async function run() {
  docker(['run', '--rm', '-d', '--network', 'none', '--name', name, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:15']);
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
        if $1 <> '${id(3)}' or $2 <> '${id(1)}' or $3 <> '${id(2)}'
           or $4 not in ('voucher.review','expense.create_submit') then
          raise exception 'FINANCE_SCOPE_FORBIDDEN';
        end if;
      end $$;
      create table public.zysyr_voucher_attachments(
        id uuid primary key, company_id uuid not null, store_id uuid not null,
        note text not null, audit_status text not null, document_type text not null,
        original_filename text not null, mime_type text not null, size_bytes bigint not null,
        sha256 text not null, bucket_id text not null, object_path text not null
      );
      create table public.zysyr_petty_cash_records(
        id uuid primary key, company_id uuid not null, store_id uuid not null,
        transaction_date date not null, direction text not null, status text not null,
        amount numeric not null, summary text not null
      );
      create table public.zysyr_voucher_links(
        id uuid primary key default gen_random_uuid(), company_id uuid not null, store_id uuid not null,
        voucher_id uuid not null, business_type text not null, business_id uuid not null,
        relation_type text not null, linked_by_user_id uuid not null,
        linked_at timestamptz not null default now(), unlinked_at timestamptz,
        unique(company_id,voucher_id,business_type,business_id,relation_type)
      );
      create function public.zysyr_review_voucher(uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,uuid[],text)
      returns public.zysyr_voucher_attachments language plpgsql as $$
      declare saved public.zysyr_voucher_attachments;
      begin
        perform zysyr_private.assert_finance_scope($1,$2,$3,'voucher.review');
        update public.zysyr_voucher_attachments set audit_status=$5, document_type=$6
        where id=$4 and company_id=$2 and store_id=$3 returning * into saved;
        return saved;
      end $$;
      create function zysyr_private.link_finance_vouchers(uuid,uuid,uuid,text,uuid,uuid[],text,text)
      returns integer language plpgsql as $$
      declare count_saved integer;
      begin
        if exists(select 1 from unnest($6) requested(id) left join public.zysyr_voucher_attachments voucher
          on voucher.id=requested.id and voucher.company_id=$2 and voucher.store_id=$3 and voucher.audit_status='approved'
          where voucher.id is null) then raise exception 'APPROVED_VOUCHER_NOT_FOUND'; end if;
        insert into public.zysyr_voucher_links(company_id,store_id,voucher_id,business_type,business_id,relation_type,linked_by_user_id)
        select $2,$3,voucher_id,$4,$5,$7,$1 from unnest($6) requested(voucher_id) on conflict do nothing;
        get diagnostics count_saved=row_count; return count_saved;
      end $$;
      create table public.zysyr_history_ledger_entries(
        id uuid primary key, company_id uuid not null, store_id uuid not null,
        import_batch_id uuid not null, import_row_id uuid not null unique, entry_type text not null,
        period_month date not null, status text not null, source_locator text not null,
        posted_payload jsonb not null, current_payload jsonb not null, version integer not null
      );
      create table public.zysyr_history_import_evidence(
        id uuid primary key default gen_random_uuid(), company_id uuid not null, store_id uuid not null,
        import_batch_id uuid not null, period_month date not null, evidence_kind text not null,
        original_filename text not null, mime_type text not null, size_bytes bigint not null,
        sha256 text not null, bucket_id text not null, object_path text not null,
        embedded_asset_count integer not null, uploaded_by_user_id uuid not null,
        unique(company_id,store_id,import_batch_id,sha256)
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
        after_json jsonb, reason text not null, actor_user_id uuid not null
      );
      create table public.zysyr_audit_events(
        id uuid primary key default gen_random_uuid(), company_id uuid not null, store_id uuid not null,
        actor_type text, actor_user_id uuid, channel text, entity_type text, entity_id uuid,
        action text, after_json jsonb, reason text, sensitivity text
      );
      insert into public.zysyr_petty_cash_records values(
        '${id(4)}','${id(1)}','${id(2)}','2026-01-02','outflow','confirmed',21.80,'柠檬'
      );
      insert into public.zysyr_history_ledger_entries values
        ('${id(5)}','${id(1)}','${id(2)}','${id(20)}','${id(21)}','petty_cash','2026-01-01','posted','01!A2:H2','{"amount":20.5}','{"amount":20.5}',1),
        ('${id(6)}','${id(1)}','${id(2)}','${id(20)}','${id(22)}','petty_cash','2026-01-01','posted','01!A3:H3','{"amount":30}','{"amount":30}',1);
      insert into public.zysyr_voucher_attachments values
        ('${id(7)}','${id(1)}','${id(2)}','petty_cash_batch|2026-01|${id(8)}|柠檬.png','pending','unclassified','柠檬.png','image/png',128,'${'a'.repeat(64)}','zysyr-vouchers','batch/formal.png'),
        ('${id(9)}','${id(1)}','${id(2)}','petty_cash_batch|2026-01|${id(8)}|鲜花.png','pending','unclassified','鲜花.png','image/png',256,'${'b'.repeat(64)}','zysyr-vouchers','batch/history.png'),
        ('${id(10)}','${id(1)}','${id(2)}','petty_cash_batch|2026-02|${id(8)}|错月.png','pending','unclassified','错月.png','image/png',256,'${'c'.repeat(64)}','zysyr-vouchers','batch/wrong-month.png');
    `);
    sql(fs.readFileSync('supabase/migrations/20260922113633_zysyr_petty_cash_batch_vouchers.sql', 'utf8'));

    const formalBefore = sql(`select amount||'|'||summary from zysyr_petty_cash_records where id='${id(4)}'`);
    const formalResult = JSON.parse(sql(`select zysyr_review_and_link_petty_cash_voucher(
      '${id(3)}','${id(1)}','${id(2)}','${id(7)}','formal','${id(4)}',
      '{"document_date":"2026-01-02","amount":21.8}'::jsonb,'{}'::jsonb,'批量凭证人工确认'
    )`));
    assert.equal(formalResult.linked, true);
    assert.equal(formalResult.amount_changed, false);
    assert.equal(sql(`select audit_status||'|'||document_type from zysyr_voucher_attachments where id='${id(7)}'`), 'approved|petty_cash');
    assert.equal(sql(`select business_type||'|'||business_id from zysyr_voucher_links where voucher_id='${id(7)}'`), 'petty_cash_record|' + id(4));
    assert.equal(sql(`select amount||'|'||summary from zysyr_petty_cash_records where id='${id(4)}'`), formalBefore);

    const historyBefore = sql(`select posted_payload::text||'|'||current_payload::text||'|'||version from zysyr_history_ledger_entries where id='${id(5)}'`);
    const historyResult = JSON.parse(sql(`select zysyr_review_and_link_petty_cash_voucher(
      '${id(3)}','${id(1)}','${id(2)}','${id(9)}','history','${id(5)}',
      '{"document_date":"2026-01-06","amount":20.5}'::jsonb,'{}'::jsonb,'批量凭证人工确认'
    )`));
    assert.equal(historyResult.linked, true);
    assert.equal(sql(`select bucket_id||'|'||object_path from zysyr_history_import_evidence where sha256='${'b'.repeat(64)}'`), 'zysyr-vouchers|batch/history.png');
    assert.equal(sql('select link_level from zysyr_history_import_row_evidence'), 'page_confirmed');
    assert.equal(sql(`select posted_payload::text||'|'||current_payload::text||'|'||version from zysyr_history_ledger_entries where id='${id(5)}'`), historyBefore);
    sql(`select zysyr_review_and_link_petty_cash_voucher('${id(3)}','${id(1)}','${id(2)}','${id(9)}','history','${id(5)}','{}','{}','安全重试')`);
    assert.equal(sql('select count(*) from zysyr_history_import_evidence'), '1');
    assert.equal(sql('select count(*) from zysyr_history_import_row_evidence'), '1');
    assert.throws(() => sql(`select zysyr_review_and_link_petty_cash_voucher('${id(3)}','${id(1)}','${id(2)}','${id(9)}','history','${id(6)}','{}','{}','错误复用')`), /VOUCHER_ALREADY_LINKED_TO_OTHER_ITEM/);
    assert.throws(() => sql(`select zysyr_review_and_link_petty_cash_voucher('${id(3)}','${id(1)}','${id(2)}','${id(10)}','formal','${id(4)}','{}','{}','月份错误')`), /PETTY_BATCH_MONTH_MISMATCH/);
    assert.equal(sql("select has_function_privilege('authenticated','zysyr_review_and_link_petty_cash_voucher(uuid,uuid,uuid,uuid,text,uuid,jsonb,jsonb,text)','execute')"), 'f');
    assert.equal(sql("select has_function_privilege('service_role','zysyr_review_and_link_petty_cash_voucher(uuid,uuid,uuid,uuid,text,uuid,jsonb,jsonb,text)','execute')"), 't');
    console.log('PostgreSQL v520 petty batch: atomic review/link, current/history isolation, idempotency, audit boundary and immutable amounts passed');
  } finally {
    docker(['stop', name]);
  }
}

run().catch(error => {
  console.error(error.stderr ? String(error.stderr) : error);
  process.exitCode = 1;
});
