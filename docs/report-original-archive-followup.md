# Full-month original archive: remaining scope

The v643 candidate batches original photos only onto existing, unlocked draft daily reports. It does not complete full-month archival for posted, locked or missing daily reports. No production files or financial records were changed during development.

## Existing constraints

- `uploadDailySheetAttachment` rejects `original_report` when the daily status is not `draft`.
- Sending `supporting_document` is not a safe shortcut: `zysyr_register_daily_sheet_attachment` may populate `source_voucher_id` and `source_sha256` on the financial daily record.
- A missing day has no draft ID. Creating a financial draft merely to store a photo is outside this archival task.
- Photo-only expense DOCX bundles belong to evidence archival, not the tabular monthly data parser. Archiving a whole bundle does not prove precise image-to-expense attribution.

## Proposed additive contract, not implemented

1. Store originals under company, authorized store, month and explicitly confirmed date, independently of financial report existence. Use the existing private voucher bucket, unique object IDs and no overwrite.
2. Add an append-only archive operation and optional link to an existing daily report. Never change amounts, source pointers, financial status, revisions or confirmation records. Posted/locked reports retain all prior originals; new evidence is clearly labeled supplemental and time-stamped.
3. Apply current capability and store-scope checks in the API and transaction, not client-supplied identity. Do not expose new public reads or broader storage rights. Verify current authority immediately before archive registration.
4. Bind each request ID to actor/store/date/hash/size/type, make retries idempotent and provide a status lookup. Preserve uncertain outcomes; do not blindly retry or delete evidence.
5. Missing report dates remain unassociated archive items. Later linking is an explicit audited operation with date/store equality checks, not automatic creation or posting.
6. Keep OCR/classification as suggestions. Date or expense matches that are ambiguous require human selection; a bundle association must not be presented as a precise receipt association.

## Required verification before release

Use synthetic files and an isolated database. Cover posted/locked/missing dates, cross-store access, revoked capabilities, duplicate bytes, repeated request IDs with changed parameters, concurrent uploads, lost replies/status lookup, file/database partial failures, and mobile/desktop date confirmation. Assert complete financial-table and source-pointer digests remain unchanged. Verify private-link scope and expiry. Production schema/API deployment and real-file acceptance remain separate steps requiring authorization.
