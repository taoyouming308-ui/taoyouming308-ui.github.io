function cleanLocationTokens(value) {
  return String(value ?? "")
    .replace(/<\|LOC_\d+\|>/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

export function parseJsonCandidate(text) {
  const cleaned = String(text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function normalizedDate(value) {
  const match = String(value ?? "").trim().match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function normalizedAmount(value) {
  const direct = String(value ?? "").replace(/[,，¥￥\s]/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(direct)) return null;
  const amount = Number(direct);
  return Number.isFinite(amount) && amount <= 999999999.99 ? amount.toFixed(2) : null;
}

export function candidates(text) {
  const structured = parseJsonCandidate(text);
  const rawFullText = structured?.full_text ?? structured?.text ?? text;
  const fullText = cleanLocationTokens(rawFullText).slice(0, 100000);
  const structuredCandidate = Boolean(structured);
  const date = structuredCandidate ? normalizedDate(structured.document_date) : null;
  const amount = structuredCandidate ? normalizedAmount(structured.amount) : null;
  const counterparty = structuredCandidate ? String(structured.counterparty ?? "").trim().slice(0, 200) || null : null;
  const number = structuredCandidate ? String(structured.document_number ?? "").trim().slice(0, 100) || null : null;
  const warnings = [];
  if (!structuredCandidate) warnings.push("OCR_OUTPUT_NOT_STRUCTURED_JSON");
  if (structuredCandidate && structured.document_date != null && !date) warnings.push("OCR_DATE_INVALID");
  if (structuredCandidate && structured.amount != null && !amount) warnings.push("OCR_AMOUNT_INVALID");
  return {
    fields: {
      document_date: date,
      amount,
      counterparty,
      document_number: number,
      full_text: fullText,
      parse_mode: structuredCandidate ? "structured_candidate" : "unstructured_manual_review",
      parse_warnings: warnings,
    },
    confidences: {
      document_date: date ? 0.72 : 0,
      amount: amount ? 0.68 : 0,
      counterparty: counterparty ? 0.55 : 0,
      document_number: number ? 0.55 : 0,
    },
    structured,
  };
}
