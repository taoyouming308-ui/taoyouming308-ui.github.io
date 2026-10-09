// Isolated native-dialog fixture; no real auth, API calls or business writes.
const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const html=fs.readFileSync('perm-app.html','utf8');
const styles=[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(x=>x[1]).join('\n');
const dialogCss=fs.readFileSync('perm-academy.css','utf8');
// Host Chrome has no native safe-area emulation: substitute only env inputs in this isolated fixture.
const fixtureCss=t=>dialogCss.replace(/env\(safe-area-inset-(top|bottom|left|right),0px\)/g,(_,key)=>(t[key]||0)+'px').replace(t.pwa?'(display-mode:standalone) and ': 'NEVER_MATCH','');
const section=html.slice(html.indexOf('  <section class="tab-content" id="tab-plans">'),html.indexOf('  </section><!-- /tab-plans -->'))+'</section>';
const switcher=html.slice(html.indexOf('  window.switchPlan = function(name)'),html.indexOf('  // 初始状态：首页显示'));
const calc=html.slice(html.indexOf('  function getFixedChem(tga, ca)'),html.indexOf('  // ===== 预约系统 ====='));
(async()=>{const browser=await chromium.launch({...(process.platform==='darwin'?{channel:'chrome'}:{}),headless:true});try{
for(const test of [{name:'portrait',width:390,height:844,top:59,bottom:34,left:0,right:0},{name:'pwa-zero-inset',width:390,height:844,top:0,bottom:0,left:0,right:0,pwa:true},{name:'narrow',width:320,height:568,top:44,bottom:20,left:0,right:0},{name:'landscape',width:844,height:390,top:0,bottom:21,left:59,right:59},{name:'reduced-height',width:390,height:320,top:59,bottom:0,left:0,right:0},{name:'desktop',width:1280,height:900,top:0,bottom:0,left:0,right:0}]){
 const page=await browser.newPage({viewport:{width:test.width,height:test.height}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>r.abort());
 await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>'+styles+'</style><style id="dialog-css">'+fixtureCss(test)+'</style><body><main class="main">'+section+'<input id="unsaved" value="未保存表单"><button id="open" onclick="openHairCalculator()">打开换算</button></main></body>');

 await page.addScriptTag({content:switcher});await page.addScriptTag({content:calc});await page.addScriptTag({path:'hair-calculator-dialog.js'});
 const dlg=page.locator('#hair-calculator-dialog'),close=dlg.locator('[data-close]'),tools=dlg.locator('[data-tools]');
 await page.locator('#open').click();assert(await dlg.isVisible());
 const box=await close.boundingBox(),outer=await dlg.boundingBox();assert(box.y>=Math.max(test.top,test.pwa?44:0)+12);assert(box.height>=44&&box.width>=44);assert(box.x>=test.left&&box.x+box.width<=test.width-test.right);assert(outer.y+outer.height<=test.height-test.bottom-10);assert(outer.x>=0&&outer.x+outer.width<=test.width);
 assert(await close.evaluate(el=>document.elementFromPoint(el.getBoundingClientRect().x+20,el.getBoundingClientRect().y+20)===el));
 await page.locator('#calc-tga').fill('3');await page.locator('#calc-ca').fill('1');await page.locator('#calc-amount').fill('100');await page.locator('#calc-btn').click();assert((await page.locator('#calc-result').innerText()).includes('75.0 g'));
 await tools.evaluate(el=>{el.scrollTop=el.scrollHeight});const after=await close.boundingBox();assert(Math.abs(after.y-box.y)<1);assert.equal(await dlg.evaluate(el=>el.scrollTop),0);
 fs.mkdirSync('artifacts/calculator-close',{recursive:true});await page.screenshot({path:'artifacts/calculator-close/'+test.name+'-scrolled.png'});
 await close.click();assert(!(await dlg.isVisible()));assert.equal(await page.locator('#unsaved').inputValue(),'未保存表单');assert.equal(await page.evaluate(()=>document.activeElement.id),'open');
 for(let i=0;i<2;i++){await page.locator('#open').click();assert.equal(await page.locator('#calc-tga').inputValue(),'3');await dlg.locator('[data-tool="cold"]').click();assert(await page.locator('#plan-cold').isVisible());await dlg.locator('[data-tool="calc"]').click();assert(await page.locator('#plan-calc').isVisible());await page.keyboard.press('Escape');assert(!(await dlg.isVisible()));}
 await page.locator('#open').click();await page.setViewportSize({width:test.height,height:test.width});await page.locator('#dialog-css').evaluate((el,css)=>el.textContent=css,fixtureCss({pwa:test.pwa}));assert((await close.boundingBox()).y>=12);await close.click();assert.deepEqual(errors,[]);await page.close();console.log(test.name+': safe bounds, 44px hit, fixed toolbar after scroll, calculation, switch, repeats, Escape, focus and rotate passed');
}
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
