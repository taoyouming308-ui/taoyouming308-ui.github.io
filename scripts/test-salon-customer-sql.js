const fs=require('fs'),sql=fs.readFileSync('supabase/migrations/20260906065710_salon_customer_transactions.sql','utf8'),fail=[];
const ok=(value,message)=>{if(!value)fail.push(message)};
['salon_create_customer','salon_set_customer_status','salon_update_customer_relation','salon_list_customers'].forEach(name=>ok(sql.includes(name),name+' missing'));
ok(/customers','write/.test(sql)&&/customers','read/.test(sql),'customer permissions missing');
ok(/regexp_replace[\s\S]*?\^1\[0-9\]\{10\}\$/.test(sql),'server phone normalization missing');
ok(/left\(c\.phone_normalized,3\)\|\|'\*\*\*\*'\|\|right/.test(sql),'masked phone projection missing');
ok(/r\.store_id=p_store_id/.test(sql),'store relationship scope missing');
ok((sql.match(/for update/g)||[]).length>=2,'customer row locks missing');
ok(/负责人不是当前门店在职员工/.test(sql),'owner store validation missing');
ok(/force row level security/i.test(fs.readFileSync('supabase/migrations/20260906040530_salon_core_foundation.sql','utf8')),'customer RLS missing');
ok(!/security definer/i.test(sql),'customer functions must use invoker security');
ok((sql.match(/revoke execute on function/g)||[]).length===4&&(sql.match(/grant execute on function/g)||[]).length===4,'function grants missing');
if(fail.length){console.error('salon customer SQL tests failed:\n- '+fail.join('\n- '));process.exit(1)}
console.log('salon customer SQL tests passed: dedupe, store scope, masked reads, locks, permissions');
