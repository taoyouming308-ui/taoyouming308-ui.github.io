-- ZYSYR V2 Sprint 5: independent procurement, perpetual inventory,
-- moving-average costing, consumptions and employee purchases.
-- No Meiguanjia tables or external data are read by this module.

set statement_timeout = '30s';
set lock_timeout = '5s';

create table public.zysyr_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  supplier_id uuid not null,
  order_number text not null check (nullif(btrim(order_number), '') is not null),
  order_date date not null,
  expected_date date,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved', 'rejected', 'cancelled')),
  receipt_status text not null default 'none'
    check (receipt_status in ('none', 'partial', 'complete')),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'partial', 'paid')),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  notes text,
  submitted_by_user_id uuid,
  submitted_at timestamptz,
  approved_by_user_id uuid,
  approved_at timestamptz,
  decided_reason text,
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_by_user_id uuid not null,
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, store_id, id),
  unique (company_id, store_id, order_number),
  foreign key (company_id, store_id) references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, supplier_id) references public.zysyr_suppliers(company_id, id) on delete restrict,
  foreign key (company_id, created_by_user_id) references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, updated_by_user_id) references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, submitted_by_user_id) references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, approved_by_user_id) references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check (expected_date is null or expected_date >= order_date),
  check ((submitted_at is null) = (submitted_by_user_id is null)),
  check ((approved_at is null) = (approved_by_user_id is null))
);

create table public.zysyr_purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  purchase_order_id uuid not null,
  line_number integer not null check (line_number > 0),
  product_id uuid not null,
  ordered_quantity numeric(14,4) not null check (ordered_quantity > 0),
  unit_cost numeric(14,4) not null check (unit_cost >= 0),
  line_amount numeric(14,2) generated always as (round(ordered_quantity * unit_cost, 2)) stored,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, store_id, id),
  unique (company_id, purchase_order_id, line_number),
  unique (company_id, purchase_order_id, product_id),
  foreign key (company_id, store_id, purchase_order_id)
    references public.zysyr_purchase_orders(company_id, store_id, id) on delete cascade,
  foreign key (company_id, product_id) references public.zysyr_products(company_id, id) on delete restrict
);

create table public.zysyr_goods_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  purchase_order_id uuid not null,
  receipt_number text not null check (nullif(btrim(receipt_number), '') is not null),
  receipt_date date not null,
  status text not null default 'posted' check (status in ('posted', 'reversed')),
  total_amount numeric(14,2) not null check (total_amount >= 0),
  posted_by_user_id uuid not null,
  posted_at timestamptz not null default now(),
  reversed_by_user_id uuid,
  reversed_at timestamptz,
  reverse_reason text,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, store_id, id),
  unique (company_id, store_id, receipt_number),
  foreign key (company_id, store_id, purchase_order_id)
    references public.zysyr_purchase_orders(company_id, store_id, id) on delete restrict,
  foreign key (company_id, posted_by_user_id) references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, reversed_by_user_id) references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check ((status = 'posted' and reversed_by_user_id is null and reversed_at is null)
    or (status = 'reversed' and reversed_by_user_id is not null and reversed_at is not null
      and nullif(btrim(reverse_reason), '') is not null))
);

create table public.zysyr_goods_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  goods_receipt_id uuid not null,
  purchase_order_line_id uuid not null,
  product_id uuid not null,
  quantity numeric(14,4) not null check (quantity > 0),
  unit_cost numeric(14,4) not null check (unit_cost >= 0),
  line_amount numeric(14,2) generated always as (round(quantity * unit_cost, 2)) stored,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, store_id, id),
  unique (company_id, goods_receipt_id, purchase_order_line_id),
  foreign key (company_id, store_id, goods_receipt_id)
    references public.zysyr_goods_receipts(company_id, store_id, id) on delete restrict,
  foreign key (company_id, store_id, purchase_order_line_id)
    references public.zysyr_purchase_order_lines(company_id, store_id, id) on delete restrict,
  foreign key (company_id, product_id) references public.zysyr_products(company_id, id) on delete restrict
);

create table public.zysyr_inventory_balances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  product_id uuid not null,
  quantity numeric(14,4) not null default 0 check (quantity >= 0),
  moving_average_cost numeric(14,4) not null default 0 check (moving_average_cost >= 0),
  inventory_value numeric(14,2) not null default 0 check (inventory_value >= 0),
  last_posting_sequence bigint not null default 0 check (last_posting_sequence >= 0),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, store_id, product_id),
  foreign key (company_id, store_id) references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, product_id) references public.zysyr_products(company_id, id) on delete restrict
);

create table public.zysyr_inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  product_id uuid not null,
  posting_sequence bigint generated always as identity,
  business_date date not null,
  posted_at timestamptz not null default clock_timestamp(),
  transaction_type text not null check (transaction_type in
    ('purchase_receipt', 'usage', 'damage', 'employee_purchase', 'transfer_out', 'transfer_in', 'reversal')),
  direction text not null check (direction in ('in', 'out')),
  quantity numeric(14,4) not null check (quantity > 0),
  unit_cost numeric(14,4) not null check (unit_cost >= 0),
  total_cost numeric(14,2) not null check (total_cost >= 0),
  quantity_before numeric(14,4) not null check (quantity_before >= 0),
  quantity_after numeric(14,4) not null check (quantity_after >= 0),
  average_cost_before numeric(14,4) not null check (average_cost_before >= 0),
  average_cost_after numeric(14,4) not null check (average_cost_after >= 0),
  source_type text not null check (source_type in ('goods_receipt_line', 'usage_record', 'employee_purchase', 'stock_transfer_line', 'inventory_transaction')),
  source_id uuid not null,
  status text not null default 'posted' check (status in ('posted', 'reversed')),
  reversal_of_id uuid,
  posted_by_user_id uuid not null,
  reversed_by_user_id uuid,
  reversed_at timestamptz,
  reverse_reason text,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, store_id, id),
  unique (posting_sequence),
  foreign key (company_id, store_id) references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, product_id) references public.zysyr_products(company_id, id) on delete restrict,
  foreign key (company_id, reversal_of_id) references public.zysyr_inventory_transactions(company_id, id) on delete restrict,
  foreign key (company_id, posted_by_user_id) references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, reversed_by_user_id) references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check ((status = 'posted' and reversed_by_user_id is null and reversed_at is null)
    or (status = 'reversed' and reversed_by_user_id is not null and reversed_at is not null
      and nullif(btrim(reverse_reason), '') is not null)),
  check ((reversal_of_id is null and transaction_type <> 'reversal')
    or (reversal_of_id is not null and transaction_type = 'reversal'))
);

create table public.zysyr_usage_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  product_id uuid not null,
  employee_id uuid,
  usage_date date not null,
  usage_type text not null check (usage_type in ('salon_service', 'daily_consumable', 'damage', 'other')),
  quantity numeric(14,4) not null check (quantity > 0),
  unit_cost numeric(14,4) not null check (unit_cost >= 0),
  total_cost numeric(14,2) not null check (total_cost >= 0),
  notes text,
  status text not null default 'confirmed' check (status in ('confirmed', 'reversed')),
  inventory_transaction_id uuid,
  confirmed_by_user_id uuid not null,
  confirmed_at timestamptz not null default now(),
  reversed_by_user_id uuid,
  reversed_at timestamptz,
  reverse_reason text,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, store_id, id),
  foreign key (company_id, store_id) references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, product_id) references public.zysyr_products(company_id, id) on delete restrict,
  foreign key (company_id, store_id, employee_id) references public.zysyr_employees(company_id, store_id, id) on delete restrict,
  foreign key (company_id, store_id, inventory_transaction_id) references public.zysyr_inventory_transactions(company_id, store_id, id) on delete restrict,
  foreign key (company_id, confirmed_by_user_id) references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, reversed_by_user_id) references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check ((status = 'confirmed' and reversed_by_user_id is null and reversed_at is null)
    or (status = 'reversed' and reversed_by_user_id is not null and reversed_at is not null
      and nullif(btrim(reverse_reason), '') is not null))
);

create table public.zysyr_employee_purchases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  employee_id uuid not null,
  product_id uuid not null,
  purchase_date date not null,
  quantity numeric(14,4) not null check (quantity > 0),
  unit_price numeric(14,4) not null check (unit_price >= 0),
  amount numeric(14,2) not null check (amount >= 0),
  inventory_unit_cost numeric(14,4) not null check (inventory_unit_cost >= 0),
  inventory_cost numeric(14,2) not null check (inventory_cost >= 0),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'partial', 'paid')),
  paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  status text not null default 'approved' check (status in ('approved', 'reversed')),
  inventory_transaction_id uuid,
  approved_by_user_id uuid not null,
  approved_at timestamptz not null default now(),
  reversed_by_user_id uuid,
  reversed_at timestamptz,
  reverse_reason text,
  notes text,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, store_id, id),
  foreign key (company_id, store_id) references public.zysyr_stores(company_id, id) on delete restrict,
  foreign key (company_id, store_id, employee_id) references public.zysyr_employees(company_id, store_id, id) on delete restrict,
  foreign key (company_id, product_id) references public.zysyr_products(company_id, id) on delete restrict,
  foreign key (company_id, store_id, inventory_transaction_id) references public.zysyr_inventory_transactions(company_id, store_id, id) on delete restrict,
  foreign key (company_id, approved_by_user_id) references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, reversed_by_user_id) references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check (amount = round(quantity * unit_price, 2)),
  check (paid_amount <= amount),
  check ((status = 'approved' and reversed_by_user_id is null and reversed_at is null)
    or (status = 'reversed' and reversed_by_user_id is not null and reversed_at is not null
      and nullif(btrim(reverse_reason), '') is not null))
);

create table public.zysyr_employee_purchase_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  store_id uuid not null,
  employee_purchase_id uuid not null,
  payment_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  payment_method text not null check (nullif(btrim(payment_method), '') is not null),
  payment_reference text,
  status text not null default 'confirmed' check (status in ('confirmed', 'reversed')),
  confirmed_by_user_id uuid not null,
  confirmed_at timestamptz not null default now(),
  reversed_by_user_id uuid,
  reversed_at timestamptz,
  reverse_reason text,
  created_at timestamptz not null default now(),
  unique (company_id, id),
  unique (company_id, store_id, id),
  foreign key (company_id, store_id, employee_purchase_id)
    references public.zysyr_employee_purchases(company_id, store_id, id) on delete restrict,
  foreign key (company_id, confirmed_by_user_id) references public.zysyr_user_accounts(company_id, id) on delete restrict,
  foreign key (company_id, reversed_by_user_id) references public.zysyr_user_accounts(company_id, id) on delete restrict,
  check ((status = 'confirmed' and reversed_by_user_id is null and reversed_at is null)
    or (status = 'reversed' and reversed_by_user_id is not null and reversed_at is not null
      and nullif(btrim(reverse_reason), '') is not null))
);

