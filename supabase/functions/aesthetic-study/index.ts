import { validateEvents, allowedEmployee, allowedAdmin, UUID } from './protocol.mjs';

const URL=Deno.env.get('SUPABASE_URL')||'', KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization, apikey','Content-Type':'application/json','Cache-Control':'no-store'};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:cors});
async function rest(path:string,body?:unknown){const r=await fetch(URL+'/rest/v1/'+path,{method:body===undefined?'GET':'POST',headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('database unavailable');return r.json();}
async function hash(token:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function identity(token:unknown,admin=false){
 if(typeof token!=='string'||token.length<32||token.length>200)throw new Error('unauthorized');
 const table=admin?'aesthetic_training_admin_sessions':'employee_booking_sessions';
 const rows=await rest(table+'?select=username,store,expires_at'+(admin?',role':'')+'&token_hash=eq.'+await hash(token)+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&limit=1');
 const session=rows[0];if(!session)throw new Error('unauthorized');
 const people=await rest('staff?select=id,username,store,role,active,employment_status&username=eq.'+encodeURIComponent(session.username)+'&limit=1');
 const person=people[0];if(!(admin?allowedAdmin(person,session):allowedEmployee(person,session)))throw new Error('unauthorized');
 return person;
}
let cachedCases:any[]=[];let refreshed=0;
async function publishedCases(){
 if(Date.now()-refreshed<60000&&cachedCases.length)return cachedCases;
 const r=await fetch('https://taoyouming308-ui.github.io/docs/aesthetic-training/feed.v1.json',{signal:AbortSignal.timeout(10000),cache:'no-store'});
 if(!r.ok)throw new Error('database unavailable');
 const raw=await r.text();if(raw.length>2000000)throw new Error('invalid feed');
 const feed=JSON.parse(raw);if(feed.schemaVersion!==1||!Array.isArray(feed.items)||feed.items.length>1000)throw new Error('invalid feed');
 const cases=[];
 for(const x of feed.items){
  if(!/^aesthetic-[a-z0-9-]+$/.test(x.id)||typeof x.title!=='string'||x.title.length>500||!/^\d{4}-\d{2}-\d{2}$/.test(x.date))throw new Error('invalid feed');
  cases.push({id:x.id,title:x.title,date:x.date,version:await hash(JSON.stringify(x))});
 }
 if(cases.length){
  const response=await fetch(URL+'/rest/v1/aesthetic_study_cases?on_conflict=case_id,content_version',{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify(cases.map(c=>({case_id:c.id,content_version:c.version,title:c.title,published_date:c.date}))),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('database unavailable');
 }
 cachedCases=cases;refreshed=Date.now();return cases;
}
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});
 if(req.method!=='POST')return json({error:'POST required'},405);
 if(!URL||!KEY)return json({error:'service unavailable'},503);
 try{
  if(Number(req.headers.get('content-length')||0)>40000)return json({error:'request too large'},413);
  const raw=await req.text();if(raw.length>40000)return json({error:'request too large'},413);
  const p=JSON.parse(raw);const op=p.operation;
  if(['bootstrap','sync'].includes(op)){
   const user=await identity(p.session_token);
   if(p.employee_id!==undefined&&p.employee_id!==user.id)throw new Error('unauthorized');
   if(op==='bootstrap'){const cases=await publishedCases();return json({user:{id:user.id,username:user.username,store:user.store},server_time:Date.now(),cases,rows:await rest('aesthetic_study_progress?employee_id=eq.'+user.id+'&select=case_id,content_version,self_completed,answer_viewed_at&limit=500')});}
   const known=await rest('aesthetic_study_cases?select=case_id,content_version&limit=10000');
   const events=validateEvents(p.events,known.map((c:any)=>({id:c.case_id,version:c.content_version})));
   return json(await rest('rpc/aesthetic_study_ingest',{p_employee_id:user.id,p_username:user.username,p_store:user.store,p_events:events}));
  }
  if(['admin_overview','admin_archives','admin_restore'].includes(op)){
   const admin=await identity(p.admin_token,true);
   if(op==='admin_restore'){
    if(typeof p.candidate_id!=='string'||!UUID.test(p.candidate_id))return json({error:'invalid candidate'},400);
    return json({restored:await rest('rpc/aesthetic_study_restore_candidate',{p_id:p.candidate_id,p_operator:admin.username})});
   }
   if(op==='admin_archives')return json({rows:await rest('aesthetic_study_candidate_archive?select=candidate_id,before_status,archived_at,restored_at&order=archived_at.desc&limit=100')});
   const offset=Number(p.offset||0);if(!Number.isInteger(offset)||offset<0||offset>100000)return json({error:'invalid offset'},400);
   return json({cases:await publishedCases(),employees:await rest('staff?select=id,username,store&role=eq.staff&active=eq.true&employment_status=eq.active&order=id.asc&limit=1000'),rows:await rest('aesthetic_study_progress?select=*&order=last_view_at.desc.nullslast,employee_id.asc,case_id.asc,content_version.asc&limit=500&offset='+offset)});
  }
  return json({error:'invalid operation'},400);
 }catch(e){const msg=(e as Error).message;return json({error:msg==='unauthorized'?'登录已失效或无权限':msg==='database unavailable'?'服务暂不可用':'请求无效'},msg==='unauthorized'?403:msg==='database unavailable'?503:400);}
});
