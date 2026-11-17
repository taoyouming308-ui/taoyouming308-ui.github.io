/** Server-only crypto adapter. No default secret, environment lookup or voucher fallback. */
const encoder=new TextEncoder();
const fail=()=>{throw new Error('DESIGN_KEY_CRYPTO_FAILED');};
const encode=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
const decode=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
function binding(context){
  if(!context||!['username','store','destination'].every(k=>typeof context[k]==='string'&&context[k])||(context.model!==null&&(typeof context.model!=='string'||!context.model))||!Number.isSafeInteger(context.revision)||context.revision<1)fail();
  return encoder.encode(JSON.stringify(['design-employee-key-v1',context.username,context.store,context.destination,context.model,context.revision]));
}
export function createDesignKeySealer({secretProvider,cryptoProvider}={}){
  async function key(){
    if(typeof secretProvider!=='function'||!cryptoProvider?.subtle||!cryptoProvider?.getRandomValues)fail();
    const secret=await secretProvider({purpose:'design-employee-key-v1'});
    if(!(secret instanceof Uint8Array)||secret.byteLength!==32)fail();
    return cryptoProvider.subtle.importKey('raw',secret,{name:'AES-GCM'},false,['encrypt','decrypt']);
  }
  return Object.freeze({
    async digest(value){try{if(typeof value!=='string'||!cryptoProvider?.subtle)fail();return encode(await cryptoProvider.subtle.digest('SHA-256',encoder.encode(value)));}catch{fail();}},
    async seal(value,context){try{
      const aad=binding(context),imported=await key(),iv=cryptoProvider.getRandomValues(new Uint8Array(12));
      const data=await cryptoProvider.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad,tagLength:128},imported,encoder.encode(value));
      return Object.freeze({v:1,iv:encode(iv),data:encode(data)});
    }catch{fail();}},
    async open(value,context){try{
      if(!value||value.v!==1||typeof value.iv!=='string'||typeof value.data!=='string')fail();
      const iv=decode(value.iv),data=decode(value.data);if(iv.length!==12||data.length<16||data.length>4096)fail();
      return new TextDecoder('utf-8',{fatal:true}).decode(await cryptoProvider.subtle.decrypt({name:'AES-GCM',iv,additionalData:binding(context),tagLength:128},await key(),data));
    }catch{fail();}}
  });
}

/** Separate v2 cryptographic domain; never attempts a v1 open. */
export function createImmutableDesignKeySealer({secretProvider,cryptoProvider}={}){
 const aad=context=>{
  const x=context;if(!x||x.schemaVersion!=='design-key-record-v2'||!x.owner||!['subjectId','employmentId','membershipId','storeId'].every(k=>typeof x.owner[k]==='string'&&x.owner[k])||!['securityEpoch','membershipRevision','revision'].every(k=>Number.isSafeInteger(x[k])&&x[k]>0)||!['chat','speech'].includes(x.purpose))fail();
  return encoder.encode(JSON.stringify(['design-immutable-key-v2',...['subjectId','employmentId','membershipId','storeId'].map(k=>x.owner[k]),x.securityEpoch,x.membershipRevision,x.purpose,x.destination,x.model,x.revision]));
 };
 async function imported(){if(typeof secretProvider!=='function'||!cryptoProvider?.subtle||!cryptoProvider?.getRandomValues)fail();const s=await secretProvider({purpose:'design-immutable-key-v2'});if(!(s instanceof Uint8Array)||s.length!==32)fail();return cryptoProvider.subtle.importKey('raw',s,'AES-GCM',false,['encrypt','decrypt']);}
 return Object.freeze({
  async digest(v){try{return encode(await cryptoProvider.subtle.digest('SHA-256',encoder.encode(v)));}catch{fail();}},
  async seal(v,c){try{const additionalData=aad(c),key=await imported(),iv=cryptoProvider.getRandomValues(new Uint8Array(12));return Object.freeze({v:2,iv:encode(iv),data:encode(await cryptoProvider.subtle.encrypt({name:'AES-GCM',iv,additionalData,tagLength:128},key,encoder.encode(v)))});}catch{fail();}},
  async open(v,c){try{if(v?.v!==2)fail();const iv=decode(v.iv),data=decode(v.data);if(iv.length!==12||data.length<16||data.length>4096)fail();return new TextDecoder('utf-8',{fatal:true}).decode(await cryptoProvider.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad(c),tagLength:128},await imported(),data));}catch{fail();}}
 });
}