create table public.zysyr_stock_transfers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  source_store_id uuid not null,
  destination_store_id uuid not null,
  transfer_number text not null check (nullif(btrim(transfer_number),'') is not null),
  transfer_date date not null,
  status text not null default 'posted' check (status in ('posted','reversed')),
  total_cost numeric(14,2) not null check (total_cost>=0),
  notes text,
  posted_by_user_id uuid not null,
  posted_at timestamptz not null default now(),
  reversed_by_user_id uuid,
  reversed_at timestamptz,
  reverse_reason text,
  created_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,source_store_id,id),
  unique(company_id,source_store_id,transfer_number),
  foreign key(company_id,source_store_id) references public.zysyr_stores(company_id,id) on delete restrict,
  foreign key(company_id,destination_store_id) references public.zysyr_stores(company_id,id) on delete restrict,
  foreign key(company_id,posted_by_user_id) references public.zysyr_user_accounts(company_id,id) on delete restrict,
  foreign key(company_id,reversed_by_user_id) references public.zysyr_user_accounts(company_id,id) on delete restrict,
  check(source_store_id<>destination_store_id),
  check((status='posted' and reversed_by_user_id is null and reversed_at is null)
    or (status='reversed' and reversed_by_user_id is not null and reversed_at is not null and nullif(btrim(reverse_reason),'') is not null))
);

create table public.zysyr_stock_transfer_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.zysyr_companies(id) on delete restrict,
  source_store_id uuid not null,
  stock_transfer_id uuid not null,
  line_number integer not null check(line_number>0),
  product_id uuid not null,
  quantity numeric(14,4) not null check(quantity>0),
  unit_cost numeric(14,4) not null check(unit_cost>=0),
  total_cost numeric(14,2) not null check(total_cost>=0),
  source_transaction_id uuid,
  destination_transaction_id uuid,
  created_at timestamptz not null default now(),
  unique(company_id,id),
  unique(company_id,stock_transfer_id,line_number),
  unique(company_id,stock_transfer_id,product_id),
  foreign key(company_id,source_store_id,stock_transfer_id) references public.zysyr_stock_transfers(company_id,source_store_id,id) on delete restrict,
  foreign key(company_id,product_id) references public.zysyr_products(company_id,id) on delete restrict,
  foreign key(company_id,source_store_id,source_transaction_id) references public.zysyr_inventory_transactions(company_id,store_id,id) on delete restrict,
  foreign key(company_id,destination_transaction_id) references public.zysyr_inventory_transactions(company_id,id) on delete restrict,
  check(total_cost=round(quantity*unit_cost,2)),
  check((source_transaction_id is null)=(destination_transaction_id is null))
);

create index zysyr_purchase_orders_scope_date_idx on public.zysyr_purchase_orders(company_id, store_id, order_date desc, status);
create index zysyr_purchase_order_lines_product_idx on public.zysyr_purchase_order_lines(company_id, product_id);
create index zysyr_goods_receipts_scope_date_idx on public.zysyr_goods_receipts(company_id, store_id, receipt_date desc, status);
create index zysyr_goods_receipt_lines_po_line_idx on public.zysyr_goods_receipt_lines(company_id, purchase_order_line_id);
create index zysyr_inventory_transactions_scope_product_idx on public.zysyr_inventory_transactions(company_id, store_id, product_id, posting_sequence desc);
create index zysyr_inventory_transactions_source_idx on public.zysyr_inventory_transactions(company_id, store_id, source_type, source_id);
create index zysyr_usage_records_scope_date_idx on public.zysyr_usage_records(company_id, store_id, usage_date desc, status);
create index zysyr_employee_purchases_scope_date_idx on public.zysyr_employee_purchases(company_id, store_id, purchase_date desc, status);
create index zysyr_employee_purchase_payments_purchase_idx on public.zysyr_employee_purchase_payments(company_id, store_id, employee_purchase_id, status);
create index zysyr_stock_transfers_source_date_idx on public.zysyr_stock_transfers(company_id,source_store_id,transfer_date desc,status);
create index zysyr_stock_transfers_destination_date_idx on public.zysyr_stock_transfers(company_id,destination_store_id,transfer_date desc,status);
create index zysyr_stock_transfer_lines_product_idx on public.zysyr_stock_transfer_lines(company_id,product_id);

create or replace function zysyr_private.assert_inventory_scope(
  target_user_account_id uuid, target_company_id uuid, target_store_id uuid
) returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not zysyr_private.account_has_capability(target_user_account_id, target_company_id, target_store_id, 'inventory.write') then
    raise exception using errcode = '42501', message = 'INVENTORY_SCOPE_FORBIDDEN';
  end if;
end $$;

create or replace function zysyr_private.assert_inventory_write_date(
  target_user_account_id uuid, target_company_id uuid, target_store_id uuid, target_date date
) returns void language plpgsql stable security definer set search_path = '' as $$
begin
  perform zysyr_private.assert_inventory_scope(target_user_account_id, target_company_id, target_store_id);
  if target_date is null then raise exception using errcode='22023', message='INVENTORY_DATE_REQUIRED'; end if;
  if zysyr_private.period_is_locked(target_company_id, target_store_id, target_date) then
    raise exception using errcode='55000', message='FINANCE_PERIOD_LOCKED';
  end if;
end $$;

create or replace function zysyr_private.lock_inventory_balance(
  target_company_id uuid, target_store_id uuid, target_product_id uuid
) returns public.zysyr_inventory_balances language plpgsql security definer set search_path = '' as $$
declare v_balance public.zysyr_inventory_balances;
begin
  insert into public.zysyr_inventory_balances(company_id, store_id, product_id)
  values(target_company_id, target_store_id, target_product_id)
  on conflict(company_id, store_id, product_id) do nothing;
  select * into v_balance from public.zysyr_inventory_balances b
  where b.company_id=target_company_id and b.store_id=target_store_id and b.product_id=target_product_id
  for update;
  return v_balance;
end $$;

create or replace function zysyr_private.post_inventory_transaction(
  target_actor_user_id uuid, target_company_id uuid, target_store_id uuid,
  target_product_id uuid, target_business_date date, target_transaction_type text,
  target_direction text, target_quantity numeric, target_unit_cost numeric,
  target_source_type text, target_source_id uuid
) returns public.zysyr_inventory_transactions language plpgsql security definer set search_path = '' as $$
declare
  v_balance public.zysyr_inventory_balances;
  v_after_quantity numeric(14,4);
  v_after_cost numeric(14,4);
  v_total numeric(14,2);
  v_saved public.zysyr_inventory_transactions;
begin
  perform zysyr_private.assert_inventory_write_date(target_actor_user_id, target_company_id, target_store_id, target_business_date);
  if target_quantity is null or target_quantity <= 0 or target_unit_cost is null or target_unit_cost < 0 then
    raise exception using errcode='22023', message='INVENTORY_QUANTITY_COST_INVALID';
  end if;
  v_balance := zysyr_private.lock_inventory_balance(target_company_id, target_store_id, target_product_id);
  if target_direction = 'in' then
    v_after_quantity := v_balance.quantity + target_quantity;
    v_after_cost := case when v_after_quantity = 0 then 0 else
      round(((v_balance.quantity * v_balance.moving_average_cost) + (target_quantity * target_unit_cost)) / v_after_quantity, 4) end;
    v_total := round(target_quantity * target_unit_cost, 2);
  elsif target_direction = 'out' then
    if v_balance.quantity < target_quantity then
      raise exception using errcode='23514', message='INSUFFICIENT_INVENTORY';
    end if;
    v_after_quantity := v_balance.quantity - target_quantity;
    v_after_cost := case when v_after_quantity = 0 then 0 else v_balance.moving_average_cost end;
    target_unit_cost := v_balance.moving_average_cost;
    v_total := round(target_quantity * target_unit_cost, 2);
  else raise exception using errcode='22023', message='INVENTORY_DIRECTION_INVALID';
  end if;
  insert into public.zysyr_inventory_transactions(
    company_id, store_id, product_id, business_date, transaction_type, direction,
    quantity, unit_cost, total_cost, quantity_before, quantity_after,
    average_cost_before, average_cost_after, source_type, source_id, posted_by_user_id
  ) values (target_company_id, target_store_id, target_product_id, target_business_date,
    target_transaction_type, target_direction, target_quantity, target_unit_cost, v_total,
    v_balance.quantity, v_after_quantity, v_balance.moving_average_cost, v_after_cost,
    target_source_type, target_source_id, target_actor_user_id) returning * into v_saved;
  update public.zysyr_inventory_balances set quantity=v_after_quantity,
    moving_average_cost=v_after_cost, inventory_value=round(v_after_quantity*v_after_cost,2),
    last_posting_sequence=v_saved.posting_sequence, updated_at=clock_timestamp()
  where id=v_balance.id;
  return v_saved;
end $$;

create or replace function zysyr_private.prevent_inventory_ledger_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception using errcode='42501', message='INVENTORY_LEDGER_IMMUTABLE'; end $$;
create trigger zysyr_inventory_transactions_immutable before update or delete on public.zysyr_inventory_transactions
for each row execute function zysyr_private.prevent_inventory_ledger_mutation();
create trigger zysyr_goods_receipt_lines_immutable before update or delete on public.zysyr_goods_receipt_lines
for each row execute function zysyr_private.prevent_inventory_ledger_mutation();

create or replace function public.zysyr_save_purchase_order(
  p_actor_user_id uuid, p_company_id uuid, p_store_id uuid, p_id uuid,
  p_supplier_id uuid, p_order_number text, p_order_date date, p_expected_date date,
  p_lines jsonb, p_notes text, p_reason text
) returns public.zysyr_purchase_orders language plpgsql security definer set search_path = '' as $$
declare
  v_saved public.zysyr_purchase_orders;
  v_before jsonb;
  v_line jsonb;
  v_number integer := 0;
  v_total numeric(14,2) := 0;
