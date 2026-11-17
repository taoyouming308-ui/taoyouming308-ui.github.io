# Stage19 immutable image/synthesis integration review

Baseline 255050ca. Review and isolated browser evidence, not production certification. No real photos, microphone, keys, provider calls,
fees or production changes. Stage18 regression remains unchanged.

## Existing contracts that must remain exact

Stage18 provider context and intent are intentionally text/ASR-only: sourceRefs are
empty, candidate ownership lookup assumes text_extraction, and external intent binds
immutable authority, current workflow/session and key version. Extending only the
route or dataKinds would not migrate image/ancestor ownership. New context must derive
the candidate kind/ID and authoritative dependency graph on the server.

Visual description is before_analysis only, model/image_description, not a measurement
or human quotation. Comparison is completed_review, two different original IDs in
ordered before/after stages with the same explicit front/back/left/right angle. It
writes four independent comparison fields, never human observed_result. All outputs
remain bounded candidates pending explicit employee adoption; adoption is not employee
confirmation and pictures cannot establish chemistry, procedure or causal success.

Synthesis reads immutable accepted per-angle AI judgments, not six images again. It
requires explicit left or right, current visible accepted ancestors and exact original
references/receipts. Missing/uncomparable/conflicting views remain server-computed.
Local deterministic mode must require no key, paid approval or transport; model mode
only selects an applicable review focus. Both modes must share the immutable request
namespace so same-ID mode changes conflict, including after process reconstruction.

## Three distinct approvals

1. Private storage/read approval permits only that original media operation.
2. Before derivative preparation, separate exact data-processing approval binds the
   immutable actor, current scope/session, ordered original IDs/hashes, local recipient
   and purpose. It cannot pretend to approve an as-yet unknown derivative/body hash.
3. Before external dispatch, independently issued approval binds original and derivative
   hashes, actual exact request body/bytes, recipient/model, purpose and explicit cost.
   Missing any step rejects before its corresponding processing or transport.

A boolean metadataRemoved is not production sanitization evidence. Synthetic fixtures
may allow only fixed known image hashes and checked PNG derivatives. Real worker
isolation and metadata stripping remain independently unimplemented/unapproved unless
proven. Browser URL/bytes/candidate JSON cannot replace server-loaded original sources.

The final fixed claim must freshly cover live identity, key, originals, candidate
ownership and ancestors after all earlier awaited gates. Do not reintroduce the prior
media/ancestor-before-later-await revocation window or hold PG locks across transport.
Unknown claim/settlement/publication remains uncertain without a new paid request.
Consumed-history TTL/ancestor exceptions must be selected by stored consumption,
not a caller flag; first acceptance/postcommit remains stricter.

## Planned separate actual-UI acceptance scope

The runtime/contracts and shared fixture were frozen before the single complete
new browser run. Do not alter test-design-immutable-browser.mjs (Stage18) or the original
synthesis browser. Reuse actual homepage picker, prepared app-entry/controller/client,
fixed immutable runtime and independent synthetic issuer connections.

A useful minimal end-to-end chain is: attach synthetic before photo; describe/adopt
without confirm; attach all three explicit before/after angle pairs; compare and adopt
front; deterministic missing-view synthesis with zero model/key calls; add opposing
back and uncomparable explicit side comparisons; model focus synthesis; explicit
adopt distinct from confirm; full archive/reconstruct/exact reload. Assertions must
show human notes and per-angle cards survive, never imply unseen angles or success.

Before spending browser time, pure/PG tests should cover wrong source/derivative hash,
changed ordering/stage/angle, revoked original/ancestor/key/approval, same-name rehiring,
source changes between preparation/claim/return, deterministic/model ID collisions,
unknown result and exact replay. The eventual browser document must list only actually
implemented assertions; do not credit old-mode regressions to the new mode.

## Performance and harness constraints

