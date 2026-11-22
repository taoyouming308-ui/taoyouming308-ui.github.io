# Stage40 acceptance (completed locally; not a deployment approval)

Baseline: b7140e92 / v689. Current app shell: v690, 72 explicitly reviewed
public files. Tests use isolated PG17, preinstalled pinned worker images and fixed
synthetic JPEG/WebP. No live object service or model was called.

| Evidence | Result / limit |
|---|---|
| Final new pure aggregate | 190 checks pass (includes preview and rendering fixes) |
| Retained workflow/history/HTTP/provider aggregate | 174 checks pass |
| Preview helper subset | 4 checks pass, included above; old field reference corrected |
| Retained immutable identity/key/ledger | 64 checks pass |
| Public shell, version and release | Pass; feature remains default closed |
| Real restricted PG content pipeline | smoke 4 / full 11 pass |
| Real pinned JPEG worker + isolated PG | 4 pass; actual direct normalization and independent verification |
| Real pinned WebP worker + isolated PG | 4 pass; same two-object path |
| Original runtime + isolated PG model/adoption/archive | 11 pass; mock model and protocol report |
| Full original homepage + real worker + PG | Final 13/13 pass; mock object/model transport |

The above numbers are assertions/checks, not customer cases. The worker evidence
uses two fixed formats of a synthetic reference, not arbitrary hair photos.

The runtime small-history run recorded describe 6.256 s, status 2.226 s, adoption
2.499 s, full archive 5.214 s. Default 30 s was not extended. These timings are not
long-history or real-network/model latency acceptance.

An initial pipeline smoke stopped on Buffer versus Uint8Array prototype comparison;
bytes matched. The fixture assertion was corrected to compare bytes and SHA, with
the original log retained. No SQL permission was loosened. A new candidate helper
still referenced an old native-object field and conservatively rejected the new
shape; it was fixed to use the independently checked direct-input output binding,
with a retained failing test and new substitution negatives.

## Interpretation

- Source storage success does not authorize decoding or external model use.
- Local test approval seams are restricted to exact preregistered synthetic
  requests and issue through separate roles after actual evidence exists. They
  are not shipped permission fallbacks or a production approval workflow.
- The new application-manifest model lane is before-analysis only. Existing other
  lanes/history are preserved, not silently relabelled as new proofs.
- No production readiness, arbitrary-image completeness, native WORM, photo
  backup, live spend cap or resolution of the old intermittent PG failure is claimed.

Final full-page/negative outcomes and final evidence manifest must be appended
before treating this stage as complete.

## First full-page run, retained failure

The original full homepage reached 9 of 13 planned checks: source upload, direct
worker/independent verification, model generation, withheld client responses for all
three, original-ID recovery without repeat writes/work/model, and successful v6
adoption. It then failed when opening the person-confirmation step: the old evidence
renderer did not yet handle the new application summary. The server adoption was
HTTP 200 and persisted; the UI form failed to render. This is a real integration
failure, not a timeout to suppress. Resource cleanup completed; a narrow renderer
fix and full rerun are required. Two misleading static status labels were also
observed in the screenshot and will be corrected without changing authorization.

The rendering fix now has an explicit application-evidence branch and a v6 accepted
record through the original page renderer regression. Unknown evidence kinds no
longer fall into the synthesis-array renderer. The two status labels are corrected.
Final new pure aggregate: 190/190; original full-page rerun remains pending.

## Corrected-render full-page run

The second run passed the 12 product-flow checks, including person confirmation,
native archive, full-v6 publication and processing revocation. Its final audit
assertion failed because the harness assumed localStorage contained one key, while
the complete original host initializes six. The product is not being changed to
satisfy that incorrect isolated-page assumption. The harness must first verify the
original host's exact initialized keys, snapshot them before the design workflow,
then assert unchanged values and absence of workflow/image/proof data afterward.
A third complete run is required; the second result is not reported as 13/13.

## Final original-homepage acceptance

Final unchanged product run passed **13/13**, after an independent no-PG baseline
confirmed the six original-host storage keys. Every key/value stayed exactly equal;
sessionStorage and cookies remained empty. New image/task/candidate data was not
persisted by the browser. No unexpected external request, microphone access,
missing asset or browser error occurred.

The complete original perm-app document and host bridge used the actual immutable
HTTP runtime, restricted PG roles, one actual fixed-JPEG normalization and one
independent PNG verification. Object HTTP and model response remained mocks. There
were exactly two object writes, seven reads, one model send and one mock-key open.
Five independent, bounded synthetic-fixture approval events were recorded. Source,
prepare and model responses were deliberately withheld after server completion;
the original client timed out around 30 seconds and recovered by the same request
ID without repeat object writes, processing, verification or model send. Source
late-result close/customer-switch isolation passed.

Normal server timings: upload 0.315 s; prepare 11.107 s; model describe 6.254 s;
adoption 2.560 s; full archive append 5.386 s. Slowest normal server request was
11.107 s. Full save visible in the UI took 5.777 s. Deliberate client response
withholding waits of 30.075 / 30.050 / 30.165 s are fault injection, not normal
service latency. The 30-second budget is unchanged.

The corrected person-confirmation page, separate confirmation, native archive,
full-v6 server-side command and processing revocation passed. Historical private
proof and new accepted-author bytes remained unchanged through those operations.
This round did **not** create a same-name rehire principal, test cross-epoch regrant,
or rerun migration of preexisting historical authors. Those are not inferred from
customer-switch UI isolation or the earlier malformed-scope negative.

Desktop candidate and archive screenshots were inspected. They show independent
prepare/generate/adopt actions and synthetic/unconfirmed restrictions, with no
manual task field, private locator or full authorization proof. Response-object
privacy assertions also passed. Browser, loopback, worker, PG pools and relays
were cleaned; independent read-only resource checks found no owned remnants.

Final pure aggregates: **190 new + 174 retained workflow + 64 retained identity/
ledger = 428 checks**, not customer cases. Final v690/72-file shell, version,
release, sync and diff gates are required again before commit. All first-failure
logs and screenshots remain preserved alongside the final success evidence.

Key evidence files: application-full-home-storage-audited-final.log,
application-browser-summary.json, application-host-storage-baseline-first.log,
application-runtime-pg-first.log, root-new-pure-final.log,
root-retained-pure-aggregate.log, root-retained-identity-ledger.log.
