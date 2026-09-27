// Synthetic fixtures only; never contacts production.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { webcrypto } from 'node:crypto';
import { customerProfileStoreFilter, scopeCustomerProfile } from '../supabase/functions/_shared/customer-profile-scope.mjs';
import { mergeEmployeeBookingRows } from '../supabase/functions/_shared/employee-booking-merge.mjs';

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
  mergeEmployeeBookingRows, customerProfileStoreFilter, scopeCustomerProfile,
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
validSession = false;
const before = reads.filter(x => x.path.endsWith('/customer_profiles')).length;
assert.equal((await post({operation:'customer_profiles',session_token:'expired'})).status, 403);
assert.equal(reads.filter(x => x.path.endsWith('/customer_profiles')).length, before);
assert(writes.every(x => x.path.endsWith('/employee_booking_sessions') && x.method === 'PATCH'), 'customer access must never change business data');
console.log('customer profile scope tests passed: cross-store child projection, exact identity, session gate and read-only boundary');
