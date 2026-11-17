# Stage12 identity and minimum-permission proposal

Review draft, 2026-11-15. **No identity store, schema, migration, grant, credential, production configuration or access expansion is implemented or authorized by this document.** This is an independently reviewable design and synthetic acceptance plan. The current runtime stays disabled. Obtain applicable approval for the specific storage, recipient and permission scope before any later credential or deployment action; broad production administration, bulk secrets and security-setting changes retain their stricter requirements. Do not request a real API key before secure input, durable isolation and identity acceptance are complete.

## 1. What the code currently proves, and what it does not

- [employee-adapter.mjs](./employee-adapter.mjs) hashes an opaque employee session, selects exactly one live session, rereads `staff` by username, compares store, active/employment status and expiry, and returns `{username,store,active,expiresAt}`. This is this application's custom employee-session protocol, **not** Supabase Auth JWT authentication or `auth.uid()`.
- [design-access-gate](../design-access-gate/index.mjs) and the binding/history adapters use actor `{username,store}`. Assignment authority still originates in exact booking/frontdesk rows and a separately verified visit/profile binding, not a name/phone match. Binding actor and assigned-stylist fields have exact schemas.
- [key-settings.mjs](./key-settings.mjs) locks and compares `username + store + purpose`. That does not establish a permanent human identity. The prepared adapters do not consume an authoritative immutable employee identifier, and no production identity source has been verified in this review. A concurrent UNIQUE username constraint alone does not establish lifetime non-reuse.
- Existing native/candidate/full/legacy authorship, source and receipt digests are immutable evidence. They must not be rewritten merely to make a new identity schema convenient.

Consequently, deleting/deactivating an employee then recycling their username could make a still-live old session or old key owner tuple match a different active person. A move away from, then back to, a store can also recreate an old tuple. These are design risks derived from the current comparisons, not claims that either incident occurred in live data. The prior 42.743/37.188-second synthetic performance failure was followed by Stage12 default-30-second 12/12 acceptance (see SYNTHESIS-PROFILING.md); production load remains unverified. Historical intermittent `RELATIONSHIP_UNAVAILABLE`, deployment/driver and image-worker blockers remain independent; a new identity design does not fix them.

## 2. Recommended identity model

Use a **server-issued immutable principal plus explicit employment and store membership**. A username is only a changeable sign-in/display alias.

| Proposed identity element | Invariant and purpose |
| --- | --- |
| `employeeId` | Opaque stable ID from an approved authoritative issuer; never reassigned to a different person. It must not be derived from name, phone or a browser field. |
| `employmentId` | A distinct employment episode. Offboarding terminates it; rehire creates a new episode even if the verified person retains `employeeId`. |
| `storeId` and `membershipId` | Stable store identity and explicit employee-to-store membership. A display-name change is not a transfer. Multiple memberships, if approved, are separate records rather than comma-separated names. |
| `securityEpoch` / membership revision | Monotonic revocation/version values checked against current authority. An old session cannot become valid again after leave/restore, username reuse or a move back to the original store. |
| Alias history | Append-only evidence of alias assignment and effective interval. It is not an authorization table for guessing old authors or service assignments. |

A future authenticated server result should carry the verified principal, employment, selected membership, store, current epochs and expiry. The opaque session's stored owner must bind that exact tuple at issuance. Every gate compares it to current authoritative rows; no browser `employeeId`, actor header, username, store claim or arbitrary database session variable establishes identity. The UI may continue displaying a historical username/store label, but label equality is not the access check.

**Recommended rehire policy:** retain the person ID only after explicit identity verification, create a new employment/membership and session, and inherit no previous keys, candidate rights, approvals or pending command authority. A new record for an unverified person is safer than silently linking them by a reused alias. The approved issuer and evidence standard are unresolved decisions, not implemented onboarding.

## 3. Lifecycle and authorization behavior

### Username rename or reuse

A rename changes a current alias, not principal ownership. Rotate/revoke sessions according to the reviewed session policy so the legacy username bridge cannot revive an older login. Historic archive labels remain exactly as originally stored.

Username reuse must not select an old principal, key slot, attempt receipt, approval, candidate, media ownership or binding authority. During transition, deny ambiguous alias mappings and keep affected production capabilities disabled. Do not manufacture identity continuity by overwriting staff rows or making the username field contain a UUID.

### Offboarding and rehire

Atomically mark the employment/membership inactive and advance revocation epochs in the authority transaction. Revoke active sessions and disable applicable key leases/approvals under their reviewed stores. Do not erase immutable business history or unknown provider-attempt receipts. Actual ciphertext retention/destruction is a separately approved policy, not an action taken here.

Reauthorization before sending, before commit and immediately before returning remains mandatory. Revocation before the relevant lock/read must deny; if a write committed first, retain that version but withhold delivery after revocation and report an uncertain acknowledgement where appropriate. Do not claim that revocation can undo an already transmitted paid request. Provider calls remain outside database locks.

