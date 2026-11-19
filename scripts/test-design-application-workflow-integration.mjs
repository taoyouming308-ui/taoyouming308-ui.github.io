import assert from 'node:assert/strict';
import {managedApplicationResultFixture} from './fixtures/managed-application-result.mjs';
import {applyTrustedManagedApplicationCandidate} from '../packages/analysis-engine/managed-application-result-candidate.mjs';
import {createFullWorkflowSnapshot,validateFullWorkflowSnapshot} from '../packages/design-production-adapter/full-workflow-archive.mjs';
import {validatePreparedWorkflowRecord} from '../packages/design-production-adapter/prepared-workflow-service.mjs';
import {projectWorkflowView} from '../packages/design-production-adapter/workflow-view-projector.mjs';
const f=managedApplicationResultFixture();
const a=applyTrustedManagedApplicationCandidate({session:f.session,candidate:f.candidate,workflowBinding:f.workflowBinding,selectedIndices:[0],requestId:'accept-application-one',input:f.input});
const history={schemaVersion:'design-managed-image-history-v4',inputs:[f.historyInput],accepted:[{candidate:f.candidate,acceptance:{requestId:'accept-application-one',workflowRevision:1,authority:f.authority,receipt:a.acceptedReceipt}}]};
const record={schemaVersion:'design-prepared-workflow-record-v6',revision:1,scope:f.scope,store:f.authority.actor.store,session:a.session,archives:[],photoRefs:[],legacyVersions:[],managedImageHistory:history};
validatePreparedWorkflowRecord(record,f.scope);
const snap=createFullWorkflowSnapshot({scope:f.scope,store:record.store,bindings:{uiScope:null,evidenceScope:a.session.scope},ui:null,evidence:{session:a.session,archives:[]},photoRefs:[],legacyVersions:[],managedImageHistory:history});
assert.equal(snap.schemaVersion,'design-full-workflow-snapshot-v6');validateFullWorkflowSnapshot(snap);
const view=projectWorkflowView(record,{scope:f.scope});assert.equal(view.acceptedCandidates[0].lane,'application');assert.equal(view.managedInputs[0].qualification,'synthetic_pinned_direct_only');assert(!Object.hasOwn(view.managedInputs[0],'normalizedVersion'));assert(!JSON.stringify(view).includes('projectOrigin'));
console.log('PASS application record/full/view integration; pure synthetic only');
// Rebuild the actual server command using branded validated records, not only a
// manually assembled full snapshot. This does not grant runtime authority.
const {createPreparedWorkflowRecord,replayPreparedWorkflowIntentAgainstValidated}=await import('../packages/design-production-adapter/prepared-workflow-service.mjs');
const {designCandidateDigest:digest}=await import('../packages/analysis-engine/design-candidate.mjs');
const prior=validatePreparedWorkflowRecord(createPreparedWorkflowRecord({scope:f.scope,store:f.authority.actor.store,session:f.session}),f.scope);
const fx=managedApplicationResultFixture({session:f.session,recordDigest:digest(prior)}),rid='application-command-upgrade';
const ax=applyTrustedManagedApplicationCandidate({session:fx.session,candidate:fx.candidate,workflowBinding:fx.workflowBinding,selectedIndices:[0],requestId:rid,input:fx.input});
const next=validatePreparedWorkflowRecord({...prior,schemaVersion:'design-prepared-workflow-record-v6',revision:1,session:ax.session,managedImageHistory:{schemaVersion:'design-managed-image-history-v4',inputs:[fx.historyInput],accepted:[{candidate:fx.candidate,acceptance:{requestId:rid,workflowRevision:1,authority:fx.authority,receipt:ax.acceptedReceipt}}]}},fx.scope);
const command={requestId:rid,expectedRevision:0,intent:{type:'accept_application_candidate',candidateId:fx.candidate.id,selectedIndices:[0]}};
replayPreparedWorkflowIntentAgainstValidated({prior,expected:next,request:command,trustedCandidate:{candidate:fx.candidate,input:fx.historyInput}});
assert.equal(prior.schemaVersion,'design-prepared-workflow-record-v1');assert.equal(prior.session.sources.length,0);
console.log('PASS exact application acceptance command upgrades v1 to v6 without altering prior');
