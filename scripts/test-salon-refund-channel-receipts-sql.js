const fs=require('node:fs');
const sql=fs.readFileSync('supabase/migrations/20260924052952_salon_refund_channel_receipts.sql','utf8');
const apiSql=fs.readFileSync('supabase/migrations/20260924054029_salon_refund_channel_receipt_api.sql','utf8');
const bad=[],ok=(value,label)=>{if(!value)bad.push(label)};
ok(/create table public\.salon_refund_channel_receipts/.test(sql),'receipt history table missing');
ok(/revision integer not null check\(revision>0\)/.test(sql),'receipt revision history missing');
ok(/status in\('reported','verified','rejected'\)/.test(sql),'separate reported and verified states missing');
ok(/verified_by_staff_id<>reported_by_staff_id/.test(sql),'maker-checker database constraint missing');
ok(/v_latest\.status<>'reported' or v_latest\.reported_by_staff_id=p_actor_staff_id/.test(sql),'review must be by another employee');
ok(/refund_amount=a\.refund_amount/.test(sql)&&/c\.status='verified'/.test(sql),'exact verified channel receipt execution gate missing');
ok(/尚未复核通过的外部渠道退款回执，未执行任何退款或库存操作/.test(sql),'unverified receipt hard stop missing');
ok(/enable row level security/.test(sql)&&/revoke all on public\.salon_refund_channel_receipts from public,anon,authenticated/.test(sql),'receipt table privilege boundary missing');
ok(/security invoker set search_path=''/i.test(sql)&&/revoke execute on function public\.salon_record_refund_channel_receipt[\s\S]*from public,anon,authenticated/.test(sql),'receipt function security and grants missing');
ok(/salon_list_refund_channel_receipts[\s\S]*assert_staff_permission[\s\S]*'orders','refund_read'/.test(apiSql),'receipt read must be authorized and store scoped');
ok(/v_latest\.status<>'rejected'/.test(apiSql),'rejected receipt cannot be revised as a new report');
ok(/revoke execute on function public\.salon_list_refund_channel_receipts[\s\S]*from public,anon,authenticated/.test(apiSql),'read RPC public execute revoke missing');
ok(/p_target_operation='refund_channel_receipt'[\s\S]*assert_staff_permission[\s\S]*r\.staff_request_actor_id=p_actor_staff_id/.test(apiSql),'lost-response lookup must stay actor/store scoped');
if(bad.length){console.error('salon refund channel receipt SQL failed:\n- '+bad.join('\n- '));process.exit(1)}
console.log('salon refund channel receipt SQL passed: immutable revisions, two-person review, exact amount gate, least privilege');
