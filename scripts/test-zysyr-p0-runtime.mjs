import assert from "node:assert/strict";
import { parseMonth } from "../supabase/functions/_shared/zysyr-date.mjs";
import { candidates, normalizedAmount, normalizedDate } from "../supabase/functions/_shared/zysyr-ocr-candidates.mjs";

assert.equal(parseMonth("2026-04"), "2026-04");
for (const invalid of ["", "2026-4", "2026-00", "2026-13", "2026-04-01"]) {
  assert.throws(() => parseMonth(invalid), /月份无效/);
}

assert.equal(normalizedDate("2026-04-21"), "2026-04-21");
assert.equal(normalizedDate("2026-02-30"), null);
assert.equal(normalizedAmount("6,395"), "6395.00");
assert.equal(normalizedAmount("<|LOC_334|>"), null);

const unstructured = candidates("2026年4月27日\n总计<|LOC_334|>\n6395");
assert.equal(unstructured.fields.document_date, null);
assert.equal(unstructured.fields.amount, null);
assert.equal(unstructured.fields.parse_mode, "unstructured_manual_review");
assert.deepEqual(unstructured.fields.parse_warnings, ["OCR_OUTPUT_NOT_STRUCTURED_JSON"]);
assert(!unstructured.fields.full_text.includes("LOC_334"));

const structured = candidates('```json\n{"full_text":"自由手艺人<|LOC_1|>","document_date":"2026-04-21","amount":"6,395","counterparty":null,"document_number":null}\n```');
assert.equal(structured.fields.document_date, "2026-04-21");
assert.equal(structured.fields.amount, "6395.00");
assert.equal(structured.fields.full_text, "自由手艺人");
assert.equal(structured.fields.parse_mode, "structured_candidate");
assert.deepEqual(structured.fields.parse_warnings, []);

console.log("ZYSYR_P0_RUNTIME_OK");
