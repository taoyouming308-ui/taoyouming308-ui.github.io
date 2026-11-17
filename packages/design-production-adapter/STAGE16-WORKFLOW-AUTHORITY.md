# Stage 16: immutable authority for the existing native text workflow

This is default-disabled, offline preparation over the existing native workflow tables. The guarded draft SQL is **not a production migration**. No real data, database, credentials, model traffic or production permission change is involved. The parent independently completed the 18-case restricted-role PostgreSQL run with exit 0 and exact fixture cleanup; its narrow evidence and limitations are recorded below.

## Supported boundary

The new runtime exposes only existing workflow `load`, `dispatch` and `snapshot` routes. It reuses `createPreparedWorkflowService`, native record validation, event replay and original HTTP parsing. Native source text and speech-transcript text, the eight named notes, six-zone groups, explicit planned/actual entries, employee confirmation, native archive and linked reopen use the original representations. Snapshot creation does not publish a full archive.

There is deliberately no fallback to the old raw-SQL executor. New media upload/publication, candidate generation/acceptance, external models/speech, full-archive publication and key operations are closed in this runtime. Any scope with private media, model candidates, accepted model history or referenced legacy photos is refused in full rather than silently dropping dependencies. Existing text-only full archive history and nonempty legacy text versions remain part of the exact authorized source set. This is not immutable-identity migration of the complete product route graph.

## Fixed same-transaction seam

`createWorkflowAuthorityCapabilities(client)` exposes only:

- `authorize({credential,scope})`, `recheck(authority)`, `clear()` using the existing Stage 13 fixed identity functions;
- `readBundle()` → `design-authorized-workflow-bundle-v1`;
- `initializeNative({expectedSourceFingerprint,record,recordSha256})`;
- `appendNative({expectedSourceFingerprint,expectedRevision,record,recordSha256,receiptKey,receipt})`.

The root executor owns one actual connection, BEGIN/COMMIT/ROLLBACK, existing global writer lock, bounded timeouts, guard registration and failed/uncertain lease disposal. The capability object does not accept SQL text or create connections. It pins the first credential and complete immutable authority, rejects concurrent/poisoned operations and closes after context clearing. Its structural copy/validation is not itself an authority proof.

The database reads current employee session/staff, immutable subject/employment/membership/store and exact visit binding/lifecycle through the existing authority functions. All capability reads and writes share the original `design-prepared:transaction:v1` advisory transaction lock, with same-connection authority rechecks. The new runtime receives no direct source-table CRUD privileges and no issuer-role membership. Fixed SECURITY DEFINER functions are owned by NOLOGIN, non-table-owner, NOBYPASSRLS roles, with qualified names and fixed search paths. Privileges held by these trusted code owners are not grants to an arbitrary runtime SQL client.

## Reader manifest is not authorship

Assignment to the current customer/visit permits an authorized employee to contribute a new operation. It does not prove that employee authored, or may read, the pre-existing content. A separate issuer LOGIN must explicitly issue a manifest for the **complete immutable reader tuple**, including epoch, membership revision and binding revision, and the exact database-derived historical source set. No phone/name matching, username-reuse assumption, caller-provided source list or caller-provided hash grants access.

The private manifest records an immutable baseline of original native versions/receipts, legacy raw rows and public projections, full versions/receipts and existing operation-author records. Its public descriptor is:

```text
{id, revision, reader, baseWorkflowRevision, baseWorkflowSha256,
 sourceFingerprint, expiresAt}
```

The protected baseline is not returned to the browser. Runtime reads require that baseline to remain exact, the manifest to remain current/unexpired, and every native suffix operation after the baseline to have an exact immutable-author sidecar for the current authority and same manifest. A genuinely empty source can be initialized without a historical manifest; only that principal's contiguous sidecar-owned suffix can continue without one. Any old record with no such sidecar requires independent historical access authorization.

`createWorkflowManifestIssuerCapabilities(client)` is a separate same-connection issuer-only interface:

```text
issue({credential, scope, requestId, ttlMs}) -> {manifest, replayed}
revoke({manifestId, expectedRevision}) -> {manifest}
```

SQL reads the source set itself and resolves the authenticated reader; the caller cannot select a subset or supply authority/content/hash. Explicit TTL is bounded and clamped to existing authority expiry. Exact issue replay does not extend expiry or revive a revoked manifest. A new grant is a distinct explicit issuer operation, not an automatic refresh. The real human/admin authorization workflow and protected issuer deployment are not implemented by this offline interface.

## Original history and transactional writes

