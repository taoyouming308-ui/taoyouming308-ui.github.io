# Request-scoped Meiguanjia source turns

## 2026-11-22 known-version customer recovery

- This specific repair uses `install_mgj_source_turn_repin.py`, not the original first-install tool below. It accepts only the recorded 02:08 booking, prior customer and old guard preimages, or a complete exact installation of the newly reviewed hashes. Any mixed/unknown changes fail closed; do not force an install or recreate locks.
- After normal shared pre-push, exact-head protected CI and merge, read all three canonical file hashes from protected main. Use those with the narrow installer's `--check` before `--install`. It keeps the booking runtime byte-for-byte in place and preserves existing cron, LaunchAgents, locks, queues and credentials. With all four verified locks and quiescent process inventory, it backs up first, writes customer then guard, and rechecks exact bytes. Rollback closes the new guard before reverting customer code, and only restores installer-owned bytes. Unverifiable or busy states are blockers, not permission to broaden the preimages or change the scheduler.
- No test write against a real appointment or a forced customer backfill. A natural successful customer batch and result readback are needed to call it restored. Check separate booking and normal consumption freshness; missing list entries are not confirmed cancellations. Existing manual-review entries remain untouched.

## Scope and evidence

Customer history resume was installed from protected PR163 on November20 at14:29. Two bounded attempts and the natural14:33 attempt completed no customer archives;14 of16 readiness samples observed the booking batch lock. That lock includes slow Supabase protocol replies and is not an actual source-request mutex. This candidate addresses that scheduling dependency; it does not claim every deferred or manual-review record is recoverable.

Only three runtime code files are targets: `sync_mgj_bookings.py`, `sync_mgj_customer_profiles.py` mapped to `sync_mgj_all.py`, and new `mgj_source_turns.py`. No frontend, schema, Edge, credential, cron, launchd, source-business or inventory changes. Preserve the installed history-resume module and all private business/cache/queue state.

## Lock and deadline contract

- Booking keeps the existing whole-batch duplicate lock and60-second durable attempt gate. Each actual source HTTP exchange (including session check/login and full response body) announces intent, then takes the request gate. Cloud begin/commit/abort traffic and retry sleeps do not hold either new lock.
- Customer holds its existing coordinator for the batch. Per request it nonblockingly acquires session, daily-source and common request locks, with booking-intent checks before and after. Any wait or gap releases all three; it never acquires the booking whole-batch lock.
- An announced booking wins the next request gate after any already-started customer source request. The latter retains the original10-second subprocess bound. Booking waits at most12 seconds per gate acquisition, bounded further by its original run deadline. This is not a guarantee of zero booking delay or10 seconds total batch delay.
- Customer readiness uses one105-second deadline and requires10 seconds for a request plus20 seconds for persistence. Only healthy-but-aged daily state is locally waited on; failure, cooldown, malformed state and unknown protocol fail closed. The previous20-second/two-episode cap and separate initial60-second wait no longer apply.
- The common module checks the exact approved booking script digest, owner, type and unsafe write permissions before customer source access. Old/unknown booking versions must not be assumed cooperative. Later booking changes require a reviewed module digest update and coordinated cutover.
- Private new lock files have no contents,0700 parent/0600 files, no-follow/type/owner/inode checks, and close-on-exec. Kernel flock release follows file close/process exit; files are never deleted as a way to unlock. Do not remove a lock path while any worker may be active.

## Cutover

1. Preserve existing changes and run normal shared pre-push and exact-head protected CI; merge normally. Recheck current protected main and all three target digests.
2. Run `install_mgj_source_turns.py --check` with `--booking-sha256`, `--customer-sha256`, `--module-sha256`. It must be read-only and accept only the known preimages. The module's literal approved booking digest must match the booking argument.
3. Install only when the four existing nonblocking coordinator/session/booking/daily locks can all be held and the process inventory contains no active booking/customer runner (including the legacy shim). Do not pause or kill jobs to force a window. Busy is a safe retry-later result.
4. Keep a0700 private backup directory,0600 original-byte backups and receipt, atomic fsync replacements and exact readback. Order is common module, booking, customer. Restore only installer-owned known bytes on failure; never overwrite an unknown concurrent change or delete a helper needed by an unknown client.
5. Verify unchanged cron and non-target worker/config/resume-module hashes. No queue/cache restoration is part of code rollback.

## Acceptance and reporting

- Synthetic tests must include real cross-process mutual exclusion/booking priority, guard cleanup, bounded waits, unsafe filesystem/protocol rejection, source-only guards, remaining-budget recomputation and original queue/validation regressions.
- Run at most a bounded small customer batch using existing source reads and signed cloud writes. Compare successful cloud customer content with the actual collected source result, including package/history arrays. A nonempty successful content readback is required; zero selected/successful customers is not a pass.
- Observe later natural booking and daily-consumption batches and preserve exact schedules. Report remaining deferred/retry/manual-review counts separately; overlapping sets must not be summed as unique customers.
- Installation, cloud updates, complete archive readback and backlog clearance are separate facts. Report partial progress and unresolved cases honestly; never reset needs-review or lower source safety to make counts appear healthy.
