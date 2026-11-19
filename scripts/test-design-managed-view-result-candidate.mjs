import test from 'node:test';
import assert from 'node:assert/strict';
import {managedViewResultFixture as fixture,managedViewInputFixture} from './fixtures/managed-view-result.mjs';
import {managedImageResultFixture} from './fixtures/managed-image-result.mjs';
import * as view from '../packages/analysis-engine/managed-view-result-candidate.mjs';
import {validateManagedImageResultCandidate} from '../packages/analysis-engine/managed-image-result-candidate.mjs';
import {DESIGN_COMPARISON_OUTPUTS,designCandidateDigest as digest} from '../packages/analysis-engine/design-candidate.mjs';
import {appendDesignEvent,getDesignView,DESIGN_MANAGED_BEFORE_FIELDS,DESIGN_MANAGED_REVIEW_FIELDS} from '../packages/analysis-engine/design-pilot.mjs';
globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};const copy=structuredClone;
const valid=f=>view.validateManagedViewResultCandidate(f.candidate,{session:f.session,workflowBinding:f.workflowBinding,...(f.candidateInput.managedImageHistory?{managedImageHistory:f.candidateInput.managedImageHistory}:{})});
const apply=(f,requestId='accept-'+f.candidate.id,selectedIndices=f.candidate.kind==='managed_before_view'?[0,1]:[0])=>view.applyTrustedManagedViewCandidate({session:f.session,candidate:f.candidate,workflowBinding:f.workflowBinding,requestId,selectedIndices,...(f.candidateInput.managedImageHistory?{managedImageHistory:f.candidateInput.managedImageHistory}:{})});
const append=(s,event)=>appendDesignEvent(s,{scope:s.scope,requestId:'manual-'+s.revision,expectedRevision:s.revision,event}).session;
function comparisons({angles=['front','back','left'],confirm=[],outputs=[]}={}){
 let session=fixture({kind:'managed_completion_comparison'}).session,revision=0;
 const history={schemaVersion:'design-managed-image-history-v2',inputs:[],accepted:[]};
 for(const [i,angle] of angles.entries()){
  const f=fixture({kind:'managed_completion_comparison',session,recordRevision:revision,id:'compare-'+angle,angle,result:{judgment:outputs[i]??DESIGN_COMPARISON_OUTPUTS[3]}}),out=apply(f);
  history.inputs.push(...f.inputs);history.accepted.push({candidate:f.candidate,acceptance:{requestId:'accept-'+f.candidate.id,workflowRevision:++revision,authority:f.authority,receipt:out.acceptedReceipt}});session=out.session;
  if(confirm.includes(angle)){
   const entry=session.entries.at(-1),source={messageId:'confirm-'+angle,kind:'text',actor:'employee',text:'【合成测试】我确认：'+entry.value};
   session=append(session,{type:'source_recorded',source});session=append(session,{type:'entry_confirmed',entryId:entry.id,confirmedValue:entry.value,sources:[{messageId:source.messageId,quote:source.text}]});revision++;
  }
 }
 return {session,managedImageHistory:history,recordRevision:revision};
}

