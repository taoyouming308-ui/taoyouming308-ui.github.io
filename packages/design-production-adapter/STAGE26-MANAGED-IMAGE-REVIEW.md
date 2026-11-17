# Stage26: managed private-image transformation preparation

## Decision and limits

Prefer evaluating the existing Supabase Pro service over purchasing another Linux host. Root's independent architecture review verified the organization's plan; this task does not infer that all project features are enabled or unused. Existing Linux image-worker checks remain unchanged and optional as a separate deployment path, not a universal requirement for image handling.

This slice is an isolated, default-off managed adapter and mock contract verification. It does not activate Supabase transforms, upload files, obtain credentials, alter buckets/RLS, contact a model, or deploy. HTTP200 is not full decode, metadata removal, correct orientation/color, or proof that returned pixels came from the claimed original. No new result is accepted by the existing candidate/provider/SQL approval contracts.

## Official service evidence (2026-11-16)

- [Transformation guide](https://supabase.com/docs/guides/storage/serving/image-transformations): Pro and above; a separate project Storage Settings toggle; authenticated private download with transform options. Explicit `contain` preserves aspect ratio instead of default `cover` cropping. `format=origin` avoids automatic WebP negotiation; it does not request PNG or prove metadata stripping. Width/height1–2500, source25MB/50MP are provider maxima, not permission to enlarge this App's input limits.
- [Usage guide](https://supabase.com/docs/guides/platform/manage-your-usage/storage-image-transformations): Pro includes100 distinct origin images per billing cycle; overage is billed in whole1000-origin packages at$5. Organization-wide usage matters. Requests, variants and origin-image counts are not interchangeable. Storage/egress are separate cost categories.
- [Download reference](https://supabase.com/docs/reference/javascript/file-buckets-download) lists `versionId`. Exact deployed SDK/server support for a transformed version-specific read is unverified; no guessed query parameter is used as an integrity guarantee.
- [Changelog](https://supabase.com/changelog.md) checked: relevant recent TLS and CLI breaking changes do not authorize upgrading or deploying anything. No CLI or package upgrade is performed.

Available connector tools do not expose a dedicated current image-usage/toggle query. Pro plan alone does not establish current remaining quota, Spend Cap state, enabled transformation state or zero marginal charge. Those remain unknown until verified read-only in the appropriate organization usage and project storage settings UI. Never probe them by making a potentially billable image request.

## Intended source and authorization boundary

The browser submits an existing media ID and approved size preset, not a bucket, URL, object path, source hash, decoder flags or arbitrary transform options. A trusted server source resolver must use the current immutable employee identity, service relationship and active media record to select an exact private object. No client-supplied authority object is accepted.

Source metadata and authority are reread around awaits. Cost approval and data-processing authorization are separate current decisions. A persistent attempt claim must precede dispatch; it does not replace a fresh check immediately before sending. A final composite guard must verify the same current source/identity/processing/cost intent after earlier awaits and immediately before dispatch or return; separate checks alone leave a withdrawal window. This guard and the durable claim are trusted server dependencies, not a completed production approval repository. Unknown dispatch/timeout must not automatically repeat a transformation. Managed transformation permission is distinct from private storage permission and from subsequent model transmission permission.

Existing storage writes use `x-upsert:false` and verify read SHA/length, but this does not prove all server writers cannot replace an object. Before production, demonstrate immutable content-addressed object creation with appropriate policies, or actual version-specific transformed reads. A before/after matching source cannot exclude replacement-and-restoration during processing. Therefore the preparation records an expected source digest/version, not an independently attested transformation lineage.

A future transport must attach least-privilege server authorization privately, reject redirects, bound streamed bytes/time, avoid public/signed URL exposure and payload logging. Using service-role storage access would bypass RLS; it cannot be treated as employee authorization. No service-role credential is requested or configured here.

## Separate provenance and validation

New managed evidence must retain provider, fixed transform parameters, expected source identity/digest/version, actual response digest/type/length, request identity and explicit pending verification status. Never synthesize old `decoded:true`, `metadataRemoved:true`, `metadata_stripped` or a local-worker attestation.

1024/1536 are proposed aspect-preserving upper bounds, not a promise of sufficient analysis quality. Unknown EXIF orientation/color handling remains pending. No enlarged dimensions should be presented as additional real detail. A returned byte stream is not made public or sent to a model by this adapter.

Actual acceptance needs a controlled synthetic corpus: orientation1–8, GPS/EXIF/XMP/comments/thumbnails, ICC/color patches, PNG/JPEG/WebP, invalid/truncated/trailing or animated input, excessive dimensions/bytes, output limits, processor errors, object replacement, revoked/expired identity or approval, interrupted replies and late completions. Mock tests validate handling of these categories as unverified data; they do not establish the vendor's actual transformation behavior.

## Integration work deliberately not bypassed

1. Existing upload requires a trusted full decoder before publication. A future managed-first upload needs a separate quarantined/unverified state and bounded private staging/retention; it cannot report a header check as full decoding.
2. Existing model derivative contracts require PNG,96KiB single image or48KiB each comparison image, total request196608bytes and exact old metadata assertions. A reviewed new candidate/body/budget/approval version is needed for larger managed images; old candidates, hashes and replays stay unchanged.
3. Independent current authorization must bracket source resolution, processing, validation and final delivery. Transform permission does not grant future reads or model sending. No absolute physical-COMMIT/network-arrival authorization guarantee is claimed.
4. Decide an evidence standard for hosted processing: actual output metadata checks, independent safe decoding or a separately reviewed provider trust contract. Avoid recreating the Linux-only requirement without evaluating a managed security boundary, but never claim an unimplemented validator exists.
5. After data and cost authorization, run bounded synthetic hosted tests on the selected project first. Only after proof of private access, source binding, quality and data handling should a single-owner real-photo pilot be considered.

## Decisions and approvals

No VM purchase is requested. First obtain read-only usage/toggle/Spend Cap evidence. Before real service calls, approve the exact synthetic files, recipient/project, purpose, count and fee ceiling including possible first overage package and egress. Any toggle, credentials, durable service access or security/permission change requires its own applicable approval. Real customer originals, model recipients and model fees require separately scoped authorization. Keys must never be pasted into chat.

## Verified local checks

`npm run test:design-managed-image`:27 pure/mock checks pass. Includes default disabled, exact selectors/source bounds, immutable identity change, independent processing/cost denial, duplicate/unknown claim, post-claim change, final-source-wait withdrawal, response revocation, EXIF/GPS/ICC bytes held as unvalidated, wrong response/MIME/redirect, streamed byte/chunk/deadline limits, invalid/late response cancellation and safe errors. No hosted behavior was tested. Retained media22/storage11/service10/provider14 and App smoke20/shell-build/care/task/archive/auth guards pass. The initial shell rebuild detected unsynchronized secondary entry version labels; all three entry labels/asset versions were synchronized and release checks pass.
