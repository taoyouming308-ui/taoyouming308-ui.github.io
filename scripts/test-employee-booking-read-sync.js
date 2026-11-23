// Exercise the actual employee booking adapters and list UI with a fake server; never contact real stores.
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const src = fs.readFileSync('perm-app.html','utf8');
const between = (a,b) => {const i=src.indexOf(a), j=src.indexOf(b,i+a.length);assert(i>=0&&j>i,a);return src.slice(i,j);};
const store = new Map(), list = {innerHTML:'',textContent:''}, picker = {textContent:''};
const localStorage = {get length(){return store.size;},key:i=>[...store.keys()][i],getItem:k=>store.get(k),removeItem:k=>store.delete(k)};
const auth = {session_token:'mock-token',store:'mock-store',username:'mock-employee',position:'mock-role'};
const c = vm.createContext({
  window:{}, document:{getElementById:id=>id==='booking-list'?list:picker}, localStorage,
  verifiedEmployeeSession:()=>c.AUTHENTICATED_STAFF, AUTHENTICATED_STAFF:auth, BOOKING_SHOP:auth.store,
  BOOKING_BARBER:auth.username, BOOKING_DATE:'2026-11-23',bookingReadGeneration:0,BOOKINGS_CACHE:[], showIdentityModal(){},
  isEmployeeSessionInvalid:e=>e.status===403, renderBookings(rows){renders.push(rows);},
});
const renders=[], requests=[], pending=[], configs=[];
c.employeeBookingsRequest=(op,body)=>{requests.push({op,body});return Promise.resolve({ok:true});};
let clears=0; c.window.ZysyrReadSync={clear(){clears++;}, read(config){configs.push(config);return new Promise((resolve,reject)=>pending.push({resolve,reject}));}};
store.set('bookings_cache_mock_2026-11-23','sensitive legacy value');store.set('hair-form-draft','do not delete');
vm.runInContext(between('  function employeeBookingsApi(','  function employeeBookingsRequest(')+
  between('  // Retire only the old plaintext','  function clearBookingSession(')+
  between('  function forgetBookingReads()', "  window.addEventListener('storage'")+
  between('  function loadBookings(', '  // ★ 独立渲染函数'),c);
