# 美管加快捷预约：只读接入与隔离验证

核查日期：2026-10-19。基线：`3b665d599293eb092b834cad2314572bb528ae8f`（App v635）。

**当前交付是只读诊断、离线预检和经过隔离测试的预约编排核心。用户已转交 Hermes 本机成功写入接口及只读回查报告；仓库尚无真实写入适配器，ChatGPT 尚未连接本机。**

## 已确认的接口与缺口

| 能力 | 证据 | 当前结论 |
| --- | --- | --- |
| 会话验证 | `scripts/sync_mgj_bookings.py` 的 `check_session` | `GET /shair/metedata!reservationMetadata.action`，业务成功码 0 |
| 店日预约读取 | 同文件 `fetch_reservation_pair` | `POST /shair/reservation!list.action`，form 中 `jsonObj` + `shopid`；json 包含 parentShopId/shopId/reservationTime/period |
| 顾客搜索 | `scripts/sync_mgj_customer_profiles.py` 的 `search_customer` | `POST /shair/consumerHelp!find.action`，searchType=1/keyType=1/keyword/isYY=1/shopId；返回 HTML 中 checkAllow 候选。候选数不等于唯一身份认证 |
| 门店映射 | `sync_mgj_bookings.py:SHOPS` | 运行时直接复用，不复制另一套门店配置 |
| App 预约同步 | 既有 signed_pair_request 和 `mgj-booking-sync` | 将源预约同步到 App；不是美管加创建预约接口 |
| 美管加新增预约 | 用户于 2026-10-19 转交的 Hermes 本机核查报告 | 本机 mgj_book.py 已使用 reservation!add.action 成功写入；完整脱敏实现、itemProp/返回体契约仍未交付此仓库 |
| Hermes 执行环境 | 本次文件存在性诊断和浏览器检查 | 当前执行环境无 `~/.hermes/meiguanjia-config.json`，无 Mac Hermes 文件系统；云浏览器显示登录页 |

Hermes 报告已用本分支 inspect 从源系统匹配到既有预约；本会话没有独立执行该回读。该单只有剪发服务项，染发在备注中。保持现状，不重复创建、不自行取消，也不能仅凭报告断言修改必须删单重建。公开代码与测试不保存真实预约 ID、顾客电话、Cookie、密码或原始业务响应。

## 本机新增接口证据（Hermes 报告，待完整契约复核）

- `POST /shair/reservation!add.action`，沿用本机会话对应的 HTTPS vip 主机；`application/x-www-form-urlencoded`，表单为 `jsonObj` JSON 字符串与 `shopid`。
- 报告中的 JSON 字段为 `parentShopId/shopId/custId/custName/memmobile/reservationTime/itemProp/barberId/barberName/number/comment/channel/reservationType/type`；人数 1，后三项 0，custId 不得为 0。毫秒时间戳代表绝对时刻，用户输入先按明确的 UTC+8 时区解释。
- `itemProp` 自身是 JSON 字符串，内含 `items` 映射；每项的 `id/name/itemid/classid/time/...` **尚不构成完整结构**，须取得实际脚本或完整脱敏样例。不能猜测 itemid/classid 的关联、time 的单位或多项目时长规则。
- 报告称业务码 0 成功，1012 为时间冲突，2003 为会员未找到；成功响应中预约 ID 所在字段仍需补齐。遇到已发出的请求超时、响应缺失或业务结果不明，回查而非重发。
- 源回读仍使用 `reservation!list.action` 的 `content.reservations`；报告中的 status 0 为正式预约。完整身份、项目组合和占用时段须一致，不能仅凭 code 0 或 status 0 宣称预约成功。
- Hermes 实时元数据中存在独立剪发/染发项目，而本机旧脚本仅配置剪发。新适配器应从实时元数据选择全部指定项目；备注不替代服务项。真实人员/项目 ID 留在本机，不作为跨店硬编码默认值。

还需 Hermes 提供：剔除凭据与客户资料的 `mgj_book.py` 相关函数、完整 `itemProp` 与元数据对应样例、创建成功响应的字段结构、列表分页/状态/跨日时长规则，以及本机并发写入的协调方式。使用既有成功记录取证，不新增生产测试预约。

