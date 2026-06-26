# Publish Rules

This app is deployed from GitHub Pages and may also be edited from the Gitee mirror.

Read first:

- `AI_COLLABORATION_RULES.md`
- `HERMES_HANDOFF.md`
- `AGENTS.md`
- `NO_DOWNTIME_UPDATE_RULES.md`
- `AGENT_SYNC_STATUS.md`

Before changing or publishing:

1. Pull the latest GitHub version first.
2. Pull the latest Gitee version too.
3. Confirm local `HEAD` includes both remote heads.
4. Keep `perm-app.html` `data-version`, `version.txt`, and `version.json` identical.
5. Never push a lower version than the current online version.
6. Push the same commit to both remotes when Gitee is used by another editor.
7. Never force-push or overwrite another assistant's work to resolve conflicts.
8. Do not force-refresh users during normal work; the app must show an update prompt instead.
9. If a release breaks usage, rollback forward with a higher version number.
10. Update `AGENT_SYNC_STATUS.md` before publishing meaningful work.

Recommended commands:

```sh
git fetch github main
git fetch origin master
node scripts/check-version-sync.js
node scripts/smoke-test-app.js
node scripts/check-agent-sync-status.js
git push github main
git push origin main:master
```
