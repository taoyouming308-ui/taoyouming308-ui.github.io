// Disposable PostgreSQL fixture only; never connects to production.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const name = `zysyr-stylist-subtotal-${process.pid}-${Date.now()}`;
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const docker = args => execFileSync('docker', args, { encoding: 'utf8' });
const sql = query => execFileSync('docker', ['exec', '-i', name, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], {
  input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
}).trim();

async function run() {
  docker(['run', '--rm', '-d', '--network', 'none', '--name', name, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17']);
  try {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      try { sql('select 1'); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 500)); }
    }
    sql(`
      create role anon; create role authenticated; create role service_role;
      create schema zysyr_private;
      create table public.zysyr_daily_sheet_drafts(id uuid primary key, company_id uuid, store_id uuid, status text not null default 'confirmed', report_date date not null default '2026-01-01');
      create table public.zysyr_daily_sheet_cells(
        company_id uuid, store_id uuid, draft_id uuid, section_code text, row_key text,
        column_code text, cell_role text, ocr_numeric numeric, corrected_numeric numeric,
        manual_override boolean not null default false
      );
      create function zysyr_private.daily_sheet_cell_value(public.zysyr_daily_sheet_cells)
        returns numeric language sql immutable as $$
        select case when $1.manual_override then $1.corrected_numeric else $1.ocr_numeric end
      $$;
      insert into public.zysyr_daily_sheet_drafts values ('${id(1)}','${id(2)}','${id(3)}');
      insert into public.zysyr_daily_sheet_cells(company_id,store_id,draft_id,section_code,row_key,column_code,cell_role,ocr_numeric)
      values
        ('${id(2)}','${id(3)}','${id(1)}','stylist','stylist_1','wash_cut_blow','staff_value',11357),
        ('${id(2)}','${id(3)}','${id(1)}','stylist','stylist_1','subtotal','staff_total',11357),
        ('${id(2)}','${id(3)}','${id(1)}','stylist','stylist_category_total','wash_cut_blow','category_total',11357),
        ('${id(2)}','${id(3)}','${id(1)}','stylist','stylist_category_total','subtotal','summary_value',1357),
        ('${id(2)}','${id(3)}','${id(1)}','summary','summary','actual_total','summary_actual',11357),
        ('${id(2)}','${id(3)}','${id(1)}','summary','summary','grand_total','summary_grand',11357),
        ('${id(2)}','${id(3)}','${id(1)}','payment','payment','cash','payment_method',11357),
        ('${id(2)}','${id(3)}','${id(1)}','payment','payment','cash_flow','payment_cashflow',11357),
        ('${id(2)}','${id(3)}','${id(1)}','payment','payment','card_consumption','payment_card_consumption',0),
        ('${id(2)}','${id(3)}','${id(1)}','payment','payment','total','payment_total',11357);
    `);
    const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260923105746_zysyr_daily_stylist_subtotal_validation.sql'), 'utf8');
    sql(migration);
    const historicalReviewMigration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260923203352_daily_confirmed_validation_review.sql'), 'utf8');
    sql(historicalReviewMigration);
    const validate = `select zysyr_private.daily_sheet_validation('${id(2)}','${id(3)}','${id(1)}')`;
    let result = JSON.parse(sql(validate));
    assert.equal(result.valid, false, 'incorrect section subtotal must block posting');
    assert.equal(result.stylist_subtotal_mismatch, true);
    assert.equal(result.staff_atomic_total, 11357);
    assert.equal(result.stylist_subtotal, 1357);
    const reviewOutput = sql(`set role service_role; select row_to_json(review)::text from public.zysyr_admin_current_daily_sheet_validation('${id(2)}','${id(3)}',array['${id(1)}']::uuid[]) as review`);
    const reviewRow = JSON.parse(reviewOutput.split('\n').at(-1));
    assert.equal(reviewRow.draft_id, id(1));
    assert.equal(reviewRow.current_validation.valid, false, 'calendar revalidation must expose current mismatch');
    assert.equal(reviewRow.current_validation.stylist_subtotal, 1357);
    assert.equal(sql(`select ocr_numeric from public.zysyr_daily_sheet_cells where row_key='stylist_category_total' and column_code='subtotal'`), '1357', 'review RPC must not change historical amounts');
    assert.equal(sql(`set role service_role; select count(*) from public.zysyr_admin_current_daily_sheet_validation('${id(2)}','${id(4)}',array['${id(1)}']::uuid[])`), 'SET\n0', 'the batch RPC must preserve company/store scoping');
    assert.throws(() => sql(`set role anon; select * from public.zysyr_admin_current_daily_sheet_validation('${id(2)}','${id(3)}',array['${id(1)}']::uuid[])`), error => /permission denied/.test(String(error.stderr)), 'anonymous users cannot invoke the revalidation RPC');
    assert.throws(() => sql(`select * from public.zysyr_admin_current_daily_sheet_validation('${id(2)}','${id(3)}',array_fill('${id(1)}'::uuid,array[101]))`), error => /DAILY_VALIDATION_BATCH_TOO_LARGE/.test(String(error.stderr)), 'batch size must be bounded');
    sql("update public.zysyr_daily_sheet_cells set ocr_numeric=11357 where row_key='stylist_category_total' and column_code='subtotal'");
    result = JSON.parse(sql(validate));
    assert.equal(result.valid, true, 'corrected section subtotal must pass');
    sql("update public.zysyr_daily_sheet_cells set ocr_numeric=null where row_key='stylist_category_total' and column_code='subtotal'");
    result = JSON.parse(sql(validate));
    assert.equal(result.valid, false, 'blank section subtotal must block posting');
    assert.ok(result.missing_controls.includes('造型区总小计'));
    assert.throws(() => sql(`set role authenticated; ${validate}`), error => /permission denied/.test(String(error.stderr)));
    console.log('ZYSYR daily stylist subtotal SQL: mismatch, correction, blank and role denial passed');
  } finally {
    docker(['stop', name]);
  }
}

run().catch(error => { console.error(error.stderr ? String(error.stderr) : error); process.exitCode = 1; });
