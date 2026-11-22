/** Exact private helper source with a reduced test-only budget; no exported bypass. */
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';import {types as nodeTypes} from 'node:util';
const source=readFileSync(new URL('../packages/design-production-adapter/prepared-workflow-service.mjs',import.meta.url),'utf8');
const start=source.indexOf('function snapshotRecordJSON(value){'),end=source.indexOf('function validateCopiedPreparedWorkflowRecord',start);
assert(start>=0&&end>start);const helper=source.slice(start,end);assert.equal(helper.split('32*1024*1024').length,2);
// Preserve the production algorithm verbatim, changing only its byte ceiling.
const reduced=helper.replace('32*1024*1024','byteBudget');
function run(json,byteBudget){return vm.runInNewContext(`${reduced}\nJSON.stringify(snapshotRecordJSON(JSON.parse(inputJSON)))`,{inputJSON:json,byteBudget,Buffer,nodeTypes,fail:code=>{throw Object.assign(Error(code),{code});}},{timeout:1000});}
for(const [name,value] of [['empty array',[]],['single item',[null]],['multiple items',[null,true,1,'é']],['nested arrays',[[],[1],[[],[]]]],['object with arrays',{empty:[],single:[1],many:[1,2,3]}]])test(name+' uses exact JSON byte budget',()=>{const json=JSON.stringify(value),bytes=Buffer.byteLength(json);assert.equal(run(json,bytes),json);assert.throws(()=>run(json,bytes-1),e=>e.code==='WORKFLOW_RECORD_INVALID');});
