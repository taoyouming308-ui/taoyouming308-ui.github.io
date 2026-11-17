# Prepared workflow, full archive and media-metadata PostgreSQL repositories

`postgres-workflow-repositories.mjs` extends the Stage6 executor rather than introducing another process-local store or an independent demo. It composes the **actual** `createPreparedWorkflowService`, native design-event contract, `createPreparedFullWorkflowArchive`, employee session/binding resolver and private media publication interfaces.

No module opens a connection, reads credentials, installs a migration, grants production permissions, publishes a route or calls Storage/AI by default. A trusted exclusive PG client must still be injected. The guarded SQL under `drafts/` and reusable Docker helper are **synthetic tests only**, not installers or runtime dependencies.

## Public server factory

```js
const repositories = createDesignPostgresRepositories({executor});
const workflow = createPreparedWorkflowService({
  enabled: true,
  permissionGate: repositories.employeeAdapter.gate,
  repository: repositories.workflowRepository,
  mediaResolver: repositories.mediaResolver,
  mediaVerifier: repositories.mediaVerifier,
});
const fullArchive = repositories.createFullWorkflowArchive({enabled: true});
```

Returned capabilities:

- `employeeAdapter.authenticate`, `.gate.authorize`, `.resolveArchiveContext`: actual employee adapter, fresh same-transaction reads per operation, no actor-header substitution.
- `initializeWorkflow({credential,scope})`: authenticate and resolve the real source binding; create a new empty native session with a **server-generated** session ID only if the exact scope has no initialized record. Existing records are returned unchanged after checks. Repeated/concurrent initialization cannot reset, replace or create a second head. There is no record/session-ID argument. The HTTP composition only initializes on its explicit load path; dispatch/snapshot do not silently create a missing record.
- `workflowRepository.transaction({grant,scope},work)`: original service contract with same-connection permission gate, read, receipt lookup, CAS write and final guard. A supplied grant alone grants nothing: methods deny until that transaction's actual employee gate authenticates the credential and exact actor/scope.
- `mediaResolver(input)`: reads exact active metadata inside the current registered workflow transaction. An arbitrary object cannot masquerade as that transaction. `mediaVerifier(input)` performs fresh independent verification after the workflow transaction returns.
- `fullArchiveTransaction({scope,actor},work)`: original full-archive transaction contract. Prefer the wrapper below for response-time revocation protection.
- `createFullWorkflowArchive({enabled:false})`: default-disabled wrapper around the existing full archive adapter. On successful append/replay it freshly rereads the verified full chain, metadata and source records and compares the returned applied version. It also requires the authenticated actor to remain the append actor. Failure after a commit is `FULL_OUTCOME_UNCERTAIN`, not a false rollback claim; no response containing stale photo references is delivered.
- `loadFullArchive({credential,scope})`: `{currentVersion,currentDigest,versions}`, including version zero/null digest for an authorized empty chain. The caller does not invent CAS values. History, receipts, explicit source bindings, current media and current employee/assignment/lifecycle authority are checked, including a fresh final transaction. Historical rows are never edited to hide a revoked reference; access to the whole response is denied instead.
- `createMediaMetadataRepository({resolveCredential})`: per-request trusted credential closure, exposing `withScopeLock(binding,work)` and `verifyRecords(binding,records)`. A binding object is not a credential and cannot be used to infer one. The transaction exposes `permissionGate` for same-connection commit checks. See media integration below.

All these methods are internal server capabilities, not browser APIs. The composition root controls which are exposed through the existing strict HTTP commands. `initializeWorkflow` returns a trusted internal record; it is not a substitute for the workflow service's final authorized load before sending data to a browser.

## Authoritative workflow persistence

`workflow_versions` is an immutable full-record revision chain beginning at zero. Every later revision has an immutable globally keyed request receipt and parent-record digest. The unique key is the canonical hash of customerProfileId/visitId/assignmentSource. Receipts bind actor, exact request ID, scope, expected revision, original intent, resulting revision and record digest.