The new sidecar attributes only the appended **operation** to an immutable authority. It does not relabel the old payload or infer the author of an earlier version. All original workflow records, hashes, authors and legacy/full records are retained unchanged. Existing username-based receipt keys stay byte-compatible; replay requires the matching new immutable operation-author record, so an old same-name receipt cannot be impersonated as a new principal's request.

Before append SQL re-reads the complete source set and checks its opaque fingerprint, current authority, scope/store, CAS revision, previous hash, original journal/source/archive prefixes, operation whitelist and matching receipt. It appends the existing native version and receipt plus immutable author sidecar in one transaction. SQL additionally constrains changes to prior entries to the explicit confirmation operation. Existing JS validators and event replay still verify the full business transition. The capability SQL is **not a second complete implementation of every native engine invariant**; trusted service replay remains required. Arbitrary hostile use of a permitted function is not evidence that an unvalidated semantic transition is valid.

The adapter runs fresh authoritative reads at initial, transaction, final-guard and final-return boundaries, with a request-local pin of the whole immutable authority, not just display actor. Pure record memoization does not cache permission, manifests, receipts, source hashes or transaction state. Failed or uncertain commits never trigger automatic retries. Reconciliation must read authoritative state; old rows must never be reset to make a retry pass.

## Hash and numerical compatibility

Original hashes are never rewritten to accommodate SQL. New records are hashed using the existing JS canonical representation and compared with the SQL implementation. This draft deliberately supports only ASCII object keys and finite decimal values with absolute value at most `9007199254740991`, and either zero or absolute value at least `0.000001`. The SQL number representation uses `trim_scale`; unsupported exponent/precision ranges are rejected, not rounded or converted. String values retain their actual content. Full compatibility with all possible historical JSON number/key representations is not assumed: unsupported scopes/updates fail closed and need a separately reviewed migration strategy.

The database source fingerprint is an opaque internal equality token, not an authentication credential or a replacement for original hashes. The root repository still validates every original record hash, receipt and native replay.

## Verification and remaining gates

- `scripts/test-design-workflow-authority-capabilities.mjs`: 10 pure tests passed. They cover fixed query boundaries, complete identity pinning, same-name replacement, strict descriptor/proxy rejection, hash binding, poisoned/concurrent handles, close and independent issuer requests.
- `scripts/test-design-workflow-authority-postgres.mjs`: 18/18 passed in the parent’s serial isolated PostgreSQL 17 execution, exit 0; exact labelled container cleanup was verified. It creates two populated legacy versions with different authors via the real old RPC, creates old native/full history, then uses real manifest functions and the new HTTP runtime to continue the same history. It also exercises native group/confirmation/archive/reopen, exact old-reader compatibility, unsupported routes/dependencies, CAS/replay, source mutation, revoked manifests and lost COMMIT acknowledgment.

The first actual execution failed during fixture function installation with SQLSTATE `42601`, before any assertion. Three `IF` expressions containing `CASE ... END` were parenthesized explicitly (journal-count, event-type and entry-count conditions), without changing their conditions. A separate static check had already parenthesized JSON extraction before subtracting the session-field whitelist, avoiding the previously diagnosed PostgreSQL operator-precedence issue. The subsequent full run exercised native source, group, technique, confirmation, archive and reopen paths successfully.

Numerical evidence is deliberately narrower than the SQL policy: the actual run proves compatible original hashes for ordinary integers and `1.5`. The `1e-7` end-to-end denial used a decimal source quote that does not contain JavaScript’s literal `1e-7`, so it can fail at native source-provenance validation before reaching SQL. It is **not** an isolated negative control proving the database numerical-range branch. That SQL boundary is statically enforced but needs a separately scheduled direct constant/valid-source negative test before claiming complete numeric compatibility coverage. No additional container run was made merely to obtain a green result.

Production still needs an approved migration and privilege review, independent human authorization for manifests, real session/identity migration and lifecycle policy, bounded deployment/driver compatibility and the missing media/candidate/full-write capability paths. Role tests must use actual restricted LOGIN connections, not an owner switching roles. Legacy writer lock order and every production writer must be reviewed together.

The hostile-SQL `SET CONSTRAINTS ... IMMEDIATE` expiry limitation remains. Current-call/final-DB checks and normal fixed transaction paths do not establish absolute authorization at any later wall-clock COMMIT or network-delivery instant. The earlier unexplained intermittent legacy `RELATIONSHIP_UNAVAILABLE` incident is still a deployment blocker; this work does not diagnose it or rerun the old suite until green. No production activation is authorized.
