import { normalizedDate, normalizedAmount } from './zysyr-ocr-candidates.mjs';

export function voucherCodexCandidates(result, month) {
  if (result?.provider !== 'codex-local' || result?.candidate_only !== true || result?.human_review_required !== true
      || !['receipt', 'bank_summary', 'multiple_transactions', 'unknown'].includes(result?.document_kind)) {
    throw new Error('CODEX_INVALID_CANDIDATE');
  }
  const fields = {}, confidences = {}, evidence = {};
  for (const key of ['document_date', 'amount', 'counterparty', 'document_number']) {
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
  return { fields: { ...fields, recognition_provider: 'codex-local', parse_mode: 'codex_structured_candidate',
    document_kind: result.document_kind, evidence, parse_warnings: [...new Set(warnings)] }, confidences };
}
