/** Real current admin HTML/modules, synthetic intercepted APIs; no real profile. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {chromium} from 'playwright';
import {createServiceBindingHandler} from '../supabase/functions/design-service-bindings/handler.mjs';
const root=resolve(new URL('..',import.meta.url).pathname),app='https://taoyouming308-ui.github.io',api='https://pdssrmpeiuwvxzsgschm.supabase.co';
const token='a'.repeat(72),sha='a'.repeat(64);let passed=0;
const pass=x=>{passed++;console.log('PASS '+x);};
const browser=await chromium.launch({headless:true});
try{
 for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'}),writes=[],seen=[],errors=[];
  let revision=0,state=null,loseAck=false,identityHold=null,releaseInspect,archiveWrites=0;
  const target={profileId:'11',profileLabel:'合成顾客',profilePhoneTail:'0011',profileSha:sha,staffId:'2',staffCreatedAt:'2026-01-01T00:00:00.000000Z',staffLabel:'合成负责员工',staffSha:sha};
  const source={visitKey:'booking:101',store:'自由手艺人',date:'2026-11-23',sourceSha:sha,customerLabel:'合成顾客',phoneTail:'0011',barberLabel:'源服务员工标注',status:0};
  const handle=createServiceBindingHandler({enabled:true,rpc:async({input})=>{
   seen.push(input.action);
   if(input.action==='choices')return {profile:{id:'11',label:'合成顾客',store:'自由手艺人',phoneTail:'0011'},visits:[{visitKey:'booking:101',label:'<img src=x onerror=alert(1)>合成顾客',phoneTail:'0011',barberLabel:'源服务员工标注',time:'10:00',kind:'预约'}],staff:[{staffId:'2',label:'合成负责员工'},{staffId:'3',label:'其他账号'}]};
   if(input.action==='inspect'){if(identityHold)await identityHold;return {source,target,revision,state,boundStaffId:state==='active'?'2':null,bindingMatches:state==='active'};}
   if(input.action==='confirm'){writes.push(input);revision++;state='active';if(loseAck){loseAck=false;throw Error('synthetic lost acknowledgement');}return {committed:true,savedRevision:revision,revision,state};}
   if(input.action==='revoke'){writes.push(input);revision++;state='revoked';return {committed:true,savedRevision:revision,revision,state};}
   if(input.action==='status')return {committed:true,savedRevision:revision,revision,state};
   if(input.action==='archive_inspect'){
    assert.equal(input.bookingId,'1002');assert.equal(input.date,'2026-11-23');
    return {profileLabel:'<img src=x>合成顾客',bookingLabel:'合成顾客',profileStore:'向里造型',serviceStore:'自由手艺人',phoneTail:'0011',date:input.date,time:'11:00',revision:0,state:null,evidenceSha:sha};
   }
   if(input.action==='archive_confirm'){archiveWrites++;assert.equal(input.evidenceSha,sha);throw Error('synthetic lost acknowledgement');}
   if(input.action==='archive_status'){return {committed:true,state:'approved',revision:1};}
   throw Error('unexpected action');
  }});
  await context.routeWebSocket('**/*',route=>route.close());
  await context.addInitScript(({token})=>{
   localStorage.setItem('perm_admin',JSON.stringify({user:'合成管理员',role:'admin',store:'',loggedAt:Date.now(),staffToken:token}));
   window.supabase={createClient:()=>({channel:()=>({on(){return this;},subscribe(){return this;}}),removeChannel(){}})};
  },{token});
  await context.route('**/*',async route=>{
   const r=route.request(),u=new URL(r.url());
   if(u.origin===app){
    let path=u.pathname==='/'?'/admin.html':u.pathname;
    if(!/^\/[A-Za-z0-9_./-]+$/.test(path)||path.includes('..')||!['.html','.js','.mjs','.css','.json','.png','.webp'].includes(extname(path))){await route.abort();return;}
    try{const body=readFileSync(resolve(root,'.'+path));await route.fulfill({status:200,contentType:({'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json'})[extname(path)]||'image/png',body});}catch{await route.fulfill({status:404,body:''});}return;
   }
   if(u.origin===api&&u.pathname==='/functions/v1/design-service-bindings'){
    const headers=await r.allHeaders();const response=await handle(new Request(r.url(),{method:r.method(),headers,...(r.method()==='POST'?{body:r.postData()}: {})}));
    await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});return;
   }
   if(u.origin===api){
    let body={};try{body=r.postDataJSON()||{};}catch{}
    const data=u.pathname==='/functions/v1/staff-access-api'?{rows:body.operation==='customer_profiles_admin'?[{id:11,phone:'13000000011',name:'合成顾客',shop_name:'自由手艺人',barber_name:'合成负责员工',total_visits:1,total_consumption:0,notes:'{}'}]:[]}:[];
    await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':app,'access-control-allow-headers':'content-type, x-design-admin-session, apikey','access-control-allow-methods':'POST, GET, OPTIONS'},body:JSON.stringify(data)});return;
   }
   if(u.hostname.includes('jsdelivr')&&u.pathname.includes('supabase')){await route.fulfill({status:200,contentType:'application/javascript',body:''});return;}
   await route.abort();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(app+'/admin.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>window.switchTab('customers'));
  const entry=page.getByRole('button',{name:'服务负责员工',exact:true});await entry.waitFor();await entry.click();
  const dialog=page.getByRole('dialog',{name:'确认服务负责员工'});await dialog.waitFor();await dialog.locator('[data-date]').fill('2026-11-23');await dialog.getByRole('button',{name:'查询服务',exact:true}).click();
  await dialog.locator('[data-visit] option[value="booking:101"]').waitFor({state:'attached'});
  assert.equal(await dialog.locator('[data-visit]').inputValue(),'');assert.equal(await dialog.locator('[data-staff]').inputValue(),'');assert.equal(await dialog.locator('img').count(),0);
  await dialog.locator('[data-visit]').selectOption('booking:101');await dialog.locator('[data-staff]').selectOption('2');await dialog.getByRole('button',{name:'核对绑定',exact:true}).click();await dialog.locator('[data-attest]:enabled').waitFor();
  assert.equal(writes.length,0);assert(await dialog.getByRole('button',{name:'确认负责员工',exact:true}).isDisabled());
  const rect=await dialog.boundingBox();assert(rect.x>=0&&rect.x+rect.width<=width);pass(width+'px actual admin entry requires explicit service, account and human attestation; labels are escaped and modal fits');
  await dialog.locator('[data-reason]').fill('已核对合成服务与账号');await dialog.locator('[data-attest]').check();loseAck=true;
  await dialog.getByRole('button',{name:'确认负责员工',exact:true}).click();await dialog.locator('[data-status]').filter({hasText:'保存结果尚未确认'}).waitFor();
  assert.equal(writes.length,1);assert.equal(seen.filter(x=>x==='status').length,0);assert(await dialog.locator('[data-visit]').isDisabled());
  await dialog.getByRole('button',{name:'查询保存结果',exact:true}).click();await dialog.locator('[data-status]').filter({hasText:'已查到原操作回执'}).waitFor();assert.equal(writes.length,1);pass(width+'px lost acknowledgement preserves request; explicit status lookup never resubmits');
  await dialog.getByRole('button',{name:'核对绑定',exact:true}).click();await dialog.locator('[data-attest]:enabled').waitFor();await dialog.getByRole('button',{name:'撤销绑定',exact:true}).click();await dialog.locator('[data-status]').filter({hasText:'绑定已撤销'}).waitFor();assert.equal(writes.length,2);assert.equal(writes[1].action,'revoke');pass(width+'px explicit revocation uses the current reviewed revision and preserves confirmation history');
  identityHold=new Promise(r=>releaseInspect=r);await dialog.getByRole('button',{name:'核对绑定',exact:true}).click();
  await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('perm_admin'));s.staffToken='c'.repeat(72);localStorage.setItem('perm_admin',JSON.stringify(s));});releaseInspect();await dialog.waitFor({state:'detached'});pass(width+'px response from the previous administrator is discarded after account switch');
  await page.evaluate(token=>{const s=JSON.parse(localStorage.getItem('perm_admin'));s.staffToken=token;localStorage.setItem('perm_admin',JSON.stringify(s));},token);
  await entry.click();await dialog.getByRole('button',{name:'核对跨店预约入档',exact:true}).click();
  const archive=page.getByRole('dialog',{name:'核对跨店预约入档'});
  await archive.locator('[data-id]').fill('1002');await archive.locator('[data-date]').fill('2026-11-23');
  await archive.getByRole('button',{name:'核对',exact:true}).click();
  await archive.locator('[data-attest]:enabled').waitFor();
  assert.equal(await archive.locator('img').count(),0);
  assert(await archive.locator('[data-approve]').isDisabled());
  await archive.locator('[data-attest]').check();await archive.locator('[data-reason]').fill('已核对这次服务');
  await archive.locator('[data-approve]').click();await archive.locator('[data-lookup]').waitFor();
  await archive.locator('[data-lookup]').click();
  await archive.locator('[data-status]').filter({hasText:'尚未写入照片或复盘'}).waitFor();
  assert.equal(archiveWrites,1);pass(width+'px exact cross-store review and one confirmation; timeout does not resubmit');
  assert.equal(errors.length,0,errors.join('\n'));await context.close();
 }
 console.log(JSON.stringify({passed,productionRequests:0,realCustomers:0,models:0}));
}finally{await browser.close();}
