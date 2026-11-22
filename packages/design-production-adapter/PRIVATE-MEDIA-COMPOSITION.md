# Private media composition and controlled decoder boundary

`createPrivateMediaService` in `private-media-service.mjs` is disabled by default. It composes the actual private-media validation/approval contract and the existing private Storage protocol with explicit server-only dependencies:

- `permissionGate`, `approvalVerifier`, `imageInspector`
- `metadataRepository` with `withScopeLock(binding, work)` and `verifyRecords(binding, records)`
- fixed `storageOrigin` and bounded, credential-internal `storageTransport`

Its public methods remain `upload`, `read`, `resolveReferences` with the existing HTTP shapes. No new client authority, endpoint, URL, key, photo-model format or bearer link is introduced. The root runtime must construct the PG metadata repository per request with `resolveCredential: () => input.credential`; owner/store claims in a binding are not credentials.

## Short transactions, immutable objects, fresh checks

This composition deliberately does **not** use the Stage6 publication bridge that awaits object I/O inside its metadata callback. It instead:

1. Authenticates the exact employee/store/customer/visit/source binding. Reads committed metadata in short authoritative transactions.
2. Fully decodes bytes, verifies exact upload purpose/recipient approval, stages an immutable private object, and checks its readback **outside all metadata locks**. Original-byte reads are likewise outside locks.
3. Opens a second short metadata transaction, compares every previously observed record, inserts only the immutable staged metadata, and runs the original private-media beforeCommit guard. A concurrent identical publication can converge; a changed/revoked row cannot.
4. Uses the transaction's `tx.permissionGate` during that guard. Context is request-local and reset in `finally`, never a shared global. Approval verifiers receive a fourth argument `{transaction: tx | null}` and must use same-transaction policy queries when non-null. They must not wait for user interaction, network calls or another connection taking the same locks. Pre-obtained approval receipts are checked here, not elicited here.
5. After transaction return and final outer approval, calls `verifyRecords` in a fresh authoritative transaction, then rechecks the employee before releasing the result. This fresh verifier checks active state and the exact complete records, not only existence. No expired transaction handle is reused.

Storage's per-request authorization closure checks the actual credential and complete fixed binding, never a browser-supplied actor. The injected Storage transport never receives that employee credential. It must enforce the descriptors' byte/time caps and no-redirect policy and must keep its separately authorized server credentials out of application data/logs. No such real credential transport is enabled by this change.

This is **not distributed atomicity**. Staging may succeed and metadata publication fail. Such objects remain private orphans, with no public read path, overwrite or automatic deletion. After staging is attempted, failures report uncertain; an explicit identical request may reconcile. Metadata commit acknowledgement loss is also uncertain. A subsequent same-ID upload verifies committed metadata plus original bytes and does not issue a new POST. A process restart test is not evidence of cloud disaster recovery. Operational orphan retention, cleanup authorization and private bucket policies remain separate deployment work.

## Decoder deployment remains fail closed

The native decoder still defaults to strict hard-address-space limits. This Mac cannot satisfy them. The composition does not automatically select native executables, enable `syntheticOnly`, download binaries, start a container, or translate an attestation flag into proof of production isolation.

A real-data deployment requires a separately reviewed, controlled Node/native worker or approved equivalent: immutable maintained decoder build, full-pixel decode, no network egress, restricted worker identity, ephemeral narrowly mounted filesystem, enforced OS hard memory/CPU/process/FD limits, bounded request/output/wall time, global admission and rate limits, and verified teardown/crash cleanup. No such production worker has been deployed or certified here. The prior ImageMagick pin is the tested installed version, not a current-security certification. RLIMIT plus ImageMagick policy is not an OS sandbox. The existing Edge runtime cannot directly run this native subprocess module.

For local acceptance only, `scripts/fixtures/design-private-media-native.mjs` constructs one known 3×2 blue PNG from fixed pixel bytes. `createSyntheticWhitelistedInspector` rejects any different SHA-256/length and NODE_ENV=production **before** invoking the actual complete native decoder with explicit synthetic-only Mac mode. This is a test helper under scripts, not a production fallback or a classifier that can identify arbitrary synthetic images. Original EXIF may remain in accepted private originals; no external derivative or provider image transmission is authorized or implemented.

## Acceptance

`node scripts/test-design-private-media-service.mjs` exercises actual complete native decode with the fixed PNG and injected metadata/Storage mocks: lock-free object I/O, same-transaction authorization, restart/replay, readback reconciliation, unpublished orphans and withdrawal checks. This suite alone is not real PostgreSQL or cloud acceptance. The separate shared PostgreSQL composition suite documents its actual executed results when available.

`node scripts/test-design-private-media-postgres.mjs` has also passed **7 tests** using the shared, isolated PostgreSQL 17 harness: actual executor/repository, actual complete fixed-PNG decoder, and the actual Storage protocol adapter with mock transport. Each object request queries real `pg_stat_activity` to reject an idle executor transaction across object I/O. It covers fresh connections/recreated service same-ID replay, immutable rows/cross-scope rejection, lost object acknowledgement, orphan recovery, lost metadata acknowledgement, and actual PG revocation tombstones. Container cleanup was verified. This is service recreation/new-connection persistence, not a power-loss or PostgreSQL process-restart durability test, and it does not certify live bucket access. The native/metadata-mock contract suite passes **10 tests** independently.
