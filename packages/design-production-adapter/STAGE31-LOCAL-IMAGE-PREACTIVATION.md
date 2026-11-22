# Stage31: image preactivation and local qualification

Checked 2026-11-16. This is not production activation, a hosted-service qualification, or permission to process customer data.

## Observed account/environment facts

Read-only Supabase connector calls confirmed the existing organization is Pro, has one active project in us-east-1, and has no development branches. Current connected tools expose no dedicated usage, Spend Cap, or Storage image-toggle reader. The existing Chrome session redirected the organization's Usage page to sign-in; no login, credential use, upload, billing or configuration change was performed. Actual usage, invoice estimate, feature toggle and Spend Cap remain unknown. Do not infer their values from the Pro plan.

Local Docker inspection found existing official imgproxy v3.8.0 and Storage API v1.62.5 images. Their pinned digests are recorded in the private stage31 evidence. Supabase CLI is 2.109.1; no upgrade or image download is authorized. Current official changelog identifies CLI v3 behavior changes, so use the installed version's help rather than assuming v3 commands. This task's local test uses Docker directly, not a linked Supabase CLI project.

## Least-cost order

1. First qualify synthetic image behavior locally with existing pinned images, no external networking and no production data. This incurs no hosted transformation/model fee. Passing does not establish hosted version/configuration/CDN behavior.
2. Only if hosted qualification remains necessary: owner signs in and reads organization Usage (billing period and transformed-origin count), Billing (Spend Cap and Upcoming Invoice), and project Storage Settings (image-transform toggle). Read first; do not change controls.
3. Confirm the target organization, region, total budget, maximum lifetime and disposable test scope before requesting the account-specific project/branch quote or creating resources. Prefer a blank temporary project over cloning production migrations, seeds, functions or integrations. A branch is another option only after those inherited effects are reviewed. No existing isolated hosted environment was found.
4. Keep test inputs synthetic, credentials project-scoped, buckets private and URLs server-only. No customer archives or DeepSeek credentials are needed for this qualification. Explicitly arrange cleanup/stop ownership and a durable deadline before starting any chargeable environment; Spend Cap is not a project lifetime timer.

## Cost estimate, not an account quote

