import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('prepared modules declare Buffer instead of depending on a Node global',()=>{
 const script=`globalThis.Buffer=undefined;globalThis.fetch=()=>{throw new Error('network forbidden');};
 const [speech,full]=await Promise.all([import('./packages/design-production-adapter/speech-adapter.mjs'),import('./packages/design-production-adapter/full-workflow-archive.mjs')]);
 await import('./packages/design-production-adapter/provider-adapter.mjs');
 await import('./packages/design-production-adapter/http-handler.mjs');
 try{speech.validateMonoPcmWav(new Uint8Array(50));throw new Error('accepted corrupt WAV');}catch(e){if(e instanceof ReferenceError)throw e;}
 try{full.parseFullWorkflowSnapshot('{}');throw new Error('accepted empty archive');}catch(e){if(e instanceof ReferenceError)throw e;}
 console.log('explicit-runtime-ok');`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:10000});
 assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/explicit-runtime-ok/);
});
