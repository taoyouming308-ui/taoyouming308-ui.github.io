// Isolated, disposable PostgreSQL only. Never connects to production.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const name = 'zysyr-income-test-' + process.pid + '-' + Date.now();
const docker = args => execFileSync('docker', args, { encoding: 'utf8' });
function sql(text) { return execFileSync('docker', ['exec', '-i', name, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input: text, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }).trim(); }
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0');
function expectFailure(text, pattern) { assert.throws(() => sql(text), error => pattern.test(String(error.stderr))); }
async function run() {
  docker(['run','--rm','-d','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:15']);
  try {
    for (let i=0;i<80;i++) { try { sql('select 1'); break; } catch { await new Promise(resolve => setTimeout(resolve, 500)); } }
    sql(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema zysyr_private;
      create table zysyr_companies(id uuid primary key);
      create table zysyr_stores(company_id uuid,id uuid,primary key(company_id,id));
      create table zysyr_user_accounts(company_id uuid,id uuid,primary key(company_id,id));
      create table zysyr_monthly_cell_unlock_requests(company_id uuid,id uuid,store_id uuid,period_month date,requested_by_user_id uuid,status text,decided_at timestamptz,consumed_at timestamptz,primary key(company_id,id));
      create table zysyr_history_ledger_entries(id uuid,company_id uuid,store_id uuid,period_month date,entry_type text,status text,import_batch_id uuid,current_payload jsonb,version integer);
      create table zysyr_report_uploads(id uuid,company_id uuid,store_id uuid,report_date date,report_type text,status text);
      create table zysyr_report_cells(id uuid,company_id uuid,store_id uuid,report_id uuid,cell_address text,label text,numeric_value numeric,cell_kind text);
      create table zysyr_monthly_cell_revisions(id uuid,company_id uuid,store_id uuid,report_id uuid,revision integer);
      create table zysyr_business_evidence_rules(id uuid primary key default gen_random_uuid(),company_id uuid,store_id uuid,business_type text,business_id uuid,evidence_policy text,reason text,updated_by_user_id uuid,updated_at timestamptz default now(),unique(company_id,store_id,business_type,business_id));
      create table zysyr_daily_sheet_drafts(id uuid,company_id uuid,store_id uuid);
      create table zysyr_audit_events(company_id uuid,store_id uuid,actor_type text,actor_user_id uuid,channel text,entity_type text,entity_id uuid,action text,before_json jsonb,after_json jsonb,reason text,sensitivity text);
      create function zysyr_private.assert_finance_scope(uuid,uuid,uuid,text) returns void language plpgsql as $$begin
        if $1<>'${id(3)}' or $2<>'${id(1)}' or $3<>'${id(2)}' then raise exception 'SCOPE_DENIED'; end if; end$$;
      create function zysyr_private.has_capability(uuid,uuid,text) returns boolean language sql as $$select $2::text=current_setting('test.store',true)$$;
      create function zysyr_private.period_is_locked(uuid,uuid,date) returns boolean language sql as $$select coalesce(current_setting('test.locked',true),'')='yes'$$;
      create function zysyr_private.protect_monthly_cell_history() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE'; end$$;
      create function zysyr_private.business_record_exists(uuid,uuid,text,uuid) returns boolean language sql as $$select false$$;
      insert into zysyr_companies values('${id(1)}');
      insert into zysyr_stores values('${id(1)}','${id(2)}');
      insert into zysyr_user_accounts values('${id(1)}','${id(3)}');
      insert into zysyr_history_ledger_entries values
        ('${id(4)}','${id(1)}','${id(2)}','2026-06-01','monthly_profit_loss','posted','${id(5)}','{"label":"主营 / 美发收入 / Nov.","cell_address":"C3","cell_kind":"formula","amount":100,"formula":"R28-S28"}',1),
        ('${id(6)}','${id(1)}','${id(2)}','2026-06-01','monthly_profit_loss','posted','${id(5)}','{"label":"房租","cell_address":"C10","amount":10}',1);
      insert into zysyr_report_uploads values('${id(7)}','${id(1)}','${id(2)}','2026-06-01','monthly_profit_loss','active');
      insert into zysyr_report_cells values('${id(8)}','${id(1)}','${id(2)}','${id(7)}','C3','主营 / 美发收入',100,'formula');
    `);
    sql(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260908060844_zysyr_monthly_income_adjustments.sql'),'utf8'));
    const versions = `'${JSON.stringify({[id(4)]:1,[id(6)]:1})}'::jsonb`;
    const adjustmentSnapshot = () => `(select coalesce(jsonb_object_agg(id::text,revision),'{}'::jsonb) from zysyr_monthly_income_adjustments)`;
    const call = ({source=id(4),kind='history',actor=id(3),store=id(2),before=100,after=120,base=100,adjustments="'{}'::jsonb",reason='月报修正',snapshot=versions}={}) => `select id from zysyr_save_monthly_income_adjustment('${actor}','${id(1)}','${store}','${kind}','${source}','2026-06-01',${snapshot},${adjustments},${base},${before},${after},'${reason}');`;
    expectFailure(call({actor:id(99)}), /SCOPE_DENIED/);
    expectFailure(call({store:id(99)}), /SCOPE_DENIED/);
    expectFailure(call({source:id(99)}), /SOURCE_NOT_FOUND/);
    expectFailure(call({source:id(6)}), /ONLY_INCOME/);
    expectFailure(call({reason:''}), /INVALID/);
    expectFailure(`set test.locked='yes';${call()}`, /UNLOCK_APPROVAL_REQUIRED/);
    sql(call());
    assert.equal(sql('select adjustment_delta from zysyr_monthly_income_adjustments'),'20.0000');
    assert.equal(sql(`select current_payload->>'amount' from zysyr_history_ledger_entries where id='${id(4)}'`),'100');
    assert.equal(sql('select count(*) from zysyr_audit_events'),'1');
    expectFailure(call(), /DATA_CHANGED_RELOAD/);
    expectFailure(call({before:120,after:130,snapshot:"'{}'::jsonb",adjustments:adjustmentSnapshot()}), /DATA_CHANGED_RELOAD/);
    sql(call({before:120,after:130,adjustments:adjustmentSnapshot()}));
    assert.equal(sql('select adjustment_delta from zysyr_monthly_income_adjustments order by revision desc limit 1'),'30.0000');
    expectFailure('update zysyr_monthly_income_adjustments set reason=\'erase\';', /IMMUTABLE/);
    expectFailure('delete from zysyr_monthly_income_adjustments;', /IMMUTABLE/);
    expectFailure('set role anon;select * from zysyr_monthly_income_adjustments;', /permission denied/);
    expectFailure('set role authenticated;' + call(), /permission denied/);
    sql('grant usage on schema zysyr_private to authenticated; grant execute on function zysyr_private.has_capability(uuid,uuid,text) to authenticated;');
    assert.equal(sql(`set role authenticated;set test.store='${id(99)}';select count(*) from zysyr_monthly_income_adjustments;`).split('\n').at(-1),'0');
    assert.equal(sql(`set role authenticated;set test.store='${id(2)}';select count(*) from zysyr_monthly_income_adjustments;`).split('\n').at(-1),'2');
    sql(call({kind:'report',source:id(8),snapshot:"'{}'::jsonb",adjustments:adjustmentSnapshot()}));
    sql(`insert into zysyr_monthly_cell_unlock_requests(company_id,id,store_id,period_month,requested_by_user_id,status,decided_at) values('${id(1)}','${id(9)}','${id(2)}','2026-06-01','${id(3)}','approved',now());`);
    sql(`set test.locked='yes';${call({before:130,after:100,adjustments:adjustmentSnapshot()})}`);
    assert.equal(sql(`select status from zysyr_monthly_cell_unlock_requests where id='${id(9)}'`),'consumed');
    expectFailure(`set test.locked='yes';${call({before:100,after:101,adjustments:adjustmentSnapshot()})}`, /UNLOCK_APPROVAL_REQUIRED/);
    assert.equal(sql('select count(*) from zysyr_monthly_income_adjustments'),'4');
    const workspaceMigration = fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260908153000_zysyr_monthly_finance_workspace_adjustments.sql'),'utf8');
    sql(workspaceMigration.slice(0, workspaceMigration.indexOf('-- A formula can still represent')));
    sql(`insert into zysyr_history_ledger_entries values
      ('${id(10)}','${id(1)}','${id(2)}','2026-06-01','monthly_profit_loss','posted','${id(5)}','{"label":"人工 / 技术人员","cell_address":"C20","cell_kind":"formula","amount":80,"formula":"N23"}',1),
      ('${id(11)}','${id(1)}','${id(2)}','2026-06-01','monthly_profit_loss','posted','${id(5)}','{"label":"财务费用 / 银/支/微/团手续费","cell_address":"C27","cell_kind":"formula","amount":20,"formula":"10+10"}',1),
      ('${id(12)}','${id(1)}','${id(2)}','2026-06-01','monthly_profit_loss','posted','${id(5)}','{"label":"产品成本 / 产品进货","cell_address":"C31","cell_kind":"formula","amount":50,"formula":"G43"}',1),
      ('${id(13)}','${id(1)}','${id(2)}','2026-06-01','monthly_profit_loss','posted','${id(5)}','{"label":"小计 / Nov.","cell_address":"C30","cell_kind":"formula","amount":20,"formula":"SUM(C25:C29)"}',1);`);
    const currentVersions = `(select coalesce(jsonb_object_agg(id::text,version),'{}'::jsonb) from zysyr_history_ledger_entries where company_id='${id(1)}' and store_id='${id(2)}' and period_month='2026-06-01' and entry_type='monthly_profit_loss' and status='posted')`;
    sql(call({source:id(10),before:80,after:85,base:80,snapshot:currentVersions,adjustments:adjustmentSnapshot()}));
    sql(call({source:id(11),before:20,after:22,base:20,snapshot:currentVersions,adjustments:adjustmentSnapshot()}));
    expectFailure(call({source:id(12),before:50,after:55,base:50,snapshot:currentVersions,adjustments:adjustmentSnapshot()}), /TARGET_READ_ONLY/);
    expectFailure(call({source:id(13),before:20,after:25,base:20,snapshot:currentVersions,adjustments:adjustmentSnapshot()}), /TARGET_READ_ONLY/);
    assert.equal(sql('select count(*) from zysyr_monthly_income_adjustments'),'6');
    assert.equal(sql("select count(*) from zysyr_audit_events where entity_type='monthly_value_adjustment'"),'2');
    sql(workspaceMigration.slice(workspaceMigration.indexOf('-- A formula can still represent')));
    sql(`insert into zysyr_report_cells values
      ('${id(14)}','${id(1)}','${id(2)}','${id(7)}','C27','财务费用 / 银/支/微/团手续费',20,'formula'),
      ('${id(15)}','${id(1)}','${id(2)}','${id(7)}','C30','小计 / Nov.',20,'formula');`);
    sql(`select id from zysyr_save_business_evidence_rule('${id(3)}','${id(1)}','${id(2)}','report_cell','${id(14)}',false,'此笔无需凭证');`);
    assert.equal(sql(`select evidence_policy from zysyr_business_evidence_rules where business_id='${id(14)}'`),'none');
    expectFailure(`select id from zysyr_save_business_evidence_rule('${id(3)}','${id(1)}','${id(2)}','report_cell','${id(15)}',false,'错误关闭小计凭证');`, /RECORD_NOT_FOUND/);
    sql(`alter table zysyr_daily_sheet_drafts add column report_date date, add column edit_revision integer,
      add column status text, add column source_voucher_id uuid, add column validation_result jsonb default '{}'::jsonb,
      add column ocr_provider text, add column ocr_model text, add column updated_by_user_id uuid, add column updated_at timestamptz;
      create table zysyr_voucher_attachments(id uuid,company_id uuid,store_id uuid,audit_status text,document_type text,primary key(company_id,store_id,id));
      create table zysyr_daily_sheet_attachments(company_id uuid,store_id uuid,draft_id uuid,voucher_id uuid,attachment_kind text);
      create table zysyr_daily_sheet_cells(id uuid,company_id uuid,store_id uuid,draft_id uuid,cell_role text,
        ocr_numeric numeric,ocr_text text,corrected_numeric numeric,manual_override boolean default false,
        confidence numeric,source_method text,bbox jsonb,updated_by_user_id uuid,updated_at timestamptz,
        constraint zysyr_daily_sheet_cells_source_method_check check(source_method in ('openai_vision','kimi_vision','paddle_ocr','blank_template')),
        primary key(company_id,store_id,id));
      create function zysyr_private.daily_sheet_cell_value(zysyr_daily_sheet_cells) returns numeric language sql as $$select case when $1.manual_override then $1.corrected_numeric else $1.ocr_numeric end$$;
      create function zysyr_private.daily_sheet_validation(uuid,uuid,uuid) returns jsonb language sql as $$select jsonb_build_object('valid',true,'grand_total',coalesce(sum(zysyr_private.daily_sheet_cell_value(c)),0)) from public.zysyr_daily_sheet_cells c where c.company_id=$1 and c.store_id=$2 and c.draft_id=$3$$;`);
    sql(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260908094822_daily_rollup_adjustment_snapshot.sql'),'utf8'));
    sql(`insert into zysyr_daily_sheet_drafts(id,company_id,store_id,report_date,edit_revision,status) values('${id(30)}','${id(1)}','${id(2)}','2026-06-01',1,'confirmed');`);
    const linked = snapshot => `select id from zysyr_save_daily_linked_monthly_adjustment('${id(3)}','${id(1)}','${id(2)}','history','${id(10)}','2026-06-01',${currentVersions},${adjustmentSnapshot()},80,85,90,'日报快照测试',${snapshot});`;
    expectFailure(linked("'{}'::jsonb"),/DATA_CHANGED_RELOAD/);
    sql(linked(`'{"${id(30)}":1}'::jsonb`));
    expectFailure('set role authenticated;'+linked(`'{"${id(30)}":1}'::jsonb`),/permission denied/);
    sql(`insert into zysyr_voucher_attachments values('${id(31)}','${id(1)}','${id(2)}','approved','daily_report');
      insert into zysyr_daily_sheet_drafts(id,company_id,store_id,report_date,edit_revision,status,source_voucher_id,updated_by_user_id)
      values('${id(32)}','${id(1)}','${id(2)}','2026-06-02',0,'draft','${id(31)}','${id(3)}');
      insert into zysyr_daily_sheet_cells(id,company_id,store_id,draft_id,cell_role,source_method,updated_by_user_id)
      values('${id(33)}','${id(1)}','${id(2)}','${id(32)}','staff_value','blank_template','${id(3)}'),
        ('${id(34)}','${id(1)}','${id(2)}','${id(32)}','staff_value','blank_template','${id(3)}');
      update zysyr_daily_sheet_cells set corrected_numeric=20,manual_override=true where id='${id(34)}';`);
    const recognize=`select zysyr_apply_daily_sheet_recognition_candidates('${id(3)}','${id(1)}','${id(2)}','${id(32)}','${id(31)}',0,
      '[{"id":"${id(33)}","value":10,"confidence":0.9},{"id":"${id(34)}","value":99,"confidence":1}]','kimi-k2.6');`;
    sql(recognize);
    assert.equal(sql(`select ocr_numeric from zysyr_daily_sheet_cells where id='${id(33)}'`),'10');
    assert.equal(sql(`select corrected_numeric from zysyr_daily_sheet_cells where id='${id(34)}'`),'20');
    assert.equal(sql(`select edit_revision from zysyr_daily_sheet_drafts where id='${id(32)}'`),'1');
    expectFailure(recognize,/CHANGED_RELOAD/);
    expectFailure(`set role authenticated;${recognize}`,/permission denied/);
    console.log('PostgreSQL: source preservation, audit, locks, RLS, daily snapshot stale rejection and role denial passed');
  } finally { docker(['stop',name]); }
}
run().catch(error => { console.error(error.stderr ? String(error.stderr) : error); process.exitCode=1; });