test('versioned union keeps old v1 candidate bytes and rejects schema masquerading',()=>{
 const old=managedImageResultFixture(),bytes=JSON.stringify(old.candidate),f=fixture();
 assert.equal(valid(f).schemaVersion,view.MANAGED_VIEW_RESULT_SCHEMA);assert.equal(JSON.stringify(validateManagedImageResultCandidate(old.candidate,{session:old.session,workflowBinding:old.workflowBinding})),bytes);
 assert.throws(()=>validateManagedImageResultCandidate(f.candidate,{session:f.session,workflowBinding:f.workflowBinding}));
 assert.throws(()=>view.validateManagedViewResultCandidate(old.candidate,{session:old.session,workflowBinding:old.workflowBinding}));
});
test('exact fourteen managed fields are independent of old common and manual review fields',()=>{
 assert.equal(DESIGN_MANAGED_BEFORE_FIELDS.length,8);assert.equal(DESIGN_MANAGED_REVIEW_FIELDS.length,6);
 assert.equal(new Set([...DESIGN_MANAGED_BEFORE_FIELDS,...DESIGN_MANAGED_REVIEW_FIELDS]).size,14);
 assert(DESIGN_MANAGED_BEFORE_FIELDS.every(x=>x.startsWith('managed_before_')));assert(!DESIGN_MANAGED_REVIEW_FIELDS.includes('observed_result'));
});
test('three before views remain simultaneously visible; correcting front only replaces front',()=>{
 let s=fixture().session;const ids=[];
 for(const [i,angle] of ['front','back','left'].entries()){const f=fixture({session:s,recordRevision:i,id:'before-'+angle,angle});s=apply(f).session;ids.push(...f.candidate.candidate.entries.map(e=>e.id));}
 assert.equal(getDesignView(s).entries.length,6);assert.deepEqual(getDesignView(s).entries.map(e=>e.id),ids);
 const f=fixture({session:s,recordRevision:3,id:'before-front-new',angle:'front'}),out=apply(f);
 assert.equal(f.candidate.candidate.entries[0].replacesEntryId,'managed-before-entry:before-front:0');
 assert.equal(getDesignView(out.session).entries.length,6);assert.equal(out.session.entries.length,8);
 assert(getDesignView(out.session).entries.some(e=>e.id==='managed-before-entry:before-left:0'));
});
test('before source is observable model text and explicit selection never confirms',()=>{
 const f=fixture(),out=apply(f,'selected',[1]);assert.equal(out.session.entries.length,1);
 assert.equal(out.session.entries[0].field,'managed_before_hair_shape_front');assert.equal(out.session.entries[0].status,'not_confirmed');
 assert.equal(out.session.entries[0].track,'context');assert.equal(out.session.sources[0].actor,'model');
 assert.deepEqual(out.acceptedReceipt.selectedIndices,[1]);assert.equal(out.acceptedReceipt.evidenceBindingDigest,digest(f.evidenceBinding));
 assert.deepEqual(out.session.journal.map(x=>x.requestId),['selected-managed-view-source-1','selected-managed-view-entry-1']);
});
test('unknown observation stays null and new v2 empty observations are rejected without filling defaults',()=>{
 const f=fixture({result:{observations:[{field:'visible_outline',value:null}]}}),out=apply(f,'unknown',[0]);assert.equal(out.session.entries[0].status,'unknown');assert.deepEqual(out.session.entries[0].sources,[]);
 assert.throws(()=>fixture({result:{observations:[]}}));
});
test('before descriptions reject personality, techniques, free text and other phases',()=>{
 for(const observation of [{field:'self_description',value:'乐观'},{field:'product',value:'某药水'},{field:'visible_outline',value:'测量完成18cm'}])assert.throws(()=>fixture({result:{observations:[observation]}}));
 const f=fixture();assert.throws(()=>fixture({session:append(f.session,{type:'phase_advanced',phase:'proposal'})}));
});
test('comparisons use the exact finite output set and never modify human observed_result',()=>{
 for(const judgment of DESIGN_COMPARISON_OUTPUTS){const f=fixture({kind:'managed_completion_comparison',result:{judgment}}),out=apply(f);assert.equal(out.session.entries.at(-1).field,'managed_photo_comparison_front');assert.equal(out.session.entries.at(-1).status,'not_confirmed');assert.equal(out.session.entries.at(-1).basis,'observable');}
 let s=fixture({kind:'managed_completion_comparison'}).session;const source={messageId:'human-result',kind:'text',actor:'employee',text:'【合成测试】员工独立记录'};s=append(s,{type:'source_recorded',source});
 const e={id:'human-review',category:'result_review',field:'observed_result',zone:null,groupId:null,service:null,side:null,track:'actual',origin:'extraction',basis:'said',value:source.text,status:'not_confirmed',sources:[{messageId:source.messageId,quote:source.text}],replacesEntryId:null};s=append(s,{type:'entry_recorded',entry:e});
 const out=apply(fixture({kind:'managed_completion_comparison',session:s}));assert.deepEqual(out.session.entries[0],s.entries[0]);assert.equal(getDesignView(out.session).entries.length,2);
});
test('pair rejects left versus right, reversed stages, duplicate tasks and same source object',()=>{
 for(const change of [f=>f.candidate.evidenceBinding.images[1].angle='left',f=>f.candidate.evidenceBinding.images.reverse(),f=>f.candidate.evidenceBinding.images[1].taskId=f.candidate.evidenceBinding.images[0].taskId,f=>f.candidate.evidenceBinding.images[1].sourceObject=copy(f.candidate.evidenceBinding.images[0].sourceObject),f=>f.candidate.evidenceBinding.angle='detail']){const f=copy(fixture({kind:'managed_completion_comparison'}));change(f);assert.throws(()=>valid(f));}
});
test('after image needs distinct versioned binding; old before-only contract is unchanged',()=>{
 const a=managedViewInputFixture({stage:'after'});assert.equal(view.validateManagedViewImageBinding(a.binding).stage,'after');
 assert.throws(()=>view.validateManagedViewImageBinding(a.binding,{stage:'before'}));
 const before=fixture();before.candidateInput.evidenceBinding.images[0]=a.binding;assert.throws(()=>view.buildManagedViewResultCandidate(before.candidateInput));
});
test('JPEG PNG WebP budgets and 1024/1536 enums are exact, no old limit changes',()=>{
 for(const mime of ['image/jpeg','image/png','image/webp'])for(const maxEdge of [1024,1536]){const max=maxEdge===1024?262144:524288,b=copy(managedViewInputFixture({mime,maxEdge,byteLength:max}).binding);view.validateManagedViewImageBinding(b);b.byteLength++;assert.throws(()=>view.validateManagedViewImageBinding(b));}
 const b=copy(managedViewInputFixture().binding);b.maxEdge=2048;assert.throws(()=>view.validateManagedViewImageBinding(b));
});
test('shape validators never grant authority and reject same-alias mismatched owner tuple',()=>{
 const f=copy(fixture({kind:'managed_completion_comparison'}));f.candidate.evidenceBinding.images[1].authority.subjectId='different-subject';assert.throws(()=>valid(f));
 const b=view.validateManagedViewEvidenceBinding(fixture().evidenceBinding,{kind:'managed_before_view'});assert.equal(Object.hasOwn(b,'authorized'),false);assert(Object.isFrozen(b));
});
test('exact record/session binding and result/source/native entry replay reject tampering',()=>{
 for(const change of [f=>f.candidate.workflowBinding.recordDigest='f'.repeat(64),f=>f.candidate.workflowBinding.sessionDigest='f'.repeat(64),f=>f.candidate.candidate.entries[0].status='confirmed',f=>f.candidate.candidate.entries[0].field='visible_outline',f=>f.candidate.descriptionSources[0].actor='employee',f=>f.candidate.result.observations[0].value='轮廓偏方']){const f=copy(fixture());change(f);assert.throws(()=>valid(f));}
});
test('synthesis retains exact confirmed/unconfirmed ancestors without sending images',()=>{
 const h=comparisons({confirm:['front']}),built=view.buildManagedSynthesisEvidence({session:h.session,managedImageHistory:h.managedImageHistory,side:'left'}),e=built.evidenceBinding;
 assert.deepEqual(e.confirmedAngles,['front']);assert.deepEqual(e.unconfirmedAngles,['back','left']);assert.deepEqual(e.missingAngles,[]);
 assert.equal(e.ancestors[0].confirmationDigest,digest(h.session.entries.find(x=>x.id===e.ancestors[0].entryId).confirmation));
 assert.equal(e.ancestors[1].confirmationDigest,null);assert.equal(Object.hasOwn(e,'images'),false);assert.equal(e.generation,'model_review_focus');
 const f=fixture({...h,kind:'managed_completion_synthesis',id:'synth'}),out=apply(f);
 assert.equal(out.session.entries.at(-1).field,'managed_completion_synthesis_left');assert.equal(out.session.entries.at(-1).status,'not_confirmed');assert.equal(out.session.entries.at(-1).basis,'inferred');
 assert.match(out.session.entries.at(-1).value,/员工已确认该条/);assert.match(out.session.entries.at(-1).value,/该条未确认/);assert.equal(out.session.sources.at(-1).kind,'model_synthesis');
});
test('deterministic 0/1 focus branch stays keyless server identity, never forged model result',()=>{
 const h=comparisons({confirm:['front','back','left']}),f=fixture({...h,kind:'managed_completion_synthesis'});
 assert.equal(f.evidenceBinding.generation,'deterministic');assert.equal(f.requestBinding.model,'server-deterministic');assert.equal(f.candidate.descriptionSources[0].actor,'system');assert.equal(f.candidate.descriptionSources[0].kind,'server_synthesis');
 assert.equal(f.result.reviewFocus.kind,'capture_conditions');valid(f);
 const bad=copy(f);bad.candidate.requestBinding.model='paid-model';assert.throws(()=>valid(bad));
 const model=copy(fixture({...comparisons(),kind:'managed_completion_synthesis'}));model.candidate.requestBinding.model='server-deterministic';assert.throws(()=>valid(model));
});
test('missing side is explicit and left/right cannot substitute for one another',()=>{
 const h=comparisons({angles:['front','back','right']}),f=fixture({...h,kind:'managed_completion_synthesis',side:'left'});
 assert.deepEqual(f.evidenceBinding.missingAngles,['left']);assert.deepEqual(f.evidenceBinding.ancestors.map(x=>x.angle),['front','back']);assert.equal(f.evidenceBinding.assessment,'limited_evidence');
 assert.match(f.candidate.candidate.entries[0].value,/仅覆盖所选左侧，不代表另一侧/);
 assert.throws(()=>fixture({...comparisons({angles:['right']}),kind:'managed_completion_synthesis',side:'left'}));
});
test('noncomparable and opposing judgments remain server limitations',()=>{
 const h=comparisons({outputs:[DESIGN_COMPARISON_OUTPUTS[1],DESIGN_COMPARISON_OUTPUTS[2],DESIGN_COMPARISON_OUTPUTS[4]]}),f=fixture({...h,kind:'managed_completion_synthesis'});
 assert.deepEqual(f.evidenceBinding.conflictingAngles,['front','back']);assert.deepEqual(f.evidenceBinding.uncomparableAngles,['left']);assert.equal(f.evidenceBinding.assessment,'limited_evidence');
 for(const key of ['missingAngles','uncomparableAngles','conflictingAngles','confirmedAngles','unconfirmedAngles']){const bad=copy(f);bad.candidate.evidenceBinding[key]=['right'];assert.throws(()=>valid(bad));}
});
test('non-default allowed focus is valid without changing original evidence; invented focus is rejected',()=>{
 const h=comparisons(),f=fixture({...h,kind:'managed_completion_synthesis'}),b=view.buildManagedSynthesisEvidence({session:h.session,managedImageHistory:h.managedImageHistory,side:'left'});
 assert(b.allowedReviewFocus.length>1);const next=copy(f.candidateInput);next.result.reviewFocus=b.allowedReviewFocus.at(-1);const c=view.buildManagedViewResultCandidate(next);
 assert.deepEqual(c.evidenceBinding,f.evidenceBinding);assert.notDeepEqual(c.result,f.result);
 next.result.reviewFocus={kind:'invented_cause',angles:['front']};assert.throws(()=>view.buildManagedViewResultCandidate(next));
});
test('ancestor candidate, receipt, image hashes and current confirmation are all bound',()=>{
 for(const change of [h=>h.managedImageHistory.accepted[0].acceptance.receipt.candidateDigest='f'.repeat(64),h=>h.managedImageHistory.accepted[0].candidate.evidenceBinding.images[0].sourceSha256='f'.repeat(64),h=>h.managedImageHistory.accepted[0].candidate.result.judgment=DESIGN_COMPARISON_OUTPUTS[0],h=>h.managedImageHistory.accepted.push(copy(h.managedImageHistory.accepted[0]))]){
  const h=copy(comparisons());change(h);assert.throws(()=>view.buildManagedSynthesisEvidence({session:h.session,managedImageHistory:h.managedImageHistory,side:'left'}));
 }
 const h=comparisons(),old=view.buildManagedSynthesisEvidence({session:h.session,managedImageHistory:h.managedImageHistory,side:'left'}).evidenceBinding,e=h.session.entries[0],src={messageId:'late-confirm',kind:'text',actor:'employee',text:e.value};
 let session=append(h.session,{type:'source_recorded',source:src});session=append(session,{type:'entry_confirmed',entryId:e.id,confirmedValue:e.value,sources:[{messageId:src.messageId,quote:src.text}]});
 assert.throws(()=>view.validateManagedSynthesisContext({session,managedImageHistory:h.managedImageHistory,evidenceBinding:old}));
});
test('unaccepted, wrong-phase or absent ancestor history cannot generate synthesis',()=>{
 const h=comparisons();h.managedImageHistory.accepted=[];assert.throws(()=>fixture({...h,kind:'managed_completion_synthesis'}));
 assert.throws(()=>view.buildManagedSynthesisEvidence({session:fixture().session,managedImageHistory:{schemaVersion:'design-managed-image-history-v2',inputs:[],accepted:[]},side:'left'}));
 const f=fixture({...comparisons(),kind:'managed_completion_synthesis'});assert.throws(()=>view.validateManagedViewResultCandidate(f.candidate,{session:f.session,workflowBinding:f.workflowBinding}));
});
test('shape-only synthesis validation recomputes facts but is explicitly not stored receipt proof',()=>{
 const f=fixture({...comparisons(),kind:'managed_completion_synthesis'});assert.deepEqual(view.validateManagedViewEvidenceBinding(f.evidenceBinding,{kind:f.candidate.kind}),f.evidenceBinding);
 for(const change of [e=>e.ancestors.reverse(),e=>e.ancestors[0].confirmationDigest='f'.repeat(64),e=>e.ancestors[0].imageBindingDigests.pop(),e=>e.generation='deterministic',e=>e.extra=true]){const e=copy(f.evidenceBinding);change(e);assert.throws(()=>view.validateManagedViewEvidenceBinding(e,{kind:f.candidate.kind}));}
});
test('all acceptance selection bounds remain exact; composite selection is only [0]',()=>{
 for(const kind of view.MANAGED_VIEW_KINDS){const f=kind==='managed_completion_synthesis'?fixture({...comparisons(),kind}):fixture({kind});for(const indices of [[],[-1],[2],[0,0],[0,1,2]])assert.throws(()=>apply(f,'reject',indices));}
});
test('getters, proxies, custom prototypes and hidden keys never become candidate proof',()=>{
 const f=fixture();let calls=0;const bad=copy(f.candidate);Object.defineProperty(bad,'result',{enumerable:true,get(){calls++;return f.result;}});assert.throws(()=>view.validateManagedViewResultCandidate(bad,{session:f.session,workflowBinding:f.workflowBinding}));
 assert.throws(()=>view.validateManagedViewImageBinding(new Proxy(f.evidenceBinding.images[0],{get(){calls++;}})));
 assert.equal(calls,0);const hidden=copy(f.candidate);Object.defineProperty(hidden,'hidden',{value:true});assert.throws(()=>view.validateManagedViewResultCandidate(hidden,{session:f.session,workflowBinding:f.workflowBinding}));
});
