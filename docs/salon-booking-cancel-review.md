# 预约取消复核 · 独立开发验收

本批完成的是“顾客已申请取消、正式预约仍为 confirmed、尚无关联订单”的门店复核。只在本机合成数据验证；不连接生产、不自动退款、不发送外部消息。

## 操作契约

- 员工接口：`booking_cancel_review`。
- 输入：`bookingRequestId`、`decision`（`approved` / `rejected`）、必填 `reason`、原操作 `requestKey`，以及已验证的所选门店。
- 身份：操作者和组织只由服务端会话解析；必须同时具有该店 `customer_portal/manage` 与 `scheduling/write`。
- 批准：申请 `cancel_requested → cancelled`；正式预约 `confirmed → cancelled`；占用块 `active → cancelled`，同事务提交。
- 拒绝：申请恢复 `confirmed`；正式预约和占用不变。
- 申请、预约、档期必须在相同组织/门店且归属一致。已到店、已结束、关联任何订单或档期异常的申请均拒绝自动处理，保留原状态等待人工流程。
- 输出：申请 ID、预约 ID、最终状态和处理决定。现有顾客本人查询可读取最终状态、处理原因和时间；顾客端页面展示及主动通知不在本批完成范围内。
- 审计：追加 `cancel_review`，保存原申请原因、前后状态、决定、操作者及复核原因，不删历史申请或订单。

## 并发与重试

复核先锁请求号，再锁申请、预约和档期。带预约开单也先锁请求号、再锁预约，并只接受 confirmed/arrived 的预约。
取消先完成则拒绝后来的新开单；开单先完成则取消复核发现关联订单并整笔回滚。失败不能留下部分释放的档期或完成的请求号。
同键同参数重试返回同一结果；改决定、改原因、换操作者或撤权后的重放不能使用旧成功结果。
本规则不等于禁止所有渠道的预约状态变更：通用预约状态接口、改期、已到店/订单关联情况下的人工处理及跨会话恢复仍需单独补齐。

## 页面与验证

本机 `salon-api-workbench.html` 新增“预约取消复核”，只列当前店待复核申请，要求填写原因。使用统一会话、门店和请求重试机制；切店/退出清空选择及原因。
空白工作台不会自动创建预约。`scripts/test-salon-booking-cancel.cjs` 在专属临时数据库建立合成顾客、项目、预约和取消申请，再操作页面验证。

运行：`NODE_PATH=/Users/a1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules node scripts/test-salon-booking-cancel.cjs`。

已验证：桌面批准、手机拒绝、数据库档期状态、顾客本人读取处理结果、同键双请求仅一条审计、改决定拒绝、四轮开单/取消竞争、已到店/已开单拦截、跨店与撤权后重放、anon/authenticated 无执行权、函数非 SECURITY DEFINER。测试结束清理专属容器。
原有 PostgreSQL 请求回归、Salon 全部 `.js/.mjs` 以及原本机工作台 1280/390 联调继续通过。
本机检查使用实际 PostgreSQL 权限断言，不是线上 Supabase Advisor 或已部署 Edge 验收。

迁移：`20260906105531_salon_booking_cancel_review.sql`，只新增精确操作白名单项、预约关联查询索引、取消复核函数及带预约开单的并发保护。没有变更资金计算。

## 未完成

改期申请/复核和原子换档、通知送达、顾客页面接入、已到店/已关联订单例外流程、正式 Auth/Edge 与整体发布验收仍待开发。G06 未全部完成；三个旧 App、main、线上环境保持不变。
