-- ZYSYR v518: cover the remaining foreign-key lookups on the immutable
-- mistaken-upload audit table without changing any report data.

create index zysyr_daily_sheet_attachment_voids_voucher_idx
  on public.zysyr_daily_sheet_attachment_voids (company_id, voucher_id);

create index zysyr_daily_sheet_attachment_voids_actor_idx
  on public.zysyr_daily_sheet_attachment_voids (company_id, voided_by_user_id);
