/** Stage37 response audit. Exact DTO validators remain production-owned;
 * this additional test oracle rejects private structural lanes and the actual
 * synthetic object's locators. It does not rewrite/redact server responses. */
import assert from 'node:assert/strict';
const PRIVATE_KEYS=new Set(['task','report','object','authority','receipt','sourceRecord','parentResponse','parentObjectReceipt','objectReceipt','verificationReport','verificationBinding','processingProvenance','claimedArtifact','managedImageHistory','normalizedBinding','imageBinding','keyBinding','keyRecord','approvedIntent','approvedReceipt','sealed','projectOrigin','bucket']);
export function assertBrowserPrivateDataAbsent(value,{locators=[]}={}){
 const visit=(v,path='$')=>{if(v===null||typeof v!=='object')return;for(const [key,child] of Object.entries(v)){assert(!PRIVATE_KEYS.has(key),'private structural key at '+path+'.'+key);visit(child,path+'.'+key);}};
 visit(value);const encoded=JSON.stringify(value);for(const locator of locators){assert.equal(typeof locator,'string');assert(locator.length>8);assert(!encoded.includes(locator),'private synthetic locator was transported');}return true;
}
