\set ON_ERROR_STOP on
begin;

insert into public.zysyr_companies(id,code,name) values('20000000-0000-0000-0000-000000000001','v428_test','V428测试公司');
insert into public.zysyr_stores(id,company_id,code,name,city,status) values
('20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','store_a','测试A店','测试市','active'),
('20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','store_b','测试B店','测试市','active');
insert into auth.users(id,email,created_at,updated_at) values('20000000-0000-0000-0000-000000000004','v428@example.invalid',now(),now());
insert into public.zysyr_user_accounts(id,company_id,auth_user_id,display_name,status,activated_at,login_name)
values('20000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','测试审核人','active',now(),'v428.user');
insert into public.zysyr_roles(id,code,name) values('20000000-0000-0000-0000-000000000006','finance','V428测试财务');
insert into public.zysyr_capabilities(code,name,risk_level) values
('voucher.review','人工审核凭证','high'),('ai_insight.read','查看AI经营分析','sensitive'),
('question.create','发起经营问题','normal'),('question.respond','回复经营问题','sensitive')
on conflict(code) do nothing;
insert into public.zysyr_role_capabilities(role_id,capability_id)
select '20000000-0000-0000-0000-000000000006',id from public.zysyr_capabilities
where code in ('voucher.review','ai_insight.read','question.create','question.respond');
insert into public.zysyr_user_role_grants(company_id,user_account_id,role_id,scope_type,store_id)
values('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000006','store','20000000-0000-0000-0000-000000000002');

insert into public.zysyr_voucher_attachments(id,store,record_type,bucket_id,object_path,original_filename,mime_type,size_bytes,uploaded_by,
  company_id,store_id,immutable_version,uploaded_by_user_id,ocr_status,audit_status,document_type,updated_by_user_id)
values('20000000-0000-0000-0000-000000000007','测试A店','unassigned','zysyr-vouchers','v428/test.jpg','OCR测试.jpg','image/jpeg',100,'测试审核人',
  '20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002',1,'20000000-0000-0000-0000-000000000005','pending','pending','unclassified','20000000-0000-0000-0000-000000000005');
insert into public.zysyr_voucher_ocr_tasks(id,company_id,store_id,voucher_id,attempt,max_attempts,created_by_user_id)
values('20000000-0000-0000-0000-000000000008','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000007',1,2,'20000000-0000-0000-0000-000000000005');

insert into public.zysyr_monthly_reports(id,company_id,store_id,period_month,version,status,generated_by_user_id)
values('20000000-0000-0000-0000-000000000009','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','2026-04-01',1,'draft','20000000-0000-0000-0000-000000000005');
insert into public.zysyr_monthly_report_lines(id,company_id,store_id,monthly_report_id,line_number,metric_code,metric_name,amount,calculation_method,source_count)
values('20000000-0000-0000-0000-000000000010','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000009',1,'NET_PROFIT','盈亏',63001.39,'sum',1);

do $$
declare claim record; retry_task public.zysyr_voucher_ocr_tasks; analysis public.zysyr_ai_analysis_runs;
  claimed_analysis public.zysyr_ai_analysis_runs; question public.zysyr_questions; message public.zysyr_question_messages;
