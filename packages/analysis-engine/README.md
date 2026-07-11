# Analysis Engine

这里定义 AI 操作契约与编排边界。标准链路是：校验操作与输入 → 选择 DSS 模块 → 调用 Prompt 构建器 → 调用模型 → 校验和裁剪 JSON → 返回页面。Supabase Function 是当前部署适配器。
