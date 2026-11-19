# Prepared free-input workflow, not production UI

This stage adds an **independent, default-disabled** thin page and an injected controller/server boundary. It leaves the existing offline and synthetic connected pilots unchanged. Stages8/9 add a narrow, default-closed homepage/shared-archive extension that reuses this same implementation; see [APP-ENTRY.md](APP-ENTRY.md). Existing business writers remain unchanged. Opening `ai-design-prepared.html` by itself displays a closed notice and no input controls. Its CSP permits only same-origin connections and worklet scripts, `blob:` image previews, and no media elements. These permissions do not activate any client or capture operation. There is no automatic API connection, browser storage, credential entry, microphone request, recording, speech recognition, model call or private image upload. Stage7 adds explicit injected HTTP/capture/media composition to this same page; see [HTTP-CAPTURE.md](HTTP-CAPTURE.md) for the current integration and test boundaries.

The implementation proves an input-to-native-evidence path with unrestricted bounded **synthetic test strings**, rather than another fixed-text catalogue. It is not authorization to enter real customer data. The original Stage6 browser harness injects an in-memory synthetic backend. Stage7 also tests this same UI through the HTTP client, actual server composition root and actual isolated PostgreSQL repository. Production deployment, approved identities/consents, storage/provider credentials and launch review remain unconfigured. The existing synthetic UI projection schema remains synthetic-only and is not widened.

## Owned files and tests

- Root `ai-design-prepared.html`, `.css`, `.mjs`: five-step thin page, reused pilot styling, six-zone neutral schematic, separate group/service/side cards.
- `controller.mjs`: browser-only scoped state controller with injected I/O/capture dependencies.
- `app-entry.mjs`, `app-session.mjs`, `archive-view.mjs`: same-workflow homepage/shared-archive mounting, function-only current-session binding and bounded read-only history. The authorized day list is server filtered and selection rechecks its original binding revision; production activation remains absent.
- `composition.mjs`, `http-client.mjs`, `recorder.mjs`, `pcm-worklet.mjs`, `photo-preview.mjs`: the additive Stage7 composition of this same workflow, described in HTTP-CAPTURE.md.
- `../design-production-adapter/prepared-workflow-service.mjs`: server-only intent-to-evidence adapter.
- `scripts/fixtures/design-prepared-fixture.mjs`: **test-only** serialized in-memory repository and synthetic media resolver. Not durable and not deployable.
- `node --test scripts/test-design-prepared-workflow.mjs`: pure/service/controller plus actual prepared HTTP handler composition.
- `node scripts/test-design-prepared-browser.mjs`: isolated Chromium with local static assets and an injected bridge through the actual HTTP handler to the synthetic service. All other browser network requests are blocked. No real HTTP listener for the business API or signed-in browser is used.

Screenshots: `/tmp/ai-design-pilot-qa/prepared-workflow-{mobile-zones,desktop-zones,desktop-archive,mobile-archive}.png`. Screenshots and inputs are synthetic.

## Mapping without invented equivalence

The underlying authoritative record is `design-prepared-workflow-record-v1`:

```
{schemaVersion, revision, scope, store, session, archives, photoRefs, legacyVersions}
```

`session` is the existing validated native v2 evidence session. Its customer ID must equal `scope.customerProfileId` and its visit ID must equal `scope.visitId`. `store` must equal the current server-verified employee store. The outer revision provides CAS for **all** intents, including metadata attachments, while native `session.revision` counts native journal events. These revisions are deliberately distinct.

