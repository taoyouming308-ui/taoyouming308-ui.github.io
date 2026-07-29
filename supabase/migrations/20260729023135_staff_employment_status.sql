alter table public.staff
  add column if not exists employment_status text not null default 'pending'
  check (employment_status in ('pending', 'active', 'departed'));

update public.staff
set employment_status = case
  when active is true then 'active'
  else 'pending'
end
where employment_status = 'pending';
