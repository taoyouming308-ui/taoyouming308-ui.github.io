import assert from 'node:assert/strict';
import fs from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {expenseSourceTargets,matchExpenseComponent} from '../supabase/functions/_shared/expense-voucher-matching.mjs';
import {buildExpenseVoucherWorkspace,expenseMatchPlan} from '../supabase/functions/_shared/expense-voucher-workspace.mjs';
import {voucherCodexCandidates,normalizedVoucherDate,recoverVoucherDateCandidate} from '../supabase/functions/_shared/zysyr-voucher-codex.mjs';
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const source={month:'2026-07',status:'ready',monthly_status:'ready',source:{selection_id:id(1),source_request_id:id(2),sha256:'a'.repeat(64),worksheet_name:'7月'},
  monthly:{expense_rows:[['房租',null,11],['物业费',1648.27,12],['小计',1648.27,16],['技术人员',28654.19,22],['备用金',93.80,46]].map(([label,amount,row])=>({row,cells:[{column:2,value:label},{column:3,address:'C'+row,value:amount}]}))},
  expenses:[{id:id(3),date:'2026-07-01',direction:'outflow',outflow:12.34,summary:'咖啡豆',category:'食品',voucher_number:'1',source_locator:'07!A8:H8',import_batch_id:id(4)}]};
const legacy=[{id:id(5),target_kind:'draft',transaction_date:'2026-07-01',amount:12.34,summary:'咖啡豆',category:'食品',voucher_number:'1'}];
const proof={document_date:'2026-07-05',amount:'实付1648.27',expense_category:'物业费',summary:'七月物业',counterparty:'物业',document_number:'001'};
const confidence={document_date:.99,amount:.99,expense_category:.99,summary:.99,counterparty:.99,document_number:.99};
const candidate={document_date:'2026-07-05',amount:1648.27,expense_category:'物业费',summary:'七月物业',evidence:proof,confidence,document_kind:'receipt',document_type:'invoice',recognition_schema_version:'expense-voucher-v2'};
const parent={id:id(6),original_filename:'不可靠文件名.png',batch_id:id(7),task_status:'succeeded',audit_status:'pending',latest_ocr_task:{id:id(8)},candidate_fields:candidate,field_confidences:confidence};
const base={month:'2026-07',items:[parent],targets:legacy,summary:{total:1}};
for(const stamp of ['2026-07-05','2026-07-05 12:34:56','2026-07-05T23:58:00+08:00','2026-07-05T00:01Z'])assert.equal(normalizedVoucherDate(stamp),'2026-07-05');
for(const stamp of ['07-05','7月5日','2026-02-30 12:00:00','2026-07-05 29:00:00','2026-07-05 12:00:00 extra'])assert.equal(normalizedVoucherDate(stamp),null);
const rawReceipt={provider:'openai-api',schema_version:'expense-voucher-v2',candidate_only:true,human_review_required:true,document_kind:'receipt',document_type:'payment',fields:{...candidate,document_date:'2026-07-05 12:34:56'},evidence:proof,confidences:confidence,warnings:[]};
const lostDate={...candidate,document_date:null,recognition_provider:'openai-api'},beforeLost=JSON.stringify(lostDate);
const restored=recoverVoucherDateCandidate(lostDate,{...confidence,document_date:0},rawReceipt,'2026-07');
assert.equal(restored.fields.document_date,'2026-07-05');assert.equal(restored.confidences.document_date,.99);assert.equal(JSON.stringify(lostDate),beforeLost,'stored fields are never rewritten');
assert.equal(recoverVoucherDateCandidate(candidate,confidence,rawReceipt,'2026-07'),null,'preserve an existing date');
assert.equal(recoverVoucherDateCandidate(lostDate,confidence,{...rawReceipt,fields:{...rawReceipt.fields,document_date:'7月5日'}},'2026-07'),null,'never supply a missing year');
let targets=expenseSourceTargets(source,legacy);
assert.equal(targets.length,5);assert.equal(targets.find(t=>t.id===id(5)).source_row_id,id(3));
assert.equal(expenseSourceTargets({...source,expenses:[...source.expenses,{...source.expenses[0],id:id(30),voucher_number:'2'}]},legacy).filter(t=>t.target_kind!=='monthly_source').length,2,'same amounts with different source sequence numbers remain distinct');
assert.equal(targets.find(t=>t.summary==='房租').amount,null);assert(!targets.some(t=>t.summary==='小计'));
assert(targets.some(t=>t.summary==='技术人员'));
const projected=expenseSourceTargets({...source,electronic_report:{id:id(25),cells:[{id:id(26),cell_address:'C12',label:'房租 / 物业费 / Nov.',amount:'1648.2700',revision:0}]}},legacy);
assert.equal(projected.find(t=>t.source_locator==='C12').electronic_cell.report_id,id(25));
assert.equal(expenseSourceTargets({...source,electronic_report:{id:id(25),cells:[{id:id(26),cell_address:'C12',label:'房租 / 物业费',amount:1}]}},legacy).find(t=>t.source_locator==='C12').electronic_cell,null);