Micro compute is $0.01344/hour, with partial hours rounded up; 24 billed hours are $0.32256 before tax. Compute is not covered by Spend Cap. Existing organization credits cannot be assumed available. [Compute pricing](https://supabase.com/docs/guides/platform/manage-your-usage/compute).

Pro includes 100 transformed origin images per organization billing cycle; overage is billed in whole $5 packages of 1,000 origins. Multiple variants of one origin do not independently consume an origin. A bounded 24-origin experiment could add $0 or one $5 package, depending on existing usage. Failed request billing is not assumed free. [Transformation billing](https://supabase.com/docs/guides/platform/manage-your-usage/storage-image-transformations).

A possible hosted experiment cap is 24 origin files, 64 total requests, 0.5 GB stored, 1 GB egress and at most 24 hours. Excess uncached egress costs $0.09/GB; excess storage is $0.00002919/GB-hour. Taxes, account-specific quotes and other organization activity are not included. A proposed $10 test authorization would be a user decision, not a guaranteed provider-enforced ceiling. [Egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress), [Storage](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size).

Preview branches also incur compute from $0.01344/hour, do not receive compute credits, and are not covered by Spend Cap. Do not call them free sandboxes or disable organization Spend Cap just to test. [Branch billing](https://supabase.com/docs/guides/platform/manage-your-usage/branching), [Cost controls](https://supabase.com/docs/guides/platform/cost-control).

## Processing and revocation boundaries

Hosted transformation means sending image bytes to Supabase infrastructure, not processing only on the owner's phone. The observed project's region is us-east-1; it is not evidence that every CDN/support processing activity stays there. Supabase describes itself as a processor following customer instructions; the customer remains responsible for appropriate notices/consents. Its published subprocessor list includes hosting/CDN providers, but the list alone does not show that a particular image is sent to every listed provider. No model-training or zero-retention promise is inferred. [DPA](https://supabase.com/legal/customer-resources/data-processing-addendum), [Subprocessors](https://supabase.com/legal/subprocessor-list/October-12-2026.pdf).

Current Smart CDN documentation says signed responses may remain cached beyond token expiry, and object deletion propagation can take up to a minute. Therefore a short signed URL is not an immediate revocation guarantee. Keep provider URLs out of client responses and logs; use the server authorization gate for every new read/delivery. Bytes already delivered cannot be recalled. A content hash is not proof of immutable server object versions, metadata removal, or future authorization. [Smart CDN](https://supabase.com/docs/guides/storage/cdn/smart-cdn).

The hosted documentation supports private transformations and 1024/1536 dimensions within its limits, but does not establish the exact EXIF/GPS/ICC/orientation behavior needed by this app. The application's stricter byte/pixel limits must not be silently widened to the hosted limits. [Image transformations](https://supabase.com/docs/guides/storage/serving/image-transformations).

## Local test security and acceptance

Execution is separately authorized for existing trusted images and synthetic inputs only. Planned controls: fixed digest, pull=never, network=none, no host port, non-root, read-only root/input mount, bounded tmpfs, CPU/memory/PID limits, cap-drop ALL and no-new-privileges. If a separate Node requester is needed, it shares only the isolated image container's loopback namespace, overrides the Storage image entrypoint and does not start Storage or inherit production settings. No host Docker socket is mounted into either container.

Use asymmetric synthetic color/orientation charts and fabricated metadata. Check actual decoded pixels and raw metadata structures with an independent local reader, not a mock report or a digest assertion. Test all eight EXIF orientations, EXIF/GPS/XMP/ICC, color conversion, target geometry, corrupt input, byte/pixel boundaries and resource settings. Record what is untested; rejection tests and configured limits are not a proof against every decompression/resource attack. Keep product verifier/hosted/model switches closed regardless of these results.

Local execution has completed with partial qualification only. All eight EXIF-orientation inputs produced correct PNG geometry and zero mean pixel difference against independent auto-orientation; listed EXIF/GPS/XMP/ICC/text metadata was absent. Display P3 → sRGB PNG output matched the independent reference with zero mean error and no ICC chunk. Synthetic 1024×768 and 1536×1152 outputs were 4,665 and 8,794 bytes, respectively; this is not a general image-byte budget guarantee. A 40,000,000-pixel input was accepted; 40,004,000 pixels rejected with 422.

Important failures remain explicit: JPEG and WebP each retained a 186-byte EXIF block with 12 normalization/resolution/version/dimension tags. Original GPS/XMP/IPTC/comment sentinels were absent, but this is not an EXIF-free result, so those formats remain ineligible under the strict current contract. Exactly 8 MiB was rejected by the local processor, contrary to the application's inclusive ≤8 MiB boundary; no limit was enlarged to hide this mismatch. Final boundary results: 8 MiB minus one byte accepted and fully decoded; exactly 8 MiB and plus one byte rejected with 422; a damaged JPEG rejected with 500. Traversal and non-local HTTP sources rejected with 404. Independent review of the preserved server log confirms both source cases failed at the allowlist (`Source URL is not allowed`), not after fetching/decoding. The script currently automatically asserts non-200 only; this causal classification is from the separate log review. Removing metadata never makes a face/photo anonymous.

Evidence identifies exact image and reader versions, command controls, source/output hashes, assertions, failures and exact cleanup. No production verified flag may be inferred from this document. All created containers were exactly removed; no external route, published host port, image pull, hosted call or production access occurred. Fixed source-prefix patterns are not a general exact-object authorization scheme; the isolated input mount contains only generated test files.

## Old intermittent PostgreSQL issue

Stage25 calibration passed 10 checks and distinguished lock timeout 55P03, lifecycle digest mismatch and connection termination. It did not reproduce the original Stage7 failure. The original underlying SQLSTATE, function position and timing were not retained and cannot be reconstructed from later passing runs. Stage30's deterministic syntax/policy/alias defects are not its root cause.

Reuse `scripts/diagnose-design-legacy-stage25.mjs` and `scripts/test-design-postgres-executor-integration.mjs --stage25-calibration`, plus `scripts/fixtures/design-legacy-diagnostics.mjs`. Before another one-shot fixed-seed isolated reproduction, add correlation for fixed query-template ID, lease/query/transaction IDs and BEGIN/COMMIT/release monotonic times. Retain only allowlisted SQLSTATE and function/line information, never raw SQL, parameters or error context. On first failure preserve the bounded ring and commit-known/unknown state; do not retry uncertain append. Existing SQL/lock limits and default HTTP 30 seconds remain unchanged. Current diagnostics lack complete function-line and connection/transaction lifetime correlation and are not themselves HTTP timeout acceptance. No PG run was performed in this read-only preparation.

## Next implementation decisions

Do not weaken the strict metadata contract to make JPEG/WebP pass. A future separately reviewed path may decode/re-encode to a strictly inspected PNG, with new source/derivative binding and byte-budget checks, or continue rejecting those outputs. This local result does not qualify a production worker: its source namespace, authentication, durable authorization and runtime hardening must still be integrated and tested. The inclusive app size boundary and the local library's strict boundary need an explicit compatibility choice; no resource limit was increased here. No hosted fee or model credential is necessary to decide these local code questions.

Exact version source evidence for the two test-environment findings: [v3.8 source allowlist configuration](https://raw.githubusercontent.com/imgproxy/imgproxy/v3.8.0/config/configurators/configurators.go) uses prefix/glob patterns rather than caller-supplied regular expressions; [v3.8 hard limit reader](https://raw.githubusercontent.com/imgproxy/imgproxy/v3.8.0/imagedata/read.go) explains the exact-size EOF boundary. The first rejected request was a test allowlist configuration error, not a decoder failure.
