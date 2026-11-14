const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http');
const {chromium}=require('playwright');
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width"><input id="month" value="2026-07"><div id="container"></div>');});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;try{
browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const pure=await import('../supabase/functions/_shared/petty-detail-import.mjs');let calls=[],release;let delay=false;
await page.exposeFunction('backend',async(op,p)=>{calls.push({op,p});if(delay)await new Promise(r=>release=r);const matrix=pure.parseDetailCSV(Buffer.from(p.base64,'base64').toString());if(!Object.keys(p.mapping).length)return{matrix,sheets:[],source_sha256:'hash'};const rows=pure.previewDetailRows(matrix,p.mapping,p.month);if(op.endsWith('confirm'))return{saved:{inserted:p.selected_rows.length}};return{rows,source_sha256:'hash',accepted:rows.filter(r=>r.valid).length,duplicates:rows.filter(r=>r.duplicate).length,invalid:rows.filter(r=>!r.valid&&!r.duplicate).length};});
await page.goto('http://127.0.0.1:'+server.address().port);
await page.evaluate(()=>{window.store='一店';window.state={session:'synthetic'};window.authAccessToken=()=>'';window.currentStore=()=>window.store;window.esc=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');window.api=(o,p)=>window.backend(o,p);window.fileBase64=f=>new Promise((r,j)=>{const reader=new FileReader();reader.onload=()=>r(reader.result.split(',')[1]);reader.onerror=j;reader.readAsDataURL(f);});window.formatAmount=v=>Number(v).toFixed(2);window.isLocalPreview=()=>false;window.ZysyrPettyReloadBatch=async()=>{};});
await page.addScriptTag({content:fs.readFileSync('operations-petty-detail-import.js','utf8')});await page.evaluate(()=>ZysyrPettyDetailImport.mount(document.getElementById('container')));
const csv='日期,支出,摘要\n2026-07-01,236.80,咖啡\n2026-07-01,236.80,咖啡\n2026-08-01,10,跨月\n2026-07-02,,缺金额';
await page.locator('#petty-detail-file').setInputFiles({name:'sample.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
await page.locator('#petty-detail-preview').click();await page.waitForSelector('#petty-detail-confirm');
assert.equal(await page.locator('[data-detail-row]:checked').count(),1);assert.equal(await page.locator('[data-detail-row]:disabled').count(),3);assert.equal(calls.filter(c=>c.op.endsWith('confirm')).length,0);
await page.locator('#petty-detail-confirm').click();await page.waitForFunction(()=>document.getElementById('petty-detail-import-status').textContent.includes('已保存 1 笔'));
assert.deepEqual(calls.find(c=>c.op.endsWith('confirm')).p.selected_rows,[2]);assert.equal(calls.find(c=>c.op.endsWith('confirm')).p.store,'一店');
// Token refresh within the same account/session preserves an in-flight import.
await page.evaluate(()=>{window.authAccessToken=()=>window.token;window.token='e30.'+btoa(JSON.stringify({sub:'user',session_id:'login',exp:1}))+'.signature';});
delay=true;await page.locator('#petty-detail-file').setInputFiles({name:'refresh.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await page.waitForTimeout(80);
await page.evaluate(()=>{window.token='e30.'+btoa(JSON.stringify({sub:'user',session_id:'login',exp:2}))+'.newsignature';});release();delay=false;await page.waitForSelector('#petty-detail-preview');
// Late result from a different store must not paint the current panel.
delay=true;await page.locator('#petty-detail-file').setInputFiles({name:'late.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});await page.waitForTimeout(80);
await page.evaluate(()=>{store='二店';document.getElementById('container').innerHTML='';ZysyrPettyDetailImport.mount(document.getElementById('container'));});release();await page.waitForTimeout(100);assert.equal(await page.locator('#petty-detail-preview').count(),0);assert.deepEqual(errors,[]);
console.log('Petty detail browser: mobile mapping, invalid/duplicate row exclusion, preview before explicit confirmation, selected rows and stale-store response isolation passed.');
}finally{if(browser)await browser.close();server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
