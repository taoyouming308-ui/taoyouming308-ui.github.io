# Bounded customer history recovery

Scope: customer archive cache synchronization only. No Meiguanjia business writes,
schema migration, financial posting, inventory enablement, new recurring job or
frontend release. App retains the concurrent protected main's v670.

## Verified baseline and cause

On November20 the deployed customer entrypoint already matched tracked
`d6fe05fb`, SHA256
`89a51806212cf335f1ba2c38c3dbe0880cf77996cda72a8c350bf6627da6a338`.
Older NOT DEPLOYED notes are historical. Actual customer cron is minute03/33;
recent-service refresh is minute14. Preserve these exact schedules.

Each archive previously reread every <=365-day history window from2018 after a
source-priority deferral. Eight customers cannot reliably complete that chain in
the existing105-second batch with request spacing, booking/daily priority and
reserved cache-write time. Retrying the same bytes does not solve this.

## Recovery contract

- Keep the105-second budget,10-second bounded source requests,1-second minimum
  spacing, all existing source validation and booking/daily priority.
- Store only completed validated normalized history windows in
  `~/.hermes/mgj_customer_history_resume`: directory0700, files0600, checksum,
  revision CAS and a nonblocking private write lock. No credentials are stored.
  Opaque owner hashes do not make the local service history non-sensitive.
- Bind a cycle to source host, customer/card/store and locked source-session
  principal. A cookie renewal for the same principal is compatible. Identity,
  scope, corruption or CAS conflicts fail closed with a fixed safe reason; do
  not force-match a customer or silently discard conflicting evidence.
- Fixed original windows and anchor survive deferral. Finish missing original
  windows, then append cross-day tail windows. Before returning history, read
  the latest<=365-day range again, including late anchor/tail-day additions.
  Changed source summaries invalidate their old enriched details. A selected
  bill disappearing from the source requires review, not invented completion.
- Reuse the existing newest/recent rotation and freeze up to2 detail selections
  per cycle. Best-effort detail failures retain clearly marked summaries;
  source deferrals never count as completed detail reads. The separate existing
  services8-detail path remains unchanged and does not use this new cache.
- Only complete windows, a fresh recent read and completed selected detail
  attempts may set `_history_complete`. Retain progress until the existing
  signed customer write and service projection both succeed. Readback acceptance
  is additional evidence, not implied by a queued request or local checkpoint.
- Absolute72-hour TTL never extends on touch. Only same-scope expired cycles
  may restart automatically. The bounded storage must not delete active,
  corrupt, unknown or non-private files to recover capacity.
- Within the existing2 compensation slots, at most1 prioritizes the oldest
  active validated cycle; keep due retries/normal customer rotation. Exclude
  `needs_review` and future retry dates even if a deferred entry also exists.
  Do not reset either old queue or treat deferral as source-not-found.
- Validation does not advance progress or mutate deferred/retry queues. Local
  cache progress is not cloud synchronization. Multi-window reads are collected
  over a bounded period, not a single atomic source snapshot.

## Installation

Only `sync_mgj_customer_profiles.py` -> `~/.hermes/scripts/sync_mgj_all.py`
and sibling `mgj_customer_history_resume.py` may change. Do not run the six-file
core installer: booking/daily/keepalive have separately verified newer runtime
bytes which must be preserved.

Run focused tests, the unchanged shared gate plus new tests, independent review,
protected exact-head checks and normal merge. Freeze both source SHA256 values.
`scripts/install_mgj_customer_backlog.py --check --source-sha256 HASH
--module-sha256 HASH` is read-only. Explicit `--install` accepts only the verified
preimage or identical target, requires all four existing locks and empty customer
process inventory, rechecks inside the locks, backs up private code bytes and
installs module first/entrypoint last atomically. Busy or unknown state means stop,
not kill/restart/pause unrelated jobs. No scheduling or queue changes.

Verify installed hashes, observe a bounded/natural batch, compare resulting
package/history evidence with the signed cloud cache and recheck booking/daily
health. Report actual recovered counts and remaining manual-review items;
never claim every historical customer is complete from one successful batch.
