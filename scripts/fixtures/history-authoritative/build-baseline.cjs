// Reconstruct catalog metadata only. No production rows, credentials or schema stubs.
const fs=require('node:fs'),path=require('node:path');
const read=name=>JSON.parse(fs.readFileSync(path.join(__dirname,name+'.json'),'utf8'));
const qi=s=>'"'+String(s).replaceAll('"','""')+'"',ql=s=>"'"+String(s).replaceAll("'","''")+"'";
const ident=x=>qi(x.schema_name)+'.'+qi(x.relname||x.proname);
module.exports=function(){
 const tables=read('tables'),schemas=read('schemas'),functions=[...read('functions'),...read('extra-functions')];
 const roles=new Set(['anon','authenticated','service_role']);
 for(const x of [...tables,...schemas]){roles.add(x.owner);for(const g of x.grants||[])roles.add(g.grantee)}
 for(const f of functions){roles.add(f.owner);for(const x of (f.acl||'').slice(1,-1).split(',')){if(x)roles.add(x.split('=')[0]||'PUBLIC')}}
 let out=['set check_function_bodies=on;'];
 for(const r of roles)if(r!=='PUBLIC')out.push(`do $$begin if not exists(select 1 from pg_roles where rolname=${ql(r)}) then create role ${qi(r)}${r==='service_role'?' bypassrls':''};end if;end$$;`);
 for(const s of schemas)out.push(`create schema if not exists ${qi(s.schema_name)};alter schema ${qi(s.schema_name)} owner to ${qi(s.owner)};`);
 for(const t of tables){
  const columns=t.columns.map(c=>{if(c.default_redacted)throw Error('Redacted default prevents exact replay: '+t.relname+'.'+c.name);return qi(c.name)+' '+c.type+(c.identity?' generated '+(c.identity==='a'?'always':'by default')+' as identity':c.generated?' generated always as ('+c.default+') stored':c.default?' default '+c.default:'')+(c.not_null?' not null':'')});
  out.push(`create table ${ident(t)} (${columns.join(',\n')});alter table ${ident(t)} owner to ${qi(t.owner)};`);
 }
 for(const foreign of [false,true])for(const t of tables)for(const c of t.constraints)if((c.type==='f')===foreign)out.push(`alter table ${ident(t)} add constraint ${qi(c.name)} ${c.definition};`);
 for(const t of tables)for(const i of t.indexes)out.push(i+';');
 // SQL-language functions are created after their function dependencies.
 const done=new Set(),pending=[...functions];
 while(pending.length){let progress=false;for(let i=pending.length-1;i>=0;i--){const f=pending[i];if(!f.definition)throw Error('Redacted function: '+f.proname);
  const refs=[...f.definition.matchAll(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\s*\(/g)].map(m=>m[1]+'.'+m[2]);
  if(refs.some(n=>n!==f.schema_name+'.'+f.proname&&functions.some(g=>g.schema_name+'.'+g.proname===n)&&!done.has(n)))continue;
  out.push(f.definition+';');out.push(`alter function ${ident(f)}(${f.identity_arguments}) owner to ${qi(f.owner)};`);
  out.push(`revoke all on function ${ident(f)}(${f.identity_arguments}) from public,anon,authenticated,service_role;`);
  for(const x of (f.acl||'{=X/postgres}').slice(1,-1).split(',')){if(!x)continue;const [role,rest]=x.split('=');if(rest.startsWith('X'))out.push(`grant execute on function ${ident(f)}(${f.identity_arguments}) to ${role?qi(role):'PUBLIC'}${rest.startsWith('X*')?' with grant option':''};`)}
  done.add(f.schema_name+'.'+f.proname);pending.splice(i,1);progress=true;
 }if(!progress)throw Error('Unresolved function dependency cycle: '+pending.map(f=>f.proname));}
 for(const t of tables){
  for(const tr of t.triggers){out.push(tr.definition+';');if(tr.enabled==='D')out.push(`alter table ${ident(t)} disable trigger ${qi(tr.name)};`);else if(tr.enabled==='A')out.push(`alter table ${ident(t)} enable always trigger ${qi(tr.name)};`);else if(tr.enabled==='R')out.push(`alter table ${ident(t)} enable replica trigger ${qi(tr.name)};`)}
  if(t.relrowsecurity)out.push(`alter table ${ident(t)} enable row level security;`);if(t.relforcerowsecurity)out.push(`alter table ${ident(t)} force row level security;`);
  for(const p of t.policies)out.push(`create policy ${qi(p.name)} on ${ident(t)} as ${p.permissive?'permissive':'restrictive'} for ${{'*':'all',r:'select',a:'insert',w:'update',d:'delete'}[p.cmd]} to ${p.roles.map(r=>r==='PUBLIC'?'PUBLIC':qi(r)).join(',')}${p.using?' using ('+p.using+')':''}${p.check?' with check ('+p.check+')':''};`);
  out.push(`revoke all on table ${ident(t)} from public,anon,authenticated,service_role;`);
  for(const g of t.grants||[])out.push(`grant ${g.privilege} on table ${ident(t)} to ${g.grantee==='PUBLIC'?'PUBLIC':qi(g.grantee)}${g.grantable?' with grant option':''};`);
 }
 for(const s of schemas){out.push(`revoke all on schema ${qi(s.schema_name)} from public,anon,authenticated,service_role;`);for(const g of s.grants||[])out.push(`grant ${g.privilege} on schema ${qi(s.schema_name)} to ${g.grantee==='PUBLIC'?'PUBLIC':qi(g.grantee)}${g.grantable?' with grant option':''};`)}
 for(const d of read('default-acls')){const target={r:'tables',S:'sequences',f:'functions',T:'types',n:'schemas'}[d.object_type];
  const prefix=`alter default privileges for role ${qi(d.owner)}${d.schema_name?' in schema '+qi(d.schema_name):''}`;
  out.push(`${prefix} revoke all on ${target} from public,anon,authenticated,service_role;`);
  for(const g of d.grants||[])out.push(`${prefix} grant ${g.privilege} on ${target} to ${g.grantee==='PUBLIC'?'PUBLIC':qi(g.grantee)}${g.grantable?' with grant option':''};`);
 }
 return out.join('\n');
};
