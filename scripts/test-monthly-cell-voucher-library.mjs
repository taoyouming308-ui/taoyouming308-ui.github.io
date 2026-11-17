import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { monthlyCellVoucherLibrary } from '../supabase/functions/_shared/monthly-cell-voucher-library.mjs';
const source=fs.readFileSync('supabase/functions/operations-api/index.ts','utf8'),start=source.indexOf('function monthlyItemCategory('),end=source.indexOf('\n}',start)+2;
const context={cleanText:(v,n)=>String(v??'').trim().slice(0,n)};vm.createContext(context);vm.runInContext(stripTypeScriptTypes(source.slice(start,end)),context);
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
function harness(options={}){
 const calls=[],payload={store:'Synthetic',month:'2026-07',report_id:id(3),cell_id:id(4),action:'list'},session={finance:true,read:true,auth_account_id:id(5)};
 const deps={canUpload:s=>s.finance,canRead:s=>s.read,store:async(s,p)=>{if(p.store!=='Synthetic')throw Error('scope');return {company_id:id(1),id:id(2)};},category:context.monthlyItemCategory,
  rows:async q=>{calls.push({q});assert.ok(q.includes('company_id=eq.'+id(1))&&q.includes('store_id=eq.'+id(2)));
   if(q.startsWith('zysyr_report_uploads?')){assert.ok(q.includes('report_type=eq.monthly_profit_loss')&&q.includes('report_date=eq.2026-07-01'));return options.badReport?[]:[{id:id(3)}];}
   if(q.startsWith('zysyr_report_cells?'))return options.badCell?[]:[{id:id(4),label:options.label||'产品进货 / 品牌甲 / 合计',cell_kind:'input'}];
   if(q.startsWith('zysyr_monthly_cell_revisions?'))return [{id:id(6)}];
   if(q.startsWith('zysyr_voucher_attachments?'))return options.badVoucher?[]:[{id:id(7)}];
   throw Error(q);},
  all:async q=>{calls.push({q});assert.ok(q.includes('store_id=eq.'+id(2)));
   if(q.startsWith('zysyr_monthly_cell_revision_vouchers?'))return options.linked?[{voucher_id:id(7)}]:[];
   if(q.startsWith('zysyr_voucher_attachments?')){assert.ok(!q.includes('uploaded_at=gte.')&&!q.includes('note=')&&!q.includes('audit_status=')&&!q.includes('record_type='));return [{id:id(7),original_filename:'November upload.png',mime_type:'image/png',uploaded_at:'2026-11-17'}, {id:id(8),original_filename:'unrecognized.png'}];}
   if(q.startsWith('zysyr_voucher_ocr_tasks?'))return [{voucher_id:id(7),candidate_fields:{amount:100,transactions:[{amount:100},{amount:200}]}}, {voucher_id:id(7),candidate_fields:{amount:999}}];
   if(q.startsWith('zysyr_voucher_reviews?'))return [{voucher_id:id(7),corrected_fields:{amount:1474}}];
   throw Error(q);},save:async(path,body)=>{calls.push({path,body});if(options.fail)throw Error('link failure');return {};}};
 return {calls,run:(p={},s={})=>monthlyCellVoucherLibrary({...payload,...p},{...session,...s},deps)};
}
for(const label of ['产品进货 / 品牌甲 / 合计','零售产品成本 / 品牌乙 / 合计','备用金 / 食品 / 合计','杂项 / 拍摄 / 合计']){
 const h=harness({label}),list=await h.run();assert.equal(list.items.length,2);assert.equal(list.items[0].candidate_fields.amount,1474);assert.deepEqual(list.items[0].recognized_amounts,[1474],'reviewed amount overrides machine components');assert.deepEqual(list.items[1].candidate_fields,{});assert.equal(h.calls.some(c=>c.path),false);
 const result=await h.run({action:'attach',voucher_id:id(7),confirmed:true,reason:'核对原图后补充凭证',amount:999999});assert.equal(result.cell_linked,true);assert.equal(result.amount_changed,false);
 const writes=h.calls.filter(c=>c.path);assert.equal(writes.length,1);assert.equal(writes[0].path,'rpc/zysyr_attach_monthly_cell_voucher');assert.deepEqual(Object.keys(writes[0].body).sort(),['p_actor_user_id','p_company_id','p_reason','p_source_cell_id','p_store_id','p_voucher_id']);assert.equal(writes[0].body.p_source_cell_id,id(4));
}
for(const label of ['其它 / 备用金','产品成本 / 产品进货','小计 / 合计','主营 / 美发收入','技术人员 / 工资'])await assert.rejects(harness({label}).run(),/需要凭证/);
for(const [options,p,s,pattern] of [[{badReport:true},{},{},/月报不存在/],[{badCell:true},{},{},/明细金额/],[{badVoucher:true},{action:'attach',voucher_id:id(7),confirmed:true,reason:'checked'},{},/凭证不存在/],[{},{},{finance:false},/只有财务/],[{},{store:'Other'},{},/scope/],[{},{month:'2026-13'},{},/信息无效/],[{},{action:'attach',voucher_id:id(7),confirmed:false,reason:'checked'},{},/先核对/],[{fail:true},{action:'attach',voucher_id:id(7),confirmed:true,reason:'checked'},{},/link failure/]])await assert.rejects(harness(options).run(p,s),pattern);
const repeated=harness({linked:true});assert.equal((await repeated.run({action:'attach',voucher_id:id(7),confirmed:true,reason:'checked'})).already_linked,true);assert.equal(repeated.calls.some(c=>c.path),false);
const noRead=harness();await assert.rejects(noRead.run({},{read:false}),/凭证查看权限/);assert.equal(noRead.calls.length,0);
assert.match(source,/operation === "monthly_voucher_library"/);
console.log('Monthly detail library: four real cell classifications, all-upload dates, corrected amounts, unrecognized originals, scoped explicit evidence-only attach, repeat and rejection guards passed.');
