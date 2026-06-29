# No-Downtime Update Rules

These rules are mandatory. Updates must not interrupt normal salon work.

## User-Safety Rules

1. Never force-refresh a user who may be filling an appointment, customer archive, or hair analysis form.
2. New versions may show an update prompt, but the user chooses when to refresh.
3. Do not change Supabase production data during a code deploy unless the task is explicitly a data repair.
4. Do not change schema or field names without backward-compatible reading of old fields.
5. Keep the previous stable version recoverable.

## Required Checks Before Push

Run:

```sh
git fetch github main
git fetch origin master
node scripts/check-version-sync.js
node scripts/check-release-integrity.js
node scripts/smoke-test-app.js
node scripts/test-care-outbound.js
node scripts/test-hair-task-state.js
node scripts/test-customer-archive-rendering.js
python3 -m unittest scripts/test_sync_mgj_bookings.py scripts/test_mgj_keepalive.py scripts/test_sync_mgj_customer_profiles.py
```

The pre-push hook runs these checks automatically.

## Smoke Test Scope

The smoke test checks:

- JavaScript syntax in `perm-app.html`
- version consistency
- key app functions still exist
- update prompt/anti-downgrade logic still exists

Manual business-flow checks are still required for risky changes:

- open the app
- login/select staff
- open appointment/customer archive
- open hair analysis
- save a local record
- load “我的任务”
- for hair-analysis changes, test stylist and assistant flows
- for customer archive changes, verify bill items, amount, staff, package expiry, and newest-first visits
- for synchronization changes, verify a failed shop/date cannot delete another shop/date

## Release Flow

1. Build the change on the latest synchronized commit.
2. Bump version only when ready to publish.
3. Run smoke tests.
4. Push the same commit to GitHub and Gitee.
5. Verify GitHub Pages returns the new version.
6. Watch the first real use report before making another change.

## Rollback Rule

Rollback must be forward-only.

Do not publish an older version number. If v315 is bad and v314 is stable, create v316 from the v314 code:

```sh
node scripts/rollback-forward.js <stable-ref> 316
node scripts/smoke-test-app.js
git commit -am "v316 rollback to stable app"
git push github main
git push origin main:master
```

This keeps browser downgrade guards and user caches working correctly.
