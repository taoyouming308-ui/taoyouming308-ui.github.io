-- Member account lifecycle and append-only recharge evidence. Development only.
set statement_timeout='30s';set lock_timeout='5s';

alter table public.salon_member_accounts
 add column display_name text not null default '',
 add column home_store_id bigint,
 add column usable_scope text not null default 'store' check(usable_scope in ('store','organization')),
 add foreign key(organization_id,home_store_id) references public.salon_stores(organization_id,id) on delete restrict;
update public.salon_member_accounts a set home_store_id=(select min(r.store_id) from public.salon_customer_store_relations r where r.organization_id=a.organization_id and r.customer_id=a.customer_id) where home_store_id is null;

create table public.salon_member_recharges(
 id bigint generated always as identity primary key,organization_id bigint not null,store_id bigint not null,account_id bigint not null,
 paid_amount numeric(12,2) not null check(paid_amount>=0),cash_added numeric(12,2) not null default 0 check(cash_added>=0),bonus_added numeric(12,2) not null default 0 check(bonus_added>=0),units_added numeric(12,3) not null default 0 check(units_added>=0),
 payment_method text not null check(payment_method in ('cash','wechat','alipay','bank','other','no_payment')),external_reference text not null default '',reason text not null,occurred_at timestamptz not null default now(),
 unique(organization_id,id),foreign key(organization_id,store_id) references public.salon_stores(organization_id,id) on delete restrict,foreign key(organization_id,account_id) references public.salon_member_accounts(organization_id,id) on delete restrict,
 check(paid_amount>0 or bonus_added>0 or units_added>0),check(nullif(btrim(reason),'') is not null)
);
create index salon_member_recharges_scope_idx on public.salon_member_recharges(organization_id,store_id,occurred_at desc);
alter table public.salon_member_recharges enable row level security;alter table public.salon_member_recharges force row level security;revoke all on table public.salon_member_recharges from public,anon,authenticated;grant all on table public.salon_member_recharges to service_role;

alter table public.salon_account_ledger add column recharge_id bigint,add foreign key(organization_id,recharge_id) references public.salon_member_recharges(organization_id,id) on delete restrict;
create unique index salon_account_ledger_recharge_idx on public.salon_account_ledger(organization_id,recharge_id) where recharge_id is not null;

alter table public.salon_operation_requests drop constraint salon_operation_requests_action_check;
alter table public.salon_operation_requests add constraint salon_operation_requests_action_check check(action in
 ('checkout','refund','inventory_move','customer_create','customer_status','customer_relation','catalog_create','catalog_enable','catalog_status','inventory_count','member_open','member_recharge','member_status'));

create or replace function public.salon_open_member_account(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_customer_id bigint,p_request_key text,p_account_type text,p_account_no text,p_display_name text,p_usable_scope text default 'store',p_expires_on date default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_request public.salon_operation_requests;v_id bigint;v_no text:=upper(btrim(coalesce(p_account_no,'')));v_name text:=btrim(coalesce(p_display_name,''));v_hash bigint;v_response jsonb;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'members','write');
 if p_account_type not in ('stored_value','package','times_card') or v_no='' or length(v_no)>50 or v_name='' or p_usable_scope not in ('store','organization') then raise exception '会员账户参数无效';end if;
 if p_expires_on is not null and p_expires_on<current_date then raise exception '会员账户有效期不能早于今天';end if;
 if not exists(select 1 from public.salon_customers c join public.salon_customer_store_relations r on r.organization_id=c.organization_id and r.customer_id=c.id where c.organization_id=p_organization_id and c.id=p_customer_id and c.status='active' and r.store_id=p_store_id) then raise exception '顾客不存在、已冻结或不属于当前门店';end if;
 v_hash:=hashtextextended(jsonb_build_object('customer',p_customer_id,'type',p_account_type,'no',v_no,'name',v_name,'scope',p_usable_scope,'expires',p_expires_on)::text,0);v_request:=salon_private.claim_request(p_organization_id,p_store_id,p_request_key,'member_open','member_payload',v_hash);if v_request.completed_at is not null then return v_request.response_json;end if;
 begin insert into public.salon_member_accounts(organization_id,customer_id,account_type,account_no,display_name,home_store_id,usable_scope,remaining_units,expires_on) values(p_organization_id,p_customer_id,p_account_type,v_no,v_name,p_store_id,p_usable_scope,case when p_account_type in ('package','times_card') then 0 else null end,p_expires_on) returning id into v_id;exception when unique_violation then raise exception '会员账户编号已经存在';end;
 insert into public.salon_account_ledger(organization_id,store_id,account_id,entry_type,reason) values(p_organization_id,p_store_id,v_id,'open','会员账户开户');
 insert into public.salon_audit_events(organization_id,store_id,actor_staff_id,entity_type,entity_id,action,after_json) values(p_organization_id,p_store_id,p_actor_staff_id,'member_account',v_id::text,'open',jsonb_build_object('accountType',p_account_type,'accountNo',v_no,'usableScope',p_usable_scope));
 v_response:=jsonb_build_object('accountId',v_id,'accountNo',v_no,'status','active');update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_request.id;return v_response;
