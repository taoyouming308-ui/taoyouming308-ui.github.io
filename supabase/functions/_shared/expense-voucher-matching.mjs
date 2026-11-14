// Expense evidence routing, independent of approval, amounts and posting.
const text = value => String(value ?? '').trim();
const cents = value => value == null || value === '' || typeof value === 'boolean' || !Number.isFinite(Number(value)) || Math.abs(Number(value)*100-Math.round(Number(value)*100))>1e-6 ? null : Math.round(Number(value) * 100);
const compact = value => text(value).replace(/[\s·，,。:：()（）-]/g, '').toLowerCase();
const categories = [
  ['property','物业费',/物业|property/], ['rent','房租',/房租|租金|rent/],
  ['water','水费',/水费|供水|water bill/], ['electricity','电费',/电费|供电|electric/],
  ['gas','煤气费',/煤气|燃气|gas bill/], ['telecom','电话/宽带',/电话|宽带|通信|telecom/],
  ['social_insurance','社保',/社保|社会保险/], ['salary','工资',/工资|薪酬|薪资|技术人员|后勤人员|payroll|salary/],
  ['training','培训费',/培训|training/], ['advertising','市场营销',/广告|营销|推广|投放|advertis/],
  ['fees','手续费',/手续费|佣金|交易费/], ['tax','税费',/税费|税款|税金/],
  ['purchase','产品进货',/进货|采购|供应商|产品货款/], ['supplies','消耗用品',/消耗|日用|清洁|纸巾|垃圾袋|洗洁精/],
  ['office','办公用品',/办公|文具|打印|stationery/], ['food','食品',/食品|咖啡|零食|点心|茶叶|coffee/],
  ['repair','维修费',/维修|修理|repair/], ['transport','车费',/车费|交通|打车|taxi/],
  ['meals','聚餐费',/聚餐|餐饮|团建/], ['petty_cash','备用金',/备用金/],
];
export function expenseCategory(value) {
  const found = categories.find(([, , pattern]) => pattern.test(text(value)));
  return found ? {code:found[0],label:found[1]} : {code:'unknown',label:'待分类'};
}
export function expenseTargetKey(target) { return `${target.target_kind}:${target.id}`; }
export function expenseSourceTargets(source, legacy = []) {
  const targets = legacy.map(row => ({...row, period_month:source.month, aggregate:false}));
  for (const row of source.expenses || []) {
    if (row.direction !== 'outflow' || !(cents(row.outflow) > 0)) continue;
    const equivalent = targets.find(t=>t.transaction_date===row.date && cents(t.amount)===cents(row.outflow) && compact(t.summary)===compact(row.summary)
      && (text(t.voucher_number)&&text(row.voucher_number)&&text(t.voucher_number)===text(row.voucher_number)||t.import_row_id===row.id||t.source_locator&&t.source_locator===row.source_locator));
    if (equivalent) { equivalent.source_row_id=row.id; continue; }
    targets.push({id:row.id,target_kind:'source_petty',period_month:source.month,transaction_date:row.date,
      amount:row.outflow,summary:row.summary,category:row.category,voucher_number:row.voucher_number,
      source_locator:row.source_locator,source_batch_id:row.import_batch_id,aggregate:false});
  }
  if (source.monthly_status === 'ready' && source.source?.selection_id) {
    for (const row of source.monthly?.expense_rows || []) {
      const at = column => (row.cells || []).find(c=>c.column===column);
      const label=text(at(2)?.value || at(1)?.value), amount=at(3);
      if (!label || /合计|小计|总计/.test(label) || !amount?.address) continue;
      const electronic=source.electronic_report?.cells?.find(c=>c.cell_address===amount.address && compact(c.label).includes(compact(label))
        && cents(c.amount)===cents(amount.value));
      targets.push({id:source.source.selection_id+'~'+amount.address,target_kind:'monthly_source',period_month:source.month,
        transaction_date:null,amount:typeof amount.value==='number'?amount.value:null,summary:label,category:label,
        expense_category:expenseCategory(label).code,source_locator:amount.address,source_selection_id:source.source.selection_id,
        source_request_id:source.source.source_request_id,source_sha256:source.source.sha256,
        source_sheet:source.source.worksheet_name,aggregate:true,
        electronic_cell:electronic?{report_id:source.electronic_report.id,cell_id:electronic.id,cell_address:electronic.cell_address,amount:electronic.amount,revision:electronic.revision}:null});
    }
  }
  return targets.map(t=>({...t,target_key:expenseTargetKey(t)}));
}
export function expenseComponents(candidate) {
  if(candidate.monthly_summary && (['payroll','advertising_report'].includes(candidate.document_type)||!candidate.transactions?.length))return [{...candidate.monthly_summary,component_index:0}];
  if (Array.isArray(candidate.transactions) && candidate.transactions.length) return candidate.transactions.slice(0,12).map((row,i)=>({...row,component_index:i}));
  return [{...candidate,component_index:0}];
}
export function matchExpenseComponent(candidate, targets, month) {
  const date=text(candidate.document_date), amount=cents(candidate.amount);
  const category=expenseCategory(candidate.expense_category || candidate.summary || candidate.counterparty);
  const usable=targets.filter(t=>t.period_month===month);
  const scored=usable.map(t=>{
    const sameAmount=amount>0 && amount===cents(t.amount), sameDate=!!date && date===t.transaction_date;
    const sameCategory=category.code!=='unknown' && expenseCategory(t.category || t.summary).code===category.code;
    const sameNumber=!!text(candidate.document_number) && text(candidate.document_number)===text(t.voucher_number);
    return {target:t,sameAmount,sameDate,sameCategory,sameNumber,
      score:(sameAmount?60:0)+(sameDate?30:0)+(sameCategory?15:0)+(sameNumber?40:0)};
  }).sort((a,b)=>b.score-a.score || expenseTargetKey(a.target).localeCompare(expenseTargetKey(b.target)));
  const recommendations=scored.filter(x=>x.score>0).slice(0,8).map(x=>({target_kind:x.target.target_kind,target_id:x.target.id,score:x.score,
    reason:[x.sameAmount?'金额一致':'',x.sameDate?'日期一致':'',x.sameCategory?'费用类别一致':'',x.sameNumber?'凭证号一致':''].filter(Boolean).join('、')}));
  const result=(state,reason,target=null,eligible=false)=>({state,reason,target_kind:target?.target_kind||null,target_id:target?.id||null,
    unique_exact:eligible,auto_eligible:eligible,candidates:recommendations,expense_category:category});
  if(candidate.evidence_kind==='monthly_summary'){
    if(candidate.period_month!==month)return result('cross_month','汇总所属期间不是当前月份，未自动对应');
    const matches=scored.filter(x=>x.target.aggregate&&x.sameAmount&&x.sameCategory),proof=candidate.evidence||{},confidence=candidate.confidence||{};
    if(matches.length===1)return result('exact','明确的所属月份、费用类别和总额与月报唯一一致；仅作汇总佐证',matches[0].target,
      Number(confidence.period_month)>=.95&&Number(confidence.amount)>=.98&&Number(confidence.expense_category)>=.95&&!!proof.period_month&&!!proof.amount&&!!proof.expense_category);
    return result('needs_review','汇总已分类，但月报没有唯一一致的栏目或费用总额');
  }
  const parsed=new Date(date+'T00:00:00Z');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(+parsed) || parsed.toISOString().slice(0,10)!==date || !(amount>0)) return result('needs_review','日期或实付金额缺少可靠证据，费用分类与候选仍保留');
  if (date.slice(0,7)!==month) return result('cross_month','原图交易日期属于其他月份，不能自动对应到当前月');
  const exact=scored.filter(x=>!x.target.aggregate && x.sameAmount && x.sameDate);
  const sameAmount=scored.filter(x=>!x.target.aggregate && x.sameAmount);
  const proof=candidate.evidence||{}, confidence=candidate.confidence||candidate.confidences||{};
  const reliable=Number(confidence.document_date)>=.95 && Number(confidence.amount)>=.98 && !!proof.document_date && !!proof.amount;
  const numbered=exact.filter(x=>x.sameNumber);
  if (exact.length===1 || numbered.length===1) return result('exact','日期、实付金额与明细唯一一致',(exact.length===1?exact[0]:numbered[0]).target,reliable);
  if (sameAmount.length>1) return result('ambiguous','日期和金额尚不能唯一定位，需要凭证号等进一步证据');
  const monthly=scored.filter(x=>x.target.aggregate && x.sameCategory && x.sameAmount);
  if (monthly.length===1) return result('exact','所属月份、费用类别及金额与月报唯一一致',monthly[0].target,reliable && Number(confidence.expense_category)>=.95 && !!proof.expense_category);
  if (recommendations.length) return result('suggested','已按金额、日期和费用类别列出候选；尚不足以自动建立关系');
  return result('unmatched','当前月份没有对应开支，请检查月份或缺少的明细');
}
