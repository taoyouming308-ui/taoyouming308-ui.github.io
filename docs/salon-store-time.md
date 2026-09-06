# 预约时间转换与门店配置读取

2026-09-06；独立开发，不发布。实现位置：`packages/salon-core/store-time.mjs`。

## 输入与输出

- `instantToStoreInput(instant, timeZone)`：带明确偏移的接口时间 → 门店年月日时分；只用于日期控件，不能替代原始乐观锁时间。
- `formatStoreInstant(instant, timeZone)`：显示日期、时区 ID 与实际 UTC 偏移，区分夏令时重复出现的时间。
- `resolveStoreTime(localTime, timeZone)`：返回 unique/nonexistent/ambiguous 及对应 UTC 时间候选。不根据设备时区推断。
- `storeTimeToInstant(localTime, timeZone)`：仅唯一匹配可转换；不存在/重复时间抛明确错误，不自动前移或选择其中一次。

门店输入必须为 `YYYY-MM-DDTHH:mm`，范围为 2000—2100 年，分钟精度。严格拒绝无效日期、24:00、缺失时区及当前运行环境不支持的时区；不得回退设备时区。不用于历史账务转换。接口原时间可含秒/小数秒，原值仍单独传给版本校验，日期控件按分钟显示。

实现遍历 ±24 小时的全部分钟候选并在指定时区回验，不假定夏令时一定调整一小时。依赖运行环境 Intl 的时区数据；未内置/锁定 IANA 数据库版本。未来法律变更、不同浏览器时区数据库版本差异需要服务端再次核验，不能只信任前端。

## 接入状态

两端工作台已使用鉴权后的 `store_time` 操作读取现有门店 timezone，验证返回的组织/门店与当前上下文一致，然后显示与输入门店时间。只读返回 organizationId/storeId/timeZone；员工需要 customer_portal/manage，顾客需要有效组织、门店与本人绑定；浏览器角色无直接 RPC 执行权限。

迁移 `20260906115825_salon_store_time_context.sql` 仅新增两个只读函数，不更新任何门店配置。切店、退出清理时区；读取失败不得默认 UTC/设备时区，改期控件禁用但保留刷新入口。时间列表显示时区 ID 和实际偏移。夏令时重复/不存在时间拒绝提交，不静默选取。

首次提交前重新读取配置，变化时要求用户刷新重填；结果未知时仍按冻结的原 UTC 请求重试，不能重新换算产生另一笔请求。

## 事务内配置保护（2026-09-06）

迁移 `20260906120718_salon_time_context_transactions.sql` 增加 timezone_version（起始 0）；时区变化由数据库触发器递增版本，改走再改回也不能复用旧版本，直接修改版本字段不会重置计数。store_time 现在同时返回 timeVersion。

三个对外操作 booking_reschedule、reschedule_request、reschedule_review 必须传 expectedTimeZone/expectedTimeVersion。API 分别调用 `salon_reschedule_booking_with_time`、`salon_customer_reschedule_with_time`、`salon_review_reschedule_with_time`；缺少版本的旧页面拒绝提交并提示刷新，不静默回退。

包装函数先校验角色/本人身份，持有门店行 SHARE 锁直至事务结束，再声明请求上下文、核对时区及版本并调用原业务函数。并发配置更新必须等待；配置先完成时新请求拒绝。任一业务失败使上下文记录、预约和业务审计一起回滚，不留下假成功。

上下文表保存组织/门店/请求键、全部参数的 SHA-256、原时区/版本及完成标记，不保存请求正文。成功重试必须匹配原身份及全部参数，随后再次进入原函数的授权与重放检查；即使配置后来变化也返回原业务结果，不再改期。缺少上下文的旧成功请求不可自动认领。

适用范围仅为上述三个 API 入口；原 service_role-only 内部业务函数保留用于复用与兼容测试，不得当作新页面的直接调用入口。本批不开放时区编辑 UI，不改变报表日期口径。前后端 IANA 数据库版本一致性与本地时间换算的服务端复核仍待完善；本机通过不代表生产部署。

仅本机合成链路已接通，真实 Auth/Edge、生产配置与线上 Advisor 未验收。

`test-salon-time-transactions.cjs`：真实 PG 并发验证配置先提交/业务先持锁、ABA 版本、配置变化后成功重放、同键并发、参数变更拒绝、冲突回滚和撤权重试。`test-salon-time-transaction-contract.mjs` 检查三个包装函数的完整参数指纹、锁顺序和错误传播。双端浏览器测试额外在预检与写请求之间修改配置，证明数据库实际拒绝旧版本。

## 验证

`node scripts/test-salon-store-time.mjs`：跨日、闰年、无效日期、UTC+14/UTC-12、尼泊尔45分钟偏移、纽约夏令时缺口/重复、Lord Howe 半小时调整、Apia 跳日、秒级显示，以及三种设备 TZ 下输出相同。

`test-salon-customer-workbench.cjs`：顾客设备洛杉矶、员工设备东京，以合成上海门店时间改期；1280/390 经 HTTP/PG 回读验证，切换纽约门店、配置中途变化、无效配置禁用、2030 夏令时重复时间拦截、员工跨店/顾客跨组织与角色执行权限。原工作台/员工改期/取消回归仍需保持通过。全部使用合成数据，不验证生产门店配置。