end $$;

create or replace function public.salon_recharge_member_account(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_account_id bigint,p_request_key text,p_paid_amount numeric,p_cash_added numeric,p_bonus_added numeric,p_units_added numeric,p_payment_method text,p_external_reference text,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_request public.salon_operation_requests;v_account public.salon_member_accounts;v_recharge_id bigint;v_reason text:=btrim(coalesce(p_reason,''));v_response jsonb;
begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'members','recharge');v_request:=salon_private.claim_request(p_organization_id,p_store_id,p_request_key,'member_recharge','member_recharge_payload',hashtextextended(jsonb_build_object('account',p_account_id,'paid',p_paid_amount,'cash',p_cash_added,'bonus',p_bonus_added,'units',p_units_added,'method',p_payment_method,'reference',btrim(coalesce(p_external_reference,'')),'reason',v_reason)::text,0));if v_request.completed_at is not null then return v_request.response_json;end if;
 if p_paid_amount is null or p_cash_added is null or p_bonus_added is null or p_units_added is null or least(p_paid_amount,p_cash_added,p_bonus_added,p_units_added)<0 or p_paid_amount+p_bonus_added+p_units_added<=0 or p_payment_method not in ('cash','wechat','alipay','bank','other','no_payment') or v_reason='' then raise exception '充值金额、方式或原因无效';end if;
 if (p_paid_amount=0)<>(p_payment_method='no_payment') then raise exception '无实收充值必须使用无支付方式';end if;
 select * into v_account from public.salon_member_accounts a where a.organization_id=p_organization_id and a.id=p_account_id and a.status='active' and (a.home_store_id=p_store_id or a.usable_scope='organization') for update;if not found then raise exception '会员账户不存在、已冻结或当前门店不可用';end if;
 if v_account.expires_on is not null and v_account.expires_on<current_date then raise exception '会员账户已经过期';end if;
 if v_account.account_type='stored_value' then if p_cash_added<>p_paid_amount or p_units_added<>0 then raise exception '储值卡充值金额不匹配';end if;else if p_cash_added<>0 or p_bonus_added<>0 or p_units_added<=0 then raise exception '次卡或套餐充值必须增加次数';end if;end if;
 insert into public.salon_member_recharges(organization_id,store_id,account_id,paid_amount,cash_added,bonus_added,units_added,payment_method,external_reference,reason) values(p_organization_id,p_store_id,p_account_id,round(p_paid_amount,2),round(p_cash_added,2),round(p_bonus_added,2),round(p_units_added,3),p_payment_method,btrim(coalesce(p_external_reference,'')),v_reason) returning id into v_recharge_id;
 update public.salon_member_accounts set cash_balance=cash_balance+round(p_cash_added,2),bonus_balance=bonus_balance+round(p_bonus_added,2),remaining_units=case when remaining_units is null then null else remaining_units+round(p_units_added,3) end where organization_id=p_organization_id and id=p_account_id;
 insert into public.salon_account_ledger(organization_id,store_id,account_id,entry_type,cash_delta,bonus_delta,units_delta,recharge_id,reason) values(p_organization_id,p_store_id,p_account_id,case when p_paid_amount>0 then 'recharge' else 'bonus' end,round(p_cash_added,2),round(p_bonus_added,2),round(p_units_added,3),v_recharge_id,v_reason);
 insert into public.salon_audit_events(organization_id,store_id,actor_staff_id,entity_type,entity_id,action,after_json,reason) values(p_organization_id,p_store_id,p_actor_staff_id,'member_recharge',v_recharge_id::text,'create',jsonb_build_object('accountId',p_account_id,'paidAmount',p_paid_amount,'paymentMethod',p_payment_method,'requestKey',p_request_key),v_reason);
 v_response:=jsonb_build_object('rechargeId',v_recharge_id,'accountId',p_account_id,'cashBalance',v_account.cash_balance+round(p_cash_added,2),'bonusBalance',v_account.bonus_balance+round(p_bonus_added,2),'remainingUnits',case when v_account.remaining_units is null then null else v_account.remaining_units+round(p_units_added,3) end);update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_request.id;return v_response;
