"""美管加预约 MCP —— 本机专用窄接口网关。

设计边界（务必保持）：
- 只暴露两家门店的预约相关能力，不提供通用 shell、任意 URL、顾客建档、取消、财务写入。
- 凭据只从本机 0600 配置文件读取，绝不写日志、不回传、不进异常信息。
- 写操作严格一次，超时/结果不明一律停止并回查，绝不自动重发。
- 所有返回体做脱敏：不含 Cookie、Token、密码、完整手机号。

本模块只依赖标准库。
"""
from __future__ import annotations

import json
import os
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

CHINA = timezone(timedelta(hours=8))

CONFIG_PATH = Path(os.path.expanduser("~/.hermes/meiguanjia-config.json"))

# 门店白名单：与既有 sync_mgj_bookings.py 的 SHOPS 保持一致，不另建一套
SHOPS = (
    {"shopId": "1009951", "name": "自由手艺人", "parentShopId": "1103470"},
    {"shopId": "1837032", "name": "向里造型", "parentShopId": "1103470"},
)

# 预约写失败的已知业务码（来自本机既有成功/失败观察，非推测）
CODE_OK = 0
CODE_CONFLICT = 1012      # 时段冲突
CODE_NO_MEMBER = 2003     # custId=0 时"会员未找到"

# 预约列表里 status 的已知语义（已核实）
STATUS_ACTIVE = 0


class Blocked(Exception):
    """任何不满足安全条件的情形都抛这个，绝不放行。"""


# ---------------------------------------------------------------- 配置与会话


def load_config() -> dict:
    """只读本机 0600 会话配置。不读取任何密码文件。"""
    if not CONFIG_PATH.is_file():
        raise Blocked("本机缺少美管加会话配置")
    if CONFIG_PATH.is_symlink():
        raise Blocked("会话配置不能是符号链接")
    mode = CONFIG_PATH.stat().st_mode & 0o777
    if mode & 0o077:
        raise Blocked("会话配置权限过宽，须为 0600")
    cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    if not isinstance(cfg, dict):
        raise Blocked("会话配置格式无效")
    return cfg


def _base_url(cfg: dict) -> str:
    """只接受既有 vip 数字美管加主机，强制 HTTPS。"""
    server = str(cfg.get("server") or cfg.get("cookie_server") or "").strip()
    if not re.fullmatch(r"vip\d+\.meiguanjia\.net", server):
        raise Blocked("会话配置中的主机不在允许的 vip 美管加范围内")
    return f"https://{server}/shair"


def _cookie(cfg: dict) -> str:
    """优先用 `cookies` 字段。

    本机配置里同时存在两个字段：`cookies`（既有同步脚本维护的当前有效会话）
    和 `cookie`（历史遗留，可能已过期）。只信 `cookies`，没有再回退。
    """
    for key in ("cookies", "cookie"):
        val = cfg.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    raise Blocked("会话配置缺少凭据")


def _request(url: str, cookie: str, payload: dict | None = None,
             timeout: float = 12.0, as_json: bool = True):
    """严格证书校验、禁止重定向、单次请求不重试。"""
    data = urllib.parse.urlencode(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data)
    req.add_header("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
    req.add_header("Accept", "application/json, text/plain, */*")
    req.add_header("Request-From", "MGJ_SHAIR")
    req.add_header("X-Requested-With", "XMLHttpRequest")
    req.add_header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                                "AppleWebKit/537.36 (KHTML, like Gecko) "
                                "Chrome/125.0.0.0 Safari/537.36")
    req.add_header("Cookie", cookie)

    class _NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            raise Blocked("接口发生重定向，已中止")

    opener = urllib.request.build_opener(
        urllib.request.HTTPSHandler(context=ssl.create_default_context()),
        _NoRedirect,
    )
    try:
        with opener.open(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", "ignore")
    except Blocked:
        raise
    except urllib.error.HTTPError as exc:
        raise Blocked(f"美管加返回 HTTP {exc.code}，已中止") from None
    except Exception:
        # 不把底层异常文本往外抛，避免任何细节泄漏到调用方日志
        raise Blocked("美管加请求失败或超时，已中止且不会重发") from None

    if not as_json:
        return body

    try:
        parsed = json.loads(body)
    except Exception:
        # 登录页是 HTML；这种情况必须明确判定为会话失效
        if re.search(r"请输入验证码|没有登录，或者登录已经过期", body):
            raise Blocked("美管加会话已失效，请在浏览器重新登录后再试") from None
        raise Blocked("美管加返回了非 JSON 响应，已中止") from None
    if not isinstance(parsed, dict):
        raise Blocked("美管加返回结构异常")
    return parsed


# ---------------------------------------------------------------- 脱敏工具


def mask_phone(phone: str) -> str:
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) >= 7:
        return f"{digits[:3]}****{digits[-4:]}"
    return "***"


