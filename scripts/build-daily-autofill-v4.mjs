// Offline only: emits apply_patch; never applies a migration or connects to DB.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const file='supabase/migrations/20260928141730_zysyr_daily_cash_candidate_v4.sql';
const base=fs.readFileSync('supabase/migrations/20260927173455_zysyr_daily_electronic_source_candidates.sql','utf8');
const scopes="'projects_daily_summary','all_business_daily_summary'";
const newScopes=scopes+",'operating_daily_summary','card_sales_daily_summary'";
let summary=base.slice(base.indexOf('create function zysyr_daily_electronic_private.daily_electronic_summary_candidate('),base.indexOf('-- Service-only capability boundary.'));
summary=summary.replace('create function','create or replace function').replaceAll(scopes,newScopes)
 .replace("then '[\"1\"]'::jsonb else", "then '[\"1\"]'::jsonb when p_source_scope='operating_daily_summary' then '[\"1\",\"2\"]'::jsonb when p_source_scope='card_sales_daily_summary' then '[\"3\",\"4\",\"5\"]'::jsonb else");
let reader=base.slice(base.indexOf('create function zysyr_daily_electronic_private.read_daily_electronic_source('),base.indexOf('create function public.zysyr_read_daily_electronic_source('));
reader=reader.replace('create function','create or replace function').replaceAll(scopes,newScopes);
let writer=fs.readFileSync('supabase/migrations/20260928094856_zysyr_daily_autofill_cash_evidence_v3.sql','utf8');
writer=writer.slice(writer.indexOf('create or replace function public.mgj_autofill_daily_sheet'));
writer=writer.replace('source jsonb; cells jsonb;','source jsonb; cash_projection jsonb; cells jsonb;')
 .replace(" sid:=(source->>'snapshot_id')::uuid;", " sid:=(source->>'snapshot_id')::uuid;\n cash_projection:=zysyr_daily_electronic_private.cash_receipt_projection(company,store,p_day);")
 .replaceAll('frontdesk-autofill-v3','frontdesk-autofill-v4')
 .replace("='frontdesk-autofill-v4'\n then", "='frontdesk-autofill-v4'\n  and draft.ocr_raw_result#>'{autofill,cash_receipts}' is not distinct from cash_projection->'metadata'\n then")
 .replace(' cells:=zysyr_daily_electronic_private.autofill_cells(source);',` cells:=zysyr_daily_electronic_private.autofill_cells(source);
 -- One writer, one immutable before/after event. Replacement by exact cell key
 -- avoids two projections double-counting project payment channels.
 if cash_projection->'available'='true'::jsonb then
  select coalesce(jsonb_agg(x),'[]'::jsonb) into cells from jsonb_array_elements(cells)x
   where not exists(select 1 from jsonb_array_elements(cash_projection->'cells')c
    where c->>'section_code'=x->>'section_code' and c->>'row_key'=x->>'row_key' and c->>'column_code'=x->>'column_code');
  cells:=cells||(cash_projection->'cells');
 end if;`)
 .replace(" gaps:=gaps||'[", " gaps:=gaps||coalesce(cash_projection->'gaps','[]'::jsonb);\n gaps:=gaps||'[")
 .replace("'known_absence_display','blank',", "'known_absence_display','blank','cash_receipts',cash_projection->'metadata',");
