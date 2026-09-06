const fs=require('fs'),sql=fs.readFileSync('supabase/migrations/20260906070408_salon_catalog_inventory_operations.sql','utf8'),fail=[];const ok=(x,m)=>{if(!x)fail.push(m)};
['salon_catalog_store_settings','salon_create_catalog_item','salon_enable_catalog_item','salon_set_catalog_status','salon_count_inventory','salon_list_catalog_inventory'].forEach(x=>ok(sql.includes(x),x+' missing'));
ok(/catalog','write/.test(sql)&&/catalog','read/.test(sql)&&/inventory','write/.test(sql),'permission checks missing');ok(/low_stock boolean/.test(sql)&&/quantity,0\)<=s\.safety_stock/.test(sql),'low-stock projection missing');
ok(/for update/.test(sql)&&/库存不足，不能出库/.test(sql),'inventory locking or nonnegative guard missing');ok(/force row level security/i.test(sql),'RLS missing');ok(!/security definer/i.test(sql),'functions must use invoker');
ok((sql.match(/revoke execute on function/g)||[]).length===5&&(sql.match(/grant execute on function/g)||[]).length===5,'function grants missing');
if(fail.length){console.error('salon catalog SQL tests failed:\n- '+fail.join('\n- '));process.exit(1)}console.log('salon catalog SQL tests passed: store settings, lifecycle, count, low stock, permissions');