let workspace=buildExpenseVoucherWorkspace(base,source);
assert.equal(workspace.items[0].match.auto_eligible,true);assert.equal(workspace.items[0].match.target_kind,'monthly_source');
assert.equal(workspace.items[0].automate_on_read,true);assert.equal(workspace.summary.ready,1);
const request={voucher_id:id(6),component_index:0,task_id:id(8),target_kind:'monthly_source',target_id:id(1)+'~C12'};
let plan=expenseMatchPlan(workspace,[request],'auto');assert.equal(plan.length,1);assert.equal(plan[0].corrected_fields.amount,1648.27);
assert.equal(plan[0].target_snapshot.source_selection_id,id(1));
assert.equal(expenseMatchPlan(workspace,[{...request,task_id:id(99)}],'auto').length,0);
assert.throws(()=>expenseMatchPlan(workspace,[{...request,target_id:id(99)+'~C12'}],'manual'),/变化/);
assert.equal(matchExpenseComponent({...candidate,document_date:'2026-08-05'},targets,'2026-07').state,'cross_month');
assert.equal(matchExpenseComponent({...candidate,document_date:'2026-07-32'},targets,'2026-07').auto_eligible,false);
assert.equal(matchExpenseComponent({...candidate,amount:1648.271},targets,'2026-07').auto_eligible,false);
assert.equal(matchExpenseComponent({...candidate,confidence:{...confidence,expense_category:.8}},targets,'2026-07').auto_eligible,false);
assert.equal(matchExpenseComponent({...candidate,evidence:{...proof,amount:''}},targets,'2026-07').auto_eligible,false);
for(const label of ['服务器','鲜花费','空调费','保洁服务费']){
  const ownTarget={...targets.find(t=>t.target_kind==='monthly_source'),id:'custom-'+label,summary:label,category:label,amount:245};
  const rawCategory=label.replace(/费$/,'')+'费用';
  assert.equal(matchExpenseComponent({...candidate,amount:245,expense_category:rawCategory,evidence:{...proof,amount:'245.00',expense_category:rawCategory}},[ownTarget],'2026-07').auto_eligible,true,'explicit source category is supported: '+label);
}
assert.equal(matchExpenseComponent({...candidate,amount:245,expense_category:'待分类'},[{...targets[1],summary:'待分类',category:'待分类',amount:245}],'2026-07').auto_eligible,false,'an unknown category is not a matching category');
assert.equal(matchExpenseComponent({...candidate,document_date:'2026-07-01',amount:12.34},[...targets,{...legacy[0],id:id(10),period_month:'2026-07'}],'2026-07').state,'ambiguous');
const link={id:id(11),voucher_id:id(6),component_index:0,status:'active',mode:'auto',target_kind:request.target_kind,target_id:request.target_id,corrected_fields:plan[0].corrected_fields};
workspace=buildExpenseVoucherWorkspace(base,source,[link]);assert.equal(workspace.summary.auto_matched,1);assert.equal(workspace.items[0].match.auto_eligible,false);
assert.equal(expenseMatchPlan(workspace,[request],'auto').length,0);
workspace=buildExpenseVoucherWorkspace(base,{...source,source:{...source.source,selection_id:id(12)}},[link]);
assert(workspace.items[0].association_stale);assert.equal(workspace.items[0].confirmed_target_id,null);assert.equal(workspace.items[0].match.auto_eligible,false);
workspace=buildExpenseVoucherWorkspace(base,source,[{...link,status:'void'}]);assert.equal(workspace.items[0].match.auto_eligible,false);
workspace=buildExpenseVoucherWorkspace({...base,items:[{...parent,confirmed_target_id:id(5),confirmed_target_kind:'draft'}]},source);
assert.equal(workspace.items[0].confirmed_target_id,id(5));assert.equal(workspace.items[0].candidate_fields,candidate,'preserve existing human-confirmed item');
workspace=buildExpenseVoucherWorkspace(base,{status:'unavailable'});assert.equal(workspace.items[0].match.auto_eligible,false);
const part={document_date:'2026-07-01',amount:12.34,summary:'咖啡豆',expense_category:'食品',evidence:{...proof,document_date:'2026-07-01',amount:'12.34'},confidence};
const repeatedTargets=[{...legacy[0],period_month:'2026-07'},{...legacy[0],id:id(31),period_month:'2026-07',transaction_date:'2026-07-03',voucher_number:'2'}];
assert.equal(matchExpenseComponent(part,repeatedTargets,'2026-07').auto_eligible,true,'an explicit unique day disambiguates recurring equal amounts');
assert.equal(matchExpenseComponent({...part,document_number:'2'},repeatedTargets.map(t=>({...t,transaction_date:part.document_date})),'2026-07').target_id,id(31),'a printed voucher number can disambiguate same-day equal amounts');
const multi= voucherCodexCandidates({provider:'openai-api',schema_version:'expense-voucher-v2',candidate_only:true,human_review_required:true,document_kind:'multiple_transactions',document_type:'chat_transfers',fields:{},evidence:{},confidences:{},transactions:[part,{...part,document_date:null,evidence:{...part.evidence,document_date:''}}]},'2026-07');
assert.equal(multi.fields.amount,null);assert.equal(multi.fields.transactions.length,2);assert.equal(multi.fields.transactions[1].document_date,null);
workspace=buildExpenseVoucherWorkspace({...base,items:[{...parent,candidate_fields:multi.fields}]},source);
assert.equal(workspace.items.length,2);assert.equal(workspace.items[0].match.auto_eligible,true);assert.equal(workspace.items[1].match.auto_eligible,false);
assert.equal(workspace.items[0].source_voucher_id,id(6));assert.equal(workspace.items[1].candidate_fields.document_kind,'receipt');
const collisionBase={...base,items:[{...parent,candidate_fields:{...multi.fields,transactions:[multi.fields.transactions[0],multi.fields.transactions[0]]}}]};
const collision=buildExpenseVoucherWorkspace(collisionBase,source);
assert(collision.items.every(i=>!i.match.auto_eligible));assert.equal(collision.summary.needs_review,1,'same-image payments cannot automatically share one transaction');
const priorPart={...link,voucher_id:id(6),component_index:0,target_kind:'draft',target_id:id(5)};
const partialCollision=buildExpenseVoucherWorkspace(collisionBase,source,[priorPart]);assert.equal(partialCollision.items[0].confirmed_target_id,id(5));assert.equal(partialCollision.items[1].match.auto_eligible,false);
const summary=buildExpenseVoucherWorkspace({...base,items:[{...parent,candidate_fields:{document_kind:'bank_summary',amount:null}}]},source);
assert.throws(()=>expenseMatchPlan(summary,[{...request,corrected_fields:candidate}],'manual'),/整张汇总/);
const manualMonthSummary=expenseMatchPlan(summary,[{...request,corrected_fields:{...candidate,evidence_kind:'monthly_summary',document_date:null,period_month:'2026-07'}}],'manual');
assert.equal(manualMonthSummary[0].corrected_fields.document_date,null,'manual summary evidence needs a confirmed month, never an invented day');
workspace=buildExpenseVoucherWorkspace({...base,items:[{...parent,task_status:'dead_letter'}]},source);assert.equal(workspace.summary.failed,1);assert(!workspace.items[0].match.auto_eligible);

