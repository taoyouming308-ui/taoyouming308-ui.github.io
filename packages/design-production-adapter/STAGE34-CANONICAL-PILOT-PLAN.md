# Stage34 bounded canonical-source pilot (isolated qualification complete; production closed)

This is an offline synthetic-only lane, not production qualification. No real customer inputs, credentials, paid calls, production grants/migrations or deployment.

## Chosen compatibility route

The previous source/hosted-parent v1 contract requires matching MIME and format=origin. Do not pretend that a PNG source produced its JPEG/WebP parent under that contract.

Instead a fixed RGB8 PNG *reference test asset* is part of the trusted runtime policy. The actual source object remains JPEG or WebP. An independent restricted worker:

1. Completely validates/decodes the fixed reference PNG.
2. Re-encodes it with the pinned source encoder and requires exact bytes equal to the actual JPEG/WebP source object.
3. Rebuilds the same-MIME parent using the exact original source and format-origin transform; requires exact parent bytes.
4. Rebuilds parent-to-PNG reference, removes only permitted pHYs after strict container checks, and independently parses/decompresses/unfilters the actual final PNG and reference to compare complete pixels.

This preserves original three-object v1 storage meaning while adding a clearly named `synthetic-pinned-producer-rgb8-v1` report. It does NOT prove arbitrary JPEG/VP8 compressed-stream consumption. Unknown images and hosted producer configurations remain unsupported. The reference asset is not falsely labelled as the customer source object.

## Separation of authority

- Independent predecode processing approval and durable once claim bind exact source/parent versions, authority, fixed normalization policy and request ID before native work.
- A claimed-artifact wrapper records immutable linkage, never decode proof.
- Existing Stage33 storage remains quarantine under its separately issued storage permission and separate restricted connection. Processing approval does not grant PUT authority.
- A new independent strict verifier task binds the current claimed artifact, actual normalized private object receipt, runtime policy and fixed fixture. Only its restricted verifier may publish the narrow report.
- Old generic reports cannot substitute for the strict profile. The new mock-only model preview lane uses this proof but never dispatches. A future real model path must additionally integrate the original personal-key/approval/send ledger; that work is not complete. No implicit adoption or archive migration.

## Minimal user trial objective

A small number of fixed synthetic fixtures should traverse real bounded local image processing and real isolated persistence/verification, with model transport mocked and clearly labelled. This tests process and safety, not hairstyle quality. Only after these engineering gates should owner-approved hosted settings, bounded costs, customer-data permission and secure key input be requested.

## Actual acceptance and remaining boundaries

- Real isolated restricted-role PostgreSQL processing suite: 13 checks; independent task/report suite: 16 checks. Fixtures retain explicit storage/issuer separation, current authority checks and failure/unknown receipt tests.
- First real coordinated PG + pinned local worker run passed three groups: JPEG and WebP fixed synthetic fixture chains (7.27s/7.11s total), plus an appended-source attack rejected before source decode. These are two test images, not customer cases. Both positive chains used actual processing claims, actual PNG generation, new independent tasks, actual canonical verification and mock-only candidate preview. Processing revocation blocked verified reads/preview preparation. Duplicate claimed normalization did not invoke native work again.
- Object storage remains a version-checking private Map fixture, not a cloud guarantee. Model response is synthetic and never sent. No real browser was newly exercised in this server-only stage.
- The fixed PNG reference is 80x120 and requested maxEdge is 1024 without enlargement. This is not acceptance of 1024px customer photographs or hairstyle quality. Exact reconstruction is deliberately restricted to the pinned synthetic producer; arbitrary JPEG/VP8 consumption remains unproven.
- Task/report issuer authority is a trusted boundary. Verification itself has no durable execution-once claim: after uncertain publication this runner instance blocks resend and callers must query status; constructing a new runner is not a claimed database guarantee against repeated verification. Normalization has a durable once claim before native execution. No model is dispatched by either operation.
- Runtime/issuer revocation is checked before/after operations, not an impossible promise of absolute authorization at final wall-clock commit. Existing global transaction serialization and bounded operations remain, without extending permission TTL.
- Production hosted usage/settings/SpendCap, actual cloud object immutability, qualified arbitrary customer-photo processing, new strict-proof real model/key/fee-ledger dispatch and employee-confirmed archive adoption remain closed. Original intermittent PG failure root cause remains unresolved despite these passing isolated runs.

The immediate owner trial can only be a clearly labelled synthetic local process demonstration. No API key, paid hosting or customer upload is needed for that demonstration. Before real-photo/model testing, separately establish a qualified processing route, private storage/deployment configuration, specific recipient/data authorization, spending bounds and secure key entry.

Final eight-module pure aggregate: 130/130; release/version/sync/public-shell gates pass. Independent final read-only review found no confirmed new blocker. This is not the complete historical production/browser suite.
