"""美管加预约 MCP 服务器（stdio）。

只暴露窄接口：健康、门店、客户查询、老师/项目查询、预约查询、冲突预检、确认预约、写后回读。
没有通用 shell、没有任意 URL、没有顾客建档、没有取消、没有财务写入。

安全闸：
- MGJ_MCP_ALLOW_WRITE 未设为 "1" 时，确认预约工具一律拒绝（默认只读）。
- 写入前必须带预检返回的 plan_id 做一次性绑定，且本次进程内只能用一次。
"""
from __future__ import annotations

import json
import os

from mcp.server.mcpserver import MCPServer

import mgj_gateway as gw

WRITE_ENABLED = os.environ.get("MGJ_MCP_ALLOW_WRITE") == "1"

server = MCPServer(
    name="mgj-booking",
    version="1.0.0",
    instructions=(
        "自由手艺人 / 向里造型 门店预约专用工具。"
        "写预约前必须先调用预检工具拿到 plan_id，再把 plan_id 原样传给确认工具；"
        "plan_id 一次有效，取消失败或结果不明时不要重试，先用回读工具核查。"
        "所有工具只返回脱敏信息，不含任何凭据。"
    ),
)

# 进程内一次性计划表：plan_id -> plan（不落盘，避免持久化客户资料）
_PLANS: dict[str, dict] = {}
_USED: set[str] = set()


def _cfg():
    return gw.load_config()


@server.tool(description="只读健康检查：确认会话配置、门店白名单和写入闸门状态。不读取任何凭据内容。")
def mgj_health() -> dict:
    cfg = gw.load_config()
    return {
        "ok": True,
        "session_file": str(gw.CONFIG_PATH),
        "session_present": gw.CONFIG_PATH.is_file(),
        "write_enabled": WRITE_ENABLED,
        "shops": [{"name": s["name"], "shop_id": s["shopId"]} for s in gw.SHOPS],
        "mode": "read_write" if WRITE_ENABLED else "read_only",
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
    }


@server.tool(description="查询某天某手机号的预约（只读）。返回脱敏列表，含预约 ID、状态原始值、时间、老师、项目名。")
def mgj_booking_find(shop: str, date: str, phone: str) -> dict:
    cfg = _cfg()
    s = gw.shop_by_ref(shop)
    return gw.find_bookings(s, cfg, date, phone)


@server.tool(description="只读冲突预检。核对客户唯一、老师存在、项目存在、该时段老师是否已被占、该客户是否已有同时间预约。返回 plan_id 供确认工具使用（若 blocked=true 则禁止创建）。")
def mgj_booking_preflight(shop: str, date: str, time: str, barber: str,
                          phone: str, services: list[str]) -> dict:
    cfg = _cfg()
    s = gw.shop_by_ref(shop)
    result = gw.preflight(s, cfg, date, time, barber, phone, services)
    plan = result.pop("_plan")
    _PLANS[result["plan_id"]] = plan
    return result


# 已提交的计划留档，供回读使用（不含凭据，进程退出即失效）
_PLAN_ARCHIVE: dict[str, dict] = {}


@server.tool(description="提交预约确认。必须传预检返回的 plan_id。写请求严格只发一次：超时或结果不明时不重发，改调回读工具核查。需要服务端开启写入闸门。")
def mgj_booking_confirm(plan_id: str, comment: str = "") -> dict:
    if not WRITE_ENABLED:
        raise gw.Blocked("写入闸门未开启（MGJ_MCP_ALLOW_WRITE 未设为 1），当前只能只读")
    if plan_id in _USED:
        raise gw.Blocked("该 plan_id 已使用过，不能重复提交")
    plan = _PLANS.get(plan_id)
    if plan is None:
        raise gw.Blocked("plan_id 无效或已过期，请重新预检")

    cfg = _cfg()
    # 提交前再核一次冲突，防止预检与写入之间被占用
    recheck = gw.preflight(plan["shop"], cfg, plan["date"], plan["time"],
                           plan["barber_name"],
                           plan["customer"]["phone"], plan["service_names"])
    if recheck["blocked"]:
        raise gw.Blocked("提交前复查发现时段已被占用或已存在相同预约，已中止")

    _USED.add(plan_id)
    _PLANS.pop(plan_id, None)
    _PLAN_ARCHIVE[plan_id] = plan  # 保留供回读，不再可用于写入

    outcome = gw.create_once(plan, cfg, comment)
    result = dict(outcome)
    result["plan_id"] = plan_id
    result["next"] = ("调用 mgj_booking_readback 核查结果"
                      if outcome["outcome"] in ("accepted", "unknown")
                      else "未写入，可直接重新预检")
    return result


@server.tool(description="写后回读核对。按 客户+时间+老师+项目 全部一致才判定 verified=true，并返回预约 ID。")
def mgj_booking_readback(plan_id: str) -> dict:
    plan = _PLAN_ARCHIVE.get(plan_id) or _PLANS.get(plan_id)
    if plan is None:
        raise gw.Blocked("plan_id 不在本进程记录中，请用 mgj_booking_find 按日期和手机号核查")
    cfg = _cfg()
    return gw.readback(plan, cfg)


def main() -> None:
    server.run()  # stdio


if __name__ == "__main__":
    main()
