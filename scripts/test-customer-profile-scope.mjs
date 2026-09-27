// Synthetic fixtures only; never contacts production.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { webcrypto } from 'node:crypto';
import { customerProfileStoreFilter, scopeCustomerProfile, customerReadStores, customerIdentityRows, scopeCustomerHairRecords, customerRecordsStoreFilter } from '../supabase/functions/_shared/customer-profile-scope.mjs';
import { mergeEmployeeBookingRows } from '../supabase/functions/_shared/employee-booking-merge.mjs';
import { customerHairPhoneFilter, customerHairIdentityRows } from '../supabase/functions/_shared/customer-profile-scope.mjs';

const store = '自由手艺人', other = '向里造型';
const profile = { phone: '13800000000', name: '合成跨店客户', shop_name: other, total_visits: 999,
  total_consumption: 999999, notes: '主店私有备注', preferences: { private: true }, barber_name: '其他店员工',
  card_packages: [{ id: 'ours', shop: store, left: 4 }, { id: 'other', shop: other, left: 2 }, { id: 'legacy', left: 1 }],
  service_history: [{ id: 'old', date: '2026-09-01', shop: store, amount: 100, barber: '本店员工' },
    { id: 'new', date: '2026-09-27', shop: store, amount: 0, staff: ['本店员工'] },
    { id: 'other', date: '2026-09-28', shop: other, amount: 900 }, { id: 'unknown', date: '2026-09-20', amount: 1000 }] };
const scoped = scopeCustomerProfile(profile, store);
assert.deepEqual(scoped.card_packages.map(x => x.id), ['ours']);
assert.deepEqual(scoped.service_history.map(x => x.id), ['new', 'old']);
assert.equal(scoped.total_visits, 2);
assert.equal(scoped.total_consumption, 100);
assert.equal(scoped.notes, '');
assert.equal(scoped.preferences, null);
assert.equal(scoped.barber_name, '本店员工');
assert.equal(scoped.summary_scope, 'synced_store_records');
assert.equal(profile.card_packages.length, 3, 'projection must not mutate source');
assert.equal(scopeCustomerProfile({ ...profile, card_packages: [], service_history: [] }, store), null);
assert.equal(scopeCustomerProfile({ ...profile, shop_name: store, card_packages: [{ id: 'legacy' }], service_history: [] }, store).card_packages.length, 1);
assert.throws(() => customerProfileStoreFilter('任意门店'));
const filter = new URLSearchParams(customerProfileStoreFilter(store)).get('or');
assert(filter.includes('shop_name.eq.') && filter.includes('card_packages.cs.') && filter.includes('service_history.cs.'));