def mask_name(name: str) -> str:
    name = (name or "").strip()
    if not name:
        return ""
    return name[0] + "*" * max(len(name) - 1, 0)


def _phone(value) -> str:
    digits = re.sub(r"\D", "", str(value or ""))
    if not re.fullmatch(r"1\d{10}", digits):
        raise Blocked("手机号必须是 11 位完整号码")
    return digits


def _ts(day: str, hhmm: str) -> int:
    try:
        dt = datetime.strptime(f"{day} {hhmm}", "%Y-%m-%d %H:%M").replace(tzinfo=CHINA)
    except ValueError:
        raise Blocked("时间格式须为 日期 YYYY-MM-DD + 时间 HH:MM") from None
    return int(dt.timestamp() * 1000)


def shop_by_ref(ref: str) -> dict:
    ref = str(ref or "").strip()
    for shop in SHOPS:
        if ref in (shop["name"], shop["shopId"]):
            return dict(shop)
    allowed = "、".join(f'{s["name"]}({s["shopId"]})' for s in SHOPS)
    raise Blocked(f"只允许这些门店：{allowed}")


# ---------------------------------------------------------------- 只读能力


def metadata(shop: dict, cfg: dict) -> dict:
    """人员/项目/配置的权威来源。GET，与既有只读诊断一致。"""
    res = _request(f"{_base_url(cfg)}/metedata!reservationMetadata.action", _cookie(cfg))
    content = res.get("content")
    if not isinstance(content, dict):
        raise Blocked("元数据响应缺少 content")
    return content


def service_catalog(shop: dict, cfg: dict) -> list[dict]:
    """把门店服务项规范成可供选择的清单。

    返回全部分类项。`reservable_entry=True` 标记「预约剪发/预约染发/…」这类
    入口项——它们是美管加预约界面上的占位项目名，不是真实服务项；
    真做服务组合时应选具体项目（如 剪发380 + 基础染发560）。
    """
    content = metadata(shop, cfg)
    items = content.get("serviceItems")
    if not isinstance(items, list):
        raise Blocked("元数据缺少 serviceItems 列表")
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        name = str(it.get("name") or "")
        out.append({
            "id": it.get("id"),
            "name": name,
            "itemid": it.get("itemid"),
            "classid": it.get("classid"),
            "classname": it.get("classname"),
            "reservable_entry": name.startswith("预约"),
        })
    out.sort(key=lambda x: (str(x["classid"]), str(x["name"])))
    return out


def find_customer(shop: dict, cfg: dict, phone: str) -> dict:
    """精确手机号查客户，返回唯一候选。"""
    number = _phone(phone)
    html = _request(
        f"{_base_url(cfg)}/consumerHelp!find.action",
        _cookie(cfg),
        {"searchType": "1", "keyType": "1", "keyword": number,
         "isYY": "1", "shopId": shop["shopId"]},
        as_json=False,
    )
    if re.search(r"请输入验证码|没有登录，或者登录已经过期", html):
        raise Blocked("美管加会话已失效，请在浏览器重新登录后再试")
    rows = re.findall(r"checkAllow\('(\d+)',\s*'?(\d+)'?,\s*'?(\d+)'?,", html)
    ids = {int(r[2]) for r in rows}
    if not ids:
        raise Blocked("该手机号在系统中查不到客户，需先在美管加建立客户档案")
    if len(ids) > 1:
        raise Blocked("该手机号匹配到多个客户，停止以免约错人")
    cust_id = ids.pop()
    name_match = re.search(r'class="memberTr"[^>]*>\s*<td>([^<]+)', html)
    cust_name = name_match.group(1).strip() if name_match else ""
    return {"custId": cust_id, "custName": cust_name, "phone_masked": mask_phone(number)}


def barbers(shop: dict, cfg: dict, day: str) -> dict:
    """从当天预约列表反查发型师 ID（元数据 emps 常为空）。"""
    payload = {
        "parentShopId": shop["parentShopId"],
        "shopId": shop["shopId"],
        "reservationTime": _ts(day, "00:00"),
        "period": day,
    }
    res = _request(f"{_base_url(cfg)}/reservation!list.action", _cookie(cfg), {
        "jsonObj": json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        "shopid": shop["shopId"],
    })
    content = res.get("content")
    if not isinstance(content, dict) or not isinstance(content.get("reservations"), list):
        raise Blocked("预约响应缺少完整列表，不能把缺失当作空")
    found = {}
    for row in content["reservations"]:
        if not isinstance(row, dict):
            continue
        bid, bname = row.get("barberId"), row.get("barberName")
        if bid and bname and int(bid) > 0:
            found[str(bname)] = int(bid)
    return {"barbers": found, "reservations_total": len(content["reservations"])}


