# Stage 22 bounded pure snapshot reuse (verified narrow optimization; long-history budget still blocked)

This follows the real-driver checkpoint8852657e/v677. Production remains disabled; no new credentials, customer data, permissions, fees or deployment are involved. The Stage21 native24/one-full-archive request timed out at the unchanged30-second client deadline and eventually returned at67.774 seconds. That failed workload is the baseline, not an accepted long-history limit.

## Narrow implementation

A module-private derived-snapshot factory first calls the original record validator on every fresh input. Only that validator's deeply frozen returned object can key the memo; callers cannot provide a digest, brand, authorization flag or cache key. Snapshot creation remains deterministic pure computation. The existing request-local record validator is unchanged.

Each `bridge.runRequest` creates a distinct memo, capped at64 entries and16MiB counting retained record and snapshot bytes, cleared in finally. This is a serialized memo-retention budget, not a bound on total request heap: input copies, temporary validated-record handles and other work still allocate memory. Nested/concurrent scopes do not share entries. A handle escaped past its request or used in another scope cannot access its former memo and recomputes pure data. Deep data-descriptor/proxy/mutability checks prevent serialization hooks from becoming a validation shortcut.

The repository still checks every fresh bundle, immutable authority, scope/store, record and previous hashes, receipts/authors, source/media/candidate state, manifest expiry, native replay, complete full chain and exact snapshot comparison. Matching order and comparison count are unchanged; no SQL call, authorization decision, clock result, mutable input, bundle or permission result is cached. There is no new cross-request retention or hash-only equality assumption.

## Verified pure results

On the exact authorized synthetic24-native/one-full archive input:

- Warm complete validation163.940/163.197ms →77.186/76.451ms.
- Matching91.682/90.990ms →4.926/4.805ms.
- Warm snapshot construction19 →0; exact comparisons remain19, matching row18.
- All26 validated records and original input bytes/hashes are retained. Cold validation remains approximately356ms.

New helper/bundle tests19/19 and retained dependency/runtime/record-memo tests42/42 pass. They cover fresh changes/tampering, expiry, different scope/author, quotas, escaped handles, late work, and nested/concurrent request scopes. Independent code review found no confirmed authorization or comparison-semantic gap.

This pure benchmark does not prove the complete HTTP path meets30 seconds. Real-driver full regression and the unchanged16/24/32 history workload must be measured separately; no timer increase or automatic retry is permitted.

## Actual-driver result: improvement, still blocked

The unchanged full candidate/provider safety regression passed21/21, including636 canonical-equivalence cases and exact cleanup. The long-history run still stopped at native24/workflow25 with one full archive:

- Client cutoff30.059s: `HTTP_OUTCOME_UNCERTAIN`; no automatic retry.
- Original server final43.369s: HTTP200, ledger `completed`, one mock provider/key call.
- Final complete statistics:151 BEGIN/151 COMMIT,1,848 queries, query await20.870s, outside-query22.499s.
-241 dependency-bundle reads consumed16.901s of measured query await, approximately81%. This includes driver/relay/transfer/parse and server work, not isolated database CPU.

The comparable server duration improved from67.774s to43.369s (about36%), without fewer transactions or queries. The cutoff snapshot (115 transactions/query await15.005s) is explicitly separate and must not replace the final totals. Native32/three full archives and64 were not tested because the first unchanged30-second budget failure stopped workload growth. The original request was awaited to a known state and all runtime/relay/Pool/container resources were exactly cleaned; completed ledger status does not retroactively turn the client's timeout into a delivered success.

The16-native checkpoint still succeeded: synthesis15.771s, replay15.311s, full append3.323s. These synthetic cases do not establish real provider latency or a production SLA.

## Remaining engineering decision, not an implemented shortcut

Further work should review both a durable operation/status contract and excessive complete-history transfer/validation. A durable job could acknowledge acceptance and expose authenticated, scoped status/result reads instead of leaving a synchronous page request waiting. It must preserve one request identity, no implicit paid retry, exact independent disclosure/cost approval, fresh checks before dispatch and result delivery, explicit cancellation semantics, and recovery after uncertain commit. Already dispatched bytes/cost cannot be recalled by client timeout.

Separately, examine whether immutable structural history can be checked once against a fresh server-verifiable content binding while current identity, service relationship, manifest expiry, media/candidate state and final write guards remain freshly enforced. Any minimal-proof/read optimization needs a precise threat model, authoritative fixed SQL capabilities, change/revocation/expiry/concurrency tests and audit of which facts are immutable versus time-dependent. A caller hash, cached grant or old successful read is not authority. No such optimization, durable worker, new grant or queue has been implemented or approved for production here.

Neither asynchronous UI nor a larger timeout fixes unbounded backend history cost. Capacity, memory and admitted concurrent work must still be bounded and measured. The historical PG intermittency, worker qualification and production hosting/TLS/ACL/credential gates remain separate blockers.

## Final security and regression coverage

The unchanged dependency-authority PostgreSQL suite passed21/21 after the memo change: full-source/full-archive checks, manifest revoke/regrant, same-name membership replacement, original author/byte preservation, media-revoked full-read denial, CAS and uncertain commits. All fixtures and relay processes were cleaned. New request-metric tests5/5 ensure client cutoff and final server statistics are independent, frozen and correctly scoped.

Final pure regressions passed: derived memo/bundle19, request metrics5, dependency-authority, immutable generation, actual-driver adapter/relay, App smoke20, booking UI, monthly care and store-login isolation. These safety passes do not change the failed long-history budget above.

The final v678 App-shell browser returned15 passing checks and exit0. No latency numbers are claimed for that final run here: its transient `/tmp` text log was no longer present when the final record was assembled. Several earlier transient text logs were likewise absent; successful tool results and the preserved numerical/shape summaries above remain the evidence actually observed. The Stage22 long-history JSON summary and synthetic bundle were copied into a task-specific local evidence directory. Missing raw logs are not recreated or described as available.