let context, validSession = true;
const reads = [], writes = [];
context = vm.createContext({ Request, Response, TextEncoder, crypto: webcrypto,
  mergeEmployeeBookingRows, customerProfileStoreFilter, scopeCustomerProfile, customerReadStores, customerIdentityRows, scopeCustomerHairRecords, customerHairPhoneFilter, customerHairIdentityRows,
  Deno: { env: { get: k => k === 'SUPABASE_URL' ? 'https://synthetic.local' : 'synthetic-key' }, serve: fn => { context.handler = fn; } },
  fetch: async (url, init = {}) => {
    const path = new URL(url).pathname, params = new URL(url).searchParams;
    const method = init.method || 'GET';
    if (method !== 'GET') { writes.push({path, method}); return new Response(null, {status: 204}); }
    reads.push({path, params});
    let result;
    if (path.endsWith('/employee_booking_sessions')) result = validSession ? [{username:'测试员工', store}] : [];
    else if (path.endsWith('/staff')) result = [{username:'测试员工', store, active:true, employment_status:'active'}];
    else if (path.endsWith('/customer_profiles')) result = [profile, {...profile, card_packages:[], service_history:[]}];
    else if (path.endsWith('/bookings')) result = [];
    else throw new Error('unexpected endpoint');
    return Response.json(result);
  }
});
const edge = fs.readFileSync('supabase/functions/employee-bookings-api/index.ts','utf8').replace(/^import .*;\n/gm, '');
vm.runInContext(stripTypeScriptTypes(edge), context);
const post = payload => context.handler(new Request('https://synthetic.local', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)}));
for (const operation of ['customer_profiles', 'customer_history']) {
  const response = await post({operation, session_token:'fixture-token', search:profile.phone, phone:profile.phone, store:other});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.store, store, 'caller cannot override authenticated store');
  assert.equal(body.rows.length, 1);
  assert.equal(body.rows[0].card_packages.length, 1);
  const query = reads.filter(x => x.path.endsWith('/customer_profiles')).at(-1).params;
  assert.equal(query.get('or'), filter);
  assert.equal(query.getAll('or').length, 1);
  if (operation === 'customer_profiles') assert(query.get('and').includes('phone.ilike'));
  else assert.equal(query.get('phone'), 'eq.' + profile.phone);
}
const shared = scopeCustomerProfile(profile, store, 'all');
assert.equal(shared.card_packages.length, 3);
assert.equal(shared.service_history.length, 4);
assert.equal(shared.card_packages[2].shop, other, 'legacy package retains known home-store origin');
assert.equal(shared.home_store, other);
assert.equal(shared.notes, profile.notes);
assert.equal(shared.total_visits, profile.total_visits, 'complete summary remains labeled as source summary');
assert.throws(() => customerReadStores('外部门店', 'all'));
assert.throws(() => customerReadStores(store, 'arbitrary'));
const contaminated = {...profile, card_packages:[...profile.card_packages,{id:'foreign',shop:'外部门店',left:99}]};
assert(!scopeCustomerProfile(contaminated,store,'all').card_packages.some(x=>x.id==='foreign'));
assert.equal(customerIdentityRows([profile,{...profile,name:'同一家庭另一位客户'}],profile.phone,profile.name).length,1);
assert.equal(customerIdentityRows([profile,{...profile,name:'同一家庭另一位客户'}],profile.phone,'').length,0);
assert.equal(customerIdentityRows([profile],'0000',profile.name).length,0);
assert.equal(customerIdentityRows([profile],'',profile.name).length,0);
const hairFixtures = [
  {id:'own',status:'completed',customer_phone:profile.phone,customer_name:profile.name,record_data:{shopName:store}},
  {id:'other',status:'completed',customer_phone:profile.phone,customer_name:profile.name,record_data:{shopName:other}},
  {id:'legacy',status:'completed',record_data:{customerPhone:profile.phone,customerName:profile.name}},
  {id:'foreign',status:'completed',customer_phone:profile.phone,customer_name:profile.name,record_data:{shopName:'外部门店'}},
  {id:'deleted',status:'deleted',customer_phone:profile.phone,customer_name:profile.name,record_data:{}},
];
assert.equal(customerHairIdentityRows(hairFixtures,profile.phone,profile.name).length,5);
assert.deepEqual(scopeCustomerHairRecords(hairFixtures,store,'all').map(x=>x.id),['own','other','legacy']);
assert.deepEqual(scopeCustomerHairRecords(hairFixtures,store,'store').map(x=>x.id),['own']);
assert(scopeCustomerHairRecords(hairFixtures,store,'all')[2].store_unconfirmed);
assert(customerHairPhoneFilter(profile.phone).includes('or='));
const allResponse=await post({operation:'customer_profiles',session_token:'fixture',customer_scope:'all',search:profile.phone,phone:profile.phone,name:profile.name,store:'外部门店'});
assert.equal(allResponse.status,200);
assert.equal((await allResponse.json()).rows[0].card_packages.length,3);
validSession = false;
const before = reads.filter(x => x.path.endsWith('/customer_profiles')).length;
assert.equal((await post({operation:'customer_profiles',session_token:'expired'})).status, 403);
assert.equal(reads.filter(x => x.path.endsWith('/customer_profiles')).length, before);
assert(writes.every(x => x.path.endsWith('/employee_booking_sessions') && x.method === 'PATCH'), 'customer access must never change business data');
console.log('customer profile scope tests passed: cross-store child projection, exact identity, session gate and read-only boundary');

