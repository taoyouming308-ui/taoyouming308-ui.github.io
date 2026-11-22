/** Actual candidate entry/loader/modules. All requests intercepted; no identity,
 * account, database or model is supplied. Failure must preserve unrelated input. */
import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';import {chromium} from 'playwright';
const root=fileURLToPath(new URL('../',import.meta.url)),origin='https://lazy.synthetic.invalid';
const source=await readFile(root+'perm-app.html','utf8');assert(/<script defer src="ai-design-entry\.js\?v=\d+"><\/script>/.test(source));assert(!source.includes('src="packages/design-prepared-ui/app-entry.mjs'));
const start=source.indexOf('<a id="ai-design-prepared-entry"'),end=source.indexOf('</a>',start)+4;assert(start>0&&end>start);
const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><input id="unrelated-input"><button id="booking-action">原预约入口</button>${source.slice(start,end)}<script>window.__hostReads=0;window.PreparedDesignHost={readSession(){window.__hostReads++;throw Error('MUST_NOT_READ_IDENTITY');}};document.getElementById('booking-action').onclick=()=>window.__bookingClicked=true;</script><script defer src="/ai-design-entry.js"></script>`;
const browser=await chromium.launch({headless:true});let passed=0;
try{
 for(const deny of [true,false]){
  const ctx=await browser.newContext({viewport:{width:390,height:844}}),modules=[],external=[],errors=[];
  await ctx.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==origin||u.pathname.startsWith('/api/')){external.push(u.pathname);return route.abort();}if(u.pathname==='/home')return route.fulfill({contentType:'text/html',body:html});
   if(u.pathname.endsWith('.mjs')){modules.push(u.pathname);if(deny)return route.abort();}
   if(!/^\/(?:ai-design-entry\.js|ai-design-(?:prepared\.mjs|prepared\.css|pilot\.css)|packages\/[a-z0-9-]+\/[a-z0-9-]+\.mjs)$/.test(u.pathname))return route.fulfill({status:404,body:''});
   return route.fulfill({contentType:u.pathname.endsWith('.css')?'text/css':'text/javascript',body:await readFile(root+u.pathname.slice(1))});
  });
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/home');await page.locator('#unrelated-input').fill('保留未提交内容');assert.deepEqual(modules,[]);assert.equal(await page.evaluate(()=>window.__hostReads),0);assert.equal(await page.evaluate(()=>typeof window.PreparedDesignApp),'undefined');
  if(!deny){passed++;console.log('PASS homepage loads no design module graph or identity before explicit click');}
  await page.locator('#ai-design-prepared-entry').click();
  if(deny){await page.locator('[data-design-entry-status]').getByText('打开独立设计入口',{exact:true}).waitFor();assert.equal(await page.locator('[data-design-entry-status] a').getAttribute('target'),'_blank');assert.equal(await page.locator('.apw-app-modal').count(),0);passed++;console.log('PASS failed optional module preserves unrelated input and separate fallback without unhandled errors');}
  else{await page.getByText('默认关闭：',{exact:false}).waitFor();assert(modules.length>0);assert.equal(await page.locator('.apw-app-modal').count(),1);await page.locator('[data-prepared-close]').click();await page.locator('#ai-design-prepared-entry').click();assert.equal(await page.locator('.apw-app-modal').count(),1);await page.locator('[data-prepared-close]').click();passed++;console.log('PASS first click loads original disabled UI; later clicks use one bridge without duplicate modal');}
  await page.locator('#booking-action').click();assert.equal(await page.evaluate(()=>window.__bookingClicked),true);assert.equal(await page.locator('#unrelated-input').inputValue(),'保留未提交内容');assert.equal(await page.evaluate(()=>window.__hostReads),0);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);await ctx.close();
 }
 console.log(JSON.stringify({passed,modelsEnabled:false,actualEmployeeData:false,physicalIPhone:false}));
}finally{await browser.close();}
