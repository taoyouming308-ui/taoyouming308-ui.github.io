# Stage 20 isolated performance review (local preparation, not deployed)

Production stays disabled. No customer data, genuine credentials, provider calls, paid activity, production migrations or permission changes are part of this work. Existing ownership, fresh authorization, evidence and uncertain-outcome checks must remain unchanged. A faster synthetic test is not a live readiness claim.

## Measured baseline

`test-design-immutable-candidate-provider-postgres.mjs --profile` completed 21/21 with exact fixture cleanup. The profiling switches are test-only and emit bounded categories/counts/durations, not SQL, parameters, credentials, identities or source content.

| Operation | Handler wall (s) | Leases | Spawn-to-first-frame sum (s) | DB top-level execution (s) | Outside query await (s) |
| --- | ---: | ---: | ---: | ---: | ---: |
| First successful vision | 8.157 | 137 | 5.499 | 1.390 | 0.986 |
| Third comparison | 21.411 | 176 | see diagnostic log | 8.116 | 5.878 |
| Three-view model synthesis | 21.063 | 151 | 5.964 | 8.192 | 6.279 |
| Synthesis replay | 17.374 | 118 | 4.660 | 6.522 | 5.673 |

These columns overlap and must not be added together. Query await includes server work and the test transport. Outside-query time includes validation, copying/serialization, connection cleanup and scheduling, not merely JavaScript CPU. Function statistics are asynchronous diagnostic samples, not exhaustive accounting. The synthesis canonical-function self-time sample was 5.983 seconds.

The fixture starts Docker/psql for each physical client; that overhead is not representative of a warm production driver pool. Equally, the increasing database execution and outside-query costs show that connection startup is not the entire long-history issue. Four SET queries per transaction totaled only 0.119 seconds in first vision, so combining them was not pursued.

## Safety-preserving investigation

- Compare an explicit bounded **test-only** warm pool with the original fresh-process mode. Keep each transaction, authority check and evidence check intact. Do not claim this implements or validates the production pool/driver.
- Investigate canonical serialization overhead without skipping its rejection domain or changing stored hashes. An unused source fingerprint cannot simply be dropped: canonicalization also rejects unsupported source values.
- Do not cache authority, remove the second fresh check, extend the client timeout, automatically retry uncertain provider calls, or weaken proof/ancestor/media validation.
- Use fixed synthetic seconds-level model delays and a separate over-budget test. Such delays are stress scenarios, not a measured provider latency distribution.

## Unchanged launch gates

The historical intermittent PG failure has not been reproduced or explained by the measurements above. It remains a distinct launch blocker. Qualified controlled Linux image-worker deployment, actual production driver/pool behavior, approval issuer isolation, secret custody, host/region, actual data/cost approval and production least-privilege checks remain unprovisioned. No API key is needed for further isolated work.

## Verified database optimization and test transport comparison

| Same synthetic workload | Fresh physical connection baseline | Warm test pool, old canonical | Warm test pool, leaf optimization |
| --- | ---: | ---: | ---: |
| Three-view model synthesis wall | 21.063 s | 13.542 s | 10.847 s |
| Synthesis replay wall | 17.374 s | 11.529 s | 9.382 s |
| Synthesis DB execution | 8.192 s | 7.245 s | 4.814 s |
| Replay DB execution | 6.522 s | 5.827 s | 3.887 s |

The synthesis still executes 151 transactions and 1,848 measured queries; replay still executes 118 transactions and 1,454 queries. Fresh baseline transaction classification missed some BEGIN variants, so its lease count supplies the transaction comparison. The later classifier recognizes both forms. No fresh read, permission/receipt check, source digest or evidence validation was removed. Reusing a backend also warms its function/plan state; the first comparison is not merely network latency subtraction.

The guarded offline `stage20-canonical-leaf-fixture.sql` only inlines primitive leaf serialization inside the existing recursive serializer. Container recursion, ASCII object-key restriction, C ordering, string escaping, number bounds/scales, unsupported-value rejection and every resulting fingerprint remain. There are no new grants, APIs, source/authority caches or hash formats. The transaction verifies unchanged owner, ACL, search path, security mode, return type and volatility. An independently renamed old function (including its recursive references) and the new function matched across 636 fixed cases: 622 accepted UTF-8 outputs/SHA-256 hashes and 14 rejected SQLSTATE/category outcomes. Unsupported raw values are sent as raw JSON text so the test does not accidentally normalize them in JavaScript.

The opt-in warm pool is **test infrastructure**, not a production driver implementation. It has at most two physical runtime-role connections, bounded waiting, exclusive physical leases, confirmed clear/COMMIT reuse and permanent quarantine after failures or unknown outcomes. Issuer/admin connections are not pooled together with runtime. Pure tests cover stale handles, in-flight release, failed destruction, creation/close races, queue handling and profile-flush exclusion. Real PG checks show the same backend restores local settings, has no usable old authority, and rejects a subsequently revoked employee. Existing replay/concurrency/unknown-claim/unknown-completion/same-name checks also run through the pool.