// Execute the real frontdesk handler; no production access and no business writes.
const frontReads=[], frontWrites=[];
let front, active=true;
const restrict=(rows,params,column)=>{const filter=params.get(column);return !filter?rows:rows.filter(row=>filter.startsWith('in.')?filter.includes(JSON.stringify(row[column])):filter==='eq.'+row[column]);};
front=vm.createContext({Request,Response,TextEncoder,crypto:webcrypto,
  customerProfileStoreFilter,scopeCustomerProfile,customerRecordsStoreFilter,customerReadStores,customerIdentityRows,scopeCustomerHairRecords,customerHairPhoneFilter,customerHairIdentityRows,
  Deno:{env:{get:key=>key==='SUPABASE_URL'?'https://synthetic.local':'fixture'},serve:fn=>{front.handler=fn;}},
  fetch:async(url,init={})=>{
    const u=new URL(url),path=u.pathname,params=u.searchParams,method=init.method||'GET';
    if(method!=='GET'){frontWrites.push({path,method,params});return new Response(null,{status:204});}
    frontReads.push({path,params});
    let rows=[];
    if(path.endsWith('/frontdesk_sessions'))rows=[{username:'测试前台',store,role:'staff',position:'前台'}];
    else if(path.endsWith('/staff'))rows=[{username:'测试前台',store,role:'staff',position:'前台',active,employment_status:'active'}];
    else if(path.endsWith('/customer_profiles'))rows=[{...profile,id:1},{...profile,id:2,name:'同一家庭另一位客户'},...['3','4'].map(id=>({...profile,id,phone:'',name:'同名无手机客户'}))];
    else if(path.endsWith('/mgj_service_records'))rows=restrict([store,other].map(shop_name=>({source_id:'same-id',customer_name:profile.name,customer_phone:profile.phone,shop_name,service_date:'2026-09-27',items:[{name:'剪发'}],amount:0})),params,'shop_name');
    else if(path.endsWith('/hair_records'))rows=hairFixtures;
    else if(path.endsWith('/frontdesk_import_records'))rows=[];
    else if(path.endsWith('/frontdesk_today_customers'))rows=[];
    else throw new Error('unexpected frontdesk path '+path);
    if(params.has('id'))rows=rows.filter(row=>'eq.'+row.id===params.get('id'));
    return Response.json(rows);
  }
});
vm.runInContext(stripTypeScriptTypes(fs.readFileSync('supabase/functions/frontdesk-api/index.ts','utf8').replace(/^import .*;\n/gm,'')),front);
const frontPost=payload=>front.handler(new Request('https://synthetic.local',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session_token:'fixture',...payload})}));
for(const scope of ['all','store']){
  const response=await frontPost({operation:'customer_detail',phone:profile.phone,name:profile.name,customer_scope:scope,store:other});
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.store,store,'shared read must not change operational store');
  assert.equal(data.data_quality.profile_rows,1,'shared phone names remain separate');
  assert.equal(data.packages.length,scope==='all'?3:1);
  assert.equal(data.hair_records.length,scope==='all'?3:1);
  assert.equal(data.timeline.filter(x=>x.source_id==='same-id').length,scope==='all'?2:1,'same bill id in separate stores must not collapse');
  assert(data.timeline.some(x=>x.amount===0&&x.amount_known));
}
const search=await (await frontPost({operation:'customer_search',query:'合成',customer_scope:'all'})).json();
assert.equal(search.results.length,4,'same names without phone and shared family phone must remain distinct');
const nameless=await (await frontPost({operation:'customer_detail',name:'同名无手机客户',profile_id:3,customer_scope:'all'})).json();
assert.equal(nameless.data_quality.profile_rows,1);
assert.equal(nameless.hair_records.length,0);
assert(nameless.identity_warning);
await frontPost({operation:'today_customer_delete',id:'fixture-record',store:other,customer_scope:'all'});
const ownDelete=frontWrites.pop();
assert.equal(ownDelete.path,'/rest/v1/frontdesk_today_customers');
assert.equal(ownDelete.params.get('store'),'eq.'+store,'all-store read never widens reception delete scope');
active=false;
const beforeFront=frontReads.filter(x=>x.path.endsWith('/customer_profiles')).length;
assert.equal((await frontPost({operation:'customer_detail',phone:profile.phone,name:profile.name,customer_scope:'all'})).status,403);
assert.equal(frontReads.filter(x=>x.path.endsWith('/customer_profiles')).length,beforeFront);
assert(frontWrites.every(x=>x.path.endsWith('/frontdesk_sessions')),'customer sharing never mutates customer, booking or financial records');
console.log('frontdesk shared customer API passed: both scopes, identity conflicts, origin-preserving history, expired/unknown archives, session revocation and write isolation');
