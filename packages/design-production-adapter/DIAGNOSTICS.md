# Prepared access and PostgreSQL diagnostics

The employee adapter, access gate, visit-binding adapter and PostgreSQL executor accept an optional trusted server `diagnostics` callback. It is absent by default and is not an HTTP, browser or authorization parameter. The executor passes it to same-connection adapters; it never opens a diagnostic database connection or changes a query, lock, deadline, retry rule or permission decision.

Each frozen event has exactly four enum fields: `component`, `phase`, `outcome`, `failureKind`. `packages/shared/design-diagnostics.mjs` contains the complete fixed allowlists. Components distinguish employee reads/validation, the assignment versus customer-visit gate, binding-history/lifecycle/context checks, and PostgreSQL acquire/BEGIN/setup/callback/guard/COMMIT/rollback/release. Events contain no request or customer IDs, employee names, tokens, token hashes, SQL, source paths, arbitrary error text, row values or payloads.

The callback is called synchronously without awaiting its return. Synchronous exceptions and rejected Promise/thenable results, including cross-realm Promises, are discarded; a pending Promise does not pause authorization. A trusted observer must itself be bounded and nonblocking, for example append to a bounded in-memory ring. This is not a sandbox for arbitrary observer code: a synchronous infinite loop or expensive logger can still block its own JavaScript process. Do not perform network requests, acquire locks, change application state or call back into repositories from an observer.

Diagnostic outcomes describe phases, not grants. A successful read can be followed by a separate validation failure. Where the binding helper has already wrapped an error, its exact phase is reported with `failureKind: 'unknown'`; the observer does not guess whether the hidden cause was a validation error or a dependency failure. Public errors remain the original fixed, sanitized codes, including `RELATIONSHIP_UNAVAILABLE`; finer attribution is internal only. Diagnostic emission cannot authorize a previously denied operation, turn failure into an empty success, or trigger an automatic retry after an uncertain commit.

## Evidence limits

The original Stage7 intermittent legacy-PG failure happened during initial archive authorization, before the archive write. Its old trace did not retain the underlying relationship failure. Later passing runs do not establish its cause or repair it. The new observer closes that evidence gap for a future occurrence; it does not reconstruct missing historical evidence.

Stage10 first verifies attribution using deterministic offline fault injection, comparing observer-off and observer-on public outcomes. One ordinary isolated PG27 regression enables the observer to verify wiring and safe output. It is not a pressure loop or a claim that the historical intermittency is reproduced. The unexplained original failure remains a deployment acceptance blocker.
