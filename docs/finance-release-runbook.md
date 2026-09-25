# 财务 App 发布与验证清单

本文记录可复现的财务发布准备步骤和环境变量**名称**。不保存密钥值，也不授权任何人自动部署、应用迁移或修改生产账务。

## 固定验证环境

| 组件 | 固定版本/来源 | 用途 |
|---|---|---|
| Node.js | `.node-version`（当前 `22.22.1`） | 静态检查与浏览器测试 |
| npm / Playwright | 根目录 `package-lock.json`；Playwright `1.62.1` | 安装锁定测试依赖、驱动 Chromium |
| Chromium | Playwright `npx playwright install chromium` | 隔离浏览器回归 |
| Python | CI `3.12` | 仓库 Python 测试 |
| Deno | CI `2.9.6` | Edge 类型检查 |
| Supabase CLI | CI `2.109.1` | 部署命令契约检查/受控发布 |
| PostgreSQL | CI 财务隔离测试 `17` | 仅合成数据的迁移/SQL 回归；禁用测试容器网络 |
| CI OS | GitHub Actions `ubuntu-24.04` | 可复现发布门禁 |

项目生产前端是无构建静态页面；不要为了运行财务测试而引入前端构建产物或将任何生产凭证复制到本机。

## 本地验证

从仓库根目录执行：

```sh
npm ci
npx playwright install chromium
node scripts/test-zysyr-validation-manifest.js
npm run test:finance
node scripts/check-version-sync.js
node scripts/check-release-integrity.js
```

`npm run test:finance` 与 Git pre-push 使用相同的 `scripts/zysyr-finance-test-manifest.json`。财务 SQL 用例需要 Docker；仅运行仓库指定的隔离测试容器，不连接生产数据库。若 Docker/Chromium 不可用，应将结果记录为“未验证”，不可跳过门禁后声称通过。

GitHub Actions 的权威检查是 `Validate shared app` 工作流。发布前必须确认目标 commit 对应的 Validate 和 Pages 工作流成功；本地通过不等于线上已发布。

## Supabase 环境变量名称

以下仅为代码读取到的名称，不代表每个部署目标都必须全部设置。按目标函数核对，使用 Supabase 项目安全设置，不把值写入文档、终端日志、Git 或截图。

| 变量名 | 使用范围 | 说明 |
|---|---|---|
| `SUPABASE_URL` | 多个 Edge Functions | 项目 API URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 服务端函数 | 高权限秘密；只能由 Supabase 注入 Edge 环境，严禁前端、仓库、日志暴露 |
| `SUPABASE_PUBLISHABLE_KEY` 或 `SUPABASE_ANON_KEY` | 认证/迁移函数 | 前者优先，旧兼容后者；不是 service-role 密钥 |
| `ZYSYR_WORKER_SECRET` | `operations-api`、OCR/AI worker | worker 间共享鉴权秘密；部署到对应调用双方前先确认同步窗口 |
| `SILICONFLOW_API_KEY` | OCR worker；报表能力状态探测 | 可选 OCR 提供商秘密 |
| `SILICONFLOW_BASE_URL` | OCR worker | 可选，代码有默认值 |
| `ZYSYR_OCR_MODEL` | OCR worker | 可选，代码有默认值 |
| `ZYSYR_DAILY_CODEX_BRIDGE_URL` / `ZYSYR_DAILY_CODEX_BRIDGE_TOKEN` | `operations-api` 日报识别桥 | 外部桥接地址与秘密；需单独验证连通性、token 轮换和失败回退 |
| `ZYSYR_DAILY_CODEX_MODEL` | 日报识别桥 | 可选模型标识 |
| `ZYSYR_AI_API_KEY` 或 `DEEPSEEK_API_KEY` | `operations-ai-worker` | AI 提供商密钥；前者优先 |
| `ZYSYR_AI_BASE_URL` / `DEEPSEEK_BASE_URL` | AI worker | 可选，代码提供默认值 |
| `ZYSYR_AI_MODEL` / `ZYSYR_AI_PROVIDER` | AI worker | 可选，代码提供默认值 |
| `OPENAI_API_KEY` / `AESTHETIC_COACH_MODEL` | `aesthetic-coach` | 非财务主链路的美感教练功能 |
| `KNOWLEDGE_COLLECTOR_MODEL` / `KNOWLEDGE_REVIEW_MODEL` | `aesthetic-learning` | 非财务主链路的知识整理模型 |

CI 通过代码类型检查和 CLI 参数契约，不读取生产秘密，也不证明线上变量齐全。每次 Edge 部署前应在 Supabase Dashboard 对照目标函数所需名称确认“已配置/有意未配置”，只记录状态，不复制变量值。

## 数据库迁移与 Edge 发布边界

1. 先检查 `git status`、分支、commit、发布版本同步；修改前确认归档备份和回滚 commit。
2. 运行上方本地/CI 门禁，检查 Supabase CLI 版本为 `2.109.1`。
3. 只读列出本地迁移与目标项目迁移历史，核对时间戳和 SQL 内容。该仓库缺少可直接代表生产的完整 `supabase/config.toml`；生产基线包含既有员工表。禁止通过伪造真实 `auth.users`、跳过 baseline 或重写远端 migration history 让整库重放“变绿”。
4. 对拟应用迁移先执行 `supabase db push --dry-run --linked --include-all`，把差异交由获授权维护者审阅。dry-run 仅列计划，不是已应用或安全证明。
5. 数据库迁移与 Edge Functions 分开发布、分开验证。任何影响财务金额、历史账、RLS、登录/会话、对象权限的迁移，须先说明影响、备份与回滚方案并取得明确确认。
6. 只有获授权后，才应用已审阅迁移或部署函数；部署后读取线上函数版本/状态/源码标记、JWT 设置和必要的无会话拒绝探针。`verify_jwt=false` 必须与代码内部身份鉴权一起检查，不能单独视为安全或不安全结论。
7. Pages 发布单独确认：线上无缓存读取版本号、HTML `data-version`、各运行时脚本 cache-buster 一致；记录 Pages workflow 成功。函数部署成功不能代替前端发布验证。
8. 使用已授权的真实测试角色执行只读/必要最小操作矩阵。未取得财务/股东账号或门店授权前，记录为“待验收”，不借用生产账号，不写入真实账务。

## 尚未由仓库自动证明的事项

- 生产秘密值存在且与目标函数匹配（只能在项目安全设置中核验）。
- 全量生产迁移顺序/基线可在一次性隔离项目完整重放；历史员工表和身份是受控基线。
- 生产数据库、Storage 原件的异地备份以及真实恢复演练；工程归档不含这两类数据。
- 真实财务/股东账号、跨门店隔离、Safari/iOS/iPad 和弱网月结验收。
- 生产部署、迁移、权限调整、PITR 开启或账号会话撤销。

这些项目必须在上线表中独立标为阻断或待验收，不能因本清单、类型检查或 CI 通过而自动关闭。
