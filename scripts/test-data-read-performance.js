// Actual API wrappers with bounded synthetic transport; no production connection or private data.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),cp=require('node:child_process');
const {performance}=require('node:perf_hooks');
const baseline=process.argv.includes('--baseline');
const read=p=>baseline?cp.execFileSync('git',['show','ac0cfd26:'+p],{encoding:'utf8'}):fs.readFileSync(p,'utf8');
const take=(s,a,b)=>{const x=s.indexOf(a),y=s.indexOf(b,x);assert.ok(x>=0&&y>x,a);return s.slice(x,y);};
const fixture={rows:Array.from({length:80},(_,i)=>({id:'test-'+i,store:'TEST-A',date:'2026-10-01',amount_cents:i===0?null:12345+i,order:'TEST-ORDER-'+i,staff:[{id:'TEST',share_cents:12345+i}]})),complete:true};
const wire=JSON.stringify(fixture),specs=[
 ['perm-app.html','  function employeeBookingsApi(','  EmployeeReports.init','employeeBookingsApi','today_bookings',{session_token:'TEST-a',date:'2026-10-01'}],
 ['frontdesk.html','    async function api(','    businessUI.init','api','dashboard',{store:'TEST-A',date:'2026-10-01'}],
 ['operations.html','  async function api(','  function currentStore','api','overview',{store:'TEST-A',month:'2026-10'}]
];
function setup(spec,delay=100){let calls=0,bytes=0,parseMs=0,fail=false;const context={window:{},Map,Promise,JSON,AbortController,setTimeout,clearTimeout,SUPABASE_KEY:'synthetic',ENDPOINT:'https://example.invalid',EMPLOYEE_BOOKINGS_ENDPOINT:'https://example.invalid',API:'https://example.invalid',state:{session:{session_token:'TEST-a'},store:'TEST-A',auth:null},authAccessToken:()=>'',authBridge:{},StaffReportView:{enabled:false},isSessionInvalidError:()=>false,clearSession:()=>{},apiError:d=>new Error(d.error)};
 const response=async(_url,opts)=>{calls++;bytes+=Buffer.byteLength(opts.body);await new Promise(r=>setTimeout(r,delay));if(fail)throw Error('synthetic network failure');bytes+=Buffer.byteLength(wire);return {ok:true,json:async()=>{const t=performance.now(),v=JSON.parse(wire);parseMs+=performance.now()-t;return v;}};};
 context.fetch=response;context.requestApiResponse=async(op,opts)=>{const responseValue=await response('',opts);return{response:responseValue,data:await responseValue.json()};};
 if(spec[0]==='operations.html')context.state.session='TEST-a';vm.createContext(context);
 if(!baseline)vm.runInContext(fs.readFileSync('data-read-client.js','utf8'),context);
 vm.runInContext(take(read(spec[0]),spec[1],spec[2]),context);
 return {c:context,call:(op=spec[4],p=spec[5])=>context[spec[3]](op,p),stats:()=>({calls,bytes,parseMs}),fail:v=>{fail=v;}};
}
(async()=>{const results=[];
for(const spec of specs){const x=setup(spec),start=performance.now();const values=await Promise.all(Array.from({length:4},()=>x.call()));const elapsed=performance.now()-start;for(const v of values)assert.equal(JSON.stringify(v),wire,'all amounts, unknowns, orders and staff shares preserved');assert.equal(x.stats().calls,baseline?4:1);results.push({entry:spec[0],scenario:'4 concurrent identical scoped reads',...x.stats(),elapsedMs:Math.round(elapsed),fixtureRows:80,modeledNetworkMs:40,modeledQueryMs:60,renderMs:null});await x.call();assert.equal(x.stats().calls,baseline?5:2,'settled data never cached');
 if(!baseline){const y=setup(spec,10);await Promise.all([y.call(),y.call(spec[4],{...spec[5],store:'TEST-B'}),y.call(spec[4],{...spec[5],month:'2026-11',date:'2026-11-01'}),y.call(spec[4],{...spec[5],session_token:'TEST-b'})]);assert.equal(y.stats().calls,4,'different scopes not coalesced');y.fail(true);await assert.rejects(y.call());y.fail(false);await y.call();assert.equal(y.stats().calls,6,'failure does not poison retry');const z=setup(spec,10);await Promise.all([z.call(),z.call('synthetic_save'),z.call('synthetic_save'),z.call()]);assert.equal(z.stats().calls,4,'writes never deduplicated and invalidate older reads');await z.call();assert.equal(z.stats().calls,5,'post-save refresh is fresh');}
}
// A stalled flight can be replaced after the bounded join window; its late settlement cannot remove the replacement.
if(!baseline){
 let now=0,calls=0,resolveOld,resolveNew;const w={window:{},Map,Promise,Date:{now:()=>now}};vm.createContext(w);vm.runInContext(fs.readFileSync('data-read-client.js','utf8'),w);
 const request=w.window.ZysyrReadFlights.request,old=request('age',true,'scope',()=>{calls++;return new Promise(r=>resolveOld=r);});
 now=5001;const replacement=request('age',true,'scope',()=>{calls++;return new Promise(r=>resolveNew=r);});
 resolveOld('old');await old;const joined=request('age',true,'scope',()=>{calls++;return 'unexpected';});assert.equal(joined,replacement);assert.equal(calls,2);resolveNew('new');await joined;
 for(const spec of specs){const x=setup(spec,10);const first=x.call();if(spec[0]==='operations.html')x.c.state.session='TEST-new';else if(spec[0]==='frontdesk.html')x.c.state.session={session_token:'TEST-new'};
 if(spec[0]!=='perm-app.html'){await Promise.all([first,x.call()]);assert.equal(x.stats().calls,2,'actual session state separates flights');}else await first;
 }
}
if(!baseline){
 for(const spec of specs){const x=setup(spec,1);delete x.c.window.ZysyrReadFlights;await Promise.all([x.call(),x.call()]);assert.equal(x.stats().calls,2,'missing optional helper retains original requests');}
 const x=setup(specs[2],1);let attempts=0,refreshes=0;x.c.state.auth={access_token:'old'};x.c.authBridge.ensureFresh=async()=>x.c.state.auth;x.c.authBridge.forceRefresh=async()=>{refreshes++;return {access_token:'new'};};x.c.authAccessToken=()=>x.c.state.auth.access_token;x.c.isSessionInvalidError=()=>true;
 x.c.requestApiResponse=async()=>{attempts++;await new Promise(r=>setTimeout(r,5));return attempts===1?{response:{ok:false,status:401},data:{error:'expired'}}:{response:{ok:true},data:fixture};};
 const values=await Promise.all([x.call(),x.call()]);assert.equal(attempts,2,'one auth retry, no promise self-cycle');assert.equal(refreshes,1);assert.equal(JSON.stringify(values[0]),wire);
}
// Exercise the actual dashboard orchestration; renderer is stubbed (not a rendering benchmark).
const s=read('frontdesk.html'),nodes=new Proxy({}, {get:(o,k)=>o[k]||(o[k]={value:k==='today-date'?'2026-10-01':'',textContent:''})});let details=0,dash=0,renders=0;
const c={state:{session:{session_token:'TEST-a'},store:'TEST-A'},$:id=>nodes[id],localDate:()=> '2026-10-01',setBusy:()=>{},renderToday:()=>{renders++;},updateStaffOptions:()=>{},businessUI:{refresh:()=>{details++;}},toast:()=>{},api:async()=>{dash++;await new Promise(r=>setTimeout(r,100));return{store:'TEST-A',date:'2026-10-01'};}};vm.createContext(c);vm.runInContext(take(s,'    async function loadDashboard(','    $(\'today-date\').value='),c);await c.loadDashboard();assert.equal(details,baseline?2:1);results.push({entry:'frontdesk.html',scenario:'new date, details already expanded',dashboardReads:dash,businessDetailRefreshes:details,renderCalls:renders,renderMs:null});
console.log(JSON.stringify({baseline,scope:'Node VM executes actual wrappers; synthetic 40ms network + 60ms query, JSON bytes only, no real network/DB/render timing',results},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
