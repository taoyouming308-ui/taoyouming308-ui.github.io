# 自由手艺人 AI 发型师训练与门店应用

静态 GitHub Pages 应用，员工端入口为 `perm-app.html`，后台入口为 `admin.html`，数据与 AI 服务由 Supabase 提供。

## 本地启动

```sh
python3 -m http.server 8000
```

打开 `http://localhost:8000/perm-app.html`。不要直接双击 HTML；部分 fetch 和浏览器能力要求 HTTP 环境。

## 常用检查

```sh
node scripts/check-version-sync.js
node scripts/check-release-integrity.js
node scripts/smoke-test-app.js
node scripts/test-module-boundaries.js
node scripts/test-aesthetic-system.js
python3 -m unittest scripts/test_aesthetic_coach_endpoint.py
```

完整发布前检查见 `AGENTS.md` 和 `PUBLISH_RULES.md`。

## 目录

- `perm-app.html` / `admin.html`：稳定的线上入口
- `packages/`：DSS、Prompt、AI 编排契约、共享代码和 UI 边界
- `docs/`：按领域归档的知识与产品文档
- `supabase/`：Edge Functions
- `scripts/`：测试、同步与发布保护
- `img/`：受控运行时图片资产

## 开发约定

修改前阅读 `ARCHITECTURE.md`、相关模块 README 和 `AGENTS.md` 指定的协作文档。Prompt 与业务代码分离；DSS 独立维护；长知识文档不直接进入运行时上下文；生产代码改动必须遵守版本同步、无停机更新和向前回滚规则。

默认的 `rg` 搜索会通过 `.rgignore` 跳过历史发布快照、缓存和待审候选，避免把无关旧代码装入 Codex 上下文。需要审计历史版本时可使用 `rg --no-ignore` 或直接指定文件。
