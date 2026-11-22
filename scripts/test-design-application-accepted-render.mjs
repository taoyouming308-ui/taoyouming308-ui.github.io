/** Pure original renderer + real v6 accepted safe view; no DOM engine/network/PG. */
import test from 'node:test';import assert from 'node:assert/strict';
import {mountPreparedDesign} from '../ai-design-prepared.mjs';
import {managedApplicationHistoryFixture} from './fixtures/managed-application-history.mjs';
import {projectWorkflowView} from '../packages/design-production-adapter/workflow-view-projector.mjs';
test('accepted v6 application entry renders original person page and independent confirmation form',async()=>{
 const f=managedApplicationHistoryFixture();f.application();const s=f.state,record={schemaVersion:'design-prepared-workflow-record-v6',revision:s.workflowRevision,scope:s.scope,store:s.store,session:s.session,archives:s.archives,legacyVersions:[],photoRefs:s.photoRefs,...(s.modelCandidates.length?{modelCandidates:s.modelCandidates}:{}),managedImageHistory:s.managedImageHistory};
 const safe=projectWorkflowView(record);assert.equal(safe.acceptedCandidates.at(-1).kind,'managed_application_before_view');const before=JSON.stringify(record),handlers=new Map();
 const container={innerHTML:'',querySelectorAll:()=>[],querySelector:()=>null,addEventListener:(type,fn)=>handlers.set(type,fn),replaceChildren(){this.innerHTML='';}};
 const prior=globalThis.window;globalThis.window=new EventTarget();let mounted;
 try{mounted=mountPreparedDesign(container,{enabled:true,adapter:{browserViewsEnabled:true,applicationContentEnabled:true,dispatch:async()=>{throw Error('not dispatched by render');},load:async()=>({record:safe,replayed:false})}});await mounted.controller.select('synthetic',s.scope);const button={dataset:{step:'1'}};assert.doesNotThrow(()=>handlers.get('click')({target:{closest:()=>button}}));assert.match(container.innerHTML,/data-application-accepted-evidence/);assert.match(container.innerHTML,/data-command="confirm_entry"/);assert.match(container.innerHTML,/未调用真实模型/);assert.doesNotMatch(container.innerHTML,/源版本 undefined|missingAngles|规范化版本 undefined/);assert.equal(JSON.stringify(record),before);}finally{mounted?.destroy();globalThis.window=prior;}
});