### Store transfer

Revoke the old membership/session and old scoped key access; create an explicitly approved new membership. A transfer is not a bulk reassignment of customers or historical archives. Each affected service assignment/binding requires the existing explicit management process and a new binding revision. Unchanged old bookings that contain only a historical username must not be silently mapped to the new membership.

Keys remain scoped to principal **and membership/store and purpose**. No owner/global fallback, cross-store copying, key resurrection on rehire, or silent chat-to-speech reuse. A new purpose/store configuration requires its own exact approved scope and current CAS revision. Offboarding/reassignment checks must cover cached candidate returns and key callbacks after asynchronous waits as well as initial reads.

### Receipts and historical authors

New requests/approvals must bind the immutable principal tuple, current scope/binding revision, operation, expected version, payload digest and request identity. A request ID reused by another employment or membership is denied, even if the username, store label and JSON payload match. Uncertain paid operations retain their original identity; changing a principal never authorizes a new paid retry.

Keep old v1/v2 records and hashes byte-for-byte unchanged. Introduce an explicitly versioned new actor/receipt envelope and separately appended identity attestation only when an authorized reviewer can prove a historical link. Old authors without that proof display as **legacy identity unresolved**. They are not assigned to today's user merely because the alias matches. Historical read access is decided by current service/store policy, never by an inferred authorship link. Neither a digest nor an attestation from the browser is authority.

## 4. Compatibility and phased implementation gates

This is a future change across the current contracts, not a UI-only field addition. Exact actor validators, employee/session verification, binding history, media/candidate access, key slots, approval/attempt receipts, full-archive validators and repository uniqueness must all be reviewed together.

1. Inspect the actual authorized identity source and existing constraints in separately approved staging. Establish issuer, stable IDs, alias reuse rules and store membership. Do not inspect production or copy real records under this document.
2. Specify a versioned server authentication/grant envelope and explicit compatibility rules. Preserve old schema readers and hashes. No implicit in-place migration, guessing, automatic backfill or enabling the old username-based key path meanwhile.
3. Provide a trusted mapping for **current visit assignment to membership**, independently of display names. Missing or conflicting mappings fail closed. The browser's list remains a locator snapshot; selected visits still re-resolve with the captured binding revision.
4. Implement the new authority, session, key and receipt rules in an isolated synthetic fixture. Continue current final guards, deadlines and post-transaction/media rechecks. Pure memoization or same-transaction locked-row reuse must not cache fresh authorization across transactions.
5. Test a production-like non-owner role/connection configuration with synthetic records and concurrent revocation, then separately obtain the exact approved rollout and data/recipient/cost scopes. Default-close rollback must leave append-only history and uncertain requests available for authorized reconciliation.

An eventual Supabase Auth integration would require an explicit issuer/session mapping to this principal model. Do not substitute `auth.uid()`, user-editable metadata, or stale JWT claims for the current opaque-token and fresh membership checks. Supabase grants and RLS are distinct layers; authentication alone does not authorize a customer's row. [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

## 5. Minimum-permission design options

The existing inventory in [DEPLOYMENT-APPROVAL-CHECKLIST.md](./DEPLOYMENT-APPROVAL-CHECKLIST.md) is the statement/column source of truth. This document does not install the proposed role split or claim a SELECT-only role already works.

### The locking constraint is real

