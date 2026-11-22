/** Independent issuer process only. Never pass its connection factory to runtime. */
import {artifactTransaction,artifactCopy,artifactExact,artifactId,validateArtifactLocator,artifactEqual,artifactPGFail} from './postgres-artifact-access-repository.mjs';
import {describeIdentityArtifact} from './artifact-identity-compatibility.mjs';
export function createArtifactAccessIssuer({enabled=false,acquireIssuerClient}={}){
 const ready=()=>{if(enabled!==true||typeof acquireIssuerClient!=='function')artifactPGFail('ARTIFACT_ISSUER_DISABLED');};
 return Object.freeze({
  async issue(input){ready();const r=artifactCopy(input,16384);artifactExact(r,['requestId','expectedRevision','locator','reader','expiresAt']);artifactId(r.requestId);if(r.requestId.length>80)artifactPGFail('ARTIFACT_PG_INVALID');r.locator=validateArtifactLocator(r.locator);artifactExact(r.reader,['subjectId','employmentId','membershipId','storeId','securityEpoch','membershipRevision','bindingRevision']);if(r.expectedRevision!==0||!Number.isSafeInteger(r.expiresAt))artifactPGFail('ARTIFACT_PG_INVALID');
   return artifactTransaction(acquireIssuerClient,async(tx,{scalar})=>{
    // Loads the authoritative source on the issuer connection. No external payload/digest accepted.
    const item=await scalar('SELECT design_artifact.issuer_source($1::jsonb,$2::jsonb) AS value',[r.locator,r.reader]);const artifact=describeIdentityArtifact(item);if(!artifactEqual(Object.fromEntries(['kind','id','version','scope'].map(k=>[k,artifact[k]])),r.locator))artifactPGFail('ARTIFACT_PG_DENIED');
    return scalar('SELECT design_artifact.issue_attestation($1::jsonb,$2::jsonb,$3::jsonb) AS value',[r,item,artifact]);
   },{identity:false});
  },
  async revoke(input){ready();const r=artifactCopy(input,4096);artifactExact(r,['requestId','attestationId','expectedRevision']);artifactId(r.requestId);if(r.requestId.length>80)artifactPGFail('ARTIFACT_PG_INVALID');artifactId(r.attestationId);if(!Number.isSafeInteger(r.expectedRevision)||r.expectedRevision<1)artifactPGFail('ARTIFACT_PG_INVALID');return artifactTransaction(acquireIssuerClient,async(_tx,{scalar})=>scalar('SELECT design_artifact.revoke_attestation($1::jsonb) AS value',[r]),{identity:false});}
 });
}
