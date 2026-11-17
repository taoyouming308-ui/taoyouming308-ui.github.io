/** Synthetic accepted-angle history only; no network, media bytes or credentials. */
import {createDesignSession,appendDesignEvent} from '../../packages/analysis-engine/design-pilot.mjs';
import {DESIGN_CANDIDATE_SCHEMA,DESIGN_COMPARISON_OUTPUTS,buildCompletionCandidateParts,applyTrustedDesignCandidate,designCandidateDigest} from '../../packages/analysis-engine/design-candidate.mjs';
export const syntheticSynthesisScope={customerProfileId:'11',visitId:'booking:101',assignmentSource:'appointment'};
export const syntheticSynthesisActor={username:'synthetic-owner',store:'synthetic-store'};
export function syntheticSynthesisWorkflow(specs=[{angle:'front'},{angle:'back'},{angle:'left'}]){
 const scope=syntheticSynthesisScope,actor=syntheticSynthesisActor;let session=createDesignSession({customerId:scope.customerProfileId,visitId:scope.visitId,sessionId:'synthetic-synthesis'});const modelCandidates=[],photoRefs=[];
 function add(event,id){session=appendDesignEvent(session,{requestId:id,scope:session.scope,expectedRevision:session.revision,event}).session;}
 for(const phase of ['proposal','execution','completed_review'])add({type:'phase_advanced',phase},phase);
 specs.forEach((spec,i)=>{
  const id=designCandidateDigest([spec.angle,i]),output=spec.output??DESIGN_COMPARISON_OUTPUTS[0],sourceRefs=['before','after'].map(stage=>({mediaId:'synthetic-'+spec.angle+'-'+stage,sourceSha256:'a'.repeat(64),derivativeSha256:'b'.repeat(64)}));
  const candidate={schemaVersion:DESIGN_CANDIDATE_SCHEMA,id,kind:'completion_comparison',scope,store:actor.store,actor,sessionId:session.scope.sessionId,baseRevision:session.revision,inputDigest:designCandidateDigest(session),payloadDigest:'c'.repeat(64),model:'synthetic-vision',promptVersion:'synthetic-comparison-v1',sourceRefs,comparison:{beforeMediaId:sourceRefs[0].mediaId,afterMediaId:sourceRefs[1].mediaId,angle:spec.angle},...buildCompletionCandidateParts({id,session,output,angle:spec.angle})};
  const requestId='accept-'+spec.angle+'-'+i,applied=applyTrustedDesignCandidate({session,candidate,selectedIndices:[0],requestId});session=applied.session;modelCandidates.push({candidate,acceptance:{requestId,workflowRevision:i+1,receipt:applied.acceptedReceipt}});
  sourceRefs.forEach((ref,j)=>photoRefs.push({kind:'private_media',scope,store:actor.store,reference:{mediaId:ref.mediaId,stage:j===0?'before':'after',angle:spec.angle,mime:'image/png',byteLength:80,width:3,height:2}}));
  if(spec.confirmed){const entry=candidate.candidate.entries[0],messageId='confirmation-'+i;add({type:'source_recorded',source:{messageId,kind:'text',actor:'employee',text:'合成确认：'+entry.value}},messageId);add({type:'entry_confirmed',entryId:entry.id,confirmedValue:entry.value,sources:[{messageId,quote:entry.value}]},'confirm-'+i);}
 });
 return {scope,store:actor.store,session,modelCandidates,photoRefs};
}
