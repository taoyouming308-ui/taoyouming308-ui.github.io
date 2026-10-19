"""美管加预约 MCP 服务器（stdio）。

只暴露窄接口：健康、门店、客户查询、老师/项目查询、预约查询、冲突预检、确认预约、写后回读。
没有通用 shell、没有任意 URL、没有顾客建档、没有取消、没有财务写入。

当前版本严格只读。MGJ_MCP_ALLOW_WRITE 不能启用生产写入。
未来必须接入已有 mgj_booking_core 的持久化日志与完整快照编排后才能写入。
"""
from __future__ import annotations

import json
import os
import secrets
import time as clock

from mcp.server.mcpserver import MCPServer

import mgj_gateway as gw

server = MCPServer(
    name="mgj-booking",
    version="1.0.1",
    instructions=(
        "自由手艺人 / 向里造型 门店预约专用工具。"
        "当前版本仅提供只读查询和部分预检，不能创建预约。"
        "未发现同开始时间预约不表示没有服务时段冲突。"
        "plan_id 仅用于五分钟内回查，不是授权凭据；不得据此宣称新建成功。"
        "所有工具只返回脱敏信息，不含任何凭据。"
    ),
)

# Bounded temporary read-only plans, not a durable creation journal.
_PLANS: dict[str, tuple[float, dict]] = {}
PLAN_TTL = 300
MAX_PLANS = 128


def _prune_plans():
    now = clock.monotonic()
    for key, (expires, _) in list(_PLANS.items()):
        if expires <= now:
            _PLANS.pop(key, None)


def _cfg():
    return gw.load_config()


@server.tool(description="只读健康检查：用现有本机会话调用元数据接口核验有效性。仅返回状态，不返回凭据。")
def mgj_health() -> dict:
    cfg = gw.load_config()
    gw.metadata(gw.SHOPS[0], cfg)
    return {
        "ok": True,
        "session_present": gw.CONFIG_PATH.is_file(),
        "session_valid": True,
        "write_enabled": False,
        "write_requested": os.environ.get("MGJ_MCP_ALLOW_WRITE") == "1",
        "write_block_reason": gw.WRITE_BLOCK_REASON,
        "shops": [{"name": s["name"], "shop_id": s["shopId"]} for s in gw.SHOPS],
        "mode": "read_only",
    }


@server.tool(description="列出可用门店。")
def mgj_shops() -> dict:
    return {"shops": [{"name": s["name"], "shop_id": s["shopId"],
                       "parent_shop_id": s["parentShopId"]} for s in gw.SHOPS]}


@server.tool(description="按完整 11 位手机号精确查询客户。只返回脱敏姓名、脱敏手机号和客户 ID。查不到或匹配到多人会报错停止。")
def mgj_customer_lookup(shop: str, phone: str) -> dict:
    cfg = _cfg()
    s = gw.shop_by_ref(shop)
    cust = gw.find_customer(s, cfg, phone)
    return {"shop": s["name"], "cust_id": cust["custId"],
            "name_masked": gw.mask_name(cust["custName"]),
            "phone_masked": cust["phone_masked"]}


@server.tool(description="列出门店可供预约的老师（从指定日期的预约列表反查老师 ID）以及可预约的服务项目清单。")
def mgj_catalog(shop: str, date: str) -> dict:
    cfg = _cfg()
    s = gw.shop_by_ref(shop)
    info = gw.barbers(s, cfg, date)
    catalog = gw.service_catalog(s, cfg)
    return {
        "shop": s["name"],
        "date": date,
        "barbers": [{"name": k, "id": v} for k, v in sorted(info["barbers"].items())],
        "services": catalog,
        "reservations_total": info["reservations_total"],
        "staff_directory_complete": False,
        "note": "老师为当天预约中观察到的身份，不代表完整在职/可预约名单",
    }


@server.tool(description="查询某天某手机号的预约（只读）。返回脱敏列表，含预约 ID、状态原始值、时间、老师、项目名。")
def mgj_booking_find(shop: str, date: str, phone: str) -> dict:
    cfg = _cfg()
    s = gw.shop_by_ref(shop)
    return gw.find_bookings(s, cfg, date, phone)


@server.tool(description="只读部分预检：查询客户、项目和已知同开始时间预约。时长/分页/跨日尚未核验，始终 blocked=true；plan_id 仅用于回查，不授权创建。")
def mgj_booking_preflight(shop: str, date: str, time: str, barber: str,
                          phone: str, services: list[str]) -> dict:
    cfg = _cfg()
    s = gw.shop_by_ref(shop)
    result = gw.preflight(s, cfg, date, time, barber, phone, services)
    plan = result.pop("_plan")
    _prune_plans()
    while len(_PLANS) >= MAX_PLANS:
        _PLANS.pop(next(iter(_PLANS)))
    plan_id = secrets.token_urlsafe(24)
    result["plan_id"] = plan["plan_id"] = plan_id
    result["expires_in_seconds"] = PLAN_TTL
    _PLANS[plan_id] = (clock.monotonic() + PLAN_TTL, plan)
    return result


@server.tool(description="当前版本禁用预约写入；任何 plan_id 和环境变量都不能启用。返回明确阻断原因，不发送写请求。")
def mgj_booking_confirm(plan_id: str, comment: str = "") -> dict:
    # Keep the reason visible even when the SDK hides exception details.
    # This is a blocked operation, not a successful reservation.
    return {"outcome": "blocked", "written": False, "reason": gw.WRITE_BLOCK_REASON}


@server.tool(description="按只读计划回查已有预约。比对客户手机号、开始时间、老师、项目 ID 和名称；完整时长/覆盖未知，所以不宣告创建成功。")
def mgj_booking_readback(plan_id: str) -> dict:
    _prune_plans()
    record = _PLANS.get(plan_id)
    if record is None:
        raise gw.Blocked("plan_id 不在本进程记录中，请用 mgj_booking_find 按日期和手机号核查")
    _, plan = record
    cfg = _cfg()
    return gw.readback(plan, cfg)


def main() -> None:
    server.run()  # stdio


if __name__ == "__main__":
    main()
