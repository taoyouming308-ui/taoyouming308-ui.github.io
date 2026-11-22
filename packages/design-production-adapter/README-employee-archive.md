# Prepared employee and archive server adapters

These modules contain executable, reviewable server adapter logic, but are **not wired into any production handler**. There is no default `fetch`, URL, database client, environment lookup, token storage, key reader, migration, permission change or deployment. Tests inject synthetic REST/RPC rows and a transaction simulator. Injected functions are trusted server dependencies, never browser-supplied functions or objects.

## Employee identity and scope

`createProductionEmployeeAdapter({restRows, rpc, resolveVisitBinding, clock = Date.now})` exports:

- `authenticate(sessionToken)` → frozen `{username, store, active:true, expiresAt}`.
- `gate.authorize(credential, scope)`, `gate.withAuthorizedRead({credential,scope}, read)` and `gate.createCommitGuard({credential,scope})`: the existing `design-access-gate` interface and delayed-read/commit rechecks.
- `resolveArchiveContext({credential,scope})` → `{actor:{username,store}, scope, context:{customer_profile_id,booking_id,booking_date,visit_key,store}, bindingRevision}`.

`validateProductionDesignScope(scope)` accepts exactly:

```js
{customerProfileId: '11', visitId: 'booking:101', assignmentSource: 'appointment'}
// Or an actual frontdesk row UUID, kept separate from appointment IDs:
{customerProfileId: '11', visitId: 'frontdesk:00000000-0000-4000-8000-000000000003', assignmentSource: 'frontdesk'}
```

These are lookup hints, not permissions. Profile/booking IDs must be canonical positive decimal strings representable as safe integers. UUIDs are canonical lowercase. Client `owner`, employee, store, phone, name, date, visit-key and permission overrides are rejected. No `demo-ui-owner` actor header is authentication.

### Existing schema reused

The implementation follows `supabase/functions/employee-bookings-api/index.ts`:

1. Hash the opaque custom session token with SHA-256. Read exactly one non-expired `employee_booking_sessions` row, then independently reread `staff` by that username. Check the exact username/store, explicit active status and `employment_status='active'`, expiration before/after delayed reads, and an existing supported store. Raw tokens never enter URLs, resolver inputs, RPC payloads, grants, errors or returned data. Hash filters are server-only and must not be logged by the eventual transport.
2. Read the exact assignment from the same `todayBookings` sources: `bookings.id/barber_name/shop_name/date/status` or `frontdesk_today_customers.id/barber_name/store/business_date/status`. Keep the two sources distinct. Never use the list's phone/name deduplication helper as an authorization resolver.
3. Resolve an independently verified stable assignment-to-customer binding. Require exact matching profile, source, visit, store, date and an active binding revision.
4. Read the profile by its stable ID, use the shared `scopeCustomerProfile`/store mechanism, and invoke the existing parameterized `customer_design_resolve_context` RPC. The current stricter write scope requires the profile's home store to equal the employee/assignment store. Cross-store membership/history read sharing does **not** grant design writes. The RPC checks the original profile/booking identity as an additional consistency check, not as a substitute for the stable binding. Returned customer name/phone are discarded.

Compared with the existing endpoint, this prepared verifier deliberately does not renew/delete sessions and does not accept ambiguous rows or `active:null`/missing active flags. It reads two candidates rather than silently choosing `limit=1`; ambiguity denies. Unknown statuses deny. Accepted booking statuses `[0,1,3,4]` are the source sync's admitted set, not a newly inferred interpretation of each status. Frontdesk accepts waiting/arrived/in_service/completed and rejects cancelled/unknown. The authoritative binding must independently establish current access and revocation/lifecycle status. Its `active:true` is that explicit server decision, never an automatic consequence of the import whitelist; it must deny when status meaning or current authority is unconfirmed. Dates come from the current assignment, not a client “today” claim; a later authorized archive revision can retain an earlier service date. Reassignment/lifecycle policy and source freshness still require deployment review.

### Missing stable binding is an explicit blocker

