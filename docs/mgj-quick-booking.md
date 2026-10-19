# 美管加快捷预约：只读接入与隔离验证

核查日期：2026-10-19。基线：`3b665d599293eb092b834cad2314572bb528ae8f`（App v635）。

**当前交付是只读诊断、离线预检和经过隔离测试的预约编排核心。真实新增预约接口尚未找到/验证，没有上线 ChatGPT 直接预约。**

## 已确认的接口与缺口

| 能力 | 证据 | 当前结论 |
| --- | --- | --- |
| 会话验证 | `scripts/sync_mgj_bookings.py` 的 `check_session` | `GET /shair/metedata!reservationMetadata.action`，业务成功码 0 |
| 店日预约读取 | 同文件 `fetch_reservation_pair` | `POST /shair/reservation!list.action`，form 中 `jsonObj` + `shopid`；json 包含 parentShopId/shopId/reservationTime/period |
| 顾客搜索 | `scripts/sync_mgj_customer_profiles.py` 的 `search_customer` | `POST /shair/consumerHelp!find.action`，searchType=1/keyType=1/keyword/isYY=1/shopId；返回 HTML 中 checkAllow 候选。候选数不等于唯一身份认证 |
| 门店映射 | `sync_mgj_bookings.py:SHOPS` | 运行时直接复用，不复制另一套门店配置 |
| App 预约同步 | 既有 signed_pair_request 和 `mgj-booking-sync` | 将源预约同步到 App；不是美管加创建预约接口 |
| 美管加新增预约 | 当前 main 相关代码、交接记录与既往聊天 | 未见已验证请求路径、载荷、成功码、预约 ID、回读证据 |
| Hermes 执行环境 | 本次文件存在性诊断和浏览器检查 | 当前执行环境无 `~/.hermes/meiguanjia-config.json`，无 Mac Hermes 文件系统；云浏览器显示登录页 |

用户已反馈次日指定老师的剪染预约由 Hermes 完成；本次不能回读核实，不允许据此发起第二笔预约。公开代码与测试不保存该顾客的真实电话、Cookie、密码或原始业务响应。

## 文件与使用方式

- `scripts/mgj_booking_quick.py`：`doctor`、`inspect`、`plan` 三个命令，无 `create`、无写入开关。
- `scripts/mgj_booking_core.py`：精确身份匹配、重复/冲突预检、绑定具体计划的确认、持久化尝试日志、单次写入与回读编排。`execute()` 目前只由合成测试适配器调用。
- `scripts/test_mgj_booking_quick.py`：隔离测试。电话、老师、项目、预约 ID 全为合成数据。

先在**已经授权且有既有会话的 Hermes Mac**，从审核后的仓库检出目录运行：

```sh
python3 scripts/mgj_booking_quick.py doctor
python3 scripts/mgj_booking_quick.py inspect --shop 自由手艺人 --date 2026-10-20 --phone-stdin
```

第二个命令从标准输入读取一行完整手机号；应由本机既有安全输入渠道提供，不放入 GitHub/聊天或终端命令历史。输出只显示匹配预约的 ID、原始状态、老师、项目、原始预约时间，以及列表字段名/计数；不输出 Cookie、顾客姓名、电话或其他顾客的预约。

`inspect` 最多三次请求，每次 10 秒，无自动重试。严格使用 HTTPS 证书验证且禁止重定向。仅接受既有 vip 数字美管加主机与私有 0600 会话配置；只读取 Cookie，不调用 `ensure_session()`、不读取密码文件、不重登、不修改会话或同步队列。不导入客户同步的禁用 TLS 校验或 curl 回退。

原始状态、项目/人员元数据、结束时间及列表完整性尚未验证，因此 `inspect` 的结果**不能自动转成可写快照，也不能把“列表无匹配”解释成允许创建**。缺失列表、失败、超时或登录页均停止，不当作空结果。

离线预检：

```sh
python3 scripts/mgj_booking_quick.py plan --request /private/request.json --snapshot /private/snapshot.json
python3 -m unittest scripts/test_mgj_booking_quick.py -v
```

请求 schema（下例为合成示意，不是真实预约）：