The first warm run stopped because its new test attempted to decrease a security epoch in cleanup. The unchanged immutable-identity guard correctly refused. Only the synthetic setup was corrected: use a separate employee for a one-way revocation and never lower an epoch. The failed log is retained; this is not the historical intermittent PG fault.

Validation so far: fresh PG 21/21, warm PG 23/23, warm-plus-leaf PG 23/23, canonical equivalence 636, pool safety 19, diagnostic privacy/isolation 6. Each PG run completed exact cleanup. Browser delay and final regression results follow below after actual execution.

Reproduce using the same isolated test fixture (never a production database):

```sh
node scripts/test-design-immutable-candidate-provider-postgres.mjs --profile
node scripts/test-design-immutable-candidate-provider-postgres.mjs --profile --warm-runtime
node scripts/test-design-immutable-candidate-provider-postgres.mjs --profile --warm-runtime --canonical-leaves
npm run test:design-performance-safety
```

Default fixture behavior remains fresh physical connections and the original SQL. Both changes require explicit test flags. A real deployment would need a separately reviewed production migration/driver and the unchanged approval gates above.

## Full browser delayed workload (verified)

The original App homepage and prepared HTTP workflow passed all 12 checks on v676 with the warm test pool and equivalent leaf SQL. Each of five mock external operations waits a fixed 1/3/2/5/3 seconds respectively. This is a deterministic stress profile, not a claim about real provider response times. The browser request budget remains 30,000 ms.

| Browser response-header latency | Seconds |
| --- | ---: |
| Before visual description | 2.550 |
| Front comparison | 10.017 |
| Back comparison | 14.306 |
| Left comparison | 20.053 |
| Three-view model synthesis | 20.059 |
| Same-request synthesis replay | 13.500 |
| Full archive publication | 5.817 |

The slowest request leaves about 9.941 seconds of synthetic headroom. There are six original photo refs, six accepted candidates, workflow revision 17/native session revision 18 and one full archive; explicit human confirmation is distinct from adoption. Opposing/noncomparable/missing-angle evidence is retained. Provider/key counts remain five each, derivative count seven. Exact browser/PG/static-server cleanup completed. This does not establish real provider latency/quality, a production SLA, or arbitrary history/concurrency capacity.

## Negative browser outcomes (verified)

- Over-budget scenario: 4/4. A 31-second synthetic provider wait actually exceeds the unchanged 30-second client budget. The client aborts; the server eventually records a 409 TIMEOUT and a reconstructed runtime returns 409 for the same request. Provider/key counts remain one, with no automatic resend or candidate delivery. A timeout is not evidence that an already dispatched external operation never happened or cannot incur cost.
- Revocation-during-wait scenario: 4/4. The independent test issuer revokes the exact receipt after mock transport entry. The original response is 409 TRANSMISSION_DENIED; same-request replay remains 409, provider/key counts one, with no candidate delivery. Post-dispatch revocation cannot recall bytes already sent; this checks non-delivery and no resend, not retroactive prevention of transmission.

Both runs wait for the original server work to reach a known state before explicit replay. The longer test cleanup wait is not an enlarged client request budget. Each run independently verifies exact cleanup.

The separate no-delay warm-plus-leaf browser baseline also passes 12/12 with exact cleanup: vision 1.355s, front/back/left comparison 6.752/12.180/14.916s, local synthesis 4.988s, model synthesis 17.040s, replay 13.503s and full archive 5.803s (response-header times). The four browser scenarios total 32 checks (12+4+4+12). No-delay and delayed rounds have the same record shape and dispatch counts. Header timings do not include all response body/UI work; passing the actual unchanged client request timer additionally confirms completion in these bounded synthetic runs, not any universal latency guarantee.

Final independent review found an initial pool-test proof weakness: calling private `require_authority()` and asserting only SQLSTATE 42501 could merely test missing EXECUTE. The test was strengthened without changing runtime code or permissions. It now verifies EXECUTE on the public fixed `recheck_authority()` entry, authorizes Alice, clears/commits/releases, borrows the exact same PID, and requires both 42501 and `IDENTITY_CONTEXT_REQUIRED`. The final warm-plus-leaf smoke passed 6/6 with 636-equivalence revalidation and exact cleanup. The earlier broad suites remain valid for their other assertions; this narrow run supplies the previously missing context-isolation evidence.

Final pure regressions passed: performance safety (6 diagnostic + 19 pool), immutable candidates (45), immutable generation (including policy repository33), dependency-authority suite, App smoke20, booking UI, monthly care and store-login isolation. v676 version/release/sync/diff checks also pass. The final app-shell browser result is recorded separately below.

Final v676 App-shell browser: 15/15, cold install 2,012ms, warm navigations 34/21/19ms, 64 explicitly public static assets. Offline entry/auth gates, failed atomic install, version mismatch, unsaved edits, eviction repair and downgrade protection pass. This local browser test is not iPhone or production performance.
