/** Fixed same-connection capabilities; no transaction, issuer or network default. */
import {types} from 'node:util';
import {artifactCopy as copy,artifactExact as exact} from './postgres-artifact-access-repository.mjs';
import {validateImmutableDesignAuthority} from './immutable-authority.mjs';
const fail=()=>{throw Object.assign(Error('BROWSER_ARCHIVE_CAPABILITY_DENIED'),{code:'BROWSER_ARCHIVE_CAPABILITY_DENIED',retryable:false});};
export function createBrowserArchiveCommandAuthority(client){
 if(!client||types.isProxy(client))fail();const d=Object.getOwnPropertyDescriptor(client,'query');if(!d||!Object.hasOwn(d,'value')||typeof d.value!=='function'||types.isProxy(d.value))fail();const fn=d.value;let busy=false,poisoned=false;
 async function call(sql,args,write){if(busy||poisoned){poisoned=true;fail();}busy=true;try{const result=await Reflect.apply(fn,client,[sql,args]);if(!result||types.isProxy(result))fail();const desc=Object.getOwnPropertyDescriptor(result,'rows');if(!desc||!Object.hasOwn(desc,'value'))fail();const rows=copy(desc.value);if(!Array.isArray(rows)||rows.length!==1)fail();exact(rows[0],['value']);const v=rows[0].value;if(write){if(v!==true)fail();}else if(v!==null)exact(v,['command','version','receipt']);return v;}catch{poisoned=true;fail();}finally{busy=false;}}
 return Object.freeze({read(authority,requestId){const a=validateImmutableDesignAuthority(copy(authority));if(typeof requestId!=='string'||!/^[-A-Za-z0-9_]{1,80}$/.test(requestId))fail();return call('SELECT design_browser_archive_command.read_command($1::jsonb,$2::text) AS value',[a,requestId],false);},append(authority,value){const a=validateImmutableDesignAuthority(copy(authority)),v=copy(value);exact(v,['command','expectedSourceFingerprint','version','receipt']);return call('SELECT design_browser_archive_command.append_current($1::jsonb,$2::jsonb) AS value',[a,v],true);}});
}
