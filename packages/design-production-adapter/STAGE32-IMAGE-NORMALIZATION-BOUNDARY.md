# Stage32: local normalization and inclusive upload boundary

Production remains disabled. Only synthetic bytes and already-installed digest-pinned official images were used. No hosted transformation, credentials, customer data, production permissions, paid call or image pull is authorized by this work.

## Inclusive source limit

Browser file preparation, client upload and server private-media input share `IMAGE_UPLOAD_MAX_BYTES = 8,388,608`. Only a known input byte count above that bound produces the explicit too-large / not_sent response (HTTP 413). Unknown provider failures and uncertain receipts are not reclassified as size failures or automatically retried. Failed replacement selection retains the prior selection and text draft; late reads/errors cannot cross customer, record epoch or closed-view boundaries.

The local pinned imgproxy 3.8.0 reader probes EOF at its configured limit. Its internal read limit is therefore 8,388,609, while the application bound stays 8,388,608. Real isolated direct requests accepted limit−1 and limit, rejected limit+1 (422), and rejected a malformed image (500). This is a version-specific local adapter test, not a hosted configuration claim. Derivative/model budgets and the existing Python worker limit are unchanged.

## New, separate normalization artifact

The previously observed JPEG/WebP generated EXIF is not declared harmless or metadata-free. A fixed controlled decoder produces static RGB8 PNG, and the narrow container pass validates chunk lengths, CRC, order and geometry, removes only pHYs, and rejects unknown/animated/trailing chunks. Independent full decoding, parent orientation/frame/profile checks and exact pixel comparison remain required. A matching hash or injected callback returning true is not independent proof.

The source record, hosted parent response and parent private-object receipt retain their original hashes and versions. The normalized PNG has a separate output hash/MIME and fixed policy. It remains pending_validation, not a replacement verified receipt; the old v1 verifier is not relaxed. A trusted consume callback receives bytes and this pending artifact, not a fabricated storage version or automatic model/adoption permission.

Fresh authorization is required before and after meaningful awaits. Once-claim, timeout, cancellation, uncertain-result and no-retry boundaries are retained. This local composition does not supply a durable claim repository, production decoder/inspector service or production credential issuer.

## Remaining activation gates

- Real private normalized-object persistence/readback and three-lineage verification issuance, with durable current approval, request ledger, PG and candidate integration, are still separate work.
- Hosted transformation enablement, current organization usage, Spend Cap and exact online decoder/configuration behavior remain unverified; no dashboard login was attempted.
- Local hard resource limits are not exhaustive adversarial qualification. Production isolation, lifetime, decoder patching and independent verifier deployment require review.
- Real model quality/latency and customer data-processing approval remain untested. No API key is needed now.
- The original intermittent PostgreSQL failure still lacks its original SQLSTATE/timing evidence. Later clean runs do not establish its root cause; retain correlated bounded first-failure diagnostics as an activation gate.

## Local real-image observations

Two generated-EXIF parents (one JPEG, one WebP) normalized successfully. JPEG 867 bytes became raw PNG 1,093 bytes and final PNG 1,072 bytes; WebP 406 became 780 and 759 bytes. Final files contain only IHDR/IDAT/IEND. Independent ImageMagick decoded each to 28,800 RGB bytes exactly equal to its parent, with parent files unchanged. Raw/final SHA and output files are preserved in private synthetic evidence. This proves these parent-to-normalized sample transformations, not the original customer's source-to-parent lineage.

Real synthetic orientation=6, multiframe WebP and P3 ICC parents were rejected before normalization (zero normalization calls). A high-entropy JPEG expanded to 1,102,211 bytes and was rejected against the unchanged 262,144-byte budget, with zero consume and no fallback retry. These are engineering fixtures, not customer cases or a haircut/perm/color efficacy bank.

A read-only review found that a failure after consume could be confused with a pre-write refusal. The error now explicitly marks consume-attempted failures uncertain, including late revocation and timeout; pure regressions cover both. No artifact is exposed on failure and the instance remains poisoned against replay.

The real test exercises container → the same JavaScript PNG cleanup helper → independent full pixel decoding. Authorization/claim/consume orchestration is separately mocked; these two tests are not a durable production end-to-end path. Comprehensive JPEG/WebP compressed-extension and trailing-payload validation is not implemented by the real sample harness. Production inspectParent must provide a qualified full-container check; ImageMagick successfully reading pixels alone is insufficient. PNG unknown/APNG/trailing/CRC rejection is covered by pure negative fixtures and strict real output parsing, not an exhaustive decoder attack corpus.

## Browser test boundary

The new original-homepage upload regression passes 11 checks through actual UI/client/HTTP/service with synthetic repository/storage. It covers exact-limit upload SHA, direct over-limit HTTP 413, retained selection/draft, late-result isolation and unknown-receipt original-ID recovery. It does not run PostgreSQL or an image decoder. Initial Chromium sandbox launch denial (zero cases) and a first fixture-only scope-key-order failure (4/11) are preserved. The fixture was corrected to full semantic equality with wrong-visit/source/extra-field negative controls; no product permission or deadline was relaxed.

Visual review also found that the existing selection controls displayed default stage/angle after rerender although the selected file retained its actual metadata. Controls now display the selected metadata and are locked while a selection/upload/unknown request exists. To change stage/angle, clear the local selection first and select again; no metadata write API, automatic history revision or silent relabeling was added.
