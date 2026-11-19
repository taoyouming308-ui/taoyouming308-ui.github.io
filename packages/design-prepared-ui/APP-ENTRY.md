# Existing App entry and read-only format compatibility

Stage8 adds a narrow extension at the existing `perm-app.html` homepage and its **single** `mountCustomerDesignArchive()` wrapper. That wrapper is already shared by appointment dialogs, the hair-form archive link and customer profile details. It keeps the original `CustomerDesignArchive.mount()` and its legacy writer unchanged, then adds a separate read-only full-format lane. The old offline synthetic pilot remains available as “离线模拟体验”. No customer form, finance, scheduling or existing legacy RPC is replaced.

The new homepage anchor uses `packages/design-prepared-ui/app-entry.mjs` and opens the **same** `mountPreparedHttpDesign()` / `mountPreparedDesign()` in a modal. There is no copied workflow or new parallel page. If the module cannot load, its ordinary link opens the existing default-closed prepared page. The existing prepared standalone entry remains useful for direct acceptance. The shared `archive-view.mjs` renderer is used in both the prepared archive step and the old archive entry.

## Default is closed

The shipped module calls `installPreparedAppBridge()` without enabling anything. It displays the default-closed prepared screen; it does not request a customer list, employee token, private photo, model, speech service or backend history. There is no activation through query parameters, localStorage, DOM attributes or an end-user URL field.

A future reviewed application composition must explicitly import and call:

```js
installPreparedAppBridge({
  enabled: true,
  // By default, use the App's function-only PreparedDesignHost bridge.
  // An explicit credentialProvider remains available for reviewed compositions.
  http: { /* same-origin HTTPS; no stored keys or query activation */ },
  // Optional independently approved capture/media adapters remain disabled.
  recording: {enabled: false},
  previews: {enabled: false},
});
```

This is trusted application configuration, **not an authorization grant**. Each HTTP operation still authenticates and resolves the current server-side employee/store/service binding. Production routing, schema installation, session/consent integration and activation remain unperformed. GitHub Pages alone has no `/api/design` service; an API key or flag is not enough to enable the workflow.

## Exact visit location, not identity inference

The default bridge accepts an explicit positive booking ID or explicit `frontdesk:<UUID>` locator and calls the fixed `POST /api/design/visit/resolve` with `{visit:{assignmentSource,visitId}}`. The backend must return a freshly authorized `{scope}`. Browser `phone`, `name`, `customerId`, current date, caller actor and free-form scope are never used to infer a visit. A customer profile that has no unique visit displays a message to open the associated appointment. The homepage now reads the authorized list for an explicit business date, then resolves a selected exact visit. It never guesses from a browser customer profile.

A reviewed host may still inject `resolveCustomers(locator)` for an explicit legacy visit locator. It is not a homepage list provider, cannot replace the server's list-selection binding check and does not authorize later workflow calls.

## Old and new are readable, not semantically interchangeable

- The prepared UI shows `record.legacyVersions`, imported by the authoritative repository from real legacy-version storage, as read-only old-format records. Original authors, version/parent identifiers and snapshot fields remain intact.
- The old archive entry resolves the exact visit, then calls only `/api/design/archive/full/load`. It does **not** initialize a workflow, dispatch an event, save an archive, issue a legacy write or automatically fetch photo bytes. The existing legacy component continues showing its original history separately.
- The shared reader exposes old baseline/optimized/eight-step notes/reasons/execution/process/review/photo references, full native sources, multiple groups, side, planned/actual tracks, confirmation status, native checkpoints and the complete original version structure. Full-format snapshots retain their independent lanes and parent history. Nothing is flattened into old `process`, `execution`, or notes fields.
- Structured summaries are convenience views. Each version includes a lazy, exact JSON text view of **every** returned field, including unfamiliar provenance lanes. No field is discarded or reverse-mapped. This is not a promise that the old schema can losslessly accept a new version for editing.
- Original quotations and exact views use `textContent`, never source HTML. Photo references are text metadata; URLs are not turned into links or images. No signed URLs, credentials, storage paths or bytes are manufactured. The server continues minimizing what is returned.
- Version digest display is an integrity indicator, not a signature, consent receipt or authorization proof.

Reading is explicit, bounded by the existing client/server history budgets and never automatically retried. The read button is disabled while pending. Destroy, switching archive contexts, page suspension and reinstalling the bridge invalidate late replies and clear displayed new-format history. Back/forward restoration does not resurrect that cached history; a fresh explicit read reauthorizes. The prepared workflow's own suspension/restoration behavior remains unchanged. Modal close warns before discarding local drafts or pending identities and cleans up the same controller/media lifecycle.

## Acceptance

- `node --test scripts/test-design-app-entry.mjs scripts/test-design-app-visits.mjs`
- `node scripts/test-design-home-visits-browser.mjs`
- `node scripts/test-design-app-entry-browser.mjs`
- Existing `test-design-prepared-browser.mjs` and `test-customer-design-integration-browser.cjs` remain required regressions.

