# Stage16 fixed native workflow boundary

## Fresh environment search

This stage queried both environment inventory and all saved cloud configurations
(cursor/nextCursor null). Inventory returned only the connected Dot cloud computer
and connected `wuming-3.local`. Saved configurations returned the Default environment
(twice) and `taoyouming308-ui.github.io` with three main-branch repository mappings.
These templates are not existing running workers and expose no approved image,
rootless daemon or cgroup delegation attestation. No new environment was started.
This search found no additional already-running compatible Linux worker. Stage15's
kernel/container observations remain historical evidence, not a fresh worker test.
No installation, security changes, workloads or customer-file transfer occurred.

## Concrete integration chosen

The new immutable workflow runtime exposes only workflow/load, workflow/dispatch,
and workflow/snapshot. Its repository pins the complete immutable authority in a
private request-local context, and uses the original native service and journal
replay validators. It does not call the old executor as a write fallback.

Each transaction acquires the existing global workflow lock, authenticates through
same-connection fixed authority capabilities, reads an authoritative bundle, and
validates records, receipts, legacy versions, full archives and immutable operation
author sidecars. Writes compare the exact source fingerprint and expected revision;
record/CAS/receipt/author persistence belongs in that same database transaction.
Final guard, authority recheck and bundle verification precede context clear/COMMIT.
Post-operation service authorization remains separate and fresh. Lost commit reply
is uncertain, not evidence of rollback. The request-local pin is not a live permission
cache: every transaction must resolve authority again.

A generic literal-SQL registry is not sufficient authorization. A safe registry
would have to include exact parameter validation, scoped RLS/context, row locks,
manifest checks and an exact operation graph for every statement. Exporting an
executeSQL/string escape hatch defeats this boundary. The narrower implementation
instead exposes authorize/recheck/readBundle/initializeNative/appendNative/clear,
with no caller SQL or transaction-control capability.

## Route graph and deliberate exclusions

| Existing operation | Stage16 native boundary |
| --- | --- |
| workflow load / snapshot | Included, native records and dependencies validated |
| record_source, record_note, advance, create_group | Included via workflow dispatch |
| record_context, record_technique, record_review, confirm_entry | Included via workflow dispatch |
| native archive / reopen intents | Included native journal/archive semantics only |
| attach_media / accept_model_candidate | Explicitly rejected |
| candidate extract / vision / compare / synthesize / load | Not exposed by this runtime |
| media upload / read / references | Not exposed; separate access/storage slices |
| archive/full append or load, archive/legacy append | Not exposed; not equivalent to native archive intent |
| analyze / speech and durable paid-attempt transitions | Not exposed |
| key read / save / revoke | Separate Stage15 membership-only runtime |
| visit resolve / list | Not exposed by this restricted runtime |

Existing stored media/model dependencies, including those inside full snapshots,
are rejected rather than partially validated or stripped. Thus this is a real native
workflow integration slice, not complete production workflow migration. Enabling
another route requires migrating all of that route's reachable dependencies first.

## Legacy provenance and same-transaction proof

Scope coincidence, matching names, and current reader access do not prove historical
authorship or permission to extend a legacy chain. An independent issuer must bind
an exact authoritative source snapshot, base revision/hash and current immutable
reader into a revocable manifest. Original records/authors/hash bytes remain intact.
New operation-author sidecars bind immutable authority and predecessor/record hashes.
New writes require the current manifest and current authority, not an old read grant.
A prior artifact read attestation is not interchangeable with this write manifest.

Required negative controls include missing/revoked/expired manifest, source changes,
same-name rehire/transfer, reassignment, historical receipt/hash corruption, expected
revision conflict, concurrent/unawaited queries, poisoned transactions, late ALS
callbacks, post-COMMIT denial and dropped commit acknowledgement. Ordinary expiry
checks remain, without claiming authorization at every physical commit instant.

## Review status

Initial read-only review of the root JS bridge found no confirmed bypass: routes
are allowlisted, unsupported intent/dependency paths reject, per-transaction authority
is pinned to the request, immutable receipts and full journal replay remain, and
query failures poison the transaction. SQL capability/manifest enforcement and actual
restricted-LOGIN integration need their own tests; this document does not certify
those merely because a mock returns a correctly shaped bundle. No Docker test was
run by this reviewer.
