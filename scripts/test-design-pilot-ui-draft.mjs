import assert from 'node:assert/strict';
import test from 'node:test';
import * as c from '../packages/analysis-engine/design-pilot-ui-draft.mjs';

const scope={customerId:'demo-ui-customer-a',visitId:'demo-ui-visit-a',sessionId:'demo-ui-session-a'};
const copy=value=>JSON.parse(JSON.stringify(value));
const rejects=(operation,code)=>assert.throws(operation,error=>error.code===code);
const request=(state,id,extra={})=>({requestId:id,expectedRevision:state.revision,scope,...extra});
const track=record=>Object.fromEntries(['value','original','origin','confirmed','phase','edited'].map(key=>[key,record[key]]));
const fill=(record,path)=>{record.value=[...c.getUIFieldOptions(path)].sort((a,b)=>Buffer.byteLength(b)-Buffer.byteLength(a))[0];record.original=record.value;record.confirmed=Boolean(record.value);if(record.phase!=='context'&&!path.startsWith('review.')&&path!=='care'){record.tracks.planned={...track(record),phase:'planned'};record.tracks.actual={...track(record),phase:'actual'};}};
function maximum(){
  const d=copy(c.createUIDraftPayload());d.text=c.UI_FIXTURE_TEXT.sample;d.demoLoaded=true;d.materialRevision=10;d.designRevision=20;
  for(const [field,record]of Object.entries(d.basic))fill(record,'basic.'+field);fill(d.proposal,'proposal');fill(d.care,'care');
  for(const zone of c.UI_ZONES){
    for(const [field,record]of Object.entries(d.zones[zone]))fill(record,'zones.'+zone+'.'+field);
    for(const service of ['perm','dye'])for(let i=0;i<8;i++){const group=copy(c.createUIProcessGroup(service));for(const [field,record]of Object.entries(group))fill(record,`zoneProcesses.${zone}.${service}.${i}.${field}`);d.zoneProcesses[zone][service].push(group);}
  }
  for(const name of ['perm','dye','review'])for(const [field,record]of Object.entries(d[name]))fill(record,name+'.'+field);
  let id=1;for(const stage of ['before','after'])for(const angle of ['front','back','left'])for(let i=0;i<4;i++)d.photos[stage].push({id:id++,kind:'demo',angle});
  d.analysis={materialRevision:10,sample:true};d.comparison={materialRevision:10,designRevision:20,sideNote:c.UI_SIDE_NOTES[0]};return d;
}

