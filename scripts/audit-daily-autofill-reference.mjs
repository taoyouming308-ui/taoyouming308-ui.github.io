// Read a single JSON line on stdin. Private source/reference values exist only
// in process memory and an isolated tmpfs database, never files or public logs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const name=`daily-reference-${process.pid}-${Date.now()}`;
const docker=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:8*1024*1024});
const sql=query=>execFileSync('docker',['exec','-i',name,'psql','-X','-h','127.0.0.1','-U','postgres','-At','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:8*1024*1024}).trim();
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
let started=false;
async function audit(reference){
 try{
  docker(['run','--rm','-d','--network','none','--name',name,'--tmpfs','/var/lib/postgresql/data:rw','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17']);started=true;
  let ready=false;for(let i=0;i<60;i++){try{sql('select 1;');ready=true;break;}catch{await new Promise(r=>setTimeout(r,250));}}assert(ready);
  assert(JSON.parse(docker(['inspect','--format','{{json .Mounts}}',name])).every(x=>x.Type!=='volume'));
  const migration=fs.readFileSync('supabase/migrations/20260928084952_zysyr_daily_autofill_precise_v2.sql','utf8');
  sql("create role anon;create role authenticated;create role service_role;create schema zysyr_daily_electronic_private;"+migration.slice(0,migration.indexOf('alter table public.zysyr_daily_autofill_events')));
  const results=[];
  for(const source of reference.sources){
   const cells=JSON.parse(sql(`select zysyr_daily_electronic_private.autofill_cells(${quote(JSON.stringify(source.payload))}::jsonb);`));
   const rowKey=label=>/^[a-f0-9]{32}$/.test(label)?label:createHash('md5').update(label).digest('hex');
   const byKey=new Map(cells.map(x=>[JSON.stringify([x.section_code,rowKey(x.row_label),x.column_code]),x]));
   const aliases=new Map((reference.verified_row_aliases||[]).map(x=>[x.reference,x.source]));
   const approved=reference.approved.filter(x=>x.day===source.day&&['staff_value','staff_total','category_total','payment_method','summary_value','summary_actual','summary_grand','payment_cashflow','payment_card_consumption','payment_total'].includes(x.role));
   let matched=0,differences=0,missingKnown=0,unmatchedKnown=0;const unmatchedFields=new Set();
   for(const row of approved){
    const generated=byKey.get(JSON.stringify([row.section,aliases.get(row.row)||row.row,row.column]));
    if(!generated){if(row.value!==null&&Number(row.value)!==0){unmatchedKnown++;unmatchedFields.add(row.section+'.'+row.column);}continue;}
    matched++;
    // Diagnostic comparison only: blank absence versus known zero is not a
    // numeric error. Unknown positive expected values still fail below.
    if(Number(row.value||0)!==Number(generated.value||0))differences++;
    if(row.value>0&&generated.value==null)missingKnown++;
   }
   results.push({day:source.day,matched_cells:matched,nonzero_differences:differences,missing_positive:missingKnown,unmapped_positive_reference_fields:unmatchedKnown,unmapped_field_names:[...unmatchedFields].sort()});
  }
  console.log(JSON.stringify({reference_comparison:results,complete_reference_coverage:results.every(x=>x.unmapped_positive_reference_fields===0),scope:'mapped cells only; unverified employee aliases and unsupported financial totals remain explicit, not a complete-reference pass',source_retained:'none'}));
  assert(results.every(x=>x.nonzero_differences===0&&x.missing_positive===0),'reference mapped cells differ');
 }finally{if(started)docker(['rm','-f','-v',name]);}
}
let buffer='';process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{buffer+=chunk;if(buffer.includes('\n')){process.stdin.pause();let reference;try{reference=JSON.parse(buffer.slice(0,buffer.indexOf('\n')));}catch{console.error('Invalid private reference input');process.exitCode=1;return;}buffer='';audit(reference).catch(()=>{console.error('Reference audit failed; no private data printed');process.exitCode=1;});}});
