# Stage37: private records stay on the server

Status: implementation and isolated acceptance complete. Production closed.
Baseline: clean affaba52/v688, current github/main included, startup gates/daily backup
and a complete private recovery bundle retained. No push, deployment, production
DDL/grant, real credential/customer data, external model/storage transform or fee.

## Separate read-only views

The server validates original stored record v1-v5 and full chains, then projects
explicit `design-workflow-view-v1`, full-workflow-view/version/history/save-view
and snapshot-preview schemas. The views are not original stored objects and must
never be accepted as write evidence. `sourceDigest` names original server bytes
as an opaque concurrency token; it is not a hash/signature of the view or permission.

Native source text, entries, separate employee confirmations and archives remain
readable. Internal immutable authority, task/report, receipt, object locator and
candidate proof bindings are omitted at the HTTP boundary, not merely hidden in DOM.
Legacy asset/photo IDs retain the original UUID constraints. Employee/legacy free
text can contain a user-authored URL; this does not classify or rewrite arbitrary
text as a secret, and no blanket string-redaction claim is made.

Trusted `browserViews:{enabled:true}` selects new fixed workflow-view load/dispatch/
snapshot and archive-view load/append routes. In this mode the original five raw
workflow/archive paths are excluded before DB access, and raw services are not
supplied to the inner HTTP handler. Browser `allowBrowserViews:true` never falls
back. The normalized synthetic mode additionally requires secure browser views.
Legacy server configuration remains for isolated compatibility, not real-data rollout.

## Server-built archive command

The browser sends only scope, requestId, expectedVersion, expectedParentDigest,
sourceRevision and sourceDigest. A read-only preparation obtains the server snapshot;
this is not an authorization lease. The original full archive service owns the real
write transaction, freshly rechecking current identity, original author, source and
archive head, all private media/history, and before-commit guards.

The additive isolated Stage37 SQL draft stores only an immutable command sidecar,
not another copy of the full archive. Existing full version/receipt bytes remain
unchanged. The fixed capability executes original append_full and the command insert
on the same connection/transaction. An old raw receipt cannot be adopted as a new
browser-command receipt. Only an exact committed command with the same full immutable
author may select a historical source for replay after the live record/head advances.
New writes still require the current source and archive CAS. Unknown COMMIT preserves
the original request ID; no automatic replay with new parameters or approval.

## Verification requirements and observed correction

- Strict DTO/parser/HTTP tests for all five response families and old route closure.
- v1-v5 stored compatibility, native confirmation, source UUID constraints and
  user-authored text preservation; original bytes/digests unchanged.
- Actual restricted PG, fixed synthetic JPEG worker, original-entry/prepared browser
  chain with mock storage/model; inspect HTTP bodies recursively for structural proof
  fields and known synthetic private object locator values, not only screenshots.
- Archive lost response after COMMIT followed by record/head advance, same-ID exact
  replay, changed selectors, stale/cross-customer scope, session revocation, rollback
  after sidecar write and unknown COMMIT. Pseudo-epoch negative controls are not a
  full employee rehire lifecycle test.

The first actual browser run passed 9 checks then the valid archive returned a safe
409. A bounded PG diagnostic showed append_current succeeded once, followed by
ROLLBACK, command count0/full count1 unchanged and no SQL error. The first wrapper
incorrectly called full service append inside an outer transaction callback; its
inner transaction returned before the true beforeCommit hook, so the original
service correctly refused `guarded!==true`. The fix gives that service ownership of
the actual transaction completion. It does not fake/early-run the guard, weaken it,
cache permission or lengthen the original timeout. Original failing evidence remains.

## Unchanged rollout limits

Fixed synthetic image qualification is not arbitrary customer-image validation.
Storage and model remain mocks, production/cloud immutability and real model quality
are not proven, and the historical intermittent PG root cause/long-history load remain
open. This browser harness extracts the original homepage entry and runs actual prepared
modules, not all live perm-app scripts or production TLS/CORS. No key is needed yet.

## Hosted transform qualification remains separate

Before any approved hosted test, explicitly select an aspect-preserving contain
policy rather than relying on provider default cover cropping. Synthetic front,
side and rear edge markers must show the top and both sides survive; test output
bounds, orientation and color separately. Documented HEIC input support is not
HEIC output support and does not qualify actual iPhone rotation/conversion. These
are pending acceptance requirements, not results of this fixed JPEG/WebP harness.
No hosted transform was invoked here.

## Final isolated acceptance

Final pure aggregate: 173/173 across 13 explicitly selected modules; additional
normalized UI/HTTP retained tests 31/31 and static shell build regression passed.
Actual restricted PG/fixed JPEG worker/original-entry browser passed 16/16 checks
plus four server controls: old raw receipt rejection, same-transaction rollback,
actual COMMIT acknowledgement loss recovery and forged immutable epoch rejection.
One mock model send/key-open/fixture approval set, one fixed native normalization
and verification; checks are not customer cases. Original 30s client abort was
observed after a real commit, then exact same-ID recovery returned the old version
while source/head advanced. No automatic resend. All resources exactly cleaned.
The second incomplete run was a test expectation of raw SQL error text; the trusted
driver correctly retained SQLSTATE 42501 while sanitizing its message. Only the
assertion was corrected, including retryability/uncertain/no-detail checks. Both
failed runs, diagnostic evidence and final response-body timing remain retained.