begin
  perform zysyr_private.assert_inventory_write_date(p_actor_user_id,p_company_id,p_store_id,p_order_date);
  if nullif(btrim(p_order_number),'') is null or nullif(btrim(p_reason),'') is null
    or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines)=0
    or p_expected_date < p_order_date then
    raise exception using errcode='22023', message='PURCHASE_ORDER_INPUT_INVALID';
  end if;
  if not exists(select 1 from public.zysyr_suppliers s where s.company_id=p_company_id and s.id=p_supplier_id and s.status='active' and s.deleted_at is null) then
    raise exception using errcode='P0002', message='SUPPLIER_NOT_FOUND';
  end if;
  if p_id is not null then
    select to_jsonb(po.*) into v_before from public.zysyr_purchase_orders po
    where po.company_id=p_company_id and po.store_id=p_store_id and po.id=p_id for update;
    if not found then raise exception using errcode='P0002', message='PURCHASE_ORDER_NOT_FOUND'; end if;
    if v_before->>'status' <> 'draft' then raise exception using errcode='55000', message='PURCHASE_ORDER_NOT_DRAFT'; end if;
    update public.zysyr_purchase_orders set supplier_id=p_supplier_id, order_number=btrim(p_order_number),
      order_date=p_order_date, expected_date=p_expected_date, notes=nullif(btrim(p_notes),''),
      updated_by_user_id=p_actor_user_id, updated_at=clock_timestamp()
    where id=p_id returning * into v_saved;
    delete from public.zysyr_purchase_order_lines where company_id=p_company_id and purchase_order_id=p_id;
  else
    insert into public.zysyr_purchase_orders(company_id,store_id,supplier_id,order_number,order_date,
      expected_date,notes,created_by_user_id,updated_by_user_id)
    values(p_company_id,p_store_id,p_supplier_id,btrim(p_order_number),p_order_date,p_expected_date,
      nullif(btrim(p_notes),''),p_actor_user_id,p_actor_user_id) returning * into v_saved;
  end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_number := v_number+1;
    if coalesce((v_line->>'quantity')::numeric,0)<=0 or coalesce((v_line->>'unit_cost')::numeric,-1)<0
      or not exists(select 1 from public.zysyr_products product where product.company_id=p_company_id
        and product.id=(v_line->>'product_id')::uuid and product.status='active' and product.deleted_at is null) then
      raise exception using errcode='22023', message='PURCHASE_ORDER_LINE_INVALID';
    end if;
    insert into public.zysyr_purchase_order_lines(company_id,store_id,purchase_order_id,line_number,
      product_id,ordered_quantity,unit_cost)
    values(p_company_id,p_store_id,v_saved.id,v_number,(v_line->>'product_id')::uuid,
      (v_line->>'quantity')::numeric,(v_line->>'unit_cost')::numeric);
    v_total := v_total + round((v_line->>'quantity')::numeric*(v_line->>'unit_cost')::numeric,2);
  end loop;
  update public.zysyr_purchase_orders set total_amount=v_total where id=v_saved.id returning * into v_saved;
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,
    entity_type,entity_id,action,before_json,after_json,reason,sensitivity)
  values(p_company_id,p_store_id,'user',p_actor_user_id,'api','purchase_order',v_saved.id,
    case when p_id is null then 'create' else 'update' end,v_before,to_jsonb(v_saved),btrim(p_reason),'financial');
  return v_saved;
end $$;

create or replace function public.zysyr_transition_purchase_order(
  p_actor_user_id uuid, p_company_id uuid, p_store_id uuid, p_purchase_order_id uuid,
  p_action text, p_reason text
) returns public.zysyr_purchase_orders language plpgsql security definer set search_path = '' as $$
declare v_before public.zysyr_purchase_orders; v_saved public.zysyr_purchase_orders; v_next text;
begin
  perform zysyr_private.assert_inventory_scope(p_actor_user_id,p_company_id,p_store_id);
  if nullif(btrim(p_reason),'') is null then raise exception using errcode='22023',message='CHANGE_REASON_REQUIRED'; end if;
  select * into v_before from public.zysyr_purchase_orders po where po.company_id=p_company_id and po.store_id=p_store_id and po.id=p_purchase_order_id for update;
  if not found then raise exception using errcode='P0002',message='PURCHASE_ORDER_NOT_FOUND'; end if;
  perform zysyr_private.assert_inventory_write_date(p_actor_user_id,p_company_id,p_store_id,v_before.order_date);
  v_next := case
    when p_action='submit' and v_before.status='draft' then 'submitted'
    when p_action='approve' and v_before.status='submitted' then 'approved'
    when p_action='reject' and v_before.status='submitted' then 'rejected'
    when p_action='cancel' and v_before.status in ('draft','submitted','approved') and v_before.receipt_status='none' then 'cancelled'
    else null end;
  if v_next is null then raise exception using errcode='55000',message='PURCHASE_ORDER_TRANSITION_INVALID'; end if;
  update public.zysyr_purchase_orders set status=v_next,
    submitted_by_user_id=case when v_next='submitted' then p_actor_user_id else submitted_by_user_id end,
    submitted_at=case when v_next='submitted' then clock_timestamp() else submitted_at end,
    approved_by_user_id=case when v_next='approved' then p_actor_user_id else approved_by_user_id end,
    approved_at=case when v_next='approved' then clock_timestamp() else approved_at end,
    decided_reason=case when v_next in ('approved','rejected','cancelled') then btrim(p_reason) else decided_reason end,
    updated_by_user_id=p_actor_user_id, updated_at=clock_timestamp()
  where id=v_before.id returning * into v_saved;
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,
    entity_type,entity_id,action,before_json,after_json,reason,sensitivity)
  values(p_company_id,p_store_id,'user',p_actor_user_id,'api','purchase_order',v_saved.id,p_action,
    to_jsonb(v_before),to_jsonb(v_saved),btrim(p_reason),'financial');
  return v_saved;
end $$;

create or replace function public.zysyr_post_goods_receipt(
  p_actor_user_id uuid, p_company_id uuid, p_store_id uuid, p_purchase_order_id uuid,
  p_receipt_number text, p_receipt_date date, p_lines jsonb, p_voucher_ids uuid[], p_reason text
) returns public.zysyr_goods_receipts language plpgsql security definer set search_path = '' as $$
declare
  v_order public.zysyr_purchase_orders; v_receipt public.zysyr_goods_receipts;
  v_po_line public.zysyr_purchase_order_lines; v_receipt_line public.zysyr_goods_receipt_lines;
  v_tx public.zysyr_inventory_transactions; v_line jsonb; v_qty numeric(14,4);
  v_received numeric(14,4); v_total numeric(14,2):=0; v_complete boolean;
begin
  perform zysyr_private.assert_inventory_write_date(p_actor_user_id,p_company_id,p_store_id,p_receipt_date);
  perform zysyr_private.assert_approved_vouchers(p_company_id,p_store_id,p_voucher_ids);
  if nullif(btrim(p_receipt_number),'') is null or nullif(btrim(p_reason),'') is null
    or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then
    raise exception using errcode='22023',message='GOODS_RECEIPT_INPUT_INVALID';
  end if;
  select * into v_order from public.zysyr_purchase_orders po where po.company_id=p_company_id and po.store_id=p_store_id and po.id=p_purchase_order_id for update;
  if not found or v_order.status<>'approved' then raise exception using errcode='55000',message='PURCHASE_ORDER_NOT_APPROVED'; end if;
  insert into public.zysyr_goods_receipts(company_id,store_id,purchase_order_id,receipt_number,receipt_date,
    total_amount,posted_by_user_id) values(p_company_id,p_store_id,p_purchase_order_id,btrim(p_receipt_number),
    p_receipt_date,0,p_actor_user_id) returning * into v_receipt;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_qty := coalesce((v_line->>'quantity')::numeric,0);
    select * into v_po_line from public.zysyr_purchase_order_lines pol
      where pol.company_id=p_company_id and pol.store_id=p_store_id and pol.id=(v_line->>'purchase_order_line_id')::uuid
        and pol.purchase_order_id=p_purchase_order_id for update;
    if not found or v_qty<=0 then raise exception using errcode='22023',message='GOODS_RECEIPT_LINE_INVALID'; end if;
    select coalesce(sum(grl.quantity),0) into v_received from public.zysyr_goods_receipt_lines grl
      join public.zysyr_goods_receipts gr on gr.id=grl.goods_receipt_id and gr.company_id=grl.company_id
      where grl.company_id=p_company_id and grl.purchase_order_line_id=v_po_line.id and gr.status='posted';
    if v_received+v_qty>v_po_line.ordered_quantity then raise exception using errcode='23514',message='RECEIPT_EXCEEDS_ORDER'; end if;
    insert into public.zysyr_goods_receipt_lines(company_id,store_id,goods_receipt_id,purchase_order_line_id,
      product_id,quantity,unit_cost) values(p_company_id,p_store_id,v_receipt.id,v_po_line.id,
      v_po_line.product_id,v_qty,v_po_line.unit_cost) returning * into v_receipt_line;
    v_tx := zysyr_private.post_inventory_transaction(p_actor_user_id,p_company_id,p_store_id,
      v_po_line.product_id,p_receipt_date,'purchase_receipt','in',v_qty,v_po_line.unit_cost,
      'goods_receipt_line',v_receipt_line.id);
    insert into public.zysyr_trace_nodes(company_id,store_id,entity_type,entity_id)
      values(p_company_id,p_store_id,'goods_receipt_line',v_receipt_line.id),
            (p_company_id,p_store_id,'purchase_order_line',v_po_line.id),
            (p_company_id,p_store_id,'inventory_transaction',v_tx.id)
      on conflict(company_id,entity_type,entity_id) do nothing;
    insert into public.zysyr_trace_edges(company_id,store_id,from_node_id,to_node_id,relation_type,created_by_user_id)
      select p_company_id,p_store_id,a.id,b.id,'derived_from',p_actor_user_id
      from public.zysyr_trace_nodes a, public.zysyr_trace_nodes b
      where a.company_id=p_company_id and a.entity_type='goods_receipt_line' and a.entity_id=v_receipt_line.id
        and b.company_id=p_company_id and b.entity_type='purchase_order_line' and b.entity_id=v_po_line.id
      on conflict(company_id,from_node_id,to_node_id,relation_type) do nothing;
    insert into public.zysyr_trace_edges(company_id,store_id,from_node_id,to_node_id,relation_type,created_by_user_id)
      select p_company_id,p_store_id,b.id,a.id,'derived_from',p_actor_user_id
      from public.zysyr_trace_nodes a, public.zysyr_trace_nodes b
      where a.company_id=p_company_id and a.entity_type='goods_receipt_line' and a.entity_id=v_receipt_line.id
        and b.company_id=p_company_id and b.entity_type='inventory_transaction' and b.entity_id=v_tx.id
      on conflict(company_id,from_node_id,to_node_id,relation_type) do nothing;
    v_total:=v_total+round(v_qty*v_po_line.unit_cost,2);
  end loop;
  update public.zysyr_goods_receipts set total_amount=v_total where id=v_receipt.id returning * into v_receipt;
  select bool_and(received>=ordered_quantity) into v_complete from (
    select pol.ordered_quantity, coalesce(sum(grl.quantity) filter(where gr.status='posted'),0) received
    from public.zysyr_purchase_order_lines pol
    left join public.zysyr_goods_receipt_lines grl on grl.company_id=pol.company_id and grl.purchase_order_line_id=pol.id
    left join public.zysyr_goods_receipts gr on gr.company_id=grl.company_id and gr.id=grl.goods_receipt_id
    where pol.company_id=p_company_id and pol.purchase_order_id=p_purchase_order_id group by pol.id
  ) totals;
  update public.zysyr_purchase_orders set receipt_status=case when v_complete then 'complete' else 'partial' end,
    updated_by_user_id=p_actor_user_id,updated_at=clock_timestamp() where id=p_purchase_order_id;
  perform zysyr_private.link_finance_vouchers(p_actor_user_id,p_company_id,p_store_id,
    'goods_receipt',v_receipt.id,p_voucher_ids,'source_document',p_reason);
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,
    entity_type,entity_id,action,after_json,reason,sensitivity)
  values(p_company_id,p_store_id,'user',p_actor_user_id,'api','goods_receipt',v_receipt.id,
    'post',to_jsonb(v_receipt),btrim(p_reason),'financial');
  return v_receipt;