assert(writer.includes("'cash_receipts',cash_projection->'metadata'"));
const projection=`create function zysyr_daily_electronic_private.cash_receipt_projection(p_company uuid,p_store uuid,p_day date)
returns jsonb language plpgsql stable set search_path='' as $$
declare
 op public.zysyr_daily_electronic_snapshots; allsrc public.zysyr_daily_electronic_snapshots; cardsrc public.zysyr_daily_electronic_snapshots;
 op_time timestamptz; all_time timestamptz; card_time timestamptz; op_view jsonb; all_view jsonb; card_view jsonb;
 op_row jsonb; all_row jsonb; op_cash bigint; all_cash bigint; new_cards bigint;
 cells jsonb:='[]'; gaps jsonb:='["source_shop_not_echoed","financial_review_required"]';
 metadata jsonb; i int; n bigint; section text; code text; label text; role_code text; col int;
begin
 perform zysyr_daily_electronic_private.daily_electronic_shop(p_company,p_store);
 select s.* into op from public.zysyr_daily_electronic_heads h
  join public.zysyr_daily_electronic_snapshots s on s.id=h.snapshot_id
  where h.company_id=p_company and h.store_id=p_store and h.business_date=p_day and h.source_scope='operating_daily_summary';
 select h.latest_fetched_at into op_time from public.zysyr_daily_electronic_heads h
  where h.company_id=p_company and h.store_id=p_store and h.business_date=p_day and h.source_scope='operating_daily_summary';
 select s.* into allsrc from public.zysyr_daily_electronic_heads h
  join public.zysyr_daily_electronic_snapshots s on s.id=h.snapshot_id
  where h.company_id=p_company and h.store_id=p_store and h.business_date=p_day and h.source_scope='all_business_daily_summary';
 select h.latest_fetched_at into all_time from public.zysyr_daily_electronic_heads h
  where h.company_id=p_company and h.store_id=p_store and h.business_date=p_day and h.source_scope='all_business_daily_summary';
 select s.* into cardsrc from public.zysyr_daily_electronic_heads h
  join public.zysyr_daily_electronic_snapshots s on s.id=h.snapshot_id
  where h.company_id=p_company and h.store_id=p_store and h.business_date=p_day and h.source_scope='card_sales_daily_summary';
 select h.latest_fetched_at into card_time from public.zysyr_daily_electronic_heads h
  where h.company_id=p_company and h.store_id=p_store and h.business_date=p_day and h.source_scope='card_sales_daily_summary';
 metadata:=jsonb_build_object('policy','operating-external-cash-v1','state','unavailable',
  'operating_snapshot_id',op.id,'operating_sha256',op.source_sha256,
  'all_snapshot_id',allsrc.id,'all_sha256',allsrc.source_sha256,'card_sales_snapshot_id',cardsrc.id,'card_sales_sha256',cardsrc.source_sha256);
 if op.id is null or allsrc.id is null or cardsrc.id is null then
  return jsonb_build_object('available',false,'cells','[]'::jsonb,'metadata',metadata,'gaps','["cash_source_missing"]'::jsonb);
 end if;
 -- Use current head watermarks, not the original creation time of a reused
 -- identical immutable snapshot. No invented freshness or source verification.
 if extract(epoch from greatest(op_time,all_time,card_time)-least(op_time,all_time,card_time))>120 or
  (p_day=(now() at time zone 'Asia/Shanghai')::date and least(op_time,all_time,card_time)<now()-interval '30 minutes') then
  return jsonb_build_object('available',false,'cells','[]'::jsonb,'metadata',metadata,'gaps','["cash_source_pair_stale"]'::jsonb);
 end if;
 op_view:=zysyr_daily_electronic_private.daily_electronic_summary_candidate(p_company,p_store,p_day,'operating_daily_summary',op.source_payload);
 all_view:=zysyr_daily_electronic_private.daily_electronic_summary_candidate(p_company,p_store,p_day,'all_business_daily_summary',allsrc.source_payload);
 card_view:=zysyr_daily_electronic_private.daily_electronic_summary_candidate(p_company,p_store,p_day,'card_sales_daily_summary',cardsrc.source_payload);
 if exists(select 1 from jsonb_array_elements(op_view->'controls')x where x->>'group'='cash' and x->'matched'='false'::jsonb)
  or exists(select 1 from jsonb_array_elements(all_view->'controls')x where x->>'group'='cash' and x->'matched'='false'::jsonb)
  or exists(select 1 from jsonb_array_elements(card_view->'controls')x where x->>'group'='cash' and x->'matched'='false'::jsonb) then
  return jsonb_build_object('available',false,'cells','[]'::jsonb,'metadata',metadata,'gaps','["cash_source_group_mismatch"]'::jsonb);
 end if;
 op_row:=op.source_payload#>'{content,data,0}'; all_row:=allsrc.source_payload#>'{content,data,0}';
 for i in 1..10 loop
  if zysyr_daily_electronic_private.daily_electronic_cents(op_row->i)>zysyr_daily_electronic_private.daily_electronic_cents(all_row->i) then
   return jsonb_build_object('available',false,'cells','[]'::jsonb,'metadata',metadata,'gaps','["cash_source_pair_decreasing"]'::jsonb);
  end if;
 end loop;
 op_cash:=(op_view->>'cash_total_reference_cents')::bigint; all_cash:=(all_view->>'cash_total_reference_cents')::bigint;
 new_cards:=(card_view->>'cash_total_reference_cents')::bigint;
 -- Never infer card sales by subtraction: an intervening PROJECT receipt can
 -- change the all-business total. Independent source closure must agree.
 if op_cash is not null and all_cash is not null and new_cards is not null and op_cash+new_cards<>all_cash then
  return jsonb_build_object('available',false,'cells','[]'::jsonb,'metadata',metadata,'gaps','["cash_source_partition_mismatch"]'::jsonb);
 end if;
 if op_cash is null or all_cash is null or new_cards is null then gaps:=gaps||'["cash_total_unknown"]'::jsonb; end if;
 if exists(select 1 from jsonb_array_elements(op_view->'cells')x where x->>'section_code'='source_cash' and x->>'value_cents' is null) then
  gaps:=gaps||'["cash_channels_unknown"]'::jsonb;
 end if;
 foreach i in array array[3,7,8,9] loop
  if zysyr_daily_electronic_private.daily_electronic_cents(op_row->i)>0 then gaps:=gaps||'["unmapped_external_cash_channel"]'::jsonb; exit; end if;
 end loop;
 if new_cards>0 then gaps:=gaps||'["card_sales_category_split_unavailable"]'::jsonb; end if;
 for i in 1..10 loop
  section:=case when i<=3 then 'summary' else 'payment' end;
  code:=(array['actual_total','card_subtotal','grand_total','cash_flow','total','cash','alipay','wechat','group_buy','douyin'])[i];
  label:=(array['实做','卡类小计','总计','现金流','总计','现金','支付宝','微信','团购','抖音'])[i];
  role_code:=(array['summary_actual','summary_value','summary_grand','payment_cashflow','payment_total','payment_method','payment_method','payment_method','payment_method','payment_method'])[i];
  col:=(array[5,9,10,10,12,1,6,7,9,8])[i];
  n:=case i when 1 then op_cash when 2 then new_cards when 3 then all_cash when 4 then op_cash when 5 then all_cash
   else zysyr_daily_electronic_private.daily_electronic_cents(op_row->((array[0,0,0,0,0,2,4,5,6,10])[i])) end;
  cells:=cells||jsonb_build_array(jsonb_build_object('section_code',section,'row_key',section,
   'row_label',case when section='summary' then '汇总' else '支付' end,'column_code',code,'column_label',label,
   'row_number',case when section='summary' then 30 else 33 end,'column_number',col,'cell_role',role_code,'value',n::numeric/100));
 end loop;
 metadata:=metadata||jsonb_build_object('state','candidate','scope_verified',false,'scope_verification','request_only',
  'operating_fetched_at',op_time,'all_fetched_at',all_time,'card_sales_fetched_at',card_time,
  'cash_channels_complete',not (gaps ? 'cash_channels_unknown' or gaps ? 'unmapped_external_cash_channel'),
  'automatic_posting_allowed',false,'new_card_cash_formula','direct_card_sales_external_cash');
 return jsonb_build_object('available',true,'cells',cells,'gaps',gaps,'metadata',metadata);
end $$;
revoke all on function zysyr_daily_electronic_private.cash_receipt_projection(uuid,uuid,date) from public,anon,authenticated,service_role;
`;
// Source events are append-only; a failed optional projection must not roll back
// accepted evidence. Both-head pairing is checked by the same scoped writer.
const trigger=`create function zysyr_daily_electronic_private.cash_source_autofill_trigger()
returns trigger language plpgsql security definer set search_path='' as $$
declare shop text; projection jsonb; result jsonb; detail_sid uuid;
begin
 if new.source_scope not in('operating_daily_summary','all_business_daily_summary','card_sales_daily_summary') then return new; end if;
 shop:=case new.store_id when 'ea7e281f-a254-4664-bb03-cf1acf48d79d'::uuid then '自由手艺人'
  when '8d057980-ff8f-4b2c-9c7f-4dd23a568f35'::uuid then '向里造型' end;
 begin
  projection:=zysyr_daily_electronic_private.cash_receipt_projection(new.company_id,new.store_id,new.business_date);
  if projection->'available'='true'::jsonb then
   result:=public.mgj_autofill_daily_sheet(shop,new.business_date);
  end if;
 exception when others then
   select h.snapshot_id into detail_sid from public.mgj_business_detail_heads h where h.shop_name=shop and h.business_date=new.business_date;
   if detail_sid is not null then
    insert into public.zysyr_daily_autofill_status(shop_name,business_date,snapshot_id,result)
     values(shop,new.business_date,detail_sid,jsonb_build_object('status','cash_projection_failed','automatic_posting_enabled',false))
     on conflict(shop_name,business_date) do update set snapshot_id=excluded.snapshot_id,result=excluded.result,updated_at=now();
   else
    -- Status FK must refer to a BUSINESS snapshot, never substitute a summary
    -- snapshot or fabricate an identity. Safe operational log if none exists.
    raise log 'ZYSYR_CASH_PROJECTION_FAILED: % %',shop,new.business_date;
   end if;
 end;
 return new;
end $$;
revoke all on function zysyr_daily_electronic_private.cash_source_autofill_trigger() from public,anon,authenticated,service_role;
create trigger zysyr_cash_source_autofill after insert or update on public.zysyr_daily_electronic_heads
 for each row execute function zysyr_daily_electronic_private.cash_source_autofill_trigger();
`;
let validation=fs.readFileSync('supabase/migrations/20260923105746_zysyr_daily_stylist_subtotal_validation.sql','utf8');
validation=validation.replace('  v_valid boolean;', `  v_valid boolean;
  v_cash_mode boolean:=false; v_card_sales numeric; v_cash_metadata jsonb; v_cash_source_current boolean:=false;`)
 .replace('  select coalesce(sum(zysyr_private.daily_sheet_cell_value(cell)), 0),', `  select draft.ocr_raw_result#>'{autofill,cash_receipts}' into v_cash_metadata
  from public.zysyr_daily_sheet_drafts draft where draft.company_id=p_company_id and draft.store_id=p_store_id and draft.id=p_draft_id;
  v_cash_mode:=coalesce(v_cash_metadata->>'policy'='operating-external-cash-v1' and v_cash_metadata->>'state'='candidate',false);
  if v_cash_mode then
    select zysyr_private.daily_sheet_cell_value(cell) into v_card_sales
    from public.zysyr_daily_sheet_cells cell where cell.company_id=p_company_id and cell.store_id=p_store_id and cell.draft_id=p_draft_id
      and cell.section_code='summary' and cell.row_key='summary' and cell.column_code='card_subtotal';
    v_cash_source_current:=exists(select 1 from public.zysyr_daily_sheet_drafts d where d.id=p_draft_id and d.company_id=p_company_id and d.store_id=p_store_id and d.status='confirmed')
      or v_cash_metadata is not distinct from (zysyr_daily_electronic_private.cash_receipt_projection(p_company_id,p_store_id,
        (select report_date from public.zysyr_daily_sheet_drafts where id=p_draft_id and company_id=p_company_id and store_id=p_store_id))->'metadata');
  end if;

  select coalesce(sum(zysyr_private.daily_sheet_cell_value(cell)), 0),`)
 .replace('  v_valid := cardinality', `  if v_cash_mode and v_card_sales is null then v_missing_controls:=array_append(v_missing_controls,'卡类新收款小计'); end if;
  if v_cash_mode and (not v_cash_source_current or v_cash_metadata->'cash_channels_complete' is distinct from 'true'::jsonb) then
    v_missing_controls:=array_append(v_missing_controls,'现金收款来源核对');
  end if;
  v_valid := cardinality`)
 .replace(`    and abs(v_staff_atomic - v_actual) <= 0.01
    and abs(v_staff_atomic - v_grand) <= 0.01
    and abs(v_payment_methods - v_cashflow) <= 0.01
    and abs(v_cashflow + v_card_consumption - v_payment_total) <= 0.01
    and abs(v_staff_atomic - v_payment_total) <= 0.01;`, `    and abs(v_payment_methods - v_cashflow) <= 0.01
    and (case when v_cash_mode then
      abs(v_actual-v_cashflow)<=0.01 and abs(v_actual+v_card_sales-v_grand)<=0.01
      and abs(v_grand-v_payment_total)<=0.01
    else abs(v_staff_atomic-v_actual)<=0.01 and abs(v_staff_atomic-v_grand)<=0.01
      and abs(v_cashflow+v_card_consumption-v_payment_total)<=0.01 and abs(v_staff_atomic-v_payment_total)<=0.01 end);`)
 .replace("'income_source', 'nonzero_stylist_atomic_cells_only'", "'cash_policy',case when v_cash_mode then 'operating-external-cash-v1' else null end,\n    'income_source',case when v_cash_mode then 'operating_external_cash_receipts' else 'nonzero_stylist_atomic_cells_only' end");
