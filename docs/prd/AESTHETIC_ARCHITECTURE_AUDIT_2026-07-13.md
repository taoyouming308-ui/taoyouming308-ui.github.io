# 美发专业领域 AI / App 架构审计（2026-07-13）

## 审计基线与范围

- 当前源仓库：`/Users/a1/Documents/Codex/2026-06-20/perm-pages`
- GitHub 基线：`5530519`（v376），审计后第一阶段实现为 v377
- 审计原则：保留零构建 GitHub Pages 入口、现有业务数据、自由聊天训练体验和 Supabase 表；只做向后兼容增量。
- 未纳入修改：门店业务流程、美管加同步、生产数据、模型密钥与既有未跟踪文件。

## 当前架构

### 前端

- 零构建 HTML/JavaScript，不是 React/Next.js。
- 员工端：`perm-app.html`；后台：`admin.html`。
- 美感训练知识运行时：`aesthetic-knowledge.v1.js`。
- Hair Vision 训练计划、计时和状态辅助：`hair-vision-training.v1.js`。
- 本机使用 localStorage 保存个人训练图库、图片分析缓存、能力画像、训练进度、进行中 Session 和输入草稿。

### 后端与模型调用

- Supabase Edge Functions：
  - `aesthetic-coach`：员工校验、图片分析、训练对话、阶段反馈和总结；服务端读取 `OPENAI_API_KEY`。
  - `aesthetic-learning`：Session/轮次云同步、独立评审、训练策略实验、训练次数与后台管理。
- 当前默认模型通过环境变量配置，密钥不在前端；公开 Supabase publishable key 只用于公开客户端边界。
- 模型链路使用 OpenAI JSON 输出；v377 前只有 JSON 解析和少量必填字段判断，v377 加入统一 Schema、一次修复和安全失败。

### 数据库

- 已有训练表：`aesthetic_training_sessions`、`aesthetic_training_turns`、`aesthetic_training_evaluations`、`aesthetic_coach_strategies`、`aesthetic_strategy_experiments`。
- 已有管理表：`aesthetic_training_policies`、`aesthetic_training_admin_sessions`、`aesthetic_training_admin_audit`。
- 所有训练写入经 service role Edge Function；匿名和普通 authenticated 角色无直接表权限。

### 图片上传

- 个人训练图在浏览器压缩并按员工隔离保存在本机图库。
- 图片分析时以临时 data image/批准的 HTTPS 图片提交给服务端模型；不进入公共知识库。
- 当前没有跨设备私有图片 Storage 闭环；这是后续工作，不应通过开放 anon 写权限实现。

### 训练记录与恢复

- v371 起本机保存 Session、当前目标、对话、检查点、计时、草稿和版本；刷新、退出和重新打开可继续。
- v372 起后台静默同步 Session、轮次、Prompt/策略/模型版本，结束后独立评审。
- v377 增加明确 `session_state`、`state_version`、`last_saved_at` 与 `resume_payload`，保留旧 `status` 和 JSON 字段兼容。

### 知识库

- 正式知识：`aesthetic-knowledge.v1.js` 与 `packages/dss/src/core.ts`，有版本和治理边界。
- 人类文档：`docs/beauty`、`docs/dss`、`docs/haircut`、`docs/perm` 等；不整篇进入运行时。
- 候选知识：`knowledge-candidates`，不会自动升级为正式标准。

## 主要问题与目标差距

1. v376 的 Prompt 同时存在于包目录和部署 Edge Function，容易漂移；v377 已收敛到 deployable shared modules。
2. v376 没有完整输出 Schema、字段级错误和自动修复；v377 已覆盖分析、教练、总结与阶段反馈四类输出。
3. v376 的云端状态只有粗粒度 `in_progress/completed/expired`；v377 增加细粒度、可版本化且可恢复的兼容状态机。
4. 缺少模型输出验证轨迹和长期能力历史表；v377 已提供 additive migration，实际写入接线可作为下一小阶段。
5. 目标文档中的通用 `users`、图片 Storage、专家案例/标注、知识 chunk、偏好对等完整数据域尚未建立；直接一次性建全会产生空表和错误权限假设，应按真实产品闭环逐步加入。
6. 当前人物分析已成为五个必经检查点之首，但完整 AI 输出仍偏训练教练契约，不是一次性全量“人物→风格→结构→技术→方案→沟通”报告；应保留对话优先，只为专家后台和数据导出增加完整报告契约。
7. 技术推导缺少已审核的药水/软化/温度参数知识源，因此必须继续拒绝猜测，不能仅靠 Prompt 扩大输出。

## 推荐开发顺序

1. 结构化输出、Prompt 单源、状态机和迁移（v377，本阶段）。
2. 把每次模型输出/修复/失败和能力更新写入新增追踪表，并做管理端只读诊断。
3. 增加跨设备 Session 拉取与冲突策略，以 `state_version` 做乐观并发控制。
4. 建立专家案例、标注版本和审核工作流，再扩展完整专业报告 Schema。
5. 建立私有图片 Storage、服务端身份/RLS 与授权 URL；完成后才开放跨设备个人图库。
6. 增加知识文档/chunk 的审核、版本、引用和检索链路。
7. 数据质量达到门槛后导出 SFT/偏好 JSONL；最后才评估 LoRA/DPO。

## 第一阶段涉及文件

- `supabase/functions/_shared/aesthetic-output-schema.ts`
- `supabase/functions/_shared/prompts/{analysis,coach,evaluation,safety-rules}.ts`
- `supabase/functions/aesthetic-coach/index.ts`
- `supabase/functions/aesthetic-learning/index.ts`
- `packages/prompts/src/aesthetic-coach.ts`
- `packages/analysis-engine/src/contracts.ts`
- `hair-vision-training.v1.js`
- `perm-app.html`
- `supabase/migrations/20260713140000_aesthetic_schema_state_machine.sql`
- `scripts/test-aesthetic-system.js`
- `CHANGELOG.md`、`AGENT_SYNC_STATUS.md`、版本文件

## 数据库迁移方案

- 只增加列、表、索引、约束和 RLS，不删除或重命名现有字段。
- `aesthetic_training_sessions` 保留旧 `status`，新增细粒度状态与恢复载荷。
- 新表 `aesthetic_model_outputs` 保存 operation、Schema/Prompt/模型版本、校验状态、错误和结构化输出。
- 新表 `aesthetic_ability_history` 保存按 Session 的能力维度变化证据。
- 新表默认 RLS 开启，anon/authenticated 全部撤权，只授予 service role。
- 迁移部署与 Edge Function 发布应先数据库、后服务端、最后前端；旧前端可继续使用旧字段，新前端遇到旧服务端会按现有 deferred sync 继续本机保存。

## 第一阶段验收标准

- 四类模型输出均有 Schema；首次失败只修复一次，二次失败不进入页面状态。
- Prompt 不再复制在页面；部署与包消费者复用同一模块源。
- 旧 Session 可恢复，新 Session 带细粒度状态、版本和恢复载荷。
- 迁移不删除数据、不开放匿名写权限。
- 版本、发布完整性、模块边界、美感系统、App 冒烟和相关业务回归通过。
