#!/usr/bin/env node
// Disposable PostgreSQL and synthetic cells only. Never touches production.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const container = `zysyr-daily-atomic-${process.pid}-${Date.now()}`;
const docker = args => execFileSync('docker', args, { encoding: 'utf8' });
const sql = query => execFileSync('docker', ['exec', '-i', container, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const q = text => `'${String(text).replaceAll("'", "''")}'`;
const company = id(1), store = id(2), draft = id(3), actor = id(4);
const api = fs.readFileSync(path.join(root, 'supabase/functions/operations-api/index.ts'), 'utf8');
const readFunction = (source, name) => {
  const start = source.indexOf(`async function ${name}(`);
  const end = source.indexOf('\n}', start) + 2;
  assert(start >= 0 && end > start, `${name} missing`);
  return source.slice(start, end);
};
const captured = [];
const scope = {
  hasAuthCapability: (_session, capability) => capability === 'daily_report.write',
  selectedStoreInfo: async () => ({ id: store, company_id: company, name: '测试门店' }),
  cleanText: (value, max = 500) => String(value ?? '').trim().slice(0, max),
  safeCellText: (value, max = 120) => String(value ?? '').trim().slice(0, max).replace(/[|\r\n]/g, ' '),
  uuidValue: (value, message) => { if (!/^[0-9a-f-]{36}$/i.test(value)) throw Error(message); return value; },
  financeRpcSaved: async (endpoint, payload) => { captured.push({ endpoint, payload }); return { saved: true }; },
  dailySheetRead: async () => ({ draft: { id: draft, status: 'draft' } }),
};
vm.createContext(scope);
vm.runInContext(stripTypeScriptTypes(readFunction(api, 'saveDailySheetDraft')), scope);

async function run() {
  docker(['run', '--rm', '-d', '--network', 'none', '--name', container, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:15']);
  try {
    for (let attempt = 0; attempt < 80; attempt++) {
      try { sql('select 1'); break; } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    sql(`create role anon; create role authenticated; create role service_role;
      create schema zysyr_private;
      create table public.zysyr_daily_sheet_drafts(id uuid primary key, company_id uuid, store_id uuid,
        status text not null, edit_revision integer not null, validation_result jsonb not null,
        updated_by_user_id uuid, updated_at timestamptz);
      create table public.zysyr_daily_sheet_cells(id uuid primary key, company_id uuid, store_id uuid,
        draft_id uuid, section_code text, row_key text, row_label text, column_code text,
        column_label text, row_number integer, column_number integer, cell_role text,
        ocr_numeric numeric(14,2), corrected_numeric numeric(14,2), manual_text text,
        manual_override boolean not null default false, row_label_source_method text not null default 'template',
        row_label_confidence numeric, updated_by_user_id uuid, updated_at timestamptz,
        unique(company_id,draft_id,section_code,row_key,column_code));
      create table public.zysyr_daily_sheet_cell_changes(id uuid default gen_random_uuid(),
        company_id uuid, store_id uuid, draft_id uuid, cell_id uuid, revision integer,
        before_value numeric, after_value numeric, before_text text, after_text text,
        before_label text, after_label text, changed_by_user_id uuid, reason text,
        unique(company_id,cell_id,revision));
      create table public.zysyr_audit_events(company_id uuid,store_id uuid,actor_type text,
        actor_user_id uuid,channel text,entity_type text,entity_id uuid,action text,
        before_json jsonb,after_json jsonb,reason text,sensitivity text);
      create function zysyr_private.assert_daily_entry_scope(uuid,uuid,uuid) returns void language plpgsql as
        $$begin if $1 <> '${actor}' or $2 <> '${company}' or $3 <> '${store}' then
          raise exception 'FINANCE_SCOPE_FORBIDDEN'; end if; end$$;
      create function zysyr_private.daily_sheet_cell_value(public.zysyr_daily_sheet_cells)
        returns numeric language sql immutable set search_path='' as
        $$select case when $1.manual_override then $1.corrected_numeric else null::numeric end$$;
      create function zysyr_private.daily_sheet_validation(uuid,uuid,uuid) returns jsonb language sql as
        $$select jsonb_build_object('valid',
          (select coalesce(sum(corrected_numeric),0) from public.zysyr_daily_sheet_cells
           where draft_id=$3 and cell_role='staff_value' and manual_override)
          = (select coalesce(sum(corrected_numeric),0) from public.zysyr_daily_sheet_cells
             where draft_id=$3 and cell_role='payment_method' and manual_override))$$;
      insert into public.zysyr_daily_sheet_drafts values('${draft}','${company}','${store}','draft',0,'{}','${actor}',now());`);
    const fixture = [
      ['stylist', 'stylist_1', 'wash_cut_blow', 'staff_value', 2126, '小王', 'codex_local_candidate'],
      ['stylist', 'stylist_1', 'subtotal', 'staff_total', 2126, '小王', 'codex_local_candidate'],
      ['stylist', 'stylist_category_total', 'wash_cut_blow', 'category_total', 2126, '小计', 'template'],
      ['summary', 'summary', 'actual_total', 'summary_actual', 2126, '汇总', 'template'],
      ['summary', 'summary', 'grand_total', 'summary_grand', 2126, '汇总', 'template'],
      ['payment', 'payment', 'alipay', 'payment_method', 2126, '支付', 'template'],
      ['payment', 'payment', 'cash_flow', 'payment_cashflow', 2126, '支付', 'template'],
      ['payment', 'payment', 'total', 'payment_total', 2126, '支付', 'template'],
    ];
    for (let i = 0; i < fixture.length; i++) {
      const [section, row, column, role, amount, label, labelSource] = fixture[i];
      sql(`insert into public.zysyr_daily_sheet_cells(id,company_id,store_id,draft_id,section_code,row_key,row_label,
        column_code,column_label,row_number,column_number,cell_role,ocr_numeric,row_label_source_method,
        updated_by_user_id,updated_at) values('${id(10 + i)}','${company}','${store}','${draft}',
        ${q(section)},${q(row)},${q(label)},${q(column)},${q(column)},${i + 1},1,
        ${q(role)},${amount},${q(labelSource)},'${actor}',now());`);
    }
    sql(fs.readFileSync(path.join(root, 'supabase/migrations/20260920071049_daily_review_atomic_save.sql'), 'utf8'));
    const legacyCells = fixture.map((row, i) => ({ id: id(10 + i), section_code: row[0], row_key: row[1],
      row_label: row[5], column_code: row[2], column_label: row[2], row_number: i + 1,
      column_number: 1, cell_role: row[3], value: String(row[4]) }));
    legacyCells.push({ id: id(10), section_code: 'stylist', row_key: 'stylist_1', row_label: '王小明' });
    const request = { store: '测试门店', draft_id: draft, reason: '逐格核对', cells: legacyCells };
    await scope.saveDailySheetDraft(request, { auth_account_id: actor });
    const edits = captured[0].payload.p_cells;
    assert.equal(edits.length, 8, 'same cell number + name must become one audited edit');
    const nameEdit = edits.find(cell => cell.id === id(10));
    assert.equal(nameEdit.value, 2126);
    assert.equal(nameEdit.row_label, '王小明');
    assert.equal(nameEdit.row_label_reviewed, true);
    assert.throws(() => sql(`select public.zysyr_save_daily_sheet_cells('${actor}','${company}','${store}','${draft}',
      ${q(JSON.stringify(legacyCells))}::jsonb,'逐格核对');`), /duplicate key|unique constraint/,
      'unmerged legacy payload reproduces the original 409');
    assert.equal(sql(`select count(*) from public.zysyr_daily_sheet_cell_changes`), '0', 'failed save rolls back');
    sql(`select public.zysyr_save_daily_sheet_cells('${actor}','${company}','${store}','${draft}',
      ${q(JSON.stringify(edits))}::jsonb,'逐格核对');`);
    assert.equal(sql(`select edit_revision||'|'||(validation_result->>'valid') from public.zysyr_daily_sheet_drafts`), '1|true');
    assert.equal(sql(`select count(*) from public.zysyr_daily_sheet_cell_changes`), '8');
    assert.equal(sql(`select count(*) from public.zysyr_daily_sheet_cell_changes where cell_id='${id(10)}' and row_label_reviewed`), '1');
    assert.equal(sql(`select corrected_numeric||'|'||row_label_source_method from public.zysyr_daily_sheet_cells where id='${id(10)}'`), '2126.00|manual');
    assert.equal(sql(`select count(*) from public.zysyr_daily_sheet_cells where ocr_numeric is distinct from 2126`), '0', 'original candidates untouched');
    sql(`insert into public.zysyr_daily_sheet_cells(id,company_id,store_id,draft_id,section_code,row_key,row_label,
      column_code,column_label,row_number,column_number,cell_role,row_label_source_method,updated_by_user_id,updated_at)
      values('${id(30)}','${company}','${store}','${draft}','stylist','stylist_2','待核姓名',
      'wash_cut_blow','洗剪吹',20,1,'staff_value','codex_local_candidate','${actor}',now());`);
    await scope.saveDailySheetDraft({ ...request, cells: [{ id: id(30), row_label: '待核姓名' }] }, { auth_account_id: actor });
    const labelOnly = captured[1].payload.p_cells[0];
    assert.equal(Object.hasOwn(labelOnly, 'value'), false, 'name-only review must never clear the number');
    sql(`select public.zysyr_save_daily_sheet_cells('${actor}','${company}','${store}','${draft}',
      ${q(JSON.stringify([labelOnly]))}::jsonb,'核对姓名');`);
    assert.equal(sql(`select row_label_source_method||'|'||manual_override from public.zysyr_daily_sheet_cells where id='${id(30)}'`), 'manual|false');
    assert.equal(sql(`select row_label_reviewed::text from public.zysyr_daily_sheet_cell_changes where cell_id='${id(30)}'`), 'true');
    assert.throws(() => sql(`select public.zysyr_save_daily_sheet_cells('${id(99)}','${company}','${store}','${draft}',
      ${q(JSON.stringify([labelOnly]))}::jsonb,'越权');`), /FINANCE_SCOPE_FORBIDDEN/);
    assert.equal(sql(`select has_function_privilege('authenticated','public.zysyr_save_daily_sheet_cells(uuid,uuid,uuid,uuid,jsonb,text)','execute')`), 'f');
    console.log('Daily atomic save: legacy 409 reproduced, merged save, unchanged name review, audit, source preservation and finance scope passed');
  } finally { docker(['stop', container]); }
}
run().catch(error => { console.error(error.stderr ? String(error.stderr) : error); process.exitCode = 1; });
