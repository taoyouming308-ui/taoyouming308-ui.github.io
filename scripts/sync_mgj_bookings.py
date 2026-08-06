#!/usr/bin/env python3
"""Synchronize Meiguanjia appointments to Supabase without unsafe deletion."""

import fcntl
import http.cookiejar
import json
import os
import socket
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone


CONFIG_PATH = os.path.expanduser("~/.hermes/meiguanjia-config.json")
AUTH_PATH = os.path.expanduser("~/.hermes/meiguanjia-auth.json")
STATUS_PATH = os.path.expanduser("~/.hermes/sync_bookings_status.json")
RUN_LOCK_PATH = "/tmp/sync_mgj_bookings.lock"
SESSION_LOCK_PATH = "/tmp/sync_mgj_all.lock"
DEFAULT_SERVER = "vip12.meiguanjia.net"
SUPABASE_URL = "https://pdssrmpeiuwvxzsgschm.supabase.co"
SUPABASE_KEY = "sb_publishable_MDx4d2QzQpTojF8yLRHIqw_uKQW7A7t"
SHOPS = [
    {"shopId": "1009951", "name": "自由手艺人", "parentShopId": "1103470"},
    {"shopId": "1837032", "name": "向里造型", "parentShopId": "1103470"},
]
CHINA_TZ = timezone(timedelta(hours=8))
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 Chrome/148.0.0.0 Safari/537.36"
)
NETWORK_RETRY_DELAYS = (1, 3)
RUN_BUDGET_SECONDS = 105
RUN_DEADLINE = None


def now_iso():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def load_json(path):
    with open(path, encoding="utf-8") as source:
        value = json.load(source)
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def atomic_write_json(path, value, mode=0o600):
    directory = os.path.dirname(path)
    os.makedirs(directory, exist_ok=True)
    fd, temp_path = tempfile.mkstemp(prefix=".mgj-", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as target:
            json.dump(value, target, ensure_ascii=False, indent=2)
            target.write("\n")
            target.flush()
            os.fsync(target.fileno())
        os.chmod(temp_path, mode)
        os.replace(temp_path, path)
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)


def write_status(status, **details):
    previous_failures = 0
    try:
        previous_failures = int(load_json(STATUS_PATH).get("consecutive_failures") or 0)
    except (OSError, ValueError, json.JSONDecodeError):
        pass
    if status == "healthy":
        consecutive_failures = 0
    elif status in ("partial", "degraded"):
        consecutive_failures = previous_failures + 1
    else:
        consecutive_failures = previous_failures
    payload = {
        "status": status,
        "updated_at": now_iso(),
        "consecutive_failures": consecutive_failures,
    }
    payload.update(details)
    atomic_write_json(STATUS_PATH, payload)


def acquire_lock(path, blocking=False):
    lock_file = open(path, "w", encoding="utf-8")
    flags = fcntl.LOCK_EX
    if not blocking:
        flags |= fcntl.LOCK_NB
    try:
        fcntl.flock(lock_file.fileno(), flags)
    except BlockingIOError:
        lock_file.close()
        return None
    lock_file.write(str(os.getpid()))
    lock_file.flush()
    return lock_file


def release_lock(lock_file):
    if lock_file is None:
        return
    fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
    lock_file.close()


def remaining_run_seconds():
    if RUN_DEADLINE is None:
        return None
    return max(0.0, RUN_DEADLINE - time.monotonic())


def run_budget_available(minimum=1.0):
    remaining = remaining_run_seconds()
    return remaining is None or remaining >= minimum


def is_transient_network_error(exc):
    if isinstance(exc, urllib.error.HTTPError):
        return exc.code in (408, 425, 429) or 500 <= exc.code <= 599
    if isinstance(exc, urllib.error.URLError):
        return is_transient_network_error(exc.reason) or isinstance(
            exc.reason, (OSError, TimeoutError)
        )
    return isinstance(
        exc,
        (TimeoutError, socket.timeout, ConnectionResetError, ConnectionAbortedError),
    )


