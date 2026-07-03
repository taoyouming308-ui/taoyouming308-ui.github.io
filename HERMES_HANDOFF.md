# Hermes Handoff

## v344 护理自动出库实验

- 仅自由手艺人启用协议配置；向里造型护理数据继续保存，但 App 不生成出库任务。
- 执行器唯一源文件：`scripts/care_outbound_worker.py`。
- 门店与产品映射唯一源文件：`scripts/care_outbound_store_config.json`。
- 部署脚本：`scripts/deploy_care_outbound_worker.sh`；部署目标位于 `~/.hermes/scripts/`，必须保持 SHA-256 一致，禁止只改 Hermes 副本。
- 新版 App 使用协议 v2 和确定性负数队列 ID；执行器只读取 `id < 0`，旧版正数队列永远不会被自动重放。
- 美管加出库必须使用原始克数和 `outwaretype=8`，并按 `saveOutDepot → auditOutDepot → getOutDepotList` 完成创建、审核和明细回查。
- 出库员工对应发质分析表的发型师，必须写入 `outdepot.employeeid`；`operatid/operatName` 只表示当前登录操作人，禁止用它替代员工字段。
- 人员 ID 在门店配置的 `employees` 中显式维护；未填写、未映射或回查员工不一致时禁止继续出库。
- 只有美管加单据 `status=1` 且 employeeId、depotId、克数全部一致时，队列才能标记 `completed`。网络结果不明确一律进入 `needs_review`。
- `scripts/care_outbound_store_config.json` 当前 `runtime_enabled=true`，但仅自由手艺人 `enabled=true`；向里造型仍保持关闭。
- LaunchAgent 唯一源文件：`scripts/com.freecraftsman.care-outbound.plist`；使用 `scripts/install_care_outbound_launchd.sh` 安装，任务 `com.freecraftsman.care-outbound` 每60秒运行一次。
- 2026-07-01 受控真实测试：自由手艺人 `歌薇酸性护理6A` 出库1克，美管加单号 `CPKY20260701001`、状态已审核，库存由756克变为755克。
- 美管加当前保存载荷使用顶层 `shopId` 和 `outdepot.details`；旧 `stockOutDepotDetailDtoList` 会生成无明细空壳单，禁止恢复。首次测试产生的未审核空壳单 `73539954` 已删除且未改变库存。
- 2026-07-01 已将旧版正数 pending 行 `7-17` 条件更新为 `legacy_review`；这些记录可能已人工出库，只能核对，不能自动重试。
- 2026-07-03 用户选择隔离员工字段修复前的3个协议v2批次；14条旧队列已标记 `needs_review` 且未自动出库。修复版部署后 active pending/processing 为0，后续只处理新建测试单。

## v332 Meiguanjia synchronization

- Canonical source: `scripts/sync_mgj_customer_profiles.py`.
- Deployed cron target: `/Users/a1/.hermes/scripts/sync_mgj_all.py`.
- Never edit only the deployed target. Change the canonical source, run `python3 -m unittest scripts/test_sync_mgj_customer_profiles.py -v`, then deploy the exact file.
- A failed package or bill request must never replace `card_packages` or `service_history` with an empty array.
- Cron modes: OS normal sync at `00/30`; the single Hermes missing-field backfill runs at `05/20/35`; keepalive runs at `50`. Do not remove the shared `/tmp/sync_mgj_all.lock`.
- Backfill checkpoint: `/Users/a1/.hermes/mgj_customer_backfill.json`. Backfill advances by profile `id` and never resets automatically after reaching the end.
- Keepalive canonical source: `scripts/mgj_keepalive.py`; deployed copies under `~/.hermes/scripts/` and the Meiguanjia skill must have the same hash.
- Hermes keepalive job `25e56b7f1ac0` runs at `50 * * * *`, not on the hour. It shares the customer sync lock and must never unconditionally relogin.
- Credentials are local-only in `~/.hermes/meiguanjia-auth.json` with mode 600. Never commit or print them.
- Booking canonical source: `scripts/sync_mgj_bookings.py`; deployed target: `/Users/a1/.hermes/scripts/sync_mgj_bookings.py`.
- Booking wrapper canonical source: `scripts/sync_mgj_bookings.sh`. It must use `exec` and propagate failures; never suppress stderr or force `exit 0`.
- A booking may be deleted only when that exact store/date API call succeeded and omitted the stable appointment id.
- Customer backfill canonical wrapper: `scripts/backfill_mgj_customer_profiles.sh`. Run one scheduled backfill source only; unmanaged endless loops are forbidden.
- Hermes no-agent scripts have a 120-second execution limit. Keep customer backfill at 15 profiles per run so the 2-second API pacing can finish before timeout.

This file is the working context Hermes should read before editing the app.

## App Shape

- The main app is a static HTML app: `perm-app.html`.
- The live site is GitHub Pages: `https://taoyouming308-ui.github.io/perm-app.html`.
- The current live app version is controlled by three files:
  - `perm-app.html` `data-version`
  - `version.txt`
  - `version.json`
