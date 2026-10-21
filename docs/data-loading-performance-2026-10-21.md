# Business data loading — local v638 candidate

Base: ac0cfd26e52abf72ef95ffede2f0c2f7a69a069f (published v637). Branch: perf/data-load-20261021. No production query, mutation, schema, permission or deployment performed.

## Findings and scope

Frontdesk dashboard already runs its four backend reads in parallel. Operations overview already uses selected fields, full pagination, staged parallel reads and server stage timing. Reducing its rows without a completeness contract could change totals; this patch does not change query ranges, limits or fields. No reliable production latency/transfer trace was available, so the slowest live query, network contribution and rendering duration remain unknown. Existing stage timing can support a later bounded, redacted sample; production EXPLAIN/index work is not executed here.

Observed frontend opportunities: concurrent identical today_bookings (main), dashboard/business_details (frontdesk), overview (operations) requests; and an expanded frontdesk details panel refreshed both before and after dashboard on a scope change. The latter now refreshes once independently, also retaining an explicit refresh after saves. No save callback or accounting calculation is changed.

An optional deferred data-read-client coalesces only pending selected reads with identical operation/payload/auth/store keys. It does not delay startup and falls back to existing requests if absent or not yet loaded. A five-second maximum join window permits a fresh retry of stalled reads. Settled success/error is immediately evicted. Every other operation, including writes/session checks, executes immediately and clears the channel before and after completion. Writes are never deduplicated or replayed; a subsequent read must be fresh. StaffReportView retains its existing path. Existing identity/generation/store/date/month guards still decide whether responses may render.

Only public JavaScript is added to the versioned static shell (38 files). No business response is persisted by this helper, and v637 activation/unsaved-input/failed-update behavior is unchanged. Existing application persistence is not expanded.

## Reproducible synthetic comparison

Run from this checkout:

```sh
node scripts/test-data-read-performance.js --baseline
node scripts/test-data-read-performance.js
```

The test executes the actual HTML API wrappers with an 80-row fictional full payload containing amounts, an unknown null amount, orders and staff shares. Four concurrent identical reads receive a modeled 100 ms transport delay (40 ms network + 60 ms server by assumption, not separately measured). Bytes are uncompressed JSON request+response, excluding headers, TLS and static assets. All returned payloads are checked unchanged.

| Entry | Requests before → after | JSON bytes before → after | Synthetic elapsed before → after |
|---|---:|---:|---:|
| Main | 4 → 1 | 46080 → 11520 | approximately 103 → 102 ms |
| Frontdesk | 4 → 1 | 46128 → 11532 | approximately 103 → 101–103 ms |
| Operations | 4 → 1 | 46116 → 11529 | approximately 103 → 101–103 ms |

This intentionally concurrent scenario demonstrates duplicate-load reduction, not a real-world speedup percentage or frequency of duplicate reads. Frontdesk scope-change orchestration separately verifies details refreshes 2 → 1, dashboard reads 1 → 1, render calls 2 → 2. Renderer is stubbed, so render time is not measured. Raw before/after run JSON is included in data-loading-performance-synthetic.json.

Additional assertions cover different scope/auth inputs, failed retry, no settled cache, non-deduplicated writes, post-write freshness, bounded joining and late-settlement cleanup. Existing browser and shared business gates cover startup identity, late responses, unsaved forms, money/booking/save behavior. All write tests use synthetic fixtures. Final cumulative gate completed with exit 0 at 2026-10-21 11:28 UTC, including all 120 shared finance manifest steps and the remaining original academy, App, booking/customer, sync and business checks. No test was skipped or weakened.

## Remaining verification

No iPhone measurement or real production query timing is claimed. Before publication, recheck latest main, run exact-head remote checks and obtain separate release authorization. On an already authorized device test route, compare the same account/store/date with cache state recorded, inspecting duplicate count and request timing; exercise slow/offline read recovery, expiry/revocation, account/store/date changes, unsaved form and failed update recovery. Do not submit a real booking or financial mutation for testing. No new test site, tunnel, credentials or network policy change is introduced.

## Final validation commands and results

```sh
RELEASE_BASE_REF=ac0cfd26 NODE_PATH=/Users/a1/Documents/Codex/2026-10-21/task/validation-deps/node_modules ZYSYR_HOOK_PYTHON=/opt/homebrew/bin/python3.11 sh .githooks/pre-push
PLAYWRIGHT_BROWSERS_PATH=/tmp/zysyr-startup-browsers STARTUP_BROWSER=webkit node scripts/test-startup-recovery-browser.js
PLAYWRIGHT_BROWSERS_PATH=/tmp/zysyr-startup-browsers STARTUP_BROWSER=webkit node scripts/test-app-shell-browser.js
node scripts/test-startup-request-scope.js
node scripts/test-zysyr-api-read-timeout.js
node scripts/check-agent-sync-status.js
node scripts/check-release-integrity.js
node scripts/check-version-sync.js
git diff --check
```

All exited 0. The pre-push hook was invoked as a local check; no git push occurred. It fetched main and confirmed ac0cfd26 remains the base. Browser launches used the required approval path and isolated profiles. Shell test covers v638's 38 public files, natural activation, unsaved form protection, offline/server-drop recovery, hash failures and old-worker compatibility. Recovery covers network/permission/expired/timeout/stale/input cases and operations monthly failure/retry plus auth recovery. Desktop Chromium/WebKit results are not iPhone acceptance.

Full logs are retained locally under /Users/a1/Documents/Codex/2026-10-21/task/validation-review/ as data-load-full-gate.log, data-load-webkit.log and data-load-webkit-shell.log. Expected synthetic failure messages inside passing tests do not indicate production calls. Remaining release gates: separate authorization, refreshed main integration if changed, exact-head remote CI and physical iPhone acceptance. No action was denied or left with an uncertain execution outcome.
