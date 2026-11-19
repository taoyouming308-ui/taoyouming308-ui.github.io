# One prepared workflow runtime

`createPreparedDesignRuntime` in `prepared-runtime.mjs` is the explicit composition root for the prepared browser HTTP path. It returns only `{handle}`, a Fetch Request/Response function. It starts no listener, opens no default database connection, reads no environment credentials, grants no permissions and is disabled by default.

When explicitly configured, it composes the real PostgreSQL executor and repository layer with the existing employee/session checks, prepared intent service, immutable full archive, private media service and HTTP handler. The first authorized workflow load initializes the native record in its scoped database transaction, then reads it through the same service used for subsequent mutations. Client-supplied initial records or identities are not accepted. A failed/uncertain initialization is not permission to reset history.

The private-media wrapper creates a fresh credential closure per request. Metadata publication and source/history reads use the same repository contracts as workflow and archive operations. Original image bytes go through the separately configured private storage protocol and decoder; neither is enabled merely because text workflow is enabled. Storage I/O must remain outside database locks and publication must be rechecked in a short authoritative transaction. Object storage and PostgreSQL are not a distributed transaction: a failed publication can leave an unreadable private orphan requiring a reviewed retention policy.

## Configuration boundaries

Required database dependencies are an exclusive, bounded pg-compatible `acquireClient`, the reviewed lifecycle policy, private schema/role contracts, and exact HTTPS handler origins. The in-repository disposable PostgreSQL harness is test-only, not a production driver or installer. Do not supply its synthetic approval rows to a real service.

Optional media dependencies are `media.enabled`, `approvalVerifier`, approved full `imageInspector`, fixed `storageOrigin` and bounded `storageTransport`. They do not obtain or provision credentials. Optional provider, speech, evidence and key-settings adapters retain their own approvals and ledgers. If absent, the corresponding route fails closed. There is no global key fallback or implicit model selection.

The browser's prepared HTTP client must use a reviewed deployment route. GitHub Pages does not provide an `/api/design` server merely because the JavaScript path exists. The current production Supabase Deno handler has not been modified or deployed; native decoder runtime and PostgreSQL driver/pool compatibility remain deployment review items. Any proxy or explicitly allowed cross-origin destination must be fixed by trusted configuration, never customer/employee free-text input.

## Full archive versus checkpoint

- `/workflow/dispatch` with an `archive` intent records the native workflow checkpoint.
- `/workflow/snapshot` creates a candidate with `saved:false`.
- `/archive/full/load` supplies authoritative history and current version/digest.
- `/archive/full` verifies trusted persisted source state and CAS, appending the full immutable version.

Only the last operation's acknowledged result and scoped readback establish full archive persistence. A timeout stays uncertain. Reuse exact request identity for permitted reconciliation; do not silently generate a fresh request and duplicate a save. Historical authorship remains intact, while current authorization and media activity govern what may be returned now.

See `docs/ai-design-activation-review.md` for consent, permissions, decoder, pilot and release decisions. Local composition and synthetic acceptance are not a production rollout, model accuracy test or authorization for paid/private-data processing.

## Verified local acceptance and remaining uncertainty

The final independent browser run passed 14 cases through this composition root and disposable PostgreSQL: initialization, recreated-runtime readback, lost reply reconciliation, actual AudioWorklet PCM capture and actual ASR adapter, private synthetic image publication/preview, full archive versions, CAS conflict, media/session revocation and simulated BFCache restoration. Provider and Storage transports remained mocked. A test-only fixed HTTPS-to-loopback fetch translation was necessary because Chromium AudioWorklet loading bypassed the Playwright fake-origin route; production HTTPS restrictions were not relaxed. This is not a deployed TLS/CORS or proxy test. The old prepared page passed its 12 original cases independently.

One earlier legacy-executor PG27 run under concurrent suites failed closed on a relationship authorization read. No data exposure or incorrect write was observed. The failure was not reproduced in subsequent repeated serial/concurrent diagnostics or the final independent serial run (27/27), so its cause remains unconfirmed. A bounded opt-in test-only diagnostic mode retains safe hashes/classes/SQLSTATE, not parameters or raw output. Do not label this issue fixed or infer production stability from later passes.
