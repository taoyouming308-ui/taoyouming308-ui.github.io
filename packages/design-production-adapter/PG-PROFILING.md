# PostgreSQL fixture profiling, not runtime tuning

Stage12 adds opt-in metrics to the **test-only** `scripts/fixtures/design-postgres-fixture.mjs`. Default callers still use a new physical psql/libpq connection for each executor lease. No production driver, pool, SQL, authority check, lock, deadline or retry policy is changed.

`createDesignPostgresFixture({timingObserver,profileDatabase:false})` accepts a trusted test observer. Events contain only a fixed phase, finite nonnegative duration, fixed outcome/error kind and optional finite command enum. No SQL, parameters, row values, result text, identity, scope or credential is emitted. Extra fields are discarded. Observer exceptions/rejected thenables do not change a query's outcome; synchronous observer code must still be bounded. Events are emitted after the query await resumes, retaining the caller's async context rather than the stdout callback's connection-creation context.

Metrics:

- `lease_spawn`: Node child creation to the OS spawn event. It does not prove Docker/psql/database readiness.
- `lease_first_frame`: child creation to the first completed result marker. It includes process/connection startup **and the first query**.
- `query_frame`: query submission to its result marker, including PostgreSQL, pipe/bridge, scheduling and transfer time.
- `result_parse`: result-marker handling/JSON decoding time, nested within the awaited query duration.
- `query_total`: total awaited query time, including decoding and scheduling.
- `workflow_history_scan`: fixed-template classification of the repository's workflow-history row SELECT, counted once per row-read. Its duration duplicates that query's `query_total`, not the subsequent JavaScript validation/replay. A successful row-read alone does not claim that the later full history verification succeeded.
- `lease_closed`: release request to process completion.
- `lease_total`: child creation to completed release.

These phases overlap. Do not add first-frame, query-frame, parse, query-total and lease-total as independent costs. Operation wall time minus summed non-overlapping awaited queries still includes JavaScript, release and scheduling; it is not a pure validation-CPU measurement. No result claims revocation remains unchanged after the last verification snapshot.

## One bounded connection experiment

`node scripts/profile-design-postgres-fixture.mjs` uses an already installed PostgreSQL17 image in one unique, labelled, disposable container with `--pull never`, `--network none`, no published ports/host mounts, and tmpfs storage. It explicitly enables the image's bundled `pg_stat_statements` only in that fixture. Only top-level aggregate call/planning/execution numbers are read, never normalized query text. The admin reset/read queries are excluded. Extension setup and container settings are not applied to any existing database or machine configuration.

The single planned experiment uses 12 repeated constant queries on one connection, then six ordinary authorized read transactions with new physical connections, then six identical authorized transactions on one physical connection. The last arm uses a sequential test wrapper only. It still performs every fresh BEGIN/COMMIT, row/advisory lock and authorization check; a failed lease is discarded. This wrapper is not an implemented or approved production pool.

Observed once on the local isolated fixture:

| Arm | Operation wall time | Client queries | First-frame total | DB planning + execution |
| --- | ---: | ---: | ---: | ---: |
| 12 constant queries, one connection | 45.696 ms | 12 | 40.085 ms | 0.138 ms |
| 6 authorized transactions, 6 connections | 300.550 ms | 264 | 214.357 ms | 8.909 ms |
| 6 authorized transactions, 1 connection | 92.286 ms | 264 | 34.067 ms | 4.328 ms |

Both authorization arms had 492 top-level PG statement calls because the bridge also issues control/prepare/execute/deallocation work. Their identical counts support an equivalent-work comparison, not a statistical latency guarantee. No unauthorized or skipped-check shortcut was used. Cleanup verified the exact labelled container absent.

Connection startup is measurable, but this small read-only case does **not** explain the 42.743/37.188-second synthesis flows by itself. Those flows include large workflow histories, archives, accepted candidates and repeated pure validation/serialization. Profile their actual shapes and separate query-await time from outside-query wall time before changing any runtime behavior. A faster synthetic bridge would not prove production performance or fix a browser timeout.

## Historical authorization incident remains unresolved

The original Stage7 failure log stops after six successful tests; the seventh first legacy append fails in initial archive authorization with `RELATIONSHIP_UNAVAILABLE`, before an archive write. At that revision, the access gate wrapped both assignment and customer-visit resolver calls in one catch. The trace therefore does not identify which resolver, underlying SQLSTATE, transport frame, clock condition or source read failed. Cleanup succeeded.

Later passing regressions and this timing experiment cannot reconstruct those missing facts. The present fixed-enum adapter diagnostics separately attribute assignment/customer-visit, employee, lifecycle and transaction phases; test-only query timing distinguishes server-error/frame/parse/closed/timeout classes without raw error text. They can improve evidence for a future occurrence, not establish the old cause. No old-PG repeat-until-green run was performed in this stage. The unexplained incident remains an independent pre-live blocker.

## Stage13 bounded diagnostic calibration, not an incident fix

A single isolated experiment recreated the source-status/lifecycle restoration boundary immediately preceding the historical failure, then used two distinguishable negative controls. It did not repeat the old whole suite until green:

- Baseline restoration followed by legacy append succeeded (1,333 ms), with no failure diagnostic.
- A real competing source-row lock produced SQLSTATE `55P03`, then `employee.assignment_read` and `gate.assignment` (116 ms observed lock wait).
- A lifecycle digest mismatch produced no database error and was attributed to `visit_binding.lifecycle`, `binding_read` and `gate.assignment`.

Both controls reached the same public `RELATIONSHIP_UNAVAILABLE`. This proves the new fixed-enum diagnostics distinguish these two paths; it does **not** prove either caused the original event. No SQL, row values or arbitrary messages were recorded. The exact isolated container was removed and absence verified. The original cause remains unresolved and the experiment stopped after the planned controls.
