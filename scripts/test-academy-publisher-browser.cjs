const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const temp=fs.mkdtempSync(path.join(os.tmpdir(),'academy-browser-fixture-')),out=path.join(temp,'candidate');let browser;
try{
 cp.execFileSync(process.env.ZYSYR_HOOK_PYTHON||'python3',['scripts/academy-publisher-browser-fixture.py',out],{stdio:'pipe'});
 browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:process.platform==='darwin'?{channel:'chrome'}:{})});
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:844}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.hostname!=='academy-fixture.test'||r.request().method()!=='GET')return r.abort();const file=path.resolve(out,'.'+decodeURIComponent(u.pathname));if(!file.startsWith(out+path.sep)||!fs.existsSync(file))return r.fulfill({status:404,body:'missing'});return r.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8'});});
  await page.goto('http://academy-fixture.test/academy/2026-10-12.html');
  const img=page.locator('figure img');await img.scrollIntoViewIfNeeded();await page.waitForFunction(()=>{const i=document.querySelector('figure img');return i&&i.complete&&i.naturalWidth>0});
  assert.equal(await page.locator('section h2').count(),11);
  assert.equal(await img.getAttribute('src'),'assets/2026-10-12/fixture.svg');
  assert((await page.locator('body').innerText()).includes('作者未知'));
  assert((await page.locator('body').innerText()).includes('发表日期未知'));
  assert((await page.locator('aside').innerText()).includes('SYNTHETIC AI source-verification fixture role'));
  assert.equal(await page.locator('nav a').first().getAttribute('href'),'../perm-app.html');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);fs.mkdirSync('artifacts/academy-publisher',{recursive:true});await page.screenshot({path:'artifacts/academy-publisher/synthetic-'+width+'.png',fullPage:true});await page.close();
 }
 console.log('Academy publisher 390/1280: ten sections, actual SVG/alt, unknown metadata, role attribution, navigation and fit passed; synthetic only.');
}finally{if(browser)await browser.close();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
