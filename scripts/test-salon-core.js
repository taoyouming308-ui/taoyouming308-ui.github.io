const fs=require('fs');
const sql=fs.readFileSync('supabase/migrations/20260906040530_salon_core_foundation.sql','utf8');
const html=fs.readFileSync('salon-app.html','utf8');
const failures=[];const expect=(ok,msg)=>{if(!ok)failures.push(msg)};
for(const block of html.matchAll(/<script>([\s\S]*?)<\/script>/g)){try{new Function(block[1])}catch(error){failures.push('salon app script syntax: '+error.message)}}
['salon_organizations','salon_stores','salon_roles','salon_staff','salon_customers','salon_catalog_items','salon_appointments','salon_orders','salon_order_lines','salon_member_accounts','salon_account_ledger','salon_payments','salon_audit_events'].forEach(t=>expect(sql.includes('public.'+t),t+' missing'));
expect(sql.includes("data_scope in ('self','store','organization')"),'role data scope missing');
expect(sql.includes("status in ('draft','opened','in_service','awaiting_payment','paid','cancelled','reversed')"),'order lifecycle missing');
expect(sql.includes('reversal_of_id'),'reversal lineage missing');
expect((sql.match(/force row level security/g)||[]).length===1 && sql.includes("foreach table_name"),'RLS loop missing');
expect(sql.includes('revoke all on table public.%I from public, anon, authenticated'),'public table access is not revoked');
['顾客会员','预约排客','开单收银','库存管理','员工组织','业绩工资','财务报表','作品评价','营销顾客端','系统设置'].forEach(m=>expect(html.includes(m),m+' navigation missing'));
expect(html.includes('不连接生产数据'),'offline boundary missing');
if(failures.length){console.error('salon core test failed:\n- '+failures.join('\n- '));process.exit(1)}
console.log('salon core test passed');