c.clearBookingSession=()=>{c.forgetBookingReads();c.AUTHENTICATED_STAFF=null;};
const currentReport={date:c.BOOKING_DATE,store:auth.store,barber:auth.username,
  rows:[{id:'1',customer_name:'PRIVATE_CUSTOMER',customer_phone:'PRIVATE_PHONE',barber_name:auth.username,notes:'PRIVATE_NOTE'}]};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  assert.deepEqual([...store.keys()],['hair-form-draft']);
  c.loadBookings(true);const a=configs[0];
  assert.equal(a.current(),true);assert.equal(a.persist,false);assert.equal(a.secret,auth.session_token);
  assert(!a.scope.includes(auth.session_token));assert.deepEqual(JSON.parse(JSON.stringify(a.summary(currentReport))),{count:1});
  assert.equal(a.summary({...currentReport,store:'wrong'}),null);
  a.onPreview(currentReport,Date.now()); assert.match(list.textContent,/1 条预约/);
  assert(!list.textContent.includes('PRIVATE'));assert.equal(renders.length,0,'no action/record until confirmed');
  const hint={v:1,rev:'synthetic'};await a.send(hint);assert.equal(requests[0].body.read_sync,hint);
  pending[0].resolve(currentReport);await tick();assert.equal(renders[0][0].id,'1');
  c.loadBookings(false);const b=configs[1];assert.equal(a.current(),false);assert.equal(b.current(),true);
  pending[1].reject(new Error('offline'));await tick();assert.match(list.textContent,/尚未核实/);
  c.loadBookings(true);const old=configs[2];c.AUTHENTICATED_STAFF={...auth,position:'new role'};assert.equal(old.current(),false);
  c.AUTHENTICATED_STAFF={...auth,session_token:'another token'};assert.equal(old.current(),false);
  c.AUTHENTICATED_STAFF=auth;pending[2].reject(Object.assign(new Error('失效'),{status:403}));await tick();
  assert.equal(clears,1);assert.equal(c.AUTHENTICATED_STAFF,null);assert.equal(list.textContent,'');
  const count=configs.length;
  for(const op of ['login','logout','customer_profiles','customer_hair_records','customer_history','customer_design_save']){
    await c.employeeBookingsApi(op,{},{});assert.equal(requests.at(-1).op,op);assert(!('read_sync' in requests.at(-1).body));
  }
  await c.employeeBookingsApi('today_bookings',{date:'old-client-no-hint'});
  assert.equal(configs.length,count);
  const edge=fs.readFileSync('supabase/functions/employee-bookings-api/index.ts','utf8');
  assert(edge.indexOf('const session = await requireEmployeeSession(payload)')<edge.indexOf('const result = await todayBookings(payload, session)'));
  assert(edge.includes('payload.read_sync ? await encodeReadSync(payload.read_sync, result) : result'));
  // Then plug the real authenticated read transport into the same adapter; no database/auth network.
  Object.assign(c,{crypto:require('node:crypto').webcrypto,TextEncoder,TextDecoder,setTimeout,clearTimeout});
  require('./read-rollout-vm-fixture.cjs')(c,fs.readFileSync('perm-app.html','utf8'));
  for (const name of ['scoped-read-codec.js','scoped-read-sync.js']) vm.runInContext(fs.readFileSync(name,'utf8'),c);
  c.window.ZysyrReadSync=c.ZysyrReadSync;
  c.AUTHENTICATED_STAFF={...auth,session_token:'mock-signed-in-token-with-over-24-chars'};
  let wire=[], previews=[], mockData={...currentReport,rows:Array.from({length:50},(_,i)=>({...currentReport.rows[0],id:String(i)}))};
  const {encodeReadSync}=await import('../supabase/functions/_shared/read-sync.mjs');
  c.employeeBookingsRequest=async(op,body)=>{
    const encoded=await encodeReadSync(body.read_sync,mockData);wire.push(encoded);
    return JSON.parse(JSON.stringify(encoded));
  };
  const read=()=>c.employeeBookingsApi('today_bookings',{date:mockData.date,session_token:c.AUTHENTICATED_STAFF.session_token},
    {current:()=>true,preview:s=>previews.push(s)});
  const verify=async()=>assert.deepEqual(JSON.parse(JSON.stringify(await read())),mockData,'complete authorized payload reconstructs exactly');
  await verify(); const fullSize=JSON.stringify(wire[0]).length;
  await verify(); assert.deepEqual(JSON.parse(JSON.stringify(previews)),[{count:50}]);
  assert.equal(wire[1].__zysyr_read,1);assert(JSON.stringify(wire[1]).length<fullSize);
  mockData={...mockData,rows:mockData.rows.map((row,i)=>i===25?{...row,notes:'PRIVATE_EDIT'}:row)};
  await verify(); assert.equal(wire[2].__zysyr_read,1); assert(Array.isArray(wire[2].patch),'local edit can travel as a patch');
  mockData={...mockData,rows:mockData.rows.slice(1)};await verify();
  // Removing the first item can shift all boundaries. A full reply is intentional if smaller.
  assert(wire[3].rows || Array.isArray(wire[3].patch));
  assert(Buffer.byteLength(JSON.stringify(wire[3]))<=Buffer.byteLength(JSON.stringify(mockData)));
  console.log('synthetic booking response bytes (full, unchanged, edited, deleted):', wire.map(x=>Buffer.byteLength(JSON.stringify(x))).join(', '));
  console.log('PASS employee booking read sync: protected read only, count-only previews, date/role/token isolation, legacy cleanup, failure and revocation');
})().catch(e=>{console.error(e);process.exitCode=1;});
