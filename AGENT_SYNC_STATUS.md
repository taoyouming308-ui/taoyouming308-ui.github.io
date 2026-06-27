# Agent Sync Status

This file is the live handoff baton between Codex, Hermes, and any other assistant.
Every meaningful change must update this file before commit/push.

## Current Shared State

- App version: v327
- Last synchronized base checked: `0138ba3 v326: 懒加载-perm_data首次进方案页才拉`
- GitHub live branch: `github/main`
- Gitee Hermes branch: `origin/master`
- Required state before editing: local `HEAD` includes both `github/main` and `origin/master`
- Current owner: handoff ready for either Codex or Hermes

## Last Completed Work

- v327: 修复后台软删除发质分析表后，App「我的任务」仍显示旧云任务的问题；任务查询与前端渲染双重排除 `status=deleted`。
- v327: 预约烫染标记、客户档案、客户历史发质记录、后台统计与未完成明细统一排除已删除的 `hair_records`。
- v327: 修复 v326 页面版本与 `version.txt/version.json` 仍停在 v322 的不一致，三处版本统一为 327。
- v327: 冒烟检查新增铁律，`renderMyTasks` 的云任务查询必须排除软删除记录。
- v326: 懒加载 `perm_data`，首次进入方案页时再请求。
- v325: 待处理任务不受日期限制，已完成任务只显示最近 30 天。
- v324: 我的任务增加待处理优先区并调整为黑白配色。
- v323: 我的任务按日期分组。
- v322: 降低轮询频率并精简查询字段。
- v321: 修复版本降级导致的无限跳转闪屏。
- v320: 护理产品添加后自动推送出库队列。
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

- 2026-06-27: 已从 GitHub 拉取并快进到 v326；确认 GitHub 比 Gitee 多 13 个提交，禁止从旧的 Gitee v317 基线直接发布。
- 2026-06-27: v326 同步前检查发现页面为 326、`version.txt/version.json` 为 322；已在 v327 修复。
- 2026-06-27: Supabase 只读检查确认当前有 10 条 `hair_records.status=deleted`，包含截图里的 `cesi` 与多条“小爱/未填写”；v327 正常页面查询均不会返回这些记录。
- 2026-06-27: v327 `check-version-sync`、`smoke-test-app`、`check-agent-sync-status`、HTML 脚本语法和 `git diff --check` 均通过。
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
