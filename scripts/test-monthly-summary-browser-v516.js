const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req,res) => {
  const file = path.resolve(root,'.' + new URL(req.url,'http://localhost').pathname);
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  fs.readFile(file,(e,bytes) => { if(e)return res.writeHead(404).end(); res.setHeader('Content-Type',file.endsWith('.html')?'text/html':'application/javascript');res.end(bytes); });
});
let browser;
(async () => {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:900}}), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await page.goto(origin+'/operations.html?preview=1&role=finance');
  await page.locator('#monthly-edit-toggle').waitFor();
  assert.equal(await page.evaluate(()=>window.ZysyrMonthlySummary),undefined,'disabled monthly summary must not load in production');
  assert.equal(await page.locator('#monthly-more').isVisible(),false,'multi-month summary entry is closed in production');
  await page.addScriptTag({path:path.join(root,'operations-monthly-summary.js')});
  assert.equal(await page.locator('#monthly-summary-toggle').isDisabled(),true,'closed summary control cannot be activated accidentally');
  await page.evaluate(()=>{
    const summaryMore=document.getElementById('monthly-more');
    summaryMore.hidden=false;summaryMore.classList.remove('hidden');summaryMore.removeAttribute('aria-hidden');
    document.getElementById('monthly-summary-toggle').disabled=false;
    window.singleFixture=JSON.parse(JSON.stringify(state.data));
    isLocalPreview=()=>false;
    document.getElementById('month').value='2026-06';
    window.calls=[];window.mode='ok';window.delayNext=false;
    api=async(operation,payload)=>{
      calls.push({operation,...payload});
      if(operation==='overview')return JSON.parse(JSON.stringify(singleFixture));
      if(operation!=='monthly_summary')throw Error('Unexpected write: '+operation);
      const response={months:['2026-04','2026-06'],requested_months:['2026-04','2026-05','2026-06'],missing_months:['2026-05'],
        lines:[{label:payload.store+' / 美发收入',address:'C3',amounts:{'2026-04':100,'2026-06':200},total:300}]};
      if(delayNext){delayNext=false;await new Promise(resolve=>window.releaseSummary=resolve);}
      if(mode==='fail')throw Error('网络暂时不可用');
      if(mode==='empty')return {months:[],requested_months:response.requested_months,missing_months:response.requested_months,lines:[]};
      return response;
    };
  });
  await page.locator('#monthly-more summary').click();
  await page.locator('#monthly-summary-toggle').click();
  await page.locator('.monthly-summary-table').waitFor();
  const first=await page.evaluate(()=>calls.find(call=>call.operation==='monthly_summary'));
  assert.equal(first.start_month,'2026-04');assert.equal(first.end_month,'2026-06','preset follows selected month');
  assert.equal(await page.locator('#monthly-sheet').isVisible(),false);
  assert.equal(await page.locator('#monthly-edit-toggle').isVisible(),false,'summary cannot edit underlying month');
  assert.match(await page.locator('#monthly-summary-output').innerText(),/缺少月报：2026-05/);
  assert.match(await page.locator('#monthly-summary-output').innerText(),/300\.00/);
  await page.locator('#monthly-summary-preset').selectOption('custom');
  await page.locator('#monthly-summary-start').fill('2026-01');
  await page.locator('#monthly-summary-end').fill('2026-06');
  await page.locator('#monthly-summary-apply').click();
  assert.equal(await page.evaluate(()=>calls.at(-1).start_month),'2026-01');
  // Close and reopen a custom range (previously dereferenced null).
  await page.locator('#monthly-summary-toggle').click();
  assert.equal(await page.locator('#monthly-sheet').isVisible(),true);
  await page.locator('#monthly-summary-toggle').click();
  await page.locator('.monthly-summary-table').waitFor();
  await page.locator('#refresh').click();
  assert.equal(await page.evaluate(()=>calls.at(-1).operation),'monthly_summary','refresh keeps summary mode');
  // Scope race: a slower prior store cannot replace the new store's result.
  await page.evaluate(()=>{delayNext=true;ZysyrMonthlySummary.refresh();});
  await page.waitForFunction(()=>typeof releaseSummary==='function');
  await page.evaluate(()=>{
    const select=document.getElementById('store-select');const option=document.createElement('option');option.value='隔离乙店';option.textContent='隔离乙店';select.appendChild(option);select.value='隔离乙店';select.dispatchEvent(new Event('change'));
  });
  await page.waitForFunction(()=>document.getElementById('monthly-summary-output').innerText.includes('隔离乙店 / 美发收入'));
  await page.evaluate(()=>releaseSummary());
  assert.match(await page.locator('#monthly-summary-output').innerText(),/隔离乙店 \/ 美发收入/);
  // Changing the store in a different view must invalidate the cached summary.
  await page.evaluate(()=>{
    state.view='archive';
    const select=document.getElementById('store-select');select.value=select.options[0].value;
    select.dispatchEvent(new Event('change'));
  });
  assert(!/隔离乙店 \/ 美发收入/.test(await page.locator('#monthly-summary-output').innerText()));
  await page.evaluate(()=>showView('monthly'));
  await page.locator('.monthly-summary-table').waitFor();
  await page.evaluate(async()=>{mode='empty';await ZysyrMonthlySummary.refresh();});
  assert.equal(await page.locator('.monthly-summary-table').count(),0,'no stale single month or prior summary');
  assert.match(await page.locator('#monthly-summary-output').innerText(),/暂无可汇总/);
  await page.evaluate(async()=>{mode='fail';await ZysyrMonthlySummary.refresh();});
  assert.match(await page.locator('#monthly-summary-output').innerText(),/汇总未完成/);
  await page.evaluate(()=>mode='ok');
  await page.locator('#monthly-summary-retry').click();
  await page.locator('.monthly-summary-table').waitFor();
  // Closing while a read is in flight never puts a summary back over single month.
  await page.evaluate(()=>{delayNext=true;ZysyrMonthlySummary.refresh();});
  await page.locator('#monthly-summary-toggle').click();
  await page.evaluate(()=>releaseSummary());
  assert.equal(await page.locator('#monthly-summary-output').isVisible(),false);
  await page.evaluate(()=>state.monthlyDirty={C3:{address:'C3',amount:123}});
  await page.locator('#monthly-summary-toggle').click();
  assert.equal(await page.evaluate(()=>state.monthlySummary.active),false,'unsaved finance edits retained');
  assert.equal(await page.evaluate(()=>state.monthlyDirty.C3.amount),123);
  await page.evaluate(()=>{state.monthlyDirty={};state.user.role='shareholder';state.user.can_upload_reports=false;state.user.can_adjust_confirmed_finance=false;refreshRoleEntries();});
  await page.locator('#monthly-summary-toggle').click();
  await page.locator('.monthly-summary-table').waitFor();
  await page.evaluate(()=>{
    const original=api;
    api=async(operation,payload)=>{
      const result=await original(operation,payload);
      if(operation==='monthly_summary'){
        result.requested_months=Array.from({length:12},(_,i)=>'2026-'+String(i+1).padStart(2,'0'));
        result.months=result.requested_months;result.missing_months=[];
      }
      return result;
    };
  });
  await page.locator('#monthly-summary-preset').selectOption('year');
  await page.waitForFunction(()=>document.querySelectorAll('.monthly-summary-table thead th').length===14);
  await page.locator('#monthly-more summary').click();
  for(const size of [{width:390,height:844},{width:844,height:390},{width:1024,height:768},{width:1440,height:900}]){
    await page.setViewportSize(size);
    await page.evaluate(()=>ZysyrReportFit.apply());
    assert.equal(await page.locator('.monthly-summary-table').isVisible(),true);
    const overflow=await page.locator('#monthly-summary-output .sheet-scroll').evaluate(el=>el.scrollWidth-el.clientWidth);
    assert(overflow<=2,JSON.stringify(size)+' summary fits width: '+overflow);
    assert.equal(await page.locator('#monthly-edit-toggle').isVisible(),false);
  }
  assert.deepEqual(errors,[]);
  assert((await page.evaluate(()=>calls)).every(call=>['overview','monthly_summary'].includes(call.operation)));
  console.log('Monthly summary browser: production entry closed; retained internal summary regression passed');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.close();});
