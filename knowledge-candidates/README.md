# DSS 候选知识区

此目录保存命令行自动收集、尚未进入正式知识标准的文件候选。总后台人工提交的候选保存于受保护的 Supabase 表，两条入口都不能自动发布正式知识。

## 状态

- `pending/`：待人工审核；
- `approved/`：审核通过、等待版本化发布；
- `rejected/`：不采用，保留原因便于追溯。

## 收集命令

先复制来源配置并完成来源、版权和专业适用范围核验：

```sh
cp scripts/aesthetic-sources.example.json scripts/aesthetic-sources.json
```

把允许抓取的来源设置为 `"allowed": true`，然后运行：

```sh
DEEPSEEK_API_KEY=你的密钥 \\
node scripts/collect-aesthetic-candidates.js \\
  --sources scripts/aesthetic-sources.json
```

只抓取原始候选、不调用模型时：

```sh
node scripts/collect-aesthetic-candidates.js \\
  --sources scripts/aesthetic-sources.json --no-ai
```

脚本只写入 `pending/`，不会自动修改 `aesthetic-knowledge.v1.js`、Prompt 或评分标准。文件候选经整理后可由总管理员录入云端候选，补齐观察事实、判断依据、适用条件、正反例和版权状态，再执行专家审核。审核通过只进入试用，之后仍需人工提交正式版本变更。

## DeepSeek 配置

- Endpoint 默认：`https://api.deepseek.com/chat/completions`；
- 模型默认：`deepseek-v4-flash`；
- 可选：`DEEPSEEK_MODEL=deepseek-v4-pro`；
- 可选：`DEEPSEEK_BASE_URL` 覆盖 API 基地址；
- API Key 只允许通过环境变量注入，禁止写入仓库、日志或前端代码。
