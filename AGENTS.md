# Agent Instructions

Codex, Hermes, and other AI coding agents must read these files before editing:

1. `AI_COLLABORATION_RULES.md`
2. `PUBLISH_RULES.md`
3. `HERMES_HANDOFF.md`
4. `NO_DOWNTIME_UPDATE_RULES.md`
5. `MEIGUANJIA_SYNC_REVIEW.md`
6. `AGENT_SYNC_STATUS.md`

Mandatory start command:

```sh
git fetch github main && node scripts/check-version-sync.js && node scripts/check-release-integrity.js && node scripts/check-agent-sync-status.js
```

Never publish from a stale copy. Never push a lower app version. GitHub `main` is the only publication source; Gitee is retired and must not be fetched or pushed. Never force-refresh users during active work; use update prompts and forward-only rollback. Update `AGENT_SYNC_STATUS.md` before committing meaningful work. Meiguanjia runtime scripts must be deployed from the tracked canonical files documented in `HERMES_HANDOFF.md`; never maintain a separate Hermes-only implementation or start an endless backfill loop.