The currently inspected bookings and frontdesk schemas do **not** supply a stable `customer_profile_id`. The adapter will not invent it using a shared phone, customer name, display name, source order, or the caller's requested profile. Without `resolveVisitBinding`, the public gate/context entrypoints return `CUSTOMER_BINDING_REQUIRED` before source reads. Absent, duplicated, inactive or mismatched mappings fail closed. A gate may normalize an underlying resolver error to `RELATIONSHIP_UNAVAILABLE`; it never chooses a fallback profile.

A trusted `resolveVisitBinding(row)` receives only:

```js
{source, visitId, id, staffUsername, store, bookingDate, status}
```

It must freshly read an independently verified binding, interpret the supplied raw status against an approved source-specific lifecycle policy, check reassignment/revocation, and return an array of **exactly one** object. If that status policy or mapping cannot be established, it must deny rather than set `active:true`:

```js
{assignmentSource, visitId, customerProfileId, store, bookingDate,
 visitKey, active: true, revision}
```

No binding table/RPC or automatic enrollment has been created here. `revision` must change whenever binding authority changes. Appointment `visitKey` must equal `booking:<id>`. Frontdesk `visitKey` must equal `manual:<business-date>:<frontdesk-uuid>`, which the existing shared resolver supports, so two same-day visits do not collapse into one manual date key. Explicit historical migration/binding review is required for older unqualified `manual:<date>` records; this adapter does not reparent or merge them.

`restRows(path)` returns decoded row arrays; `rpc(name, params)` returns a decoded object or throws a sanitized database error. They must apply fixed server connection/permissions and must not let callers choose a host or client credential. The module uses fixed table/column/function names and encoded equality literals. It does not query full profiles, original customer names, phones, images or passwords.

## Archive append interface

`createProductionArchiveAdapter({employeeAdapter, transaction})` exposes:

```js
await adapter.appendLegacyVersion({
  credential: opaqueSessionToken,
  scope,
  requestId: lowerCaseUuid,
  expectedLatestVersionId: null, // or the exact last immutable version UUID
  snapshot: {
    baseline: {outline:'', root_flow:'', steps:{style:'',person:'',length:'',features:'',layers:'',bangs:'',curls:'',care:''}},
    optimized: {outline:'', root_flow:'', steps:{style:'',person:'',length:'',features:'',layers:'',bangs:'',curls:'',care:''}},
    reasons: {outline:'',root_flow:'',style:'',person:'',length:'',features:'',layers:'',bangs:'',curls:'',care:''},
    execution: {}, process: {}, review: {},
    status:'baseline', photo_ids:[], archive_url:null
  }
});
```

`validateLegacyArchiveSnapshot` validates the exact schema before I/O. Models contain exactly the eight existing steps plus outline/root flow. Nonempty changed optimizations require reasons. Execution allows the six existing zones with issue/target/actions/check. Process allows the existing ten fields; review allows achieved/pending/next. Unknown fields, group/source/track/history injection, invalid/duplicate photo UUIDs, external archive URLs, byte payloads and excessive text/size are rejected, not stripped. Per-field limit is 4,000 characters; total snapshot limit 768 KiB. All three extension objects are explicit, so omission cannot silently erase newer workflow fields. Existing immutable photo IDs can be referenced; the database transaction must check each belongs to this exact customer/visit/store. This adapter performs no upload or photo URL minting.

**This is explicitly the legacy archive contract. It is not the complete AI pilot UI projection or event journal.** The existing SQL does not preserve multiple groups, source quotations, separate planned/actual tracks and confirmation histories. Passing that richer data here fails. No hidden conversion to eight text fields exists. A future complete projection archive needs an approved additive schema/RPC and an explicit lossless bridge, reviewed separately. Legacy `care` is a persisted document field, not permission for before-analysis care inference. This append method does not invoke a model or mark a planned field as actually performed.

The call is parameterized as the existing:

```js
rpc('append_customer_design_version', {
  p_payload: {...serverResolvedContext, ...validatedSnapshot,
    request_id: requestId, expected_latest_version_id: expectedLatestVersionId},
  p_actor: serverAuthenticatedUsername,
  p_source: 'manual'
})
```

