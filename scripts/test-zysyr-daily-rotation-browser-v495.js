/* Synthetic browser regression only; no production credentials or writes. */
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return}fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return}res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'application/javascript':'application/octet-stream');res.end(bytes)})});
let browser;
function centered(metrics){return Math.abs(metrics.imageCenterX-metrics.frameCenterX)<1.5&&Math.abs(metrics.imageCenterY-metrics.frameCenterY)<1.5}
async function run(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({channel:'chrome',headless:true});
  for(const viewport of [{width:1280,height:900},{width:390,height:844},{width:844,height:390}]){
    const page=await browser.newPage({viewport,isMobile:viewport.width!==1280,hasTouch:viewport.width!==1280});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
    await page.goto(origin+'/operations.html?preview=1&role=finance');
    await page.evaluate(()=>{showView('import');document.getElementById('daily-review-workspace').classList.remove('hidden');const image=document.getElementById('daily-original-image');image.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="white"/><rect x="20" y="20" width="1160" height="760" fill="none" stroke="black" stroke-width="20"/></svg>');state.imports.sheet={draft:{id:'preview-draft'},permissions:{save_orientation:true},attachments:[{id:'preview-attachment',voucher_id:'preview-voucher',display_rotation_degrees:null}]};setDailyImageOrientationContext('daily-original-image',state.imports.sheet.attachments[0],state.imports.sheet)});
    await page.locator('#daily-original-image').evaluate(image=>image.decode());
    const stage=page.locator('#daily-original-stage'),tools=stage.locator('xpath=preceding-sibling::*[1]');
    async function metrics(){await page.waitForTimeout(180);return page.evaluate(()=>{const image=document.getElementById('daily-original-image'),frame=image.parentElement,stage=frame.parentElement,ir=image.getBoundingClientRect(),fr=frame.getBoundingClientRect();return{imageCenterX:(ir.left+ir.right)/2,imageCenterY:(ir.top+ir.bottom)/2,frameCenterX:(fr.left+fr.right)/2,frameCenterY:(fr.top+fr.bottom)/2,transform:image.style.transform,origin:image.style.transformOrigin,scrollLeft:stage.scrollLeft,scrollTop:stage.scrollTop,expectedLeft:Math.max(0,(stage.scrollWidth-stage.clientWidth)/2),expectedTop:Math.max(0,(stage.scrollHeight-stage.clientHeight)/2)}})}
    assert.equal(centered(await metrics()),true,'initial image must be centered at '+viewport.width+'x'+viewport.height);
    await tools.locator('[data-turn="90"]').click();let after=await metrics();
    assert.match(after.transform,/rotate\(90deg\)/);assert.equal(after.origin,'center center');assert.equal(centered(after),true,'right rotation must remain centered');
    assert.ok(Math.abs(after.scrollLeft-after.expectedLeft)<2&&Math.abs(after.scrollTop-after.expectedTop)<2,'right rotation must recenter both axes');
    const save=tools.locator('[data-save-orientation]');assert.equal(await save.isVisible(),true,'finance must see save orientation');assert.equal(await save.isEnabled(),true,'rotation must enable save');
    await save.click();assert.equal(await save.isEnabled(),false,'saved direction must no longer be dirty');
    assert.equal(await page.evaluate(()=>state.imports.sheet.attachments[0].display_rotation_degrees),90,'saved direction must update attachment state');
    await page.evaluate(()=>setDailyImageOrientationContext('daily-original-image',state.imports.sheet.attachments[0],state.imports.sheet));after=await metrics();
    assert.match(after.transform,/rotate\(90deg\)/,'reopening the image must restore the saved direction');
    await tools.locator('[data-turn="-90"]').click();after=await metrics();
    assert.match(after.transform,/rotate\(0deg\)/);assert.equal(centered(after),true,'left rotation must return to centered origin');
    await tools.locator('[data-turn="-90"]').click();after=await metrics();
    assert.match(after.transform,/rotate\(270deg\)/);assert.equal(centered(after),true,'left rotation must remain centered');
    await tools.locator('[data-auto-straighten]').click();after=await metrics();
    assert.match(after.transform,/rotate\(0deg\)/);assert.equal(centered(after),true,'automatic straighten must remain centered');
    assert.deepEqual(errors,[],'browser page errors');await page.close();
  }
  console.log('ZYSYR daily image centered rotation browser tests passed');
}
run().finally(async()=>{if(browser)await browser.close();server.close()}).catch(error=>{console.error(error);process.exitCode=1});
