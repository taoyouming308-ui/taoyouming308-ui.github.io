# Stage25: bounded durable history and recovery verification

Test-only work on the v680 implementation. No product authorization, SQL capability, TTL, client/worker budget, model, credential, production deployment or system-security configuration changed.

## Normal durable workload

One serial isolated run constructs history through the original HTTP workflow with actual node-postgres runtime and independent worker role connections. It uses six synthetic image references, three accepted comparison candidates, an explicitly confirmed front comparison and a local synthesis. At native16/24/32 it performs enqueue → queued status/list → actual finite worker → completed status/list → candidate load → explicit adoption → native archive → full snapshot append/read. Independent synthetic approval issuance precedes the measured HTTP enqueue; no live model is called.

| Checkpoint | Full archives before | Enqueue | Worker total | Candidate load | Adoption | Full append |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| native16 | 0 | 0.685s | 1.044s | 1.393s | 1.118s | 2.127s |
| native24 | 1 | 1.850s | 1.903s | 3.385s | 2.757s | 4.389s |
| native32 | 2 | 3.645s | 3.086s | 6.396s | 5.191s | 7.924s |

At native32, status requests take0.237–0.432s and list requests0.533–0.764s. All39 measured operations succeed within their original30-second budgets. The last ledger is completed and automatic retries are zero. Each enqueue is separately verified to perform zero key/provider execution;202 is never counted as model completion.

Before the32 checkpoint: workflow31/native32, two full archives, six accepted candidates, six media references,1,796,778-byte captured bundle. After adoption/archive: workflow33/native35, three full archives, seven accepted candidates,2,294,534 bytes. Full archive native revisions are19/27/35. The new run adopts every generated synthesis, unlike the old synchronous benchmark. It is not an identical-content before/after speed comparison. The old synchronous native32/full2 observation of39.185s remains a historical failure, not a repaired old route; opt-in durable mode does not fall back to it.

### Timing validity

Fixed SQL family definitions are shared by classifier and recorder, preventing silently omitted families. All39 cutoff/server-final points report zero discarded observations. HTTP client cutoff and server completion are separate; worker cutoff is the finite pump result and worker server-final additionally waits for its tracked phase promises to settle. Late SQL cannot silently disappear from a final report.

At32 the worker uses five transactions,2.484s summed query await and0.602s outside-query wall time. Its finish phase is1.194s inclusive. Phase totals overlap SQL attribution and must not be added to it; outside-query is not a CPU measurement. Test sealer/transport phases include synthetic transaction-open checks. The provider response is immediate mock data. Actual model latency, production TCP/TLS, concurrent store load and64-record capacity are not established by these figures.

Exact cleanup: runtime22 and worker18 created connections; all relay children, pools (total/idle/waiting), and the labelled disposable container ended at zero/absent. Original history is retained; no bundle is restored into the database to manufacture a passing state.

## Long-history browser interruption case

The first original-entry browser attempt built native32/two full archives and passed default-closed checks, then stopped2/7. Destroying the connection before any headers of an already committed202 led to a second enqueue POST returning202. The test authorizer permits only one new request ID (a second would fail before the runtime), so the duplicate used the same request. The UI test clicked once and the client source has one fetch call, but the run did not preserve measured browser fetch-start counts; browser-stack replay is an evidence-supported inference, not an invented event count.

No worker was started and provider calls were zero. The test did not capture target job/attempt/approval table counts before teardown, so this run alone cannot claim each was one. Existing immutable-keyed queue idempotency remains a code/tested-contract boundary, not a substitute for those missing observations. The failure log and exact cleanup are retained. It is not counted as a successful unknown-result recovery test.

One separately reviewed partial-body attempt passes7/7: actual202 headers are acknowledged before the body stream is cut, producing ERR_CONTENT_LENGTH_MISMATCH and unknown body outcome. Measured App enqueue fetch1, server POST1, one request/operation and one job/attempt/approval/issued receipt. Exact-ID lookup and close/reopen recover the same task. This does not erase the first pre-header retransmission finding.

The slow mock worker aborts at30.003s; separate settlement takes92ms, total30.096s. One provider invocation is observed, no key-open count is claimed for this custom worker. Result is uncertain with no candidate/adoption. Repeated manual reads preserve job/ledger revisions and deadlines; worker transitions legitimately advance execution revisions but do not renew deadlines. Original native32 record and both full archives remain unchanged. The test has no automatic resend, real network/model, microphone or browser credential persistence.

Maximum browser response-header latency is17.649s, including the independent synthetic issuer inside the test server, unlike the separately measured normal enqueue3.645s. Header time is not body-completion time; the intentionally broken body is unknown, not successful. Mobile screenshot was visually reviewed. Final runtime34/worker18 connections, relays and pools are zero; exact disposable container, browser and loopback server are closed. Product retry, permission, TTL and timeout behavior are unchanged.

### Network retry boundary

Application-level no-retry is not a guarantee that a browser, HTTP client or intermediary never retransmits a POST. The durable queue must remain idempotent for the same immutable owner/request/intent. The worker ledger prevents a second application dispatch after uncertainty; it does not prove external provider exactly-once delivery or billing. Live provider transport/proxy configuration must separately be reviewed for retries, redirects and uncertain-send handling before activation.

## Old PostgreSQL intermittent failure

The original Stage7 first legacy append failed during initial authorization before writing; its underlying SQLSTATE was not retained. Successful wire/durable tests cannot identify that earlier psql-path cause.

A fixed-budget, single-run calibration now correlates safe numeric lease/query IDs across query start, error frame, result, timeout and process close, with monotonic time and allowlisted stages/SQLSTATE only. It does not log raw SQL, parameters or error messages. Pure4 and one isolated10-case run (six original setup cases plus four calibrations) pass:

- A new assignment-lock failure is linked to the same query with55P03. Only this negative-control transaction uses a shorter100ms lock wait; defaults and product guards are unchanged.
- A newly introduced lifecycle mismatch is detected independently.
- Termination of the fixture's own connection is identified as process-close.
- Restoration is followed by one successful first legacy append, without replay or retry.

These establish diagnostic discrimination, not the historical root cause. The original intermittent issue remains unresolved and on the release checklist. The permanent unique log preserves the first run and exact labelled-container cleanup.

## Existing image-worker environment review

Only existing connected environments were inspected. The Mac is Darwin; its Docker reports Linux/aarch64, cgroupv2 with cgroupfs and no rootless support. Existing PostgreSQL/Supabase images (including imgproxy) are not an approved implementation of the worker protocol. The connected cloud environment has no container launcher, Docker socket or visible delegated cgroup; its own seccomp/NoNewPrivs status is not proof of per-job isolation.

No qualified existing option was found. No installation, container launch for this review, system-security change, credential or privilege expansion occurred. Actual activation still needs a selected suitable Linux host/runtime, fixed reviewed image, authenticated broker, global admission control and isolation negative tests. These cannot be replaced by weakening the current checks.

## Reproduction and evidence preservation

Run the long-history and browser scripts serially, never against production. The normal workload refuses to overwrite its existing summary/bundle; preserve completed evidence before any separately authorized new run. The browser keeps separate first-failure and corrected-attempt logs. Results below are not a guarantee of arbitrary history size or live-provider timing. Current final pure coverage: metrics9, classifier8, legacy diagnostics4, worker57; smoke20 and shell-build/auth guards pass. Independent read-only review found no confirmed new blocker, and emphasized separating the normal headless-wire completion from the browser fault scenario.
