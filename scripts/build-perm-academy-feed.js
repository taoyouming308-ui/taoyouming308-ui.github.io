#!/usr/bin/env node
// Explicit reviewed publication only. No scheduler, network, AI or business database access.
const fs=require('node:fs'),crypto=require('node:crypto');
const categories=['热烫原理','烫发设计','排杠技法','中发方案库','顾客沟通','科研与验证'];
const date=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!isNaN(Date.parse(value));
function validate(x){
  if(!x||x.reviewStatus!=='approved'||!date(x.batchDate)||!categories.includes(x.category))throw Error('Only approved, dated category records are publishable');
  for(const k of ['title','coreKnowledge','shopApplication','openQuestions','reviewedBy','reviewedAt'])if(typeof x[k]!=='string'||!x[k].trim())throw Error('Missing '+k);
  if(!x.evidence||!['强','中','弱'].includes(x.evidence.level)||!x.evidence.basis?.trim())throw Error('Evidence required');
  if(!x.source?.author?.trim()||!Object.hasOwn(x.source,'publishedAt')||(x.source.publishedAt!==null&&!date(x.source.publishedAt)))throw Error('Source author/publication date required (null if unknown)');
  const url=new URL(x.source.url);if(url.protocol!=='https:'||url.username||url.password)throw Error('Public HTTPS source required');url.hash='';
  if(!Array.isArray(x.tags)||x.tags.some(t=>typeof t!=='string'))throw Error('Tags required');
  if(typeof x.isRealCase!=='boolean'||typeof x.isExample!=='boolean')throw Error('Case/example classification required');
  if(x.isRealCase&&x.authorization!=='granted')throw Error('Real case authorization required');
  if(x.isExample&&x.evidence.level!=='弱')throw Error('Example cannot claim strong scientific evidence');
  if(!Number.isFinite(Date.parse(x.reviewedAt)))throw Error('Valid review timestamp required');
  const fields=['title','category','batchDate','source','evidence','coreKnowledge','shopApplication','openQuestions','tags','reviewStatus','reviewedBy','reviewedAt','isExample','isRealCase','authorization'];
  const safe=Object.fromEntries(fields.map(k=>[k,x[k]]));
  safe.source={url:url.toString(),author:x.source.author,publishedAt:x.source.publishedAt};
  safe.evidence={level:x.evidence.level,basis:x.evidence.basis};
  return {...safe,id:crypto.createHash('sha256').update(url.toString()+'\n'+x.title.trim()).digest('hex').slice(0,24)};
}
function build(previous,incoming){const map=new Map();for(const raw of [...previous,...incoming]){const x=validate(raw);const old=map.get(x.id);if(old){x.batchDate=old.batchDate; if(x.reviewedAt<old.reviewedAt)continue;}map.set(x.id,x);}return {schemaVersion:1,timezone:'Asia/Shanghai',updatedAt:new Date().toISOString(),items:[...map.values()].sort((a,b)=>b.batchDate.localeCompare(a.batchDate)||a.id.localeCompare(b.id))};}
if(require.main===module){try{const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node scripts/build-perm-academy-feed.js reviewed.json feed.json');const incoming=JSON.parse(fs.readFileSync(input,'utf8'));const previous=fs.existsSync(output)?JSON.parse(fs.readFileSync(output,'utf8')).items:[];const feed=build(previous,incoming);const temp=output+'.tmp';fs.writeFileSync(temp,JSON.stringify(feed,null,2)+'\n');fs.renameSync(temp,output);console.log('Reviewed feed:',feed.items.length,'unique records');}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={build,validate};
