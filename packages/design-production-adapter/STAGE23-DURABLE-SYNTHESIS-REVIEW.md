# Stage23: proof projection and durable synthesis preparation

Status: offline review candidate. Production remains disabled. This document is not a deployment approval.

## Preserved safety invariants

- Each proof read executes the existing complete database source/authority/manifest checks. Only repeated bundle transfer and JavaScript structural replay can be avoided. No caller hash, head-only hash, session-wide authorization cache or weaker SQL source scan is substituted.
- The first request read and each task resumption must validate a full bundle. Request-local structural reuse requires exact authority, whole source fingerprint and whole manifest equality. Time-dependent candidate acceptance and expiry are not structural facts.
- Durable synthesis is a separate explicit server flag. It does not enable production routing, employee onboarding, model credentials, real private media or a paid transport. In durable mode the old synchronous synthesis HTTP route is closed; other existing synchronous operations retain their prior behavior.
- An enqueue request contains only scope, original request ID and chosen side. The server constructs exact synthesis evidence and the existing prompt body, verifies the independently issued original approval, and does not open a personal key or invoke a model during preparation.
- The new PostgreSQL scheduler must reserve the **existing** request ledger and job atomically. It must not persist the employee bearer token, create a second payment ledger, renew an approval or candidate TTL, or turn an unknown receipt into a resend instruction.
- Metadata reads must reauthorize the current immutable employee and original job scope in SQL. An operation ID is not a credential. They do not require JavaScript full-history reconstruction merely to display status.
- After dispatch is claimed, cancellation can withhold delivery but cannot promise no external bytes, no cost or a refund. A lost claim/completion acknowledgment is not safe to retry externally.
- Published candidate, adopted suggestion and explicit employee confirmation remain separate. Existing original statements and append-only authors/history remain intact.

## Implemented preparation boundaries

`durable-synthesis-preparation.mjs` checks exact source/evidence/model/body/approval binding and rechecks source after preparation. It has no provider transport or secret-opening dependency. `http-handler.mjs` has fixed enqueue/status/lookup/list/cancel routes, strict request/result schemas, 202 only after a successful durable adapter return, bounded output and safe error projection.

`immutable-generation-runtime.mjs` forwards opt-in `proofReadsEnabled` and `generation.durableSynthesisEnabled`. Metadata routes independently authenticate before/after their fixed SQL repository operation; enqueue additionally uses the original full source validation. No runtime listener or production option is configured by these factories.

The isolated SQL draft is not an installable production migration. A new worker capability requires a separately reviewed actual-host deployment and least-privilege approval. Worker/provider execution and candidate publication must be individually tested before claiming a full asynchronous model pipeline.

## Verification record

- Proof/capability/TTL pure 48 and actual restricted-role PostgreSQL proof 7 pass. First PG attempt stopped because a test tried to lower a monotonic security epoch during cleanup; the guard correctly refused. Only that invalid cleanup was removed, not the guard. Both failed and corrected logs are retained.
- Server enqueue preparation 8, HTTP boundary 10, immutable generation runtime 21 pass. HTTP rejects forged disclosure fields and reconstructs safe error codes even from mutated Error instances. Metadata route tests confirm no JavaScript full-bundle traversal, but fixed SQL still performs authorization.
- Frontend durable pure19 plus existing client/candidate/synthesis46 pass. Final original-homepage browser10 passes with mocked HTTP only; publication, ID-only adoption and confirmation remain distinct. The task list is explicitly labelled a last-query snapshot. Chromium/context cleanup verified. Static shell15 passes with65 explicit public assets; no server modules enter the cache.
- Retained dependency, generation, derived snapshot and real-driver pure suites passed. App smoke20, care, task-state31, archive2205-row pagination and auth regressions passed. Existing system Python with cryptography48 passed42 booking/keepalive/customer tests; default Homebrew Python lacked that dependency, no package or system setting was changed.

### Final-security synchronous long-history observation

All timeouts remain unchanged at30 seconds. Existing actual pg wire, network-none synthetic fixture and original HTTP workflow generated the records; this is not production TCP/TLS or a real provider benchmark.

| Native history / existing full archives | First synthesis | Same-ID replay | Outcome |
| --- | ---: | ---: | --- |
|16 / 0|9.740s|6.934s|Pass under30s|
|24 / 1|19.508s|15.568s|Pass under30s; second distinct full archive appended|
|32 / 2|client30.003s / server39.185s|Not attempted|FAIL; server200 and ledger completed, exactly one provider/key use, zero automatic retries|

The planned third full archive and64-record workload remain unaccepted. The final synthetic bundle has34 workflow rows, native revision32, two full archives and1501056 bytes. Exact relay/pool/container cleanup verified.

The final-security timing run loaded a metric whitelist which omitted the newly separated proof family. Its wall times, transaction/provider counts and outcomes above are valid; its query-await/outside-query totals are **incomplete and must not be presented as SQL-versus-CPU attribution**. The whitelist was corrected and a dedicated pure regression added. The earlier pre-clock-fix diagnostic is retained separately, not labelled final security acceptance. No log values were reconstructed.

Raw synthetic-only evidence is stored outside the publicly served repository. No performance pass is inferred from HTTP202.

## Existing unresolved pre-live gates

