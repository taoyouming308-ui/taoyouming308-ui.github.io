// Actual customer-modal functions/styles, synthetic data and blocked external network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const source = fs.readFileSync('perm-app.html','utf8');
const styles = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(x=>x[1]).join('\n');
const modal = source.slice(source.indexOf('window.showPlanModal = function'), source.indexOf('function hairRecordPersonText(rec)'));
const archives = source.slice(source.indexOf('function parseHairArrayField(value)'), source.indexOf('function fetchCareRecordsByHairIds(ids)'));
let browser;
(async()=>{
  browser = await chromium.launch({...(process.platform==='darwin'?{channel:'chrome'}:{}),headless:true});
  for (const width of [320,390,768]) {
    const page = await browser.newPage({viewport:{width,height:844}});
    await page.route('**/*', route=>route.abort());
    await page.setContent('<!doctype html><html><head><style>'+styles+'</style></head><body class="plan-white-mode"><button id="customer" onclick="showPlanModal(\'13800000000\',\'合成客户\')">合成客户</button></body></html>');
    await page.addScriptTag({content:modal+'\n'+archives});
    await page.evaluate(()=>{
      window.esc = value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      window.renderAiButton = ()=>'';
      window.renderHairRecordReadOnly = ()=>'';
      window.updateAiButtonsAvailability = ()=>{};
      window.renderCustomerHistory = ()=>{};
      window.AUTHENTICATED_STAFF = {session_token:'fixture',store:'自由手艺人'};
      window.BARBER_SPECIALTIES = {};
      window.getLocalDateStr = ()=>'2026-09-27';
      window.mode = 'cloud';
      window.fetch = async()=>({ok:true,json:async()=>window.mode==='local'?{name:'合成客户',plan_text:'fixture'}:{error:'local unavailable'}});
      window.fixture = [{summary_scope:'synced_store_records',total_visits:7,total_consumption:300,last_visit_date:'2026-09-27 13:02',
        card_packages:[{id:'p1',name:'剪发280',package_name:'设计总监五次剪发卡',left:4,total:5,shop:'自由手艺人'}],
        service_history:Array.from({length:7},(_,i)=>({id:'b'+i,date:'2026-09-'+(20+i),amount:i?50:0,items:[{name:'洗剪吹'}],staff:['合成员工'],shop:'自由手艺人'}))}];
      window.fixture[0].card_packages.push({id:'p2',name:'异店护理',left:2,total:3,shop:'向里造型'});
      window.fetchCustomerProfileRows = async(phone,name,limit,scope)=>window.mode==='empty'?[]:window.fixture.map(row=>({...row,card_packages:row.card_packages.filter(pkg=>scope==='all'||pkg.shop==='自由手艺人')}));
      window.employeeBookingsApi = async()=>({bookings:[{date:'2026-09-01',barber_name:'合成员工'}]});
    });
    assert.deepEqual(await page.evaluate(()=>[
      hairArchiveStoreForSave(null,false),hairArchiveStoreForSave({},true),hairArchiveStoreForSave({shopName:'向里造型'},true)
    ]),['自由手艺人','','向里造型'],'new archives record current store; editing old archives never guesses/reassigns their store');
    for(const mode of ['cloud','local','empty']) {
      await page.evaluate(value=>{window.mode=value;window._customerReadScope='all';window.closePlanModal();},mode);
      await page.click('#customer');
      await page.locator('.hair-archive-title').filter({hasText:'消费记录'}).waitFor();
      const text = await page.locator('#plan-modal').innerText();
      assert(text.includes('套餐详情'));
      if(mode==='empty') {
        assert(text.includes('历史预约') && text.includes('尚未同步') && !text.includes('历史到店'));
      } else {
        assert(text.includes('设计总监五次剪发卡') && text.includes('剩4/5次') && text.includes('已同步 7 笔消费'));
        await page.locator('#plan-modal details summary').click();
        assert.equal(await page.locator('#plan-modal details').getAttribute('open'),'');
        assert(await page.locator('#plan-modal details').innerText().then(x=>x.includes('2026-09-20')));
      }
      const layout=await page.locator('#plan-modal .box').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,right:el.getBoundingClientRect().right}));
      assert(layout.scroll<=layout.width+1 && layout.right<=width+1, 'modal must fit viewport '+width);
      assert.equal(await page.locator('#plan-modal .box').evaluate(el=>getComputedStyle(el).getPropertyValue('--text').trim()), '#111', 'white modal must use readable dark text');
      if(mode!=='empty') assert.equal(await page.locator('#plan-modal .hair-archive-body td').first().evaluate(el=>getComputedStyle(el).color), 'rgb(25, 25, 24)', 'package title must have readable contrast');
      if(width===390 && mode==='cloud') await page.screenshot({path:path.join(os.tmpdir(),'customer-profile-modal.png')});
      if(mode!=='empty') {
        assert((await page.locator('#plan-modal').innerText()).includes('异店护理'));
        await page.locator('.customer-read-scope').selectOption('store');
        await page.locator('.hair-archive-title').filter({hasText:'消费记录'}).waitFor();
        assert(!(await page.locator('#plan-modal').innerText()).includes('异店护理'));
        assert.equal(await page.locator('.customer-read-scope').inputValue(),'store');
      }
    }
    await page.close();
  }
  console.log('customer modal browser tests passed: 3 widths x cloud/local/no-profile branches, expandable history');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();});
