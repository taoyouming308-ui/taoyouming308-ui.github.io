# Protected historical generations

Local release candidate. This document contains implementation design and synthetic test coverage, not customer accounting records.

## Source preservation

The server checks original workbook byte length and SHA-256 before parsing. Original batch/row identifiers, raw cells, mapped snapshots and evidence are not rewritten. Append-only generations cover every original row exactly once. Only verified merged slave cells can be excluded. Formula caches distinguish an actual zero from unavailable data; shared formulas are expanded without changing underlying amounts.

For salary, an allowlisted source-provenance plan converts only proven missing-column, blank or uncached source amounts from the old parser's zero to null. Other numeric fields do not change. Critical gross, deduction and net values must exist before acceptance or posting. Original missing-value provenance remains in the accepted and posted payload even if a later authorized correction supplies a value.

Petty cash retains only original dated transaction rows. Opening balances and undated movements are recorded as explicit scope exclusions, with unknown amounts/dates left null. No synthetic transaction date or balancing entry is created. The UI says the result is dated details, not a complete cash account.

## Transactions and permissions

Every operation resolves trusted actor/store scope, checks permissions and locks the historical transaction boundary and target batch. Requests bind source hash, generation ID/version, full state fingerprint, purpose and request ID. Financial actions additionally bind warning/review fingerprints and a distinct confirmation. No action automatically advances to the next.

Parse generations and financial/ledger actions are private append-only audit records. Context tables are not caller-settable and permit only narrowly checked writes in the controlling transaction. Exceptions roll back ledger entries, revisions, batch completion, contexts and receipts together. Period locks are enforced. Old entry points reject generation-bearing batches rather than bypassing version checks.

Public RPCs are executable only by service_role. Private tables/internal executors revoke direct access from public, anon, authenticated and service_role. Existing finance scope plus expense.create_submit gates review/post. Later correction/reversal additionally requires existing confirmed_finance.adjust, with no automatic grant.

## Later correction and reversal

Dedicated operations bind generation, ledger entry/current revision, full state and request ID. Correction changes only permitted current business fields and appends a revision; posted_payload, original source identity, employee identity, period and original provenance stay immutable. Reversal is a separate explicit action and appends its own audit record. Stale states, invalid dates, missing key amounts, forbidden fields and duplicate/conflicting requests fail closed. Existing null optional salary amounts can remain null while other fields are corrected.

The UI verifies direct and queried receipts, including action, request, generation and old/new ledger versions. An uncertain or mismatched outcome retains the original request lock and never retries under a new ID automatically.

## Validation and release

Four additive candidate migrations implement parsing, acceptance/posting, amendment and missing-source provenance. Isolated tests use generated business records only. Coverage includes a large merged-cell scenario, salary missing-value preservation, partial petty-cash scope, all financial stages, after-write faults, permission revocation/account disable, period locks, bidirectional concurrency, exact replay and cross-action request collision rejection.

The authoritative fixture contains catalog metadata only: relevant tables/functions, constraints/indexes, triggers, RLS, owners, ACL/default ACL and selected role memberships. It is rebuilt in a disposable official Supabase PostgreSQL container without network, with function body checks enabled. This proves upgrades of the selected production dependency closure, not a complete historical fresh install. Its timestamp/hash manifest supports drift checks; unrelated views/event triggers and full role settings are outside scope.

Focused JavaScript/API tests and offline real Chromium component tests cover source presentation, narrow layout, separate explicit actions, blank versus zero, ledger edit allowlists, stale/cross-store responses and double-submit behavior. The browser uses an empty context and blocked network, not a production login.

Before publication: verify current source/deployment state and baseline drift, coordinate pending upload changes, run repository-wide release gates, publish a forward version without forced user refresh, verify deployed responses and perform a scoped read-back. No production migration, posting or sharing is authorized by this design document alone.
