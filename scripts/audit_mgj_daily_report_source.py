#!/usr/bin/env python3
"""Read-only, privacy-filtered inspection of already observed Meiguanjia pages.

This is an audit helper, not a synchronizer. It only reads the existing
project-consumption list, one to three bill details, one daily summary, or the observed menu page.
It never writes to Meiguanjia or to the application database.
"""
import argparse
import fcntl
import json
import math
import re
import subprocess
import sys
import time
import urllib.parse
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
from pathlib import Path

try:
    from scripts import sync_mgj_daily_consumption as daily
except ModuleNotFoundError:
    import sync_mgj_daily_consumption as daily

SERVER = "vip12.meiguanjia.net"
PARENT_SHOP_ID = "1103470"
TZ = timezone(timedelta(hours=8))
MAX_BUDGET_SECONDS = 60
MAX_BILL_LIMIT = 3
DETAIL_URL = f"https://{SERVER}/shair/bill!detail.action"
MENU_URL = f"https://{SERVER}/shair/main!showDesk.action"
DAILY_SUMMARY_URL = f"https://{SERVER}/shair/report!shopSumDay.action"
REFERER = f"https://{SERVER}/shair/components/customerRelation/index.html"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
)
DAILY_SUMMARY_HEADERS = [
    "日期", "总额", "现金", "银联", "支付宝", "微信支付", "大众点评", "商场卡", "合作券", "口碑", "抖音",
    "总额", "划卡", "划赠送金", "划分期赠送金", "总额", "代金券", "欠款", "免单", "红包", "优惠券",
    "商城订单", "线上积分抵扣", "门店积分抵扣",
]
DAILY_SUMMARY_TOP = [
    {"rowspan": "2", "text": "日期"},
    {"colspan": "10", "text": "现金类"},
    {"colspan": "4", "text": "划卡类"},
    {"colspan": "9", "text": "其他非现类"},
]
DAILY_SUMMARY_GROUPS = [
    ("现金类", 1, tuple(range(2, 11))),
    ("划卡类", 11, tuple(range(12, 15))),
    ("其他非现类", 15, tuple(range(16, 24))),
]
SUMMARY_INCOME_TYPES = {"projects": ["1"], "all": ["1", "2", "3", "4", "5"]}


class AuditError(ValueError):
    """An error whose message is safe to show to the operator."""


def validate_shop(shop):
    if str(shop) not in daily.SHOPS:
        raise AuditError("invalid_shop")
    return str(shop)


def validate_day(day, today=None):
    try:
        parsed = date.fromisoformat(str(day))
    except (TypeError, ValueError):
        raise AuditError("invalid_date") from None
    if parsed.isoformat() != day or parsed.year != 2026:
        raise AuditError("invalid_date")
    today = today or datetime.now(TZ).date()
    if parsed > today:
        raise AuditError("date_after_today")
    return parsed.isoformat()


def validate_bill_limit(value):
    try:
        limit = int(value)
    except (TypeError, ValueError):
        raise AuditError("invalid_bill_limit") from None
    if str(value) != str(limit) or not 1 <= limit <= MAX_BILL_LIMIT:
        raise AuditError("invalid_bill_limit")
    return limit


def session_shop_id(config):
    configured = config.get("shop_id") or (config.get("shop") or {}).get("id")
    return str(configured or PARENT_SHOP_ID)


def config_quote(value):
    """Quote one curl config value; secrets stay in stdin, never argv/files."""
    return ('"' + str(value).replace("\\", "\\\\").replace('"', '\\"')
            .replace("\r", "\\r").replace("\n", "\\n") + '"')


def common_headers(cookie, multipart_boundary=None):
    headers = [
        ("Cookie", cookie),
        ("Request-From", "MGJ_SHAIR"),
        ("Accept", "application/json, text/plain, */*"),
        ("Accept-Language", "zh-CN,zh;q=0.9"),
        ("Origin", f"https://{SERVER}"),
        ("Referer", REFERER),
        ("User-Agent", USER_AGENT),
        ("X-Requested-With", "XMLHttpRequest"),
    ]
    if multipart_boundary:
        headers.insert(2, ("Content-Type", f"multipart/form-data; boundary={multipart_boundary}"))
    return headers


def curl_config(headers, data=None):
    lines = ["silent", "show-error", "http2", "connect-timeout = 8", "max-time = 15"]
    lines.extend("header = " + config_quote(f"{key}: {value}") for key, value in headers)
    if data is not None:
        lines.append("data-binary = " + config_quote(data))
    return "\n".join(lines) + "\n"


