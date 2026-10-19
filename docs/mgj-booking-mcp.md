# 专用预约 MCP 接入说明（本机 stdio + OpenAI Secure MCP Tunnel）

状态：**Hermes 报告旧版本本机只读调用通过；代码复核发现阻断问题，已修为严格只读候选。新版本尚未部署到 Mac 或通过 ChatGPT 隧道验收。**
日期：2026-10-19。

本文件给出接入所需的启动命令、工具清单、鉴权与撤销方式。
不含任何 Cookie、Token、密码、手机号或客户资料。

代码复核修正：真实预检计划遗漏手机号；缺失状态被默认成 0；自由备注可能泄漏手机号；内存防重无法跨重启；同开始时间检查不覆盖服务时段。前三项已修复。后两项仍需完整源契约并接入现有持久化编排，因此本版移除可被环境变量开启的确认路径。查询、项目选择和回查仍可使用，但不能宣告创建完成。

---

## 1. 需要谁去授权什么

两套权限互相独立，都要办：

### Platform 侧（tunnel 本身）

| 角色 | 权限 | 给谁 |
| --- | --- | --- |
| 创建/编辑隧道 | Tunnels **Read + Manage** | Platform 组织 owner 或 RBAC 管理员授予你 |
| 运行 `tunnel-client` | Tunnels **Read + Use** | 同上；运行密钥也需要这个 |

权限是**组织级**，不是项目级。新角色分配最多 30 分钟生效。

### ChatGPT 侧（能不能用这个 MCP）

- 目标 ChatGPT 工作区必须**允许添加自定义 MCP 服务器**（工作区管理员设置）。
- 隧道必须**关联到该 ChatGPT 工作区**，只关联个人 Platform 组织不会出现在列表里。
- 个人账号测试时：同时关联「个人 Platform 组织」+「目标 ChatGPT 工作区」。

### 需要你提供给我（只留本机）

1. `tunnel_id`（Platform tunnel settings 里创建后得到）
2. 一条 **runtime API key**（给 tunnel-client 用）
3. 目标 ChatGPT 工作区确认已允许自定义 MCP

> 凭据通过本机安全输入或秘密存储注入，**不要贴在聊天、命令参数、shell 历史或日志里**。隧道配置只保留环境变量引用。运行密钥仅需 Read + Use，不因创建者需要 Manage 而复制管理权限。

---

## 2. Hermes 报告的本机旧版本（本次未远程核验）

| 组件 | 路径 | 状态 |
| --- | --- | --- |
| MCP 服务器（stdio） | `~/.hermes/mgj_mcp/mgj_booking_mcp.py` | 8 个工具就绪 |
| 窄接口网关 | `~/.hermes/mgj_mcp/mgj_gateway.py` | 只用标准库 |
| 隔离测试 | `~/.hermes/mgj_mcp/test_gateway.py` | 36 项全通过 |
| 只读验证 | `~/.hermes/mgj_mcp/verify_readonly.py` | 真实数据跑通 |
| Python | 3.11（独立 venv，含 `mcp>=2.0`） | 不动系统 Python |
| 会话/门店配置 | `~/.hermes/meiguanjia-config.json`（0600） | 复用，只读 |

**没有做**：不开公网端口、不建隧道、不改原同步脚本、不改 cron、不碰客户资料与财务、不碰任何已有预约。

应用本次修正须由本机执行者从审核后的仓库同步 `mcp/mgj_gateway.py` 与 `mcp/mgj_booking_mcp.py`，保留 venv 与凭据，重启 MCP 进程并重新只读验收。门店名单现在读取仓库 canonical 同步脚本，部署时读取既有 `~/.hermes/scripts/sync_mgj_bookings.py`；不维护独立门店副本，不复制或覆盖原同步运行文件。

---

## 3. 工具清单（8 个）

| 工具 | 性质 | 作用 |
| --- | --- | --- |
| `mgj_health` | 只读 | 实际调用元数据接口检查业务成功码；文件存在不能证明会话有效 |
| `mgj_shops` | 只读 | 列出两家门店 |
| `mgj_customer_lookup` | 只读 | 按完整 11 位手机号精确定位客户，返回脱敏姓名/手机号/客户 ID |
| `mgj_catalog` | 只读 | 某日老师 ID 清单 + 服务项目清单（含「是否入口项」标记） |
| `mgj_booking_find` | 只读 | 某天某手机号的预约（脱敏） |
| `mgj_booking_preflight` | 只读 | 部分预检，始终 blocked=true；plan_id 仅供 5 分钟内回查 |
| `mgj_booking_confirm` | **禁用** | 无条件拒绝，不发送写请求；环境变量不能放行 |
| `mgj_booking_readback` | 只读 | 返回部分身份是否匹配；完整契约未验证，verified 始终为 false |

**没有提供**：通用 shell、任意 URL 请求、顾客建档、取消预约、财务/库存写入、跨店操作。

### 写入闸门

`mgj_booking_confirm` 当前无条件拒绝。`MGJ_MCP_ALLOW_WRITE=1` 仅在健康输出中表示“请求写入”，不会变成有效权限。内存中的只读计划最多 128 条、5 分钟过期，不是防重日志，也不是用户鉴权。

后续必须核实服务时长、分页与跨日覆盖、顾客身份和在职老师目录，并接入 `scripts/mgj_booking_core.py` 的完整快照、绑定确认、持久化尝试日志、锁与写后回读。不能仅改布尔量或环境变量解除当前限制。网关里的 create_once 是隔离测试用的底层请求原型，未接入可用的生产写工具。

