import assert from 'node:assert/strict';
import { voucherCodexCandidates as parse } from '../supabase/functions/_shared/zysyr-voucher-codex.mjs';
const raw = { provider: 'codex-local', candidate_only: true, human_review_required: true, document_kind: 'receipt',
  fields: { document_date: '2026-07-01', amount: 236.8, counterparty: '测试', document_number: null },
  confidences: { document_date: .99, amount: .99, counterparty: .9 },
  evidence: { document_date: '2026-07-01', amount: '实付236.80', counterparty: '测试' }, warnings: [] };
assert.equal(parse(raw, '2026-07').fields.amount, '236.80');
assert.equal(parse({...raw, document_kind: 'multiple_transactions'}, '2026-07').fields.amount, null);
assert.equal(parse({...raw, document_kind: 'bank_summary'}, '2026-07').fields.document_date, null);
assert.equal(parse({...raw, evidence: {}}, '2026-07').fields.amount, null);
assert.equal(parse({...raw, confidences: {amount: .3}}, '2026-07').fields.amount, null);
assert.equal(parse({...raw, fields: {...raw.fields, amount: true}}, '2026-07').fields.amount, null);
assert.equal(parse({...raw, fields: {...raw.fields, document_date: '2026-02-30'}}, '2026-07').fields.document_date, null);
assert.throws(() => parse({...raw, candidate_only: false}, '2026-07'));
const mismatch = parse({...raw, fields: {...raw.fields, document_date: '2026-09-11'}}, '2026-07');
assert.equal(mismatch.fields.document_date, '2026-09-11');
assert.ok(mismatch.fields.parse_warnings.some(w => w.includes('不属于')));
console.log('Voucher Codex candidates: schema, evidence, confidence, multi-row, month mismatch and unknown safeguards passed.');
