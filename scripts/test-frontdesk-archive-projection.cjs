// Exercise the actual TypeScript Edge projection and the shared identity/store predicates.
// PostgREST wire replies are generated exclusively from synthetic rows, no database credentials.
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{stripTypeScriptTypes}=require('node:module');
async function realPostgrest(outlinePath,validateRow){
 const docker=(args,options={})=>require('node:child_process').execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],...options}).trim();
 const prefix='desk-archive-'+process.pid+'-'+Date.now(),db=prefix+'-db',api=prefix+'-api',net=prefix+'-net',cleanup=[];
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),sql=input=>docker(['exec','-i',db,'psql','-X','-h','127.0.0.1','-U','postgres','-v','ON_ERROR_STOP=1','-At'],{input});
 try{
   docker(['network','create',net]);cleanup.unshift(['network','rm',net]);
   docker(['run','--pull=never','--rm','-d','--network',net,'--tmpfs','/var/lib/postgresql/data:rw','--name',db,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);cleanup.unshift(['stop',db]);
   for(let i=0;;i++){try{sql('select 1');break;}catch(e){if(i>59)throw e;await wait(200);}}
   sql(`create role synthetic nologin; create role reader login; grant synthetic to reader;
   create table hair_records(id text,customer_name text,customer_phone text,technician text,barber text,status text,created_at timestamptz,record_data jsonb);
   insert into hair_records values('x',null,null,null,null,'ok',now(),'{"seq":17,"shopName":"自由手艺人","formFields":{"hair-form-name":"甲","hair-form-phone":"13800000001"},"serviceBeforePhoto":"TEST-IMAGE"}');
   grant select on hair_records to synthetic;`);
   docker(['run','--pull=never','--rm','-d','--network',net,'--name',api,'-p','127.0.0.1::3000','-e','PGRST_DB_URI=postgres://reader@'+db+':5432/postgres','-e','PGRST_DB_ANON_ROLE=synthetic','postgrest/postgrest:v14.14@sha256:d2009b5c9deffc210c8a5592698472fede14fd9f6ca89823c8474ca54d58c012']);cleanup.unshift(['stop',api]);
   const base='http://127.0.0.1:'+docker(['port',api,'3000/tcp']).split(':').pop();
   for(let i=0;;i++){try{if((await fetch(base+'/')).ok)break;}catch{}if(i>59)throw Error('disposable REST did not start');await wait(200);}
   const res=await fetch(base+'/'+outlinePath),data=await res.json();assert.equal(res.status,200,JSON.stringify(data));assert.equal(data.length,1);assert(!JSON.stringify(data).includes('TEST-IMAGE'));
   if(validateRow)await validateRow(data[0],{sql,base});else{assert.equal(data[0].hdr_form_name,'甲');assert.equal(data[0].hdr_form_phone,'13800000001');assert.equal(data[0].hdr_shopName,'自由手艺人');}
   console.log('Disposable PG17/PostgREST14: JSON projection/legacy identity and store aliases verified.');
 }finally{for(const args of cleanup)docker(args);}
}
module.exports={realPostgrest};
if(require.main===module)(async()=>{
 const shared=await import('../supabase/functions/_shared/customer-profile-scope.mjs');
 const src=fs.readFileSync('supabase/functions/frontdesk-api/index.ts','utf8'),cut=(a,b)=>src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)));
 const shop='自由手艺人',other='向里造型',staff={role:'staff',store:shop},phone='13800000001';
 const image='data:image/jpeg;base64,'+'X'.repeat(8192),record=(id,name,origin,status='ok')=>({id,customer_name:null,customer_phone:null,technician:'甲',barber:'乙',status,created_at:'2026-01-04',record_data:{shopName:origin,formFields:{'hair-form-phone':phone,'hair-form-name':name},visitDate:'2026-01-02',serviceBeforePhoto:image,serviceAfterPhoto:image}});
 let rows=[record('1','甲',shop),record('2','乙',shop),record('3','甲',other),record('4','甲',''),record('5','甲',shop,'deleted')],reads=[],change;
 async function read(path){
   reads.push(path);if(!path.startsWith('hair_records?'))return [];
   const p=new URL('https://mock.invalid/'+path).searchParams;assert.equal(p.get('status'),'neq.deleted');assert(p.get('or').includes(phone));
   const id=p.get('id');if(id&&change)change();
   const visible=rows.filter(r=>r.status!=='deleted'&&(!id||'eq.'+r.id===id));
   const columns=p.get('select').split(',');
   return visible.map(r=>Object.fromEntries(columns.map(k=>{const [alias,expression]=k.split(':');if(!expression)return [alias,r[alias]];
     assert(expression.startsWith('record_data->'));return [alias,expression.split(/->>?/).slice(1).reduce((a,key)=>a?.[key],r.record_data)??null];})));
 }
 const ctx={...shared,restRows:read,readCustomerPages:read,historyFromProfiles:()=>[],collectPackages:()=>[],encodeURIComponent,console};
 vm.createContext(ctx);vm.runInContext(stripTypeScriptTypes(cut('function cleanText(','function customerPhonesMatch(')+cut('function selectedStore(','function withStore(')+cut('const hairBaseColumns','async function readCustomerPages(')),ctx);
 assert(src.indexOf('const session = await requireSession(payload)')<src.indexOf('if (operation === "customer_detail") return'));
 const payload={phone,name:'甲',store:shop,customer_scope:'store'},run=(extra={})=>ctx.customerDetail({...payload,...extra},staff),body=(id,extra={})=>run({archive_projection:'body-v1',archive_id:id,...extra});
 const full=await run(),summary=await run({archive_projection:'outline-v1'});
 assert.deepEqual(Array.from(summary.hair_records,r=>r.id),['1']);assert.equal(full.hair_records[0].record_data.serviceBeforePhoto,image);
 assert(!JSON.stringify(summary).includes(image));assert(summary.hair_records[0].archive_deferred);
 assert(!reads.at(-1).split('select=')[1].split('&')[0].split(',').includes('record_data'));
 if(process.argv.includes('--postgrest'))await realPostgrest(reads.at(-1));
 reads=[];assert.equal((await body('1')).record_data.serviceAfterPhoto,image);assert.equal(reads.length,2,'outline family check, then exactly one full row');
 for(const [id,extra] of [['2',{}],['3',{}],['4',{}],['5',{}],['1',{name:''}],['1',{phone:phone.slice(-4)}],['3',{store:other}],['1',{customer_scope:'invalid'}]]){
   reads=[];await assert.rejects(body(id,extra));assert(!reads.some(p=>p.includes('&id=eq.')),'denied references never fetch original row');
 }
 assert.equal((await body('4',{customer_scope:'all'})).archive_id,'4','unassigned legacy store is shared only in original all scope');
 change=()=>{rows[0].record_data.shopName=other;};await assert.rejects(body('1'));change=null;rows[0].record_data.shopName=shop;
 change=()=>{rows[0].record_data.formFields['hair-form-name']='乙';};await assert.rejects(body('1'));
 const bytes=x=>Buffer.byteLength(JSON.stringify(x));console.log(JSON.stringify({fixture:'one visible archive, two synthetic 8 KiB images',fullWireBytes:bytes(full),outlineWireBytes:bytes(summary),legacyAndLazyRead:'ok',familyIdentityStoreAndRevocation:'ok'}));
})().catch(error=>{console.error(error);process.exitCode=1;});
