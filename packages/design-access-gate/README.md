# Prepared employee-to-visit access gate

This is an isolated, server-only dependency-injection boundary, not a deployed authentication implementation. Without all three authoritative adapters it denies access. It performs no I/O, reads no secrets and has no production route. Synthetic tests use fake identities and a symbolic credential; no actual employee session is created or renewed.

`createPreparedDesignAccessGate({authenticate, resolveAssignment, resolveCustomerVisit, now})` exposes:

- `authorize(opaqueCredential, {customerProfileId, visitId, assignmentSource})`: verifies active non-expired employee, exact server-owned appointment/frontdesk assignment and unambiguous customer/visit/store mapping. Returns only frozen actor and scope, not credentials.
- `withAuthorizedRead({credential,scope}, read)`: authorizes before reading and again before returning delayed data. A changed actor, deactivation, reassignment or mapping failure rejects delivery. The trusted read callback must constrain its query and returned rows to the supplied grant; this generic helper does not inspect arbitrary response bodies or replace row-level authorization.
- `createCommitGuard({credential,scope})`: returns `{grant,recheck}`. Recheck consults all sources again; it is not a bearer token or a lasting permission. The eventual durable transaction adapter must call it immediately before its atomic commit and implement appropriate database locking/transaction guarantees. This helper alone cannot eliminate a race between separate systems.

`authenticate` must be an existing trusted server session verifier, never a browser-supplied employee object or the synthetic service actor header. The current app's `requireEmployeeSession` already checks its custom hashed token and staff status; a real adapter must preserve that mechanism and accurately normalize expiration. No `auth.uid()` substitution is implied.

`resolveAssignment` receives only source and visit ID and must read the exact authoritative appointment/frontdesk assignment. Its normalized row is `{source,visitId,customerProfileId,staffUsername,store,active}`. The current `todayBookings` source filters employee username/store/date; production wiring still needs stable visit/customer identity, lifecycle/status mapping and reassignment policy. Never treat arbitrary barber display text or a phone as an identity grant.

`resolveCustomerVisit` receives the requested exact scope and server-derived store; it must independently resolve the same profile/visit/source/store with `unambiguous:true`. It returns `{customerProfileId,visitId,assignmentSource,store,unambiguous}`. Duplicate/shared-phone identities must fail, not silently choose a record. Inputs are lookup hints, not authority. Errors fail closed; no fallback to all customers or all stores exists.

This adapter deliberately has no owner-global override, photo access, provider endpoint, billing, credential persistence, migration, background learning or external transmission. Those still require their separate policies and approvals. A future binding to the production backend needs review and real integration tests in an approved isolated environment before rollout.

Test: `node scripts/test-design-access-gate.mjs`.
