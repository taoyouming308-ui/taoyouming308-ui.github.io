set lock_timeout='5s';
create table if not exists public.zysyr_voucher_ai_settings(
 company_id uuid not null,store_id uuid not null,provider text not null default 'openai' check(provider in ('openai','openai_compatible')),
 base_url text not null default 'https://api.openai.com/v1',protocol text not null default 'responses' check(protocol in ('responses','chat_completions')),
 model text not null check(length(model) between 2 and 100),encrypted_key jsonb,
 revision integer not null default 1,updated_at timestamptz not null default now(),updated_by uuid not null,
 primary key(company_id,store_id),foreign key(company_id,store_id) references public.zysyr_stores(company_id,id),
 foreign key(company_id,updated_by) references public.zysyr_user_accounts(company_id,id),
 check(encrypted_key is null or (encrypted_key->>'v'='1' and encrypted_key->>'iv' is not null and encrypted_key->>'data' is not null))
);
alter table public.zysyr_voucher_ai_settings enable row level security;
revoke all on public.zysyr_voucher_ai_settings from public,anon,authenticated,service_role;
grant select on public.zysyr_voucher_ai_settings to service_role;
create or replace function public.zysyr_save_voucher_ai_settings(p_actor uuid,p_company uuid,p_store uuid,p_model text,p_base_url text,p_protocol text,p_encrypted_key jsonb,p_expected integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_revision integer;saved_revision integer;
begin
 perform zysyr_private.assert_finance_scope(p_actor,p_company,p_store,'voucher.review');
 if p_protocol is null or p_base_url is null or p_model is null or p_expected is null or p_protocol not in ('responses','chat_completions') or p_base_url !~ '^https://' or p_model !~ '^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,99}$' or p_expected<0 then raise exception 'VOUCHER_AI_SETTINGS_INVALID';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('voucher-ai-settings|'||p_company::text||'|'||p_store::text,0));
 select revision into current_revision from public.zysyr_voucher_ai_settings where company_id=p_company and store_id=p_store for update;
 if coalesce(current_revision,0)<>p_expected then raise exception 'VOUCHER_AI_SETTINGS_CHANGED';end if;
 insert into public.zysyr_voucher_ai_settings(company_id,store_id,provider,model,base_url,protocol,encrypted_key,revision,updated_by)
 values(p_company,p_store,case when p_base_url='https://api.openai.com/v1' then 'openai' else 'openai_compatible' end,p_model,p_base_url,p_protocol,p_encrypted_key,coalesce(current_revision,0)+1,p_actor)
 on conflict(company_id,store_id) do update set provider=excluded.provider,model=excluded.model,base_url=excluded.base_url,protocol=excluded.protocol,encrypted_key=excluded.encrypted_key,revision=excluded.revision,updated_at=now(),updated_by=p_actor returning revision into saved_revision;
 insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,after_json,reason,sensitivity)
 values(p_company,p_store,'user',p_actor,'api','store',p_store,'voucher_ai_settings_saved',jsonb_build_object('model',p_model,'base_url',p_base_url,'protocol',p_protocol,'revision',saved_revision,'custom_key_configured',p_encrypted_key is not null),'财务测试连接后更新当前门店凭证识别设置','financial');
 return jsonb_build_object('saved',true,'revision',saved_revision,'model',p_model,'key_configured',p_encrypted_key is not null);
end $$;
revoke execute on function public.zysyr_save_voucher_ai_settings(uuid,uuid,uuid,text,text,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.zysyr_save_voucher_ai_settings(uuid,uuid,uuid,text,text,text,jsonb,integer) to service_role;

-- Pin the selected provider/model/encrypted key for each newly queued expense image.
-- A later settings edit must not redirect an already queued image to another provider.
alter table public.zysyr_voucher_ocr_tasks add column if not exists ai_settings_snapshot jsonb;
create or replace function zysyr_private.capture_voucher_ai_settings() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.zysyr_voucher_attachments where id=new.voucher_id and company_id=new.company_id and store_id=new.store_id and note like 'petty_cash_batch|%') then
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('voucher-ai-settings|'||new.company_id::text||'|'||new.store_id::text,0));
  select jsonb_build_object('model',model,'base_url',base_url,'protocol',protocol,'encrypted_key',encrypted_key,'revision',revision) into new.ai_settings_snapshot from public.zysyr_voucher_ai_settings where company_id=new.company_id and store_id=new.store_id;
  if new.ai_settings_snapshot is null then new.ai_settings_snapshot:=jsonb_build_object('base_url','https://api.openai.com/v1','protocol','responses','revision',0);end if;
 end if;
 return new;
end $$;
revoke execute on function zysyr_private.capture_voucher_ai_settings() from public,anon,authenticated;
create trigger zysyr_voucher_ai_settings_snapshot before insert on public.zysyr_voucher_ocr_tasks for each row execute function zysyr_private.capture_voucher_ai_settings();
