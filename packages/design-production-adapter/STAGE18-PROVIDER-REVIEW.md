# Stage18 immutable provider/browser review

Baseline cb4f458f / v673. Read-only interface review plus implemented and executed synthetic harness.
The results below distinguish the failed first browser run from the completed corrected run. No production issuer,
secret, model, account or data is configured. Legacy identity is not inferred from
username/store and no old key/approval/attempt is inherited automatically.

## Integration constraint found in actual code

`createImmutablePreparedDesignKeySettings.withProviderKey` currently awaits its
callback inside `repository.withIdentityLock`. The existing runner callback covers
fresh permission/policy transactions and the entire external transport. The actual
key repository sets a 10-second idle-in-transaction timeout, while the runner permits
30-second transport waits. It also holds identity/session SHARE locks and a key-slot
advisory lock. Directly replacing the mock resolver with this callback can block
revocation and fail slow calls. Do not solve this by raising timeouts.

The new immutable-provider-request-facade now reads a key/version/identity snapshot
in a short transaction and closes it before sealer/transport work. Its fixed policy
claim performs final key/source/authority/approval checks; the runner has no awaited
operation between successful claim and transport invocation. This avoids using the
older withProviderKey callback across external I/O. The callback-lock observation is from static implementation review; the separate
browser result below exercises the corrected new facade. No check can revoke an
already sent request. Secret lifetime is bounded application memory, not secure erasure.

## Reuse existing contracts, not a parallel approval demo

The durable policy's forRequest binds full immutable authority and requestId, checks
exact disclosure via intentResolver, and exposes processingGate plus attemptStore.
The owner key is immutable; runner legacy key/fingerprint are compatibility bindings,
not ownership proof. Independent issuer evidence must match recipient/model/body hash,
data kinds/purpose/source refs and explicit cost. A model-approved flag is insufficient.

Keep pending → dispatch_claimed → completed/uncertain tombstones durable. Unknown
reserve/claim/settle/COMMIT outcomes never trigger a replacement request or automatic
paid retry. Completed replay must freshly authorize without opening a key or calling
transport. The new facade conservatively also requires the same live key configuration,
source and approval: key revocation/rotation denies completed replay even though no
key is decrypted for that replay. Deterministic/model synthesis remains closed in this
new runtime; previous legacy-mode tests are not new-mode coverage.

New-mode generation was closed in Stage17. Enable only routes whose identity/key,
policy, source validation, publication and return checks are all wired. Speech output
is an unconfirmed transcript; source creation and later confirmation remain separate
explicit employee actions. Private storage permission is not external processing
permission. No generic executeSQL or browser-supplied authority/model/endpoint.

## Implemented browser harness and completed execution

Owned file: `scripts/test-design-immutable-browser.mjs`, syntax-checked and passed 12/12 after the fixture correction below. The
original synthesis regression is unchanged. The harness uses the actual perm-app
homepage bridge, app-entry, prepared controller/http-client and recorder, with fixed
immutable runtime and real isolated PG non-owner access through the shared fixture.
Independent synthetic issuer connections authorize only the two planned test requests;
the application runtime does not issue its own approval.

The twelve implemented assertions cover:

1. Homepage is disabled without trusted activation.
2. Real immutable list/resolve offers two same-name customers and opens booking 101.
3. One synthetic photo traverses decode, mock immutable storage protocol, metadata
   publication and explicit workflow attachment.
4. Browser-generated oscillator audio becomes bounded PCM and reaches the real ASR
   adapter/key/policy path; no microphone request or automatic workflow write.
5. Employee explicitly adopts the unconfirmed transcript as a speech source.
6. Text extraction plus deliberately lost candidate readback retries only the read.
7. Runtime reconstruction and exact request replay retain one chat transport call.
8. ID-only candidate acceptance preserves quoted human source and unconfirmed status.
9. Complete archive publication retains the photo and accepted candidate provenance.
10. A reconstructed runtime reads back the exact saved full-version object.
11. Explicit reopen succeeds without rewriting that archived version.
12. Default 30-second generation/ASR client budget, no external traffic, browser secret
    storage or automatic paid retry. Browser and exact fixture cleanup run in finally.

The helper initializes separate synthetic chat and ASR slots, but this browser script
**does not test** key rotation/revocation, same-name employee replacement, customer or
employee switch during an in-flight response, late-response handling, rejected/expired
approval, unknown COMMIT, concurrent claims, explicit entry confirmation, preview URL
lifecycle, or technical plan-versus-actual preservation. Those need separately named
unit/PG tests; no legacy-mode result is credited to this new browser harness. It also
does not claim a real microphone, production issuer, pricing or provider validation.

Root owns serial test slots. This reviewer ran the new browser chain, not the separate
provider PG suite; those PG assertions belong to its author/root report.

## Cost and current prepared harness scope

`cost.maximumMinorUnits` binds what was approved. It is not an implemented provider
billing cap or proof of actual pricing. Before any production activation, pricing and
request budgets must be verified to meet that limit. The ledger proves a single
claim/no automatic resend, not that the provider cannot charge or exceed an estimate.

The new harness passed 12/12 with exit 0 and verified cleanup. It uses actual
homepage modules with the immutable generation runtime, independent test-issuer
receipts and synthetic oscillator audio (not a real microphone). It covers chat text
and ASR only; image comparison/vision/synthesis stay closed. Default client timeout is
30 seconds. Browser timing includes test issuer setup before forwarding the request;
separate runtimeMs reports application handling alone, without conflating the two.
The independent v674 app-shell run passed 15 assertions (cold 2048 ms, warm 39/21/20 ms)
and cleaned up. That shell run does not validate this new immutable provider chain.

## Actual runs and measured boundaries

- First browser run stopped at 3/12: synthetic record-stop stayed disabled before any
  ASR request. Browser and exact PG fixture cleaned. Log:
  `/tmp/stage18-immutable-browser.log`. This failure was not a provider timeout.
- One no-PG diagnostic compared the same recorder/worklet code. Virtual HTTPS routing
  left addModule pending despite a running source AudioContext; real loopback static
  serving completed module load and start. Both browser contexts/server cleaned. Log:
  `/tmp/stage18-audio-diagnostic.log`.
- Fixture-only correction reused the existing unified-test loopback static server and
  fixed HTTPS backend transport shim. No product HTTPS checks, microphone permissions,
  source code, or client timeout were relaxed. No Blob worklet replacement.
- Corrected full run passed 12/12, exit 0; one chat and one ASR mock transport call.
  Log: `/tmp/stage18-immutable-browser-loopback.log`. Default client budget: 30000 ms.

| Operation | Browser headers ms | Runtime handler ms |
| --- | ---: | ---: |
| ASR | 2907.2 | 2663 |
| Text extraction | 5809.1 | 5401 |
| Same-request replay after runtime reconstruction | 4463.1 | 4459 |
| Candidate readback retry | 1054.1 | 1049 |
| Complete archive publication | 1003.2 | 998 |

One deliberately lost candidate readback produced the expected fetch failure, followed
by read-only retry without generation. Final cleanup awaited browser.close, all active
requests, exact isolated PG fixture cleanup and loopback server close. This small
synthetic workflow is not a production latency/load guarantee or the larger legacy
synthesis performance scenario. The explicit omissions above remain untested here.