const monthlyInput={provider:'openai-api',schema_version:'expense-voucher-v2',candidate_only:true,human_review_required:true,document_kind:'bank_summary',document_type:'payroll',fields:{},evidence:{},confidences:{},
  monthly_summary:{period_month:'2026-07',expense_total:28654.19,expense_category:'工资',evidence:{period_month:'2026年7月',expense_total:'技术人员工资合计28654.19',expense_category:'技术人员工资'},confidence:{period_month:.99,expense_total:.99,expense_category:.99}}};
const payroll=voucherCodexCandidates(monthlyInput,'2026-07');
workspace=buildExpenseVoucherWorkspace({...base,items:[{...parent,candidate_fields:payroll.fields}]},source);
assert.equal(workspace.items[0].candidate_fields.document_kind,'monthly_summary');assert.equal(workspace.items[0].match.auto_eligible,true);
plan=expenseMatchPlan(workspace,[{...request,target_id:id(1)+'~C22'}],'auto');
assert.equal(plan[0].corrected_fields.document_date,null,'monthly summary never invents a payment day');assert.equal(plan[0].corrected_fields.period_month,'2026-07');
assert.throws(()=>expenseMatchPlan(workspace,[{...request,target_kind:'draft',target_id:id(5),corrected_fields:payroll.fields.monthly_summary}],'manual'),/月度汇总/);
assert.equal(voucherCodexCandidates({...monthlyInput,monthly_summary:{...monthlyInput.monthly_summary,period_month:'07'}},'2026-07').fields.monthly_summary,null);
assert.equal(voucherCodexCandidates({...monthlyInput,document_type:'recharge_list'},'2026-07').fields.monthly_summary,null,'recharge total is not an expense summary');
assert.equal(voucherCodexCandidates({...monthlyInput,monthly_summary:{...monthlyInput.monthly_summary,confidence:{...monthlyInput.monthly_summary.confidence,expense_total:2}}},'2026-07').fields.monthly_summary,null);
assert.equal(matchExpenseComponent({...payroll.fields.monthly_summary,period_month:'2026-08'},targets,'2026-07').auto_eligible,false);

