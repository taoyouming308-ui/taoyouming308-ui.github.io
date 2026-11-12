import assert from 'node:assert/strict';
import {parseHistoricalWorkbook} from '../supabase/functions/_shared/zysyr-history-import.mjs';
import {historyGenerationLedgerBindings, buildHistoryReparsePlan,stableHistoryJson,historyEffectiveRows} from '../supabase/functions/_shared/history-reparse-plan.mjs';
const batch={import_type:'monthly_profit_loss',status:'needs_review',confirmed_at:null,imported_row_count:0,period_start:'2026-07-01',period_end:'2026-09-01',target_store_label:'自由手艺人'};
const cells={A1:{value:'自由手艺人盈亏统计'},A2:{value:'费用'},A3:{value:'费用'},A4:{value:'费用'},
  B2:{value:100,isMerged:true,master:{address:'B2'}},C2:{value:100,isMerged:true,master:{address:'B2'}},
  B3:{value:{formula:'1-1'},result:0,formula:'1-1'},
  B4:{value:{sharedFormula:'B3'},result:0,formula:'2-2'}};
const sheet={name:'7月',rowCount:4,actualRowCount:4,columnCount:3,actualColumnCount:3,getCell(r,c){const a=typeof r==='string'?r:String.fromCharCode(64+c)+r;return {address:a,value:null,numFmt:'General',...cells[a]};}};
const workbook={worksheets:[sheet]};
const parsed=parseHistoricalWorkbook(workbook,{import_type:batch.import_type,year:2026,period_start:'2026-07',period_end:'2026-09',target_store_label:'自由手艺人'}).rows;
const rows=parsed.map((r,i)=>({id:`row-${i}`,row_hash:'a'.repeat(64),source_sheet:r.source_sheet,source_locator:r.source_locator,
 raw_json:r.raw,mapped_json:{...r.mapped},review_status:'pending',import_status:'pending',validation_status:'warning',validation_issues:[{code:'business_pending',severity:'warning'}]}));
rows.find(r=>r.source_locator==='7月!B3').mapped_json.amount=null;
rows.find(r=>r.source_locator==='7月!B4').mapped_json.formula='B3';
rows.push({...structuredClone(rows[0]),id:'row-merged',source_locator:'7月!C2',mapped_json:{...rows[0].mapped_json,cell_address:'C2'}});
const before=stableHistoryJson(rows);
const plan=buildHistoryReparsePlan(workbook,batch,rows);
assert.equal(plan.counts.included,3);assert.equal(plan.counts.excluded,1);assert.equal(plan.counts.changed,2);
assert.equal(plan.decisions.find(r=>r.source_locator==='7月!B3').effective_mapped.amount,0);
assert.equal(plan.decisions.find(r=>r.source_locator==='7月!B4').effective_mapped.formula,'2-2');
assert(plan.decisions.every(r=>r.validation_issues.some(i=>i.code==='business_pending')));
assert.equal(stableHistoryJson(rows),before);assert.equal(plan.formal_ledger_written,false);
const generation={id:'generation-a',version:1,decisions:plan.decisions};
const effective=historyEffectiveRows(rows,generation);
assert.equal(effective.length,3);assert.equal(rows.length,4);
assert.equal(effective.find(r=>r.source_locator==='7月!B3').mapped_json.amount,0);
assert.equal(effective.find(r=>r.source_locator==='7月!B3').original_mapped_json.amount,null);
assert.equal(stableHistoryJson(rows),before);
assert.throws(()=>historyEffectiveRows(rows,{...generation,decisions:plan.decisions.slice(1)}),/INCOMPLETE/);
assert.throws(()=>historyEffectiveRows(rows,{...generation,decisions:plan.decisions.map((d,i)=>i===0?{...d,source_row_hash:'changed'}:d)}),/SOURCE_CHANGED/);
function reject(change,pattern){const copy=structuredClone(rows);change(copy);assert.throws(()=>buildHistoryReparsePlan(workbook,batch,copy),pattern);}
reject(r=>r[0].mapped_json.amount=999,/UNAPPROVED_CHANGE/);
reject(r=>r[0].review_status='confirmed',/NOT_PRISTINE/);
reject(r=>r[0].corrected_json={},/NOT_PRISTINE/);
reject(r=>r.push(structuredClone(r[0])),/NOT_PRISTINE/);
reject(r=>r.splice(0,1),/NEW_OR_DUPLICATE_ROW/);
reject(r=>r[0].source_locator='7月!ZZ999',/NEW_OR_DUPLICATE_ROW|IDENTITY_INVALID/);
assert.throws(()=>buildHistoryReparsePlan(workbook,{...batch,status:'completed'},rows),/NOT_PRISTINE/);
assert.throws(()=>buildHistoryReparsePlan(workbook,{...batch,import_type:'employee_purchase'},rows),/NOT_PRISTINE/);
assert.equal(stableHistoryJson({b:2,a:1}),stableHistoryJson({a:1,b:2}));
console.log('protected reparse plan passed: allowlisted delta, exact original coverage, pristine state, warning preservation and no mutation');

const gen={id:'g',version:2,decisions:[{import_row_id:'r',source_locator:'Sheet!A1',disposition:'include',effective_mapped:{amount:1}}]};
const entry={id:'ledger',import_row_id:'r',source_locator:'Sheet!A1',posted_payload:{amount:1},current_payload:{amount:2},version:2};
assert.equal(historyGenerationLedgerBindings([entry],gen)[0].generation_id,'g');assert.equal(entry.generation_id,undefined);
assert.equal(historyGenerationLedgerBindings([{...entry,source_locator:'other'}],gen)[0].generation_id,undefined);
assert.equal(historyGenerationLedgerBindings([{...entry,posted_payload:{amount:2}}],gen)[0].generation_id,undefined);
assert.equal(historyGenerationLedgerBindings([{...entry,import_row_id:'other'}],gen)[0].generation_id,undefined);
assert.equal(historyGenerationLedgerBindings([entry],null)[0],entry);
console.log('ledger generation bindings passed: exact original snapshot and locator, current amendments allowed, mismatches fail closed');
