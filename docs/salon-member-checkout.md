# 会员储值收银 · 版本保护接口阶段

状态：独立开发分支；本批只补充版本保护数据库/API基础，使用一次性合成 PostgreSQL 验证。未连接真实账户、未部署迁移/Edge，工作台 UI 尚未接入，不能用于收款。

## 本批交付

- 新增 `salon_checkout_order_versioned`，先锁定当前门店订单并比较 `edit_version` 与 `awaiting_payment` 状态，再调用现有原子收银事务。原子事务继续同时处理支付行、储值/次数流水、商品库存、订单状态、审计和幂等请求。
- 保留旧 `salon_checkout_order` 供内部兼容；本机员工 API 的 `checkout` 路由改走带版本的函数，必须提交 `expectedVersion`。
- 成功响应增加实际支付明细；`salon_lookup_checkout_request` 仅按组织、门店、当前员工及原请求号核对，并逐项匹配持久化支付记录。刷新恢复只查原请求，不重放支付。
- 当前阶段覆盖储值卡和现金组合的底层事务基础。顾客/账户归属、卡状态、余额、账户类型、门店范围及到期规则仍由数据库在提交时重新验证。次卡/疗程 UI 尚未开放；其次数与项目权益分摊需后续接入既有卡项规则。

## 本地验证

- `node scripts/test-salon-api.mjs`
- `node scripts/test-salon-api-client.mjs`
- `node scripts/test-salon-recovery-journal.mjs`
- `node scripts/test-salon-member-checkout-sql.js`
- `NODE_PATH=/Users/a1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules node scripts/test-salon-member-checkout.cjs`

专项 PostgreSQL 测试覆盖旧版本拒绝、储值+现金、同键顺序/并发重试、原请求回读、跨店隔离、匿名执行拒绝及审计失败整体回滚。测试只使用专用临时容器与合成数据。

## 尚未完成

- 把账户选择、余额最小展示、储值金额/现金余款预览、人工确认、支付明细回读及刷新恢复接入收银工作台；并完成桌面/手机浏览器联测。
- 补真实 Auth/Edge/Advisor 门禁和正式线下业务验收。上线前不应用迁移、不部署、不合并主分支或旧三 App。
