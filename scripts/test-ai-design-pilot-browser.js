#!/usr/bin/env node
'use strict';

/* Isolated synthetic-only browser checks. No signed-in profile or live endpoint. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const allowed=new Set(['ai-design-pilot.html','ai-design-pilot.js','ai-design-pilot.css']);
const MIME={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8'};
const screenshotDir=process.env.AI_DESIGN_PILOT_SCREENSHOTS||'';
let checks=0;
function pass(name){checks++;console.log('PASS '+name);}
const server=http.createServer((req,res)=>{
  const filename=new URL(req.url,'http://localhost').pathname.slice(1);
  if(!allowed.has(filename)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',MIME[filename.split('.').pop()]);res.end(fs.readFileSync(path.join(root,filename)));
});

(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:960},permissions:[],serviceWorkers:'block'});
  const external=[], errors=[];
  await context.route('**/*',route=>{
    const url=route.request().url();
    if(url.startsWith(base+'/')||url.startsWith('data:')||url.startsWith('blob:'))return route.continue();
    external.push(url);return route.abort();
  });
  await context.addInitScript(()=>{
    window.__pilotCalls={network:0,storage:0,microphone:0,revoked:0};
    window.fetch=()=>{window.__pilotCalls.network++;throw new Error('No API allowed in pilot');};
    XMLHttpRequest.prototype.open=function(){window.__pilotCalls.network++;throw new Error('No XHR allowed in pilot');};
    Storage.prototype.setItem=function(){window.__pilotCalls.storage++;throw new Error('No persistence allowed in pilot');};
    if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=()=>{window.__pilotCalls.microphone++;throw new Error('No microphone allowed');};
    const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>{window.__pilotCalls.revoked++;return revoke(url);};
  });
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  const field=p=>page.locator('[data-field="'+p+'"]');
  const step=async n=>{await page.locator('.adp-stepper [data-step="'+n+'"]').click();};
  const action=async a=>{await page.locator('[data-action="'+a+'"]').click();};
  const customer=async id=>{await page.locator('[data-customer]').selectOption(id);};
  async function edit(p,text){await field(p).fill(text);await field(p).blur();}
  try {
    await page.goto(base+'/ai-design-pilot.html');
    assert.match(await page.locator('.adp-mode').innerText(),/本人试用/);
    assert.equal(await page.locator('[data-customer] option').count(),3);
    assert.equal(await page.locator('input[type=password],input[type=email],input[type=tel]').count(),0);
    assert.equal(await page.locator('[data-file-stage]:disabled').count(),3);
    pass('standalone mode, three synthetic customers, no credential/identity entry, gated local photos');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    if(screenshotDir){fs.mkdirSync(screenshotDir,{recursive:true});await page.screenshot({path:path.join(screenshotDir,'pilot-desktop-intake.png'),fullPage:true});}
    pass('1280px desktop layout has no horizontal overflow');

    await page.locator('[data-text=text]').fill('只记录这段人工输入，不自行推断参数。');
    await action('demo-text');
    assert.equal(await page.locator('[data-text=text]').inputValue(),'只记录这段人工输入，不自行推断参数。');
    await step(1);await action('analyze');
    assert.equal(await field('basic.style').inputValue(),'');
    assert.match(await page.locator('.adp-notice').innerText(),/未被自动分析/);
    pass('free text stays raw and demo refuses to overwrite existing input');
    await edit('basic.person','人工记录初稿');
    await page.locator('[data-confirm="basic.person"]').check();
    await edit('basic.person','人工修订稿');
    assert.equal(await page.locator('[data-confirm="basic.person"]').isChecked(),false);
    assert.equal(await page.locator('[data-record="basic.person"] .adp-original').textContent(),'人工记录初稿');
    assert.match(await page.locator('[data-record="basic.person"] summary').innerText(),/当前值已修改/);
    pass('manual field preserves first completed input; later edit clears confirmation and marks changed evidence');
    assert.equal(await page.locator('[data-phase^="basic."]').count(),0);
    assert.match(await page.locator('[data-record="basic.person"]').innerText(),/观察 \/ 意向记录/);
    await edit('proposal','计划 A');
    await page.locator('[data-confirm=proposal]').check();
    await page.locator('[data-phase=proposal]').selectOption('actual');
    assert.equal(await field('proposal').inputValue(),'');
    assert.equal(await page.locator('[data-confirm=proposal]').isChecked(),false);
    await edit('proposal','实际 B');
    await page.locator('[data-confirm=proposal]').check();
    await page.locator('[data-phase=proposal]').selectOption('planned');
    assert.equal(await field('proposal').inputValue(),'计划 A');
    assert.equal(await page.locator('[data-confirm=proposal]').isChecked(),true);
    await page.locator('[data-phase=proposal]').selectOption('actual');
    assert.equal(await field('proposal').inputValue(),'实际 B');
    assert.equal(await page.locator('[data-confirm=proposal]').isChecked(),true);
    await step(4);await action('archive');await page.locator('[data-revision="1"] > summary').click();
    assert.match(await page.locator('[data-revision="1"]').innerText(),/计划 A/);
    assert.match(await page.locator('[data-revision="1"]').innerText(),/实际 B/);
    pass('observations are contextual; plan and actual values, evidence and confirmations remain independent and both archive');

    await customer('demo-booking-b');
    assert.equal(await page.locator('[data-text=text]').inputValue(),'');
    await action('demo-text');await page.locator('[data-action="demo-photos"][data-stage=before]').click();
    assert.equal(await page.locator('.adp-photo-strip img').count(),3);
    await step(1);await action('analyze');
    assert.equal(await field('basic.style').inputValue(),'简洁；脸周柔和');
    assert.equal(await field('basic.person').inputValue(),'');
    assert.equal(await field('basic.layers').inputValue(),'');
    assert.equal(await page.locator('[data-field^="basic."]').count(),7);
    assert.equal(await field('care').count(),0);
    assert.match(await page.locator('[data-record=proposal] .adp-source').innerText(),/建议演示/);
    pass('fixed sample extracts only supported fields, seven before-stage design fields and separate suggestion');
    const original=await page.locator('[data-record="basic.style"] .adp-original').textContent();
    await edit('basic.style','本人修改：更简洁');
    await page.locator('[data-confirm="basic.style"]').check();
    await action('analyze');
    assert.equal(await field('basic.style').inputValue(),'本人修改：更简洁');
    assert.equal(await page.locator('[data-confirm="basic.style"]').isChecked(),true);
    assert.equal(await page.locator('[data-record="basic.style"] .adp-original').textContent(),original);
    pass('repeat mock analysis preserves human edits, confirmation and original source');

    await step(2);
    assert.equal(await page.locator('.adp-mannequin').count(),3);
    assert.equal(await page.locator('[data-zone]').count(),6);
    assert.equal(await page.locator('.adp-mannequin line').count(),5); // top in all three; bangs / ear-front in side only.
    await page.locator('[data-zone=bottom]').click();
    assert.match(await page.locator('.adp-zone-edit > h3').innerText(),/底区/);
    assert.equal(await field('zones.bottom.direction').inputValue(),'');
    await field('zones.bottom.direction').selectOption('down');
    assert.equal(await page.locator('.adp-mannequin line').count(),7);
    assert.equal(await page.locator('[data-map-zone=bottom][data-selected=true]').count(),2);
    pass('six-zone cards map to neutral front/side/back; only entered directions produce arrows');
    await page.locator('[data-zone=bangs]').click();
    await page.locator('[data-action="add-zone-group"][data-group-type=perm]').click();
    await edit('zoneProcesses.bangs.perm.0.rods','虚构杠具 A，参数待确认');
    await edit('zoneProcesses.bangs.perm.0.method','虚构操作方法 A');
    await edit('zoneProcesses.bangs.perm.0.mix','虚构配方 A，未提供比例');
    await page.locator('[data-action="add-zone-group"][data-group-type=perm]').click();
    await edit('zoneProcesses.bangs.perm.1.rods','虚构杠具 B，参数待确认');
    await page.locator('[data-service=perm]').uncheck();
    assert.equal(await page.locator('[data-zone-process=perm]').isVisible(),false);
    await page.locator('[data-service=perm]').check();
    assert.equal(await field('zoneProcesses.bangs.perm.0.rods').inputValue(),'虚构杠具 A，参数待确认');
    assert.equal(await field('zoneProcesses.bangs.perm.1.rods').inputValue(),'虚构杠具 B，参数待确认');
    await page.locator('[data-zone=top]').click();
    assert.equal(await page.locator('[data-process-group]').count(),0);
    await page.locator('[data-zone=bangs]').click();
    assert.equal(await page.locator('[data-process-group]').count(),2);
    pass('same-zone multiple rod/formula groups survive service hiding and remain isolated from other zones');
    await page.locator('[data-service=dye]').check();
    await page.locator('[data-action="add-zone-group"][data-group-type=dye]').click();
    await edit('zoneProcesses.bangs.dye.0.colors','虚构颜色 A');
    await edit('zoneProcesses.bangs.dye.0.ratios','未知比例，不填写数值');
    await page.locator('[data-phase="zoneProcesses.bangs.dye.0.colors"]').selectOption('actual');
    await edit('zoneProcesses.bangs.dye.0.colors','虚构实际颜色 B');
    await page.locator('[data-confirm="zoneProcesses.bangs.dye.0.colors"]').check();
    assert.equal(await field('zoneProcesses.bangs.perm.0.mix').inputValue(),'虚构配方 A，未提供比例');
    assert.equal(await field('care').count(),0);
    pass('dye groups and ratios stay separate from perm; no care field in before/proposal stages');
    if(screenshotDir){
      await page.locator('[data-zone=bangs]').click();
      await page.locator('[data-process-group="bangs-perm-0"] > summary').click();
      await page.locator('[data-process-group="bangs-dye-0"] > summary').click();
      await page.screenshot({path:path.join(screenshotDir,'pilot-desktop-zones.png'),fullPage:true});
    }

    await step(3);await edit('care','完成后的人工整理记录');await action('compare');
    assert.match(await page.locator('.adp-notice').innerText(),/补齐/);
    await page.locator('[data-photo-side=after]').selectOption('right');
    await page.locator('[data-action="demo-photos"][data-stage=after]').click();await action('compare');
    assert.match(await page.locator('.adp-comparison').innerText(),/不是.*AI/);
    assert.match(await page.locator('.adp-comparison').innerText(),/侧面标签不一致/);
    assert.equal(await page.locator('.adp-comparison-grid img').count(),2);
    pass('comparison requires complete before/after views and identifies unmatched sides without claiming results');
    await edit('review.achieved','只记录人工观察，不代表模型确认');
    assert.equal(await page.locator('[data-phase^="review."]').count(),0);
    assert.match(await page.locator('[data-record="review.achieved"]').innerText(),/完成观察/);
    await page.locator('[data-confirm="review.achieved"]').check();
    assert.match(await page.locator('.adp-comparison h4').innerText(),/已更改/);
    await action('compare');await step(4);await action('archive');
    assert.equal(await page.locator('[data-revision]').count(),1);
    await action('archive');assert.equal(await page.locator('[data-revision]').count(),1);
    await page.locator('[data-revision="1"] > summary').click();
    const revisionOne=await page.locator('[data-revision="1"] .adp-revision-body').textContent();
    assert.match(revisionOne,/虚构杠具 A/);assert.match(revisionOne,/虚构杠具 B/);assert.match(revisionOne,/虚构颜色 A/);
    assert.equal(await page.locator('[data-revision="1"] img').count(),0);
    pass('archive includes separate groups and evidence, excludes image bytes/URLs, deduplicates repeated save');
    await step(1);await edit('basic.style','第二版人工修订');await step(4);await action('archive');
    assert.equal(await page.locator('[data-revision]').count(),2);
    await page.locator('[data-revision="1"] > summary').click();
    assert.equal(await page.locator('[data-revision="1"] .adp-revision-body').textContent(),revisionOne);
    await page.locator('[data-revision="2"] > summary').click();
    assert.match(await page.locator('[data-revision="2"] .adp-revision-body').innerText(),/第二版人工修订/);
    pass('archive revisions are append-only snapshots, original version remains byte-for-byte unchanged');
    await customer('demo-booking-a');await step(1);assert.equal(await field('basic.person').inputValue(),'人工修订稿');
    await step(4);assert.equal(await page.locator('[data-revision]').count(),1);
    await customer('demo-booking-b');assert.equal(await page.locator('[data-revision]').count(),2);
    pass('customer switching restores independent drafts, stages, photos and revision history');

    await customer('demo-walk-in');await page.locator('[data-consent]').check();
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6JocAAAAASUVORK5CYII=','base64');
    const file={name:'synthetic-test.png',mimeType:'image/png',buffer:png};
    await page.locator('[data-file-angle=front]').setInputFiles([file,file]);
    await page.waitForFunction(()=>document.querySelectorAll('.adp-photo-strip img').length===2);
    assert.equal(await page.locator('.adp-photo-strip img').count(),2);
    await page.locator('[data-file-angle=back]').setInputFiles({name:'not-image.png',mimeType:'image/png',buffer:Buffer.from('invalid synthetic bytes')});
    await page.waitForFunction(()=>document.querySelector('.adp-notice').textContent.includes('无法解码'));
    assert.equal(await page.locator('.adp-photo-strip img').count(),2);
    await page.locator('[data-file-angle=back]').setInputFiles({name:'unsafe.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});
    assert.match(await page.locator('.adp-notice').innerText(),/只接受/);
    pass('local multi-photo preview works; invalid bytes and SVG are rejected');
    await page.locator('[data-file-angle=front]').setInputFiles([file,file,file]);
    await page.waitForFunction(()=>document.querySelectorAll('.adp-photo-strip img').length===4);
    assert.equal(await page.locator('.adp-photo-strip img').count(),4);
    await page.locator('[data-remove-photo]').first().click();
    assert.equal(await page.locator('.adp-photo-strip img').count(),3);
    assert.ok(await page.evaluate(()=>window.__pilotCalls.revoked>=2));
    pass('photo count bounds and object URL cleanup on removal/decode failure');
    await page.evaluate(()=>{
      const NativeImage=window.Image;
      window.__restoreImage=()=>{window.Image=NativeImage;};
      window.Image=class{set src(value){this.value=value;}get src(){return this.value;}};
    });
    await page.locator('[data-file-angle=back]').setInputFiles(file);
    await customer('demo-booking-a');
    await page.evaluate(()=>window.__restoreImage());
    await customer('demo-walk-in');
    assert.equal(await page.locator('.adp-photo-strip img').count(),3);
    pass('switching customer cancels a pending image decode and discards stale photo results');
    await page.locator('[data-text=text]').fill('<img src=x onerror=alert(1)>');
    await step(1);await edit('basic.style','<script>alert(1)</script>');await step(4);await action('archive');
    await page.locator('[data-revision="1"] > summary').click();
    assert.equal(await page.locator('[data-revision="1"] script').count(),0);
    assert.equal(await page.locator('[data-revision="1"] img').count(),0);
    assert.match(await page.locator('[data-revision="1"]').innerText(),/<script>alert\(1\)<\/script>/);
    pass('all free text is escaped in editable and archived views');

    await page.setViewportSize({width:390,height:844});await customer('demo-booking-b');
    for(let n=0;n<5;n++) {
      await step(n);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'overflow on stage '+n);
    }
    await step(2);await page.locator('[data-zone=bangs]').click();
    if(screenshotDir)await page.screenshot({path:path.join(screenshotDir,'pilot-mobile-zones.png'),fullPage:true});
    await step(3);
    if(screenshotDir)await page.screenshot({path:path.join(screenshotDir,'pilot-mobile-review.png'),fullPage:true});
    pass('all five stages fit 390px mobile viewport');
    assert.deepEqual(await page.evaluate(()=>({network:window.__pilotCalls.network,storage:window.__pilotCalls.storage,microphone:window.__pilotCalls.microphone})),{network:0,storage:0,microphone:0});
    assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
    pass('zero API/network, storage writes, microphone calls, external requests or page errors');
    await page.reload();
    assert.equal(await page.locator('[data-text=text]').inputValue(),'');
    assert.equal(await page.locator('[data-customer]').inputValue(),'demo-booking-a');
    assert.equal(await page.locator('.adp-photo-strip img').count(),0);
    await step(4);assert.equal(await page.locator('[data-revision]').count(),0);
    pass('refresh clears drafts, previews and local mock revisions');
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
    assert.equal(await page.locator('.adp').count(),0);
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
    assert.equal(await page.locator('.adp').count(),1);
    pass('pagehide cleanup and back-forward restoration remount safely without stale state');
    console.log('\n'+checks+' isolated pilot browser checks passed.');
  } finally {await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
