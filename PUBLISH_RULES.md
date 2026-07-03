# Publish Rules

This app is deployed from GitHub Pages. GitHub `main` is the only publication source; the former Gitee mirror is retired.

Read first:

- `AI_COLLABORATION_RULES.md`
- `HERMES_HANDOFF.md`
- `AGENTS.md`
- `NO_DOWNTIME_UPDATE_RULES.md`
- `AGENT_SYNC_STATUS.md`

Before changing or publishing:

1. Pull the latest GitHub version first.
2. Confirm local `HEAD` includes the latest `github/main`.
3. Keep `perm-app.html` `data-version`, `version.txt`, and `version.json` identical.
4. Never push a lower version than the current online version.
5. Never fetch or push Gitee.
6. Never force-push or overwrite another assistant's work to resolve conflicts.
7. Do not force-refresh users during normal work; the app must show an update prompt instead.
8. If a release breaks usage, rollback forward with a higher version number.
9. Update `AGENT_SYNC_STATUS.md` before publishing meaningful work.
10. Do not create or edit `perm-app.v*.html` snapshots; use Git commits/tags for history.
11. Enable the shared hook once in every clone with `git config core.hooksPath .githooks`.

Recommended commands:

```sh
git fetch github main
node scripts/check-version-sync.js
node scripts/check-release-integrity.js
node scripts/smoke-test-app.js
node scripts/test-care-outbound.js
node scripts/test-hair-task-state.js
node scripts/test-customer-archive-rendering.js
python3 -m unittest scripts/test_sync_mgj_bookings.py scripts/test_mgj_keepalive.py scripts/test_sync_mgj_customer_profiles.py
node scripts/check-agent-sync-status.js
git push github main
```
