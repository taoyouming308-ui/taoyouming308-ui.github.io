# Publish Rules

This app is deployed from GitHub Pages and may also be edited from the Gitee mirror.

Before changing or publishing:

1. Pull the latest GitHub version first.
2. Keep `perm-app.html` `data-version`, `version.txt`, and `version.json` identical.
3. Never push a lower version than the current online version.
4. Push the same commit to both remotes when Gitee is used by another editor.

Recommended commands:

```sh
git fetch github main
git fetch origin master
node scripts/check-version-sync.js
git push github main
git push origin main:master
```
