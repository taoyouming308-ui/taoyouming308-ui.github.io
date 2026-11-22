# Stage 21 real driver and history-load preparation (driver checkpoint; long-history performance blocked)

No production connection, credential, permission, migration or provider call is enabled. All database fixtures and model/media inputs are synthetic. The injected driver adapter is not a deployed service or an approved connection configuration.

## Dependency provenance

`pg` 8.16.3 was verified against the official npm registry and pinned as a development dependency with the lockfile's SHA-512 integrity. Installation used empty personal/global npm configs, no project npm config, disabled lifecycle scripts, no audit submission and no funding actions. Fourteen packages were added. This is a local test dependency, not a production package rollout. Explicit synthetic test connection settings must prevent ambient credential/default or pgpass discovery.

## Historical intermittent error: bounded investigation, unresolved

The original Stage 7 failure reached initial legacy archive authorization and returned `RELATIONSHIP_UNAVAILABLE`; its trace did not retain the underlying relationship/SQL failure. It must not be retroactively attributed to connection startup, serializer performance or a later test-fixture defect.

A single existing `test-design-postgres-executor-integration.mjs --investigate-legacy` run passed 7 checks, including 12 distinct correct-CAS appends without retry, and exact container cleanup. No recurrence or root cause was observed. The existing fixed-category diagnostic ring remains available to capture a future occurrence. Passing this bounded run does not resolve the deployment blocker; no authorization check, retry rule or test deadline was relaxed.

## Actual driver validation boundary

Implementation and actual protocol/load results will be recorded only after execution. A Docker pipe carrying PostgreSQL binary protocol is not ordinary production TCP/TLS, even if the real node-postgres Client and Pool parse and manage that protocol. Driver correctness evidence and transport/performance qualification must be stated separately.

Worker environment findings and unmet deployment decisions are in `STAGE21-WORKER-DEPLOYMENT-OPTIONS.md`; no currently available environment meets the specified controlled-worker host boundary.

## Verified real driver integration

`trusted-pg-pool-adapter.mjs` accepts an explicitly provided owner-managed node-postgres Pool and is disabled by default. It reads no environment, connection options, passwords or keys, creates no pool, network listener or service, grants no rights and installs no SQL. Every checkout verifies the exact nonowner runtime role and dangerous role flags before returning own-method capabilities. Separate runtime and issuer pools, finite driver-level connection timeouts and approved host/TLS settings remain deployment responsibilities.

The adapter bounds concurrent leases, queue size and acquire/query waits. It preserves existing transaction/authorization order and allows an authorized unclean commit, but destroys rather than reuses its connection. Only acknowledged clear-plus-COMMIT clean leases can return to the owner pool. Unknown, failed, pending and poisoned work is quarantined; no automatic retry occurs. Query-stage errors conservatively report uncertainty, safe SQLSTATE/conflict sentinels remain compatible, and driver errors/credentials are never copied into diagnostic events. Async diagnostics are contained. Shutdown waits for outstanding work within the stated bound and explicitly reports unresolved cleanup rather than claiming success; the owner must still close its Pool.

A fixed test-only Perl byte relay inside the existing network-disabled PG17 container carries the actual PostgreSQL wire protocol. There are no exposed host ports, mounts or new images. The real `pg` 8.16.3 Client/Pool handles Bind/Execute, parameter values, row metadata, SQLSTATE and connection reuse. Installer, seed and independent synthetic issuer utilities remain psql; they are not misrepresented as measured runtime driver calls. Connection settings are explicit synthetic values, not ambient credentials.

Passed and exactly cleaned:

- Real protocol probe 3/3: nonowner LOGIN, quoted Unicode/NULL/bytea/int8 values, server ErrorResponse, aborted COMMIT returning ROLLBACK, and same-backend authorization cleanup.
- Real driver + trusted wrapper + existing HTTP services smoke 4/4.
- Complete immutable candidate/provider regression 21/21: concurrent single dispatch, injected lost claim/completion COMMIT acknowledgements, actual persisted replay, processing/cost approval separation, ancestor revocation, old v2 ASR and same-name identity isolation. Thirteen actual runtime connections were created, with final relay children and Pool total/idle/waiting all zero.
- Synthesis/replay handler times in that workload were 10.685/9.228 seconds. These are Docker-relay measurements, not production TCP/TLS latency.