end $$;

create or replace function public.zysyr_record_usage(
  p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_product_id uuid,p_employee_id uuid,
  p_usage_date date,p_usage_type text,p_quantity numeric,p_notes text,p_voucher_ids uuid[],p_reason text
) returns public.zysyr_usage_records language plpgsql security definer set search_path='' as $$
declare v_record public.zysyr_usage_records; v_tx public.zysyr_inventory_transactions; v_balance public.zysyr_inventory_balances;
begin
  perform zysyr_private.assert_inventory_write_date(p_actor_user_id,p_company_id,p_store_id,p_usage_date);
  perform zysyr_private.assert_approved_vouchers(p_company_id,p_store_id,p_voucher_ids);
  if p_usage_type not in ('salon_service','daily_consumable','damage','other') or p_quantity is null or p_quantity<=0
    or nullif(btrim(p_reason),'') is null then raise exception using errcode='22023',message='USAGE_INPUT_INVALID'; end if;
  v_balance:=zysyr_private.lock_inventory_balance(p_company_id,p_store_id,p_product_id);
  if v_balance.quantity<p_quantity then raise exception using errcode='23514',message='INSUFFICIENT_INVENTORY'; end if;
  insert into public.zysyr_usage_records(company_id,store_id,product_id,employee_id,usage_date,usage_type,
    quantity,unit_cost,total_cost,notes,confirmed_by_user_id)
  values(p_company_id,p_store_id,p_product_id,p_employee_id,p_usage_date,p_usage_type,p_quantity,
    v_balance.moving_average_cost,round(p_quantity*v_balance.moving_average_cost,2),nullif(btrim(p_notes),''),p_actor_user_id)
  returning * into v_record;
  v_tx:=zysyr_private.post_inventory_transaction(p_actor_user_id,p_company_id,p_store_id,p_product_id,p_usage_date,
    case when p_usage_type='damage' then 'damage' else 'usage' end,'out',p_quantity,v_balance.moving_average_cost,
    'usage_record',v_record.id);
  update public.zysyr_usage_records set inventory_transaction_id=v_tx.id where id=v_record.id returning * into v_record;
  perform zysyr_private.link_finance_vouchers(p_actor_user_id,p_company_id,p_store_id,'usage_record',v_record.id,p_voucher_ids,'source_document',p_reason);
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,after_json,reason,sensitivity)
  values(p_company_id,p_store_id,'user',p_actor_user_id,'api','usage_record',v_record.id,'confirm',to_jsonb(v_record),btrim(p_reason),'financial');
  return v_record;
end $$;

create or replace function public.zysyr_record_employee_purchase(
  p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_employee_id uuid,p_product_id uuid,
  p_purchase_date date,p_quantity numeric,p_unit_price numeric,p_notes text,p_voucher_ids uuid[],p_reason text
) returns public.zysyr_employee_purchases language plpgsql security definer set search_path='' as $$
declare v_record public.zysyr_employee_purchases; v_tx public.zysyr_inventory_transactions; v_balance public.zysyr_inventory_balances;
begin
  perform zysyr_private.assert_inventory_write_date(p_actor_user_id,p_company_id,p_store_id,p_purchase_date);
  perform zysyr_private.assert_approved_vouchers(p_company_id,p_store_id,p_voucher_ids);
  if p_quantity is null or p_quantity<=0 or p_unit_price is null or p_unit_price<0 or nullif(btrim(p_reason),'') is null then
    raise exception using errcode='22023',message='EMPLOYEE_PURCHASE_INPUT_INVALID'; end if;
  v_balance:=zysyr_private.lock_inventory_balance(p_company_id,p_store_id,p_product_id);
  if v_balance.quantity<p_quantity then raise exception using errcode='23514',message='INSUFFICIENT_INVENTORY'; end if;
  insert into public.zysyr_employee_purchases(company_id,store_id,employee_id,product_id,purchase_date,quantity,
    unit_price,amount,inventory_unit_cost,inventory_cost,approved_by_user_id,notes)
  values(p_company_id,p_store_id,p_employee_id,p_product_id,p_purchase_date,p_quantity,p_unit_price,
    round(p_quantity*p_unit_price,2),v_balance.moving_average_cost,round(p_quantity*v_balance.moving_average_cost,2),
    p_actor_user_id,nullif(btrim(p_notes),'')) returning * into v_record;
  v_tx:=zysyr_private.post_inventory_transaction(p_actor_user_id,p_company_id,p_store_id,p_product_id,p_purchase_date,
    'employee_purchase','out',p_quantity,v_balance.moving_average_cost,'employee_purchase',v_record.id);
  update public.zysyr_employee_purchases set inventory_transaction_id=v_tx.id where id=v_record.id returning * into v_record;
  perform zysyr_private.link_finance_vouchers(p_actor_user_id,p_company_id,p_store_id,'employee_purchase',v_record.id,p_voucher_ids,'source_document',p_reason);
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,after_json,reason,sensitivity)
  values(p_company_id,p_store_id,'user',p_actor_user_id,'api','employee_purchase',v_record.id,'approve',to_jsonb(v_record),btrim(p_reason),'financial');
  return v_record;
end $$;

create or replace function public.zysyr_confirm_employee_purchase_payment(
  p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_employee_purchase_id uuid,
  p_payment_date date,p_amount numeric,p_payment_method text,p_payment_reference text,
  p_voucher_ids uuid[],p_reason text
) returns public.zysyr_employee_purchase_payments language plpgsql security definer set search_path='' as $$
declare v_purchase public.zysyr_employee_purchases; v_payment public.zysyr_employee_purchase_payments; v_paid numeric(14,2);
begin
  perform zysyr_private.assert_inventory_write_date(p_actor_user_id,p_company_id,p_store_id,p_payment_date);
  perform zysyr_private.assert_approved_vouchers(p_company_id,p_store_id,p_voucher_ids);
  if p_amount is null or p_amount<=0 or nullif(btrim(p_payment_method),'') is null or nullif(btrim(p_reason),'') is null then
    raise exception using errcode='22023',message='EMPLOYEE_PURCHASE_PAYMENT_INVALID'; end if;
  select * into v_purchase from public.zysyr_employee_purchases ep where ep.company_id=p_company_id and ep.store_id=p_store_id and ep.id=p_employee_purchase_id for update;
  if not found or v_purchase.status<>'approved' then raise exception using errcode='P0002',message='EMPLOYEE_PURCHASE_NOT_FOUND'; end if;
  select coalesce(sum(amount),0) into v_paid from public.zysyr_employee_purchase_payments
    where company_id=p_company_id and store_id=p_store_id and employee_purchase_id=p_employee_purchase_id and status='confirmed';
  if v_paid+p_amount>v_purchase.amount then raise exception using errcode='23514',message='PAYMENT_EXCEEDS_EMPLOYEE_PURCHASE'; end if;
  insert into public.zysyr_employee_purchase_payments(company_id,store_id,employee_purchase_id,payment_date,
    amount,payment_method,payment_reference,confirmed_by_user_id)
  values(p_company_id,p_store_id,p_employee_purchase_id,p_payment_date,p_amount,btrim(p_payment_method),
    nullif(btrim(p_payment_reference),''),p_actor_user_id) returning * into v_payment;
  v_paid:=v_paid+p_amount;
  update public.zysyr_employee_purchases set paid_amount=v_paid,payment_status=case when v_paid=amount then 'paid' else 'partial' end
    where id=p_employee_purchase_id;
  perform zysyr_private.link_finance_vouchers(p_actor_user_id,p_company_id,p_store_id,'employee_purchase_payment',v_payment.id,p_voucher_ids,'payment_proof',p_reason);
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,after_json,reason,sensitivity)
  values(p_company_id,p_store_id,'user',p_actor_user_id,'api','employee_purchase_payment',v_payment.id,'confirm',to_jsonb(v_payment),btrim(p_reason),'financial');
  return v_payment;
end $$;

