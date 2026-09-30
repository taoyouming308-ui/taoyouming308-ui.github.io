// Offline generator for the user-approved independent bank-card channel.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const file='supabase/migrations/20260930040928_zysyr_daily_bank_card_v6.sql';
const v4=fs.readFileSync('supabase/migrations/20260928141730_zysyr_daily_cash_candidate_v4.sql','utf8');
let projection=v4.slice(v4.indexOf('create function zysyr_daily_electronic_private.cash_receipt_projection'),v4.indexOf('alter table public.zysyr_daily_autofill_events'));
projection=projection.replace('create function','create or replace function').replace('array[3,7,8,9]','array[7,8,9]');
const anchor=" metadata:=metadata||jsonb_build_object('state','candidate'";
assert(projection.includes(anchor));
projection=projection.replace(anchor,` -- User-approved independent 银联 channel; never classify as public/private
 -- account, stored-value drawdown, WeChat or Alipay. Unknown stays unknown.
 n:=zysyr_daily_electronic_private.daily_electronic_cents(op_row->3);
 cells:=cells||jsonb_build_array(jsonb_build_object('section_code','payment','row_key','payment',
  'row_label','支付','column_code','bank_card','column_label','银行卡','row_number',33,
  'column_number',8,'cell_role','payment_method','value',n::numeric/100));
`+anchor);
const v5=fs.readFileSync('supabase/migrations/20260930034900_zysyr_daily_project_routes_v5.sql','utf8');
const writer=v5.slice(v5.indexOf('create or replace function public.mgj_autofill_daily_sheet')).replaceAll("'frontdesk-autofill-v5'","'frontdesk-autofill-v6'");
assert(writer.includes('confirmed_preserved')&&writer.includes('period_locked')&&writer.includes('before_snapshot'));
const result=`-- User approved an independent 银行卡 payment column on 2026-09-30.
-- Candidate-only; original source, confirmed sheets and account columns unchanged.
set statement_timeout='30s';
set lock_timeout='5s';

${projection.trimEnd()}

alter table public.zysyr_daily_autofill_events drop constraint zysyr_daily_autofill_events_mapping_version_check;
alter table public.zysyr_daily_autofill_events add constraint zysyr_daily_autofill_events_mapping_version_check
 check(mapping_version in('frontdesk-autofill-v1','frontdesk-autofill-v2','frontdesk-autofill-v3','frontdesk-autofill-v4','frontdesk-autofill-v5','frontdesk-autofill-v6'));

${writer.trimEnd()}
`;
if(process.argv.includes('--check')){
 assert.equal(fs.readFileSync(file,'utf8'),result,'v6 differs from the reviewed bank-channel generator');
 console.log('v6 bank channel and protected writer match');
}else{
 assert.equal(fs.readFileSync(file,'utf8').trim(),'','only initialize an empty migration');
 console.log('*** Begin Patch\n*** Update File: '+process.cwd()+'/'+file+'\n@@\n'+result.trimEnd().split('\n').map(l=>'+'+l).join('\n')+'\n*** End Patch');
}
