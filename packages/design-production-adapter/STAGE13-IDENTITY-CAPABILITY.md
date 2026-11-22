# Stage13 immutable-identity capability slice

Local, synthetic preparation only. No migration is installed in a live database; no real employee, customer, credential, provider call or permission grant is involved. The SQL is deliberately under `drafts/`, not the deployment migration directory.

## Contract and composition

`immutable-authority.mjs` validates the exact `design-immutable-authority-v1` envelope:

`subjectId`, `employmentId`, `membershipId`, `securityEpoch`, `membershipRevision`, `storeId`, presentation `actor`, exact customer/visit `scope`, and `bindingRevision`.

Structural validation is not authentication. A username, display store, phone, name, caller JSON or GUC cannot create the authority. The fixture explicitly seeds the stable relationship; it does not infer a migration by matching old names.

`createIdentityCapabilityAdapter({enabled, acquireClient}).resolveAuthority({credential, scope})` performs two independently authorized transactions and compares the complete tuple. It is disabled by default, has no connection/credential discovery, and never retries an uncertain transaction.

For a trusted repository already owning a transaction, `createIdentityCapabilityOperations(client)` exposes `resolveAuthority({credential, scope})`, `recheck(expectedAuthority)`, `readScopeRecords()` and `clear()`. These methods use the same connection and fixed parameterized SQL. The repository must retain the transaction, guards, final recheck, clear, COMMIT/ROLLBACK and uncertain-result handling; the operations object does not create a nested transaction. Actual PostgreSQL `void` serializes as the empty string in this harness; `clear()` validates that exact result, not a permissive null/string alternative.

## Actual role boundary under test

The helper creates a real `design_identity_runtime` LOGIN connection (`psql -U`), not an administrator connection followed by SET ROLE. It is NOSUPERUSER, NOBYPASSRLS, NOINHERIT, and not a member of either privileged role. No password is created: trust authentication exists only inside the uniquely named, network-disabled disposable fixture.

- `design_identity_owner` owns the new tables and cannot log in.
- `design_identity_capability` owns the fixed functions, cannot log in, is not the table owner and cannot bypass RLS.
- Runtime has only explicitly named function EXECUTE rights, not base-table reads/writes or approval issuance rights. PUBLIC/anon/authenticated function access, public-schema CREATE and database TEMP inheritance are revoked in this disposable fixture.
- The capability role has bounded SELECT and identifier-column UPDATE privileges needed for PostgreSQL `FOR SHARE`; these are not granted to runtime. Scoped evidence is protected by ENABLE/FORCE RLS and queried without a scope WHERE so filtering is actually exercised. Authority metadata has narrow role policies, while functions enforce exact token/scope checks.
- Definer functions use a fixed `pg_catalog` search path and qualified objects. Caller-set JWT-shaped/custom GUCs and hostile search paths are not identity inputs.

The sidecar re-reads and locks the existing opaque-token session and staff lifecycle, stable identity/membership, explicit visit binding, actual appointment/frontdesk assignment, customer profile and independently approved lifecycle decision. Raw imported status is not interpreted as permission. Nullable legacy values fail closed.

The protected context includes actual `session_user`, backend PID, transaction ID, token hash, complete authority/scope and the earliest session/lifecycle expiry. Another backend or transaction cannot reuse it. Normal success clears it; rollback removes it. A fresh authorize removes only that backend's old contexts. Abandoned contexts from other backends need a separately authorized bounded GC; they cannot confer access.

## Confirmed limitation: deferred expiry is not hostile-SQL commit enforcement

The normal fixed adapter uses a deferred constraint trigger to reject a commit after its original context deadline, including when the context row was cleared. **A caller controlling arbitrary SQL on the runtime connection can execute `SET CONSTRAINTS ALL IMMEDIATE` while unexpired, consume the deferred event early, clear, wait past expiry and commit.** Each later capability call still checks the current deadline, but that does not restore a commit-time guarantee against this attack.

The synthetic matrix deliberately records this as `EXPOSED`, separately from passing protection tests. It is an unresolved deployment blocker, not a successful defense, and not fixed by keeping a broader role or resetting constraints once in the normal adapter. The new slice must not be advertised as arbitrary-runtime-SQL-safe expiry enforcement. No production activation is authorized on this evidence.

## Scope and migration gaps

- This is a new identity/capability slice, not conversion of the entire legacy executor, key AAD/ownership, media, candidate or workflow histories. Existing v1/v2 authors and hashes remain untouched. The identity matrix preserves its existing nonempty binding rows and writes no legacy/workflow rows; its empty legacy/workflow tables are not evidence of populated-history compatibility. The separate workflow suite covers populated legacy histories.
- The fixture's explicit profile/store rule is deliberately narrower than a complete shared-store production resolver. Shared-store and historical access policy must be reviewed and mapped rather than inferred from labels or silently widened.
- Offboarding/rehire and A→B→A use new employment/membership IDs; old tuples are not reactivated. Security epoch and membership revision are monotonic. Production issuance, revocation, alias-change/rename policy and verified historical identity linking are not implemented. Retiring an alias alone must not substitute for session/epoch/membership revocation.
- Authority changes are locked through the transaction. A production writer/issuer must follow a reviewed common lock order; the fixture does not prove compatibility with every existing writer. Real pooling, transport cancellation, Node/Edge packaging, database exposure and hosted role membership remain unaccepted.
- Any durable approval/attempt integration must bind the full immutable tuple and use the same transaction's authority operations. No old username/store receipt or key is automatically reassigned to the new tuple.

## Bounded legacy-incident diagnostic

`scripts/diagnose-design-legacy-boundary.mjs` ran once: one baseline append and two fixed negative controls. The baseline succeeded. A real assignment-row lock with a test-only 100 ms lock timeout produced SQLSTATE `55P03` and the assignment-read failure path; a mismatched lifecycle digest produced the lifecycle/relationship path without an SQL error. Both safely became `RELATIONSHIP_UNAVAILABLE`. Logs contain reviewed enums/counters/timings, not SQL, tokens or customer payloads.

This calibrates attribution; it does **not** explain the original Stage7 intermittent failure, whose log lacks the underlying SQLSTATE/phase. No further repeat-until-green experiment was performed. The old unexplained incident remains an independent deployment blocker.

## Reproducible local checks

Pure: `node --test scripts/test-design-immutable-authority.mjs scripts/test-design-identity-capability.mjs`.

Author verification on 2026-11-15: pure **24/24**; actual-role matrix **13 normal/denial checks passed**, plus **1 confirmed EXPOSED deadline bypass** recorded separately. Every started fixture was removed with its exact-label cleanup check. Intermediate failures were the PostgreSQL void-result representation, a synthetic staff seed's invalid unique-conflict target, and the test bridge's missing exact `SET CONSTRAINTS` command tag; each was corrected without widening authorization or timeouts. These implementation fixes do not explain or fix the historical intermittent legacy incident.

Actual-role fixture: `node scripts/test-design-identity-capability-postgres.mjs`. It uses only the already installed PostgreSQL 17 image, `--pull never`, `--network none`, no ports or host mounts, tmpfs storage, a unique label and exact-container cleanup. Installer/seed controls use the fixture administrator; authorization assertions use the real restricted LOGIN. The final report must retain the separate `EXPOSED` outcome even when all ordinary-path assertions pass.
