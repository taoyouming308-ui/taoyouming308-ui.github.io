# 美管加新增预约接口契约（脱敏）

来源：本机 Hermes Mac 上已实际成功写入的脚本（`mgj_book.py`），以及对该次写入结果的源系统回读。
日期：2026-10-19。**本文件不含 Cookie、Token、密码、手机号、客户姓名或任何真实预约 ID。**

这份契约回答 `docs/mgj-quick-booking.md` 末尾列出的待补齐项：完整 `itemProp`、元数据对应关系、成功响应结构。

---

## 1. 接口

| 项 | 值 |
| --- | --- |
| URL | `POST https://<vip 主机>/shair/reservation!add.action` |
| Content-Type | `application/x-www-form-urlencoded; charset=UTF-8` |
| 表单字段 | `jsonObj=<整个 JSON 序列化字符串>` + `shopid=<门店 ID>` |
| 必带请求头 | `Cookie`、`User-Agent`；本机实测另带 `Accept: application/json, text/plain, */*`、`Request-From: MGJ_SHAIR`、`X-Requested-With: XMLHttpRequest` |
| 会话 | 复用既有 0600 会话配置；不重登、不读密码文件 |

> 主机名只接受既有 `vip<数字>.meiguanjia.net`，强制 HTTPS，禁止重定向。

---

## 2. `jsonObj` 完整结构

```json
{
  "parentShopId": "<父门店 ID>",
  "shopId": "<门店 ID>",
  "custId": 0,
  "custName": "<客户姓名>",
  "memmobile": "<客户手机号>",
  "reservationTime": 0,
  "itemProp": "<另一层 JSON 字符串>",
  "barberId": 0,
  "barberName": "<发型师姓名>",
  "number": 1,
  "comment": "<备注，可为空>",
  "channel": 0,
  "reservationType": 0,
  "type": 0
}
```

约束：

- `custId` **不能为 0**。传 0 会返回 `2003 会员未找到`；不传 `custId` 会直接报错。
- `reservationTime` 是**毫秒时间戳**，代表绝对时刻。用户输入的 `18:00` 必须先按明确时区（UTC+8）解释再转毫秒。
- `number` 固定 1（多人同服务不拆单）。
- `channel` / `reservationType` / `type` 均为 0。
- `itemProp` 是**字符串**，不是对象。

---

## 3. `itemProp` 完整结构

`itemProp` 内部再序列化一层 JSON：

```json
{
  "times": 1,
  "strategy": 0,
  "items": {
    "<服务项 ID>": {
      "id": 0,
      "name": "<服务项名称>",
      "itemid": "<服务项 itemid>",
      "classid": "<服务项 classid>",
      "sorting": null,
      "price": 0,
      "adjustPrice": null,
      "shopids": ",<门店 ID>,",
      "stopshopids": null,
      "item_description": null,
      "mgjservicesetlogo": null,
      "userLevels": null,
      "time": 1,
      "priceFlag": 0,
      "reserv": 1,
      "timeStr": "半小时"
    }
  }
}
```

要点：

- `items` 是**对象映射**，键是服务项 ID 的字符串形式，不是数组。
- 每个 item 是**完整 16 字段对象**，不是只传 id/name。
- `shopids` 的格式是`,<shopId>,`（前后都有逗号）。
- **多服务项**：在 `items` 里放多个键即可。剪发和染发是两个独立的 item，分别选择，而不是只写一个入口项。
- `price` 固定 0（预约不锁价），`adjustPrice` 为 null。

---

## 4. 元数据对应关系

服务项与人员 ID 的权威来源是元数据接口，不是硬编码。

| 需要的东西 | 取自 | 说明 |
| --- | --- | --- |
| 服务项 `id` / `itemid` / `classid` | `GET /shair/metedata!reservationMetadata.action` → `content.serviceItems[]` | 127 项；`classid` 区分大类（剪发 2、烫发 3、染发 4、护理 5 等） |
| 服务项分类名 | 同上，`classname` 字段 | |
| 发型师 ID | 同上 `content.emps[]`，**但该数组实测为空** | 实际做法：从当天 `reservation!list.action` 的返回里按 `barberName` ↔ `barberId` 反查 |
| 门店 ID | 既有 `sync_mgj_bookings.py` 的 `SHOPS` | 不复制第二套门店配置 |
| 客户 ID | `POST /shair/consumerHelp!find.action` | 返回 HTML，`checkAllow('memcardId','?','custId',` 中第三个数字是 `custId` |

