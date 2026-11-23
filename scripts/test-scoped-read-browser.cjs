// Real browser storage + deterministic server transport. Never contacts production.
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage(), ctx=page.context();
  await ctx.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<html lang="zh"></html>'}));
  async function boot(){await page.goto('https://test.invalid/');for(const file of ['scoped-read-codec.js','scoped-read-sync.js'])await page.addScriptTag({content:fs.readFileSync(path.join(root,file),'utf8')});}
  await boot();
  const setup=async()=>page.evaluate(()=>{
    const secret='demo-session-long-high-entropy-123456789',scope='desk/storeA/day1';
    window.value={rows:Array.from({length:40},(_,i)=>({id:i,name:'PRIVATE-CUSTOMER-'+i,note:'信息'.repeat(74)}))};
    window.audit=[];window.hints=[];
    window.read=(extra={})=>ZysyrReadSync.read(Object.assign({
      secret, scope,persist:false,current:()=>true,summary:r=>({count:r.rows.length}),
      onSummary:(s)=>audit.push(s),send:async h=>{hints.push(!!h);return ZysyrReadCodec.encode(h,value);}
    },extra));
  });
  await setup();
  await page.evaluate(async()=>{await read();await read();});
  assert.deepEqual(await page.evaluate(()=>hints),[false,true]);
  const deadline=Date.now()+5000;let ready=false;
  while(!ready&&Date.now()<deadline){
    ready=await page.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('zysyr-scoped-reads-v1');q.onsuccess=()=>r(q.result);});const rows=await new Promise(r=>{const q=db.transaction('reads').objectStore('reads').getAll();q.onsuccess=()=>r(q.result);});db.close();return rows.length===1&&rows[0].blob instanceof ArrayBuffer&&!('value' in rows[0]);});
    if(!ready)await new Promise(r=>setTimeout(r,20));
  }
  assert(ready,'expected completed ciphertext write before reload');
  await boot();await setup();
  let snap=await page.evaluate(async()=>{
    // A cached summary is not evidence that a live request succeeded.
    let failed=false;try{await read({send:async()=>{throw Error('offline');}});}catch{failed=true;}
    const cached=audit.slice();audit.length=0;
    await read({scope:'desk/storeB/day1',send:async()=>value});const other=audit.slice();
    return {failed,cached,other};
  });
  assert.deepEqual(snap,{failed:true,cached:[{count:40}],other:[]});
  const res=await page.evaluate(async()=>{
    await read();value.rows.splice(2,1);value.rows[0].name='renamed';
    const updated=await read();
    let tries=0;
    const recovered=await read({send:async h=>{tries++;return h?{__zysyr_read:1,base:h.rev,rev:'1'.repeat(64),patch:[99999]}:value;}});
    await ZysyrReadSync.clear();audit.length=0;await read();return {ok:JSON.stringify(value)===JSON.stringify(updated)&&JSON.stringify(updated)===JSON.stringify(recovered),tries,previewAfterLogout:audit};
  });
  assert.deepEqual(res,{ok:true,tries:2,previewAfterLogout:[]});
  console.log('PASS: browser IndexedDB summary after reload/offline, session/store isolation, verified deletion and repair, no offline success, clear on logout');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
