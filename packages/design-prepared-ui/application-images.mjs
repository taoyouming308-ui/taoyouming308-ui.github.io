/** Browser-only application source status. A manifest reference is not a decode proof. */
const fail=()=>{const e=new Error('APPLICATION_IMAGE_STATUS_INVALID');e.code=e.message;e.outcome='unknown';throw e;};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
function exact(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype||Reflect.ownKeys(v).length!==keys.length)fail();for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k);if(!d?.enumerable||!Object.hasOwn(d,'value'))fail();}}
export function checkedApplicationImageStatus(v,{scope,mediaId,requestId}={}){
 exact(v,['schemaVersion','scope','mediaId','requestId','stage','angle','source','state','synthetic','productionEligible','modelSubmissionAuthorized']);
 if(v.schemaVersion!=='design-application-image-status-v1'||!id(v.mediaId)||!id(v.requestId)||!['before','after'].includes(v.stage)||!['front','back','left','right'].includes(v.angle)||!['pending','uncertain','stored','terminated'].includes(v.state)||v.synthetic!==true||v.productionEligible!==false||v.modelSubmissionAuthorized!==false)fail();
 exact(v.scope,['customerProfileId','visitId','assignmentSource']);if(!Object.values(v.scope).every(x=>typeof x==='string'&&x.length>0&&x.length<=160)||!['appointment','frontdesk'].includes(v.scope.assignmentSource))fail();
 if(scope&&Object.keys(v.scope).some(k=>v.scope[k]!==scope[k])||mediaId&&v.mediaId!==mediaId||requestId&&v.requestId!==requestId)fail();
 if(v.state==='stored'){exact(v.source,['manifestId','revision','digest']);if(!/^content-manifest-[a-f0-9]{64}$/.test(v.source.manifestId)||!Number.isSafeInteger(v.source.revision)||v.source.revision<1||v.source.revision>1000||!/^[a-f0-9]{64}$/.test(v.source.digest))fail();}else if(v.source!==null)fail();
 return JSON.parse(JSON.stringify(v));
}
export function checkedApplicationPreparation(v,{mediaId,requestId,source}={}){
 exact(v,['schemaVersion','requestId','state','taskId','source','synthetic','modelDispatched']);exact(v.source,['mediaId','reference']);exact(v.source.reference,['manifestId','revision','digest']);
 const ref=v.source.reference;if(v.schemaVersion!=='design-application-prepare-status-v1'||!id(v.requestId)||!id(v.source.mediaId)||!['missing','pending','ready','failed'].includes(v.state)||v.synthetic!==true||v.modelDispatched!==false||(v.state==='ready'?!id(v.taskId):v.taskId!==null)||!/^content-manifest-[a-f0-9]{64}$/.test(ref.manifestId)||!Number.isSafeInteger(ref.revision)||ref.revision<1||ref.revision>1000||!/^[a-f0-9]{64}$/.test(ref.digest))fail();
 if(mediaId&&v.source.mediaId!==mediaId||requestId&&v.requestId!==requestId||source&&Object.keys(ref).some(k=>ref[k]!==source[k]))fail();return JSON.parse(JSON.stringify(v));
}
