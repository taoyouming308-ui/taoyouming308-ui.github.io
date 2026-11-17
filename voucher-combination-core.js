// Pure currency arithmetic shared by the browser and the authenticated API.
export function voucherCents(value) {
  if (value == null || typeof value === 'boolean' || String(value).trim() === '') return null;
  const n = Number(value), cents = Math.round(n * 100);
  return Number.isFinite(n) && Number.isSafeInteger(cents) && cents > 0 && Math.abs(n * 100 - cents) < 1e-6 ? cents : null;
}
export const voucherIdentity = item => String(item.source_voucher_id || item.id || '');
export const voucherPartKey = item => voucherIdentity(item) + ':' + Number(item.component_index || 0);
export function voucherFields(item) { return { ...(item.candidate_fields || {}), ...(item.corrected_fields || {}) }; }
export function voucherAmount(item) {
  if (Object.hasOwn(item.corrected_fields || {}, 'amount')) return item.corrected_fields.amount;
  const fields = voucherFields(item);
  if (Object.hasOwn(fields, 'amount') && fields.amount != null && fields.amount !== '') return fields.amount;
  const amounts = [...new Set((item.recognized_amounts || []).map(voucherCents).filter(n => n !== null))];
  return amounts.length === 1 ? amounts[0] / 100 : null;
}
// Printed order totals are useful search clues, but never become payment fields.
export function voucherRecommendation(item, target = {}, month = '') {
  const f = voucherFields(item), review = Number(item.component_count || 1) === 1 ? item.latest_review?.corrected_fields || {} : {};
  const corrected = { ...review, ...(item.corrected_fields || {}) }, manual = Object.hasOwn(corrected, 'amount');
  const actual = voucherCents(manual ? corrected.amount : voucherAmount(item));
  let amount = actual, documentOnly = false, amountLabel = '';
  if(!manual&&amount===null&&voucherCents(target.amount)!==null){const amounts=[...new Set((item.recognized_amounts||[]).map(voucherCents).filter(n=>n!==null))];if(amounts.length>1){amounts.sort((a,b)=>Math.abs(a-voucherCents(target.amount))-Math.abs(b-voucherCents(target.amount)));amount=amounts[0];documentOnly=true;amountLabel='分项识别金额';}}
  const proof = String(f.evidence?.amount || '').trim();
  if (!manual && amount === null && proof) {
    const number = '([0-9]+(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?)(?![0-9.,])';
    const patterns = [new RegExp('(?:实付(?:款)?(?:金额)?|实际支付)\\s*[:：]?\\s*(?:人民币)?[¥￥]?\\s*'+number, 'g'),
      new RegExp('(?:订单金额|订单总额|订单合计|应付(?:款)?(?:金额)?|价税合计|合计|总计|支付金额|交易金额)\\s*[:：]?\\s*(?:人民币)?[¥￥]?\\s*'+number, 'g')];
    for (const pattern of patterns) {
      const values = [...new Set([...proof.matchAll(pattern)].map(m => voucherCents(m[1].replaceAll(',', ''))).filter(n => n !== null))];
      if (values.length) { if (values.length === 1) amount = values[0]; break; }
    }
    if (amount === null && /^(?:人民币)?\s*[¥￥]?\s*[0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?\s*元?$/.test(proof)) amount = voucherCents(proof.replace(/人民币|[¥￥元\s,]/g, ''));
    if(amount===null){const values=[...new Set([...proof.matchAll(/[¥￥]\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)(?![0-9.,])/g)].map(m=>voucherCents(m[1].replaceAll(',',''))).filter(n=>n!==null))];if(values.length===1)amount=values[0];}
    documentOnly = amount !== null;
  }
  const validDate = value => { if (!/^20\d{2}-\d{2}-\d{2}$/.test(String(value || ''))) return false; const day = new Date(value + 'T00:00:00Z'); return Number.isFinite(+day) && day.toISOString().slice(0, 10) === value; };
  const manualDate = Object.hasOwn(corrected, 'document_date'), actualDate = manualDate ? corrected.document_date : f.document_date;
  const dates = validDate(actualDate) ? [{ date: actualDate, role: f.date_role || 'payment' }]
    : manualDate ? [] : (f.date_candidates || []).filter(d => d && validDate(d.date) && d.evidence && Number(d.confidence) >= .85);
  const words = String(target.summary || target.label || '').replace(/\s/g, '').toLowerCase();
  const printed = [f.summary, f.expense_category, f.counterparty, f.evidence?.expense_category, f.evidence?.summary, item.original_filename].join(' ').toLowerCase();
  const tokens = new Set(); if (words.length === 1) tokens.add(words); for (let i = 0; i < words.length - 1; i++) tokens.add(words.slice(i, i + 2));
  const relevance = [...tokens].filter(token => printed.includes(token)).length;
  const foreign = Boolean(month && dates.length && dates.every(d => d.date.slice(0, 7) !== month));
  const distance = target.transaction_date && dates.length ? Math.min(...dates.map(d => Math.abs(Date.parse(d.date) - Date.parse(target.transaction_date)) / 86400000)) : 32;
  return { amount_cents: amount, document_only: documentOnly, payment_unconfirmed: documentOnly,
    amount_label: amountLabel || (documentOnly ? f.document_type === 'order' ? '订单原文金额' : '原文金额' : '金额'), proof,
    dates, relevance, foreign, date_distance: Number.isFinite(distance) ? distance : 32 };
}
export function normalizeVoucherPeriod(value, contextMonth) {
  const text=String(value||'').trim();if(!text)return '';
  const full=text.match(/^(20\d{2})\s*(?:-|\/|年)\s*(0?[1-9]|1[0-2])\s*月?$/);
  if(full)return full[1]+'-'+full[2].padStart(2,'0');
  const short=text.match(/^(0?[1-9]|1[0-2])\s*月?$/);
  return short&&/^20\d{2}-(0[1-9]|1[0-2])$/.test(contextMonth)?contextMonth.slice(0,4)+'-'+short[1].padStart(2,'0'):text;
}
export function rankVoucherLibrary(items, target, month) {
  const goal = voucherCents(target.amount);
  return items.map((item, index) => {
    const recommendation = voucherRecommendation(item, target, month), amount = recommendation.amount_cents;
    const difference = goal === null || amount === null ? Infinity : Math.abs(goal - amount);
    const tier = difference === 0 ? 0 : recommendation.relevance > 0 && !recommendation.foreign ? 1 : Number.isFinite(difference) ? 2 : 3;
    return { item, index, recommendation, difference, tier };
  }).sort((a, b) => a.tier - b.tier || (a.tier === 0 ? Number(a.recommendation.foreign) - Number(b.recommendation.foreign) : 0)
    || (a.tier === 0 || a.tier === 1 ? b.recommendation.relevance - a.recommendation.relevance : 0)
    || a.difference - b.difference || a.recommendation.date_distance - b.recommendation.date_distance
    || Number(Boolean(a.item.confirmed_target_id || a.item.expense_association)) - Number(Boolean(b.item.confirmed_target_id || b.item.expense_association)) || a.index - b.index);
}
export function sameVoucherTarget(item, target) {
  return item.confirmed_target_kind === target.target_kind && item.confirmed_target_id === target.id;
}
export function combinationTotal(items) {
  if (!Array.isArray(items) || items.length < 2 || items.length > 20) return null;
  const images = new Set(); let total = 0;
  for (const item of items) {
    const identity = voucherIdentity(item), cents = voucherCents(voucherAmount(item));
    if (!identity || images.has(identity) || cents === null) return null;
    images.add(identity); total += cents;
  }
  return Number.isSafeInteger(total) ? total : null;
}
export function recommendVoucherCombinations(items, target, month, query = '') {
  const goal = voucherCents(target.amount);
  if (goal === null) return { groups: [], candidates: [], limited: false };
  const candidates = items.filter(item => {
    const f = voucherFields(item), hint = voucherRecommendation(item, target, month), amount = hint.amount_cents;
    return amount !== null && amount <= goal && f.evidence_kind !== 'monthly_summary'
      && !['bank_summary', 'multiple_transactions', 'monthly_summary'].includes(f.document_kind)
      && !hint.foreign && (!f.period_month || f.period_month === month)
      && (!(item.confirmed_target_id || item.expense_association) || sameVoucherTarget(item, target))
      && [item.original_filename, f.summary, f.counterparty, f.expense_category, f.amount].join(' ').toLowerCase().includes(query.trim().toLowerCase());
  }).map((item, index) => {
    const hint = voucherRecommendation(item, target, month);
    return { item, amount: hint.amount_cents, rank: hint.relevance * 100 - Math.min(32, hint.date_distance), index };
  }).sort((a, b) => b.rank - a.rank || a.index - b.index);
  // Bounded recommendations; manual selection still exposes the complete library.
  const pool = candidates.slice(0, 80), states = new Map([[0, [[]]]]), found = new Map();
  let operations = 0, limited = candidates.length > pool.length;
  outer: for (let index = 0; index < pool.length; index++) {
    const row = pool[index], image = voucherIdentity(row.item), before = [...states.entries()].map(([sum, groups]) => [sum, groups.slice()]);
    for (const [sum, groups] of before) for (const group of groups) {
      if (++operations > 650000) { limited = true; break outer; }
      if (group.length >= 20 || group.some(i => voucherIdentity(pool[i].item) === image)) continue;
      const next = sum + row.amount; if (next > goal) continue;
      const selected = group.concat(index);
      if (next === goal && selected.length >= 2) {
        const key = selected.map(i => voucherPartKey(pool[i].item)).sort().join('|');
        if (!found.has(key) && found.size < 80) found.set(key, { items: selected.map(i => pool[i].item), total_cents: next,
          score: selected.reduce((n, i) => n + pool[i].rank, 0) / selected.length });
      }
      const bucket = states.get(next);
      if (bucket) { if (bucket.length < 3) bucket.push(selected); }
      else if (states.size < 26000) states.set(next, [selected]); else limited = true;
    }
  }
  return { groups: [...found.values()].sort((a, b) => b.score - a.score || a.items.length - b.items.length).slice(0, 8),
    candidates: candidates.map(row => row.item), limited };
}