### 命名陷阱（实测）

`serviceItems` 里同时存在两类项目：

- **具体服务项**：`剪发380`、`基础染发560`、`健康染长发1460` 等，是真实服务。
- **预约入口项**：名称以「预约」开头（`预约剪发` / `预约烫发` / `预约染发` / `预约护理`），`itemid` 为 `2000/3000/4000/5000`，是预约界面上的占位项目名。

两者都能传进 `add.action`，但语义不同：
- 只写入口项 → 单子里只有一个占位项目，具体做了什么不在服务项里。
- 写具体项目 → 服务项准确，可以剪发 + 染发分别选择。

适配器应把「是否为入口项」标出来让调用方判断，**不要自行猜测替换**。

---

## 5. 成功与失败响应

响应体是 JSON，关键字段 `code`（整数）和 `message`（字符串）。

| code | 语义 | 处理 |
| --- | --- | --- |
| `0` | 接受写入 | 不能据此宣布成功，必须回读核对 |
| `1012` | 时段冲突 | 未写入，可重新预检 |
| `2003` | 会员未找到（`custId` 为 0） | 未写入，需先建客户档案 |
| `3` | 会话失效（"您没有登录，或者登录已经过期"） | 停止，需重新登录 |
| 其他 | 未知结果 | 视为**结果不明**，回读而不是重发 |

> 成功响应中**稳定的预约 ID 字段尚未确认**。本机现有实现按「新建后按 客户+时间+老师+项目 回读拿到 id」来获取，不依赖 `add.action` 返回体里的 id。

---

## 6. 写后回读

| 项 | 值 |
| --- | --- |
| URL | `POST /shair/reservation!list.action` |
| 表单 | `jsonObj={"parentShopId":"…","shopId":"…","reservationTime":<当天0点毫秒>,"period":"YYYY-MM-DD"}` + `shopid=<门店 ID>` |
| 返回 | `content.reservations[]` |
| 单条关键字段 | `id`、`status`、`reservationTime`、`barberId`、`barberName`、`memmobile`、`itemProp`（JSON 字符串，里面才是服务项名）、`comment` |

判定规则：

1. 必须存在 `content.reservations` 列表。**列表缺失 ≠ 空列表**，要报错而不是当空处理。
2. 按 `reservationTime == 目标毫秒` **且** `barberId == 目标老师` **且** `memmobile == 目标客户` **且** 目标项目名集合一致 来匹配。
3. `status` 已验证语义：`0` = 正式预约。其他数字状态语义**未验证**，遇到时停止而不是当作取消。
4. 匹配到 0 条 → 结果不明，**禁止自动重发**。
5. 匹配到多条 → 需人工核查。
6. 项目名不一致 → 不算成功。

---

## 7. 防重复与超时

- 写入请求**严格只发一次**。超时、响应缺失、code 未知一律不再重发，改走回读。
- 预检 → 确认之间必须重新核一次冲突，防止窗口期被占用。
- 确认必须绑定一次性 `plan_id`，用过即作废。
- 同客户同时间已存在预约 → 预检即 block，不能靠改项目/改时长绕过。

---

## 8. 未验证、不得假设的部分

以下是本机尚未取得证据的项，实现时不能猜：

- `add.action` 成功响应中预约 ID 的字段名。
- `status` 除 `0` 之外的语义（`2` 是否为取消、`3`、`4` 等）。
- 多服务项时的**时长计算规则**（各 item 的 `time` 是 1、`timeStr` 是「半小时」，但总时长如何叠加未核实）。
- 列表是否分页、单日条数上限，以及**跨日服务**（前一天开始、次日结束）是否出现在当天的列表里。
- 服务项 `priceFlag` / `reserv` 在不同项目上的取值差异。
- 并发写入时美管加侧的幂等保护是否存在。

在这些补齐之前：新适配器只应作为**窄接口**存在，写工具默认关闭，先跑只读验证。
