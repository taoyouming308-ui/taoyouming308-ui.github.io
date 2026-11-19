import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const url=new URL('../packages/design-production-adapter/demo/normalized-synthetic-demo.html',import.meta.url),html=readFileSync(url,'utf8');
for(const [tag,directive] of [['script','script-src'],['style','style-src']]){const text=html.match(new RegExp('<'+tag+'>([\\s\\S]*?)</'+tag+'>'))[1],hash=createHash('sha256').update(text).digest('base64');assert(html.includes(directive+" 'sha256-"+hash+"'"));}
assert(html.includes("connect-src 'none'"));assert(html.includes("form-action 'none'"));assert.equal((html.match(/data:image\/png;base64,/g)||[]).length,2);assert(!/<(?:form|iframe|input|link)\b/.test(html));assert(!/https?:\/\/|fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|\/Users\/|objectReceipt|credential/.test(html));
console.log('PASS static: CSP hashes, two embedded synthetic images, no network/storage/input/locator');
if(process.argv.includes('--browser')){
 const {chromium}=await import('playwright');let browser;
 const directory=new URL('../../ai-design-pilot-evidence/stage35/',import.meta.url);mkdirSync(directory,{recursive:true});
 try{browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1080,height:900}}),page=await context.newPage(),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));await context.route('**/*',route=>{if(route.request().url()===url.href)return route.continue();requests.push(route.request().url());return route.abort();});
 await page.goto(url.href);assert.equal(await page.locator('img').evaluateAll(xs=>xs.every(x=>x.complete&&x.naturalWidth>0)),true);
 for(const [id,text] of [['generate','未采纳 / 未确认'],['adopt','仍未确认'],['confirm','尚未归档'],['archive','仅当前页面内存']]){await page.locator('#'+id).click();assert((await page.locator('#state').textContent()).includes(text));}
 await page.screenshot({path:new URL('normalized-demo-desktop.png',directory).pathname,fullPage:true});await page.locator('#reset').click();assert((await page.locator('#state').textContent()).includes('尚未生成'));
 await page.locator('#generate').click();await page.reload();assert((await page.locator('#state').textContent()).includes('尚未生成'));
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:new URL('normalized-demo-mobile-layout.png',directory).pathname,fullPage:true});
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);await context.close();console.log('PASS browser: file URL, images, four separate actions, reset/reload, mobile layout, zero network requests');
 }finally{await browser?.close();console.log('BROWSER_CLEANUP complete; no server/container started');}
}