- Free original text is preserved exactly, including whitespace. The server creates an employee source with controlled message ID. This means **recorded by the authenticated employee**, not independently verified speech of a customer. Client-supplied actor/model/origin/status/confirmation fields are rejected.
- Eight older note labels (style, person, length, features, layers, bangs, curls, care) remain exact raw sources with controlled `note:<field>:<requestId>` identities. `preparedUnmappedNotes()` exposes them as **unmapped**. They do not invent native fields or automatic semantic equivalence. `care` is accepted only in completed review, never before-cut analysis.
- A manual mapping explicitly selects a native field, source and verbatim quote. Native `origin:'extraction'` means direct source extraction here, **not a claim that live AI performed it**. Technical values must occur in the quote. Unknowns stay `null`; no angle, rod size, direction or turn count is guessed.
- Numeric measurements accept explicit finite nonnegative decimal numbers only. The page does not turn blank into zero or interpret units/rod numbers. The server independently requires numeric JSON values for measurement fields. Text is used for rods, methods, formulas and similar fields.
- Six zones use native stable group IDs, separate cut/perm/dye service, explicit left/right/center/bilateral/unknown and independent planned/actual tracks. Same-zone groups are not flattened or mirrored. Service checkboxes hide cards without deleting data.
- Confirming a card is a separate intent with the exact current entry ID and independent original text identifying its value. The server records an employee confirmation event atomically after checking current access; the browser never optimistically changes a status. Editing creates a new native entry with a replacement link and resets confirmation.
- Transcription is an injected **text candidate** interface only. A candidate is `confirmed:false` and does not mutate the record. Explicit acceptance records it as a speech-transcript source, never as an actual operation or automatically confirmed entry. The original text-candidate interface does not invoke capture. Stage7's separately enabled recorder and explicit speech submission feed the same candidate-review flow; no real microphone or provider was used in acceptance.
- Photos are authorized opaque private media IDs only. Metadata is resolved server-side and preserves `before/after/reference`, `front/back/left/right/detail`, MIME/size/dimensions. Native archive references contain no bytes, URLs, filenames or hidden download links. Stage7 can explicitly upload/read an authorized private image through separate media endpoints and display a revocable local blob preview. Bytes never enter the evidence journal or full snapshot, and only generated synthetic images were tested.
- Native archive checkpoints are append-only. Once archived **all writes except explicit reopen are refused**, including attaching a photo reference. Reopen uses the exact latest existing checkpoint and an employee reason, retaining old journal and archives.

`snapshot()` produces a full-workflow candidate with `ui:null`, an exact native evidence lane (current session plus every archive), existing legacy versions and current scoped private references. It returns `saved:false` and `requiresAuthoritativeSourceVerification:true`. It does not insert evidence into legacy fields or claim the old synthetic UI projection exists. Original native histories and photo metadata survive unpacking. It does not include presentation-only tab/form state.

SHA-256 in the full snapshot is an integrity/consistency check, not a user signature, source authorization or proof of consent. Passing the pure native schema is not enough to trust a submitted source. The full archive transaction must independently compare the candidate against authoritative source stores with `verifySourceSnapshots`, verify binding and photo ownership again, and apply its own CAS/parent/idempotency rules. Nothing in this UI bypasses those checks.

## Browser injection contract

```
mountPreparedDesign(element, {
  enabled: true, // explicit test integration only in this stage
  customers: [{id, title, scope}],
  adapter: {
    load(scope),                    // -> {record, replayed}
    dispatch(scope, {requestId, expectedRevision, intent}),
    snapshot(scope),                // -> {snapshot, saved:false, ...}
    transcript(scope),              // optional -> {kind:'speech_transcript', text, confirmed:false}
  },
});
```

A client customer list and scope only **locate** a record; they do not establish permission. No client actor identity is accepted. The server must load the trusted record and recheck employee/service relationship on every call.

Controller state and unsent form text are isolated by customer. Form fields are isolated per technique group. Delayed load/save/speech/snapshot results cannot replace another customer or a newer snapshot. Duplicate submits are blocked while pending. If an acknowledgement is lost, the identical request ID and payload remain pending; there is no automatic retry. The user may explicitly replay that same request or explicitly discard the pending intent and reread. Reloading the document closes the page again until injected, then reads server state. Unsent browser drafts are memory-only and are lost on reload.