Reads verify consecutive revisions, exact scope, parent and record digests, every receipt and its actor/request/fingerprint. They then **replay the original stored intent using the same pure `applyPreparedWorkflowIntent` used by the service** and compare the complete resulting record. A structurally valid record with recomputed hashes but a different original source cannot bypass the original receipt intent. No second copy of business event logic is maintained in SQL or the repository.

The existing native contract preserves raw text and source IDs/quotes, explicit human confirmations, unknown values, independent planned/actual tracks, zone/service/group/side, archive snapshots and explicit linked reopen revisions. The database does not infer techniques, promote a plan to execution, or mark a source confirmed merely because a save succeeded.

CAS checks, version insertion and unique receipt insertion occur on the same real connection and transaction. A failed guard, insert or post-insert validation rolls all staged rows back. A lost COMMIT acknowledgment remains uncertain and retains the original request. Exact workflow replay returns the **current head** with `replayed:true`; full archive replay returns its **original immutable applied version**. These intentionally different existing semantics are preserved.

Cross-scope reuse of an actor/request key returns a fixed conflict without returning another scope's receipt or original text. Changed payload reuse in the same scope also conflicts. There is no automatic retry with a new request ID.

## Full archive source verification

The client may submit the bounded full snapshot, but its digest is not authority. The repository recomputes the snapshot from a known immutable **server-stored workflow revision** and requires an exact match, including original evidence, all native archives, mappings, legacy records and photo references. UI projections not present in this prepared workflow repository are not invented: `ui` and `uiScope` remain null, with the exact server native session as `evidenceScope`.

- A **new append** must use the current authoritative workflow record, current expected full version and exact parent digest.
- An **exact request replay** may match a historical trusted workflow checkpoint after the workflow/full heads have advanced. It returns the original applied version, never a new archive fabricated from stale input.
- Full chains are validated with the existing full-workflow contract and immutable request receipts. Each receipt fingerprint is recomputed from actor/scope/request/expected version/parent and snapshot digest.
- Source/profile/stylist/lifecycle, private media metadata and final guards share the executor's real transaction and row locks. The Stage6 deferred database deadline still applies to every write.

## Existing legacy source boundary

Initialization reads the existing shared legacy context and immutable `customer_design_versions` through parameterized SQL and retains their public adapter representation. It does not overwrite legacy tables or convert the new event journal into an old payload. Supported legacy photo references are verified against exact existing asset/profile/visit/store rows.

The full contract currently supports legacy assets with before/after and front/back/left/right metadata. Existing external archive URLs or unsupported legacy reference/detail values fail with `PG_LEGACY_IMPORT_REQUIRED`; they are **not silently dropped or renamed**. A future explicit compatible import extension is required for those cases.

A separate legacy writer appending after workflow initialization makes the current prepared record's legacy lane incomplete. Current workflow operations then fail closed with `PG_LEGACY_SOURCE_CHANGED`; there is no implicit merge or rewrite. Historical full-archive replay can verify a known historical prefix while fresh append requires current sources. A reviewed explicit legacy synchronization workflow remains a deployment prerequisite if both writer paths will be used concurrently.

## Media metadata, tombstones and short transactions

`media_records` stores only immutable metadata: exact authenticated employee owner/store/customer/visit/source, media/request ID, stage, angle, MIME, byte count, dimensions, hash and original active=true. It contains **no bytes, object key, file name or URL**. The key is the canonical full binding hash plus media ID. `media_access` is a separate current revocation record; false is a tombstone, not deletion or a reusable ID. The fixture permits only active→false with revision+1 and rejects delete/revival. This module does not install a production revocation endpoint or infer who may issue that decision.

The metadata repository reauthenticates from its trusted per-request credential closure, locks the authoritative source/session/binding and metadata rows, checks every observed row before commit and supplies a same-connection employee gate. The caller may register additional approval guards. Even read-only `withScopeLock` calls have the internal authorization guard. `verifyRecords` performs an independent fresh transaction and exact metadata/active comparison.

