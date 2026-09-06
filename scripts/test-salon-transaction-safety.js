const fs=require('fs');
const migration=fs.readFileSync('supabase/migrations/20260906062903_salon_transaction_safety.sql','utf8');
const refundMigration=fs.readFileSync('supabase/migrations/20260906063629_salon_refund_reversal.sql','utf8');
const failures=[];const expect=(ok,msg)=>{if(!ok)failures.push(msg)};
['salon_operation_requests','salon_inventory_balances','salon_inventory_ledger'].forEach(name=>expect(migration.includes('public.'+name),name+' missing'));
['salon_checkout_order','salon_move_inventory'].forEach(name=>{
  expect(migration.includes('function public.'+name),name+' function missing');
  expect(new RegExp('revoke execute on function public\\.'+name+'[\\s\\S]*?from public,anon,authenticated','i').test(migration),name+' browser execute revoke missing');
  expect(new RegExp('grant execute on function public\\.'+name+'[\\s\\S]*?to service_role','i').test(migration),name+' service-role grant missing');
});
expect(/unique\s*\(organization_id,\s*request_key\)/i.test(migration),'organization-scoped idempotency uniqueness missing');
expect((migration.match(/for update/g)||[]).length>=2,'order and balance row locks missing');
expect(/order by a\.id for update/i.test(migration),'member accounts must lock in stable order');
expect(/if v_after<0 then raise exception '库存不足/i.test(migration),'non-negative inventory guard missing');
expect(/assert_staff_permission[\s\S]*?s\.store_id=p_store_id/i.test(migration),'staff store permission boundary missing');
expect(/force row level security/i.test(migration),'RLS force missing');
expect(/revoke all on table public\.%I from public,anon,authenticated/i.test(migration),'browser table grants not revoked');
expect(!/security definer/i.test(migration),'transaction functions must not bypass RLS with security definer');
expect(!/raw_user_meta_data|user_metadata/i.test(migration),'user-editable metadata must not authorize writes');
expect(/response_json=v_response,completed_at=now\(\)/i.test(migration),'idempotent response completion missing');
expect(refundMigration.includes('function public.salon_refund_order'),'refund function missing');
expect(/salon_payments_one_reversal_idx/i.test(refundMigration),'payment one-reversal constraint missing');
expect(/salon_account_ledger_payment_idx/i.test(refundMigration),'payment-to-member-ledger exact link missing');
expect(/salon_inventory_ledger_one_reversal_idx/i.test(refundMigration),'inventory one-reversal constraint missing');
expect(/movement_type='sale'[\s\S]*?reversal_of_id is null/i.test(refundMigration),'refund must return only original sale movements');
expect(/revoke execute on function public\.salon_refund_order[\s\S]*?from public,anon,authenticated/i.test(refundMigration),'browser refund execute revoke missing');
expect(!/security definer/i.test(refundMigration),'refund function must not bypass RLS with security definer');
if(failures.length){console.error('salon transaction safety tests failed:\n- '+failures.join('\n- '));process.exit(1)}
console.log('salon transaction safety tests passed: service-only RPC, idempotency, row locks, store permission, RLS');
