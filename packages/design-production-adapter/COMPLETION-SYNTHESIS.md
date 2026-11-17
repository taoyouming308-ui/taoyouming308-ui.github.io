# Synthesis of accepted per-angle AI judgments

This is an offline-tested prepared service, not a deployed model feature. It **does not view six photos again**, perform a complete visual diagnosis, infer the procedure, or verify the result. It summarizes previously accepted AI comparison judgments and, only when useful and separately approved, asks a model to prioritize a bounded review question. No new images leave private storage.

## Stable interfaces

- Public POST `/api/design/candidate/synthesize`: exact `{scope,requestId,side}` with explicit `side:'left'|'right'`. The root owns this HTTP/runtime wiring. No browser candidate array, source JSON, model, bytes, image URL, free-form analysis, generation switch or authority flag is accepted.
- `createDesignCandidateService(...).synthesize({credential,scope,requestId,side}) -> {candidate,replayed}` loads the authoritative workflow.
- `createDesignCandidateAdapters(config).synthesize({credential,scope,requestId,side,session,modelCandidates})` is server-internal only. Output uses the same candidate/load/ID-only acceptance path.
- Mandatory trusted `synthesisVerifier({credential,scope,actor,sessionId,baseRevision,inputDigest,synthesis,sourceRefs,candidateId?})->true` revalidates authoritative ancestor artifacts and acceptance receipts. The provider omits candidateId and requires a current source session; readback may pass the candidate ID so the repository, never the caller, determines an already-consumed history exception. Missing verifier fails closed.

`completion_synthesis` is an additive kind under `design-model-candidate-v1`. Old envelope shapes and hashes are not amended. The only kind-specific envelope key is `synthesis`, exactly:

- `side`.
- `evidence`, ordered front/back/explicit side, 1–3 entries. Each is `{candidateId,candidateDigest,angle,entryId,acceptanceRequestId,entryStatus,judgment:{comparability,reason,change}}`.
- `missingAngles`, `uncomparableAngles`, `conflictingAngles`, `assessment`.
- `generation`, `reviewFocus`.

`sourceRefs` is the ordered flattening of each ancestor's before/after original and derivative hashes, 2–6 references. Reuse of a photo under a different angle is not silently inferred. Ancestors must be `completion_comparison`, not another synthesis. Current visible entries are selected at the candidate's exact native base revision, not the most recent row by date or a browser selection. Acceptance is not automatically confirmation: each source's `entryStatus` stays explicit.

Pure helper exports live in `design-candidate.mjs`:

- `buildSynthesisEvidence({session,modelCandidates,side}) -> {synthesis,sourceRefs}` selects visible accepted comparison ancestors and computes the server facts/default valid focus.
- `validateSynthesisContext({synthesis,sourceRefs,session,modelCandidates}) -> true` permits a different applicable model-selected focus but requires every other fact/reference to equal the reconstruction.
- `validateSynthesisEvidence({candidate,session,modelCandidates}) -> true` additionally binds native base revision.
- `buildSynthesisCandidateParts({id,session,synthesis}) -> {descriptionSources,candidate}` creates one separate pending derived entry.
- `designSynthesisReviewChoices(synthesis)` returns the finite supported review questions.

These helpers do not authenticate or prove a digest was genuinely published. Their caller validates the full immutable accepted-candidate lane. Historical replay uses the exact `baseRevision` prefix and earlier validated acceptances, not today's latest entries; later confirmation or replacement must not rewrite an earlier summary.

## Server facts, missing views, and model role

Only `completed_review` is supported. Zero accepted eligible views is denied before any model/key access. A left view never stands for right or bilateral. Missing views are never invented. Uncomparable ancestor judgments preserve their exact bounded reason. Opposite apparent curl judgments are marked as **potential conflict requiring review**, not proof either view is wrong; different image directions/conditions can explain differences.

The server fixes assessment:

- `limited_evidence`: any missing or incomparable required view.
- Otherwise `potential_conflict`: opposite apparent curl judgments.
- Otherwise `consistent_judgments`: all three comparable judgments have the same bounded change label.
- Otherwise `mixed_judgments`.

Conflict flags remain even when insufficient evidence takes priority. Agreement is not a vote for achieved quality, satisfaction, technique or causality. The generated text always includes every angle's original judgment, employee confirmation status, missing/incomparable/conflicting angles, explicit side and all scope limitations.

The only model-selected value is `reviewFocus:{kind,angles}` chosen as a whole item from a server-built applicable list. Kinds are `missing_views`, `noncomparable_views`, `opposing_judgments`, `cross_view_differences`, `confirm_angle_judgment`, and `capture_conditions`. Every associated angle must exactly match supported missing or existing evidence. There is no free-form conclusion, chemistry, parameter, measurement, cause, plan-attainment, personality/identity or care channel. A selected priority does not remove other problems.

## Local versus model generation

