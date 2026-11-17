# Stage15: real PostgreSQL artifact access sidecar and separate issuer

**Local preparation, default disabled.** This slice adds a real fixed-SQL implementation of Stage14's read repository and independent issuance seam. It does not migrate historical authors, add new write ownership, provision credentials, install a production schema, or authorize deployment. The SQL file is guarded for the existing disposable synthetic PostgreSQL 17 database only. No real key, customer data or provider is used.

## Components and ownership

- `postgres-artifact-access-repository.mjs`: `createPostgresArtifactAccessRepository({enabled:false,acquireClient})` returns `{repository,issuer}`. `repository.withReadTransaction(work)` and `issuer.verify(proof, context)` implement the unchanged Stage14 interface. The latter verifies protected database provenance, **not a cryptographic signature** or self-reported digest.
- `artifact-access-issuer.mjs`: `createArtifactAccessIssuer({enabled:false,acquireIssuerClient})` is for a separate, trusted issuer process. Its connection factory must never be controlled by, forwarded through or shared with the runtime request handler.
- `drafts/stage15-artifact-access-fixture.sql`: additive test-only private schema, roles, RLS, fixed read/issuer functions, append-only request receipts and monotonic proof revocation. Existing identity SQL and old historical tables/records are not rewritten.
- `artifact-read-runtime.mjs`, owned by the coordinator, explicitly composes the new sidecar with the existing HTTP handler, original employee adapter and old readers. It permits only media read/references, candidate load and full-history load. This is not a replacement full runtime; all other routes are rejected.

No module obtains a DB connection, opens a port, looks up a secret or calls a provider by default. Dependency exceptions produce fixed safe codes, not SQL, identifiers or source payloads. `ARTIFACT_PG_UNKNOWN` is an uncertain outcome and never automatic-retry permission.

## Independent issuance, not current-reader authorship

The independent process exposes only:

```js
await issuer.issue({
  requestId, expectedRevision: 0,
  locator: {kind, id, version, scope},
  reader: {subjectId, employmentId, membershipId, storeId,
           securityEpoch, membershipRevision, bindingRevision},
  expiresAt
}); // {attestation, replayed}

await issuer.revoke({requestId, attestationId, expectedRevision});
// {attestation, replayed}; irreversible active:false, revision + 1
```

The request cannot supply original payload, checksum, actor, authorship, issuer ID or issue time. `issuer_source` loads the exact original artifact on the issuer's transaction/connection after resolving the requested immutable reader against active subjects, employment, membership, store and the explicit current visit binding. No phone, name or current alias establishes the reader tuple. The source can have a different historical author. That original label remains `authorship.status:'unresolved'`, never a claim that today's reader created it.

The JS issuer computes the Stage14 domain-separated fingerprint from the loaded original with `describeIdentityArtifact`. PostgreSQL independently reloads/locks and compares that exact original before inserting the proof and original-source snapshot. This avoids pretending PostgreSQL `jsonb::text` has the same numeric/key formatting as the existing JavaScript hash protocol. The fingerprint checks consistency; the **separate issuer DB authority and protected rows establish issuance**, not the fingerprint alone. The issuer is deliberately a trusted authorization authority, not a browser-request flag or a default approval callback. Production still needs a separately reviewed issuer service and approval policy; possessing an authenticated runtime employee session does not grant that role.

Issuance expires within one hour. Exact request replay returns the current proof without a second row; conflicting request content denies. Revoked proof replay remains revoked, and the same artifact/reader tuple cannot be reissued with another request ID. Renewal/regrant policy is not implemented. In particular, the `UNIQUE(artifact,reader)` constraint also rejects a new request ID for an expired grant: expiry does not free the tuple. This is a deliberately conservative protocol limit, not a completed renewal feature. Before deployment, append-only renewal/regrant semantics, independent approval, latest-grant selection, revocation precedence and old-receipt replay must be separately designed and reviewed. A new employment/epoch/binding revision requires separate exact issuance rather than inheriting the old proof. The issuer role can revoke issued proofs; runtime cannot create, reassign, revoke or reactivate them.

## Roles and data access

- Existing `design_identity_runtime`: real restricted LOGIN, no superuser/BYPASSRLS/table ownership or role membership. Receives only three new fixed read/verify functions. Even direct calls to `load_artifacts` must have current identity context and matching live proof **before payload return**. Raw source function and issuance functions are not executable by runtime.
- `design_artifact_issuer`: separate restricted LOGIN, fixed `issuer_source`, `issue_attestation`, `revoke_attestation` only. No direct table CRUD or capability-role membership. No password is created; local trust authentication exists only inside the disposable fixture.
- `design_artifact_capability` and `design_artifact_issuer_capability`: distinct NOLOGIN, non-owner, non-BYPASSRLS fixed function owners. Their schema-creation privilege is revoked after test installation. `PUBLIC` execute and schema access are revoked. Search paths are fixed to `pg_catalog,pg_temp`, with private objects fully qualified.
- `design_artifact_owner`: NOLOGIN table/schema owner; private proof/receipt tables have ENABLE and FORCE RLS. Reader policy binds the authority's exact scope and immutable tuple. Issuer-only mutation is further limited by fixed functions, immutable receipts and the revoke-only trigger.