The wrapper's pure tests cover lifecycle, role, duplicate lease, observer failures, unknown outcomes and bounded close. Real-driver verification does not certify an arbitrary caller-supplied pool, driver extensions, deployment credentials or infrastructure.

## Long-history boundary found (not a pass)

The first seed attempt omitted the existing explicit front-comparison confirmation, so the real synthesis rules correctly selected `model_review_focus` rather than the test's expected deterministic branch. The test was corrected to use the normal exact-value human-confirmation operation; no model rule was relaxed.

On the corrected run, native revision16/workflow17 with six photos and four accepted candidates passed load (0.901s), new synthesis (15.507s) and full archive publication (4.607s). At native24/workflow25 with **one** full archive, the unchanged client aborted at about30.030s and reported `HTTP_OUTCOME_UNCERTAIN`. The original server operation was awaited without retry; it eventually returned200 at67.774s and made only one mock provider/key invocation for that request. The script stopped before native32/three archives and did not attempt64.

The saved synthetic evidence is800,026bytes with26 workflow rows, native24 and one full archive from native17. It is not the planned32/three-archive acceptance. Query-await10.906s and outside-query19.125s were only measured up to client abort, not across the full67.774s; they must not be presented as complete CPU attribution. This is an active performance blocker, separate from the still-unexplained historical PG error. All connections, relay children and the exact fixture container were cleaned after the original operation settled.

Further pure-computation profiling uses that exact authorized synthetic bundle before any optimization. No authority/source/manifest cache, dropped check, new fee, automatic generation retry or larger client timeout is permitted as a shortcut.

## Additional isolation and cleanup review

The actual Pool(2) two-employee test passed5/5: distinct backend PIDs and immutable authorities, Alice/Bob each using the same request ID for one normal workflow write with exact own replay, and Bob denied read/write of Alice's scope without changing row counts. No model ran. Both connections and all relay/Pool counts reached zero, with exact container cleanup.

Independent review found that the test wire pool's original `close()` could return success on a second call after its first failure. The fixture now preserves one close Promise, including rejection, and waits for initiated relay destruction even if `pool.end()` fails. Four pure lifecycle tests cover concurrent/repeated close and failed/synchronously thrown shutdown. This fixes a test-cleanup reporting defect, not the historical PG authorization failure.

The runtime role-name/flag probe is not a proof of all role memberships or database ACLs. A production rollout still needs exact role membership, SET ROLE, schema/EXECUTE/table privileges, RLS, supported server version, connection transport/TLS, pool ownership and credential custody review. Do not infer that NOINHERIT alone prevents SET ROLE into an independently granted role.

## Pure attribution of the failed shape

One bounded offline profile retained the exact24/one-archive data and unmodified production source. Warm full bundle validation measured163.940/163.197ms. Matching the full archive back to a native snapshot consumed91.682/90.990ms, of which snapshot construction consumed86.652/85.996ms. Each call constructed19 snapshots and matched row18. All26 validated-record identities were reused by the existing request-local pure validator on fresh copied input.

A script-local pure derived-snapshot memo prototype reduced that matching segment to4.818/5.172ms with19 hits/zero new builds and681,374 retained bytes. This is a **prototype measurement**, not a production change, complete runtime speedup or a32/three-archive pass. It motivates a separately reviewed bounded pure-computation optimization while all fresh authorization, expiry and evidence checks remain mandatory.

Final v677 regressions: adapter26, relay10, wire-pool cleanup4, immutable candidates/generation, smoke20, booking/care/auth guards and shell15 pass. Shell cold2051ms, warm34/22/21ms,64 public files. No production deployment or credentials; long-history and worker gates above remain open.

A concrete launch plan must also resolve routing, not merely accept an API key: the current prepared browser client enforces its configured same-origin contract, while the existing frontend is a static GitHub Pages application and this adapter requires a Node-compatible server. Identify an approved HTTPS origin and an actual routing/hosting arrangement for `/api/design/*`, or separately review a deliberate client/server origin-contract change. Do not silently relax the origin guard, expose database credentials to the frontend, or assume a Deno Edge runtime can execute this Node driver/native-worker composition. No such production routing has been configured here.
