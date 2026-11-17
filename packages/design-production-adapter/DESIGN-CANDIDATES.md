# Server-owned text and image candidates (prepared, default off)

This stage implements real request/validation contracts with synthetic fixtures and mock provider responses. It does not select an approved live model, call a provider, configure credentials, deploy a derivative worker, grant access, or claim model quality from mock tests.

## Official protocol, without default approval

The official [Vision guide](https://api-docs.deepseek.com/guides/vision/) and [Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/) were read during this implementation. They describe inline base64 image content in a user message at `https://api.deepseek.com/chat/completions`; the current guide names `deepseek-flash` as image capable. That is documentation of capability, not approval to use that model. This implementation sets **no default model**, accepts no client-selected endpoint/model, and requires an independently supplied server model allowlist and approved model configuration. Model aliases/remapping are not silently accepted: response model must exactly match configured model. Recheck official support before any live activation.

There is no public/signed image URL, Files API upload, tool/web search, or image-to-technical-parameter path. One bounded inline PNG derivative is the only image input. Existing speech and the old text-only provider remain unchanged.

## Interfaces

`createDesignCandidateAdapters(config)` in `design-candidate-provider.mjs` provides:

- `extract({credential,scope,requestId,session})`
- `describe({credential,scope,requestId,session,media:{reference,bytes}})`

These are **internal server methods**. `session` must come from the authoritative workflow loader, and image bytes/reference must come from authorized private-media access. HTTP must never accept browser session JSON, raw image bytes, model candidate JSON or image URLs as these parameters. Both methods return `{candidate,replayed}`; the orchestration layer must publish the candidate to the immutable server repository before offering acceptance.

Configuration reuses the existing runner's `transport`, callback-based `keyResolver`, `permissionGate`, durable `attemptStore` and timeout. It additionally requires:

- `modelConfig:{approved,model,maxTokens}` and independent `approvedTextModels` / `approvedVisionModels` arrays. Defaults are empty. A chat credential's existence does not authorize an image purpose or paid operation.
- `sessionVerifier({credential,scope,sessionId,baseRevision,inputDigest}) -> true` verifies the full authoritative current session, not a browser hash. Checked around runner authorization awaits, including cached-result delivery.
- `processingGate(disclosure) -> true` verifies explicit current purpose, recipient/model, exact input/payload digest, selected source and derivative hashes, data transmission and cost approval. `maxOutputTokens`, `mayIncurCharge`, `costAuthorizationRequired`, `dataProcessingAuthorizationRequired` are supplied. A token cap is **not** a monetary spending cap; the real gate must tie approved currency/budget and current pricing or a bounded provider arrangement to this request. A mock `true` verifier is not production approval.
- Image-only `mediaVerifier({credential,scope,actor,sourceRefs}) -> true` independently checks the original object hash and active authorization, including at replay and after processing-approval waits. `before_derivative` has original-only `{mediaId,sourceSha256}`; subsequent disclosure also includes `derivativeSha256` and exact `payloadSha256`/byteLength. Initial local preparation approval is not the later external transmission/cost approval.
- Image-only `derivativeProvider({bytes,reference,sourceSha256})` returns `{bytes,mime:'image/png',sourceSha256,metadataRemoved:true}`. This is a trusted, separately reviewed local-worker capability, not a browser declaration. `derivativeInspector(bytes)` must completely decode the derived image.

The output PNG is limited to 96 KiB and 2048 pixels per side; only 8-bit non-interlaced RGB/RGBA with IHDR/IDAT/IEND chunks is allowed. Ancillary metadata chunks, palette/APNG, trailing bytes and unsupported content are rejected, and complete decode dimensions are cross-checked. The request remains within the existing official transport's 196608-byte limit. Production requires a verified derivative worker with the same OS isolation, resource limits and no-egress requirements as the private decoder; none is deployed here. Synthetic tests return the fixed hash-whitelisted PNG through actual native decoding. They do not establish that arbitrary originals are safely transformed. Private originals and EXIF are not sent by default.

## Unified immutable candidate and provenance

`packages/analysis-engine/design-candidate.mjs` exports:

- `validateDesignCandidate(candidate,originalSession)`
- `designCandidateDigest(value)` (canonical SHA-256, not an authority proof)
- `applyTrustedDesignCandidate({session,candidate,selectedIndices,requestId}) -> {session,acceptedReceipt}`

The envelope has exact fields:

`schemaVersion,id,kind,scope,store,actor,sessionId,baseRevision,inputDigest,payloadDigest,model,promptVersion,sourceRefs,descriptionSources,candidate`.

The schema is `design-model-candidate-v1`; kind is `text_extraction` or `visual_description`. The ID is a server-computed digest of actor, provider request ID and kind. `baseRevision` is the **native session revision**, not the workflow record revision. `inputDigest` binds the complete original session. The candidate itself retains the native `{phase,entries,questions,warnings}` shape. `sourceRefs` binds original media ID/hash and actual derivative hash; it is not a URL or a substitute for permission.

Text extraction sends an explicit text-only prompt projection of human text/speech sources and necessary existing technical context. It never edits or deletes the underlying session's image sources, journal or history. A session that already accepted a model image description remains usable. Output must be extraction/said, must quote the actually transmitted human evidence verbatim, and technical group ID/zone/service/side must match an employee-created group. No new/mirrored/merged group can be invented. Phase and planned/actual checks remain enforced by the engine. Semantic interpretation of an ambiguous human phrase still needs employee review; schema tests do not prove that a model selected the intended existing group or track.

Vision is intentionally limited to `before_analysis` and the small enumerations `visible_outline` and `visible_hair_shape`, with null for unknown. It has no free-text identity/personality/health inference or care/technical output channel. The server constructs description sources with `kind:'image_description'`, `actor:'model'` and an explicit “model visual description, unconfirmed, not a measurement or fact” label. Observable values are **model candidates**, not a measurement, human statement or automatically confirmed fact. A separate employee confirmation is still required. Description/source IDs are deterministically server-generated and length-bounded.

Acceptance takes only a candidate ID and selected indices through the authoritative server orchestration. The pure helper cannot prove provenance of arbitrary JSON: the caller must load the exact immutable saved envelope, check current actor/scope, expiry/revocation/consumption, original session digest and media authorization. It appends selected entries as not_confirmed/unknown and required model sources, never confirms. Its audit receipt contains `candidateId,kind,candidateDigest,inputDigest,baseRevision,resultRevision,selectedIndices,sourceRefs`. After one subset is accepted, the native revision changes; remaining fields require fresh generation rather than silently adopting stale output.

The separate repository/record integration retains the complete immutable candidate and acceptance receipt in an explicit versioned provenance lane. Old schema hashes must not change through silent migration. Archive/history replay must verify that applying the recorded candidate to its original session produces the exact journal prefix and receipt. Candidate expiry or revocation blocks new acceptance; it must not erase historically accepted provenance. Retain/export the candidate artifact and its references for the same lifetime as the associated archive; a hash without the artifact and authoritative chain is not evidence.

## Failure and tests

The shared runner reserves durable request identities, validates exact provider responses, blocks duplicate uncertain attempts and does no automatic paid retry. A failed/invalid response after dispatch remains uncertain. Source/session/media withdrawal before dispatch prevents sending; withdrawal afterward withholds candidates. Exceptions are cleaned before leaving the adapter. Real deployments still require a durable attempt store and approval/credential dependencies; the test-only store is explicitly in-memory.

`node scripts/test-design-candidate-provider.mjs` runs synthetic text/images only, with real installed native decoding on a fixed fixture and mock provider/approval/state responses. It covers default deny, exact inline/provenance disclosure, storage-vs-external consent, asynchronous revocation, uncertain outcomes, replay, unsafe visual fields, derivative metadata rejection, explicit acceptance, technical group restrictions, fabricated quotes/confirmation, and text extraction after a visual candidate was accepted. These tests do not call a model or demonstrate its accuracy.

## Authoritative HTTP/runtime composition

`candidate-service.mjs` performs authoritative workflow loading, optional attached-reference private-media reading, provider generation, immutable publication, and fresh post-publication source/media/actor checks. If provider generation completed but publication or final verification fails, it returns `CANDIDATE_SERVICE_OUTCOME_UNCERTAIN` and never automatically calls the provider again. An explicit same-request retry may use the runner's already-completed result; it must not become a new paid request. Repository errors are cleaned, and private bytes never appear in candidate responses.

Exact POST routes under `/api/design`:

- `/candidate/extract`: `{scope,requestId}`
- `/candidate/vision`: `{scope,requestId,mediaId,approval}`
- `/candidate/load`: `{scope,candidateId}`

Generation returns `{candidate,replayed}`; load returns `{candidate}`. The employee session remains in the existing authenticated header, never a JSON authority claim. `approval` on vision is only the private read approval; it does not authorize external image processing or cost. The media ID must already be attached to the current workflow with matching metadata. The original bytes are loaded on the server, not accepted from the browser.

`createPreparedDesignRuntime` accepts an explicit `candidates` server configuration with `enabled`, `ttlMs` (1000–3600000, no default), model allowlists/config and the operational provider dependencies listed above. It **does not** accept replacement identity, session or media verifiers from that configuration: these are always constructed from the real repository employee gate, authoritative full-session digest loader and `verifyCandidateMedia`. Candidate metadata expiry uses the repository clock. Provider calls occur outside PG transactions. Existing visit-resolution, media, speech, key and legacy routes remain in place.

Verified acceptance:

- Candidate provider/pure contracts: **14/14** synthetic tests.
- Candidate orchestration + actual HTTP/provider modules with mock repositories: **10/10**.
- Existing HTTP handler: **26/26**; default runtime boundary: **2/2**.
- `scripts/test-design-candidate-runtime-postgres.mjs`: **8/8** actual isolated PostgreSQL tests, with actual runtime/HTTP/provider contracts and fixed-PNG native decoding; all external provider/Storage traffic is mocked. The chain covers generation → immutable PG candidate → ID-only employee acceptance → model image-description provenance → separate employee confirmation → full v2 archive → recreated-runtime readback. Each provider invocation checks actual PG activity for no idle executor transaction spanning the call. The isolated fixture container was cleaned up and removal verified.

These counts do not claim production deployment, live model output accuracy, live derivative isolation, external spending approval, or a real cloud/provider integration test.
