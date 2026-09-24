# 会员储值与组合收银（离线开发阶段）

状态：已接入本机合成工作台并完成桌面/手机浏览器联测；仍只在独立开发分支。未连接真实账户、未应用远程迁移、未部署 Edge/Pages、未合并主分支，不可用于真实收款。

## 当前能力

- 在已载入的待收银订单中，按 `members.read` 权限读取该顾客、当前授权门店可用的储值账户；仅展示卡别名、遮罩卡号末四位与余额，不读取手机号或其他顾客账户。
- 手工指定储值扣款金额和现金实收金额，按分精度预览储值、现金余款与找零；预览前重新读取订单、账户、版本与余额，不产生业务写入。
- 员工明确确认后，以带订单版本与幂等请求号的 `checkout` 原子提交；服务端重新核对顾客、账户类型/状态、余额、有效期、门店范围与支付总额。会员余额、支付行、库存、订单状态、审计与请求回执处于同一事务。
- 成功后按原请求只读查询持久化支付行并回读订单。写入响应丢失时可刷新页面，以原请求号恢复历史收银回执；恢复只读，不重放扣款或收款。
- 不支持散客会员扣款；次卡/疗程 UI 与项目权益分摊尚未接入；微信/支付宝的组合支付凭证采集尚未开放。本页依旧是专用本机合成测试台。

## 本批接口与迁移

- `salon_checkout_order_versioned`：锁定订单，校验 `edit_version` 与待收银状态，再调用现有原子收银事务。
- `salon_lookup_checkout_request`：按当前组织、门店、员工与原请求号验证持久化支付行；回执包含数据库 `completedAt`，供页面做提交完成校验。
- `packages/salon-core/member-checkout.mjs`：规范化会员 RPC 返回字段、验证账户范围、构建分支付预览并验证直返/历史回执。
- `20260924062036_salon_member_checkout_versioned.sql`、`20260924070500_salon_checkout_lookup_completed_at.sql`：版本门禁及历史核对时间戳迁移。

## 验证

- `node scripts/test-salon-member-checkout-model.mjs`
- `node scripts/test-salon-member-checkout-sql.js`
- `NODE_PATH=/Users/a1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules node scripts/test-salon-member-checkout.cjs`
- `NODE_PATH=/Users/a1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules node scripts/test-salon-member-checkout-browser.cjs`
- 相关 API、API 客户端、恢复日志与现金收银回归另行通过后方可记录。

端到端测试使用临时 PostgreSQL 容器、合成身份/顾客/账户/订单与库存；覆盖账户遮罩、储值+现金拆分、直返支付记录、响应丢失后刷新恢复、请求幂等及不重复扣款，桌面 1280px 与手机 390px 布局均通过。测试结束自动删除容器。

## 仍需完成

- 接入正式 Auth/员工会话、生产 Edge、最小权限与 Advisor 验收；远程部署迁移必须另行审批并在上线阶段实施。
- 补次卡/疗程权益分摊、渠道组合支付、退款/撤销后的会员余额与支付追踪，以及完整门店/员工权限矩阵线下验收。
- 完成整个 App 的模块覆盖、跨模块业务链及离线验收；此单模块通过不代表项目完成。合并三个既有 App 或上线前，需完成线下验收并获得用户明确授权。
