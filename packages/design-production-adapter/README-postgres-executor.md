# Prepared PostgreSQL executor and explicit lifecycle policy

These new modules close the prior JavaScript transaction-executor gap for **visit binding, employee authorization and the existing legacy archive adapter**. They execute actual parameterized statements and `BEGIN`/`COMMIT`/`ROLLBACK` on one exclusively leased PostgreSQL connection. They do not connect anywhere by themselves, read environment variables, load a driver, read credentials, migrate a database, install permissions or wire a production handler.

This is reviewable Node server code. The live employee API uses Supabase Deno Edge; its packaging, driver, pool/connection lifetime and platform limits have **not** been validated here. No claim of Edge deployment compatibility or production readiness is made.

## Interface and composition

```js
const executor = createDesignPostgresExecutor({
  acquireClient, // trusted server dependency, never browser input
  lifecyclePolicy: createExplicitVisitLifecyclePolicy({
    approvedPolicyRevisions: reviewedRevisions,
  }),
});
const binding = createVisitBindingAdapter({
  readTransaction: executor.readTransaction,
  writeTransaction: executor.writeTransaction,
});
const employeeAdapter = {
  resolveArchiveContext: request => executor.readTransaction(tx =>
    createProductionEmployeeAdapter(tx).resolveArchiveContext(request)),
};
const legacyArchive = createProductionArchiveAdapter({
  employeeAdapter,
  transaction: executor.transaction,
});
```

`acquireClient()` must lease an exclusive pg-compatible connection with `query(sql, values)` and `release(error?)`. It must not return a connection already inside another transaction or shared with another request. Queries return `{command, rows, rowCount}`; a control statement may have `rowCount:null`. Values remain separate bound parameters. The module never interpolates names, filters, values, credentials, scopes or JSON into SQL. No raw SQL/query method is exposed on the transaction context.

- `readTransaction(callback)` permits fixed reads and the shared context RPC. It rejects writes and guard registration.
- `writeTransaction(callback)` and `transaction(callback)` permit the existing binding/legacy operations. A successful callback is not enough: registered final guards must pass, and actual PostgreSQL `COMMIT` must acknowledge success.
- `tx.resolveVisitBinding` composes the existing binding resolver **on that same transaction**, rather than opening a second connection. The actual employee/access-gate code is reused.
- The REST-shaped adapter input is a strict local translator, not an HTTP request or generic PostgREST proxy. Only exact known columns, predicates and limits from existing employee/binding code are accepted.
- The only allowed public RPCs are `customer_design_resolve_context(bigint,bigint,date,text)` and `append_customer_design_version(jsonb,text,text)`. Their SQL is reused from the repository's real migrations. Context names/phones returned by the legacy resolver are discarded, not used to infer a new binding.

The complete UI/event/full-workflow archive repository methods are a different interface and are **not** implemented by this executor. No full snapshot is lossy-converted into the legacy payload. The existing legacy adapter still validates scope, actor, parent, request, normalized snapshot and result before commit.

## Transaction mechanics

The executor performs, in order:

1. `BEGIN ISOLATION LEVEL READ COMMITTED`, local five-second lock timeout, thirty-second statement/idle-transaction timeout, and a fixed `pg_catalog` search path.
2. A conservative exclusive transaction advisory lock named `design-prepared:transaction:v1`, then a locked schema-contract row and verification that the required deferred deadline trigger is enabled.
3. The adapter callback's parameterized queries on this connection. Existing source, session, staff, profile, lifecycle and capability rows use `FOR SHARE`; approval consumption uses `FOR UPDATE`. Locks remain until commit or rollback. Binding reads include full ordered history and exact immutable receipts, with existing validators recomputing their consistency.
4. Binding append checks the expected head, full history transition and exact receipt/approval intent, inserts the version with a SQL head predicate, then inserts its unique request receipt. Single-use approval consumption is part of the same transaction. Unique database constraints remain mandatory. Legacy append calls its existing request-lock/visit-lock/CAS/idempotency RPC in this same transaction.
5. Every registered `beforeCommit` guard is awaited. Any exception rolls everything back. Observed session, approval and lifecycle deadlines are reduced to the earliest deadline. A write requires current authentication, a final guard and a deadline, then inserts an immutable private commit-check row.
6. The private **deferred PostgreSQL constraint trigger** checks that deadline at commit. This covers expiry while the connection is waiting between the final JavaScript check and actual commit. It is a database check, not a JavaScript timer or mutex. This trigger/table is part of the uninstalled private schema contract below.
7. Acknowledged `COMMIT`, then connection release. Handles are closed after completion; duplicate acquisition cannot release another active lease. Lease ownership remains reserved through asynchronous release, and a failed release quarantines the handle.

The transaction lock is deliberately coarse: **all operations through this executor serialize**, including reads. This favors an auditable correctness baseline over throughput. It is not a recommended final-scale locking strategy, and long callback/policy work must not perform provider calls or other network work while holding it. Timeouts bound database waits, not arbitrary hanging JavaScript. A production request deadline/cancellation and pool implementation still needs review.

### Existing writers and lock order

The existing legacy archive RPC uses `design-request:<UUID>` followed by `design-visit:<profile>:<visitKey>`. The new outer executor obtains its coarse prepared lock and source/auth rows before entering that RPC. Ordinary source/session/staff updates block on the relevant shared row lock, so revocation-first denies and append-first commits before subsequent revocation.

