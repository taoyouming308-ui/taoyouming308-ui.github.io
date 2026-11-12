-- Additional ACL assertions; run only on an isolated database after migration.
begin;
do $$
begin
 if has_table_privilege('service_role','zysyr_private.history_parse_generations','INSERT')
 or has_table_privilege('authenticated','zysyr_private.history_parse_generations','SELECT') then
 raise exception 'Generation storage exposed'; end if;
end $$;
rollback;
