/** Finite visual parser only; candidate provenance/persistence is a separate contract. */
import {types} from 'node:util';
import {DESIGN_VISUAL_VALUES} from '../analysis-engine/design-candidate.mjs';
import {managedImageCanonical} from './managed-image-contracts.mjs';
export function parseManagedImageModelObservations(value){try{
 if(types.isProxy(value)||!types.isUint8Array(value)||value.byteLength>262144)throw 0;
 const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(value)),choice=raw?.choices;
 if(!Array.isArray(choice)||choice.length!==1||choice[0]?.finish_reason!=='stop'||choice[0]?.message?.role!=='assistant'||typeof choice[0]?.message?.content!=='string'||choice[0].message.tool_calls!==undefined)throw 0;
 const result=JSON.parse(choice[0].message.content);if(!result||Object.getPrototypeOf(result)!==Object.prototype||Object.keys(result).join()!=='observations'||!Array.isArray(result.observations)||result.observations.length<1||result.observations.length>2)throw 0;
 const seen=new Set();for(const o of result.observations){if(!o||Object.keys(o).sort().join()!=='field,value'||!Object.hasOwn(DESIGN_VISUAL_VALUES,o.field)||seen.has(o.field)||o.value!==null&&!DESIGN_VISUAL_VALUES[o.field].includes(o.value))throw 0;seen.add(o.field);Object.freeze(o);}Object.freeze(result.observations);managedImageCanonical(result);return Object.freeze(result);
 }catch{const e=new Error('MANAGED_MODEL_RESULT_INVALID');e.code=e.message;e.retryable=false;throw e;}}
