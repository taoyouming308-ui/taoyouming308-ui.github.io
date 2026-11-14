import { normalizedDate, normalizedAmount } from './zysyr-ocr-candidates.mjs';

export function voucherCodexCandidates(result, month) {
  if (!['codex-local','openai-api'].includes(result?.provider) || result?.candidate_only !== true || result?.human_review_required !== true
      || !['receipt', 'bank_summary', 'multiple_transactions', 'unknown'].includes(result?.document_kind)) {
    throw new Error('CODEX_INVALID_CANDIDATE');
  }
  const fields = {}, confidences = {}, evidence = {};
  for (const key of ['document_date', 'amount', 'counterparty', 'document_number','summary','expense_category']) {
    const proof = String(result.evidence?.[key] || '').trim().slice(0, 500);
    const score = result.confidences?.[key];
    let value = result.fields?.[key];
    if (!proof || typeof score !== 'number' || !Number.isFinite(score) || score > 1 || score < (['document_date', 'amount'].includes(key) ? .85 : .7)) value = null;
    if (key === 'document_date') value = normalizedDate(value);
    else if (key === 'amount') value = typeof value === 'boolean' ? null : normalizedAmount(value);
    else value = value == null ? null : String(value).trim().slice(0, 200) || null;
    if (key === 'amount' && Number(value) <= 0) value = null;
    if (result.document_kind !== 'receipt' && ['amount', 'document_date'].includes(key)) value = null;
    fields[key] = value;
    confidences[key] = value == null ? 0 : score;
    evidence[key] = proof;
  }
  const warnings = (Array.isArray(result.warnings) ? result.warnings : []).map(w => String(w).slice(0, 200)).slice(0, 25);
  if (fields.document_date && fields.document_date.slice(0, 7) !== month) warnings.push('原图日期不属于所选月份，请核对门店和月份');
  const transactions = [];
  if (['bank_summary','multiple_transactions'].includes(result.document_kind) && Array.isArray(result.transactions)) {
    for (const item of result.transactions.slice(0,12)) {
      const parsed=voucherCodexCandidates({provider:result.provider,candidate_only:true,human_review_required:true,document_kind:'receipt',
        fields:item,evidence:item.evidence,confidences:item.confidence,warnings:[]},month);
      transactions.push({...parsed.fields,confidence:parsed.confidences});
    }
  }
  const summary=result.monthly_summary;
  const validSummaryConfidence=key=>typeof summary?.confidence?.[key]==='number'&&Number.isFinite(summary.confidence[key])&&summary.confidence[key]>=.85&&summary.confidence[key]<=1;
  let monthlySummary=null;
  if(summary && ['payroll','advertising_report','invoice','receipt'].includes(result.document_type) && /^\d{4}-(0[1-9]|1[0-2])$/.test(summary.period_month||'') && summary.evidence?.period_month && summary.evidence?.expense_total
    && validSummaryConfidence('period_month') && validSummaryConfidence('expense_total') && typeof summary.expense_total==='number'&&Number.isFinite(summary.expense_total)&&summary.expense_total>0){
    monthlySummary={evidence_kind:'monthly_summary',document_kind:'monthly_summary',document_date:null,period_month:summary.period_month,
      amount:normalizedAmount(summary.expense_total),expense_category:summary.evidence?.expense_category&&validSummaryConfidence('expense_category')?String(summary.expense_category||'').slice(0,120):null,
      summary:'月度费用汇总佐证',evidence:{period_month:String(summary.evidence.period_month).slice(0,500),amount:String(summary.evidence.expense_total).slice(0,500),expense_category:String(summary.evidence.expense_category||'').slice(0,500)},
      confidence:{period_month:summary.confidence.period_month,amount:summary.confidence.expense_total,expense_category:summary.confidence.expense_category}};
  }
  return { fields: { ...fields, recognition_provider: result.provider, parse_mode: result.provider === 'openai-api' ? 'openai_structured_candidate' : 'codex_structured_candidate',
    document_kind: result.document_kind,recognition_schema_version:result.schema_version==='expense-voucher-v2'?'expense-voucher-v2':'legacy',document_type:String(result.document_type||'unknown').slice(0,40),transactions,monthly_summary:monthlySummary, evidence, parse_warnings: [...new Set(warnings)] }, confidences };
}
