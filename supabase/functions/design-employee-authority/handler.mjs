/** Own-credential employee authentication only. No customer/visit grant or login
 * issuer. Dependencies are trusted server capabilities; no env/network on import. */
const APP='https://taoyouming308-ui.github.io';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const token=v=>typeof v==='string'&&v.length>=32&&v.length<=200&&!/[\s\u0000-\u001f\u007f]/.test(v);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
/** @param {{verifySession?: (credential:string,nonce:string)=>Promise<unknown>,clock?:()=>number}} [options] */
export function createLiveEmployeeAuthorityHandler({verifySession,clock=()=>Date.now()}={}){
 return async request=>{
  const origin=request.headers.get('origin'),headers={'cache-control':'private, no-store','pragma':'no-cache','vary':'Origin','x-content-type-options':'nosniff'};
  const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{...headers,'content-type':'application/json'}});
  if(origin&&origin!==APP)return reply(403,{ok:false,code:'DESIGN_EMPLOYEE_DENIED'});
  if(origin===APP)headers['access-control-allow-origin']=APP;
  const u=new URL(request.url);
  if(u.search||u.hash||!['/design-employee-authority','/functions/v1/design-employee-authority'].includes(u.pathname))return reply(404,{ok:false,code:'DESIGN_EMPLOYEE_DENIED'});
  if(request.method==='OPTIONS'){
   const names=(request.headers.get('access-control-request-headers')??'').toLowerCase().split(',').map(s=>s.trim()).sort().join(',');
   if(origin!==APP||request.headers.get('access-control-request-method')!=='POST'||names!=='content-type,x-employee-session')return reply(403,{ok:false,code:'DESIGN_EMPLOYEE_DENIED'});
   return new Response(null,{status:204,headers:{...headers,'access-control-allow-methods':'POST','access-control-allow-headers':'content-type,x-employee-session','access-control-max-age':'0'}});
  }
  if(request.method!=='POST'||request.headers.get('content-type')!=='application/json'||request.headers.has('authorization')||request.headers.has('cookie'))return reply(403,{ok:false,code:'DESIGN_EMPLOYEE_DENIED'});
  const credential=request.headers.get('x-employee-session');
  if(!token(credential)||Number(request.headers.get('content-length'))>80)return reply(403,{ok:false,code:'DESIGN_EMPLOYEE_DENIED'});
  try{
   let size=0;const parts=[];for await(const p of request.body??[]){size+=p.length;if(size>80)throw Error();parts.push(p);}
   const bytes=new Uint8Array(size);let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}
   const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));bytes.fill(0);
   if(!plain(input)||Object.keys(input).join('|')!=='nonce'||!UUID.test(input.nonce)||typeof verifySession!=='function')throw Error();
   const value=await verifySession(credential,input.nonce);
   // Do not relay an arbitrary dependency response, credential or DB error.
   const keys=['schemaVersion','nonce','staffId','staffCreatedAt','actor','sessionBinding','sourceRevision','checkedAt','sessionExpiresAt','validUntil'];
   const now=clock();
   if(!plain(value)||Object.keys(value).sort().join('|')!==keys.sort().join('|')||value.schemaVersion!=='design-live-employee-v1'||value.nonce!==input.nonce||!plain(value.actor)||Object.keys(value.actor).sort().join('|')!=='store|username'||typeof value.staffId!=='string'||!/^\d{1,10}$/.test(value.staffId)||Number(value.staffId)<1||typeof value.staffCreatedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value.staffCreatedAt)||!['自由手艺人','向里造型'].includes(value.actor.store)||typeof value.actor.username!=='string'||!value.actor.username||value.actor.username.length>80||value.actor.username!==value.actor.username.trim()||/[\u0000-\u001f\u007f]/.test(value.actor.username)||![value.sessionBinding,value.sourceRevision].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v))||![now,value.checkedAt,value.validUntil,value.sessionExpiresAt].every(Number.isSafeInteger)||value.checkedAt>now+250||now-value.checkedAt>2000||value.validUntil<=now||value.validUntil>Math.min(value.sessionExpiresAt,value.checkedAt+5000))throw Error();
   return reply(200,{ok:true,identity:value});
  }catch{return reply(403,{ok:false,code:'DESIGN_EMPLOYEE_DENIED'});}
 };
}
