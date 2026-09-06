# 顾客改期申请与门店复核：后端批次

2026-09-06；独立开发分支；生产版本 v476 不变。

## 业务流程

顾客读取本人已确认预约 → 提交原时间、版本、新时间和原因 → 申请待处理（原档期不变） → 门店批准或拒绝。

- 批准：重新验证顾客绑定、门店权限、预约版本和新档期；原子更新预约及占用，申请变为 approved。
- 拒绝：仅记录理由与 rejected 状态，原预约不变。
- 冲突、版本变化、到店、关联订单、申请取消：批准失败，申请仍待处理，原预约保持当前值；门店可拒绝申请。
- 一条预约最多一个待处理改期申请；新档期在批准前不预占。保留同手艺人和原时长，不自动退款、扣款或发消息。
- 已批准或拒绝的申请不可修改；同请求号同参数重试返回原结果。不同决定须使用新请求号，但已处理申请仍拒绝再次处理。

## 接口

| 使用方 | operation | 必填业务字段 | 输出 |
|---|---|---|---|
| 顾客 | reschedule_request | organizationId、storeId、bookingRequestId、requestKey、expectedStartsAt、expectedEndsAt、expectedVersion、newStartsAt、reason | changeRequestId、bookingRequestId、submitted |
| 顾客 | reschedule_requests | organizationId、storeId；可选 limit | 本人申请与处理结果 |
| 员工 | reschedule_review | storeId、changeRequestId、requestKey、decision（approved/rejected）、reason | changeRequestId、status、成功改期结果或 null |
| 员工 | reschedule_requests | storeId；可选 status、limit | 本店申请列表 |

时间必须带时区；版本必须是非负整数。顾客身份由已验证登录令牌取得，员工身份及组织由服务端解析，禁止以客户端传入身份替代。列表上限 200，不返回账号 UUID；表启用强制 RLS，浏览器角色无直接读取/写入权限。批准和拒绝需要 scheduling/write、customer_portal/manage。

## 本地证据与复现

新增迁移：`supabase/migrations/20260906113627_salon_customer_reschedule_requests.sql`。

```sh
node scripts/test-salon-api.mjs
node scripts/test-salon-customer-api.mjs
node scripts/test-salon-customer-reschedule-contract.mjs
node scripts/test-salon-replay-coverage.mjs
node scripts/test-salon-customer-reschedule.cjs
```

最后一项需要 Docker，自动创建并清除专用临时 PostgreSQL；只用合成数据。覆盖申请不占档、同键并发、重复申请、批准/拒绝竞争、冲突回滚、旧版本、跨顾客/门店查询、账号重绑/停用、撤权重放和服务端权限。契约测试保证旧顾客请求守卫仅扩展操作白名单、所有新增请求参数参与指纹。

## 尚未完成

本批只完成数据库事务与 API 处理器，不代表新流程页面可用。仍需顾客独立登录页面、门店复核控件、本机真实 HTTP/双身份浏览器闭环、丢包重试交互、正式门店时区、消息通知及业务例外。真实 Auth、测试项目部署、线上 Advisor 与生产验收均未执行。不得据此标记 G06 或全 App 完成，不合并三个旧 App。