def day_reservations(shop: dict, cfg: dict, day: str) -> list[dict]:
    payload = {
        "parentShopId": shop["parentShopId"],
        "shopId": shop["shopId"],
        "reservationTime": _ts(day, "00:00"),
        "period": day,
    }
    res = _request(f"{_base_url(cfg)}/reservation!list.action", _cookie(cfg), {
        "jsonObj": json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        "shopid": shop["shopId"],
    })
    content = res.get("content")
    if not isinstance(content, dict) or not isinstance(content.get("reservations"), list):
        raise Blocked("预约响应缺少完整列表，不能把缺失当作空")
    return [r for r in content["reservations"] if isinstance(r, dict)]


def _norm_services(row: dict) -> list[str]:
    try:
        prop = json.loads(row.get("itemProp") or "{}")
        items = prop.get("items") or {}
        names = [str(v.get("name")) for v in items.values() if isinstance(v, dict)]
        return sorted(names)
    except Exception:
        return []


def _row_view(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "status_raw": row.get("status"),
        "time_ms": row.get("reservationTime"),
        "time_local": datetime.fromtimestamp(
            int(row.get("reservationTime") or 0) / 1000, CHINA).strftime("%Y-%m-%d %H:%M"),
        "barber_id": row.get("barberId"),
        "barber_name": row.get("barberName"),
        "services": _norm_services(row),
        "phone_masked": mask_phone(str(row.get("memmobile") or "")),
        "customer_masked": mask_name(str(row.get("custName") or "")),
        "comment": row.get("comment") or "",
    }


def find_bookings(shop: dict, cfg: dict, day: str, phone: str) -> dict:
    number = _phone(phone)
    rows = day_reservations(shop, cfg, day)
    matched = [
        _row_view(r) for r in rows
        if re.sub(r"\D", "", str(r.get("memmobile") or "")) == number
    ]
    return {"date": day, "reservations_total": len(rows), "matched": matched}


# ---------------------------------------------------------------- 冲突预检


def preflight(shop: dict, cfg: dict, day: str, hhmm: str, barber_name: str,
              phone: str, services: list[str]) -> dict:
    """只读预检：客户唯一、发型师存在、项目存在、无重复、无时段冲突。

    返回的 plan 结构只在内存里用于后续确认；不落盘、不含凭据。
    """
    number = _phone(phone)
    if not services:
        raise Blocked("至少选择一个服务项目")
    if len(services) > 5:
        raise Blocked("服务项目过多，最多 5 项")

    cust = find_customer(shop, cfg, number)
    catalog = service_catalog(shop, cfg)
    by_name = {}
    for it in catalog:
        by_name.setdefault(str(it["name"]), []).append(it)

    chosen = []
    for raw in services:
        name = str(raw or "").strip()
        hits = by_name.get(name) or []
        if not hits:
            raise Blocked(f"门店服务项里没有「{name}」，请先查询可用项目名")
        if len(hits) > 1:
            raise Blocked(f"「{name}」对应多个项目，需用更精确的项目名")
        chosen.append(hits[0])

    barber_map = barbers(shop, cfg, day)["barbers"]
    if barber_name not in barber_map:
        raise Blocked(f"该门店在 {day} 的预约里没有出现「{barber_name}」，"
                      f"可用：{'、'.join(sorted(barber_map))}")

    rows = day_reservations(shop, cfg, day)
    target_ms = _ts(day, hhmm)
    same_customer = []
    barber_clash = []
    for row in rows:
        if str(row.get("barberId")) == str(barber_map[barber_name]) and \
                int(row.get("reservationTime") or 0) == target_ms and \
                int(row.get("status") or 0) == STATUS_ACTIVE:
            barber_clash.append(_row_view(row))
        if re.sub(r"\D", "", str(row.get("memmobile") or "")) == number and \
                int(row.get("reservationTime") or 0) == target_ms and \
                int(row.get("status") or 0) == STATUS_ACTIVE:
            same_customer.append(_row_view(row))

    plan = {
        "shop": shop,
        "date": day,
        "time": hhmm,
        "time_ms": target_ms,
        "barber_name": barber_name,
        "barber_id": barber_map[barber_name],
        "customer": cust,
        "services": chosen,
        "service_names": [c["name"] for c in chosen],
    }
    digest = json.dumps({
        "shop": shop["shopId"], "date": day, "time": hhmm,
        "barber": barber_map[barber_name], "cust": cust["custId"],
        "services": sorted(c["id"] for c in chosen),
    }, ensure_ascii=False, sort_keys=True)
    import hashlib
    plan["plan_id"] = hashlib.sha256(digest.encode()).hexdigest()[:16]

    return {
        "plan_id": plan["plan_id"],
        "shop": shop["name"],
        "shop_id": shop["shopId"],
        "date": day,
        "time": hhmm,
        "time_local": f"{day} {hhmm}",
        "barber": barber_name,
        "barber_id": plan["barber_id"],
        "customer": {"custId": cust["custId"],
                     "name_masked": mask_name(cust["custName"]),
                     "phone_masked": cust["phone_masked"]},
        "services": [{"id": c["id"], "name": c["name"]} for c in chosen],
        "duplicate_same_time": same_customer,
        "barber_slot_taken": barber_clash,
        "blocked": bool(same_customer or barber_clash),
        "note": ("该时段该老师或该客户已有预约，禁止创建"
                 if (same_customer or barber_clash) else "预检通过，可提交确认"),
        "_plan": plan,
    }