Original source/quote display uses DOM `textContent`, and textarea drafts use their `value` property. Other labels/attributes are HTML-escaped. No HTML from a source is rendered as markup.

## Server dependency contract

```
createPreparedWorkflowService({enabled:false, permissionGate, repository, mediaResolver, mediaVerifier})
  .load({credential, scope})
  .dispatch({credential, scope, requestId, expectedRevision, intent})
  .snapshot({credential, scope})
```

An explicitly enabled instance requires `permissionGate.authorize(credential,scope)` and `repository.transaction({grant,scope}, work)`. The transaction must select/lock the authoritative row by the server binding, not a browser actor or submitted session, and provide:

- `permissionGate.authorize` against the transaction's current access state.
- `read()` returning the complete current trusted record.
- `findReceipt(key)` returning `null` or the exact saved receipt.
- `write({expectedRevision,record,receiptKey,receipt})` performing atomic CAS and durable receipt insertion; returns exactly `true` on success. It must never overwrite another scope or prior receipt.
- `beforeCommit(hook)` registering an awaited callback **inside the transaction before irreversible commit**. Callback rejection must roll back. The adapter checks readback/receipt and that the hook executed.

The repository owns durable identity/binding/row security, serialization, backups and lifecycle. No production implementation is supplied by this module. Receipts include the original `{requestId,expectedRevision,intent}`, actor, scope, applied revision and fingerprint. This preserves an audit trail for attachment intents even though native evidence has no fabricated “photo spoken source” event. Keep these receipts durably with the record; they are not replaced by an in-process map. The full snapshot preserves reference state per full archive version, not this separate repository command audit.

`mediaResolver({credential,grant,scope,mediaIds,transaction})` must return the exact references array in request order after checking active private-record owner/store/customer/visit binding using the **same transaction/lock**. It must not treat an earlier public reference as authorization. A public `privateMedia.resolveReferences()` result can only be unwrapped when the trusted integration supplies the required current checks; do not blindly wrap an external/unlocked read. All current stored private references are reverified on load, replay, candidate creation and immediately before commit. A revoked reference therefore blocks delivery rather than silently disappearing. `mediaVerifier({credential,grant,scope,mediaIds})` is a separate mandatory final dependency whenever private refs exist. It performs a fresh current read **after** the transaction has finished, returns the exact reference array, and must never reuse a closed transaction. The service invokes it before its final employee authorization and before returning any record or snapshot. If it fails after a write may have committed, the result is uncertain and no record is delivered. A read-only failure returns a safe denial without refs. The eventual full archive adapter still must reverify it separately. Actual media reads and provider transmission require their own current access and approval.

The service rejects non-JSON values/accessors/hidden authority, bounds intent size/depth, preserves native event validation, and has no network or key dependency. Changed request payloads conflict; exact replays return the latest authorized record without reapplying. A failure after a transaction may have committed returns `WORKFLOW_OUTCOME_UNCERTAIN`, withholds the record and disables automatic retry. Keep the same request identity and resolve state through a fresh authorized read/replay.

## Remaining production work

This is a bounded mapping and prepared-page acceptance stage, not completion of the production workflow UI. Stage7 now adds the actual injected workflow repository, HTTP client, explicit upload/preview/recording, actual ASR-adapter composition with mocked external transport, and full archive append UI. Remaining production work includes reviewed schema/role installation and runtime driver/storage operations, deployed HTTPS routing/CORS, real consent and credential flows, business-page integration and authenticated customer selection, device/media compatibility, live ASR quality, live model analysis and model suggestion review. No real deployment, migration, access grant, key creation, paid request or real-data test was performed.


## Existing App entry compatibility

Stage8 adds the default-closed homepage/legacy-modal extension and a shared read-only old/full-format renderer, without replacing the legacy writer. See [APP-ENTRY.md](APP-ENTRY.md) for exact-visit resolution, field preservation, trust boundaries and synthetic acceptance. No production activation or new-to-legacy write conversion is provided.
