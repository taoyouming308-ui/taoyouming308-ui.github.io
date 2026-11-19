/** Internal fixed-call transaction utility. No credential acquisition, dynamic
 * SQL endpoint, external I/O or permission issuance is exposed to callers. */
import {types} from 'node:util';
import {policyCopy as copy,policyExact as exact,policyFreeze as freeze} from './approval-attempt-contracts.mjs';
import {validateProductionDesignScope} from './employee-adapter.mjs';
const held=new WeakSet(),quarantined=new WeakSet();
export class ContentPipelineLedgerError extends Error{constructor(code='CONTENT_PIPELINE_DENIED'){const c=['CONTENT_PIPELINE_DISABLED','CONTENT_PIPELINE_INVALID','CONTENT_PIPELINE_DENIED','CONTENT_PIPELINE_UNCERTAIN'].includes(code)?code:'CONTENT_PIPELINE_DENIED';super(c);this.code=c;this.retryable=false;this.outcome=c==='CONTENT_PIPELINE_UNCERTAIN'?'uncertain':'not_sent';}}
export const pipelineFail=c=>{throw new ContentPipelineLedgerError(c);};
export const pipelineId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(v);
export const pipelineSha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function pipelineInput(value,keys){try{const q=copy(value);exact(q,['credential','scope',...keys]);if(typeof q.credential!=='string'||q.credential.length<32||q.credential.length>200||/[\s\x00-\x1f\x7f]/.test(q.credential))pipelineFail();q.scope=validateProductionDesignScope(q.scope);return q;}catch{pipelineFail('CONTENT_PIPELINE_INVALID');}}
function scalar(v){if(!v||types.isProxy(v))pipelineFail();const d=Object.getOwnPropertyDescriptors(v);if(!['command','rowCount','rows'].every(k=>d[k]&&Object.hasOwn(d[k],'value'))||d.command.value!=='SELECT'||d.rowCount.value!==1)pipelineFail();const rows=copy(d.rows.value);if(!Array.isArray(rows)||rows.length!==1)pipelineFail();exact(rows[0],['value']);return rows[0].value;}
export function createPipelineFixedExecutor({enabled=false,acquireClient}={}){return async({sql,params,validate,finalSql,finalParams,finalValidate})=>{
 if(enabled!==true||typeof acquireClient!=='function')pipelineFail('CONTENT_PIPELINE_DISABLED');let c,q,release,owned=false,started=false,committing=false,committed=false;
 try{c=await acquireClient();if(!c||types.isProxy(c)||held.has(c)||quarantined.has(c))pipelineFail();const method=k=>{const d=Object.getOwnPropertyDescriptor(c,k);if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function'||types.isProxy(d.value))pipelineFail();return(...a)=>Reflect.apply(d.value,c,a);};q=method('query');release=method('release');held.add(c);owned=true;started=true;
 if((await q('BEGIN ISOLATION LEVEL READ COMMITTED',[])).command!=='BEGIN')pipelineFail();for(const s of ["SET LOCAL statement_timeout='5000ms'","SET LOCAL lock_timeout='2000ms'","SET LOCAL idle_in_transaction_session_timeout='10000ms'",'SET LOCAL search_path=pg_catalog'])await q(s,[]);
 const out=validate(scalar(await q(sql,params)));if(finalSql)finalValidate(scalar(await q(finalSql,finalParams)),out);committing=true;if((await q('COMMIT',[])).command!=='COMMIT')pipelineFail();committed=true;return freeze(out);
 }catch(e){let uncertain=false;if(owned&&started&&!committed)try{if((await q('ROLLBACK',[])).command!=='ROLLBACK')uncertain=true;}catch{uncertain=true;}if(committing||uncertain){if(owned)quarantined.add(c);pipelineFail('CONTENT_PIPELINE_UNCERTAIN');}const d=e&&!types.isProxy(e)&&e instanceof ContentPipelineLedgerError?Object.getOwnPropertyDescriptor(e,'code'):null;throw new ContentPipelineLedgerError(d&&Object.hasOwn(d,'value')?d.value:undefined);
 }finally{if(owned){try{await release(committed?undefined:Error('Discard content pipeline lease'));}catch{quarantined.add(c);pipelineFail('CONTENT_PIPELINE_UNCERTAIN');}finally{held.delete(c);}}}
};}
export const pipelineSQL=(name,casts)=>`SELECT design_content_pipeline.${name}(${casts}) AS value`;
