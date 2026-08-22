\set ON_ERROR_STOP on
begin;

insert into public.zysyr_companies(id,code,name) values('10000000-0000-0000-0000-000000000001','v427_test','V427测试公司');
insert into public.zysyr_stores(id,company_id,code,name,city,status) values
('10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','store_a','测试A店','测试市','active'),
('10000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','store_b','测试B店','测试市','active');
insert into public.zysyr_employees(id,company_id,store_id,employee_code,name,position,employment_status)
values('10000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','H001','测试员工','发型师','active');
insert into auth.users(id,email,created_at,updated_at) values('10000000-0000-0000-0000-000000000005','v427@example.invalid',now(),now());
insert into public.zysyr_user_accounts(id,company_id,auth_user_id,display_name,status,activated_at,login_name)
values('10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000005','测试财务','active',now(),'v427.finance');
insert into public.zysyr_roles(id,code,name) values('10000000-0000-0000-0000-000000000007','finance','财务');
insert into public.zysyr_capabilities(id,code,name,risk_level) values
('10000000-0000-0000-0000-000000000008','inventory.write','维护采购库存','high'),
('10000000-0000-0000-0000-000000000009','payment.confirm','确认付款','high'),
('10000000-0000-0000-0000-000000000010','report.lock','锁定月报','high');
insert into public.zysyr_role_capabilities(role_id,capability_id) values
('10000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000008'),
('10000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000009'),
('10000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000010');
insert into public.zysyr_user_role_grants(company_id,user_account_id,role_id,scope_type,store_id)
values('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000007','store','10000000-0000-0000-0000-000000000002');
insert into public.zysyr_products(id,company_id,name,category,unit,default_cost,status,created_by_user_id,updated_by_user_id)
values('10000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001','测试洗发水','美发消耗品','瓶',100,'active','10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000006');
insert into public.zysyr_suppliers(id,company_id,name,status,created_by_user_id,updated_by_user_id)
values('10000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000001','测试供应商','active','10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000006');
insert into public.zysyr_voucher_attachments(id,store,record_type,bucket_id,object_path,original_filename,mime_type,size_bytes,uploaded_by,
  company_id,store_id,immutable_version,uploaded_by_user_id,ocr_status,audit_status,document_type,reviewed_at,reviewed_by_user_id,updated_by_user_id)
values('10000000-0000-0000-0000-000000000013','测试A店','unassigned','zysyr-vouchers','v427/purchase.jpg','采购凭证.jpg','image/jpeg',100,'测试财务',
  '10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',1,'10000000-0000-0000-0000-000000000006','reviewed','approved','purchase',now(),'10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000006');
insert into public.zysyr_report_uploads(id,company_id,store_id,report_type,report_date,template_code,original_filename,mime_type,size_bytes,sha256,object_path,uploaded_by_user_id)
values('10000000-0000-0000-0000-000000000014','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','daily','2026-04-01','zysyr_daily_original','日报.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',100,repeat('c',64),'v427/daily.xlsx','10000000-0000-0000-0000-000000000006');
insert into public.zysyr_daily_reports(company_id,store_id,report_date,is_business_day,version,source_report_id,status,submitted_by_user_id,reviewed_by_user_id,reviewed_at)
values('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','2026-04-01',true,1,'10000000-0000-0000-0000-000000000014','approved','10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000006',now());

do $$
declare po1 public.zysyr_purchase_orders; po2 public.zysyr_purchase_orders; line1 uuid; line2 uuid;
  receipt1 public.zysyr_goods_receipts; receipt2 public.zysyr_goods_receipts;
  usage1 public.zysyr_usage_records; usage2 public.zysyr_usage_records; employee_purchase public.zysyr_employee_purchases;
  employee_payment public.zysyr_employee_purchase_payments; purchase_payment public.zysyr_payment_records;
  stock_transfer public.zysyr_stock_transfers;
  monthly public.zysyr_monthly_reports; balance public.zysyr_inventory_balances;
