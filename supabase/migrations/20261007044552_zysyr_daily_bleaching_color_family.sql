-- User-approved service family: bleaching belongs to dye, in the two existing stores.
-- Definitions only. No draft/ledger/payment writes; no owner/ACL/security changes.
-- Frozen v2-v10 catalogs and mapping version remain unchanged.
begin;
do $migration$
declare
  target regprocedure := 'zysyr_daily_electronic_private.report_project_category(text,text,text)'::regprocedure;
  original text;
  old_predicate text := 'p_name=''褪色''';
  new_predicate text := '(p_name=''褪色'' or p_name ~ ''^漂发([0-9]+(元)?)?$'')';
  prior_acl aclitem[];
  prior_owner oid;
  prior_security boolean;
  prior_config text[];
begin
  select pg_get_functiondef(oid),proacl,proowner,prosecdef,proconfig
    into original,prior_acl,prior_owner,prior_security,prior_config from pg_proc where oid=target;
  if position(new_predicate in original)>0 then return; end if;
  if (length(original)-length(replace(original,old_predicate,''))) <> length(old_predicate)
     or position('p_shop in(''1837032'',''1009951'') and '||old_predicate in original)=0
  then raise exception 'BLEACHING_CATEGORY_BASELINE_CHANGED'; end if;
  execute replace(original,old_predicate,new_predicate);
  if exists(select 1 from pg_proc where oid=target and
    (proacl is distinct from prior_acl or proowner<>prior_owner or prosecdef<>prior_security or proconfig is distinct from prior_config))
  then raise exception 'BLEACHING_CATEGORY_PRIVILEGES_CHANGED'; end if;
end $migration$;
commit;