begin
  perform set_config('request.jwt.claim.role','service_role',true);
  select * into claim from public.zysyr_claim_voucher_ocr_task('test-provider','test-model','v1',60);
  perform public.zysyr_complete_voucher_ocr_task(claim.task_id,claim.lease_token,false,true,'{}','{}','{}','临时失败');
  update public.zysyr_voucher_ocr_tasks set next_attempt_at=now() where id=claim.task_id;
  select * into claim from public.zysyr_claim_voucher_ocr_task('test-provider','test-model','v1',60);
  perform public.zysyr_complete_voucher_ocr_task(claim.task_id,claim.lease_token,false,true,'{}','{}','{}','第二次失败');
  if (select status from public.zysyr_voucher_ocr_tasks where id=claim.task_id)<>'dead_letter' then raise exception 'OCR_DEAD_LETTER_MISSING'; end if;

  retry_task:=public.zysyr_retry_voucher_ocr('20000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000007','人工确认重新识别');
  if retry_task.attempt<>3 or retry_task.max_attempts>10 then raise exception 'OCR_MANUAL_RETRY_INVALID'; end if;
  select * into claim from public.zysyr_claim_voucher_ocr_task('test-provider','test-model','v1',60);
  perform public.zysyr_complete_voucher_ocr_task(claim.task_id,claim.lease_token,true,false,
    '{"full_text":"合计1137.50"}','{"amount":"1137.50"}','{"amount":0.72}',null);
  perform public.zysyr_review_voucher('20000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000007',
    'approved','purchase','{"amount":"1137.50"}','{"amount":0.72}',array[]::uuid[],'已对照原图人工确认');
  if (select ocr_status from public.zysyr_voucher_attachments where id='20000000-0000-0000-0000-000000000007')<>'reviewed' then raise exception 'OCR_HUMAN_REVIEW_NOT_FINAL'; end if;
  insert into public.zysyr_voucher_attachments(id,store,record_type,bucket_id,object_path,original_filename,mime_type,size_bytes,uploaded_by,
    company_id,store_id,immutable_version,uploaded_by_user_id,ocr_status,audit_status,document_type,updated_by_user_id)
  values('20000000-0000-0000-0000-000000000011','测试A店','unassigned','zysyr-vouchers','v428/concurrent.jpg','并发复核.jpg','image/jpeg',100,'测试审核人',
    '20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002',1,'20000000-0000-0000-0000-000000000005','pending','pending','unclassified','20000000-0000-0000-0000-000000000005');
  insert into public.zysyr_voucher_ocr_tasks(id,company_id,store_id,voucher_id,attempt,max_attempts,created_by_user_id)
  values('20000000-0000-0000-0000-000000000012','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000011',1,3,'20000000-0000-0000-0000-000000000005');
  select * into claim from public.zysyr_claim_voucher_ocr_task('test-provider','test-model','v1',60);
  perform public.zysyr_review_voucher('20000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000011',
    'approved','other','{}','{}',array[]::uuid[],'OCR处理中人工审核优先');
  if (select status<>'cancelled' or lease_token is not null or leased_until is not null from public.zysyr_voucher_ocr_tasks where id=claim.task_id) then raise exception 'OCR_REVIEW_DID_NOT_CLEAR_LEASE'; end if;
  begin
    perform public.zysyr_retry_voucher_ocr('20000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000011','审核后不应重跑');
    raise exception 'OCR_RETRIED_AFTER_HUMAN_REVIEW';
  exception when sqlstate '55000' then if sqlerrm<>'OCR_ALREADY_HUMAN_REVIEWED' then raise; end if; end;

  analysis:=public.zysyr_request_ai_analysis('20000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000009','monthly_operations','运行证据快照测试');
  claimed_analysis:=public.zysyr_claim_ai_analysis('test-provider','test-model','v1',60);
  begin
    perform public.zysyr_complete_ai_analysis(claimed_analysis.id,claimed_analysis.lease_token,true,false,
      jsonb_build_object('summary','错误引用','citations',jsonb_build_array(jsonb_build_object('metric_line_id','20000000-0000-0000-0000-000000000010','metric_code','NET_PROFIT','amount',1))),null);
    raise exception 'AI_FALSE_CITATION_ACCEPTED';
  exception when sqlstate '22023' then if sqlerrm<>'AI_CITATION_NOT_IN_SNAPSHOT' then raise; end if; end;
  perform public.zysyr_complete_ai_analysis(claimed_analysis.id,claimed_analysis.lease_token,true,false,
    jsonb_build_object('summary','盈亏为63001.39','findings',jsonb_build_array('仅引用正式月报'),
      'citations',jsonb_build_array(jsonb_build_object('metric_line_id','20000000-0000-0000-0000-000000000010','metric_code','NET_PROFIT','amount',63001.39))),null);
  if (select status from public.zysyr_ai_analysis_runs where id=analysis.id)<>'succeeded' then raise exception 'AI_VALID_OUTPUT_NOT_SAVED'; end if;

  question:=public.zysyr_create_question('20000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000009','盈亏来源','请说明盈亏来源');
  message:=public.zysyr_respond_question('20000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002',question.id,'来自正式月报快照及底层追溯');
  if (select count(*) from public.zysyr_question_messages where question_id=question.id)<>2 then raise exception 'QUESTION_THREAD_INCOMPLETE'; end if;
  begin
    perform public.zysyr_request_ai_analysis('20000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000009','monthly_operations','越权测试');
    raise exception 'AI_CROSS_STORE_WAS_NOT_BLOCKED';
  exception when sqlstate '42501' then if sqlerrm<>'AI_ANALYSIS_FORBIDDEN' then raise; end if; end;
  raise notice 'ZYSYR_V428_RUNTIME_OK ocr=% analysis=% question=%',retry_task.id,analysis.id,question.id;
end $$;

rollback;
