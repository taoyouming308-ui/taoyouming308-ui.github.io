/* QA only: node scripts/phone-read-acceptance.cjs [--smoke]. No tunnel, live API or business files. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),apps=['perm-app.html','frontdesk.html','operations.html'];
const html=new Map(apps.map(name=>[name,fs.readFileSync(path.join(root,name),'utf8')]));
const permitted=new Set();
// Serve only named, root-level app scripts/styles referenced by the three published shells.
for(const s of html.values())for(const m of s.matchAll(/["'`=]([\w.-]+\.(?:js|css))(?=[?"'`\s])/g)){
  if(!/^(?:sw|service-worker|app-shell-sw)\./i.test(m[1])&&fs.existsSync(path.join(root,m[1])))permitted.add(m[1]);
}
const scrub=s=>s.replace(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'fixture-not-a-real-key').replace(/sb_publishable_[A-Za-z0-9_-]+/g,'fixture-publishable');
const CSP="default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src data: blob:; media-src 'none'; font-src 'none'; frame-src 'self'; frame-ancestors 'self'; worker-src 'none'; object-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none'";
const home='<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>三端只读验收</title><style>*{box-sizing:border-box}body{margin:0;display:flex;flex-direction:column;height:100dvh;font:14px system-ui}header{padding:7px;background:#171717;color:white}nav{display:flex;gap:.4em;flex-wrap:wrap;padding:6px}button,select{padding:6px;min-height:40px}iframe{border:0;flex:1;width:100%}</style><header>三端只读验收 · 假资料 · 不能保存或入账</header><nav><button data-app="perm-app.html">自由手艺人</button><button data-app="frontdesk.html">前台</button><button data-app="operations.html">报表</button><select id="network" aria-label="模拟网络"><option value="normal">正常</option><option value="slow">慢网 1.2 秒</option><option value="offline">接口断网</option></select></nav><iframe sandbox="allow-scripts allow-same-origin" id="app" title="只读验收页面"></iframe><script>const app=document.querySelector("iframe");document.querySelectorAll("button").forEach(b=>b.onclick=()=>app.src="/"+b.dataset.app);network.value=sessionStorage.getItem("test-network")||"normal";network.onchange=()=>sessionStorage.setItem("test-network",network.value);app.src="/perm-app.html";</script>';
async function main(){
 const server=http.createServer((req,res)=>{
   const port=server.address().port;
   const deny=(status)=>res.writeHead(status,{'Cache-Control':'no-store'}).end();
   if(req.method!=='GET'||req.headers.host!=='127.0.0.1:'+port||req.headers['sec-fetch-site']==='cross-site')return deny(403);
   const name=new URL(req.url,'http://127.0.0.1').pathname.slice(1);let type,body;
   if(name===''){type='text/html';body=home}
   else if(html.has(name)){type='text/html';body=scrub(html.get(name)).replace(/<head(\s[^>]*)?>/i,'$&<meta name="phone-fixture" content="local"><script src="/fixture.js"></script>')}
   else if(name==='fixture.js'){type='application/javascript';body=fs.readFileSync(path.join(__dirname,'phone-read-acceptance-fixture.js'))}
   else if(permitted.has(name)){type=name.endsWith('.js')?'application/javascript':'text/css';body=scrub(fs.readFileSync(path.join(root,name),'utf8'))}
   else return deny(404);
   res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':CSP,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}).end(body);
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 const origin='http://127.0.0.1:'+server.address().port;
 if(!process.argv.includes('--smoke')){console.log('仅本机 Safari / 同机 iOS 模拟器：'+origin+'/\n手机不能直接打开 Mac 的回环地址。Ctrl+C 关闭；不提供公网或局域网服务。');return}
 try{
   for(const engine of ['chromium','webkit']){
     const pw=require('playwright'),browser=await pw[engine].launch();
     try{
       const ctx=await browser.newContext({...pw.devices['iPhone 13'],serviceWorkers:'block'}),page=await ctx.newPage(),violations=[];
       await page.route('**/*',r=>{if(new URL(r.request().url()).origin!==origin){violations.push(r.request().url());return r.abort()}return r.continue()});
       await page.goto(origin);
       for(const [label,name,check] of [['自由手艺人','perm-app.html',async f=>{await f.waitForFunction(()=>typeof openFeature==='function'&&!!localStorage.getItem('booking-session'));await f.evaluate(()=>openFeature('bookings'));await f.locator('#booking-list').getByText('演示顾客甲',{exact:true}).waitFor()}],['前台','frontdesk.html',async f=>{await f.locator('#today-list').getByText(/演示顾客甲/).first().waitFor();await f.locator('#today-list [data-index]').first().click();await f.locator('#customer-drawer-content').getByText(/演示顾客甲/).first().waitFor()}],['报表','operations.html',async f=>{await f.waitForFunction(()=>state.monthlyOverviewReady===true);await f.evaluate(()=>showView('daily-report'));await f.locator('#daily-report-calendar').waitFor();await f.waitForFunction(()=>window.__phoneFixtureCalls.includes('daily_sheet_month'))}]]){
         await page.getByRole('button',{name:label,exact:true}).click();
         await page.waitForFunction(n=>document.querySelector('iframe').contentWindow.location.pathname==='/'+n,name);
         const f=page.frames().find(f=>f.url()===origin+'/'+name);assert(f,label);await check(f);
         const write=await f.evaluate(async()=>{const r=await fetch('/fake',{method:'POST',body:JSON.stringify({operation:'cashier_confirm'})});return r.status});assert.equal(write,405);
         await page.locator('#network').selectOption('offline');
         assert.equal(await f.evaluate(async()=>{try{await fetch('/fake',{method:'POST',body:'{"operation":"session"}'});return false}catch{return true}}),true);
         await page.locator('#network').selectOption('normal');
         assert.equal(await f.evaluate(async()=>(await fetch('/fake',{method:'POST',body:'{"operation":"session"}'})).status),200);
       }
       assert.deepEqual(violations,[]);console.log(engine+': 3 production shells with synthetic bookings, archive, calendar, denied writes, offline and reconnected transport; no outbound requests');
     }finally{await browser.close()}
   }
 }finally{await new Promise(resolve=>server.close(resolve))}
}
main().catch(e=>{console.error(e);process.exitCode=1});
