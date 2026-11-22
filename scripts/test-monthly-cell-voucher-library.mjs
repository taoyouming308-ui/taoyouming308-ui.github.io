import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { monthlyCellVoucherLibrary } from '../supabase/functions/_shared/monthly-cell-voucher-library.mjs';
const source=fs.readFileSync('supabase/functions/operations-api/index.ts','utf8'),start=source.indexOf('function monthlyItemCategory('),end=source.indexOf('\n}',start)+2;
const context={cleanText:(v,n)=>String(v??'').trim().slice(0,n)};vm.createContext(context);vm.runInContext(stripTypeScriptTypes(source.slice(start,end)),context);
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const note=(month='2026-07')=>'petty_cash_batch|'+month+'|'+id(77)+'|synthetic.png';
function harness(options={}){
 const calls=[],payload={store:'Synthetic',month:'2026-07',report_id:id(3),cell_id:id(4),action:'list'},session={finance:true,read:true,auth_account_id:id(5)};
 const deps={canUpload:s=>s.finance,canRead:s=>s.read,store:async(s,p)=>{if(p.store!=='Synthetic')throw Error('scope');return {company_id:id(1),id:id(2)};},category:context.monthlyItemCategory,
  rows:async q=>{calls.push({q});assert.ok(q.includes('company_id=eq.'+id(1))&&q.includes('store_id=eq.'+id(2)));
   if(q.startsWith('zysyr_report_uploads?')){assert.ok(q.includes('report_type=eq.monthly_profit_loss')&&q.includes('report_date=eq.2026-07-01'));return options.badReport?[]:[{id:id(3)}];}
   if(q.startsWith('zysyr_report_cells?'))return options.badCell?[]:[{id:id(4),label:options.label||'产品进货 / 品牌甲 / 合计',cell_kind:'input'}];
   if(q.startsWith('zysyr_monthly_cell_revisions?'))return [{id:id(6)}];
   if(q.startsWith('zysyr_voucher_attachments?')){
    if(q.includes('&offset=')){
     assert(q.includes('note=like.petty_cash_batch%7C2026-07%7C*')&&!q.includes('uploaded_at=gte.'));
     return [{id:id(7),original_filename:'2026年6月.png',mime_type:'image/png',uploaded_at:'2026-11-17',note:note()},
       {id:id(8),original_filename:'unrecognized.png',note:note()},
       {id:id(9),original_filename:'2026年7月.png',note:note('2026-08')},
       {id:id(10),original_filename:'2026年7月.png',note:'报表证明'}];
    }
    return options.badVoucher?[]:[{id:id(7),note:note(options.archiveMonth)}];
   }
   throw Error(q);},
  all:async q=>{calls.push({q});assert.ok(q.includes('store_id=eq.'+id(2)));
   if(q.startsWith('zysyr_monthly_cell_revision_vouchers?'))return options.linked?[{voucher_id:id(7)}]:[];
   if(q.startsWith('zysyr_voucher_ocr_tasks?')){assert(!q.includes(id(9))&&!q.includes(id(10)));return [{voucher_id:id(7),candidate_fields:{amount:100,document_date:'2026-06-15',transactions:[{amount:100},{amount:200}]}}, {voucher_id:id(7),candidate_fields:{amount:999}}];}
   if(q.startsWith('zysyr_voucher_reviews?'))return [{voucher_id:id(7),corrected_fields:{amount:1474}}];
   throw Error(q);},save:async(path,body)=>{calls.push({path,body});if(options.fail)throw Error('link failure');return {};}};
 return {calls,run:(p={},s={})=>monthlyCellVoucherLibrary({...payload,...p},{...session,...s},deps)};
}
for(const label of ['产品进货 / 品牌甲 / 合计','零售产品成本 / 品牌乙 / 合计','备用金 / 食品 / 合计','杂项 / 拍摄 / 合计']){
 const h=harness({label}),list=await h.run();assert.equal(list.archive_month,'2026-07');assert.deepEqual(list.items.map(v=>v.id),[id(7),id(8)]);assert(list.items.every(v=>v.archive_month==='2026-07'&&!Object.hasOwn(v,'note')));assert.equal(list.items[0].candidate_fields.document_date,'2026-06-15');assert.equal(list.items[0].candidate_fields.amount,1474);assert.deepEqual(list.items[0].recognized_amounts,[1474],'reviewed amount overrides machine components');assert.deepEqual(list.items[1].candidate_fields,{});assert.equal(h.calls.some(c=>c.path),false);
 const result=await h.run({action:'attach',voucher_id:id(7),confirmed:true,reason:'核对原图后补充凭证',amount:999999});assert.equal(result.cell_linked,true);assert.equal(result.amount_changed,false);
 const writes=h.calls.filter(c=>c.path);assert.equal(writes.length,1);assert.equal(writes[0].path,'rpc/zysyr_attach_monthly_cell_voucher');assert.deepEqual(Object.keys(writes[0].body).sort(),['p_actor_user_id','p_company_id','p_reason','p_source_cell_id','p_store_id','p_voucher_id']);assert.equal(writes[0].body.p_source_cell_id,id(4));
}
for(const label of ['其它 / 备用金','产品成本 / 产品进货','小计 / 合计','主营 / 美发收入','技术人员 / 工资'])await assert.rejects(harness({label}).run(),/需要凭证/);
for(const [options,p,s,pattern] of [[{badReport:true},{},{},/月报不存在/],[{badCell:true},{},{},/明细金额/],[{badVoucher:true},{action:'attach',voucher_id:id(7),confirmed:true,reason:'checked'},{},/凭证不存在/],[{},{},{finance:false},/只有财务/],[{},{store:'Other'},{},/scope/],[{},{month:'2026-13'},{},/信息无效/],[{},{action:'attach',voucher_id:id(7),confirmed:false,reason:'checked'},{},/先核对/],[{fail:true},{action:'attach',voucher_id:id(7),confirmed:true,reason:'checked'},{},/link failure/]])await assert.rejects(harness(options).run(p,s),pattern);
const mismatched=harness({archiveMonth:'2026-08'});await assert.rejects(mismatched.run({action:'attach',voucher_id:id(7),confirmed:true,reason:'checked'}),/未归档到当前报表月份/);assert.equal(mismatched.calls.some(c=>c.path),false);
const repeated=harness({linked:true,archiveMonth:'2026-08'});assert.equal((await repeated.run({action:'attach',voucher_id:id(7),confirmed:true,reason:'checked'})).already_linked,true);assert.equal(repeated.calls.some(c=>c.path),false);
const noRead=harness();await assert.rejects(noRead.run({},{read:false}),/凭证查看权限/);assert.equal(noRead.calls.length,0);
assert.match(source,/operation === "monthly_voucher_library"/);
console.log('Monthly detail library: four real cell classifications, all-upload dates, corrected amounts, unrecognized originals, scoped explicit evidence-only attach, repeat and rejection guards passed.');

