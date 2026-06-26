# Hermes Handoff

This file is the working context Hermes should read before editing the app.

## App Shape

- The main app is a static HTML app: `perm-app.html`.
- The live site is GitHub Pages: `https://taoyouming308-ui.github.io/perm-app.html`.
- The current live app version is controlled by three files:
  - `perm-app.html` `data-version`
  - `version.txt`
  - `version.json`
- `admin.html` is the backend/admin page.
- Supabase is the app data backend. Do not rename table fields casually because the frontend reads many fields directly from `record_data`.

## Remotes

- `github` -> `git@github.com:taoyouming308-ui/taoyouming308-ui.github.io.git`
- `origin` -> `git@gitee.com:free-craftsman/perm-app.git`
- GitHub branch is `main`.
- Gitee branch is `master`.
- These two must be kept synchronized. The previous downgrade happened because Gitee was old while GitHub was new.

## Current Publish Guard

The repo now has:

- `scripts/check-version-sync.js`
- `.githooks/pre-push`
- `PUBLISH_RULES.md`
- `AI_COLLABORATION_RULES.md`
- `NO_DOWNTIME_UPDATE_RULES.md`

Run:

```sh
git config core.hooksPath .githooks
node scripts/check-version-sync.js
```

The hook fetches both remotes and rejects pushes if local `HEAD` does not include both remote heads.

Updates must not interrupt active salon work. The app should prompt for refresh instead of forcing a refresh. If a release is bad, use `scripts/rollback-forward.js` to publish stable code as a higher version.

## Hair Analysis Workflow

The hair analysis records live in Supabase `hair_records`.

Important columns and JSON fields:

- row `id`
- row `customer_name`
- row `customer_phone`
- row `barber`
- row `technician`
- row `status`
- row `record_data`
- `record_data.seq`
- `record_data.status`
- `record_data.formFields`
- `record_data.rodDetails`
- `record_data.careUsage`
- `record_data.feedbackRating`
- `record_data.followDate`
- `record_data.followMsg`

Status meanings:

- `待回访`: the stylist created/saved the record and assistant may still need to fill.
- `技师已完成`: assistant has filled and returned it to stylist.
- `待回访完成`: legacy equivalent of assistant returned; treat like `技师已完成`.
- `已完成`: stylist saved the archive, but follow-up/evaluation is not completed.
- `回访完成`: stylist completed follow-up/evaluation and archived it.

Task-list display rules:

- Stylist sees `待助理填写` only when there is an assistant and status has not returned.
- Stylist sees `待保存档案` when status is `技师已完成` or `待回访完成`.
- Stylist sees red `未评定未回访` unless status is exactly `回访完成`.
- The red task button is `填写回访`, not `回访完成`. `回访完成` is a result, not an action.
- Assistant sees `待填写` before saving and `已回传发型师` after saving.

Save behavior:

- Assistant save must patch the same cloud row and set status to `技师已完成`.
- Stylist ordinary archive save must not become `回访完成`.
- Stylist follow-up save must come from the follow-up mode and set status to `回访完成`.
- Uploaded/customer-archive hair records must not be deleted from task list.
- Record numbering must remain stable across app versions.

## Customer Archive Sync

Customer archive should show the same hair analysis data as frontend records:

- customer info
- hair diagnosis
- rod plan, including `头顶区`, `枕骨区`, `两侧区`, `刘海区`, `后颈区`
- perm parameters
- dye parameters
- care usage records
- follow-up/evaluation when completed

When adding fields, prefer adding them to `record_data.formFields` and preserving old keys during PATCH.

## Meiguanjia Sync Notes

The goal is stable synchronization with Meiguanjia customer data:

- customer profile
- package/cards balance
- remaining package items
- consumption history
- booking/customer matching

Do not guess API endpoints. Use the logged-in Meiguanjia page and DevTools Network to observe real requests, parameters, response fields, and auth behavior. Then map those fields into this app.

For any sync issue, collect a concrete example first:

- customer name
- phone suffix/full phone
- what Meiguanjia shows
- what this app shows
- endpoint/table involved

Then fix mapping or refresh logic.

## Safe Editing Checklist

Before editing:

```sh
git fetch github main
git fetch origin master
git status --short --branch
node scripts/check-version-sync.js
node scripts/smoke-test-app.js
```

Before publishing:

```sh
node scripts/check-version-sync.js
git push github main
git push origin main:master
```

After publishing:

```sh
curl -fsSL 'https://taoyouming308-ui.github.io/version.txt?_v=NEW_VERSION&t='$(date +%s)
curl -fsSL 'https://taoyouming308-ui.github.io/perm-app.html?_v=NEW_VERSION&t='$(date +%s) | sed -n '2p'
```