test('empty UI projection is explicit, frozen and distinct from model/event schema',()=>{
  const state=c.createUIDraftState(scope);assert.equal(state.schemaVersion,c.UI_STATE_SCHEMA);assert.equal(state.draft.schemaVersion,c.UI_DRAFT_SCHEMA);
  assert.ok(Object.isFrozen(state.draft.zones.bangs.direction));assert.equal(state.revision,0);assert.equal(state.status,'draft');
  assert.deepEqual(c.validateUIDraftState(state),state);assert.equal(state.draft.basic.person.phase,'context');assert.equal(state.draft.care.phase,'actual');
});
test('full 96-group UI with populated planned/actual tracks and 24 photo markers fits 512 KiB',()=>{
  const d=maximum();assert.deepEqual(c.validateUIDraftPayload(d),d);
  assert.equal(c.UI_ZONES.reduce((count,z)=>count+d.zoneProcesses[z].perm.length+d.zoneProcesses[z].dye.length,0),96);
  const bytes=Buffer.byteLength(JSON.stringify(d));assert.ok(bytes<512*1024,`${bytes} bytes`);console.log('Maximum populated UI fixture: '+bytes+' bytes');
  assert.equal(d.photos.before.length+d.photos.after.length,24);
});
test('client cannot supply authority, history, server revision, alternate schema or credentials',()=>{
  for(const extra of [{actor:'owner'},{permissions:['all']},{revisions:[]},{revision:99},{scope},{customerId:'real'},{password:'fake'}])rejects(()=>c.validateUIDraftPayload({...copy(c.createUIDraftPayload()),...extra}),'UI_INVALID_FIELDS');
  rejects(()=>c.validateUIDraftPayload({...copy(c.createUIDraftPayload()),schemaVersion:'design-pilot-local-v2'}),'UI_SCHEMA_MISMATCH');
  for(const text of ['real personal information','https://example.test/private','data:image/png;base64,AAAA','sk-synthetic12345678901234567890'])rejects(()=>c.validateUIDraftPayload({...copy(c.createUIDraftPayload()),text}),'UI_SYNTHETIC_TEXT_ONLY');
  const proto=JSON.parse(JSON.stringify(c.createUIDraftPayload()).replace('"synthetic":true','"synthetic":true,"__proto__":{"polluted":true}'));rejects(()=>c.validateUIDraftPayload(proto),'UI_INVALID_FIELDS');assert.equal(Object.prototype.polluted,undefined);
});
test('record values use field-specific catalogue, preserve provenance and reject nested spoofing',()=>{
  const d=copy(c.createUIDraftPayload());d.basic.style.value=c.UI_FIXTURE_TEXT.rodA;rejects(()=>c.validateUIDraftPayload(d),'UI_INVALID_VALUE');
  d.basic.style.value=c.UI_FIXTURE_TEXT.style;d.basic.style.confirmed=true;rejects(()=>c.validateUIDraftPayload(d),'UI_INVALID_CONFIRMATION');
  d.basic.style.original=c.UI_FIXTURE_TEXT.style;assert.doesNotThrow(()=>c.validateUIDraftPayload(d));
  d.basic.style.owner=true;rejects(()=>c.validateUIDraftPayload(d),'UI_INVALID_FIELDS');delete d.basic.style.owner;
  d.basic.style.tracks.actual={...track(d.basic.style),phase:'actual'};rejects(()=>c.validateUIDraftPayload(d),'UI_INVALID_TRACK');
});
test('direction source labels are allowed while direction value remains a strict key',()=>{
  const d=copy(c.createUIDraftPayload());Object.assign(d.zones.bangs.direction,{value:'down',original:'向下',confirmed:true});assert.doesNotThrow(()=>c.validateUIDraftPayload(d));
  d.zones.bangs.direction.value='向下';rejects(()=>c.validateUIDraftPayload(d),'UI_INVALID_VALUE');
});
test('group arrays preserve independent positions, sides, services and exact tracks',()=>{
  const d=copy(c.createUIDraftPayload());for(const service of ['perm','dye'])for(let i=0;i<2;i++)d.zoneProcesses.bangs[service].push(copy(c.createUIProcessGroup(service)));
  const left=d.zoneProcesses.bangs.perm[0],right=d.zoneProcesses.bangs.perm[1];
  Object.assign(left.placement,{value:c.UI_FIXTURE_TEXT.left,original:c.UI_FIXTURE_TEXT.left});Object.assign(right.placement,{value:c.UI_FIXTURE_TEXT.right,original:c.UI_FIXTURE_TEXT.right});
  Object.assign(left.rods,{value:c.UI_FIXTURE_TEXT.rodA,original:c.UI_FIXTURE_TEXT.rodA,confirmed:true});left.rods.tracks.actual={value:c.UI_FIXTURE_TEXT.rodB,original:c.UI_FIXTURE_TEXT.rodB,origin:'manual',phase:'actual',confirmed:false,edited:false};
  const validated=c.validateUIDraftPayload(d);assert.equal(validated.zoneProcesses.bangs.perm[0].rods.value,c.UI_FIXTURE_TEXT.rodA);assert.equal(validated.zoneProcesses.bangs.perm[0].rods.tracks.actual.value,c.UI_FIXTURE_TEXT.rodB);assert.equal(validated.zoneProcesses.bangs.perm[1].placement.value,c.UI_FIXTURE_TEXT.right);assert.equal(validated.zoneProcesses.bangs.dye[0].colors.value,'');
  left.rods.tracks.actual.phase='planned';rejects(()=>c.validateUIDraftPayload(d),'UI_INVALID_VALUE');
});
test('demo provenance cannot assert invented extraction or suggestion',()=>{
  const d=copy(c.createUIDraftPayload());Object.assign(d.basic.style,{value:c.UI_FIXTURE_TEXT.style,original:c.UI_FIXTURE_TEXT.quote,origin:'demo_extract'});assert.doesNotThrow(()=>c.validateUIDraftPayload(d));
  d.basic.style.value=c.UI_FIXTURE_TEXT.styleB;rejects(()=>c.validateUIDraftPayload(d),'UI_INVALID_PROVENANCE');
  d.basic.style.edited=true;assert.doesNotThrow(()=>c.validateUIDraftPayload(d));
});
test('only bounded built-in photo metadata passes, never URLs, filenames, bytes or local kinds',()=>{
  const d=copy(c.createUIDraftPayload());d.photos.before=[{id:1,kind:'demo',angle:'front'}];assert.doesNotThrow(()=>c.validateUIDraftPayload(d));
  for(const extra of [{url:'blob:synthetic'},{filename:'synthetic.png'},{bytes:'AAAA'},{base64:'AAAA'}]){d.photos.before=[{id:1,kind:'demo',angle:'front',...extra}];rejects(()=>c.validateUIDraftPayload(d),'UI_INVALID_FIELDS');}
  d.photos.before=[{id:1,kind:'local',angle:'front'}];rejects(()=>c.validateUIDraftPayload(d),'UI_SYNTHETIC_PHOTO_ONLY');
  d.photos.before=[{id:1,kind:'demo',angle:'front'}];d.photos.after=[{id:1,kind:'demo',angle:'front'}];rejects(()=>c.validateUIDraftPayload(d),'UI_PHOTO_ID');
  d.photos.after=[];d.photos.before=Array.from({length:5},(_,i)=>({id:i+1,kind:'demo',angle:'left'}));rejects(()=>c.validateUIDraftPayload(d),'UI_PHOTO_LIMIT');
});
test('comparison/analysis cannot claim unseen current material or matching wrong sides',()=>{
  const d=copy(c.createUIDraftPayload());d.analysis={materialRevision:1,sample:false};rejects(()=>c.validateUIDraftPayload(d),'UI_INVALID_REVISION');
  d.analysis={materialRevision:0,sample:true};rejects(()=>c.validateUIDraftPayload(d),'UI_INVALID_PROVENANCE');d.analysis=null;
  d.comparison={materialRevision:0,designRevision:0,sideNote:c.UI_SIDE_NOTES[0]};rejects(()=>c.validateUIDraftPayload(d),'UI_INVALID_COMPARISON');
  let id=1;for(const stage of ['before','after'])for(const angle of ['front','back',stage==='before'?'left':'right'])d.photos[stage].push({id:id++,kind:'demo',angle});
  rejects(()=>c.validateUIDraftPayload(d),'UI_INVALID_COMPARISON');d.comparison.sideNote=c.UI_SIDE_NOTES[1];assert.doesNotThrow(()=>c.validateUIDraftPayload(d));
});
test('save uses CAS, exact scope and idempotent payload, preserving source/history across reload',()=>{
  const initial=c.createUIDraftState(scope),d=copy(initial.draft);d.text=c.UI_FIXTURE_TEXT.sample;d.materialRevision=1;d.designRevision=1;
  const req=request(initial,'save-1',{draft:d});const saved=c.saveUIDraft(initial,req);assert.equal(saved.uiDraft.revision,1);assert.equal(initial.revision,0);
  const second=c.saveUIDraft(saved.uiDraft,request(saved.uiDraft,'save-2',{draft:{...d,transcript:c.UI_FIXTURE_TEXT.transcript,materialRevision:2,designRevision:2}})).uiDraft;
  assert.equal(c.saveUIDraft(second,req).replayed,true);assert.equal(c.saveUIDraft(second,req).appliedRevision,1);
  rejects(()=>c.saveUIDraft(second,{...req,requestId:'stale'}),'REVISION_CONFLICT');rejects(()=>c.saveUIDraft(second,{...req,draft:{...d,text:''}}),'IDEMPOTENCY_CONFLICT');
  for(const key of Object.keys(scope))rejects(()=>c.saveUIDraft(second,{...request(second,'foreign',{draft:d}),scope:{...scope,[key]:'foreign'}}),'SCOPE_MISMATCH');
  assert.deepEqual(c.validateUIDraftState(copy(second)),second);
});
test('archive is built from saved state only, then reopening appends with immutable parent',()=>{
  let state=c.createUIDraftState(scope);const d=copy(state.draft);d.proposal.value=c.UI_FIXTURE_TEXT.proposal;d.proposal.original=c.UI_FIXTURE_TEXT.quote;d.proposal.origin='demo_suggest';d.proposal.confirmed=true;d.designRevision=1;
  state=c.saveUIDraft(state,request(state,'save',{draft:d})).uiDraft;const saved=copy(state);
  const archiveRequest=request(state,'archive');state=c.archiveUIDraft(state,archiveRequest).uiDraft;const archive=c.createUIDraftArchive(state),before=JSON.stringify(archive);
  assert.deepEqual(archive.snapshot.draft,saved.draft);assert.equal(archive.snapshot.draft.proposal.phase,'planned');
  rejects(()=>c.archiveUIDraft(saved,{...archiveRequest,draft:d}),'UI_INVALID_FIELDS');rejects(()=>c.saveUIDraft(state,request(state,'edit-closed',{draft:d})),'ARCHIVE_IMMUTABLE');
  const reopen=request(state,'reopen',{reason:c.UI_FIXTURE_TEXT.revisionReason});state=c.reopenUIDraft(state,archive,reopen).uiDraft;
  assert.equal(state.status,'draft');assert.equal(c.reopenUIDraft(state,archive,reopen).replayed,true);
  const modified=copy(d);modified.proposal.value=c.UI_FIXTURE_TEXT.proposalB;modified.proposal.edited=true;modified.proposal.confirmed=false;modified.designRevision++;state=c.saveUIDraft(state,request(state,'edit',{draft:modified})).uiDraft;
  assert.equal(JSON.stringify(archive),before);assert.deepEqual(c.validateUIDraftArchive(archive,scope),archive);
  state=c.archiveUIDraft(state,request(state,'archive-next')).uiDraft;assert.equal(c.createUIDraftArchive(state).previousArchiveRevision,archive.revision);
});
test('projection/revision/history corruption and wrong archive parent fail closed',()=>{
  let state=c.saveUIDraft(c.createUIDraftState(scope),{requestId:'save',expectedRevision:0,scope,draft:c.createUIDraftPayload()}).uiDraft;
  for(const change of [s=>s.revision++,s=>s.status='archived',s=>s.draft.text=c.UI_FIXTURE_TEXT.sample,s=>s.history[0].scope.visitId='foreign']){const bad=copy(state);change(bad);assert.throws(()=>c.validateUIDraftState(bad));}
  state=c.archiveUIDraft(state,request(state,'archive')).uiDraft;const archive=c.createUIDraftArchive(state);
  const bad=copy(archive);bad.previousArchiveRevision=99;rejects(()=>c.validateUIDraftArchive(bad,scope),'ARCHIVE_MISMATCH');
  rejects(()=>c.reopenUIDraft(state,archive,{...request(state,'reopen',{reason:c.UI_FIXTURE_TEXT.revisionReason}),expectedRevision:0}),'ARCHIVE_MISMATCH');
});
test('client counters cannot hide changed raw material or design as an unchanged comparison',()=>{
  const initial=c.createUIDraftState(scope),raw=copy(initial.draft);raw.text=c.UI_FIXTURE_TEXT.sample;
  rejects(()=>c.saveUIDraft(initial,request(initial,'unversioned-source',{draft:raw})),'UI_INVALID_REVISION');
  const design=copy(initial.draft);design.proposal.value=c.UI_FIXTURE_TEXT.proposal;
  rejects(()=>c.saveUIDraft(initial,request(initial,'unversioned-design',{draft:design})),'UI_INVALID_REVISION');
});
test('fixed transcript then demo analysis saves and restores without accepting another transcript',()=>{
  const state=c.createUIDraftState(scope),draft=copy(state.draft);draft.text=c.UI_FIXTURE_TEXT.sample;draft.demoLoaded=true;draft.transcript=c.UI_FIXTURE_TEXT.transcript;draft.materialRevision=2;draft.designRevision=3;draft.analysis={materialRevision:2,sample:true};
  const saved=c.saveUIDraft(state,request(state,'spoken-then-demo',{draft})).uiDraft;assert.deepEqual(c.validateUIDraftState(copy(saved)).draft,draft);
  const bad=copy(draft);bad.transcript=c.UI_FIXTURE_TEXT.alternateText;rejects(()=>c.validateUIDraftPayload(bad),'UI_INVALID_PROVENANCE');
});