## 文件与使用方式

- `scripts/mgj_booking_quick.py`：`doctor`、`inspect`、`plan` 三个命令，无 `create`、无写入开关。
- `scripts/mgj_booking_core.py`：精确身份匹配、重复/冲突预检、绑定具体计划的确认、持久化尝试日志、单次写入与回读编排。`execute()` 目前只由合成测试适配器调用。
- `scripts/test_mgj_booking_quick.py`：隔离测试。电话、老师、项目、预约 ID 全为合成数据。

先在**已经授权且有既有会话的 Hermes Mac**，从审核后的仓库检出目录运行：

```sh
python3 scripts/mgj_booking_quick.py doctor
python3 scripts/mgj_booking_quick.py inspect --shop 自由手艺人 --date 2026-10-20 --phone-stdin
```

已修复 Python 3.9 导入 `str | None` 产生的运行时错误，改用 `Optional[str]`。Hermes 已实际验证的解释器为 `/opt/homebrew/bin/python3.11`，本机仍优先复用该环境及原依赖；不替换系统 Python 或同步任务解释器。

修复后在独立 Linux Python 3.9.25 环境（既有 cryptography 48.0.0 依赖）运行全部 37 项隔离测试通过；Python 3.12 上连同原预约/保活/顾客测试共 79 项通过。没有在此会话中执行 Mac Python 3.9.6 或真实写入验证。

第二个命令从标准输入读取一行完整手机号；应由本机既有安全输入渠道提供，不放入 GitHub/聊天或终端命令历史。输出只显示匹配预约的 ID、原始状态、老师、项目、原始预约时间，以及列表字段名/计数；不输出 Cookie、顾客姓名、电话或其他顾客的预约。

`inspect` 最多三次请求，每次 10 秒，无自动重试。严格使用 HTTPS 证书验证且禁止重定向。仅接受既有 vip 数字美管加主机与私有 0600 会话配置；只读取 Cookie，不调用 `ensure_session()`、不读取密码文件、不重登、不修改会话或同步队列。不导入客户同步的禁用 TLS 校验或 curl 回退。

Hermes 报告补充了 status 0、人员与项目存在性的证据；完整状态映射、结束时间及列表完整性仍未核验，因此 `inspect` 的结果**不能自动转成可写快照，也不能把“列表无匹配”解释成允许创建**。缺失列表、失败、超时或登录页均停止，不当作空结果。

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

## 建议的私有连接方案（尚未部署）

2026-10-19 查阅 OpenAI 官方文档：私有 MCP 可通过 Secure MCP Tunnel 接入 ChatGPT；tunnel-client 主动出站 HTTPS，可调用本机 stdio MCP，无需为预约服务开放公网入站端口。该能力不是现成 Hermes 连接，账户/工作区权限也仍需核实。

建议封装专用预约 MCP，提供只读健康检查、精确顾客查询、人员/项目选择、预约预检、确认执行与回读；只允许既有两店。写工具必须经过核心的计划绑定、重新核查、持久化防重和完整回读，不提供 shell、任意 URL、财务写入、顾客建档或预约取消工具。首先仅验证只读工具；真实写工具待契约完整且权限核验后再启用。

准备条件：Platform 隧道关联目标 ChatGPT 工作区；创建者具备 Tunnels Read + Manage，运行密钥及操作者具备 Read + Use；工作区允许自定义 MCP。运行凭据通过本机安全渠道配置，不能写进聊天、代码、命令参数或日志。传输鉴权不替代工具权限与每次具体预约授权。Mac 与 tunnel-client 必须在线。

在用户批准具体接入方案前，保持为待部署设计，不创建隧道/密钥、不扩大账户权限。由本机执行者准备脱敏源契约和 MCP 封装，再按现有权限接入；完成标准是 ChatGPT 实际调用只读工具成功，而非仅有 tunnel_id。

官方参考：
- https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- https://developers.openai.com/plugins/deploy/connect-chatgpt