assert(validation.includes('abs(v_actual+v_card_sales-v_grand)'));
const result=`-- PREPARED ONLY: unposted cash-receipt candidates, never automatic posting.
-- Apply only after explicit review, baseline backup and finance release gates.
set statement_timeout='30s';
set lock_timeout='5s';
alter table public.zysyr_daily_electronic_snapshots drop constraint zysyr_daily_electronic_snapshots_source_scope_check;
alter table public.zysyr_daily_electronic_snapshots add constraint zysyr_daily_electronic_snapshots_source_scope_check check(source_scope in(${newScopes}));
${summary}
${reader}
${projection}
alter table public.zysyr_daily_autofill_events drop constraint zysyr_daily_autofill_events_mapping_version_check;
alter table public.zysyr_daily_autofill_events add constraint zysyr_daily_autofill_events_mapping_version_check
 check(mapping_version in('frontdesk-autofill-v1','frontdesk-autofill-v2','frontdesk-autofill-v3','frontdesk-autofill-v4'));
${writer}
${trigger}
${validation}`;
if(process.argv.includes('--check')){assert.equal(fs.readFileSync(file,'utf8'),result);console.log('v4 matches scoped candidate generator');}
else{
 const current=fs.readFileSync(file,'utf8');
 if(!process.argv.includes('--patch'))assert.equal(current.trim(),'');
 const removed=current.trimEnd()?current.trimEnd().split('\n').map(l=>'-'+l).join('\n')+'\n':'';
 console.log('*** Begin Patch\n*** Update File: '+process.cwd()+'/'+file+'\n@@\n'+removed+result.trimEnd().split('\n').map(l=>'+'+l).join('\n')+'\n*** End Patch');
}