The App-entry browser harness uses the **actual homepage anchors and actual shared wrapper extracted from `perm-app.html`**, the original legacy component, the same prepared module and the actual HTTP composition root with an isolated PostgreSQL fixture. Only synthetic records are seeded. The old legacy transport is test-injected to supply the actual synthetic RPC results; new resolve/load/write/full-history calls use the real root and repositories. No production page is opened and no real data, key, photo, microphone, provider request or migration is used. Synthetic HTTPS routing is browser-test interception, not a production TLS/CORS/deployment test.

The intended cross-version checks are two actual legacy RPC versions read by the new UI, two new complete versions read from the old entry, exact old SQL-row preservation, original authors/fields, delayed response isolation, missing visit refusal, page suspension/revocation, XSS-as-text and mobile layout. This does not certify a production deployment or bidirectional editing between incompatible formats.

## Candidate review remains a separate explicit step

The same prepared “素材原话” step now has an independently enabled candidate review section. `http.allowCandidates` defaults to false. The fixed extract endpoint accepts only scope/request ID; vision also requires `allowVisionCandidates` and an injected `candidateApprovalProvider`, otherwise its button is absent. That callback grants only the specific private-image read; it does not replace the server's separate processing/transmission/fee permission gate. The UI cannot choose a provider URL, model, session projection or key.

A returned candidate is displayed as unconfirmed text extraction or clearly labelled model visual description, with original quotation, group, side, track, unknowns and media references intact. Selecting rows and clicking **加入待核对记录** sends only `{type:'accept_model_candidate',candidateId,selectedIndices}` through the existing workflow CAS command. It never sends candidate content as authority or changes status to confirmed. An employee confirmation remains a distinct native command.

Candidate generation does not mutate the native record. Writes, scope changes and page suspension invalidate the visible candidate. Delayed results cannot replace another customer's content or a newer record. Unknown outcomes retain the same request identity for explicit retry, never an automatic second paid call. A changed record refuses old candidate acceptance; the server independently rechecks the base revision, candidate provenance and current media/access. Durable server receipts remain necessary because browser-only unsent/pending state is memory-only.

Prepared record/full snapshot v1 remain readable unchanged. Only authoritative acceptance upgrades to v2 with a separate complete `modelCandidates` provenance lane. The archive reader preserves both schemas and shows that lane without relabelling model descriptions as employee quotations or measured facts. UI/client contract tests are in `scripts/test-design-prepared-candidates.mjs`; they use only synthetic mocked candidate responses, not real model quality or production permission flows.

The Stage9 authorized-list integration is implemented and exercised through the actual HTTP composition/repositories with synthetic PostgreSQL data. **Production remains disabled and undeployed.** This does not mean the live GitHub Pages application already has a working `/api/design` backend, reviewed routing or initialized bindings.

After a published candidate is returned, the client explicitly reads it back through `/candidate/load` before displaying it. If this read is uncertain, same-request recovery uses the known candidate ID instead of creating another paid generation. If workflow context changes while an uncertain request is pending, the UI offers a clearly warned **stop this page's retry and retain the original request ID for reconciliation** action. That action does not cancel the server request or prove no charge. It retains an `unverified` local record, never automatically starts a new request, and any later explicit new generation must pass the server's independent permission/fee gate again. Pending/reconciliation IDs remain memory-only; production recovery continues to require durable server receipts and an authorized lookup flow.

## Stage9: authorized homepage list and existing employee session

`perm-app.html` exposes only two functions through `PreparedDesignHost`: `readSession()` calls the existing in-memory `verifiedEmployeeSession()` and returns its current employee token/name/store; `readDate()` returns the App's existing `BOOKING_DATE`. No new authentication, token persistence, login, key, fallback identity or automatic session refresh is created. The bridge's definition does not read the session, and the shipped disabled entry never calls either getter. The existing App's own session storage behavior is unchanged; prepared UI adds no storage.

When a reviewed application explicitly enables the same entry, its picker calls fixed `POST /api/design/visit/list` with exactly `{date}`. The date comes from the App's explicit business date or the visible date input, never UTC-now inference. The response is strictly `{date,visits:[{id,displayName,visit,bindingRevision}]}`: at most 50 rows, a 160-character trimmed/control-free display name and opaque binding revision, no scope/profile/phone/actor. Same-name or same-phone appointments and frontdesk visits remain distinct. The UI explicitly tells staff to verify the appointment/frontdesk number and not open a record if identity remains unclear; technical distinctness is not proof of human identification. Missing stable bindings are not shown; capacity errors show no partial/truncated list. No first-row automatic selection occurs.

Every selection calls fixed `/visit/resolve` with the original `{visit,expectedBindingRevision}` before mounting the **same** prepared workflow. A stale binding is refused and the list must be explicitly refreshed, even if the employee/name/profile are unchanged after a legitimate revoke/restore. The UI never silently swaps in a newer binding revision. Workflow load and every subsequent operation independently reauthorize against the actual repository. The old explicit-visit entry may omit the expected revision and therefore does not assert consistency with a previously displayed list.