Actor, source and context cannot be overridden by the client. The existing SQL handles the unique request hash, request/visit advisory locks, exact latest-version CAS, appended previous-version linkage and immutable old versions. Same request/payload replay returns its original applied version; changed content conflicts. No local “already saved” cache bypasses current authorization. The adapter validates returned scope, author, source, request, parent/version, normalized payload and status; arbitrary SQL extras, private asset paths and request hashes are not returned. SQL's empty archive URL is normalized back to `null` in the public snapshot.

Result: `{saved:true, alreadyApplied, appliedVersionId, version:{id,requestId,versionNumber,previousVersionId,createdAt,actor,scope,snapshot}}`. `appliedVersionId` is the version produced by that request, **not a claim about the current head after a replay**. Errors expose stable codes, not SQL text or customer values. Unknown transport/commit failures return `ARCHIVE_OUTCOME_UNCERTAIN`; retain the same request ID/payload and reread/retry under fresh authorization, never assume failure and generate another request.

## Required transaction and deployment preconditions

The provided code does not pretend that several PostgREST calls form one transaction. `transaction(callback)` is a required trusted server executor, with callback dependencies:

```js
{restRows, rpc, resolveVisitBinding, clock, beforeCommit(hook)}
```

It must run all callback reads and the append RPC in **one transaction**. `beforeCommit` registers an awaited hook immediately before commit. Throws roll back all pending versions/receipts. The adapter repeats employee, assignment, profile/visit and binding checks inside that transaction, compares the exact initial actor/context/binding revision, validates the RPC response before commit and registers a final recheck. A missing hook is reported as uncertain; this cannot retroactively undo a misbehaving executor's commit. Dependencies are an audited trust boundary, not a proof supplied by arbitrary JS objects.

Before a production implementation is enabled, all of the following are necessary:

- Implement/review a stable profile-to-assignment binding and revocation/lifecycle policy, including frontdesk migration semantics. Do not materialize one from caller authority or phone/name matching alone.
- Implement a server-owned transaction wrapper/connection or tightly scoped RPC that keeps the session, staff, assignment and binding authorization rows stable through commit. Lock them in a consistent order or implement equivalent serializable/version preconditions with proper conflict handling. A REST facade whose methods each open a new transaction is **invalid**. A long stale MVCC snapshot is not a fresh revocation check. The existing append RPC alone does not provide this employee/reassignment protection.
- Preserve the existing request uniqueness/hash semantics, visit-level serialization/CAS, parent linkage, profile/asset scope checks and immutable triggers, with rollback on any late authorization/result-validation error. Test actual PostgreSQL concurrency and rollback in an approved isolated database. The JS simulator below is not such a database test.
- Retain private table/RPC permissions and RLS. No anon/browser direct access or `auth.uid()` substitute for the current custom employee session. Do not widen grants, add unrestricted SECURITY DEFINER functions, expose service credentials, or persist raw employee tokens. Deploy only after the exact transaction/role/search-path boundary is reviewed.
- For full pilot projection persistence, implement a separately reviewed lossless extension rather than sending it to this legacy method. Production handlers, real credentials, live queries, external providers and deployment remain intentionally unconfigured.

No production transaction executor or stable binding is included, so this phase does not make real archive saving ready to enable.

## Verification

Run `node scripts/test-design-production-employee.mjs` (31 synthetic tests) and `node scripts/test-design-access-gate.mjs` (14 existing tests). Coverage includes actual REST column shapes and token hash, malformed/expired/disabled/duplicate identities, scoped frontdesk/appointment IDs, cross-store/reassignment and shared-profile failures, required stable binding, delayed-read revocation, parameterized append, immutable history/parent chain, CAS concurrency, payload conflict, normalized SQL output, caller mutation, late revocation rollback, malicious response scope, uncertain commit acknowledgment and idempotent recovery. Global fetch is disabled. No real employee/customer/session or paid model call is used.
