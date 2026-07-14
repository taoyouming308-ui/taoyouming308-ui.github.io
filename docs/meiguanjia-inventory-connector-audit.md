# 美管加库存连接器技术审计与 MVP 方案

审计日期：2026-07-14。证据来自仓库中的当前生产执行器及本机 Hermes 运行脚本/笔记；本次未调用任何美管加库存写接口。

## 结论

Hermes 确实使用美管加网页内部 API，而不是官方开放 API。认证依赖本机登录会话 Cookie，并从 Cookie 中提取 `token` 请求头。登录凭据仅允许保存在权限 600 的 `~/.hermes/meiguanjia-auth.json`，会话保存在 `~/.hermes/meiguanjia-config.json`，前端和仓库不得保存这些内容。

当前能力不能笼统描述为“库存 API 已全部打通”：

| 能力 | 接口/实现 | 当前证据 | 状态 |
|---|---|---|---|
| 登录校验 | `metedata!reservationMetadata.action` | 当前 keepalive 使用，要求 `code=0` | 已验证 |
| Token 刷新 | `loginAction!ajaxLogin.action?v=mgj` | 会话失效才重登，原子替换 Cookie | 已验证 |
| 商品/库存查询 | `stockApi!getAllDepotList.action` | 2026-06-20 曾成功；2026-06-26 记录 `code=1000000` | 陈旧/需只读复验 |
| 商品新增 | `storageInfoManage!save.action` | Hermes 旧脚本和笔记有记录，后续 WAF 状态冲突 | 默认禁用 |
| 入库单查询 | `stockApi!getIntoDepotList.action` | 旧脚本存在；2026-06-26 状态异常 | 陈旧/需只读复验 |
| 入库创建/审核 | `saveIntoDepot` / `auditIntoDepot` | 2026-06-20 旧记录；后续状态异常 | 默认禁用 |
| 出库查询 | `stockApi!getOutDepotList.action` | 当前生产执行器使用 | 已验证 |
| 出库创建/审核 | `saveOutDepot` / `auditOutDepot` | 2026-07-01 真实 1 克出库并回查成功 | 仅现有护理协议启用 |
| 库存流水 | `stockApi!getDepotInoutBills.action` | Hermes 发现记录，未见当前生产验证 | 未验证 |
| 盘点 | 没有独立已验证接口；应转换为经审批的盘盈/盘亏单 | 无当前可靠写入证据 | 默认禁用 |

## 已确认的接口契约

统一请求为 `POST https://{server}/shair/{action}`，表单字段为：

- `jsonObj`: JSON 字符串；
- `shopid`: 当前目标门店 ID；
- `_t`: 防缓存时间戳。

请求携带当前 Cookie、`X-Requested-With: XMLHttpRequest`、同源 `Origin/Referer`；Cookie 中存在 `token` 时同时发送 `Token` 请求头。成功响应为 JSON 对象，现有代码兼容 `code=0` 或 `success=true`。

唯一标识：门店使用 `shopId`，上级门店使用 `parentShopId`，商品使用 `depotid`，员工使用 `employeeid`，单据使用 `id`/`billno`。App 产品必须显式映射到 `depotid`，禁止用产品名称模糊命中后直接写库存。

已验证出库载荷关键字段为顶层 `shopId` 和 `outdepot.details`。每条明细含 `depotid`、`num`、`price`。`outwaretype=8`，发型师写入 `employeeid`，当前登录操作人写入 `operatid`。只有创建、审核、再查询后确认 `status=1` 且员工、商品和数量全部一致，任务才算完成。

## 失败与重试规则

- 写请求出现超时、断线、非 JSON、403、WAF 页面或审核结果不明确：进入 `needs_review`，禁止盲目重试。
- 明确的校验失败或业务 `code != 0` 且确认未创建单据：可按退避策略重试。
- 每个写任务必须有调用方生成的幂等键；写前、写后都按备注中的幂等标记回查单据。
- 同一幂等标记出现多张单据、回查字段不一致、门店或员工不一致：进入异常清单。
- 盘点不直接覆盖余额；系统计算差额后生成盘盈/盘亏提案，必须经权限校验和人工批准，再转换成确定性库存单据。

## MVP 边界

新增的 `scripts/meiguanjia_inventory_connector.py` 是服务端中间层内核：

1. 只从本机配置读取会话，不接受前端传入 Cookie/Token；
2. 提供商品、入库单、出库单和流水的只读调用契约；
3. 对所有写命令执行角色、门店、商品 ID、数量、幂等键和显式批准校验；
4. 默认 `writes_enabled=false`，没有逐能力开关时绝不发出写请求；
5. 使用 SQLite 本地审计日志记录请求摘要、状态、外部单据和异常，不记录凭据；
6. 网络结果不明确时不自动重放写操作；
7. DeepSeek 仅能输出字段映射/异常解释提案，返回值永远是 `advisory_only=true`，不能进入执行函数。

下一阶段在只读复验成功后，按“商品读取 → 流水读取 → 入库创建/审核 → 盘点差额单”的顺序逐项开启，不一次性开放全部写能力。
