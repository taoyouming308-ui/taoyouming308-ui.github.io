-- ZYSYR: disable Xiangli shareholder account "哈维"; release login name for later re-registration
do $$
declare
  v_account record;
  v_new_login text;
begin
  for v_account in
    select id, company_id, login_name
    from public.zysyr_user_accounts
    where btrim(login_name) = '哈维'
      and status = 'active'
  loop
    v_new_login := v_account.login_name || '_disabled_' || to_char(now(), 'YYYYMMDD');

    update public.zysyr_user_accounts
    set status = 'inactive',
        login_name = v_new_login
    where id = v_account.id;

    update public.zysyr_user_role_grants
    set revoked_at = now()
    where user_account_id = v_account.id
      and revoked_at is null;

    insert into public.zysyr_audit_events (
      company_id,
      store_id,
      actor_type,
      actor_user_id,
      channel,
      entity_type,
      entity_id,
      action,
      after_json,
      reason,
      sensitivity
    ) values (
      v_account.company_id,
      null,
      'system',
      null,
      'migration',
      'user_account',
      v_account.id,
      'shareholder_account_disabled',
      jsonb_build_object(
        'login_name', v_new_login,
        'former_status', 'active'
      ),
      '老板要求停用向里造型股东账号，后续使用需重新注册股东角色。',
      'personal'
    );
  end loop;
end
$$;
