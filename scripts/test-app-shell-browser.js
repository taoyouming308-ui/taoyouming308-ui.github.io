// Real loopback Service Worker + CacheStorage. External requests are blocked; no business backend.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..'), paths = require('./app-shell-files.json');
const runtime = fs.readFileSync(path.join(__dirname, 'app-shell-worker-runtime.js'), 'utf8');
const base = Number(fs.readFileSync(path.join(root, 'version.txt'), 'utf8'));
const types = { html:'text/html', js:'application/javascript', css:'text/css', json:'application/json', png:'image/png' };
let release = base, corrupt = '', runtimeSuffix = '', networkDown = false, delay = 60, requests = [], posts = 0;
// The SW can intercept fetch before browser automation routes see it. Keep the
// synthetic HTML itself offline-safe in both engines, including after cache activation.
const sourceBytes=new Map(paths.map(f=>[f,fs.readFileSync(path.join(root,f))]));
function bytes(file) { let b=sourceBytes.get(file); if(file.endsWith('.html')) b=Buffer.from(b.toString()
 .replace(/<head\b[^>]*>/i,"$&<meta http-equiv=\"Content-Security-Policy\" content=\"connect-src 'self'\">")
 .replaceAll('data-version="'+base+'"','data-version="'+release+'"').replaceAll('?v='+base,'?v='+release)); return b; }
