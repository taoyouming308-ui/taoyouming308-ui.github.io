/** Explicit renewal-chain read mode. Unenrolled/revoked chains never fall back to base proofs. */
import {artifactTransaction,artifactCopy,artifactExact,artifactEqual,artifactPGFail} from './postgres-artifact-access-repository.mjs';
import {validateImmutableDesignAuthority} from './immutable-authority.mjs';
import {artifactReaderIdentity,describeIdentityArtifact} from './artifact-identity-compatibility.mjs';
const contexts=new WeakMap();
export function createPostgresArtifactRenewalRepository({enabled=false,acquireClient}={}){
 const ready=()=>{if(enabled!==true||typeof acquireClient!=='function')artifactPGFail('ARTIFACT_PG_DISABLED');};
 const repository=Object.freeze({async withReadTransaction(work){ready();if(typeof work!=='function')artifactPGFail('ARTIFACT_PG_INVALID');return artifactTransaction(acquireClient,async(inner,{scalar})=>{
  let authority=null,guard=null,open=true,finalizing=false,poison=false;
  const usable=()=>{if(!open||poison)artifactPGFail('ARTIFACT_PG_TRANSACTION');};
  const requireAuth=()=>{usable();if(!authority){poison=true;artifactPGFail('ARTIFACT_PG_DENIED');}};
  const tx=Object.freeze({
   async resolveAuthority(input){usable();const v=artifactCopy(input,4096);artifactExact(v,['credential','scope']);const a=validateImmutableDesignAuthority(await scalar('SELECT design_identity.authorize($1::text,$2::jsonb) AS value',[v.credential,v.scope]));if(authority&&!artifactEqual(a,authority)||!artifactEqual(a.scope,v.scope)){poison=true;artifactPGFail('ARTIFACT_PG_DENIED');}authority=a;return a;},
   async loadArtifacts(input){requireAuth();const v=artifactCopy(input,8192);artifactExact(v,['operation','scope','ids']);if(!artifactEqual(v.scope,authority.scope)){poison=true;artifactPGFail('ARTIFACT_PG_DENIED');}const items=await scalar('SELECT design_artifact_renewal.load_artifacts($1::jsonb) AS value',[v]);if(!Array.isArray(items))artifactPGFail('ARTIFACT_PG_INVALID');items.forEach(describeIdentityArtifact);return items;},
   async readAttestations(input){requireAuth();const v=artifactCopy(input,16384);artifactExact(v,['artifact','reader']);if(!artifactEqual(v.reader,artifactReaderIdentity(authority))){poison=true;artifactPGFail('ARTIFACT_PG_DENIED');}return scalar('SELECT design_artifact_renewal.read_attestations($1::jsonb,$2::jsonb) AS value',[v.artifact,v.reader]);},
   async now(){requireAuth();return inner.now();},
   beforeCommit(fn){requireAuth();if(finalizing||guard||typeof fn!=='function'){poison=true;artifactPGFail('ARTIFACT_PG_TRANSACTION');}guard=fn;}
  });contexts.set(tx,{scalar,requireAuth,get authority(){return authority;}});
  try{const result=await work(tx);requireAuth();if(!guard)artifactPGFail('ARTIFACT_PG_TRANSACTION');finalizing=true;await guard();requireAuth();const a=validateImmutableDesignAuthority(await scalar('SELECT design_identity.recheck_authority() AS value'));if(!artifactEqual(a,authority))artifactPGFail('ARTIFACT_PG_DENIED');if(await scalar('SELECT design_identity.clear_context() AS value')!=='')artifactPGFail('ARTIFACT_PG_INVALID');return result;}finally{open=false;}
 },{identity:false});}});
 const issuer=Object.freeze({async verify(proof,{authority,artifact,reader,transaction}={}){ready();const c=contexts.get(transaction);if(!c||!artifactEqual(c.authority,authority)||!artifactEqual(artifactReaderIdentity(authority),reader))artifactPGFail('ARTIFACT_PG_DENIED');c.requireAuth();return await c.scalar('SELECT design_artifact_renewal.verify_attestation($1::jsonb,$2::jsonb,$3::jsonb) AS value',[artifactCopy(proof,32768),artifactCopy(artifact,8192),artifactCopy(reader,4096)])===true;}});
 return Object.freeze({repository,issuer});
}
