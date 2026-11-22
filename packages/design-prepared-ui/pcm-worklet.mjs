/** Copies mono float samples only; no recording permissions or network APIs. */
class PreparedPcmCapture extends AudioWorkletProcessor {
 constructor(){super();this.running=true;this.frames=0;this.maximum=0;this.port.onmessage=event=>{if(event.data?.type==='configure')this.maximum=event.data.maxFrames;if(event.data?.type==='stop'){this.running=false;this.port.postMessage({type:'stopped'});}};}
 process(inputs){if(!this.running)return false;const channel=inputs[0]?.[0];if(!this.maximum||!channel)return true;if(inputs[0].length!==1){this.running=false;this.port.postMessage({type:'invalid'});return false;}const count=Math.min(channel.length,this.maximum-this.frames);if(count>0){const copy=new Float32Array(channel.subarray(0,count));this.port.postMessage({type:'samples',samples:copy},[copy.buffer]);this.frames+=count;}if(this.frames>=this.maximum){this.running=false;this.port.postMessage({type:'limit'});return false;}return true;}
}
registerProcessor('prepared-pcm-capture',PreparedPcmCapture);
