# Stage13 identity, least-privilege and durable-ledger acceptance matrix

Status: **planned / pending independent acceptance**, 2026-11-15. Initial read-only baseline: `29ebd585`. This document records test requirements, not results or permission to deploy. Stage13 implementation is in progress in separate modules; no item below becomes passed merely because code exists or an older suite passed.

The authorized scope is isolated synthetic implementation and review. No production migration, grant, credential setup, real customer data, paid provider call, image-worker bypass or deployment is authorized here. Applicable approval must cover the particular storage, recipient, permissions and action. Do not request a real API key before the identity, secure-entry, durable-storage and deployment boundaries are accepted.

## Evidence boundaries

- The existing prepared UI/runtime remain the integration target, not a second production workflow. All production switches stay closed.
- Existing employee authentication reads an opaque token's SHA-256, then current staff by username/store (`employee-adapter.mjs`). That is not an immutable principal, nor Supabase Auth JWT/`auth.uid()` identity.
- Existing access grants, key slot ownership and authenticated encryption context, media owners, provider attempt keys and candidate actors use username/store. Adding an ID to a new table does not migrate these consumers.
- The old shared PG fixture connects as `postgres`. Its actual database transaction tests do not prove non-owner ACL/RLS isolation. New role tests must establish their actual connection identities.
- Stage12's final memo-active run passed the existing 12-case synthetic browser chain at the unchanged 30-second client timeout. Earlier 5/12 and 8/12 failures remain historical evidence. This is not a production load, hosting, driver or role-isolation result.
- The rootless Linux image-worker requirements remain separate. Current documented local daemon capabilities and the Mac host do not satisfy them; this review did not run a fresh environment probe.

## Acceptance records

For each test, record exact artifact/fixture revision, actual role/session identity where relevant, test command and outcome, state before/after, observed external mock-call count, error/outcome category, and exact resource cleanup. Keep identifiers and synthetic payloads in bounded test fixtures rather than general diagnostic logs. Never record plaintext keys, session tokens, approval secrets, customer content or raw SQL parameters in routine telemetry.

The only statuses in this initial matrix are:

- **PENDING / LOCAL**: feasible in a separately authorized isolated fixture, but not run or accepted by this document.
- **PENDING / TARGET**: needs the actual proposed host/service configuration and separate authorization; a local mock cannot establish it.
- **DECISION**: a policy/identity meaning must be explicitly selected before a test can establish the intended behavior.

## A. Immutable identity and lifecycle

Proposed authority tuple: server-issued immutable principal, employment episode, stable store/membership, revocation epoch/revision and session expiry. Names and store labels remain presentation/history data. Exact field names and versioned contracts belong to the implementation review, not this matrix.

| ID | Attack or transition | Required result | Status |
| --- | --- | --- | --- |
| I01 | Delete/deactivate person A, reuse the username for person B while A's token remains unexpired | A's token stays denied. B inherits no A key, approval, request receipt, candidate/media access or authority. A's historic authorship is unchanged. | PENDING / LOCAL |
| I02 | Rename one verified principal | Ownership stays tied to the principal; historic labels/digests remain unchanged. Legacy-token treatment follows an explicit policy rather than accidentally switching identities. | PENDING / LOCAL; token policy DECISION |
| I03 | Offboard, restore or rehire the same person | Old employment/membership/epoch remains invalid. Rehire needs a new episode and session; no automatic credential/approval/request resurrection. | PENDING / LOCAL; person-link evidence DECISION |
| I04 | Transfer store A to B and later back to A | The first A membership never becomes valid again. No customer/binding/key copying follows a display-name/store edit. | PENDING / LOCAL |
| I05 | Two simultaneous store memberships | Selected membership is explicit and server verified. Same request ID or receipt cannot cross memberships. | PENDING / LOCAL; multi-store policy DECISION |
| I06 | Existing booking/frontdesk row has only an alias; mapping is missing, duplicate or refers to a former employment | Resolve/list/load deny ambiguous authority. Name, phone and current username equality cannot invent the assignment-to-membership binding. | PENDING / LOCAL |
| I07 | Browser supplies principal, actor, store, epoch, session owner or identity attestation | Those fields cannot establish authority. Exact schemas reject unsupported fields; the server loads authoritative context. | PENDING / LOCAL |
| I08 | Reassignment after list fetch, before selection/load | Captured binding revision is rechecked. Stale selection is rejected rather than silently opening a different current assignment. | PENDING / LOCAL |
| I09 | Identity changes in each async boundary: initial authentication, approval wait, key callback, dispatch authorization, commit guard and final return | No unauthorized result delivery. No fresh authorization is replaced by request-local pure-validation memoization. | PENDING / LOCAL |
| I10 | Introduce new identity version beside legacy/native/full v1/v2 | Old bytes, hashes, sources, receipts and author labels are unchanged. New current grants do not arise from legacy alias equality. Unproven historical identity is explicitly unresolved. | PENDING / LOCAL |