function worker() {
 const files=paths.map(file=>({path:file,sha256:crypto.createHash('sha256').update(bytes(file)).digest('hex'),types:[types[file.split('.').pop()]],versions:[String(release),...(file==='staff-access-client.js'?['539']:[])]}));
 return 'const SHELL='+JSON.stringify({version:release,id:crypto.createHash('sha256').update(JSON.stringify(files)+runtime+runtimeSuffix).digest('hex').slice(0,16),files})+';\n'+runtime+runtimeSuffix;
}
const server=http.createServer(async(req,res)=>{
 if(networkDown){req.socket.destroy();return;}
 const u=new URL(req.url,'http://localhost'),file=u.pathname.slice(1); requests.push({method:req.method,path:file});
 if(req.method==='POST'){posts++;res.writeHead(503,{'Content-Type':'application/json'});return res.end('{"error":"synthetic offline/write denied"}');}
 if(file==='harness'||file==='admin.html'){res.writeHead(200,{'Content-Type':'text/html'});return res.end('<!doctype html><title>SW harness</title>');}
 if(file==='legacy-sw.js'){res.writeHead(200,{'Content-Type':'application/javascript','Cache-Control':'no-store'});return res.end("self.addEventListener('fetch',()=>{});");}
 if(file==='app-shell-sw.js'){res.writeHead(200,{'Content-Type':'application/javascript','Cache-Control':'no-store'});return res.end(worker());}
 if(file==='version.txt'){res.writeHead(200,{'Content-Type':'text/plain'});return res.end(String(release));}
 if(paths.includes(file)){await new Promise(r=>setTimeout(r,delay));res.writeHead(200,{'Content-Type':types[file.split('.').pop()],'Cache-Control':'no-store'});return res.end(corrupt===file?'corrupt synthetic release':bytes(file));}
 res.writeHead(404);res.end('not cached');
});
const engine=process.env.STARTUP_BROWSER||'chromium';
async function waitFor(page,fn,arg){
 // Playwright treats a Promise predicate as truthy: await each actual result, with a hard deadline.
 let expired=false,timer;
 try { await Promise.race([
  (async()=>{while(!expired){if(await page.evaluate(fn,arg))return;await page.waitForTimeout(50);}})(),
  new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(new Error('Timed out after 30000ms awaiting shell lifecycle condition: '+fn.toString()));},30000);})
 ]); } finally {expired=true;clearTimeout(timer);}
}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await require('playwright')[engine].launch({headless:true});
 let stage='cold';const watchdog=setTimeout(()=>{console.error('bounded test timeout at '+stage);browser.close();},120000);watchdog.unref();
 try {
  const context=await browser.newContext({viewport:{width:390,height:844}});
  await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort('internetdisconnected'));
  let page=await context.newPage();page.on('pageerror',e=>console.log('pageerror',e.message));const coldStart=performance.now();await page.goto(origin+'/perm-app.html');
  await page.evaluate(()=>navigator.serviceWorker.ready);const coldMs=Math.round(performance.now()-coldStart);
  assert.equal(await page.evaluate(()=>!!navigator.serviceWorker.controller),false,'first install must not claim or reload active page');
  const warm=[];
  for(let i=0;i<3;i++){const n=requests.length,t=performance.now();await page.reload();warm.push(Math.round(performance.now()-t));const network=requests.slice(n).filter(r=>paths.includes(r.path));assert.equal(network.length,0,'warm public shell should use no static network requests');}
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.version),String(base));
  stage='warm-complete';console.log(stage);
  // No API, auth query, POST or non-allowlisted bytes enter our cache.
  const before=posts;assert.equal(await page.evaluate(()=>fetch('/api/private',{method:'POST',body:'synthetic'}).then(r=>r.status)),503);assert.equal(posts,before+1);
  assert.equal(await page.evaluate(()=>fetch('/api/private?token=synthetic').then(r=>r.status)),404);
  const keys=await page.evaluate(async()=>{const out=[];for(const name of await caches.keys())for(const r of await (await caches.open(name)).keys())out.push(r.url);return out;});
  assert.equal(keys.length,paths.length+1);assert.ok(keys.every(k=>!k.includes('?')&&!k.includes('api/')));
  // Offline opens the real three entry documents but never treats a stored credential as verified.
  await page.locator('#identity-modal').waitFor(); // Finish the preceding page's empty-session check before seeding an offline fixture.
  await page.goto(origin+'/harness'); // Seed from a neutral document; pending empty-session checks in a live app must not race fixture setup.
  await page.evaluate(()=>localStorage.setItem('booking-session',JSON.stringify({session_token:'synthetic',username:'test',store:'test',loggedAt:Date.now()})));
  if(engine==='webkit') networkDown=true; else await context.setOffline(true);
  for(const entry of ['perm-app.html','frontdesk.html','operations.html']){
   await page.goto(origin+'/'+entry,{waitUntil:'load'});assert.equal(await page.evaluate(()=>document.documentElement.dataset.version),String(base));
   if(entry==='perm-app.html'){await page.locator('#identity-recovery').waitFor();assert.equal(await page.locator('#hair-analysis-modal').count(),0);assert.ok(await page.evaluate(()=>localStorage.getItem('booking-session')));}
  }
  assert.equal(await page.evaluate(()=>fetch('/api/private',{method:'POST',body:'synthetic'}).then(()=>false,()=>true)),true,'offline write is a real network failure');
  if(engine==='webkit') networkDown=false; else await context.setOffline(false);await page.goto(origin+'/frontdesk.html');
  await page.locator('#login-user').fill('unsaved synthetic');
  stage='offline-complete';console.log(stage);
  // Failed installation leaves old complete worker active and old input untouched.
  release=base+1;corrupt='operations.html';
  await page.evaluate(async()=>{
    const reg=await navigator.serviceWorker.getRegistration();window.__installStates=[];
    const observe=sw=>{if(!sw)return;const record=()=>window.__installStates.push(sw.state);record();sw.addEventListener('statechange',record);};
    observe(reg.installing);reg.addEventListener('updatefound',()=>observe(reg.installing),{once:true});
    await reg.update().catch(()=>{});observe(reg.installing);
  });
  await waitFor(page,()=>window.__installStates.includes('redundant'));
  assert.equal(await page.locator('#login-user').inputValue(),'unsaved synthetic');assert.equal(await page.evaluate(()=>document.documentElement.dataset.version),String(base));
  assert.equal(await page.evaluate(async()=>(await navigator.serviceWorker.getRegistration()).waiting),null);
  await waitFor(page,async()=>(await caches.keys()).length===1);
  assert.equal(await page.evaluate(async()=>(await caches.keys()).length),1,'failed partial cache removed after all downloads settle');
  stage='bad-install-complete';console.log(stage);
  // Corruption in the *old* cache must force a refetch even for an unchanged public script.
  await page.evaluate(async()=>{const [n]=await caches.keys(),cache=await caches.open(n);
    window.undoSyntheticDamage = await cache.match(new URL('/operations-time.js',location.href));
    await cache.put(new URL('/operations-time.js',location.href),new Response('synthetic broken old JS',{headers:{'Content-Type':'application/javascript'}}));});
  const beforeUpgrade=requests.length;
  corrupt='';await page.evaluate(async()=>(await navigator.serviceWorker.getRegistration()).update());
  await waitFor(page,async()=>!!(await navigator.serviceWorker.getRegistration()).installing);
  // Repeated button/online events must not queue another update while installation is running.
  assert.equal(await page.evaluate(()=>{
   const original=ServiceWorkerRegistration.prototype.update;let calls=0;
   ServiceWorkerRegistration.prototype.update=function(){calls++;return original.call(this);};
   try {window.ZysyrAppShell.requestUpdate();window.ZysyrAppShell.requestUpdate();window.dispatchEvent(new Event('online'));return calls;}
   finally {ServiceWorkerRegistration.prototype.update=original;}
  }),0,'installing worker must not receive duplicate update jobs');
  assert.equal(await page.locator('#login-user').inputValue(),'unsaved synthetic');
  await waitFor(page,async()=>!!(await navigator.serviceWorker.getRegistration()).waiting);
  const downloaded=requests.slice(beforeUpgrade).filter(r=>paths.includes(r.path)).map(r=>r.path);
  assert.deepEqual([...new Set(downloaded)].sort(),[...paths.filter(f=>f.endsWith('.html')),'operations-time.js'].sort(),
    'Only new entry HTML and damaged public assets should be downloaded');
  console.log('Synthetic release upgrade: '+downloaded.length+' static downloads vs '+paths.length+' in full shell.');
  await page.evaluate(async()=>{const [n]=await caches.keys();await (await caches.open(n)).put(new URL('/operations-time.js',location.href),window.undoSyntheticDamage);delete window.undoSyntheticDamage;});
  assert.equal(await page.locator('#login-user').inputValue(),'unsaved synthetic');
  await page.evaluate(()=>window.ZysyrAppShell.requestUpdate());assert.equal(await page.locator('#login-user').inputValue(),'unsaved synthetic');
  assert.equal(await page.locator('#app-shell-notice').getAttribute('data-state'),'waiting');
  // The real main entry must show one dismissible waiting prompt, not a false preparation pill.
  const prompt=await context.newPage();await prompt.goto(origin+'/perm-app.html');
  await prompt.locator('#app-shell-notice[data-state="waiting"]').waitFor();
  assert.equal(await prompt.locator('#update-banner').isVisible(),false);
  for(const width of [390,1366]) {
   await prompt.setViewportSize({width,height:844});
   const box=await prompt.locator('#app-shell-notice').boundingBox();assert(box.x>=0&&box.x+box.width<=width&&box.height<180);
   const button=prompt.getByRole('button',{name:'收起界面更新提示'});assert((await button.boundingBox()).height>=44);
   await prompt.locator('#app-shell-notice').screenshot({path:'/tmp/zysyr-shell-notice-'+engine+'-'+width+'.png'});
  }
  await prompt.getByRole('button',{name:'收起界面更新提示'}).click();assert.equal(await prompt.locator('#app-shell-notice').count(),0);
  await prompt.goto(origin+'/frontdesk.html');await prompt.waitForFunction(()=>!!window.ZysyrAppShell);
  await prompt.evaluate(()=>window.dispatchEvent(new Event('online')));assert.equal(await prompt.locator('#app-shell-notice').count(),0,'dismissal survives same-tab navigation and online events');
  await prompt.close();assert.equal(await page.locator('#login-user').inputValue(),'unsaved synthetic');
  // A second controlled page keeps the old version pinned, including report iframe parameters.
  const second=await context.newPage();await second.goto(origin+'/operations.html?entry=staff-shareholder&v='+(base+1)+'&review_store=synthetic&review_month=2026-10');
  assert.equal(await second.evaluate(()=>document.documentElement.dataset.version),String(base));
  assert.equal(await second.evaluate(v=>fetch('/operations-time.js?v='+v).then(r=>r.status),base+1),409);
  assert.equal(await second.evaluate(()=>fetch('/operations-time.js?v=999&_t=synthetic').then(r=>r.status)),409);
  await waitFor(second,async()=>!!(await navigator.serviceWorker.getRegistration()).waiting);
  await page.close();assert.equal(await second.evaluate(()=>fetch('/operations-time.js').then(r=>r.headers.get('X-Zysyr-Shell'))),String(base));
  await second.close();await new Promise(r=>setTimeout(r,1000));page=await context.newPage();await page.goto(origin+'/harness');
  await waitFor(page,async()=>{const r=await navigator.serviceWorker.getRegistration();return r&&r.active&&!r.waiting&&!r.installing;});
  await page.goto(origin+'/frontdesk.html');assert.equal(await page.evaluate(()=>document.documentElement.dataset.version),String(base+1));
  stage='activation-complete';console.log(stage);
  // Eviction: repair only matching bytes, reject a newer/mixed file.
  await page.evaluate(async()=>{for(const n of await caches.keys())if(n.includes('-'+document.documentElement.dataset.version+'-'))await(await caches.open(n)).delete(new URL('/operations-time.js',location.href).href);});
  corrupt='operations-time.js';assert.equal(await page.evaluate(v=>fetch('/operations-time.js?v='+v).then(r=>r.status),base+1),503);
  corrupt='';assert.equal(await page.evaluate(v=>fetch('/operations-time.js?v='+v).then(r=>r.status),base+1),200);
  assert.equal(await page.evaluate(async()=>(await caches.keys()).length),2,'current and previous complete shells retained');
  // Runtime-only update cannot overwrite/delete the active complete cache when download fails.
  runtimeSuffix='\n// synthetic runtime-only revision';corrupt='operations-time.js';
  await page.evaluate(async()=>{
    const reg=await navigator.serviceWorker.getRegistration();window.__installStates=[];
    const observe=sw=>{if(!sw)return;const record=()=>window.__installStates.push(sw.state);record();sw.addEventListener('statechange',record);};
    observe(reg.installing);reg.addEventListener('updatefound',()=>observe(reg.installing),{once:true});
    await reg.update().catch(()=>{});observe(reg.installing);
  });
  await waitFor(page,()=>window.__installStates.includes('redundant'));
  assert.equal(await page.evaluate(()=>fetch('/frontdesk.html').then(r=>r.headers.get('X-Zysyr-Shell'))),String(base+1));
  runtimeSuffix='';corrupt='';
  const admin=await context.newPage();await admin.goto(origin+'/admin.html');
  assert.equal(await admin.evaluate(()=>fetch('/staff-access-client.js?v=514').then(r=>r.status)),200);
  assert.equal(await admin.evaluate(()=>fetch('/aesthetic-knowledge.v1.js?v=388').then(r=>r.headers.get('X-Zysyr-Shell'))),null);await admin.close();
  // A lower release cannot replace a complete newer shell, even after all tabs close.
  release=base;
  await page.evaluate(async()=>{
    const reg=await navigator.serviceWorker.getRegistration();window.__installStates=[];
    const observe=sw=>{if(!sw)return;const record=()=>window.__installStates.push(sw.state);record();sw.addEventListener('statechange',record);};
    observe(reg.installing);reg.addEventListener('updatefound',()=>observe(reg.installing),{once:true});
    await reg.update().catch(()=>{});observe(reg.installing);
  });
  await waitFor(page,()=>window.__installStates.includes('redundant'));
  assert.equal(await page.evaluate(async()=>(await navigator.serviceWorker.getRegistration()).waiting),null);
  assert.equal(await page.evaluate(()=>fetch('/frontdesk.html').then(r=>r.headers.get('X-Zysyr-Shell'))),String(base+1));
  await context.close();
  // Existing legacy root worker must wait, never forcibly take over an active old document.
  const legacy=await browser.newContext();await legacy.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  let old=await legacy.newPage();await old.goto(origin+'/harness');await old.evaluate(async()=>{await navigator.serviceWorker.register('/legacy-sw.js');await navigator.serviceWorker.ready;});await old.reload();
  await old.evaluate(()=>navigator.serviceWorker.register('/app-shell-sw.js',{updateViaCache:'none'}));await waitFor(old,async()=>!!(await navigator.serviceWorker.getRegistration()).waiting);
  assert.ok(await old.evaluate(()=>navigator.serviceWorker.controller.scriptURL.endsWith('/legacy-sw.js')));
  await old.close();await new Promise(r=>setTimeout(r,1000));old=await legacy.newPage();await old.goto(origin+'/harness');await waitFor(old,async()=>{const r=await navigator.serviceWorker.getRegistration();return r&&r.active.scriptURL.endsWith('/app-shell-sw.js')&&!r.waiting;});await legacy.close();
  console.log(JSON.stringify({engine,simulatedStaticDelayMs:delay,networkFailure:engine==='webkit'?'loopback server closes sockets; Playwright offline navigation failed':'browser offline emulation',coldInstallMs:coldMs,warmNavigationMs:warm,publicFiles:paths.length,publicBytes:paths.reduce((n,p)=>n+fs.statSync(path.join(root,p)).size,0),passed:['installing duplicate button/online guarded','single truthful dismissible prompt at390/1366','dismissal survives navigation','cold no claim','warm zero static network','offline three entries/auth gate','no API or write cache','failed atomic install','unsaved input preserved','multi-tab waiting','version mismatch denied','natural version activation','eviction hash repair','legacy worker waiting','runtime-only failure preserves cache','admin shared resources untouched','downgrade rejected'],scope:'desktop browser loopback synthetic; not iPhone or production performance'},null,2));
 } finally {clearTimeout(watchdog);await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.closeAllConnections();server.close();process.exitCode=1;});
