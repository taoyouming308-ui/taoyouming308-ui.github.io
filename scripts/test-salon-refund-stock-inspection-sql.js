const fs=require('node:fs');
const sql=fs.readFileSync('supabase/migrations/20260924050826_salon_refund_stock_inspection.sql','utf8');
const bad=[],ok=(value,label)=>{if(!value)bad.push(label)};
ok(/create table public\.salon_refund_stock_inspections/.test(sql),'append-only inspection history table missing');
ok(/revision integer not null check\(revision>0\)/.test(sql),'revision history missing');
ok(/accepted_quantity numeric\(12,3\).*accepted_quantity<=requested_quantity/.test(sql),'accepted quantity bound missing');
ok(/p_expected_revision.*商品验收记录已变化/.test(sql),'inspection compare-and-set missing');
ok(/refund_request_lines[\s\S]*salon_refund_stock_inspections[\s\S]*商品尚未逐项验收/.test(sql),'execution inspection gate missing');
ok(/sum\(i\.accepted_quantity\)[\s\S]*movement_type='refund'/.test(sql),'stock execution does not use accepted quantity');
ok(/condition not in\('damaged','not_returnable'\) or accepted_quantity=0/.test(sql),'non-saleable condition can enter inventory');
ok(/enable row level security/.test(sql)&&/revoke all on public\.salon_refund_stock_inspections from public,anon,authenticated/.test(sql),'inspection table privilege boundary missing');
ok(/security invoker set search_path=''/i.test(sql)&&/revoke execute on function public\.salon_inspect_refund_product_line[\s\S]*from public,anon,authenticated/.test(sql),'function security/execute grants missing');
if(bad.length){console.error('salon refund stock inspection SQL failed:\n- '+bad.join('\n- '));process.exit(1)}
console.log('salon refund stock inspection SQL passed: immutable history, revision CAS, accepted-only stock, permission boundary');
