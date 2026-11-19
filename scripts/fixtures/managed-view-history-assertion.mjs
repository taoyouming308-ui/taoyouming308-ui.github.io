/** Test-only JSONB readback assertion. Object key order is not a semantic
 * history byte format; canonical digests, every value and array order are. */
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {designCandidateDigest} from '../../packages/analysis-engine/design-candidate.mjs';
export function managedHistoryComparison(before,after){return {serializedEqual:JSON.stringify(before)===JSON.stringify(after),valuesEqual:isDeepStrictEqual(before,after),digestEqual:designCandidateDigest(before)===designCandidateDigest(after),beforeDigest:designCandidateDigest(before),afterDigest:designCandidateDigest(after)};}
export function assertManagedHistoryUnchanged(before,after){const result=managedHistoryComparison(before,after);assert.equal(result.valuesEqual,true,'MANAGED_HISTORY_VALUES_CHANGED');assert.equal(result.digestEqual,true,'MANAGED_HISTORY_CANONICAL_DIGEST_CHANGED');return result;}
