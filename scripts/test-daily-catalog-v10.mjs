// Offline catalog, frozen generation, SQL preservation checks. No DB/network/browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {REPORT_MAPPING_VERSION,REPORT_PROJECT_ADDITIONS_V10 as additions,
  REPORT_PROJECT_ROUTES_V9 as old,APPROVED_BLEACHING_PATTERN,reportProjectCategory} from '../supabase/functions/_shared/salon-report-catalog.mjs';
import {build,path} from './build-daily-autofill-v10.mjs';
let checks=0;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const legacy=(shop,code,name)=>old.find(r=>r[0]===shop&&r[1]===code&&r[2]===name)?.[3]??null;
eq(REPORT_MAPPING_VERSION,'frontdesk-autofill-v10');eq(additions.length,8);
for(const [shop,code,name,category] of additions) {
  eq(reportProjectCategory(shop,{item_code:code,item_name:name}),category);
  for(const [s,c,n] of [
    [shop==='1009951'?'1837032':'1009951',code,name],['unknown',code,name],
    [shop,'0'+code,name],[shop,code+'0',name],[shop,code,name+'改名'],
    [shop,code,name+' '],[shop,code,name.replace(/\d+/,'999')===name?name+'其他产品':name.replace(/\d+/,'999')]
  ])eq(reportProjectCategory(s,{item_code:c,item_name:n}),
    ['1009951','1837032'].includes(s)&&new RegExp(APPROVED_BLEACHING_PATTERN).test(n)?'color':legacy(s,c,n));
}
eq(reportProjectCategory('1009951',{item_code:'518',item_name:'Olaplex短发'}),null);
eq(reportProjectCategory('1009951',{item_code:'518',item_name:'Olaplex洗发水'}),null);
for(let v=2;v<=9;v++) {
  execFileSync(process.execPath,[`scripts/build-daily-autofill-v${v}.mjs`,'--check'],{stdio:'pipe'});checks++;
}
const sql=build(), prior=fs.readFileSync('supabase/migrations/20261001124358_zysyr_daily_project_completeness_v9.sql','utf8');
eq(sql,fs.readFileSync(path,'utf8'));
const tuplePattern=/\('([^']*)','([^']*)','([^']*)','([^']*)'\)/g;
const tuples=s=>[...s.slice(0,s.indexOf('revoke all on function')).matchAll(tuplePattern)].map(m=>m.slice(1));
eq(tuples(sql),[...tuples(prior),...additions]);
eq([...sql.matchAll(/frontdesk-autofill-v(\d+)/g)].filter(m=>m.index<sql.indexOf('create or replace function public.mgj_autofill_daily_sheet')).map(m=>Number(m[1])),Array.from({length:10},(_,i)=>i+1));
const writer=s=>s.slice(s.indexOf('create or replace function public.mgj_autofill_daily_sheet'));
const legacyGuard="\n  and exists(select 1 from public.zysyr_daily_sheet_cells c where c.draft_id=draft.id and c.manual_override\n   and c.section_code in('stylist','technician'))";
const normalize=s=>s.replaceAll('frontdesk-autofill-v10','frontdesk-autofill-v9')
  .replace(/ -- Source-head triggers cannot silently upgrade[\s\S]*?(?= if sid=)/,'');
// Apart from version, broader legacy-template protection and the explicit-review guard,
// the actual writer (manual blanks, locks, posted status, evidence/audit, totals) is byte-identical.
eq(normalize(writer(sql)),writer(prior).replace(legacyGuard,''));
const helpers=s=>s.slice(s.indexOf('-- One explanation'),s.indexOf('alter table'));
eq(sql.includes('create or replace function zysyr_daily_electronic_private.project_classification_issues'),false);
for(const marker of ['period_locked','confirmed_preserved','multiple_drafts_preserved','manual_draft_preserved',
 'source_unavailable_or_changed','where not public.zysyr_daily_sheet_cells.manual_override',
 'already_applied','before_snapshot,after_snapshot','formal_ledger_amount_changed',
 "pg_trigger_depth()>0",'mapping_upgrade_requires_review']) {
  assert(sql.includes(marker),marker);checks++;
}
// Strip stored function bodies; installation must contain no historical row mutations/calls.
const ddl=sql.replace(/\$\$[\s\S]*?\$\$/g,'');
assert(!/\b(update|insert into|delete from|select public\.mgj_autofill_daily_sheet)\b/i.test(ddl));checks++;
console.log(`${checks} offline v10 assertions passed; database execution NOT tested`);
