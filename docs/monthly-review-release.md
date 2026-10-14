# Monthly shareholder confirmation release

## Boundary

This workflow attests that a person reviewed a specific monthly report and has no objections. It does not post, edit, lock or generate financial amounts. Finance explicitly previews saved data and publishes; every current authorized shareholder confirms once per immutable version. Changed content requires another finance publication. Existing read receipts remain historical read receipts.

Only the administrator's existing backend store grants authorize App readers. Publishing, registration, job titles and identity aliases never create grants. The separately verified owner alias deduplicates confirmations across entrances; each entrance retains its own current store permissions.

## Validation and deployment

1. Preserve the daily archive and exact live Edge function package outside Git. Verify main ancestry and normal required `validate` protection.
2. Run `test-monthly-review-identity-db.js`, `test-monthly-review-versions-db.js`, `test-monthly-review-api.mjs`, `test-monthly-review-browser.js`, frozen Deno and the full shared pre-push gate. Fixtures are synthetic. No real month's submission/confirmation is a test.
3. Apply `20261013130139_zysyr_monthly_review_identity.sql`, `20261013143641_zysyr_monthly_review_versions.sql`, then `20261014014800_zysyr_monthly_review_service_namespace.sql`. These are additive, service-only and do not seed real reports, receipts, role grants or financial values. The final migration grants only namespace USAGE to the trusted service; existing function EXECUTE/table/client/store ACLs remain unchanged. Production-shaped tests reproduce missing USAGE before applying it. If rollback is required, revoke that USAGE only when it was absent before this release; retain all review evidence.
4. Reverify the specifically user-confirmed owner entrances and enroll their identity alias in one guarded transaction, only before any publication. Do not merge by name or enroll anybody else.
5. Build the deployment from the saved operations-api v129 package. Replace only `supabase/functions/operations-api/index.ts`, `_shared/staff-report-access.ts`; add `_shared/monthly-review.mjs`. Retain its prior verify_jwt setting: custom authenticated routes verify every request. Preserve the live catalog dependency, which predates main's classification changes; do not deploy that unrelated diff incidentally. All other package contents must remain identical to the backup.
6. Merge the versioned front-end PR only through the existing required CI check. Read back Pages version and changed assets, live Edge package hashes and migration/ACL metadata. Unauthorized live requests must fail without returning data.
7. Finance uses “提交股东确认”, checks the saved preview, then explicitly submits. A shareholder opens App pending tasks, checks the published version, explicitly attests no objections. Backend access must already be manually granted. No reminders while App is closed.

## Recovery

For a UI or endpoint defect, publish the previous front-end code under a **higher** App version and redeploy the exact saved v129 Edge package. Never decrease version, force-refresh active editors, delete financial rows or reset grants. Keep all new review tables/receipts/identity mappings intact for audit. No destructive down migration is needed. Re-enable only after the same tests pass.

If a reply is lost, reopen the monthly status; do not automatically retry a publication/confirmation. Duplicate server requests return the same receipt rather than a new confirmation. Old receipts stay visible if a newer pending version exists.

## Evidence limits

Synthetic database, HTTP and browser tests do not substitute for a human checking a real financial statement. Production release verification is non-mutating except the approved additive schema and verified identity alias. The first real monthly publication/confirmation is performed by finance/shareholders, not the release agent.

## 2026-10-14 backend verification

- operations-api v130: all 14 deployed file contents match the reviewed candidate manifest, including the preserved live classification dependency.
- Both granted stores: real service-role inbox/status/source-token reads pass; no real publications or confirmations were created.
- 41 identity and 145 version synthetic PostgreSQL checks pass. Forced RLS, no client table reads or RPC execution, no direct service table writes, and unchanged old private finance helper ACLs verified live. No new security advisor notices versus the pre-release baseline.
- Anonymous HTTP status/inbox/overview calls return 403. This does not claim authenticated human financial acceptance. Frontend remains gated by the normal complete hook, required PR check and exact Pages readback.
