# 备用金明细导入与凭证匹配

入口位于财务工作台的备用金区，仅当前门店财务可用。Excel 支持 `.xlsx`；旧 `.xls` 先另存为 XLSX。CSV 使用 UTF-8，支持 BOM、引号、逗号和换行。单文件上限 10MB、5000 条明细、60 列；表头可以从前 50 行选择。

先选工作表、表头并映射日期、支出金额、摘要列；科目、领款人、凭证编号可选。日期必须有完整年月日，金额必须是明确的正数且至多两位小数。公式字段不读取缓存；汇总/余额、缺失和跨月行留在预览中报错，不猜填。重复检查比较日期、金额及规范化摘要，覆盖本文件、当前电子记录、历史账和已导入草稿。只导入勾选的有效行。

预览没有存储写入。确认时服务端重新解析原始文件、核验选中行，并私有保存原始字节。`zysyr_save_petty_detail_import` 在门店/月事务锁中保存不可变来源、列映射、原始行、操作者和匹配草稿；选中集合及行键阻止重复提交。未选行可以在之后重新预览同一文件并选择。网络结果不明时原件保留，先刷新核验，不立即重传。

草稿只用于匹配，不创建正式支出或历史入账。批量凭证候选按金额（精确到分）、日期及摘要排列推荐。多笔同金额保留人工选择；汇总/多交易候选不允许强关联到单笔支出。确认草稿关联调用 `zysyr_link_petty_detail_draft`，在原有凭证审核历史之外追加关联人、原因和修改后的识别字段；草稿金额不改变。

服务端存在 `OPENAI_API_KEY` 时，新的批量图片任务使用 Responses API（`store:false`，结构化 schema，45 秒超时）。`ZYSYR_VOUCHER_OPENAI_MODEL` 可指定模型，默认 `gpt-4.1-mini`。没有该密钥时保留既有 Codex 桥接；其他凭证维持既有 OCR 路径，PDF 仍人工审核。密钥、签名和私有原件不进入前端配置。识别输出必须有原文证据和足够置信度；未知日期/金额为空，最终关联仍由人确认。

发布顺序：正常受保护 PR 检查通过后，先应用增量迁移，再部署兼容的 operations-api 与 voucher-ocr-worker，最后发布 v655 页面及静态缓存。迁移和 worker 部署本身不代表真实上传验收；只验证新的用户上传，不重复识别、作废或上传既有六张凭证。现有门店数据、正式金额、历史修订和排程均保持原边界。

专项检查：`test-petty-detail-import.mjs`、`test-petty-detail-import-db.js`、`test-petty-detail-import-browser.js`、`test-petty-voucher-openai.mjs` 及既有批量凭证/识别回归。新测试纳入统一财务门禁；数据库测试仅连接本地隔离容器。


## Expense recognition and API settings (v659)

The existing all-expense voucher panel provides a re-recognition action on each image and an API/model settings dialog. Bulk model upgrade skips human-reviewed, associated or voided images. Explicit per-image re-recognition of a protected image creates a separate candidate for comparison; it cannot replace human confirmation or write a ledger. Originals and prior attempts remain available.

Settings belong to the selected company/store and require its finance scope. The default is OpenAI Responses with gpt-5.6-sol. Users can edit model ID, supported public provider API base URL, protocol and key. Supported hosts are api.openai.com, openrouter.ai, api.siliconflow.cn/com, api.deepseek.com, api.groq.com, dashscope.aliyuncs.com, dashscope-intl.aliyuncs.com and ark.cn-beijing.volces.com; private/arbitrary hosts and redirects are rejected. Compatible services must accept images and JSON Schema output. A synthetic receipt with a known date and amount verifies the connection before saving. Provider compatibility beyond these checks and recognition quality require real-sample acceptance.

Keys remain server-only: AES-GCM envelopes use ZYSYR_VOUCHER_SETTINGS_KEY with company/store additional authenticated data; never rotate or overwrite an existing encryption secret blindly. No raw/cipher credentials appear in settings responses, audit summaries, browser storage or logs. Leaving the key blank retains the same provider's credential; changing provider requires its own key. Newly queued expense images retain a server-only settings snapshot; later configuration edits apply to later attempts. A stale settings preflight cannot enqueue a new job. Other recognition workloads and server credentials remain separate.

Acceptance distinguishes request completion, field accuracy and matching accuracy. Known date, amount, category, duplicate and source cases must have zero incorrect automatic associations; missing years, conflicting date roles and combined bills without allocation evidence remain explicit exceptions. No automatic financial import, voucher approval or posting is authorized.


## Evidence validation corrections (v660)

Printed date candidates are selected by their quoted labels: explicit payment, invoice/receipt, order, then completion. A creation or completion timestamp is not a debit timestamp. Missing years, shipping dates and conflicting equally preferred dates cannot become an automatic expense date. Raw model responses stay immutable.

Drinking-water delivery remains distinct from utility water; merchant names alone cannot establish a specific property or beauty-product category. Bank fee summaries retain their explicit month without a fabricated payment day. Contradictory store splits, direction-unverified chat receipts and product matches without quoted item evidence stay for review. These guards apply to new candidate processing and do not rewrite historical/manual results, import details or accounting records.

## Electronic monthly choices (v677 candidate, not published)

The voucher selector independently reads the current scoped electronic monthly report, even when no archived monthly original has been designated. `monthly_cell` choices identify the immutable report and cell; they are grouped separately from `monthly_source` and petty transactions. Already-mapped source targets retain their identities without duplicate display. Current formula amounts and editable names reuse the monthly page's projection.

The new `monthly_voucher_library` context `expense_workspace` only supports explicit whole-original `attach` and selected-original `list` readback. It validates the current company/store/month/report, visible expense target and known amount. Left-side salary/purchase/petty summary cells may receive manual evidence here without changing their normal classification or audit policy. Blank amounts remain visible but disabled, including legacy blank-zero slots. Original-level evidence never confirms every payment in a multi-transaction image, enters automatic/combination matching, or uses the old match-void action.

No schema migration, source designation, amount change, approval or posting is performed. Existing evidence links are copied by the established audited RPC. Unknown responses trigger readback, not an automatic write replay. Publication requires compatible operations-api and static-page releases after approval; synthetic browser/DB tests do not constitute production acceptance.
