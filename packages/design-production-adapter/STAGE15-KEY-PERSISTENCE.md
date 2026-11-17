# Stage 15: immutable key storage and independent approval issuer

Status: offline, default-closed implementation. The SQL in `drafts/stage15-key-repository-fixture.sql` is an explicitly guarded **synthetic PostgreSQL 17 fixture**, not an installed or deployable production migration. No real key, provider call, account credential, production permission change, or production database was used. Role grants were limited to the disposable isolated fixture.

## Separate roles and exact authority

`createPostgresImmutableKeyRepository({enabled, acquireClient})` provides `resolveIdentity({credential})` and `withIdentityLock(identity, work)`. It authenticates the existing custom-token hash session and active staff row together with the immutable subject/employment/membership/store sidecar. Key settings are session-level: no arbitrary customer/visit is selected to establish key ownership. The slot is the four immutable IDs plus `purpose`; security epoch and membership revision bind the configuration and AES-GCM AAD. A username or store label is never the slot key, and v1 username-owned keys are not inherited or re-encrypted.

The isolated fixture connects as the actual non-owner LOGIN `design_identity_runtime`, not `postgres SET ROLE`. Runtime cannot read tables, sign approvals, alter policies/triggers, or switch into issuer/capability roles. Its fixed functions run as the NOLOGIN, non-table-owner, NOBYPASSRLS capability role. All new tables have ENABLE/FORCE RLS, but the capability policies deliberately permit that trusted role's functions: ownership filtering is enforced by the audited functions, **not by a separate row-owner RLS predicate protecting against a compromised function owner**. Schema/function names are qualified and search paths fixed; PUBLIC/anonymous/authenticated function execution and direct table privileges are revoked.

The distinct disposable LOGIN `design_key_issuer` can only call issue/revoke functions. Its separate NOLOGIN capability cannot read key ciphertext, consume an approval, or call runtime key APIs. No password is generated: these roles exist only inside the network-disabled, no-port, tmpfs fixture with its existing synthetic connection mechanism. This is real database role separation, not a completed human-confirmation UI or production issuer service.

## Approval and atomic mutation

The independent, trusted issuer API is:

```js
const issuer = createPostgresKeyApprovalIssuer({enabled: true, acquireIssuerClient});
await issuer.issue({credential, receiptId, intent, ttlMs});
// -> {receiptId, issuedAt, expiresAt}
await issuer.revoke({receiptId});
```

It is not exposed by the key HTTP runtime. `intent` is the exact `design-key-approval-v2` immutable identity tuple plus purpose, action, destination, model, expected revision and key digest (null for revoke). TTL is explicit, 1–300000 ms. PostgreSQL time controls issuance and expiry; the effective TTL is shortened to the authenticated session deadline. Repeating the same receipt/intent/requested TTL returns the original times, never renews them. Changing any of those fields conflicts. Revocation is monotonic.

The v2 settings service requires the following same-transaction methods; it has **no cross-transaction `approvalVerifier.consume` fallback**:

```js
await repository.withIdentityLock(identity, async tx => {
  await tx.resolveIdentity({credential});
  const current = await tx.read(purpose);
  await tx.consumeKeyApproval({receiptId}, exactIntent); // strict true
  await tx.compareAndSwap(expectedRevision, nextRecord); // strict true
  tx.beforeCommit(async () => { /* fresh same-connection checks */ });
});
```

An approval is consumed only for the authenticated immutable tuple and exact intent, current slot revision, and still-valid issuer receipt. The consumption is tied to actual session user/backend/transaction ID. CAS cannot use another transaction's consumption or another receipt/configuration. Version history is immutable; revocation appends a tombstone and does not reset the revision or erase ciphertext history. Read/status creates neither a revision-zero row nor a consumed approval.

Paired deferred foreign keys require exactly matching consumption/version records at COMMIT. An application exception or failed CAS rolls both back. A successful consumption without a matching key version cannot commit. Same-slot advisory transaction locks serialize even an absent head; these hashes are lock routing only, never authorization or identity proofs. Other immutable owners/purposes remain distinct.

## Executor and uncertainty

The repository uses parameterized fixed SQL, explicit READ COMMITTED transactions, fixed statement/lock/idle timeouts, fresh credential/identity checks, and a final same-connection recheck and context removal. It rejects concurrent or unfinished transaction operations and poisons the transaction even when a callback catches the operation error. Only one before-commit guard may be registered, and no guard may be added during finalization. Escaped/closed transactions cannot be reused.

