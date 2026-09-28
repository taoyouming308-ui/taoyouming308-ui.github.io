// Pure candidate projection, NOT an accounting writer or posting authorization.
// User policy: real external receipts; stored-value drawdown is not income.
// New recharge/package/annual-card cash is separate, never counted as 实做.
export const CASH_POLICY = 'operating-external-cash-v1';
const HEADERS = ['日期','总额','现金','银联','支付宝','微信支付','大众点评','商场卡','合作券','口碑','抖音',
  '总额','划卡','划赠送金','划分期赠送金','总额','代金券','欠款','免单','红包','优惠券','商城订单','线上积分抵扣','门店积分抵扣'];
const STORES = new Set(['1009951', '1837032']);
const cents = value => {
  if (value === '') return null;
  if (!['number','string'].includes(typeof value) || !/^\d{1,11}(?:\.\d{1,2})?$/.test(String(value))) throw new Error('invalid_amount');
  const [whole, part = ''] = String(value).split('.');
  return Number(whole) * 100 + Number(part.padEnd(2, '0'));
};

function validate(envelope, scope, incomeTypes) {
  if (!envelope || envelope.source_scope !== scope || !STORES.has(envelope.shop_id)
    || !/^2026-\d{2}-\d{2}$/.test(envelope.business_date)
    || !/^[a-f0-9]{64}$/.test(envelope.source_sha256) || typeof envelope.snapshot_id !== 'string'
    || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(envelope.snapshot_id)) throw new Error('invalid_evidence');
  const source = envelope.source;
  const millis = Date.parse(envelope.business_date + 'T00:00:00Z');
  if (!Number.isFinite(millis) || new Date(millis).toISOString().slice(0,10) !== envelope.business_date) throw new Error('invalid_date');
  const q = source?.query, content = source?.content;
  if (source?.shop_id !== envelope.shop_id || source?.business_date !== envelope.business_date
    || String(q?.parentShopId) !== '1103470' || !['1103470','1009951','1837032'].includes(String(q?.shopId))
    || JSON.stringify(q?.shopIds) !== JSON.stringify([envelope.shop_id])
    || q?.period !== `${millis}_${millis}` || q?.depcode !== '-1'
    || JSON.stringify(q?.incomeType) !== JSON.stringify(incomeTypes)) throw new Error('scope_mismatch');
  if (JSON.stringify(content?.head) !== JSON.stringify(HEADERS) || content?.config?.title !== '门店营业日汇总'
    || !Array.isArray(content?.data) || content.data.length !== 1
    || !Array.isArray(content.data[0]) || content.data[0].length !== 24
    || content.data[0][0] !== envelope.business_date) throw new Error('source_shape_changed');
  const top = content.headTop;
  if (!Array.isArray(top) || top.length !== 4 || top.some((item,i) => !item
    || item.text !== ['日期','现金类','划卡类','其他非现类'][i]
    || String(item[i ? 'colspan' : 'rowspan']) !== ['2','10','4','9'][i])
    || !Array.isArray(content.columns) || content.columns.length !== 24) throw new Error('source_shape_changed');
  if (typeof envelope.fetched_at !== 'string' || !/(?:Z|[+-]\d\d:\d\d)$/.test(envelope.fetched_at)
    || !Number.isFinite(Date.parse(envelope.fetched_at))) throw new Error('invalid_fetched_at');
  const row = content.data[0].slice(1).map(cents);
  // A source total may be known even when components are missing. Keep it as
  // a review candidate; a KNOWN contradictory cash group is never accepted.
  const components = row.slice(1,10);
  if (row[0] !== null && components.every(v => v !== null)
    && components.reduce((a,b) => a+b,0) !== row[0]) throw new Error('cash_group_mismatch');
  return row;
}

export function dailyCashCandidate(operating, allBusiness, cardSalesSource) {
  const op = validate(operating, 'operating_daily_summary', ['1','2']);
  const all = validate(allBusiness, 'all_business_daily_summary', ['1','2','3','4','5']);
  const sales = validate(cardSalesSource, 'card_sales_daily_summary', ['3','4','5']);
  const sources = [operating,allBusiness,cardSalesSource];
  if (sources.some(e=>e.shop_id!==operating.shop_id||e.business_date!==operating.business_date)) throw new Error('evidence_pair_scope_mismatch');
  const times=sources.map(e=>Date.parse(e.fetched_at));
  if (Math.max(...times)-Math.min(...times) > 120000) throw new Error('evidence_pair_not_contemporaneous');
  // Every incomeType included in operating is included in all. A decreasing
  // external channel means the pair changed between reads (or a scope error).
  for (let i=0;i<10;i++) if (op[i] !== null && all[i] !== null && all[i] < op[i]) throw new Error('evidence_pair_decreasing_cash');
  if (op[0]!==null&&sales[0]!==null&&all[0]!==null&&op[0]+sales[0]!==all[0]) throw new Error('cash_source_partition_mismatch');
  const gaps = [{code:'source_shop_not_echoed',blocking:true}, {code:'financial_review_required',blocking:true}];
  if (op[0] === null || all[0] === null || sales[0] === null) gaps.push({code:'cash_total_unknown',blocking:true});
  if (op.slice(1,10).some(v=>v === null)) gaps.push({code:'cash_channels_unknown',blocking:true});
  // No unsupported mapping from 银联/商场卡/合作券/口碑 to one of the four
  // user-excluded account columns. Known nonzero values need a mapping review.
  if ([2,6,7,8].some(i=>op[i] !== null && op[i] !== 0)) gaps.push({code:'unmapped_external_cash_channel',blocking:true});
  const cardSales = sales[0];
  if (cardSales !== null && cardSales > 0) gaps.push({code:'card_sales_category_split_unavailable',blocking:true});
  const refs = sources.map(e=>({snapshot_id:e.snapshot_id,source_sha256:e.source_sha256,
    source_scope:e.source_scope,fetched_at:e.fetched_at}));
  const cell = (section,code,label,role,value,indices,sourceIndex=0) => ({section_code:section,row_key:section,row_label:section==='summary'?'汇总':'支付',
    column_code:code,column_label:label,cell_role:role,value_cents:value,value:value===null?null:value/100,
    status:value===null?'unknown':'candidate',lineage:indices.map(index=>({...refs[index===-1?1:sourceIndex],
      json_pointer:'/content/data/0/'+Math.abs(index)}))});
  const cells = [
    cell('summary','actual_total','实做','summary_actual',op[0],[1]),
    // Independent incomeTypes 3+4+5 cash source, never a subtraction estimate.
    {...cell('summary','card_subtotal','卡类小计','summary_value',cardSales,[1],2),formula:'direct_card_sales_external_cash'},
    cell('summary','grand_total','总计','summary_grand',all[0],[1],1),
    cell('payment','cash_flow','现金流','payment_cashflow',op[0],[1]),
    cell('payment','total','总计','payment_total',all[0],[1],1),
    ...[['cash','现金',1],['alipay','支付宝',3],['wechat','微信',4],['group_buy','团购',5],['douyin','抖音',9]]
      .map(([code,label,index])=>cell('payment',code,label,'payment_method',op[index],[index+1])),
  ];
  return {policy:CASH_POLICY,stage:'draft_candidate',status:'needs_review',shop_id:operating.shop_id,
    business_date:operating.business_date,scope_verified:false,scope_verification:'request_only',
    automatic_posting_allowed:false,formal_ledger_amount_changed:false,source_refs:refs,
    fingerprint:refs.map(e=>e.snapshot_id+':'+e.source_sha256).join('|'),cells,gaps};
}
