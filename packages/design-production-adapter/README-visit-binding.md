# Prepared authoritative visit binding

`visit-binding.mjs` is executable server-side preparation with **no default I/O, permission, lifecycle policy, binding inference or database deployment**. It fills the interface previously left to `resolveVisitBinding`, while keeping persistence and human/server verification as explicit trust boundaries. Its synthetic tests use the actual employee adapter. It is not automatically installed in the application or any production handler.

No customer names, phones, images, credentials or source business records are copied into a binding. A requested profile ID is only a proposed target. A binding becomes usable only after independent current source/profile/stylist checks, an authorized operator, an exact approved mapping and atomic append.

## Public API

```js
const binding = createVisitBindingAdapter({readTransaction, writeTransaction, clock});
const employee = createProductionEmployeeAdapter({
  restRows, rpc, clock,
  resolveVisitBinding: binding.resolveVisitBinding,
});
```

`resolveVisitBinding(row)` accepts the employee adapter's exact normalized row:

```js
{source:'appointment', visitId:'booking:101', id:'101',
 staffUsername:'synthetic-stylist', store:'自由手艺人',
 bookingDate:'2026-11-15', status:0}
```

It returns no mapping (`[]`) when none exists or the current version is revoked. Otherwise it freshly rereads the exact assignment, immutable binding history/receipts, assigned stylist and profile, separately evaluates the lifecycle policy, checks `customer_design_resolve_context`, then rechecks source, policy and history before returning the exact employee-adapter shape:

```js
[{assignmentSource:'appointment', visitId:'booking:101',
 customerProfileId:'11', store:'自由手艺人', bookingDate:'2026-11-15',
 visitKey:'booking:101', active:true, revision:'binding:1'}]
```

This shape is a point-in-time normalized result, not a bearer grant. The employee/access gate still authenticates the calling employee and rechecks before protected work. Store sharing is not write authority. Source reassignment does not silently move a grant to the new stylist; until an explicitly approved reassign is appended, both the stale mapping and newly claimed mapping are denied.

Mutation entrypoint:

```js
await binding.applyChange({
  credential: opaqueEmployeeSessionToken,
  requestId: '20000000-0000-4000-8000-000000000011',
  expectedRevision: 0,
  action: 'bind',
  visit: {assignmentSource:'appointment', visitId:'booking:101'},
  customerProfileId: '11',
  approval: opaqueSingleUseApproval,
});
```

The actor/store come from the existing SHA-256 custom employee session verifier, not the body or actor headers. All fields are exact, bounded and validated; extra owner/store/stylist/name/phone/history fields are rejected. Request IDs are canonical lowercase UUIDs. The actor must also pass a separate current operator-capability check; an ordinary active employee or assigned stylist does not automatically gain binding-management authority.

Actions:

- `bind`: first version only, expectedRevision=0.
- `reassign`: existing binding, different stylist derived from the current authoritative source. It can also reactivate a revoked binding for a newly assigned stylist, but needs a new exact approval.
- `revoke`: existing active binding; preserves its last exact identity. It remains possible after the source assignment/profile has disappeared, since revocation must not depend on keeping access alive.
- `restore`: revoked binding only, same stylist, current source/profile/lifecycle checks and new exact approval.

**The first binding fixes customerProfileId, store, service date and visit key.** Reassign is a stylist change, not a customer-identity correction. Wrong-profile/store/date corrections, source merge/split and legacy `manual:<date>` reparenting require a separately designed and approved workflow; they are deliberately unsupported. Existing binding history and archives are never rewritten or moved.

Appointment identity is `booking:<positive-safe-integer>`. Frontdesk identity is `frontdesk:<lowercase-uuid>`, with archive key `manual:<service-date>:<that-uuid>`. Two same-day visits to the same profile remain separate.

Result: `{requestId,visit,appliedRevision,currentRevision,replayed}`. It is a minimal **historical commit acknowledgment**, not a live access grant or a binding document. Exact retry after later revocation can report appliedRevision=1/currentRevision=2 without restoring revision 1. Consumers must resolve current authorization for any later data access. A response can arrive after the transaction committed and the operator was subsequently revoked; no live claim, customer identity, stylist data or approval is included in this acknowledgment. A closed transaction handle is never reused to pretend it provides post-commit authority.

## Trusted transaction dependencies

Both `readTransaction(callback)` and `writeTransaction(callback)` must execute against an authoritative, correctly scoped server repository. Default absence fails closed. A callback receives:

| Method | Contract |
| --- | --- |
| `restRows(path)` | Decoded exact source rows for fixed parameterized table/column queries; reads must belong to this transaction. |
| `rpc(name, params)` | Same-transaction shared `customer_design_resolve_context`; name/phone consistency inside the existing resolver is only a secondary check, never the source of binding authority. |
| `readBindingHistory(visit)` | Complete ascending immutable history for exactly this source visit, max 256. Missing-middle/duplicate/malformed versions fail; never silently truncate/reset. |
| `readRequest(requestId)` | Exact immutable receipt or null, with global request uniqueness. |
| `evaluateLifecycle(row)` | Fresh `{allowed:true,policyRevision}` only after an approved source-specific status/revocation policy; unknown/unconfirmed meanings must deny. |

Writes additionally require:

| Method | Contract |
| --- | --- |
| `authorizeOperator({actor,action,visit,customerProfileId})` | Verify current management capability from authoritative server state. Only exact boolean true allows. Browser roles and the proposed profile are not authority. |
| `consumeApproval({approval,intent,intentSha256})` | Atomically consume an unexpired, unused, exact approval belonging to this operator and mapping. Return `{receiptId,intentSha256,expiresAt}` with an integer millisecond deadline; expiry is checked again before commit. The trusted approval issuer must have verified the mapping independently; this module does not issue approvals. |
| `appendVersion({expectedRevision,record,receipt})` | Atomically enforce head CAS and unique request, append the new immutable record and its receipt in the same transaction; return true. Never mutate old versions. |
| `beforeCommit(hook)` | Register an awaited final guard in that same transaction immediately before commit. Hook error must roll back version, receipt and approval consumption together. |

The approval intent includes server actor, exact request/action/expected revision/profile/visit, previous binding state, exact target store/date/visit key/stylist and independently evaluated source status/policy revision. If source assignment changes after approval was issued, its exact intent no longer matches. No wildcard consent, automatic binding or phone/name fallback exists. Raw approval/employee credentials are not persisted; only an authority receipt identifier enters the audit record.

Each immutable version includes schemaVersion, source visit, revision/previousRevision, requestId, action/state, profile/store/date/visitKey/stylist, authenticated operator, authority receipt ID, source status/policy revision and timestamp. Each request receipt binds actor, source visit, command hash, applied revision and whole-record hash. Reads recompute these relationships, so merely altering an old record into a valid-looking different profile does not turn it into authority. Hashes are consistency checks, not signatures or protection against a database owner rewriting every related object.

Writes check operator authentication/capability repeatedly, including after asynchronous policy/source waits and inside the final commit hook. Source, profile, target staff, lifecycle and history are rechecked before and after staged append. Exact requests replay their original applied revision under fresh operator authorization; changed command/actor/visit conflicts. Unknown post-commit acknowledgment failures return `BINDING_OUTCOME_UNCERTAIN`; retain the same request/command and verify or replay, never generate another request blindly.

## Lifecycle and identity remain explicit

The booking importer accepting numeric statuses 0/1/3/4 is **not** proof those statuses mean access is allowed. No such mapping is installed here. `evaluateLifecycle` must be backed by a separately reviewed policy and current authoritative revocation information. The mock policy is synthetic, not the production policy. Unknown policy/status, ambiguous source/profile, inactive target stylist, missing approval or absent transaction capability denies.

The module reads `bookings` or `frontdesk_today_customers` by stable source ID, `staff` by exact quoted username, and `customer_profiles` by the explicitly proposed stable ID. It checks real schema columns but does not query names/phones or bulk customer datasets. The existing shared RPC's additional source consistency is retained; approval must establish the stable mapping independently. No source row, customer profile or employee session is modified.

## Real database transaction blueprint

The separate [guarded fixture SQL and PostgreSQL test notes](drafts/README.md) describe non-installed SQL and actual isolated database checks. They are **not automatically wired to this JS adapter**, are not in `supabase/migrations`, and do not install production permissions. The fixture tests binding/restore/reassignment/revocation and archive-append primitives, but it is a separate synthetic schema, not the JS transaction executor or the complete application persistence format. Its exact coverage and remaining differences are listed in the fixture README.

Required production design, before any activation:

1. Add private immutable binding versions, a unique source-visit head/CAS record, immutable request receipts and exact approval receipts. Required identifiers are source+source row ID, stable customer profile ID, source service date/store, stylist account, state/revision/previous revision and explicit approval/lifecycle audit references. Keep distinct frontdesk UUID keys and preserve old archives. Existing customer/booking tables do not silently acquire a profile mapping.
2. Implement restricted server-only binding mutation/read and archive-append transaction boundaries. No public/anon execution, browser direct table access or `auth.uid()` substitution for existing custom sessions. Keep RLS and least privilege; review function owner, search_path, immutable triggers and EXECUTE grants separately. No permission changes are made here.
3. Use a consistent lock order across binding mutation, revocation and archive append: request serialization, session/staff authorization rows, source-visit serialization, current source/lifecycle/profile, then binding/archive heads. Multi-staff/profile locks require canonical ordering. External source/staff/session writers must not introduce reverse order; review actual writer transactions before rollout.
4. Hold authorization and source/binding locks through commit, or use a reviewed serializable/version protocol providing the same guarantee. Direct UPDATE/DELETE must conflict with those locks. If revocation wins first, the append denies; if the append commits first, revocation commits afterward and denies all later work. A successful JS `Promise` queue or several PostgREST calls are not that guarantee. A stale MVCC snapshot is not a fresh revocation check.
5. Approvals, head CAS, immutable version/receipt append and archive linkage must commit or roll back together. Unique constraints and immutable triggers protect historical rows; never reset a damaged/incomplete history to an empty binding. Test concurrent CAS, conflicting request reuse, delayed authorization, rollback and lock contention in PostgreSQL under the eventual real role/function layout.

No live stable binding repository, lifecycle policy, approval issuer, transaction transport, migration or production route has been installed. Preparing and testing this logic does not make activation authorized or complete.

## Tests

`node scripts/test-design-visit-binding.mjs` currently runs 24 purely synthetic checks, including real employee-adapter composition, exact approvals, current capability, source reassignment, revoked/deleted sources, restore, immutable customer scope, frontdesk isolation, CAS, idempotency, receipt integrity, late revocation rollback, input mutation and uncertain acknowledgments. Global fetch is disabled. The test's queue is only a simulator; real PostgreSQL transaction results are reported separately by `scripts/test-design-binding-postgres.mjs`.