end $$;

create or replace function public.salon_set_member_status(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_account_id bigint,p_request_key text,p_status text,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$ declare v_request public.salon_operation_requests;v_before text;v_response jsonb;begin
 perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'members','write');v_request:=salon_private.claim_request(p_organization_id,p_store_id,p_request_key,'member_status','member_status_'||coalesce(p_status,''),p_account_id);if v_request.completed_at is not null then return v_request.response_json;end if;
 if p_status not in ('active','frozen') or nullif(btrim(p_reason),'') is null then raise exception '会员账户状态或原因无效';end if;select status into v_before from public.salon_member_accounts where organization_id=p_organization_id and id=p_account_id and (home_store_id=p_store_id or usable_scope='organization') for update;if not found then raise exception '会员账户不存在或当前门店不可管理';end if;if v_before=p_status then raise exception '会员账户已经是目标状态';end if;
 update public.salon_member_accounts set status=p_status where organization_id=p_organization_id and id=p_account_id;insert into public.salon_audit_events(organization_id,store_id,actor_staff_id,entity_type,entity_id,action,before_json,after_json,reason) values(p_organization_id,p_store_id,p_actor_staff_id,'member_account',p_account_id::text,'status_change',jsonb_build_object('status',v_before),jsonb_build_object('status',p_status),btrim(p_reason));v_response:=jsonb_build_object('accountId',p_account_id,'status',p_status);update public.salon_operation_requests set response_json=v_response,completed_at=now() where id=v_request.id;return v_response;
end $$;

create or replace function public.salon_list_member_accounts(p_actor_staff_id bigint,p_organization_id bigint,p_store_id bigint,p_customer_id bigint default null,p_status text default '',p_limit integer default 200)
returns table(account_id bigint,customer_id bigint,account_type text,account_no text,display_name text,status text,cash_balance numeric,bonus_balance numeric,remaining_units numeric,expires_on date,home_store_id bigint,usable_scope text)
language plpgsql security invoker set search_path='' as $$ begin perform salon_private.assert_staff_permission(p_actor_staff_id,p_organization_id,p_store_id,'members','read');if p_status not in ('','active','frozen','expired','closed') or p_limit not between 1 and 500 then raise exception '会员账户查询参数无效';end if;return query select a.id,a.customer_id,a.account_type,a.account_no,a.display_name,a.status,a.cash_balance,a.bonus_balance,a.remaining_units,a.expires_on,a.home_store_id,a.usable_scope from public.salon_member_accounts a join public.salon_customer_store_relations r on r.organization_id=a.organization_id and r.customer_id=a.customer_id and r.store_id=p_store_id where a.organization_id=p_organization_id and (a.home_store_id=p_store_id or a.usable_scope='organization') and (p_customer_id is null or a.customer_id=p_customer_id) and (p_status='' or a.status=p_status) order by a.id desc limit p_limit;end $$;

revoke execute on function public.salon_open_member_account(bigint,bigint,bigint,bigint,text,text,text,text,text,date) from public,anon,authenticated;
revoke execute on function public.salon_recharge_member_account(bigint,bigint,bigint,bigint,text,numeric,numeric,numeric,numeric,text,text,text) from public,anon,authenticated;
revoke execute on function public.salon_set_member_status(bigint,bigint,bigint,bigint,text,text,text) from public,anon,authenticated;
revoke execute on function public.salon_list_member_accounts(bigint,bigint,bigint,bigint,text,integer) from public,anon,authenticated;
grant execute on function public.salon_open_member_account(bigint,bigint,bigint,bigint,text,text,text,text,text,date) to service_role;
grant execute on function public.salon_recharge_member_account(bigint,bigint,bigint,bigint,text,numeric,numeric,numeric,numeric,text,text,text) to service_role;
grant execute on function public.salon_set_member_status(bigint,bigint,bigint,bigint,text,text,text) to service_role;
grant execute on function public.salon_list_member_accounts(bigint,bigint,bigint,bigint,text,integer) to service_role;
