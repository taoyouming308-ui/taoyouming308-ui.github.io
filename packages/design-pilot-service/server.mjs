/** Local synthetic fixture server. Never a production authentication boundary. */
import http from 'node:http';
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import * as contract from '../analysis-engine/design-pilot.mjs';
import * as uiContract from '../analysis-engine/design-pilot-ui-draft.mjs';

export const SYNTHETIC_ACTORS = Object.freeze([
  Object.freeze({ id:'demo-stylist-a', customerId:'demo-customer-a', visitId:'demo-visit-a' }),
  Object.freeze({ id:'demo-stylist-b', customerId:'demo-customer-b', visitId:'demo-visit-b' })
]);
export const UI_SYNTHETIC_ACTOR='demo-ui-owner';
export const UI_SYNTHETIC_CUSTOMERS=Object.freeze([
  Object.freeze({id:'demo-booking-a',title:'模拟预约 A',kind:'预约',scope:Object.freeze({customerId:'demo-ui-customer-a',visitId:'demo-ui-visit-a',sessionId:'demo-ui-session-a'})}),
  Object.freeze({id:'demo-booking-b',title:'模拟预约 B',kind:'预约',scope:Object.freeze({customerId:'demo-ui-customer-b',visitId:'demo-ui-visit-b',sessionId:'demo-ui-session-b'})}),
  Object.freeze({id:'demo-walk-in',title:'模拟散客 C',kind:'散客',scope:Object.freeze({customerId:'demo-ui-customer-c',visitId:'demo-ui-visit-c',sessionId:'demo-ui-session-c'})}),
]);
const FORMAT='synthetic-design-pilot-store-v1';
const OPT_IN='I_UNDERSTAND_SYNTHETIC_LOCAL_ONLY';
const BODY_LIMIT=128*1024;
const UI_BODY_LIMIT=768*1024;
const STORE_LIMIT=32*1024*1024;
const SESSION_LIMIT=20;
const RECEIPT_LIMIT=2400;
const ARCHIVE_LIMIT=200;
const STATIC_FILES=Object.freeze({
  'ai-design-pilot-service-test.html':'text/html; charset=utf-8',
  'ai-design-pilot-service-test.js':'text/javascript; charset=utf-8',
  'ai-design-pilot-service-test.css':'text/css; charset=utf-8'
  ,'ai-design-pilot-connected.html':'text/html; charset=utf-8'
  ,'ai-design-pilot-connected.js':'text/javascript; charset=utf-8'
  ,'ai-design-pilot.js':'text/javascript; charset=utf-8'
  ,'ai-design-pilot.css':'text/css; charset=utf-8'
});
const CSP="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const UI_CSP=CSP.replace("img-src 'none'","img-src data:");
export class PilotServiceError extends Error {
  constructor(code,message,status=400){super(message);this.name='PilotServiceError';this.code=code;this.status=status;}
}
function fail(code,message,status){throw new PilotServiceError(code,message,status);}
function check(value,code,message,status){if(!value)fail(code,message,status);}
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;}
function exact(value,keys,label){check(object(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|'),'INVALID_FIELDS',label+' has missing or unsupported fields');}
function identifier(value,label){check(typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value)&&!['__proto__','prototype','constructor'].includes(value),'INVALID_ID',label+' must be a short alphanumeric fixture identifier');}
function revision(value){check(Number.isSafeInteger(value)&&value>=0,'INVALID_REVISION','Expected revision must be a nonnegative integer');}
function canonical(value){
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  check(object(value),'INVALID_JSON','Only plain JSON values are accepted');
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
}
const clone=value=>JSON.parse(canonical(value));
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
function jsonSafety(value,depth=0,count={value:0}){
  check(depth<=30&&++count.value<=25000,'PAYLOAD_LIMIT','JSON structure exceeds the local fixture limit',413);
  if(typeof value==='string'){
    check(value.length<=14000,'PAYLOAD_LIMIT','Text exceeds the local fixture limit',413);
    check(!/(?:data:|blob:|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[a-zA-Z0-9_-]{16,}|[a-zA-Z0-9+/]{256,}={0,2})/i.test(value),'UNSAFE_PAYLOAD','Image/audio payloads and credentials are not accepted');
  } else if(Array.isArray(value))value.forEach(item=>jsonSafety(item,depth+1,count));
  else if(object(value))Object.entries(value).forEach(([key,item])=>{
    check(!['__proto__','prototype','constructor'].includes(key),'INVALID_FIELDS','Unsafe object key');jsonSafety(item,depth+1,count);
  });
}
function syntheticSource(source){
  exact(source,['messageId','kind','actor','text'],'source');identifier(source.messageId,'messageId');
  check(['text','speech_transcript'].includes(source.kind)&&['customer','employee'].includes(source.actor),'SYNTHETIC_SOURCE_ONLY','Only synthetic person text/transcripts are accepted; no image or model source');
  check(typeof source.text==='string'&&source.text.startsWith('【合成测试】'),'SYNTHETIC_SOURCE_ONLY','Fixture source text must begin with 【合成测试】');
}
function syntheticEvent(event){
  check(object(event),'INVALID_EVENT','A contract event is required');
  check(['source_recorded','entry_recorded','entry_confirmed','phase_advanced'].includes(event.type),'UNSUPPORTED_EVENT','Use the dedicated revision endpoint for archive continuation');
  if(event.type==='source_recorded')syntheticSource(event.source);
}
function scopeValue(scope){exact(scope,['customerId','visitId','sessionId'],'scope');Object.entries(scope).forEach(([key,value])=>identifier(value,key));}
function fixtureRelation(actor,scope){
  const fixture=SYNTHETIC_ACTORS.find(item=>item.id===actor);
  return fixture&&fixture.customerId===scope.customerId&&fixture.visitId===scope.visitId;
}
function uiFixtureRelation(actor,scope){return actor===UI_SYNTHETIC_ACTOR&&UI_SYNTHETIC_CUSTOMERS.some(item=>canonical(item.scope)===canonical(scope));}
function initialState(){return {format:FORMAT,mode:'synthetic-only',commitRevision:0,sessions:{},archives:{},receipts:{},uiDrafts:{},uiArchives:{},uiReceipts:{}};}
function validateState(data){
  // Additive in-memory upgrade only: old event maps/archives/digests are untouched.
  if(object(data)&&Object.keys(data).sort().join('|')===['format','mode','commitRevision','sessions','archives','receipts'].sort().join('|'))data={...data,uiDrafts:{},uiArchives:{},uiReceipts:{}};
  exact(data,['format','mode','commitRevision','sessions','archives','receipts','uiDrafts','uiArchives','uiReceipts'],'store');
  check(data.format===FORMAT&&data.mode==='synthetic-only','STORE_INVALID','Not a synthetic pilot store',500);revision(data.commitRevision);
  for(const key of ['sessions','archives','receipts','uiDrafts','uiArchives','uiReceipts'])check(object(data[key]),'STORE_INVALID','Invalid store map',500);
  check(Object.keys(data.sessions).length<=SESSION_LIMIT&&Object.keys(data.archives).length<=ARCHIVE_LIMIT&&Object.keys(data.receipts).length<=RECEIPT_LIMIT,'STORE_LIMIT','Store exceeds bounded fixture capacity',500);
  for(const [id,row] of Object.entries(data.sessions)){
    identifier(id,'stored session ID');exact(row,['actor','session'],'session row');
    const session=contract.validateDesignSession(row.session);scopeValue(session.scope);
    check(session.scope.sessionId===id&&fixtureRelation(row.actor,session.scope),'STORE_INVALID','Stored session escapes the synthetic relationship whitelist',500);
    session.sources.forEach(syntheticSource);
  }
  for(const [id,row] of Object.entries(data.archives)){
    exact(row,['archiveId','actor','sessionId','archive','sha256'],'archive row');
    check(id===row.archiveId&&id==='ar-'+row.sessionId+'-'+row.archive.revision,'STORE_INVALID','Invalid archive identity',500);
    const sessionRow=data.sessions[row.sessionId];
    check(sessionRow&&row.actor===sessionRow.actor&&fixtureRelation(row.actor,row.archive.scope),'STORE_INVALID','Archive scope has no authorized session',500);
    contract.validateDesignArchive(row.archive,sessionRow.session.scope);
    check(digest(row.archive)===row.sha256,'STORE_INVALID','Archive integrity digest differs',500);
    check(row.archive.revision<=sessionRow.session.revision,'STORE_INVALID','Archive revision is ahead of session',500);
    check(canonical(sessionRow.session.journal.slice(0,row.archive.snapshot.journal.length))===canonical(row.archive.snapshot.journal),'STORE_INVALID','Archive journal is not an immutable prefix of its session',500);
  }
  for(const [id,row] of Object.entries(data.sessions)){
    for(const request of row.session.journal){
      if(request.event.type!=='revision_opened')continue;
      const parent=data.archives['ar-'+id+'-'+request.event.parentArchiveRevision];
      check(parent&&parent.actor===row.actor&&parent.sessionId===id,'STORE_INVALID','Revision journal has no persisted same-actor/session parent archive',500);
      check(parent.archive.revision===request.event.parentArchiveRevision&&canonical(parent.archive.snapshot.journal)===canonical(row.session.journal.slice(0,request.event.parentArchiveRevision)),'STORE_INVALID','Revision parent archive is not its exact journal checkpoint',500);
    }
  }
  for(const [key,receipt] of Object.entries(data.receipts)){
    exact(receipt,['actor','requestId','operation','payloadHash','result'],'receipt');identifier(receipt.requestId,'stored request ID');
    check(key===receipt.actor+'|'+receipt.requestId&&SYNTHETIC_ACTORS.some(item=>item.id===receipt.actor),'STORE_INVALID','Invalid idempotency identity',500);
    check(typeof receipt.operation==='string'&&/^(create|event|archive|revision):[A-Za-z0-9_-]{1,80}$/.test(receipt.operation)&&/^[a-f0-9]{64}$/.test(receipt.payloadHash),'STORE_INVALID','Invalid idempotency receipt',500);
    exact(receipt.result,['sessionId','appliedRevision','archiveId'],'receipt result');
    const row=data.sessions[receipt.result.sessionId];
    check(row&&row.actor===receipt.actor,'STORE_INVALID','Receipt has no matching authorized session',500);
    revision(receipt.result.appliedRevision);check(receipt.result.appliedRevision<=row.session.revision,'STORE_INVALID','Receipt points beyond latest revision',500);
    const [operation,operationSessionId]=receipt.operation.split(':');
    check(operationSessionId===receipt.result.sessionId,'STORE_INVALID','Receipt operation and result session differ',500);
    const archived=receipt.result.archiveId===null?null:data.archives[receipt.result.archiveId];
    if(receipt.result.archiveId!==null)check(archived&&archived.actor===receipt.actor&&archived.sessionId===receipt.result.sessionId,'STORE_INVALID','Receipt archive is missing or belongs to another actor/session',500);
    let expectedPayload;
    if(operation==='create'){
      check(receipt.result.appliedRevision===0&&!archived,'STORE_INVALID','Create receipt has invalid revision or archive',500);
      expectedPayload={requestId:receipt.requestId,...row.session.scope};
    }else if(operation==='archive'){
      check(archived&&archived.archive.revision===receipt.result.appliedRevision,'STORE_INVALID','Archive receipt does not match its checkpoint',500);
      expectedPayload={requestId:receipt.requestId,expectedRevision:receipt.result.appliedRevision,scope:row.session.scope};
    }else{
      const applied=row.session.journal[receipt.result.appliedRevision-1];
      check(applied&&applied.requestId===receipt.requestId,'STORE_INVALID','Receipt does not identify its applied journal request',500);
      if(operation==='event'){
        check(!archived&&['source_recorded','entry_recorded','entry_confirmed','phase_advanced'].includes(applied.event.type),'STORE_INVALID','Event receipt points to an unsupported event or archive',500);
        expectedPayload=applied;
      }else{
        check(applied.event.type==='revision_opened'&&archived&&archived.archive.revision===applied.event.parentArchiveRevision,'STORE_INVALID','Revision receipt does not match its exact parent archive',500);
        expectedPayload={requestId:applied.requestId,expectedRevision:applied.expectedRevision,scope:applied.scope,resumePhase:applied.event.resumePhase,reasonSource:applied.event.reasonSource};
      }
    }
    check(digest(expectedPayload)===receipt.payloadHash,'STORE_INVALID','Receipt digest does not match its operation and journal',500);
  }
  validateUIStore(data);
  return data;
}
function validateUIStore(data){
  check(Object.keys(data.uiDrafts).length<=UI_SYNTHETIC_CUSTOMERS.length&&Object.keys(data.uiArchives).length<=ARCHIVE_LIMIT&&Object.keys(data.uiReceipts).length<=RECEIPT_LIMIT,'STORE_LIMIT','UI fixture capacity exceeded',500);
  for(const [id,row] of Object.entries(data.uiDrafts)){
    exact(row,['actor','uiDraft'],'UI draft row');const state=uiContract.validateUIDraftState(row.uiDraft);
    check(id===state.scope.sessionId&&uiFixtureRelation(row.actor,state.scope),'STORE_INVALID','UI row escapes its fixed synthetic relationship',500);
  }
  for(const [id,row] of Object.entries(data.uiArchives)){
    exact(row,['archiveId','actor','sessionId','archive','sha256','createdAt'],'UI archive row');
    const current=data.uiDrafts[row.sessionId];
    check(current&&current.actor===row.actor&&id===row.archiveId&&id==='uia-'+row.sessionId+'-'+row.archive.revision,'STORE_INVALID','Invalid UI archive identity',500);
    uiContract.validateUIDraftArchive(row.archive,current.uiDraft.scope);
    check(digest(row.archive)===row.sha256&&typeof row.createdAt==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.createdAt),'STORE_INVALID','UI archive digest/time invalid',500);
    check(row.archive.revision<=current.uiDraft.revision&&canonical(row.archive.snapshot.history)===canonical(current.uiDraft.history.slice(0,row.archive.revision)),'STORE_INVALID','UI archive is not an exact immutable history prefix',500);
  }
  for(const [id,row] of Object.entries(data.uiDrafts))for(const request of row.uiDraft.history){
    if(request.operation==='archive'||request.operation==='reopen'){
      const revision=request.operation==='archive'?request.expectedRevision+1:request.parentArchiveRevision,parent=data.uiArchives['uia-'+id+'-'+revision];
      check(parent&&parent.actor===row.actor&&parent.sessionId===id,'STORE_INVALID','UI archive/reopen history has no persisted same-scope checkpoint',500);
      check(canonical(parent.archive.snapshot.history)===canonical(row.uiDraft.history.slice(0,revision)),'STORE_INVALID','UI parent archive does not match history',500);
    }
  }
  for(const [key,receipt] of Object.entries(data.uiReceipts)){
    exact(receipt,['actor','requestId','operation','payloadHash','result'],'UI receipt');identifier(receipt.requestId,'UI stored request ID');
    check(!Object.hasOwn(data.receipts,key)&&key===receipt.actor+'|'+receipt.requestId&&receipt.actor===UI_SYNTHETIC_ACTOR,'STORE_INVALID','UI receipt identity collision',500);
    check(typeof receipt.operation==='string'&&/^ui-(create|save|archive|reopen):[A-Za-z0-9_-]{1,80}$/.test(receipt.operation)&&/^[a-f0-9]{64}$/.test(receipt.payloadHash),'STORE_INVALID','UI receipt operation/digest invalid',500);
    exact(receipt.result,['sessionId','appliedRevision','archiveId'],'UI receipt result');const row=data.uiDrafts[receipt.result.sessionId];
    check(row&&row.actor===receipt.actor,'STORE_INVALID','UI receipt has no matching owner/session',500);
    const [operation,id]=receipt.operation.split(':');check(id===receipt.result.sessionId,'STORE_INVALID','UI receipt route differs from result',500);
    revision(receipt.result.appliedRevision);check(receipt.result.appliedRevision<=row.uiDraft.revision,'STORE_INVALID','UI receipt exceeds history',500);
    const archived=receipt.result.archiveId===null?null:data.uiArchives[receipt.result.archiveId];
    if(receipt.result.archiveId!==null)check(archived&&archived.actor===receipt.actor&&archived.sessionId===id,'STORE_INVALID','UI receipt archive escapes owner/session',500);
    let expected;
    if(operation==='ui-create'){
      check(receipt.result.appliedRevision===0&&!archived,'STORE_INVALID','UI creation receipt has invalid revision/archive',500);
      expected={requestId:receipt.requestId,scope:row.uiDraft.scope};
    }else{
      const applied=row.uiDraft.history[receipt.result.appliedRevision-1];
      check(applied&&applied.requestId===receipt.requestId&&operation==='ui-'+applied.operation,'STORE_INVALID','UI receipt does not bind its history request',500);
      expected={requestId:applied.requestId,expectedRevision:applied.expectedRevision,scope:applied.scope};
      if(applied.operation==='save'){check(!archived,'STORE_INVALID','UI save receipt cannot expose archive',500);expected.draft=applied.draft;}
      else if(applied.operation==='archive')check(archived&&archived.archive.revision===receipt.result.appliedRevision,'STORE_INVALID','UI archive receipt checkpoint differs',500);
      else {check(archived&&archived.archive.revision===applied.parentArchiveRevision,'STORE_INVALID','UI reopen receipt parent differs',500);expected.reason=applied.reason;}
    }
    check(digest(expected)===receipt.payloadHash,'STORE_INVALID','UI receipt digest differs from its exact history payload',500);
  }
}
function serialQueue(){let tail=Promise.resolve();return operation=>{const result=tail.then(operation);tail=result.catch(()=>{});return result;};}

// Dependency-injection seam intentionally registers only a local synthetic adapter.
// Arbitrary remote stores, identities and credentials cannot be passed over HTTP.
const registeredStorageAdapters=new WeakSet();
export function createSyntheticMemoryStorageAdapter(){
  let data=null,currentLease=null;
  const adapter=Object.freeze({kind:'synthetic-memory',mode:'synthetic-only',async open(){
    check(currentLease===null,'STORE_LOCKED','This synthetic memory adapter already has a writer',409);const lease=Symbol('synthetic-memory-lease');currentLease=lease;let closed=false;
    const requireLease=()=>check(!closed&&currentLease===lease,'STORE_CLOSED','Synthetic memory lease is closed',503);
    return {async load(){requireLease();return validateState(clone(data||initialState()));},
      async persist(next,authorize){requireLease();const checked=validateState(clone(next));check(Buffer.byteLength(canonical(checked))<=STORE_LIMIT,'STORE_LIMIT','Synthetic memory store is full',413);authorize();requireLease();data=checked;},
      async close(){if(closed)return;closed=true;if(currentLease===lease)currentLease=null;}};
  }});registeredStorageAdapters.add(adapter);return adapter;
}

async function openStore(dataDir,fault){
  check(typeof dataDir==='string'&&path.isAbsolute(dataDir)&&path.dirname(dataDir)!==dataDir,'INVALID_DIRECTORY','Pass an explicit absolute dedicated fixture directory');
  await fs.mkdir(dataDir,{recursive:true,mode:0o700});
  const directoryStat=await fs.lstat(dataDir);check(directoryStat.isDirectory()&&!directoryStat.isSymbolicLink(),'UNSAFE_DIRECTORY','Fixture directory must not be a symlink');
  const directory=await fs.realpath(dataDir),storeFile=path.join(directory,'store.json'),lockFile=path.join(directory,'.service.lock'),markerFile=path.join(directory,'.initialized');
  const nonce=randomUUID();let lock;
  try{lock=await fs.open(lockFile,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);}
  catch(error){if(error.code==='EEXIST')fail('STORE_LOCKED','Another instance or an unclean exit owns this fixture directory; do not bypass its lock',409);throw error;}
  await lock.writeFile(JSON.stringify({format:FORMAT,pid:process.pid,nonce}));await lock.sync();
  let closed=false,hasStore=false,initialized=false;
  async function close(){
    if(closed)return;closed=true;await lock.close();
    try{const held=JSON.parse(await fs.readFile(lockFile,'utf8'));if(held.nonce===nonce)await fs.unlink(lockFile);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  async function load(){
    let handle;
    try{
      handle=await fs.open(storeFile,constants.O_RDONLY|constants.O_NOFOLLOW);const stat=await handle.stat();
      check(stat.isFile()&&stat.size<=STORE_LIMIT,'STORE_INVALID','Fixture store is not a bounded regular file',500);
      let data;try{data=JSON.parse(await handle.readFile('utf8'));}catch{fail('STORE_CORRUPT','Fixture store is incomplete or invalid; original file has been preserved',500);}
      hasStore=true;return validateState(data);
    }catch(error){if(error.code==='ENOENT'){check(!hasStore&&!initialized,'STORE_MISSING','Previously initialized fixture store is missing; refusing to initialize over it',500);return initialState();}throw error;}finally{if(handle)await handle.close();}
  }
  async function persist(data,authorize){
    validateState(data);const bytes=Buffer.from(canonical(data)+'\n');check(bytes.length<=STORE_LIMIT,'STORE_LIMIT','Fixture store is full',413);
    const temp=path.join(directory,'.store-'+randomUUID()+'.tmp');let handle;
    try{
      handle=await fs.open(temp,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
      await handle.writeFile(bytes);await handle.sync();
      if(fault)await fault('after-temp-sync',{temp,storeFile});
      authorize();await handle.close();handle=null;
      await fs.rename(temp,storeFile);
      hasStore=true;
      if(fault)await fault('after-rename',{storeFile});
      // macOS/Linux directory fsync makes the atomic rename durable across a power loss.
      const dirHandle=await fs.open(directory,constants.O_RDONLY);try{await dirHandle.sync();}finally{await dirHandle.close();}
    }finally{if(handle)await handle.close();await fs.unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  }
  try{
    let marker;
    try{
      marker=await fs.open(markerFile,constants.O_RDONLY|constants.O_NOFOLLOW);const markerStat=await marker.stat();
      check(markerStat.isFile()&&markerStat.size<1024,'STORE_INVALID','Invalid initialization marker',500);
      check((await marker.readFile('utf8'))===FORMAT+'\n','STORE_INVALID','Unrecognized initialization marker',500);initialized=true;
    }catch(error){if(error.code!=='ENOENT')throw error;}finally{if(marker)await marker.close();}
    await load();
    if(!hasStore)await persist(initialState(),()=>{});
    if(!initialized){
      const created=await fs.open(markerFile,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
      try{await created.writeFile(FORMAT+'\n');await created.sync();}finally{await created.close();}
      const dirHandle=await fs.open(directory,constants.O_RDONLY);try{await dirHandle.sync();}finally{await dirHandle.close();}
      initialized=true;
    }
  }catch(error){await close();throw error;}
  return {load,persist,close};
}

/** relationshipAllowed may revoke a whitelist relationship, never expand it. */
export async function startSyntheticDesignService(options={}){
  check(options.optIn===OPT_IN,'OPT_IN_REQUIRED','This local fixture service requires explicit synthetic-only opt-in');
  check((process.env.NODE_ENV||'').trim().toLowerCase()!=='production','PRODUCTION_DISABLED','This fixture service cannot run in production');
  const port=options.port===undefined?0:options.port;
  check(Number.isInteger(port)&&port>=0&&port<=65535,'INVALID_PORT','Port must be 0 or a valid local port');
  check(options.host===undefined||options.host==='127.0.0.1','LOOPBACK_ONLY','Only 127.0.0.1 is supported');
  if(options.relationshipAllowed!==undefined)check(typeof options.relationshipAllowed==='function','INVALID_POLICY','Relationship revocation hook must be a function');
  if(options.fault!==undefined)check(typeof options.fault==='function','INVALID_TEST_HOOK','Fault hook must be a function');
  if(options.uiRoot!==undefined){
    check(typeof options.uiRoot==='string'&&path.isAbsolute(options.uiRoot),'UNSAFE_STATIC_ROOT','UI root must be an explicit absolute directory');
    const uiStat=await fs.lstat(options.uiRoot);check(uiStat.isDirectory()&&!uiStat.isSymbolicLink(),'UNSAFE_STATIC_ROOT','UI root must be a real directory, not a symlink');
  }
  if(options.storageAdapter!==undefined)check(registeredStorageAdapters.has(options.storageAdapter),'UNSUPPORTED_STORAGE_ADAPTER','Only the explicit built-in synthetic memory adapter is enabled; external stores are not configured');
  const store=options.storageAdapter?await options.storageAdapter.open():await openStore(options.dataDir,options.fault),queue=serialQueue();
  let baseURL='',closing=false;
  function authorize(actor,scope){
    scopeValue(scope);
    check(fixtureRelation(actor,scope),'FORBIDDEN','Synthetic actor has no service relationship with this fixture visit',403);
    check(!options.relationshipAllowed||options.relationshipAllowed(actor,clone(scope))===true,'RELATIONSHIP_REVOKED','Synthetic service relationship is no longer active',403);
  }
  function authorizeUI(actor,scope){
    scopeValue(scope);check(uiFixtureRelation(actor,scope),'FORBIDDEN','Synthetic actor has no UI relationship with this fixed fixture scope',403);
    check(!options.relationshipAllowed||options.relationshipAllowed(actor,clone(scope))===true,'RELATIONSHIP_REVOKED','Synthetic UI relationship is no longer active',403);
  }
  function actorFrom(request){
    check(!request.headers.authorization&&!request.headers.cookie,'CREDENTIALS_FORBIDDEN','Do not send real credentials or cookies to this synthetic service',400);
    const actor=request.headers['x-design-pilot-actor'];
    check(typeof actor==='string'&&(actor===UI_SYNTHETIC_ACTOR||SYNTHETIC_ACTORS.some(item=>item.id===actor)),'SYNTHETIC_ACTOR_REQUIRED','Choose a fixed synthetic actor; this is not real authentication',401);
    return actor;
  }
  function rowFor(state,id,actor){
    identifier(id,'sessionId');const row=Object.hasOwn(state.sessions,id)?state.sessions[id]:null;check(Boolean(row),'SESSION_NOT_FOUND','Synthetic session does not exist',404);
    authorize(actor,row.session.scope);check(row.actor===actor,'FORBIDDEN','Session belongs to another synthetic actor',403);return row;
  }
  function responseFor(state,result,replayed){
    const session=state.sessions[result.sessionId].session;
    return {ok:true,mode:'synthetic-only',replayed,appliedRevision:result.appliedRevision,session,view:contract.getDesignView(session),...(result.archiveId?{archive:clone(state.archives[result.archiveId])}:{})};
  }
  async function mutate(actor,operation,payload,scope,apply){
    identifier(payload.requestId,'requestId');authorize(actor,scope);
    return queue(async()=>{
      authorize(actor,scope);const state=await store.load();const key=actor+'|'+payload.requestId,hash=digest(payload),receipt=state.receipts[key];
      check(!Object.hasOwn(state.uiReceipts,key),'IDEMPOTENCY_CONFLICT','Request ID belongs to a different UI operation',409);
      if(receipt){
        check(receipt.operation===operation&&receipt.payloadHash===hash,'IDEMPOTENCY_CONFLICT','Request ID was already used with another operation or payload',409);
        authorize(actor,state.sessions[receipt.result.sessionId].session.scope);return responseFor(state,receipt.result,true);
      }
      check(Object.keys(state.receipts).length<RECEIPT_LIMIT,'STORE_LIMIT','Fixture request limit reached',413);
      const result=apply(state);state.commitRevision++;
      state.receipts[key]={actor,requestId:payload.requestId,operation,payloadHash:hash,result};
      await store.persist(state,()=>authorize(actor,scope));return responseFor(state,result,false);
    });
  }
  function uiRowFor(state,id,actor){
    identifier(id,'UI sessionId');const row=Object.hasOwn(state.uiDrafts,id)?state.uiDrafts[id]:null;
    check(row,'SESSION_NOT_FOUND','Synthetic UI draft does not exist',404);authorizeUI(actor,row.uiDraft.scope);check(row.actor===actor,'FORBIDDEN','UI draft belongs to another synthetic actor',403);return row;
  }
  function uiResponse(state,result,replayed){
    const current=state.uiDrafts[result.sessionId].uiDraft;
    const archives=Object.values(state.uiArchives).filter(item=>item.sessionId===result.sessionId).sort((a,b)=>a.archive.revision-b.archive.revision).map((item,index)=>({number:index+1,createdAt:item.createdAt,revision:item.archive.revision,archiveId:item.archiveId,sha256:item.sha256,previousArchiveRevision:item.archive.previousArchiveRevision,draft:clone(item.archive.snapshot.draft)}));
    return {ok:true,mode:'synthetic-only',projection:'ui-draft-not-event-contract',replayed,appliedRevision:result.appliedRevision,uiDraft:current,revision:current.revision,status:current.status,draft:current.draft,archives};
  }
  async function mutateUI(actor,operation,payload,apply){
    identifier(payload.requestId,'requestId');authorizeUI(actor,payload.scope);
    return queue(async()=>{
      authorizeUI(actor,payload.scope);const state=await store.load(),key=actor+'|'+payload.requestId,hash=digest(payload),receipt=state.uiReceipts[key];
      check(!Object.hasOwn(state.receipts,key),'IDEMPOTENCY_CONFLICT','Request ID belongs to another event operation',409);
      if(receipt){check(receipt.operation===operation&&receipt.payloadHash===hash,'IDEMPOTENCY_CONFLICT','UI request ID was already used with another operation/payload',409);authorizeUI(actor,state.uiDrafts[receipt.result.sessionId].uiDraft.scope);return uiResponse(state,receipt.result,true);}
      check(Object.keys(state.uiReceipts).length<RECEIPT_LIMIT,'STORE_LIMIT','UI receipt limit reached',413);
      const result=apply(state);state.commitRevision++;state.uiReceipts[key]={actor,requestId:payload.requestId,operation,payloadHash:hash,result};
      await store.persist(state,()=>authorizeUI(actor,payload.scope));return uiResponse(state,result,false);
    });
  }
  async function readBody(request,limit=BODY_LIMIT){
    check(request.headers['content-type']?.split(';')[0].trim()==='application/json','JSON_REQUIRED','Only application/json is accepted',415);
    check(!request.headers['content-encoding'],'ENCODING_FORBIDDEN','Compressed uploads are not accepted',415);
    const length=Number(request.headers['content-length']||0);check(Number.isFinite(length)&&length<=limit,'PAYLOAD_LIMIT','Request body is too large',413);
    const chunks=[];let size=0;
    for await(const chunk of request){size+=chunk.length;check(size<=limit,'PAYLOAD_LIMIT','Request body is too large',413);chunks.push(chunk);}
    let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('INVALID_JSON','Request body must be complete JSON');}
    check(object(value),'INVALID_JSON','Request body must be an object');jsonSafety(value);return value;
  }
  async function route(request,response){
    check(!closing,'SERVICE_CLOSING','Service is closing',503);
    check(['127.0.0.1','::ffff:127.0.0.1'].includes(request.socket.remoteAddress),'LOOPBACK_ONLY','Loopback requests only',403);
    check(request.headers.host===baseURL.slice('http://'.length),'HOST_REJECTED','Unexpected host',403);
    check(!request.headers.origin||request.headers.origin===baseURL,'ORIGIN_REJECTED','Only same-origin local requests are allowed',403);
    check(!request.headers['sec-fetch-site']||['same-origin','none'].includes(request.headers['sec-fetch-site']),'ORIGIN_REJECTED','Cross-site requests are not allowed',403);
    const url=new URL(request.url,baseURL);check(!url.search,'INVALID_PATH','Query parameters are not accepted');
    check(!/%|\\|\.{2}/.test(request.url),'INVALID_PATH','Encoded or traversal paths are not accepted');
    if(request.method==='GET'&&!url.pathname.startsWith('/api/')){
      const name=url.pathname==='/'?'ai-design-pilot-service-test.html':url.pathname.slice(1);
      check(options.uiRoot&&Object.hasOwn(STATIC_FILES,name),'NOT_FOUND','No such local fixture resource',404);
      const filename=path.join(options.uiRoot,name),stat=await fs.lstat(filename);
      check(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=1024*1024,'UNSAFE_STATIC_FILE','Only bounded regular allowlisted UI files are served',404);
      if(name==='ai-design-pilot-connected.html')response.setHeader('Content-Security-Policy',UI_CSP);
      response.setHeader('Content-Type',STATIC_FILES[name]);response.end(await fs.readFile(filename));return null;
    }
    check(['GET','POST'].includes(request.method),'METHOD_NOT_ALLOWED','Only GET and POST are supported',405);
    const actor=actorFrom(request);
    if(request.method==='GET'&&url.pathname==='/api/demo')return {ok:true,mode:'synthetic-only',warning:'Synthetic actor headers are not authentication. Never use real customer data.',actors:SYNTHETIC_ACTORS};
    if(request.method==='GET'&&url.pathname==='/api/ui-catalog'){
      const customers=UI_SYNTHETIC_CUSTOMERS.filter(item=>uiFixtureRelation(actor,item.scope)&&(!options.relationshipAllowed||options.relationshipAllowed(actor,clone(item.scope))===true));
      return {ok:true,mode:'synthetic-only',projection:'ui-draft-not-event-contract',actor,...uiContract.getUIDraftCatalogue(),customers};
    }
    if(request.method==='POST'&&url.pathname==='/api/ui-drafts'){
      const body=await readBody(request);exact(body,['requestId','scope'],'UI create');scopeValue(body.scope);
      return mutateUI(actor,'ui-create:'+body.scope.sessionId,body,state=>{
        check(!Object.hasOwn(state.uiDrafts,body.scope.sessionId),'SESSION_EXISTS','UI draft already exists',409);
        state.uiDrafts[body.scope.sessionId]={actor,uiDraft:uiContract.createUIDraftState(body.scope)};
        return {sessionId:body.scope.sessionId,appliedRevision:0,archiveId:null};
      });
    }
    const uiMatch=/^\/api\/ui-drafts\/([A-Za-z0-9_-]{1,80})(?:\/(save|archive|reopen))?$/.exec(url.pathname);
    if(uiMatch){
      const [,id,action]=uiMatch;
      if(request.method==='GET'&&!action)return queue(async()=>{const state=await store.load(),row=uiRowFor(state,id,actor);authorizeUI(actor,row.uiDraft.scope);return uiResponse(state,{sessionId:id,appliedRevision:row.uiDraft.revision,archiveId:null},false);});
      check(request.method==='POST'&&action,'METHOD_NOT_ALLOWED','Unsupported UI draft route method',405);
      const body=await readBody(request,UI_BODY_LIMIT);
      exact(body,['requestId','expectedRevision','scope',...(action==='save'?['draft']:action==='reopen'?['reason']:[])],'UI '+action);
      scopeValue(body.scope);revision(body.expectedRevision);check(body.scope.sessionId===id,'SCOPE_MISMATCH','UI route and body session must match',403);
      return mutateUI(actor,'ui-'+action+':'+id,body,state=>{
        const row=uiRowFor(state,id,actor);check(canonical(row.uiDraft.scope)===canonical(body.scope),'SCOPE_MISMATCH','UI scope must match persisted draft',403);
        check(row.uiDraft.revision===body.expectedRevision,'REVISION_CONFLICT','Expected revision must match durable UI revision',409);
        let result,archiveId=null;
        if(action==='save')result=uiContract.saveUIDraft(row.uiDraft,body);
        else if(action==='archive'){
          result=uiContract.archiveUIDraft(row.uiDraft,body);const archive=uiContract.createUIDraftArchive(result.uiDraft);archiveId='uia-'+id+'-'+archive.revision;
          check(!Object.hasOwn(state.uiArchives,archiveId),'ARCHIVE_CONFLICT','UI archive checkpoint cannot be replaced',409);
          check(Object.keys(state.uiArchives).length<ARCHIVE_LIMIT,'STORE_LIMIT','UI archive capacity reached',413);
          state.uiArchives[archiveId]={archiveId,actor,sessionId:id,archive,sha256:digest(archive),createdAt:new Date().toISOString()};
        }else{
          archiveId='uia-'+id+'-'+body.expectedRevision;const parent=state.uiArchives[archiveId];
          check(parent&&parent.actor===actor&&parent.sessionId===id,'ARCHIVE_REQUIRED','Persist the exact same-scope UI archive before reopening',409);
          result=uiContract.reopenUIDraft(row.uiDraft,parent.archive,body);
        }
        row.uiDraft=result.uiDraft;return {sessionId:id,appliedRevision:result.appliedRevision,archiveId};
      });
    }
    if(request.method==='POST'&&url.pathname==='/api/sessions'){
      const body=await readBody(request);exact(body,['requestId','customerId','visitId','sessionId'],'create session');
      const scope={customerId:body.customerId,visitId:body.visitId,sessionId:body.sessionId};
      return mutate(actor,'create:'+body.sessionId,body,scope,state=>{
        check(Object.keys(state.sessions).length<SESSION_LIMIT,'STORE_LIMIT','Fixture session limit reached',413);
        check(!Object.hasOwn(state.sessions,body.sessionId),'SESSION_EXISTS','Session identifier already exists',409);
        state.sessions[body.sessionId]={actor,session:contract.createDesignSession(scope)};
        return {sessionId:body.sessionId,appliedRevision:0,archiveId:null};
      });
    }
    const match=/^\/api\/sessions\/([A-Za-z0-9_-]{1,80})(?:\/(events|archive|archives|revisions))?$/.exec(url.pathname);
    check(match,'NOT_FOUND','No such local fixture route',404);const [,id,action]=match;
    if(request.method==='GET'&&!action)return queue(async()=>{const state=await store.load();const row=rowFor(state,id,actor);return {ok:true,mode:'synthetic-only',session:row.session,view:contract.getDesignView(row.session)};});
    if(request.method==='GET'&&action==='archives')return queue(async()=>{const state=await store.load();const row=rowFor(state,id,actor);authorize(actor,row.session.scope);return {ok:true,mode:'synthetic-only',archives:Object.values(state.archives).filter(item=>item.sessionId===id).sort((a,b)=>a.archive.revision-b.archive.revision)};});
    check(request.method==='POST'&&['events','archive','revisions'].includes(action),'METHOD_NOT_ALLOWED','Unsupported method for this fixture route',405);
    const body=await readBody(request);
    exact(body,action==='events'?['requestId','expectedRevision','scope','event']:action==='revisions'?['requestId','expectedRevision','scope','resumePhase','reasonSource']:['requestId','expectedRevision','scope'],action);
    scopeValue(body.scope);revision(body.expectedRevision);check(body.scope.sessionId===id,'SCOPE_MISMATCH','Route and body session must match exactly',403);
    if(action==='events')syntheticEvent(body.event);
    if(action==='revisions')syntheticSource(body.reasonSource);
    return mutate(actor,(action==='events'?'event':action==='revisions'?'revision':'archive')+':'+id,body,body.scope,state=>{
      const row=rowFor(state,id,actor);check(canonical(row.session.scope)===canonical(body.scope),'SCOPE_MISMATCH','Scope must match the persisted session',403);
      check(row.session.revision===body.expectedRevision,'REVISION_CONFLICT','Expected revision must match the durable latest revision',409);
      if(action==='events'){
        const result=contract.appendDesignEvent(row.session,body);row.session=result.session;
        return {sessionId:id,appliedRevision:result.appliedRevision,archiveId:null};
      }
      if(action==='revisions'){
        const archived=state.archives['ar-'+id+'-'+body.expectedRevision];check(archived,'ARCHIVE_REQUIRED','Persist the exact latest archive checkpoint before opening a revision',409);
        check(typeof contract.createDesignRevision==='function','REVISION_UNAVAILABLE','Revision contract is unavailable',503);
        const result=contract.createDesignRevision(row.session,archived.archive,body);row.session=result.session;
        return {sessionId:id,appliedRevision:result.appliedRevision,archiveId:archived.archiveId};
      }
      const archive=contract.createDesignArchive(row.session,body.scope),archiveId='ar-'+id+'-'+archive.revision;
      if(!state.archives[archiveId]){
        check(Object.keys(state.archives).length<ARCHIVE_LIMIT,'STORE_LIMIT','Fixture archive limit reached',413);
        state.archives[archiveId]={archiveId,actor,sessionId:id,archive,sha256:digest(archive)};
      }else check(canonical(state.archives[archiveId].archive)===canonical(archive),'ARCHIVE_CONFLICT','Existing archive cannot be replaced',409);
      return {sessionId:id,appliedRevision:row.session.revision,archiveId};
    });
  }
  const server=http.createServer((request,response)=>{
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Content-Security-Policy',CSP);response.setHeader('Referrer-Policy','no-referrer');response.setHeader('Cross-Origin-Resource-Policy','same-origin');
    response.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    route(request,response).then(result=>{if(result!==null){response.setHeader('Content-Type','application/json; charset=utf-8');response.end(JSON.stringify(result));}}).catch(error=>{
      const conflict=['REVISION_CONFLICT','IDEMPOTENCY_CONFLICT','ARCHIVE_IMMUTABLE','STALE_ENTRY','ARCHIVE_REQUIRED'].includes(error.code);
      const known=error instanceof PilotServiceError||error instanceof contract.DesignContractError||error instanceof uiContract.UIDraftError;
      response.statusCode=error.status||(error.code==='UI_PAYLOAD_LIMIT'?413:conflict?409:known?400:500);
      response.setHeader('Content-Type','application/json; charset=utf-8');
      response.end(JSON.stringify({ok:false,error:{code:known?error.code:'STORAGE_FAILURE',message:known?error.message:'Local fixture operation failed; reread state before retrying with the same request ID.'}}));
    });
  });
  server.requestTimeout=10000;server.headersTimeout=10000;server.keepAliveTimeout=1000;
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});}
  catch(error){await store.close();throw error;}
  baseURL='http://127.0.0.1:'+server.address().port;
  return Object.freeze({url:baseURL,actors:SYNTHETIC_ACTORS,async close(){if(closing)return;closing=true;await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await queue(()=>store.close());}});
}

export { OPT_IN as SYNTHETIC_OPT_IN };
