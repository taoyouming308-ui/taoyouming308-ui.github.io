// Offline regression: actual employee adapter, AI flow and archive render, no real customer or backend.
// Optional historical measurement: node scripts/test-stylist-secondary-reads.cjs --baseline <git-ref>
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),cp=require('node:child_process');
const old=process.argv[2]==='--baseline',ref=process.argv[3];
if(old)assert(/^[a-z\d./_-]+$/i.test(ref) && !ref.startsWith('-'));
const read=file=>old?cp.execFileSync('git',['show',ref+':'+file],{encoding:'utf8',maxBuffer:10e6}):fs.readFileSync(file,'utf8');
const html=read('perm-app.html'),take=(a,b)=>{const i=html.indexOf(a),j=html.indexOf(b,i+1);assert(i>=0 && j>i,a);return html.slice(i,j);};
const tick=()=>new Promise(r=>setImmediate(r));
async function testEmployeeHairProjection(metrics){
  const shared=await import('../supabase/functions/_shared/customer-profile-scope.mjs');
  const edge=read('supabase/functions/employee-bookings-api/index.ts');
  const from=edge.indexOf('async function customerHairRecords('),to=edge.indexOf('async function customerHistory(',from);
  const phone='13800000001',own='自由手艺人',other='向里造型',requests=[];
  const generate=(i,name='甲',shop=own)=>({id:String(i),customer_phone:null,customer_name:null,status:'ok',created_at:'2026-11-22',record_data:{
    formFields:{'hair-form-phone':phone,'hair-form-name':name},shopName:shop,seq:i,bookingId:i,date:'2026-11-22',
    serviceBeforePhoto:'data:image/jpeg;base64,'+'X'.repeat(4096),privateNotes:'hidden'}});
  const rows=[...Array.from({length:501},(_,i)=>generate(i)),generate(501,'乙'),generate(502,'甲',other),generate(503,'甲',''),{...generate(504),status:'deleted'}];
  const receptionId='a5c6111b-97b8-4073-b063-f8f475193738';let bookingStatus=0,receptionStatus='arrived';
  const cx=vm.createContext({...shared,cleanText:v=>String(v||'').trim(),safeFilterValue:encodeURIComponent,
    restRows:async path=>{
      if(path.startsWith('bookings?') || path.startsWith('frontdesk_today_customers?')){
        requests.push(path); assert(path.includes('barber_name=eq.') && path.includes('id=eq.') && path.includes('date=eq.2026-11-22'));
        const desk=path.startsWith('frontdesk_today_customers?'),id=desk?receptionId:'7',params=new URL('http://fixture/'+path).searchParams;
        assert.equal(params.get('id'),'eq.'+id,'retain every character of the verified source ID');
        assert(params.get('select').split(',').includes('status'));
        return [{id,customer_phone:phone,customer_name:'甲',status:desk?receptionStatus:bookingStatus}];
      }
      if(path.startsWith('hair_analysis_queue?')){
        requests.push(path);assert(path.includes('phone=ilike.') && decodeURIComponent(path).includes('shop_name.eq.') && decodeURIComponent(path).includes('booking_date.eq.2026-11-22'));
        return [{booking_id:7,booking_date:'2026-11-22',customer_name:'甲',phone,status:'pending',shop_name:own,barber_name:'员工'}];
      }
      requests.push(path);const params=new URL('http://fixture/'+path).searchParams;
      assert(params.get('or').includes('hair-form-phone'));assert.equal(params.get('status'),'neq.deleted');
      const selectedId=params.get('id'),offset=Number(params.get('offset')||0);
      const fields=params.get('select').split(',');
      return rows.filter(r=>r.status!=='deleted' && (!selectedId || 'eq.'+r.id===selectedId))
        .slice(offset,offset+Number(params.get('limit'))).map(r=>Object.fromEntries(fields.map(part=>{
          const [to,from]=part.split(':');const value=from?from.split('->').reduce((item,k)=>item?.[k],r):r[to];
          return [to,value??null];
        })));
    }});
  vm.runInContext(require('node:module').stripTypeScriptTypes(edge.slice(from,to)),cx);
  const query=(view,scope='store',id='',name='甲')=>cx.customerHairRecords({phone,name,customer_scope:scope,read_view:view,record_id:id},{store:own});
  const legacy=await query(undefined);assert.equal(legacy.rows.length,501);
  const index=await query('index');assert.equal(index.rows.length,501);assert.equal(index.rows.at(-1).id,'500');
  assert(!JSON.stringify(index).includes('data:image'));assert(!JSON.stringify(index).includes('privateNotes'));
  assert.equal(index.rows[0].record_data.formFields['hair-form-name'],'甲');
  assert.equal(index.rows[500].record_data.bookingId,500);
  const actualIndexPath=requests.find(p=>p.includes('h_form_phone:'));
  assert(actualIndexPath && !new URL('http://fixture/'+actualIndexPath).searchParams.get('select').split(',').includes('record_data'));
  const one=await query('record','store','500');assert.equal(one.rows.length,1);assert(one.rows[0].record_data.serviceBeforePhoto);
  for(const id of ['501','502','503','504'])assert.equal((await query('record','store',id)).rows.length,0);
  assert.equal((await query('record','all','502')).rows.length,1);assert.equal((await query('record','all','503')).rows[0].store_unconfirmed,true);
  assert.equal((await query('record','all','501','')).rows.length,0,'shared family phone alone is not authority');
  assert.equal((await query('record','all','501','乙')).rows[0].id,'501');
  metrics.hairArchiveApi={fixtureOwnRecords:501,oldCompleteBytes:Buffer.byteLength(JSON.stringify(legacy)),
    indexPlusOneCompleteBytes:Buffer.byteLength(JSON.stringify(index))+Buffer.byteLength(JSON.stringify(one))};
  const visit={date:'2026-11-22',booking_id:'7',phone,name:'甲',customer_scope:'store'},staff={store:own,username:'员工'};
  const beforeProbe=requests.length;assert.equal((await cx.bookingHairStatus({...visit,phone:'13800000002'},staff)).verified,false);
  assert.equal(requests.length,beforeProbe+1,'no hair or queue information released on a stale visit');
  const hint=await cx.bookingHairStatus(visit,staff);
  assert.equal(hint.verified,true);assert.equal(hint.queue[0].status,'pending');
  assert(!JSON.stringify(hint).includes('data:image'));const queuePath=requests.at(-1);
  const deskVisit={...visit,booking_id:'frontdesk:'+receptionId};
  assert.equal((await cx.bookingHairStatus(deskVisit,staff)).verified,true);
  for(const cancelled of [2,'2',null,'unknown']){
    bookingStatus=cancelled;const start=requests.length;assert.equal((await cx.bookingHairStatus(visit,staff)).verified,false);
    assert.equal(requests.length,start+1,'do not query hair archives or queue for invalid booking state');
  }
  for(const cancelled of ['cancelled',null,'unknown']){
    receptionStatus=cancelled;const start=requests.length;assert.equal((await cx.bookingHairStatus(deskVisit,staff)).verified,false);
    assert.equal(requests.length,start+1,'do not query hair archives or queue for invalid reception state');
  }
  if(process.argv.includes('--postgrest')){
    // Use the actual projected URL against ephemeral synthetic PG/PostgREST.
    const {realPostgrest}=require('./test-frontdesk-archive-projection.cjs');
    await realPostgrest(actualIndexPath.replace('select=','select=seq:record_data->seq,'),async(row,{sql,base})=>{
      assert.equal(row.h_form_name,'甲');assert.equal(row.h_form_phone,phone);assert.equal(row.h_shopName,own);
      assert.equal(row.seq,17);assert.equal(row.h_seq,17);
      sql("create table hair_analysis_queue(id int,phone text,booking_id int,booking_date date,created_at timestamptz,status text,customer_name text,shop_name text,barber_name text); grant select on hair_analysis_queue to synthetic; insert into hair_analysis_queue values(1,'138-0000-0001',7,'2026-11-22',now(),'pending','甲','自由手艺人','员工'); notify pgrst,'reload schema';");
      for(let i=0;i<30;i++){const res=await fetch(base+'/'+queuePath),rows=await res.json();if(res.ok){assert.equal(rows.length,1);break;}if(res.status!==404 || i===29)throw Error(JSON.stringify(rows));await new Promise(r=>setTimeout(r,150));}
    });
  }
}
async function testSelectedArchiveUi(){
  const reads=[], events=[],fixturePhone='13800000001',own='甲';
  const skinny=[{id:'current',customer_name:own,customer_phone:fixturePhone,record_data:{bookingId:'101',date:'2026-11-23'}},
    {id:'old-same-day',customer_name:own,customer_phone:fixturePhone,record_data:{bookingId:'99',date:'2026-11-23'}}];
  let oldServer=false,changed=false,active=true;
  const c=vm.createContext({window:{},AUTHENTICATED_STAFF:{session_token:'s1'},customerReadOwner:()=>'owner1',getCustomerReadScope:()=>'store',
    employeeBookingsApi:async(op,payload)=>{
      reads.push({...payload});assert.equal(op,'customer_hair_records');assert.equal(payload.customer_scope,'store');
      const full=skinny.map(r=>({...r,record_data:{...r.record_data,secret:'full-'+r.id}}));
      if(oldServer)return {rows:full};
      if(payload.read_view==='index')return {read_view:'index',rows:skinny};
      return {read_view:'record',rows:changed?[]:full.filter(r=>r.id===payload.record_id)};
    },enrichHairRecordsWithCareRows:async rows=>{events.push(rows.map(r=>r.id).join(','));return rows;}});
  vm.runInContext(take('  function normalizeHairCustomerPhone(', '  function fetchAllSupabaseRows(')+
    take('  function normalizeHairBookingDate(','  function hairQueueMatchesBooking(')+
    take('  function findHairRecordForBooking(', '  function findHairQueueRowsForBooking(')+
    take('  function fetchHairRecordsForCustomer(','  function parseHairArrayField('),c);
  const fetchRecord=()=>c.readSelectedHairArchive(fixturePhone,own,'101','2026-11-23','store',()=>active);
  let result=await fetchRecord();assert.equal(result.secret,'full-current');
  assert.deepEqual(reads.map(p=>p.read_view),['index','record']);assert.deepEqual(events,['current']);
  changed=true;await assert.rejects(fetchRecord,/已变更/);changed=false;active=false;
  const count=reads.length;assert.equal(await fetchRecord(),null);assert.equal(reads.length,count+1,'no detail request after leaving');
  oldServer=true;active=true;const start=reads.length;result=await fetchRecord();assert.equal(result.secret,'full-current');assert.equal(reads.length,start+1);
  assert(!take('  window.showHairRecordByPhone =','  window.createAndOpenHairTask').includes('hair_analysis_queue'));
  assert(!take('  window.renderHairRecordReadOnly =','  // 客户历史档案').includes('localStorage'));
  // Execute actual form loader: edit/switch while a slow read is pending.
  const listeners={},loaded=[];let gate,owner='first';
  const modal={isConnected:true,addEventListener:(event,fn)=>{listeners[event]=fn;},_selectedArchive:{recordId:'current',phone:fixturePhone,name:own,scope:'store'}};
  const form=vm.createContext({window:{_hairViewMode:'form',loadHairRecordData:rec=>loaded.push(rec)},document:{getElementById:id=>id==='hair-analysis-modal'?modal:null},
    customerReadOwner:()=>owner,fetchHairRecordsForCustomer:()=>new Promise(resolve=>{gate=resolve;}),alert(){}});
  vm.runInContext(take('  function hairArchiveEditStamp(', '  window.openHairRecordArchive =')+take('  window.loadCloudRecord =','  window.markFollowUpDone'),form);
  form.window.loadCloudRecord('current',false,true);listeners.input({type:'input',target:{closest:()=>true}});gate([{id:'current'}]);await tick();assert.equal(loaded.length,0);
  form.window.loadCloudRecord('current',false,true);owner='second';gate([{id:'current'}]);await tick();assert.equal(loaded.length,0);
  form.window.loadCloudRecord('current',false,true);gate([{id:'current'}]);await tick();assert.equal(loaded.length,1);
  const badge={dataset:{phone:fixturePhone,name:own,bookingId:'101',bdate:'2026-11-23',barber:'员工'},isConnected:true};
  let apiCalls=0,newTasks=0,pending=0,saved=0,mode='old';
  const b=vm.createContext({window:{showToast(){},createAndOpenHairTask(){newTasks++;},openHairAnalysisForBooking(){pending++;},showHairRecordByPhone(){saved++;}},
    document:{querySelectorAll:()=>[badge],getElementById:()=>null},customerReadOwner:()=>'owner',getCustomerReadScope:()=>'store',BOOKING_DATE:'2026-11-23',isForegroundFeature:()=>true,
    verifiedEmployeeSession:()=>({session_token:'fixture'}),findHairRecordForBooking:rows=>rows[0],employeeBookingsApi:async(op,body)=>{
      assert.equal(op,'booking_hair_status');apiCalls++;if(mode==='old')throw Error('unknown op');
      return {verified:true,rows:mode==='saved'?[{id:'current'}]:[],queue:mode==='empty'||mode==='saved'?[]:[{status:mode}]};
    }});
  vm.runInContext(take('  window.loadHairTagStatuses =','  window.openHairAnalysisForBooking ='),b);
  b.window.loadHairTagStatuses();assert.equal(apiCalls,0,'zero store-wide badge reads on calendar paint');
  await badge.onclick();assert.match(badge.textContent,/未核实/);assert.equal(newTasks,0,'an old Edge cannot authorize a new task');
  mode='completed';await badge.onclick();assert.match(badge.textContent,/原档待核对/);assert.equal(saved,0);
  mode='pending';await badge.onclick();assert.equal(pending,1);
  mode='empty';await badge.onclick();assert.equal(newTasks,0);assert.equal(badge.dataset.offerNew,'1');
  mode='saved';await badge.onclick();assert.equal(saved,1);assert.equal(newTasks,0,'another device created an archive between taps');
  mode='empty';await badge.onclick();await badge.onclick();assert.equal(newTasks,1);
}
async function run(){
  const metrics={mode:old?'baseline':'candidate',type:'isolated synthetic fixtures, no live requests'};
  let calls=0,wireBytes=0;const rows={rows:[{record_data:{note:'x'.repeat(512)}}]};
  const fakeStaff={session_token:'synthetic',username:'worker',store:'A',position:'staff'};
  const c=vm.createContext({window:{},AUTHENTICATED_STAFF:fakeStaff,
    employeeBookingsRequest:async()=>{calls++;wireBytes+=Buffer.byteLength(JSON.stringify(rows));await tick();return rows;}});
  vm.runInContext(read('data-read-client.js')+take('  function employeeBookingsApi(','  function employeeBookingsRequest('),c);
  const payload={phone:'synthetic-customer',session_token:'synthetic',customer_scope:'all'};
  await Promise.all(Array.from({length:4},()=>c.employeeBookingsApi('customer_hair_records',payload)));
  metrics.concurrentCustomerReads=calls;metrics.responseBytes=wireBytes;
  assert.equal(calls,old?4:1);
  const before=calls;
  await Promise.all([c.employeeBookingsApi('customer_hair_records',payload),
    c.employeeBookingsApi('customer_hair_records',{...payload,customer_scope:'store'}),c.employeeBookingsApi('customer_hair_records',{...payload,session_token:'other'})]);
  assert.equal(calls-before,3,'no completed read replay, no sharing across sessions or scopes');
  const writes=calls;await Promise.all([1,2].map(()=>c.employeeBookingsApi('customer_design_save',payload)));
  assert.equal(calls-writes,2,'no write coalescing/replay');const verify=calls;
  await Promise.all([1,2].map(()=>c.employeeBookingsApi('customer_design_history',payload)));
  assert.equal(calls-verify,2,'post-save and conflict checks always re-read');
  const root={innerHTML:'',setAttribute(){},addEventListener(){},querySelectorAll(){return []}};
  const m=vm.createContext({window:{},document:{createElement:()=>root}});
  vm.runInContext(read('customer-design-archive.js'),m);
  const versions=Array.from({length:220},(_,i)=>({id:String(i),booking_id:i+1,status:'confirmed',created_at:new Date(1e12-i*864e5).toISOString(),
    baseline:{outline:'sample'},execution:{bangs:{target:'sample'}},photos:[]}));
  m.window.CustomerDesignArchive.mount({appendChild(){}},{name:'fixture',api:async()=>({versions})});
  await tick();assert.equal((root.innerHTML.match(/class="cda-visit"/g)||[]).length,220);
  metrics.expandedBodiesConstructed=(root.innerHTML.match(/class="cda-eight"/g)||[]).length;
  metrics.initialHistoryMarkupBytes=Buffer.byteLength(root.innerHTML);
  assert.equal(metrics.expandedBodiesConstructed,old?220:1);
  const configUrl='https://fixture.invalid/api/codex-plan',metricsAi={configs:0,requests:0,storageAccess:0};
  let owner='employee-A',scope='all',staff=true,xhr=null,fail=false;
  const aiButton={style:{}},closeButton={style:{}},box={isConnected:true,data:{},output:'',
    getAttribute(k){return this.data[k];},setAttribute(k,v){this.data[k]=v;},removeAttribute(k){delete this.data[k];},
    querySelector(){return null;},querySelectorAll(q){return q==='button'?[aiButton,closeButton]:q==='.ai-btn'?[aiButton]:[];},insertAdjacentHTML(_,s){this.output+=s;}};
  const a=vm.createContext({window:{addEventListener(){}},document:{querySelector:()=>box,getElementById:()=>null},setTimeout,clearTimeout,AbortController,
    fetch:async()=>{metricsAi.configs++;if(fail)throw Error('fixture offline');return {ok:true,json:async()=>({url:configUrl})};},
    XMLHttpRequest:class{open(method,url){assert.equal(method,'GET');assert(url.startsWith(configUrl));}send(){metricsAi.requests++;xhr=this;}},
    verifiedEmployeeSession:()=>staff,customerReadOwner:()=>owner,getCustomerReadScope:()=>scope,getLocalDateStr:()=>'2026-11-23',
    esc:s=>s,escAttr:s=>s,localStorage:{getItem(){metricsAi.storageAccess++;return null},setItem(){metricsAi.storageAccess++;}}});
  vm.runInContext(take(old?'  var _analyzedPhones = null;':'  var aiReadOwner =','  // ===== 本地保存烫发记录'),a);
  await tick();metrics.startupAiConfigRequests=metricsAi.configs;assert.equal(metricsAi.configs,old?1:0);
  if(!old){
    a.window.runAiAnalysis('fiction','A','barber','2026-11-23');a.window.runAiAnalysis('fiction','A','barber','2026-11-23');await tick();
    assert(aiButton.disabled && !closeButton.disabled);assert.equal(metricsAi.requests,1);assert.equal(metricsAi.configs,1);
    xhr.status=200;xhr.responseText='{"analysis":"fixture-result"}';xhr.onload();
    assert.equal(a._getCachedAnalysis('fiction','2026-11-23','barber'),'fixture-result');
    assert.equal(a._getCachedAnalysis('fiction','2026-11-23','other'),undefined);
    scope='store';assert.equal(a._getCachedAnalysis('fiction','2026-11-23','barber'),undefined);
    scope='all';a.window.runAiAnalysis('fiction','A','barber','2026-11-23');await tick();owner='employee-B';
    xhr.status=200;xhr.responseText='{"analysis":"late-secret"}';xhr.onload();
    assert(!box.output.includes('late-secret'));assert.equal(a._getCachedAnalysis('fiction','2026-11-23','barber'),undefined);
    assert.equal(metricsAi.storageAccess,0,'no legacy AI read or plaintext persistence');
    a.customerPlanConfigUntil=0;fail=true;a.window.runAiAnalysis('fiction','A','barber','2026-11-23');await tick();
    assert.equal(metricsAi.requests,2,'unverified fallback endpoint cannot receive a customer');assert(!aiButton.disabled);
    await testEmployeeHairProjection(metrics);await testSelectedArchiveUi();
  }
  console.log(JSON.stringify(metrics));
}
run().catch(e=>{console.error(e);process.exitCode=1;});
