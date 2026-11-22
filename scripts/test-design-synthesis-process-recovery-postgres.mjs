/** Real child-process death/restart over isolated worker pg wire, never factory recreation. */
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createDurableSynthesisWorkerPostgresFixture} from './fixtures/design-durable-synthesis-worker-fixture.mjs';
globalThis.fetch=()=>{throw Error('SYNTHETIC_NETWORK_FORBIDDEN');};
const f=await createDurableSynthesisWorkerPostgresFixture(),children=new Set();let cases=0;
const quote=value=>{assert(/^[a-f0-9]{64}$/.test(value));return `'${value}'`;};
const state=id=>JSON.parse(f.sqlAdmin(`SELECT jsonb_build_object('state',state,'fence',fence,'revision',revision) FROM design_durable_synthesis.jobs WHERE operation_id=${quote(id)}`));
function launch(mode){
 const child=fork(fileURLToPath(new URL('./fixtures/design-synthesis-recovery-child.mjs',import.meta.url)),[],{stdio:['ignore','pipe','pipe','ipc'],env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:'C.UTF-8'},execArgv:[]});children.add(child);child.stdout.resume();child.stderr.resume();
 const messages=[],waiters=[];let exited=false;
 const exit=new Promise(resolve=>child.once('exit',(code,signal)=>{exited=true;children.delete(child);resolve({code,signal});for(const w of waiters.splice(0))w.reject(Error('RECOVERY_CHILD_EXIT_BEFORE_MESSAGE'));}));
 child.on('error',()=>{for(const w of waiters.splice(0))w.reject(Error('RECOVERY_CHILD_START_FAILED'));});
 child.on('message',message=>{const w=waiters.shift();if(w)w.resolve(message);else messages.push(message);});
 child.send({container:f.container,mode});
 const next=()=>{if(messages.length)return Promise.resolve(messages.shift());if(exited)return Promise.reject(Error('RECOVERY_CHILD_ALREADY_EXITED'));return new Promise((resolve,reject)=>waiters.push({resolve,reject}));};
 const bounded=async pending=>{let timer;try{return await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('RECOVERY_CHILD_DEADLINE')),40000);})]);}finally{clearTimeout(timer);}};
 return {pid:child.pid,next:()=>bounded(next()),exit:()=>bounded(exit),async kill(){if(!exited){assert(child.pid>1);assert.equal(child.kill('SIGKILL'),true);}const result=await bounded(exit);assert.equal(result.signal,'SIGKILL');}};
}
function cleanStats(stats){assert.equal(stats.activeRelayChildren,0);assert.equal(stats.totalCount,0);assert.equal(stats.idleCount,0);assert.equal(stats.waitingCount,0);}
const complete=async()=>{const p=launch('complete'),message=await p.next();assert.equal(message.type,'result',JSON.stringify(message));cleanStats(message.stats);assert.deepEqual(await p.exit(),{code:0,signal:null});return {...message,pid:p.pid};};
try{
 await f.seedLocal();await f.comparison('back');
 const first=await f.enqueue('stage24-process-before-dispatch');assert.equal(first.intent.kind,'external');
 const before=launch('prepare'),checkpoint=await before.next();assert.equal(checkpoint.type,'checkpoint',JSON.stringify(checkpoint));assert.equal(checkpoint.phase,'prepare');assert.equal(checkpoint.transportCalls,0);assert.equal(checkpoint.keyOpens,0);cleanStats(checkpoint.stats);const leased=state(first.ownerKey);assert.equal(leased.state,'leased');await before.kill();
 // Synthetic admin fixture only: expire the original lease without changing the
 // approval/job deadline or disabling immutable guards. Revision still advances.
 f.sqlAdmin(`UPDATE design_durable_synthesis.jobs SET lease_until=clock_timestamp()-interval '1 second',revision=revision+1,updated_at=clock_timestamp() WHERE operation_id=${quote(first.ownerKey)} AND state='leased'`);
 const resumed=await complete();assert.notEqual(resumed.pid,before.pid);assert.equal(resumed.result.state,'completed');assert.equal(resumed.transportCalls,1);assert.equal(resumed.keyOpens,1);assert.equal(state(first.ownerKey).state,'completed');assert(state(first.ownerKey).fence>leased.fence);console.log(`ok ${++cases} - killed actual pre-dispatch Node process; new process claims expired lease and completes once`);
 const second=await f.enqueue('stage24-process-after-dispatch');assert.equal(second.intent.kind,'external');
 const after=launch('transport'),sent=await after.next();assert.equal(sent.type,'checkpoint',JSON.stringify(sent));assert.equal(sent.phase,'transport');assert.equal(sent.transportCalls,1);assert.equal(sent.keyOpens,1);cleanStats(sent.stats);assert.equal(state(second.ownerKey).state,'dispatch_claimed');await after.kill();
 f.sqlAdmin(`UPDATE design_durable_synthesis.jobs SET lease_until=clock_timestamp()-interval '1 second',revision=revision+1,updated_at=clock_timestamp() WHERE operation_id=${quote(second.ownerKey)} AND state='dispatch_claimed'`);
 const restarted=await complete();assert.notEqual(restarted.pid,after.pid);assert.equal(restarted.result.state,'idle');assert.equal(restarted.transportCalls,0);assert.equal(restarted.keyOpens,0);assert.equal(state(second.ownerKey).state,'dispatch_claimed');assert.equal(f.sqlAdmin(`SELECT record->>'state' FROM design_policy_private.attempts WHERE owner_key=${quote(second.ownerKey)}`),'dispatch_claimed');console.log(`ok ${++cases} - killed actual process after dispatch; restarted process cannot resend unknown request`);
 console.log(`PASS ${cases} actual Node worker process-recovery checks`);
}finally{
 for(const child of [...children]){child.kill('SIGKILL');await new Promise(resolve=>child.once('exit',resolve));}
 assert.equal(children.size,0);await f.cleanup();console.log('STAGE24_PROCESS_RECOVERY_CLEANUP '+JSON.stringify({activeNodeChildren:children.size}));
}
