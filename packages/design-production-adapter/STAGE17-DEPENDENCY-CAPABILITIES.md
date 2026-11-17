# Stage17 fixed dependency capabilities

Offline, reviewable preparation on baseline `514573a2`. This is not installed in a
production database. New files are additive; the Stage16 text-only API remains
closed to media/candidate/full publication and is not silently redirected here.

## Composition and ownership

`dependency-authority-capabilities.mjs` accepts one trusted, already leased PG
connection. It exposes no SQL string, table selector, connection configuration,
permission grant or credential discovery API. The repository owns BEGIN, isolation,
fixed timeouts, the existing global lock, final guards, COMMIT/ROLLBACK and uncertain
lease disposal. A handle pins the exact credential, scope and full immutable
identity, rejects concurrent use, poisons after errors and closes after clear.

The isolated fixture installs `design_dependency_authority` after Stage16. Fixed
functions execute as a NOLOGIN, non-table-owner, NOBYPASSRLS capability role. A
separate manifest issuer LOGIN can issue/revoke read manifests; runtime cannot mint
one or mutate the protected tables directly. These disposable grants do not modify
any production role. RLS here is defense in depth around trusted fixed functions,
not evidence that a compromised capability function is safe.

## Same-connection API

`createDependencyAuthorityCapabilities(client)` exposes:

- `authorize({credential,scope})`, `recheck(authority)`, `clear()`.
- `readBundle()`.
- `initializeNative({expectedSourceFingerprint,record,recordSha256})`.
- `appendNative({expectedSourceFingerprint,expectedRevision,record,recordSha256,receiptKey,receipt})`.
- `insertMedia({expectedSourceFingerprint,record,recordSha256})`.
- `publishCandidate({expectedSourceFingerprint,candidate,candidateSha256,ttlMs})`.
- `appendFull({expectedSourceFingerprint,expectedVersion,expectedParentDigest,version,receipt})`.

Writes return strict booleans. The server bridge owns full native transition,
candidate provenance, full-chain validation and precise replay reconciliation;
passing a self-consistent hash is not sufficient authorization or semantic proof.
No browser supplies candidate JSON or a dependency-author sidecar.

The new runtime deliberately closes extract/vision/compare/synthesize generation
routes: existing provider-attempt and key ownership are not yet migrated end to end
to the immutable tuple. Tests publish explicit synthetic server fixtures through the
repository, then exercise ID-only loading/acceptance. This is not model generation.

`createDependencyManifestIssuerCapabilities(client)` separately exposes
`issue({credential,scope,requestId,ttlMs})` and
`revoke({manifestId,expectedRevision})`. The issuer resolves the reader and source
set from the database; it does not accept a caller-proposed reader or baseline.
A real administrator approval workflow for this issuer remains a deployment
prerequisite, not an available production input screen.

## Complete source bundle

The new schema is `design-authorized-dependency-bundle-v1`. It retains Stage16
workflowRows, workflowReceipts, legacyVersions, legacyPhotos, fullRows,
fullReceipts and operationAuthors, plus:

- `mediaRows`: binding_key, media_id, record, record_sha256, active, access_revision.
- `candidateRows`: candidate_id, scope_key, envelope, sha256, expiresAt (integer
  epoch milliseconds), active, access_revision, consumed (null or original receipt).
- `dependencyAuthors`: kind, id, authority, sha256, manifestId.

Dependency keys are `media / binding_key:media_id`, `candidate / candidate_id`,
and `full / decimal-version`. The manifest's `baseDependencyDigests` contains exact
kind/id/sha256 members. Existing immutable sources remain byte-equivalent and their
historical authors are not replaced by the reader. A current employee can contribute
new operations but cannot acquire an old generation/upload/request identity merely
because the username is the same or a read manifest exists.

