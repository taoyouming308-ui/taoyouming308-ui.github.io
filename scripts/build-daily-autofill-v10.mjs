// Offline candidate builder. No database calls or historical recomputation.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {REPORT_PROJECT_ADDITIONS_V10 as additions} from '../supabase/functions/_shared/salon-report-catalog.mjs';
export const path='supabase/migrations/20261002020000_zysyr_daily_exact_catalog_v10.sql';
export function build() {
  const prior=fs.readFileSync('supabase/migrations/20261001124358_zysyr_daily_project_completeness_v9.sql','utf8');
  const q=s=>"'"+s.replaceAll("'","''")+"'";
  const split=prior.indexOf('revoke all on function zysyr_daily_electronic_private.report_project_category');
  let catalog=prior.slice(prior.indexOf('create or replace function'),split);
  const anchor=')t(shop,code,name,category)';
  assert(catalog.includes(anchor));
  catalog=catalog.replace(anchor,',\n '+additions.map(r=>'('+r.map(q).join(',')+')').join(',\n ')+ '\n '+anchor);
  // Existing explanation helper and its ACL remain untouched.
  const suffix=prior.slice(split,prior.indexOf('-- One explanation'))+prior.slice(prior.indexOf('alter table'));
  const guard=` -- Source-head triggers cannot silently upgrade an existing old mapping.
 if pg_trigger_depth()>0 and draft.id is not null
  and (select e.mapping_version from public.zysyr_daily_autofill_events e
       where e.draft_id=draft.id order by e.revision desc limit 1) is distinct from 'frontdesk-autofill-v10'
 then return jsonb_build_object('status','mapping_upgrade_requires_review','draft_id',draft.id,
  'automatic_posting_enabled',false,'formal_ledger_amount_changed',false); end if;
`;
  const writerAnchor=' if sid=(select e.snapshot_id';
  assert(suffix.includes(writerAnchor));
  const legacyGuard="\n  and exists(select 1 from public.zysyr_daily_sheet_cells c where c.draft_id=draft.id and c.manual_override\n   and c.section_code in('stylist','technician'))";
  assert(suffix.includes(legacyGuard));
  return '-- Independent local candidate: 8 exact catalog tuples; install does not recalculate history.\n'
    + "set statement_timeout='30s';\nset lock_timeout='5s';\n" + catalog
    +suffix.replace(legacyGuard,'').replace("'frontdesk-autofill-v9'))", "'frontdesk-autofill-v9','frontdesk-autofill-v10'))")
      .replace(writerAnchor,guard+writerAnchor).replaceAll("='frontdesk-autofill-v9'","='frontdesk-autofill-v10'")
      .replace("'mapping_version','frontdesk-autofill-v9'","'mapping_version','frontdesk-autofill-v10'")
      .replace("values(company,store,draft.id,sid,'frontdesk-autofill-v9'","values(company,store,draft.id,sid,'frontdesk-autofill-v10'");
}
if(process.argv.includes('--check')) {
  assert.equal(fs.readFileSync(path,'utf8'),build());
  console.log('v10 generated SQL matches');
} else if(process.argv.includes('--write')) {
  fs.writeFileSync(path,build());
}
