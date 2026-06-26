# Agent Sync Status

This file is the live handoff baton between Codex, Hermes, and any other assistant.
Every meaningful change must update this file before commit/push.

## Current Shared State

- App version: v319
- Last synchronized base checked: `6fe1047 Add shared agent sync handoff`
- GitHub live branch: `github/main`
- Gitee Hermes branch: `origin/master`
- Required state before editing: local `HEAD` includes both `github/main` and `origin/master`
- Current owner: handoff ready for either Codex or Hermes

## Last Completed Work

- v319: 发质分析表预约选择器改为展示所有客户（不再仅限烫染/护理），删除 `bookingNeedsHairAnalysis` 过滤条件。空列表文案改为「暂无预约」。
- v317 prevents pure haircut appointments from entering the hair-analysis booking picker/task path.
- v317 prevents silent close/autosave from creating empty `hair_records` tasks.
- v317 prevents assistants from returning an empty cloud hair form as `技师已完成`.
- v317 prevents empty hair forms from being archived as customer records.
- v317 adds admin deletion for `hair_records` from the backend hair-analysis record list, deleting linked `care_records` first.
- Investigated sample `宋奕 / 15858274326 / #012 / hair_records id 1782448281615_3cp3`: the booking source is `预约剪发`, while the cloud hair record has mostly empty analysis/perm/dye/care fields and was marked `技师已完成`.
- Added this shared Codex/Hermes handoff baton and `scripts/check-agent-sync-status.js`.
- Added the baton check to `.githooks/pre-push`, `AGENTS.md`, `CLAUDE.md`, `PUBLISH_RULES.md`, `AI_COLLABORATION_RULES.md`, and `HERMES_HANDOFF.md`.
- v316 reviewed Meiguanjia synchronization risk areas.
- Booking cache now includes shop/date/barber context to reduce stale appointment display.
- Booking DOM change detection now includes phone and reservation time.
- Customer profile reads sample more rows for archive/package visibility.
- Added `MEIGUANJIA_SYNC_REVIEW.md` and `scripts/audit-meiguanjia-sync.js`.

## Last Verification

- 2026-06-26: `node scripts/check-version-sync.js` passed at v319.
- 2026-06-26: `node scripts/smoke-test-app.js` passed at v319.
- 2026-06-26: `node scripts/check-agent-sync-status.js` passed at v317.
- 2026-06-26: `admin.html` script syntax check passed.
- 2026-06-26: `node scripts/check-version-sync.js` passed at v316.
- 2026-06-26: `node scripts/smoke-test-app.js` passed.
- 2026-06-26: `node scripts/check-agent-sync-status.js` passed.
- 2026-06-26: `node scripts/audit-meiguanjia-sync.js` completed read-only.
- Latest audit sample still shows Meiguanjia data gaps: 838 profile rows have visit/consumption counters but no `service_history`, 820 have consumption but no `service_history`, and only 55 sampled profiles have any `card_packages`.

## Open Work For Next Agent

- For Meiguanjia sync, use the logged-in Meiguanjia page with DevTools Network in read-only mode before changing endpoint mappings.
- Verify real endpoints/fields for appointments, customer packages/cards, remaining package items, and consumption history.
- Ensure sync writers never overwrite existing package/history arrays with empty arrays when an external request partially fails.
- Improve customer archive display only after confirming the source data mapping.
- Keep hair-analysis task status rules from `HERMES_HANDOFF.md`; do not reintroduce `已回传` as a stylist final state.
- Use backend admin deletion for confirmed erroneous `hair_records`; do not delete production records from scripts unless the row id, phone, name, and current status have been verified.

## Required Checks Before Editing

```sh
git fetch github main
git fetch origin master
git status --short --branch
node scripts/check-version-sync.js
node scripts/smoke-test-app.js
node scripts/check-agent-sync-status.js
```

For Meiguanjia/customer data work also run:

```sh
node scripts/audit-meiguanjia-sync.js
```

## Required Checks Before Publishing

```sh
node scripts/check-version-sync.js
node scripts/smoke-test-app.js
node scripts/check-agent-sync-status.js
git push github main
git push origin main:master
```

## Handoff Rule

Before any agent says the work is done, update this file with:

- the app version after the work
- what changed
- what remains open
- any data examples that were inspected
- any checks that passed or could not be run

Do not hand work to another agent through chat memory only. The repository must contain the current handoff.