function workspaceHarness(options={}){
 const calls=[],store={company_id:id(1),id:id(2)},values=[['支出','支出类别','Nov.'],['','房租','5000'],['','技术人员','8000'],['','备用金','100'],['','空白费用',''],['','合计','13100']];
 const report={id:id(3),company_id:id(1),store_id:id(2),report_type:'monthly_profit_loss',report_date:'2026-07-01',status:options.inactive?'superseded':'active',sha256:'a'.repeat(64),version:2,display_data:{values,merges:[{start_row:1,end_row:3,start_col:0,end_col:0}]}};
 const cell=(n,row,label,value,display=String(value))=>({id:id(n),company_id:id(1),store_id:id(2),report_id:id(3),cell_address:'C'+row,row_number:row,column_number:3,label,numeric_value:value,display_value:display,cell_kind:'input'});
 const cells=[cell(4,2,'房租 / 房租',5000),cell(13,3,'技术人员 / 工资',8000),cell(14,4,'其它 / 备用金',100),cell(15,5,'杂项 / 空白费用',0,'')];
 const revisions=[{id:id(6),source_cell_id:id(4),revision:1,revision_type:'evidence_update',after_amount:5000}];
 let linked=Boolean(options.linked),reads=0;
 const deps={canUpload:s=>s.finance,canRead:s=>s.read,store:async(s,p)=>{if(p.store!=='Synthetic')throw Error('scope');return store;},category:context.monthlyItemCategory,
 rows:async query=>{calls.push({q:query});assert(query.includes('company_id=eq.'+id(1))&&query.includes('store_id=eq.'+id(2)));
  if(query.startsWith('zysyr_report_uploads?')){if(query.includes('order=version.desc&limit=1')){reads++;return [options.changed&&reads>1?{...report,id:id(99)}:report];}return [{id:id(3)}];}
  if(query.startsWith('zysyr_report_cells?'))return cells.filter(c=>query.includes('&id=eq.'+c.id));
  if(query.startsWith('zysyr_voucher_attachments?'))return options.badVoucher?[]:[{id:id(7),note:note(options.archiveMonth)}];
  throw Error('Unexpected direct read '+query);},
 all:async query=>{calls.push({q:query});assert(query.includes('company_id=eq.'+id(1))&&query.includes('store_id=eq.'+id(2)));
  if(query.startsWith('zysyr_report_cells?'))return cells;
  if(query.startsWith('zysyr_monthly_cell_revisions?'))return revisions;
  if(query.startsWith('zysyr_monthly_cell_revision_vouchers?'))return linked?[{revision_id:id(6),voucher_id:id(7)}]:[];
  throw Error('Workspace must not scan all vouchers or OCR '+query);},
 save:async(route,body)=>{calls.push({path:route,body});if(options.fail)throw Error('synthetic link failure');linked=true;return {};}};
 const payload={store:'Synthetic',month:'2026-07',report_id:id(3),cell_id:id(4),context:'expense_workspace',action:'list',voucher_id:id(7)};
 return {calls,run:(p={},s={})=>monthlyCellVoucherLibrary({...payload,...p},{finance:true,read:true,auth_account_id:id(5),...s},deps)};
}
for(const cellId of [id(4),id(13),id(14)]){
 const h=workspaceHarness();const list=await h.run({cell_id:cellId});assert.equal(list.items.length,1);assert.equal(list.items[0].id,id(7));assert.equal(list.items[0].already_linked,false);assert.equal(list.target.manual_only,true);
 const saved=await h.run({action:'attach',cell_id:cellId,confirmed:true,reason:'已核对整张原图，仅作月报栏目佐证',amount:999999});
 assert.equal(saved.evidence_only,true);assert.equal(saved.whole_original,true);assert.equal(saved.amount_changed,false);assert.equal(saved.posted,false);
 const write=h.calls.find(c=>c.path);assert.equal(write.path,'rpc/zysyr_attach_monthly_cell_voucher');assert.equal(write.body.p_source_cell_id,cellId);assert.equal(write.body.p_voucher_id,id(7));assert(!Object.keys(write.body).some(k=>/amount|review|post/.test(k)));
 if(cellId===id(4)){const reread=await h.run();assert.equal(reread.items[0].already_linked,true);const again=await h.run({action:'attach',confirmed:true,reason:'checked again'});assert.equal(again.already_linked,true);assert.equal(h.calls.filter(c=>c.path).length,1);}
 assert(!h.calls.some(c=>c.q&&/ocr_tasks|voucher_reviews/.test(c.q)),'workspace single-image readback cannot miss a historical original due to the 2000-item store cap');
}
for(const [options,patch,pattern] of [[{}, {cell_id:id(15)}, /金额为空/], [{inactive:true},{},/版本已变化/], [{changed:true},{},/版本已变化/],
 [{badVoucher:true},{},/凭证不存在/], [{},{voucher_id:id(99),action:'attach',confirmed:false,reason:'checked'},/先核对/],
 [{},{action:'attach_combination',items:[],confirmed:true},/不支持图内分项或组合/], [{},{component_index:0},/不支持图内分项或组合/],
 [{},{voucher_id:null},/需要回读的原图/], [{},{context:'unexpected'},/入口无效/], [{fail:true},{action:'attach',confirmed:true,reason:'checked'},/synthetic link failure/],
 [{},{report_id:id(99)},/版本已变化/], [{},{cell_id:id(99)},/可关联的栏目/]])await assert.rejects(workspaceHarness(options).run(patch),pattern);
console.log('Electronic expense-workspace library: current report/cell revalidation, left salary/summary manual whole-original support, unknown blocking, one-image bounded readback, legacy behavior, repeated attachment and no amount/approval/posting writes passed.');
const historical=workspaceHarness({linked:true,archiveMonth:'2026-08'});
assert.equal((await historical.run()).items[0].already_linked,true);
const outside=workspaceHarness({archiveMonth:'2026-08'});
await assert.rejects(outside.run({action:'attach',confirmed:true,reason:'checked'}),/未归档到当前报表月份/);
assert.equal(outside.calls.some(c=>c.path),false);
