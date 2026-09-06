import assert from 'node:assert/strict';
import {createSalonSession} from '../packages/salon-core/session-controller.mjs';

const makeSession=(id='user-a',token='synthetic-access-token-a')=>({access_token:token,expires_at:2000,user:{id}});
function fixture(authTimeoutMs=30000){
 let session=makeSession(),listener=()=>{},userOverride=null,pendingUser=null,pendingSession=null,pendingLogout=null,pendingHTTP=null,logoutError=false,unsubscribed=false;
 const calls=[],resets=[];
 const auth={
  getSession:async()=>pendingSession||({data:{session}}),
  getUser:async()=>pendingUser||({data:{user:{id:userOverride||session?.user.id}}}),
  onAuthStateChange:fn=>{listener=fn;return {data:{subscription:{unsubscribe:()=>{unsubscribed=true;}}}};},
  signOut:async options=>{assert.deepEqual(options,{scope:'local'});if(pendingLogout)return pendingLogout;if(logoutError)return {error:true};session=null;listener('SIGNED_OUT',null);return {};},
 };
 const controller=createSalonSession({auth,endpoint:'http://127.0.0.1:1234/api',authTimeoutMs,now:()=>1000000,onReset:reason=>resets.push(reason),fetchImpl:async(_,options)=>{
  const body=JSON.parse(options.body);calls.push({body,token:options.headers.Authorization});
  if(pendingHTTP)return pendingHTTP;
  const data=body.operation==='context'?{organizationId:1,storeId:body.storeId||1,staffId:1}:[];
  return new Response(JSON.stringify({data,requestId:'trace'}));
 }});
 return {controller,calls,resets,emit:(event,next)=>{session=next;assert.equal(listener(event,next),undefined,'auth callbacks must remain synchronous');},
  setSession:value=>{session=value;},setUser:value=>{userOverride=value;},setPendingUser:value=>{pendingUser=value;},setPendingHTTP:value=>{pendingHTTP=value;},
  setPendingSession:value=>{pendingSession=value;},setPendingLogout:value=>{pendingLogout=value;},
  setLogoutError:value=>{logoutError=value;},get unsubscribed(){return unsubscribed;}};
}
{
 const f=fixture(),c=f.controller;await c.connect();const ticket=c.prepare('customer_create',{displayName:'合成'});
 f.emit('TOKEN_REFRESHED',makeSession('user-a','synthetic-refreshed-token'));
 await c.submit(ticket);assert.match(f.calls.at(-1).token,/refreshed/);const key=f.calls.at(-1).body.requestKey;
 f.emit('SIGNED_IN',makeSession('user-a','synthetic-refreshed-token'));await c.submit(ticket);assert.equal(f.calls.at(-1).body.requestKey,key);
 f.emit('SIGNED_IN',makeSession('user-b','synthetic-access-token-b'));assert.equal(c.scope,null);assert.throws(()=>c.submit(ticket),{code:'STALE_SCOPE'});
 await c.connect();await c.signOut();assert.equal(c.scope,null);await assert.rejects(c.read('customers'));
 c.dispose();assert.equal(f.unsubscribed,true);await assert.rejects(c.connect());
}
{
 const f=fixture(),c=f.controller;await c.connect();f.setSession(makeSession('user-b'));const count=f.calls.length;
 await assert.rejects(c.read('customers'),{code:'AUTH_REQUIRED'});assert.equal(f.calls.length,count,'silent account change cannot send business request');assert.equal(c.scope,null);
}
{
 const f=fixture();f.setUser('different-server-user');await assert.rejects(f.controller.connect(),{code:'AUTH_REQUIRED'});assert.equal(f.calls.length,0,'local user claims are not trusted');
}
{
 const f=fixture();f.setSession({...makeSession(),expires_at:999});await assert.rejects(f.controller.connect(),{code:'AUTH_REQUIRED'});assert.equal(f.calls.length,0);
}
{
 const f=fixture(),c=f.controller;await c.connect();let resolve;
 f.setPendingUser(new Promise(r=>{resolve=r;}));const work=c.read('customers');await Promise.resolve();await Promise.resolve();
 f.emit('SIGNED_OUT',null);resolve({data:{user:{id:'user-a'}}});await assert.rejects(work,{code:'STALE_SESSION'});assert.equal(f.calls.length,1);
}
{
 const f=fixture(),c=f.controller;await c.connect();let release;
 f.setPendingHTTP(new Promise(r=>{release=r;}));const work=c.read('customers');
 while(f.calls.length<2)await new Promise(r=>setImmediate(r));
 f.emit('SIGNED_OUT',null);release(new Response(JSON.stringify({data:[{customer_id:1}]})));
 await assert.rejects(work,{code:'STALE_SCOPE'});
}
{
 const f=fixture(),c=f.controller;await c.connect();f.setLogoutError(true);await assert.rejects(c.signOut(),{code:'SIGNOUT_UNCONFIRMED'});
 assert.equal(c.scope,null);await assert.rejects(c.connect(),{code:'AUTH_REQUIRED'});f.setLogoutError(false);await c.signOut();
}
{
 const f=fixture(),c=f.controller;await c.connect();f.emit('PASSWORD_RECOVERY',makeSession());await assert.rejects(c.connect(),{code:'AUTH_REQUIRED'});
 f.emit('TOKEN_REFRESHED',makeSession());await assert.rejects(c.connect(),{code:'AUTH_REQUIRED'});await c.signOut();
}
{
 const f=fixture(),c=f.controller;await c.connect();const ticket=c.prepare('customer_create',{displayName:'合成'});
 f.setPendingHTTP(Promise.resolve(new Response(JSON.stringify({error:'登录已过期',code:'AUTH_REQUIRED'}),{status:403})));
 await assert.rejects(c.submit(ticket));assert.equal(c.scope,null);assert.ok(f.resets.includes('SERVER_AUTH_REJECTED'));assert.throws(()=>c.submit(ticket),{code:'STALE_SCOPE'});
}
{
 const f=fixture(),c=f.controller;await c.connect();f.setPendingHTTP(Promise.resolve(new Response('Unauthorized',{status:401})));
 await assert.rejects(c.read('customers'),{code:'AUTH_REQUIRED'});assert.equal(c.scope,null);
}
for(const method of ['setPendingSession','setPendingUser']){
 const f=fixture(20),c=f.controller;let release;
 f[method](new Promise(resolve=>{release=resolve;}));
 await assert.rejects(c.connect(),{code:'AUTH_REQUIRED'});assert.equal(c.scope,null);assert.equal(f.calls.length,0);
 release(method==='setPendingSession'?{data:{session:makeSession()}}:{data:{user:{id:'user-a'}}});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(c.scope,null,'late verification cannot restore scope');
 f[method](null);await c.connect();assert.equal(c.scope.storeId,1);c.dispose();
}
{
 const f=fixture(20),c=f.controller;await c.connect();const ticket=c.prepare('customer_create',{displayName:'不应发送'});
 f.setPendingUser(new Promise(()=>{}));const count=f.calls.length;
 await assert.rejects(c.submit(ticket),{code:'AUTH_REQUIRED'});assert.equal(f.calls.length,count);assert.equal(c.scope,null);c.dispose();
}
{
 const f=fixture(20),c=f.controller;await c.connect();let release;
 f.setPendingLogout(new Promise(resolve=>{release=resolve;}));
 const first=c.signOut();await assert.rejects(c.signOut(),{code:'SIGNOUT_PENDING'});
 await assert.rejects(first,{code:'SIGNOUT_UNCONFIRMED'});
 assert.equal(c.scope,null);await assert.rejects(c.connect(),{code:'AUTH_REQUIRED'});
 release({});f.emit('SIGNED_OUT',null);f.emit('SIGNED_IN',makeSession());
 await new Promise(resolve=>setImmediate(resolve));
 await assert.rejects(c.connect(),{code:'AUTH_REQUIRED'});assert.equal(c.scope,null,'late success and events cannot clear unconfirmed logout');
 f.setPendingLogout(null);await c.signOut();f.setSession(makeSession());await c.connect();assert.equal(c.scope.storeId,1);c.dispose();
}
for(const timeout of [0,-1,NaN,Infinity,1.5,'30',120001])assert.throws(()=>fixture(timeout),RangeError);
console.log('Salon session: verified identity, refresh, logout, expiry, account switch, auth deadlines, late results and recovery guards passed');
