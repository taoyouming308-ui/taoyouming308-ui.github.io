#!/usr/bin/env python3
"""
美管加直连同步脚本 · sync_mgj_all.py
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
直接从美管加API拉客户数据，写到Supabase，不经过任何中间层。

核心逻辑：
  1. 从Supabase bookings表拿客户手机号
  2. 对每个手机号，调美管加API拿完整客户数据
  3. 写进Supabase customer_profiles表

字段映射：
  name              = 客户姓名（membername/custName）
  total_visits      = consumetimes（物理到店次数）
  total_consumption = consumetimes × avgfee（历史总消费金额）
  avg_fee           = avgfee（客单价）
  last_visit_date   = lastconsumetime（最后到店时间）
  card_packages     = treatMentItems（疗程套餐）

API调用：
  - 主路径：memberDetail!detail.action（multipart POST，返回JSON）
  - 回退路径：consumerHelp!find.action（现金页HTML带consumefee/name/lastconsumetime/lciList表格）

用法：
  python3 sync_mgj_all.py                     # 增量同步：今天+未来7天有预约的客户
  python3 sync_mgj_all.py full                # 全量同步：从bookings表最近90天所有客户
  python3 sync_mgj_all.py backfill [数量]     # 断点回填缺失的消费记录/套餐，默认20人
  python3 sync_mgj_all.py one <手机号>        # 同步单个客户
  python3 sync_mgj_all.py validate <手机号>   # 验证单个客户数据
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""

import fcntl
import json
import os
import re
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

# ── 配置 ──
CONFIG_PATH = "/Users/a1/.hermes/meiguanjia-config.json"
HISTORY_CONFIG_PATH = os.environ.get(
    "MEIGUANJIA_HISTORY_CONFIG_PATH",
    os.path.expanduser("~/.hermes/meiguanjia-care-config.json"),
)
SERVER = "vip12.meiguanjia.net"
SUPABASE_URL = "https://pdssrmpeiuwvxzsgschm.supabase.co"
SUPABASE_KEY = "sb_publishable_MDx4d2QzQpTojF8yLRHIqw_uKQW7A7t"
TABLE = "customer_profiles"
SERVICE_TABLE = "mgj_service_records"
SHOP_IDS = ["1009951", "1837032"]  # 自由手艺人, 向里造型
PARENT_SHOP_ID = "1103470"
LEGACY_EMP_ID = "543987"
API_TIMEOUT = 20
HISTORY_START_DATE = "2018-01-01"
HISTORY_DETAIL_CALLS = 2
HISTORY_RECORD_LIMIT = 500
HISTORY_RECENT_DAYS = 45
SERVICE_REFRESH_DETAIL_CALLS = 8
SERVICE_REFRESH_LIMIT = 5
LOCK_PATH = "/tmp/sync_mgj_all.lock"
STATUS_PATH = "/Users/a1/.hermes/sync_status.json"
BACKFILL_STATUS_PATH = "/Users/a1/.hermes/mgj_customer_backfill.json"
SHOP_NAMES = {
    "1009951": "自由手艺人",
    "1837032": "向里造型",
}
DEFAULT_SESSION_SHOP_ID = "1009951"

SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE


# ═══════════════════════════════════════════════════════════════════
#  工具函数
# ═══════════════════════════════════════════════════════════════════

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def load_config(path=CONFIG_PATH):
    with open(path, encoding="utf-8") as config_file:
        return json.load(config_file)


def load_cookies(config_path=None):
    """从配置文件加载美管加cookie"""
    cfg = load_config() if config_path is None else load_config(config_path)
    ck = cfg.get("cookies", "")
    return ck if isinstance(ck, str) else "".join(ck)


def cookie_value(cookies, name):
    for part in str(cookies or "").split(";"):
        key, separator, value = part.strip().partition("=")
        if separator and key == name:
            return value.strip()
    return ""


def session_employee_id():
    """Use the employee attached to the current authenticated Meiguanjia session."""
    cfg = load_config()
    configured = cfg.get("emp_id") or cfg.get("employee_id")
    return str(configured or cookie_value(load_cookies(), "userId") or LEGACY_EMP_ID)


def session_shop_id(config_path=None):
    cfg = load_config() if config_path is None else load_config(config_path)
    return str(cfg.get("shop_id") or (cfg.get("shop") or {}).get("id") or DEFAULT_SESSION_SHOP_ID)


def acquire_run_lock():
    """Prevent overlapping cron runs from writing the same profiles."""
    lock_file = open(LOCK_PATH, "w", encoding="utf-8")
    try:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock_file.close()
        return None
    lock_file.write(str(os.getpid()))
    lock_file.flush()
    return lock_file


def write_status(status, **details):
    payload = {
        "status": status,
        "updated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "script": os.path.realpath(__file__),
    }
    payload.update(details)
    tmp_path = STATUS_PATH + ".tmp"
    try:
        with open(tmp_path, "w", encoding="utf-8") as status_file:
            json.dump(payload, status_file, ensure_ascii=False, indent=2)
        os.replace(tmp_path, STATUS_PATH)
    except OSError as exc:
        log(f"  ⚠️ 同步状态写入失败: {exc}")


def parse_array(value):
    if isinstance(value, list):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        except json.JSONDecodeError:
            return []
    return []


def number(value, default=0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def int_number(value, default=0):
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def timestamp_text(timestamp_ms):
    timestamp_ms = int_number(timestamp_ms)
    if timestamp_ms <= 0:
        return "", ""
    dt = datetime.fromtimestamp(timestamp_ms / 1000).astimezone()
    return dt.strftime("%Y-%m-%d"), dt.strftime("%H:%M")


def timestamp_date(timestamp_ms):
    date_text, _ = timestamp_text(timestamp_ms)
    return date_text


# ═══════════════════════════════════════════════════════════════════
#  Supabase 操作
# ═══════════════════════════════════════════════════════════════════

def supabase_get(path, timeout=10):
    """GET请求Supabase REST API"""
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    req = urllib.request.Request(url, headers={"apikey": SUPABASE_KEY, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def supabase_post(path, body, timeout=10):
    """POST请求Supabase REST API"""
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    data = json.dumps(body, ensure_ascii=False).encode()
    req = urllib.request.Request(url, data=data, headers={
        "apikey": SUPABASE_KEY,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status


def supabase_patch(path, body, timeout=10):
    """PATCH请求Supabase REST API"""
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    data = json.dumps(body, ensure_ascii=False).encode()
    req = urllib.request.Request(url, data=data, headers={
        "apikey": SUPABASE_KEY, "Content-Type": "application/json", "Prefer": "return=minimal"
    }, method="PATCH")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status


def get_booking_phones(days_back=0, days_forward=7):
    """
    从bookings表获取需要同步的手机号。
    
    参数：
      days_back:   向前看多少天（全量模式用30）
      days_forward: 向后看多少天
    
    注意：Supabase bookings表的未来预约条目可能没有存储手机号，
    所以同时会往回查 days_back 天来获取已知客户。
    """
    today = datetime.now().strftime("%Y-%m-%d")
    start_date = (datetime.now() - timedelta(days=days_back)).strftime("%Y-%m-%d")
    
    phones = set()
    
    # 1) 从未来预约（today ~ today+days_forward）获取手机号
    end_date = (datetime.now() + timedelta(days=days_forward)).strftime("%Y-%m-%d")
    try:
        data = supabase_get(
            f"bookings?select=customer_phone,customer_name&date=gte.{today}&date=lte.{end_date}&limit=500")
        for b in data:
            p = b.get("customer_phone")
            if p and p.strip():
                phones.add(p.strip())
        log(f"  未来预约({today}~{end_date}): {len(data)}条, {sum(1 for b in data if b.get('customer_phone'))}个有手机号")
    except Exception as e:
        log(f"  ⚠️ 查询未来预约失败: {e}")
    
    # 2) 同时从近期历史预约获取手机号（未来预约可能没存手机号）
    if days_back > 0:
        try:
            data = supabase_get(
                f"bookings?select=customer_phone&date=gte.{start_date}&date=lt.{today}&limit=1000")
            for b in data:
                p = b.get("customer_phone")
                if p and p.strip():
                    phones.add(p.strip())
        except Exception as e:
            log(f"  ⚠️ 查询历史预约失败: {e}")
    
    return sorted(phones)


def select_sync_window(phones, limit=20, slot=None):
    """Rotate cron batches so sorted customers after the first page are not starved."""
    phones = list(phones or [])
    if len(phones) <= limit:
        return phones
    if slot is None:
        slot = int(time.time() // 1800)
    start = (int(slot) * limit) % len(phones)
    return [phones[(start + offset) % len(phones)] for offset in range(limit)]


# ═══════════════════════════════════════════════════════════════════
#  美管加 API 调用
# ═══════════════════════════════════════════════════════════════════

def form_post(path, data):
    """普通的form POST请求"""
    url = f"https://{SERVER}/shair/{path}"
    body = urllib.parse.urlencode(data).encode()
    req = urllib.request.Request(url, data=body, headers={
        "Cookie": load_cookies(),
        "Request-From": "MGJ_SHAIR",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
    })
    with urllib.request.urlopen(req, timeout=15, context=SSL_CTX) as resp:
        return resp.read().decode("utf-8", errors="replace")


def multipart_post(path, json_data, shop_id, retries=2, config_path=None):
    """
    multipart/form-data POST请求。
    通过curl发送，带完整浏览器头+http2以绕过WAF。
    参考plan_server的mp_call实现。
    """
    url = f"https://{SERVER}/shair/{path}"
    boundary = "----MGJSyncBoundary"
    
    body = (
        f"--{boundary}\r\n"
        f"Content-Disposition: form-data; name=\"jsonObj\"\r\n\r\n"
        f"{json.dumps(json_data)}\r\n"
        f"--{boundary}\r\n"
        f"Content-Disposition: form-data; name=\"shopid\"\r\n\r\n"
        f"{shop_id}\r\n"
        f"--{boundary}--\r\n"
    )
    
    tmp = tempfile.NamedTemporaryFile(mode="w", delete=False, suffix=".txt")
    tmp.write(body)
    tmp.close()
    
    cookies = load_cookies(config_path)
    
    cmd = [
        "curl", "-s", "-k", "--connect-timeout", "10", "--max-time", "20",
        "--http2", "-X", "POST", url,
        "-H", f"Cookie: {cookies}",
        "-H", "Request-From: MGJ_SHAIR",
        "-H", f"Content-Type: multipart/form-data; boundary={boundary}",
        "-H", "Accept: application/json, text/plain, */*",
        "-H", "Accept-Language: zh-CN,zh;q=0.9",
        "-H", f"Origin: https://{SERVER}",
        "-H", f"Referer: https://{SERVER}/shair/components/customerRelation/index.html",
        "-H", "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
        "-H", "X-Requested-With: XMLHttpRequest",
        "--data-binary", f"@{tmp.name}"
    ]
    
    try:
        last_error = None
        for attempt in range(retries + 1):
            try:
                out = subprocess.check_output(cmd, timeout=25, stderr=subprocess.STDOUT)
                decoded = out.decode("utf-8", errors="replace")
                try:
                    result = json.loads(decoded)
                except json.JSONDecodeError as exc:
                    if decoded.lstrip().startswith("<"):
                        raise RuntimeError(f"{path}返回HTML拦截页") from exc
                    raise
                if result.get("code") == 0:
                    return result
                if int_number(result.get("code"), -1) == 403:
                    raise RuntimeError(f"{path} code=403 请求被拒绝")
                last_error = RuntimeError(
                    f"{path} code={result.get('code')} "
                    f"{result.get('message') or result.get('msg') or ''}".strip()
                )
            except (subprocess.SubprocessError, json.JSONDecodeError) as exc:
                last_error = exc
            if attempt < retries:
                time.sleep(0.8 * (attempt + 1))
        raise RuntimeError(f"{path}请求失败: {last_error}")
    finally:
        os.unlink(tmp.name)


def search_customer(phone):
    """
    在两家店中搜索客户，返回(cust_id, mem_id, shop_id)或None。
    搜索时带isYY=1参数。
    """
    cookies = load_cookies()
    for sid in SHOP_IDS:
        try:
            html = form_post("consumerHelp!find.action", {
                "searchType": "1", "keyType": "1", "keyword": phone,
                "isYY": "1", "shopId": sid
            })
            m = re.search(r"checkAllow\('(\d+)',\s*'?(\d+)'?,\s*'?(\d+)'?,", html)
            if m:
                return m.group(3), m.group(1), sid  # cust_id, mem_id, shop_id
        except Exception as e:
            log(f"  ⚠️ 搜索shop={sid}失败: {e}")
    return None


def fetch_customer_detail(cust_id, shop_id):
    """
    通过memberDetail!detail.action获取客户完整数据。
    如果WAF拦截（code!=0），返回None表示需要回退。
    """
    try:
        result = multipart_post("memberDetail!detail.action", {
            "memberid": cust_id,
            "freezeType": 0,
            "empId": int_number(session_employee_id()),
            "parentShopId": PARENT_SHOP_ID,
            "shopId": PARENT_SHOP_ID
        }, PARENT_SHOP_ID)
    except Exception as e:
        log(f"  ⚠️ memberDetail请求异常: {e}")
        return None
    
    content = result.get("content") or {}
    member_info = content.get("memberInfo") or {}
    if not member_info:
        return None
    return {
        "member_info": member_info,
        "cards": content.get("cards") or member_info.get("cards") or [],
    }


def unique_strings(values):
    result = []
    seen = set()
    for value in values:
        text = str(value or "").strip()
        if text and text not in seen:
            seen.add(text)
            result.append(text)
    return result


def choose_member_card(cards, fallback_card_id=None):
    """Mirror Meiguanjia's customer-relation card selection logic."""
    valid_cards = [card for card in cards or [] if isinstance(card, dict) and card.get("id")]
    if not valid_cards:
        return fallback_card_id
    if len(valid_cards) > 1 and str(valid_cards[0].get("cardtypeid") or "") == "20151212":
        return valid_cards[1]["id"]
    return valid_cards[0]["id"]