---

## 4. 服务项选择规则（对应「剪发、染发分别选择」）

服务项里有两类名字，`mgj_catalog` 会明确标出来：

- `reservable_entry: true` → 「预约剪发」「预约染发」这类占位入口项
- `reservable_entry: false` → 「剪发380」「基础染发560」这类真实服务项

新预约要剪发 + 染发分别选时，`services` 传**两个明确选定的项目名**。入口项不能自动替换成收费档位；下例只说明数组结构，不是默认选择或报价：

```json
{"services": ["剪发380", "基础染发560"]}
```

工具会在 `items` 里生成两个独立 item，各自完整的 16 字段结构。
只传一个入口项也能成功，但单子里就只有占位项目，具体内容只落在备注——这是 2026-10-20 那单的形态，保持不动。

---

## 5. 启动命令

### 5.1 安装 tunnel-client

从 Platform tunnel settings 页面下载，或用官方最新 release。不要硬编码某个版本的 URL。

### 5.2 初始化 profile

```sh
# 先通过本机安全输入注入 CONTROL_PLANE_API_KEY；不在命令中填写密钥。

tunnel-client init \
  --sample sample_mcp_stdio_local \
  --profile mgj-booking \
  --tunnel-id tunnel_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  --mcp-command "/Users/a1/.hermes/mgj_mcp/venv/bin/python /Users/a1/.hermes/mgj_mcp/mgj_booking_mcp.py"
```

### 5.3 自检

```sh
tunnel-client doctor --profile mgj-booking --explain
```

必须看到 stdio 命令可启动、宿主可达、密钥有效。

### 5.4 启动

```sh
tunnel-client run --profile mgj-booking
```

本机管理界面：使用 tunnel-client 实际输出的回环地址与端口，在 `/ui` 查看 healthy / ready / connected；不假定监听 80 端口。
健康探针：`/healthz`、`/readyz`、`/metrics`。

### 5.5 在 ChatGPT 侧接上

ChatGPT → Plugins → `+` → **Add custom MCP server** → Connection 选 **Tunnel** → 选中该隧道 → 配置鉴权 → 确认风险提示 → Create as a plugin。

### 5.6 后续写入验收（当前版本不可用）

先完成上文列出的适配与验证，再用用户明确要求的一笔新预约验证单次写入和完整回读。授权隧道只建立传输路径，不证明生产写入已经具备条件。现有预约保持原样。

---

## 6. 鉴权设计

| 层 | 机制 |
| --- | --- |
| 传输 | tunnel-client 用 runtime API key 出站 HTTPS 到 OpenAI，无需入站端口 |
| 会话 | 美管加 Cookie 只在本机 0600 文件，MCP 进程内读取，不出本机 |
| 工具 | 当前严格只读；未来须有独立用户权限与持久化写入编排 |
| 数据面 | 所有返回脱敏：手机号 `138****1234`，姓名 `张**`，不含 Cookie/Token |

隧道鉴权**不替代**工具用户权限或具体预约授权。只读 plan_id 不是鉴权令牌；共享工作区的访问范围须先核实，不能把整个工作区默认视为门店授权用户。

---

## 7. 撤销方式

按影响面从小到大：

1. **当前已禁写**；旧版本若设置过 `MGJ_MCP_ALLOW_WRITE`，须移除并重启相关 MCP/client 进程，修改父 shell 环境不会改变已运行的子进程。
2. **停用隧道**：`tunnel-client run` 进程停掉。ChatGPT 调用直接失败。
3. **删插件**：ChatGPT 里删除该 custom MCP server。
4. **删隧道**：Platform tunnel settings 删除 tunnel，或解除它和 ChatGPT 工作区的关联。
5. **作废密钥**：Platform 里 revoke 该 runtime API key。
6. **断本机会话**：在美管加退出登录（本机配置文件里的 Cookie 随之失效，所有工具自动拒绝）。

全程不需要改动美管加里的任何数据。

---

## 8. 已验证 / 未验证

**Hermes 报告的旧版本本机验证（不是本次云端独立验证）**

- 会话读取与 8 个工具在 stdio MCP 协议下可正常调用
- 客户精确定位返回脱敏结果
- 老师 ID 反查、服务项清单（含入口项标记）
- 预约查询（脱敏）
- 冲突预检能识别「同客户同时间已有预约」并 block
- 写入闸门：只读模式拒绝；开闸后无有效 `plan_id` 也拒绝

上述记录不能证明完整写入可用。修正版须重新运行本机只读验证；`python3 -m unittest discover -s mcp -p 'test_*.py'` 包含网关与工具边界的合成回归，工具边界使用 SDK 替身，不冒充真实 MCP 协议或隧道验证。

**未验证（不得假设）**

- AI 侧通过隧道真实调用（需要你的账户授权与 tunnel_id）
- 真实写入一轮完整链路（需要你明确授权 + 一笔新预约）
- 多服务项时长叠加规则、列表分页、跨日服务归属

---

## 9. 依赖说明

MCP Python SDK 2.x 把 `FastMCP` 改名为 `MCPServer`（`from mcp.server.mcpserver import MCPServer`）。
本项目按 2.x 编写；若环境是 1.x，需改成 `mcp.server.fastmcp.FastMCP`。

官方参考：

- https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- https://github.com/openai/tunnel-client/blob/master/docs/onboarding.md
