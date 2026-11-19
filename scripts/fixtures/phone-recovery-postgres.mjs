/** Synthetic-only pg_dump/pg_dumpall and new-container restore. No real target
 * host can be supplied. Never a production migration or restore command. */
import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {randomUUID} from 'node:crypto';
const db='design_executor_synthetic',quote=s=>"'"+s.replaceAll("'","''")+"'";
const run=(args,input)=>execFileSync('docker',args,{input,stdio:['pipe','pipe','pipe'],timeout:30000,maxBuffer:32*1024*1024});
function owned(f,label){assert(/^design-workflow-synthetic-[0-9]+-[a-f0-9]{8}$/.test(f.container));assert.equal(f.db,db);const v=JSON.parse(run(['inspect',f.container]));assert.equal(v.length,1);assert.equal(v[0].Config.Labels[label],f.container);assert.equal(v[0].HostConfig.NetworkMode,'none');assert.equal(Object.keys(v[0].HostConfig.PortBindings??{}).length,0);assert(v[0].Mounts.every(m=>m.Type==='tmpfs'));}
export function captureSyntheticRecoveryDatabase(f){
 owned(f,'design.workflow.fixture');assert.equal(f.sqlAdmin("SELECT count(*) FROM pg_stat_activity WHERE datname='design_executor_synthetic' AND application_name='identity-runtime'"),'0','runtime must be fully closed before matching snapshot');
 const databaseDump=run(['exec',f.container,'pg_dump','-h','127.0.0.1','-U','postgres','-w','--format=custom','--create','--dbname',db]);
 const roles=run(['exec',f.container,'pg_dumpall','-h','127.0.0.1','-U','postgres','-w','--roles-only','--no-role-passwords']);
 assert.equal(databaseDump.subarray(0,5).toString(),'PGDMP');assert(!/\bPASSWORD\s+'/i.test(roles.toString()));return {databaseDump,roles};
}
// Compare effective privileges, not ACL text order or NULL versus its defined
// PostgreSQL default. Grantor/grantee, each privilege and grant-option stay exact.
const acl=(value,kind,owner)=>`(SELECT jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,'privilege',a.privilege_type,'grantOption',a.is_grantable) ORDER BY pg_get_userbyid(a.grantor),CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable) FROM aclexplode(coalesce(${value},acldefault(${kind},${owner}))) a)`;
export const syntheticRecoveryContractSQL=`SELECT jsonb_build_object(
 'database',(SELECT jsonb_build_object('owner',pg_get_userbyid(datdba),'acl',${acl('datacl',"'d'",'datdba')},'encoding',encoding,'collate',datcollate,'ctype',datctype,'connectionLimit',datconnlimit) FROM pg_database WHERE datname='design_executor_synthetic'),
 'schemas',(SELECT jsonb_agg(jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner),'acl',${acl('nspacl',"'n'",'nspowner')}) ORDER BY nspname) FROM pg_namespace WHERE nspname IN ('public','auth') OR nspname LIKE 'design_%'),
 'defaultACLs',(SELECT jsonb_agg(jsonb_build_object('owner',pg_get_userbyid(d.defaclrole),'schema',coalesce(n.nspname,''),'kind',d.defaclobjtype,'acl',${acl('d.defaclacl','d.defaclobjtype','d.defaclrole')}) ORDER BY pg_get_userbyid(d.defaclrole),coalesce(n.nspname,''),d.defaclobjtype) FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace),
 'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY rolname) FROM (SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil,rolconfig FROM pg_roles WHERE rolname NOT LIKE 'pg_%') r),
 'memberships',(SELECT jsonb_agg(jsonb_build_object('role',r.rolname,'member',m.rolname,'grantor',g.rolname,'admin',x.admin_option,'inherit',x.inherit_option,'set',x.set_option) ORDER BY r.rolname,m.rolname,g.rolname) FROM pg_auth_members x JOIN pg_roles r ON r.oid=x.roleid JOIN pg_roles m ON m.oid=x.member JOIN pg_roles g ON g.oid=x.grantor WHERE r.rolname NOT LIKE 'pg_%' OR m.rolname NOT LIKE 'pg_%'),
 'relations',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'acl',${acl('c.relacl',"CASE WHEN c.relkind='S' THEN 's'::\"char\" ELSE 'r'::\"char\" END",'c.relowner')},'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth') OR n.nspname LIKE 'design_%'),
 'functions',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'args',pg_get_function_identity_arguments(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',${acl('p.proacl',"'f'",'p.proowner')},'definition',pg_get_functiondef(p.oid)) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind='f' AND (n.nspname IN ('public','auth') OR n.nspname LIKE 'design_%')),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p WHERE schemaname IN ('public','auth') OR schemaname LIKE 'design_%'))::text`;
export async function restoreSyntheticRecoveryDatabase({databaseDump,roles}={}){
 assert(databaseDump instanceof Uint8Array&&Buffer.from(databaseDump).subarray(0,5).toString()==='PGDMP');assert(roles instanceof Uint8Array);
 const container='design-workflow-synthetic-'+process.pid+'-'+randomUUID().slice(0,8),f={container,db,offlineRecoveryFixture:true};let attempted=false,cleaned=false;
 const sqlAdmin=(sql,database=db)=>run(['exec','-i',container,'psql','-X','-qAt','-h','127.0.0.1','-U','postgres','-w','-d',database,'-v','ON_ERROR_STOP=1'],sql).toString().trim();
 async function cleanup(){if(cleaned)return;const names=run(['ps','-a','--filter','name=^/'+container+'$','--format','{{.Names}}']).toString().trim();if(names){owned(f,'design.recovery.fixture');run(['stop','-t','0',container]);}let gone=false;for(let i=0;i<80;i++){if(run(['ps','-a','--filter','name=^/'+container+'$','--format','{{.Names}}']).toString().trim()===''){gone=true;break;}await new Promise(r=>setTimeout(r,30));}assert(gone,'exact recovery fixture removal confirmed');cleaned=true;}
 try{
  run(['image','inspect','postgres:17']);attempted=true;run(['run','--rm','--pull=never','-d','--network=none','--name',container,'--label','design.recovery.fixture='+container,'--tmpfs','/var/lib/postgresql/data:rw,size=268435456','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);
  let ready=false;for(let i=0;i<150;i++){try{if(sqlAdmin('SELECT 1','postgres')==='1'){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,30));}assert(ready);owned(f,'design.recovery.fixture');
  assert.equal(sqlAdmin('SELECT count(*) FROM pg_database WHERE datname='+quote(db),'postgres'),'0','target has no former schema or metadata');
  const roleSql=Buffer.from(roles).toString();assert.equal((roleSql.match(/^CREATE ROLE postgres;$/gm)??[]).length,1);assert(!/\bPASSWORD\s+'/i.test(roleSql));
  // Fresh initdb necessarily owns one existing postgres role. Keep its ALTER
  // definition; remove exactly its duplicate CREATE and no other error/role.
  sqlAdmin(roleSql.replace(/^CREATE ROLE postgres;$/m,'-- Existing fresh initdb postgres role.'),'postgres');
  run(['exec','-i',container,'pg_restore','-h','127.0.0.1','-U','postgres','-w','--create','--exit-on-error','--dbname','postgres'],databaseDump);
  assert.equal(sqlAdmin('SELECT count(*) FROM design_key_private.key_versions'),'0');
  const tokens=Object.fromEntries(['manager','alice','bob'].map(n=>[n,'synthetic-'+n+'-'+'0'.repeat(64)]));
  return {...f,sqlAdmin,runtimeRole:'design_identity_runtime',scopeA:{customerProfileId:'11',visitId:'booking:101',assignmentSource:'appointment'},scopeB:{customerProfileId:'12',visitId:'booking:102',assignmentSource:'appointment'},store:'自由手艺人',credential:tokens.alice,tokens,cleanup};
 }catch(e){if(attempted)await cleanup();throw e;}
}
