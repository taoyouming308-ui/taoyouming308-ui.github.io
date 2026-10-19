#!/usr/bin/env python3
"""Meiguanjia read-only diagnostics and offline booking preflight.

No production create endpoint is implemented. No password, auth-file read,
session renewal, cloud synchronization, scheduler or business-data mutation.
"""

import argparse
from datetime import datetime
import importlib.util
import json
import os
from pathlib import Path
import re
import ssl
import sys
import urllib.parse
import urllib.request

try:
    from mgj_booking_core import Blocked, CHINA, Request, phone, prepare
except ModuleNotFoundError:
    from scripts.mgj_booking_core import Blocked, CHINA, Request, phone, prepare


LIVE_WRITE_AVAILABLE = False


def canonical():
    path = Path(__file__).with_name("sync_mgj_bookings.py")
    spec = importlib.util.spec_from_file_location("mgj_canonical_read_config", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def select_shop(query):
    matches = [dict(s) for s in canonical().SHOPS if query in (s["shopId"], s["name"])]
    if len(matches) != 1:
        raise Blocked("门店未唯一匹配现有同步配置")
    return matches[0]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise Blocked("源接口发生重定向，停止；不会转发会话到其他地址")


class SourceReader:
    """Only the THREE read endpoints evidenced in tracked canonical scripts."""

    ALLOWED = {
        "metedata!reservationMetadata.action": "GET",
        "reservation!list.action": "POST",
        "consumerHelp!find.action": "POST",
    }

    def __init__(self, config_path=None):
        sync = canonical()
        path = Path(config_path or sync.CONFIG_PATH).expanduser()
        if not path.is_file():
            raise Blocked("当前环境没有 Hermes 本机登录会话配置")
        if path.is_symlink() or path.stat().st_mode & 0o077:
            raise Blocked("会话配置须为当前用户私有文件（0600），不自动修改权限")
        try:
            config = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raise Blocked("会话配置无法读取") from None
        if not isinstance(config, dict):
            raise Blocked("会话配置格式异常")
        self.server = config.get("server") or sync.DEFAULT_SERVER
        if not isinstance(self.server, str) or not re.fullmatch(r"vip[0-9]+\.meiguanjia\.net", self.server):
            raise Blocked("会话主机不在已知美管加主机范围")
        if config.get("cookie_server") not in (None, self.server):
            raise Blocked("会话与主机不匹配")
        self.cookie = config.get("cookies")
        if not isinstance(self.cookie, str) or not self.cookie or any(c in self.cookie for c in "\r\n"):
            raise Blocked("没有可复用的有效会话；请由本机既有保活流程处理")
        self.opener = urllib.request.build_opener(NoRedirect(),
            urllib.request.HTTPSHandler(context=ssl.create_default_context()))
        self.user_agent = sync.USER_AGENT

    def read(self, endpoint, fields=None, as_json=True):
        method = "GET" if fields is None else "POST"
        if self.ALLOWED.get(endpoint) != method:
            raise Blocked("只读诊断不允许该接口或方法")
        body = None if fields is None else urllib.parse.urlencode(fields).encode()
        request = urllib.request.Request(f"https://{self.server}/shair/{endpoint}", data=body,
            headers={"Cookie": self.cookie, "User-Agent": self.user_agent,
                     "Accept": "application/json, text/plain, */*", "Request-From": "MGJ_SHAIR",
                     "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"}, method=method)
        try:
            with self.opener.open(request, timeout=10) as response:
                text = response.read(2_000_001).decode("utf-8")
            if len(text.encode("utf-8")) > 2_000_000:
                raise ValueError()
            if not as_json:
                return text
            result = json.loads(text)
            if not isinstance(result, dict) or type(result.get("code")) is not int or result["code"] != 0:
                raise ValueError()
            return result
        except Exception:
            # Do not expose URL params, cookies, customer data or raw server text.
            raise Blocked("美管加只读请求失败/会话失效/返回结构异常；未重登、未写入") from None

    def inspect(self, shop, day, customer_phone=None):
        sync = canonical()
        parsed_day = datetime.strptime(day, "%Y-%m-%d").date()
        if parsed_day.isoformat() != day:
            raise Blocked("日期须为 YYYY-MM-DD")
        number = phone(customer_phone) if customer_phone else None
        metadata = self.read("metedata!reservationMetadata.action")
        payload = dict(parentShopId=shop["parentShopId"], shopId=shop["shopId"],
                       reservationTime=sync.reservation_timestamp(day), period=day)
        result = self.read("reservation!list.action", {
            "jsonObj": json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            "shopid": shop["shopId"],
        })
        content = result.get("content")
        if not isinstance(content, dict) or not isinstance(content.get("reservations"), list):
            raise Blocked("预约响应缺少完整列表，不能将缺失当作空列表")
        rows = content["reservations"]
        if any(not isinstance(r, dict) for r in rows):
            raise Blocked("预约响应含无效记录")
        matched = []
        for row in rows:
            try:
                same = number is not None and phone(row.get("memmobile")) == number
            except Blocked:
                same = False
            if same:
                matched.append({"id": row.get("id"), "status_raw": row.get("status"),
                    "barber_id": row.get("barberId"), "barber_name": row.get("barberName"),
                    "service_name": row.get("categoryName"), "reservation_time_raw": row.get("reservationTime")})
        candidates = None
        if number:
            html = self.read("consumerHelp!find.action", {
                "searchType": "1", "keyType": "1", "keyword": number, "isYY": "1", "shopId": shop["shopId"]
            }, as_json=False)
            candidates = len(set(re.findall(r"checkAllow\('(\d+)',\s*'?(\d+)'?,\s*'?(\d+)'?,", html)))
        metadata_content = metadata.get("content")
        return dict(mode="read_only", source="meiguanjia", shop_id=shop["shopId"], date=day,
                    session_valid=True, live_write_available=False, reservations_returned=len(rows),
                    matching_reservations=matched, customer_search_candidate_count=candidates,
                    metadata_content_keys=sorted(metadata_content) if isinstance(metadata_content, dict) else [],
                    reservation_field_names=sorted({k for r in rows for k in r}),
                    warning="这是原始只读核查，不是完整冲突判定；项目/人员/状态/时长/分页映射仍待核实")


def doctor(config_path=None):
    sync = canonical()
    path = Path(config_path or sync.CONFIG_PATH).expanduser()
    exists = path.is_file()
    return dict(mode="local_read_only", session_file_present=exists,
                session_file_private=exists and not path.is_symlink() and not path.stat().st_mode & 0o077,
                hermes_scripts_present=(path.parent / "scripts").is_dir(),
                canonical_shops=[dict(s) for s in sync.SHOPS],
                live_write_available=LIVE_WRITE_AVAILABLE,
                missing=["经真实成功请求及回读验证的新增预约适配器", "ChatGPT 到 Hermes 的已授权执行连接"]
                        + ([] if exists else ["Hermes 本机会话文件"]))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    local = commands.add_parser("doctor", help="仅查看文件是否存在，不读取密钥")
    local.add_argument("--config")
    inspect = commands.add_parser("inspect", help="复用本机会话，只读查指定店日及精确手机号")
    inspect.add_argument("--config")
    inspect.add_argument("--shop", required=True)
    inspect.add_argument("--date", required=True)
    inspect.add_argument("--phone", help="完整手机号；优先使用 --phone-stdin 避免终端历史")
    inspect.add_argument("--phone-stdin", action="store_true")
    plan = commands.add_parser("plan", help="离线核验规范化快照，不连接美管加")
    plan.add_argument("--request", required=True)
    plan.add_argument("--snapshot", required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "doctor":
            result = doctor(args.config)
        elif args.command == "inspect":
            if args.phone and args.phone_stdin:
                raise Blocked("手机号来源只能选择一种")
            number = sys.stdin.readline().strip() if args.phone_stdin else args.phone
            if args.phone_stdin and not number:
                raise Blocked("没有收到完整手机号")
            result = SourceReader(args.config).inspect(select_shop(args.shop), args.date, number)
        else:
            request = Request.parse(json.loads(Path(args.request).read_text(encoding="utf-8")))
            select_shop(request.shop_id)  # Same canonical store whitelist as the existing sync.
            snapshot = json.loads(Path(args.snapshot).read_text(encoding="utf-8"))
            result = prepare(request, snapshot, datetime.now(CHINA)).public()
            result.update(mode="offline_preflight", live_write_available=False,
                          warning="离线数据演练；不能据此宣称真实预约成功或时间空闲")
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (Blocked, OSError, ValueError, TypeError, ImportError):
        error = sys.exc_info()[1]
        message = str(error) if isinstance(error, Blocked) else "本机依赖、输入文件或日期不完整；未执行写入"
        print(json.dumps({"status": "blocked", "reason": message, "live_write_available": False}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    sys.exit(main())