// Execute real API methods with scoped synthetic I/O. No production connection.
const apiSource=fs.readFileSync('supabase/functions/operations-api/index.ts','utf8');
const code=stripTypeScriptTypes(apiSource.slice(apiSource.indexOf('async function expenseVoucherWorkspace('),apiSource.indexOf('async function voucherCenter(')));
let writes=[],apiBase=base,apiLinks=[],rawReads=0;
const scoped=path=>assert(path.includes('company_id=eq.'+id(20))&&path.includes('store_id=eq.'+id(21)));
const deps={buildExpenseVoucherWorkspace,expenseMatchPlan,recoverVoucherDateCandidate,uuidIn:ids=>'('+ids.join(',')+')',pettyCashBatchStatus:async(p,s)=>{if(s.operations_role!=='finance')throw Error('denied');return structuredClone(apiBase);},selectedStoreInfo:async()=>({company_id:id(20),id:id(21)}),cleanText:(v,n)=>String(v||'').slice(0,n),readReportSourceReview:async()=>structuredClone(source),
  restRows:async path=>{scoped(path);if(path.startsWith('zysyr_report_uploads?')){assert(path.includes('order=version.desc&limit=1'));return [{id:id(25),sha256:'b'.repeat(64)}];}if(path.startsWith('zysyr_voucher_ocr_tasks?')){rawReads++;return [{id:id(8),raw_result:{provider_response:rawReceipt}}];}throw Error('Unexpected bounded read '+path);},
  restRowsAll:async path=>{scoped(path);if(path.startsWith('zysyr_report_uploads?'))throw Error('A one-row latest query must not use the complete-pagination helper');if(path.startsWith('zysyr_report_cells?'))return [{id:id(26),cell_address:'C12',label:'房租 / 物业费 / Nov.',numeric_value:'1648.2700'}];if(path.startsWith('zysyr_expense_voucher_matches?'))return apiLinks;return [];},financeRpcSaved:async(route,body)=>{writes.push({route,body});return {inserted:1};},wakeVoucherOcrInBackground:()=>{}};
const methods=new Function(...Object.keys(deps),code+';return {expenseVoucherWorkspace,applyExpenseVoucherMatches,recoverExpenseVoucherFailures};')(...Object.values(deps));
await assert.rejects(methods.expenseVoucherWorkspace({month:'2026-07'},{operations_role:'employee'}));
const realShape=await methods.expenseVoucherWorkspace({month:'2026-07'},{operations_role:'finance'});assert.equal(writes.length,0,'workspace read cannot write associations');
assert.equal(realShape.targets.find(t=>t.source_locator==='C12').electronic_cell.report_id,id(25),'bounded latest report projection survives the real one-row result');
await methods.applyExpenseVoucherMatches({month:'2026-07',mode:'auto',items:[request]},{operations_role:'finance',auth_account_id:id(22)});
assert.equal(writes.length,1);assert.equal(writes[0].body.p_actor,id(22));assert.equal(writes[0].body.p_company,id(20));assert.equal(writes[0].body.p_matches[0].target_id,request.target_id);
apiBase={...base,items:[{...parent,candidate_fields:lostDate,field_confidences:{...confidence,document_date:0}}]};
const repairedRead=await methods.expenseVoucherWorkspace({month:'2026-07'},{operations_role:'finance'});
assert.equal(repairedRead.items[0].candidate_fields.document_date,'2026-07-05');assert.equal(writes.length,1,'date recovery is read-only');
await methods.applyExpenseVoucherMatches({month:'2026-07',mode:'auto',items:[request]},{operations_role:'finance',auth_account_id:id(22)});
assert.equal(writes.at(-1).body.p_matches[0].corrected_fields.date_basis,'stored_ocr_timestamp');assert.equal(lostDate.document_date,null);
apiLinks=[{...link,mode:'manual',corrected_fields:{...candidate,document_date:'2026-07-06'}}];const readsBeforeManual=rawReads;
const existingManual=await methods.expenseVoucherWorkspace({month:'2026-07'},{operations_role:'finance'});
assert.equal(rawReads,readsBeforeManual,'do not reparse an associated image');assert.equal(existingManual.items[0].corrected_fields.document_date,'2026-07-06','preserve human-confirmed fields');
console.log('Expense workspace: all monthly/petty targets, blank/summary handling, duplicate-source dedup, evidence/confidence, multi-image components, stale/manual protections, exception recovery and scoped read/apply API passed.');