The new private media composition uses **short DB read → Storage outside DB → short DB recheck/insert → fresh metadata verification**. It must not call a fresh PG transaction or Storage transport while holding the metadata transaction's global lock. Outer approval/employee guards use the supplied `tx.permissionGate` in that callback's request-local context, not a global mutable variable. No bytes are put in PostgreSQL to pretend Storage and metadata form a distributed transaction. Private orphan objects and uncertain publication remain explicit states handled by the media composition.

Reassignment does not automatically transfer the former employee's private images. The new stylist can be authorized for the customer/visit while old owner-bound photo references remain denied. Old archives and authors remain immutable. Historical access/ownership transfer policy is deliberately not inferred.

## Limits, schema and production prerequisites

The executor retains `READ COMMITTED`, its conservative global prepared-design transaction lock, scoped row locks, final guards, deadlines, rollback and uncertain-COMMIT behavior. Existing external writers still require a lock-order/deadlock audit; the new private tables do not make every existing writer join this protocol.

The additional uninstalled schema contract is `design-workflow-postgres-v1`: workflow versions/receipts, full versions/receipts, immutable media metadata and monotonic media access. SQL fixture constraints/immutability triggers exercise those properties in a disposable database only. No live migration, grant, RLS change, backfill, approval issuer, Storage credential or production runtime configuration has been installed.

Current bounded correctness baseline: at most 1,001 workflow snapshots including revision zero, 1,000 native journal events from the existing event contract, 100 full versions and 64 MiB per fetched workflow/full history. Before history fetch, SQL checks aggregate stored bytes/count. New full snapshots retain the existing 32 MiB cap. The native event cap may be reached before the repository revision cap. A history that exceeds its bound fails rather than truncating/resetting. Capacity and high-volume performance are **not production-accepted**: reads replay history and full-source checks can be expensive. This is intentional auditable correctness preparation, not a claim of scalable storage. No limit was enlarged to hide that gap.

Before any deployment: review actual database role/RLS/EXECUTE/direct-table permissions and immutable constraints; install only an explicitly approved migration; approve authoritative lifecycle and binding management; define legacy synchronization and private media ownership/revocation policy; audit all writer lock ordering; configure a reviewed driver/pool and exact runtime; validate the native media worker isolation/Storage permissions; then run independently authorized production-like acceptance. The local PostgreSQL fixture uses its isolated administrator, so it proves application/transaction behavior, **not production RLS or least-privilege role correctness**. Supabase Deno/Edge compatibility remains unverified.

## Synthetic acceptance

- `scripts/fixtures/design-postgres-fixture.mjs` exports a reusable isolated PG17 lifecycle/client factory for browser, workflow and media tests. It is never imported by production modules. It only uses the pre-existing image with `--pull never --network none`, no ports, tmpfs, unique labelled containers and cleanup even after uncertain launch.
- `node scripts/test-design-workflow-postgres.mjs` composes the actual services with these repositories and PostgreSQL. It checks restart, native source/plan/actual/confirmation, archive/reopen, exact historical replay, CAS/contention, immutable versions/receipts, fabricated source rejection, corruption, revocation, rollback and lost commits. It retains the ordered psql diagnostics/UTF-8 bridge regressions from Stage6.
- Nonempty legacy regression seeds two versions and a scoped asset through the actual legacy RPCs, retains different original authors and all populated snapshot fields, and compares the original SQL rows before and after initialization/full archiving. A third independent legacy append must make current prepared operations fail closed without resetting or rewriting either history. The asset is synthetic metadata only; no image bytes or Storage upload are involved.
- The separate UI/media workers reuse the same isolated helper for real browser→HTTP→PG and native colored-pixel/media→Storage-mock→PG acceptance. Their result counts are reported separately, not assumed by this document.