create or replace function public.zysyr_post_stock_transfer(
  p_actor_user_id uuid,p_company_id uuid,p_source_store_id uuid,p_destination_store_id uuid,
  p_transfer_number text,p_transfer_date date,p_lines jsonb,p_notes text,p_voucher_ids uuid[],p_reason text
) returns public.zysyr_stock_transfers language plpgsql security definer set search_path='' as $$
declare v_transfer public.zysyr_stock_transfers; v_line jsonb; v_product uuid; v_quantity numeric(14,4);
  v_balance public.zysyr_inventory_balances; v_out public.zysyr_inventory_transactions; v_in public.zysyr_inventory_transactions;
  v_number integer:=0; v_total numeric(14,2):=0; v_transfer_line public.zysyr_stock_transfer_lines;
begin
  perform zysyr_private.assert_inventory_write_date(p_actor_user_id,p_company_id,p_source_store_id,p_transfer_date);
  perform zysyr_private.assert_inventory_write_date(p_actor_user_id,p_company_id,p_destination_store_id,p_transfer_date);
  perform zysyr_private.assert_approved_vouchers(p_company_id,p_source_store_id,p_voucher_ids);
  if p_source_store_id=p_destination_store_id or nullif(btrim(p_transfer_number),'') is null
    or nullif(btrim(p_reason),'') is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then
    raise exception using errcode='22023',message='STOCK_TRANSFER_INPUT_INVALID'; end if;
  insert into public.zysyr_stock_transfers(company_id,source_store_id,destination_store_id,transfer_number,
    transfer_date,total_cost,notes,posted_by_user_id)
  values(p_company_id,p_source_store_id,p_destination_store_id,btrim(p_transfer_number),p_transfer_date,0,
    nullif(btrim(p_notes),''),p_actor_user_id) returning * into v_transfer;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_number:=v_number+1; v_product:=(v_line->>'product_id')::uuid; v_quantity:=coalesce((v_line->>'quantity')::numeric,0);
    if v_quantity<=0 or not exists(select 1 from public.zysyr_products product where product.company_id=p_company_id and product.id=v_product and product.status='active' and product.deleted_at is null) then
      raise exception using errcode='22023',message='STOCK_TRANSFER_LINE_INVALID'; end if;
    perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':'||v_product::text||':'||least(p_source_store_id,p_destination_store_id)::text||':'||greatest(p_source_store_id,p_destination_store_id)::text,0));
    v_balance:=zysyr_private.lock_inventory_balance(p_company_id,p_source_store_id,v_product);
    if v_balance.quantity<v_quantity then raise exception using errcode='23514',message='INSUFFICIENT_INVENTORY'; end if;
    insert into public.zysyr_stock_transfer_lines(company_id,source_store_id,stock_transfer_id,line_number,product_id,
      quantity,unit_cost,total_cost)
    values(p_company_id,p_source_store_id,v_transfer.id,v_number,v_product,v_quantity,v_balance.moving_average_cost,
      round(v_quantity*v_balance.moving_average_cost,2))
    returning * into v_transfer_line;
    v_out:=zysyr_private.post_inventory_transaction(p_actor_user_id,p_company_id,p_source_store_id,v_product,p_transfer_date,
      'transfer_out','out',v_quantity,v_balance.moving_average_cost,'stock_transfer_line',v_transfer_line.id);
    v_in:=zysyr_private.post_inventory_transaction(p_actor_user_id,p_company_id,p_destination_store_id,v_product,p_transfer_date,
      'transfer_in','in',v_quantity,v_out.unit_cost,'stock_transfer_line',v_transfer_line.id);
    update public.zysyr_stock_transfer_lines set source_transaction_id=v_out.id,destination_transaction_id=v_in.id
      where id=v_transfer_line.id;
    v_total:=v_total+v_out.total_cost;
  end loop;
  update public.zysyr_stock_transfers set total_cost=v_total where id=v_transfer.id returning * into v_transfer;
  perform zysyr_private.link_finance_vouchers(p_actor_user_id,p_company_id,p_source_store_id,'stock_transfer',v_transfer.id,p_voucher_ids,'source_document',p_reason);
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,after_json,reason,sensitivity)
  values(p_company_id,p_source_store_id,'user',p_actor_user_id,'api','stock_transfer',v_transfer.id,'post',to_jsonb(v_transfer),btrim(p_reason),'financial');
  return v_transfer;
end $$;

create or replace function public.zysyr_confirm_purchase_payment(
  p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_purchase_order_id uuid,
  p_payment_date date,p_amount numeric,p_payment_method text,p_payment_reference text,
  p_voucher_ids uuid[],p_reason text
) returns public.zysyr_payment_records language plpgsql security definer set search_path='' as $$
declare v_order public.zysyr_purchase_orders; v_paid numeric(14,2); v_saved public.zysyr_payment_records; v_supplier text;
begin
  perform zysyr_private.assert_finance_scope(p_actor_user_id,p_company_id,p_store_id,'payment.confirm');
  if zysyr_private.period_is_locked(p_company_id,p_store_id,p_payment_date) then raise exception using errcode='55000',message='FINANCE_PERIOD_LOCKED'; end if;
  perform zysyr_private.assert_approved_vouchers(p_company_id,p_store_id,p_voucher_ids);
  if p_amount is null or p_amount<=0 or nullif(btrim(p_payment_method),'') is null or nullif(btrim(p_reason),'') is null then
    raise exception using errcode='22023',message='PURCHASE_PAYMENT_INPUT_INVALID'; end if;
  select po.* into v_order from public.zysyr_purchase_orders po
    where po.company_id=p_company_id and po.store_id=p_store_id and po.id=p_purchase_order_id and po.status='approved' for update;
  if not found then raise exception using errcode='P0002',message='APPROVED_PURCHASE_ORDER_NOT_FOUND'; end if;
  select s.name into v_supplier from public.zysyr_suppliers s
    where s.company_id=p_company_id and s.id=v_order.supplier_id;
  select coalesce(sum(amount),0) into v_paid from public.zysyr_payment_records
    where company_id=p_company_id and store_id=p_store_id and business_type='purchase' and business_id=p_purchase_order_id and status='confirmed';
  if v_paid+p_amount>v_order.total_amount then raise exception using errcode='23514',message='PAYMENT_EXCEEDS_PURCHASE_ORDER'; end if;
  insert into public.zysyr_payment_records(company_id,store_id,payment_date,business_type,business_id,payee,
    amount,payment_method,payment_reference,confirmed_by_user_id)
  values(p_company_id,p_store_id,p_payment_date,'purchase',p_purchase_order_id,v_supplier,p_amount,
    btrim(p_payment_method),nullif(btrim(p_payment_reference),''),p_actor_user_id) returning * into v_saved;
  v_paid:=v_paid+p_amount;
  update public.zysyr_purchase_orders set payment_status=case when v_paid=total_amount then 'paid' else 'partial' end,
    updated_by_user_id=p_actor_user_id,updated_at=clock_timestamp() where id=p_purchase_order_id;
  perform zysyr_private.link_finance_vouchers(p_actor_user_id,p_company_id,p_store_id,'payment_record',v_saved.id,p_voucher_ids,'payment_proof',p_reason);
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,after_json,reason,sensitivity)
  values(p_company_id,p_store_id,'user',p_actor_user_id,'api','payment_record',v_saved.id,'purchase_payment_confirm',to_jsonb(v_saved),btrim(p_reason),'financial');
  return v_saved;
end $$;

create or replace function zysyr_private.reverse_inventory_transaction(
  target_actor_user_id uuid,target_company_id uuid,target_store_id uuid,target_transaction_id uuid,target_reason text
) returns public.zysyr_inventory_transactions language plpgsql security definer set search_path='' as $$
declare v_original public.zysyr_inventory_transactions; v_balance public.zysyr_inventory_balances; v_reversal public.zysyr_inventory_transactions;
begin
  select * into v_original from public.zysyr_inventory_transactions tx where tx.company_id=target_company_id and tx.store_id=target_store_id and tx.id=target_transaction_id for update;
  if not found or v_original.status<>'posted' then raise exception using errcode='P0002',message='POSTED_INVENTORY_TRANSACTION_NOT_FOUND'; end if;
  perform zysyr_private.assert_inventory_write_date(target_actor_user_id,target_company_id,target_store_id,v_original.business_date);
  v_balance:=zysyr_private.lock_inventory_balance(target_company_id,target_store_id,v_original.product_id);
  if v_balance.last_posting_sequence<>v_original.posting_sequence then
    raise exception using errcode='55000',message='INVENTORY_REVERSAL_REQUIRES_LATEST_TRANSACTION';
  end if;
  insert into public.zysyr_inventory_transactions(company_id,store_id,product_id,business_date,transaction_type,direction,
    quantity,unit_cost,total_cost,quantity_before,quantity_after,average_cost_before,average_cost_after,
    source_type,source_id,reversal_of_id,posted_by_user_id)
  values(target_company_id,target_store_id,v_original.product_id,current_date,'reversal',
    case when v_original.direction='in' then 'out' else 'in' end,v_original.quantity,v_original.unit_cost,v_original.total_cost,
    v_balance.quantity,v_original.quantity_before,v_balance.moving_average_cost,v_original.average_cost_before,
    'inventory_transaction',v_original.id,v_original.id,target_actor_user_id) returning * into v_reversal;
  perform set_config('zysyr.inventory_reversal','on',true);
  update public.zysyr_inventory_transactions set status='reversed',reversed_by_user_id=target_actor_user_id,
    reversed_at=clock_timestamp(),reverse_reason=btrim(target_reason) where id=v_original.id;
  update public.zysyr_inventory_balances set quantity=v_original.quantity_before,moving_average_cost=v_original.average_cost_before,
    inventory_value=round(v_original.quantity_before*v_original.average_cost_before,2),
    last_posting_sequence=v_reversal.posting_sequence,updated_at=clock_timestamp() where id=v_balance.id;
  return v_reversal;
end $$;

create or replace function zysyr_private.prevent_inventory_ledger_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and current_setting('zysyr.inventory_reversal',true)='on'
    and old.status='posted' and new.status='reversed'
    and new.company_id=old.company_id and new.store_id=old.store_id and new.product_id=old.product_id
    and new.posting_sequence=old.posting_sequence and new.quantity=old.quantity and new.unit_cost=old.unit_cost
    and new.source_type=old.source_type and new.source_id=old.source_id then return new; end if;
  raise exception using errcode='42501',message='INVENTORY_LEDGER_IMMUTABLE';
