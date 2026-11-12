# Full-month daily original archive candidate

The independent archive accepts JPG/PNG originals for a chosen store and date, including posted, locked and missing daily-report dates. It does not create financial reports, change amounts, replace original evidence, change source pointers, or perform OCR/classification/posting.

## Storage and authority

- New reservation and completion tables are append-only. Their request key and immutable metadata bind actor, company, store, date, filename, MIME, size, content hash and note.
- The existing service identity gets only EXECUTE on the new scoped RPC. Direct table access is revoked from public, anon, authenticated and service_role; RLS remains enabled. No new credentials, public storage grants or role memberships are introduced.
- The API checks daily_report.write and the selected store; the RPC rechecks current account and store capability. Completed archives are viewable within the same authorized store, while pending requests and mutation/recovery remain owner-scoped.
- Objects remain in the existing private zysyr-vouchers bucket under company/store/date/request paths. Viewing uses short-lived authorized signed URLs. Originals are never overwritten or deleted by this workflow.

## Idempotency and recovery

Only a winning reservation uploads initially. The stored object's size and hash are verified before completion. Unknown network or registration outcomes remain pending; status reconciliation verifies stored bytes and can append completion without sending the file again.

Explicit resume requires the same original file and exact original metadata. It can create the same object only after a definitive missing-object result, using create-only storage semantics. Other failures are not treated as absence. Completed records and own pending requests appear in the server-side monthly list, so closing a browser tab does not lose recovery visibility.

The UI previews each original and asks the user to confirm its date, maintains scope/cancellation guards, and never infers a financial linkage. Missing dates are archive-only. Opening the archive from a daily report refuses to hide unsaved edits.

## Publication boundary

This is local candidate code, not a deployed service. Production migration, API deployment and frontend publication remain separate authorized steps. Do not publish the frontend before the additive API/migration are available. Do not import July–September financial data as part of rollout.

## Verification limits

Run new API mocks, browser fixtures and isolated PostgreSQL concurrency tests plus the repository gates on the final tree. Database fixtures isolate the new schema and use authority stubs and financial sentinel rows; they are not proof against the entire deployed schema. Real account permissions, storage configuration and end-to-end production availability require a separate authorized deployment/acceptance step with no automatic business-data import.