- Historical intermittent PostgreSQL authorization failure remains unlocated; newer successful isolated regressions do not establish its cause or cure.
- The last accepted Stage22 long-history request exceeded the unchanged 30-second client budget. Stage23 performance must be measured with the final security checks and disclose the longest accepted workload.
- A qualified controlled Linux image worker, approved Node service host, same-origin HTTPS routing/TLS, concrete role grants and secret custody are not provisioned.
- Real provider quality, customer data-processing consent and personal billing have not been tested. No personal API key is needed for synthetic acceptance.

## Deploy-time decisions, not actions taken

A future activation request must identify the actual hosting account/region, approved database target, same-origin HTTPS route, and concrete restricted runtime/worker role changes. The proposed new proof EXECUTE and fixed worker functions are additional database capabilities, not implied by possession of a model API key. No such production changes are performed here.

The trusted Node worker must validate a candidate using the existing complete pure validators and fixed synthesis builders before publication. SQL binding checks and a self-computed digest alone do not prove that a compromised worker produced honest explanatory text. A worker is not given approval issuance, personal key-settings mutation, arbitrary employee impersonation or direct table privileges; this does not make it an untrusted semantic validator. The execution runner and secret-opening boundary must be reviewed before activation.

Existing approval expiry and 60-second candidate TTL stay unchanged. A later decision to retain/read model results after the original approval expires needs its own explicit contract; neither a queued job nor heartbeat grants that permission. The guarantee is fresh checks at the final validation point, not an absolute authorization-at-physical-COMMIT or network-arrival guarantee.

The selected image decoder remains a separate deployment gate. A generic scheduler worker is not evidence that the controlled Linux image worker is qualified.

## Exact remaining implementation work

1. Connect a real `pg.Pool` worker lease adapter with the exact independent worker role. The existing trusted pool adapter deliberately only accepts `design_identity_runtime`; it must not be silently reused or loosened to accept arbitrary roles. Current worker SQL tests use restricted real PostgreSQL fixture connections.
2. Add a bounded worker runner and fixed job-bound personal-key access facade. It must not emulate an employee by saving/reusing bearer tokens. Recheck job fence, original session, immutable identity, source, key and approval around key opening and the single dispatch claim; external I/O stays outside transactions. Parse and validate the original model response through existing builders before same-transaction publication. This is **not connected in this stage**.
3. Verify runtime-process interruption, durable recovery and long-history queued end-to-end behavior with the actual worker adapter and mocked provider. Recreating a runtime object or opening a new database connection is not a process-restart test. Unknown dispatch remains non-resendable.
4. Only after isolated readiness, request concrete production-host/role/routing approvals and offer the secure personal-key settings entry. No key is needed in chat or for the present synthetic tests.


## Final isolated queue acceptance

Real PostgreSQL final21 passed with an actual restricted non-owner worker LOGIN. Coverage includes original HTTP source/media/comparison/adoption seeding; atomic original-ledger enqueue; read-only metadata and new-runtime/new-connection recovery; cancellation and old-route/ledger/publication bypass denial; bounded admission and concurrent same-ID reservation; pre-dispatch fence replacement; lost enqueue/dispatch COMMIT responses; no automatic resend; original approval/source/epoch revocation and same-scope checks; candidate revocation and actual waiting for the unchanged60-second TTL; exact external runner result metadata; invalid semantic candidate rollback; stale-source list recovery and reduction-only cancellation; no bearer stored or caller-GUC authority.

The worker completion calls in this suite are deliberate fixed repository calls using synthetic candidates, not a running model worker. The production-pool worker path, real model call and whole browser→queue→worker integration remain the exact work listed above.

Important repair evidence retained:
- Initial smoke used an unconfirmed synthetic angle while expecting deterministic synthesis; only a normal explicit confirmation step was added to the fixture.
- Initial enqueue tried to import the issuer's five-field receipt projection directly as the runtime approval record. It now constructs the existing exact runtime record fields without changing receipt authority, content or expiry.
- A new restrictive completed-result SELECT policy initially also denied the UPDATE's uncommitted completed row before the job state advanced. Diagnostics confirmed42501/RLS_NEW_ROW. The exception is now only the independent worker's protected current backend/transaction/fence/action=finish context after fresh authority checking. Ordinary/old-runtime readers still require a completed, unexpired, non-cancelled job. The corrected full21 suite passed.
- Cancel no longer requires old source content to remain unchanged: it requires the same complete current immutable owner/scope and only reduces future permission. It does not retract a separately published artifact or adopted history.
- List scans at most20 original-owner/scope jobs, skips only the fixed stale-source denial, and fails closed on other errors. It returns currently authorized recovery entries, not all historical jobs.
- A bounded claim can retire up to8 invalid pre-dispatch jobs. An original pending ledger row may remain as a permanent non-dispatchable tombstone when revocation prevents a ledger settlement. This is not a completed or billed result; old capabilities and terminal-state guards cannot revive it. Already-claimed dispatch is never reclaimed for an automatic send.

The diagnostic RLS run briefly overlapped final UI/cache testing due to queued tool-start messages. It is not used for timing claims; final full21 ran alone. The cache check is correctness evidence only. No production authorization was expanded.

Proof and durable flags were additionally enabled together in a separate actual-PG smoke6: all passed,410 fixed proof reads observed, exact fixture cleanup verified. Only the test harness gained this explicit option; implementation/permissions did not change after final21. These small-history queue timings are not a long-history or real-provider latency guarantee.
