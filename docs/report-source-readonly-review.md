# Monthly and expense source review

The monthly page offers an explicit read of the selected month's verification
original and a link to its expense sources. The existing finance workbench shows
the original monthly expense section, petty-cash source rows and month-level
evidence packages separately from formal expenses and petty-cash records.

`report_source_review` is a read-only, finance-authorized operation. It uses the
existing monthly-source archive `list`/`view` RPC actions, private object GET and
history-import read route. It does not create a source, stage an import, update a
cell, approve evidence, post a ledger entry or change any existing totals.

The monthly source is selected by current authorized store and month. Original
bytes must match the archived SHA256 and size; the worksheet name must match
exactly, including spaces. The selection is re-read before returning. Changed
selections fail explicitly. Bounded XML reads preserve cached formula results
(including zero) without recalculating them. Blank values remain blank, and
merged cells are displayed once at their original coordinates.

Expense rows use original raw source cells, preserve incoming/outgoing columns,
voucher numbers and coordinates, and expose existing review/import status.
Multiple candidate historical batches return a source conflict, not an automatic
choice. Month-level evidence is never presented as a per-row match. Evidence from
an older monthly workbook is identified as needing correspondence review.

Source reading is on demand. Store/month/account changes clear the private view
and suppress late responses. Employee report iframes receive no new operation or
permission. The source renderer is an optional same-origin resource; its loading
failure leaves an explicit unavailable message and preserves core report access.

Local validation uses synthetic API responses and isolated PostgreSQL. Separate
private local acceptance can use real original files; those files, projections and
screenshots must never enter this public repository. Local checks do not establish
production readiness or live financial approval. Deployment requires a later
authorized release and normal migration/API/frontend readback.
