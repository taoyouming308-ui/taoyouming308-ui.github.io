/** Default-closed Stage14 read seam; fixed SQL, no installer or credential source. */
import {Buffer} from 'node:buffer';
import {types} from 'node:util';
import {createIdentityCapabilityOperations} from './identity-capability-postgres.mjs';
import {describeIdentityArtifact,artifactReaderIdentity} from './artifact-identity-compatibility.mjs';
import {validateProductionDesignScope} from './employee-adapter.mjs';
const CODES=new Set(['ARTIFACT_PG_DISABLED','ARTIFACT_PG_INVALID','ARTIFACT_PG_DENIED','ARTIFACT_PG_TRANSACTION','ARTIFACT_PG_UNKNOWN','ARTIFACT_PG_LIMIT','ARTIFACT_ISSUER_DISABLED']);
export class ArtifactPostgresError extends Error{constructor(code){super(CODES.has(code)?code:'ARTIFACT_PG_DENIED');this.name='ArtifactPostgresError';this.code=this.message;this.retryable=false;this.outcome=code==='ARTIFACT_PG_UNKNOWN'?'uncertain':'withheld';}}
export const artifactPGFail=code=>{throw new ArtifactPostgresError(code);};
export const artifactCanonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(artifactCanonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+artifactCanonical(v[k])).join(',')+'}';
export const artifactEqual=(a,b)=>artifactCanonical(a)===artifactCanonical(b);
export function artifactCopy(input,max=64*1024*1024+65536){
 let bytes=0,nodes=0;const charge=n=>{bytes+=n;if(bytes>max)artifactPGFail('ARTIFACT_PG_LIMIT');};
 function walk(v,d){if(++nodes>1500000||d>90||types.isProxy(v))artifactPGFail('ARTIFACT_PG_LIMIT');if(v===null||['string','boolean','number'].includes(typeof v)){if(typeof v==='number'&&(!Number.isFinite(v)||Object.is(v,-0)))artifactPGFail('ARTIFACT_PG_INVALID');charge(Buffer.byteLength(JSON.stringify(v)));return v;}
  if(!v||typeof v!=='object'||Object.getPrototypeOf(v)!==(Array.isArray(v)?Array.prototype:Object.prototype))artifactPGFail('ARTIFACT_PG_INVALID');const keys=Reflect.ownKeys(v);
  if(Array.isArray(v)){if(keys.length!==v.length+1)artifactPGFail('ARTIFACT_PG_INVALID');charge(2+Math.max(0,v.length-1));return Array.from({length:v.length},(_,i)=>{const p=Object.getOwnPropertyDescriptor(v,String(i));if(!p?.enumerable||!Object.hasOwn(p,'value'))artifactPGFail('ARTIFACT_PG_INVALID');return walk(p.value,d+1);});}
  charge(2+Math.max(0,keys.length-1));const r={};for(const key of keys){if(typeof key!=='string'||['__proto__','prototype','constructor'].includes(key))artifactPGFail('ARTIFACT_PG_INVALID');const p=Object.getOwnPropertyDescriptor(v,key);if(!p?.enumerable||!Object.hasOwn(p,'value'))artifactPGFail('ARTIFACT_PG_INVALID');charge(Buffer.byteLength(JSON.stringify(key))+1);r[key]=walk(p.value,d+1);}return r;
 }return walk(input,0);
}
export function artifactExact(v,keys){if(!v||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))artifactPGFail('ARTIFACT_PG_INVALID');}
export function artifactId(v){if(typeof v!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(v))artifactPGFail('ARTIFACT_PG_INVALID');return v;}
export function validateArtifactLocator(input){const v=artifactCopy(input,4096);artifactExact(v,['kind','id','version','scope']);artifactId(v.id);if(!['private_media','candidate','full_version'].includes(v.kind)||!Number.isSafeInteger(v.version)||v.version<1||v.version>100||(v.kind!=='full_version'&&v.version!==1))artifactPGFail('ARTIFACT_PG_INVALID');v.scope=validateProductionDesignScope(v.scope);return v;}
const transactions=new WeakMap(),leased=new WeakSet();
/** Shared fixed transaction runner. acquireClient is trusted server composition, never request data. */
export async function artifactTransaction(acquireClient,work,{identity=true}={}){
 let client,owned=false,open=false,beginAttempted=false,commitAttempted=false,committed=false,closed=false,busy=false,poisoned=false,finalizing=false,pending=null,authority=null;const guards=[];
 const usable=()=>{if(!open||closed||busy||poisoned){poisoned=true;artifactPGFail('ARTIFACT_PG_TRANSACTION');}};
 async function query(sql,params=[]){usable();busy=true;try{pending=Promise.resolve().then(()=>client.query(sql,params));return await pending;}catch(error){poisoned=true;throw error;}finally{busy=false;pending=null;}}
 async function scalar(sql,params=[]){const r=await query(sql,params);if(r?.rowCount!==1||r.rows?.length!==1)artifactPGFail('ARTIFACT_PG_INVALID');artifactExact(r.rows[0],['value']);return artifactCopy(r.rows[0].value);}
 try{
  client=await acquireClient();if(!client||types.isProxy(client)||typeof client.query!=='function'||typeof client.release!=='function'||leased.has(client))artifactPGFail('ARTIFACT_PG_TRANSACTION');leased.add(client);owned=true;open=true;beginAttempted=true;
  if((await query('BEGIN ISOLATION LEVEL READ COMMITTED')).command!=='BEGIN')artifactPGFail('ARTIFACT_PG_TRANSACTION');
  await query("SET LOCAL lock_timeout='5s'");await query("SET LOCAL statement_timeout='30s'");await query("SET LOCAL idle_in_transaction_session_timeout='30s'");await query('SET LOCAL search_path=pg_catalog');
  // Same lock as ALL supported legacy executor writes, not a new uncoordinated scope lock.
  await scalar("SELECT pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0)) AS value");
  const ops=createIdentityCapabilityOperations({query});
  const tx=Object.freeze({
   async resolveAuthority(input){usable();if(!identity)artifactPGFail('ARTIFACT_PG_TRANSACTION');const a=await ops.resolveAuthority(artifactCopy(input,4096));if(authority&&!artifactEqual(a,authority))artifactPGFail('ARTIFACT_PG_DENIED');authority=a;return a;},
   async loadArtifacts(input){usable();if(!authority)artifactPGFail('ARTIFACT_PG_DENIED');const v=artifactCopy(input,8192);artifactExact(v,['operation','scope','ids']);if(!artifactEqual(v.scope,authority.scope)||!['media_read','media_references','candidate_load','history_load'].includes(v.operation)||!Array.isArray(v.ids)||v.ids.length>30||new Set(v.ids).size!==v.ids.length)artifactPGFail('ARTIFACT_PG_INVALID');v.ids.forEach(artifactId);const items=await scalar('SELECT design_artifact.load_artifacts($1::jsonb) AS value',[v]);if(!Array.isArray(items))artifactPGFail('ARTIFACT_PG_INVALID');items.forEach(describeIdentityArtifact);return items;},
   async readAttestations(input){usable();if(!authority)artifactPGFail('ARTIFACT_PG_DENIED');const v=artifactCopy(input,16384);artifactExact(v,['artifact','reader']);if(!artifactEqual(v.reader,artifactReaderIdentity(authority)))artifactPGFail('ARTIFACT_PG_DENIED');return scalar('SELECT design_artifact.read_attestations($1::jsonb,$2::jsonb) AS value',[v.artifact,v.reader]);},
   async now(){if(identity&&!authority)artifactPGFail('ARTIFACT_PG_DENIED');const n=Number(await scalar('SELECT floor(extract(epoch from clock_timestamp())*1000)::bigint::text AS value'));if(!Number.isSafeInteger(n)||n<0)artifactPGFail('ARTIFACT_PG_INVALID');return n;},
   beforeCommit(guard){usable();if(finalizing||typeof guard!=='function'||guards.length){poisoned=true;artifactPGFail('ARTIFACT_PG_TRANSACTION');}guards.push(guard);}
  });
  transactions.set(tx,{scalar,usable,get authority(){return authority;}});
  const result=await (identity?work(tx):work(tx,{scalar}));if(busy||poisoned||identity&&(!authority||guards.length!==1))artifactPGFail('ARTIFACT_PG_TRANSACTION');
  finalizing=true;for(const guard of guards){await guard();if(busy||poisoned)artifactPGFail('ARTIFACT_PG_TRANSACTION');}if(identity){await ops.recheck(authority);await ops.clear();}
  commitAttempted=true;if((await query('COMMIT')).command!=='COMMIT')artifactPGFail('ARTIFACT_PG_TRANSACTION');committed=true;open=false;return result;
 }catch(error){poisoned=true;if(pending)try{await pending;}catch{}let badRollback=false;if(owned&&beginAttempted&&!committed)try{if((await client.query('ROLLBACK',[])).command!=='ROLLBACK')badRollback=true;}catch{badRollback=true;}if(commitAttempted||badRollback)artifactPGFail('ARTIFACT_PG_UNKNOWN');if(error instanceof ArtifactPostgresError)throw new ArtifactPostgresError(error.code);artifactPGFail('ARTIFACT_PG_DENIED');
 }finally{closed=true;open=false;if(owned)try{await client.release(committed?undefined:new Error('Discard artifact transaction'));leased.delete(client);}catch{artifactPGFail('ARTIFACT_PG_UNKNOWN');}}
}
/** issuer.verify is protected-row provenance, not a signature/key or historical-author claim. */
export function createPostgresArtifactAccessRepository({enabled=false,acquireClient}={}){
 const repository=Object.freeze({async withReadTransaction(work){if(enabled!==true||typeof acquireClient!=='function'||typeof work!=='function')artifactPGFail('ARTIFACT_PG_DISABLED');return artifactTransaction(acquireClient,work);}});
 const issuer=Object.freeze({async verify(proof,{authority,artifact,reader,transaction}={}){if(enabled!==true)artifactPGFail('ARTIFACT_PG_DISABLED');const state=transactions.get(transaction);if(!state||!artifactEqual(authority,state.authority)||!artifactEqual(reader,artifactReaderIdentity(authority)))artifactPGFail('ARTIFACT_PG_DENIED');state.usable();return await state.scalar('SELECT design_artifact.verify_attestation($1::jsonb,$2::jsonb,$3::jsonb) AS value',[artifactCopy(proof,32768),artifactCopy(artifact,8192),artifactCopy(reader,4096)])===true;}});
 return Object.freeze({repository,issuer});
}
