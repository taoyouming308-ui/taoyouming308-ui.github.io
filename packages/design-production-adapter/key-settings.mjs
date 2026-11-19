/** Prepared server-only credential settings. Never mount on the public synthetic UI. */
export const DESIGN_KEY_DESTINATION='https://api.deepseek.com/chat/completions';
export const DESIGN_ASR_DESTINATION='https://api.deepseek.com/v1/tools/asr';
export class DesignKeySettingsError extends Error{constructor(code){super(code);this.name='DesignKeySettingsError';this.code=code;}}
const publicCodes=new Set(['INVALID_KEY_REQUEST','KEY_SETTINGS_DISABLED','AUTHENTICATION_REQUIRED','KEY_RECORD_INVALID','ACTOR_CHANGED','KEY_REVISION_CONFLICT','KEY_NOT_CONFIGURED','KEY_APPROVAL_REQUIRED','KEY_SETTINGS_UNAVAILABLE']);
const fail=code=>{throw new DesignKeySettingsError(code);};
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,keys)=>{if(!plain(x)||Object.keys(x).sort().join('|')!==keys.sort().join('|'))fail('INVALID_KEY_REQUEST');};
const revision=x=>{if(!Number.isSafeInteger(x)||x<0)fail('INVALID_KEY_REQUEST');};
const purposeOf=destination=>destination===DESIGN_KEY_DESTINATION?'chat':'speech';
const validPurpose=value=>{if(!['chat','speech'].includes(value))fail('INVALID_KEY_REQUEST');return value;};
const same=(a,b)=>a.username===b.username&&a.store===b.store;
const validKey=x=>{if(typeof x!=='string'||!/^\S{16,500}$/.test(x)||/[\u0000-\u0020\u007f]/.test(x))fail('INVALID_KEY_REQUEST');};
function checkedConfig(x,models,allowASR){exact(x,['destination','model']);const chat=x.destination===DESIGN_KEY_DESTINATION&&typeof x.model==='string'&&models.includes(x.model);const asr=allowASR===true&&x.destination===DESIGN_ASR_DESTINATION&&x.model===null;if(!chat&&!asr)fail('INVALID_KEY_REQUEST');return Object.freeze({...x});}
function summary(row){return Object.freeze({configured:Boolean(row?.enabled),revision:row?.revision||0,destination:row?.destination||null,model:row?.model||null});}
export function createPreparedDesignKeySettings(deps={}){
  const {enabled=false,approvedModels=[],allowASR=false,authenticate,approvalVerifier,sealer,repository,now=()=>Date.now()}=deps;
  const models=Object.freeze(Array.isArray(approvedModels)?approvedModels.filter(x=>typeof x==='string'&&/^[A-Za-z0-9._-]{1,100}$/.test(x)):[]);
  const config=x=>checkedConfig(x,models,allowASR);
  function ready(){if(enabled!==true||typeof authenticate!=='function'||typeof approvalVerifier?.consume!=='function'||!['seal','open','digest'].every(k=>typeof sealer?.[k]==='function')||typeof repository?.withEmployeeLock!=='function')fail('KEY_SETTINGS_DISABLED');}
  async function actor(credential){
    const e=await authenticate(credential),instant=now();
    if(!plain(e)||e.active!==true||!['username','store'].every(k=>typeof e[k]==='string'&&e[k].trim()===e[k]&&e[k].length>0&&e[k].length<=160&&!/[\u0000-\u001f]/.test(e[k]))||!Number.isFinite(e.expiresAt)||!Number.isFinite(instant)||e.expiresAt<=instant)fail('AUTHENTICATION_REQUIRED');
    return Object.freeze({username:e.username,store:e.store});
  }
  function rowCheck(row,owner,purpose){
    if(row===null)return;
    exact(row,['username','store','purpose','revision','enabled','destination','model','sealed']);revision(row.revision);
    if(!same(row,owner)||row.purpose!==purpose||purposeOf(row.destination)!==purpose||row.revision<1||typeof row.enabled!=='boolean')fail('KEY_RECORD_INVALID');
    const storedChat=row.destination===DESIGN_KEY_DESTINATION&&typeof row.model==='string'&&/^[A-Za-z0-9._-]{1,100}$/.test(row.model);
    const storedSpeech=row.destination===DESIGN_ASR_DESTINATION&&row.model===null;
    if(!storedChat&&!storedSpeech)fail('KEY_RECORD_INVALID');if(row.enabled?!plain(row.sealed):row.sealed!==null)fail('KEY_RECORD_INVALID');
  }
  async function run(credential,purpose,work){
    validPurpose(purpose);
    ready();try{
      const owner=await actor(credential);
      return await repository.withEmployeeLock(owner,async tx=>{
        const recheck=async()=>{if(!same(owner,await actor(credential)))fail('ACTOR_CHANGED');};
        const row=await tx.read(purpose);rowCheck(row,owner,purpose);await recheck();
        return work({owner,row,tx,recheck});
      });
    }catch(error){if(error instanceof DesignKeySettingsError&&publicCodes.has(error.code))throw new DesignKeySettingsError(error.code);fail('KEY_SETTINGS_UNAVAILABLE');}
  }
  async function mutate(input,remove){
    exact(input,remove?['credential','approval','expectedRevision','purpose']:['credential','approval','expectedRevision','config','key']);revision(input.expectedRevision);
    const chosen=remove?null:config(input.config);if(!remove)validKey(input.key);input={...input,config:chosen};
    const purpose=remove?validPurpose(input.purpose):purposeOf(chosen.destination);
    return run(input.credential,purpose,async({owner,row,tx,recheck})=>{
      if((row?.revision||0)!==input.expectedRevision)fail('KEY_REVISION_CONFLICT');
      if(remove&&!row)fail('KEY_NOT_CONFIGURED');
      const target=chosen||{destination:row.destination,model:row.model};
      const intent=Object.freeze({...owner,purpose,action:remove?'revoke-design-key':'persist-design-key',...target,expectedRevision:input.expectedRevision,keyDigest:remove?null:await sealer.digest(input.key)});
      // Trusted verifier must validate an exact, short-lived action-time approval and atomically consume it.
      if(await approvalVerifier.consume(input.approval,intent)!==true)fail('KEY_APPROVAL_REQUIRED');
      const next={...owner,purpose,revision:input.expectedRevision+1,enabled:!remove,...target,sealed:null};
      if(!remove)next.sealed=await sealer.seal(input.key,next);
      await recheck();
      if(await tx.compareAndSwap(input.expectedRevision,Object.freeze(next))!==true)fail('KEY_REVISION_CONFLICT');
      return summary(next);
    });
  }
  return Object.freeze({
    status:input=>{exact(input,['credential','purpose']);return run(input.credential,input.purpose,async({row,recheck})=>{await recheck();return summary(row);});},
    save:input=>mutate(input,false),revoke:input=>mutate(input,true),
    // Internal provider-only capability. Never expose this method as an HTTP return value.
    async withProviderKey(input,use){
      exact(input,['credential','expectedRevision','destination','model']);revision(input.expectedRevision);config({destination:input.destination,model:input.model});
      if(typeof use!=='function')fail('INVALID_KEY_REQUEST');input={...input};
      const purpose=purposeOf(input.destination);
      return run(input.credential,purpose,async({owner,row,tx,recheck})=>{
        if(!row?.enabled)fail('KEY_NOT_CONFIGURED');
        if(row.revision!==input.expectedRevision||row.destination!==input.destination||row.model!==input.model)fail('KEY_REVISION_CONFLICT');
        let key=await sealer.open(row.sealed,row);validKey(key);await recheck();
        try{
          // Lock prevents concurrent revocation while dispatch is in flight. Callback must be bounded.
          const result=await use(Object.freeze({key,model:row.model,baseURL:'https://api.deepseek.com',destination:row.destination,revision:row.revision,actor:owner}));
          await recheck();const latest=await tx.read(purpose);rowCheck(latest,owner,purpose);
          if(!latest?.enabled||latest.revision!==row.revision)fail('KEY_REVISION_CONFLICT');
          return result;
        }finally{key=null;}
      });
    }
  });
}

