#!/usr/bin/env node
/** Full five-stage UI over actual loopback HTTP. Synthetic fixed options only. */
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {startSyntheticDesignService,SYNTHETIC_OPT_IN} from '../packages/design-pilot-service/server.mjs';
import {UI_FIXTURE_TEXT as T} from '../packages/analysis-engine/design-pilot-ui-draft.mjs';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'design-pilot-connected-'));
const shots=process.env.AI_DESIGN_PILOT_SCREENSHOTS||'/tmp/ai-design-pilot-qa';
let service,browser,context,checks=0;
const passed=label=>{checks++;console.log('PASS '+label);};
const errors=[],external=[],requests=[];
const options={optIn:SYNTHETIC_OPT_IN,dataDir:path.join(temp,'store'),port:0,uiRoot:repo};
try{
  service=await startSyntheticDesignService(options);
  browser=await chromium.launch({headless:true});
  context=await browser.newContext({viewport:{width:1280,height:960},permissions:[],serviceWorkers:'block'});
  await context.route('**/*',route=>{
    const url=route.request().url();
    if(url.startsWith(service.url+'/')||url.startsWith('data:')||url.startsWith('blob:'))return route.continue();
    external.push(url);return route.abort();
  });
  await context.addInitScript(()=>{
    window.__boundary={storage:0,microphone:0};
    Storage.prototype.setItem=function(){window.__boundary.storage++;throw new Error('Unexpected browser persistence');};
    if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=()=>{window.__boundary.microphone++;throw new Error('Unexpected microphone use');};
  });
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  context.on('request',request=>{if(request.url().includes('/api/'))requests.push({url:request.url(),headers:request.headers(),body:request.postData()});});
  const page=await context.newPage();
  const url=()=>service.url+'/ai-design-pilot-connected.html';
  const field=(p,on=page)=>on.locator('[data-field="'+p+'"]');
  const action=(key,on=page)=>on.locator('[data-action="'+key+'"]');
  const step=async(n,on=page)=>{await on.locator('.adp-stepper [data-step="'+n+'"]').click();};
  const set=async(p,value,on=page)=>{await field(p,on).selectOption(value);};
  const expand=async key=>{const group=page.locator('[data-process-group="'+key+'"]');if(await group.getAttribute('open')===null)await group.locator(':scope > summary').click();};
  const ready=async(on=page)=>{await on.waitForFunction(()=>{const el=document.querySelector('.adp-connected-bar');return el&&!el.textContent.includes('正在处理')&&!el.textContent.includes('尚未加载');});};
  const save=async(on=page)=>{await action('connected-save',on).click();await ready(on);assert.equal(await on.locator('.adp-connected-error').count(),0,await on.locator('.adp-connected-bar').textContent());assert.match(await on.locator('.adp-notice').textContent(),/已保存到本机/);};
  await page.goto(url());await ready();
  assert.equal(await page.locator('input[type=file],input[type=password],textarea').count(),0);
  assert.match(await page.locator('.adp-safety').first().textContent(),/demo-ui-owner/);
  assert.equal(await page.locator('[data-customer] option').count(),3);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  passed('full UI loads synthetic owner catalogue; no free-text, file, credential or identity-switch fields');

  await action('demo-text').click();await page.locator('[data-action=demo-photos][data-stage=before]').click();
  await action('connected-transcript').click();
  assert.equal(await page.locator('[data-connected-transcript]').textContent(),T.transcript);
  await step(1);await action('analyze').click();
  assert.equal(await field('basic.style').inputValue(),T.style);
  assert.equal(await field('basic.person').inputValue(),'');
  await save();
  const analyzedDraft=JSON.parse(requests.filter(item=>item.url.endsWith('/save')).at(-1).body).draft;
  assert.equal(analyzedDraft.transcript,T.transcript);
  assert.equal(analyzedDraft.analysis.sample,true);
  assert.equal(analyzedDraft.analysis.materialRevision,analyzedDraft.materialRevision);
  const refreshedRead=page.waitForResponse(response=>response.request().method()==='GET'&&response.url().includes('/api/ui-drafts/'));
  await page.reload();await ready();
  const restoredAnalysis=(await (await refreshedRead).json()).uiDraft.draft;
  assert.equal(restoredAnalysis.transcript,T.transcript);
  assert.deepEqual(restoredAnalysis.analysis,analyzedDraft.analysis);
  assert.equal(await field('basic.style').inputValue(),T.style);
  await step(0);assert.equal(await page.locator('[data-connected-transcript]').textContent(),T.transcript);
  await step(1);
  passed('fixed transcript followed by mock analysis saves successfully and both survive a fresh HTTP read');
  await set('basic.style',T.styleB);await page.locator('[data-confirm="basic.style"]').check();
  assert.equal(await page.locator('[data-record="basic.style"] .adp-original').textContent(),T.quote);
  await set('proposal',T.proposal);await page.locator('[data-confirm=proposal]').check();
  await page.locator('[data-phase=proposal]').selectOption('actual');assert.equal(await field('proposal').inputValue(),'');
  await set('proposal',T.proposalB);await page.locator('[data-confirm=proposal]').check();
  await page.locator('[data-phase=proposal]').selectOption('planned');assert.equal(await field('proposal').inputValue(),T.proposal);
  assert.equal(await page.locator('[data-confirm=proposal]').isChecked(),true);
  passed('original-source evidence, fixed mock extraction and independent proposal plan/actual remain functional');

  await step(2);assert.equal(await page.locator('.adp-mannequin').count(),3);assert.equal(await page.locator('[data-zone]').count(),6);
  await page.locator('[data-zone=bottom]').click();await set('zones.bottom.direction','down');
  assert.equal(await page.locator('[data-record="zones.bottom.direction"] .adp-original').textContent(),'向下');
  await page.locator('[data-zone=bangs]').click();
  await page.locator('[data-action=add-zone-group][data-group-type=perm]').click();
  await set('zoneProcesses.bangs.perm.0.placement',T.left);
  await set('zoneProcesses.bangs.perm.0.rods',T.rodA);await set('zoneProcesses.bangs.perm.0.method',T.methodA);
  await set('zoneProcesses.bangs.perm.0.products',T.productA);await set('zoneProcesses.bangs.perm.0.mix',T.formulaA);
  await page.locator('[data-confirm="zoneProcesses.bangs.perm.0.rods"]').check();
  await page.locator('[data-phase="zoneProcesses.bangs.perm.0.rods"]').selectOption('actual');
  assert.equal(await field('zoneProcesses.bangs.perm.0.rods').inputValue(),'');
  await set('zoneProcesses.bangs.perm.0.rods',T.rodB);
  await page.locator('[data-phase="zoneProcesses.bangs.perm.0.rods"]').selectOption('planned');
  assert.equal(await field('zoneProcesses.bangs.perm.0.rods').inputValue(),T.rodA);
  await page.locator('[data-action=add-zone-group][data-group-type=perm]').click();
  await set('zoneProcesses.bangs.perm.1.placement',T.right);await set('zoneProcesses.bangs.perm.1.rods',T.rodB);await set('zoneProcesses.bangs.perm.1.mix',T.formulaB);
  await page.locator('[data-service=perm]').uncheck();assert.equal(await page.locator('[data-zone-process=perm]').isVisible(),false);await page.locator('[data-service=perm]').check();
  assert.equal(await field('zoneProcesses.bangs.perm.0.rods').inputValue(),T.rodA);
  await page.locator('[data-service=dye]').check();await page.locator('[data-action=add-zone-group][data-group-type=dye]').click();
  await set('zoneProcesses.bangs.dye.0.placement',T.left);await set('zoneProcesses.bangs.dye.0.colors',T.colorA);await set('zoneProcesses.bangs.dye.0.ratios',T.formulaA);
  await save();
  passed('six zones, explicit side, multiple rods/formulas, dye separation and hidden service fields save through real HTTP');
  await page.reload();await ready();
  assert.match(await page.locator('.adp-zone-edit > h3').textContent(),/刘海/);
  assert.equal(await field('zoneProcesses.bangs.perm.0.rods').inputValue(),T.rodA);
  assert.equal(await field('zoneProcesses.bangs.perm.1.rods').inputValue(),T.rodB);
  assert.equal(await field('zoneProcesses.bangs.dye.0.colors').inputValue(),T.colorA);
  await expand('bangs-perm-0');
  await page.locator('[data-phase="zoneProcesses.bangs.perm.0.rods"]').selectOption('actual');assert.equal(await field('zoneProcesses.bangs.perm.0.rods').inputValue(),T.rodB);
  await page.locator('[data-phase="zoneProcesses.bangs.perm.0.rods"]').selectOption('planned');
  assert.equal(await page.locator('[data-confirm="zoneProcesses.bangs.perm.0.rods"]').isChecked(),true);
  await save();await expand('bangs-perm-0');
  await fs.mkdir(shots,{recursive:true});await page.screenshot({path:path.join(shots,'pilot-connected-desktop-zones.png'),fullPage:true});
  passed('refresh restores complete structured draft, plan/actual tracks, original source and confirmations');

  await step(0);await action('connected-transcript').click();assert.equal(await page.locator('[data-connected-transcript]').textContent(),T.transcript);
  await step(3);await page.locator('[data-action=demo-photos][data-stage=after]').click();
  await set('care',T.care);await set('review.achieved',T.achieved);await page.locator('[data-confirm="review.achieved"]').check();
  await action('compare').click();assert.equal(await page.locator('.adp-comparison-grid img').count(),2);
  await step(4);await save();await action('archive').click();await ready();
  assert.match(await page.locator('.adp-connected-bar strong').textContent(),/已归档/);
  assert.equal(await page.locator('[data-revision]').count(),1);
  await page.locator('[data-revision="1"] > summary').click();const originalArchive=await page.locator('[data-revision="1"] .adp-revision-body').textContent();
  assert.match(originalArchive,/虚构杠具A/);assert.match(originalArchive,/虚构杠具B/);assert.match(originalArchive,/模拟口述/);
  await step(2);assert.equal(await field('zones.bangs.goal').isDisabled(),true);await step(4);
  await page.screenshot({path:path.join(shots,'pilot-connected-desktop-archive.png'),fullPage:true});
  passed('fixed transcript, synthetic photo markers, completed review and immutable local archive use the same full UI');

  await action('connected-reopen').click();await ready();await step(1);await set('basic.style',T.style);await step(4);await save();await action('archive').click();await ready();
  assert.equal(await page.locator('[data-revision]').count(),2);await page.locator('[data-revision="1"] > summary').click();
  assert.equal(await page.locator('[data-revision="1"] .adp-revision-body').textContent(),originalArchive);
  passed('explicit reopen enables new revision while preserving original archive contents exactly');

  const port=Number(new URL(service.url).port);await service.close();service=await startSyntheticDesignService({...options,port});
  await page.reload();await ready();await step(4);assert.equal(await page.locator('[data-revision]').count(),2);
  await step(3);assert.equal(await page.locator('.adp-photo-strip img').count(),3);
  assert.equal(await field('care').inputValue(),T.care);
  passed('normal server restart restores archives, review and regenerated built-in photo previews');

  await action('connected-reopen').click();await ready();await step(1);
  const second=await context.newPage();await second.goto(url());await ready(second);await step(1,second);
  await set('basic.style',T.styleB);await save();
  await set('basic.style',T.style,second);await action('connected-save',second).click();await ready(second);
  assert.match(await second.locator('.adp-connected-error').textContent(),/版本冲突/);
  assert.equal(await field('basic.style',second).inputValue(),T.style);
  await action('connected-load',second).click();assert.equal(await field('basic.style',second).inputValue(),T.style);
  await second.locator('[data-action=connected-load]').last().click();await ready(second);
  assert.equal(await field('basic.style',second).inputValue(),T.styleB);
  await second.close();
  passed('two-window revision conflict preserves local selections until explicit reread/discard confirmation');

  let lost=false;
  await page.route('**/api/ui-drafts/*/save',async route=>{if(!lost){lost=true;await route.fetch();await route.abort('failed');}else await route.continue();});
  await set('basic.style',T.style);const beforeLost=requests.length;await action('connected-save').click();await ready();
  assert.match(await page.locator('.adp-connected-error').textContent(),/请求未完成/);assert.equal(await field('basic.style').inputValue(),T.style);
  await action('connected-retry').click();await ready();assert.equal(await page.locator('.adp-connected-error').count(),0);
  const lostRequests=requests.slice(beforeLost).filter(item=>item.url.endsWith('/save')).map(item=>JSON.parse(item.body));
  assert.equal(lostRequests.length,2);assert.equal(lostRequests[0].requestId,lostRequests[1].requestId);assert.deepEqual(lostRequests[0],lostRequests[1]);
  await page.unroute('**/api/ui-drafts/*/save');
  passed('lost response after durable commit retries the identical request without losing input or duplicating save');

  let release,markStarted;const held=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{markStarted=resolve;});let intercept=true;
  await page.route('**/api/ui-drafts/*',async route=>{if(intercept&&route.request().method()==='GET'){intercept=false;markStarted();await held;}await route.continue();});
  await page.locator('[data-customer]').selectOption('demo-booking-b');
  await started;
  await page.locator('[data-customer]').selectOption('demo-walk-in');await ready();
  assert.match(await page.locator('.adp-customer-detail').textContent(),/散客/);release();
  await page.waitForTimeout(80);assert.equal(await page.locator('[data-customer]').inputValue(),'demo-walk-in');
  assert.equal(await page.locator('[data-connected-text]').textContent(),'尚未载入固定示例');
  await page.unroute('**/api/ui-drafts/*');
  await page.locator('[data-customer]').selectOption('demo-booking-a');await ready();await step(1);assert.equal(await field('basic.style').inputValue(),T.style);
  passed('delayed customer read never replaces current customer; each customer retains isolated full draft');

  await page.setViewportSize({width:390,height:844});
  for(let index=0;index<5;index++){await step(index);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile overflow at step '+index);}
  await step(2);await page.locator('[data-zone=bangs]').click();await expand('bangs-perm-0');
  await page.screenshot({path:path.join(shots,'pilot-connected-mobile-zones.png'),fullPage:true});
  await step(4);await save();await page.screenshot({path:path.join(shots,'pilot-connected-mobile-save.png'),fullPage:true});
  passed('390px full workflow has no horizontal overflow; desktop/mobile zone and archive screenshots captured');

  for(const request of requests){
    assert.equal(request.headers['x-design-pilot-actor'],'demo-ui-owner');
    if(request.body){const body=JSON.parse(request.body);if(body.draft){assert.equal(body.draft.synthetic,true);assert.ok(!/data:|blob:|"url"|"file"|"syntheticConsent"/.test(request.body));for(const photos of Object.values(body.draft.photos))for(const photo of photos)assert.deepEqual(Object.keys(photo).sort(),['angle','id','kind']);}}
  }
  assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
  assert.deepEqual(await page.evaluate(()=>window.__boundary),{storage:0,microphone:0});
  passed('all customer calls keep one synthetic owner; no external calls, photo bytes/URLs, localStorage or microphone');
  console.log('\n'+checks+' full connected UI checks passed.');
}finally{
  if(context)await context.close();if(browser)await browser.close();if(service)await service.close();await fs.rm(temp,{recursive:true,force:true});
}
