const fs=require('fs'),assert=require('assert/strict'),{chromium}=require('playwright');
const html=fs.readFileSync('admin.html','utf8'),styles=[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(x=>x[1]).join('\n'),feed=JSON.parse(fs.readFileSync('docs/aesthetic-training/feed.v1.json'));
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:process.platform==='darwin'?{channel:'chrome'}:{})});try{for(const width of [390,1280]){
 const page=await browser.newPage({viewport:{width,height:844}}),errors=[];let mode='ok',restored=false;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{
  const url=r.request().url();if(url.includes('/functions/v1/aesthetic-study')){
   const p=r.request().postDataJSON();if(mode==='fail')return r.fulfill({status:503,json:{error:'服务暂不可用'}});
   if(p.operation==='admin_restore'){restored=true;return r.fulfill({json:{restored:true}});}
   if(p.operation==='admin_archives')return r.fulfill({json:{rows:[{candidate_id:'11111111-1111-4111-8111-111111111111',before_status:'pending_review',archived_at:'2026-10-09T02:00:00Z',restored_at:restored?'2026-10-09T03:00:00Z':null}]}});
   return r.fulfill({json:{cases:[{id:feed.items[0].id,title:feed.items[0].title}],employees:[{id:1,username:'合成员工A',store:'合成门店'},{id:2,username:'合成员工B',store:'合成门店'}],rows:mode==='empty'?[]:[{employee_id:1,username:'合成员工A',store:'合成门店',case_id:feed.items[0].id,content_version:'abcdef00',visits:2,active_ms:81000,first_view_at:'2026-10-09T02:00:00Z',last_view_at:'2026-10-09T02:01:21Z',answer_viewed_at:'2026-10-09T02:00:20Z',self_completed:true}]}});
  }
  if(url.includes('feed.v1.json'))return r.fulfill({json:feed});const asset=feed.items.find(x=>url.endsWith(x.image));if(asset)return r.fulfill({body:fs.readFileSync(asset.image),contentType:'image/jpeg'});
  return r.fulfill({body:'<!doctype html><meta charset="utf-8"><style>'+styles+'</style><main><h1>美学研究院</h1><div id="aesthetic-study-admin"></div><details><summary>旧知识资料与可恢复归档</summary><div id="aesthetic-study-archives"></div></details></main><script>const SUPABASE_URL="https://db.test",SUPABASE_KEY="synthetic-public";function getAdminSession(){return {trainingToken:"synthetic-admin"}};function toast(){};let aestheticCloudCandidates=null;window.loadAestheticAdmin=function(){};</script>'});
 });
 await page.goto('https://study-admin.test');await page.addScriptTag({path:'aesthetic-study-admin.js'});await page.evaluate(()=>loadAestheticAdmin());await page.getByText('有浏览记录员工',{exact:true}).waitFor();
 await page.getByRole('button',{name:'员工记录',exact:true}).click();await page.getByText('1分21秒',{exact:true}).filter({visible:true}).waitFor();assert(await page.getByText('区域显示过',{exact:true}).filter({visible:true}).isVisible());assert(await page.getByText('已自主标记',{exact:true}).filter({visible:true}).isVisible());
 fs.mkdirSync('artifacts/study',{recursive:true});await page.screenshot({path:'artifacts/study/admin-records-'+width+'.png',fullPage:true});
 await page.getByRole('button',{name:'案例查看管理',exact:true}).click();await page.locator('details.panel summary').first().click();await page.locator('img').filter({visible:true}).first().waitFor();await page.waitForFunction(()=>{const x=document.querySelector('details.panel[open] img');return x&&x.complete&&x.naturalWidth>0;});
 await page.screenshot({path:'artifacts/study/admin-case-'+width+'.png',fullPage:true});
 await page.getByText('旧知识资料与可恢复归档',{exact:true}).click();await page.getByRole('button',{name:'恢复到旧审核区'}).click();await page.getByText('已恢复',{exact:false}).waitFor();assert(restored);
 mode='empty';await page.getByRole('button',{name:'员工记录',exact:true}).click();await page.getByRole('button',{name:'刷新记录',exact:true}).click();await page.getByText('暂无符合条件的学习记录。').waitFor();
 mode='fail';await page.getByRole('button',{name:'刷新记录',exact:true}).click();await page.getByRole('button',{name:'重新读取',exact:true}).waitFor();mode='ok';await page.getByRole('button',{name:'重新读取',exact:true}).click();await page.getByText('1分21秒',{exact:true}).filter({visible:true}).waitFor();
 assert.deepEqual(errors,[]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.close();
}console.log('study admin390/1280: summary, records, case/image, archive restore, empty/error/retry passed');}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
