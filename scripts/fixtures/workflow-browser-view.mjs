/** Synthetic original records and cryptographically consistent full versions.
 * No database, authorization, decoding, network or real customer data. */
import {managedNormalizedHistoryFixture} from './managed-normalized-history.mjs';
import {appendDesignEvent} from '../../packages/analysis-engine/design-pilot.mjs';
import {designCandidateDigest as digest} from '../../packages/analysis-engine/design-candidate.mjs';
import {createFullWorkflowSnapshot} from '../../packages/design-production-adapter/full-workflow-archive.mjs';
import {validatePreparedWorkflowRecord} from '../../packages/design-production-adapter/prepared-workflow-service.mjs';
import * as project from '../../packages/design-production-adapter/workflow-view-projector.mjs';
const copy=structuredClone;
export function workflowBrowserViewFixture({archive=false}={}){
 const h=managedNormalizedHistoryFixture(),s=h.state,records=[],versions=[];
 s.session=appendDesignEvent(s.session,{scope:s.session.scope,requestId:'employee-original',expectedRevision:0,event:{type:'source_recorded',source:{messageId:'employee-original',kind:'text',actor:'employee',text:'  合成员工原话 https://example.invalid/user-text 。关键词 projectOrigin / objectKey 只是原文，不是内部 locator。\n保留空白。  '}}}).session;s.workflowRevision++;
 function capture(n){const record={schemaVersion:'design-prepared-workflow-record-v'+n,revision:s.workflowRevision,scope:s.scope,store:s.store,session:s.session,archives:s.archives,photoRefs:s.photoRefs,legacyVersions:[],...(s.modelCandidates.length?{modelCandidates:s.modelCandidates}:{}),...(n>=3?{managedImageHistory:s.managedImageHistory}:{})};validatePreparedWorkflowRecord(record,s.scope);const snapshot=createFullWorkflowSnapshot({scope:record.scope,store:record.store,bindings:{uiScope:null,evidenceScope:record.session.scope},ui:null,evidence:{session:record.session,archives:record.archives},legacyVersions:record.legacyVersions,photoRefs:record.photoRefs,...(record.modelCandidates?{modelCandidates:record.modelCandidates}:{}),...(record.managedImageHistory?{managedImageHistory:record.managedImageHistory}:{})}),base={schemaVersion:'design-full-workflow-version-v1',version:versions.length+1,previous:versions.length?{version:versions.length,sha256:versions.at(-1).sha256}:null,scope:s.scope,actor:s.authority.actor,requestId:'save-view-'+n,createdAt:'2026-11-16T12:00:00.000Z',bindingRevision:'synthetic-binding-1',snapshot};records.push(copy(record));versions.push({...copy(base),sha256:digest(base)});}
 capture(1);h.oldModel();capture(2);h.oldManaged();s.managedImageHistory.schemaVersion='design-managed-image-history-v1';capture(3);s.managedImageHistory.schemaVersion='design-managed-image-history-v2';h.before('back');capture(4);h.normalized();if(archive)h.archive();capture(5);
 const record=records.at(-1),scope=s.scope,history={versions,currentVersion:versions.length,currentDigest:versions.at(-1).sha256},preview=project.projectWorkflowSnapshotPreview(record,{scope});return {h,scope,records,record,versions,history,view:project.projectWorkflowView(record,{scope}),preview,historyView:project.projectFullWorkflowHistoryView(history,{scope}),saveView:project.projectFullWorkflowSaveView({saved:true,replayed:false,appliedVersion:5,observedHeadVersion:5,sourceRevision:record.revision,sourceDigest:preview.sourceDigest,version:versions.at(-1)},{scope})};
}
export {digest as workflowFixtureDigest};