The legacy representative chain had six photo refs, three accepted comparisons and
prior archives/local synthesis. Earlier full-history repetition made generation exceed
30 seconds. A small text/ASR workflow does not establish this larger-chain budget.
Measure headers and handler wall time separately at equivalent workflow revision and
archive depth; record provider calls and fresh query/transaction counts if available.
No timeout increase, live permission cache, skipped history or shortened source chain.

Use the established loopback static server if AudioWorklet is involved: virtual HTTPS
Playwright routes previously left addModule pending, while actual local static serving
loaded the same worklet. This is a synthetic transport shim only; production HTTPS
requirements and microphone permissions stay unchanged. Keep client timeout 30000 ms,
stop the first failed complete run, preserve logs, and verify exact fixture/browser
cleanup before another worker uses the serial slot.

cost.maximumMinorUnits is approval content, not a provider hard billing cap. This
stage cannot demonstrate real pricing, production issuance/deployment, actual models,
full identity migration of unrelated routes, or a production Linux derivative worker.

## Official format reference and configuration boundary

Root checked the official documentation on 2026-11-16:
- https://api-docs.deepseek.com/guides/vision/
- https://api-docs.deepseek.com/api/create-chat-completion/

These support the reviewed inline image_url/data-URL chat message format and standard
choices[0].message.content response envelope. Stage19 remains narrower: checked PNG
inline synthetic content only, no public image URL or Files API. Documentation support
is not approval to select a real model, transmit actual content or incur charges.
Explicit server model configuration and exact independent price/cost approval remain
required. Preserve the existing applicable-focus rule for deterministic versus model
synthesis; missing views alone do not make every synthesis deterministic.

## Harness implementation and scope

`scripts/test-design-immutable-visual-browser.mjs` is written, syntax-checked and passed its single full run.
It reuses the actual homepage/immutable visit runtime, shared Stage19 fixture, private
media approvals and separate processing/external receipts. Twelve assertions
exercise before visual adoption; six original refs across front/back/left; three
comparisons; a separate employee confirmation; deterministic and model synthesis;
readback-only retry; same-request durable replay; six accepted candidates; one full
archive and exact reload. Provider/key counters remained five each.

This reviewer ran the browser chain, not the separately owned PG suite. This harness does not
cover new-mode rehire, revocation races, wrong derivative hashes or unknown COMMIT;
these require the separately owned pure/PG suites. It does not test a long multiarchive
history. The measured scale below is not generalized to larger histories.
The v675 app-shell run passed 15/15 (cold 2017 ms, warm 36/21/19 ms) and cleaned up;
that result covers only the static shell, not the new image/synthesis chain.

## Final isolated browser result

Single full run: 12/12, exit 0. Log:
`/tmp/stage19-immutable-visual-browser.log`. Default client timeout stayed 30000 ms.
No assertion/time-budget relaxation or automatic retry was used.

| Operation | Browser response-header seconds |
| --- | ---: |
| Before visual description | 8.465 |
| Front comparison | 17.269 |
| Back comparison | 24.418 |
| Left comparison | 27.440 |
| Deterministic missing-view synthesis | 9.929 |
| Model three-view synthesis | 28.398 |
| Same-request synthesis replay after runtime reconstruction | 22.232 |
| Full archive publication | 6.726 |

Measured pre-archive accepted record: workflow revision 17, native session revision 18,
six original photo refs, six accepted candidates (one visual, three comparisons, local
and model synthesis), then one full archive. Front comparison had a separate explicit
employee confirmation; final synthesis remained not_confirmed. Provider/key-open
counts were five each and derivative count seven. Deterministic synthesis increased
neither provider nor key counts. Deliberately lost candidate readback was recovered
by a read-only retry, not generation. Full version was equal after runtime recreation.

The slowest headers left only about **1.602 seconds** below the default 30-second
limit. This is a successful bounded synthetic case, not substantial headroom, a long
multiarchive history guarantee, load-test result, or production SLA. Browser timings
include independent synthetic issuer preparation; handler timings in the same log
exclude that preparation. Production pricing/quality, worker isolation and deployment
remain unvalidated. Browser, exact isolated PG fixture, in-flight requests and local
static server were all awaited/cleaned before the serial slot was released.
