// Offline, deterministic migration builder. Prints an apply_patch; never writes
// files, contacts the database or changes sources. Canonical v1 remains intact.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {REPORT_PROJECT_ROUTES_V2 as routes} from '../supabase/functions/_shared/salon-report-catalog.mjs';
const file='supabase/migrations/20260928084952_zysyr_daily_autofill_precise_v2.sql';
const old=fs.readFileSync('supabase/migrations/20260928005448_zysyr_frontdesk_daily_autofill.sql','utf8');
const q=s=>"'"+s.replaceAll("'","''")+"'";
const cat=`
create function zysyr_daily_electronic_private.report_project_category(p_shop text,p_code text,p_name text)
returns text language sql immutable set search_path='' as $$
 select case when p_shop in('1837032','1009951') and p_name='褪色' then 'color'
 else (select category from(values
 ${routes.map(r=>'('+r.map(q).join(',')+')').join(',\n ')}
 )t(shop,code,name,category) where shop=p_shop and code=p_code and name=p_name) end
$$;
revoke all on function zysyr_daily_electronic_private.report_project_category(text,text,text) from public,anon,authenticated,service_role;
`;
let projection=old.slice(old.indexOf('create function zysyr_daily_electronic_private.autofill_cells'),old.indexOf('create function public.mgj_autofill_daily_sheet'));
projection=projection.replace('create function','create or replace function');
projection=projection.replace('with bills as (select b from jsonb_array_elements', 'with bills as (select b,zysyr_daily_electronic_private.platform_item_routes(b) routes from jsonb_array_elements');
projection=projection.replace(" select a->>'employee_id' employee_id", " select b->>'source_bill_id' visit_key,a->>'employee_id' employee_id");
const start=projection.indexOf("  case when i->>'item_name' ~ '烫'");const end=projection.indexOf(' from bills cross join lateral');assert(start>0&&end>start);
projection=projection.slice(0,start)+`  zysyr_daily_electronic_private.report_project_category(b->>'shop_id',i->>'item_code',i->>'item_name') category,
  case when routes->>(i->>'source_item_id')='project' then
    zysyr_daily_electronic_private.report_project_category(b->>'shop_id',i->>'item_code',i->>'item_name')
   when routes->>(i->>'source_item_id') in('dianping_group','douyin') then routes->>(i->>'source_item_id')
   else null end stylist_category
`+projection.slice(end);
const ps=projection.indexOf(' cross join lateral (select count(*) filter');const pe=projection.indexOf('), staff as (',ps);assert(ps>0&&pe>ps);projection=projection.slice(0,ps)+projection.slice(pe);
projection=projection.replace('then sum(l.project_count) end end value',`then case when c.code='subtotal' then count(distinct (l.visit_key,l.category)) filter(where l.project_count>0)
       else count(distinct l.visit_key) filter(where l.project_count>0) end end end value`);
projection=projection.replace("('wechat','微信','weixin',7),('group_buy','团购','dianpin',9)","('wechat','微信','weixin',7),('douyin','抖音','otherfee2',8),('group_buy','团购','dianpin',9)");
projection=projection.replace("when 'pay' then '支付宝' when 'weixin' then '微信' when 'dianpin' then '大众点评' end)","when 'pay' then '支付宝' when 'weixin' then '微信' when 'dianpin' then '大众点评' when 'otherfee2' then '抖音' end)");
let writer=old.slice(old.indexOf('create function public.mgj_autofill_daily_sheet'),old.indexOf('-- Database-only'));
writer=writer.replace('create function','create or replace function').replaceAll("'frontdesk-autofill-v1'","'frontdesk-autofill-v2'");
writer=writer.replace("order by e.revision desc limit 1)\n then return", "order by e.revision desc limit 1) and draft.ocr_model='frontdesk-autofill-v2'\n then return");
writer=writer.replace("if draft.ocr_model<>'frontdesk-autofill-v2' then", "if draft.ocr_model not in('frontdesk-autofill-v1','frontdesk-autofill-v2') then");
const gs=writer.indexOf(' if exists(select 1 from jsonb_array_elements(source');const ge=writer.indexOf(' if draft.id is null',gs);assert(gs>0&&ge>gs);
writer=writer.slice(0,gs)+` if exists(select 1 from jsonb_array_elements(cells)x where x->>'cell_role'='staff_value'
  and x->>'column_code' in('dianping_group','douyin','wash_cut_blow','makeup_styling','perm','color','treatment')
  and x->>'value' is null) then gaps:=gaps||'["project_or_platform_assignment_unresolved"]'::jsonb; end if;
`+writer.slice(ge);
writer=writer.replace("'active_staff_row_keys',", "'known_absence_display','blank',\n   'active_staff_row_keys',");
const added=cat+projection+`
alter table public.zysyr_daily_autofill_events drop constraint zysyr_daily_autofill_events_mapping_version_check;
alter table public.zysyr_daily_autofill_events add constraint zysyr_daily_autofill_events_mapping_version_check
 check(mapping_version in('frontdesk-autofill-v1','frontdesk-autofill-v2'));
`+writer;
assert(projection.includes('otherfee2'));assert(projection.includes('count(distinct'));assert(!projection.includes('platform.'));assert(writer.includes("and draft.ocr_model='frontdesk-autofill-v2'"));
const current=fs.readFileSync(file,'utf8');
if(process.argv.includes('--check')){
 assert(current.endsWith(added.trimEnd()+'\n'),'catalog/writer migration differs from deterministic builder');
 console.log('v2 migration matches canonical catalog and scoped writer');
}else{
 console.log('*** Begin Patch\n*** Update File: '+process.cwd()+'/'+file+'\n@@\n '+current.trimEnd().split('\n').at(-1)+'\n'+added.trimEnd().split('\n').map(l=>'+'+l).join('\n')+'\n*** End Patch');
}
