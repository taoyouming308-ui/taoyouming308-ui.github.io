/* Opt-in reads only. No fetch adapter of its own, outbox, credential store, or
 * offline success path. The caller owns authentication and foreground state. */
(function(g){
  'use strict';
  const codec=g.ZysyrReadCodec, TTL=8*3600000, CAP=12, MAX_DISK=256*1024;
  const memory=new Map(), inflight=new Map(), enc=new TextEncoder(), dec=new TextDecoder();
  let epoch=0, dbPromise, clearing=Promise.resolve();
  function rolloutEnabled(){
    if(g.document?.documentElement?.getAttribute?.('data-read-sync-rollout')!=='opt-in')return true;
    try{
      const choice=new URLSearchParams(g.location.search).get('read_preview');
      if(choice==='0'||choice==='1')g.sessionStorage.setItem('zysyr-scoped-read-preview',choice);
      return g.sessionStorage.getItem('zysyr-scoped-read-preview')==='1';
    }catch{return false;}
  }
  const enabled=rolloutEnabled(),build=g.document?.documentElement?.getAttribute?.('data-version')||'1';
  function db(){
    if(!dbPromise)dbPromise=new Promise(resolve=>{
      if(!g.indexedDB)return resolve(null);
      let req;try{req=g.indexedDB.open('zysyr-scoped-reads-v1',1);}catch{return resolve(null);}
      req.onupgradeneeded=()=>req.result.createObjectStore('reads',{keyPath:'id'}).createIndex('saved','saved');
      req.onsuccess=()=>{const d=req.result;d.onversionchange=()=>{d.close();dbPromise=null;};
        // Even a read-only visit after a long absence should retire expired summaries.
        try{const s=d.transaction('reads','readwrite').objectStore('reads');
          const q=s.index('saved').openCursor(g.IDBKeyRange.upperBound(Date.now()-TTL));
          q.onsuccess=()=>{const c=q.result;if(c){c.delete();c.continue();}};
        }catch{/* Expired rows are also refused on read and pruned on write. */}
        resolve(d);};
      req.onerror=req.onblocked=()=>resolve(null);
    });
    return dbPromise;
  }
  function timed(p,ms,fallback){
    let timer;return Promise.race([p,new Promise(r=>{timer=setTimeout(()=>r(fallback),ms);})]).finally(()=>clearTimeout(timer));
  }
  async function diskGet(id){
    await clearing;const d=await db();if(!d)return null;
    return new Promise(resolve=>{const req=d.transaction('reads').objectStore('reads').get(id);req.onsuccess=()=>resolve(req.result);req.onerror=()=>resolve(null);});
  }
  async function clearDisk(){
    const d=await db();if(!d)return;
    return new Promise(resolve=>{const tx=d.transaction('reads','readwrite');tx.objectStore('reads').clear();tx.oncomplete=tx.onerror=tx.onabort=resolve;});
  }
  function clear(){epoch++;memory.clear();inflight.clear();clearing=clearDisk().catch(()=>{});return clearing;}
  async function sessionKey(secret,id){
    const raw=await g.crypto.subtle.digest('SHA-256',enc.encode('zysyr-read/aes-v1\0'+id+'\0'+secret));
    return g.crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
  }
  function stale(){const e=Error('当前账号、门店或查看范围已变化，请重新打开');e.code='SYNC_SCOPE_CHANGED';throw e;}
  function validTime(t){const age=Date.now()-t;return Number.isFinite(age)&&age>=0&&age<TTL;}
  async function restore(id,key){
    const row=await diskGet(id);
    if(!row||!validTime(row.saved)||!row.blob||row.blob.byteLength>MAX_DISK+16)return null;
    const plain=await g.crypto.subtle.decrypt({name:'AES-GCM',iv:row.iv,additionalData:enc.encode(id)},key,row.blob);
    const v=JSON.parse(dec.decode(plain));if(v.time!==row.saved||!validTime(v.time))return null;
    // Never deserialize a saved customer ledger, photo, URL, or full report.
    return v.kind==='summary'?{time:v.time,summary:v.value}:null;
  }
  async function persist(id,key,value,active){
    const bytes=enc.encode(JSON.stringify(value));if(bytes.length>MAX_DISK)return;
    const iv=g.crypto.getRandomValues(new Uint8Array(12));
    const blob=await g.crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(id)},key,bytes);
    await clearing;const d=await db();if(!d||!active())return;
    return new Promise(resolve=>{
      const tx=d.transaction('reads','readwrite'),s=tx.objectStore('reads');s.put({id,saved:value.time,iv,blob});
      const cursor=s.index('saved').openCursor(null,'prev');let count=0;
      cursor.onsuccess=()=>{const c=cursor.result;if(c){if(++count>CAP||!validTime(c.key))c.delete();c.continue();}};
      tx.oncomplete=()=>resolve(true);tx.onerror=tx.onabort=()=>resolve(false);
    });
  }
  function isAuthError(e){
    return e && (e.status===401||e.status===403||/AUTH|SESSION_INVALID|FORBIDDEN|无权限|没有权限|登录失效|登录已失效/.test(String(e.code||'')+' '+String(e.message||'')));
  }
  async function read(o){
    if(typeof o.current!=='function'||typeof o.send!=='function')throw Error('缺少读取范围');
    const gen=epoch, live=()=>gen===epoch&&o.current();
    if(!live())stale();
    if(!enabled||!codec||!g.crypto?.subtle||typeof o.secret!=='string'||o.secret.length<24||!o.scope){
      const val=await o.send(null);if(!live())stale();return val;
    }
    for(const [k,v] of memory)if(!validTime(v.time))memory.delete(k);
    let id;try{id=await codec.digest(JSON.stringify(['scoped-read-v1',build,o.scope,o.secret]));}
    catch{if(!live())stale();const val=await o.send(null);if(!live())stale();return val;}
    if(!live())stale();const ticket={};inflight.set(id,ticket);
    const active=()=>live()&&inflight.get(id)===ticket;
    try {
      let old=memory.get(id),key,writeJob,early;
      const disk=typeof o.summary==='function';
      // On a cold visit the disk can contain only a projection, never the
      // transport baseline. Start the authorized full read without waiting for IDB.
      if(!old||!validTime(old.time)){
        memory.delete(id);old=null;
        early=Promise.resolve().then(()=>{if(!active())stale();return o.send(null);})
          .then(value=>({ok:true,value}),error=>({ok:false,error}));
      }
      if(disk)try{key=await sessionKey(o.secret,id);}catch{/* Storage is optional. */}
      if(early&&key){
        // A fast online reply or a denial wins immediately. A network error
        // may still display a dated, read-only summary; never return it as success.
        old=await timed(Promise.race([restore(id,key).catch(()=>null),
          early.then(r=>r.ok||isAuthError(r.error)?null:new Promise(()=>{}))]),120,null);
      }
      if(!active())stale();
      if(old&&validTime(old.time)){
        try {
          if(old.text&&o.onPreview)o.onPreview(JSON.parse(old.text),old.time);
          else if(old.text&&o.summary&&o.onSummary)o.onSummary(o.summary(JSON.parse(old.text)),old.time);
          else if(Object.hasOwn(old,'summary')&&o.onSummary)o.onSummary(old.summary,old.time);
        } catch{/* Display is optional and must not block an authorized refresh. */}
      }
      const hint=old?.spec?{v:1,rev:old.spec.rev,ids:old.spec.ids}:null;
      const result=early?await early:null;
      if(!active())stale();if(result&&!result.ok)throw result.error;
      const reply=result?result.value:await o.send(hint);if(!active())stale();
      let data;
      try{data=await codec.decode(reply,old);}catch{
        // One full retry of this opted-in read only. Never replay a mutation.
        if(!active())stale();const reset=await o.send(null);if(!active())stale();
        data=await codec.decode(reset,null);
      }
      if(!active())stale();
      const text=JSON.stringify(data), same=old?.text===text;
      let spec=null;try{spec=same?old.spec:await codec.describe(text);}catch{/* An optional digest must not lose an authorized full response. */}
      if(!active())stale();
      const time=Date.now();
      const savedAt=old?.diskSaved||0,shouldStore=!!key&&(!same||time-savedAt>60000);
      const entry={time,text,spec,diskSaved:savedAt};
      if(spec){memory.delete(id);memory.set(id,entry);if(memory.size>CAP)memory.delete(memory.keys().next().value);}
      else memory.delete(id);
      // Avoid rewriting the same encrypted snapshot on every poll.
      if(shouldStore){
        try{
          const value={kind:'summary',value:o.summary(data),time};
          if(value.value!==undefined)writeJob=persist(id,key,value,active).then(saved=>{if(saved)entry.diskSaved=time;}).catch(()=>{});
        }catch{/* Optional projection must not mask a successful online read. */}
      }
      // Release the view without waiting for storage; the ticket check still
      // prevents a superseded result from writing after a refresh or logout.
      if(writeJob){ticket.storing=true;writeJob.finally(()=>{if(inflight.get(id)===ticket)inflight.delete(id);});}
      return data;
    } catch(e){if(live()&&isAuthError(e))clear();throw e;}
    finally{if(!ticket.storing&&inflight.get(id)===ticket)inflight.delete(id);}
  }
  g.ZysyrReadSync=Object.freeze({enabled,read,clear});
})(globalThis);
