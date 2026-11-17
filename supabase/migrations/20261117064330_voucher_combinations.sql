-- Additive, service-only wrappers. Existing writers retain their scope and audit checks.
set lock_timeout = '5s';
set statement_timeout = '30s';
create function public.zysyr_save_expense_voucher_combination(
 p_actor uuid,p_company uuid,p_store uuid,p_month date,p_matches jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb; n integer; v_kind text; v_target text; total numeric; goal numeric;
 fresh jsonb; saved jsonb; group_id uuid:=gen_random_uuid();
begin
 perform zysyr_private.assert_finance_scope(p_actor,p_company,p_store,'expense.create_submit');
 if jsonb_typeof(p_matches) is distinct from 'array' or jsonb_array_length(p_matches) not between 2 and 20
   or p_month is null or extract(day from p_month)<>1 then raise exception 'VOUCHER_COMBINATION_INVALID';end if;
 v_kind:=p_matches->0->>'target_kind';v_target:=p_matches->0->>'target_id';
 goal:=(p_matches->0->'target_snapshot'->>'amount')::numeric;
 if goal is null or goal<=0 or goal::text in ('NaN','Infinity','-Infinity') or goal<>round(goal,2) then raise exception 'VOUCHER_COMBINATION_AMOUNT_REQUIRED';end if;
 if (select count(distinct value->>'voucher_id') from jsonb_array_elements(p_matches))<>jsonb_array_length(p_matches)
   or exists(select 1 from jsonb_array_elements(p_matches) x where x->>'target_kind' is distinct from v_kind or x->>'target_id' is distinct from v_target
     or (x->'target_snapshot'->>'amount')::numeric is distinct from goal
     or x->'corrected_fields'->>'evidence_kind' is distinct from 'transaction'
     or coalesce((x->'corrected_fields'->>'amount')::numeric,0)<=0
     or (x->'corrected_fields'->>'amount')::numeric::text in ('NaN','Infinity','-Infinity')
     or (x->'corrected_fields'->>'amount')::numeric<>round((x->'corrected_fields'->>'amount')::numeric,2)) then raise exception 'VOUCHER_COMBINATION_INVALID';end if;
 select sum((value->'corrected_fields'->>'amount')::numeric) into total from jsonb_array_elements(p_matches);
 if total is distinct from goal then raise exception 'VOUCHER_COMBINATION_SUM_MISMATCH';end if;
 -- Stable lock order prevents competing claims from leaving a half-saved group.
 perform id from public.zysyr_voucher_attachments where company_id=p_company and store_id=p_store
   and id in (select (value->>'voucher_id')::uuid from jsonb_array_elements(p_matches)) order by id for update;
 select count(*) into n from public.zysyr_voucher_attachments where company_id=p_company and store_id=p_store
   and id in (select (value->>'voucher_id')::uuid from jsonb_array_elements(p_matches));
 if n<>jsonb_array_length(p_matches) then raise exception 'VOUCHER_COMBINATION_SCOPE_CHANGED';end if;
 for r in select value from jsonb_array_elements(p_matches) loop
   if exists(select 1 from public.zysyr_expense_voucher_matches m where m.company_id=p_company and m.store_id=p_store and m.voucher_id=(r->>'voucher_id')::uuid
     and m.component_index=(r->>'component_index')::int and m.status='active' and (m.period_month<>p_month or m.target_kind is distinct from v_kind
       or m.target_id is distinct from v_target or (m.corrected_fields->>'amount')::numeric is distinct from (r->'corrected_fields'->>'amount')::numeric))
     then raise exception 'VOUCHER_COMBINATION_CLAIM_CHANGED';end if;
 end loop;
 select coalesce(jsonb_agg(x),'[]'::jsonb) into fresh from jsonb_array_elements(p_matches) x where not exists(
   select 1 from public.zysyr_expense_voucher_matches m where m.company_id=p_company and m.store_id=p_store and m.voucher_id=(x->>'voucher_id')::uuid
     and m.component_index=(x->>'component_index')::int and m.status='active');
 if jsonb_array_length(fresh)=0 then return jsonb_build_object('inserted',0,'already_linked',true,'combination_saved',true);end if;
 saved:=public.zysyr_save_expense_voucher_matches(p_actor,p_company,p_store,p_month,'manual',fresh);
 select count(*) into n from jsonb_array_elements(p_matches) x join public.zysyr_expense_voucher_matches m
   on m.voucher_id=(x->>'voucher_id')::uuid and m.component_index=(x->>'component_index')::int
   where m.company_id=p_company and m.store_id=p_store and m.period_month=p_month and m.status='active'
     and m.target_kind=v_kind and m.target_id=v_target and (m.corrected_fields->>'amount')::numeric=(x->'corrected_fields'->>'amount')::numeric;
 if n<>jsonb_array_length(p_matches) then raise exception 'VOUCHER_COMBINATION_NOT_COMPLETE';end if;
 insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,after_json,reason,sensitivity)
 values(p_company,p_store,'user',p_actor,'api','voucher_combination',group_id,'voucher_combination_link',
   jsonb_build_object('target_kind',v_kind,'target_id',v_target,'total',total,'items',p_matches),'人工逐张核对组合凭证','financial');
 return saved||jsonb_build_object('group_id',group_id,'combination_saved',true,'total',total,'amount_changed',false,'posted',false);
