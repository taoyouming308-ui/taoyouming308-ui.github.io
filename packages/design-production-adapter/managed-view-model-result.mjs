/** Only finite output selection; provenance remains the shared candidate contract. */
import {types} from 'node:util';
import {DESIGN_COMPARISON_OUTPUTS} from '../analysis-engine/design-candidate.mjs';
import {parseManagedImageModelObservations} from './managed-image-model-result.mjs';
import {managedImageCanonical} from './managed-image-contracts.mjs';
const same=(a,b)=>managedImageCanonical(a)===managedImageCanonical(b);
export function parseManagedViewModelResult(bytes,{kind,allowedReviewFocus=[]}={}){try{
 if(kind==='managed_before_view')return parseManagedImageModelObservations(bytes);
 if(types.isProxy(bytes)||!types.isUint8Array(bytes)||bytes.byteLength>262144)throw 0;
 const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),c=raw?.choices;
 if(!Array.isArray(c)||c.length!==1||c[0]?.finish_reason!=='stop'||c[0]?.message?.role!=='assistant'||typeof c[0].message.content!=='string'||c[0].message.tool_calls!==undefined||c[0].message.refusal)throw 0;
 const output=JSON.parse(c[0].message.content);
 if(kind==='managed_completion_comparison'&&Object.keys(output).join()==='judgment'&&DESIGN_COMPARISON_OUTPUTS.some(x=>same(x,output.judgment)))return Object.freeze({judgment:Object.freeze({...output.judgment})});
 if(kind==='managed_completion_synthesis'&&allowedReviewFocus.length>1&&Object.keys(output).join()==='reviewFocus'&&allowedReviewFocus.some(x=>same(x,output.reviewFocus)))return Object.freeze({reviewFocus:Object.freeze({...output.reviewFocus,angles:Object.freeze([...output.reviewFocus.angles])})});
 throw 0;
 }catch{const e=new Error('MANAGED_VIEW_MODEL_RESULT_INVALID');e.code=e.message;e.retryable=false;throw e;}}