def curl_request(url, headers, data=None, deadline=None, runner=subprocess.run):
    remaining = MAX_BUDGET_SECONDS if deadline is None else deadline - time.monotonic()
    if remaining <= 0:
        raise AuditError("budget_exhausted")
    # No secret or request body is placed in argv. TLS verification is curl's default.
    command = ["curl", "--disable", "--config", "-", "--write-out", "\\n%{http_code}", url]
    try:
        result = runner(command, input=curl_config(headers, data), text=True,
                        capture_output=True, timeout=min(15, remaining), check=False)
    except subprocess.TimeoutExpired:
        raise AuditError("curl_timeout") from None
    except OSError:
        raise AuditError("curl_unavailable") from None
    stdout = result.stdout or ""
    body, separator, status_text = stdout.rpartition("\n")
    status = status_text.strip() if separator else "000"
    if result.returncode != 0:
        raise AuditError(f"curl_returncode:{result.returncode}")
    valid_status = re.fullmatch(r"\d{3}", status)
    safe_status = status if valid_status else "000"
    if not valid_status or status != "200":
        raise AuditError(f"http_status:{safe_status}")
    return body


def multipart_body(payload, shop_id, boundary="----MGJAuditBoundary"):
    return (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"jsonObj\"\r\n\r\n"
        f"{json.dumps(payload, ensure_ascii=False, separators=(',', ':'))}\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"shopid\"\r\n\r\n"
        f"{shop_id}\r\n--{boundary}--\r\n"
    )


def request_bill_detail(bill_id, config, deadline=None, runner=subprocess.run):
    boundary = "----MGJAuditBoundary"
    payload = {"parentShopId": int(PARENT_SHOP_ID), "id": int(bill_id), "fromHis": 0}
    headers = common_headers(str(config.get("cookies") or ""), boundary)
    body = multipart_body(payload, session_shop_id(config), boundary)
    raw = curl_request(DETAIL_URL, headers, body, deadline, runner)
    try:
        response = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        raise AuditError("invalid_json_response") from None
    if not isinstance(response, dict) or type(response.get("code")) is not int or response.get("code") != 0:
        raise AuditError("source_response_rejected")
    content = response.get("content")
    if not isinstance(content, dict):
        raise AuditError("source_detail_missing")
    return content


def daily_summary_payload(shop, day, config, summary_scope="projects"):
    shop = validate_shop(shop)
    day = validate_day(day)
    if summary_scope not in SUMMARY_INCOME_TYPES:
        raise AuditError("invalid_summary_scope")
    day_start = datetime.combine(date.fromisoformat(day), datetime.min.time(), tzinfo=timezone.utc)
    millis = int(day_start.timestamp() * 1000)
    return {
        "parentShopId": int(PARENT_SHOP_ID),
        "shopId": session_shop_id(config),
        "shopIds": [shop],
        "period": f"{millis}_{millis}",
        "incomeType": SUMMARY_INCOME_TYPES[summary_scope],
        "depcode": "-1",
    }


def request_daily_summary(shop, day, config, summary_scope="projects", deadline=None, runner=subprocess.run):
    payload = daily_summary_payload(shop, day, config, summary_scope)
    form = urllib.parse.urlencode({
        "jsonObj": json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        "shopid": session_shop_id(config),
    })
    headers = common_headers(str(config.get("cookies") or ""))
    headers.insert(2, ("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8"))
    raw = curl_request(DAILY_SUMMARY_URL, headers, form, deadline, runner)
    try:
        response = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        raise AuditError("invalid_json_response") from None
    if not isinstance(response, dict) or type(response.get("code")) is not int or response.get("code") != 0:
        raise AuditError("source_response_rejected")
    content = response.get("content")
    if not isinstance(content, dict):
        raise AuditError("summary_content_missing")
    return content


def parse_summary_cents(value):
    if value == "":
        return None
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise AuditError("summary_amount_type_changed")
    text = str(value)
    # Keep conversion within Decimal's exact arithmetic precision, even for malformed input.
    if len(text) > 24 or not re.fullmatch(r"\d+(?:\.\d+)?", text):
        raise AuditError("summary_amount_invalid")
    try:
        amount = Decimal(text)
    except InvalidOperation:
        raise AuditError("summary_amount_invalid") from None
    if not amount.is_finite() or amount < 0:
        raise AuditError("summary_amount_invalid")
    cents = amount * 100
    if cents != cents.to_integral_value():
        raise AuditError("summary_amount_not_integral_cents")
    return int(cents)


