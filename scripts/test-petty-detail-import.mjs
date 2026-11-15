import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {loadPettyDetailWorkbook,compatiblePettyXlsxBytes} from '../supabase/functions/_shared/petty-detail-xlsx.mjs';
import {parseDetailCSV,previewDetailRows,detailKey,detailDate} from '../supabase/functions/_shared/petty-detail-import.mjs';
import {matchPettyCashCandidate,rankPettyCashCandidates} from '../supabase/functions/_shared/petty-cash-batch.mjs';
const mapping={transaction_date:0,amount:1,summary:2};
const matrix=parseDetailCSV('\uFEFF日期,支出,说明\r\n2026-07-01,236.80,"咖啡,茶"\r\n2026-02-30,10,错误\r\n7/2,10,缺少年\r\n2026-08-01,10,跨月\r\n2026-07-02,,未知\r\n2026-07-01,236.80,"咖啡,茶"\r\n2026-07-31,200,合计');
const rows=previewDetailRows(matrix,mapping,'2026-07');
assert.equal(rows.filter(r=>r.valid).length,1);assert(rows[5].duplicate);assert(rows[6].errors.length);assert.equal(rows[4].amount,null);
assert.throws(()=>parseDetailCSV('a,"b'));assert.throws(()=>previewDetailRows(matrix,{transaction_date:0,amount:0,summary:2},'2026-07'));
assert.equal(previewDetailRows(matrix,mapping,'2026-07',0,[rows[0]])[0].duplicate,true);
const targets=[{id:'a',target_kind:'draft',transaction_date:'2026-07-01',amount:10,summary:'咖啡'},{id:'b',target_kind:'draft',transaction_date:'2026-07-01',amount:10,summary:'水'}];
assert.equal(matchPettyCashCandidate({amount:10,document_date:'2026-07-01'},targets).target_id,null);
assert.notEqual(matchPettyCashCandidate({amount:10.01,document_date:'2026-07-01'},[targets[0]]).state,'exact');
assert.equal(matchPettyCashCandidate({amount:10,document_date:'2026-07-01'},[targets[0],{...targets[1],transaction_date:'2026-07-02'}]).target_id,null);
assert.equal(rankPettyCashCandidates({amount:10,document_date:'2026-07-01',summary:'水'},targets)[0].target_id,'b');
assert.equal(matchPettyCashCandidate({document_kind:'multiple_transactions',amount:10,document_date:'2026-07-01'},targets).state,'summary_review');
const src=fs.readFileSync('supabase/functions/operations-api/index.ts','utf8');
const methods=stripTypeScriptTypes(src.slice(src.indexOf('async function pettyDetailDrafts('),src.indexOf('function pettyCashBatchNote(')));
let calls=[],uploads=[],existing=[];
const hash=async b=>createHash('sha256').update(b).digest('hex');
const deps={ExcelJS,JSZip,loadPettyDetailWorkbook,parseDetailCSV,previewDetailRows,detailKey,historyImportFinance:s=>{if(s.operations_role!=='finance')throw Error('denied');},canReviewVouchers:()=>true,selectedStoreInfo:async(s,p)=>{assert.equal(p.store,'store');return {company_id:'company',id:'store-id'};},cleanText:(x,n)=>String(x??'').trim().slice(0,n),validDate:d=>/^\d{4}-\d{2}-01$/.test(d),decodeBase64:s=>new Uint8Array(Buffer.from(s,'base64')),exactArrayBuffer:b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),pettyCashBatchFields:v=>v&&typeof v==='object'?v:{},restRowsAll:async url=>{assert(url.includes('company_id=eq.company&store_id=eq.store-id'));return url.startsWith('zysyr_petty_detail_drafts')?existing:[];},historyMonthEntries:async()=>[],sha256Bytes:hash,sha256:hash,SUPABASE_URL:'https://synthetic.test',REPORT_BUCKET:'private',SERVICE_KEY:'synthetic-server',XLSX_MIME:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',storagePath:s=>s,crypto:globalThis.crypto,fetch:async(url,options)=>{uploads.push(options);return new Response('{}');},financeRpcSaved:async(route,body)=>{calls.push({route,body});return {inserted:body.p_rows.length};}};
const fn=new Function(...Object.keys(deps),methods+';return pettyDetailImport;')(...Object.values(deps));
const payload={store:'store',month:'2026-07',filename:'test.csv',base64:Buffer.from('日期,支出,摘要\n2026-07-01,236.80,咖啡').toString('base64')};
await assert.rejects(fn(payload,{operations_role:'staff'},false));
let data=await fn(payload,{operations_role:'finance'},false);assert.equal(data.matrix.length,2);assert.equal(uploads.length,0);
data=await fn({...payload,mapping},{operations_role:'finance'},false);assert.equal(data.accepted,1);assert.equal(uploads.length,0);
await assert.rejects(fn({...payload,mapping,selected_rows:[2],preview_sha256:'wrong'},{operations_role:'finance'},true));
await fn({...payload,mapping,selected_rows:[2],preview_sha256:data.source_sha256},{operations_role:'finance',auth_account_id:'actor'},true);
assert.equal(calls[0].body.p_actor,'actor');assert.equal(calls[0].body.p_store,'store-id');assert.equal(calls[0].body.p_rows[0].amount,236.8);assert.equal(calls[0].body.p_rows[0].row_key.length,64);assert.equal(uploads.length,1);
existing=[rows[0]]; // Different summary remains independent.
const book=new ExcelJS.Workbook();book.addWorksheet('空表');const sheet=book.addWorksheet('七月');sheet.addRow(['日期','支出','说明']);sheet.addRow([new Date('2026-07-03T00:00:00Z'),{formula:'1+2',result:3},'公式']);sheet.addRow(['2026-07-04',12.3,'茶']);
const bytes=await book.xlsx.writeBuffer();
data=await fn({...payload,filename:'test.xlsx',base64:Buffer.from(bytes).toString('base64'),sheet:'七月',mapping},{operations_role:'finance'},false);
assert.equal(data.invalid,1);assert.equal(data.accepted,1);assert.equal(data.rows[0].amount,null);
// Valid SpreadsheetML may use a namespace prefix and absolute package relationships.
// Reproduce both workbook and nested table relationships without private source files.
const tabular=new ExcelJS.Workbook(), tab=tabular.addWorksheet('明细');
tab.addTable({name:'DetailTable',ref:'A1',headerRow:true,columns:['日期','借方金额','贷方金额','说明'].map(name=>({name})),rows:[['2026-07-05',0,12.34,'字面值 <x:t> & 茶'],['2026-07-06',99,0,'零']]});
const standard=Buffer.from(await tabular.xlsx.writeBuffer()), zip=await JSZip.loadAsync(standard);
for(const entry of Object.values(zip.files).filter(e=>!e.dir)) {
  let xml=await entry.async('string');
  if(entry.name.endsWith('.xml')&&xml.includes('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"')) {
    xml=xml.replace('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"','xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"').replace(/<(\/?)([A-Za-z][\w.-]*)(?=[\s/>])/g,'<$1x:$2');
    zip.file(entry.name,xml);
  } else if(entry.name.endsWith('.rels')) {
    const base=entry.name.split('/').slice(0,-2);
    xml=xml.replace(/Target="([^"/:]+(?:\/[^\"]*)?)"/g,(_,target)=>{
      const parts=[...base];for(const part of target.split('/')){if(part==='..')parts.pop();else if(part!=='.')parts.push(part);}return 'Target="/'+parts.join('/')+'"';
    });zip.file(entry.name,xml);
  }
}
const main='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
zip.file('compatibility-probe.xml','<q:root xmlns:q="'+main+'" xmlns:f="urn:foreign"><q:t attr="a > b">x: untouched &lt;q:t&gt;<![CDATA[<q:t>]]></q:t><!-- <q:t> --><f:item><plain xmlns="urn:plain"/><q:item xmlns:q="urn:rebound"/></f:item></q:root>');
const prefixed=await zip.generateAsync({type:'uint8array'}), unchanged=Buffer.from(prefixed);
await assert.rejects(new ExcelJS.Workbook().xlsx.load(prefixed));
const compatible=await loadPettyDetailWorkbook(prefixed,ExcelJS,JSZip);
assert.deepEqual(compatible.getWorksheet('明细').getSheetValues(),tab.getSheetValues());
assert.deepEqual(Buffer.from(prefixed),unchanged,'source bytes must remain immutable');
const normalized=await JSZip.loadAsync(await compatiblePettyXlsxBytes(prefixed,JSZip));
const probe=await normalized.file('compatibility-probe.xml').async('string');
assert(probe.includes('<![CDATA[<q:t>]]>'));assert(probe.includes('<!-- <q:t> -->'));assert(probe.includes('x: untouched &lt;q:t&gt;'));assert(probe.includes('attr="a > b"'));
assert(probe.includes('<plain xmlns="urn:plain"/>'));assert(probe.includes('<q:item xmlns:q="urn:rebound"/>'));
const rel=await normalized.file('xl/worksheets/_rels/sheet1.xml.rels').async('string');assert(rel.includes('Target="../tables/table1.xml"'));
assert.deepEqual(Buffer.from(await compatiblePettyXlsxBytes(standard,JSZip)),standard,'ordinary XLSX must pass through unchanged');
data=await fn({...payload,filename:'prefixed.xlsx',base64:Buffer.from(prefixed).toString('base64'),mapping:{transaction_date:0,amount:2,summary:3}},{operations_role:'finance'},false);
assert.equal(data.rows[0].amount,12.34);assert.equal(data.rows[1].raw[2],'0');assert.equal(data.rows[1].amount,null);assert(data.rows[1].errors.includes('支出金额缺失或无效'));assert.equal(data.rows[0].summary,'字面值 <x:t> & 茶');
// Independent t="d" fixture: never let parseFloat turn a calendar year into a serial.
for(const prefixedDate of [false,true]) {
const dateZip=await JSZip.loadAsync(prefixedDate?prefixed:standard), name='xl/worksheets/sheet1.xml';
let xml=await dateZip.file(name).async('string');
const prefix=prefixedDate?'x:':'';
xml=xml.replace(new RegExp('<'+prefix+'c\\b[^>]*r="A2"[^>]*>[\\s\\S]*?</'+prefix+'c>'),'<'+prefix+'c r="A2" t="d"><'+prefix+'v>2026-07-05T00:00:00.000Z</'+prefix+'v></'+prefix+'c>');
dateZip.file(name,xml);const dateBytes=await dateZip.generateAsync({type:'uint8array'});
data=await fn({...payload,filename:'iso-date.xlsx',base64:Buffer.from(dateBytes).toString('base64'),mapping:{transaction_date:0,amount:2,summary:3}},{operations_role:'finance'},false);
assert.equal(data.rows[0].transaction_date,'2026-07-05');assert.equal(data.rows[0].raw[0],'2026-07-05T00:00:00.000Z');
}
assert.equal(detailDate('2026-02-30T00:00:00.000Z'),'');assert.equal(detailDate('2026-07-05T23:00:00.000Z'),'');
await assert.rejects(loadPettyDetailWorkbook(Buffer.from('not an xlsx'),ExcelJS,JSZip),/不是 XLSX/);
await assert.rejects(loadPettyDetailWorkbook(Buffer.from('PKbroken zip'),ExcelJS,JSZip),/无法解压/);
assert.equal(calls.length,1);console.log('Petty detail: strict dates/amounts, CSV quoting, real XLSX, formula exclusion, duplicate/scope validation, summary guard, ranked choices, preview-only and confirmed draft RPC passed.');