def with_network_retries(operation, delays=NETWORK_RETRY_DELAYS):
    for attempt in range(len(delays) + 1):
        try:
            return operation()
        except Exception as exc:
            if attempt >= len(delays) or not is_transient_network_error(exc):
                raise
            delay = delays[attempt]
            remaining = remaining_run_seconds()
            if remaining is not None and remaining <= delay + 1:
                raise
            time.sleep(delay)


def request_json(url, cookie="", data=None, timeout=20):
    headers = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "User-Agent": USER_AGENT,
    }
    if cookie:
        headers["Cookie"] = cookie
    if data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8"
    request = urllib.request.Request(url, data=data, headers=headers)
    def perform():
        remaining = remaining_run_seconds()
        if remaining is not None and remaining < 1:
            raise TimeoutError("预约同步运行时间已到105秒上限")
        effective_timeout = timeout if remaining is None else max(1, min(timeout, int(remaining)))
        with urllib.request.urlopen(
            request,
            timeout=effective_timeout,
            context=ssl.create_default_context(),
        ) as response:
            return json.loads(response.read().decode("utf-8", errors="replace"))
    return with_network_retries(perform)


def check_session(server, cookie):
    if not cookie:
        return False
    try:
        result = request_json(
            f"https://{server}/shair/metedata!reservationMetadata.action",
            cookie=cookie,
            timeout=10,
        )
        return result.get("code") == 0
    except Exception:
        return False


def login(server, username, password):
    cookie_jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(cookie_jar),
        urllib.request.HTTPSHandler(context=ssl.create_default_context()),
    )
    body = urllib.parse.urlencode({
        "login": username,
        "passwd": password,
        "rand": "",
        "mobileFlag": "false",
    }).encode()
    request = urllib.request.Request(
        f"https://{server}/shair/loginAction!ajaxLogin.action?v=mgj",
        data=body,
        headers={
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Origin": f"https://{server}",
            "Referer": f"https://{server}/shair/",
            "User-Agent": USER_AGENT,
        },
    )
    with opener.open(request, timeout=20) as response:
        result = json.loads(response.read().decode("utf-8", errors="replace"))
    if result.get("code") != 7:
        raise RuntimeError(f"Meiguanjia login code={result.get('code')}")
    parts = [f"{cookie.name}={cookie.value}" for cookie in cookie_jar]
    if not any(part.startswith("JSESSIONID=") for part in parts):
        raise RuntimeError("Meiguanjia login response missing JSESSIONID")
    return "; ".join(parts)


def save_session(config, cookie):
    updated = dict(config)
    updated.update({
        "cookies": cookie,
        "cookie_server": updated.get("server") or DEFAULT_SERVER,
        "cookie_source": "booking_sync_relogin",
        "saved_at": now_iso(),
    })
    atomic_write_json(CONFIG_PATH, updated)


def ensure_session():
    config = load_json(CONFIG_PATH)
    server = str(config.get("server") or DEFAULT_SERVER)
    cookie = str(config.get("cookies") or "")
    if check_session(server, cookie):
        return server, cookie

    session_lock = acquire_lock(SESSION_LOCK_PATH)
    if session_lock is None:
        for _ in range(5):
            time.sleep(2)
            config = load_json(CONFIG_PATH)
            cookie = str(config.get("cookies") or "")
            if check_session(server, cookie):
                return server, cookie
        raise RuntimeError("Meiguanjia session renewal is busy")

    try:
        config = load_json(CONFIG_PATH)
        server = str(config.get("server") or DEFAULT_SERVER)
        cookie = str(config.get("cookies") or "")
        if check_session(server, cookie):
            return server, cookie
        auth = load_json(AUTH_PATH)
        username = str(auth.get("login") or "")
        password = str(auth.get("password") or "")
        if not username or not password:
            raise RuntimeError("missing local Meiguanjia credentials")
        cookie = login(server, username, password)
        if not check_session(server, cookie):
            raise RuntimeError("renewed Meiguanjia session failed verification")
        save_session(config, cookie)
        return server, cookie
    finally:
        release_lock(session_lock)


