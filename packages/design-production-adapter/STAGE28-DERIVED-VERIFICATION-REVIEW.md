# Stage28: private derivative bytes and verification handoff

## Scope and trust

Additive offline preparation only. All features default off. There is no production migration, deployed role, credential, real customer upload, hosted image transformation or paid model call in this stage. No new Linux machine is purchased. Existing v3 PNG/96KiB contracts, model transport196608-byte bound and archived history stay unchanged.

A hash binds bytes; it does not prove a decoder completed, that EXIF/GPS was removed, that orientation/color is correct, or that the hosted service read the intended immutable source. A readback receipt is storage integrity only. The new verifier must read both exact original and derivative versions and independently check all six properties. Missing trusted runtime, unknown/failed checks or invalid measurements fail closed. The current synthetic runtime tests protocol behavior, not vendor image quality or production decoder isolation.

The old Linux worker has a128px PNG limit and is not silently enlarged. No already accepted production verifier exists for the new1024/1536 format. If cleanup/re-encoding changes bytes, it must create a new artifact and parent lineage; this stage never claims cleaned bytes have the old derivative SHA.

## Actual byte path

The existing managed transform can opt into a fixed server-only persistence callback after reading/hash-checking the same response bytes and passing fresh composite authorization. It still returns only pending metadata, never bytes or a URL. The sink copies before awaiting, publishes the matching pending response, then invokes the separate derived store. There is another fresh gate before returning.

The derived store requires an independently issued exact response/target/budget permission and a one-shot durable claim before private immutable put. It reads back and hashes the actual object before recording its version. Fixed target, no upsert, no public preview, no automatic retry. The original upload/storage or transformation cost receipt cannot authorize this different write. Production needs an independent approval bridge; synthetic fixture issuance does not implement one.

Storage and PostgreSQL are not one distributed transaction. Failure can leave pending metadata or a private, unpublished object. Unknown claim/put/commit outcomes never trigger another put or automatic deletion. Private recovery/readback and later lifecycle cleanup need their own reviewed path. A database object version is not proof that the deployed vendor enforces immutable/version-specific reads.

## Independent verification and model preparation

New guarded SQL is isolated-fixture-only and adds separate storage issuer, verifier authorizer and verifier principals. Runtime cannot publish verification. Every task is limited to the exact source/response/object, verifier version/policy and expiry, with current identity/service scope and original processing/cost/claim checks. Revocation and expiration do not extend themselves.

The verification module accepts only server-owned private readers and fixed trusted runtime configuration, not client evidence. It measures real input SHA/length and rejects incomplete decode, multiframe, mismatched dimensions or incomplete six-property checks. Reports bind source/response/object/transform digests and both object versions. Structurally valid report JSON is not independently issued evidence. Timeouts discard late results; nonsettling dependencies retain bounded admission rather than accumulating work. JavaScript cannot enforce a native process sandbox by assertion.

A separate model request preparer is server-only and supports one before-view. It uses independently recorded evidence plus fresh private byte reads and rechecks current authorization before and after preparing the exact body. Its provisional1MiB body budget is separate from the old196608-byte transport. No model is selected by default. Prepared output is not a browser response, not a dispatch authorization and not a confirmed design fact. New-version personal-key/fee approval, exact-body claim/final-dispatch wiring and real model quality remain unimplemented activation gates.

## Existing homepage integration

The original app entry, controller and HTTP client gain an opt-in managed image branch, not another app. Its fixed upload/status endpoints authenticate first and use the immutable repository/service. The private managed card never assigns old uploaded/private_media references, never automatically transforms, attaches to an old archive or sends to a model. Upload/network uncertainty is separate from a technical validation failure.

Status v1 reports only quarantined or pending_validation with candidate/public eligibility false. It is a fresh query snapshot, not a live subscription. A later transform request ID may differ while the original source version stays pinned. Known-media-ID recovery is manual; there is no server list or promised complete recovery after refresh. Full verified/failed status display, model dispatch and new-archive adoption need later versioned integration. No client JSON can manufacture those states.

## Hosted account and deployment gates

Prior read-only inspection reached Supabase sign-in. Current image usage, project transformation setting and Spend Cap remain unknown; no login, feature toggle or paid probe was attempted. Before real synthetic hosted processing: authenticated read-only billing/configuration inspection, explicit data destination/purpose/count and a concrete spending ceiling, tested version-specific reads, a qualified trusted verifier, and separately reviewed minimum production permissions/secret custody are required. No personal API key should be sent in chat now.

Historical old-PG intermittent failure remains unresolved. The Stage27 fixture bugs have specific diagnoses but are not evidence of that older root cause. Fresh authorization is a checked transaction boundary, not an absolute guarantee at arbitrary remote-arrival or physical COMMIT time.

## Acceptance

- Final managed pure/mocked suite207 passes. Verification31, derived store14/ledger11, model preparer13/reader11, persistence sink6, managed HTTP5, UI18 and retained managed contracts are included, not additive double counts.
- Restricted-role real PostgreSQL17 passes the actual transform→root persistence sink→Stage27/28 repository chain with mock private storage, independent verification task/report with mock binary runtime, actual private reader→prepared-only model, raw budget/null/cross-binding rejection, wrong verifier/policy before binary work, revocation/expiry, concurrency and uncertain COMMIT no-reput. Exact cleanup:10 created clients, zero active relay/pool/idle/waiting.
- Separate actual immutable-generation-runtime→HTTP multipart/status→Stage27 PostgreSQL6 passes default-off, authentication/scope rejection, exact approved upload, new-runtime recovery, no permission/no put and uncertain write/nonretryable behavior. Only storage is mocked; this does not substitute for browser or live vendor acceptance. Exact cleanup:4 created clients, all counters zero.
- Original-homepage managed browser11 passes through actual HTTP handler with explicit mocked managed/native backends. Existing prepared browser12 also passes. A second managed11 run verifies final simplified copy and collapsed technical details; mobile/desktop screenshots were inspected. No external network, microphone, real storage/model or browser data persistence. Browser/server cleanup verified.
- Retained media/storage/provider81 and HTTP/runtime59 pass; App smoke20, static-shell15/66 public assets, shell-build, care, task, archive pagination, operations auth/bridge and cross-store checks pass. No iPhone or production performance claim.
- First derived PG run passed11 groups then its malformed scope input threw synchronously before assert.rejects received a Promise. The fixture now uses a valid unauthorized numeric scope; product authorization was not relaxed. Added pure malformed-input/zero-SQL coverage. First failure retained. One regression command named a nonexistent bridge script; corrected bridge/store tests pass separately, with the failed invocation retained.
- Final upstream c80358ad is already included; no conflict, publication or production activation. Failed and final logs, screenshots and complete recovery bundles live in private project evidence, not temporary files or the served app.

Remaining approval boundaries are unchanged: actual hosted fees/data processing and production permissions are not covered by these tests. The full v4 model dispatch/key/billing ledger and new verified/failed UI/archive adoption are not implemented by prepared-only output.
