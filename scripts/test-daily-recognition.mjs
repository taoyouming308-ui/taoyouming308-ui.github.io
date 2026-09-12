import assert from 'node:assert/strict';
import {validateDailyCandidates} from '../supabase/functions/_shared/daily-recognition.mjs';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const cells=[
  {id:'a',section_code:'stylist',row_key:'stylist_1',cell_role:'staff_value'},
  {id:'b',section_code:'technician',row_key:'technician_1',cell_role:'unclosed_order'},
];
const run=value=>validateDailyCandidates(value,cells,'2026-04-01','向里造型');
assert.equal(run({cells:[{id:'a',value:0,confidence:.8}]}).cells[0].value,0);
assert.equal(run({cells:[{id:'a',value:null}]}).cells.length,0);
assert.throws(()=>run({report_date:'2026-04-02',cells:[]}),/日期/);
assert.throws(()=>run({store_name:'东方福邸',cells:[]}),/门店/);
assert.throws(()=>run({cells:[{id:'other',value:100}]}),/未知/);
assert.throws(()=>run({cells:[{id:'a',value:1},{id:'a',value:2}]}),/重复/);
assert.throws(()=>run({cells:[{id:'a',value:'100'}]}),/金额/);
assert.throws(()=>run({cells:[{id:'a',value:-1}]}),/金额/);
assert.equal(run({cells:[]}).date_unconfirmed,true);
const full=run({cells:[{id:'a',value:12,confidence:.9}],text_cells:[{id:'b',value:'A102',confidence:.8}],row_names:[{section:'stylist',row_key:'stylist_1',name:'陈晨',confidence:.95}]});
assert.equal(full.text_cells[0].value,'A102');
assert.equal(full.row_names[0].name,'陈晨');
assert.throws(()=>run({cells:[],text_cells:[{id:'a',value:'错误列'}]}),/文字格/);
assert.throws(()=>run({cells:[],row_names:[{section:'stylist',row_key:'stylist_category_total',name:'错误'}]}),/姓名行/);
console.log('Daily candidate validation passed: wrong store/date, unknown/duplicate cells, blank/zero, invalid amounts.');
const source=fs.readFileSync(new URL('../supabase/functions/operations-api/index.ts',import.meta.url),'utf8');
const definitions=['cleanText','uuidIn','effectiveCellValue','confirmedDailyRollup'].map(name=>{const start=source.indexOf((name==='confirmedDailyRollup'?'async ':'')+'function '+name+'(');return source.slice(start,source.indexOf('\n}',start)+2);}).join('\n');
const id='00000000-0000-4000-8000-000000000001';
let duplicate=false;
const context=vm.createContext({restRowsAll:async path=>{assert.match(path,/company_id=eq.company/);assert.match(path,/store_id=eq.store/);if(path.startsWith('zysyr_daily_sheet_drafts')){assert.match(path,/status=eq.confirmed/);return duplicate?[{id,report_date:'2026-04-01'},{id,report_date:'2026-04-01'}]:[{id,report_date:'2026-04-01',edit_revision:1}];}return [{id:'cell',draft_id:id,manual_override:true,corrected_numeric:123.45}];}});
vm.runInContext(stripTypeScriptTypes(definitions),context);
assert.equal((await context.confirmedDailyRollup('company','store','2026-04')).amount,123.45);
assert.equal((await context.confirmedDailyRollup('company','store','2026-04')).amount,123.45,'repeat reads never accumulate again');
duplicate=true;await assert.rejects(context.confirmedDailyRollup('company','store','2026-04'),/重复汇总/);
console.log('Daily rollup: company/store/month scope, confirmed-only, no repeated accumulation and duplicate-date refusal passed.');