import {validateImmutableKeyIdentity,immutableKeyOwner} from './immutable-key-identity.mjs';
import {policyCopy,policyCanonical,policyFreeze} from './approval-attempt-contracts.mjs';
/** New server-only path. No legacy identity, row or ciphertext fallback. */
export function createImmutablePreparedDesignKeySettings({enabled=false,resolveIdentity,sealer,repository,approvedModels=[],allowASR=false,now=()=>Date.now()}={}){
 const models=Object.freeze(Array.isArray(approvedModels)?approvedModels.filter(x=>typeof x==='string'&&/^[A-Za-z0-9._-]{1,100}$/.test(x)):[]);
 const safeCodes=new Set([...publicCodes,'KEY_OUTCOME_UNCERTAIN']);
 const equal=(a,b)=>policyCanonical(a)===policyCanonical(b);
 const current=async(resolver,credential)=>{const x=validateImmutableKeyIdentity(await resolver({credential}));const instant=now();if(!Number.isFinite(instant)||x.expiresAt<=instant)fail('AUTHENTICATION_REQUIRED');return x;};
 const stable=x=>({...immutableKeyOwner(x),securityEpoch:x.securityEpoch,membershipRevision:x.membershipRevision});
 const config=x=>checkedConfig(x,models,allowASR);
 async function run(raw,fields,purposeFor,work){
  if(enabled!==true||typeof resolveIdentity!=='function'||typeof repository?.withIdentityLock!=='function'||!['open','seal','digest'].every(k=>typeof sealer?.[k]==='function'))fail('KEY_SETTINGS_DISABLED');
  let committed=false,writeAttempted=false,guardClaimed=false,guarded=false;
  try{
   const input=policyCopy(raw);exact(input,fields);const purpose=validPurpose(purposeFor(input));
   const identity=await current(resolveIdentity,input.credential),owner=immutableKeyOwner(identity);
   const output=await repository.withIdentityLock(identity,async tx=>{
    if(typeof tx.resolveIdentity!=='function'||typeof tx.beforeCommit!=='function'||typeof tx.consumeKeyApproval!=='function')fail('KEY_SETTINGS_DISABLED');
    const recheck=async()=>{if(!equal(stable(identity),stable(await current(tx.resolveIdentity.bind(tx),input.credential))))fail('ACTOR_CHANGED');};
    await recheck();
    const row=policyCopy(await tx.read(purpose));
    if(row!==null){exact(row,['schemaVersion','owner','securityEpoch','membershipRevision','purpose','revision','enabled','destination','model','sealed']);if(row.schemaVersion!=='design-key-record-v2'||!equal(row.owner,owner)||row.purpose!==purpose||purposeOf(row.destination)!==purpose||!Number.isSafeInteger(row.revision)||row.revision<1||!['securityEpoch','membershipRevision'].every(k=>Number.isSafeInteger(row[k])&&row[k]>0)||typeof row.enabled!=='boolean'||(row.enabled?!plain(row.sealed):row.sealed!==null))fail('KEY_RECORD_INVALID');const valid=row.destination===DESIGN_KEY_DESTINATION&&typeof row.model==='string'&&/^[A-Za-z0-9._-]{1,100}$/.test(row.model)||row.destination===DESIGN_ASR_DESTINATION&&row.model===null;if(!valid)fail('KEY_RECORD_INVALID');}
    const result=await work({input,purpose,identity,owner,row,tx,recheck,markWrite:()=>{writeAttempted=true;}});
    await tx.beforeCommit(async()=>{if(guardClaimed)fail('KEY_SETTINGS_UNAVAILABLE');guardClaimed=true;await recheck();guarded=true;});await recheck();return result;
   });committed=true;if(!guarded)fail('KEY_SETTINGS_UNAVAILABLE');
   if(!equal(stable(identity),stable(await current(resolveIdentity,input.credential))))fail('ACTOR_CHANGED');
   return output;
  }catch(e){if(committed||writeAttempted)throw new DesignKeySettingsError('KEY_OUTCOME_UNCERTAIN');if(e instanceof DesignKeySettingsError&&safeCodes.has(e.code))throw new DesignKeySettingsError(e.code);throw new DesignKeySettingsError('KEY_SETTINGS_UNAVAILABLE');}
 }
 const mutate=(raw,remove)=>run(raw,remove?['credential','approval','expectedRevision','purpose']:['credential','approval','expectedRevision','config','key'],i=>remove?i.purpose:purposeOf(config(i.config).destination),async({input,purpose,identity,owner,row,tx,recheck,markWrite})=>{
  revision(input.expectedRevision);if((row?.revision||0)!==input.expectedRevision)fail('KEY_REVISION_CONFLICT');if(remove&&!row)fail('KEY_NOT_CONFIGURED');
  const target=remove?{destination:row.destination,model:row.model}:config(input.config);if(!remove)validKey(input.key);
  const intent=policyFreeze({schemaVersion:'design-key-approval-v2',...stable(identity),purpose,action:remove?'revoke-design-key':'persist-design-key',...target,expectedRevision:input.expectedRevision,keyDigest:remove?null:await sealer.digest(input.key)});
  exact(input.approval,['receiptId']);if(typeof input.approval.receiptId!=='string'||!input.approval.receiptId||input.approval.receiptId.length>160||input.approval.receiptId.trim()!==input.approval.receiptId||/[\u0000-\u001f\u007f]/.test(input.approval.receiptId))fail('INVALID_KEY_REQUEST');
  if(await tx.consumeKeyApproval(input.approval,intent)!==true)fail('KEY_APPROVAL_REQUIRED');await recheck();
  const next={schemaVersion:'design-key-record-v2',owner,securityEpoch:identity.securityEpoch,membershipRevision:identity.membershipRevision,purpose,revision:input.expectedRevision+1,enabled:!remove,...target,sealed:null};
  if(!remove)next.sealed=await sealer.seal(input.key,policyFreeze({...next}));await recheck();
  markWrite();if(await tx.compareAndSwap(input.expectedRevision,policyFreeze(next))!==true)fail('KEY_REVISION_CONFLICT');return summary(next);
 });
 return Object.freeze({
  status:raw=>run(raw,['credential','purpose'],i=>i.purpose,async({identity,row})=>({...summary(row),requiresReconfiguration:Boolean(row?.enabled&&(row.securityEpoch!==identity.securityEpoch||row.membershipRevision!==identity.membershipRevision))})),
  save:raw=>mutate(raw,false),revoke:raw=>mutate(raw,true),
  withProviderKey:(raw,use)=>run(raw,['credential','expectedRevision','destination','model'],i=>purposeOf(config({destination:i.destination,model:i.model}).destination),async({input,identity,row,tx,recheck,purpose})=>{
   revision(input.expectedRevision);if(typeof use!=='function')fail('INVALID_KEY_REQUEST');if(!row?.enabled)fail('KEY_NOT_CONFIGURED');
   if(row.revision!==input.expectedRevision||row.destination!==input.destination||row.model!==input.model||row.securityEpoch!==identity.securityEpoch||row.membershipRevision!==identity.membershipRevision)fail('KEY_REVISION_CONFLICT');
   let key=await sealer.open(row.sealed,row);validKey(key);await recheck();
   try{const result=await use(Object.freeze({key,identity,model:row.model,destination:row.destination,revision:row.revision}));const latest=policyCopy(await tx.read(purpose));if(!equal(latest,row))fail('KEY_REVISION_CONFLICT');await recheck();return result;}finally{key=null;}
  })
 });
}
