# Unified prepared HTTP, capture and private preview

This is the **same** `ai-design-prepared.html` → `mountPreparedDesign()` → existing controller/native evidence workflow, not a new parallel demo. `mountPreparedHttpDesign()` in `composition.mjs` injects the real HTTP client, optional recorder and optional scoped preview manager into it. Its default remains closed. Stage8 adds a default-closed homepage/modal bridge to this same path; the old offline/synthetic pilot remains separate and clearly labelled. See [App entry compatibility](APP-ENTRY.md).

The server counterpart is `createPreparedDesignRuntime()` in `packages/design-production-adapter/prepared-runtime.mjs`. The unified test exercises its actual HTTP handler, employee/assignment authorization, workflow service, PostgreSQL repositories, private media service and full archive transactions. There is no client-submitted trusted actor, source confirmation, session projection, provider URL or model choice.

## Explicit composition

```js
mountPreparedHttpDesign(element, {
  enabled: false,
  customers: trustedVisibleCustomerCandidates,
  http: {
    credentialProvider,        // existing opaque employee session, memory only
    approvalProvider,          // independent exact media approval flow
    allowUploads: false,
  },
  recording: {enabled: false, requestStream, channelPolicy: 'require-mono'},
  previews: {enabled: false},
});
```

Candidates locate a customer; the server reauthorizes every operation. The production client accepts **HTTPS on the exact configured document origin only**, fixed `/api/design/...` paths, no redirects, no cookies, `no-store`, bounded responses and an injected current-session resolver. There is no HTTP protocol exception, arbitrary URL field, default API key, stored token, or automatic retry. Responses may not echo the session credential. Upload approval input includes SHA-256 of the already copied bytes plus exact scope, request ID, MIME, size, stage and angle; the server independently recalculates the content digest and verifies its own exact recipient/purpose approval. The provider/fee approval path remains separate from media approval.

**GitHub Pages does not implement `/api/design`.** Merely enabling a flag or adding an API key cannot connect this to the existing deployment. A reviewed same-origin HTTPS proxy/deployment or a separately reviewed fixed API-origin policy is still required, together with production schema/driver/permissions, current identity, media consent and provider approval. This stage deploys none of them.

## Recording

`recorder.mjs` uses the actual Web Audio `AudioWorkletNode` and `pcm-worklet.mjs`. The audio graph explicitly produces one channel; JavaScript writes PCM16 little-endian mono WAV with the supported server header. It clamps finite samples and rejects invalid rates/data. Maximum frames are the smaller of `sampleRate * 120` and `floor((8 MiB - 44) / 2)`. Thus 44.1 kHz cannot run for 120 seconds within this byte cap. Limits use real captured frames and final bytes, not MIME or client-declared duration.

- Default `require-mono` rejects a missing/zero/non-one source channel count. No unknown source is silently treated as mono.
- Explicit `mix-to-mono` uses the Web Audio node's `channelCount:1` / `channelCountMode:'explicit'` mixing. The worklet still refuses input arrays other than one channel. The UI labels this conversion. No stereo WAV is sent to the ASR endpoint.
- `requestStream` is mandatory and invoked only by explicit start. `createMicrophoneStreamRequest()` is an optional separately enabled bridge that first awaits an injected microphone permission gate and then requests mono audio with `getUserMedia`. **No real device permission or microphone was requested in these tests.** Browser permission remains required in a future real-device flow.
- Stop/cancel, customer change, page suspension and destroy close the audio context and stop the supplied stream. Late stream acquisition and late worklet loading after cancellation also release the stream. The buffer stays memory-only.
- Stopping only creates a local candidate. A distinct user action sends the WAV to `/api/design/speech`. The returned transcript remains `confirmed:false` until the user explicitly accepts it as a source. It is never automatically an actual operation or confirmation. Uncertain/malformed speech responses retain pending identity and cannot automatically trigger a second paid call. A durable production provider-attempt ledger and an authorized reconciliation workflow are still activation prerequisites.

