import assert from 'node:assert/strict';
import { parseHistoricalWorkbook } from '../supabase/functions/_shared/zysyr-history-import.mjs';
const cells={A1:{value:'自由手艺人盈亏统计'},A2:{value:'费用'},A3:{value:'费用'},A4:{value:'费用'},A5:{value:'费用'},A6:{value:'费用'},A7:{value:'费用'},A8:{value:'费用'},
  B2:{value:100,isMerged:true,master:{address:'B2'}},C2:{value:100,isMerged:true,master:{address:'B2'}},
  B3:{value:{formula:'1-1'},result:0,formula:'1-1'},
  B4:{value:{sharedFormula:'B3'},result:0,formula:'2-2'},
  B5:{value:{formula:'1-1'},formula:'1-1'},B6:{value:null},
  B7:{value:{formula:'3-2',result:1}},B8:{value:0}};
const sheet={name:'7月',rowCount:8,actualRowCount:8,columnCount:3,actualColumnCount:3,
  getCell(r,c){const address=String.fromCharCode(64+c)+r;return {address,value:null,numFmt:'General',...cells[address]};}};
function parse(){return parseHistoricalWorkbook({worksheets:[sheet]},{import_type:'monthly_profit_loss',year:2026,period_start:'2026-07',period_end:'2026-09',target_store_label:'自由手艺人',employees:[],products:[]}).rows;}
const rows=parse(),byAddress=new Map(rows.map(r=>[r.mapped.cell_address,r]));
assert.equal(rows.length,6);
assert.equal(byAddress.has('C2'),false,'merged slave must not become a second amount');
assert.equal(byAddress.get('B2').mapped.amount,100);
assert.equal(byAddress.get('B3').mapped.amount,0);
assert.equal(byAddress.get('B3').raw.value,0);
assert.equal(byAddress.get('B4').mapped.formula,'2-2');
assert.equal(byAddress.get('B4').raw.formula,'2-2');
assert.equal(byAddress.get('B4').mapped.amount,0);
assert.equal(byAddress.get('B5').mapped.amount,null,'missing formula cache remains unknown');
assert.equal(byAddress.has('B6'),false,'blank must not become zero');
assert.equal(byAddress.get('B7').mapped.amount,1,'plain adapters remain compatible');
assert.equal(byAddress.get('B8').mapped.amount,0);
cells.B2.value={formula:'2+3',result:5};cells.C2.value={formula:'2+3',result:5};
const formulas=parse().filter(r=>r.source_row_number===2);
assert.equal(formulas.length,1);assert.equal(formulas[0].mapped.amount,5);
console.log('history cell semantics passed: merged input/formula, shared formula, cached zero, missing cache, blank and adapters');
