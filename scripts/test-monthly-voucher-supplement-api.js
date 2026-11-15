/* Real upload handler with synthetic storage/SQL boundaries; no network. */
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const {stripTypeScriptTypes}=require('node:module');
const source=fs.readFileSync('supabase/functions/operations-api/index.ts','utf8');
const start=source.indexOf('async function uploadVoucher('),end=source.indexOf('\nasync function pettyDetailDrafts(',start);
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
function harness(options={}){
 const calls=[],original={id:id(8),store_id:id(2),original_filename:'existing.jpeg',audit_status:'pending',amount:3800,old_links:[id(90)]};
 const c={cleanText:(v,n)=>String(v??'').trim().slice(0,n),uuidValue:(v,label,optional)=>{if(v==null&&optional)return null;if(!/^[a-f0-9-]{36}$/i.test(v))throw Error(label);return v;},
  selectedStoreInfo:async(s,p)=>{if(p.store!=='Synthetic')throw Error('scope');return {id:id(2),company_id:id(1)};},
  canUploadVouchers:s=>s.operations_role==='finance',decodeBase64:()=>new Uint8Array([1,2,3]),MAX_VOUCHER_BYTES:10*1024*1024,
  sha256Bytes:async()=> 'a'.repeat(64),crypto:{randomUUID:()=>id(10)},SUPABASE_URL:'https://synthetic.invalid',VOUCHER_BUCKET:'private',SERVICE_KEY:'synthetic',storagePath:v=>v,exactArrayBuffer:v=>v.buffer,
  fetch:async(url,o)=>{calls.push({storage:o.method});return {ok:true};},
  rest:async(path,o)=>{calls.push({path,body:JSON.parse(o.body)});return {ok:true,json:async()=>({id:id(10)})};},
  restRows:async query=>{calls.push({query});assert.match(query,new RegExp('company_id=eq.'+id(1)));
   if(query.startsWith('zysyr_voucher_attachments?'))return options.fresh?[]:[{...original,store_id:options.foreignStore?id(99):id(2)}];
   assert.match(query,new RegExp('store_id=eq.'+id(2)));
   if(query.startsWith('zysyr_report_uploads?'))return options.badReport?[]:[{id:id(4)}];
   if(query.startsWith('zysyr_report_cells?'))return options.badCell?[]:[{id:id(5)}];
   if(query.startsWith('zysyr_monthly_cell_revisions?'))return options.noRevision?[]:[{id:id(6)}];
   if(query.startsWith('zysyr_monthly_cell_revision_vouchers?'))return options.alreadyLinked?[{voucher_id:id(8)}]:[];
   throw Error('Unexpected read '+query);},
  financeRpcSaved:async(path,body)=>{calls.push({path,body});if(options.failLink)throw Error('synthetic link failure');return {revision_id:id(7),voucher_id:body.p_voucher_id};},
  wakeVoucherOcrInBackground:()=>{calls.push({wake:true});}
 };vm.createContext(c);vm.runInContext(stripTypeScriptTypes(source.slice(start,end)),c);
 const payload={store:'Synthetic',record_type:'report',record_id:id(4),monthly_cell_id:id(5),monthly_cell_reason:'只补充图片',filename:'chosen.jpeg',mime_type:'image/jpeg',base64:'AQID',skip_ocr:true};
 const session={operations_role:'finance',auth_account_id:id(3)};
 return {calls,original,run:(patch={},s={})=>c.uploadVoucher({...payload,...patch},{...session,...s})};
}
(async()=>{
 for(const opts of [{},{noRevision:true},{alreadyLinked:true}]){
  const h=harness(opts),before=JSON.stringify(h.original),r=await h.run();
  assert.equal(r.reused,true);assert.equal(r.cell_linked,true);assert.equal(r.formal_ledger_amount_changed,false);assert.equal(r.saved.id,id(8));
  assert.equal(r.already_linked,!!opts.alreadyLinked);
  assert.equal(h.calls.filter(c=>c.storage||c.wake||c.path==='rpc/zysyr_register_voucher').length,0,'reuse never uploads/registers/recognizes another original');
  const writes=h.calls.filter(c=>c.path);assert.equal(writes.length,opts.alreadyLinked?0:1);
  if(writes[0]){assert.equal(writes[0].path,'rpc/zysyr_attach_monthly_cell_voucher');assert.equal(writes[0].body.p_voucher_id,id(8));assert.equal(writes[0].body.p_source_cell_id,id(5));assert.equal(writes[0].body.p_actor_user_id,id(3));assert.equal(Object.keys(writes[0].body).some(k=>/amount|approve|status/.test(k)),false);}
  assert.equal(JSON.stringify(h.original),before,'existing metadata, pending review, amounts and old associations stay intact');
 }
 for(const [opts,patch,session,pattern] of [
  [{foreignStore:true},{},{},/该文件已上传/],[{badCell:true},{},{},/单元格不存在/],[{badReport:true},{},{},/报表不存在/],
  [{},{monthly_cell_id:null},{},/该文件已上传/],[{},{monthly_cell_reason:''},{},/填写关联报表/],
  [{},{},{operations_role:'shareholder'},/只有财务/],[{},{store:'Other'},{},/scope/],[{failLink:true},{},{},/synthetic link failure/]
 ]){const h=harness(opts);await assert.rejects(h.run(patch,session),pattern);assert.equal(h.calls.some(c=>c.storage||c.wake),false);}
 const fresh=harness({fresh:true}),r=await fresh.run();assert.equal(r.cell_linked,true);assert.equal(fresh.calls.filter(c=>c.storage==='POST').length,1);assert.equal(fresh.calls.filter(c=>c.path==='rpc/zysyr_register_voucher').length,1);
 console.log('Monthly voucher supplements: exact-original reuse, scoped explicit cell link, safe repeat, unchanged amounts/old links/review, error propagation and fresh upload passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