# ---------------------------------------------------------------- 写入（严格一次）


def build_item_prop(services: list[dict], shop: dict) -> str:
    """完整 itemProp 结构，字段来自本机既有成功写入的请求体。"""
    items = {}
    for s in services:
        items[str(s["id"])] = {
            "id": s["id"],
            "name": s["name"],
            "itemid": s.get("itemid", "2000"),
            "classid": s.get("classid", "2"),
            "sorting": None,
            "price": 0,
            "adjustPrice": None,
            "shopids": f",{shop['shopId']},",
            "stopshopids": None,
            "item_description": None,
            "mgjservicesetlogo": None,
            "userLevels": None,
            "time": 1,
            "priceFlag": 0,
            "reserv": 1,
            "timeStr": "半小时",
        }
    return json.dumps({"times": 1, "strategy": 0, "items": items},
                      ensure_ascii=False, separators=(",", ":"))


def build_payload(plan: dict, comment: str = "") -> dict:
    shop = plan["shop"]
    cust = plan["customer"]
    return {
        "parentShopId": shop["parentShopId"],
        "shopId": shop["shopId"],
        "custId": cust["custId"],
        "custName": cust["custName"],
        "memmobile": cust["phone"],
        "reservationTime": plan["time_ms"],
        "itemProp": build_item_prop(plan["services"], shop),
        "barberId": plan["barber_id"],
        "barberName": plan["barber_name"],
        "number": 1,
        "comment": comment or "",
        "channel": 0,
        "reservationType": 0,
        "type": 0,
    }


def create_once(plan: dict, cfg: dict, comment: str = "") -> dict:
    """恰好发一次写请求。任何异常都不重试。"""
    shop = plan["shop"]
    body = build_payload(plan, comment)
    res = _request(
        f"{_base_url(cfg)}/reservation!add.action",
        _cookie(cfg),
        {"jsonObj": json.dumps(body, ensure_ascii=False),
         "shopid": shop["shopId"]},
        timeout=15.0,
    )
    code = res.get("code")
    if code == CODE_OK:
        return {"outcome": "accepted", "code": code,
                "message": str(res.get("message") or "")}
    if code == CODE_CONFLICT:
        return {"outcome": "conflict", "code": code,
                "message": str(res.get("message") or "该时段已有预约")}
    if code == CODE_NO_MEMBER:
        return {"outcome": "no_member", "code": code,
                "message": str(res.get("message") or "会员未找到")}
    return {"outcome": "unknown", "code": code,
            "message": str(res.get("message") or "")}


def readback(plan: dict, cfg: dict) -> dict:
    """写后回读：必须按 客户+时间+老师+项目 全一致才算成功。"""
    shop = plan["shop"]
    rows = day_reservations(shop, cfg, plan["date"])
    wanted_services = sorted(s["name"] for s in plan["services"])
    hits = []
    for row in rows:
        if int(row.get("reservationTime") or 0) != plan["time_ms"]:
            continue
        if str(row.get("barberId")) != str(plan["barber_id"]):
            continue
        if re.sub(r"\D", "", str(row.get("memmobile") or "")) != plan["customer"]["phone"]:
            continue
        if int(row.get("status") or 0) != STATUS_ACTIVE:
            continue
        hits.append(row)

    if not hits:
        return {"verified": False, "reason": "回读未找到匹配预约，结果不明，禁止自动重发",
                "matched": []}
    if len(hits) > 1:
        return {"verified": False, "reason": "回读匹配到多条，需人工核查",
                "matched": [_row_view(r) for r in hits]}

    view = _row_view(hits[0])
    service_ok = sorted(view["services"]) == wanted_services
    return {
        "verified": bool(service_ok),
        "reason": "" if service_ok else f"项目不一致：期望{wanted_services}，实际{view['services']}",
        "matched": [view],
        "booking_id": view["id"],
        "barber_match": True,
        "time_match": True,
        "customer_match": True,
    }