BEGIN acknowledgment loss, pending queries, COMMIT ambiguity and failed release are never silently retried. The injected driver must honor `release(error)` by discarding the physical connection; an adapter cannot prove cleanup if the driver violates that contract. A failure after a possibly committed key change is reported as uncertain. Reconciliation must reread the authoritative revision before any newly approved action. The repository does not turn a stale retry into a second write.

## Tests and boundaries

- `scripts/test-design-immutable-key-repository.mjs`: 12 pure synthetic tests, including unfinished/concurrent operations, poisoned caught errors, guard misuse, closed transaction use, lost acknowledgments, exact receipt shape and session-truncated TTL.
- `scripts/test-design-immutable-key-postgres.mjs`: 20/20 actual restricted-LOGIN PostgreSQL checks passed in the parent’s serial isolated execution, exit 0; exact labelled container cleanup was verified. It includes issuer/runtime privilege separation, real AES-GCM synthetic ciphertext, atomic receipt/CAS rollback, orphan rejection, concurrent CAS, restart/new-instance reads, uncertain actual COMMIT, expiry and truncated TTL, actual key-only HTTP save/read/revoke, tombstone history and epoch invalidation. The constant-expression regression also preserves rejection of extra sealed fields.
- Existing v1 settings and historical artifacts remain unchanged. This does not migrate every old provider/candidate/media/key owner to immutable identity.

### Investigated installation-path failure

The first execution stopped at the first approved save. A bounded test-only driver diagnostic identified `cas_key`, SQLSTATE `22P02`; it did not log SQL, token/key parameters, or raw server messages. PostgreSQL's binary subtraction precedence made `n->'sealed'-array[...]` evaluate the subtraction before the JSON extraction and attempt to parse the unquoted word `sealed` as JSON. The fix is only `((n->'sealed')-array[...])`, preserving the exact field whitelist. An actual PostgreSQL constant regression reproduces the original `22P02`, verifies the fixed expression returns `{}`, and verifies an extra field remains detectable. The common immutability trigger was also made to branch on table name before referencing table-specific fields, preserving all allow/reject conditions. The final 20-case run includes repeated writes and revocation through both branches.

This deterministic new-fixture SQL defect is separate from the older unexplained legacy authorization incident. Neither its diagnosis nor the final passing run resolves that incident.

Required remaining work before activation:

1. Review and install a separate production schema/permission migration and roll-forward/recovery plan. The fixture must not be copied into an automatic migration directory. Verify least privilege with actual non-owner deployment connections and the real writer/lock order.
2. Implement and review the independent action-time confirmation issuer, its authenticated user-facing approval flow, protected signer connection, expiry/revocation, audit and denial handling. Possession of a receipt ID is not permission to issue another receipt. This offline issuer factory does not prove that a person approved an action.
3. Provide a separately controlled HTTPS key input surface with no third-party scripts/analytics/session replay, no caching, URL/query/localStorage/log transmission, and fixed trusted origin. Do not ask for real API keys in chat or use a public synthetic demo page.
4. Supply and operate a protected encryption master-key service and trusted sealer. SQL verifies approved metadata, immutable identity, configuration and ciphertext shape; it **cannot independently prove that arbitrary ciphertext decrypts to the approved key digest** without the trusted sealer/master key. A compromised runtime or sealer is outside that proof. No such master key or service was configured here.
5. Preserve the documented hostile-SQL deadline limitation: arbitrary runtime SQL can run `SET CONSTRAINTS ... IMMEDIATE` early. Deferred expiry triggers therefore are not an absolute wall-clock COMMIT authorization guarantee. Fixed capability calls still check current authority and expiry; fixed Node paths do not expose a raw SQL channel. Stage 14's bounded read broker is containment for its own read operation, not a fix for this write boundary or for a compromised broker/DB credential.
6. Keep the original intermittent legacy `RELATIONSHIP_UNAVAILABLE` incident classified as unexplained. Passing this new isolated suite is not evidence that the old incident was fixed. No blind old-suite reruns are part of this change.
7. Validate actual Supabase Edge deployment/driver compatibility, operation deadlines, recovery monitoring, secure UI and every remaining immutable-owner migration. Node tests with an injected connection do not prove deployed Edge compatibility.

The key-only runtime exposes the existing save/read/revoke routes only and defaults off. It has no issuer, model, upload, workflow or arbitrary SQL route, and no network listener is started by these factories. Production activation remains blocked.
