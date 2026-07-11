# 系统架构

## 产品边界

本项目是训练发型师审美、分析、判断、设计与顾客沟通能力的 AI 产品，同时包含门店预约、发质分析、顾客档案和护理记录。AI 只辅助训练与整理证据，不替代现场检测和专业判断。

## 当前形态

这是一个零构建的 GitHub Pages 应用，不是 React/Next.js 工程。`perm-app.html` 和 `admin.html` 必须保留在仓库根目录，避免改变现有线上 URL。模块化采用渐进方式：浏览器发布入口保持稳定，新业务规则进入 `packages/`，长资料进入 `docs/`。

## 目录职责

- `perm-app.html`：员工端发布入口；不承载新的长 Prompt 或知识正文。
- `admin.html`：后台发布入口。
- `aesthetic-knowledge.v1.js`：浏览器兼容的版本化知识运行时产物；DSS 规则的维护边界见 `packages/dss/README.md`。
- `packages/dss`：DSS 风格、阶段、训练目标等稳定领域定义。
- `packages/prompts`：模型 Prompt 构建器，只接收结构化输入。
- `packages/analysis-engine`：AI 操作契约、编排边界和结果校验。
- `packages/shared`：跨模块纯类型和无业务倾向工具。
- `packages/ui`：未来抽取的通用 UI；现有单文件页面暂不做高风险拆分。
- `supabase/functions`：鉴权、服务端 AI 调用和数据边界。
- `scripts`：测试、发布保护和门店运行任务。
- `docs`：人类知识、PRD 和治理资料；运行时不得整篇加载。

## 数据流与 AI 调用链

```text
浏览器页面
  -> Supabase Edge Function (鉴权、输入裁剪)
  -> analysis-engine 操作契约
  -> prompts 构建结构化提示
  -> DSS 领域规则与按需知识模块
  -> 模型 JSON 输出
  -> 服务端校验/裁剪
  -> 浏览器训练状态与本地成长记录
```

Prompt 只定义模型任务和输出契约；DSS 定义稳定的专业语言；`docs` 保存来源、解释和治理材料。运行时只传当前阶段需要的 DSS 模块与最近对话，不把整份知识文档送入模型。

## 前后端与 Supabase 边界

浏览器负责交互、有限缓存和展示，不保存模型密钥。Supabase 提供业务数据、员工状态校验和 Edge Function。生产字段必须向后兼容；不得因目录重构改表名或字段。公开 anon key 可由浏览器使用，服务密钥只能存在于服务端环境变量。

## 扩展原则

1. 新功能先定义数据契约，再实现 Prompt 和页面。
2. Prompt 不在 HTML、事件处理器或网络编排代码中拼接。
3. DSS 规则独立版本化；知识资料有来源、审核状态和复核日期。
4. 页面避免堆按钮，优先分析质量和对话体验。
5. 模块通过小接口协作，禁止跨目录读取内部实现。
6. 保留根发布入口，直到存在经过验证的构建与部署迁移方案。

## 节省 Codex 上下文

新 Session 先读本文件、`AGENTS.md` 和目标模块 README，只搜索目标模块及直接调用方。不要默认读取 1 万行 HTML、历史快照或全部知识正文。需要业务细节时按 `docs` 子目录索引逐份加载。
