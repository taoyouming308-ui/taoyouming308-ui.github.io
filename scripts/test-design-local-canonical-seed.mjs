// Real fixed-image seed only. Never generates normalized PNG or claims approval.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createLocalCanonicalImageRuntime} from '../packages/design-production-adapter/local-canonical-image-runtime.mjs';
const root='/Users/a1/Documents/Codex/2026-11-17/ai-design-stage41-development/work/evidence/stage34/canonical-seed';
await mkdir(root,{recursive:true,mode:0o700});
const runtime=createLocalCanonicalImageRuntime({enabled:true});
for(const mime of ['image/jpeg','image/webp']){
 const r=await runtime.prepareSyntheticSource({mime,maxEdge:1024,signal:null});
 const ext=mime==='image/jpeg'?'jpg':'webp';
 try{
  assert.equal(r.mime,mime);assert.equal(r.maxEdge,1024);
  assert.equal(Object.hasOwn(r,'normalizedBytes'),false);
  for(const [name,bytes]of [['source',r.sourceBytes],['parent',r.parentBytes]]){
   assert(bytes.length>0&&bytes.length<=262144);
   await writeFile(`${root}/${name}.${ext}`,bytes,{mode:0o600,flag:'wx'});
  }
  const summary={mime,fixtureId:r.fixtureId,maxEdge:r.maxEdge,source:{byteLength:r.sourceBytes.length,sha256:createHash('sha256').update(r.sourceBytes).digest('hex')},parent:{byteLength:r.parentBytes.length,sha256:createHash('sha256').update(r.parentBytes).digest('hex')},normalizedGenerated:false};
  await writeFile(`${root}/${ext}.json`,JSON.stringify(summary,null,2),{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({test:'fixed source/parent seed',...summary}));
 }finally{r.sourceBytes.fill(0);r.parentBytes.fill(0);}
}
console.log('PASS 2 fixed synthetic seed branches; no normalized object or verifier report generated');
