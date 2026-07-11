# Agent Instructions

## Enterprise backup rules

Before any modification:

1. Run `git status --short --branch` and review existing changes.
2. Create a recovery commit when there are tracked changes that form a safe, coherent checkpoint. Never commit secrets, caches, or unrelated untracked files merely to create a checkpoint.
3. Push the recovery commit to GitHub with `git push github main`. If the push cannot be completed, stop before risky or broad changes and report the blocker.
4. Run `scripts/backup-zysyr.sh`; it creates at most one complete `ZYSYR` daily archive per calendar day unless `--force` is supplied.
5. Start development only after the checks and backup above succeed.

The following operations are prohibited:

- `git reset --hard`
- `git clean -fd`
- deleting many files without explicit user confirmation
- overwriting existing business logic without explicit user confirmation and a reviewed diff

After every completed module, create a focused commit, push it to GitHub, and update `CHANGELOG.md`. Existing publication, version, synchronization, and no-downtime rules below remain mandatory.

这是训练发型师审美、分析、判断、设计与沟通能力的 AI 产品，同时承载门店业务流程。开始修改前先读 `ARCHITECTURE.md`、目标模块的 `README.md`，以及下列协作与发布文件。

## Product and architecture rules

- 代码必须模块化；新增模块保持低耦合并通过小型标准接口协作。
- Prompt 与页面、业务和网络代码分离，统一维护在 `packages/prompts`。
- DSS 独立维护在 `packages/dss`；知识资料统一归档到 `docs` 对应领域。
- AI Engine 只通过标准操作契约选择 DSS/Prompt，不在编排层直接拼接 Prompt。
- 长知识文档不得整篇成为运行时依赖；使用审核后的结构化模块按需加载。
- 公共类型与纯工具放 `packages/shared`；通用 UI 的边界放 `packages/ui`。
- 页面避免堆按钮，优先保证 AI 分析质量与自然对话体验。
- 当前是零构建 GitHub Pages 应用。根目录发布入口不得机械迁移到 `apps/web`；任何入口迁移必须先有兼容部署方案和回归验证。

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