def validate_summary_top(value):
    if not isinstance(value, list) or len(value) != len(DAILY_SUMMARY_TOP):
        raise AuditError("summary_headtop_changed")
    for actual, expected in zip(value, DAILY_SUMMARY_TOP):
        if not isinstance(actual, dict) or actual.get("text") != expected["text"]:
            raise AuditError("summary_headtop_changed")
        span_key = "rowspan" if "rowspan" in expected else "colspan"
        if set(actual) != set(expected) or str(actual.get(span_key)) != expected[span_key]:
            raise AuditError("summary_headtop_changed")


def parse_daily_summary(content, shop, day, summary_scope="projects"):
    """Validate one source day; blanks remain unknown and no-row is never zero."""
    shop = validate_shop(shop)
    day = validate_day(day)
    if not isinstance(content, dict) or set(content) != {"head", "headTop", "data", "columns", "config"}:
        raise AuditError("summary_content_structure_changed")
    if content.get("head") != DAILY_SUMMARY_HEADERS:
        raise AuditError("summary_header_changed")
    validate_summary_top(content.get("headTop"))
    columns = content.get("columns")
    if not isinstance(columns, list) or len(columns) != len(DAILY_SUMMARY_HEADERS) or any(
        value is not None and not isinstance(value, dict) for value in columns
    ):
        raise AuditError("summary_columns_changed")
    config = content.get("config")
    if not isinstance(config, dict) or set(config) != {"title"} or config.get("title") != "门店营业日汇总":
        raise AuditError("summary_title_changed")
    rows = content.get("data")
    if not isinstance(rows, list):
        raise AuditError("summary_data_changed")
    if not rows:
        raise AuditError("summary_no_rows")
    if len(rows) != 1:
        raise AuditError("summary_duplicate_or_multiple_rows")
    row = rows[0]
    if not isinstance(row, list) or len(row) != len(DAILY_SUMMARY_HEADERS):
        raise AuditError("summary_row_changed")
    if row[0] != day:
        raise AuditError("summary_date_mismatch")
    cents = {DAILY_SUMMARY_HEADERS[0]: day}
    for index, header in enumerate(DAILY_SUMMARY_HEADERS[1:], 1):
        cents[header + f"#{index}"] = parse_summary_cents(row[index])

    groups = []
    for name, total_idx, component_indices in DAILY_SUMMARY_GROUPS:
        component_values = [cents[DAILY_SUMMARY_HEADERS[i] + f"#{i}"] for i in component_indices]
        unknown_fields = [DAILY_SUMMARY_HEADERS[i] for i, item in zip(component_indices, component_values) if item is None]
        total = cents[DAILY_SUMMARY_HEADERS[total_idx] + f"#{total_idx}"]
        if total is None:
            unknown_fields.insert(0, DAILY_SUMMARY_HEADERS[total_idx] + f"#{total_idx}")
        known_sum = sum(value for value in component_values if value is not None)
        has_unknown = bool(unknown_fields)
        groups.append({
            "name": name,
            "total_cents": total,
            "known_sum_cents": known_sum,
            "unknown_fields": unknown_fields,
            "has_unknown": has_unknown,
            "delta_cents": None if has_unknown else total - known_sum,
        })

    types = SUMMARY_INCOME_TYPES.get(summary_scope)
    if types is None:
        raise AuditError("invalid_summary_scope")
    return {
        "source_scope": {"shop": shop, "date": day, "incomeType": types, "verification": "request_only"},
        "header": DAILY_SUMMARY_HEADERS,
        "row": row,
        "cents": cents,
        "group_checks": groups,
        "scope_limitations": [
            "响应未回显shopId/shopIds；店铺范围仅由请求载荷限定，属于request_only。",
            "本次只查询单个营业日；该响应不证明历史完整性或其他日期状态。",
            "空单元格保留为未知值，不当作零；没有数据行时拒绝输出零营业额。",
        ],
    }


def beijing_date(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        seconds = float(value) / 1000 if abs(float(value)) >= 1_000_000_000_000 else float(value)
        return datetime.fromtimestamp(seconds, TZ).date().isoformat()
    if isinstance(value, str):
        text = value.strip()
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
                try:
                    parsed = datetime.strptime(text, fmt)
                    break
                except ValueError:
                    continue
            else:
                raise AuditError("invalid_source_datetime") from None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=TZ)
        return parsed.astimezone(TZ).date().isoformat()
    raise AuditError("invalid_source_datetime")


def verify_bill_scope(content, bill_id, shop, day):
    if str(content.get("id", "")) != str(bill_id):
        raise AuditError("bill_id_mismatch")
    if str(content.get("shopid", "")) != str(shop):
        raise AuditError("bill_shop_mismatch")
    if beijing_date(content.get("consumetime")) != day:
        raise AuditError("bill_date_mismatch")


