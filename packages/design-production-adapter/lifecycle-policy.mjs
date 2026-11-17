/** Explicit server-owned lifecycle decisions; no imported status is automatically active. */
import {createHash} from 'node:crypto';
export class VisitLifecycleError extends Error {
  constructor(code){super(code);this.name='VisitLifecycleError';this.code=code;}
}
const fail=code=>{throw new VisitLifecycleError(code);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const text=v=>typeof v==='string'&&v.length>0&&v.length<=160&&v===v.trim()&&!/[\u0000-\u001f\u007f]/.test(v);
export function visitLifecycleRowDigest(row){
  const keys=['source','visitId','id','staffUsername','store','bookingDate','status'];
  if(!plain(row)||Object.keys(row).sort().join('|')!==keys.sort().join('|')||!['appointment','frontdesk'].includes(row.source)||!keys.filter(k=>!['source','status'].includes(k)).every(k=>text(row[k]))||!(Number.isSafeInteger(row.status)||text(row.status)))fail('LIFECYCLE_INVALID_ROW');
  return createHash('sha256').update(canonical(row)).digest('hex');
}
/** The deployment owner must explicitly approve policy revisions AND issue exact current decisions. */
export function createExplicitVisitLifecyclePolicy({approvedPolicyRevisions=[]}={}){
  if(!Array.isArray(approvedPolicyRevisions)||approvedPolicyRevisions.length>100||new Set(approvedPolicyRevisions).size!==approvedPolicyRevisions.length||!approvedPolicyRevisions.every(text))fail('LIFECYCLE_CONFIGURATION_INVALID');
  const approved=new Set(approvedPolicyRevisions);
  return Object.freeze({evaluate({row,decision,now}){
    const sha=visitLifecycleRowDigest(row);
    if(!Number.isSafeInteger(now)||now<0||!plain(decision)||Object.keys(decision).sort().join('|')!==['allowed','expiresAt','policyRevision','rowSha256'].sort().join('|')||decision.allowed!==true||!approved.has(decision.policyRevision)||decision.rowSha256!==sha||!Number.isSafeInteger(decision.expiresAt)||decision.expiresAt<=now)fail('LIFECYCLE_UNCONFIRMED');
    return Object.freeze({allowed:true,policyRevision:decision.policyRevision});
  }});
}
