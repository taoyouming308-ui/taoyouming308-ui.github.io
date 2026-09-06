# Salon 未知结果核对：只读接口第一批

状态：独立分支、本机合成数据验证；尚未部署，尚未提供刷新恢复页面或持久化待核对清单。

## 支持范围

员工 API 新增 `request_lookup`，输入 `storeId`、原 `requestKey`、`targetOperation`。仅支持 `customer_create`、`order_create`、`order_lines`，不支持顾客端、收银、退款、充值或批量搜索。

身份由现有 API 验证并解析实际员工/组织/所选门店；忽略客户端伪造身份参数。数据库要求当前门店相应资源的 read 和 write 权限，并精确匹配原员工、原组织、原店、原请求号和操作类型。曾经有权限不等于现在有权限。

使用现有请求表的 `(organization_id, request_key)` 唯一索引查询，不新建表、不增加浏览器表权限、不认领请求、不重放写操作、不修改业务数据。RPC 为 STABLE / SECURITY INVOKER，空 search_path，仅 service_role 可执行；API 仍可按原规则记录不含业务正文的访问元数据。

## 返回语义

| status | 含义 | 安全处理 |
| --- | --- | --- |
| committed | 找到有操作者证明、已完成且有有效资源编号的历史请求回执 | 不再重新执行；按编号通过当前业务查询核对现状 |
| unconfirmed | 未找到可向当前操作者确认的回执 | 继续保留待核对状态，不能据此新建或重发 |

`committed` 仅额外返回 `resourceType`（customer/order）、`resourceId`（十进制字符串）、`completedAt` 和原操作类型。**这不是当前订单状态、金额或支付成功凭证**；订单之后可能被修改或撤销，应另查业务页面。

`unconfirmed` 不区分不存在、事务未提交、回滚、缺少身份信息的旧回执、其他人/其他店/其他操作的请求。没有记录也可能是请求尚未到达服务器，不能证明旧请求将来不会提交。接口不返回 failed、自动补单建议或可安全重新提交标记。

只输出白名单字段，不返回 response_json 全文、请求指纹、顾客姓名/电话、订单明细/备注、金额或余额。原请求号与 HTTP 追踪 requestId 是不同标识，不能混用。

## 验证与边界

- `node scripts/test-salon-api.mjs`：操作/请求号严格白名单、伪造身份不生效、无效请求不调用数据库。
- `node scripts/test-salon-request-lookup.cjs`：临时 PG + 真实本机 HTTP + 统一客户端；丢失写入响应后新合成会话查询，三类最小回执，读写权限分别撤销、停职、跨人/店/组织、旧回执、提交中与回滚、read-only 事务及查询前后业务快照不变。
- RPC 使用 p_lookup_key 表达“查询已有请求”；不属于新增带幂等键写入，现有 41 个员工写入入口的指纹覆盖要求不变。
- 已尝试本地 Supabase Advisor，但默认本地 Supabase 数据库不可连接；未改连生产。临时 PG 的权限和只读测试不等于完整 Advisor 验收。

下一步：设计仅含身份范围、操作类型与原请求号的待核对清单；加入刷新/重新登录后的人工查询页面与存储损坏保护。不保存业务正文、令牌、顾客隐私或资金。未完成这些页面前，不宣称“刷新后业务恢复”完成。

实施依据：[Supabase 函数权限与 invoker](https://supabase.com/docs/guides/database/functions)。