When there are zero or one applicable review choices, generation is `deterministic`, reviewFocus is the only option (or null), and model metadata is explicitly `server-deterministic`. It requires **no modelConfig, keyResolver, provider transport, processingGate or cost approval**. The source is `server_synthesis` with actor `system`; the text says “服务器整理既有AI判断” and explicitly states no new model was called. This still undergoes employee, ancestor, original-media and publication checks and is stored as a normal immutable, reviewable candidate.

When more than one supported priority exists, generation is `model_review_focus`. Only an explicitly configured approved text model can select the review priority; no default actual model is supplied. Exact processing/cost approval is mandatory for recipient/endpoint/model/body digest/token limit/purpose `accepted_angle_ai_judgment_synthesis`, and bounded ancestor provenance is disclosed to the approval gate. The actual model request includes only angle judgments, statuses and their limits/allowed questions, **not original photos, image URLs, customer IDs, acceptance receipts, hashes, raw human notes or procedure records**. Returned JSON must be exactly `{reviewFocus:<one applicable option>}`. The source is `model_synthesis`, actor `model`, and is labeled derived judgment rather than new observation.

Both source types create `origin:suggestion,basis:inferred` in separate `result_review.model_completion_synthesis_left|right` fields, never in a human observation or per-angle comparison field. They remain unconfirmed until a separate employee action. The engine enforces system actor only for server_synthesis and model actor for model_synthesis; neither can be used as human “said” evidence or employee confirmation. Existing general review APIs remain limited to human review fields.

## Authorization, revocation, persistence and replay

The repository must verify full ancestor artifacts/receipts, their current access state, employee/visit scope, attached original-media metadata and original hashes. The model adapter verifies around approval waits, before key/transport, after transport and on cached replay. Service publication/readback repeats context and media checks, then performs the composite ancestor/employee/media verifier as its final awaited dependency. The synthesis-specific runner gate also performs that composite check last, including before send and cached return. This closes intervening source-read waits; the returned result remains a verification-time snapshot, not a promise that authority cannot change before network delivery. Private-media authority alone is not ancestor authorization.

Previously accepted ancestors survive TTL expiry as historical evidence, but an ancestor's active tombstone prohibits **new** synthesis generation, unaccepted synthesis preview and acceptance. Already accepted synthesis history is retained unchanged. The repository alone recognizes committed replay/history exceptions; no client mode or flag grants them. Employee/media withdrawal still blocks current data access. Actual database enforcement belongs to the PG repository and is tested separately.

Local generation uses the same trusted attempt store key, canonical SHA-256 of `[actor,requestId]`, as the existing provider runner, with a distinct local fingerprint and result. It does not call the paid runner. This prevents a changed same-ID local request later becoming a paid model call, and vice versa: both transitions conflict before any new key lease or transport. The store must be durable in production. No automatic new ID or retry is generated. Unknown local reservation/settlement is uncertain, even though no model fee occurred.

Local fingerprints bind the transmitted-free summary projection; if identical judgments now belong to different immutable ancestors, exact cached candidate comparison rejects reuse. This conservative failure is not permission to substitute the new ancestors. Publication failure after a generated result remains `CANDIDATE_SERVICE_OUTCOME_UNCERTAIN`; source/cached-output rechecks may withhold data even if the result was already durably saved.

## Verified and not verified

`node scripts/test-design-synthesis-candidate.mjs` runs synthetic accepted native histories through the real helper/provider/service logic with mocked transport, approvals, publication and authorization. It covers useful multi-choice model synthesis; local generation with all paid dependencies absent; complete and missing views; incompatible views; no implicit side; unsupported focus claims; original/ancestor withdrawal; local/model same-ID conflicts; exact canonical ledger key equality; local settlement uncertainty; same projection with changed ancestor; source actor restrictions; explicit pending adoption and preservation of all per-angle records.

The fixture is `scripts/fixtures/design-synthesis.mjs`. It contains no real images, customer content or credentials. Root/DB/UI owners separately verify HTTP, actual isolated PG persistence/history and browser integration. No actual model judgment quality, production worker isolation, long-lived driver/credential access, real data permission, deployment or external paid request was exercised here.

### Current end-to-end performance blocker

The initial diagnostic-only 120-second client run reached 8 of 12 functional checks, with synthesis taking 43,197 ms. After narrow transaction-local SQL deduplication, one bounded run at the unchanged product 30-second client timeout still measured 42,743 ms for the synthetic HTTP/PG synthesis response. Eventual HTTP 200 is not successful default-client acceptance. This fixture uses a test psql bridge, not the eventual production driver, so these timings neither certify nor predict production throughput. The end-to-end latency and interrupted/readback flow remain a release blocker pending bounded attribution and unchanged-default acceptance. Do not increase product timeout, remove fresh authorization, or describe the diagnostic run as passing.

That default run stopped at 5/12 checks. The explicit same-request recovery also returned only after 37,188 ms, with no second model dispatch. The browser never obtained the candidate ID and did not reach candidate/load. The server returned a published candidate, but default-client readback, acceptance and later interruption cases did not pass. Cleanup of the exact isolated fixture was verified. Existing screenshots are from the earlier partial diagnostic run only.
