# Agent Instructions

Codex, Hermes, and other AI coding agents must read these files before editing:

1. `AI_COLLABORATION_RULES.md`
2. `PUBLISH_RULES.md`
3. `HERMES_HANDOFF.md`
4. `NO_DOWNTIME_UPDATE_RULES.md`

Mandatory start command:

```sh
git fetch github main && git fetch origin master && node scripts/check-version-sync.js
```

Never publish from a stale copy. Never push a lower app version. Push the same commit to GitHub and Gitee. Never force-refresh users during active work; use update prompts and forward-only rollback.