**Other existing writers do not automatically participate in the prepared lock protocol.** A transaction that takes source/staff/request locks in reverse order, holds multiple visits/profiles, or invokes the legacy RPC and then changes source/auth rows can deadlock with this executor. PostgreSQL aborts one transaction; the executor does not automatically retry it. All relevant production writers and multi-row canonical lock order need an explicit audit before rollout. Direct insertion into proposed private tables must be forbidden except through the reviewed server role/procedure. Hashes and the schema marker do not protect against a malicious database owner or a privileged process altering tables/triggers.

No separate REST calls, browser actor headers or process-local promise queues are represented as database atomicity.

## Explicit lifecycle contract

`createExplicitVisitLifecyclePolicy({approvedPolicyRevisions:[]})` denies by default. A deployment must supply an explicitly approved revision list **and** a fresh authoritative per-visit decision. The decision is:

```js
{rowSha256, allowed:true, policyRevision, expiresAt}
```

The executor reads the decision from a locked private row and supplies database time to the policy. `rowSha256` is SHA-256 over canonical sorted-key JSON of the exact normalized source row:

```js
{source, visitId, id, staffUsername, store, bookingDate, status}
```

`visitLifecycleRowDigest(row)` defines that encoding. A changed source status, stylist, store, date or identity invalidates the old decision. Unknown/missing policy, denied decision, expiry or mismatched digest fails closed. Approval of a numeric import status (0/1/3/4) is **not** approval of a service/access lifecycle. The production meaning and authoritative issuer of decisions remain unresolved and unconfigured. A trusted custom policy may be injected, but that is server authority, never a client field.

The independent binding-authority table names exact actor/store/action capabilities; an employee position, active session or matching phone/name does not grant management rights. The exact approval issuer remains separate and unimplemented. It must independently verify customer/visit/stylist identity and issue an unexpired one-time intent. Approvals are looked up only by hash; their raw token is not stored. The existing fixed profile/store/date rules and separate reassign/revoke/restore transitions remain unchanged.

## Uninstalled private schema contract

No automatic migration file is added. The guarded `drafts/stage6-executor-fixture.sql` is **test-only**, requires an empty specifically named disposable database and explicit fixture setting, and is not an installation script. Before real use, a separately approved migration/permission design would have to supply:

| Private table | Required role |
| --- | --- |
| `design_private.runtime_contract` | Locked singleton version marker `design-postgres-v1`. |
| `binding_versions` | Immutable exact JSON record; primary key `(assignment_source,visit_id,revision)` and globally unique request UUID. |
| `binding_requests` | Immutable exact receipt keyed by globally unique request UUID, atomically appended with version. |
| `binding_authorities` | Exact current `(username,store,action)` capability, no wildcard/browser grants. |
| `binding_approvals` | Hash lookup, unique immutable receipt/intent/hash/deadline, monotonic revocation and one-time consumed-request UUID. |
| `lifecycle_decisions` | Exact current per-visit row digest, explicit allowed decision, reviewed policy revision and expiry. |
| `commit_checks` | Immutable random audit identifier and earliest authority deadline, with enabled deferred initially-deferred `design_commit_deadline` constraint trigger. |

The fixture includes constraints and immutable triggers to exercise this contract. It does not design a complete production approval issuer, RLS role layout, approval/decision audit trail, retention policy, migration/backfill, or database-owner hardening. The existing public session/staff/booking/frontdesk/profile tables and shared legacy functions are not rewritten by the module. The test's temporary database loads relevant tracked migrations only into synthetic schema.

## Failure and retry semantics

Driver diagnostics, SQL text, credentials and arbitrary dependency `message`, `name`, extra properties or `cause` are not forwarded. Known adapter classes are reconstructed using fixed code lists. A small enumerated SQLSTATE/sentinel list preserves conflict mapping; everything else becomes a fixed error.

A lost/malformed COMMIT acknowledgment is `PG_COMMIT_UNCERTAIN` with `outcome:'uncertain'` and no automatic retry. Retain the exact request ID/payload and reconcile or repeat through the adapter's idempotency mechanism only after fresh authorization. Even a known deferred-constraint COMMIT rejection is conservatively reported uncertain at this boundary. Failed BEGIN acknowledgment or rollback transport failure discards the lease; no callback is rerun. Pool release failure after an acknowledged COMMIT does not falsely relabel committed work as a failed append.

The executor is a trusted server library, not an authentication HTTP endpoint. Its callback and injected connection/policy must never be built from browser objects. Returning a transaction acknowledgment does not grant lasting access; later reads require fresh authorization.

## Tests

- `node scripts/test-design-postgres-executor.mjs`: synthetic driver-boundary and lifecycle tests; no network. Covers exact parameterization, reused/released handles, guards, default denial, diagnostics, uncertain outcomes and actual employee-adapter composition.
- `node scripts/test-design-postgres-executor-integration.mjs`: separate actual PostgreSQL 17 suite. Uses only the already available image, `--pull never --network none`, no published ports, temporary storage and a unique disposable container. Persistent `psql` connections use PostgreSQL PREPARE/EXECUTE parameter binding as a **test-only driver bridge**; production must inject its separately reviewed real driver. No credentials, production database or live schema is used. Final counts and cleanup are reported only after the run succeeds.

The isolated integration connections use the disposable database's fixture administrator. They validate real transactions/locks and application authorization decisions, **not** the eventual production role, RLS/EXECUTE policy, managed pooling or Edge deployment. Those require a separate authorized environment and acceptance tests. No private-table permission grant for a production role is supplied.
