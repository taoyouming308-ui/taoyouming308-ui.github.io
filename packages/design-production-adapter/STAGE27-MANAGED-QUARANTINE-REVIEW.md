# Stage27: isolated managed upload and durable authority

## Scope

Default-off additive server contracts/service/repository preparation only. Old private-media upload, local decoder, PNG derivative, v3 provider/approval and archive histories are not converted. No production migration, role grant, key, customer bytes, hosted transformation or model call is authorized or performed. All external transports in acceptance are mocks; any PostgreSQL fixture is isolated and explicitly guarded against production installation.

## Quarantine is not decoded media

An upload intent binds current immutable employee/service authority, exact server-selected private destination, source SHA/length/declared MIME, media/request ID and its scoped storage approval. The storage-generated object version cannot be known before uploading: approval covers the exact upload intent without inventing that version. A one-shot claim precedes storage dispatch. Only a trusted successful storage response supplies the observed version for subsequent current-scope publication. Unknown storage/commit outcomes never automatically re-upload, delete or issue a replacement authorization.

A persisted source remains `quarantined` and unpublished. Client dimensions, EXIF flags or a successful put cannot create a full-decode assertion. The new source record intentionally has no invented dimensions. A separate trusted preflight declaration must bind the exact persisted source digest/version/bytes hash to confirmed display dimensions and orientation before Stage26's transformation source resolver can succeed. Its issuer is separate from runtime and cannot silently confer processing or cost permission. The actual provider of this preflight is still a production integration decision, not implemented by mocked evidence.

## Version and evidence boundaries

An immutable source record, pending managed-response wrapper and later evidence use separate schemas and digests. Source digest/version/request/hash mismatch is rejected, not treated as a correction or a new historical author. Expected source SHA is not proof that Supabase transformed those exact bytes. Database anchoring and pre/post equality cannot rule out a mutable object being replaced and restored during I/O. Production still needs verified object immutability or supported, tested version-specific transformation semantics.

This slice persists source/response metadata, not the transformed image binary. Stage26 still discards response bytes after bounded hashing. A later reviewed private derivative store/validation handoff is required before a real verifier or model can consume them; a persisted response hash is not a saved picture.

The new image-input candidate is not a model observation or an App archive entry. Provisional independent caps are256KiB at1024 and512KiB at1536 for JPEG/PNG/WebP. These are not real-model quality or body-size acceptance. Unknown/failed source binding, full decode, metadata removal, orientation, color or geometry blocks technical readiness. Even structurally complete evidence does not authorize submission, public display or adoption. Only a trusted verifier and fresh authorization can give an evidence record meaning; arbitrary client JSON cannot.

## Durable authorization

Separate storage, preflight, processing and cost issuance must remain distinct. Runtime may persist pending metadata and one-shot claims through fixed capability functions, not issue approvals or upgrade an upload to a trusted preflight. Each operation resolves the current immutable employee authority rather than reusing display-name identity or a cached grant.

The managed-transform hooks use short database transactions, not a lock held over a network call. Final composite verification checks source identity/version, current access, preflight, exact processing/cost intent, claim and expiry. The final check is a checkpoint, not a guarantee at an arbitrary later physical COMMIT, remote receive or billing instant. Unknown commit or a preexisting claim cannot yield another `created` result. No automatic TTL extension or retry is introduced.

Storage authorization before a put is separate from transformation processing/cost authorization. Supabase Pro eligibility is not a cost receipt. Budget/recipient/count/expiry must be explicit, and real quota must not be assumed unused. The numeric ceiling is an approval limit, not an observed provider quote or a guarantee of vendor billing enforcement; a real independent cost issuer must verify a conservative charge including package/egress/tax effects. Model transmission would need a later distinct exact-body and recipient/cost approval; this slice has no such send route.

## Read-only hosted-account inspection

The available connector has no dedicated current image-usage/project-toggle/Spend-Cap reader. Native Chrome was inspected read-only; opening the official Supabase dashboard reached its sign-in page, not an authenticated organization or project. No login, credential entry, settings action or transformation probe was attempted. The temporary tab was closed. Therefore all three values remain unobserved, not zero or disabled.

Before an actual hosted synthetic test, an authenticated read-only dashboard check must establish organization billing-period usage, project transformation setting and Spend Cap. Turning on a feature or changing a cap is a separate action, not part of this check. Test-image recipient/purpose/count and a concrete fee ceiling must be approved before any potentially billable transformation. No VM purchase is requested.

## Acceptance record

Pure final suites pass92 (transform27/contracts27/service28/ledger10). Retained private media/storage/service/provider tests pass57. App smoke20, static shell/build, care, task state, archive rendering, auth and cross-store guards pass. Chromium loopback shell15 passes with65 explicit public assets; external requests are blocked. Initial sandbox Chromium launch failed before testing (MachPort permission); the approved local-only test subsequently passed without changing system settings. These are not production/iPhone performance results.

Actual restricted-role PostgreSQL final acceptance passes16/16. First full run stopped at storage issuance because the new capability lacked EXECUTE on the existing pure canonical helper; a bounded diagnostic identified SQLSTATE42501. The narrowly scoped fixture grant fixed that, without changing existing helper definitions or production roles. Second run exposed PostgreSQL's regex repetition bound (2201B); the same key whitelist now uses a separate1–1024 length check. A fresh restricted-role diagnostic passed7 including1/1024 acceptance and1025/traversal/empty-segment/illegal-character rejection. Third full run passed the first3 groups then stopped at the real service transformation composition. A bounded cause comparison then confirmed42501 on the immutable claims table: FOR SHARE incorrectly required UPDATE privilege. Only this redundant claims row lock was removed, without granting UPDATE; the same advisory transaction lock, immutable trigger/primary key and source/preflight/receipt locks remain. The actual service upload→preflight/dual approvals→mock transform→publication→fresh reconstructed service read passed. Final full16-group rerun passes: actual service composition/reconstruction, separate nonowner issuers, raw SQL null/A-to-B denial, concurrent one-winner claims, lost COMMIT receipt without redispatch, revoked/expired approval, wrong scope and changed identity epoch, no bearer/body persistence and unchanged old provider/identity definitions. Exact cleanup reports22 created clients and zero active relay/pool/idle/waiting resources. All external storage/transformation responses are mocks. All failed runs and exact pool/relay cleanup remain in private evidence. None identifies the historical old-PG intermittent fault.

A read-only final review found no confirmed additional blocker in error sanitization, lease lifetime, uncertain-client quarantine or the narrowly scoped canonical grant. Client quarantine depends on the trusted driver preserving identity and destroying bad connections; it is not a vendor connection certification.

Passing mock/isolated database tests will not prove vendor EXIF/GPS removal, orientation/color quality, conditional version reads, deployed RLS/TLS, secret custody or production throughput.

## Upstream preservation

Final fetch discovered upstream c80358ad (MGJ source transport). A focused Stage27 checkpoint was committed first, then a non-fast-forward local merge preserved both histories without conflicts. Post-merge managed92 and version/release/sync checks pass. Four upstream transport/daily/backfill suites pass23 using the existing system Python; initial direct-script import and default-Python missing-cryptography failures are retained, not repaired by installing packages. No push/deploy occurred.
