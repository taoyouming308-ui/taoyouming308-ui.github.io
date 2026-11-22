/** The existing prepared UI with one HTTP client, not another workflow implementation. */
import {mountPreparedDesign} from '../../ai-design-prepared.mjs';
import {createPreparedHttpClient} from './http-client.mjs';
import {createPreparedRecorder} from './recorder.mjs';
import {createScopedPhotoPreviews} from './photo-preview.mjs';
export function mountPreparedHttpDesign(element,{enabled=false,customers=[],http={},recording={},previews:previewOptions={}}={}){
 if(enabled!==true)return mountPreparedDesign(element);
 const client=createPreparedHttpClient({...http,enabled:true});
 const recorder=recording.enabled===true?createPreparedRecorder({...recording,enabled:true}):null;
 const previews=previewOptions.enabled===true?createScopedPhotoPreviews({...previewOptions,readMedia:client.readMedia,enabled:true}):null;
 return mountPreparedDesign(element,{enabled:true,adapter:client,recorder,previews,customers});
}
