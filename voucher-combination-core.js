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
  const goal = voucherCents(target.amount), words = String(target.summary || target.label || '').replace(/\s/g, '');
  if (goal === null) return { groups: [], candidates: [], limited: false };
  const tokens = new Set(); for (let i = 0; i < words.length - 1; i++) tokens.add(words.slice(i, i + 2));
  const candidates = items.filter(item => {
    const f = voucherFields(item), date = String(f.document_date || ''), amount = voucherCents(voucherAmount(item));
    return amount !== null && amount <= goal && f.evidence_kind !== 'monthly_summary'
      && !['bank_summary', 'multiple_transactions', 'monthly_summary'].includes(f.document_kind)
      && (!date || date.slice(0, 7) === month) && (!f.period_month || f.period_month === month)
      && (!(item.confirmed_target_id || item.expense_association) || sameVoucherTarget(item, target))
      && [item.original_filename, f.summary, f.counterparty, f.expense_category, f.amount].join(' ').toLowerCase().includes(query.trim().toLowerCase());
  }).map((item, index) => {
    const f = voucherFields(item), proof = [f.summary, f.expense_category, f.counterparty].join('');
    const relevance = [...tokens].filter(t => proof.includes(t)).length;
    const distance = f.document_date && target.transaction_date ? Math.abs(Date.parse(f.document_date) - Date.parse(target.transaction_date)) / 86400000 : 32;
    return { item, amount: voucherCents(voucherAmount(item)), rank: relevance * 100 - Math.min(32, Number.isFinite(distance) ? distance : 32), index };
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
