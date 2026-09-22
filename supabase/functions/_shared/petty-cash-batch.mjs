function clean(value, max = 300) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function normalizedDate(value) {
  const raw = clean(value, 20).replace(/[./]/g, "-");
  const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return "";
  const month = Number(match[2]), day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${match[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizedAmount(value) {
  if (value == null || value === "") return null;
  const amount = Number(String(value).replace(/[,，￥¥\s]/g, ""));
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null;
}

function normalizedText(value) {
  return clean(value, 300).replace(/[\s·•._,，。:：;；()（）\-]/g, "").toLowerCase();
}

export function pettyCashTargetKey(target) {
  return `${clean(target && target.target_kind, 20)}:${clean(target && target.id, 40)}`;
}

export function matchPettyCashCandidate(candidate, targets) {
  const documentDate = normalizedDate(candidate && candidate.document_date);
  const amount = normalizedAmount(candidate && candidate.amount);
  const counterparty = normalizedText(candidate && candidate.counterparty);
  const usable = Array.isArray(targets) ? targets.filter((target) => target && target.id) : [];
  const ranked = usable.map((target) => {
    const targetDate = normalizedDate(target.transaction_date);
    const targetAmount = normalizedAmount(target.amount);
    const dateMatch = Boolean(documentDate && targetDate === documentDate);
    const amountMatch = amount !== null && targetAmount !== null && Math.abs(targetAmount - amount) <= 0.01;
    const haystack = normalizedText(`${target.summary || ""}${target.category || ""}${target.recipient || ""}`);
    const textMatch = Boolean(counterparty && haystack && (haystack.includes(counterparty) || counterparty.includes(haystack)));
    return { target, dateMatch, amountMatch, textMatch, score: (amountMatch ? 60 : 0) + (dateMatch ? 30 : 0) + (textMatch ? 10 : 0) };
  }).sort((left, right) => right.score - left.score || pettyCashTargetKey(left.target).localeCompare(pettyCashTargetKey(right.target)));
  const exact = ranked.filter((item) => item.dateMatch && item.amountMatch);
  if (exact.length === 1) return {
    state: "exact", unique_exact: true, score: exact[0].score,
    target_kind: exact[0].target.target_kind, target_id: exact[0].target.id,
    reason: "凭证日期和金额与一笔备用金明细一致",
  };
  if (exact.length > 1) return { state: "ambiguous", unique_exact: false, score: exact[0].score,
    target_kind: null, target_id: null, reason: `有 ${exact.length} 笔明细的日期和金额相同，请人工选择` };
  const amountOnly = ranked.filter((item) => item.amountMatch);
  if (amountOnly.length === 1) return {
    state: "amount_only", unique_exact: false, score: amountOnly[0].score,
    target_kind: amountOnly[0].target.target_kind, target_id: amountOnly[0].target.id,
    reason: "金额仅对应一笔，但日期不一致或未识别，请人工核对",
  };
  if (amountOnly.length > 1) return { state: "ambiguous", unique_exact: false, score: amountOnly[0].score,
    target_kind: null, target_id: null, reason: `有 ${amountOnly.length} 笔明细金额相同，请人工选择` };
  const dateOnly = ranked.filter((item) => item.dateMatch);
  if (dateOnly.length === 1) return {
    state: "date_only", unique_exact: false, score: dateOnly[0].score,
    target_kind: dateOnly[0].target.target_kind, target_id: dateOnly[0].target.id,
    reason: "日期仅对应一笔，但金额不一致或未识别，请人工核对",
  };
  return { state: documentDate || amount !== null ? "unmatched" : "missing_fields", unique_exact: false,
    score: 0, target_kind: null, target_id: null,
    reason: documentDate || amount !== null ? "没有唯一对应明细，请人工选择" : "未识别出日期和金额，请人工填写并选择明细" };
}

export function parsePettyCashBatchNote(value) {
  const parts = clean(value, 500).split("|");
  if (parts.length < 4 || parts[0] !== "petty_cash_batch" || !/^\d{4}-\d{2}$/.test(parts[1])
      || !/^[0-9a-f-]{36}$/i.test(parts[2])) return null;
  return { month: parts[1], batch_id: parts[2], original_filename: parts.slice(3).join("|") };
}
