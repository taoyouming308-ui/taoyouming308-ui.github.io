# Offline synthesis attribution and validation-equivalence baseline

These diagnostic scripts do not change authorization, timeouts, database access or provider configuration. Three separately reviewed runtime pure-validation optimizations described below are now implemented. All inputs, credentials and transport responses are synthetic. No network calls are permitted by these scripts.

Run from the repository root:

- `node scripts/profile-design-synthesis-pure.mjs`
- `node scripts/profile-design-synthesis-history.mjs`
- `node scripts/test-design-record-history-equivalence.mjs`
- `node scripts/test-design-validated-replay.mjs`
- `node scripts/test-design-record-json-budget.mjs`
- `node scripts/test-design-request-local-record-validation.mjs`
- `node scripts/test-design-prepared-record-memo.mjs`

The first script measures native revisions 17 and 33 with three accepted comparisons and six media references. It runs the actual service/provider against synthetic dependencies. Inclusive dependency times overlap; use the separately reported dependency union instead of adding them. It does not model the database authority checks.

The second script constructs 23 workflow versions: human planned/actual technique and review, six attachments, an accepted and confirmed front comparison, accepted deterministic synthesis, native archive/reopen, and later back/left comparisons. It reproduces the repository history loop's pure record validation, accepted-artifact prefix verification, intent replay, hashes, canonical equality and JSON decoding. Its stage timings are mutually exclusive. It excludes SQL/locks, credential/access checks, database full-archive versions and some metadata/receipt decoding. One scan is not one complete HTTP request. Actual scan counts are needed before extrapolation.

Initial local observations on Node 22.22.1: latest-only service/provider mock paths took about 42–79 ms; a cumulative 23-version pure history scan took 349–356 ms. These are measurements, not performance guarantees or acceptance thresholds. The latter demonstrates why latest-record measurements cannot exclude cumulative JavaScript cost.

## Applied first layer: one complete accepted-history traversal

`validatePreparedWorkflowRecord` no longer calls the complete accepted-history validator twice. It preserves a nonempty, bounded model lane; constructs the full snapshot, which strictly copies and completely validates history; then checks each sanitized snapshot acceptance's workflow revision against the record revision. Surrounding schema, scope, session, native archives, photos and legacy validation remain in place. Failures retain `WORKFLOW_RECORD_INVALID` mapping.

The revision-bound loop originally inspected raw rows before strict copying. Independent review caught the resulting getter-execution regression. It now reads only the validated frozen snapshot lane. Negative tests assert zero executions for index, acceptance and workflowRevision getters and a custom iterator. No raw-row accessor is needed for the optimization.

The equivalence suite covers future acceptance revisions, malformed/empty lanes, malformed revisions, receipt/input hashes, source provenance, media references, angle/stage binding, ordering, journal tampering, corrupt legacy artifacts and valid v1/v2 bytes/hash. Its small test-only oracle is not a replacement public validator.

## Applied second layer: replay against a validated expected record

Before reading schema/session fields, `validatePreparedWorkflowRecord` strictly snapshots both record and scope through own data descriptors. Getters, proxies, non-JSON prototypes and primitives are rejected without execution. All subsequent validation and output construction use only those snapshots. This closes the alternating-top-level-getter gap found in independent review: an unvalidated second getter result can never receive a brand. Existing history JSON bounds remain (32 MiB, 750,000 nodes, 80 levels, 65,536-character strings), with downstream contract limits still enforced.

A module-private WeakSet marks only deep-frozen objects returned by `validatePreparedWorkflowRecord`. It is a pure structural proof, not an authorization cache, database authenticity proof or a record of current access, TTL or credentials. No caller flag, digest, clone or Proxy can create that proof.

`replayPreparedWorkflowIntentAgainstValidated` requires marked prior and expected records. It rejects top-level accessors before reading arguments, checks request data properties, JSON prototypes and primitives, preserves the existing intent-only 16 KiB limit, and rejects inherited getters/iterators/toJSON, functions and proxies. The private reconstruction function executes the same intent, event and candidate semantics as ordinary replay. Only if its complete canonical result equals the validated expected record does it return that exact frozen object, avoiding another complete record validation. A mismatch is rejected. The original four-argument `applyPreparedWorkflowIntent` still fully validates its output; no skip flag or raw reconstruction function is exported.

Only the database history loop uses the new replay path after its existing persisted record, hash, receipt and accepted-candidate checks. Fresh reads, locks, identity, scope, live media/ancestor access, expiry checks and final authorization checks are unchanged. There is no cross-transaction live-state cache.

## Applied third layer: request-local pure record validation reuse

