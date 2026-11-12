import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { historicalCellSnapshot } from '../supabase/functions/_shared/zysyr-history-import.mjs';

const api=fs.readFileSync('supabase/functions/operations-api/index.ts','utf8');
const block=(start,end)=>api.slice(api.indexOf(start),api.indexOf(end,api.indexOf(start)));
const source=block('function excelCellText(', '\nfunction mergeCoordinates(')
  +block('async function historyImportSheetPreview(', '\nasync function historyImportReview(');
const matrix={A1:{value:'盈亏统计'},A2:{value:'费用'},B2:{value:100,isMerged:true,master:{address:'B2'}},C2:{value:100,isMerged:true,master:{address:'B2'}},
  B3:{value:{formula:'1-1'},result:0,formula:'1-1'},
  B4:{value:{sharedFormula:'B3'},result:0,formula:'2-2'},
  B5:{value:{formula:'1-1'},formula:'1-1'},
  B6:{value:{richText:[{text:'原件'},{text:'说明'}]}}};
const sheet={name:'7月',actualRowCount:7,actualColumnCount:3,model:{merges:['B2:C2']},
  getCell(r,c){const address=String.fromCharCode(64+c)+r;return {address,value:null,...matrix[address]};},
  getColumn(){return {width:12};},getRow(){return {height:22};}};
let allowed=true,visible=true,fetchOk=true,parseOk=true,fetches=0;
const queries=[];
const sandbox={historicalCellSnapshot,Uint8Array,
  cleanText:(v,max=500)=>String(v??'').trim().slice(0,max),
  historyImportFinance:()=>{if(!allowed)throw Error('denied');},
  selectedStoreInfo:async()=>({company_id:'company-a',id:'store-a'}),
  uuidValue:v=>v,storagePath:v=>v,exactArrayBuffer:v=>v.buffer,
  SUPABASE_URL:'https://example.invalid',SERVICE_KEY:'synthetic-only',
  restRows:async q=>{queries.push(q);return visible?[{id:'batch-a',source_bucket_id:'private',source_object_path:'scope/source.xlsx',source_filename:'source.xlsx'}]:[];},
  fetch:async()=>{fetches++;return {ok:fetchOk,status:503,arrayBuffer:async()=>new ArrayBuffer(1)};},
  ExcelJS:{Workbook:class{constructor(){this.worksheets=[sheet];this.xlsx={load:async()=>{if(!parseOk)throw Error('invalid');}};}}},
  worksheetByCleanName:(w,name)=>w.worksheets.find(s=>s.name===name),
};
vm.createContext(sandbox);
vm.runInContext(stripTypeScriptTypes(source+'\nthis.preview=historyImportSheetPreview;'),sandbox);
const payload={import_batch_id:'batch-a',source_sheet:'7月'};
const result=await sandbox.preview(payload,{});
const cells=new Map(result.cells.map(c=>[c.address,c]));
assert.equal(cells.has('C2'),false);
assert.equal(cells.get('B2').value,'100');
assert.equal(cells.get('B3').value,'0');
assert.equal(cells.get('B4').value,'0');
assert.equal(cells.get('B4').formula,'2-2');
assert.notEqual(cells.get('B5').value,'0');
assert.equal(cells.get('B5').formula,'1-1');
assert.equal(cells.get('B6').value,'原件说明');
assert.equal(cells.has('B7'),false);
assert.equal(result.merges[0],'B2:C2');
assert.equal(result.formal_ledger_written,false);
assert.equal(result.source_immutable,true);
assert.match(queries[0],/company_id=eq.company-a&store_id=eq.store-a&id=eq.batch-a/);
allowed=false;const before=fetches;await assert.rejects(()=>sandbox.preview(payload,{}),/denied/);assert.equal(fetches,before);allowed=true;
visible=false;await assert.rejects(()=>sandbox.preview(payload,{}),/不存在或不属于/);assert.equal(fetches,before);visible=true;
await assert.rejects(()=>sandbox.preview({...payload,source_sheet:'不存在'},{}),/工作表不存在/);
fetchOk=false;await assert.rejects(()=>sandbox.preview(payload,{}),/原件读取失败/);fetchOk=true;
parseOk=false;await assert.rejects(()=>sandbox.preview(payload,{}),/原件无法读取/);
console.log('history sheet preview passed: zero/shared formula/merges/rich text/blank, tenant scope, denied access and source failures');