def map_bill_summary(bill):
    date_text, time_text = timestamp_text(bill.get("createDate"))
    raw_json = bill.get("jsonStr")
    if isinstance(raw_json, str):
        try:
            raw_json = json.loads(raw_json)
        except json.JSONDecodeError:
            raw_json = {}
    raw_json = raw_json if isinstance(raw_json, dict) else {}
    staff = unique_strings([raw_json.get("empName")])
    return {
        "id": str(bill.get("id") or bill.get("billno") or ""),
        "source_id": str(bill.get("id") or ""),
        "bill_no": str(bill.get("billno") or ""),
        "date": date_text,
        "time": time_text,
        "amount": number(bill.get("consumefee")),
        "items": [],
        "barber": staff[0] if staff else "",
        "staff": staff,
        "shop": str(bill.get("consumeshopname") or ""),
        "comment": str(bill.get("comment") or ""),
        "bill_type": bill.get("billtype"),
        "consume_type": bill.get("consumeType"),
    }


def select_history_detail_indexes(
    history,
    detail_calls,
    recent_days=HISTORY_RECENT_DAYS,
    slot=None,
    today=None,
):
    """Prioritize the newest bill, then rotate only through recent bills."""
    if not history or detail_calls <= 0:
        return []
    today = today or datetime.now().date()
    cutoff = today - timedelta(days=recent_days)
    recent_indexes = []
    for index, row in enumerate(history):
        try:
            row_date = datetime.strptime(str(row.get("date") or ""), "%Y-%m-%d").date()
        except ValueError:
            continue
        if row_date >= cutoff:
            recent_indexes.append(index)
    pool = recent_indexes or list(range(len(history)))
    indexes = [0]
    candidates = [index for index in pool if index != 0]
    if not candidates:
        return indexes[:detail_calls]
    if slot is None:
        slot = int(time.time() // 1800)
    start = (int(slot) * max(1, detail_calls - 1)) % len(candidates)
    for offset in range(min(detail_calls - 1, len(candidates))):
        indexes.append(candidates[(start + offset) % len(candidates)])
    return indexes


def enrich_bill_history(history_item, shop_id, config_path=HISTORY_CONFIG_PATH):
    bill_id = history_item.get("source_id") or history_item.get("id")
    if not bill_id:
        return history_item
    detail = multipart_post("bill!detail.action", {
        "parentShopId": int(PARENT_SHOP_ID),
        "id": int(bill_id),
        "fromHis": 0,
    }, session_shop_id(config_path), retries=1, config_path=config_path)
    content = detail.get("content") or {}
    item_rows = []
    for item in content.get("details") or []:
        name = str(item.get("itemname") or "").strip()
        if not name:
            continue
        item_rows.append({
            "name": name,
            "quantity": number(item.get("num"), 1),
            "price": number(item.get("price")),
            "list_price": number(item.get("itemPrice")),
        })
    staff = unique_strings(
        [employee.get("empname") for employee in content.get("empfees") or []]
    )
    date_text, time_text = timestamp_text(content.get("consumetime"))
    updated = dict(history_item)
    if date_text:
        updated["date"] = date_text
        updated["time"] = time_text
    updated["items"] = item_rows
    updated["staff"] = staff
    updated["barber"] = staff[0] if staff else updated.get("barber", "")
    updated["shop"] = (
        content.get("consumeshopname")
        or updated.get("shop")
        or SHOP_NAMES.get(str(shop_id), "")
    )
    updated["card_type"] = str(content.get("cardtypename") or "")
    updated["comment"] = str(content.get("comment") or updated.get("comment") or "")
    return updated


def fetch_service_history(
    cust_id,
    member_card_id,
    billing_shop_id,
    detail_calls=HISTORY_DETAIL_CALLS,
    config_path=HISTORY_CONFIG_PATH,
):
    """Fetch bills through the read-only history session and enrich recent rows."""
    if not member_card_id:
        raise RuntimeError("缺少会员卡ID，无法查询消费记录")
    bills = multipart_post("member!queryMemberBillListnew.action", {
        "pageNum": 1,
        "pageSize": 99999,
        "memberid": cust_id,
        "shopid": billing_shop_id,
        "billstatus": -1,
        "billtype": -1,
        "timeUnLimit": 1,
        "memberCardId": int(member_card_id),
        "startDate": HISTORY_START_DATE,
        "endDate": datetime.now().strftime("%Y-%m-%d"),
        "isFromOpenCard": 0,
    }, session_shop_id(config_path), config_path=config_path)
    rows = bills.get("content")
    if not isinstance(rows, list):
        raise RuntimeError("消费记录接口返回格式异常")
    history = [map_bill_summary(row) for row in rows]
    history = [row for row in history if row.get("id") and row.get("date")]
    history.sort(
        key=lambda row: (row.get("date", ""), row.get("time", ""), row.get("id", "")),
        reverse=True,
    )
    detail_indexes = select_history_detail_indexes(history, detail_calls)
    for index in detail_indexes:
        try:
            history[index] = enrich_bill_history(
                history[index],
                billing_shop_id,
                config_path=config_path,
            )
        except Exception as exc:
            log(f"  ⚠️ 账单{history[index].get('id')}明细读取失败，保留账单摘要: {exc}")
    return history[:HISTORY_RECORD_LIMIT]


def fetch_cashier_html(phone, shop_id):
    """
    现金页HTML回退：当memberDetail被WAF拦截时，
    用不带isYY参数的搜索获取现金页HTML。
    
    从HTML中提取：
      - hidden input: name, consumefee, lastconsumetime
      - table tbody#lciList: 疗程套餐数据
    """
    html = form_post("consumerHelp!find.action", {
        "searchType": "1", "keyType": "1", "keyword": phone,
        "shopId": shop_id
    })
    return html


def parse_cashier_html(html):
    """从现金页HTML提取客户数据"""
    result = {}
    
    # hidden inputs
    def hv(name):
        m = re.search(r'<input[^>]*id="' + re.escape(name) + r'"[^>]*value="([^"]*)"', html)
        return m.group(1).strip() if m else ""
    
    result["name"] = hv("name")
    
    fee_str = hv("consumefee")
    result["consumefee"] = float(fee_str) if fee_str and fee_str.replace(".", "", 1).isdigit() else 0
    
    last_str = hv("lastconsumetime")
    if last_str:
        try:
            # Format: "Thu May 21 19:25:42 CST 2026"
            clean = re.sub(r'\s+[A-Z]{3,4}\s+', ' ', last_str)
            result["lastconsumetime"] = time.strftime("%Y-%m-%d", 
                time.strptime(clean.strip(), "%a %b %d %H:%M:%S %Y"))
        except Exception:
            result["lastconsumetime"] = last_str
    else:
        result["lastconsumetime"] = ""
    
    # 疗程套餐：从lciList表格提取
    treats = []
    lci = re.search(r'<tbody id="lciList">(.*?)</tbody>', html, re.DOTALL)
    if lci:
        trs = re.findall(r'<tr[^>]*>(.*?)</tr>', lci.group(1), re.DOTALL)
        for tr in trs:
            tds = re.findall(r'<td[^>]*>(.*?)</td>', tr, re.DOTALL)
            if len(tds) >= 4:
                item_name = re.sub(r'<[^>]+>', '', tds[0]).strip()
                item_name = re.sub(r'\s*\(\d+\)\s*', '', item_name).strip()
                total_str = re.sub(r'<[^>]+>', '', tds[2]).strip()
                left_str = re.sub(r'<[^>]+>', '', tds[3]).strip()
                total = int(total_str) if total_str.isdigit() else 0
                left = int(left_str) if left_str.isdigit() else 0
                if total > 0 and item_name:
                    treats.append({
                        "name": item_name,
                        "total": total,
                        "left": left
                    })
    result["treats"] = treats
    return result


# ═══════════════════════════════════════════════════════════════════
#  获取客户完整数据（核心逻辑）
# ═══════════════════════════════════════════════════════════════════

def get_customer_full(phone, history_detail_calls=HISTORY_DETAIL_CALLS):
    """
    获取客户的完整数据。
    
    路径：
      1. 搜索客户 → 获取custId
      2. memberDetail!detail.action → 完整JSON（有consumetimes/avgfee/treatMentItems）
      3. 失败（WAF）→ 现金页HTML回退（有consumefee但无consumetimes）
    
    返回dict:
      {
        "found": bool,
        "name": str,
        "total_visits": int,        # consumetimes
        "total_consumption": float, # 历史总消费
        "avg_fee": float,           # 客单价
        "last_visit_date": str,     # 最后到店时间
        "card_packages": list,      # 疗程列表 [{name, total, left}, ...]
        "source": str               # "memberDetail" 或 "cashier"
      }
    """
    result = search_customer(phone)
    if not result:
        return {"found": False, "message": "未搜索到该客户"}
    
    cust_id, mem_id, shop_id = result
    log(f"  找到客户 custId={cust_id}, shopId={shop_id}")
    
    # 主路径：memberDetail
    detail_data = fetch_customer_detail(cust_id, shop_id)
    
    if detail_data:
        # memberDetail成功 — 有完整数据
        member_info = detail_data["member_info"]
        name = (
            member_info.get("membername", "")
            or member_info.get("custName", "")
            or member_info.get("name", "")
            or ""
        )
        
        # 如果memberDetail没返回名字，尝试从现金页HTML获取
        if not name:
            try:
                cashier = parse_cashier_html(fetch_cashier_html(phone, shop_id))
                if cashier.get("name"):
                    name = cashier["name"]
                    log(f"  从现金页获取到姓名: {name}")
            except Exception:
                pass
        
        consumetimes = int(member_info.get("consumetimes", 0) or 0)
        avgfee = float(member_info.get("avgfee", 0) or 0)
        
        # total_consumption = consumetimes × avgfee（这是唯一历史总消费来源）
        total_consumption = round(consumetimes * avgfee, 2)
        
        # 最后到店时间（毫秒时间戳）
        last_ts = member_info.get("lastconsumetime", 0)
        last_visit = ""
        if last_ts and last_ts > 1000000000000:
            last_visit = time.strftime("%Y-%m-%d %H:%M", time.localtime(last_ts / 1000))
        
        # 疗程套餐。memberDetail成功时，空数组也是权威结果。
        treats = member_info.get("treatMentItems", []) or []
        card_packages = []
        for t in treats:
            item_name = t.get("itemname", "").strip()
            leavetimes = int(t.get("leavetimes", 0) or 0)
            sumtimes = int(t.get("sumtimes", 0) or 0)
            if item_name and sumtimes > 0:
                package_name = str(t.get("treatPackageName") or "").strip()
                source_id = (
                    t.get("id")
                    or t.get("treatPackageId")
                    or t.get("packageId")
                    or t.get("itemid")
                )
                card_packages.append({
                    "id": str(source_id or f"{cust_id}:{item_name}:{sumtimes}"),
                    "name": item_name,
                    "package_name": package_name,
                    "total": sumtimes,
                    "left": leavetimes,
                    "used": max(0, sumtimes - leavetimes),
                    "shop": str(t.get("treatShopName") or SHOP_NAMES.get(shop_id, "")),
                    "expire_date": timestamp_date(t.get("validdate")),
                    "bought_at": timestamp_date(t.get("buyDate")),
                    "status": "active" if leavetimes > 0 else "used",
                })

        cards = detail_data.get("cards") or []
        card_id = choose_member_card(cards, mem_id)
        billing_shop_id = str(member_info.get("shopid") or shop_id)
        service_history = []
        history_complete = False
        try:
            service_history = fetch_service_history(
                cust_id,
                card_id,
                billing_shop_id,
                detail_calls=history_detail_calls,
            )
            history_complete = True
            log(f"  消费记录: {len(service_history)}笔")
        except Exception as exc:
            log(f"  ⚠️ 消费记录读取失败，将保留档案原数据: {exc}")
        
        return {
            "found": True,
            "name": name,
            "shop_name": SHOP_NAMES.get(shop_id, ""),
            "barber_name": str(member_info.get("mgjlastserver") or ""),
            "total_visits": consumetimes,
            "total_consumption": total_consumption,
            "avg_fee": avgfee,
            "last_visit_date": last_visit if last_visit else None,
            "card_packages": card_packages,
            "service_history": service_history,
            "source": "memberDetail",
            "source_customer_id": str(cust_id),
            "_packages_complete": True,
            "_history_complete": history_complete,
        }
    
    # 回退路径：现金页HTML
    log(f"  memberDetail被拦截，回退到现金页HTML...")
    try:
        cashier = parse_cashier_html(fetch_cashier_html(phone, shop_id))
    except Exception as e:
        return {"found": False, "message": f"现金页回退失败: {e}"}
    
    if cashier.get("name") or cashier.get("consumefee", 0) > 0:
        # 现金页有consumefee（历史总消费）但没有consumetimes
        return {
            "found": True,
            "name": cashier.get("name", ""),
            "shop_name": SHOP_NAMES.get(shop_id, ""),
            "total_visits": 0,       # 现金页没有到店次数
            "total_consumption": cashier.get("consumefee", 0),
            "avg_fee": 0,            # 现金页没有均价
            "last_visit_date": cashier.get("lastconsumetime", ""),
            "card_packages": cashier.get("treats", []),
            "service_history": [],
            "source": "cashier",
            "source_customer_id": str(cust_id),
            "_packages_complete": bool(cashier.get("treats")),
            "_history_complete": False,
            "_note": "现金页回退：缺少total_visits和avg_fee"
        }
    
    return {"found": False, "message": "查询客户详情失败"}


# ═══════════════════════════════════════════════════════════════════
#  写入Supabase
# ═══════════════════════════════════════════════════════════════════

def history_key(item):
    source_id = str(item.get("source_id") or item.get("id") or "").strip()
    if source_id:
        return f"id:{source_id}"
    item_names = ",".join(
        str(row.get("name") or row) if isinstance(row, dict) else str(row)
        for row in item.get("items") or []
    )
    return "|".join([
        str(item.get("date") or ""),
        str(item.get("time") or ""),
        str(item.get("amount") or ""),
        item_names,
        str(item.get("shop") or ""),
    ])


def merge_history(existing_history, incoming_history):
    existing_by_key = {
        history_key(item): item
        for item in parse_array(existing_history)
        if isinstance(item, dict) and history_key(item)
    }
    merged = []
    seen = set()
    for incoming in parse_array(incoming_history):
        if not isinstance(incoming, dict):
            continue
        key = history_key(incoming)
        if not key or key in seen:
            continue
        previous = existing_by_key.get(key, {})
        row = dict(previous)
        for field, value in incoming.items():
            if value not in (None, "", []):
                row[field] = value
            elif field not in row:
                row[field] = value
        merged.append(row)
        seen.add(key)
    for key, previous in existing_by_key.items():
        if key not in seen:
            merged.append(previous)
    merged.sort(
        key=lambda row: (
            str(row.get("date") or ""),
            str(row.get("time") or ""),
            str(row.get("source_id") or row.get("id") or ""),
        ),
        reverse=True,
    )
    return merged[:HISTORY_RECORD_LIMIT]


def merge_notes(existing_notes, avg_fee, source_customer_id):
    if isinstance(existing_notes, (dict, list)):
        existing_text = json.dumps(existing_notes, ensure_ascii=False)
    else:
        existing_text = str(existing_notes or "").strip()
    parts = [
        part.strip()
        for part in re.split(r"\s*\|\s*", existing_text)
        if part.strip() and not part.strip().startswith("均消¥")
    ]
    if avg_fee > 0:
        parts.insert(0, f"均消¥{avg_fee:.0f}")
    if source_customer_id and not any(part.startswith("美管加客户ID:") for part in parts):
        parts.append(f"美管加客户ID:{source_customer_id}")
    return " | ".join(parts)


SERVICE_TYPE_KEYWORDS = {
    "perm": ("烫", "热塑", "冷烫", "纹理", "软化"),
    "dye": ("染", "补色", "漂", "挑染", "盖白"),
    "care": ("护理", "护发", "酸护", "蛋白", "头疗", "水疗"),
}


def service_types_for_history(item):
    """Return the regulated service types proved by Meiguanjia bill line items."""
    names = []
    for row in parse_array((item or {}).get("items")):
        if isinstance(row, dict):
            name = str(row.get("name") or "").strip()
        else:
            name = str(row or "").strip()
        if name:
            names.append(name)
    joined = " ".join(names)
    return [
        service_type
        for service_type, keywords in SERVICE_TYPE_KEYWORDS.items()
        if any(keyword in joined for keyword in keywords)
    ]


def build_service_records(profile):
    """Flatten authoritative perm/dye/care bills for daily hair-form reconciliation."""
    records = []
    for item in parse_array((profile or {}).get("service_history")):
        if not isinstance(item, dict):
            continue
        source_id = str(item.get("source_id") or item.get("id") or "").strip()
        service_date = str(item.get("date") or "").strip()
        service_types = service_types_for_history(item)
        if not source_id or not service_date or not service_types:
            continue
        records.append({
            "source_id": source_id,
            "bill_no": str(item.get("bill_no") or ""),
            "customer_phone": str(profile.get("phone") or "").strip(),
            "customer_name": str(profile.get("name") or "").strip(),
            "shop_name": str(item.get("shop") or profile.get("shop_name") or "").strip(),
            "service_date": service_date,
            "service_time": str(item.get("time") or "").strip() or None,
            "staff": unique_strings(item.get("staff") or [item.get("barber")]),
            "items": parse_array(item.get("items")),
            "service_types": service_types,
            "amount": number(item.get("amount")),
            "source": "meiguanjia",
            "synced_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        })
    return records


def upsert_service_records(profile):
    records = build_service_records(profile)
    if not records:
        return 0
    supabase_post(f"{SERVICE_TABLE}?on_conflict=source_id", records)
    return len(records)


def merge_profile(existing, incoming, fill_missing_only=False):
    """Merge only authoritative fields; partial API failures never erase arrays."""
    existing = existing or {}
    existing_packages = parse_array(existing.get("card_packages"))
    existing_history = parse_array(existing.get("service_history"))
    profile = {
        "phone": incoming["phone"],
        "name": existing.get("name") or incoming.get("name") or "",
        "shop_name": existing.get("shop_name") or incoming.get("shop_name") or "",
        "barber_name": existing.get("barber_name") or incoming.get("barber_name") or "",
        "total_visits": existing.get("total_visits") or 0,
        "total_consumption": existing.get("total_consumption") or 0,
        "last_visit_date": existing.get("last_visit_date") or incoming.get("last_visit_date"),
        "card_packages": existing_packages,
        "service_history": existing_history,
        "last_updated": datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    if not fill_missing_only and incoming.get("name"):
        profile["name"] = incoming["name"]
    if not fill_missing_only and incoming.get("shop_name"):
        profile["shop_name"] = incoming["shop_name"]
    if not fill_missing_only and incoming.get("barber_name"):
        profile["barber_name"] = incoming["barber_name"]
    if not fill_missing_only and incoming.get("last_visit_date"):
        profile["last_visit_date"] = incoming["last_visit_date"]
    if int_number(incoming.get("total_visits")) > 0 and (
        not fill_missing_only or int_number(existing.get("total_visits")) <= 0
    ):
        profile["total_visits"] = int_number(incoming.get("total_visits"))
    if number(incoming.get("total_consumption")) > 0 and (
        not fill_missing_only or number(existing.get("total_consumption")) <= 0
    ):
        profile["total_consumption"] = number(incoming.get("total_consumption"))
    if incoming.get("_packages_complete") and (not fill_missing_only or not existing_packages):
        profile["card_packages"] = parse_array(incoming.get("card_packages"))
    if incoming.get("_history_complete") and (not fill_missing_only or not existing_history):
        profile["service_history"] = merge_history(
            existing.get("service_history"),
            incoming.get("service_history"),
        )
    if fill_missing_only and existing.get("notes"):
        profile["notes"] = existing["notes"]
    else:
        profile["notes"] = merge_notes(
            existing.get("notes"),
            number(incoming.get("avg_fee")),
            incoming.get("source_customer_id"),
        )
    return profile


def upsert_customer(data, fill_missing_only=False):
    """
    将客户数据写入Supabase customer_profiles表。
    存在则更新，不存在则新增。
    """
    phone = data["phone"]
    filter_path = f"{TABLE}?phone=eq.{urllib.parse.quote(phone)}"
    
    # 查是否已存在
    try:
        rows = supabase_get(
            f"{filter_path}&select=id,phone,name,shop_name,barber_name,total_visits,"
            "total_consumption,last_visit_date,card_packages,service_history,notes,last_updated&limit=1"
        )
    except Exception as e:
        return False, f"查询失败: {e}"

    existing = rows[0] if rows else None
    profile = merge_profile(existing, data, fill_missing_only=fill_missing_only)
    
    try:
        if existing:
            supabase_patch(filter_path, profile)
            action = "updated"
        else:
            supabase_post(f"{TABLE}?on_conflict=phone", profile)
            action = "created"
        try:
            service_count = upsert_service_records(profile)
            if service_count:
                action += f" + {service_count} service records"
        except Exception as service_exc:
            # Customer archives must keep syncing during a staged schema rollout.
            log(f"  ⚠️ 烫染护对账明细写入失败，客户档案已保留: {service_exc}")
        return True, action
    except Exception as e:
        return False, str(e)


# ═══════════════════════════════════════════════════════════════════
#  验证函数
# ═══════════════════════════════════════════════════════════════════

def validate_customer(phone):
    """验证一个客户的消费数据是否合理"""
    data = get_customer_full(phone)
    if not data.get("found"):
        return {"valid": False, "error": data.get("message", "未找到")}
    
    issues = []
    v = data.get("total_visits", 0)
    c = data.get("total_consumption", 0)
    a = data.get("avg_fee", 0)
    lv = data.get("last_visit_date", "")
    
    if v > 0 and c == 0:
        issues.append(f"⚠️ {v}次到店但总消费为0")
    if v > 0 and c > 0:
        implied_avg = c / v
        if a > 0 and abs(implied_avg - a) / max(a, implied_avg) > 0.2:
            issues.append(f"⚠️ 隐含均消¥{implied_avg:.0f}≠系统均消¥{a:.0f}（偏差>{a:.0f}）")
    if v > 0 and not lv:
        issues.append(f"⚠️ {v}次到店但无最后到店时间")
    if v > 0 and a < 10:
        issues.append(f"⚠️ 均消¥{a}过低")
    if data.get("source") == "cashier":
        issues.append("⚠️ 当前仅取得现金页回退数据，消费明细未完成")
    elif v > 0 and not data.get("_history_complete"):
        issues.append("⚠️ 消费记录接口未完成")
    
    # 次数×均消≈总消费
    if v > 0 and a > 0:
        computed = round(v * a, 2)
        if abs(computed - c) > 0.01:
            issues.append(f"ℹ️ {v}次×¥{a}=¥{computed} vs total_consumption=¥{c}")
    
    result = {
        "valid": len(issues) == 0,
        "phone": phone,
        "name": data.get("name", ""),
        "total_visits": v,
        "total_consumption": c,
        "avg_fee": a,
        "last_visit": lv,
        "packages": len(data.get("card_packages", [])),
        "source": data.get("source", ""),
        "issues": issues
    }
    return result


# ═══════════════════════════════════════════════════════════════════
#  主逻辑
# ═══════════════════════════════════════════════════════════════════

def sync_phones(phones, label="同步"):
    """同步一批客户的手机号"""
    total = len(phones)
    ok = 0
    fail = 0
    skipped = 0
    
    log(f"📞 共{total}个客户需要{label}")
    
    for i, phone in enumerate(phones):
        log(f"[{i+1}/{total}] {phone}...")
        
        try:
            data = get_customer_full(phone)
            if not data.get("found"):
                log(f"  ❌ {data.get('message', '查询失败')}")
                fail += 1
                continue
            
            profile_data = dict(data)
            profile_data["phone"] = phone
            
            success, action = upsert_customer(profile_data)
            if success:
                v = data["total_visits"]
                c = data["total_consumption"]
                s = data.get("source", "?")
                log(f"  ✅ ({action}) {v}次 ¥{c:.0f} [{s}]")
                ok += 1
            else:
                log(f"  ❌ 写入失败: {action}")
                fail += 1
        except Exception as e:
            log(f"  ❌ 同步异常: {e}")
            fail += 1
        
        # API调用间隔，避免被墙
        if i < total - 1:
            time.sleep(1)
    
    return ok, fail, skipped


def load_backfill_status():
    try:
        with open(BACKFILL_STATUS_PATH, encoding="utf-8") as status_file:
            value = json.load(status_file)
            return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def save_backfill_status(**updates):
    status = load_backfill_status()
    status.update(updates)
    status["updated_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
    tmp_path = BACKFILL_STATUS_PATH + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as status_file:
        json.dump(status, status_file, ensure_ascii=False, indent=2)
    os.replace(tmp_path, BACKFILL_STATUS_PATH)


def get_backfill_candidates(target_count, start_id=0, scan_size=500):
    candidates = []
    cursor = int_number(start_id)
    reached_end = False
    while len(candidates) < target_count:
        rows = supabase_get(
            f"{TABLE}?select=id,phone,name,card_packages,service_history"
            f"&id=gt.{cursor}&order=id.asc&limit={scan_size}",
            timeout=20,
        )
        if not rows:
            reached_end = True
            break
        target_reached = False
        for row in rows:
            cursor = max(cursor, int_number(row.get("id")))
            phone = str(row.get("phone") or "").strip()
            if not phone:
                continue
            if parse_array(row.get("card_packages")) and parse_array(row.get("service_history")):
                continue
            candidates.append(row)
            if len(candidates) >= target_count:
                target_reached = True
                break
        if target_reached:
            break
        if len(rows) < scan_size:
            reached_end = True
            break
    return candidates, cursor, reached_end


def run_backfill(limit=20):
    """Fill missing arrays only, using a persistent id checkpoint."""
    state = load_backfill_status()
    start_id = int_number(state.get("last_id"))
    candidates, scanned_to, reached_end = get_backfill_candidates(limit, start_id=start_id)
    log(f"🧩 缺失字段回填: 从id>{start_id}扫描，待处理{len(candidates)}个")
    ok = 0
    fail = 0
    last_processed_id = start_id
    for index, row in enumerate(candidates):
        phone = str(row.get("phone") or "").strip()
        row_id = int_number(row.get("id"))
        log(f"[{index + 1}/{len(candidates)}] id={row_id} {phone}...")
        try:
            data = get_customer_full(phone, history_detail_calls=0)
            if not data.get("found"):
                log(f"  ❌ {data.get('message', '查询失败')}")
                fail += 1
            else:
                data["phone"] = phone
                success, action = upsert_customer(data, fill_missing_only=True)
                if success:
                    log(
                        f"  ✅ ({action}) 消费{len(data.get('service_history') or [])}笔 "
                        f"套餐{len(data.get('card_packages') or [])}个"
                    )
                    ok += 1
                else:
                    log(f"  ❌ 写入失败: {action}")
                    fail += 1
        except Exception as exc:
            log(f"  ❌ 回填异常: {exc}")
            fail += 1
        last_processed_id = row_id
        save_backfill_status(
            last_id=last_processed_id,
            last_phone=phone,
            success_total=int_number(state.get("success_total")) + ok,
            failed_total=int_number(state.get("failed_total")) + fail,
            cycle_complete=False,
        )
        if index < len(candidates) - 1:
            time.sleep(2)

    if not candidates and scanned_to > start_id:
        last_processed_id = scanned_to
    if reached_end:
        save_backfill_status(
            last_id=max(last_processed_id, scanned_to),
            last_phone="",
            cycle_complete=True,
            completed_at=datetime.now().astimezone().isoformat(timespec="seconds"),
        )
    elif not candidates:
        save_backfill_status(last_id=scanned_to, cycle_complete=False)
    return ok, fail, len(candidates)


def get_recent_hair_record_phones(days_back=HISTORY_RECENT_DAYS):
    start = (datetime.now() - timedelta(days=days_back)).strftime("%Y-%m-%d")
    rows = supabase_get(
        "hair_records?select=customer_phone"
        "&status=neq.deleted"
        f"&created_at=gte.{start}T00:00:00"
        "&order=created_at.desc&limit=1000"
    )
    result = []
    for row in rows:
        phone = str(row.get("customer_phone") or "").strip()
        if phone and phone not in result:
            result.append(phone)
    return result


def select_service_refresh_phones(hair_phones, booking_phones, limit, slot):
    """Reserve most of each small refresh batch for recent hair-form customers."""
    hair_limit = min(len(hair_phones), max(1, (limit + 1) // 2))
    selected = select_sync_window(hair_phones, limit=hair_limit, slot=slot)
    remaining = limit - len(selected)
    booking_pool = [phone for phone in booking_phones if phone not in selected]
    selected.extend(select_sync_window(booking_pool, limit=remaining, slot=slot))
    return selected


def run_service_refresh(limit=SERVICE_REFRESH_LIMIT):
    """Refresh recent bill details in small rotating batches for reconciliation."""
    hair_phones = get_recent_hair_record_phones()
    booking_phones = get_booking_phones(days_back=HISTORY_RECENT_DAYS, days_forward=0)
    selected = select_service_refresh_phones(
        hair_phones,
        booking_phones,
        limit,
        int(time.time() // 3600),
    )
    log(
        f"🧾 近期消费明细刷新: 本批{len(selected)}人"
        f"（发质档案候选{len(hair_phones)}，预约候选{len(booking_phones)}）"
    )
    ok = 0
    fail = 0
    service_rows = 0
    for index, phone in enumerate(selected):
        log(f"[{index + 1}/{len(selected)}] 刷新消费明细...")
        try:
            data = get_customer_full(
                phone,
                history_detail_calls=SERVICE_REFRESH_DETAIL_CALLS,
            )
            if not data.get("found"):
                fail += 1
                continue
            data["phone"] = phone
            success, action = upsert_customer(data)
            if success:
                ok += 1
                service_rows += len(build_service_records(data))
                log(f"  ✅ {action}")
            else:
                fail += 1
                log(f"  ❌ {action}")
        except Exception as exc:
            fail += 1
            log(f"  ❌ 近期明细刷新失败: {exc}")
        if index < len(selected) - 1:
            time.sleep(1)
    return ok, fail, service_rows


def run_validate(phones, label="验证"):
    """验证一批客户的数据"""
    total = len(phones)
    all_issues = []
    ok_count = 0
    
    log(f"🔍 {label} {total}个客户...")
    
    for i, phone in enumerate(phones):
        result = validate_customer(phone)
        if result.get("valid"):
            log(f"  ✅ {phone}: {result['name']} {result['total_visits']}次 ¥{result['total_consumption']:.0f}")
            ok_count += 1
        else:
            log(f"  {'⚠️' if not result['valid'] else '✅'} {phone}: {result['name']}")
            for issue in result.get("issues", []):
                log(f"    {issue}")
                all_issues.append(f"[{phone}] {issue}")
        
        if i < total - 1:
            time.sleep(0.5)
    
    return ok_count, all_issues


# ═══════════════════════════════════════════════════════════════════
#  入口
# ═══════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "sync"
    run_lock = acquire_run_lock()
    if run_lock is None:
        log("⏭ 已有同步任务运行，本次跳过")
        sys.exit(0)
    write_status("running", mode=mode, pid=os.getpid())
    final_status = "healthy"
    status_details = {}
    
    if mode == "backfill":
        batch_limit = int_number(sys.argv[2], 20) if len(sys.argv) > 2 else 20
        batch_limit = max(1, min(batch_limit, 100))
        log(f"🧩 缺失消费/套餐断点回填，批次上限{batch_limit}")
        ok, fail, processed = run_backfill(batch_limit)
        status_details = {"success": ok, "failed": fail, "processed": processed}
        if fail and not ok:
            final_status = "degraded"

    elif mode == "services":
        batch_limit = int_number(sys.argv[2], SERVICE_REFRESH_LIMIT) if len(sys.argv) > 2 else SERVICE_REFRESH_LIMIT
        batch_limit = max(1, min(batch_limit, 10))
        ok, fail, service_rows = run_service_refresh(batch_limit)
        status_details = {
            "success": ok,
            "failed": fail,
            "service_records_seen": service_rows,
        }
        if fail and not ok:
            final_status = "degraded"

    elif mode == "full":
        # 全量同步：近90天所有有手机号的客户
        log("🔄 全量同步模式")
        phones = get_booking_phones(days_back=90, days_forward=7)
        log(f"📞 共 {len(phones)} 个客户手机号")
        if phones:
            ok, fail, skipped = sync_phones(phones, "全量同步")
            status_details = {"success": ok, "failed": fail, "skipped": skipped}
            if fail:
                final_status = "degraded"
    
    elif mode == "one":
        # 同步单个客户
        phone = sys.argv[2] if len(sys.argv) > 2 else ""
        if not phone:
            log("用法: python3 sync_mgj_all.py one <手机号>")
            sys.exit(1)
        log(f"🔄 同步单个客户: {phone}")
        data = get_customer_full(phone)
        if data.get("found"):
            log(f"  ✅ {data['name']}: {data['total_visits']}次 ¥{data['total_consumption']:.0f} [来源:{data.get('source','?')}]")
            if data.get("card_packages"):
                log(f"  疗程: {len(data['card_packages'])}个")
                for t in data["card_packages"]:
                    log(f"    · {t['name']} (剩{t['left']}/{t['total']}次)")
            profile_data = dict(data)
            profile_data["phone"] = phone
            success, action = upsert_customer(profile_data)
            log(f"  写入: {action}" if success else f"  ❌ 写入失败: {action}")
            status_details = {"success": 1 if success else 0, "failed": 0 if success else 1}
            if not success:
                final_status = "degraded"
        else:
            log(f"  ❌ {data.get('message', '查询失败')}")
            status_details = {"success": 0, "failed": 1}
            final_status = "degraded"
    
    elif mode == "validate":
        # 验证单个客户
        phone = sys.argv[2] if len(sys.argv) > 2 else ""
        if phone:
            result = validate_customer(phone)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            final_status = "healthy" if result.get("valid") else "degraded"
        else:
            # 验证所有已写入的客户数据
            log("🔍 验证所有已同步客户...")
            try:
                records = supabase_get(
                    f"{TABLE}?select=phone,total_visits,total_consumption,last_visit_date,notes&limit=500")
                log(f"📊 共 {len(records)} 条记录")
                issues = []
                for r in records:
                    v = r.get("total_visits", 0) or 0
                    c = r.get("total_consumption", 0) or 0
                    p = r.get("phone", "?")
                    # Try to extract avg_fee from notes
                    notes = r.get("notes", "") or ""
                    avg_from_notes = 0
                    m_avg = re.search(r"均消¥(\d+)", notes)
                    if m_avg:
                        avg_from_notes = float(m_avg.group(1))
                    if v > 0 and c == 0:
                        issues.append(f"[{p}] {v}次到店但消费为0")
                    if v > 0 and c > 0:
                        implied_avg = c / v
                        if implied_avg < 10:
                            issues.append(f"[{p}] 隐含均消¥{implied_avg:.0f}过低({v}次¥{c:.0f})")
                        if avg_from_notes > 0 and abs(implied_avg - avg_from_notes) / max(avg_from_notes, implied_avg) > 0.2:
                            issues.append(f"[{p}] {v}次 ¥{c:.0f}: 隐含均消¥{implied_avg:.0f}≠系统均消¥{avg_from_notes:.0f}")
                if issues:
                    log(f"⚠️ 发现 {len(issues)} 个问题:")
                    for issue in issues:
                        log(f"  {issue}")
                else:
                    log("✅ 所有数据合理，无问题")
            except Exception as e:
                log(f"❌ 验证失败: {e}")
                final_status = "degraded"
    
    else:
        # 增量同步（默认cron模式）：只查今天+未来2天，最多20个
        log("⏱ 增量同步模式（cron）")
        phones = get_booking_phones(days_back=1, days_forward=2)
        if len(phones) > 20:
            total_phones = len(phones)
            phones = select_sync_window(phones, limit=20)
            log(f"  轮换同步20个（共{total_phones}个）")
        log(f"📞 获取到 {len(phones)} 个客户手机号")
        if phones:
            ok, fail, skipped = sync_phones(phones, "增量同步")
            log(f"\n📊 完成: ✅ {ok} 成功  ❌ {fail} 失败  ⏭ {skipped} 跳过")
            status_details = {"success": ok, "failed": fail, "skipped": skipped}
            if fail:
                final_status = "degraded"
        else:
            log("没有需要同步的客户")

    write_status(final_status, mode=mode, **status_details)
    if final_status != "healthy":
        sys.exit(1)
