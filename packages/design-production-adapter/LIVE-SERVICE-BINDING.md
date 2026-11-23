# App1 administrator-confirmed service binding

The owner selected **管理员** on 2026-11-23. Use the existing `admin.html`
`staff_access_sessions` administrator, with current `staff.role = admin`.
`store_admin`, finance/operations roles, job labels and browser role claims do
not become confirmation authority. Only the service's explicitly selected,
currently active staff account may resolve binding evidence through its existing
employee session. Confirming a binding never grants the administrator photo view.

## Actual entry and scope

后台 → 顾客档案 → 服务负责员工. Select the service date, one existing appointment
or frontdesk visit, and one current same-store staff account. The initial selectors
remain empty; no name/phone matching selects an account or grants access. Review
the two customer labels and masked phone tails, attest the correspondence, add
a reason and explicitly confirm. Selecting an external stylist label is not
mapping that label to a login. Existing primary keys establish the chosen relation.

The endpoint is fixed to the current project's `design-service-bindings` Edge
function. Custom administrator and employee credentials use separate headers;
mixed credentials, bearer fallback, foreign origins, redirects and arbitrary
endpoints are rejected. Current administrator role/employment, original session,
account creation and credential hash are checked from the real database. No
credential is logged, placed in a URL, persisted in a new browser store or returned.

The new private append-only ledger contains service/profile/staff identifiers,
staff account incarnation, current source/profile/staff fingerprints, administrator
incarnation, reason, revision and original request receipt. Existing source
tables, grants, RLS, triggers, sessions and appointment workers are unchanged.
There are no foreign keys or row locks on those source tables. A private
transaction-scoped try-advisory lock serializes a visit without queuing behind
booking writes. CAS and globally unique request IDs prevent silent overwrites.
Revocation appends a new version; replaying an older request reports current
state and never restores it. Uncertain writes use explicit original-ID status
lookup; neither the browser nor server automatically resubmits a mutation.

Customer/store/date scope cannot be changed on an existing visit binding. Preserve
its history and establish a new service identity when that service scope changes.
Reassignment/restoration to a current employee is an explicit new confirmation.
Source fingerprints describe current material fields, not a complete upstream
change journal. Routine timestamp refreshes and unrelated profile notes are
excluded. Changed source assignment/customer/status, profile identity, account
incarnation, employment or current binding deny old evidence. Cancellation or
source deletion does not require a source-table write by this module. Revocation
of the new binding is independently durable even if source values later revert.

## Existing authentication dependency

The already deployed `design_employee_verify_session(text,uuid)` remains
unchanged. Its exact body SHA256 is
`71f806e757e9cbe1576261781dcadf4c8f3e9ba58f2355c69a1d2130fa5c9af4`.
The new atomic migration checks that body, invoker security and service-only
EXECUTE before creating anything. `supabase/functions/design-employee-authority/`
records the already deployed source; `session-verifier.sql` is its reproduction
reference, not a new production migration or a command to run again.

The new public RPC is SECURITY INVOKER, service-role-only, with a 3-second statement
and 100-ms lock limit. Private ledger RLS is enabled and forced; anon/authenticated
have no schema, table or function access. Service-role ledger grants are only
SELECT/INSERT, with immutable UPDATE/DELETE/TRUNCATE triggers. Schema and ACL changes
commit atomically. No fixture accounts, bindings or old draft SQL are installed.

## Evidence is separate from photos

`createLiveServiceBindingVerifier` is default-closed and server-only. It pins the
fixed HTTPS endpoint, nonce, employee credential binding, exact response shape,
stable account, visit/profile, private/no-store response and <=5-second freshness.
Every call is fresh; `recheck` rejects a changed binding revision or source.
It returns binding evidence, **not** an upload, view, processing, verifier or model
receipt. Do not plug it in as a bypass for the original workflow's independent
identity, media permission, processing, final delivery and archive checks.

This release does not activate the unpublished photo entry, install the prepared
workflow fixtures, connect private photo Storage, process a real customer photo or
enable a model. The owner configures model/API keys last. Full photo acceptance
still requires production composition and actual authorized employee/device tests.

## Deployment and acceptance

From the exact protected head: inspect the current schema/dependency and advisors;
apply only the new additive migration; deploy only the new custom-session Edge
function (`verify_jwt:false` because its handler authenticates both opaque session
types); read back source/ACL and cloud denial/preflight behavior. Then normally
merge the focused PR and verify Pages bytes. Do not redeploy the existing employee,
booking, customer, frontdesk, finance or model functions for this release.

Tests run the exact migration in a new bounded, no-network PG17 container with
SELECT-only source privileges, the real admin page/modules at 390/1280 widths
against intercepted synthetic endpoints, and request/client/evidence boundaries.
These prove the stated synthetic scope; they are not real staff/customer acceptance.