Web Audio behavior follows the primary [W3C Web Audio specification](https://www.w3.org/TR/webaudio/). This is whole-file recording and transcription, **not live streaming speech**. Browser/device/mobile microphone compatibility, noise handling, speaker attribution and actual ASR accuracy have not been accepted.

## Photos and blob lifetime

File selection is separately disabled by default. An explicit selection accepts bounded PNG/JPEG/WebP only and performs local browser decode/dimension checks; it does not upload. A separate button passes copied bytes to the existing private upload endpoint after independent approval. The server performs full native decode and private storage/metadata checks. No filename is transmitted; the upload uses a fixed placeholder filename. Successful upload returns an opaque reference, which is attached through the existing workflow service only after current authorization.

A preview requires an independent authorized `/media/read` request, bounded binary bytes with `private, no-store`, matching MIME/length, expected file signature and successful browser decode with exact dimensions. Only then is a `blob:` URL created locally. It is not a bearer URL from the server and never enters PostgreSQL workflow state, source text or archives. Replacing/clearing a preview, switching customers, reloading, page suspension or destruction revokes it. Old-customer decode responses or failures cannot replace or clear the newly selected customer's preview. Same-customer file selections use a latest-selection token so a slow old file cannot overwrite a newer selection.

Decode explicitly requests `imageOrientation:'none'` and keeps strict encoded-size checks. Native originals may retain EXIF. The unified fixture is a generated 3×2 PNG with a fixed SHA whitelist and complete native decoding. **EXIF-oriented phone JPEGs, phone camera capture, WebP variants and cross-browser orientation behavior are not accepted by this PNG test.** No width/height-swap heuristic is used. These remain required compatibility tests before real photo input is enabled. Browser preflight is not a substitute for the server decoder or consent.

## Saving, recovery and lifecycle

The existing native archive checkpoint is distinct from the full archive. The UI separately prepares the full snapshot, reads authoritative full-history head, and explicitly appends with request ID, expected version and parent digest. `saved:false` is only a candidate. A validated backend `saved:true` clears the candidate and displays the applied full version. Old native and full archive versions remain unchanged.

Load, dispatch and full writes preserve original IDs across an explicit replay. Scope switches revalidate cached customers and hide old records while waiting. Failed access hides cached record data. Stale CAS keeps input/pending state until explicit reread; it does not overwrite another writer. Snapshot/history replies are checked against current customer and record revision. Page suspension hides records and clears media; persisted page restoration reauthorizes instead of showing the old cached page. Pending write identity is retained rather than silently discarded.

## What the unified test proves, and does not prove

Run:

```
node --test scripts/test-design-prepared-client.mjs
node --test scripts/test-design-prepared-workflow.mjs
node scripts/test-design-prepared-browser.mjs
node scripts/test-design-unified-browser.mjs
```

The last command uses a unique, temporary, network-disabled PostgreSQL 17 container with no ports/host mounts and verifies its removal. It uses the actual existing-image executor and fixture, not a map pretending to be a DB. Chromium is fresh, has no microphone permission and forbids real `getUserMedia`; its two-channel oscillator stream is explicitly mixed, and both generated frequencies are verified in the mono PCM sent to the **actual** `createDeepSeekSpeechAdapter`. That adapter uses the actual PG permission gate, a clearly synthetic key callback/test-only attempt store and a mocked external provider transport. No real key is read or configured and no paid/provider network request occurs. The actual private media service uses native fixed-PNG decoding, actual PG metadata and an immutable in-memory object-storage transport.

**Transport/origin simulation is explicit:** Chromium's worklet module request is not intercepted by the tested Playwright routing path. A `127.0.0.1`-only exact static-file allowlist serves the real worklet in the browser's trusted localhost context. The test injects a `fetchImpl` that maps only the fixed synthetic HTTPS API origin/routes to this loopback request path; the route harness constructs the corresponding fixed synthetic HTTPS Request for the actual server root. The production client remains HTTPS-only. No certificate warning is bypassed, no CSP `unsafe-eval`/blob script permission is added, and no system/network permission is changed. This test verifies the shared application/request/authorization/persistence flow, **not production TLS, deployed CORS, routing infrastructure or a live provider/storage service**.

Synthetic screenshots are in `/tmp/ai-design-pilot-qa/unified-pg-mobile-zones.png` and `unified-pg-desktop-archive.png`. The generated media/audio are not real customer records. No production migration, deployment, credential creation, data upload or live employee rollout is performed by these tests.

## Stage10: completion-photo comparison in the same review step

The existing completed-review step now offers comparison through the same client/controller, independently disabled by `http.allowComparisonCandidates:false`. Enabling text or before-photo vision does not enable comparison. An injected `candidateApprovalProvider` is also required; the callback receives the fixed purpose `model_completion_comparison`, current scope/request ID and the ordered before/after media IDs. Its returned object authorizes only the precise private reads. The server independently authorizes each read, metadata removal, external disclosure and possible provider cost. There is no approval checkbox pretending to grant these permissions, model picker, provider URL or key input.

Only attached private references with stage `before` and `after`, distinct IDs and the same explicit `front|back|left|right` angle are selectable as a pair. Reference/detail images and mismatched angles are refused. The phase must already be `completed_review`; no comparison request is made merely by opening the step or choosing a photo. The fixed request is `POST /api/design/candidate/compare {scope,requestId,beforeMediaId,afterMediaId,approval}`. It never sends image URLs, bytes, a client session projection or client model output as authority.

The server's `completion_comparison` candidate is read back before display. Its explicit pair/angle, both source and derivative SHA-256 digests, model-authored image-description source and verbatim citations remain visible/readable. These hashes show content consistency, not user consent or proof of authorization. The limited output is either a bounded visual-change description or an explicit inability to compare with a reason. It is **not** a measurement, evidence of an operation being performed, chemical-causation finding, service-quality grade or proof the target was achieved.

Human selection uses the existing ID/indices-only acceptance command, adding a **not-confirmed** record. Four separate `result_review.model_photo_comparison_front|back|left|right` fields prevent another angle or model comparison from replacing the employee's `observed_result`. `actual` here locates a completion-review record; it does not transform a visual inference into proof of actual technique. The original plan/actual technique entries remain distinct and unchanged. A subsequent employee confirmation is a separate intent with original text, and the archived model candidate remains unconfirmed and immutable even after that action.

Unknown outcomes retain the original request and image pair for explicit retry. If publication succeeded but readback was lost, retry reads the known candidate ID without regenerating. Customer/employee changes, page suspension, a newer workflow write or close cannot display or accept a delayed old comparison. Closing a pending request warns that it may already have completed, not that it was cancelled. No automatic retry or second paid request is introduced.

Additional acceptance:

```
node --test scripts/test-design-prepared-comparison.mjs
node scripts/test-design-comparison-browser.mjs
```

The browser test uses the actual homepage anchor and function-only App-session bridge, actual authorized list, private upload/native decode/PG metadata, workflow evidence, candidate provider adapter/service/publication/readback/acceptance and append-only full archive. Only the external provider output, independent approvals, object store and pre-existing browser session getter are synthetic test fixtures. Input is the fixed generated PNG; both pictures deliberately use synthetic pixels, so this validates wiring/provenance/lifecycle, **not model accuracy or real before/after similarity**. No real photo, session, microphone or paid model call is used. Test HTTPS interception does not validate a production TLS/CORS deployment.

## Stage11: synthesis of accepted angle judgments

The same completed-review panel now supports independently gated `http.allowSynthesisCandidates` (false by default). Fixed `POST /api/design/candidate/synthesize` sends only `{scope,requestId,side:'left'|'right'}`. The browser never supplies evidence, judgment, assessment, a candidate payload, photos, model, key or approval. The server selects currently visible and explicitly accepted front/back/selected-side comparison ancestry and rechecks current binding, media and candidate history. The browser's coverage helper is presentation only, not permission or trusted provenance.

There must be at least one accepted angle; one or two angles explicitly remain insufficient. Opposite-side evidence is not silently substituted. Every candidate displays its per-angle ancestry, original confirmation state, missing angles, non-comparable angles and potentially opposing judgments. The synthesis does not read the six photos again, infer procedure/chemistry, measure hair or prove execution/goal attainment. The original human review, four per-angle comparison lanes and planned/actual technique tracks remain separate.

The returned `synthesis.generation` controls the label. `deterministic` means the server organized existing AI judgments with zero new provider/key calls (`server_synthesis`/`system`, model `server-deterministic`). `model_review_focus` means an independently approved model selected one priority review item from a server-derived finite list (`model_synthesis`/`model`). Assessment and all limitations remain server-determined in both cases. The UI does not predict billing or claim a model was used before the result; an uncertain request is still uncertain. Neither synthesis source is offered as an employee's original quotation in manual entry forms.

Candidate generation does not write or confirm the workflow. Explicit **加入待核对记录** uses the existing candidate-ID/selected-indices CAS command. Accepted synthesis stays `suggestion`/`inferred`/`not_confirmed`, with original candidate and acceptance ancestry retained in complete archive versions. Employee confirmation remains a separate action, never a change to the original candidate. Older accepted synthesis is visibly marked outdated if current angle evidence or its confirmation state changes. No automatic replacement, new generation or charge occurs.

Readback failure retains the known published candidate ID; explicit retry rereads it without regenerating. Unknown pre-publication outcomes retain the same request ID/side. Customer, employee, page suspension/close and later workflow revisions prevent stale delivery. These reuse the existing controller and session lifecycle rather than a separate workflow. All operation feature gates and production activation remain off.

Acceptance: `node --test scripts/test-design-prepared-synthesis.mjs` and `node scripts/test-design-synthesis-browser.mjs`. The browser test uses the actual homepage anchors/function-only host bridge, shared UI/client, HTTP runtime, PostgreSQL binding/workflow/candidate/full-history repositories and complete native synthetic image decoder. Fixed synthetic images and synthetic staff data only; storage, approval and external provider transport are mocks. Synthesis provider input is asserted to contain text judgments, not image data. Browser HTTPS routing is test interception, not production TLS/CORS or deployment validation. No real key, customer photo, microphone, model charge or production activation is tested.


## Existing static App transport (unpublished v671 candidate)

Same-origin remains the default. Trusted host configuration can explicitly supply
`apiOrigin` and `allowCrossOriginApi:true` while `origin===documentOrigin` stays
the actual page origin. Only exact HTTPS origins and fixed routes are accepted;
response URL checks follow apiOrigin. No query/persistence endpoint discovery,
ambient cookies, redirects, retry or model activation is added. Private preview
metadata must be exposed by the separate exact-origin API ingress. See
[existing App deployment contract](../../deployment/README-design-app1.md).
