/** Public task DTO checks only, never an authorization or execution proof. */
const clone=v=>JSON.parse(JSON.stringify(v));
const fail=()=>{throw Object.assign(Error('INVALID_SYNTHESIS_OPERATION'),{code:'INVALID_SYNTHESIS_OPERATION',outcome:'unknown',retryable:false});};
const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join('|')!==[...keys].sort().join('|'))fail();};
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const id=v=>typeof v==='string'&&v.length>0&&v.length<=160&&v===v.trim()&&!/[\x00-\x1f\x7f]/.test(v);
const integer=(v,min=0)=>Number.isSafeInteger(v)&&v>=min;
export const SYNTHESIS_OPERATION_STATES=Object.freeze(['queued','leased','dispatch_claimed','completed','uncertain','not_sent','cancelled']);
export function checkedSynthesisOperation(value){
 exact(value,['schemaVersion','id','requestId','side','state','revision','createdAt','updatedAt','expiresAt','sourceBinding','candidateId','resultAvailable','cancelRequested']);
 if(value.schemaVersion!=='design-synthesis-operation-v1'||!sha(value.id)||typeof value.requestId!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(value.requestId)||!['left','right'].includes(value.side)||!SYNTHESIS_OPERATION_STATES.includes(value.state)||!integer(value.revision,1)||![value.createdAt,value.updatedAt,value.expiresAt].every(x=>integer(x))||value.updatedAt<value.createdAt||value.expiresAt<=value.createdAt||typeof value.resultAvailable!=='boolean'||typeof value.cancelRequested!=='boolean')fail();
 if(value.resultAvailable?(value.state!=='completed'||value.cancelRequested||!sha(value.candidateId)):value.candidateId!==null)fail();
 const s=value.sourceBinding;exact(s,['workflowRevision','workflowSha256','sessionId','sessionRevision','sessionDigest','manifestId','manifestFingerprint']);
 if(!integer(s.workflowRevision)||s.workflowRevision>1000||!integer(s.sessionRevision)||s.sessionRevision>1000||!sha(s.workflowSha256)||!id(s.sessionId)||!sha(s.sessionDigest)||(s.manifestId===null?s.manifestFingerprint!==null:!id(s.manifestId)||!sha(s.manifestFingerprint)))fail();
 return clone(value);
}
export function checkedSynthesisOperationResult(value,{nullable=false}={}){
 exact(value,['operation']);if(value.operation===null&&nullable)return {operation:null};return {operation:checkedSynthesisOperation(value.operation)};
}
export function checkedSynthesisOperationList(value){
 exact(value,['operations']);if(!Array.isArray(value.operations)||value.operations.length>20)fail();const ids=new Set(),requests=new Set();
 const operations=value.operations.map(x=>{const op=checkedSynthesisOperation(x);if(ids.has(op.id)||requests.has(op.requestId))fail();ids.add(op.id);requests.add(op.requestId);return op;});return {operations};
}