end $$;

create or replace function public.zysyr_reverse_inventory_record(
  p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_business_type text,p_business_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_tx public.zysyr_inventory_transactions; v_row record; v_result jsonb; v_order_id uuid; v_paid numeric; v_destination_store_id uuid;
begin
  perform zysyr_private.assert_inventory_scope(p_actor_user_id,p_company_id,p_store_id);
  if nullif(btrim(p_reason),'') is null then raise exception using errcode='22023',message='REVERSE_REASON_REQUIRED'; end if;
  if p_business_type='usage_record' then
    select tx.* into v_tx from public.zysyr_usage_records r join public.zysyr_inventory_transactions tx on tx.id=r.inventory_transaction_id
      where r.company_id=p_company_id and r.store_id=p_store_id and r.id=p_business_id and r.status='confirmed' for update of r;
    if not found then raise exception using errcode='P0002',message='USAGE_RECORD_NOT_FOUND'; end if;
    perform zysyr_private.reverse_inventory_transaction(p_actor_user_id,p_company_id,p_store_id,v_tx.id,p_reason);
    update public.zysyr_usage_records set status='reversed',reversed_by_user_id=p_actor_user_id,reversed_at=clock_timestamp(),reverse_reason=btrim(p_reason) where id=p_business_id returning to_jsonb(zysyr_usage_records.*) into v_result;
  elsif p_business_type='employee_purchase' then
    select coalesce(sum(amount),0) into v_paid from public.zysyr_employee_purchase_payments where company_id=p_company_id and store_id=p_store_id and employee_purchase_id=p_business_id and status='confirmed';
    if v_paid>0 then raise exception using errcode='55000',message='EMPLOYEE_PURCHASE_HAS_PAYMENT'; end if;
    select tx.* into v_tx from public.zysyr_employee_purchases r join public.zysyr_inventory_transactions tx on tx.id=r.inventory_transaction_id
      where r.company_id=p_company_id and r.store_id=p_store_id and r.id=p_business_id and r.status='approved' for update of r;
    if not found then raise exception using errcode='P0002',message='EMPLOYEE_PURCHASE_NOT_FOUND'; end if;
    perform zysyr_private.reverse_inventory_transaction(p_actor_user_id,p_company_id,p_store_id,v_tx.id,p_reason);
    update public.zysyr_employee_purchases set status='reversed',reversed_by_user_id=p_actor_user_id,reversed_at=clock_timestamp(),reverse_reason=btrim(p_reason) where id=p_business_id returning to_jsonb(zysyr_employee_purchases.*) into v_result;
  elsif p_business_type='goods_receipt' then
    select purchase_order_id into v_order_id from public.zysyr_goods_receipts where company_id=p_company_id and store_id=p_store_id and id=p_business_id and status='posted' for update;
    if not found then raise exception using errcode='P0002',message='GOODS_RECEIPT_NOT_FOUND'; end if;
    for v_row in select tx.id from public.zysyr_goods_receipt_lines line join public.zysyr_inventory_transactions tx
      on tx.company_id=line.company_id and tx.source_type='goods_receipt_line' and tx.source_id=line.id and tx.status='posted'
      where line.company_id=p_company_id and line.store_id=p_store_id and line.goods_receipt_id=p_business_id
      order by tx.posting_sequence desc loop
      perform zysyr_private.reverse_inventory_transaction(p_actor_user_id,p_company_id,p_store_id,v_row.id,p_reason);
    end loop;
    update public.zysyr_goods_receipts set status='reversed',reversed_by_user_id=p_actor_user_id,reversed_at=clock_timestamp(),reverse_reason=btrim(p_reason) where id=p_business_id returning to_jsonb(zysyr_goods_receipts.*) into v_result;
    update public.zysyr_purchase_orders po set receipt_status=case when exists(
      select 1 from public.zysyr_goods_receipts gr where gr.company_id=p_company_id and gr.purchase_order_id=v_order_id and gr.status='posted') then 'partial' else 'none' end,
      updated_by_user_id=p_actor_user_id,updated_at=clock_timestamp() where po.id=v_order_id;
  elsif p_business_type='stock_transfer' then
    select destination_store_id into v_destination_store_id from public.zysyr_stock_transfers transfer
      where transfer.company_id=p_company_id and transfer.source_store_id=p_store_id and transfer.id=p_business_id and transfer.status='posted' for update;
    if not found then raise exception using errcode='P0002',message='STOCK_TRANSFER_NOT_FOUND'; end if;
    perform zysyr_private.assert_inventory_scope(p_actor_user_id,p_company_id,v_destination_store_id);
    for v_row in select source_transaction_id,destination_transaction_id from public.zysyr_stock_transfer_lines
      where company_id=p_company_id and source_store_id=p_store_id and stock_transfer_id=p_business_id order by line_number desc loop
      perform zysyr_private.reverse_inventory_transaction(p_actor_user_id,p_company_id,v_destination_store_id,v_row.destination_transaction_id,p_reason);
      perform zysyr_private.reverse_inventory_transaction(p_actor_user_id,p_company_id,p_store_id,v_row.source_transaction_id,p_reason);
    end loop;
    update public.zysyr_stock_transfers set status='reversed',reversed_by_user_id=p_actor_user_id,reversed_at=clock_timestamp(),reverse_reason=btrim(p_reason)
      where id=p_business_id returning to_jsonb(zysyr_stock_transfers.*) into v_result;
  else raise exception using errcode='22023',message='INVENTORY_BUSINESS_TYPE_INVALID'; end if;
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,after_json,reason,sensitivity)
  values(p_company_id,p_store_id,'user',p_actor_user_id,'api',p_business_type,p_business_id,'reverse',v_result,btrim(p_reason),'financial');
  return v_result;
end $$;

create or replace function public.zysyr_reverse_inventory_payment(
  p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_payment_type text,p_payment_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_payment public.zysyr_payment_records; v_employee_payment public.zysyr_employee_purchase_payments;
  v_purchase_id uuid; v_paid numeric(14,2); v_total numeric(14,2); v_result jsonb;
begin
  if nullif(btrim(p_reason),'') is null then raise exception using errcode='22023',message='REVERSE_REASON_REQUIRED'; end if;
  if p_payment_type='purchase' then
    perform zysyr_private.assert_finance_scope(p_actor_user_id,p_company_id,p_store_id,'payment.confirm');
    select * into v_payment from public.zysyr_payment_records payment where payment.company_id=p_company_id and payment.store_id=p_store_id
      and payment.id=p_payment_id and payment.business_type='purchase' and payment.status='confirmed' for update;
    if not found then raise exception using errcode='P0002',message='PURCHASE_PAYMENT_NOT_FOUND'; end if;
    if zysyr_private.period_is_locked(p_company_id,p_store_id,v_payment.payment_date) then raise exception using errcode='55000',message='FINANCE_PERIOD_LOCKED'; end if;
    update public.zysyr_payment_records set status='reversed',reversed_by_user_id=p_actor_user_id,reversed_at=clock_timestamp(),reverse_reason=btrim(p_reason)
      where id=p_payment_id returning to_jsonb(zysyr_payment_records.*) into v_result;
    v_purchase_id:=v_payment.business_id;
    select coalesce(sum(amount),0) into v_paid from public.zysyr_payment_records where company_id=p_company_id and store_id=p_store_id
      and business_type='purchase' and business_id=v_purchase_id and status='confirmed';
    select total_amount into v_total from public.zysyr_purchase_orders where company_id=p_company_id and store_id=p_store_id and id=v_purchase_id for update;
    update public.zysyr_purchase_orders set payment_status=case when v_paid=0 then 'unpaid' when v_paid=v_total then 'paid' else 'partial' end,
      updated_by_user_id=p_actor_user_id,updated_at=clock_timestamp() where id=v_purchase_id;
  elsif p_payment_type='employee_purchase' then
    perform zysyr_private.assert_inventory_scope(p_actor_user_id,p_company_id,p_store_id);
    select * into v_employee_payment from public.zysyr_employee_purchase_payments payment where payment.company_id=p_company_id and payment.store_id=p_store_id
      and payment.id=p_payment_id and payment.status='confirmed' for update;
    if not found then raise exception using errcode='P0002',message='EMPLOYEE_PURCHASE_PAYMENT_NOT_FOUND'; end if;
    if zysyr_private.period_is_locked(p_company_id,p_store_id,v_employee_payment.payment_date) then raise exception using errcode='55000',message='FINANCE_PERIOD_LOCKED'; end if;
    update public.zysyr_employee_purchase_payments set status='reversed',reversed_by_user_id=p_actor_user_id,reversed_at=clock_timestamp(),reverse_reason=btrim(p_reason)
      where id=p_payment_id returning to_jsonb(zysyr_employee_purchase_payments.*) into v_result;
    v_purchase_id:=v_employee_payment.employee_purchase_id;
    select coalesce(sum(amount),0) into v_paid from public.zysyr_employee_purchase_payments where company_id=p_company_id and store_id=p_store_id
      and employee_purchase_id=v_purchase_id and status='confirmed';
    select amount into v_total from public.zysyr_employee_purchases where company_id=p_company_id and store_id=p_store_id and id=v_purchase_id for update;
    update public.zysyr_employee_purchases set paid_amount=v_paid,payment_status=case when v_paid=0 then 'unpaid' when v_paid=v_total then 'paid' else 'partial' end
      where id=v_purchase_id;
  else raise exception using errcode='22023',message='INVENTORY_PAYMENT_TYPE_INVALID'; end if;
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,after_json,reason,sensitivity)
  values(p_company_id,p_store_id,'user',p_actor_user_id,'api',p_payment_type||'_payment',p_payment_id,'reverse',v_result,btrim(p_reason),'financial');
  return v_result;
end $$;

