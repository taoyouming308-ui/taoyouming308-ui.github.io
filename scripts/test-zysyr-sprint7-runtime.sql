\set ON_ERROR_STOP on
begin;
insert into public.zysyr_companies(id,code,name) values('30000000-0000-0000-0000-000000000001','v429_test','V429测试公司');
insert into public.zysyr_stores(id,company_id,code,name,city,status) values
('30000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','store_a','测试A店','测试市','active'),
('30000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000001','store_b','测试B店','测试市','active');
insert into auth.users(id,email,created_at,updated_at) values('30000000-0000-0000-0000-000000000004','v429@example.invalid',now(),now());
insert into public.zysyr_user_accounts(id,company_id,auth_user_id,display_name,status,activated_at,login_name)
values('30000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000004','测试财务','active',now(),'v429.finance');
insert into public.zysyr_roles(id,code,name) values('30000000-0000-0000-0000-000000000006','finance','V429测试财务');
insert into public.zysyr_capabilities(code,name,risk_level) values('daily_report.write','录入日报','sensitive') on conflict(code) do nothing;
insert into public.zysyr_role_capabilities(role_id,capability_id) select '30000000-0000-0000-0000-000000000006',id from public.zysyr_capabilities where code='daily_report.write';
insert into public.zysyr_user_role_grants(company_id,user_account_id,role_id,scope_type,store_id)
values('30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000006','store','30000000-0000-0000-0000-000000000002');
insert into public.zysyr_voucher_attachments(id,store,record_type,bucket_id,object_path,original_filename,mime_type,size_bytes,uploaded_by,
  company_id,store_id,immutable_version,uploaded_by_user_id,ocr_status,audit_status,document_type,reviewed_at,reviewed_by_user_id,updated_by_user_id)
values('30000000-0000-0000-0000-000000000007','测试A店','unassigned','zysyr-vouchers','v429/daily.jpg','4月7日日报.jpg','image/jpeg',100,'测试财务',
  '30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002',1,'30000000-0000-0000-0000-000000000005','reviewed','approved','daily_report',now(),'30000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000005');
insert into public.zysyr_report_uploads(id,company_id,store_id,report_type,report_date,template_code,original_filename,mime_type,size_bytes,sha256,object_path,uploaded_by_user_id)
values('30000000-0000-0000-0000-000000000008','30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','daily','2026-04-07','zysyr_daily_photo_reviewed','4月7日日报.jpg','image/jpeg',100,repeat('d',64),'v429/report.jpg','30000000-0000-0000-0000-000000000005');
insert into public.zysyr_report_cells(id,company_id,store_id,report_id,sheet_name,cell_address,row_number,column_number,cell_kind,display_value,numeric_value,label) values
('30000000-0000-0000-0000-000000000009','30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000008','人工复核日报','B2',2,2,'input','1000.00',1000,'美发收入'),
('30000000-0000-0000-0000-000000000010','30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000008','人工复核日报','B3',3,2,'input','200.00',200,'产品收入');

do $$
declare batch public.zysyr_import_batches; daily public.zysyr_daily_reports; recon public.zysyr_reconciliation_reports; duplicate public.zysyr_import_batches;
begin
  batch:=public.zysyr_create_photo_import_batch('30000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','2026-04-07','30000000-0000-0000-0000-000000000007',
    '[{"line_type":"income","metric_code":"INCOME_SERVICE","description":"美发收入","amount":1000},{"line_type":"income","metric_code":"INCOME_RETAIL","description":"产品收入","amount":200}]','已对照原图');
  if batch.status<>'validated' or batch.mapped_row_count<>2 then raise exception 'IMPORT_BATCH_VALIDATION_FAILED'; end if;
  batch:=public.zysyr_attach_import_report('30000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002',batch.id,'30000000-0000-0000-0000-000000000008');
  if batch.status<>'importing' or exists(select 1 from public.zysyr_import_rows row where row.import_batch_id=batch.id and row.source_report_cell_id is null) then raise exception 'IMPORT_CELL_MAPPING_FAILED'; end if;
  daily:=public.zysyr_save_daily_report('30000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000008',null,
    (select jsonb_agg(row.mapped_json||jsonb_build_object('source_report_cell_id',row.source_report_cell_id) order by row.row_number) from public.zysyr_import_rows row where row.import_batch_id=batch.id),'图片日报导入');
  recon:=public.zysyr_finalize_daily_import('30000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002',batch.id,daily.id);
  if recon.status<>'matched' or recon.source_row_count<>2 or recon.business_row_count<>2 or recon.source_amount<>1200 or recon.delta<>0 then raise exception 'IMPORT_RECONCILIATION_FAILED %',to_jsonb(recon); end if;
  daily:=public.zysyr_review_daily_report('30000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002',daily.id,'approved','已核对原图及对账结果');
  if (select count(*) from public.zysyr_income_records where daily_report_id=daily.id)<>2 then raise exception 'IMPORTED_INCOME_MISSING'; end if;
  if not exists(select 1 from public.zysyr_voucher_links link where link.voucher_id='30000000-0000-0000-0000-000000000007' and link.business_type='income_record') then raise exception 'IMPORTED_INCOME_VOUCHER_TRACE_MISSING'; end if;
  duplicate:=public.zysyr_create_photo_import_batch('30000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','2026-04-07','30000000-0000-0000-0000-000000000007',
    '[{"line_type":"income","metric_code":"INCOME_SERVICE","description":"美发收入","amount":1000}]','重复日报测试');
  if duplicate.status<>'conflict' or not exists(select 1 from public.zysyr_import_conflicts conflict where conflict.import_batch_id=duplicate.id and conflict.conflict_type='existing_daily_report') then raise exception 'DUPLICATE_DAILY_CONFLICT_MISSING'; end if;
  begin
    perform public.zysyr_create_photo_import_batch('30000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003','2026-04-08','30000000-0000-0000-0000-000000000007','[{"line_type":"income","metric_code":"INCOME_SERVICE","description":"越权","amount":1}]','越权测试');
    raise exception 'IMPORT_CROSS_STORE_WAS_NOT_BLOCKED';
  exception when sqlstate '42501' then if sqlerrm<>'FINANCE_SCOPE_FORBIDDEN' then raise; end if; end;
  raise notice 'ZYSYR_V429_RUNTIME_OK batch=% daily=% reconciliation=%',batch.id,daily.id,recon.id;
end $$;
rollback;
