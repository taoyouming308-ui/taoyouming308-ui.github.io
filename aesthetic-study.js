/* App-local study estimates. No background tracking or answers/keystrokes collected. */
(function(){
 'use strict';
 if(window.AestheticStudy)return;
 const root=document.getElementById('perm-academy-root');if(!root)return;
 const uid=()=>crypto.randomUUID();
 const database=new Promise((resolve,reject)=>{
  const request=indexedDB.open('aesthetic-study-records-v1',1);
  request.onupgradeneeded=()=>{const table=request.result.createObjectStore('events',{keyPath:'event_id'});table.createIndex('employee_id','employee_id');};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 });
 // IndexedDB transactions prevent concurrent tabs from overwriting each other's queue.
 let saving=Promise.resolve();
 async function pending(employee){const db=await database;return new Promise((resolve,reject)=>{const tx=db.transaction('events','readwrite'),table=tx.objectStore('events'),request=table.index('employee_id').getAll(employee);let rows=[];request.onsuccess=()=>{for(const e of request.result){if(Date.parse(e.at)>Date.now()+offset-604800000)rows.push(e);else table.delete(e.event_id);}};tx.oncomplete=()=>resolve(rows);tx.onerror=()=>reject(tx.error);});}
 async function save(event,employee){
  const db=await database;
  return new Promise((resolve,reject)=>{const tx=db.transaction('events','readwrite'),table=tx.objectStore('events'),index=table.index('employee_id');
   const count=index.count(employee);count.onsuccess=()=>{if(count.result>=2000){tx.abort();return;}table.add({...event,employee_id:employee});};
   tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(Error('queue full or unavailable'));
  });
 }
 async function remove(ids){const db=await database;return new Promise((resolve,reject)=>{const tx=db.transaction('events','readwrite');for(const id of ids)tx.objectStore('events').delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
 database.catch(()=>note('浏览器存储不可用，无法保存学习记录。'));
 let user=null,token='',offset=0,caseInfo=null,visit='',last=performance.now(),lastAction=performance.now(),lastFlush=0,loading=false,sending=false,epoch=0,answerSeen=false,own={};
 const visible=()=>document.visibilityState==='visible'&&document.hasFocus()&&root.getClientRects().length>0;
 function storedSession(){try{return JSON.parse(localStorage.getItem('booking-session')||'null');}catch(_){return null;}}
 function note(text){const el=root.querySelector('[data-study-status]');if(el)el.textContent=text;}
 function add(kind,start,end){
  if(!user||!caseInfo||!visit)return;
  const at=end||Math.round(Date.now()+offset);
  const e={event_id:uid(),visit_id:visit,case_id:caseInfo.id,content_version:caseInfo.version,kind,at:new Date(at).toISOString()};
  if(kind==='time'){e.start_ms=start;e.end_ms=end;}
  const employee=user.id;saving=saving.then(()=>save(e,employee)).catch(()=>note('本地记录存储已满或不可用；请联网同步后重试。'));
 }
 function resetVisit(){visit='';answerSeen=false;last=performance.now();lastAction=last;}
 function ensureVisit(){if(user&&caseInfo&&visible()&&!visit){visit=uid();add('visit');}}
 async function api(operation,extra={}){
  const r=await fetch(SUPABASE_URL+'/functions/v1/aesthetic-study',{method:'POST',headers:{'Content-Type':'application/json',apikey:SUPABASE_KEY,Authorization:'Bearer '+SUPABASE_KEY},body:JSON.stringify({operation,session_token:token,...(user?{employee_id:user.id}:{}),...extra}),signal:AbortSignal.timeout(12000)});
  const body=await r.json();if(!r.ok){const e=Error(body.error||'同步失败');e.status=r.status;throw e;}return body;
 }
 let manifest=[];
 async function bind(){
  const session=storedSession(),next=session&&session.session_token||'';
  if(next!==token){epoch++;user=null;token=next;own={};caseInfo=null;resetVisit();window.dispatchEvent(new Event('aesthetic-learning-state'));}
  if(!token||user||loading)return;
  const captured=epoch;loading=true;
  try{
   const before=Date.now(),data=await api('bootstrap');if(captured!==epoch)return;
   user=data.user;offset=data.server_time-(before+Date.now())/2;manifest=data.cases||[];
   own=Object.fromEntries((data.rows||[]).map(r=>[r.case_id+':'+r.content_version,!!r.self_completed]));
   // Pending self marks retain their chronological meaning until acknowledged.
   const buffered=await pending(user.id);if(captured!==epoch)return;
   for(const e of buffered.sort((a,b)=>a.at.localeCompare(b.at)))if(['complete','uncomplete'].includes(e.kind))own[e.case_id+':'+e.content_version]=e.kind==='complete';
   window.dispatchEvent(new Event('aesthetic-learning-state'));
   if(currentCase)await setCase(currentCase);
   note('学习记录已连接；有效停留为估算，自主学完不代表已掌握。');
  }catch(e){if(captured===epoch)note(e.status===403?'请登录有效员工账号后同步学习记录。':'记录服务暂不可用；本地待传记录保留。');}
  finally{loading=false;}
 }
 let currentCase=null,renderSeq=0,lastCaseRefresh=0;
 async function setCase(x){
  currentCase=x;const seq=++renderSeq;
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(x)));
  if(seq!==renderSeq)return;
  const version=[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(!user)return;
  let match=manifest.find(c=>c.id===x.id&&c.version===version);
  if(!match&&Date.now()-lastCaseRefresh>=60000){
   lastCaseRefresh=Date.now();const captured=epoch;
   try{const data=await api('bootstrap');if(captured!==epoch||seq!==renderSeq)return;manifest=data.cases||[];match=manifest.find(c=>c.id===x.id&&c.version===version);}catch(_){}
  }
  if(!match){caseInfo=null;note('当前案例版本尚未连接记录服务；内容仍可阅读。');return;}
  const changed=!caseInfo||caseInfo.id!==x.id||caseInfo.version!==version;
  caseInfo=match;if(changed)resetVisit();ensureVisit();
  const b=root.querySelector('[data-complete]');if(b){const done=!!own[x.id+':'+version];b.setAttribute('aria-pressed',String(done));b.textContent=done?'已学完 ✓':'标记学完';}
  note('仅记录本App案例浏览、答案区域查看、自主学完及有效前台停留（估算）；切后台或60秒无操作暂停。断网记录最多保留7天，联网补传；同步明细在下次学习时清理8天前的数据，汇总记录持续保存，总管理员可查看。');
 }
 async function flush(){
  if(!user||sending||!navigator.onLine)return;
  const captured=epoch, employee=user.id;sending=true;
  let rows;
  try{await saving;rows=(await pending(employee)).slice(0,60);}catch(_){sending=false;return;}
  if(!rows.length||captured!==epoch){sending=false;return;}
  try{const data=await api('sync',{events:rows.map(({employee_id,...e})=>e)});if(captured!==epoch)return;
   await remove(data.accepted||[]);
   note((await pending(employee)).length?'记录等待补传。':'学习记录已同步；有效停留为估算，自主学完不代表已掌握。');
  }catch(e){if(captured===epoch){note(e.status===403?'登录已失效，暂停记录；重新登录同一账号后可补传。':'断网或服务暂不可用，记录等待补传。');if(e.status===403){user=null;caseInfo=null;resetVisit();}}}
  finally{sending=false;}
 }
 function tick(){
  const now=performance.now(),delta=now-last;last=now;
  if(storedSession()?.session_token!==token){bind();return;}
  if(!user){if(visible()&&now-lastFlush>=60000){lastFlush=now;bind();}return;}
  if(!caseInfo&&currentCase)setCase(currentCase);
  ensureVisit();
  if(caseInfo&&visit&&visible()&&now-lastAction<60000&&delta>0&&delta<=25000){
   const end=Math.round(Date.now()+offset),start=end-Math.round(delta);
   const midnight=Math.floor((start+28800000)/86400000)*86400000+86400000-28800000;
   if(midnight>start&&midnight<end){add('time',start,midnight);add('time',midnight,end);}else add('time',start,end);
  }
  // Region exposure, not proof of reading or answering.
  const answer=root.querySelector('[data-study-answer]');
  if(!answerSeen&&visible()&&caseInfo&&visit&&answer){const r=answer.getBoundingClientRect();if(r.bottom>0&&r.top<innerHeight){answerSeen=true;add('answer_view');}}
  if(visible()&&now-lastFlush>=60000){lastFlush=now;flush();}
 }
 root.addEventListener('aesthetic-case-rendered',e=>setCase(e.detail));
 for(const name of ['pointerdown','keydown','touchstart','touchmove','wheel'])window.addEventListener(name,()=>{lastAction=performance.now();},{passive:true,capture:true});
 document.addEventListener('visibilitychange',()=>{last=performance.now();if(document.visibilityState!=='visible')flush();else{lastAction=last;bind();}});
 window.addEventListener('blur',()=>{last=performance.now();});
 window.addEventListener('focus',()=>{last=performance.now();lastAction=last;});
 window.addEventListener('online',()=>{bind().then(flush);});
 window.addEventListener('storage',e=>{if(e.key==='booking-session')bind();});
 window.addEventListener('staff-identity-changed',bind);
 const tab=root.closest('.tab-content');if(tab)new MutationObserver(()=>{last=performance.now();if(!root.getClientRects().length)resetVisit();else{lastAction=last;ensureVisit();}}).observe(tab,{attributes:true,attributeFilter:['class','style']});
 window.AestheticStudy={
  connected:()=>!!user,
  ready:()=>!!user&&!!caseInfo,
  isComplete:id=>caseInfo&&caseInfo.id===id?!!own[id+':'+caseInfo.version]:false,
  mark:(id,done)=>{if(!user||!caseInfo||caseInfo.id!==id)return false;ensureVisit();if(!visit)return false;own[id+':'+caseInfo.version]=done;add(done?'complete':'uncomplete');note('自主学完标记等待同步。');return true;}
 };
 setInterval(tick,20000);bind();
})();
