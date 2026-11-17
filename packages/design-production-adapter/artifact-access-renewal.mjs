/** Independent explicit authorization and artifact issuer. No runtime/default renewal. */
import {artifactTransaction,artifactCopy,artifactExact,artifactId,artifactPGFail} from './postgres-artifact-access-repository.mjs';
const intentKeys=['authorizationId','requestId','baseAttestationId','expectedRevision','expectedHeadDigest','action','expiresAt'];
function input(raw,authorization=false){const v=artifactCopy(raw,16384);artifactExact(v,authorization?[...intentKeys,'authorizationExpiresAt']:intentKeys);for(const k of ['authorizationId','requestId','baseAttestationId'])artifactId(v[k]);if(v.requestId.length>80||!Number.isSafeInteger(v.expectedRevision)||v.expectedRevision<1||v.expectedRevision>1000||typeof v.expectedHeadDigest!=='string'||!/^[a-f0-9]{64}$/.test(v.expectedHeadDigest)||!['renew','regrant','revoke'].includes(v.action)||!Number.isSafeInteger(v.expiresAt)||v.expiresAt<1||authorization&&(!Number.isSafeInteger(v.authorizationExpiresAt)||v.authorizationExpiresAt<1))artifactPGFail('ARTIFACT_PG_INVALID');return v;}
function simple(raw,key){const v=artifactCopy(raw,1024);artifactExact(v,[key]);artifactId(v[key]);return v;}
export function createArtifactRenewalIssuer({enabled=false,acquireIssuerClient}={}){
 const ready=()=>{if(enabled!==true||typeof acquireIssuerClient!=='function')artifactPGFail('ARTIFACT_ISSUER_DISABLED');};
 return Object.freeze({
  async head(raw){ready();const v=simple(raw,'baseAttestationId');return artifactTransaction(acquireIssuerClient,async(_,{scalar})=>scalar('SELECT design_artifact_renewal.issuer_head($1::text) AS value',[v.baseAttestationId]),{identity:false});},
  async apply(raw){ready();const v=input(raw);return artifactTransaction(acquireIssuerClient,async(_,{scalar})=>scalar('SELECT design_artifact_renewal.apply_revision($1::jsonb) AS value',[v]),{identity:false});}
 });
}
/** Dedicated authorizer connection, not the artifact issuer or authenticated employee session. */
export function createArtifactRenewalAuthorizationIssuer({enabled=false,acquireAuthorizationClient}={}){
 const ready=()=>{if(enabled!==true||typeof acquireAuthorizationClient!=='function')artifactPGFail('ARTIFACT_ISSUER_DISABLED');};
 return Object.freeze({
  async authorize(raw){ready();const v=input(raw,true);return artifactTransaction(acquireAuthorizationClient,async(_,{scalar})=>scalar('SELECT design_artifact_renewal.authorize_intent($1::jsonb) AS value',[v]),{identity:false});},
  async revoke(raw){ready();const v=simple(raw,'authorizationId');return artifactTransaction(acquireAuthorizationClient,async(_,{scalar})=>scalar('SELECT design_artifact_renewal.revoke_intent($1::text) AS value',[v.authorizationId]),{identity:false});}
 });
}