```json
{
  "shop_id": "1009951",
  "customer_phone": "13800000000",
  "barber": "合成老师",
  "services": ["合成剪发", "合成染发"],
  "start": "2026-10-20T18:00:00+08:00",
  "duration_minutes": 120
}
```

项目时长必须来自已核实的门店规则或该笔明确指令；此处 120 分钟只是测试值。不能将“18:00”理解为任意时长、不自动换老师、跨店、创建新顾客或用电话尾号匹配。

## 真实适配器的最小契约（仍待实现）

`snapshot(request)` 须返回刚从源系统取得的规范化结构：

| 字段 | 要求 |
| --- | --- |
| shop_id / fetched_at | 精确门店 ID；有时区的读取时间，60秒内有效 |
| complete | 仅在状态/分页已核实、全量覆盖检查时段后设 true，错误或缺字段不能默认 true |
| window_start / window_end | 覆盖完整服务区间，且列表包含所有与区间相交的预约，包括前一天开始、次日结束的记录 |
| customers | id/shop_id/phone/active；精确完整电话；同电话多候选时停止 |
| barbers / services | id/shop_id/name/active；明确指定并唯一匹配，停用项不选 |
| bookings | id/shop_id/customer_id/customer_phone/barber_id/service_ids/start/end/state |
| state | 仅根据证据映射 active/cancelled；未知数字状态不能当成取消。completed/no-show 等语义核实前停下 |

`create_once(identity)` 须使用**真实成功请求观察到的接口及字段**，恰好请求一次，不使用现有同步脚本的网络重试装饰器。响应返回稳定 `booking_id`。必须从正常既有权限获得写入能力；不能使用只读历史/护理账户、公开 App key 或财务接口替代。

核心 `execute(request, plan, confirmation, gateway, journal, clock)` 的顺序：

1. 验证确认绑定具体人、店、老师、项目、时段，且未过期。
2. 独占本机预约锁，重新读取完整快照。身份变化/新增冲突则停止。
3. 完全相同预约已存在则返回其 ID；同顾客同开始时间内容不一致、重复多单或未知状态须核查。
4. 写前将 pending 意图 fsync 到独立 0700 目录的 0600 日志。日志不存明文手机号。
5. 仅调用一次创建。无论响应成功或超时，重新只读核验店、顾客、老师、项目、起止时间和响应 ID。
6. 回读全部一致才返回 confirmed_readback；否则 unknown，禁止自动重发。已记录但后来取消/消失的预约也不会被重建。

锁仅保护使用同一日志目录的本机脚本；**不能对其他电脑、浏览器或 Hermes 原有独立写入实现跨客户端原子排他**。真实接口的幂等键/冲突保护是否可用仍需核查；若没有，需要明确执行协调或独立复核，不能承诺绝对防重。不要删除日志来重试未知结果，也不要把 `confirmation` 摘要当作远程鉴权令牌。

## 下一步接入：复用 Hermes，保留现有同步

1. 在本机定位 Hermes **已成功使用**的预约脚本/技能及执行记录，只筛查相关路径；不要导出密码、Cookie、全量日志或客户资料。先回读已完成预约的稳定 ID 和内容，不能重新创建来“抓包”。
2. 从该次已有记录或已登录页面的开发工具核实新增 URL、方法、Content-Type、必填参数、顾客/老师/项目 ID、时区、状态/时长、成功和失败响应、权限与分页边界。提交仓库的样例必须脱敏。
3. 实现独立窄接口适配器，并对观察到的参数增加契约测试；只读检查先通过。不能靠填写任意 URL 或把布尔开关改成 true 启用写入。
4. 使用用户后续明确要求的**新预约**验收真实写入和回读；不制造假客户/占用生产时段来测试。当前已完成预约仅供核对。
5. 若 ChatGPT 仍无本机执行连接，先使用既有授权连接；需要新权限/凭证或公开服务时，另行准备具体方案审核。不要直接暴露通用 shell、Cookie 或密码。
6. 成功后继续由原 `sync_mgj_bookings.py` 和原计划任务同步到 App；不新增第二个调度、不直接写云端镜像、不重置 cadence、不改客户档案/财务/出库。App 镜像可能晚于源预约，以源回读结果为预约成功凭据。

本次没有修改原同步代码、定时任务、客户资料、财务或真实预约。未部署到 Hermes；无需升级 App 页面版本。