- `admin.html` is the backend/admin page.
- `admin-panel.html` is legacy-only and redirects to `admin.html`; do not add features to the legacy file.
- Backend configuration modules for `hair_types`, `perm_styles`, and `perm_data` were intentionally removed from `admin.html` in v335. Their tables/data were not deleted, and the App must keep its existing `perm_data` runtime query.
- Inactive `staff` rows are registration applications in the current schema. Do not add a staff-disable action until a separate approval/disabled state exists, or pending applications and disabled employees will be conflated.
- Backend operation logs are current-device localStorage only. Do not describe them as database-level audit logs.
- Supabase is the app data backend. Do not rename table fields casually because the frontend reads many fields directly from `record_data`.

## Publication Source

- `github` -> `git@github.com:taoyouming308-ui/taoyouming308-ui.github.io.git`
- GitHub branch is `main`.
- GitHub `main` is the only publication source.
- Gitee is retired; Hermes and Codex must not fetch or push it.

## Current Publish Guard

The repo now has:

- `scripts/check-version-sync.js`
- `scripts/check-release-integrity.js`
- `scripts/test-hair-task-state.js`
- `scripts/test-admin-workflow.js`
- `scripts/test-booking-ui.js`
- `.githooks/pre-push`
- `PUBLISH_RULES.md`
- `AI_COLLABORATION_RULES.md`
- `NO_DOWNTIME_UPDATE_RULES.md`
- `MEIGUANJIA_SYNC_REVIEW.md`
- `AGENT_SYNC_STATUS.md`

Run:

```sh
git config core.hooksPath .githooks
node scripts/check-version-sync.js
node scripts/check-release-integrity.js
node scripts/test-hair-task-state.js
node scripts/test-admin-workflow.js
node scripts/test-booking-ui.js
node scripts/check-agent-sync-status.js
```

The hook fetches GitHub and rejects pushes if local `HEAD` does not include `github/main`.

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

- `待技师填写`: the stylist assigned an assistant and the assistant has not returned the record.
- `待回访`: no assistant is pending; the stylist still needs to complete the follow-up.
- `技师已完成`: assistant has filled and returned it to stylist.
- `待回访完成`: legacy equivalent of assistant returned; treat like `技师已完成`.
- `已完成` / `已保存`: legacy saved states; they are not proof of follow-up.
- `回访完成`: only complete when `record_data.feedbackRating` or this record's `record_data.followUpScreenshot` is present.

Task-list display rules:

- Stylist sees `待助理填写` only when there is an assistant and status has not returned.
- Stylist sees `待保存档案` when status is `技师已完成` or `待回访完成`.
- Stylist sees red `未评定未回访` only after the task is ready for stylist follow-up.
- The red task button is `填写回访`, not `回访完成`. `回访完成` is a result, not an action.
- Assistant sees `待填写` before saving and `已回传发型师` after saving.

Save behavior:

- Assistant save must patch the same cloud row and set status to `技师已完成`.
- An assistant/technician who creates a new record and selects another stylist is recorded as the technician; meaningful content is returned directly with status `技师已完成`.
- Stylist archive save without a rating or this record's screenshot must not become `回访完成`.
- Stylist save from either the archive-edit entry or the dedicated follow-up entry sets status to `回访完成` when a rating or this record's screenshot is present.
- A record still waiting for its assigned assistant must not become `回访完成`, even if follow-up evidence was entered early.
- Uploaded/customer-archive hair records must not be deleted from task list.
- Record numbering must remain stable across app versions.
- All task states are hidden after 30 days.
- Follow-up screenshots belong to the current `hair_records.record_data`; never restore a global screenshot from localStorage.

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

For sync optimization details and the read-only audit script, read `MEIGUANJIA_SYNC_REVIEW.md` and run:

```sh
node scripts/audit-meiguanjia-sync.js
```

## Codex/Hermes Handoff Baton

Before editing, read `AGENT_SYNC_STATUS.md`. Before committing or publishing any meaningful change, update it with the new version, what changed, what remains open, inspected examples, and checks run. Do not rely on chat history alone for handoff.

## Safe Editing Checklist

Before editing:

```sh
git fetch github main
git status --short --branch
node scripts/check-version-sync.js
node scripts/check-release-integrity.js
node scripts/smoke-test-app.js
node scripts/test-care-outbound.js
node scripts/test-hair-task-state.js
node scripts/test-customer-archive-rendering.js
node scripts/test-admin-workflow.js
node scripts/test-booking-ui.js
python3 -m unittest scripts/test_sync_mgj_bookings.py scripts/test_mgj_keepalive.py scripts/test_sync_mgj_customer_profiles.py
node scripts/check-agent-sync-status.js
```

Before publishing:

```sh
node scripts/check-version-sync.js
node scripts/check-agent-sync-status.js
git push github main
```

After publishing:

```sh
curl -fsSL 'https://taoyouming308-ui.github.io/version.txt?_v=NEW_VERSION&t='$(date +%s)
curl -fsSL 'https://taoyouming308-ui.github.io/perm-app.html?_v=NEW_VERSION&t='$(date +%s) | sed -n '2p'
```
