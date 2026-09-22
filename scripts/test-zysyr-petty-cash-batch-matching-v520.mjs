#!/usr/bin/env node
import assert from 'node:assert/strict';
import { matchPettyCashCandidate, parsePettyCashBatchNote } from '../supabase/functions/_shared/petty-cash-batch.mjs';

const targets = [
  { id: 'a', target_kind: 'formal', transaction_date: '2026-01-02', amount: 21.8, summary: '柠檬' },
  { id: 'b', target_kind: 'history', transaction_date: '2026-01-06', amount: 20.5, summary: '鲜花' },
];

assert.deepEqual(matchPettyCashCandidate({ document_date: '2026/1/2', amount: '¥21.80', counterparty: '柠檬' }, targets), {
  state: 'exact', unique_exact: true, score: 100, target_kind: 'formal', target_id: 'a',
  reason: '凭证日期和金额与一笔备用金明细一致',
});
assert.equal(matchPettyCashCandidate({ document_date: null, amount: 20.5 }, targets).state, 'amount_only');
assert.equal(matchPettyCashCandidate({}, targets).state, 'missing_fields');
assert.equal(matchPettyCashCandidate({ document_date: '2026-01-02', amount: 21.8 }, [...targets,
  { id: 'c', target_kind: 'history', transaction_date: '2026-01-02', amount: 21.8, summary: '重复金额' }]).state, 'ambiguous');
assert.deepEqual(parsePettyCashBatchNote('petty_cash_batch|2026-01|11111111-1111-4111-8111-111111111111|收据|补充.jpg'), {
  month: '2026-01', batch_id: '11111111-1111-4111-8111-111111111111', original_filename: '收据|补充.jpg',
});
assert.equal(parsePettyCashBatchNote('普通备注'), null);
console.log('v520 petty cash batch matching: unique, ambiguous, manual and durable batch-note cases passed');
