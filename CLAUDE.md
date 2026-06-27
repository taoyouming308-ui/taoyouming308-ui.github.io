# Claude/Hermes Instructions

Before editing this app, read:

- `AI_COLLABORATION_RULES.md`
- `PUBLISH_RULES.md`
- `HERMES_HANDOFF.md`
- `NO_DOWNTIME_UPDATE_RULES.md`
- `MEIGUANJIA_SYNC_REVIEW.md`
- `AGENT_SYNC_STATUS.md`

Run:

```sh
git fetch github main
git fetch origin master
node scripts/check-version-sync.js
node scripts/check-release-integrity.js
node scripts/smoke-test-app.js
node scripts/check-agent-sync-status.js
```

Do not push unless the checks pass. Keep GitHub `main` and Gitee `master` synchronized. Do not force-refresh users; use update prompts and forward-only rollback. Update `AGENT_SYNC_STATUS.md` before committing meaningful work.
