// No server or live credentials. Playwright intercepts every request, including the fake API.
// --compare also runs the same scenarios against the v689 Git snapshot (requires history).
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),cp=require('node:child_process');
const {chromium,webkit}=require('playwright'),origin='https://frontdesk-performance.invalid',root=path.resolve(__dirname,'..');
const rows=Array.from({length:60},(_,i)=>({name:'模拟客户'+i,profile_id:'id-'+i,shops:['A']}));
const photo='https://pdssrmpeiuwvxzsgschm.supabase.co/storage/v1/object/public/synthetic/example.png';
const day={available:true,source_count:1,payments:[],employees:Array.from({length:12},(_,i)=>({employee_id:'E'+i,employee_names:['合成员工'+i],performance_cents:100,lines:Array.from({length:80},(_,j)=>({item:{item_name:'模拟服务'},source_bill_id:'模拟'+j,performance_cents:100}))}))};
const user={username:'synthetic',role:'admin',position:'前台',store:'A',stores:['A','B'],can_import:true};
function deferred(){let resolve;return{promise:new Promise(r=>{resolve=r}),resolve}}
async function scenario(browser,baseline){
  const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'}),calls=[],errors=[],unexpected=[],stats={};
  const late=deferred(),started=deferred();let block=false,bodyCalls=0,wrongScope='';
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin===origin){
      const name=url.pathname.slice(1)||'frontdesk.html',file=path.resolve(root,name);
      if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
      const body=baseline&&['frontdesk.html','frontdesk-business-details.js','data-read-client.js'].includes(name)?cp.execFileSync('git',['show','1b70a903:'+name],{cwd:root,maxBuffer:5e6}):fs.readFileSync(file);
      return route.fulfill({body,contentType:name.endsWith('html')?'text/html':name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'application/octet-stream'});
    }
    if(url.href===photo)return route.fulfill({body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64'),contentType:'image/png'});
    if(url.pathname!=='/functions/v1/frontdesk-api'){unexpected.push(url.origin);return route.abort();}
    const q=route.request().postDataJSON();calls.push(q);
    const detail={store:q.store,customer:{name:'合成专享'+q.store},customer_scope:q.customer_scope,hair_records:Array.from({length:12},(_,i)=>({id:'archive-'+i,created_at:'2026-01-01',record_data:{formFields:{'hair-form-perm-notes':'测试 '+i},serviceBeforePhoto:photo,serviceAfterPhoto:photo}}))};
    if(q.operation==='customer_detail'&&q.archive_projection==='body-v1'){
      assert.equal(q.store,'A');assert.equal(q.name,'A模拟客户0');bodyCalls++;
      if(bodyCalls===1)return route.fulfill({status:503,json:{error:'模拟读取失败'}});
      return route.fulfill({json:{archive_projection:'body-v1',store:q.store,customer_scope:q.customer_scope,archive_id:q.archive_id,record_data:detail.hair_records[0].record_data}});
    }
    if(q.archive_projection==='outline-v1')detail.hair_records=detail.hair_records.map(r=>({...r,record_data:{date:'2026-01-01'},archive_deferred:true}));
    const data={login:{user,session_token:'fake-only'},dashboard:{store:q.store,date:q.date,bookings:[],reception:[],barbers:[],assistants:[],technicians:[],services:[]},business_details:day,customer_search:{store:q.store,customer_scope:q.customer_scope,results:rows.map(r=>({...r,name:q.store+r.name}))},customer_detail:detail,ledger_records:{store:q.store,business_date:q.business_date,rows:[]},import_batches:{batches:[]},logout:{}};
    if(!Object.hasOwn(data,q.operation)){unexpected.push(q.operation);return route.fulfill({status:400,json:{error:'Not a synthetic read'}});}
    if(wrongScope===q.operation){if(wrongScope==='customer_search')data.customer_search.customer_scope='store';else data.customer_detail.store='previous-store';}
    if(q.operation==='customer_search'){await new Promise(r=>setTimeout(r,45));if(block&&q.store==='A'){started.resolve();await late.promise;}}
    await route.fulfill({json:data[q.operation]});
  });
  const count=op=>calls.filter(c=>c.operation===op).length;
  try{
    await page.goto(origin+'/frontdesk.html');await page.locator('#login-user').fill('synthetic');await page.locator('#login-pass').fill('fixture');await page.locator('#login-btn').click();
    await page.locator('#login.hidden').waitFor({state:'attached'});await page.locator('#business-details > summary').click();
    await page.locator('#business-details-content details').first().waitFor({state:'attached'});
    stats.hiddenEmployeeRows=await page.locator('#business-details-content details tbody tr').count();
    const first=page.locator('#business-details-content details').first();await first.locator('summary').click();await first.locator('tbody tr').first().waitFor();
    assert.equal(await first.locator('tbody tr').count(),80);
    await page.locator('[data-view="customers"]').click();await page.locator('#refresh-btn').click();await page.waitForTimeout(50);
    stats.unrelatedRefreshCalls=count('ledger_records')+count('import_batches');
    await page.locator('#customer-query').fill('模拟');
    await page.evaluate(()=>{for(let i=0;i<4;i++)document.getElementById('customer-query').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));});
    await page.locator('.result').first().waitFor();stats.concurrentSearchCalls=count('customer_search');stats.firstResultButtons=await page.locator('.result').count();
    if(!baseline){await page.locator('.customer-result-more').click();await page.locator('.customer-result-more').click();assert.equal(await page.locator('.result').count(),60);}
    await page.locator('.result').first().click();await page.locator('#customer-detail details.package').first().waitFor({state:'attached'});
    stats.collapsedArchiveImages=await page.locator('#customer-detail details img').count();
    await page.locator('#customer-detail details.package').first().locator('summary').click();
    if(!baseline){await page.locator('button',{hasText:'重试本份档案'}).click();assert(bodyCalls>=1);}
    await page.locator('#customer-detail details.package').first().locator('img').first().waitFor({state:'attached'});assert.equal(await page.locator('#customer-detail details.package').first().locator('img').count(),2);
    if(!baseline){
      assert.deepEqual(stats,{hiddenEmployeeRows:0,unrelatedRefreshCalls:0,concurrentSearchCalls:1,firstResultButtons:24,collapsedArchiveImages:0});
      assert.equal(bodyCalls,2);const navCounts=[count('customer_detail'),count('customer_search')];await page.locator('[data-view="today"]').click();await page.locator('[data-view="customers"]').click();
      assert.deepEqual([count('customer_detail'),count('customer_search')],navCounts,'immediate return reuses this read-only view');
      assert(await page.locator('#customer-detail details.package').first().evaluate(el=>el.open));
      await page.clock.setFixedTime(new Date(Date.now()+20000));await page.locator('[data-view="today"]').click();
      const reread=page.waitForResponse(res=>res.url().endsWith('/frontdesk-api')&&res.request().postDataJSON().operation==='customer_search');
      await page.locator('[data-view="customers"]').click();await reread;
      assert.equal(calls.filter(c=>c.archive_projection==='outline-v1').length,2);assert.equal(count('customer_search'),navCounts[1]+1);
      block=true;
      await page.locator('#customer-search-btn').click();await started.promise;
      await page.locator('#store-select').selectOption('B');await page.waitForFunction(()=>document.querySelector('.result-name')?.textContent.startsWith('B'));
      late.resolve();await page.waitForTimeout(80);
      assert.match(await page.locator('.result-name').first().textContent(),/^B/);
      assert(!await page.locator('#customer-detail').textContent());assert.equal(await page.locator('#customer-detail img').count(),0);
      const imports=count('import_batches');await page.locator('[data-view="import"]').click();await page.waitForTimeout(50);assert.equal(count('import_batches'),imports);
      await page.locator('#import-tools > summary').click();await page.waitForFunction(()=>document.getElementById('batch-list').textContent.includes('暂无导入记录'));
      assert.equal(count('import_batches'),imports+1);
      await page.locator('#logout-btn').click();await page.locator('#login').waitFor();assert.equal(await page.locator('.result').count(),0);
      assert(!await page.evaluate(()=>JSON.stringify({...localStorage}).includes('合成专享')));
      for(const mismatch of ['customer_search','customer_detail']){
        wrongScope='';block=false;await page.reload();await page.locator('#login-user').fill('synthetic');await page.locator('#login-pass').fill('fixture');await page.locator('#login-btn').click();
        await page.locator('#login.hidden').waitFor({state:'attached'});await page.locator('[data-view="customers"]').click();await page.locator('#customer-query').fill('模拟');
        wrongScope=mismatch;await page.locator('#customer-search-btn').click();if(mismatch==='customer_detail')await page.locator('.result').first().click();
        await page.locator('#frontdesk-scope-message').waitFor();assert.equal(await page.locator('#customer-detail').textContent(),'');assert.equal(await page.locator('.result').count(),0);
        await page.evaluate(()=>localStorage.clear());
      }
    }
    assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);return stats;
  }finally{late.resolve();await page.close();}
}
(async()=>{
  const engine=process.env.FRONTDESK_WEBKIT?'webkit':'chromium',browser=await(engine==='webkit'?webkit:chromium).launch({...(engine==='chromium'&&process.platform==='darwin'?{channel:'chrome'}:{}),headless:true});
  try{const before=process.argv.includes('--compare')?await scenario(browser,true):null,after=await scenario(browser,false);console.log(JSON.stringify({engine,network:'intercepted synthetic reads; counts only, not production timings',before,after}));}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
