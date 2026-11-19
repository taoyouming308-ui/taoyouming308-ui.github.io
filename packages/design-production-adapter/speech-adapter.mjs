import {Buffer} from 'node:buffer';
/** Prepared non-streaming DeepSeek ASR. Strict byte validation; no recording or default network. */
import {DesignProviderError,DEEPSEEK_ASR_ENDPOINT,createDeepSeekOperationRunner,validateProviderRequest,providerDigest} from './provider-adapter.mjs';
export const ASR_MAX_BYTES=8*1024*1024;
export const ASR_MAX_SECONDS=120;
const fail=code=>{throw new DesignProviderError(code);};
const RATES=new Set([8000,16000,22050,24000,32000,44100,48000]);
/** Narrow supported subset: RIFF little-endian, fmt(16) then data, PCM16 mono. No ancillary metadata. */
export function validateMonoPcmWav(input){
  if(!(input instanceof Uint8Array))fail('ASR_INVALID_WAV');
  if(input.byteLength>ASR_MAX_BYTES)fail('ASR_TOO_LARGE');
  const bytes=Buffer.from(input);
  if(bytes.subarray(0,4).equals(Buffer.from('OggS')))fail('ASR_OGG_NOT_SUPPORTED');
  if(bytes.length<44)fail('ASR_INVALID_WAV');
  const tag=(offset,value)=>bytes.subarray(offset,offset+value.length).equals(Buffer.from(value,'ascii'));
  if(!tag(0,'RIFF')||!tag(8,'WAVE')||bytes.readUInt32LE(4)!==bytes.length-8||!tag(12,'fmt ')||bytes.readUInt32LE(16)!==16||!tag(36,'data'))fail('ASR_INVALID_WAV');
  const format=bytes.readUInt16LE(20),channels=bytes.readUInt16LE(22),sampleRate=bytes.readUInt32LE(24),byteRate=bytes.readUInt32LE(28),blockAlign=bytes.readUInt16LE(32),bitsPerSample=bytes.readUInt16LE(34),dataLength=bytes.readUInt32LE(40);
  if(format!==1||bitsPerSample!==16)fail('ASR_UNSUPPORTED_FORMAT');
  if(channels===2)fail('ASR_STEREO_NOT_SUPPORTED');if(channels!==1)fail('ASR_UNSUPPORTED_FORMAT');
  if(!RATES.has(sampleRate))fail('ASR_INVALID_RATE');
  if(blockAlign!==2||byteRate!==sampleRate*blockAlign||dataLength!==bytes.length-44||dataLength%blockAlign!==0)fail('ASR_INVALID_WAV');
  if(dataLength===0)fail('ASR_EMPTY');
  const frames=dataLength/blockAlign;if(frames>sampleRate*ASR_MAX_SECONDS)fail('ASR_TOO_LONG');
  return Object.freeze({sha256:providerDigest(bytes),durationMs:frames*1000/sampleRate,sampleRate,channels,bitsPerSample,frames,byteLength:bytes.length});
}
export function createDeepSeekSpeechAdapter(config={}){
  const run=createDeepSeekOperationRunner(config);
  return Object.freeze({async transcribe(request){
    if(config.enabled!==true)fail('ADAPTER_DISABLED');
    const fixed=validateProviderRequest(request,['audioBytes']);
    if(!(request.audioBytes instanceof Uint8Array))fail('ASR_INVALID_WAV');
    if(request.audioBytes.byteLength>ASR_MAX_BYTES)fail('ASR_TOO_LARGE');
    const bytes=Buffer.from(request.audioBytes),metadata=validateMonoPcmWav(bytes);
    // A fixed filename and no original file metadata, customer IDs or language/model guesses.
    const body=new FormData();body.append('file',new Blob([bytes],{type:'audio/wav'}),'speech.wav');
    const audio=Object.freeze({sha256:metadata.sha256,durationMs:metadata.durationMs,sampleRate:metadata.sampleRate,channels:1,bitsPerSample:16});
    const validateResult=result=>{
      // JSONB may reorder object keys; all approved scalar fields must still match exactly.
      const recorded=result.audio;
      const sameAudio=recorded&&Object.getPrototypeOf(recorded)===Object.prototype&&Object.keys(recorded).length===Object.keys(audio).length&&Object.keys(audio).every(key=>Object.hasOwn(recorded,key)&&recorded[key]===audio[key]);
      if(!sameAudio||result.transcript?.kind!=='speech_transcript'||result.transcript?.confirmed!==false||typeof result.transcript.text!=='string'||result.transcript.text.length>12000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result.transcript.text))fail('INVALID_RESULT');
    };
    return run(fixed,{operation:'speech',endpoint:DEEPSEEK_ASR_ENDPOINT,model:null,payloadSha256:metadata.sha256,byteLength:metadata.byteLength,dataKinds:['mono_pcm16_wav'],body,headers:{},resultFields:['audio','transcript'],validateResult,parse(value){
      if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).sort().join('|')!=='duration_ms|request_id|text'||typeof value.request_id!=='string'||value.request_id.length<1||value.request_id.length>160||/[\u0000-\u001f]/.test(value.request_id)||typeof value.text!=='string'||value.text.length>12000||!Number.isInteger(value.duration_ms)||value.duration_ms<0||value.duration_ms>120000||Math.abs(value.duration_ms-metadata.durationMs)>2)fail('INVALID_PROVIDER_RESPONSE');
      const result={audio,transcript:{kind:'speech_transcript',text:value.text,confirmed:false}};validateResult(result);return result;
    }});
  }});
}
