#!/usr/bin/env python3
"""Synchronize Meiguanjia appointments to Supabase without unsafe deletion."""

import base64
import fcntl
import http.cookiejar
import json
import os
import socket
import ssl
import sys
import tempfile
import time
import uuid
import urllib.parse
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
try:
    from mgj_booking_source import complete_reservations
except ModuleNotFoundError:
    from scripts.mgj_booking_source import complete_reservations
try:
    import mgj_source_turns as source_turns
except ModuleNotFoundError:
    from scripts import mgj_source_turns as source_turns

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


CONFIG_PATH = os.path.expanduser("~/.hermes/meiguanjia-config.json")
AUTH_PATH = os.path.expanduser("~/.hermes/meiguanjia-auth.json")
STATUS_PATH = os.path.expanduser("~/.hermes/sync_bookings_status.json")
CADENCE_PATH = os.path.expanduser("~/.hermes/mgj_booking_cadence.json")
FUTURE_INTERVAL_SECONDS = 15 * 60
RUN_LOCK_PATH = "/tmp/sync_mgj_bookings.lock"
SESSION_LOCK_PATH = "/tmp/sync_mgj_all.lock"
DEFAULT_SERVER = "vip12.meiguanjia.net"
SUPABASE_URL = "https://pdssrmpeiuwvxzsgschm.supabase.co"
SUPABASE_KEY = "sb_publishable_MDx4d2QzQpTojF8yLRHIqw_uKQW7A7t"
SIGNING_KEY_PATH = os.path.expanduser("~/.hermes/mgj-booking-sync-ed25519.pem")
SYNC_FUNCTION = f"{SUPABASE_URL}/functions/v1/mgj-booking-sync"
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
    lock_file = open(path, "a+", encoding="utf-8")
    flags = fcntl.LOCK_EX
    if not blocking:
        flags |= fcntl.LOCK_NB
    try:
        fcntl.flock(lock_file.fileno(), flags)
    except BlockingIOError:
        lock_file.close()
        return None
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


class NoSourceRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("source_redirect_rejected")


def source_urlopen(request, timeout):
    """Exact source-only direct read route; verified TLS and no redirects."""
    parsed = urllib.parse.urlsplit(request.full_url)
    allowed_paths = {
        "/shair/metedata!reservationMetadata.action",
        "/shair/reservation!list.action",
    }
    if (parsed.scheme != "https" or parsed.hostname != DEFAULT_SERVER
            or parsed.port not in (None, 443) or parsed.username or parsed.password
            or parsed.path not in allowed_paths or parsed.query or parsed.fragment):
        raise ValueError("invalid_booking_source_destination")
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}), NoSourceRedirect(),
        urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    return opener.open(request, timeout=timeout)


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
        # The batch lock still protects cadence/v2 ordering. Only real source
        # HTTP/body reads hold this narrow turn; retries sleep outside it.
        with source_turns.booking_request(deadline=RUN_DEADLINE):
            remaining = remaining_run_seconds()
            if remaining is not None and remaining < 1:
                raise TimeoutError("预约同步运行时间已到本轮上限")
            effective_timeout = timeout if remaining is None else max(1, min(timeout, int(remaining)))
            with source_urlopen(request, timeout=effective_timeout) as response:
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
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            return False
        raise
    # A timeout is not proof of expiry. Do not repeatedly log in on outages.


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
    with source_turns.booking_request(deadline=RUN_DEADLINE):
        # A preceding customer read may consume part of the existing deadline.
        remaining = remaining_run_seconds()
        if remaining is not None and remaining < 1:
            raise TimeoutError("预约同步运行时间已到本轮上限")
        effective_timeout = 20 if remaining is None else max(1, min(20, int(remaining)))
        with opener.open(request, timeout=effective_timeout) as response:
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


