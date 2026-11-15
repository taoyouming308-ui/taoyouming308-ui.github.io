import { normalizedDate, normalizedAmount } from './zysyr-ocr-candidates.mjs';
import { printedVoucherDate } from './voucher-printed-date.mjs';

// Keep the printed calendar day; never convert time zones or supply a year.
export function normalizedVoucherDate(value) {
  const match=String(value??'').trim().match(/^(20\d{2}-\d{2}-\d{2})(?:[ T](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/);
  return match?normalizedDate(match[1]):null;
}

export function voucherCodexCandidates(result, month) {
  if (!['codex-local','openai-api','openai-compatible'].includes(result?.provider) || result?.candidate_only !== true || result?.human_review_required !== true
      || !['receipt', 'bank_summary', 'multiple_transactions', 'unknown'].includes(result?.document_kind)) {
    throw new Error('CODEX_INVALID_CANDIDATE');
  }
  const hasPrintedDates=Array.isArray(result.date_candidates)&&result.date_candidates.length>0;
  const selectedDate=hasPrintedDates?printedVoucherDate(result,normalizedVoucherDate):null;
  const original=result;
  if(hasPrintedDates)result={...result,date_role:selectedDate?.role||'unknown',fields:{...result.fields,document_date:selectedDate?.date||null},
    evidence:{...result.evidence,document_date:selectedDate?.evidence||''},confidences:{...result.confidences,document_date:selectedDate?.confidence||0}};
  const categoryProof=[result.evidence?.expense_category,result.evidence?.summary,result.evidence?.counterparty].join(' ');
  if(/饮用水|桶装.{0,4}水|送水|桶水/.test(categoryProof))
    result={...result,fields:{...result.fields,expense_category:'饮用水'}};
  const fields = {}, confidences = {}, evidence = {};
  for (const key of ['document_date', 'amount', 'counterparty', 'document_number','summary','expense_category']) {
    const proof = String(result.evidence?.[key] || '').trim().slice(0, 500);
    const score = result.confidences?.[key];
    let value = result.fields?.[key];
    if (!proof || typeof score !== 'number' || !Number.isFinite(score) || score > 1 || score < (['document_date', 'amount'].includes(key) ? .85 : .7)) value = null;
    if (key === 'document_date') value = normalizedVoucherDate(value);
    else if (key === 'amount') value = typeof value === 'boolean' ? null : normalizedAmount(value);
    else value = value == null ? null : String(value).trim().slice(0, 200) || null;
    if (key === 'amount' && Number(value) <= 0) value = null;
    if (result.document_kind !== 'receipt' && ['amount', 'document_date'].includes(key)) value = null;
    fields[key] = value;
    confidences[key] = value == null ? 0 : score;
    evidence[key] = proof;
  }
  const warnings = (Array.isArray(result.warnings) ? result.warnings : []).map(w => String(w).slice(0, 200)).slice(0, 25);
  const categoryLiteral=String(result.evidence?.expense_category||'');
  if((/美发辅助品|美发消耗品|产品进货/.test(fields.expense_category||'')&&/用品(?:商行|公司|商店)/.test(categoryLiteral)&&categoryLiteral===String(result.evidence?.counterparty||''))
    ||(/物业费/.test(fields.expense_category||'')&&/物业.*公司/.test(categoryLiteral)&&!/物业(?:管理)?费/.test(categoryLiteral))){
    fields.expense_category=null;confidences.expense_category=0;warnings.push('商户名称不足以确认具体费用科目，类别待核对');
  }
  const splitProof=[result.evidence?.summary,result.fields?.summary].join(' ');
  const split=splitProof.match(/一店\s*([0-9]+(?:\.[0-9]{1,2})?)[\s\S]*?二店\s*([0-9]+(?:\.[0-9]{1,2})?)/);
  const splitTotal=splitProof.match(/总计\s*([0-9]+(?:\.[0-9]{1,2})?)/)||splitProof.match(/合计\s*([0-9]+(?:\.[0-9]{1,2})?)/);
  const arithmeticConflict=Boolean(split&&splitTotal&&Math.round(Number(split[1])*100)+Math.round(Number(split[2])*100)!==Math.round(Number(splitTotal[1])*100));
  if(arithmeticConflict){fields.summary='原文分店金额与总计不一致；保留原转账金额，分摊需人工核对';warnings.splice(0,warnings.length,...warnings.filter(w=>!/合计|总计/.test(w)));warnings.push('分店小计与原文总计不一致，不得据此拆分或自动对应');}
  if(hasPrintedDates&&(original.fields?.document_date!==result.fields.document_date||original.date_role!==result.date_role))warnings.push('日期已按原文标签核对用途：优先付款/开具，其次下单；创建或成交时间不冒充扣款时间');
  if (fields.document_date && fields.document_date.slice(0, 7) !== month) warnings.push('原图日期不属于所选月份，请核对门店和月份');
  const transactions = [];
  let unverifiedTransfers=0;
  const chat=result.document_type==='chat_transfers'&&/^expense-voucher-v[34]$/.test(result.prompt_version||'');
  const outgoingProof=item=>{
    const proof=[item?.evidence?.amount,item?.evidence?.summary].join(' ');
    return /已被接收|转账成功|付款成功|支付成功|已付款/.test(proof)&&!/未付款|未领取|待领取|待支付|未显示|未见|无法确认/.test(proof);
  };
  if(chat&&result.document_kind==='receipt'&&fields.amount&&!outgoingProof(result)){
    fields.amount=null;confidences.amount=0;warnings.push('转账缺少已完成对外付款证据，金额仅保留在原始识别中，未当作开支');
  }
  if (['bank_summary','multiple_transactions'].includes(result.document_kind) && Array.isArray(result.transactions)) {
    for (const item of result.transactions.slice(0,12)) {
      if(chat&&!outgoingProof(item)){unverifiedTransfers++;continue;}
      const parsed=voucherCodexCandidates({provider:result.provider,prompt_version:result.prompt_version,candidate_only:true,human_review_required:true,document_kind:'receipt',document_type:result.document_type,date_role:item.date_role,date_candidates:item.date_candidates,
        fields:item,evidence:item.evidence,confidences:item.confidence,warnings:[]},month);
      transactions.push({...parsed.fields,confidence:parsed.confidences});
    }
  }
  if(unverifiedTransfers)warnings.push('已排除'+unverifiedTransfers+'笔方向或付款完成状态未确认的聊天记录；收款回执本身不证明新增开支');
  const summary=result.monthly_summary;
  const validSummaryConfidence=key=>typeof summary?.confidence?.[key]==='number'&&Number.isFinite(summary.confidence[key])&&summary.confidence[key]>=.85&&summary.confidence[key]<=1;
  let monthlySummary=null;
  if(summary && ['payroll','advertising_report','invoice','receipt','bank_statement'].includes(result.document_type) && /^\d{4}-(0[1-9]|1[0-2])$/.test(summary.period_month||'') && summary.evidence?.period_month && summary.evidence?.expense_total
    && validSummaryConfidence('period_month') && validSummaryConfidence('expense_total') && typeof summary.expense_total==='number'&&Number.isFinite(summary.expense_total)&&summary.expense_total>0){
    monthlySummary={evidence_kind:'monthly_summary',document_kind:'monthly_summary',document_date:null,period_month:summary.period_month,
      amount:normalizedAmount(summary.expense_total),expense_category:summary.evidence?.expense_category&&validSummaryConfidence('expense_category')?String(summary.expense_category||'').slice(0,120):null,
      summary:'月度费用汇总佐证',evidence:{period_month:String(summary.evidence.period_month).slice(0,500),amount:String(summary.evidence.expense_total).slice(0,500),expense_category:String(summary.evidence.expense_category||'').slice(0,500)},
      confidence:{period_month:summary.confidence.period_month,amount:summary.confidence.expense_total,expense_category:summary.confidence.expense_category}};
  }
  return { fields: { ...fields, recognition_provider: result.provider, parse_mode: result.provider === 'openai-api' ? 'openai_structured_candidate' : result.provider==='openai-compatible'?'openai_compatible_structured_candidate':'codex_structured_candidate',
    date_role:['payment','order','completion','invoice','receipt'].includes(result.date_role)?result.date_role:'unknown',
    date_candidates:(Array.isArray(result.date_candidates)?result.date_candidates:[]).slice(0,8).filter(d=>d&&d.evidence&&typeof d.confidence==='number'&&d.confidence>=0&&d.confidence<=1).map(d=>({date:normalizedVoucherDate(d.date),role:['payment','order','completion','invoice','receipt'].includes(d.role)?d.role:'unknown',evidence:String(d.evidence).slice(0,500),confidence:d.confidence})),
    ...(arithmeticConflict?{arithmetic_conflict:true}:{}),
    ...(unverifiedTransfers?{unverified_transfer_count:unverifiedTransfers}:{}),
    recognition_prompt_version:String(result.prompt_version||'').slice(0,80),
    recognition_model:String(result.model||'').slice(0,100),document_kind: result.document_kind,recognition_schema_version:result.schema_version==='expense-voucher-v2'?'expense-voucher-v2':'legacy',document_type:String(result.document_type||'unknown').slice(0,40),transactions,monthly_summary:monthlySummary, evidence, parse_warnings: [...new Set(warnings)] }, confidences };
}

export function recoverVoucherDateCandidate(fields,confidences,raw,month) {
  if(fields?.document_date||fields?.document_kind!=='receipt'||fields?.recognition_schema_version!=='expense-voucher-v2'||raw?.schema_version!=='expense-voucher-v2')return null;
  try{
    const parsed=voucherCodexCandidates(raw,month);
    if(!parsed.fields.document_date||normalizedDate(raw.fields?.document_date))return null;
    return {fields:{...fields,document_date:parsed.fields.document_date,date_format_recovered:true,
      parse_warnings:[...new Set([...(fields.parse_warnings||[]),...parsed.fields.parse_warnings])]},
      confidences:{...confidences,document_date:parsed.confidences.document_date}};
  }catch{return null;}
}