### Integration closure, not just new ID storage

Before claiming full identity migration, enumerate the accepted identity version at each of: session issuance/validation, access gate, visit binding/list, workflow receipts, source confirmations, candidate publication/readback/acceptance, private-media ownership, complete archive authorization, key status/save/revoke/callback/AAD, approvals, provider attempts and HTTP final return. A still-legacy consumer must remain disabled or be behind a reviewed exact compatibility bridge. Silently dropping the new principal back to `{username,store}` is not such a bridge.

Historical identity attestations require an independent issuer and evidence standard. They must be separate append-only records, not modifications to old author/hash fields. A digest only checks consistency; it proves neither identity nor permission.

## B. Actual non-owner database permissions and RLS

The current row-lock protocol must remain intact. PostgreSQL 17 requires UPDATE privilege on at least one column of each table selected with a locking clause. A SELECT-only role cannot run these locked reads unchanged. Do not remove locks or grant broad business UPDATE to make the test pass. [PostgreSQL 17 SELECT](https://www.postgresql.org/docs/17/sql-select.html)

| ID | Attack or property | Required result | Status |
| --- | --- | --- | --- |
| P01 | Fixture silently uses installer/admin privileges | Assert actual `session_user` and `current_user`, non-owner relation/function ownership, no SUPERUSER/BYPASSRLS, and no membership path to privileged roles. Connect directly as the restricted LOGIN role. An admin connection that can `RESET ROLE` is not runtime confinement evidence. | PENDING / LOCAL |
| P02 | Required locked reads and legal appends | Positive operations succeed through the selected boundary while revocation-first/append-first outcomes, deadlines, CAS and idempotency remain correct. | PENDING / LOCAL |
| P03 | Direct SQL bypasses the JS executor | Unauthorized reads and bulk enumeration, mutable source/session/staff UPDATE/DELETE, forged workflow/full/candidate INSERT, receipt forgery and access revival fail at the claimed DB boundary. | PENDING / LOCAL |
| P04 | Runtime role issues its own approval, changes identity/lifecycle authority or consumes another principal's approval | Separate issuer/consumer capabilities are enforced; no self-approval by ordinary runtime. | PENDING / LOCAL |
| P05 | `SET ROLE`, `RESET ROLE`, inherited membership, schema CREATE, TRUNCATE, trigger disabling, replacement functions or `row_security=off` | None yields unauthorized rows, writes or bypass. Failure must not partially alter state. | PENDING / LOCAL |
| P06 | Forge identity/scope using custom GUC or JWT-shaped JSON | A caller-set setting alone is never authority. If a context mechanism exists, the protected verifier binds it to a real current opaque session/principal and checks scope. | PENDING / LOCAL |
| P07 | Search-path/temp-object/operator/function shadowing; function overloads and PUBLIC/anon/unrelated-role execution | Exact private capability signatures and qualified objects cannot be redirected. All unapproved execution paths fail. | PENDING / LOCAL |
| P08 | A pooled connection is reused by another employee after error, cancellation or rollback | No principal/scope/transaction state leaks to the next lease. Failed or uncertain leases are quarantined/discarded. | PENDING / LOCAL; production driver PENDING / TARGET |
| P09 | Concurrent revocation/reassignment against append, plus malicious final-row changes | Actual lock order and final commit checks preserve the stated ordering. No actor/source swap after checks; no timeout or guard removal. | PENDING / LOCAL |
| P10 | Hosted Data API, views, default privileges and inherited memberships differ from fixture | Review actual exposed schemas, ACL/RLS/function definitions and views under the exact staging role. Local fixture proof is not real-project inspection. | PENDING / TARGET |

If a private privileged capability function is chosen, it is a new security boundary, not a generic `SECURITY DEFINER` fix. Its owner must not be a business-table owner, superuser or BYPASSRLS role; runtime cannot become that owner. Review fixed search path/qualified objects, no caller-selected SQL, exact opaque-session verification, non-exposed placement and EXECUTE ACLs. PostgreSQL grants new functions PUBLIC execution by default, and temporary objects can shadow unqualified names. [PostgreSQL function security](https://www.postgresql.org/docs/17/sql-createfunction.html)

RLS controls rows after object access is granted; `authenticated` alone does not identify an authorized customer. Do not substitute `auth.uid()` or user-editable metadata for this application's custom employee sessions. A definer function skips RLS only when its owner can; the actual owner/role/table policies, not the keyword alone, determine the result. [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)

## C. Persistent approvals, reservations and uncertain outcomes

The old provider seam takes `reserve({key,fingerprint})` and `settle(...)`. These digests are not database-verifiable employee identity. A trusted request facade must bind the stored request to authoritative principal/employment/membership/epoch, request identity, exact scope and approved operation. A caller-supplied actor or arbitrary database setting cannot substitute for that binding.

Approval issuance, one-time authorization/budget reservation and repeated fresh checks are distinct operations. The runner calls gates at several stages and on completed replay. The implementation must neither consume a fresh approval at each check nor reuse one approval for a different request/payload.

| ID | Attack/failure schedule | Required result | Status |
| --- | --- | --- | --- |
| L01 | Forged receipt, `approved:true`, expired/revoked receipt, wrong issuer or principal | Deny before provider dispatch. A receipt ID/hash is not proof of approval. | PENDING / LOCAL |
| L02 | Change request ID, scope, source/derivative digest, purpose, model, endpoint, expected revision, payer or budget | Exact-intent mismatch denies; no fallback to a broader approval. Token limits are not monetary limits. | PENDING / LOCAL; actual cost policy DECISION |
| L03 | Two processes reserve the same request concurrently; same ID with different fingerprint | One durable reservation only; incompatible reuse conflicts. At most one dispatch grant is issued. | PENDING / LOCAL |
| L04 | Repeat before-reserve/send/return/replay checks with the same exact request | Fresh authorization remains required but approval/budget is not consumed twice; completed replay makes zero new provider calls. | PENDING / LOCAL |
| L05 | Crash before reserve commit, after reserve, after dispatch authorization, after send, after response or during settlement | Each boundary has an explicit recoverable durable state. Possible send/COMMIT success remains uncertain, never silently reset to not-sent. | PENDING / LOCAL |
| L06 | TTL expires, process restarts or original employee is offboarded while request is pending/uncertain | Tombstone/request identity survives. Expiry and identity changes never grant permission to resend or create an automatic paid retry. | PENDING / LOCAL |
| L07 | Revoke identity/approval/binding while `authorizeDispatch` awaits | Final grant uses current locked authority. Revoke-before-grant denies. Grant-before-revoke behavior is explicitly defined; do not claim an already sent request is cancelled. | PENDING / LOCAL |
| L08 | Forged completion/result, wrong principal or receipt, corrupted result digest, cross-scope cached replay | Reject without exposing results. Current permission must be checked immediately before delivery, including after asynchronous result loading. | PENDING / LOCAL |
| L09 | Settlement succeeds but acknowledgement is lost; caller repeats settlement or queries same identity | Preserve the original terminal record/result. No overwrite or duplicate external call; acknowledgement uncertainty is distinct from data loss. | PENDING / LOCAL |
| L10 | Runtime directly edits/deletes attempts, issues approvals, revives tombstones or reads another employee's result | Actual non-owner SQL/RLS/capability tests deny, not merely JS API tests. | PENDING / LOCAL |
| L11 | Current key rotates/revokes after a request completed | Authorized readback of an already stored result does not require a new billed call or old plaintext key; identity and result access still apply. New dispatch needs the current approved exact key/configuration. | PENDING / LOCAL |
| L12 | Request or result is huge, malformed, getter/proxy-shaped in internal calls, or logs include sensitive fields | Bound shape/bytes before costly work; safe-copy behavior is explicit. Diagnostics expose only reviewed codes/aggregates, never content or secrets. | PENDING / LOCAL |

The DB and external provider are not one transaction. A durable dispatch grant is a conservative boundary, not proof that the provider received or did not receive bytes. Keep external exactly-once claims out of acceptance. A new manually requested operation, after an uncertain one, needs its own applicable exact approval and an explicit reconciliation policy; the code must never invent that decision.

## D. Key ownership and secure entry

| ID | Required check | Status |
| --- | --- | --- |
| K01 | Ciphertext AAD/record slot includes the accepted immutable identity context and independent purpose/revision; alias reuse, membership reuse and ciphertext swapping fail. | PENDING / LOCAL with synthetic secrets |
| K02 | Save/revoke CAS, consumed-approval/save failure, final identity checks and uncertain commit outcomes are defined; old revision zero cannot revive a tombstone. | PENDING / LOCAL |
| K03 | Chat and speech cannot silently share/fall back to another slot, owner key or server default. Returned settings/callback results and logs contain no raw key or digest. | PENDING / LOCAL |
| K04 | Secure input uses an exact reviewed HTTPS origin, no URL/browser storage/cache/analytics/session-replay leakage, current identity, bounded request body and protected approval issuance. | PENDING / TARGET; no real key requested |
| K05 | Dedicated secret-manager provisioning, rotation/versioning, recovery, offboarding and backup-retention behavior have applicable approval and operational evidence. | PENDING / TARGET / DECISION |

Approval wording must describe the actual persistent-access effect and the exact storage/recipient/scope. Existing module-specific receipt requirements may be stricter than platform defaults; do not generalize them into a claim that every personal API-key action universally requires another action-time confirmation. Saving a credential never itself approves customer processing or spending.

## E. What can and cannot be closed locally

**Feasible later in isolated local synthetic tests:** immutable identity/lifecycle transitions; versioned compatibility; actual non-owner roles/RLS and direct-SQL negative tests; durable reserve/settle/approval races; restart/crash/uncertain COMMIT fixtures; mock-provider dispatch counts; safe output/logging; fresh-gate timing; existing UI/default-close regression. This review itself runs none of them.

**Still requires an accepted target:** actual hosted HTTPS/proxy/CORS/pool behavior; actual deployed database definitions/exposure/role membership; approved identity and approval issuers; real secure-key-entry/secret-manager operations; private storage lifecycle; supported rootless nonroot Linux broker with cgroup-v2/systemd enforcement; approved immutable image/native decoder corpus; authenticated bounded broker IPC, physical resource/network/host-access negative tests and orphan cleanup. The web/Edge process must not receive a Docker socket. Do not use a Mac/synthetic/flag-based fallback or weaken host checks to bypass these gates.

**Not part of this stage:** real customer capture/recording/upload, real model calls/quality evaluation, monetary approval, production DDL/grants/credentials, rollout or publication. The old intermittent `RELATIONSHIP_UNAVAILABLE` incident is not explained merely by adding a new identity table or a passing rerun.

## Open decisions and review handoff

Pending choices include the authoritative identity issuer and historical link evidence, rehire/multi-store semantics, assignment-to-membership mapping, retention/revocation policy, exact permission/capability design, approval issuer and bounded spending units, and the post-dispatch reconciliation operator/process. Tests must name their provisional choices rather than present them as approved production policy.

Independent review should examine the actual identity/RLS and ledger implementations after their authors declare a stable point. Report concrete defects and missing tests without changing the other authors' files. New modules that are not connected through the current runtime must be labelled isolated preparation, not completed identity migration or production access control.

References checked read-only on 2026-11-15: [Supabase changelog](https://supabase.com/changelog.md), the official RLS and PostgreSQL 17 pages linked above. No Supabase CLI, real project query, credential, DDL, grant, Docker or browser action was performed for this review. The main deployment checklist remains the root-owned activation authority; this document is a pending acceptance plan only.

## Stage13 evidence update (bounded, not matrix-wide closure)

The tables above retain the original full-product acceptance requirements; a new isolated slice is not completion of those requirements. Actual non-owner identity tests passed 13 normal/denial assertions; actual policy persistence passed 18. Independent pure identity24/policy18/budget5 checks passed. The unchanged original homepage workflow passed 12/12 with the default 30-second client deadline.

**Confirmed BLOCKED finding affecting P02/I09/L07:** both database suites demonstrated that a caller controlling arbitrary runtime SQL can force deferred expiry evaluation with `SET CONSTRAINTS ALL IMMEDIATE`, then commit after expiry. This is recorded separately from protection passes. Every capability still checks present authority at call time and normal fixed adapters preserve their checks; arbitrary-SQL commit-deadline enforcement is not established.

Current scope evidence: actual role/RLS/capability isolation, immutable identity lifecycle, exact independently seeded receipt and data-context binding, cross-employee denial, durable reserve/claim/terminal states, concurrent reservation, lost commit acknowledgement, no automatic provider replay, precise byte limits and denied direct malformed mutations. Detailed commands and boundaries are in STAGE13-IDENTITY-CAPABILITY.md and STAGE13-POLICY-PERSISTENCE.md. No production issuer, historical identity attestation, full key/media/candidate identity migration or target-worker acceptance is supplied. Those whole-product rows remain pending.