revoke execute on function zysyr_private.assert_inventory_scope(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke execute on function zysyr_private.assert_inventory_write_date(uuid,uuid,uuid,date) from public,anon,authenticated,service_role;
revoke execute on function zysyr_private.lock_inventory_balance(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke execute on function zysyr_private.post_inventory_transaction(uuid,uuid,uuid,uuid,date,text,text,numeric,numeric,text,uuid) from public,anon,authenticated,service_role;
revoke execute on function zysyr_private.reverse_inventory_transaction(uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;

revoke execute on function public.zysyr_save_purchase_order(uuid,uuid,uuid,uuid,uuid,text,date,date,jsonb,text,text) from public,anon,authenticated,service_role;
revoke execute on function public.zysyr_transition_purchase_order(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
revoke execute on function public.zysyr_post_goods_receipt(uuid,uuid,uuid,uuid,text,date,jsonb,uuid[],text) from public,anon,authenticated,service_role;
revoke execute on function public.zysyr_record_usage(uuid,uuid,uuid,uuid,uuid,date,text,numeric,text,uuid[],text) from public,anon,authenticated,service_role;
revoke execute on function public.zysyr_record_employee_purchase(uuid,uuid,uuid,uuid,uuid,date,numeric,numeric,text,uuid[],text) from public,anon,authenticated,service_role;
revoke execute on function public.zysyr_confirm_employee_purchase_payment(uuid,uuid,uuid,uuid,date,numeric,text,text,uuid[],text) from public,anon,authenticated,service_role;
revoke execute on function public.zysyr_confirm_purchase_payment(uuid,uuid,uuid,uuid,date,numeric,text,text,uuid[],text) from public,anon,authenticated,service_role;
revoke execute on function public.zysyr_reverse_inventory_record(uuid,uuid,uuid,text,uuid,text) from public,anon,authenticated,service_role;
revoke execute on function public.zysyr_post_stock_transfer(uuid,uuid,uuid,uuid,text,date,jsonb,text,uuid[],text) from public,anon,authenticated,service_role;
revoke execute on function public.zysyr_reverse_inventory_payment(uuid,uuid,uuid,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.zysyr_save_purchase_order(uuid,uuid,uuid,uuid,uuid,text,date,date,jsonb,text,text) to service_role;
grant execute on function public.zysyr_transition_purchase_order(uuid,uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.zysyr_post_goods_receipt(uuid,uuid,uuid,uuid,text,date,jsonb,uuid[],text) to service_role;
grant execute on function public.zysyr_record_usage(uuid,uuid,uuid,uuid,uuid,date,text,numeric,text,uuid[],text) to service_role;
grant execute on function public.zysyr_record_employee_purchase(uuid,uuid,uuid,uuid,uuid,date,numeric,numeric,text,uuid[],text) to service_role;
grant execute on function public.zysyr_confirm_employee_purchase_payment(uuid,uuid,uuid,uuid,date,numeric,text,text,uuid[],text) to service_role;
grant execute on function public.zysyr_confirm_purchase_payment(uuid,uuid,uuid,uuid,date,numeric,text,text,uuid[],text) to service_role;
grant execute on function public.zysyr_reverse_inventory_record(uuid,uuid,uuid,text,uuid,text) to service_role;
grant execute on function public.zysyr_post_stock_transfer(uuid,uuid,uuid,uuid,text,date,jsonb,text,uuid[],text) to service_role;
grant execute on function public.zysyr_reverse_inventory_payment(uuid,uuid,uuid,text,uuid,text) to service_role;

alter table public.zysyr_purchase_orders enable row level security;
alter table public.zysyr_purchase_orders force row level security;
alter table public.zysyr_purchase_order_lines enable row level security;
alter table public.zysyr_purchase_order_lines force row level security;
alter table public.zysyr_goods_receipts enable row level security;
alter table public.zysyr_goods_receipts force row level security;
alter table public.zysyr_goods_receipt_lines enable row level security;
alter table public.zysyr_goods_receipt_lines force row level security;
alter table public.zysyr_inventory_balances enable row level security;
alter table public.zysyr_inventory_balances force row level security;
alter table public.zysyr_inventory_transactions enable row level security;
alter table public.zysyr_inventory_transactions force row level security;
alter table public.zysyr_usage_records enable row level security;
alter table public.zysyr_usage_records force row level security;
alter table public.zysyr_employee_purchases enable row level security;
alter table public.zysyr_employee_purchases force row level security;
alter table public.zysyr_employee_purchase_payments enable row level security;
alter table public.zysyr_employee_purchase_payments force row level security;
alter table public.zysyr_stock_transfers enable row level security;
alter table public.zysyr_stock_transfers force row level security;
alter table public.zysyr_stock_transfer_lines enable row level security;
alter table public.zysyr_stock_transfer_lines force row level security;

create policy zysyr_purchase_orders_scope_select on public.zysyr_purchase_orders for select to authenticated using ((select zysyr_private.has_capability(company_id,store_id,'dashboard.store.read')));
create policy zysyr_purchase_order_lines_scope_select on public.zysyr_purchase_order_lines for select to authenticated using ((select zysyr_private.has_capability(company_id,store_id,'dashboard.store.read')));
create policy zysyr_goods_receipts_scope_select on public.zysyr_goods_receipts for select to authenticated using ((select zysyr_private.has_capability(company_id,store_id,'dashboard.store.read')));
create policy zysyr_goods_receipt_lines_scope_select on public.zysyr_goods_receipt_lines for select to authenticated using ((select zysyr_private.has_capability(company_id,store_id,'dashboard.store.read')));
create policy zysyr_inventory_balances_scope_select on public.zysyr_inventory_balances for select to authenticated using ((select zysyr_private.has_capability(company_id,store_id,'dashboard.store.read')));
create policy zysyr_inventory_transactions_scope_select on public.zysyr_inventory_transactions for select to authenticated using ((select zysyr_private.has_capability(company_id,store_id,'dashboard.store.read')));
create policy zysyr_usage_records_scope_select on public.zysyr_usage_records for select to authenticated using ((select zysyr_private.has_capability(company_id,store_id,'dashboard.store.read')));
create policy zysyr_employee_purchases_scope_select on public.zysyr_employee_purchases for select to authenticated using ((select zysyr_private.has_capability(company_id,store_id,'dashboard.store.read')));
create policy zysyr_employee_purchase_payments_scope_select on public.zysyr_employee_purchase_payments for select to authenticated using ((select zysyr_private.has_capability(company_id,store_id,'dashboard.store.read')));
create policy zysyr_stock_transfers_scope_select on public.zysyr_stock_transfers for select to authenticated using (
  (select zysyr_private.has_capability(company_id,source_store_id,'dashboard.store.read'))
  or (select zysyr_private.has_capability(company_id,destination_store_id,'dashboard.store.read'))
);
create policy zysyr_stock_transfer_lines_scope_select on public.zysyr_stock_transfer_lines for select to authenticated using (
  (select zysyr_private.has_capability(company_id,source_store_id,'dashboard.store.read'))
  or exists (
    select 1 from public.zysyr_stock_transfers transfer
    where transfer.company_id=zysyr_stock_transfer_lines.company_id
      and transfer.id=zysyr_stock_transfer_lines.stock_transfer_id
      and (select zysyr_private.has_capability(transfer.company_id,transfer.destination_store_id,'dashboard.store.read'))
  )
);

revoke all on table public.zysyr_purchase_orders,public.zysyr_purchase_order_lines,public.zysyr_goods_receipts,
  public.zysyr_goods_receipt_lines,public.zysyr_inventory_balances,public.zysyr_inventory_transactions,
  public.zysyr_usage_records,public.zysyr_employee_purchases,public.zysyr_employee_purchase_payments,
  public.zysyr_stock_transfers,public.zysyr_stock_transfer_lines
from public,anon,authenticated,service_role;
grant select on table public.zysyr_purchase_orders,public.zysyr_purchase_order_lines,public.zysyr_goods_receipts,
  public.zysyr_goods_receipt_lines,public.zysyr_inventory_balances,public.zysyr_inventory_transactions,
  public.zysyr_usage_records,public.zysyr_employee_purchases,public.zysyr_employee_purchase_payments,
  public.zysyr_stock_transfers,public.zysyr_stock_transfer_lines
to authenticated,service_role;

-- Extend the existing formal monthly generator without duplicating its full
-- payroll/expense logic. The core remains service-internal; this wrapper adds
-- inventory-derived lines, recalculates totals, and records source edges.
alter function public.zysyr_generate_monthly_report(uuid,uuid,uuid,date,uuid,text)
  rename to zysyr_generate_monthly_report_before_inventory;
revoke execute on function public.zysyr_generate_monthly_report_before_inventory(uuid,uuid,uuid,date,uuid,text)
  from public,anon,authenticated,service_role;

create or replace function zysyr_private.prevent_finance_line_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_table_name='zysyr_monthly_report_lines'
    and tg_op='UPDATE' and current_setting('zysyr.monthly_inventory_append',true)='on'
    and new.company_id=old.company_id and new.store_id=old.store_id
    and new.monthly_report_id=old.monthly_report_id and new.id=old.id
    and new.metric_code=old.metric_code then return new; end if;
  raise exception using errcode='42501',message='FINANCE_LINE_IMMUTABLE';
end $$;

create or replace function public.zysyr_generate_monthly_report(
  p_actor_user_id uuid,p_company_id uuid,p_store_id uuid,p_period_month date,
  p_source_report_id uuid,p_reason text
) returns public.zysyr_monthly_reports language plpgsql security definer set search_path='' as $$
declare v_report public.zysyr_monthly_reports; v_offset integer; v_usage numeric(14,2); v_usage_count integer;
  v_employee_income numeric(14,2); v_employee_cost numeric(14,2); v_employee_count integer;
begin
  v_report:=public.zysyr_generate_monthly_report_before_inventory(p_actor_user_id,p_company_id,p_store_id,p_period_month,p_source_report_id,p_reason);
  select coalesce(sum(total_cost),0),count(*) into v_usage,v_usage_count from public.zysyr_usage_records
    where company_id=p_company_id and store_id=p_store_id and usage_date>=p_period_month
      and usage_date<(p_period_month+interval '1 month')::date and status='confirmed';
  select coalesce(sum(amount),0),coalesce(sum(inventory_cost),0),count(*) into v_employee_income,v_employee_cost,v_employee_count
    from public.zysyr_employee_purchases where company_id=p_company_id and store_id=p_store_id
      and purchase_date>=p_period_month and purchase_date<(p_period_month+interval '1 month')::date and status='approved';
  perform set_config('zysyr.monthly_inventory_append','on',true);
  update public.zysyr_monthly_report_lines set line_number=line_number+1000
    where monthly_report_id=v_report.id and metric_code in ('TOTAL_INCOME','TOTAL_EXPENSE','NET_PROFIT');
  select coalesce(max(line_number),0) into v_offset from public.zysyr_monthly_report_lines
    where monthly_report_id=v_report.id and line_number<1000;
  if v_employee_count>0 then
    v_offset:=v_offset+1;
    insert into public.zysyr_monthly_report_lines(company_id,store_id,monthly_report_id,line_number,metric_code,
      metric_name,amount,calculation_method,calculation_expression,source_count)
    values(p_company_id,p_store_id,v_report.id,v_offset,'INCOME_EMPLOYEE_PURCHASE','员工自购收入',v_employee_income,
      'sum','SUM(APPROVED_EMPLOYEE_PURCHASE_AMOUNT)',v_employee_count);
  end if;
  if v_usage_count>0 then
    v_offset:=v_offset+1;
    insert into public.zysyr_monthly_report_lines(company_id,store_id,monthly_report_id,line_number,metric_code,
      metric_name,amount,calculation_method,calculation_expression,source_count)
    values(p_company_id,p_store_id,v_report.id,v_offset,'PRODUCT_USAGE_COST','产品消耗成本',v_usage,
      'sum','SUM(CONFIRMED_USAGE_COST_SNAPSHOT)',v_usage_count);
  end if;
  if v_employee_count>0 then
    v_offset:=v_offset+1;
    insert into public.zysyr_monthly_report_lines(company_id,store_id,monthly_report_id,line_number,metric_code,
      metric_name,amount,calculation_method,calculation_expression,source_count)
    values(p_company_id,p_store_id,v_report.id,v_offset,'EMPLOYEE_PURCHASE_COST','员工自购产品成本',v_employee_cost,
      'sum','SUM(APPROVED_EMPLOYEE_PURCHASE_INVENTORY_COST)',v_employee_count);
  end if;
  update public.zysyr_monthly_report_lines set line_number=v_offset+1,
    amount=(select coalesce(sum(amount),0) from public.zysyr_monthly_report_lines where monthly_report_id=v_report.id and metric_code like 'INCOME_%'),
    calculation_expression='SUM(INCOME_*)',source_count=(select count(*) from public.zysyr_monthly_report_lines where monthly_report_id=v_report.id and metric_code like 'INCOME_%')
  where monthly_report_id=v_report.id and metric_code='TOTAL_INCOME';
  update public.zysyr_monthly_report_lines set line_number=v_offset+2,
    amount=(select coalesce(sum(amount),0) from public.zysyr_monthly_report_lines where monthly_report_id=v_report.id
      and (metric_code like 'EXPENSE_%' or metric_code in ('PETTY_CASH_OUT','LABOR_COST','PRODUCT_USAGE_COST','EMPLOYEE_PURCHASE_COST'))),
    calculation_expression='SUM(EXPENSE_*,PETTY_CASH_OUT,LABOR_COST,PRODUCT_USAGE_COST,EMPLOYEE_PURCHASE_COST)',
    source_count=(select count(*) from public.zysyr_monthly_report_lines where monthly_report_id=v_report.id
      and (metric_code like 'EXPENSE_%' or metric_code in ('PETTY_CASH_OUT','LABOR_COST','PRODUCT_USAGE_COST','EMPLOYEE_PURCHASE_COST')))
  where monthly_report_id=v_report.id and metric_code='TOTAL_EXPENSE';
  update public.zysyr_monthly_report_lines set line_number=v_offset+3,
    amount=(select income.amount-expense.amount from public.zysyr_monthly_report_lines income,public.zysyr_monthly_report_lines expense
      where income.monthly_report_id=v_report.id and income.metric_code='TOTAL_INCOME'
        and expense.monthly_report_id=v_report.id and expense.metric_code='TOTAL_EXPENSE')
  where monthly_report_id=v_report.id and metric_code='NET_PROFIT';

  insert into public.zysyr_trace_nodes(company_id,store_id,entity_type,entity_id)
  select p_company_id,p_store_id,'monthly_report_line',line.id from public.zysyr_monthly_report_lines line
    where line.monthly_report_id=v_report.id and line.metric_code in ('INCOME_EMPLOYEE_PURCHASE','PRODUCT_USAGE_COST','EMPLOYEE_PURCHASE_COST')
  on conflict(company_id,entity_type,entity_id) do nothing;
  insert into public.zysyr_trace_nodes(company_id,store_id,entity_type,entity_id)
  select p_company_id,p_store_id,'usage_record',record.id from public.zysyr_usage_records record
    where record.company_id=p_company_id and record.store_id=p_store_id and record.usage_date>=p_period_month
      and record.usage_date<(p_period_month+interval '1 month')::date and record.status='confirmed'
  on conflict(company_id,entity_type,entity_id) do nothing;
  insert into public.zysyr_trace_nodes(company_id,store_id,entity_type,entity_id)
  select p_company_id,p_store_id,'employee_purchase',record.id from public.zysyr_employee_purchases record
    where record.company_id=p_company_id and record.store_id=p_store_id and record.purchase_date>=p_period_month
      and record.purchase_date<(p_period_month+interval '1 month')::date and record.status='approved'
  on conflict(company_id,entity_type,entity_id) do nothing;
  insert into public.zysyr_trace_edges(company_id,store_id,from_node_id,to_node_id,relation_type,source_amount,created_by_user_id)
  select p_company_id,p_store_id,line_node.id,source_node.id,'derived_from',record.total_cost,p_actor_user_id
  from public.zysyr_monthly_report_lines line
  join public.zysyr_trace_nodes line_node on line_node.company_id=p_company_id and line_node.entity_type='monthly_report_line' and line_node.entity_id=line.id
  join public.zysyr_usage_records record on record.company_id=p_company_id and record.store_id=p_store_id and record.usage_date>=p_period_month
    and record.usage_date<(p_period_month+interval '1 month')::date and record.status='confirmed'
  join public.zysyr_trace_nodes source_node on source_node.company_id=p_company_id and source_node.entity_type='usage_record' and source_node.entity_id=record.id
  where line.monthly_report_id=v_report.id and line.metric_code='PRODUCT_USAGE_COST'
  on conflict(company_id,from_node_id,to_node_id,relation_type) do nothing;
  insert into public.zysyr_trace_edges(company_id,store_id,from_node_id,to_node_id,relation_type,source_amount,created_by_user_id)
  select p_company_id,p_store_id,line_node.id,source_node.id,'derived_from',
    case line.metric_code when 'INCOME_EMPLOYEE_PURCHASE' then record.amount else record.inventory_cost end,p_actor_user_id
  from public.zysyr_monthly_report_lines line
  join public.zysyr_trace_nodes line_node on line_node.company_id=p_company_id and line_node.entity_type='monthly_report_line' and line_node.entity_id=line.id
  join public.zysyr_employee_purchases record on record.company_id=p_company_id and record.store_id=p_store_id and record.purchase_date>=p_period_month
    and record.purchase_date<(p_period_month+interval '1 month')::date and record.status='approved'
  join public.zysyr_trace_nodes source_node on source_node.company_id=p_company_id and source_node.entity_type='employee_purchase' and source_node.entity_id=record.id
  where line.monthly_report_id=v_report.id and line.metric_code in ('INCOME_EMPLOYEE_PURCHASE','EMPLOYEE_PURCHASE_COST')
  on conflict(company_id,from_node_id,to_node_id,relation_type) do nothing;
  insert into public.zysyr_trace_edges(company_id,store_id,from_node_id,to_node_id,relation_type,source_amount,created_by_user_id)
  select p_company_id,p_store_id,total_node.id,component_node.id,'derived_from',component.amount,p_actor_user_id
  from public.zysyr_monthly_report_lines total
  join public.zysyr_trace_nodes total_node on total_node.company_id=p_company_id and total_node.entity_type='monthly_report_line' and total_node.entity_id=total.id
  join public.zysyr_monthly_report_lines component on component.monthly_report_id=v_report.id
    and ((total.metric_code='TOTAL_INCOME' and component.metric_code='INCOME_EMPLOYEE_PURCHASE')
      or (total.metric_code='TOTAL_EXPENSE' and component.metric_code in ('PRODUCT_USAGE_COST','EMPLOYEE_PURCHASE_COST')))
  join public.zysyr_trace_nodes component_node on component_node.company_id=p_company_id and component_node.entity_type='monthly_report_line' and component_node.entity_id=component.id
  where total.monthly_report_id=v_report.id and total.metric_code in ('TOTAL_INCOME','TOTAL_EXPENSE')
  on conflict(company_id,from_node_id,to_node_id,relation_type) do nothing;
  update public.zysyr_trace_edges edge set source_amount=line.amount
  from public.zysyr_trace_nodes source_node join public.zysyr_monthly_report_lines line on line.id=source_node.entity_id
  join public.zysyr_trace_nodes profit_node on profit_node.company_id=p_company_id and profit_node.entity_type='monthly_report_line'
  join public.zysyr_monthly_report_lines profit on profit.id=profit_node.entity_id and profit.monthly_report_id=v_report.id and profit.metric_code='NET_PROFIT'
  where edge.company_id=p_company_id and edge.from_node_id=profit_node.id and edge.to_node_id=source_node.id
    and line.monthly_report_id=v_report.id and line.metric_code in ('TOTAL_INCOME','TOTAL_EXPENSE');
  insert into public.zysyr_audit_events(company_id,store_id,actor_type,actor_user_id,channel,entity_type,entity_id,action,after_json,reason,sensitivity)
  values(p_company_id,p_store_id,'user',p_actor_user_id,'api','monthly_report',v_report.id,'append_inventory_costs',
    jsonb_build_object('product_usage_cost',v_usage,'employee_purchase_income',v_employee_income,'employee_purchase_cost',v_employee_cost,'costing_method','moving_average'),
    btrim(p_reason),'financial');
  return v_report;
end $$;
revoke execute on function public.zysyr_generate_monthly_report(uuid,uuid,uuid,date,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.zysyr_generate_monthly_report(uuid,uuid,uuid,date,uuid,text) to service_role;

comment on table public.zysyr_inventory_transactions is 'Immutable, store-scoped perpetual inventory ledger with moving-average cost snapshots and source provenance.';
comment on function public.zysyr_post_goods_receipt(uuid,uuid,uuid,uuid,text,date,jsonb,uuid[],text) is 'Posts a partial or complete receipt independently from payment and atomically updates moving-average inventory.';
