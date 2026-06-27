# AI Collaboration Rules

These rules are mandatory for Codex, Hermes, and any other assistant editing this app.

## Iron Rules

1. Always start by fetching both remotes:

```sh
git fetch github main
git fetch origin master
git status --short --branch
```

2. Never edit from an old local copy. `HEAD` must include both `github/main` and `origin/master`.

3. Never overwrite `perm-app.html`, `version.txt`, or `version.json` from an older copy.

4. Every app-code change must bump all three versions together:

- `perm-app.html` `<html data-version="...">`
- `version.txt`
- `version.json`

5. Do not push until this passes:

```sh
node scripts/check-version-sync.js
node scripts/check-agent-sync-status.js
```

6. Push the same commit to both remotes:

```sh
git push github main
git push origin main:master
```

7. If either remote has changed, stop and merge/rebase first. Never force-push to solve divergence.

8. If another assistant made changes, read the diff before editing. Preserve their work unless the user explicitly asks to revert it.

9. Do not patch production data blindly. If a Supabase row needs repair, first identify the row by id, phone, name, and current status, then patch only that row.

10. For Meiguanjia sync work, treat external API behavior as unstable. Verify by observing real Network requests or existing integration code before changing mapping logic.

11. Updates must not interrupt normal use. Never force-refresh active users; show an update prompt and let them refresh when safe.

12. Rollbacks must be forward-only. Restore stable code under a higher version number instead of publishing an older version.

13. `AGENT_SYNC_STATUS.md` is the live baton between Codex and Hermes. Every meaningful change must update it before commit/push.

14. Never add or modify `perm-app.v*.html` or `perm-app.backup.html` as a release method. Git history and tags are the only release backups; production changes must be applied to the latest `perm-app.html`.

15. The tracked hook must be enabled in every clone:

```sh
git config core.hooksPath .githooks
```

GitHub branch protection must require the `Validate shared app` check before merging or publishing through a pull request.

## Ownership

- GitHub `github/main` is the live GitHub Pages source.
- Gitee `origin/master` is a mirror that Hermes may use.
- Both remotes must stay on the same commit whenever possible.

## Required Final Check

Before telling the user the work is done, verify:

```sh
node scripts/check-version-sync.js
node scripts/check-release-integrity.js
node scripts/smoke-test-app.js
node scripts/check-agent-sync-status.js
git status --short
git log -1 --oneline --decorate
```

For app-code changes, also verify the online version:

```sh
curl -fsSL 'https://taoyouming308-ui.github.io/version.txt?_v=CHECK&t='$(date +%s)
curl -fsSL 'https://taoyouming308-ui.github.io/perm-app.html?_v=CHECK&t='$(date +%s) | sed -n '2p'
```