The prepared runtime now wraps each HTTP `handle(request)` in a fresh private AsyncLocalStorage context using `runPreparedRecordValidationScope`. Its lifetime awaits the complete handler promise. Concurrent requests and nested scopes are isolated. Disabled runtime behavior remains unchanged.

The service binds a private factory instance to its strict snapshot function and complete record validator. No cache get/set API, caller skip flag or configurable validator is exposed from the service. Every lookup still safely snapshots both new record and scope inputs. Its key includes their complete canonical content **and** complete JSON serialization with original insertion order; neither a hash alone nor a trusted database digest substitutes for full content matching. Only the validator's original deeply frozen, privately branded result can be reused. Structurally equal input with different key order preserves its own serialized output bytes instead of returning the other order's object.

Each context holds at most 64 entries with a 16 MiB **serialized key plus output byte budget**. This is not an actual JavaScript heap limit: strings, objects, Map entries and runtime bookkeeping have additional overhead. Exceeding either budget falls back to complete validation, rather than rejecting otherwise valid input. Failed, mutable, promise-based or content-changing validation results are never cached. Other factory instances cannot contaminate the service's private store or mint its replay brand.

The `finally` path marks the context closed and clears its Map and counters. This releases cache references; it does not promise secure erasure of memory. Late callbacks inherit a closed context and perform complete validation without reading old entries or repopulating the cache. The same fallback applies when no request context exists.

Only pure structural validation is reused across fresh transactions within the same request. Fresh DB row reads, source/provenance proof, row and chain hashes, receipts, whole history and replay, credentials, identity, live access, expiry, media and ancestor checks, locks and final checks are never memoized. A cache hit does not establish that a record was freshly read or remains authorized.

Independent review and pure tests cover concurrency, nesting, successful/error cleanup, late callbacks, altered content/scope, malicious getters/proxies/prototypes, byte-order preservation, failure and overflow fallback, private-brand retention and independent-factory poisoning attempts. Root's actual runtime tests verify two concurrent HTTP failure paths and late callbacks. Memo-active actual PG regression passed all 23 cases across independent scopes, with 171 exact frozen-record hit assertions; warm-cache row-hash/receipt corruption and fresh revocation checks still reject. The counted composite remains 292 SQL statements and two independent transactions. Final default-30-second browser acceptance passed all 12 cases in a single run, with exact fixture cleanup verified.

## Bounded before/after observations

On the same synthetic 23-version chain, three cumulative pure scans measured:

- Before either layer: 349–356 ms.
- First layer only: 217–225 ms.
- Both layers: 127–134 ms.
- Both layers including strict entry snapshots after the brand-creation safety fix: 127–135 ms.

The replay portion fell from about 173–176 ms to 18–19 ms; the remaining full record validation still executes. These are local pure-computation observations, not HTTP latency guarantees. Browser/PG measurements must independently confirm the end-to-end result with unchanged default timeout and authorization checks. Do not sum inclusive dependency timings or infer that database costs disappeared. Legacy test artifacts are synthetic, not real customer records.

## Final end-to-end observation (synthetic only)

| Request | HTTP wall seconds | Cumulative query-await seconds | History row reads |
| --- | ---: | ---: | ---: |
| Local deterministic synthesis | 5.457 | 4.558 | 31 |
| First model synthesis | 14.323 | 10.178 | 61 |
| Later-history navigation case | 16.377 | 10.445 | 61 |
| Later-history close case | 16.736 | 10.486 | 61 |
| Later-history identity case | 16.567 | 10.346 | 61 |

All 12 unchanged browser assertions passed with the product client timeout still 30,000 ms. Intentionally lost candidate readback recovered manually in 2.072 seconds with no regeneration. Seven mock provider calls comprised three individual comparisons and four explicitly requested syntheses. No real provider or customer data was used. Safe aggregate discard/overflow counts were zero. Inclusive stage times overlap and must not be summed.

The instrumented pre-fix baseline was 42.636 seconds (153 leases, 18,222 queries, 61 history reads); explicit replay was 37.146 seconds and both timed out at 30 seconds. The first two layers alone improved the initial model request to 21.216 seconds but later-history synthesis still took 32.060 seconds, completing only 8/12 assertions. Preserve both failures; the final pass follows a specific third-layer change, not repeated unchanged attempts or a longer timeout.

These are single bounded local observations, not load/concurrency, production driver, real-model latency or memory certification. Trusted I/O that never settles retains its request context until completion; deployment must bound overall request lifetime, concurrency/queueing and process memory separately. The unrelated historical PG failure still lacks causal evidence and remains unresolved.
