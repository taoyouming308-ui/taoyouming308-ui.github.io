/** One bounded, offline PostgreSQL 17 experiment. Not a runtime mitigation.
 * Fixed controls only; no raw errors, SQL, parameters, credentials or rows logged.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createDesignIdentityPostgresFixture} from './fixtures/design-identity-postgres-fixture.mjs';

globalThis.fetch=()=>{throw Error('EXTERNAL_NETWORK_FORBIDDEN');};
const PARAMETERS=['transaction_timeout','statement_timeout','idle_in_transaction_session_timeout'];
const STATES=new Set(['25P04','57014','25P03','42501','2D000']);
const quote=v=>`'${String(v).replaceAll("'","''")}'`;
const hash=v=>createHash('sha256').update(v).digest('hex');
const f=await createDesignIdentityPostgresFixture();
let passed=0,exposed=0,failed=false;
const scopeSQL=`${quote(JSON.stringify(f.scopeA))}::jsonb`;
const authorize=(token=f.credential)=>`SELECT design_identity.authorize(${quote(token)},${scopeSQL}) IS NOT NULL;`;
const clear='SELECT design_identity.clear_context();';
const idle="\\! sleep 0.5\nSELECT 1;";
const active='SELECT pg_sleep(0.5);';
const zeroOthers=parameter=>PARAMETERS.filter(p=>p!==parameter).map(p=>`SET LOCAL ${p}='0';`).join('\n');
const empty=()=>assert.equal(f.sqlAdmin('SELECT count(*) FROM design_identity.transaction_contexts;'),'0');
function state(error){
 const match=String(error?.stderr||'').match(/(?:ERROR|FATAL):\s+([A-Z0-9]{5}):/);
 return match&&STATES.has(match[1])?match[1]:'unclassified';
}
function denied(sql,expected){
 let caught;try{f.sqlAsRole(sql,f.runtimeRole);}catch(error){caught=error;}
 assert(caught,'control must fail');assert.equal(state(caught),expected,'exact reviewed SQLSTATE');
 empty();return expected;
}
function successful(sql){f.sqlAsRole(sql,f.runtimeRole);empty();}
async function check(phase,work,{exposure=false}={}){
 const start=performance.now();
 try{
  const sqlstate=await work();
  if(exposure)exposed++;else passed++;
  console.log(JSON.stringify({phase,outcome:exposure?'exposed':'expected',sqlstate:sqlstate||'none',durationMs:Math.round(performance.now()-start)}));
 }catch(error){
  failed=true;
  console.log(JSON.stringify({phase,outcome:'unexpected',sqlstate:state(error),durationMs:Math.round(performance.now()-start)}));
  throw Error('DEADLINE_EXPERIMENT_UNEXPECTED');
 }
}
function shortSession(label){
 const token=`synthetic-deadline-${label}-`+'0'.repeat(48),digest=quote(hash(token));
 f.sqlAdmin(`INSERT INTO public.employee_booking_sessions(token_hash,username,store,expires_at) VALUES(${digest},'alice',${quote(f.store)},clock_timestamp()+interval '1 hour');
 INSERT INTO design_identity.sessions(session_hash,subject_id,employment_id,membership_id,security_epoch,membership_revision,expires_at,revoked)
 VALUES(${digest},'synthetic-subject-alice','synthetic-employment-alice','synthetic-membership-alice',1,1,clock_timestamp()+interval '1.2 seconds',false);`);
 return token;
}
try{
 await check('actual_role_and_parameter_context',()=>{
  const result=f.sqlAsRole(`SELECT jsonb_build_object('role',session_user='design_identity_runtime' AND current_user=session_user,
   'restricted',NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolinherit)
   FROM pg_catalog.pg_roles WHERE rolname=current_user;
   SELECT jsonb_object_agg(name,context) FROM pg_catalog.pg_settings WHERE name IN ('transaction_timeout','statement_timeout','idle_in_transaction_session_timeout');`,f.runtimeRole).split('\n').map(JSON.parse);
  assert.deepEqual(result[0],{role:true,restricted:true});
  assert.deepEqual(result[1],Object.fromEntries(PARAMETERS.map(p=>[p,'user'])));
 });
 for(const parameter of PARAMETERS){
  const wait=parameter==='idle_in_transaction_session_timeout'?idle:active;
  const expected={transaction_timeout:'25P04',statement_timeout:'57014',idle_in_transaction_session_timeout:'25P03'}[parameter];
  await check(`${parameter}_positive`,()=>denied(`BEGIN;\n${zeroOthers(parameter)}\nSET LOCAL ${parameter}='250ms';\n${authorize()}\n${wait}\n${clear}\nCOMMIT;`,expected));
  await check(`${parameter}_set_zero`,()=>successful(`BEGIN;\n${zeroOthers(parameter)}\nSET LOCAL ${parameter}='250ms';\nSET LOCAL ${parameter}='0';\n${authorize()}\n${wait}\n${clear}\nCOMMIT;`));
  await check(`${parameter}_reset`,()=>successful(`BEGIN;\n${zeroOthers(parameter)}\nSET LOCAL ${parameter}='250ms';\nRESET ${parameter};\n${authorize()}\n${wait}\n${clear}\nCOMMIT;`));
 }
 await check('parameter_acl_revoke_does_not_remove_user_setting',()=>{
  // Scope: only this newly created, uniquely labelled disposable fixture.
  f.sqlAdmin('REVOKE SET ON PARAMETER transaction_timeout,statement_timeout,idle_in_transaction_session_timeout FROM PUBLIC,design_identity_runtime;');
  const result=f.sqlAsRole("SET transaction_timeout='0'; SET statement_timeout='0'; SET idle_in_transaction_session_timeout='0'; SELECT bool_and(setting='0') FROM pg_catalog.pg_settings WHERE name IN ('transaction_timeout','statement_timeout','idle_in_transaction_session_timeout');",f.runtimeRole);
  assert.equal(result,'t');empty();
 });
 await check('default_deferred_deadline_positive',()=>{
  const token=shortSession('deferred');
  return denied(`BEGIN;\n${authorize(token)}\n${clear}\nSELECT pg_sleep(1.5);\nCOMMIT;`,'42501');
 });
 await check('immediate_deadline_bypass',()=>{
  const token=shortSession('immediate');
  successful(`BEGIN;\n${authorize(token)}\nSET CONSTRAINTS ALL IMMEDIATE;\n${clear}\nSELECT pg_sleep(1.5);\nCOMMIT;`);
 },{exposure:true});
 await check('definer_procedure_cannot_commit',()=>{
  f.sqlAdmin(`CREATE SCHEMA design_deadline_probe AUTHORIZATION design_identity_owner;
   GRANT USAGE ON SCHEMA design_deadline_probe TO design_identity_capability,design_identity_runtime;
   GRANT CREATE ON SCHEMA design_deadline_probe TO design_identity_capability;
   CREATE PROCEDURE design_deadline_probe.commit_probe() LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN COMMIT; END $$;
   ALTER PROCEDURE design_deadline_probe.commit_probe() OWNER TO design_identity_capability;
   REVOKE ALL ON PROCEDURE design_deadline_probe.commit_probe() FROM PUBLIC;
   GRANT EXECUTE ON PROCEDURE design_deadline_probe.commit_probe() TO design_identity_runtime;
   REVOKE CREATE ON SCHEMA design_deadline_probe FROM design_identity_capability;`);
  return denied('CALL design_deadline_probe.commit_probe();','2D000');
 });
 console.log(JSON.stringify({phase:'summary',expectedControls:passed,exposures:exposed,securityFix:false,oldIncidentExplained:false}));
}finally{
 await f.cleanup();
 console.log(JSON.stringify({phase:'cleanup',exactLabelAbsent:true,experimentFailed:failed}));
}