`app-session.mjs` captures one employee credential for each picker/record/archive operation. Existing `staff-identity-changed` events compare token/name/store, so a same-identity refresh preserves unsent input. A change clears visible lists/history and hides the old record immediately. Existing pending operation identity remains in its suspended controller until explicit close, with a warning that a server operation may already have completed; changing identity is not cancellation. The HTTP client compares the current credential again after reading response bytes. A different employee cannot receive a delayed previous-employee result or reuse its pending command under a replacement token. Neither marker nor token is rendered or logged.

Repeated refresh/select clicks are guarded. Closing, date changes, identity changes and BFCache suspension invalidate delayed list/resolve results. Suspension clears the list, and persisted return performs a fresh authorized list read. Returning from the workflow also rereads the list rather than reusing cached authority. The same prepared workflow's source/CAS/history/media/record lifecycle is reused, not copied.

The Stage9 browser harness extracts the actual homepage anchors and function-only host bridge from `perm-app.html`, substituting **only** a synthetic existing-session getter and explicit business date. The actual client/HTTP/runtime/executor/binding service/PG records perform list, resolve, load, source append and readback. It covers same-name visits, frontdesk UUIDv7, missing bindings, original-binding selection, real approved reassignment/revoke+restore, identity/date/close/BFCache races, committed-late source save recovery, list capacity, XSS-as-text and mobile layout. No real session, browser storage, microphone, model or private photo is accessed. The isolated browser HTTPS route is a test transport, not a production TLS/CORS/deployment validation.

Stage10 uses this same selected-service modal for the completed-review comparison controls. It adds no homepage, parallel workflow or activation path. The comparison's separate feature/read-permission gates remain off by default, and its results follow the existing candidate readback, human acceptance and full-version history paths described in [HTTP-CAPTURE.md](HTTP-CAPTURE.md). Model comparisons retain four separate angle fields and cannot silently replace manual completion observations or plan/actual technique records.

Stage11 extends that same completed-review panel with an explicitly selected left/right synthesis of accepted front/back/side comparisons. It does not add an entry, change homepage authorization, reread images or turn model judgments into employee facts. The independent synthesis gate defaults off. Returned generation labels distinguish server-only deterministic organization from an approved model's choice of priority review focus. Complete source ancestry and missing/non-comparable/conflicting limits remain visible; manual review, per-angle records and old full versions are retained. Details and synthetic actual-HTTP/PG acceptance are in [HTTP-CAPTURE.md](HTTP-CAPTURE.md).

## Stage36 fixed synthetic normalized lane (default closed)

The existing homepage/modal also has a separately gated `http.allowNormalizedSynthetic`
configuration. It is not implied by `allowManagedImages`, `allowManagedViews` or the
old model flags. Its panel explicitly describes fixed color-pattern qualification and
a mock model response, not a customer hairstyle analysis. A task ID is only an opaque
selector for the server's current authorization checks; the browser cannot upload a
proof or turn an arbitrary local photo into a qualified task.

The three bounded API routes are `managed-normalized/describe`, `status` and `load`.
A failed or timed-out describe remains associated with its original request ID;
checking it only queries, and never sends the image again or issues approval. The
same original workflow dispatch accepts an ID/selected-index intent, followed by a
separate employee confirmation. Existing full-v5 archive rendering retains the
synthetic label and confirmation status. No token, image or task evidence is persisted
to browser storage. A browser feature flag never replaces server authentication,
processing/cost approval, verification or model-request authorization.

Server integration additionally requires the independent synthetic-only runtime mode,
its own existing restricted canonical-reader connection, and trusted mock dependencies.
None is installed by the shipped default-closed bridge. GitHub Pages alone still has
no backend. Browser 30-second timeout is not proof that a timed-out server request was
cancelled or never committed; recovery must query the original ID.

Important scope of redaction: only the three new normalized endpoints return the
minimal status/review DTO. Existing workflow load/dispatch/snapshot and full archive
routes still return full authorized history provenance, including tasks, reports and
private object locators, to the same authenticated browser. The renderer hiding them
is not transport redaction. No real customer data is enabled; a dedicated view DTO
and server-constructed archive command must be reviewed before real-data rollout.

## Stage37 secure browser views

Trusted `http.allowBrowserViews: true` selects only fixed `workflow-view/{load,dispatch,snapshot}`
and `archive-view/{load,append}` routes. The server must independently enable
`browserViews:{enabled:true}`. There is no client fallback; secure runtime closes the
five raw workflow/archive routes and does not pass their services into its handler.
Normalized synthetic generation now also requires this secure server mode.

These responses use explicit read-only view schemas. The native working record and
saved-history summaries remain readable, but complete internal provenance stays on
the server. Original record/snapshot digests are labelled opaque `sourceDigest`
tokens and are not recomputed from a view. The snapshot preview binds the record
`sourceRevision/sourceDigest`; save sends only that selector, original request ID,
and expected archive parent. The server constructs and validates the full snapshot.
Unknown save recovery retains the exact original command even if a later record or
archive version exists. It is not permission to write a replacement snapshot.

Original stored versions and proofs are unchanged. This closes the Stage36 structured
proof transport gap in secure mode; user-authored text can still contain URLs or
technical words and is not silently edited. Production activation remains unperformed.