The manifest freezes immutable source content, not future permission. Live access
rows, expiry and consumption are read again on the same connection. Consumption is
an immutable pending-to-accepted link and must match a real atomic workflow receipt.
New artifacts need current immutable author sidecars. New acceptance requires the
pending candidate's own current immutable author, rather than historical read
membership. Exact already-committed replay remains distinct from a new acceptance.

The complete assembled source is bounded; a per-table limit alone is not a total
memory bound. Unsupported, missing, ambiguous or corrupt dependencies reject the
whole result. Neither legacy data nor candidate/photo lanes are silently omitted.

## Atomicity and live checks

Media object storage is outside the metadata transaction. The original bounded
synthetic bytes can be staged before metadata publication, leaving an inaccessible
orphan if metadata publication fails. Original hash, metadata, initial active row
and immutable author publish atomically in SQL. This is not a distributed
transaction and unknown outcomes do not authorize blind new uploads.

Candidate publication uses the current native base/session digest, exact attached
originals and allowed comparison/synthesis dependencies. Accepting a stored candidate
atomically appends native record, request receipt, consumed receipt and operation
author. Original envelope/provenance stays unchanged. Accepted history can retain
expired evidence; this does not permit new pending use or revoked-ancestor synthesis.

Full publication uses a snapshot derived from the authoritative current workflow,
with exact parent version/digest and all original photo/candidate receipts. The full
version, receipt and author sidecar publish together. A native archive action and a
full publication are different operations.

The immutable tuple is pinned across storage/model awaits and rechecked inside the
transaction and in fresh post-transaction reads. Public/provider routes lacking a
fully migrated capability remain closed; there is no raw-table or legacy fallback.

## Deliberate limits

- No production installation, runtime activation, live migration, real credentials,
  real customer/photo data, external provider call or payment has occurred.
- Database canonical numeric support remains bounded as in Stage16. Original hashes
  are not rewritten to accommodate unsupported JSON numbers. The first actual-PG
  run directly proved the Stage16 tiny-exponent rejection; the final actual-PG run
  also proved the new schema rejection with its own fixed rejection code.
- Final authorization checks do not promise authority until a later arbitrary COMMIT
  or network delivery. The known hostile `SET CONSTRAINTS IMMEDIATE` limitation and
  the unresolved original legacy-PG intermittent incident remain separate blockers.
- The fixed operation and pure validator boundaries are both required. This work is
  not a full SQL reimplementation of all native analysis semantics.

## Verification status

The fixed-capability pure suite currently passes 14 tests, including exact method
and parameter allowlists, immutable identity pinning, poisoned/closed handles,
getter/proxy refusal, request-copy stability and hash/TTL checks.

The root's first serialized isolated PostgreSQL run passed all 21 cases with exit 0
and exact container cleanup. It exercised real nonowner LOGINs, the independent
manifest issuer, two nonempty original legacy versions plus native/private-media/
accepted-candidate/full history, actual HTTP media publication and candidate
acceptance, old-reader compatibility, immutable identity replacement, CAS,
rollback, lost-COMMIT acknowledgment and revocation. All data, image bytes,
approvals and object storage were synthetic; candidate publication did not call a
model. Evidence: `/tmp/stage17-dependency-pg-first.log`.

The final serialized isolated PostgreSQL rerun passed all 21 cases with exit 0 and
exact container cleanup after the bridge's empty-native/legacy-photo initialization
fix and HTTP safe-error mapping. Both canonical SQL schemas passed their direct
numeric acceptance/rejection controls, and the lost-COMMIT HTTP response passed the
explicit `uncertain` outcome and `retryable: false` assertions. Final evidence:
`/tmp/stage17-dependency-pg-final.log`.

The empty-native/legacy-photo case itself is covered by the 18-test pure bridge
suite, not the nonempty-native actual-PG fixture; it is not claimed as an actual-PG
scenario.

Security reference review used [PostgreSQL 17 CREATE FUNCTION](https://www.postgresql.org/docs/17/sql-createfunction.html)
and [row-security documentation](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).