Locking SELECT needs UPDATE privilege on a column. Only the NOLOGIN capability roles receive the exact necessary column privileges. Runtime receives no source-table privilege. These grants are a **disposable fixture experiment**, not permission to apply them to the live service. Existing old-reader executor permissions are unchanged: the integrated test uses its existing privileged synthetic connection for the original readers. Passing the new sidecar's restricted-role tests must not be reported as migrating all old readers or writes to a minimum-privilege production role.

## Exact transaction boundary and history completeness

The Stage14 wrapper still performs:

1. Fresh sidecar transaction and final guard.
2. Unchanged original reader, with its own independent authorization, source/ancestry/media checks and transactions.
3. A second fresh sidecar transaction, requiring identical source set, proofs and authority.

**There is no single connection or lock spanning all three steps.** Within each sidecar inspection, one physical lease holds the Stage13 identity context, authority/source/live-access/proof row locks, repeated checks and COMMIT. Connection/session/backend/transaction context cannot be transferred to another lease. Skipped guards, duplicate registration, parallel or unawaited queries, and swallowed SQL errors permanently poison that transaction; it cannot subsequently commit.

Every sidecar and issuer transaction takes the exact existing executor advisory lock:

```sql
pg_advisory_xact_lock(hashtextextended('design-prepared:transaction:v1',0))
```

Supported old writers take this same lock. It protects full-history membership while the sidecar checks every version, rather than pretending a new scope lock protects against old writers that never acquire it. The global lock serializes unrelated visits too and is a throughput limitation, not a production scaling solution. Trusted administrator/direct-SQL writes outside this protocol are not frozen by an advisory lock; this slice does not claim to defend against a compromised owner/administrator. Original immutable triggers and all old reader checks remain necessary.

Full history is all-or-deny, ordered, max 100 versions and existing 64 MiB aggregate budget. Every version requires a proof. A normal new append outside either inspection makes the old attestation set incomplete; return is denied, never silently truncated to the attested prefix. The source snapshot and embedded original SHA/author are preserved. Candidate current access/expiry and media current active state are loaded again under locks. Actual media bytes are independently compared with the original metadata hash by Stage14 after the unchanged full-decoding reader returns.

The result represents authority at its final successful check, not indefinite permission or atomic physical network delivery. The guard checks proof time after its final authority await; the repository then performs fixed identity recheck/clear/COMMIT. No absolute expiry-at-COMMIT or physical-send guarantee is claimed. The known Stage13 arbitrary-SQL `SET CONSTRAINTS ALL IMMEDIATE` deadline exposure remains unresolved; this read slice neither repairs it nor grants arbitrary SQL to the external caller.

## Verification status

Author local pure check: `node --test scripts/test-design-artifact-access-repository.mjs`, **15/15 passed**, including permanent poison after swallowed SQL/concurrent errors, guard finalization, independent issuer inputs, same-lease boundaries, safe errors and uncertain COMMIT. Node syntax and `git diff --check` passed. These tests mock the SQL protocol and do not prove PostgreSQL privileges.

Actual PG script executed once by the coordinator, serialized with the other database suites:

```sh
node scripts/test-design-artifact-access-postgres.mjs
```

**Actual PG: 17/17 passed, exit 0, exact isolated-container cleanup confirmed** by the coordinator on 2026-11-15. Log: `/tmp/stage15-artifact-pg-root.log`. The first default-sandbox attempt stopped at image inspection before creating a container; the subsequent authorized isolated execution produced these results. The script composes the real Stage13 capability, new repository/issuer, existing workflow/full/candidate/media modules, native fixed-image inspection and coordinator's read-only HTTP factory. Object storage is synthetic mock; no model exists. It tests real LOGIN denial, no runtime self-issuance, missing/forged/cross-reader proofs, issue/revoke CAS/idempotency, concurrent issue, expiry, old-writer lock interaction, unattested new head rejection, revocation between transactions, actual old access revocation and immutable history with a populated different-author legacy RPC version. Its tested role boundary applies to the new sidecar/issuer only. Original reader setup and original source validation still use the existing privileged fixture executor; object storage remains mock. This is not a claim of production minimum-privilege migration or a real external issuer service.

## Still pending before any full write integration

New upload ownership, workflow writes, candidate publication/acceptance, full append identity, key usage and cross-employee write delegation are not authorized by a read attestation. A complete production write path needs independently bound immutable authorship/operation approval, protected source/version and CAS/receipt writes on the **same real transaction**, with its own authorization deadline and failure semantics. It cannot reuse the read sidecar to run a legacy privileged write or silently flatten a new format into old fields. No such fallback is added here.

Deployment, issuer hosting/policy, DB driver/pool/role provisioning, all legacy consumer migration, real media sandbox, existing deadline exposure, load/throughput and production integration remain independent blockers. Production stays disabled.

## Primary references checked

- [PostgreSQL 17 explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html): row/advisory lock lifetimes and application coordination.
- [PostgreSQL 17 row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html): non-owner policies and owner/BYPASSRLS distinctions.
- [PostgreSQL 17 CREATE FUNCTION](https://www.postgresql.org/docs/17/sql-createfunction.html): SECURITY DEFINER ownership, safe search path and default PUBLIC execute.
- [Supabase changelog](https://supabase.com/changelog.md): reviewed 2026-11-15; this change uses no hosted API, Supabase CLI, Flutter or project migration. Its new CLI/TLS entries are not used by the isolated fixture.
