# Customer fairness cutover plan — NOT APPLIED

Candidate changes only customer execution. Keep existing customer1/31 and service16 phases, booking/daily priority,105s budget, verified TLS and source allowlists. Two readiness-wait episodes/20s are shared by the whole batch; waits hold only the new customer coordinator. Request factories derive current session credentials/shop/employee under the legacy session lock. Do not repeat ambiguous sent requests.20s cloud-write reserve is a minimum, not a promise of completion.

## Preconditions
- Complete isolated/full repository gates and independent review; explicit instruction to deploy.
- Inventory OS cron, enabled Hermes jobs and their wrappers. Known customer triggers: ordinary cron, service refresh, dormant completed-backfill wrapper. Include manual/alternate customer invocations in the process inventory.
- Record exact runtime/canonical hashes and recoverable trigger definitions privately. No credential or customer records in public artifacts.

## Quiescence and switch
1. Outside old/new execution windows, temporarily pause ONLY the three existing customer triggers: remove the exact ordinary cron line using compare-before-write; pause the existing service and backfill jobs through the scheduler API. Preserve IDs, minute expressions, disabled-state history and all unrelated jobs. Do not pause booking/daily/keepalive. No new timers or replacement jobs.
2. Obtain verified pause/readback receipts. If any pause fails, restore only changes made by this operation after confirming no intervening owner edits. Never overwrite the entire jobs JSON.
3. Let old customer modes finish. Obtain a fresh process inventory proving no old customer interpreter is in source OR cloud-write/queue phases. Free locks alone are insufficient. No kills. Reconfirm pause receipts.
4. `mgj_customer_cutover_guard.quiescent_cutover` uses four fixed locks: new coordinator, legacy customer/session, booking and daily-source. Acquire all nonblocking; if any is busy, release all and defer installation. While held, recheck no old processes and original hash, back up bytes, atomically install verified canonical bytes and read back hash. Guard callbacks require actual evidence, not assumed booleans; this helper does not pause schedulers or install code itself.
5. Release all locks. Restore ONLY the triggers paused here through their existing APIs/IDs and exact original1/31,16,backfill phases. Check original enabled state; do not enable a task that was originally disabled or changed by the owner. Compare cron again to preserve concurrent unrelated edits. Read back next-run times and verify no immediate duplicate dispatch or new frequency.
6. If restoration fails, report which trigger remains paused and restore it before declaring deployment complete. A maintenance window is not an excuse to silently leave a trigger disabled.

## Acceptance and rollback
Observe next ordinary and service natural batches only. Check distinct complete successes, deferred oldest age/count, zero false retries, accurate terminal state, appointment/daily freshness and one-request priority delay. Strict priority cannot guarantee a backlog-clear deadline.
Rollback requires the same trigger quiescence plus new coordinator: new workers can be in cloud writes while legacy session lock is free. Atomically restore prior script bytes after hash verification, then restore exactly the paused triggers. Do not revert/delete source data, cloud caches, original failure queue or deferred ledger. If a newly arrived operator change prevents safe restoration, stop and report instead of broad overwrite.

This plan creates no new monitoring. Existing status/ledger observation requirements remain, including persistent-source/age alerts; a healthy service-only status cannot prove deferred backlog cleared.
