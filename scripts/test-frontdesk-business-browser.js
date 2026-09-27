const assert=require('node:assert/strict'),{chromium}=require('playwright'),{execFileSync}=require('node:child_process');
(async()=>{
 const {projectBusinessDay}=await import('../supabase/functions/_shared/frontdesk-business-domain.mjs');
 const bill=JSON.parse(execFileSync('/usr/bin/python3',['-c','import json;from scripts.test_mgj_business_detail import normalized;print(json.dumps(normalized()))'],{encoding:'utf8'}));
 const data=projectBusinessDay({available:true,shop:'向里造型',date:'2026-01-01',source_count:1,source_list_changed:false,bills:[bill]});
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  await page.setContent('<details class="card business-details" id="business-details"><summary>员工业绩与付款明细</summary><div id="business-details-content"></div></details>');
  await page.addStyleTag({path:'frontdesk-minimal.css'});
  await page.addScriptTag({path:'frontdesk-business-details.js'});
  await page.evaluate(value=>{window.testData=value;window.testScope={session:'fixture',store:'向里造型',date:'2026-01-01'};window.FrontdeskBusinessDetails.init({api:async()=>window.testData,scope:()=>({...window.testScope})});},data);
  await page.locator('#business-details>summary').click();
  await page.waitForFunction(()=>document.getElementById('business-details-content').textContent.includes('TEST_STYLIST'));
  assert.match(await page.locator('#business-details-content').innerText(),/TEST_TECH/);
  assert.match(await page.locator('#business-details-content').innerText(),/待补齐/);
  await page.locator('.business-columns details').first().locator('summary').click();
  assert.match(await page.locator('.business-columns').innerText(),/剪发/);
  for(const width of [1280,768,390]){await page.setViewportSize({width,height:800});assert(await page.locator('#business-details').evaluate(el=>el.getBoundingClientRect().width<=innerWidth));}
  await page.evaluate(()=>{window.FrontdeskBusinessDetails.init({api:()=>new Promise(resolve=>window.lateResolve=resolve),scope:()=>({...window.testScope})});window.FrontdeskBusinessDetails.refresh();});
  await page.evaluate(()=>{window.testScope.store='自由手艺人';window.lateResolve(window.testData);});
  await page.waitForTimeout(30);assert.doesNotMatch(await page.locator('#business-details-content').innerText(),/TEST_STYLIST/);
  await page.evaluate(()=>window.FrontdeskBusinessDetails.clear());
  assert.equal(await page.locator('#business-details-content').innerText(),'');
  assert.equal(await page.locator('#business-details').evaluate(el=>el.open),false);
  console.log('Business browser: staff/item/payment display, mobile widths, stale scope rejection and logout clearing passed');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