def load_signing_key():
    if os.stat(SIGNING_KEY_PATH).st_mode & 0o077:
        raise PermissionError("预约同步私钥权限必须为0600")
    with open(SIGNING_KEY_PATH, "rb") as source:
        key = serialization.load_pem_private_key(source.read(), password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise ValueError("预约同步私钥类型必须为Ed25519")
    return key


def signed_protocol_request(payload, signing_key, timeout=15):
    shop_id, date_text = payload["shop_id"], payload["date"]
    body = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    timestamp = str(int(time.time()))
    signature = base64.urlsafe_b64encode(
        signing_key.sign(timestamp.encode("ascii") + b"." + body)
    ).rstrip(b"=").decode("ascii")
    request = urllib.request.Request(
        SYNC_FUNCTION,
        data=body,
        headers={
            "Content-Type": "application/json",
            "apikey": SUPABASE_KEY,
            "X-Booking-Sync-Ts": timestamp,
            "X-Booking-Sync-Signature": signature,
        },
    )

    def perform():
        remaining = remaining_run_seconds()
        if remaining is not None and remaining < 1:
            raise TimeoutError("预约同步运行时间已到本轮上限")
        effective_timeout = timeout if remaining is None else max(1, min(timeout, int(remaining)))
        try:
            with urllib.request.urlopen(
                request, timeout=effective_timeout, context=ssl.create_default_context()
            ) as response:
                result = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError:
            raise
        if not isinstance(result, dict) or result.get("shop_id") != shop_id or result.get("date") != date_text:
            raise RuntimeError("预约写入接口返回异常")
        if type(result.get("protocol")) is not int or result["protocol"] != 2:
            raise RuntimeError("预约协议版本不符")
        if result.get("operation") != payload["operation"]:
            raise RuntimeError("预约回执操作不符")
        if payload["operation"] in ("commit", "abort") and result.get("lease_id") != payload["lease_id"]:
            raise RuntimeError("预约回执租约不符")
        if payload["operation"] == "commit" and (type(result.get("upserted")) is not int or result["upserted"] != len(payload["bookings"])):
            raise RuntimeError("预约写入接口回报数量不符")
        if payload["operation"] == "begin":
            try:
                uuid.UUID(result["lease_id"])
                expiry_text = result["expires_at"].replace("Z", "+00:00")
                # macOS Python 3.9 fromisoformat rejects valid 1/2/4/5 digit fractions.
                expiry_format = "%Y-%m-%dT%H:%M:%S.%f%z" if "." in expiry_text else "%Y-%m-%dT%H:%M:%S%z"
                expiry = datetime.strptime(expiry_text, expiry_format)
                if expiry.tzinfo is None or expiry.timestamp() <= time.time():
                    raise ValueError("expired")
                if type(result.get("generation")) is not int or result["generation"] <= 0:
                    raise ValueError("generation")
            except (KeyError, ValueError, TypeError, AttributeError):
                raise RuntimeError("预约租约无效")
        if payload["operation"] == "commit":
            if type(result.get("deleted")) is not int or not 0 <= result["deleted"] <= 1000:
                raise RuntimeError("预约清理回执无效")
        return result

    return with_network_retries(perform)


def reservation_date_keys(days=8):
    today = datetime.now(CHINA_TZ).date()
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
    try:
        reservation_time = int(raw.get("reservationTime") or 0)
    except (TypeError, ValueError):
        return None
    time_label = ""
    if reservation_time:
        value = datetime.fromtimestamp(reservation_time / 1000, tz=CHINA_TZ)
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


def fetch_reservation_snapshot(server, cookie, shop, date_text, today_text):
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
    reservations = complete_reservations(result, shop["shopId"], date_text)
    normalized = []
    for raw in reservations:
        booking = normalize_reservation(raw, shop, date_text, today_text)
        if booking is not None:
            normalized.append(booking)
    return {
        "raw_result": result,
        "raw_rows": reservations,
        "source_ids": [int(row["id"]) for row in reservations],
        "source_statuses": {str(int(row["id"])): int(row["status"]) for row in reservations},
        "bookings": normalized,
    }


def fetch_reservation_pair(server, cookie, shop, date_text, today_text):
    # Compatibility only. New signed protocol must call snapshot and carry
    # source_ids/source_statuses; filtered bookings are not a source inventory.
    return fetch_reservation_snapshot(server, cookie, shop, date_text, today_text)["bookings"]


def scheduled_dates(cadence, now=None):
    """Today every tick; at most one overdue future day, oldest first."""
    now = time.time() if now is None else now
    dates = reservation_date_keys()
    history = cadence.get("dates", {})
    due = [d for d in dates[1:] if now - history.get(d, {}).get("success_at", 0) >= FUTURE_INTERVAL_SECONDS
           and now >= history.get(d, {}).get("retry_after", 0)]
    due.sort(key=lambda d: (history.get(d, {}).get("success_at", 0), d))
    return dates[:1] + due[:1]


def sync_bookings(dates=None, cadence=None):
    server, cookie = ensure_session()
    dates = reservation_date_keys() if dates is None else dates
    today_text = datetime.now(CHINA_TZ).date().isoformat()
    successful_pairs, written_keys = set(), set()
    fetch_errors, write_errors = [], []
    upserted = deleted = written_pairs = fetched_count = 0
    signing_key = load_signing_key()
    stop = False
    for date_text in dates:
        for shop in SHOPS:
            if not run_budget_available(8):
                stop = True
                write_errors.append("run_budget_exhausted")
                break
            pair = (shop["shopId"], date_text)
            base = {"protocol": 2, "shop_id": shop["shopId"], "date": date_text}
            try:
                lease = signed_protocol_request(dict(base, operation="begin", request_id=str(uuid.uuid4())), signing_key)
            except Exception as exc:
                # An unknown begin result can hold a lease. Never collect or
                # move to another pair until it expires.
                write_errors.append("begin_" + type(exc).__name__)
                stop = True
                break
            try:
                snapshot = fetch_reservation_snapshot(server, cookie, shop, date_text, today_text)
                successful_pairs.add(pair)
                fetched_count += len(snapshot["bookings"])
            except Exception as exc:
                fetch_errors.append("source_" + type(exc).__name__)
                if cadence is not None and isinstance(exc, urllib.error.HTTPError) and exc.code in (401, 403, 429):
                    cadence["cooldown_until"] = time.time() + 300
                try:
                    signed_protocol_request(dict(base, operation="abort", lease_id=lease["lease_id"]), signing_key)
                except Exception:
                    pass
                stop = True
                break
            try:
                source_rows = [{"id": int(r["id"]), "status": int(r["status"]),
                                "reservation_time": int(r["reservationTime"])}
                               for r in snapshot["raw_rows"]]
                result = signed_protocol_request(dict(base, operation="commit",
                    lease_id=lease["lease_id"], source_complete=True,
                    source_rows=source_rows, bookings=snapshot["bookings"]), signing_key)
                if type(result.get("generation")) is not int or result["generation"] != lease["generation"]:
                    raise RuntimeError("预约回执版本不符")
                upserted += result["upserted"]
                deleted += result["deleted"]
                written_pairs += 1
                written_keys.add(pair)
            except Exception as exc:
                # A commit timeout can mean committed. Same-body retry above
                # is idempotent; never release/re-begin to replay a stale read.
                write_errors.append("commit_" + type(exc).__name__)
                stop = True
                break
        if stop:
            break

    if not fetch_errors and not write_errors:
        status = "healthy"
    elif written_pairs:
        status = "partial"
    else:
        status = "degraded"
    expected_pairs = len(SHOPS) * len(dates)
    if cadence is not None:
        history = cadence.setdefault("dates", {})
        for day in dates:
            previous = history.setdefault(day, {})
            if all((shop["shopId"], day) in written_keys for shop in SHOPS):
                previous.update(success_at=time.time(), retry_after=0)
            else:
                previous["retry_after"] = time.time() + 120
        cadence["dates"] = {d: v for d, v in history.items() if d in reservation_date_keys()}
        atomic_write_json(CADENCE_PATH, cadence)
    summary = {
        "pairs_ok": len(successful_pairs),
        "pairs_written": written_pairs,
        "pairs_failed": expected_pairs - len(successful_pairs),
        "fetched": fetched_count,
        "upserted": upserted,
        "deleted": deleted,
        "write_errors": len(write_errors),
        "pairs_expected": expected_pairs,
        "dates": dates,
    }
    write_status(
        status,
        **summary,
        errors=(fetch_errors + write_errors)[:10],
    )
    print(
        "预约同步: "
        f"读取日期{summary['pairs_ok']}/{expected_pairs} 写入日期{written_pairs}/{expected_pairs} "
        f"读取{summary['fetched']} 写入{summary['upserted']} 删除{summary['deleted']}"
    )
    if fetch_errors or write_errors:
        for error in (fetch_errors + write_errors)[:10]:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


def main():
    global RUN_DEADLINE
    # Refuse root/other-user launches before lock, status, cadence or source I/O.
    if os.getuid() != 501 or os.geteuid() != 501:
        print("预约同步拒绝非预期运行身份", file=sys.stderr)
        return 1
    scheduled = "--scheduled" in sys.argv[1:]
    cadence = None
    RUN_DEADLINE = time.monotonic() + (90 if scheduled else RUN_BUDGET_SECONDS)
    run_lock = acquire_lock(RUN_LOCK_PATH)
    if run_lock is None:
        print("预约同步已有任务运行，本次跳过")
        return 0
    try:
        try:
            cadence = load_json(CADENCE_PATH)
        except FileNotFoundError:
            cadence = {"dates": {}}
        now = time.time()
        # All entry modes share one durable pre-attempt gate, under the lock.
        if now < cadence.get("cooldown_until", 0) or now - cadence.get("attempt_at", 0) < 60:
            return 0
        dates = scheduled_dates(cadence, now)
        history = cadence.get("dates", {})
        dates = [d for d in dates if now >= history.get(d, {}).get("retry_after", 0)]
        if not dates:
            return 0
        cadence["attempt_at"] = now
        atomic_write_json(CADENCE_PATH, cadence)
        return sync_bookings(dates, cadence)
    except Exception as exc:
        if cadence is not None:
            cadence["cooldown_until"] = max(cadence.get("cooldown_until", 0), time.time() + 300)
            atomic_write_json(CADENCE_PATH, cadence)
        write_status("degraded", error=type(exc).__name__)
        print(f"预约同步失败: {type(exc).__name__}", file=sys.stderr)
        return 1
    finally:
        release_lock(run_lock)


if __name__ == "__main__":
    if os.getuid() != 501 or os.geteuid() != 501:
        print("预约同步拒绝非预期运行身份", file=sys.stderr)
        sys.exit(1)
    result = main()
    # Consumption has its own installed launchd job; do not duplicate it here.
    sys.exit(result)