def curl_request(method, path, body=None, prefer=None, timeout=30):
    remaining = remaining_run_seconds()
    if remaining is not None and remaining < 1:
        raise TimeoutError("预约同步运行时间已到105秒上限")
    effective_timeout = timeout if remaining is None else max(1, min(timeout, int(remaining)))
    process_timeout = timeout + 5 if remaining is None else max(1, remaining)
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    command = [
        "curl",
        "--silent",
        "--show-error",
        "--fail-with-body",
        "--request",
        method,
        url,
        "--header",
        f"apikey: {SUPABASE_KEY}",
        "--header",
        "Content-Type: application/json",
        "--max-time",
        str(effective_timeout),
        "--retry",
        "2",
        "--retry-delay",
        "1",
        "--retry-max-time",
        str(effective_timeout),
        "--retry-connrefused",
    ]
    if prefer:
        command.extend(["--header", f"Prefer: {prefer}"])
    input_text = None
    if body is not None:
        command.extend(["--data-binary", "@-"])
        input_text = json.dumps(body, ensure_ascii=False)
    result = subprocess.run(
        command,
        input=input_text,
        capture_output=True,
        text=True,
        timeout=process_timeout,
        check=False,
    )
    if result.returncode != 0:
        message = (result.stderr or result.stdout or "unknown error").strip()
        raise RuntimeError(f"Supabase {method} failed: {message[:500]}")
    response_text = result.stdout.strip()
    return json.loads(response_text) if response_text else None


def supabase_get_all(path, page_size=1000):
    rows = []
    offset = 0
    separator = "&" if "?" in path else "?"
    while True:
        page = curl_request("GET", f"{path}{separator}limit={page_size}&offset={offset}")
        if not isinstance(page, list):
            raise RuntimeError("Supabase GET did not return a list")
        rows.extend(page)
        if len(page) < page_size:
            return rows
        offset += page_size


def reservation_date_keys(days=8):
    today = date.today()
    return [(today + timedelta(days=offset)).isoformat() for offset in range(days)]


def reservation_timestamp(date_text):
    value = datetime.strptime(date_text, "%Y-%m-%d").replace(
        hour=12,
        tzinfo=CHINA_TZ,
    )
    return int(value.timestamp() * 1000)


def normalize_reservation(raw, shop, date_text, today_text):
    try:
        booking_id = int(raw.get("id"))
    except (TypeError, ValueError):
        return None
    try:
        status = int(raw.get("status"))
    except (TypeError, ValueError):
        return None
    allowed = (0, 1, 3, 4) if date_text == today_text else (0, 3, 4)
    if status not in allowed:
        return None
    customer_name = raw.get("custName") or ""
    if customer_name == "未登记":
        customer_name = ""
    reservation_time = raw.get("reservationTime") or 0
    time_label = ""
    if reservation_time:
        value = datetime.fromtimestamp(int(reservation_time) / 1000, tz=CHINA_TZ)
        time_label = value.strftime("%H:%M")
    return {
        "id": booking_id,
        "shop_id": shop["shopId"],
        "shop_name": shop["name"],
        "barber_name": raw.get("barberName") or "待分配",
        "barber_id": str(raw.get("barberId") or ""),
        "customer_name": customer_name,
        "customer_phone": str(raw.get("memmobile") or "").strip(),
        "service_name": raw.get("categoryName") or "",
        "notes": raw.get("comment") or "",
        "reservation_time": reservation_time,
        "time_label": time_label,
        "date": date_text,
        "status": status,
        "updated_at": now_iso(),
    }


def fetch_reservation_pair(server, cookie, shop, date_text, today_text):
    payload = {
        "parentShopId": shop["parentShopId"],
        "shopId": shop["shopId"],
        "reservationTime": reservation_timestamp(date_text),
        "period": date_text,
    }
    body = urllib.parse.urlencode({
        "jsonObj": json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        "shopid": shop["shopId"],
    }).encode()
    result = request_json(
        f"https://{server}/shair/reservation!list.action",
        cookie=cookie,
        data=body,
    )
    if result.get("code") != 0:
        raise RuntimeError(f"Meiguanjia reservation code={result.get('code')}")
    reservations = (result.get("content") or {}).get("reservations") or []
    if not isinstance(reservations, list):
        raise RuntimeError("Meiguanjia reservations is not a list")
    normalized = []
    for raw in reservations:
        booking = normalize_reservation(raw, shop, date_text, today_text)
        if booking is not None:
            normalized.append(booking)
    return normalized