end $$;
revoke all on function public.zysyr_save_expense_voucher_combination(uuid,uuid,uuid,date,jsonb) from public,anon,authenticated;
grant execute on function public.zysyr_save_expense_voucher_combination(uuid,uuid,uuid,date,jsonb) to service_role;

create function public.zysyr_attach_monthly_voucher_combination(
 p_actor uuid,p_company uuid,p_store uuid,p_cell uuid,p_expected_amount numeric,
 p_expected_versions jsonb,p_expected_adjustments uuid[],p_items jsonb,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare cell public.zysyr_report_cells;report public.zysyr_report_uploads;versions jsonb;adjustments uuid[];
 r jsonb;total numeric;n integer;inserted integer:=0;latest uuid;group_id uuid:=gen_random_uuid();
begin
 perform zysyr_private.assert_finance_scope(p_actor,p_company,p_store,'voucher.upload');
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 2 and 20
   or jsonb_typeof(p_expected_versions) is distinct from 'object' or p_expected_adjustments is null
   or p_expected_amount is null or p_expected_amount<=0 or p_expected_amount::text in ('NaN','Infinity','-Infinity')
   or p_expected_amount<>round(p_expected_amount,2) or nullif(btrim(p_reason),'') is null then raise exception 'VOUCHER_COMBINATION_INVALID';end if;
 select * into cell from public.zysyr_report_cells where id=p_cell and company_id=p_company and store_id=p_store;
 select * into report from public.zysyr_report_uploads where id=cell.report_id and company_id=p_company and store_id=p_store and report_type='monthly_profit_loss';
 if report.id is null then raise exception 'MONTHLY_COMBINATION_CELL_NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company::text||':'||p_store::text||':'||report.report_date::text,0));
 perform id from public.zysyr_report_cells where id=p_cell and company_id=p_company and store_id=p_store for update;
 select coalesce(jsonb_object_agg(id::text,revision),'{}'::jsonb) into versions from public.zysyr_monthly_cell_revisions
   where company_id=p_company and store_id=p_store and report_id=report.id;
 select coalesce(array_agg(id order by id),array[]::uuid[]) into adjustments from public.zysyr_monthly_income_adjustments
   where company_id=p_company and store_id=p_store and period_month=report.report_date;
 if versions is distinct from p_expected_versions or adjustments is distinct from p_expected_adjustments then raise exception 'VOUCHER_COMBINATION_SOURCE_CHANGED';end if;
 if (select count(distinct value->>'voucher_id') from jsonb_array_elements(p_items))<>jsonb_array_length(p_items)
   or exists(select 1 from jsonb_array_elements(p_items) x where coalesce((x->>'amount')::numeric,0)<=0
     or (x->>'amount')::numeric::text in ('NaN','Infinity','-Infinity') or (x->>'amount')::numeric<>round((x->>'amount')::numeric,2)) then raise exception 'VOUCHER_COMBINATION_INVALID';end if;
 select sum((value->>'amount')::numeric) into total from jsonb_array_elements(p_items);
 if total is distinct from p_expected_amount then raise exception 'VOUCHER_COMBINATION_SUM_MISMATCH';end if;
 perform id from public.zysyr_voucher_attachments where company_id=p_company and store_id=p_store
   and id in (select (value->>'voucher_id')::uuid from jsonb_array_elements(p_items)) order by id for update;
 select count(*) into n from public.zysyr_voucher_attachments where company_id=p_company and store_id=p_store
   and id in (select (value->>'voucher_id')::uuid from jsonb_array_elements(p_items));
 if n<>jsonb_array_length(p_items) then raise exception 'VOUCHER_COMBINATION_SCOPE_CHANGED';end if;
 for r in select value from jsonb_array_elements(p_items) loop
   select id into latest from public.zysyr_monthly_cell_revisions where company_id=p_company and store_id=p_store and source_cell_id=p_cell order by revision desc limit 1;
   if not exists(select 1 from public.zysyr_monthly_cell_revision_vouchers where company_id=p_company and store_id=p_store and revision_id=latest and voucher_id=(r->>'voucher_id')::uuid) then
     perform public.zysyr_attach_monthly_cell_voucher(p_actor,p_company,p_store,p_cell,(r->>'voucher_id')::uuid,p_reason);
     inserted:=inserted+1;
   end if;
 end loop;
 if inserted>0 then
   insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,after_json,reason,sensitivity)
   values(p_company,p_store,'user',p_actor,'api','voucher_combination',group_id,'voucher_combination_link',
     jsonb_build_object('cell_id',p_cell,'total',total,'items',p_items),p_reason,'financial');
 end if;
 return jsonb_build_object('group_id',group_id,'inserted',inserted,'already_linked',inserted=0,'combination_saved',true,'total',total,'amount_changed',false,'posted',false);
end $$;
revoke all on function public.zysyr_attach_monthly_voucher_combination(uuid,uuid,uuid,uuid,numeric,jsonb,uuid[],jsonb,text) from public,anon,authenticated;
grant execute on function public.zysyr_attach_monthly_voucher_combination(uuid,uuid,uuid,uuid,numeric,jsonb,uuid[],jsonb,text) to service_role;
