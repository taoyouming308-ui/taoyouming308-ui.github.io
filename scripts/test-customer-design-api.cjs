#!/usr/bin/env node
// Synthetic boundaries only. Real database locking/immutability is tested separately.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {pathToFileURL} = require('node:url');
const {resolve} = require('node:path');
const cryptoNode = require('node:crypto');
let api, tests = 0;
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const empty = () => ({outline:'',root_flow:'',steps:Object.fromEntries(['style','person','length','features','layers','bangs','curls','care'].map(k=>[k,'']))});
const scope = {customer_profile_id:1,booking_id:10,booking_date:'2026-11-08',visit_key:'booking:10',store:'自由手艺人'};
const common = {customer_profile_id:1,booking_id:10,booking_date:'2026-11-08',customer_scope:'all'};
const session = {username:'测试发型师',store:'自由手艺人'};
const original = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nc3cAAAAASUVORK5CYII=','base64');
const digest = data => cryptoNode.createHash('sha256').update(data).digest('hex');
const upload = () => ({...common,operation:'customer_design_upload',request_id:A,data_base64:original.toString('base64'),mime_type:'image/png',filename:'original.png',stage:'before',angle:'front',caption:'原始状态，阶段待确认'});
const draft = () => ({...common,operation:'customer_design_save',request_id:B,expected_latest_version_id:null,status:'baseline',baseline:empty(),optimized:empty(),reasons:{},photo_ids:[]});
function fixture() {
  const f = {profiles:[{id:1,name:'测试顾客',phone:'13800000000',shop_name:'自由手艺人',card_packages:[],service_history:[]}],contexts:{10:{...scope}},versions:[],assets:[],objects:new Map(),calls:[],storagePosts:0,now:Date.parse('2026-11-08T05:00:00Z')};
  f.deps = {
    now:()=>f.now,supabaseUrl:'https://synthetic.supabase.co',
    restRows:async path=>{
      f.calls.push(['read',path]);
      const u = new URL('https://fixture/' + path), q=u.searchParams;
      if(u.pathname==='/bookings') return Object.values(f.contexts).filter(c=>c.booking_id===Number(q.get('id').slice(3))).map(c=>({id:c.booking_id,shop_name:c.store,date:c.booking_date,customer_name:'测试顾客',customer_phone:'13800000000'}));
      if(u.pathname==='/customer_profiles') return f.profiles.filter(p=>!q.has('id')||p.id===Number(q.get('id').slice(3)));
      const rows = u.pathname==='/customer_design_versions'?f.versions:f.assets;
      return rows.filter(r=>(!q.has('request_id')||r.request_id===q.get('request_id').slice(3))&&(!q.has('customer_profile_id')||r.customer_profile_id===Number(q.get('customer_profile_id').slice(3)))&&(!q.has('visit_key')||r.visit_key===q.get('visit_key').slice(3))&&(!q.has('id')||q.get('id').includes(r.id))).slice(Number(q.get('offset')||0),Number(q.get('offset')||0)+Number(q.get('limit')||1000));
    },
    rest:async(path,init)=>{
      const body=JSON.parse(init.body);f.calls.push(['rpc',path,body]);
      if(path.endsWith('validate_customer_design_ingest_grant')) return Response.json(f.grant||{...scope,expires_at:new Date(f.now+60000).toISOString(),author:'ChatGPT',source:'chatgpt'});
      if(path.endsWith('customer_design_resolve_context')) {
        const p=f.profiles.find(p=>p.id===body.p_customer_profile_id);
        const context=body.p_booking_id?f.contexts[body.p_booking_id]:{customer_profile_id:p.id,booking_id:null,booking_date:body.p_booking_date,visit_key:body.p_visit_key||'manual:'+body.p_booking_date,store:p.shop_name};
        return context?Response.json(context):Response.json({code:'42501',message:'CUSTOMER_DESIGN_IDENTITY_MISMATCH'},{status:403});
      }
      if(f.rpcError)return Response.json(f.rpcError,{status:400});
      if(path.endsWith('register_customer_design_asset')) {
        const asset={...body.p_payload,source:body.p_source,author:body.p_actor,created_at:new Date(f.now).toISOString()};
        f.assets.push(asset);return Response.json({asset});
      }
      if(path.endsWith('append_customer_design_version')) {
        const p=body.p_payload,previous=f.versions.filter(v=>v.visit_key===p.visit_key).at(-1);
        const existing=f.versions.find(v=>v.request_id===p.request_id);
        if(existing) return Response.json({saved:true,version:existing,latest_version_id:existing.id,already_applied:true});
        if((previous?.id||null)!==p.expected_latest_version_id) return Response.json({code:'40001',message:'CUSTOMER_DESIGN_VERSION_CONFLICT'},{status:400});
        const version={...p,id:crypto.randomUUID(),version_no:(previous?.version_no||0)+1,previous_version_id:previous?.id||null,source:body.p_source,author:body.p_actor,photos:p.photo_ids.map(id=>f.assets.find(a=>a.id===id)),created_at:new Date(f.now).toISOString()};
        f.versions.push(version);return Response.json({saved:true,version,latest_version_id:version.id});
      }
      throw Error('unexpected RPC '+path);
    },
    storage:async(path,init={})=>{
      f.calls.push(['storage',path,init.method||'GET']);
      if(path.startsWith('/object/sign/'))return Response.json({signedURL:path+'?token=synthetic'});
      if(init.method==='POST') {f.storagePosts++;if(f.objects.has(path))return Response.json({error:'exists'},{status:409});f.objects.set(path,Buffer.from(init.body));return Response.json({Key:path});}
      return f.objects.has(path)?new Response(f.objects.get(path)):new Response('',{status:404});
    },
  };
  return f;
}
async function run(label,fn){await fn();tests++;process.stdout.write('ok '+tests+' - '+label+'\n');}
async function rejects(fn,code,status){await assert.rejects(fn,e=>e instanceof api.CustomerDesignError&&e.code===code&&(!status||e.status===status));}
(async()=>{
 api=await import(pathToFileURL(resolve(__dirname,'../supabase/functions/_shared/customer-design-archive.ts')));
 await run('employee and import operations have explicit allowlist',async()=>{assert.equal(api.isCustomerDesignOperation('login'),false);await rejects(()=>api.handleCustomerDesign({operation:'today_bookings',ingest_token:'x'.repeat(64)},null,fixture().deps),'DESIGN_INGEST_DENIED',403);});
 await run('session is mandatory without scoped import authorization',()=>rejects(()=>api.handleCustomerDesign({...common,operation:'customer_design_history'},null,fixture().deps),'DESIGN_AUTH_REQUIRED',403));
 await run('all-store read still permits own-store design writes with server provenance',async()=>{const f=fixture(),p=draft();p.source='chatgpt';p.author='forged';const r=await api.handleCustomerDesign(p,session,f.deps);assert.equal(r.version.author,session.username);assert.equal(r.version.source,'manual');});
 await run('other-store customer is read only even with all-store selector',async()=>{const f=fixture();f.profiles[0].shop_name='向里造型';f.contexts[10].store='向里造型';const r=await api.handleCustomerDesign({...common,operation:'customer_design_history'},session,f.deps);assert.equal(r.can_write,false);await rejects(()=>api.handleCustomerDesign(draft(),session,f.deps),'DESIGN_WRITE_DENIED',403);});
 await run('store-only reads reject customers from another store',async()=>{const f=fixture();f.profiles[0].shop_name='向里造型';await rejects(()=>api.handleCustomerDesign({...common,customer_scope:'store',operation:'customer_design_history'},session,f.deps),'DESIGN_IDENTITY_AMBIGUOUS',403);});
 await run('name-only or masked phone never resolves a person',async()=>{for(const p of [{name:'测试顾客'},{phone:'138****0000',name:'测试顾客'}])await rejects(()=>api.handleCustomerDesign({...p,booking_id:10,operation:'customer_design_history'},session,fixture().deps),'DESIGN_IDENTITY_REQUIRED');});
 await run('full phone+name fallback resolves a unique exact identity',async()=>{const f=fixture();const r=await api.handleCustomerDesign({operation:'customer_design_history',phone:'13800000000',name:'测试顾客',booking_id:10,booking_date:'2026-11-08'},session,f.deps);assert.equal(r.customer_profile_id,1);});
 await run('ambiguous full identities fail closed',async()=>{const f=fixture();f.profiles.push({...f.profiles[0],id:2});await rejects(()=>api.handleCustomerDesign({operation:'customer_design_history',phone:'13800000000',name:'测试顾客',booking_id:10},session,f.deps),'DESIGN_IDENTITY_AMBIGUOUS',403);});
 await run('appointment anchors identical full profiles to its actual store',async()=>{const f=fixture();f.profiles.push({...f.profiles[0],id:2,shop_name:'向里造型'});const r=await api.handleCustomerDesign({operation:'customer_design_history',phone:'13800000000',name:'测试顾客',booking_id:10,booking_date:'2026-11-08',customer_scope:'all'},session,f.deps);assert.equal(r.customer_profile_id,1);assert.equal(r.can_write,true);});
 await run('appointment anchor cannot override full identity or widen writes',async()=>{const f=fixture();f.profiles.push({...f.profiles[0],id:2,shop_name:'向里造型'});f.contexts[11]={...scope,customer_profile_id:2,booking_id:11,visit_key:'booking:11',store:'向里造型'};const r=await api.handleCustomerDesign({operation:'customer_design_history',phone:'13800000000',name:'测试顾客',booking_id:11,booking_date:'2026-11-08',customer_scope:'all'},session,f.deps);assert.equal(r.customer_profile_id,2);assert.equal(r.can_write,false);await rejects(()=>api.handleCustomerDesign({operation:'customer_design_history',phone:'13900000000',name:'测试顾客',booking_id:10,customer_scope:'all'},session,f.deps),'DESIGN_SCOPE_DENIED',403);});
 await run('explicit customer id plus mismatched name is rejected',async()=>{await rejects(()=>api.handleCustomerDesign({...common,operation:'customer_design_history',name:'另一位'},session,fixture().deps),'DESIGN_IDENTITY_AMBIGUOUS',403);});
 await run('booking/date mismatch cannot bind photos or versions',async()=>{await rejects(()=>api.handleCustomerDesign({...draft(),booking_date:'2026-11-09'},session,fixture().deps),'DESIGN_SCOPE_DENIED',403);});
 await run('invalid calendar date rejected before lookup',async()=>{await rejects(()=>api.handleCustomerDesign({...common,operation:'customer_design_history',booking_date:'2026-02-30'},session,fixture().deps),'DESIGN_INVALID');});
 await run('expired scoped ingest token is rejected',async()=>{const f=fixture();f.grant={...scope,expires_at:new Date(f.now-1).toISOString()};await rejects(()=>api.handleCustomerDesign({...common,operation:'customer_design_history',ingest_token:'s'.repeat(64)},null,f.deps),'DESIGN_INGEST_DENIED',403);});
 await run('ingest token hash alone reaches database; provenance cannot be forged',async()=>{const f=fixture(),token='private-token-'.repeat(5);const p={...draft(),ingest_token:token,source:'manual',author:'forged'};const r=await api.handleCustomerDesign(p,null,f.deps);const call=f.calls.find(c=>c[1]==='rpc/validate_customer_design_ingest_grant');assert.equal(call[2].p_token_hash,digest(Buffer.from(token)));assert.ok(!JSON.stringify(f.calls).includes(token));assert.equal(r.version.source,'chatgpt');assert.equal(r.version.author,'ChatGPT');});
 await run('ingest cannot change customer, booking or service date',async()=>{for(const change of [{customer_profile_id:2},{booking_id:11},{booking_date:'2026-11-09'}])await rejects(()=>api.handleCustomerDesign({...common,...change,operation:'customer_design_history',ingest_token:'s'.repeat(64)},null,fixture().deps),'DESIGN_INGEST_DENIED',403);});
 await run('history latest version is selected visit, not global newest',async()=>{const f=fixture();f.versions=[{...scope,id:A,version_no:2,photo_ids:[]},{...scope,id:B,booking_id:11,visit_key:'booking:11',version_no:9,photo_ids:[]}];const r=await api.handleCustomerDesign({...common,operation:'customer_design_history'},session,f.deps);assert.equal(r.latest_version_id,A);assert.equal(r.versions.length,2);});
 await run('ingest history is restricted to fixed visit',async()=>{const f=fixture();f.versions=[{...scope,id:A,version_no:1,photo_ids:[]},{...scope,id:B,booking_id:11,visit_key:'booking:11',version_no:1,photo_ids:[]}];const r=await api.handleCustomerDesign({...common,operation:'customer_design_history',ingest_token:'s'.repeat(64)},null,f.deps);assert.deepEqual(r.versions.map(v=>v.id),[A]);});
 await run('manual dated visit has stable independent concurrency key',async()=>{const f=fixture(),p={...draft(),booking_id:null};const r=await api.handleCustomerDesign(p,session,f.deps);assert.equal(r.version.visit_key,'manual:2026-11-08');assert.equal(r.version.booking_id,null);});
 await run('every nonempty changed optimized field requires its reason',async()=>{const p=draft();p.optimized.steps.layers='低层次';await rejects(()=>api.handleCustomerDesign(p,session,fixture().deps),'DESIGN_INVALID');p.reasons.layers='保留重量';assert.equal((await api.handleCustomerDesign(p,session,fixture().deps)).saved,true);});
 await run('outline and root flow require reasons; blank draft remains valid',async()=>{for(const key of ['outline','root_flow']){const p=draft();p.optimized[key]='调整';await rejects(()=>api.handleCustomerDesign(p,session,fixture().deps),'DESIGN_INVALID');}assert.equal((await api.handleCustomerDesign(draft(),session,fixture().deps)).saved,true);});
 await run('URLs and oversized text are rejected before persistence',async()=>{for(const archive_url of ['https://evil.invalid/space/a','https://chatgpt.com.evil.invalid/space/a','javascript:alert(1)'])await rejects(()=>api.handleCustomerDesign({...draft(),archive_url},session,fixture().deps),'DESIGN_INVALID');const p=draft();p.baseline.outline='x'.repeat(4001);await rejects(()=>api.handleCustomerDesign(p,session,fixture().deps),'DESIGN_INVALID');});
 await run('parallel same-precondition saves surface one conflict',async()=>{const f=fixture();const results=await Promise.allSettled([api.handleCustomerDesign(draft(),session,f.deps),api.handleCustomerDesign({...draft(),request_id:C},session,f.deps)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'DESIGN_CONFLICT');assert.equal(f.versions.length,1);});
 await run('replaying a lost save response retains original request and version',async()=>{const f=fixture(),p=draft();const a=await api.handleCustomerDesign(p,session,f.deps),b=await api.handleCustomerDesign(p,session,f.deps);assert.equal(a.version.id,b.version.id);assert.equal(f.versions.length,1);});
 await run('database request reuse is structured conflict, SQL details stay private',async()=>{const f=fixture();f.rpcError={code:'22023',message:'CUSTOMER_DESIGN_REQUEST_REUSED secret internal SQL'};await rejects(()=>api.handleCustomerDesign(draft(),session,f.deps),'DESIGN_REQUEST_CONFLICT',409);});
 await run('original bytes are unchanged and metadata hash/size verified',async()=>{const f=fixture();const r=await api.handleCustomerDesign(upload(),session,f.deps);assert.equal(r.asset.sha256,digest(original));assert.equal(r.asset.byte_size,original.length);assert.deepEqual([...f.objects.values()][0],original);assert.equal(r.asset.bucket,'customer-design-photos');});
 await run('lost upload response replay creates no duplicate object or asset',async()=>{const f=fixture(),p=upload();const a=await api.handleCustomerDesign(p,session,f.deps),b=await api.handleCustomerDesign(p,session,f.deps);assert.equal(a.asset.id,b.asset.id);assert.equal(f.storagePosts,1);assert.equal(f.assets.length,1);});
 await run('storage success before database failure can safely resume exact bytes',async()=>{const f=fixture(),p=upload();f.rpcError={code:'XX000',message:'temporary'};await rejects(()=>api.handleCustomerDesign(p,session,f.deps),'DESIGN_DATABASE_ERROR');f.rpcError=null;const r=await api.handleCustomerDesign(p,session,f.deps);assert.equal(r.asset.sha256,digest(original));assert.equal(f.objects.size,1);});
 await run('reused upload request cannot change bytes or descriptive metadata',async()=>{const f=fixture(),p=upload();await api.handleCustomerDesign(p,session,f.deps);await rejects(()=>api.handleCustomerDesign({...p,caption:'changed'},session,f.deps),'DESIGN_REQUEST_CONFLICT',409);});
 await run('MIME spoof, wrong original hash and oversize are refused',async()=>{await rejects(()=>api.handleCustomerDesign({...upload(),mime_type:'image/jpeg'},session,fixture().deps),'DESIGN_INVALID');await rejects(()=>api.handleCustomerDesign({...upload(),sha256:'f'.repeat(64)},session,fixture().deps),'DESIGN_INVALID');await rejects(()=>api.handleCustomerDesign({...upload(),data_base64:'a'.repeat(Math.ceil(api.MAX_DESIGN_PHOTO_BYTES/3)*4+4)},session,fixture().deps),'DESIGN_INVALID');});
 await run('photo URL authorization checks all IDs before signing any',async()=>{const f=fixture();const p=await api.handleCustomerDesign(upload(),session,f.deps);f.assets.push({...p.asset,id:B,customer_profile_id:2});await rejects(()=>api.handleCustomerDesign({...common,operation:'customer_design_photo_urls',asset_ids:[A,B]},session,f.deps),'DESIGN_PHOTO_SCOPE_DENIED',403);assert.equal(f.calls.filter(c=>c[0]==='storage'&&c[1].startsWith('/object/sign/')).length,0);});
 await run('authorized original links are signed for five minutes only',async()=>{const f=fixture();await api.handleCustomerDesign(upload(),session,f.deps);const r=await api.handleCustomerDesign({...common,operation:'customer_design_photo_urls',asset_ids:[A]},session,f.deps);assert.equal(r.assets[0].expires_in,300);assert.ok(r.assets[0].url.startsWith('https://synthetic.supabase.co/storage/v1/object/sign/customer-design-photos/'));});
 await run('ingest cannot sign another visit even for same person',async()=>{const f=fixture();const r=await api.handleCustomerDesign(upload(),session,f.deps);f.assets[0]={...r.asset,booking_id:11,visit_key:'booking:11'};await rejects(()=>api.handleCustomerDesign({...common,operation:'customer_design_photo_urls',asset_ids:[A],ingest_token:'s'.repeat(64)},null,f.deps),'DESIGN_PHOTO_SCOPE_DENIED',403);});
 await run('current visit cannot reference a previous visit photo',async()=>{const f=fixture();const r=await api.handleCustomerDesign(upload(),session,f.deps);f.assets[0]={...r.asset,booking_id:11,visit_key:'booking:11'};await rejects(()=>api.handleCustomerDesign({...draft(),photo_ids:[A]},session,f.deps),'DESIGN_PHOTO_SCOPE_DENIED',403);});
 await run('six-zone execution, process and review survive save and history readback',async()=>{
  const f=fixture(),p={...draft(),execution:{top:{issue:' 顶区偏塌 ',target:'适度支撑',actions:'保留表层长度',check:'自然落发后核对'}},process:{proposal:' 八步后六区 ',styling:'手吹'},review:{achieved:'轮廓更清楚',pending:'洗后待核对',next:'复查支撑'}};
  const saved=await api.handleCustomerDesign(p,session,f.deps);
  assert.equal(saved.version.execution.top.issue,'顶区偏塌');assert.equal(saved.version.execution.top.actions,'保留表层长度');
  assert.deepEqual(Object.keys(saved.version.execution),['bangs','top','ear_front','ear_back','middle','bottom']);
  assert.deepEqual(saved.version.execution.bottom,{issue:'',target:'',actions:'',check:''});
  assert.equal(Object.keys(saved.version.process).length,10);assert.equal(saved.version.process.proposal,'八步后六区');assert.equal(saved.version.review.pending,'洗后待核对');
  const history=await api.handleCustomerDesign({...common,operation:'customer_design_history'},session,f.deps);
  assert.deepEqual(history.versions[0].execution,saved.version.execution);assert.deepEqual(history.versions[0].process,saved.version.process);assert.deepEqual(history.versions[0].review,saved.version.review);
  assert.ok(f.calls.some(c=>c[0]==='read'&&c[1].includes('reasons,execution,process,review,photo_ids')));
 });
 await run('legacy omission remains missing while explicit empty workflow is retained',async()=>{
  const a=fixture();await api.handleCustomerDesign(draft(),session,a.deps);
  const legacy=a.calls.find(c=>c[1]==='rpc/append_customer_design_version')[2].p_payload;
  for(const key of ['execution','process','review'])assert.equal(Object.hasOwn(legacy,key),false);
  const b=fixture();await api.handleCustomerDesign({...draft(),execution:{top:{target:' '}},process:{},review:{achieved:''}},session,b.deps);
  const explicit=b.calls.find(c=>c[1]==='rpc/append_customer_design_version')[2].p_payload;
  for(const key of ['execution','process','review'])assert.deepEqual(explicit[key],{});
 });
 await run('unknown workflow keys and non-text values are rejected before persistence',async()=>{
  for(const change of [
   {execution:null},{execution:[]},{execution:{unknown:{target:'x'}}},{execution:{top:null}},
   {execution:{top:[]}},{execution:{top:{unknown:'x'}}},{execution:{top:{target:null}}},{execution:{top:{check:7}}},
   {process:null},{process:[]},{process:{unknown:'x'}},{process:{styling:1}},
   {review:null},{review:[]},{review:{unknown:'x'}},{review:{achieved:{nested:'x'}}}
  ]){const f=fixture();await rejects(()=>api.handleCustomerDesign({...draft(),...change},session,f.deps),'DESIGN_INVALID');assert.equal(f.calls.filter(c=>c[1]==='rpc/append_customer_design_version').length,0);}
 });
 await run('all new workflow text fields enforce the same size boundary',async()=>{
  for(const change of [{execution:{bottom:{actions:'x'.repeat(4001)}}},{process:{application:'x'.repeat(4001)}},{review:{next:'x'.repeat(4001)}}])await rejects(()=>api.handleCustomerDesign({...draft(),...change},session,fixture().deps),'DESIGN_INVALID');
  const f=fixture();assert.equal((await api.handleCustomerDesign({...draft(),execution:{top:{target:'x'.repeat(4000)}}},session,f.deps)).saved,true);
 });
 await run('legacy-client workflow protection returns a private structured upgrade conflict',async()=>{
  const f=fixture();f.rpcError={code:'22023',message:'CUSTOMER_DESIGN_CLIENT_UPGRADE_REQUIRED private SQL'};
  await assert.rejects(()=>api.handleCustomerDesign(draft(),session,f.deps),e=>e.code==='DESIGN_CLIENT_UPGRADE_REQUIRED'&&e.status===409&&e.message.includes('草稿')&&!e.message.includes('private SQL'));
 });
 await run('API dispatch confines import tokens before legacy auth routes',async()=>{const source=fs.readFileSync(resolve(__dirname,'../supabase/functions/employee-bookings-api/index.ts'),'utf8');assert.ok(source.indexOf('payload.ingest_token !== undefined && !isCustomerDesignOperation')<source.indexOf('if (operation === "login")'));assert.ok(source.includes('payload.ingest_token !== undefined ? null : await requireEmployeeSession(payload)'));assert.ok(source.includes('error instanceof CustomerDesignError'));});
 console.log(`${tests} customer design API boundary tests passed (synthetic only)`);
})().catch(error=>{console.error(error);process.exitCode=1;});
