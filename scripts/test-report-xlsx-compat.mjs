// Synthetic regressions; optional private original is read locally and never uploaded.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import * as compatibility from '../supabase/functions/_shared/petty-detail-xlsx.mjs';
import { captureMonthlySource, verifyMonthlyUpload } from '../supabase/functions/_shared/monthly-upload-verification.mjs';
import { detectReportMetadata } from '../supabase/functions/_shared/report-auto-detection.mjs';

const index = fs.readFileSync('supabase/functions/operations-api/index.ts', 'utf8');
const names = ['cleanText','excelCellText','numericCellValue','formulaCellText','mergeCoordinates','columnLetters','formulaPrecedents','reportCellLabel','monthlyEditableBlankCells','worksheetByCleanName','activeWorkbookSheetName','workbookDisplay'];
const snippets = names.map(name => {const start=index.indexOf((['workbookDisplay','activeWorkbookSheetName'].includes(name)?'async ':'')+'function '+name+'(');assert(start>=0);return index.slice(start,index.indexOf('\n}',start)+2);}).join('\n');
const sandbox=vm.createContext({ExcelJS,JSZip,...compatibility,exactArrayBuffer:b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)});
vm.runInContext(stripTypeScriptTypes(snippets),sandbox);
const archiveSource=fs.readFileSync('supabase/functions/_shared/monthly-source-archive.ts','utf8').replace("from './petty-detail-xlsx.mjs'","from '"+pathToFileURL(path.resolve('supabase/functions/_shared/petty-detail-xlsx.mjs')).href+"'");
const {monthlySourceWorksheetNames}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(archiveSource)).toString('base64'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const clone=v=>JSON.parse(JSON.stringify(v));
const book=new ExcelJS.Workbook();book.views=[{activeTab:1}];
for(const name of ['7月 ','8月']){
  const sheet=book.addWorksheet(name);sheet.getCell('A1').value='2026年'+name.trim()+'盈亏报表';
  sheet.getCell('A4').value='盈亏统计';sheet.getCell('A5').value='收入类别';sheet.getCell('A6').value='美发收入';
  sheet.getCell('B2').value=123.45;sheet.getCell('B3').value=0;
  sheet.getCell('C2').value={formula:'SUM(B2:B3)',result:123.45};
  sheet.getCell('C3').value={formula:'0+0',result:0};sheet.getCell('C4').value={formula:'SUM(B4:B5)'};
  sheet.mergeCells('D2:E2');sheet.getCell('D2').value=77.25;sheet.getCell('B7').value='字面值 <ns0:sheet> & 茶';
}
const standard=Buffer.from(await book.xlsx.writeBuffer());
const zip=await JSZip.loadAsync(standard);
for(const entry of Object.values(zip.files).filter(e=>!e.dir&&/\.(xml|rels)$/.test(e.name))){
  let xml=await entry.async('string');
  for(const [uri,prefix] of [['http://schemas.openxmlformats.org/spreadsheetml/2006/main','ns0'],['http://schemas.openxmlformats.org/package/2006/relationships','p'],['http://schemas.openxmlformats.org/package/2006/content-types','ct']]){
    if(xml.includes('xmlns="'+uri+'"'))xml=xml.replace('xmlns="'+uri+'"','xmlns:'+prefix+'="'+uri+'"').replace(/<(\/?)([A-Za-z][\w.-]*)(?=[\s/>])/g,'<$1'+prefix+':$2');
  }
  if(entry.name==='xl/workbook.xml')xml=xml.replaceAll('xmlns:r=','xmlns:relx=').replaceAll('r:id=','relx:id=');
  zip.file(entry.name,xml);
}
const prefixed=Buffer.from(await zip.generateAsync({type:'uint8array'})),before=hash(prefixed);
assert.equal(await sandbox.activeWorkbookSheetName(prefixed),'8月');
assert.deepEqual(await monthlySourceWorksheetNames(prefixed,b=>JSZip.loadAsync(b)),['7月 ','8月']);
const reference=await sandbox.workbookDisplay(standard,'monthly_profit_loss','','7月');
const projected=await sandbox.workbookDisplay(prefixed,'monthly_profit_loss','','7月');
assert.deepEqual(clone(projected),clone(reference),'namespace aliases must preserve full display, values, formulas, merges and formatting');
const snapshot=await captureMonthlySource(prefixed,{filename:'2026年7月盈亏表.xlsx',sha256:before,sheet_name:projected.sheet_name,report_date:'2026-07-01'},{loadZip:b=>JSZip.loadAsync(b)});
assert(snapshot.available,snapshot.reason);const audit=verifyMonthlyUpload(snapshot,{report_date:'2026-07-01',sha256:before,display_data:projected},projected.cells);assert.equal(audit.status,'needs_review');assert(!audit.issues.some(i=>i.severity==='error'),JSON.stringify(audit));
assert.equal(projected.cells.find(c=>c.cell_address==='B3').numeric_value,0);
assert.equal(projected.cells.find(c=>c.cell_address==='C4').numeric_value,null);
assert(!projected.cells.some(c=>c.cell_address==='E2'));
assert.equal(hash(prefixed),before,'original bytes remain immutable');
assert.deepEqual(Buffer.from(await compatibility.compatiblePettyXlsxBytes(standard,JSZip)),standard,'ordinary XLSX remains byte-identical');
const rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
assert.equal(compatibility.workbookRelationshipId('<x:workbook xmlns:z="'+rel+'">',{'z:id':'rId8'}),'rId8');
assert.equal(compatibility.workbookRelationshipId('<workbook/>',{'xmlns:z':rel,'z:id':'local'}),'local');
assert.equal(compatibility.workbookRelationshipId('<workbook xmlns:z="'+rel+'">',{'z:id':'a','r:id':'b'}),'');
assert.throws(()=>compatibility.compatibleWorkbookXml('<s:sheet xmlns:s="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:z="'+rel+'" xmlns:r="urn:foreign" z:id="a"/>'),/冲突/);

if(process.env.MONTHLY_COMPAT_REAL_FILE){
  const file=process.env.MONTHLY_COMPAT_REAL_FILE,bytes=fs.readFileSync(file),sha=hash(bytes);
  const active=await sandbox.activeWorkbookSheetName(bytes),display=await sandbox.workbookDisplay(bytes,'monthly_profit_loss','向里造型',active);
  const detection=detectReportMetadata({filename:path.basename(file),sheetName:display.sheet_name,values:display.values,storeName:'向里造型'});
  assert.equal(detection.month,'2026-07');assert.equal(detection.report_type,'monthly_profit_loss');
  const original=await captureMonthlySource(bytes,{filename:path.basename(file),sha256:sha,sheet_name:display.sheet_name,report_date:detection.report_date},{loadZip:b=>JSZip.loadAsync(b)});
  const verification=verifyMonthlyUpload(original,{report_date:detection.report_date,sha256:sha,display_data:display},display.cells);
  assert(original.available,original.reason);assert.equal(verification.status,'matched',JSON.stringify(verification));
  assert.deepEqual(await monthlySourceWorksheetNames(bytes,b=>JSZip.loadAsync(b)),['7月 ']);
  assert.equal(hash(bytes),sha);assert.equal(hash(fs.readFileSync(file)),sha);
  fs.writeFileSync('artifacts/v668-acceptance/real-file-verification.json',JSON.stringify({sha256:sha,detection,rows:display.rows,columns:display.columns,verification,source_unchanged:true,production_writes:false},null,2)+'\n');
  console.log('Private July original: month/type detection, numeric/formula/merge audit and exact-byte preservation passed locally; no production writes.');
}
console.log('Report XLSX compatibility: namespace aliases in workbook/types/relationships, active month, independent source audit, zeros/unknowns/merges and ordinary bytes passed.');
