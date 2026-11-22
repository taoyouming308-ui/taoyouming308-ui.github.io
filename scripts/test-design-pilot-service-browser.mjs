/* Actual local synthetic HTTP service + fresh browser; never signed-in or external. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startSyntheticDesignService, SYNTHETIC_OPT_IN } from '../packages/design-pilot-service/server.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = await mkdtemp(path.join(tmpdir(), 'design-service-browser-'));
let server, browser, checks = 0;
const pass = name => { checks++; console.log('PASS '+name); };
try {
  server = await startSyntheticDesignService({optIn:SYNTHETIC_OPT_IN,dataDir:dir,port:0,uiRoot:root});
  let base = server.url;
  browser = await chromium.launch({headless:true});
  const context = await browser.newContext({viewport:{width:390,height:844},permissions:[],serviceWorkers:'block'});
  const external=[],errors=[];
  await context.route('**/*',route=>{
    if(route.request().url().startsWith(base+'/')) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  await context.addInitScript(()=>{
    window.__blocked={storage:0,mic:0};
    Storage.prototype.setItem=function(){window.__blocked.storage++;throw new Error('No browser persistence');};
    if(navigator.mediaDevices) navigator.mediaDevices.getUserMedia=()=>{window.__blocked.mic++;throw new Error('No microphone');};
  });
  const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
  async function settled(){await page.waitForFunction(()=>!document.querySelector('#open').disabled);assert.doesNotMatch(await page.locator('#status').innerText(),/^未完成/);}
  async function click(id){await page.locator('#'+id).click();await settled();}
  const data=async()=>JSON.parse(await page.locator('#result').textContent());
  await page.goto(base+'/ai-design-pilot-service-test.html');await settled();
  assert.equal(await page.locator('input,textarea').count(),0);
  assert.match(await page.locator('body').innerText(),/不是云档案/);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  pass('mobile synthetic-only page has no real-data/credential inputs or overflow');
  await click('open');assert.equal((await data()).session.revision,0);
  await click('source');assert.equal((await data()).session.sources.length,1);
  assert.match((await data()).session.sources[0].text,/^【合成测试】/);
  pass('fixed source is persisted through actual HTTP contract');
  await click('phase');await click('groups');
  const entries=(await data()).session.entries;
  assert.equal(entries.length,3);assert.deepEqual(entries.map(e=>[e.side,e.value]),[['left',18],['right',20],['left',22]]);
  assert(entries.every(e=>e.track==='planned'&&e.status==='not_confirmed'));
  pass('three same-zone groups preserve side, values and unconfirmed plan through HTTP');
  for(let n=0;n<3;n++) await click('phase');
  await click('archive'); const original=JSON.stringify((await data()).archives);
  assert.equal((await data()).archives.length,1);
  await click('archive');assert.equal(JSON.stringify((await data()).archives),original);
  pass('archive exact retry is idempotent');
  await page.reload();await settled();await click('open');
  assert.equal(JSON.stringify((await data()).archives),original);
  pass('reload restores durable session, not browser storage');
  await server.close();
  server=await startSyntheticDesignService({optIn:SYNTHETIC_OPT_IN,dataDir:dir,port:0,uiRoot:root});base=server.url;
  await page.goto(base+'/ai-design-pilot-service-test.html');await settled();await click('open');
  assert.equal(JSON.stringify((await data()).archives),original);
  pass('server restart restores immutable archive from isolated test directory');
  await click('revision');assert.equal((await data()).session.phase,'completed_review');
  assert.equal(JSON.stringify((await data()).archives),original);
  await click('phase');await click('archive');
  const revised=await data();assert.equal(revised.archives.length,2);
  assert.equal(JSON.stringify([revised.archives[0]]),original);
  assert.equal(revised.archives[1].archive.previousArchiveRevision,revised.archives[0].archive.revision);
  pass('post-archive revision links parent and preserves prior archive byte-for-byte');
  if(process.env.AI_DESIGN_PILOT_SCREENSHOTS){
    await mkdir(process.env.AI_DESIGN_PILOT_SCREENSHOTS,{recursive:true});
    await page.screenshot({path:path.join(process.env.AI_DESIGN_PILOT_SCREENSHOTS,'pilot-service-mobile.png')});
  }
  await page.locator('#actor').selectOption('demo-stylist-b');
  assert.deepEqual(await data(),{});
  await click('open');assert.equal((await data()).session.scope.customerId,'demo-customer-b');
  assert.equal((await data()).session.sources.length,0);assert.equal((await data()).archives.length,0);
  pass('identity switch clears state and selects independent scoped customer');
  const denied=await page.evaluate(async()=>{const r=await fetch('/api/sessions/demo-ui-session-a',{headers:{'X-Design-Pilot-Actor':'demo-stylist-b'}});return r.status;});
  assert([403,404].includes(denied));
  pass('foreign session request is rejected by actual server');
  await page.setViewportSize({width:1280,height:900});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  assert.deepEqual(await page.evaluate(()=>window.__blocked),{storage:0,mic:0});
  pass('desktop layout, no external traffic, microphone, browser storage or page errors');
  console.log(`${checks} local-service browser checks passed`);
} finally {
  await browser?.close(); await server?.close(); await rm(dir,{recursive:true,force:true});
}