def deletion_ids(existing_rows, fetched_by_pair, successful_pairs):
    existing_by_pair = {}
    for row in existing_rows:
        pair = (str(row.get("shop_id") or ""), str(row.get("date") or ""))
        existing_by_pair.setdefault(pair, set()).add(int(row["id"]))
    result = set()
    for pair in successful_pairs:
        fetched_ids = {row["id"] for row in fetched_by_pair.get(pair, [])}
        result.update(existing_by_pair.get(pair, set()) - fetched_ids)
    return result


def chunked(values, size):
    values = list(values)
    for index in range(0, len(values), size):
        yield values[index:index + size]


def sync_bookings():
    server, cookie = ensure_session()
    dates = reservation_date_keys()
    today_text = date.today().isoformat()
    fetched_by_pair = {}
    successful_pairs = set()
    fetch_errors = []

    budget_exhausted = False
    for shop in SHOPS:
        for date_text in dates:
            if not run_budget_available():
                fetch_errors.append("预约同步运行时间已到105秒上限，剩余日期留待下次")
                budget_exhausted = True
                break
            pair = (shop["shopId"], date_text)
            try:
                fetched_by_pair[pair] = fetch_reservation_pair(
                    server,
                    cookie,
                    shop,
                    date_text,
                    today_text,
                )
                successful_pairs.add(pair)
            except Exception as exc:
                fetch_errors.append(f"{shop['name']} {date_text}: {exc}")
        if budget_exhausted:
            break

    bookings = [
        booking
        for pair in successful_pairs
        for booking in fetched_by_pair.get(pair, [])
    ]
    write_errors = []
    upserted = 0
    for batch in chunked(bookings, 100):
        try:
            curl_request(
                "POST",
                "bookings?on_conflict=id",
                batch,
                prefer="resolution=merge-duplicates,return=minimal",
            )
            upserted += len(batch)
        except Exception as exc:
            write_errors.append(str(exc))

    existing_rows = None
    try:
        existing_rows = supabase_get_all(
            "bookings?select=id,shop_id,date"
            f"&date=gte.{dates[0]}&date=lte.{dates[-1]}"
        )
    except Exception as exc:
        write_errors.append(f"existing booking read failed: {exc}")

    deleted = 0
    if existing_rows is not None:
        stale_ids = sorted(deletion_ids(
            existing_rows,
            fetched_by_pair,
            successful_pairs,
        ))
        for batch in chunked(stale_ids, 100):
            try:
                id_filter = ",".join(str(value) for value in batch)
                curl_request(
                    "DELETE",
                    f"bookings?id=in.({id_filter})",
                    prefer="return=minimal",
                )
                deleted += len(batch)
            except Exception as exc:
                write_errors.append(str(exc))

    if not fetch_errors and not write_errors:
        status = "healthy"
    elif successful_pairs:
        status = "partial"
    else:
        status = "degraded"
    expected_pairs = len(SHOPS) * len(dates)
    summary = {
        "pairs_ok": len(successful_pairs),
        "pairs_failed": expected_pairs - len(successful_pairs),
        "fetched": len(bookings),
        "upserted": upserted,
        "deleted": deleted,
        "write_errors": len(write_errors),
    }
    write_status(
        status,
        **summary,
        errors=(fetch_errors + write_errors)[:10],
    )
    print(
        "预约同步: "
        f"成功日期{summary['pairs_ok']}/16 "
        f"读取{summary['fetched']} 写入{summary['upserted']} 删除{summary['deleted']}"
    )
    if fetch_errors or write_errors:
        for error in (fetch_errors + write_errors)[:10]:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


def main():
    global RUN_DEADLINE
    RUN_DEADLINE = time.monotonic() + RUN_BUDGET_SECONDS
    run_lock = acquire_lock(RUN_LOCK_PATH)
    if run_lock is None:
        write_status("skipped_busy", reason="booking_sync_running")
        print("预约同步已有任务运行，本次跳过")
        return 0
    try:
        return sync_bookings()
    except Exception as exc:
        write_status("degraded", error=f"{type(exc).__name__}:{exc}")
        print(f"预约同步失败: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    finally:
        release_lock(run_lock)


if __name__ == "__main__":
    sys.exit(main())