PostgreSQL 17 requires SELECT on referenced columns and UPDATE privilege on at least one column of each table locked by the SELECT locking clauses. Changing `FOR SHARE` to a different row-lock strength does not remove that requirement. The current executor depends on these locks for revocation/commit ordering. Do not remove them or grant blanket business UPDATE to make a permission error disappear. [PostgreSQL 17 SELECT](https://www.postgresql.org/docs/17/sql-select.html).

**Option A: direct constrained server role.** Retain the current fixed-statement executor and prove the exact locking/append capabilities under narrowly granted columns, RLS and immutable-row constraints. This is not presently proven for mutable session/staff/assignment/profile tables. A harmless-looking column UPDATE grant is still a write capability. A false UPDATE policy is not evidence that the required locked SELECT will work: test both operations with the actual non-owner role. Direct INSERT privileges are not “RPC-only”; they can bypass JavaScript validators unless database boundaries enforce the same invariants. Select this option only with an explicit reviewed capability and negative-test matrix.

**Option B: narrow private database capability boundary.** Preferred for investigation, not approved or implemented. A fixed-function API could encapsulate authenticated locked reads and the exact CAS/append operations so an application role cannot access the base business tables directly. It must preserve the existing transaction, final guard, deadline and revocation semantics, not move them into an unchecked helper. An invoker function does not solve missing caller lock privileges by itself.

If a privileged function is proposed, treat it as a new security boundary, not a `SECURITY DEFINER` shortcut. Its narrowly privileged non-login owner must not be a base-table owner, superuser or `BYPASSRLS` role; the caller must not be able to become that owner. Use a non-exposed private schema, fixed qualified objects/search path, no dynamic SQL, no user-controlled identity variables, explicit caller/opaque-session/principal authorization and only exact function signatures. Review default/PUBLIC execution, schema CREATE and inherited role memberships. Revoke broad execution as part of a separately approved implementation, not through this draft. PostgreSQL gives functions PUBLIC execution by default, and ownership is itself broad authority. [PostgreSQL privileges](https://www.postgresql.org/docs/17/ddl-priv.html).

**Rejected shortcuts:** browser service-role keys; a broadly privileged shared production connection plus only UI checks; `SECURITY DEFINER` owned by a blanket administrator; arbitrary SQL/RPC proxies; removing fresh reads/locks/deadlines; or adding `auth.uid()` policies without a real mapping for this application's sessions.

### Capability separation to prove

| Capability | Future minimum boundary | Must not receive |
| --- | --- | --- |
| Ordinary workflow/full archive | Current authorized source/context reads and exact scoped immutable appends with receipts | Staff/session/source edits, binding issuance, approval issuance, role or schema management |
| Binding management | Distinct approved bind/reassign/revoke/restore intents and one-use approval consumption | Ability to issue its own capability/approval or silently infer a profile from name/phone |
| Candidate/media publication | Server-generated bounded envelopes/metadata, exact initial access state, source checks | Browser-authored candidate authority, access revival, raw image bytes in DB history |
| Identity/lifecycle issuer | Independently approved principal/membership/session/decision changes with durable audit | Ordinary employee self-elevation; automatic customer or key transfer |
| Revoker | Monotonic epoch/access-state revocation for specified targets | Deletion/revival of immutable evidence or unrelated authority |
| Secret/attempt service | Exact principal-membership-purpose CAS, protected key callback, durable reservation/settlement | Bulk plaintext enumeration, global fallback, new paid retry of uncertain attempts |
| Installation owner | Separately approved schema/role/trigger installation and review | Runtime reuse of its administrative identity |

The current single injected connection does not enforce this role diagram. Choose separate reviewed entry points/connections or the narrow capability boundary before claiming separation. Private tables/functions must not be exposed to browser `anon`/`authenticated` access. Review RLS as defense in depth, function execution ACLs and inherited/default privileges independently. Current legacy `to_jsonb` reads include full rows; do not claim column-minimized grants without reviewing/refactoring those exact queries. No new legacy write capability is required merely to read existing legacy versions in full-format history.

## 6. Required synthetic negative tests (not run by this draft)

- Reuse a username for a different principal while the old session is unexpired: old session/key/approval/receipt/candidate access denied; no old historical author relabelled.
- Rename one verified principal: ownership remains stable, historic username bytes/hashes unchanged, old compatibility sessions obey the explicit revocation policy.
- Offboard and rehire the same person: old employment/membership epoch stays invalid; new session does not inherit a prior key or paid-attempt authority.
- Move store A→B→A: all original membership sessions/keys remain invalid. No old visit is reassigned or exposed automatically.
- Two approved simultaneous memberships: explicit store selection and exact binding required; switching store cannot replay a prior-store request or receipt.
- Revoke before lock, during the final asynchronous verifier, after provider transmission and after commit: no unauthorized return; no repeated paid call; committed-but-withheld outcomes retain their original receipt and history.
- Reject ambiguous alias/assignment mappings, forged client principal/actor, stale epochs, duplicate IDs and unauthorized identity attestations.
- Preserve every legacy/native/full digest when a new identity version is introduced; unresolved authors remain unresolved and cannot authorize current access.
- With actual non-owner roles: prove required locked reads work while direct business UPDATE/DELETE, unauthorized INSERT, history overwrite, approval issuance, access revival, role switching, schema creation, trigger disabling and arbitrary function calls all fail.
- For any proposed capability function, test PUBLIC/anon/unrelated-role execution denial, hostile search path/object shadowing, forged identity/session variables, cross-store inputs, expired approvals and CAS/replay races. An administrator-only fixture pass is insufficient.

## 7. Decisions still required

The approved immutable identity issuer and verification process; whether a verified rehire retains the person ID; supported multi-store membership semantics; exact transfer/offboarding and key-retention policy; historical identity-attestation authority and unresolved-record treatment; the selected lock-preserving permission option; deployed server/driver/storage/secret boundaries; and the production-like negative-test evidence are all unresolved. Recommended defaults above are proposals, not permission to execute them.

Primary references checked 2026-11-15: [Supabase changelog](https://supabase.com/changelog.md), the RLS guide and PostgreSQL 17 pages linked above. Relevant tooling changes do not change this repository's custom employee-session contract; no CLI, project query, credential setup, DDL or grant was run. This draft is not a declaration of production readiness.
