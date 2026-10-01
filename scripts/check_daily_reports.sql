-- Read-only monitor projection. :day is replaced only after ISO date validation.
begin transaction isolation level repeatable read read only;
set local statement_timeout = '20s';
set local lock_timeout = '2s';
with shops(store_id,shop) as (values
 ('ea7e281f-a254-4664-bb03-cf1acf48d79d'::uuid,'自由手艺人'),
 ('8d057980-ff8f-4b2c-9c7f-4dd23a568f35'::uuid,'向里造型')),
drafts as materialized (
 select d.* from public.zysyr_daily_sheet_drafts d join shops s using(store_id)
 where d.company_id='02463a53-dfdb-4291-b04d-dd1d85f9d998' and d.report_date=date ':day'
), cells as materialized (
 select c.*,case when c.manual_override then c.corrected_numeric else c.ocr_numeric end value
 from public.zysyr_daily_sheet_cells c join drafts d on d.id=c.draft_id
 and d.company_id=c.company_id and d.store_id=c.store_id
 where not (d.template_code='zysyr_frontdesk_project_draft'
   and c.section_code in ('stylist','technician') and c.row_key<>'company'
   and jsonb_typeof(d.ocr_raw_result#>'{autofill,active_staff_row_keys}')='array'
   and not (d.ocr_raw_result#>'{autofill,active_staff_row_keys}') ? c.row_key)
), row_checks as (
 select draft_id,row_key,max(row_label) label,
 sum(value) filter(where cell_role='staff_value')::text parts,
 max(value) filter(where cell_role='staff_total')::text total
 from cells where section_code='stylist' and cell_role in ('staff_value','staff_total')
 group by draft_id,row_key
), category_checks as (
 select draft_id,column_code,
 sum(value) filter(where cell_role='staff_value')::text parts,
 max(value) filter(where cell_role='category_total')::text total
 from cells where section_code='stylist' and cell_role in ('staff_value','category_total')
 group by draft_id,column_code
), controls as (
 select draft_id,cell_role,sum(value)::text value,count(value) known
 from cells where cell_role in ('staff_value','staff_total','category_total','summary_actual',
 'summary_grand','payment_method','payment_cashflow','payment_card_consumption','payment_total')
 group by draft_id,cell_role
), source as materialized (
 select s.*,h.snapshot_id,h.last_seen_at,l.fetched_at list_fetched_at,
 x.source_sha256,x.source_count,
 zysyr_daily_electronic_private.autofill_cells(x.payload) project_cells,
 l.services is null or
 (select array_agg(b->>'source_bill_id' order by b->>'source_bill_id') from jsonb_array_elements(x.payload->'bills') b)
 is distinct from
 (select array_agg(b->>'source_id' order by b->>'source_id') from jsonb_array_elements(l.services) b)
 or exists(select 1 from jsonb_array_elements(x.payload->'bills') b
 join jsonb_array_elements(l.services) v on v->>'source_id'=b->>'source_bill_id'
 where (b->>'source_posted_amount_cents')::numeric is distinct from (v->>'amount')::numeric*100) list_changed,
 zysyr_daily_electronic_private.cash_receipt_projection(
 '02463a53-dfdb-4291-b04d-dd1d85f9d998',s.store_id,date ':day') cash
 from shops s left join public.mgj_business_detail_heads h on h.shop_name=s.shop and h.business_date=date ':day'
 left join public.mgj_business_detail_snapshots x on x.id=h.snapshot_id and x.shop_name=s.shop and x.business_date=date ':day'
 left join public.mgj_daily_consumption l on l.shop_name=s.shop and l.business_date=date ':day'
)
select jsonb_build_object('schema',1,'date',date ':day','checked_at',now(),'stores',
 (select jsonb_agg(jsonb_build_object('shop',s.shop,'store_id',s.store_id,
 'source_snapshot_id',s.snapshot_id,'source_sha256',s.source_sha256,
 'source_seen_at',s.last_seen_at,'list_seen_at',s.list_fetched_at,
 'source_count',s.source_count,'source_list_changed',s.list_changed,
 'cash_available',s.cash->'available','cash_gaps',s.cash->'gaps',
 'cash_metadata',s.cash->'metadata',
 'drafts',coalesce((select jsonb_agg(jsonb_build_object(
 'id',d.id,'status',d.status,'revision',d.edit_revision,'template',d.template_code,
 'metadata',d.ocr_raw_result->'autofill',
 'source_cell_differences',coalesce((select jsonb_agg(jsonb_build_object(
 'employee',p->>'row_label','column',p->>'column_code','expected',p->>'value',
 'actual',c.value::text,'manual',coalesce(c.manual_override,false),'missing',c.id is null))
 from jsonb_array_elements(s.project_cells) p left join cells c on c.draft_id=d.id
 and c.section_code=p->>'section_code' and c.row_key=p->>'row_key' and c.column_code=p->>'column_code'
 where p->>'section_code'='stylist' and p->>'cell_role' in ('staff_value','staff_total')
 and (p->>'value')::numeric is distinct from c.value),'[]'::jsonb),
 'cell_count',(select count(*) from cells c where c.draft_id=d.id),
 'negative_count',(select count(*) from cells c where c.draft_id=d.id and value<0),
 'duplicate_count',(select count(*) from (select row_key,column_code,section_code from cells c
 where c.draft_id=d.id group by row_key,column_code,section_code having count(*)>1) dup),
 'rows',coalesce((select jsonb_agg(to_jsonb(r)-'draft_id') from row_checks r where r.draft_id=d.id),'[]'::jsonb),
 'categories',coalesce((select jsonb_agg(to_jsonb(r)-'draft_id') from category_checks r where r.draft_id=d.id),'[]'::jsonb),
 'controls',coalesce((select jsonb_object_agg(cell_role,jsonb_build_object('value',value,'known',known)) from controls c where c.draft_id=d.id),'{}'::jsonb),
 'stylist_subtotal',(select max(value)::text from cells c where c.draft_id=d.id and c.row_key='stylist_category_total' and c.column_code='subtotal'),
 'card_sales',(select max(value)::text from cells c where c.draft_id=d.id and c.section_code='summary' and c.row_key='summary' and c.column_code='card_subtotal')
 ) order by d.id) from drafts d where d.store_id=s.store_id),'[]'::jsonb)) order by s.shop) from source s)) audit;
rollback;