begin
  po1:=public.zysyr_save_purchase_order('10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',null,
    '10000000-0000-0000-0000-000000000012','PO-001','2026-04-02','2026-04-03',
    '[{"product_id":"10000000-0000-0000-0000-000000000011","quantity":10,"unit_cost":100}]'::jsonb,null,'测试采购一');
  po1:=public.zysyr_transition_purchase_order('10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',po1.id,'submit','提交测试');
  po1:=public.zysyr_transition_purchase_order('10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',po1.id,'approve','批准测试');
  select id into line1 from public.zysyr_purchase_order_lines where purchase_order_id=po1.id;
  receipt1:=public.zysyr_post_goods_receipt('10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',po1.id,
    'GR-001','2026-04-03',jsonb_build_array(jsonb_build_object('purchase_order_line_id',line1,'quantity',10)),array['10000000-0000-0000-0000-000000000013']::uuid[],'入库测试一');

  po2:=public.zysyr_save_purchase_order('10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',null,
    '10000000-0000-0000-0000-000000000012','PO-002','2026-04-04','2026-04-05',
    '[{"product_id":"10000000-0000-0000-0000-000000000011","quantity":10,"unit_cost":200}]'::jsonb,null,'测试采购二');
  po2:=public.zysyr_transition_purchase_order('10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',po2.id,'submit','提交测试');
  po2:=public.zysyr_transition_purchase_order('10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',po2.id,'approve','批准测试');
  select id into line2 from public.zysyr_purchase_order_lines where purchase_order_id=po2.id;
  receipt2:=public.zysyr_post_goods_receipt('10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',po2.id,
    'GR-002','2026-04-05',jsonb_build_array(jsonb_build_object('purchase_order_line_id',line2,'quantity',10)),array['10000000-0000-0000-0000-000000000013']::uuid[],'入库测试二');
  select * into balance from public.zysyr_inventory_balances where store_id='10000000-0000-0000-0000-000000000002' and product_id='10000000-0000-0000-0000-000000000011';
  if balance.quantity<>20 or balance.moving_average_cost<>150 then raise exception 'MOVING_AVERAGE_MISMATCH %',to_jsonb(balance); end if;

  begin
    perform public.zysyr_post_goods_receipt('10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',po2.id,
      'GR-OVER','2026-04-06',jsonb_build_array(jsonb_build_object('purchase_order_line_id',line2,'quantity',1)),array['10000000-0000-0000-0000-000000000013']::uuid[],'超量阻断');
    raise exception 'OVER_RECEIPT_WAS_NOT_BLOCKED';
  exception when sqlstate '23514' then if sqlerrm<>'RECEIPT_EXCEEDS_ORDER' then raise; end if; end;

  usage1:=public.zysyr_record_usage('10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000004','2026-04-06','salon_service',4,'服务领用',array['10000000-0000-0000-0000-000000000013']::uuid[],'消耗测试');
  if usage1.unit_cost<>150 or usage1.total_cost<>600 then raise exception 'USAGE_COST_MISMATCH'; end if;
  employee_purchase:=public.zysyr_record_employee_purchase('10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000011','2026-04-07',2,250,'员工自购',array['10000000-0000-0000-0000-000000000013']::uuid[],'自购测试');
  if employee_purchase.amount<>500 or employee_purchase.inventory_cost<>300 then raise exception 'EMPLOYEE_PURCHASE_COST_MISMATCH'; end if;
  employee_payment:=public.zysyr_confirm_employee_purchase_payment('10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',employee_purchase.id,
    '2026-04-08',500,'现金','EP-001',array['10000000-0000-0000-0000-000000000013']::uuid[],'自购收款');
  purchase_payment:=public.zysyr_confirm_purchase_payment('10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',po1.id,
    '2026-04-08',1000,'银行转账','PAY-001',array['10000000-0000-0000-0000-000000000013']::uuid[],'采购付款');

  usage2:=public.zysyr_record_usage('10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000011',null,'2026-04-09','damage',1,'测试报损',array['10000000-0000-0000-0000-000000000013']::uuid[],'报损测试');
  perform public.zysyr_reverse_inventory_record('10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','usage_record',usage2.id,'撤销测试报损');
  select * into balance from public.zysyr_inventory_balances where store_id='10000000-0000-0000-0000-000000000002' and product_id='10000000-0000-0000-0000-000000000011';
  if balance.quantity<>14 or balance.moving_average_cost<>150 then raise exception 'REVERSAL_BALANCE_MISMATCH %',to_jsonb(balance); end if;
  begin
    perform public.zysyr_reverse_inventory_record('10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','employee_purchase',employee_purchase.id,'有收款不允许');
    raise exception 'PAID_EMPLOYEE_PURCHASE_REVERSED';
  exception when sqlstate '55000' then if sqlerrm<>'EMPLOYEE_PURCHASE_HAS_PAYMENT' then raise; end if; end;
  begin
    perform public.zysyr_record_usage('10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003',
      '10000000-0000-0000-0000-000000000011',null,'2026-04-09','other',1,null,array['10000000-0000-0000-0000-000000000013']::uuid[],'越权门店');
    raise exception 'CROSS_STORE_WRITE_WAS_NOT_BLOCKED';
  exception when sqlstate '42501' then if sqlerrm<>'INVENTORY_SCOPE_FORBIDDEN' then raise; end if; end;

  perform public.zysyr_reverse_inventory_payment('10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','employee_purchase',employee_payment.id,'撤销员工收款');
  if (select payment_status from public.zysyr_employee_purchases where id=employee_purchase.id)<>'unpaid' then raise exception 'EMPLOYEE_PAYMENT_STATUS_NOT_RESTORED'; end if;
  perform public.zysyr_reverse_inventory_payment('10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','purchase',purchase_payment.id,'撤销采购付款');
  if (select payment_status from public.zysyr_purchase_orders where id=po1.id)<>'unpaid' then raise exception 'PURCHASE_PAYMENT_STATUS_NOT_RESTORED'; end if;

  insert into public.zysyr_user_role_grants(company_id,user_account_id,role_id,scope_type,store_id)
  values('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000007','store','10000000-0000-0000-0000-000000000003');
  stock_transfer:=public.zysyr_post_stock_transfer('10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003','TR-001','2026-04-10',
    '[{"product_id":"10000000-0000-0000-0000-000000000011","quantity":2}]'::jsonb,'跨店测试',array['10000000-0000-0000-0000-000000000013']::uuid[],'调拨测试');
  if (select quantity from public.zysyr_inventory_balances where store_id='10000000-0000-0000-0000-000000000002' and product_id='10000000-0000-0000-0000-000000000011')<>12 then raise exception 'TRANSFER_SOURCE_BALANCE_MISMATCH'; end if;
  if (select quantity from public.zysyr_inventory_balances where store_id='10000000-0000-0000-0000-000000000003' and product_id='10000000-0000-0000-0000-000000000011')<>2 then raise exception 'TRANSFER_DESTINATION_BALANCE_MISMATCH'; end if;
  perform public.zysyr_reverse_inventory_record('10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','stock_transfer',stock_transfer.id,'撤销调拨测试');
  if (select quantity from public.zysyr_inventory_balances where store_id='10000000-0000-0000-0000-000000000002' and product_id='10000000-0000-0000-0000-000000000011')<>14 then raise exception 'TRANSFER_REVERSE_SOURCE_MISMATCH'; end if;
  if (select quantity from public.zysyr_inventory_balances where store_id='10000000-0000-0000-0000-000000000003' and product_id='10000000-0000-0000-0000-000000000011')<>0 then raise exception 'TRANSFER_REVERSE_DESTINATION_MISMATCH'; end if;

  monthly:=public.zysyr_generate_monthly_report('10000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','2026-04-01',null,'库存进入月报测试');
  if (select amount from public.zysyr_monthly_report_lines where monthly_report_id=monthly.id and metric_code='PRODUCT_USAGE_COST')<>600 then raise exception 'MONTHLY_USAGE_COST_MISMATCH'; end if;
  if (select amount from public.zysyr_monthly_report_lines where monthly_report_id=monthly.id and metric_code='EMPLOYEE_PURCHASE_COST')<>300 then raise exception 'MONTHLY_EMPLOYEE_COST_MISMATCH'; end if;
  if (select amount from public.zysyr_monthly_report_lines where monthly_report_id=monthly.id and metric_code='INCOME_EMPLOYEE_PURCHASE')<>500 then raise exception 'MONTHLY_EMPLOYEE_INCOME_MISMATCH'; end if;
  if (select amount from public.zysyr_monthly_report_lines where monthly_report_id=monthly.id and metric_code='TOTAL_EXPENSE')<>900 then raise exception 'MONTHLY_TOTAL_EXPENSE_MISMATCH'; end if;
  if (select amount from public.zysyr_monthly_report_lines where monthly_report_id=monthly.id and metric_code='NET_PROFIT')<>-400 then raise exception 'MONTHLY_NET_PROFIT_MISMATCH'; end if;
  if not exists(select 1 from public.zysyr_trace_edges edge join public.zysyr_trace_nodes source on source.id=edge.from_node_id
    join public.zysyr_trace_nodes target on target.id=edge.to_node_id where source.entity_type='monthly_report_line' and target.entity_type in ('usage_record','employee_purchase')) then
    raise exception 'MONTHLY_INVENTORY_TRACE_MISSING'; end if;
  raise notice 'ZYSYR_V427_RUNTIME_OK balance=% avg_cost=% monthly=%',balance.quantity,balance.moving_average_cost,monthly.id;
end $$;

rollback;
