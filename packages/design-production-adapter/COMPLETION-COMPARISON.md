# Prepared completion-photo comparison

Offline/mock-tested preparation only. No real customer images, model selection, API keys, paid calls or deployment are enabled. Existing candidate and root switches keep their prior default-deny behavior.

## API and provenance

- Internal adapter: `createDesignCandidateAdapters(config).compare({credential,scope,requestId,session,media:[{reference,bytes},{reference,bytes}]})`.
- Server service: `createDesignCandidateService(dependencies).compare({credential,scope,requestId,beforeMediaId,afterMediaId,approval})`.
- Public route, wired separately by the root handler: POST `/api/design/candidate/compare`, exact JSON `{scope,requestId,beforeMediaId,afterMediaId,approval}`. No client session, bytes, URL, endpoint, model, key or candidate JSON.
- Response `{candidate,replayed}`. Existing load and ID-only explicit acceptance remain unchanged. Request/body/prompt hashes, employee/store/visit/native session revision, immutable server publication, consumption/expiry and history checks remain required.

The additive `completion_comparison` kind keeps the existing schema marker and adds one exact required field `comparison:{beforeMediaId,afterMediaId,angle}`. Other kinds must not include that field and old hashes remain unchanged. Ordered `sourceRefs` contain the before and after media IDs with exact original and derivative SHA-256. These hashes are integrity links, not independent proof of authorization or correct interpretation.

Both media must already be attached to the current server-loaded workflow, same employee/store/customer/visit scope. The first must be `before`, the second `after`, and both must have the same explicit `front`, `back`, `left` or `right` angle. Distinct IDs are required. `detail`, legacy markers, reference-stage images, reversed pairs, unattached IDs and mismatched directions fail before model dispatch. A matching direction label does not prove matching pose, framing, distance, lighting, or technical comparability. The output must explicitly support inability to compare and its bounded reason.

Private media are read individually through existing authorization, and reference metadata must match the attached authoritative reference. Inputs and metadata are copied. The service refreshes scope/session/photoRefs around reads, before publication and after publication. It validates pairing again on load. Database/history owners additionally bind the pairing to immutable metadata and accepted snapshot provenance.

## Evidence, model judgment, and employee confirmation

Generation is allowed only in `completed_review`, never during before analysis. It creates one pending model description with `source.kind=image_description,actor=model`, plus a `result_review` entry whose **dedicated field is `model_photo_comparison_front`, `model_photo_comparison_back`, `model_photo_comparison_left` or `model_photo_comparison_right`, bound to the exact comparison angle**. `track:actual` only selects the completed-review lane; it does not establish actual execution, measurement or causal fact. The existing human `observed_result` field is not replaced or hidden. The original journal, human sources, planned/actual technical records and confirmations are untouched.

The deterministic label says this is an unconfirmed model visual judgment, not measurement or execution fact, and does not prove target achievement or causal effects. A model may choose only:

- Apparent silhouette change; curl shape appears more pronounced or less pronounced; no clear visible appearance change.
- Or no comparison, with reason: obstruction, insufficient clarity, pose/framing difference, lighting difference, or unknown comparability.

There is no free-form channel for inferred chemistry, sizes, angles, time/temperature, identity/personality/health, satisfaction, quality grade, plan attainment, care advice or causation. Prompt instructions alone are not relied on: enums, exact output shape and reconstructed source/entry text are checked before settling the provider attempt. Image text/instructions are untrusted and not extracted.

The words “observable” and “extraction” are existing engine metadata for a quoted model image description, **not a claim that the model output is objective evidence**. Provenance explicitly distinguishes the original images from the model's judgment. Adoption stays ID-only and explicit; it appends unconfirmed data. An employee must separately supply a human statement to confirm. Confirmation never changes the original model source or immutable candidate provenance. AI comparison can supersede an earlier entry only in its own same-angle comparison field, preserving the human-result lane and other angles. The builder requires an explicit angle and the validator binds it to the envelope; no default or inferred left/right mirroring is allowed.

## Permission, size, and failure limits

Private-storage permission does not authorize external processing. Each original read requires the existing exact private-read approval. The shared request approval object is checked separately for each media ID; it is not accepted as automatic permission for both images or an AI cost approval.

The processing gate independently approves local derivative preparation and later exact recipient, model, purpose `private_completion_photo_comparison`, two source/derivative hashes, request body hash, output-token limit and possible cost. Media and employee/session authorization are rechecked across approval/derivative/provider waits and on cached replay. No user content is sent outside the explicitly approved request. The provider uses the existing official inline-image request shape and operation runner, mock transport in tests, and an explicit approved vision model allowlist with no default model.

Only metadata-stripped, fully decoded PNG derivatives may be transmitted. Each comparison derivative is capped at **48 KiB**, both together fitting the unchanged 196,608-byte overall request cap. An oversized derivative is rejected rather than truncated or silently downgraded. The stage9 worker's 128px RGBA maximum may still exceed this smaller cap for some images; such images currently fail closed until an independently reviewed deterministic smaller derivative is configured. The service never sends an original as fallback. Metadata removal is not anonymization.

Provider-attempt replay preserves exact payload identity and never automatically repeats an uncertain paid operation. Failure after generation/publication is `CANDIDATE_SERVICE_OUTCOME_UNCERTAIN`; no stale candidate is exposed and no automatic retry is initiated. Private media withdrawal or source changes deny cached loads. A response can be withheld even when immutable publication already happened; subsequent explicit recovery must use the trusted server repository/attempt state.

## Verification

`node scripts/test-design-completion-candidate.mjs` exercises real candidate/provider/service contracts with synthetic fixed PNG full-decode fixture, synthetic employee and approval gates, mock transport and immutable-publication mock. It covers phase/pair/order/angle checks, exact double-image disclosure, independent approval, revocation across waits, uncertain outcomes, repeat requests, prohibited content, incomparable reasons, explicit pending adoption, retaining confirmed human result notes, authoritative two-image reads, source changes, and schema tampering.

This is not production database or model-quality validation. Real PG publication/consumption/history and browser-route acceptance are coordinated in separate owner tests. The live image worker, deployed gateway, actual model capabilities/quality, credentials and real external-processing grants remain unconfigured and unapproved.