def finite_number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(float(value)):
        return None
    return value


def safe_scalar(value, max_length=64):
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return finite_number(value)
    if isinstance(value, str):
        return value[:max_length]
    return None


def safe_amount(value):
    number = finite_number(value)
    if number is not None:
        return number
    if isinstance(value, str) and re.fullmatch(r"-?\d+(?:\.\d{1,4})?", value.strip()):
        try:
            return float(value)
        except ValueError:
            return None
    return None


DETAIL_FIELDS = ("id", "type", "depcode", "depcodename", "itemno", "itemname", "num", "price", "money")
EMPLOYEE_NUMERIC_FIELDS = ("detailId", "fee", "cardFee", "cashFee", "otherFee", "projectCount", "personCount", "gain")
PAYDETAIL_NUMERIC_FIELDS = frozenset({
    "cardfee", "presentfee", "cash", "unionpay", "cooperation", "mall", "weixin", "pay",
    "voucherfee", "dividefee", "debtfee", "mdfee", "luckymoney", "coupon", "dianpin",
    "onlineCreditPay", "offlineCreditPay", "mallorderfee",
    *(f"otherfee{i}" for i in range(1, 11)), "treatfee", "treatpresentfee",
})
PAYMENT_SUM_FIELDS = {key.lower() for key in PAYDETAIL_NUMERIC_FIELDS}


def list_of_dicts(value):
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def sanitize_detail(content):
    emp_list = list_of_dicts(content.get("empList"))
    duties = {}
    for employee in emp_list:
        dutyname = employee.get("dutyname")
        aliases = {field: str(employee[field]) for field in ("id", "empId", "employeeId")
                   if employee.get(field) not in (None, "")}
        if not aliases or not isinstance(dutyname, str):
            continue
        identity = tuple(sorted(aliases.items()))
        for employee_id in aliases.values():
            previous = duties.get(employee_id)
            if previous is not None and previous[0] != identity:
                raise AuditError("employee_id_alias_conflict")
            if previous is not None and previous[1] != dutyname[:64]:
                raise AuditError("employee_duty_conflict")
            duties[employee_id] = (identity, dutyname[:64])

    empfees = []
    for employee in list_of_dicts(content.get("empfees")):
        item = {}
        for field in EMPLOYEE_NUMERIC_FIELDS:
            number = finite_number(employee.get(field))
            if number is not None:
                item[field] = number
        emp_id = employee.get("empid")
        if emp_id is not None and str(emp_id) in duties:
            item["dutyname"] = duties[str(emp_id)][1]
        empfees.append(item)

    details = []
    for row in list_of_dicts(content.get("details")):
        item = {}
        for field in DETAIL_FIELDS:
            value = safe_scalar(row.get(field), max_length=100)
            if value is not None:
                item[field] = value
        details.append(item)

    result = {
        "type": safe_scalar(content.get("type")),
        "status": safe_scalar(content.get("status")),
        "eafee": safe_amount(content.get("eafee")),
        "money": safe_amount(content.get("money")),
    }
    result["payConfigs"] = [
        {field: safe_scalar(row.get(field), 80) for field in ("field", "fieldName", "type")
         if safe_scalar(row.get(field), 80) is not None}
        for row in list_of_dicts(content.get("payConfigs"))
    ]
    paydetail = content.get("paydetail")
    result["paydetail"] = {
        key: number for key in PAYDETAIL_NUMERIC_FIELDS
        if isinstance(paydetail, dict) and (number := finite_number(paydetail.get(key))) is not None
    }
    result["details"] = details
    result["empfees"] = empfees
    result["cash_card_summaries"] = summarize_cash_card_details(content)
    return result


def summarize_rows(rows):
    rows = list_of_dicts(rows)
    totals = {}
    for row in rows:
        for key, value in row.items():
            if str(key).lower() in PAYMENT_SUM_FIELDS:
                number = finite_number(value)
                if number is not None:
                    totals[str(key)] = totals.get(str(key), 0) + number
    return {"count": len(rows), "numeric_sums": totals}


def summarize_cash_card_details(content):
    summaries = {}
    for key, value in content.items():
        normalized = re.sub(r"[^a-z]", "", str(key).lower())
        if not any(kind in normalized for kind in ("cash", "card")) or not any(tag in normalized for tag in ("detail", "list")):
            continue
        if isinstance(value, list):
            summaries[normalized] = summarize_rows(value)
        elif isinstance(value, dict):
            summaries[normalized] = summarize_rows(value.get("list") or value.get("details"))
    return summaries


class MenuParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links = []
        self.current = None
        self.action_urls = set()

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        href = attrs.get("href", "")
        if tag.lower() == "a":
            self.current = {"attrs": attrs, "text": ""}
        if href and re.search(r"(?:report|stat|summary).*\.action|\.action.*(?:report|stat|summary)", href, re.I):
            parsed = urllib.parse.urlsplit(href)
            self.action_urls.add(urllib.parse.urlunsplit(("", "", parsed.path, "", "")) or href.split("?", 1)[0])

    def handle_data(self, data):
        if self.current is not None:
            self.current["text"] += data

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self.current is not None:
            searchable = self.current["text"] + " " + " ".join(str(v) for v in self.current["attrs"].values())
            if re.search(r"财务|统计|report|stat|summary", searchable, re.I):
                safe_attrs = {}
                for key, value in self.current["attrs"].items():
                    if key not in {"href", "id", "class", "title", "name", "role"} and not key.startswith("data-"):
                        continue
                    value = str(value)
                    if key == "href":
                        parsed = urllib.parse.urlsplit(value)
                        value = urllib.parse.urlunsplit(("", "", parsed.path, "", "")) or value.split("?", 1)[0]
                    safe_attrs[key] = value[:160]
                self.links.append(safe_attrs)
            self.current = None


def inspect_menu(config, deadline=None, runner=subprocess.run):
    html = curl_request(MENU_URL, common_headers(str(config.get("cookies") or "")), deadline=deadline, runner=runner)
    parser = MenuParser()
    parser.feed(html)
    return {"menu_links": parser.links, "report_action_urls_not_executed": sorted(parser.action_urls)}


def load_config():
    try:
        return json.loads(Path(daily.CONFIG).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise AuditError("session_config_unavailable") from None


def acquire_shared_lock():
    lock = open(daily.LOCK, "a", encoding="utf-8")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock.close()
        raise AuditError("source_lock_busy") from None
    return lock


def audit(shop, day, bill_limit=1, budget_seconds=MAX_BUDGET_SECONDS, menu=False,
          daily_summary=False, summary_scope="projects"):
    shop = validate_shop(shop)
    day = validate_day(day)
    bill_limit = validate_bill_limit(bill_limit)
    if summary_scope not in SUMMARY_INCOME_TYPES:
        raise AuditError("invalid_summary_scope")
    if menu and daily_summary:
        raise AuditError("incompatible_modes")
    if not 1 <= budget_seconds <= MAX_BUDGET_SECONDS:
        raise AuditError("invalid_budget")
    deadline = time.monotonic() + budget_seconds
    lock = acquire_shared_lock()
    try:
        config = load_config()
        if menu:
            return {"mode": "menu", **inspect_menu(config, deadline)}
        if daily_summary:
            content = request_daily_summary(shop, day, config, summary_scope, deadline)
            return {"mode": "daily_summary", **parse_daily_summary(content, shop, day, summary_scope)}
        period = daily.fetch_period(shop, day, day, deadline)
        selected = period["services"][:bill_limit]
        bills = []
        for row in selected:
            if time.monotonic() >= deadline:
                raise AuditError("budget_exhausted")
            bill_id = row.get("source_id")
            content = request_bill_detail(bill_id, config, deadline)
            verify_bill_scope(content, bill_id, shop, day)
            bills.append({"source_id": str(bill_id), **sanitize_detail(content)})
        return {"mode": "bill_detail", "shop": shop, "date": day,
                "source_count": period["source_count"], "inspected_count": len(bills), "bills": bills}
    finally:
        lock.close()


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="只读审查已观测的美管加日报相关源字段")
    parser.add_argument("--shop", choices=sorted(daily.SHOPS), required=True)
    parser.add_argument("--date", required=True)
    parser.add_argument("--bill-limit", type=int, default=1)
    parser.add_argument("--budget-seconds", type=int, default=MAX_BUDGET_SECONDS)
    parser.add_argument("--menu", action="store_true", help="仅读取已观测菜单页，不访问菜单链接")
    parser.add_argument("--daily-summary", action="store_true", help="只读已观测门店营业日汇总")
    parser.add_argument("--summary-scope", choices=("projects", "all"), default="projects")
    return parser.parse_args(argv)


def main(argv=None):
    try:
        args = parse_args(argv)
        result = audit(args.shop, args.date, args.bill_limit, args.budget_seconds, args.menu,
                       args.daily_summary, args.summary_scope)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 0
    except AuditError as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False, sort_keys=True), file=sys.stderr)
        return 2
    except Exception:
        # Never print exception text: HTTP libraries may include headers or body fragments.
        print(json.dumps({"error": "audit_failed"}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
